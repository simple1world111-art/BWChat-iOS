// BWChat/Views/AddGroupMembersView.swift
// Add members to an existing group chat

import SwiftUI

struct AddGroupMembersView: View {
    let groupID: Int
    @StateObject private var friendsVM = FriendsViewModel()
    @Environment(\.dismiss) private var dismiss
    @State private var selectedFriends: Set<String> = []
    @State private var existingMemberIDs: Set<String> = []
    @State private var isAdding = false
    @State private var isLoadingDetail = true
    @State private var errorMessage: String?
    var onMembersAdded: (() -> Void)?

    private var availableFriends: [FriendInfo] {
        friendsVM.friends.filter { !existingMemberIDs.contains($0.userID) }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if isLoadingDetail || friendsVM.isLoading {
                    Spacer()
                    ProgressView()
                        .tint(AppColors.accent)
                    Spacer()
                } else if availableFriends.isEmpty {
                    VStack(spacing: 12) {
                        Spacer()
                        Image(systemName: "person.badge.plus")
                            .font(.system(size: 36))
                            .foregroundColor(AppColors.tertiaryText)
                        Text("所有好友都已在群中")
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.secondaryText)
                        Spacer()
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    // Header
                    VStack(alignment: .leading, spacing: 8) {
                        Text("选择要添加的好友 (\(selectedFriends.count))")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                            .textCase(.uppercase)
                            .padding(.horizontal, 16)
                    }
                    .padding(.top, 16)
                    .padding(.bottom, 8)

                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(availableFriends) { friend in
                                let isSelected = selectedFriends.contains(friend.userID)
                                Button {
                                    if isSelected {
                                        selectedFriends.remove(friend.userID)
                                    } else {
                                        selectedFriends.insert(friend.userID)
                                    }
                                } label: {
                                    HStack(spacing: 12) {
                                        ZStack {
                                            Circle()
                                                .strokeBorder(isSelected ? AppColors.accent : AppColors.tertiaryText, lineWidth: 2)
                                                .frame(width: 24, height: 24)
                                            if isSelected {
                                                Circle()
                                                    .fill(AppColors.accent)
                                                    .frame(width: 24, height: 24)
                                                Image(systemName: "checkmark")
                                                    .font(.system(size: 11, weight: .bold))
                                                    .foregroundColor(.white)
                                            }
                                        }
                                        .frame(width: 36, height: 36)
                                        .contentShape(Circle())

                                        AvatarView(url: friend.avatarURL, size: 42)

                                        Text(friend.nickname)
                                            .font(.system(size: 16, weight: .medium))
                                            .foregroundColor(AppColors.primaryText)
                                            .lineLimit(1)

                                        Spacer()
                                    }
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 8)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                Divider().padding(.leading, 76)
                            }
                        }
                    }
                }

                Spacer(minLength: 0)
            }
            .background(AppColors.background)
            .navigationTitle("添加群成员")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                        .font(.system(size: 16))
                        .foregroundColor(AppColors.accent)
                        .frame(height: 44)
                        .contentShape(Rectangle())
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        Task { await addMembers() }
                    } label: {
                        if isAdding {
                            ProgressView()
                                .scaleEffect(0.8)
                        } else {
                            Text("添加")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(!selectedFriends.isEmpty ? AppColors.accent : AppColors.tertiaryText)
                        }
                    }
                    .disabled(selectedFriends.isEmpty || isAdding)
                    .frame(height: 44)
                    .contentShape(Rectangle())
                }
            }
            .alert("错误", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("确定", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
        .task {
            await loadData()
        }
    }

    private func loadData() async {
        isLoadingDetail = true
        async let detailTask: () = loadGroupDetail()
        async let friendsTask: () = friendsVM.loadFriends()
        _ = await (detailTask, friendsTask)
        isLoadingDetail = false
    }

    private func loadGroupDetail() async {
        do {
            let detail = try await APIService.shared.getGroupDetail(groupID: groupID)
            existingMemberIDs = Set(detail.members.map { $0.userID })
        } catch {
            errorMessage = "加载群信息失败"
        }
    }

    private func addMembers() async {
        isAdding = true
        do {
            try await APIService.shared.addGroupMembers(groupID: groupID, memberIDs: Array(selectedFriends))
            onMembersAdded?()
            dismiss()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "添加失败"
        }
        isAdding = false
    }
}
