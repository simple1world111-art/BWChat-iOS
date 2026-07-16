import Foundation
import UIKit

enum MomentFeedTab: String, CaseIterable, Identifiable {
    case recommended
    case following

    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .recommended:
            return "moments.tab.recommended"
        case .following:
            return "moments.tab.following"
        }
    }
}

private struct MomentsFeedState {
    var moments: [Moment] = []
    var isLoading = false
    var hasMore = true
    var nextBeforeID: Int?
    var errorMessage: String?
}

private struct MomentsFeedPage {
    let moments: [Moment]
    let hasMore: Bool
    let nextBeforeID: Int?
}

private enum MomentsFeedContext: Hashable {
    case tab(MomentFeedTab)
    case user(String)
}

@MainActor
class MomentsViewModel: ObservableObject {
    private struct PendingMomentUpload {
        let context: MomentsFeedContext
        let content: String
        let media: [MomentUploadMedia]
        let unlockPriceCatFood: Int?
    }
    private struct CachedMomentFeed: Codable {
        let items: [Moment]
        let hasMore: Bool
        let nextBeforeID: Int?

        init(items: [Moment], hasMore: Bool, nextBeforeID: Int? = nil) {
            self.items = items
            self.hasMore = hasMore
            self.nextBeforeID = nextBeforeID
        }
    }
    @Published var selectedTab: MomentFeedTab = .recommended {
        didSet {
            guard filterUserID == nil else { return }
            seedFromCacheIfNeeded(for: .tab(selectedTab))
        }
    }

    @Published private var feedStates: [MomentFeedTab: MomentsFeedState] = [
        .recommended: MomentsFeedState(),
        .following: MomentsFeedState()
    ]
    @Published private var userState = MomentsFeedState()
    @Published private(set) var uploadingMomentIDs = Set<Int>()
    @Published private(set) var failedMomentIDs = Set<Int>()
    private var pendingMomentUploads: [Int: PendingMomentUpload] = [:]

    /// nil = public feed tabs; non-nil = single user's moments
    var filterUserID: String? {
        didSet {
            guard oldValue != filterUserID else { return }
            if filterUserID != nil {
                userState = MomentsFeedState()
            }
            seedFromCacheIfNeeded(for: activeContext)
        }
    }

    var moments: [Moment] {
        state(for: activeContext).moments
    }

    var isLoading: Bool {
        state(for: activeContext).isLoading
    }

    var hasMore: Bool {
        state(for: activeContext).hasMore
    }

    var errorMessage: String? {
        state(for: activeContext).errorMessage
    }

    private static let followingCacheKey = "moments_following_feed"
    private static let worldCacheKey = "moments_world_feed"
    private var seededCacheKeys = Set<String>()
    private var activeContext: MomentsFeedContext {
        if let uid = filterUserID {
            return .user(uid)
        }
        return .tab(selectedTab)
    }

    private func state(for context: MomentsFeedContext) -> MomentsFeedState {
        switch context {
        case .tab(let tab):
            return feedStates[tab] ?? MomentsFeedState()
        case .user:
            return userState
        }
    }

    private func setState(_ state: MomentsFeedState, for context: MomentsFeedContext) {
        switch context {
        case .tab(let tab):
            feedStates[tab] = state
        case .user:
            userState = state
        }
    }

    private func mutateState(
        for context: MomentsFeedContext,
        _ update: (inout MomentsFeedState) -> Void
    ) {
        var next = state(for: context)
        update(&next)
        setState(next, for: context)
    }

    private func cacheKey(for context: MomentsFeedContext) -> String? {
        switch context {
        case .tab(.following):
            return Self.followingCacheKey
        case .tab(.recommended):
            return Self.worldCacheKey
        case .user:
            return nil
        }
    }

    private func snapshotKey(for context: MomentsFeedContext) -> CacheKey? {
        switch context {
        case .tab(let tab):
            return CacheKey.current(namespace: "moments-feed", key: tab.rawValue)
        case .user(let userID):
            return CacheKey.current(namespace: "moments-user", key: userID)
        }
    }

