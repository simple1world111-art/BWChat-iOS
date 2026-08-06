import Foundation
import UIKit
import SwiftUI

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
    var isShowingCachedData = false
    var lastUpdatedAt: Date?
}

private struct MomentsFeedPage {
    let moments: [Moment]
    let hasMore: Bool
    let nextBeforeID: Int?
    let snapshotComplete: Bool?
}

private enum MomentsFeedContext: Hashable {
    case tab(MomentFeedTab)
    case user(String)
}

@MainActor
class MomentsViewModel: ObservableObject {
    private struct PendingMomentUpload {
        let context: MomentsFeedContext
        let clientRequestID: String
        let content: String
        let mediaFiles: [MomentUploadFile]
        let parts: [OutgoingPart]
        let unlockPriceGoldCoins: Int?
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
    @Published private var userStates: [String: MomentsFeedState] = [:]
    @Published private(set) var uploadingMomentIDs = Set<Int>()
    @Published private(set) var failedMomentIDs = Set<Int>()
    private var pendingMomentUploads: [Int: PendingMomentUpload] = [:]
    private var unlockIdempotencyKeys: [String: UUID] = [:]

    /// nil = public feed tabs; non-nil = single user's moments
    var filterUserID: String? {
        didSet {
            guard oldValue != filterUserID else { return }
            seedFromCacheIfNeeded(for: activeContext)
            projectPendingMomentsIntoActiveUserFeedIfNeeded()
        }
    }

    init() {
        restorePendingMoments()
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

    var isShowingCachedData: Bool {
        state(for: activeContext).isShowingCachedData
    }

    var lastUpdatedAt: Date? {
        state(for: activeContext).lastUpdatedAt
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
        case .user(let userID):
            return userStates[userID] ?? MomentsFeedState()
        }
    }

    private func setState(_ state: MomentsFeedState, for context: MomentsFeedContext) {
        switch context {
        case .tab(let tab):
            feedStates[tab] = state
        case .user(let userID):
            userStates[userID] = state
        }
    }

    private func restorePendingMoments() {
        guard let ownerID = AuthManager.shared.currentUser?.userID, !ownerID.isEmpty else { return }
        for job in OutgoingStore.shared.jobs(ownerID: ownerID) where job.scene == .moment && job.state != .succeeded && job.state != .cancelled {
            guard let payload = try? JSONDecoder().decode(MomentOutgoingPayload.self, from: job.payload) else { continue }
            let storedParts = OutgoingStore.shared.parts(jobID: job.id)
            let mediaFiles = storedParts.compactMap { part -> MomentUploadFile? in
                guard !part.localRelativePath.isEmpty, part.role == "image" || part.role == "video" else { return nil }
                return MomentUploadFile(
                    kind: part.role == "image" ? .image : .video,
                    fileURL: OutgoingFileStore.absoluteURL(for: part.localRelativePath),
                    filename: part.filename,
                    mimeType: part.mimeType,
                    previewFileURL: part.thumbnailRelativePath.map { OutgoingFileStore.absoluteURL(for: $0) }
                )
            }
            let tempID = temporaryMomentID(clientRequestID: job.id)
            let pending = PendingMomentUpload(
                context: .tab(.recommended),
                clientRequestID: job.id,
                content: payload.content,
                mediaFiles: mediaFiles,
                parts: storedParts,
                unlockPriceGoldCoins: payload.unlockPriceGoldCoins
            )
            pendingMomentUploads[tempID] = pending
            if job.state.isUserVisibleFailure { failedMomentIDs.insert(tempID) }
            insertMomentIntoPublicTabs(optimisticMoment(
                tempID: tempID,
                content: payload.content,
                media: mediaFiles,
                unlockPriceGoldCoins: payload.unlockPriceGoldCoins,
                clientRequestID: job.id
            ))
            if job.state == .queued || job.state == .staging || job.state == .retryWaiting {
                enqueueMomentUpload(tempID: tempID)
            }
        }
    }

