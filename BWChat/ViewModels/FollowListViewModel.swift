// BWChat/ViewModels/FollowListViewModel.swift
// Paginated following/follower lists with optimistic follow actions.

import Foundation

enum FollowListKind {
    case following
    case followers

    var titleKey: String {
        switch self {
        case .following: return "follow.following"
        case .followers: return "follow.followers"
        }
    }

    var emptyTitleKey: String {
        switch self {
        case .following: return "follow.following.empty"
        case .followers: return "follow.followers.empty"
        }
    }
}

@MainActor
final class FollowListViewModel: ObservableObject {
    @Published private(set) var users: [FollowUser] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published var errorMessage: String?

    let kind: FollowListKind
    let userID: String?

    private var nextPage: Int? = 1
    private var hasLoaded = false

    init(kind: FollowListKind, userID: String?) {
        self.kind = kind
        self.userID = userID
    }

    var hasMore: Bool {
        nextPage != nil
    }

    func loadInitial(force: Bool = false) async {
        guard force || !hasLoaded else { return }
        hasLoaded = true
        nextPage = 1
        users = []
        await loadPage(showBlockingLoader: true)
    }

    func refresh() async {
        hasLoaded = true
        nextPage = 1
        await loadPage(showBlockingLoader: users.isEmpty)
    }

    func loadMoreIfNeeded(currentUserID: String) {
        guard users.last?.userID == currentUserID,
              nextPage != nil,
              !isLoading,
              !isLoadingMore else { return }
        Task { await loadPage(showBlockingLoader: false) }
    }

    func toggleFollow(userID: String) {
        guard let index = users.firstIndex(where: { $0.userID == userID }) else { return }
        let previous = users[index]
        let targetState = !previous.followedByMe
        users[index].followedByMe = targetState
        users[index].followerCount = max(0, previous.followerCount + (targetState ? 1 : -1))

        Task {
            do {
                let relationship = targetState
                    ? try await APIService.shared.followUser(userID: userID)
                    : try await APIService.shared.unfollowUser(userID: userID)
                applyRelationship(relationship, to: userID)
            } catch {
                if let rollbackIndex = users.firstIndex(where: { $0.userID == userID }) {
                    users[rollbackIndex] = previous
                }
                errorMessage = error.localizedDescription
            }
        }
    }

    private func loadPage(showBlockingLoader: Bool) async {
        guard let page = nextPage else { return }
        if showBlockingLoader {
            isLoading = true
        } else {
            isLoadingMore = true
        }
        errorMessage = nil
        defer {
            isLoading = false
            isLoadingMore = false
        }

        do {
            let result: FollowUsersPage
            switch kind {
            case .following:
                result = try await APIService.shared.getFollowing(userID: userID, page: page)
            case .followers:
                result = try await APIService.shared.getFollowers(userID: userID, page: page)
            }

            if page == 1 {
                users = result.users
            } else {
                let existingIDs = Set(users.map(\.userID))
                users.append(contentsOf: result.users.filter { !existingIDs.contains($0.userID) })
            }
            nextPage = result.hasMore ? (result.nextPage ?? page + 1) : nil
            result.users.forEach {
                UserCacheManager.shared.cacheUser(userID: $0.userID, username: $0.username, nickname: $0.nickname, avatarURL: $0.avatarURL)
            }
        } catch {
            if users.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func applyRelationship(_ relationship: FollowRelationship, to userID: String) {
        guard let index = users.firstIndex(where: { $0.userID == userID }) else { return }
        users[index].followedByMe = relationship.followedByMe
        users[index].followsMe = relationship.followsMe
        users[index].isFriend = relationship.isFriend
        if let followerCount = relationship.followerCount {
            users[index].followerCount = followerCount
        }
        if let followingCount = relationship.followingCount {
            users[index].followingCount = followingCount
        }
    }
}
