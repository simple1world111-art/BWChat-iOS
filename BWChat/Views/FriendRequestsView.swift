// BWChat/Views/FriendRequestsView.swift
// Pending friend requests - adaptive layout

import SwiftUI

struct FriendRequestsView: View {
    @StateObject private var viewModel = FriendsViewModel()

    var body: some View {
        Group {
            if viewModel.friendRequests.isEmpty && !viewModel.isLoading {
                VStack(spacing: 14) {
                    Spacer()
                    Image(systemName: "person.crop.circle.badge.clock")
                        .font(.system(size: 40))
                        .foregroundColor(AppColors.tertiaryText)
                    Text("暂无好友请求")
                        .font(.system(size: 15))
                        .foregroundColor(AppColors.secondaryText)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(viewModel.friendRequests) { request in
                            FriendRequestRow(request: request) {
                                Task { await viewModel.acceptRequest(request) }
                            } onReject: {
                                Task { await viewModel.rejectRequest(request) }
                            }
                            Divider().padding(.leading, 72)
                        }
                    }
                }
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle("好友请求")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadFriendRequests()
        }
        .toast(message: $viewModel.successMessage)
    }
}

struct FriendRequestRow: View {
    let request: FriendRequest
    let onAccept: () -> Void
    let onReject: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(url: request.avatarURL, size: 44)

            VStack(alignment: .leading, spacing: 3) {
                Text(request.nickname)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)
                Text("请求添加你为好友")
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
            }

            Spacer(minLength: 4)

            HStack(spacing: 8) {
                Button(action: onReject) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(AppColors.secondaryText)
                        .frame(width: 38, height: 38)
                        .background(AppColors.separator)
                        .clipShape(Circle())
                }

                Button(action: onAccept) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 38, height: 38)
                        .background(AppColors.accentGradient)
                        .clipShape(Circle())
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
