// BWChat/Views/AddFriendView.swift
// Search and add friends - adaptive layout

import SwiftUI

struct AddFriendView: View {
    @StateObject private var viewModel = FriendsViewModel()
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var navigator: UIKitNavigator

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(AppColors.secondaryText)
                        .font(.system(size: 16))

                    TextField(L10n.tr("addFriend.search.placeholder"), text: $viewModel.searchText)
                        .font(.system(size: 16))
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .submitLabel(.search)
                        .onChange(of: viewModel.searchText) { _ in
                            viewModel.debouncedSearch()
                        }

                    if !viewModel.searchText.isEmpty {
                        Button {
                            viewModel.searchText = ""
                            viewModel.searchResults = []
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(AppColors.tertiaryText)
                                .font(.system(size: 18))
                                .frame(width: 36, height: 36)
                                .contentShape(Circle())
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(AppColors.separator.opacity(0.8))
                .cornerRadius(12)
                .padding(.horizontal, 16)
                .padding(.top, 8)

                if viewModel.isSearching {
                    Spacer()
                    ProgressView()
                        .tint(AppColors.accent)
                    Spacer()
                } else if viewModel.searchResults.isEmpty && !viewModel.searchText.isEmpty {
                    Spacer()
                    VStack(spacing: 12) {
                        Image(systemName: "person.slash")
                            .font(.system(size: 36))
                            .foregroundColor(AppColors.tertiaryText)
                        Text(L10n.tr("addFriend.noResults"))
                            .font(.system(size: 15))
                            .foregroundColor(AppColors.secondaryText)
                    }
                    Spacer()
                } else if viewModel.searchText.isEmpty {
                    Spacer()
                    VStack(spacing: 12) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 36))
                            .foregroundColor(AppColors.tertiaryText)
                        Text(L10n.tr("addFriend.searchHint"))
                            .font(.system(size: 15))
                            .foregroundColor(AppColors.secondaryText)
                    }
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(viewModel.searchResults) { user in
                                SearchUserRow(
                                    user: user,
                                    isUpdatingFollow: viewModel.updatingFollowUserIDs.contains(user.userID),
                                    onOpenProfile: {
                                        navigator.push(UserProfileView(userID: user.userID))
                                    },
                                    onToggleFollow: {
                                        viewModel.toggleFollow(userID: user.userID)
                                    },
                                    onMessage: {
                                        openMessage(with: user)
                                    }
                                )
                                Divider().padding(.leading, 72)
                            }
                        }
                        .padding(.top, 8)
                    }
                }
            }
            .background(AppColors.background)
            .navigationTitle(L10n.tr("addFriend.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Text(L10n.tr("common.cancel"))
                            .font(.system(size: 16))
                            .foregroundColor(AppColors.accent)
                            .frame(height: 44)
                            .contentShape(Rectangle())
                    }
                }
            }
            .toast(message: $viewModel.successMessage)
            .toast(message: $viewModel.errorMessage)
        }
    }

    private func openMessage(with user: SearchUser) {
        let contact = Contact(
            userID: user.userID,
            nickname: user.nickname,
            avatarURL: user.avatarURL,
            lastMessage: nil,
            lastMessageTime: nil,
            unreadCount: 0
        )

        dismiss()
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 250_000_000)
            navigator.push(ChatView(contact: contact))
        }
    }
}

// MARK: - Search User Row

struct SearchUserRow: View {
    let user: SearchUser
    let isUpdatingFollow: Bool
    let onOpenProfile: () -> Void
    let onToggleFollow: () -> Void
    let onMessage: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            UserAvatarButton(
                userID: user.userID,
                avatarURL: user.avatarURL,
                size: 44,
                accessibilityName: user.nickname
            )

            Button(action: onOpenProfile) {
                Text(user.nickname)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)
            }
            .buttonStyle(.plain)

            Spacer(minLength: 4)

            actionButtons
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var actionButtons: some View {
        HStack(spacing: 6) {
            Button(action: onToggleFollow) {
                Group {
                    if isUpdatingFollow {
                        ProgressView()
                            .tint(followButtonForegroundColor)
                    } else {
                        Text(followButtonTitle)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(followButtonForegroundColor)
                .padding(.horizontal, 10)
                .frame(minWidth: 56, minHeight: 32)
                .background(
                    Capsule()
                        .fill(followButtonBackgroundColor)
                )
            }
            .buttonStyle(.plain)
            .disabled(isUpdatingFollow)
            .accessibilityLabel(followButtonTitle)

            Button(action: onMessage) {
                Text(L10n.tr("profile.message"))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .padding(.horizontal, 10)
                    .frame(minWidth: 56, minHeight: 32)
                    .background(
                        Capsule()
                            .fill(AppColors.separator)
                    )
            }
            .buttonStyle(.plain)
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private var followButtonTitle: String {
        if user.followedByMe {
            return L10n.tr("follow.followingButton")
        }
        if user.followRequested {
            return L10n.tr("follow.requestedButton")
        }
        return L10n.tr("follow.followButton")
    }

    private var followButtonForegroundColor: Color {
        user.followedByMe || user.followRequested ? AppColors.primaryText : .white
    }

    private var followButtonBackgroundColor: Color {
        user.followedByMe || user.followRequested ? AppColors.separator : AppColors.accent
    }
}
