// BWChat/ViewModels/UserProfileViewModel.swift
// Public user profile state and follow relationship updates.

import Foundation

@MainActor
final class UserProfileViewModel: ObservableObject {
    @Published private(set) var profile: PublicProfile?
    @Published private(set) var isLoading = false
    @Published private(set) var isUpdatingFollow = false
    @Published var errorMessage: String?

    let userID: String

    init(userID: String) {
        self.userID = userID
    }

    var isMe: Bool {
        AuthManager.shared.currentUser?.userID == userID
    }

    func loadProfile() async {
        let showLoader = profile == nil
        if showLoader { isLoading = true }
        errorMessage = nil
        defer { isLoading = false }

        do {
            let fetched = try await APIService.shared.getPublicProfile(userID: userID)
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

    func toggleFollow() {
        guard !isMe, !isUpdatingFollow, var current = profile else { return }
        let previous = current
        let targetState = !current.followedByMe
        current.followedByMe = targetState
        current.followerCount = max(0, current.followerCount + (targetState ? 1 : -1))
        profile = current
        isUpdatingFollow = true

        Task {
            defer { isUpdatingFollow = false }
            do {
                let relationship = targetState
                    ? try await APIService.shared.followUser(userID: userID)
                    : try await APIService.shared.unfollowUser(userID: userID)
                applyRelationship(relationship)
            } catch {
                profile = previous
                errorMessage = error.localizedDescription
            }
        }
    }

    private func applyRelationship(_ relationship: FollowRelationship) {
        guard var current = profile else { return }
        current.followedByMe = relationship.followedByMe
        current.followsMe = relationship.followsMe
        current.isFriend = relationship.isFriend
        if let followerCount = relationship.followerCount {
            current.followerCount = followerCount
        }
        if let followingCount = relationship.followingCount {
            current.followingCount = followingCount
        }
        profile = current
    }
}