    private func seedFromCacheIfNeeded(for context: MomentsFeedContext) {
        // “关注”必须以服务端当前关注关系为准，不能先展示可能已经过期、
        // 或由旧版服务端混入非关注作者的本地 Feed 快照。
        if context == .tab(.following) { return }

        let marker: String
        switch context {
        case .tab(let tab): marker = "tab.\(tab.rawValue)"
        case .user(let userID): marker = "user.\(userID)"
        }
        guard !seededCacheKeys.contains(marker),
              state(for: context).moments.isEmpty
        else { return }

        seededCacheKeys.insert(marker)
        if let key = snapshotKey(for: context),
           let cached: CachedSnapshot<CachedMomentFeed> = AppCacheRepository.shared.cachedValue(for: key) {
            mutateState(for: context) { state in
                state.moments = cached.value.items
                state.hasMore = cached.value.hasMore
                state.nextBeforeID = cached.value.nextBeforeID
            }
        } else if let legacyKey = cacheKey(for: context),
                  let cached = LocalCache.load([Moment].self, key: legacyKey) {
            mutateState(for: context) { state in state.moments = cached }
            if let key = snapshotKey(for: context) {
                AppCacheRepository.shared.save(
                    CachedMomentFeed(
                        items: Array(cached.prefix(200)),
                        hasMore: true,
                        nextBeforeID: cached.last?.id
                    ),
                    for: key,
                    policy: .feed
                )
                LocalCache.clear(key: legacyKey)
            }
        }
    }

    private func persistIfNeeded(_ context: MomentsFeedContext) {
        if let snapshotKey = snapshotKey(for: context) {
            let current = state(for: context)
            AppCacheRepository.shared.save(
                CachedMomentFeed(
                    items: Array(current.moments.prefix(200)),
                    hasMore: current.hasMore,
                    nextBeforeID: current.nextBeforeID
                ),
                for: snapshotKey,
                policy: .feed
            )
        }
    }

    private func fetchFeed(
        for context: MomentsFeedContext,
        beforeID: Int? = nil,
        limit: Int = 20
    ) async throws -> MomentsFeedPage {
        switch context {
        case .tab(.recommended):
            let result = try await APIService.shared.getMomentsWorld(beforeID: beforeID, limit: limit)
            return MomentsFeedPage(
                moments: result.0,
                hasMore: result.1,
                nextBeforeID: result.0.last?.id
            )
        case .tab(.following):
            // `/moments/feed` is the authoritative personalized feed. Do not
            // gate it on a second `/follows/following` request or filter its
            // authors again: either can turn a valid server page into a false
            // empty state when identifiers or pagination differ.
            let result = try await APIService.shared.getMomentsFollowing(beforeID: beforeID, limit: limit)
            return MomentsFeedPage(
                moments: Self.followingFeedItems(from: result.0),
                hasMore: result.1,
                nextBeforeID: result.0.last?.id
            )
        case .user(let uid):
            let result = try await APIService.shared.getUserMoments(userID: uid, limit: limit, beforeID: beforeID)
            return MomentsFeedPage(
                moments: result.0,
                hasMore: result.1,
                nextBeforeID: result.0.last?.id
            )
        }
    }

    /// Policy seam covered by tests: the server owns follow filtering and
    /// ordering, while the client only renders the returned page.
    nonisolated static func followingFeedItems(from moments: [Moment]) -> [Moment] {
        moments
    }

    private func insertMoment(_ moment: Moment, for context: MomentsFeedContext) {
        mutateState(for: context) { state in
            state.moments.removeAll { $0.id == moment.id }
            state.moments.insert(moment, at: 0)
        }
        persistIfNeeded(context)
    }

    private func insertMomentIntoPublicTabs(_ moment: Moment) {
        insertMoment(moment, for: .tab(.recommended))
    }

    private func replaceMoment(tempID: Int, with moment: Moment, for context: MomentsFeedContext) {
        mutateState(for: context) { state in
            let insertionIndex = state.moments.firstIndex { $0.id == tempID } ?? 0
            state.moments.removeAll { $0.id == tempID || $0.id == moment.id }
            state.moments.insert(moment, at: min(insertionIndex, state.moments.count))
        }
        persistIfNeeded(context)
    }

    private func replaceMomentInRelatedPublicLists(tempID: Int, with moment: Moment, source: MomentsFeedContext) {
        switch source {
        case .tab:
            replaceMoment(tempID: tempID, with: moment, for: .tab(.recommended))
        case .user:
            replaceMoment(tempID: tempID, with: moment, for: source)
        }
    }

    private func updateMomentIfPresent(_ moment: Moment, for context: MomentsFeedContext) {
        var didUpdate = false
        mutateState(for: context) { state in
            guard let index = state.moments.firstIndex(where: { $0.id == moment.id }) else { return }
            state.moments[index] = moment
            didUpdate = true
        }
        if didUpdate {
            persistIfNeeded(context)
        }
    }