    private func projectPendingMomentsIntoActiveUserFeedIfNeeded() {
        guard case .user(let userID) = activeContext,
              userID == AuthManager.shared.currentUser?.userID else { return }
        let pending = feedStates[.recommended]?.moments.filter { $0.clientRequestID != nil } ?? []
        mutateState(for: activeContext) { state in
            let existing = Set(state.moments.map(\.presentationIdentity))
            state.moments.insert(contentsOf: pending.filter { !existing.contains($0.presentationIdentity) }, at: 0)
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
            guard Self.supportsOfflineCache(for: tab) else { return nil }
            return CacheKey.current(namespace: MomentCacheNamespace.publicFeed, key: tab.rawValue)
        case .user(let userID):
            return CacheKey.current(namespace: MomentCacheNamespace.userFeed, key: userID)
        }
    }

    private func legacySnapshotKey(for context: MomentsFeedContext) -> CacheKey? {
        guard case .user(let userID) = context else { return nil }
        return CacheKey.current(
            namespace: MomentCacheNamespace.legacyProfileUserFeed,
            key: userID
        )
    }

    private func seedFromCacheIfNeeded(for context: MomentsFeedContext) {
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
           let cached: CachedSnapshot<CachedMomentFeedSnapshot> = AppCacheRepository.shared.cachedValue(for: key) {
            mutateState(for: context) { state in
                state.moments = cached.value.items
                state.hasMore = cached.value.hasMore
                state.nextBeforeID = cached.value.nextBeforeID
                state.isShowingCachedData = cached.isStale
                state.lastUpdatedAt = cached.updatedAt
            }
        } else if let legacyKey = legacySnapshotKey(for: context),
                  let cached: CachedSnapshot<CachedMomentFeedSnapshot> = AppCacheRepository.shared.cachedValue(for: legacyKey) {
            mutateState(for: context) { state in
                state.moments = cached.value.items
                state.hasMore = cached.value.hasMore
                state.nextBeforeID = cached.value.nextBeforeID
                state.isShowingCachedData = true
                state.lastUpdatedAt = cached.updatedAt
            }
            if let canonicalKey = snapshotKey(for: context) {
                AppCacheRepository.shared.save(cached.value, for: canonicalKey, policy: .feed)
            }
        } else if let legacyKey = cacheKey(for: context),
                  let cached = LocalCache.load([Moment].self, key: legacyKey) {
            mutateState(for: context) { state in
                state.moments = cached
                state.isShowingCachedData = true
            }
            if let key = snapshotKey(for: context) {
                AppCacheRepository.shared.save(
                    CachedMomentFeedSnapshot(
                        items: Array(cached.prefix(200)),
                        hasMore: true,
                        nextBeforeID: cached.last?.id,
                        snapshotComplete: nil
                    ),
                    for: key,
                    policy: .feed
                )
            }
        }
    }

