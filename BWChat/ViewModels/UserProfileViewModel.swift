// BWChat/ViewModels/UserProfileViewModel.swift
// Public user profile state and follow relationship updates.

import Foundation

@MainActor
final class UserProfileViewModel: ObservableObject {
    @Published private(set) var profile: PublicProfile?
    @Published private(set) var moments: [Moment] = []
    @Published private(set) var shortDramas: [ShortDramaSeries] = []
    @Published private(set) var suggestedUsers: [FollowUser] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMoments = false
    @Published private(set) var isLoadingMoreMoments = false
    @Published private(set) var isLoadingShortDramas = false
    @Published private(set) var isLoadingMoreShortDramas = false
    @Published private(set) var isLoadingSuggestions = false
    @Published private(set) var hasMoreMoments = true
    @Published private(set) var isUpdatingFollow = false
    @Published private(set) var updatingSuggestedUserIDs: Set<String> = []
    @Published var errorMessage: String?
    @Published var shortDramasErrorMessage: String?

    let userID: String
    private let momentsPageSize = 24
    private let shortDramasPageSize = 12
    private var didLoadInitialMoments = false
    private var didLoadInitialShortDramas = false
    private var shortDramasCursor: String?
    private var hasMoreShortDramas = true

    private struct CachedMoments: Codable {
        let items: [Moment]
        let hasMore: Bool
    }

    init(userID: String) {
        self.userID = userID
        if let key = Self.profileKey(userID: userID),
           let cached: CachedSnapshot<PublicProfile> = AppCacheRepository.shared.cachedValue(for: key) {
            profile = cached.value
        }
        if let key = Self.momentsKey(userID: userID),
           let cached: CachedSnapshot<CachedMoments> = AppCacheRepository.shared.cachedValue(for: key) {
            moments = cached.value.items
            hasMoreMoments = cached.value.hasMore
        }
        if let key = Self.shortDramasKey(userID: userID),
           let cached: CachedSnapshot<ShortDramaSeriesPage> = AppCacheRepository.shared.cachedValue(for: key) {
            shortDramas = Self.visibleShortDramas(cached.value.series, userID: userID)
            shortDramasCursor = cached.value.nextCursor
            hasMoreShortDramas = cached.value.hasMore
        }
    }

    var isMe: Bool {
        AuthManager.shared.currentUser?.userID == userID
    }

    func loadProfile(forceRefresh: Bool = false) async {
        let showLoader = profile == nil
        if showLoader { isLoading = true }
        errorMessage = nil
        defer { isLoading = false }

        guard let key = Self.profileKey(userID: userID) else { return }
        do {
            let fetched: PublicProfile = try await AppCacheRepository.shared.loadValue(
                key: key,
                policy: .profile,
                forceRefresh: forceRefresh
            ) {
                try await APIService.shared.getPublicProfile(userID: self.userID)
            }
            profile = fetched
            UserCacheManager.shared.cacheUser(
                userID: fetched.userID,
                username: fetched.username,
                nickname: fetched.nickname,
                avatarURL: fetched.avatarURL
            )
        } catch {
            if profile == nil {
                errorMessage = error.localizedDescription
            }
        }
    }

    func loadInitialMoments(refresh: Bool = false) async {
        guard refresh || !didLoadInitialMoments else { return }
        didLoadInitialMoments = true
        if refresh {
            hasMoreMoments = true
        }
        await loadMoments(refresh: refresh)
    }

    func loadMoreMomentsIfNeeded(currentMomentID: Int) {
        guard moments.last?.id == currentMomentID,
              hasMoreMoments,
              !isLoadingMoments,
              !isLoadingMoreMoments
        else { return }

        Task { await loadMoments(refresh: false, isLoadMore: true) }
    }

    func loadInitialShortDramas(refresh: Bool = false) async {
        guard refresh || !didLoadInitialShortDramas else { return }
        didLoadInitialShortDramas = true
        await loadShortDramas(reset: true, forceRefresh: refresh)
        if Task.isCancelled { didLoadInitialShortDramas = false }
    }

    func loadMoreShortDramasIfNeeded(currentSeriesID: String) {
        guard shortDramas.last?.id == currentSeriesID,
              hasMoreShortDramas,
              !isLoadingShortDramas,
              !isLoadingMoreShortDramas else { return }
        Task { await loadShortDramas(reset: false, forceRefresh: false) }
    }

