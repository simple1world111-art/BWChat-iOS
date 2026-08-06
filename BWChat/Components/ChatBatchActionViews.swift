import SwiftUI

struct ForwardBundleMessageCard: View {
    let payload: ForwardBundleMessagePayload
    let isFromMe: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .foregroundColor(AppColors.accent)
                    Text(payload.title)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(1)
                }
                Text(payload.summary)
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(3)
                Divider()
                Text(L10n.tr("forward.chatRecordCount", payload.itemCount))
                    .font(.caption)
                    .foregroundColor(AppColors.tertiaryText)
            }
            .padding(12)
            .frame(width: 230, alignment: .leading)
            .background(isFromMe ? Color.white.opacity(0.96) : AppColors.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(payload.title)，\(payload.itemCount)")
    }
}

struct ForwardFlowView: View {
    let mode: ForwardMode
    let sources: [ForwardMessageSource]
    let preview: String
    let onCompleted: () -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var contactsViewModel = ContactsViewModel()
    @StateObject private var groupsViewModel = GroupsViewModel()
    @State private var query = ""
    @State private var isMultiTarget = false
    @State private var selectedTargets: Set<ForwardTarget> = []
    @State private var confirmationTargets: [ForwardTarget] = []
    @State private var isSending = false
    @State private var errorMessage: String?

