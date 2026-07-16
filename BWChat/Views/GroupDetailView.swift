// BWChat/Views/GroupDetailView.swift
// Group info/detail page — members, rename, leave/dismiss

import SwiftUI

struct GroupDetailView: View {
    let groupID: Int
    @Environment(\.dismiss) private var dismiss
    @State private var detail: GroupDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?

    private var cacheKey: String { "group_detail_\(groupID)" }
    @State private var showRenameAlert = false
    @State private var newGroupName = ""
    @State private var showAddMembers = false
    @State private var showLeaveConfirm = false
    @State private var showDismissConfirm = false
    @State private var showRemoveConfirm = false
    @State private var memberToRemove: GroupMember?
    @State private var isProcessing = false
    @State private var isUpdatingVisibility = false
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
        .navigationTitle(L10n.tr("group.info.title"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .task {
            // Render from cache immediately (no spinner) while we refresh
            // from the server in the background. Only first-ever open
            // blocks on the network.
            if detail == nil,
               let key = snapshotKey,
               let cached: CachedSnapshot<GroupDetail> = AppCacheRepository.shared.cachedValue(for: key) {
                detail = cached.value
            } else if detail == nil,
                      let legacy = LocalCache.load(GroupDetail.self, key: cacheKey),
                      let key = snapshotKey {
                detail = legacy
                AppCacheRepository.shared.save(legacy, for: key, policy: .profile)
                LocalCache.clear(key: cacheKey)
            }
            await loadDetail()
        }
        .alert(L10n.tr("group.rename.title"), isPresented: $showRenameAlert) {
            TextField(L10n.tr("group.rename.placeholder"), text: $newGroupName)
            Button(L10n.tr("common.cancel"), role: .cancel) {}
            Button(L10n.tr("common.confirm")) {
                Task { await renameGroup() }
            }
        }
        .alert(L10n.tr("group.leave.confirmTitle"), isPresented: $showLeaveConfirm) {
            Button(L10n.tr("common.cancel"), role: .cancel) {}
            Button(L10n.tr("group.leave.confirm"), role: .destructive) {
                Task { await leaveGroup() }
            }
        } message: {
            Text(L10n.tr("group.leave.message"))
        }
        .alert(L10n.tr("group.dismiss.confirmTitle"), isPresented: $showDismissConfirm) {
            Button(L10n.tr("common.cancel"), role: .cancel) {}
            Button(L10n.tr("group.dismiss.confirm"), role: .destructive) {
                Task { await dismissGroup() }
            }
        } message: {
            Text(L10n.tr("group.dismiss.message"))
        }
        .alert(L10n.tr("group.removeMember.title"), isPresented: $showRemoveConfirm) {
            Button(L10n.tr("common.cancel"), role: .cancel) { memberToRemove = nil }
            Button(L10n.tr("group.removeMember.confirm"), role: .destructive) {
                if let m = memberToRemove {
                    Task { await removeMember(m) }
                }
            }
        } message: {
            Text(L10n.tr("group.removeMember.message", memberToRemove?.nickname ?? ""))
        }
        .sheet(isPresented: $showAddMembers) {
            AddGroupMembersView(groupID: groupID) {
                Task { await loadDetail() }
            }
        }
        .alert(L10n.tr("common.error"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(L10n.tr("common.confirm"), role: .cancel) {}
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

            Text(L10n.tr("group.members.count", detail.members.count))
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
                Text(L10n.tr("group.members"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .textCase(.uppercase)
                Spacer()
                Text(L10n.tr("group.members.shortCount", detail.members.count))
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

                        Text(L10n.tr("group.addMembers"))
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
            UserAvatarButton(
                userID: member.userID,
                avatarURL: member.avatarURL,
                size: 42,
                accessibilityName: member.nickname
            )

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(member.nickname)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)

                    if member.role == "owner" {
                        Text(L10n.tr("group.role.owner"))
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(AppColors.accent)
                            .cornerRadius(4)
                    } else if member.role == "admin" {
                        Text(L10n.tr("group.role.admin"))
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
                    Text(L10n.tr("call.voice"))
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
                    Text(L10n.tr("call.video"))
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
                visibilityToggleRow(detail)

                Button {
                    newGroupName = detail.name
                    showRenameAlert = true
                } label: {
                    actionRow(icon: "pencil", text: L10n.tr("group.rename.action"), color: AppColors.accent)
                }
            }

            // Leave or Dismiss
            if isOwner {
                Button {
                    showDismissConfirm = true
                } label: {
                    actionRow(icon: "trash", text: L10n.tr("group.dismiss.action"), color: AppColors.errorColor)
                }
            } else {
                Button {
                    showLeaveConfirm = true
                } label: {
                    actionRow(icon: "rectangle.portrait.and.arrow.right", text: L10n.tr("group.leave.action"), color: AppColors.errorColor)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .padding(.bottom, 40)
    }

    private func visibilityToggleRow(_ detail: GroupDetail) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "globe")
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(AppColors.accent)
                .frame(width: 24)

            Text(L10n.tr("group.isPublic"))
                .font(.system(size: 16))
                .foregroundColor(AppColors.primaryText)

            Spacer()

            if isUpdatingVisibility {
                ProgressView()
                    .scaleEffect(0.8)
                    .tint(AppColors.accent)
            } else {
                Text(detail.isPublic ? L10n.tr("group.public") : L10n.tr("group.private"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
            }

            Toggle("", isOn: Binding(
                get: { self.detail?.isPublic ?? detail.isPublic },
                set: { newValue in
                    Task { await updateGroupVisibility(newValue) }
                }
            ))
            .labelsHidden()
            .tint(AppColors.accent)
            .disabled(isUpdatingVisibility)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(AppColors.background)
        .cornerRadius(12)
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
                .lineLimit(1)
                .minimumScaleFactor(0.82)
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
        // Only block the UI on the very first open (no cache hit). Otherwise
        // refresh silently so the user doesn't see a spinner over data that
        // was already drawn from the cache.
        let showLoader = detail == nil
        if showLoader { isLoading = true }
        defer { isLoading = false }
        do {
            let fetched: GroupDetail
            if let key = snapshotKey {
                fetched = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .profile,
                    forceRefresh: false
                ) {
                    try await APIService.shared.getGroupDetail(groupID: groupID)
                }
            } else {
                fetched = try await APIService.shared.getGroupDetail(groupID: groupID)
            }
            if detail != fetched {
                detail = fetched
            }
            if let key = snapshotKey {
                AppCacheRepository.shared.save(fetched, for: key, policy: .profile)
                LocalCache.clear(key: cacheKey)
            }
        } catch {
            if detail == nil { errorMessage = L10n.tr("group.loadFailed") }
        }
    }

    private var snapshotKey: CacheKey? {
        CacheKey.current(namespace: "group-detail", key: "\(groupID)")
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
            errorMessage = L10n.tr("group.updateFailed")
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
            errorMessage = L10n.tr("group.leaveFailed")
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
            errorMessage = L10n.tr("group.dismissFailed")
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
            errorMessage = L10n.tr("group.removeFailed")
        }
        isProcessing = false
    }

    @MainActor
    private func updateGroupVisibility(_ isPublic: Bool) async {
        guard !isUpdatingVisibility, let current = detail else { return }
        guard current.isPublic != isPublic else { return }

        isUpdatingVisibility = true
        var optimistic = current
        optimistic.isPublic = isPublic
        detail = optimistic
        if let key = snapshotKey { AppCacheRepository.shared.save(optimistic, for: key, policy: .profile) }

        do {
            try await APIService.shared.updateGroupVisibility(groupID: groupID, isPublic: isPublic)
            await loadDetail()
        } catch let error as APIError {
            detail = current
            if let key = snapshotKey { AppCacheRepository.shared.save(current, for: key, policy: .profile) }
            errorMessage = error.errorDescription
        } catch {
            detail = current
            if let key = snapshotKey { AppCacheRepository.shared.save(current, for: key, policy: .profile) }
            errorMessage = L10n.tr("group.publicSettingFailed")
        }

        isUpdatingVisibility = false
    }
}