    func toggleMomentLike(momentID: Int) async {
        do {
            let liked = try await APIService.shared.toggleMomentLike(momentID: momentID)
            guard let index = moments.firstIndex(where: { $0.id == momentID }) else { return }

            let moment = moments[index]
            let currentUser = AuthManager.shared.currentUser
            let currentUserID = currentUser?.userID ?? ""
            var likes = moment.likes.filter { $0.userID != currentUserID }
            if liked {
                likes.append(MomentAuthor(
                    userID: currentUserID,
                    nickname: currentUser?.nickname ?? "",
                    avatarURL: currentUser?.avatarURL ?? ""
                ))
            }

            moments[index] = Moment(
                id: moment.id,
                author: moment.author,
                content: moment.content,
                images: moment.images,
                createdAt: moment.createdAt,
                likes: likes,
                comments: moment.comments,
                likedByMe: liked,
                media: moment.media,
                unlockPriceCatFood: moment.unlockPriceCatFood,
                isUnlocked: moment.isUnlocked,
                locationName: moment.locationName
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggleFollow() {
        guard !isMe, !isUpdatingFollow, var current = profile else { return }
        let previous = current
        let shouldSendFollow = !current.followedByMe && !current.followRequested
        if shouldSendFollow {
            if current.isPrivate {
                current.followRequested = true
            } else {
                current.followedByMe = true
                current.followerCount += 1
            }
        } else {
            if current.followedByMe {
                current.followerCount = max(0, current.followerCount - 1)
            }
            current.followedByMe = false
            current.followRequested = false
        }
        profile = current
        isUpdatingFollow = true

        Task {
            defer { isUpdatingFollow = false }
            do {
                let relationship = shouldSendFollow
                    ? try await APIService.shared.followUser(userID: userID)
                    : try await APIService.shared.unfollowUser(userID: userID)
                applyRelationship(relationship)
            } catch {
                profile = previous
                errorMessage = error.localizedDescription
            }
        }
    }

    func loadSuggestedUsers() async {
        guard !isMe else {
            suggestedUsers = []
            return
        }

        isLoadingSuggestions = true
        defer { isLoadingSuggestions = false }

        if let databaseUsers = try? await APIService.shared.getRecommendedUsers(
            limit: 18,
            excludeUserID: userID
        ), !databaseUsers.isEmpty {
            setSuggestedUsers(databaseUsers)
            return
        }

        async let followingPage = try? APIService.shared.getFollowing(userID: userID, page: 1, limit: 18)
        async let followersPage = try? APIService.shared.getFollowers(userID: userID, page: 1, limit: 18)
        async let myFollowingPage = try? APIService.shared.getFollowing(page: 1, limit: 18)
        async let myFollowersPage = try? APIService.shared.getFollowers(page: 1, limit: 18)
        let (following, followers, myFollowing, myFollowers) = await (
            followingPage,
            followersPage,
            myFollowingPage,
            myFollowersPage
        )

        let candidates = (profile?.mutualFollowers ?? [])
            + (following?.users ?? [])
            + (followers?.users ?? [])
            + (myFollowing?.users ?? [])
            + (myFollowers?.users ?? [])
        setSuggestedUsers(candidates)
    }

    private func setSuggestedUsers(_ candidates: [FollowUser]) {
        let excludedIDs = Set([userID, AuthManager.shared.currentUser?.userID].compactMap { $0 })
        var seenIDs = Set<String>()
        suggestedUsers = candidates.filter { user in
            !user.userID.isBlank
                && !excludedIDs.contains(user.userID)
                && seenIDs.insert(user.userID).inserted
        }
    }

    func dismissSuggestedUser(userID: String) {
        suggestedUsers.removeAll { $0.userID == userID }
    }

    func toggleSuggestedFollow(userID: String) {
        guard !updatingSuggestedUserIDs.contains(userID),
              let index = suggestedUsers.firstIndex(where: { $0.userID == userID })
        else { return }

        let previous = suggestedUsers[index]
        let targetState = !previous.followedByMe
        suggestedUsers[index].followedByMe = targetState
        suggestedUsers[index].followerCount = max(0, previous.followerCount + (targetState ? 1 : -1))
        updatingSuggestedUserIDs.insert(userID)

        Task {
            defer { updatingSuggestedUserIDs.remove(userID) }
            do {
                let relationship = targetState
                    ? try await APIService.shared.followUser(userID: userID)
                    : try await APIService.shared.unfollowUser(userID: userID)
                guard let currentIndex = suggestedUsers.firstIndex(where: { $0.userID == userID }) else { return }
                suggestedUsers[currentIndex].followedByMe = relationship.followedByMe
                suggestedUsers[currentIndex].followsMe = relationship.followsMe
                suggestedUsers[currentIndex].isFriend = relationship.isFriend
                if let followerCount = relationship.followerCount {
                    suggestedUsers[currentIndex].followerCount = followerCount
                }
            } catch {
                if let rollbackIndex = suggestedUsers.firstIndex(where: { $0.userID == userID }) {
                    suggestedUsers[rollbackIndex] = previous
                }
                errorMessage = error.localizedDescription
            }
        }
    }

    private func applyRelationship(_ relationship: FollowRelationship) {
        guard var current = profile else { return }
        current.followedByMe = relationship.followedByMe
        current.followsMe = relationship.followsMe
        current.isFriend = relationship.isFriend
        if let followRequested = relationship.followRequested {
            current.followRequested = followRequested
        } else if relationship.followedByMe {
            current.followRequested = false
        }
        if let followerCount = relationship.followerCount {
            current.followerCount = followerCount
        }
        if let followingCount = relationship.followingCount {
            current.followingCount = followingCount
        }
        profile = current
    }

    private func loadMoments(refresh: Bool = false, isLoadMore: Bool = false) async {
        guard !isLoadingMoments, !isLoadingMoreMoments else { return }
        if isLoadMore {
            isLoadingMoreMoments = true
        } else {
            isLoadingMoments = moments.isEmpty || refresh
        }
        defer {
            isLoadingMoments = false
            isLoadingMoreMoments = false
        }

        do {
            let beforeID = (refresh || !isLoadMore) ? nil : moments.last?.id
            let items: [Moment]
            let hasMore: Bool
            if !isLoadMore, let key = Self.momentsKey(userID: userID) {
                let cached: CachedMoments = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .feed,
                    forceRefresh: refresh
                ) {
                    let result = try await APIService.shared.getUserMoments(
                        userID: self.userID,
                        limit: self.momentsPageSize,
                        beforeID: nil
                    )
                    return CachedMoments(items: result.0, hasMore: result.1)
                }
                items = cached.items
                hasMore = cached.hasMore
            } else {
                let result = try await APIService.shared.getUserMoments(
                    userID: userID,
                    limit: momentsPageSize,
                    beforeID: beforeID
                )
                items = result.0
                hasMore = result.1
            }

            if refresh || !isLoadMore {
                moments = items
            } else {
                let existingIDs = Set(moments.map(\.id))
                moments.append(contentsOf: items.filter { !existingIDs.contains($0.id) })
            }
            hasMoreMoments = hasMore
            if let key = Self.momentsKey(userID: userID) {
                AppCacheRepository.shared.save(
                    CachedMoments(items: Array(moments.prefix(200)), hasMore: hasMoreMoments),
                    for: key,
                    policy: .feed
                )
            }
        } catch {
            if moments.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func loadShortDramas(reset: Bool, forceRefresh: Bool) async {
        guard !isLoadingShortDramas, !isLoadingMoreShortDramas else { return }
        if reset {
            isLoadingShortDramas = true
            shortDramasCursor = nil
            hasMoreShortDramas = true
        } else {
            isLoadingMoreShortDramas = true
        }
        shortDramasErrorMessage = nil
        defer {
            isLoadingShortDramas = false
            isLoadingMoreShortDramas = false
        }

        do {
            let fetch: () async throws -> ShortDramaSeriesPage = {
                try await APIService.shared.getUserShortDramaSeries(
                    creatorUserID: self.userID,
                    cursor: reset ? nil : self.shortDramasCursor,
                    limit: self.shortDramasPageSize
                )
            }
            let page: ShortDramaSeriesPage
            if reset, let key = Self.shortDramasKey(userID: userID) {
                page = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .mediaFeed,
                    forceRefresh: forceRefresh,
                    fetch: fetch
                )
            } else {
                page = try await fetch()
            }

            let incoming = Self.visibleShortDramas(page.series, userID: userID)
            shortDramas = Self.merged(reset ? [] : shortDramas, with: incoming)
            shortDramasCursor = page.nextCursor
            hasMoreShortDramas = page.hasMore
            cacheShortDramas()
        } catch {
            guard !Self.isCancellation(error) else { return }
            shortDramasErrorMessage = error.localizedDescription
        }
    }

    private func cacheShortDramas() {
        guard let key = Self.shortDramasKey(userID: userID) else { return }
        AppCacheRepository.shared.save(
            ShortDramaSeriesPage(
                series: Array(shortDramas.prefix(200)),
                hasMore: hasMoreShortDramas,
                nextCursor: shortDramasCursor
            ),
            for: key,
            policy: .mediaFeed
        )
    }

    private static func visibleShortDramas(_ series: [ShortDramaSeries], userID: String) -> [ShortDramaSeries] {
        series.filter { $0.status == .published && $0.creator.userID == userID }
    }

    private static func merged<T: Identifiable>(_ current: [T], with incoming: [T]) -> [T] where T.ID: Hashable {
        var seen = Set<T.ID>()
        return (current + incoming).filter { seen.insert($0.id).inserted }
    }

    private static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError || Task.isCancelled { return true }
        if let urlError = error as? URLError, urlError.code == .cancelled { return true }
        if case APIError.networkError(let underlying) = error {
            return isCancellation(underlying)
        }
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }

    private static func profileKey(userID: String) -> CacheKey? {
        CacheKey.current(namespace: "profiles", key: userID)
    }

    private static func momentsKey(userID: String) -> CacheKey? {
        CacheKey.current(namespace: "user-moments", key: userID)
    }

    private static func shortDramasKey(userID: String) -> CacheKey? {
        CacheKey.current(namespace: "user-short-dramas", key: userID)
    }
}
