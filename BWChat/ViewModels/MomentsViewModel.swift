import Foundation
import UIKit

enum MomentFeedTab: String, CaseIterable, Identifiable {
    case world
    case friends

    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .friends:
            return "moments.tab.friends"
        case .world:
            return "moments.tab.world"
        }
    }
}

private struct MomentsFeedState {
    var moments: [Moment] = []
    var isLoading = false
    var hasMore = true
    var errorMessage: String?
}

private enum MomentsFeedContext: Hashable {
    case tab(MomentFeedTab)
    case user(String)
}

@MainActor
class MomentsViewModel: ObservableObject {
    @Published var selectedTab: MomentFeedTab = .world {
        didSet {
            guard filterUserID == nil else { return }
            seedFromCacheIfNeeded(for: .tab(selectedTab))
        }
    }

    @Published private var feedStates: [MomentFeedTab: MomentsFeedState] = [
        .friends: MomentsFeedState(),
        .world: MomentsFeedState()
    ]
    @Published private var userState = MomentsFeedState()

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

    private static let feedCacheKey = "moments_feed"
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
        case .tab(.friends):
            return Self.feedCacheKey
        case .tab(.world):
            return Self.worldCacheKey
        case .user:
            return nil
        }
    }

    private func seedFromCacheIfNeeded(for context: MomentsFeedContext) {
        guard let key = cacheKey(for: context),
              !seededCacheKeys.contains(key),
              state(for: context).moments.isEmpty
        else { return }

        seededCacheKeys.insert(key)
        if let cached = LocalCache.load([Moment].self, key: key) {
            mutateState(for: context) { state in
                state.moments = cached
            }
        }
    }

    private func persistIfNeeded(_ context: MomentsFeedContext) {
        guard let key = cacheKey(for: context) else { return }
        LocalCache.save(state(for: context).moments, key: key)
    }

    private func fetchFeed(
        for context: MomentsFeedContext,
        beforeID: Int? = nil,
        limit: Int = 20
    ) async throws -> ([Moment], Bool) {
        switch context {
        case .tab(.world):
            return try await APIService.shared.getMomentsWorld(beforeID: beforeID, limit: limit)
        case .tab(.friends):
            return try await APIService.shared.getMomentsFeed(beforeID: beforeID, limit: limit)
        case .user(let uid):
            return try await APIService.shared.getUserMoments(userID: uid, limit: limit, beforeID: beforeID)
        }
    }

    private func insertMoment(_ moment: Moment, for context: MomentsFeedContext) {
        mutateState(for: context) { state in
            state.moments.removeAll { $0.id == moment.id }
            state.moments.insert(moment, at: 0)
        }
        persistIfNeeded(context)
    }

    private func insertMomentIntoPublicTabs(_ moment: Moment) {
        for tab in MomentFeedTab.allCases {
            insertMoment(moment, for: .tab(tab))
        }
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
            for tab in MomentFeedTab.allCases {
                replaceMoment(tempID: tempID, with: moment, for: .tab(tab))
            }
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
            let (items, more) = try await fetchFeed(for: context)
            mutateState(for: context) { state in
                if state.moments != items {
                    state.moments = items
                }
                state.hasMore = more
            }
            persistIfNeeded(context)
        } catch {
            if state(for: context).moments.isEmpty {
                mutateState(for: context) { state in
                    state.errorMessage = L10n.tr("common.operationFailed")
                }
            }
        }
    }

    func loadMore() async {
        let context = activeContext
        let current = state(for: context)
        guard current.hasMore,
              !current.isLoading,
              let lastID = current.moments.last?.id
        else { return }

        mutateState(for: context) { state in
            state.isLoading = true
        }

        do {
            let (items, more) = try await fetchFeed(for: context, beforeID: lastID)
            mutateState(for: context) { state in
                let existingIDs = Set(state.moments.map(\.id))
                state.moments.append(contentsOf: items.filter { !existingIDs.contains($0.id) })
                state.hasMore = more
            }
            persistIfNeeded(context)
        } catch { }

        mutateState(for: context) { state in
            state.isLoading = false
        }
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
        } catch { }
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
        } catch { }
    }

    func deleteMoment(momentID: Int) async {
        let context = activeContext

        do {
            try await APIService.shared.deleteMoment(momentID: momentID)
            removeMomentFromRelatedPublicLists(momentID: momentID, source: context)
        } catch { }
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

        Task {
            do {
                let uploaded = try await APIService.shared.createMoment(
                    content: content,
                    mediaDataList: media,
                    unlockPriceCatFood: unlockPriceCatFood
                )
                replaceMomentInRelatedPublicLists(tempID: tempID, with: uploaded, source: context)
            } catch {
                removeMomentFromRelatedPublicLists(momentID: tempID, source: context)
                mutateState(for: context) { state in
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