    private func persistIfNeeded(_ context: MomentsFeedContext) {
        if let snapshotKey = snapshotKey(for: context) {
            let current = state(for: context)
            AppCacheRepository.shared.save(
                CachedMomentFeedSnapshot(
                    items: Array(current.moments.prefix(200)),
                    hasMore: current.hasMore,
                    nextBeforeID: current.nextBeforeID,
                    snapshotComplete: nil
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
                nextBeforeID: result.0.last?.id,
                snapshotComplete: result.2
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
                nextBeforeID: result.0.last?.id,
                snapshotComplete: result.2
            )
        case .user(let uid):
            let result = try await APIService.shared.getUserMoments(userID: uid, limit: limit, beforeID: beforeID)
            return MomentsFeedPage(
                moments: result.0,
                hasMore: result.1,
                nextBeforeID: result.0.last?.id,
                snapshotComplete: result.2
            )
        }
    }

    /// Both public tabs must be available offline. The following feed may be
    /// stale until the next successful sync, which is preferable to a false
    /// empty page and is made explicit by the cached-content notice.
    nonisolated static func supportsOfflineCache(for tab: MomentFeedTab) -> Bool {
        switch tab {
        case .recommended, .following:
            return true
        }
    }

    nonisolated static func shouldAcceptRemoteFirstPage(
        itemCount: Int,
        replacingLocalCount: Int,
        snapshotComplete: Bool?
    ) -> Bool {
        MomentFirstPageReplacementPolicy.shouldAccept(
            itemCount: itemCount,
            replacingLocalCount: replacingLocalCount,
            snapshotComplete: snapshotComplete
        )
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

    private func temporaryMomentID(clientRequestID: String) -> Int {
        let hex = clientRequestID.replacingOccurrences(of: "-", with: "")
        let prefix = String(hex.prefix(12))
        return -max(Int(prefix, radix: 16) ?? 1, 1)
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

    private func optimisticMedia(from uploads: [MomentUploadFile], clientRequestID: String) -> [MomentMedia] {
        uploads.enumerated().map { index, upload in
            let mediaKey = upload.previewFileURL?.absoluteString ?? upload.fileURL.absoluteString

            switch upload.kind {
            case .image:
                return MomentMedia(
                    id: mediaKey,
                    type: .image,
                    url: upload.fileURL.absoluteString,
                    thumbnailURL: mediaKey,
                    isLocked: false
                )
            case .video:
                return MomentMedia(
                    id: mediaKey,
                    type: .video,
                    url: upload.fileURL.absoluteString,
                    thumbnailURL: mediaKey,
                    isLocked: false
                )
            }
        }
    }

    private func optimisticMoment(
        tempID: Int,
        content: String,
        media uploads: [MomentUploadFile],
        unlockPriceGoldCoins: Int?,
        clientRequestID: String
    ) -> Moment {
        let media = optimisticMedia(from: uploads, clientRequestID: clientRequestID)
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
            unlockPriceGoldCoins: uploads.isEmpty ? nil : unlockPriceGoldCoins,
            isUnlocked: true,
            locationName: nil,
            clientRequestID: clientRequestID
        )
    }

    /// Maps the files already displayed by the optimistic moment onto every
    /// server URL before swapping in the confirmed object. This prevents both
    /// image and video rows from falling back to a remote-loading state.
    private func adoptLocalMedia(
        _ localMedia: [MomentUploadFile],
        for confirmedMedia: [MomentMedia]
    ) async {
        for (local, remote) in zip(localMedia, confirmedMedia) {
            switch local.kind {
            case .image:
                if !remote.url.isBlank {
                    await ImageCacheManager.shared.adoptLocalFile(local.fileURL, for: remote.url)
                }
                if let rawThumbnailURL = remote.thumbnailURL,
                   !rawThumbnailURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                   rawThumbnailURL != remote.url {
                    let thumbnailURL = rawThumbnailURL
                    await ImageCacheManager.shared.adoptLocalFile(local.fileURL, for: thumbnailURL)
                }
            case .video:
                MediaCacheManager.shared.adoptLocalFile(
                    mediaID: "chat-video:\(remote.url)",
                    remoteURL: remote.url,
                    sourceURL: local.fileURL
                )
                if let previewURL = local.previewFileURL,
                   let thumbnailURL = remote.thumbnailDisplayURL(isLockedForViewer: false) {
                    await ImageCacheManager.shared.adoptLocalFile(previewURL, for: thumbnailURL)
                } else {
                    await ImageCacheManager.shared.adoptLocalVideoThumbnail(
                        local.fileURL,
                        for: remote.url
                    )
                }
            }
        }
    }

    func loadFeed(refresh: Bool = false) async {
        let context = activeContext
        let ownerID = AuthManager.shared.currentUser?.userID
        seedFromCacheIfNeeded(for: context)

        if refresh {
            mutateState(for: context) { state in
                state.hasMore = true
                state.nextBeforeID = nil
            }
        }

        guard !state(for: context).isLoading else { return }

        mutateState(for: context) { state in
            state.isLoading = true
            state.errorMessage = nil
        }

        defer {
            mutateState(for: context) { state in
                state.isLoading = false
            }
        }

        guard let key = snapshotKey(for: context) else {
            mutateState(for: context) { state in
                state.errorMessage = L10n.tr("api.networkUnavailable")
            }
            return
        }

        let existing: CachedSnapshot<CachedMomentFeedSnapshot>? = AppCacheRepository.shared.cachedValue(for: key)
        let result: CacheResult<CachedMomentFeedSnapshot> = await AppCacheRepository.shared.load(
            key: key,
            policy: .feed,
            forceRefresh: refresh || existing?.isStale == true
        ) {
            let result = try await self.fetchFeed(for: context)
            let localCount = self.state(for: context).moments.reduce(into: 0) { count, moment in
                if moment.clientRequestID == nil { count += 1 }
            }
            guard Self.shouldAcceptRemoteFirstPage(
                itemCount: result.moments.count,
                replacingLocalCount: localCount,
                snapshotComplete: result.snapshotComplete
            ) else {
                throw APIError.invalidResponse
            }
            return CachedMomentFeedSnapshot(
                items: result.moments,
                hasMore: result.hasMore,
                nextBeforeID: result.nextBeforeID,
                snapshotComplete: result.snapshotComplete
            )
        }

        guard !Task.isCancelled,
              ownerID == AuthManager.shared.currentUser?.userID else { return }

        let cached: CachedMomentFeedSnapshot
        let showingCachedData: Bool
        let updatedAt: Date?
        switch result {
        case .cache(let value, let isStale):
            cached = value
            showingCachedData = isStale
            updatedAt = existing?.updatedAt
        case .remote(let value):
            cached = value
            showingCachedData = false
            updatedAt = Date()
        case .staleCache(let value, let error):
            if error is CancellationError { return }
            cached = value
            showingCachedData = true
            updatedAt = existing?.updatedAt
        case .failure(let error):
            if error is CancellationError { return }
            if state(for: context).moments.isEmpty {
                mutateState(for: context) { state in
                    state.errorMessage = Self.message(for: error)
                }
            } else {
                mutateState(for: context) { state in
                    state.isShowingCachedData = true
                }
            }
            return
        }

        let page = MomentsFeedPage(
            moments: cached.items,
            hasMore: cached.hasMore,
            nextBeforeID: cached.nextBeforeID,
            snapshotComplete: cached.snapshotComplete
        )
        mutateState(for: context) { state in
            let localPending = state.moments.filter { $0.clientRequestID != nil }
            let merged = localPending + page.moments.filter { remote in
                !localPending.contains { $0.clientRequestID == remote.clientRequestID }
            }
            if state.moments != merged {
                state.moments = merged
            }
            state.hasMore = page.hasMore
            state.nextBeforeID = page.nextBeforeID
            state.isShowingCachedData = showingCachedData
            state.lastUpdatedAt = updatedAt
        }
    }

    func loadMore() async {
        let context = activeContext
        let ownerID = AuthManager.shared.currentUser?.userID
        let current = state(for: context)
        guard current.hasMore,
              !current.isLoading,
              ownerID != nil,
              let lastID = current.nextBeforeID ?? current.moments.last?.id
        else { return }

        mutateState(for: context) { state in
            state.isLoading = true
        }
        defer {
            mutateState(for: context) { state in
                state.isLoading = false
            }
        }

        do {
            let page = try await fetchFeed(for: context, beforeID: lastID)
            guard !Task.isCancelled,
                  ownerID == AuthManager.shared.currentUser?.userID else { return }
            mutateState(for: context) { state in
                let existingIDs = Set(state.moments.map(\.id))
                state.moments.append(contentsOf: page.moments.filter { !existingIDs.contains($0.id) })
                state.hasMore = page.hasMore
                state.nextBeforeID = page.nextBeforeID
                state.isShowingCachedData = false
                state.lastUpdatedAt = Date()
            }
            persistIfNeeded(context)
        } catch is CancellationError {
            return
        } catch {
            guard ownerID == AuthManager.shared.currentUser?.userID else { return }
            mutateState(for: context) { state in
                state.errorMessage = Self.message(for: error)
            }
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
                unlockPriceGoldCoins: m.unlockPriceGoldCoins,
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
                unlockPriceGoldCoins: m.unlockPriceGoldCoins,
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
            let pending = pendingMomentUploads.removeValue(forKey: momentID)
            removeMomentFromRelatedPublicLists(momentID: momentID, source: context)
            if let pending {
                await UploadEngine.shared.cancel(jobID: pending.clientRequestID, ownerID: AuthManager.shared.currentUser?.userID ?? "")
            }
            return
        }

        do {
            try await APIService.shared.deleteMoment(momentID: momentID)
            removeMomentFromRelatedPublicLists(momentID: momentID, source: context)
        } catch {
            mutateState(for: context) { $0.errorMessage = Self.message(for: error) }
        }
    }

    func publishMomentOptimistically(draft: MomentPublishDraft) {
        let context = activeContext
        do {
            try MomentMediaPolicy.validate(draft.mediaFiles.map(\.kind))
        } catch {
            mutateState(for: context) { state in
                state.errorMessage = error.localizedDescription
            }
            let ownerID = AuthManager.shared.currentUser?.userID ?? "anonymous"
            OutgoingFileStore.removeJob(ownerID: ownerID, jobID: draft.clientRequestID)
            return
        }
        let tempID = temporaryMomentID(clientRequestID: draft.clientRequestID)
        let optimistic = optimisticMoment(
            tempID: tempID,
            content: draft.content,
            media: draft.mediaFiles,
            unlockPriceGoldCoins: draft.unlockPriceGoldCoins,
            clientRequestID: draft.clientRequestID
        )

        switch context {
        case .tab:
            insertMomentIntoPublicTabs(optimistic)
        case .user:
            insertMoment(optimistic, for: context)
        }
        let ownerID = AuthManager.shared.currentUser?.userID ?? ""
        let payload = MomentOutgoingPayload(content: draft.content, unlockPriceGoldCoins: draft.unlockPriceGoldCoins)
        let job = OutgoingJob(
            clientRequestID: draft.clientRequestID,
            ownerID: ownerID,
            scene: .moment,
            businessKey: "public",
            payload: (try? JSONEncoder().encode(payload)) ?? Data(),
            state: .queued
        )
        var parts = draft.mediaFiles.enumerated().map { index, media in
            let values = try? media.fileURL.resourceValues(forKeys: [.fileSizeKey])
            return OutgoingPart(
                jobID: draft.clientRequestID,
                role: media.kind == .image ? "image" : "video",
                ordinal: index,
                localRelativePath: OutgoingFileStore.relativePath(for: media.fileURL),
                thumbnailRelativePath: media.previewFileURL.map { OutgoingFileStore.relativePath(for: $0) },
                filename: media.filename,
                mimeType: media.mimeType,
                byteSize: Int64(values?.fileSize ?? 0),
                state: .queued
            )
        }
        if parts.isEmpty {
            parts = [OutgoingPart(
                jobID: draft.clientRequestID,
                role: "payload",
                ordinal: 0,
                localRelativePath: "",
                filename: "payload.json",
                mimeType: "application/json",
                byteSize: 0,
                state: .queued
            )]
        }
        try? OutgoingStore.shared.create(job, parts: parts)
        pendingMomentUploads[tempID] = PendingMomentUpload(
            context: context,
            clientRequestID: draft.clientRequestID,
            content: draft.content,
            mediaFiles: draft.mediaFiles,
            parts: parts,
            unlockPriceGoldCoins: draft.unlockPriceGoldCoins
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
                    mediaFiles: payload.mediaFiles,
                    unlockPriceGoldCoins: payload.unlockPriceGoldCoins,
                    job: OutgoingJob(
                        clientRequestID: payload.clientRequestID,
                        ownerID: AuthManager.shared.currentUser?.userID ?? "",
                        scene: .moment,
                        businessKey: "public",
                        payload: (try? JSONEncoder().encode(MomentOutgoingPayload(
                            content: payload.content,
                            unlockPriceGoldCoins: payload.unlockPriceGoldCoins
                        ))) ?? Data(),
                        state: .queued
                    ),
                    parts: payload.parts
                )
                await self.adoptLocalMedia(payload.mediaFiles, for: uploaded.media)
                self.uploadingMomentIDs.remove(tempID)
                self.failedMomentIDs.remove(tempID)
                self.pendingMomentUploads.removeValue(forKey: tempID)
                var transaction = Transaction(animation: nil)
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    self.replaceMomentInRelatedPublicLists(
                        tempID: tempID,
                        with: uploaded,
                        source: payload.context
                    )
                }
                OutgoingStore.shared.updateJob(
                    id: payload.clientRequestID,
                    ownerID: AuthManager.shared.currentUser?.userID ?? "",
                    state: .succeeded,
                    serverID: String(uploaded.id)
                )
            } catch {
                self.uploadingMomentIDs.remove(tempID)
                if OutgoingStore.shared.jobs(ownerID: AuthManager.shared.currentUser?.userID ?? "")
                    .contains(where: { $0.id == payload.clientRequestID && $0.state == .confirmationUnknown }) {
                    return
                }
                if UploadEngine.isTransient(error),
                   let job = OutgoingStore.shared.jobs(ownerID: AuthManager.shared.currentUser?.userID ?? "")
                    .first(where: { $0.id == payload.clientRequestID }),
                   job.attemptCount < 5 {
                    if job.state != .retryWaiting {
                        await UploadEngine.shared.markRetryWaiting(
                            jobID: job.id,
                            ownerID: job.ownerID,
                            error: error,
                            attempt: job.attemptCount
                        )
                    }
                    Task { @MainActor [weak self] in
                        try? await Task.sleep(nanoseconds: UInt64(min(pow(2, Double(job.attemptCount)), 30) * 1_000_000_000))
                        guard let self,
                              self.pendingMomentUploads[tempID] != nil,
                              OutgoingStore.shared.jobs(ownerID: job.ownerID)
                                .contains(where: { $0.id == job.id && $0.state == .retryWaiting }) else { return }
                        self.enqueueMomentUpload(tempID: tempID)
                    }
                    return
                }
                self.failedMomentIDs.insert(tempID)
                OutgoingStore.shared.updateJob(
                    id: payload.clientRequestID,
                    ownerID: AuthManager.shared.currentUser?.userID ?? "",
                    state: .failedPermanent,
                    lastErrorCode: String(describing: error)
                )
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
        unlockPriceGoldCoins: Int?
    ) async -> Bool {
        let context = activeContext

        do {
            let moment = try await APIService.shared.createMoment(
                content: content,
                mediaDataList: media,
                unlockPriceGoldCoins: unlockPriceGoldCoins
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

    func unlockMoment(
        momentID: Int,
        paymentMethod: MediaUnlockPaymentMethod,
        idempotencyKey: UUID = UUID()
    ) async -> Bool {
        let context = activeContext
        let idempotencyScope = "\(momentID)|\(paymentMethod.idempotencyScope)"
        let stableIdempotencyKey = unlockIdempotencyKeys[idempotencyScope] ?? idempotencyKey
        unlockIdempotencyKeys[idempotencyScope] = stableIdempotencyKey

        do {
            let result = try await APIService.shared.unlockMoment(
                momentID: momentID,
                paymentMethod: paymentMethod,
                idempotencyKey: stableIdempotencyKey
            )
            unlockIdempotencyKeys.removeValue(forKey: idempotencyScope)
            if let updatedMoment = result.moment {
                updateMomentInRelatedPublicLists(updatedMoment, source: context)
            } else {
                await loadFeed(refresh: true)
            }
            if let charge = result.charge {
                WalletStore.shared.applyServerBalance(charge.walletBalance)
                WalletTelemetry.recordMixedCharge(charge, operation: "moment_unlock")
            } else if !result.alreadyUnlocked, result.consumedProp == nil {
                await WalletStore.shared.refreshBalanceFromServer()
            }
            if !result.alreadyUnlocked,
               let consumedProp = result.consumedProp,
               let cardKind = paymentMethod.cardKind {
                PropInventoryStore.shared.applyConsumption(
                    consumedProp,
                    fallbackKind: cardKind
                )
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
