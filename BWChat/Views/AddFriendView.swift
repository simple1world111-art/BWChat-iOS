// BWChat/Views/AddFriendView.swift
// Search and add friends

import SwiftUI

struct AddFriendView: View {
    @StateObject private var viewModel = FriendsViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                HStack(spacing: 12) {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(AppColors.secondaryText)
                        .font(.system(size: 16))

                    TextField("搜索用户名或昵称", text: $viewModel.searchText)
                        .font(.system(size: 16))
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
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
                                .font(.system(size: 16))
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(AppColors.separator.opacity(0.8))
                .cornerRadius(12)
                .padding(.horizontal, 16)
                .padding(.top, 8)

                if viewModel.isSearching {
                    Spacer()
                    ProgressView()
                        .scaleEffect(1.2)
                    Spacer()
                } else if viewModel.searchResults.isEmpty && !viewModel.searchText.isEmpty {
                    Spacer()
                    VStack(spacing: 12) {
                        Image(systemName: "person.slash")
                            .font(.system(size: 40))
                            .foregroundColor(AppColors.tertiaryText)
                        Text("未找到相关用户")
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
                                Divider().padding(.leading, 76)
                            }
                        }
                        .padding(.top, 12)
                    }
                }
            }
            .background(AppColors.background)
            .navigationTitle("添加好友")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                        .foregroundColor(AppColors.accent)
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
        HStack(spacing: 14) {
            AvatarView(url: user.avatarURL, size: 48)

            VStack(alignment: .leading, spacing: 3) {
                Text(user.nickname)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
            }

            Spacer()

            switch user.relation {
            case "friend":
                Text("已是好友")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(AppColors.separator)
                    .cornerRadius(16)

            case "pending_sent":
                Text("已发送")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(AppColors.separator)
                    .cornerRadius(16)

            case "pending_received":
                Text("待接受")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(AppColors.warningColor)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(AppColors.warningColor.opacity(0.1))
                    .cornerRadius(16)

            default:
                Button(action: onAdd) {
                    Text("添加")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 7)
                        .background(AppColors.accentGradient)
                        .cornerRadius(16)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
