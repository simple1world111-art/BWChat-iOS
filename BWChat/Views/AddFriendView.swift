// BWChat/Views/AddFriendView.swift
// Search and add friends - adaptive layout

import SwiftUI

struct AddFriendView: View {
    @StateObject private var viewModel = FriendsViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(AppColors.secondaryText)
                        .font(.system(size: 16))

                    TextField("搜索用户名或昵称", text: $viewModel.searchText)
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
                        Text("未找到相关用户")
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
                        Text("输入用户名或昵称搜索")
                            .font(.system(size: 15))
                            .foregroundColor(AppColors.secondaryText)
                    }
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(viewModel.searchResults) { user in
                                SearchUserRow(user: user) {
                                    Task { await viewModel.sendFriendRequest(to: user.userID) }
                                }
                                Divider().padding(.leading, 72)
                            }
                        }
                        .padding(.top, 8)
                    }
                }
            }
            .background(AppColors.background)
            .navigationTitle("添加好友")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Text("取消")
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
}

// MARK: - Search User Row

struct SearchUserRow: View {
    let user: SearchUser
    let onAdd: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(url: user.avatarURL, size: 44)

            Text(user.nickname)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
                .lineLimit(1)

            Spacer(minLength: 4)

            actionButton
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var actionButton: some View {
        switch user.relation {
        case "friend":
            Text("已是好友")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(AppColors.separator)
                .cornerRadius(16)

        case "pending_sent":
            Text("已发送")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(AppColors.separator)
                .cornerRadius(16)

        case "pending_received":
            Text("待接受")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(AppColors.warningColor)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(AppColors.warningColor.opacity(0.1))
                .cornerRadius(16)

        default:
            Button(action: onAdd) {
                Text("添加")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(AppColors.accentGradient)
                    .cornerRadius(16)
            }
        }
    }
}