    private func updateMomentInRelatedPublicLists(_ moment: Moment, source: MomentsFeedContext) {
        switch source {
        case .tab:
            for tab in MomentFeedTab.allCases {
                updateMomentIfPresent(moment, for: .tab(tab))
            }
        case .user:
            updateMomentIfPresent(moment, for: source)
            for tab in MomentFeedTab.allCases {
                updateMomentIfPresent(moment, for: .tab(tab))
            }
        }
    }

    private func removeMomentFromRelatedPublicLists(momentID: Int, source: MomentsFeedContext) {
        func remove(from context: MomentsFeedContext) {
            mutateState(for: context) { state in
                state.moments.removeAll { $0.id == momentID }
            }
            persistIfNeeded(context)
        }

        switch source {
        case .tab:
            for tab in MomentFeedTab.allCases {
                remove(from: .tab(tab))
            }
        case .user:
            remove(from: source)
            for tab in MomentFeedTab.allCases {
                remove(from: .tab(tab))
            }
        }
    }

    private func currentUserAuthor() -> MomentAuthor {
        let user = AuthManager.shared.currentUser
        return MomentAuthor(
            userID: user?.userID ?? "",
            nickname: user?.nickname ?? "",
            avatarURL: user?.avatarURL ?? ""
        )
    }

    private func temporaryMomentID() -> Int {
        -Int(Date().timeIntervalSince1970 * 1000) - Int.random(in: 0..<1_000)
    }

