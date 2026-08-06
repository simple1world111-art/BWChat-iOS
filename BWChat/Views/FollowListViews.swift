// BWChat/Views/FollowListViews.swift
// Following and follower lists.

import SwiftUI
import Combine

struct FollowingListView: View {
    @StateObject private var viewModel: FollowListViewModel

    init(userID: String?) {
        _viewModel = StateObject(wrappedValue: FollowListViewModel(kind: .following, userID: userID))
    }

    var body: some View {
        FollowListContentView(viewModel: viewModel)
    }
}

struct FollowersListView: View {
    @StateObject private var viewModel: FollowListViewModel

    init(userID: String?) {
        _viewModel = StateObject(wrappedValue: FollowListViewModel(kind: .followers, userID: userID))
    }

    var body: some View {
        FollowListContentView(viewModel: viewModel)
    }
}

struct RecommendedUsersListView: View {
    @StateObject private var viewModel: RecommendedUsersListViewModel

    init(excludeUserID: String?, initialUsers: [FollowUser] = []) {
        _viewModel = StateObject(
            wrappedValue: RecommendedUsersListViewModel(
                excludeUserID: excludeUserID,
                initialUsers: initialUsers
            )
        )
    }

    var body: some View {
        RecommendedUsersListContentView(viewModel: viewModel)
    }
}

@MainActor
private final class RecommendedUsersListViewModel: ObservableObject {
    @Published private(set) var users: [FollowUser]
    @Published private(set) var isLoading = false
    @Published private(set) var updatingUserIDs: Set<String> = []
    @Published var errorMessage: String?

    private let excludeUserID: String?
    private var hasLoaded = false
    private var cancellables = Set<AnyCancellable>()

    init(excludeUserID: String?, initialUsers: [FollowUser]) {
        self.excludeUserID = excludeUserID
        users = Self.filtered(initialUsers, excludeUserID: excludeUserID)
        FollowRelationshipStore.shared.changes
            .sink { [weak self] change in
                self?.apply(change.relationship)
            }
            .store(in: &cancellables)
    }

