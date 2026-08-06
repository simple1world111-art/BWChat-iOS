// BWChat/Views/GroupDetailView.swift
// Group info/detail page — members, rename, leave/dismiss

import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins

struct GroupDetailView: View {
    let groupID: Int
    var onGroupLeft: (() -> Void)?
    var onLocateMessage: ((Int) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var notificationSettingsStore = GroupNotificationSettingsStore.shared
    @ObservedObject private var viewerSettingsStore = GroupInfoPreferencesStore.shared
    @ObservedObject private var conversationPreferenceStore = ConversationPreferenceStore.shared
    @ObservedObject private var appConfig = AppRemoteConfigStore.shared

    @State private var detail: GroupDetail?
    @State private var isLoading = false
    @State private var isProcessing = false
    @State private var isUpdatingVisibility = false
    @State private var showAddMembers = false
    @State private var showLeaveConfirm = false
    @State private var showDismissConfirm = false
    @State private var showClearConfirm = false
    @State private var errorMessage: String?
    @State private var toastMessage: String?

    private var cacheKey: String { "group_detail_\(groupID)" }
    private var snapshotKey: CacheKey? {
        CacheKey.current(namespace: "group-detail", key: "\(groupID)")
    }
    private var groupInfoV2Enabled: Bool {
        appConfig.featureFlags.isEnabled("group_info_v2", default: true)
    }
    private var notificationSettingsEnabled: Bool {
        appConfig.featureFlags.isEnabled("group_notification_settings_v1", default: false)
    }

    var body: some View {
        Group {
            if isLoading && detail == nil {
                ProgressView()
                    .tint(AppColors.accent)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let detail {
                content(detail)
            } else {
                VStack(spacing: 14) {
                    Image(systemName: "person.3.sequence")
                        .font(.title)
                        .foregroundColor(AppColors.secondaryText)
                    Text(L10n.tr("group.loadFailed"))
                        .foregroundColor(AppColors.secondaryText)
                    Button(L10n.tr("common.retry")) { Task { await loadDetail(forceRefresh: true) } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("group.info.title.count", detail?.members.count ?? 0))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { openMembers() } label: {
                    Image(systemName: "magnifyingglass")
                }
                .disabled(detail == nil)
                .accessibilityLabel(L10n.tr("group.members.search"))
            }
        }
        .task {
            restoreCachedDetailIfNeeded()
            await loadDetail()
        }
        .sheet(isPresented: $showAddMembers) {
            AddGroupMembersView(groupID: groupID) {
                Task { await loadDetail(forceRefresh: true) }
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
        .alert(L10n.tr("group.clear.confirmTitle"), isPresented: $showClearConfirm) {
            Button(L10n.tr("common.cancel"), role: .cancel) {}
            Button(L10n.tr("group.clear.action"), role: .destructive) {
                Task { await clearHistory() }
            }
        } message: {
            Text(L10n.tr("group.clear.message"))
        }
        .alert(L10n.tr("common.error"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(L10n.tr("common.confirm"), role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
        .overlay {
            if isProcessing {
                ZStack {
                    Color.black.opacity(0.08).ignoresSafeArea()
                    ProgressView().tint(AppColors.accent)
                }
            }
        }
        .toast(message: $toastMessage)
        .onReceive(WebSocketService.shared.groupAnnouncementPublisher) { update in
            guard update.groupID == groupID, var current = detail else { return }
            if let existing = current.announcement, existing.revision > update.revision { return }
            current.announcement = update
            detail = current
            persist(current)
        }
        .onReceive(WebSocketService.shared.groupMemberUpdatePublisher) { update in
            guard update.groupID == groupID else { return }
            Task { await loadDetail(forceRefresh: true) }
        }
        .onReceive(viewerSettingsStore.$settingsByGroupID) { values in
            guard let settings = values[groupID], var current = detail else { return }
            current.viewerSettings = settings
            detail = current
            persist(current)
        }
    }

    private func content(_ detail: GroupDetail) -> some View {
        let viewerSettings = viewerSettingsStore.settings(for: groupID)
        return List {
            Section {
                GroupMemberPreviewSection(
                    members: detail.members,
                    canManageMembers: effectiveCapabilities(for: detail).canManageMembers,
                    onAdd: { showAddMembers = true },
                    onMore: openMembers
                )
                .padding(.bottom, 6)
                .listRowBackground(AppColors.secondaryBackground)
                .listRowSeparator(.hidden)
            }
            .listRowInsets(EdgeInsets())

            Section {
                groupNameRow(detail)

                if featureEnabled("group_invite_qr_v1") {
                    groupInviteRow(detail)
                }

                if featureEnabled("group_announcement_v1") {
                    groupAnnouncementRow(detail)
                }

                if featureEnabled("group_viewer_settings_v1") {
                    Button { openRemarkEditor(detail) } label: {
                        GroupInfoNavigationRow(
                            title: L10n.tr("group.remark.title"),
                            value: viewerSettings.remark.isBlank
                                ? L10n.tr("common.notSet")
                                : viewerSettings.remark
                        )
                    }
                }
            }

            if featureEnabled("group_message_search_v1") {
                Section {
                    Button { openMessageSearch(detail) } label: {
                        GroupInfoNavigationRow(title: L10n.tr("group.search.title"))
                    }
                }
            }

            Section {
                if notificationSettingsEnabled {
                    notificationRows(detail)
                }

                Toggle(isOn: Binding(
                    get: { conversationPreferenceStore.isPinned(groupID: groupID) },
                    set: { newValue in Task { await updatePinned(newValue) } }
                )) {
                    Text(L10n.tr("group.pin.title"))
                }
                .tint(AppColors.accent)
                .disabled(conversationPreferenceStore.isUpdating(groupID: groupID))
            }

            if featureEnabled("group_viewer_settings_v1") {
                Section {
                    Button { openMyNicknameEditor(detail) } label: {
                        GroupInfoNavigationRow(
                            title: L10n.tr("group.myNickname.title"),
                            value: currentMember(in: detail)?.groupNickname?.isBlank == false
                                ? currentMember(in: detail)?.groupNickname
                                : L10n.tr("common.notSet")
                        )
                    }

                    Toggle(isOn: Binding(
                        get: { viewerSettingsStore.settings(for: groupID).showMemberNicknames },
                        set: { newValue in Task { await updateShowMemberNicknames(newValue) } }
                    )) {
                        Text(L10n.tr("group.showMemberNicknames"))
                    }
                    .tint(AppColors.accent)
                    .disabled(viewerSettingsStore.isUpdating(groupID: groupID))
                }
            }

            Section {
                Button {
                    navigator.push(ChatBackgroundSettingsView(
                        targetType: .group,
                        targetID: String(groupID),
                        title: L10n.tr("chatBackground.currentChat")
                    ))
                } label: {
                    GroupInfoNavigationRow(title: L10n.tr("chatBackground.currentChat"))
                }
            }

            Section {
                Button(role: .destructive) { showClearConfirm = true } label: {
                    Text(L10n.tr("group.clear.action"))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            if featureEnabled("group_reporting_v1") {
                Section {
                    Button {
                        navigator.push(GroupReportView(groupID: groupID))
                    } label: {
                        GroupInfoNavigationRow(title: L10n.tr("group.report.title"))
                    }
                }
            }

            if effectiveCapabilities(for: detail).canChangeVisibility {
                Section {
                    visibilityToggle(detail)
                }
            }

            Section {
                if effectiveCapabilities(for: detail).canDismissGroup {
                    Button(role: .destructive) { showDismissConfirm = true } label: {
                        Text(L10n.tr("group.dismiss.action"))
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                } else {
                    Button(role: .destructive) { showLeaveConfirm = true } label: {
                        Text(L10n.tr("group.leave.action"))
                            .frame(maxWidth: .infinity, alignment: .center)
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(AppColors.secondaryBackground)
        .environment(\.defaultMinListRowHeight, 54)
        .tint(AppColors.accent)
    }

    @ViewBuilder
    private func groupNameRow(_ detail: GroupDetail) -> some View {
        if effectiveCapabilities(for: detail).canEditGroup {
            Button { openGroupNameEditor(detail) } label: {
                GroupInfoNavigationRow(title: L10n.tr("group.name.title"), value: detail.name)
            }
        } else {
            GroupInfoNavigationRow(title: L10n.tr("group.name.title"), value: detail.name, showsChevron: false)
        }
    }

    @ViewBuilder
    private func groupInviteRow(_ detail: GroupDetail) -> some View {
        if effectiveCapabilities(for: detail).canCreateInvite {
            Button {
                navigator.push(GroupInviteView(groupID: groupID, groupName: detail.name))
            } label: {
                GroupInfoNavigationRow(
                    title: L10n.tr("group.invite.title"),
                    trailingSystemImage: "qrcode"
                )
            }
        } else {
            GroupInfoNavigationRow(
                title: L10n.tr("group.invite.title"),
                value: L10n.tr("group.invite.managersOnly"),
                showsChevron: false
            )
        }
    }

    private func groupAnnouncementRow(_ detail: GroupDetail) -> some View {
        Button {
            navigator.push(GroupAnnouncementView(
                groupID: groupID,
                announcement: detail.announcement,
                canEdit: effectiveCapabilities(for: detail).canEditAnnouncement
            ) { updated in
                var current = self.detail
                current?.announcement = updated
                self.detail = current
                if let current { persist(current) }
            })
        } label: {
            GroupInfoNavigationRow(
                title: L10n.tr("group.announcement.title"),
                subtitle: announcementSummary(detail.announcement)
            )
        }
    }

    @ViewBuilder
    private func notificationRows(_ detail: GroupDetail) -> some View {
        let settings = notificationSettingsStore.settings(for: groupID)
        let isUpdating = notificationSettingsStore.isUpdating(groupID: groupID)
        Toggle(isOn: Binding(
            get: { notificationSettingsStore.settings(for: groupID).isMuted },
            set: { value in Task { await updateMute(value) } }
        )) {
            Text(L10n.tr("group.notifications.mute"))
        }
        .tint(AppColors.accent)
        .disabled(isUpdating)

        if settings.isMuted {
            Button {
                navigator.push(GroupNotificationExceptionsView(groupID: groupID, members: detail.members))
            } label: {
                GroupInfoNavigationRow(
                    title: L10n.tr("group.notifications.exceptions"),
                    subtitle: notificationExceptionSummary(settings)
                )
            }
        }
    }

    private func visibilityToggle(_ detail: GroupDetail) -> some View {
        Toggle(isOn: Binding(
            get: { self.detail?.isPublic ?? detail.isPublic },
            set: { value in Task { await updateGroupVisibility(value) } }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text(L10n.tr("group.isPublic"))
                Text(detail.isPublic ? L10n.tr("group.public") : L10n.tr("group.private"))
                    .font(.caption)
                    .foregroundColor(AppColors.secondaryText)
            }
        }
        .tint(AppColors.accent)
        .disabled(isUpdatingVisibility)
    }

    private func openMembers() {
        guard let detail else { return }
        navigator.push(GroupMembersView(
            groupID: groupID,
            members: detail.members,
            capabilities: effectiveCapabilities(for: detail)
        ) {
            Task { await loadDetail(forceRefresh: true) }
        })
    }

    private func openGroupNameEditor(_ detail: GroupDetail) {
        navigator.push(GroupTextSettingView(
            title: L10n.tr("group.name.title"),
            prompt: L10n.tr("group.rename.placeholder"),
            initialValue: detail.name,
            allowsEmpty: false
        ) { value in
            try await APIService.shared.renameGroup(groupID: groupID, name: value)
            await loadDetail(forceRefresh: true)
        })
    }

    private func openRemarkEditor(_ detail: GroupDetail) {
        navigator.push(GroupTextSettingView(
            title: L10n.tr("group.remark.title"),
            prompt: L10n.tr("group.remark.placeholder"),
            initialValue: viewerSettingsStore.settings(for: groupID).remark,
            allowsEmpty: true
        ) { value in
            try await viewerSettingsStore.update(groupID: groupID, remark: value)
        })
    }

    private func openMyNicknameEditor(_ detail: GroupDetail) {
        navigator.push(GroupTextSettingView(
            title: L10n.tr("group.myNickname.title"),
            prompt: L10n.tr("group.myNickname.placeholder"),
            initialValue: currentMember(in: detail)?.groupNickname ?? "",
            allowsEmpty: true
        ) { value in
            _ = try await APIService.shared.updateMyGroupNickname(groupID: groupID, nickname: value)
            await loadDetail(forceRefresh: true)
        })
    }

    private func openMessageSearch(_ detail: GroupDetail) {
        navigator.push(GroupMessageSearchView(
            groupID: groupID,
            members: detail.members,
            onSelect: { messageID in onLocateMessage?(messageID) }
        ))
    }

    private func featureEnabled(_ key: String) -> Bool {
        groupInfoV2Enabled && appConfig.featureFlags.isEnabled(key, default: false)
    }

    private func currentMember(in detail: GroupDetail) -> GroupMember? {
        if let currentMember = detail.currentMember { return currentMember }
        guard let currentUserID = AuthManager.shared.currentUser?.userID else { return nil }
        return detail.members.first(where: { $0.userID == currentUserID })
    }

    private func effectiveCapabilities(for detail: GroupDetail) -> GroupCapabilities {
        let server = detail.capabilities
        let member = currentMember(in: detail)
        let role = member?.role.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        let isOwner = member?.userID == detail.creatorID || role == "owner"
        let isManager = isOwner || role == "admin"
        return GroupCapabilities(
            canManageMembers: server.canManageMembers || isManager,
            canEditGroup: server.canEditGroup || isManager,
            canEditAnnouncement: server.canEditAnnouncement || isManager,
            canCreateInvite: server.canCreateInvite || detail.isPublic || isManager,
            canChangeVisibility: server.canChangeVisibility || isOwner,
            canDismissGroup: server.canDismissGroup || isOwner
        )
    }

    private func announcementSummary(_ announcement: GroupAnnouncement?) -> String {
        guard let announcement else { return L10n.tr("group.announcement.empty") }
        let title = announcement.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let content = announcement.content.trimmingCharacters(in: .whitespacesAndNewlines)
        if !title.isEmpty && !content.isEmpty { return "\(title) · \(content)" }
        return title.isEmpty ? (content.isEmpty ? L10n.tr("group.announcement.empty") : content) : title
    }

    private func notificationExceptionSummary(_ settings: GroupNotificationSettings) -> String {
        var items: [String] = []
        if settings.notifyMentionsMe { items.append(L10n.tr("group.notifications.mentionsMe")) }
        if settings.notifyMentionsAll { items.append(L10n.tr("group.notifications.mentionsAll")) }
        if !settings.importantMemberIDs.isEmpty {
            items.append(L10n.tr("group.notifications.importantSummary", settings.importantMemberIDs.count))
        }
        return items.isEmpty ? L10n.tr("group.notifications.none") : items.joined(separator: "、")
    }

    private func restoreCachedDetailIfNeeded() {
        guard detail == nil else { return }
        if let key = snapshotKey,
           let cached: CachedSnapshot<GroupDetail> = AppCacheRepository.shared.cachedValue(for: key) {
            detail = cached.value
            viewerSettingsStore.apply(cached.value.viewerSettings, allowOlderRevision: true)
        } else if let legacy = LocalCache.load(GroupDetail.self, key: cacheKey) {
            detail = legacy
            viewerSettingsStore.apply(legacy.viewerSettings, allowOlderRevision: true)
        }
    }

    private func loadDetail(forceRefresh: Bool = false) async {
        let showsLoader = detail == nil
        if showsLoader { isLoading = true }
        defer { isLoading = false }
        do {
            var fetched: GroupDetail
            if let key = snapshotKey {
                fetched = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .profile,
                    forceRefresh: forceRefresh
                ) {
                    try await APIService.shared.getGroupDetail(groupID: groupID)
                }
            } else {
                fetched = try await APIService.shared.getGroupDetail(groupID: groupID)
            }
            notificationSettingsStore.apply(fetched.notificationSettings)
            viewerSettingsStore.apply(fetched.viewerSettings)
            fetched.viewerSettings = viewerSettingsStore.settings(for: groupID)
            detail = fetched
            persist(fetched)
        } catch {
            if detail == nil { errorMessage = L10n.tr("group.loadFailed") }
        }
    }

    private func persist(_ value: GroupDetail) {
        if let key = snapshotKey {
            AppCacheRepository.shared.save(value, for: key, policy: .profile)
        }
        LocalCache.save(value, key: cacheKey)
    }

    private func updateMute(_ value: Bool) async {
        do {
            try await notificationSettingsStore.update(groupID: groupID, isMuted: value)
        } catch {
            errorMessage = L10n.tr("group.notifications.updateFailed")
        }
    }

    private func updatePinned(_ value: Bool) async {
        do {
            try await conversationPreferenceStore.setPinned(
                type: "group",
                targetID: String(groupID),
                isPinned: value
            )
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }

    private func updateShowMemberNicknames(_ value: Bool) async {
        do {
            try await viewerSettingsStore.update(groupID: groupID, showMemberNicknames: value)
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }

    private func clearHistory() async {
        isProcessing = true
        defer { isProcessing = false }
        do {
            let receipt = try await APIService.shared.clearGroupMessageHistory(groupID: groupID)
            viewerSettingsStore.applyHistoryClear(receipt)
            toastMessage = L10n.tr("group.clear.success")
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }

    private func leaveGroup() async {
        isProcessing = true
        defer { isProcessing = false }
        do {
            try await APIService.shared.leaveGroup(groupID: groupID)
            onGroupLeft?()
            dismiss()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("group.leaveFailed")
        }
    }

    private func dismissGroup() async {
        isProcessing = true
        defer { isProcessing = false }
        do {
            try await APIService.shared.dismissGroup(groupID: groupID)
            onGroupLeft?()
            dismiss()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("group.dismissFailed")
        }
    }

    private func updateGroupVisibility(_ value: Bool) async {
        guard !isUpdatingVisibility, let current = detail, current.isPublic != value else { return }
        isUpdatingVisibility = true
        var optimistic = current
        optimistic.isPublic = value
        detail = optimistic
        persist(optimistic)
        do {
            try await APIService.shared.updateGroupVisibility(groupID: groupID, isPublic: value)
            await loadDetail(forceRefresh: true)
        } catch let error as APIError {
            detail = current
            persist(current)
            errorMessage = error.errorDescription
        } catch {
            detail = current
            persist(current)
            errorMessage = L10n.tr("group.publicSettingFailed")
        }
        isUpdatingVisibility = false
    }
}

private struct GroupInfoNavigationRow: View {
    let title: String
    var value: String? = nil
    var subtitle: String? = nil
    var trailingSystemImage: String? = nil
    var showsChevron = true

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.body)
                    .foregroundColor(AppColors.primaryText)
                if let subtitle, !subtitle.isBlank {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 12)
            if let value, !value.isBlank {
                Text(value)
                    .font(.body)
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: 190, alignment: .trailing)
            }
            if let trailingSystemImage {
                Image(systemName: trailingSystemImage)
                    .font(.body)
                    .foregroundColor(AppColors.secondaryText)
            }
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(AppColors.tertiaryText)
            }
        }
        .contentShape(Rectangle())
    }
}

private struct GroupMemberPreviewSection: View {
    let members: [GroupMember]
    let canManageMembers: Bool
    let onAdd: () -> Void
    let onMore: () -> Void

    private var columnCount: Int { UIScreen.main.bounds.width <= 375 ? 5 : 6 }
    private var visibleMembers: [GroupMember] {
        let capacity = columnCount * 3 - (canManageMembers ? 1 : 0)
        return Array(members.prefix(max(capacity, 0)))
    }

    var body: some View {
        VStack(spacing: 10) {
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: columnCount),
                spacing: 14
            ) {
                ForEach(visibleMembers) { member in
                    VStack(spacing: 6) {
                        UserAvatarButton(
                            userID: member.userID,
                            avatarURL: member.avatarURL,
                            size: 48,
                            accessibilityName: member.displayNickname
                        )
                        Text(member.displayNickname)
                            .font(.caption)
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                }

                if canManageMembers {
                    Button(action: onAdd) {
                        VStack(spacing: 6) {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(
                                    AppColors.tertiaryText,
                                    style: StrokeStyle(lineWidth: 1, dash: [5, 4])
                                )
                                .frame(width: 48, height: 48)
                                .overlay {
                                    Image(systemName: "plus")
                                        .font(.title3)
                                        .foregroundColor(AppColors.secondaryText)
                                }
                            Text(L10n.tr("group.members.addShort"))
                                .font(.caption)
                                .foregroundColor(AppColors.secondaryText)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.tr("group.addMembers"))
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)

            Button(action: onMore) {
                HStack(spacing: 6) {
                    Text(L10n.tr("group.members.more"))
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                }
                .font(.body)
                .foregroundColor(AppColors.secondaryText)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            .buttonStyle(.plain)
        }
        .background(AppColors.background)
    }
}

private struct GroupRoleBadge: View {
    let role: String

    var body: some View {
        let normalized = role.lowercased()
        if normalized == "owner" || normalized == "admin" {
            Text(normalized == "owner" ? L10n.tr("group.role.owner") : L10n.tr("group.role.admin"))
                .font(.caption2.weight(.semibold))
                .foregroundColor(normalized == "owner" ? .white : AppColors.accent)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(normalized == "owner" ? AppColors.accent : AppColors.accentLight)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        }
    }
}

struct GroupMembersView: View {
    let groupID: Int
    let initialMembers: [GroupMember]
    let capabilities: GroupCapabilities
    let onChanged: () -> Void

    @EnvironmentObject private var navigator: UIKitNavigator
    @State private var members: [GroupMember]
    @State private var query = ""
    @State private var showAddMembers = false
    @State private var memberToRemove: GroupMember?
    @State private var errorMessage: String?
    @State private var isProcessing = false

    init(
        groupID: Int,
        members: [GroupMember],
        capabilities: GroupCapabilities,
        onChanged: @escaping () -> Void
    ) {
        self.groupID = groupID
        self.initialMembers = members
        self.capabilities = capabilities
        self.onChanged = onChanged
        _members = State(initialValue: members)
    }

    private var filteredMembers: [GroupMember] {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return members }
        return members.filter {
            $0.displayNickname.localizedCaseInsensitiveContains(value)
                || $0.nickname.localizedCaseInsensitiveContains(value)
                || $0.userID.localizedCaseInsensitiveContains(value)
        }
    }

    var body: some View {
        List(filteredMembers) { member in
            HStack(spacing: 12) {
                UserAvatarButton(
                    userID: member.userID,
                    avatarURL: member.avatarURL,
                    size: 44,
                    accessibilityName: member.displayNickname
                )
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(member.displayNickname)
                            .font(.body)
                            .foregroundColor(AppColors.primaryText)
                            .lineLimit(1)
                        GroupRoleBadge(role: member.role)
                    }
                    if member.displayNickname != member.nickname && !member.nickname.isBlank {
                        Text(member.nickname)
                            .font(.caption)
                            .foregroundColor(AppColors.secondaryText)
                    }
                }
                Spacer()
                if canRemove(member) {
                    Button {
                        memberToRemove = member
                    } label: {
                        Image(systemName: "minus.circle")
                            .foregroundColor(AppColors.errorColor)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(L10n.tr("group.removeMember.title"))
                }
            }
        }
        .listStyle(.plain)
        .searchable(text: $query, prompt: L10n.tr("group.members.search"))
        .navigationTitle(L10n.tr("group.info.title.count", members.count))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            if capabilities.canManageMembers {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showAddMembers = true } label: { Image(systemName: "person.badge.plus") }
                        .accessibilityLabel(L10n.tr("group.addMembers"))
                }
            }
        }
        .sheet(isPresented: $showAddMembers) {
            AddGroupMembersView(groupID: groupID) {
                Task { await reloadMembers() }
            }
        }
        .alert(L10n.tr("group.removeMember.title"), isPresented: Binding(
            get: { memberToRemove != nil },
            set: { if !$0 { memberToRemove = nil } }
        )) {
            Button(L10n.tr("common.cancel"), role: .cancel) { memberToRemove = nil }
            Button(L10n.tr("group.removeMember.confirm"), role: .destructive) {
                guard let member = memberToRemove else { return }
                Task { await remove(member) }
            }
        } message: {
            Text(L10n.tr("group.removeMember.message", memberToRemove?.displayNickname ?? ""))
        }
        .alert(L10n.tr("common.error"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(L10n.tr("common.confirm"), role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
        .overlay { if isProcessing { ProgressView().tint(AppColors.accent) } }
    }

    private func canRemove(_ member: GroupMember) -> Bool {
        capabilities.canManageMembers
            && member.userID != AuthManager.shared.currentUser?.userID
            && member.role.lowercased() == "member"
    }

    private func reloadMembers() async {
        guard let detail = try? await APIService.shared.getGroupDetail(groupID: groupID) else { return }
        members = detail.members
        onChanged()
    }

    private func remove(_ member: GroupMember) async {
        isProcessing = true
        defer { isProcessing = false }
        do {
            try await APIService.shared.removeGroupMember(groupID: groupID, userID: member.userID)
            members.removeAll { $0.id == member.id }
            memberToRemove = nil
            onChanged()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("group.removeFailed")
        }
    }
}

struct GroupTextSettingView: View {
    let title: String
    let prompt: String
    let initialValue: String
    let allowsEmpty: Bool
    let onSave: (String) async throws -> Void

    @EnvironmentObject private var navigator: UIKitNavigator
    @State private var value: String
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var isFocused: Bool

    init(
        title: String,
        prompt: String,
        initialValue: String,
        allowsEmpty: Bool,
        onSave: @escaping (String) async throws -> Void
    ) {
        self.title = title
        self.prompt = prompt
        self.initialValue = initialValue
        self.allowsEmpty = allowsEmpty
        self.onSave = onSave
        _value = State(initialValue: initialValue)
    }

    private var normalizedValue: String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        Form {
            TextField(prompt, text: $value)
                .focused($isFocused)
                .submitLabel(.done)
                .onSubmit { Task { await save() } }
            if allowsEmpty {
                Text(L10n.tr("group.textSetting.emptyHint"))
                    .font(.footnote)
                    .foregroundColor(AppColors.secondaryText)
            }
        }
        .scrollContentBackground(.hidden)
        .background(AppColors.secondaryBackground)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(L10n.tr("common.save")) { Task { await save() } }
                    .disabled(isSaving || (!allowsEmpty && normalizedValue.isEmpty))
            }
        }
        .disabled(isSaving)
        .overlay { if isSaving { ProgressView().tint(AppColors.accent) } }
        .onAppear { isFocused = true }
        .alert(L10n.tr("common.error"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(L10n.tr("common.confirm"), role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    private func save() async {
        guard allowsEmpty || !normalizedValue.isEmpty, !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await onSave(normalizedValue)
            navigator.pop()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }
}

struct GroupAnnouncementView: View {
    let groupID: Int
    let announcement: GroupAnnouncement?
    let canEdit: Bool
    let onSaved: (GroupAnnouncement) -> Void

    @EnvironmentObject private var navigator: UIKitNavigator
    @State private var titleText: String
    @State private var contentText: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        groupID: Int,
        announcement: GroupAnnouncement?,
        canEdit: Bool,
        onSaved: @escaping (GroupAnnouncement) -> Void
    ) {
        self.groupID = groupID
        self.announcement = announcement
        self.canEdit = canEdit
        self.onSaved = onSaved
        _titleText = State(initialValue: announcement?.title ?? "")
        _contentText = State(initialValue: announcement?.content ?? "")
    }

    var body: some View {
        Group {
            if canEdit {
                Form {
                    Section(L10n.tr("group.announcement.titleField")) {
                        TextField(L10n.tr("group.announcement.titlePlaceholder"), text: $titleText)
                    }
                    Section(L10n.tr("group.announcement.contentField")) {
                        TextEditor(text: $contentText)
                            .frame(minHeight: 180)
                    }
                    if let announcement, let updatedAt = announcement.updatedAt {
                        Section {
                            Text(L10n.tr(
                                "group.announcement.updatedAt",
                                TimestampHelper.formatDetailedDateTime(updatedAt)
                            ))
                            .font(.footnote)
                            .foregroundColor(AppColors.secondaryText)
                        }
                    }
                }
                .scrollContentBackground(.hidden)
                .background(AppColors.secondaryBackground)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(titleText.isBlank ? L10n.tr("group.announcement.title") : titleText)
                            .font(.title3.weight(.semibold))
                        Text(contentText.isBlank ? L10n.tr("group.announcement.empty") : contentText)
                            .font(.body)
                            .foregroundColor(contentText.isBlank ? AppColors.secondaryText : AppColors.primaryText)
                            .textSelection(.enabled)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                }
                .background(AppColors.background)
            }
        }
        .navigationTitle(L10n.tr("group.announcement.title"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            if canEdit {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(L10n.tr("common.save")) { Task { await save() } }
                        .disabled(isSaving || contentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .disabled(isSaving)
        .overlay { if isSaving { ProgressView().tint(AppColors.accent) } }
        .alert(L10n.tr("common.error"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(L10n.tr("common.confirm"), role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let updated = try await APIService.shared.updateGroupAnnouncement(
                groupID: groupID,
                title: titleText.trimmingCharacters(in: .whitespacesAndNewlines),
                content: contentText.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            onSaved(updated)
            navigator.pop()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }
}

struct GroupInviteView: View {
    let groupID: Int
    let groupName: String

    @State private var invite: GroupInvite?
    @State private var isWorking = false
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                Text(groupName)
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.center)

                if let invite, let image = qrImage(for: invite.inviteURL) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 260)
                        .padding(18)
                        .background(Color(.systemBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
                        .accessibilityLabel(L10n.tr("group.invite.qrAccessibility"))

                    Text(L10n.tr(
                        "group.invite.expires",
                        TimestampHelper.formatDetailedDateTime(invite.expiresAt)
                    ))
                    .font(.footnote)
                    .foregroundColor(AppColors.secondaryText)

                    if let url = URL(string: invite.inviteURL) {
                        ShareLink(item: url) {
                            Label(L10n.tr("group.invite.share"), systemImage: "square.and.arrow.up")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                    }

                    Button(L10n.tr("group.invite.revoke"), role: .destructive) {
                        Task { await revoke(invite) }
                    }
                    .buttonStyle(.bordered)
                } else {
                    Image(systemName: "qrcode")
                        .font(.system(size: 80, weight: .light))
                        .foregroundColor(AppColors.secondaryText)
                    Text(L10n.tr("group.invite.validityHint"))
                        .font(.body)
                        .foregroundColor(AppColors.secondaryText)
                        .multilineTextAlignment(.center)
                    Button {
                        Task { await generate() }
                    } label: {
                        Label(L10n.tr("group.invite.generate"), systemImage: "qrcode")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
            }
            .frame(maxWidth: 420)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("group.invite.title"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .tint(AppColors.accent)
        .disabled(isWorking)
        .overlay { if isWorking { ProgressView().tint(AppColors.accent) } }
        .alert(L10n.tr("common.error"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(L10n.tr("common.confirm"), role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    private func generate() async {
        isWorking = true
        defer { isWorking = false }
        do {
            invite = try await APIService.shared.createGroupInvite(groupID: groupID)
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }

    private func revoke(_ invite: GroupInvite) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await APIService.shared.revokeGroupInvite(groupID: groupID, inviteID: invite.inviteID)
            self.invite = nil
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }

    private func qrImage(for value: String) -> UIImage? {
        guard let data = value.data(using: .utf8), !value.isBlank else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = data
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 12, y: 12)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

private enum GroupSearchMessageType: String, CaseIterable, Identifiable {
    case all = ""
    case text
    case image
    case video
    case voice
    case sticker
    case gift
    case file
    case system

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return L10n.tr("group.search.type.all")
        case .text: return L10n.tr("group.search.type.text")
        case .image: return L10n.tr("message.image")
        case .video: return L10n.tr("message.video")
        case .voice: return L10n.tr("message.voice")
        case .sticker: return L10n.tr("message.sticker")
        case .gift: return L10n.tr("gift.title")
        case .file: return L10n.tr("group.search.type.file")
        case .system: return L10n.tr("group.search.type.system")
        }
    }
}

private struct GroupSearchRequestKey: Hashable {
    let query: String
    let senderID: String
    let messageType: String
    let usesDateRange: Bool
    let from: Date
    let to: Date
}

struct GroupMessageSearchView: View {
    let groupID: Int
    let members: [GroupMember]
    let onSelect: (Int) -> Void

    @State private var query = ""
    @State private var selectedSenderID = ""
    @State private var selectedType = GroupSearchMessageType.all
    @State private var usesDateRange = false
    @State private var fromDate = Calendar.current.date(byAdding: .month, value: -1, to: Date()) ?? Date()
    @State private var toDate = Date()
    @State private var results: [GroupMessageSearchResult] = []
    @State private var nextCursor: String?
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var showFilters = false
    @State private var errorMessage: String?

    private var requestKey: GroupSearchRequestKey {
        GroupSearchRequestKey(
            query: query.trimmingCharacters(in: .whitespacesAndNewlines),
            senderID: selectedSenderID,
            messageType: selectedType.rawValue,
            usesDateRange: usesDateRange,
            from: fromDate,
            to: toDate
        )
    }

    private var hasSearchInput: Bool {
        !requestKey.query.isEmpty
            || !selectedSenderID.isEmpty
            || selectedType != .all
            || usesDateRange
    }

    var body: some View {
        List {
            if isLoading {
                HStack { Spacer(); ProgressView().tint(AppColors.accent); Spacer() }
                    .listRowSeparator(.hidden)
            } else if !hasSearchInput {
                GroupSearchPlaceholder(
                    systemImage: "magnifyingglass",
                    text: L10n.tr("group.search.startHint")
                )
            } else if results.isEmpty {
                GroupSearchPlaceholder(
                    systemImage: "text.magnifyingglass",
                    text: L10n.tr("group.search.noResults")
                )
            } else {
                ForEach(results) { result in
                    Button { onSelect(result.locator.messageID) } label: {
                        GroupMessageSearchRow(result: result)
                    }
                    .buttonStyle(.plain)
                    .onAppear {
                        if result.id == results.last?.id {
                            Task { await loadMore() }
                        }
                    }
                }
                if isLoadingMore {
                    HStack { Spacer(); ProgressView().tint(AppColors.accent); Spacer() }
                        .listRowSeparator(.hidden)
                }
            }
        }
        .listStyle(.plain)
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: L10n.tr("group.search.prompt")
        )
        .navigationTitle(L10n.tr("group.search.title"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showFilters = true } label: {
                    Image(systemName: hasActiveFilters ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel(L10n.tr("group.search.filters"))
            }
        }
        .sheet(isPresented: $showFilters) {
            GroupMessageSearchFiltersView(
                members: members,
                selectedSenderID: $selectedSenderID,
                selectedType: $selectedType,
                usesDateRange: $usesDateRange,
                fromDate: $fromDate,
                toDate: $toDate
            )
        }
        .task(id: requestKey) {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await search()
        }
        .alert(L10n.tr("common.error"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(L10n.tr("common.confirm"), role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    private var hasActiveFilters: Bool {
        !selectedSenderID.isEmpty || selectedType != .all || usesDateRange
    }

    private func search() async {
        guard hasSearchInput else {
            results = []
            nextCursor = nil
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await APIService.shared.searchGroupMessages(
                groupID: groupID,
                query: requestKey.query,
                senderID: selectedSenderID.isEmpty ? nil : selectedSenderID,
                messageType: selectedType == .all ? nil : selectedType.rawValue,
                from: usesDateRange ? min(fromDate, toDate) : nil,
                to: usesDateRange ? max(fromDate, toDate) : nil
            )
            guard !Task.isCancelled else { return }
            results = page.results
            nextCursor = page.hasMore ? page.nextCursor : nil
        } catch is CancellationError {
            return
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }

    private func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await APIService.shared.searchGroupMessages(
                groupID: groupID,
                query: requestKey.query,
                senderID: selectedSenderID.isEmpty ? nil : selectedSenderID,
                messageType: selectedType == .all ? nil : selectedType.rawValue,
                from: usesDateRange ? min(fromDate, toDate) : nil,
                to: usesDateRange ? max(fromDate, toDate) : nil,
                cursor: cursor
            )
            var seen = Set(results.map(\.id))
            results.append(contentsOf: page.results.filter { seen.insert($0.id).inserted })
            nextCursor = page.hasMore ? page.nextCursor : nil
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }
}

private struct GroupSearchPlaceholder: View {
    let systemImage: String
    let text: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.title)
                .foregroundColor(AppColors.tertiaryText)
            Text(text)
                .font(.body)
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 70)
        .listRowSeparator(.hidden)
    }
}

private struct GroupMessageSearchRow: View {
    let result: GroupMessageSearchResult

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(url: result.message.senderAvatar, size: 42)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(result.message.senderNickname)
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(AppColors.primaryText)
                    Spacer()
                    Text(TimestampHelper.formatDetailedDateTime(result.message.timestamp))
                        .font(.caption)
                        .foregroundColor(AppColors.tertiaryText)
                }
                Text(previewText)
                    .font(.body)
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(3)
            }
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundColor(AppColors.tertiaryText)
                .padding(.top, 4)
        }
        .contentShape(Rectangle())
    }

    private var previewText: String {
        if let highlighted = result.highlightedText, !highlighted.isBlank { return highlighted }
        if result.message.isImage { return L10n.tr("message.image") }
        if result.message.isVideo { return L10n.tr("message.video") }
        if result.message.isVoice { return L10n.tr("message.voice") }
        if result.message.isSticker { return L10n.tr("message.sticker") }
        return result.message.content
    }
}

private struct GroupMessageSearchFiltersView: View {
    let members: [GroupMember]
    @Binding var selectedSenderID: String
    @Binding var selectedType: GroupSearchMessageType
    @Binding var usesDateRange: Bool
    @Binding var fromDate: Date
    @Binding var toDate: Date

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            Form {
                Section(L10n.tr("group.search.sender")) {
                    Picker(L10n.tr("group.search.sender"), selection: $selectedSenderID) {
                        Text(L10n.tr("group.search.sender.all")).tag("")
                        ForEach(members) { member in
                            Text(member.displayNickname).tag(member.userID)
                        }
                    }
                }
                Section(L10n.tr("group.search.type")) {
                    Picker(L10n.tr("group.search.type"), selection: $selectedType) {
                        ForEach(GroupSearchMessageType.allCases) { type in
                            Text(type.title).tag(type)
                        }
                    }
                }
                Section {
                    Toggle(L10n.tr("group.search.dateRange"), isOn: $usesDateRange)
                        .tint(AppColors.accent)
                    if usesDateRange {
                        DatePicker(L10n.tr("group.search.from"), selection: $fromDate, displayedComponents: .date)
                        DatePicker(L10n.tr("group.search.to"), selection: $toDate, displayedComponents: .date)
                    }
                }
                Section {
                    Button(L10n.tr("group.search.reset"), role: .destructive) {
                        selectedSenderID = ""
                        selectedType = .all
                        usesDateRange = false
                    }
                }
            }
            .navigationTitle(L10n.tr("group.search.filters"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.tr("common.done")) { dismiss() }
                }
            }
        }
    }
}

private enum GroupReportReason: String, CaseIterable, Identifiable {
    case spam
    case fraud
    case harassment
    case inappropriate
    case other

    var id: String { rawValue }
    var title: String { L10n.tr("group.report.reason.\(rawValue)") }
}

struct GroupReportView: View {
    let groupID: Int

    @EnvironmentObject private var navigator: UIKitNavigator
    @State private var reason = GroupReportReason.spam
    @State private var detailText = ""
    @State private var isSubmitting = false
    @State private var showSuccess = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section(L10n.tr("group.report.reason")) {
                Picker(L10n.tr("group.report.reason"), selection: $reason) {
                    ForEach(GroupReportReason.allCases) { reason in
                        Text(reason.title).tag(reason)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }

            Section {
                TextEditor(text: $detailText)
                    .frame(minHeight: 130)
            } header: {
                Text(L10n.tr("group.report.detail"))
            } footer: {
                Text(L10n.tr("group.report.privacyHint"))
            }

            Section {
                Button {
                    Task { await submit() }
                } label: {
                    Text(L10n.tr("group.report.submit"))
                        .frame(maxWidth: .infinity)
                }
                .disabled(isSubmitting)
            }
        }
        .scrollContentBackground(.hidden)
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("group.report.title"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .disabled(isSubmitting)
        .overlay { if isSubmitting { ProgressView().tint(AppColors.accent) } }
        .alert(L10n.tr("group.report.success"), isPresented: $showSuccess) {
            Button(L10n.tr("common.confirm")) { navigator.pop() }
        }
        .alert(L10n.tr("common.error"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(L10n.tr("common.confirm"), role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    private func submit() async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await APIService.shared.reportGroup(
                groupID: groupID,
                reason: reason.rawValue,
                detail: detailText.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            showSuccess = true
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }
}

struct GroupInvitePreviewView: View {
    let token: String

    @EnvironmentObject private var navigator: UIKitNavigator
    @State private var preview: GroupInvitePreview?
    @State private var isLoading = true
    @State private var isJoining = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            if isLoading {
                ProgressView().tint(AppColors.accent)
            } else if let preview {
                AvatarView(url: preview.avatarURL, size: 88)
                Text(preview.groupName)
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                Text(L10n.tr("group.members.count", preview.memberCount))
                    .font(.body)
                    .foregroundColor(AppColors.secondaryText)
                if let inviter = preview.inviterNickname, !inviter.isBlank {
                    Text(L10n.tr("group.invite.invitedBy", inviter))
                        .font(.subheadline)
                        .foregroundColor(AppColors.secondaryText)
                }
                Text(L10n.tr(
                    "group.invite.expires",
                    TimestampHelper.formatDetailedDateTime(preview.expiresAt)
                ))
                .font(.footnote)
                .foregroundColor(AppColors.tertiaryText)

                Button {
                    Task { await joinOrOpen(preview) }
                } label: {
                    Text(preview.isMember ? L10n.tr("group.invite.openGroup") : L10n.tr("group.invite.join"))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(isJoining || (!preview.isMember && !preview.canJoin))
            }
            Spacer()
        }
        .frame(maxWidth: 420)
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("group.invite.previewTitle"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .tint(AppColors.accent)
        .task { await load() }
        .overlay { if isJoining { ProgressView().tint(AppColors.accent) } }
        .alert(L10n.tr("common.error"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(L10n.tr("common.confirm"), role: .cancel) {}
        } message: { Text(errorMessage ?? "") }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            preview = try await APIService.shared.getGroupInvitePreview(token: token)
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }

    private func joinOrOpen(_ preview: GroupInvitePreview) async {
        isJoining = true
        defer { isJoining = false }
        do {
            let groupID: Int
            if preview.isMember {
                groupID = preview.groupID
            } else {
                groupID = try await APIService.shared.acceptGroupInvite(token: token).groupID
            }
            let detail = try await APIService.shared.getGroupDetail(groupID: groupID)
            let group = ChatGroup(
                groupID: detail.groupID,
                name: detail.displayName,
                avatarURL: detail.avatarURL,
                creatorID: detail.creatorID,
                memberCount: detail.members.count,
                lastMessage: nil,
                lastMessageTime: nil,
                lastMessageSender: nil,
                unreadCount: 0,
                isPublic: detail.isPublic,
                isMuted: detail.notificationSettings.isMuted
            )
            navigator.push(GroupChatView(group: group))
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
        }
    }
}

struct GroupNotificationExceptionsView: View {
    let groupID: Int
    let members: [GroupMember]

    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var store = GroupNotificationSettingsStore.shared
    @State private var errorMessage: String?

    private var settings: GroupNotificationSettings {
        store.settings(for: groupID)
    }

    private var selectableMembers: [GroupMember] {
        let currentUserID = AuthManager.shared.currentUser?.userID
        var seen = Set<String>()
        return members.filter { member in
            member.userID != currentUserID && seen.insert(member.userID).inserted
        }
    }

    var body: some View {
        Form {
            Section {
                Toggle(
                    L10n.tr("group.notifications.mentionsMe"),
                    isOn: updateBinding(
                        get: { settings.notifyMentionsMe },
                        update: { try await store.update(groupID: groupID, notifyMentionsMe: $0) }
                    )
                )
                Toggle(
                    L10n.tr("group.notifications.mentionsAll"),
                    isOn: updateBinding(
                        get: { settings.notifyMentionsAll },
                        update: { try await store.update(groupID: groupID, notifyMentionsAll: $0) }
                    )
                )
            } footer: {
                Text(L10n.tr("group.notifications.description"))
            }

            Section {
                Button {
                    navigator.push(ImportantGroupMembersView(
                        groupID: groupID,
                        members: selectableMembers
                    ))
                } label: {
                    HStack {
                        Text(L10n.tr("group.notifications.importantMembers"))
                            .foregroundColor(AppColors.primaryText)
                        Spacer()
                        Text("\(settings.importantMemberIDs.count)/\(GroupNotificationSettings.importantMemberLimit)")
                            .foregroundColor(AppColors.secondaryText)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(AppColors.tertiaryText)
                    }
                }
            } footer: {
                Text(L10n.tr("group.notifications.limit"))
            }
        }
        .navigationTitle(L10n.tr("group.notifications.title"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .disabled(store.isUpdating(groupID: groupID))
        .overlay {
            if store.isUpdating(groupID: groupID) {
                ProgressView().tint(AppColors.accent)
            }
        }
        .task {
            let validIDs = Set(selectableMembers.map(\.userID))
            do {
                let loaded = try await store.load(groupID: groupID)
                let cleaned = loaded.retainingValidMembers(validIDs)
                if cleaned.importantMemberIDs != loaded.importantMemberIDs {
                    try await store.update(
                        groupID: groupID,
                        importantMemberIDs: cleaned.importantMemberIDs
                    )
                }
            } catch {
                errorMessage = L10n.tr("group.notifications.loadFailed")
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

    private func updateBinding(
        get: @escaping () -> Bool,
        update: @escaping (Bool) async throws -> Void
    ) -> Binding<Bool> {
        Binding(
            get: get,
            set: { newValue in
                Task {
                    do {
                        try await update(newValue)
                    } catch {
                        errorMessage = L10n.tr("group.notifications.updateFailed")
                    }
                }
            }
        )
    }
}

struct ImportantGroupMembersView: View {
    let groupID: Int
    let members: [GroupMember]

    @ObservedObject private var store = GroupNotificationSettingsStore.shared
    @State private var query = ""
    @State private var errorMessage: String?

    private var selectedIDs: [String] {
        store.settings(for: groupID).importantMemberIDs
    }

    private var filteredMembers: [GroupMember] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return members
        }
        return members.filter {
            $0.nickname.localizedCaseInsensitiveContains(query)
                || $0.userID.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        List {
            if selectedIDs.count >= GroupNotificationSettings.importantMemberLimit {
                Text(L10n.tr("group.notifications.limit"))
                    .font(.footnote)
                    .foregroundColor(AppColors.secondaryText)
            }

            ForEach(filteredMembers) { member in
                let isSelected = selectedIDs.contains(member.userID)
                let reachedLimit = selectedIDs.count >= GroupNotificationSettings.importantMemberLimit
                Button {
                    Task { await toggle(member.userID) }
                } label: {
                    HStack(spacing: 12) {
                        AvatarView(url: member.avatarURL, size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(member.nickname)
                                .foregroundColor(AppColors.primaryText)
                            Text(member.userID)
                                .font(.caption)
                                .foregroundColor(AppColors.tertiaryText)
                        }
                        Spacer()
                        if isSelected {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(AppColors.accent)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .disabled(store.isUpdating(groupID: groupID) || (reachedLimit && !isSelected))
            }
        }
        .searchable(text: $query, prompt: L10n.tr("group.notifications.search"))
        .navigationTitle(L10n.tr("group.notifications.importantMembers"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .alert(L10n.tr("common.error"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(L10n.tr("common.confirm"), role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func toggle(_ userID: String) async {
        var next = selectedIDs
        if let index = next.firstIndex(of: userID) {
            next.remove(at: index)
        } else {
            guard next.count < GroupNotificationSettings.importantMemberLimit else { return }
            next.append(userID)
        }
        do {
            try await store.update(groupID: groupID, importantMemberIDs: next)
        } catch {
            errorMessage = L10n.tr("group.notifications.updateFailed")
        }
    }
}
