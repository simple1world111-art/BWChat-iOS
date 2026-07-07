// BWChat/Views/FollowListViews.swift
// Following and follower lists.

import SwiftUI

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