    private func currentTimestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }

    private func cacheOptimisticPreview(_ image: UIImage, for key: String) {
        ImageCacheManager.shared.setImage(image, for: key)
        ImageCacheManager.shared.setImage(image, for: key + "?thumb=1")
    }

    private func optimisticMedia(from uploads: [MomentUploadMedia], tempID: Int) -> [MomentMedia] {
        uploads.enumerated().map { index, upload in
            let mediaKey = "local-moment://\(abs(tempID))/\(index)"
            let previewData = upload.previewImageData ?? (upload.kind == .image ? upload.data : nil)
            if let previewData, let image = UIImage(data: previewData) {
                cacheOptimisticPreview(image, for: mediaKey)
            }

            switch upload.kind {
            case .image:
                return MomentMedia(
                    id: mediaKey,
                    type: .image,
                    url: mediaKey,
                    thumbnailURL: mediaKey,
                    isLocked: false
                )
            case .video:
                return MomentMedia(
                    id: mediaKey,
                    type: .video,
                    url: "local-video://\(abs(tempID))/\(index)",
                    thumbnailURL: mediaKey,
                    isLocked: false
                )
            }
        }
    }

    private func optimisticMoment(
        tempID: Int,
        content: String,
        media uploads: [MomentUploadMedia],
        unlockPriceCatFood: Int?
    ) -> Moment {
        let media = optimisticMedia(from: uploads, tempID: tempID)
        return Moment(
            id: tempID,
            author: currentUserAuthor(),
            content: content,
            images: media.filter { $0.type == .image }.map(\.url),
            createdAt: currentTimestamp(),
            likes: [],
            comments: [],
            likedByMe: false,
            media: media,
            unlockPriceCatFood: uploads.isEmpty ? nil : unlockPriceCatFood,
            isUnlocked: true,
            locationName: nil
        )
    }

    func loadFeed(refresh: Bool = false) async {
        let context = activeContext
        seedFromCacheIfNeeded(for: context)

        if refresh {
            mutateState(for: context) { state in
                state.hasMore = true
                state.nextBeforeID = nil
            }
        }

        guard !state(for: context).isLoading else { return }

        let showLoader = state(for: context).moments.isEmpty || refresh
        if showLoader {
            mutateState(for: context) { state in
                state.isLoading = true
            }
        }
        mutateState(for: context) { state in
            state.errorMessage = nil
        }

        defer {
            mutateState(for: context) { state in
                state.isLoading = false
            }
        }

        do {
            let page: MomentsFeedPage
            if context == .tab(.following) {
                page = try await fetchFeed(for: context)
            } else if let key = snapshotKey(for: context) {
                let cached: CachedMomentFeed = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .feed,
                    forceRefresh: refresh
                ) {
                    let result = try await self.fetchFeed(for: context)
                    return CachedMomentFeed(
                        items: result.moments,
                        hasMore: result.hasMore,
                        nextBeforeID: result.nextBeforeID
                    )
                }
                page = MomentsFeedPage(
                    moments: cached.items,
                    hasMore: cached.hasMore,
                    nextBeforeID: cached.nextBeforeID
                )
            } else {
                page = try await fetchFeed(for: context)
            }
            mutateState(for: context) { state in
                if state.moments != page.moments {
                    state.moments = page.moments
                }
                state.hasMore = page.hasMore
                state.nextBeforeID = page.nextBeforeID
            }
            persistIfNeeded(context)
        } catch {
            if state(for: context).moments.isEmpty {
                mutateState(for: context) { state in
                    state.errorMessage = Self.message(for: error)
                }
            }
        }
    }

    func loadMore() async {
        let context = activeContext
        let current = state(for: context)
        guard current.hasMore,
              !current.isLoading,
              let lastID = current.nextBeforeID ?? current.moments.last?.id
        else { return }

        mutateState(for: context) { state in
            state.isLoading = true
        }

        do {
            let page = try await fetchFeed(for: context, beforeID: lastID)
            mutateState(for: context) { state in
                let existingIDs = Set(state.moments.map(\.id))
                state.moments.append(contentsOf: page.moments.filter { !existingIDs.contains($0.id) })
                state.hasMore = page.hasMore
                state.nextBeforeID = page.nextBeforeID
            }
            persistIfNeeded(context)
        } catch {
            mutateState(for: context) { state in
                state.errorMessage = Self.message(for: error)
            }
        }

        mutateState(for: context) { state in
            state.isLoading = false
        }
    }

    nonisolated private static func message(for error: Error) -> String {
        if let apiError = error as? APIError {
            return apiError.errorDescription ?? L10n.tr("common.operationFailed")
        }
        return error.localizedDescription
    }

    func loadMoreIfNeeded(currentMomentID: Int) {
        let current = state(for: activeContext)
        guard current.moments.last?.id == currentMomentID,
              current.hasMore,
              !current.isLoading
        else { return }

        Task {
            await loadMore()
        }
    }

    func toggleLike(momentID: Int) async {
        let context = activeContext

        do {
            let liked = try await APIService.shared.toggleMomentLike(momentID: momentID)
            guard let index = state(for: context).moments.firstIndex(where: { $0.id == momentID }) else { return }

            let m = state(for: context).moments[index]
            let myID = AuthManager.shared.currentUser?.userID ?? ""
            let myNick = AuthManager.shared.currentUser?.nickname ?? ""
            let myAvatar = AuthManager.shared.currentUser?.avatarURL ?? ""
            let me = MomentAuthor(userID: myID, nickname: myNick, avatarURL: myAvatar)

            var newLikes = m.likes.filter { $0.userID != myID }
            if liked { newLikes.append(me) }

            let updated = Moment(
                id: m.id, author: m.author, content: m.content,
                images: m.images, createdAt: m.createdAt,
                likes: newLikes, comments: m.comments, likedByMe: liked,
                media: m.media,
                unlockPriceCatFood: m.unlockPriceCatFood,
                isUnlocked: m.isUnlocked,
                locationName: m.locationName
            )

            updateMomentInRelatedPublicLists(updated, source: context)
        } catch {
            mutateState(for: context) { $0.errorMessage = Self.message(for: error) }
        }
    }

    func addComment(
        momentID: Int,
        content: String,
        replyToUserID: String? = nil,
        imageData: Data? = nil
    ) async {
        let context = activeContext

        do {
            let imgJpeg: Data? = imageData.flatMap { UIImage(data: $0)?.jpegData(compressionQuality: 0.7) }
            let comment = try await APIService.shared.addMomentComment(
                momentID: momentID, content: content, replyToUserID: replyToUserID, imageData: imgJpeg
            )
            guard let index = state(for: context).moments.firstIndex(where: { $0.id == momentID }) else { return }

            let m = state(for: context).moments[index]
            var newComments = m.comments
            newComments.append(comment)

            let updated = Moment(
                id: m.id, author: m.author, content: m.content,
                images: m.images, createdAt: m.createdAt,
                likes: m.likes, comments: newComments, likedByMe: m.likedByMe,
                media: m.media,
                unlockPriceCatFood: m.unlockPriceCatFood,
                isUnlocked: m.isUnlocked,
                locationName: m.locationName
            )

            updateMomentInRelatedPublicLists(updated, source: context)
        } catch {
            mutateState(for: context) { $0.errorMessage = Self.message(for: error) }
        }
    }

    func deleteMoment(momentID: Int) async {
        let context = activeContext

        if momentID < 0 {
            uploadingMomentIDs.remove(momentID)
            failedMomentIDs.remove(momentID)
            pendingMomentUploads.removeValue(forKey: momentID)
            removeMomentFromRelatedPublicLists(momentID: momentID, source: context)
            return
        }

        do {
            try await APIService.shared.deleteMoment(momentID: momentID)
            removeMomentFromRelatedPublicLists(momentID: momentID, source: context)
        } catch {
            mutateState(for: context) { $0.errorMessage = Self.message(for: error) }
        }
    }

    func publishMomentOptimistically(
        content: String,
        media: [MomentUploadMedia],
        unlockPriceCatFood: Int?
    ) {
        let context = activeContext
        let tempID = temporaryMomentID()
        let optimistic = optimisticMoment(
            tempID: tempID,
            content: content,
            media: media,
            unlockPriceCatFood: unlockPriceCatFood
        )

        switch context {
        case .tab:
            insertMomentIntoPublicTabs(optimistic)
        case .user:
            insertMoment(optimistic, for: context)
        }
        pendingMomentUploads[tempID] = PendingMomentUpload(
            context: context,
            content: content,
            media: media,
            unlockPriceCatFood: unlockPriceCatFood
        )
        enqueueMomentUpload(tempID: tempID)
    }

    func retryMomentUpload(momentID: Int) {
        guard pendingMomentUploads[momentID] != nil else { return }
        failedMomentIDs.remove(momentID)
        enqueueMomentUpload(tempID: momentID)
    }

    private func enqueueMomentUpload(tempID: Int) {
        guard let payload = pendingMomentUploads[tempID] else { return }
        uploadingMomentIDs.insert(tempID)
        BackgroundUploadCoordinator.shared.enqueue(id: "moment-\(tempID)") { [self] in
            do {
                let uploaded = try await APIService.shared.createMoment(
                    content: payload.content,
                    mediaDataList: payload.media,
                    unlockPriceCatFood: payload.unlockPriceCatFood
                )
                self.uploadingMomentIDs.remove(tempID)
                self.failedMomentIDs.remove(tempID)
                self.pendingMomentUploads.removeValue(forKey: tempID)
                self.replaceMomentInRelatedPublicLists(tempID: tempID, with: uploaded, source: payload.context)
            } catch {
                self.uploadingMomentIDs.remove(tempID)
                self.failedMomentIDs.insert(tempID)
                self.mutateState(for: payload.context) { state in
                    state.errorMessage = error.localizedDescription
                }
            }
        }
    }

    func createMoment(content: String, images: [UIImage]) async -> Bool {
        let context = activeContext
        var imageDataList: [(Data, String)] = []
        for (i, img) in images.enumerated() {
            if let data = img.jpegData(compressionQuality: 0.85) {
                imageDataList.append((data, "moment_\(Int(Date().timeIntervalSince1970))_\(i).jpg"))
            }
        }

        do {
            let moment = try await APIService.shared.createMoment(content: content, imageDataList: imageDataList)
            switch context {
            case .tab:
                insertMomentIntoPublicTabs(moment)
            case .user:
                insertMoment(moment, for: context)
            }
            return true
        } catch {
            return false
        }
    }

    func createMoment(
        content: String,
        media: [MomentUploadMedia],
        unlockPriceCatFood: Int?
    ) async -> Bool {
        let context = activeContext

        do {
            let moment = try await APIService.shared.createMoment(
                content: content,
                mediaDataList: media,
                unlockPriceCatFood: unlockPriceCatFood
            )
            switch context {
            case .tab:
                insertMomentIntoPublicTabs(moment)
            case .user:
                insertMoment(moment, for: context)
            }
            return true
        } catch {
            mutateState(for: context) { state in
                state.errorMessage = error.localizedDescription
            }
            return false
        }
    }

    func unlockMoment(momentID: Int) async -> Bool {
        let context = activeContext

        do {
            let result = try await APIService.shared.unlockMoment(momentID: momentID)
            if let updatedMoment = result.moment {
                updateMomentInRelatedPublicLists(updatedMoment, source: context)
            } else {
                await loadFeed(refresh: true)
            }
            if let walletBalance = result.walletBalance {
                WalletStore.shared.applyServerBalance(walletBalance)
            } else {
                await WalletStore.shared.refreshBalanceFromServer()
            }
            return true
        } catch {
            mutateState(for: context) { state in
                state.errorMessage = error.localizedDescription
            }
            return false
        }
    }
}