    func load(force: Bool = false) async {
        guard force || !hasLoaded else { return }
        hasLoaded = true
        isLoading = users.isEmpty
        errorMessage = nil
        defer { isLoading = false }

        do {
            let recommended = try await APIService.shared.getRecommendedUsers(
                limit: 50,
                excludeUserID: excludeUserID
            )
            let filtered = Self.filtered(recommended, excludeUserID: excludeUserID)
            if !filtered.isEmpty || users.isEmpty {
                users = filtered
            }
            filtered.forEach {
                UserCacheManager.shared.cacheUser(
                    userID: $0.userID,
                    username: $0.username,
                    nickname: $0.nickname,
                    avatarURL: $0.avatarURL
                )
            }
        } catch {
            if users.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    func toggleFollow(userID: String) {
        guard !updatingUserIDs.contains(userID),
              let index = users.firstIndex(where: { $0.userID == userID })
        else { return }

        let previous = users[index]
        let targetState = !previous.followedByMe
        users[index].followedByMe = targetState
        users[index].followerCount = max(0, previous.followerCount + (targetState ? 1 : -1))
        updatingUserIDs.insert(userID)

        Task {
            defer { updatingUserIDs.remove(userID) }
            do {
                let relationship = targetState
                    ? try await APIService.shared.followUser(userID: userID)
                    : try await APIService.shared.unfollowUser(userID: userID)
                guard let currentIndex = users.firstIndex(where: { $0.userID == userID }) else { return }
                users[currentIndex].followedByMe = relationship.followedByMe
                users[currentIndex].followsMe = relationship.followsMe
                users[currentIndex].isFriend = relationship.isFriend
                if let followerCount = relationship.followerCount {
                    users[currentIndex].followerCount = followerCount
                }
            } catch {
                if let rollbackIndex = users.firstIndex(where: { $0.userID == userID }) {
                    users[rollbackIndex] = previous
                }
                errorMessage = error.localizedDescription
            }
        }
    }

    private static func filtered(_ candidates: [FollowUser], excludeUserID: String?) -> [FollowUser] {
        let excludedIDs = Set([excludeUserID, AuthManager.shared.currentUser?.userID].compactMap { $0 })
        var seenIDs = Set<String>()
        return candidates.filter {
            !$0.userID.isBlank
                && !excludedIDs.contains($0.userID)
                && seenIDs.insert($0.userID).inserted
        }
    }

    private func apply(_ relationship: FollowRelationship) {
        guard let index = users.firstIndex(where: { $0.userID == relationship.userID }) else { return }
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

private struct RecommendedUsersListContentView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject var viewModel: RecommendedUsersListViewModel

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                if viewModel.isLoading && viewModel.users.isEmpty {
                    ProgressView()
                        .tint(AppColors.accent)
                        .padding(.top, 80)
                } else if viewModel.users.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "person.2")
                            .font(.system(size: 34, weight: .semibold))
                            .foregroundColor(AppColors.tertiaryText)
                        Text(L10n.tr("profile.suggestions.unavailable"))
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(AppColors.secondaryText)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 80)
                } else {
                    ForEach(viewModel.users) { user in
                        FollowUserRow(
                            user: user,
                            showsFollowButton: user.userID != AuthManager.shared.currentUser?.userID,
                            onOpenProfile: {
                                navigator.push(UserProfileView(userID: user.userID))
                            },
                            onToggleFollow: {
                                viewModel.toggleFollow(userID: user.userID)
                            }
                        )
                        .disabled(viewModel.updatingUserIDs.contains(user.userID))
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 28)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("profile.suggestions.title"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .task {
            await viewModel.load()
        }
        .refreshable {
            await viewModel.load(force: true)
        }
        .toast(message: $viewModel.errorMessage)
    }
}

private struct FollowListContentView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject var viewModel: FollowListViewModel

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                if viewModel.isLoading && viewModel.users.isEmpty {
                    ProgressView()
                        .tint(AppColors.accent)
                        .padding(.top, 80)
                } else if viewModel.users.isEmpty {
                    emptyState
                        .padding(.top, 80)
                } else {
                    ForEach(viewModel.users) { user in
                        FollowUserRow(
                            user: user,
                            showsFollowButton: user.userID != AuthManager.shared.currentUser?.userID,
                            onOpenProfile: {
                                navigator.push(UserProfileView(userID: user.userID))
                            },
                            onToggleFollow: {
                                viewModel.toggleFollow(userID: user.userID)
                            }
                        )
                        .onAppear {
                            viewModel.loadMoreIfNeeded(currentUserID: user.userID)
                        }
                    }

                    if viewModel.isLoadingMore {
                        ProgressView()
                            .tint(AppColors.accent)
                            .padding(.vertical, 16)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 28)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr(viewModel.kind.titleKey))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .task {
            await viewModel.loadInitial()
        }
        .refreshable {
            await viewModel.refresh()
        }
        .toast(message: $viewModel.errorMessage)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.2")
                .font(.system(size: 34, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)
            Text(L10n.tr(viewModel.kind.emptyTitleKey))
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct FollowUserRow: View {
    let user: FollowUser
    let showsFollowButton: Bool
    let onOpenProfile: () -> Void
    let onToggleFollow: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onOpenProfile) {
                HStack(spacing: 12) {
                    AvatarView(url: user.avatarURL, size: 48)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(user.nickname)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(AppColors.primaryText)
                            .lineLimit(1)

                        Text(user.bio.isBlank ? "#\(user.userID)" : user.bio)
                            .font(.system(size: 13))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

            if showsFollowButton {
                Button(action: onToggleFollow) {
                    Text(user.followedByMe ? L10n.tr("follow.followingButton") : L10n.tr("follow.followButton"))
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(user.followedByMe ? AppColors.accent : .white)
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(
                            Capsule()
                                .fill(user.followedByMe ? AppColors.accentLight : AppColors.accent)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .background(AppColors.cardBackground)
        .cornerRadius(14)
    }
}
