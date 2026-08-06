// BWChat/ViewModels/FriendsViewModel.swift
// Friends management view model

import Foundation
import Combine

@MainActor
class FriendsViewModel: ObservableObject {
    @Published var searchText: String = ""
    @Published var searchResults: [SearchUser] = []
    @Published var friendRequests: [FriendRequest]
    @Published var friends: [FriendInfo]
    @Published var isSearching = false
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var successMessage: String?
    @Published private(set) var updatingFollowUserIDs: Set<String> = []

    private var searchTask: Task<Void, Never>?
    private var cancellables = Set<AnyCancellable>()

    init() {
        // Seed from local cache so the contacts tab renders instantly on
        // launch / tab switch. Network refresh will overwrite if different.
        let userID = AuthManager.shared.currentUser?.userID
        let legacyFriends = LocalCache.load([FriendInfo].self, key: FriendCacheKeys.friends(for: userID)) ?? []
        let legacyRequests = LocalCache.load([FriendRequest].self, key: FriendCacheKeys.requests(for: userID)) ?? []
        if let key = Self.friendsCacheKey(),
           let cached: CachedSnapshot<[FriendInfo]> = AppCacheRepository.shared.cachedValue(for: key) {
            friends = cached.value
        } else {
            friends = legacyFriends
            if let key = Self.friendsCacheKey(), !legacyFriends.isEmpty {
                AppCacheRepository.shared.save(legacyFriends, for: key, policy: .list)
                LocalCache.clear(key: FriendCacheKeys.friends(for: userID))
            }
        }
        if let key = Self.requestsCacheKey(),
           let cached: CachedSnapshot<[FriendRequest]> = AppCacheRepository.shared.cachedValue(for: key) {
            friendRequests = cached.value
        } else {
            friendRequests = legacyRequests
            if let key = Self.requestsCacheKey(), !legacyRequests.isEmpty {
                AppCacheRepository.shared.save(legacyRequests, for: key, policy: .list)
                LocalCache.clear(key: FriendCacheKeys.requests(for: userID))
            }
        }

        FollowRelationshipStore.shared.changes
            .sink { [weak self] change in
                self?.applyFollowRelationship(change.relationship)
            }
            .store(in: &cancellables)
    }

    func searchUsers() async {
        let keyword = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !keyword.isEmpty else {
            searchResults = []
            return
        }
        isSearching = true
        do {
            searchResults = try await APIService.shared.searchUsers(keyword: keyword)
        } catch {
            searchResults = []
        }
        isSearching = false
    }

    func debouncedSearch() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            await searchUsers()
        }
    }

    func loadFriendRequests(forceRefresh: Bool = false) async {
        guard let key = Self.requestsCacheKey() else { return }
        do {
            let fetched: [FriendRequest] = try await AppCacheRepository.shared.loadValue(
                key: key,
                policy: .list,
                forceRefresh: forceRefresh
            ) {
                try await APIService.shared.getFriendRequests()
            }
            if friendRequests != fetched {
                friendRequests = fetched
            }
        } catch {
            // silently fail — cached list keeps rendering
        }
    }

    func loadFriends(forceRefresh: Bool = false) async {
        // Only show the blocking loader on the very first load — subsequent
        // re-runs (e.g. tab re-appears after NavigationStack pop) shouldn't
        // flash a spinner over an already-populated list.
        let showLoader = friends.isEmpty
        if showLoader { isLoading = true }
        defer { isLoading = false }
        guard let key = Self.friendsCacheKey() else { return }
        do {
            let fetched: [FriendInfo] = try await AppCacheRepository.shared.loadValue(
                key: key,
                policy: .list,
                forceRefresh: forceRefresh
            ) {
                try await APIService.shared.getFriendList()
            }
            if friends != fetched {
                friends = fetched
                UserCacheManager.shared.cacheFriends(fetched)
            }
        } catch {
            if friends.isEmpty { errorMessage = L10n.tr("friends.loadFailed") }
        }
    }

    private static func friendsCacheKey() -> CacheKey? {
        CacheKey.current(namespace: "friends", key: "list")
    }

    private static func requestsCacheKey() -> CacheKey? {
        CacheKey.current(namespace: "friends", key: "requests")
    }

    func sendFriendRequest(to userID: String) async {
        do {
            let msg = try await APIService.shared.sendFriendRequest(targetUserID: userID)
            successMessage = msg
            // Update search results
            if let idx = searchResults.firstIndex(where: { $0.userID == userID }) {
                let u = searchResults[idx]
                searchResults[idx] = SearchUser(
                    userID: u.userID,
                    nickname: u.nickname,
                    avatarURL: u.avatarURL,
                    relation: "pending_sent"
                )
            }
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("messages.sendFailed")
        }
    }

    func toggleFollow(userID: String) {
        guard !updatingFollowUserIDs.contains(userID),
              let index = searchResults.firstIndex(where: { $0.userID == userID })
        else { return }

        let previous = searchResults[index]
        let shouldFollow = !previous.followedByMe && !previous.followRequested
        searchResults[index].followedByMe = shouldFollow
        searchResults[index].followRequested = false
        updatingFollowUserIDs.insert(userID)

        Task {
            defer { updatingFollowUserIDs.remove(userID) }
            do {
                let relationship = shouldFollow
                    ? try await APIService.shared.followUser(userID: userID)
                    : try await APIService.shared.unfollowUser(userID: userID)
                applyFollowRelationship(relationship)
            } catch let error as APIError {
                if let rollbackIndex = searchResults.firstIndex(where: { $0.userID == userID }) {
                    searchResults[rollbackIndex] = previous
                }
                errorMessage = error.errorDescription
            } catch {
                if let rollbackIndex = searchResults.firstIndex(where: { $0.userID == userID }) {
                    searchResults[rollbackIndex] = previous
                }
                errorMessage = error.localizedDescription
            }
        }
    }

    private func applyFollowRelationship(_ relationship: FollowRelationship) {
        guard let index = searchResults.firstIndex(where: { $0.userID == relationship.userID }) else {
            return
        }
        searchResults[index].followedByMe = relationship.followedByMe
        searchResults[index].followRequested = relationship.followRequested ?? false
    }

    func acceptRequest(_ request: FriendRequest) async {
        do {
            try await APIService.shared.acceptFriendRequest(requestID: request.requestID)
            friendRequests.removeAll { $0.id == request.id }
            successMessage = L10n.tr("friends.added", request.nickname)
            await loadFriends()
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }

    func rejectRequest(_ request: FriendRequest) async {
        do {
            try await APIService.shared.rejectFriendRequest(requestID: request.requestID)
            friendRequests.removeAll { $0.id == request.id }
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }
}
