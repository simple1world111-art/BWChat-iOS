// BWChat/Views/FriendRequestsView.swift
// Pending friend requests list

import SwiftUI

struct FriendRequestsView: View {
    @StateObject private var viewModel = FriendsViewModel()

    var body: some View {
        Group {
            if viewModel.friendRequests.isEmpty && !viewModel.isLoading {
                VStack(spacing: 16) {
                    Spacer()
                    Image(systemName: "person.crop.circle.badge.clock")
                        .font(.system(size: 44))
                        .foregroundColor(AppColors.tertiaryText)
                    Text("暂无好友请求")
                        .font(.system(size: 15))
                        .foregroundColor(AppColors.secondaryText)
                    Spacer()
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(viewModel.friendRequests) { request in
                            FriendRequestRow(request: request) {
                                Task { await viewModel.acceptRequest(request) }
                            } onReject: {
                                Task { await viewModel.rejectRequest(request) }
                            }
                            Divider().padding(.leading, 76)
                        }
                    }
                }
            }
        }
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
        HStack(spacing: 14) {
            AvatarView(url: request.avatarURL, size: 48)

            VStack(alignment: .leading, spacing: 3) {
                Text(request.nickname)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                Text("请求添加你为好友")
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
            }

            Spacer()

            HStack(spacing: 10) {
                Button(action: onReject) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(AppColors.secondaryText)
                        .frame(width: 36, height: 36)
                        .background(AppColors.separator)
                        .clipShape(Circle())
                }

                Button(action: onAccept) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 36, height: 36)
                        .background(AppColors.accentGradient)
                        .clipShape(Circle())
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