    private var allTargets: [ForwardTarget] {
        let direct = contactsViewModel.contacts.map {
            ForwardTarget(conversationType: .dm, conversationID: $0.userID, displayName: $0.nickname, avatarURL: $0.avatarURL)
        }
        let groups = groupsViewModel.groups.map {
            ForwardTarget(conversationType: .group, conversationID: String($0.groupID), displayName: $0.name, avatarURL: $0.avatarURL)
        }
        let combined = direct + groups
        guard !query.isBlank else { return combined }
        return combined.filter { $0.displayName.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if contactsViewModel.isLoading && groupsViewModel.isLoading && allTargets.isEmpty {
                    ProgressView()
                } else if let errorMessage, allTargets.isEmpty {
                    ChatUnavailableView(
                        title: L10n.tr("common.loadFailed"),
                        systemImage: "wifi.exclamationmark",
                        message: errorMessage,
                        actionTitle: L10n.tr("common.retry")
                    ) { Task { await loadTargets() } }
                } else if allTargets.isEmpty {
                    ChatUnavailableView(
                        title: L10n.tr("forward.chooseChat"),
                        systemImage: "magnifyingglass",
                        message: query
                    )
                } else {
                    List(allTargets) { target in
                        Button { select(target) } label: {
                            HStack(spacing: 12) {
                                targetAvatar(target)
                                Text(target.displayName)
                                    .foregroundColor(AppColors.primaryText)
                                Spacer()
                                if isMultiTarget {
                                    Image(systemName: selectedTargets.contains(target) ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 22))
                                        .foregroundColor(selectedTargets.contains(target) ? AppColors.accent : AppColors.tertiaryText)
                                }
                            }
                            .frame(minHeight: 52)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    .listStyle(.plain)
                }
            }
            .searchable(text: $query, prompt: L10n.tr("forward.searchChats"))
            .navigationTitle(L10n.tr("forward.chooseChat"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.tr("common.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isMultiTarget {
                        Button(L10n.tr("common.done")) { proceed(with: Array(selectedTargets)) }
                            .disabled(selectedTargets.isEmpty)
                    } else {
                        Button(L10n.tr("chat.action.multiSelect")) { isMultiTarget = true }
                    }
                }
            }
            .task { await loadTargets() }
            .alert(L10n.tr("common.error"), isPresented: Binding(
                get: { errorMessage != nil && !allTargets.isEmpty },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button(L10n.tr("common.ok"), role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .sheet(isPresented: Binding(
                get: { !confirmationTargets.isEmpty },
                set: { if !$0 { confirmationTargets = [] } }
            )) {
                ForwardConfirmationCard(
                    targets: confirmationTargets,
                    preview: preview,
                    isSending: isSending,
                    onCancel: { confirmationTargets = [] },
                    onSend: { Task { await submit() } }
                )
                .presentationDetents([.height(310)])
                .interactiveDismissDisabled(isSending)
            }
        }
    }

    @ViewBuilder
    private func targetAvatar(_ target: ForwardTarget) -> some View {
        if target.conversationType == .group {
            if let groupID = Int(target.conversationID) {
                GroupMemberAvatarView(groupID: groupID, size: 42)
            } else {
                GroupAvatarIcon(size: 42)
            }
        } else {
            AvatarView(url: target.avatarURL, size: 42)
        }
    }

    private func loadTargets() async {
        errorMessage = nil
        await contactsViewModel.loadContacts()
        await groupsViewModel.loadGroups(forceRefresh: true)
        errorMessage = contactsViewModel.errorMessage ?? groupsViewModel.errorMessage
    }

    private func select(_ target: ForwardTarget) {
        if isMultiTarget {
            if selectedTargets.remove(target) == nil {
                guard selectedTargets.count < 9 else {
                    errorMessage = L10n.tr("forward.maximum9")
                    return
                }
                selectedTargets.insert(target)
            }
        } else {
            proceed(with: [target])
        }
    }

    private func proceed(with targets: [ForwardTarget]) {
        guard !targets.isEmpty else { return }
        confirmationTargets = targets.sorted { $0.displayName.localizedCompare($1.displayName) == .orderedAscending }
    }

    private func submit() async {
        guard !confirmationTargets.isEmpty, !isSending else { return }
        isSending = true
        defer { isSending = false }
        do {
            _ = try await APIService.shared.forwardMessages(ForwardRequest(
                clientOperationID: UUID(),
                mode: mode,
                sources: sources,
                targets: confirmationTargets
            ))
            confirmationTargets = []
            onCompleted()
            dismiss()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? L10n.tr("messages.sendFailed")
            confirmationTargets = []
        }
    }
}

private struct ForwardConfirmationCard: View {
    let targets: [ForwardTarget]
    let preview: String
    let isSending: Bool
    let onCancel: () -> Void
    let onSend: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Capsule().fill(AppColors.separator).frame(width: 36, height: 5).padding(.top, 8)
            Text(targets.map(\.displayName).joined(separator: "、"))
                .font(.system(size: 16, weight: .semibold))
                .lineLimit(2)
            Text(preview)
                .font(.system(size: 14))
                .foregroundColor(AppColors.secondaryText)
                .lineLimit(3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(AppColors.secondaryBackground)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            HStack(spacing: 12) {
                Button(L10n.tr("common.cancel"), action: onCancel)
                    .buttonStyle(.bordered)
                    .disabled(isSending)
                Button(action: onSend) {
                    if isSending { ProgressView().tint(.white) } else { Text(L10n.tr("common.send")) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSending)
            }
        }
        .padding(.horizontal, 20)
    }
}

struct ForwardBundleDetailView: View {
    let bundleID: String
    @State private var bundle: ForwardBundle?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let bundle {
                List(bundle.items) { item in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text(item.senderName).font(.system(size: 14, weight: .semibold))
                            Spacer()
                            Text(TimestampHelper.formatTime(item.sentAt))
                                .font(.caption)
                                .foregroundColor(AppColors.tertiaryText)
                        }
                        Text(item.messageType == "voice" ? L10n.tr("message.voice") : item.summary)
                            .foregroundColor(AppColors.primaryText)
                    }
                    .padding(.vertical, 4)
                }
                .navigationTitle(bundle.title)
            } else if let errorMessage {
                ChatUnavailableView(
                    title: L10n.tr("common.loadFailed"),
                    systemImage: "exclamationmark.triangle",
                    message: errorMessage,
                    actionTitle: L10n.tr("common.retry")
                ) { Task { await load() } }
            } else {
                ProgressView()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        errorMessage = nil
        do { bundle = try await APIService.shared.getForwardBundle(bundleID: bundleID) }
        catch { errorMessage = (error as? LocalizedError)?.errorDescription ?? L10n.tr("common.loadFailed") }
    }
}

private struct ChatUnavailableView: View {
    let title: String
    let systemImage: String
    var message: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .medium))
                .foregroundColor(AppColors.tertiaryText)
            Text(title).font(.headline)
            if let message, !message.isBlank {
                Text(message)
                    .font(.subheadline)
                    .foregroundColor(AppColors.secondaryText)
                    .multilineTextAlignment(.center)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action).buttonStyle(.borderedProminent)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
