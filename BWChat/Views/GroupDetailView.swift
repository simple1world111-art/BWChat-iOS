// BWChat/Views/GroupDetailView.swift
// Group info/detail page — members, rename, leave/dismiss

import SwiftUI

struct GroupDetailView: View {
    let groupID: Int
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var tabBar: TabBarVisibility
    @State private var detail: GroupDetail?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showRenameAlert = false
    @State private var newGroupName = ""
    @State private var showAddMembers = false
    @State private var showLeaveConfirm = false
    @State private var showDismissConfirm = false
    @State private var showRemoveConfirm = false
    @State private var memberToRemove: GroupMember?
    @State private var isProcessing = false
    var onGroupLeft: (() -> Void)?

    private var isOwner: Bool {
        detail?.creatorID == AuthManager.shared.currentUser?.userID
    }

    var body: some View {
        ScrollView {
            if isLoading {
                ProgressView()
                    .tint(AppColors.accent)
                    .padding(.top, 80)
            } else if let detail = detail {
                VStack(spacing: 0) {
                    // Group name section
                    groupHeaderSection(detail)

                    // Call buttons
                    callSection(detail)

                    // Members section
                    membersSection(detail)

                    // Actions section
                    actionsSection(detail)
                }
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle("群聊信息")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { tabBar.hide() }
        .onDisappear { tabBar.show() }
        .task { await loadDetail() }
        .alert("修改群名", isPresented: $showRenameAlert) {
            TextField("输入新群名", text: $newGroupName)
            Button("取消", role: .cancel) {}
            Button("确定") {
                Task { await renameGroup() }
            }
        }
        .alert("确认退出", isPresented: $showLeaveConfirm) {
            Button("取消", role: .cancel) {}
            Button("退出", role: .destructive) {
                Task { await leaveGroup() }
            }
        } message: {
            Text("确定要退出该群聊吗？")
        }
        .alert("确认解散", isPresented: $showDismissConfirm) {
            Button("取消", role: .cancel) {}
            Button("解散", role: .destructive) {
                Task { await dismissGroup() }
            }
        } message: {
            Text("解散后所有成员将被移出，聊天记录将被删除，此操作不可恢复。")
        }
        .alert("移除成员", isPresented: $showRemoveConfirm) {
            Button("取消", role: .cancel) { memberToRemove = nil }
            Button("移除", role: .destructive) {
                if let m = memberToRemove {
                    Task { await removeMember(m) }
                }
            }
        } message: {
            Text("确定要将 \(memberToRemove?.nickname ?? "") 移出群聊吗？")
        }
        .sheet(isPresented: $showAddMembers) {
            AddGroupMembersView(groupID: groupID) {
                Task { await loadDetail() }
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

    // MARK: - Group Header

    private func groupHeaderSection(_ detail: GroupDetail) -> some View {
        VStack(spacing: 12) {
            // Group avatar (grid of member avatars)
            groupAvatarGrid(detail.members)

            Text(detail.name)
                .font(.system(size: 20, weight: .semibold))
                .foregroundColor(AppColors.primaryText)

            Text("\(detail.members.count) 位成员")
                .font(.system(size: 14))
                .foregroundColor(AppColors.secondaryText)
        }
        .padding(.vertical, 24)
        .frame(maxWidth: .infinity)
        .background(AppColors.background)
    }

    private func groupAvatarGrid(_ members: [GroupMember]) -> some View {
        let displayMembers = Array(members.prefix(9))
        let columns = min(displayMembers.count, 3)
        let gridSize: CGFloat = columns <= 3 ? 72 : 72

        return LazyVGrid(
            columns: Array(repeating: GridItem(.fixed(22), spacing: 2), count: min(columns, 3)),
            spacing: 2
        ) {
            ForEach(displayMembers) { member in
                AvatarView(url: member.avatarURL, size: 22)
            }
        }
        .frame(width: gridSize, height: gridSize)
        .padding(6)
        .background(AppColors.separator)
        .cornerRadius(14)
    }

    // MARK: - Members Section

    private func membersSection(_ detail: GroupDetail) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("群成员")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .textCase(.uppercase)
                Spacer()
                Text("\(detail.members.count) 人")
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.tertiaryText)
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 8)

            VStack(spacing: 0) {
                ForEach(detail.members) { member in
                    memberRow(member, detail: detail)
                    if member.id != detail.members.last?.id {
                        Divider().padding(.leading, 72)
                    }
                }

                // Add member button
                Divider().padding(.leading, 72)
                Button {
                    showAddMembers = true
                } label: {
                    HStack(spacing: 12) {
                        ZStack {
                            Circle()
                                .strokeBorder(AppColors.accent, style: StrokeStyle(lineWidth: 1.5, dash: [4]))
                                .frame(width: 42, height: 42)
                            Image(systemName: "plus")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(AppColors.accent)
                        }

                        Text("添加成员")
                            .font(.system(size: 16))
                            .foregroundColor(AppColors.accent)

                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
            }
            .background(AppColors.background)
            .cornerRadius(12)
            .padding(.horizontal, 16)
        }
    }

    private func memberRow(_ member: GroupMember, detail: GroupDetail) -> some View {
        HStack(spacing: 12) {
            AvatarView(url: member.avatarURL, size: 42)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(member.nickname)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)

                    if member.role == "owner" {
                        Text("群主")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(AppColors.accent)
                            .cornerRadius(4)
                    } else if member.role == "admin" {
                        Text("管理员")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(AppColors.accent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(AppColors.accentLight)
                            .cornerRadius(4)
                    }
                }
            }

            Spacer()

            // Owner can remove non-owner members
            if isOwner && member.userID != AuthManager.shared.currentUser?.userID {
                Button {
                    memberToRemove = member
                    showRemoveConfirm = true
                } label: {
                    Image(systemName: "minus.circle")
                        .foregroundColor(AppColors.errorColor)
                        .font(.system(size: 18))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: - Call Section

    private func callSection(_ detail: GroupDetail) -> some View {
        HStack(spacing: 20) {
            Button {
                CallManager.shared.startGroupCall(
                    groupID: groupID,
                    groupName: detail.name,
                    type: .voice
                )
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "phone.fill")
                        .font(.system(size: 16))
                    Text("语音通话")
                        .font(.system(size: 15, weight: .medium))
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(AppColors.accent)
                .cornerRadius(12)
            }

            Button {
                CallManager.shared.startGroupCall(
                    groupID: groupID,
                    groupName: detail.name,
                    type: .video
                )
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "video.fill")
                        .font(.system(size: 16))
                    Text("视频通话")
                        .font(.system(size: 15, weight: .medium))
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(AppColors.groupAccent)
                .cornerRadius(12)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
    }

    // MARK: - Actions Section

    private func actionsSection(_ detail: GroupDetail) -> some View {
        VStack(spacing: 12) {
            // Rename (owner/admin only)
            if isOwner {
                Button {
                    newGroupName = detail.name
                    showRenameAlert = true
                } label: {
                    actionRow(icon: "pencil", text: "修改群名", color: AppColors.accent)
                }
            }

            // Leave or Dismiss
            if isOwner {
                Button {
                    showDismissConfirm = true
                } label: {
                    actionRow(icon: "trash", text: "解散群聊", color: AppColors.errorColor)
                }
            } else {
                Button {
                    showLeaveConfirm = true
                } label: {
                    actionRow(icon: "rectangle.portrait.and.arrow.right", text: "退出群聊", color: AppColors.errorColor)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .padding(.bottom, 40)
    }

    private func actionRow(icon: String, text: String, color: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(color)
                .frame(width: 24)
            Text(text)
                .font(.system(size: 16))
                .foregroundColor(color)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(AppColors.tertiaryText)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(AppColors.background)
        .cornerRadius(12)
    }

    // MARK: - Actions

    private func loadDetail() async {
        isLoading = true
        do {
            detail = try await APIService.shared.getGroupDetail(groupID: groupID)
        } catch {
            errorMessage = "加载群信息失败"
        }
        isLoading = false
    }

    private func renameGroup() async {
        let name = newGroupName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        isProcessing = true
        do {
            try await APIService.shared.renameGroup(groupID: groupID, name: name)
            await loadDetail()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "修改失败"
        }
        isProcessing = false
    }

    private func leaveGroup() async {
        isProcessing = true
        do {
            try await APIService.shared.leaveGroup(groupID: groupID)
            onGroupLeft?()
            dismiss()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "退出失败"
        }
        isProcessing = false
    }

    private func dismissGroup() async {
        isProcessing = true
        do {
            try await APIService.shared.dismissGroup(groupID: groupID)
            onGroupLeft?()
            dismiss()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "解散失败"
        }
        isProcessing = false
    }

    private func removeMember(_ member: GroupMember) async {
        isProcessing = true
        do {
            try await APIService.shared.removeGroupMember(groupID: groupID, userID: member.userID)
            memberToRemove = nil
            await loadDetail()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "移除失败"
        }
        isProcessing = false
    }
}
