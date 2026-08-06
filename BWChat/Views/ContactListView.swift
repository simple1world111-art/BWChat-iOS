import SwiftUI
import UIKit

enum ConversationPreviewFormatter {
    @MainActor
    static func text(for content: String) -> String {
        if let stickerPreview = StickerMessagePayload.previewText(content: content) {
            return stickerPreview
        }
        if let moneyPreview = ChatMoneyPreview.text(
            content: content,
            msgType: nil,
            viewerID: AuthManager.shared.currentUser?.userID
        ) {
            return moneyPreview
        }
        return content
    }

    static func senderPrefix(_ sender: String?, content: String) -> String? {
        guard let sender else { return nil }
        let trimmed = sender.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let unavailableNames = ["未知", "unknown", "null", "nil"]
        guard !unavailableNames.contains(trimmed.lowercased()) else { return nil }
        guard !ChatMoneyPreview.isReceipt(content: content, msgType: nil) else { return nil }
        guard !ChatMoneyPreview.isReceiptDisplayText(content) else { return nil }
        return trimmed
    }
}

struct ContactListView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel = ConversationListViewModel()
    @ObservedObject private var authManager = AuthManager.shared
    @ObservedObject private var messageSyncCoordinator = AppMessageSyncCoordinator.shared
    @ObservedObject private var groupInviteRouteStore = GroupInviteRouteStore.shared
    @State private var showCreateGroup = false
    @State private var showAddFriendSheet = false
    @State private var showScannerComingSoon = false
    @State private var showMessageActions = false
    @State private var pendingMessageAction: MessageAction?
    @State private var pendingConversationDeletion: Conversation?
    @State private var initialLoadUserID: String?
    @State private var initialLoadInFlightUserID: String?
    @State private var openSwipeActionID: ConversationSwipeActionID?
    @State private var searchText = ""
    @State private var openingAgentConversationKey: String?
    @State private var agentOpenError: String?
    @FocusState private var isSearchFocused: Bool

    private var trimmedSearchText: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isSearchingConversations: Bool {
        !trimmedSearchText.isEmpty
    }

    private var visibleConversations: [Conversation] {
        guard isSearchingConversations else { return viewModel.conversations }
        return viewModel.conversations.filter { matchesSearch($0, query: trimmedSearchText) }
    }

    private var showsNoSearchResults: Bool {
        isSearchingConversations
            && visibleConversations.isEmpty
    }

    var body: some View {
        Group {
            if viewModel.conversations.isEmpty && !viewModel.isLoading {
                emptyStateView
            } else {
                conversationListView
            }
        }
        .background(AppColors.secondaryBackground)
        .background(
            KeyboardDismissTapInstaller(
                isEnabled: isSearchFocused,
                consumesOutsideTaps: true,
                onBackgroundTap: dismissMessageInputState
            )
        )
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $showAddFriendSheet) {
            AddFriendView()
        }
        .alert(L10n.tr("messages.scan"), isPresented: $showScannerComingSoon) {
            Button(L10n.tr("common.ok"), role: .cancel) {}
        } message: {
            Text(L10n.tr("common.comingSoonMessage"))
        }
        .alert(
            L10n.tr("messages.deleteConversation.confirmTitle"),
            isPresented: Binding(
                get: { pendingConversationDeletion != nil },
                set: { if !$0 { pendingConversationDeletion = nil } }
            ),
            presenting: pendingConversationDeletion
        ) { conversation in
            Button(L10n.tr("common.cancel"), role: .cancel) {
                pendingConversationDeletion = nil
            }
            Button(L10n.tr("common.delete"), role: .destructive) {
                pendingConversationDeletion = nil
                Task {
                    guard await viewModel.deleteConversationAndHistory(conversation) else { return }
                    // The row has already left the list. Clear the shared swipe
                    // identity afterwards so no close animation competes with
                    // the alert transition or flashes on the remaining rows.
                    await Task.yield()
                    openSwipeActionID = nil
                }
            }
        } message: { conversation in
            Text(deletionWarning(for: conversation))
        }
        .alert("无法打开智能体", isPresented: Binding(
            get: { agentOpenError != nil },
            set: { if !$0 { agentOpenError = nil } }
        )) {
            Button(L10n.tr("common.ok"), role: .cancel) { agentOpenError = nil }
        } message: {
            Text(agentOpenError ?? "请稍后重试")
        }
        .refreshable {
            closeOpenSwipeAction()
            await viewModel.loadConversations(forceRefresh: true)
        }
        .sheet(isPresented: $showCreateGroup) {
            CreateGroupView {
                Task { await viewModel.loadConversations() }
            }
        }
        .toast(message: $viewModel.errorMessage)
        .task(id: AuthManager.shared.currentUser?.userID ?? "") {
            await loadInitialContentIfNeeded()
        }
        .onDisappear {
            dismissMessageInputState()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openChat"))) { notif in
            guard let senderID = Self.stringValue(notif.userInfo?["sender_id"]) else { return }
            navigator.popToRoot()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                if let conv = viewModel.conversations.first(where: { $0.isDM && $0.id == senderID }) {
                    openConversation(conv)
                } else {
                    let user = UserCacheManager.shared.getUser(senderID)
                    let conv = Conversation(
                        type: "dm",
                        id: senderID,
                        name: user?.nickname ?? senderID,
                        avatarURL: user?.avatarURL ?? "",
                        lastMessage: nil,
                        lastMessageTime: nil,
                        unreadCount: 0,
                        subtitle: nil,
                        groupID: nil,
                        memberCount: nil
                    )
                    openConversation(conv)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .pushLivePairChat)) { notification in
            guard let contact = notification.object as? Contact else { return }
            viewModel.ensureLivePairConversation(for: contact)
            navigator.popToRoot()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
                navigator.push(ChatView(contact: contact))
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openGroupChat"))) { notif in
            guard let groupID = Self.intValue(notif.userInfo?["group_id"]) else { return }
            navigator.popToRoot()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                if let conv = viewModel.conversations.first(where: { $0.groupID == groupID }) {
                    openConversation(conv)
                }
            }
        }
        .onReceive(groupInviteRouteStore.$pendingToken.compactMap { $0 }) { token in
            guard AppRemoteConfigStore.shared.featureFlags.isEnabled(
                "group_info_v2",
                default: true
            ), AppRemoteConfigStore.shared.featureFlags.isEnabled(
                "group_invite_qr_v1",
                default: false
            ) else {
                groupInviteRouteStore.clear(token)
                return
            }
            navigator.popToRoot()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                navigator.push(GroupInvitePreviewView(token: token))
                groupInviteRouteStore.clear(token)
            }
        }
        .onReceive(messageSyncCoordinator.$pendingRoute.compactMap { $0 }) { route in
            openNotificationRoute(route)
        }
    }

    /// Push directly into the right concrete destination view. Earlier we
    /// funneled this through a `@ViewBuilder` helper returning `some View`,
    /// but the resulting `_ConditionalContent` wrapper + environmentObject
    /// injection inside `UIKitNavigator.push` produced an intermittent
    /// breakage where DM rows wouldn't push (groups and bots still did).
    /// Calling `navigator.push` with a concrete `ChatView`/`GroupChatView`
    /// value side-steps the type-erasure mismatch.
    private func openConversation(_ conv: Conversation) {
        closeOpenSwipeAction()
        if conv.isAgentConversation {
            openAgentConversation(conv)
        } else if conv.isScriptRoom, let roomID = conv.scriptRoomID {
            if let groupID = conv.resolvedGroupID {
                viewModel.markGroupAsRead(groupID: groupID)
            }
            let initialRoom = ScriptRoomLocalCache.cachedRoom(roomID: roomID)
                ?? ScriptRoom(provisionalConversationRow: conv)
            navigator.push(ScriptRoomChatView(roomID: roomID, initialRoom: initialRoom))
        } else if conv.isGroup, let gid = conv.resolvedGroupID {
            let group = ChatGroup(
                groupID: gid,
                name: conv.name,
                avatarURL: conv.avatarURL,
                creatorID: "",
                memberCount: conv.memberCount ?? 0,
                lastMessage: conv.lastMessage,
                lastMessageTime: conv.lastMessageTime,
                lastMessageSender: conv.subtitle,
                unreadCount: conv.unreadCount,
                isMuted: conv.isMuted
            )
            navigator.push(GroupChatView(group: group) { throughMessageID in
                viewModel.markGroupAsRead(
                    groupID: gid,
                    throughMessageID: throughMessageID
                )
            })
        } else {
            let contact = Contact(
                userID: conv.id,
                nickname: conv.name,
                avatarURL: conv.avatarURL,
                lastMessage: conv.lastMessage,
                lastMessageTime: conv.lastMessageTime,
                unreadCount: conv.unreadCount
            )
            navigator.push(ChatView(contact: contact) { throughMessageID in
                viewModel.markAsRead(
                    conversationID: conv.id,
                    throughMessageID: throughMessageID
                )
            })
        }
    }

    private func openAgentConversation(_ row: Conversation) {
        let key = row.listIdentity
        guard openingAgentConversationKey != key else { return }
        openingAgentConversationKey = key

        Task {
            defer { openingAgentConversationKey = nil }
            do {
                let conversation: AgentConversation
                if let conversationID = row.agentConversationID, !conversationID.isBlank {
                    if let cached = AgentChatLocalCache.cachedConversation(id: conversationID)
                        ?? AgentConversation(cachedConversationRow: row) {
                        navigator.push(AgentChatView(conversation: cached))
                        Task {
                            guard let refreshed = try? await APIService.shared.getAgentConversation(
                                id: conversationID
                            ) else { return }
                            AgentChatLocalCache.saveConversation(refreshed)
                        }
                        return
                    }
                    conversation = try await APIService.shared.getAgentConversation(id: conversationID)
                } else if let agentID = row.agentID, !agentID.isBlank {
                    conversation = try await APIService.shared.createAgentConversation(
                        agentID: agentID,
                        greetingID: row.agentGreetingID ?? "default",
                        idempotencyKey: UUID()
                    )
                    NotificationCenter.default.post(name: .conversationListNeedsReload, object: nil)
                } else {
                    throw APIError.serverError(code: 400, message: "智能体会话信息不完整")
                }

                AgentChatLocalCache.saveConversation(conversation)
                async let runtimeConfigRequest = try? APIService.shared.getAgentRuntimeConfig()
                async let walletRequest = try? APIService.shared.getWalletBalance()
                let runtimeConfig = await runtimeConfigRequest
                let wallet = await walletRequest
                navigator.push(AgentChatView(
                    conversation: conversation,
                    runtimeConfig: runtimeConfig,
                    spendableBalance: wallet?.spendableBalance
                ))
            } catch {
                agentOpenError = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func loadInitialContentIfNeeded() async {
        guard let userID = AuthManager.shared.currentUser?.userID, !userID.isEmpty else { return }
        guard initialLoadUserID != userID else { return }
        guard initialLoadInFlightUserID != userID else { return }
        initialLoadInFlightUserID = userID
        defer { initialLoadInFlightUserID = nil }

        await viewModel.loadConversations(
            forceRefresh: messageSyncCoordinator.needsSync
        )
        initialLoadUserID = userID
    }

    private func openNotificationRoute(_ route: NotificationRoute) {
        guard AuthManager.shared.currentUser != nil else { return }
        closeOpenSwipeAction()
        navigator.popToRoot()

        switch route.conversationType {
        case .direct:
            let existing = viewModel.conversations.first {
                $0.isDM && $0.id == route.conversationID
            }
            let cachedUser = UserCacheManager.shared.getUser(route.conversationID)
            let contact = Contact(
                userID: route.conversationID,
                nickname: existing?.name
                    ?? route.senderName
                    ?? cachedUser?.nickname
                    ?? route.conversationID,
                avatarURL: existing?.avatarURL
                    ?? route.senderAvatar
                    ?? cachedUser?.avatarURL
                    ?? "",
                lastMessage: existing?.lastMessage ?? route.contentPreview,
                lastMessageTime: existing?.lastMessageTime ?? route.sentAt,
                unreadCount: route.unreadCount ?? existing?.unreadCount ?? 0
            )
            Task { @MainActor in
                await Task.yield()
                navigator.push(ChatView(
                    contact: contact,
                    initialReadThroughMessageID: route.messageID
                ))
                messageSyncCoordinator.consume(route)
            }

        case .group:
            guard let groupID = route.groupID ?? Int(route.conversationID) else { return }
            let existing = viewModel.conversations.first {
                $0.isGroup && $0.resolvedGroupID == groupID
            }
            if let existing {
                pushNotificationGroup(
                    route: route,
                    group: ChatGroup(
                        groupID: groupID,
                        name: existing.name,
                        avatarURL: existing.avatarURL,
                        creatorID: "",
                        memberCount: existing.memberCount ?? 0,
                        lastMessage: existing.lastMessage,
                        lastMessageTime: existing.lastMessageTime,
                        lastMessageSender: existing.subtitle,
                        unreadCount: route.unreadCount ?? existing.unreadCount,
                        isMuted: existing.isMuted
                    )
                )
                return
            }

            // Open from push metadata immediately. GroupChatView fetches and
            // caches authoritative group details in parallel with its initial
            // message synchronization.
            pushNotificationGroup(
                route: route,
                group: ChatGroup(
                    groupID: groupID,
                    name: route.groupName ?? "群聊 \(groupID)",
                    avatarURL: route.groupAvatar ?? "",
                    creatorID: "",
                    memberCount: 0,
                    lastMessage: route.contentPreview,
                    lastMessageTime: route.sentAt,
                    lastMessageSender: route.senderName,
                    unreadCount: route.unreadCount ?? 0
                )
            )
        }
    }

    private func pushNotificationGroup(route: NotificationRoute, group: ChatGroup) {
        Task { @MainActor in
            await Task.yield()
            navigator.push(GroupChatView(
                group: group,
                initialReadThroughMessageID: route.messageID
            ))
            messageSyncCoordinator.consume(route)
        }
    }

    private func closeOpenSwipeAction() {
        guard openSwipeActionID != nil else { return }
        openSwipeActionID = nil
    }

    private func dismissSearchFocus() {
        if isSearchFocused {
            isSearchFocused = false
        }
        hideKeyboard()
    }

    private func dismissMessageInputState() {
        closeOpenSwipeAction()
        dismissSearchFocus()
    }

    private func consumeSearchDismissTapIfNeeded() -> Bool {
        guard isSearchFocused else { return false }
        dismissMessageInputState()
        return true
    }

    private static func stringValue(_ value: Any?) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) }
        return nil
    }

    private var conversationListView: some View {
        let conversations = visibleConversations

        return ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: 0) {
                messageHeader
                    .padding(.top, AppSpacing.rootTabTopInset)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                    .simultaneousGesture(TapGesture().onEnded(closeOpenSwipeAction))

                messageSearchBox
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)

                if showsNoSearchResults {
                    searchEmptyRow
                        .padding(.top, 28)
                        .padding(.horizontal, 16)
                }

                ForEach(conversations, id: \.listIdentity) { conv in
                    ConversationRow(
                        conversation: conv,
                        showsDivider: conv.listIdentity != conversations.last?.listIdentity,
                        isPinned: viewModel.isPinned(conv)
                    )
                    .padding(.horizontal, 16)
                    .wrappedInSwipeActions(
                        id: .conversation(conv.listIdentity),
                        openID: $openSwipeActionID,
                        isPinned: viewModel.isPinned(conv),
                        pinTitle: viewModel.isPinned(conv) ? L10n.tr("messages.unpin") : L10n.tr("messages.pin"),
                        accessibilityLabel: conv.name,
                        accessibilityIdentifier: "conversation.\(conv.listIdentity)",
                        onRequestClose: closeOpenSwipeAction,
                        onTap: {
                            guard !consumeSearchDismissTapIfNeeded() else { return }
                            openConversation(conv)
                        },
                        onPin: {
                            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                                viewModel.togglePinned(conv)
                            }
                        },
                        onDelete: {
                            pendingConversationDeletion = conv
                        }
                    )
                }

                // This is scrollable content, not an overlay or mask. Unlike a
                // transparent List row, ScrollView preserves its full height,
                // so the final card can always be pulled above the floating tab bar.
                Color.clear
                    .frame(height: AppListMetrics.rootTabBottomScrollableClearance)
                    .accessibilityHidden(true)
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            messageHeader
                .padding(.horizontal, 16)
                .padding(.top, AppSpacing.rootTabTopInset)

            messageSearchBox
                .padding(.horizontal, 16)

            Spacer()
            if let errorMessage = viewModel.errorMessage {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundColor(AppColors.warningColor)
                Text(errorMessage)
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.secondaryText)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
                Button(L10n.tr("common.retry")) {
                    Task { await viewModel.loadConversations(forceRefresh: true) }
                }
                .font(.system(size: 14, weight: .semibold))
                .buttonStyle(.borderedProminent)
                .tint(AppColors.accent)
            } else {
                ZStack {
                    Circle()
                        .fill(AppColors.accent.opacity(0.08))
                        .frame(width: 80, height: 80)
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.system(size: 32))
                        .foregroundColor(AppColors.accent.opacity(0.5))
                }
                Text(L10n.tr("messages.empty.title"))
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                Text(L10n.tr("messages.empty.subtitle"))
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.secondaryText)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var messageSearchBox: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)

            TextField(L10n.tr("messages.search.placeholder"), text: $searchText)
                .font(.system(size: 15))
                .foregroundColor(AppColors.primaryText)
                .focused($isSearchFocused)
                .submitLabel(.search)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .onSubmit {
                    dismissSearchFocus()
                }
                .onChange(of: searchText) { _ in
                    closeOpenSwipeAction()
                }

            if !searchText.isEmpty {
                Button {
                    searchText = ""
                    closeOpenSwipeAction()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(AppColors.tertiaryText)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr("common.cancel"))
            }
        }
        .padding(.horizontal, 13)
        .frame(maxWidth: .infinity, minHeight: 42)
        .background(AppColors.cardBackground)
        .cornerRadius(12)
        .contentShape(Rectangle())
        .onTapGesture {
            isSearchFocused = true
            closeOpenSwipeAction()
        }
    }

    private var searchEmptyRow: some View {
        VStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 28, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)
            Text(L10n.tr("messages.search.empty"))
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
    }

    private var messageHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            RootTabTitle(localizedKey: "tab.messages")
            messageActionsMenu
        }
        .frame(maxWidth: .infinity, minHeight: 36, alignment: .center)
    }

    private var messageActionsMenu: some View {
        Button {
            closeOpenSwipeAction()
            dismissSearchFocus()
            showMessageActions.toggle()
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(AppColors.primaryText)
                .frame(width: 40, height: 40)
                .background {
                    Circle()
                        .fill(.ultraThinMaterial)
                        .overlay {
                            Circle()
                                .fill(Color.white.opacity(0.52))
                        }
                }
                .overlay {
                    Circle()
                        .stroke(Color.white.opacity(0.72), lineWidth: 1)
                }
                .shadow(color: Color.black.opacity(0.08), radius: 5, x: 0, y: 2)
                .contentShape(Circle())
        }
        .frame(width: 44, height: 44)
        .buttonStyle(.plain)
        .popover(
            isPresented: $showMessageActions,
            attachmentAnchor: .rect(.bounds),
            arrowEdge: .top
        ) {
            if #available(iOS 16.4, *) {
                messageActionsPopover
                    .presentationCompactAdaptation(.popover)
                    .presentationBackground(.ultraThinMaterial)
            } else {
                messageActionsPopover
            }
        }
        .accessibilityLabel(L10n.tr("messages.moreActions"))
    }

    private var messageActionsPopover: some View {
        VStack(spacing: 0) {
            messageActionRow(
                title: L10n.tr("messages.startGroup"),
                systemImage: "bubble.left.and.bubble.right",
                action: .createGroup
            )
            menuDivider
            messageActionRow(
                title: L10n.tr("messages.addFriend"),
                systemImage: "person.badge.plus",
                action: .addFriend
            )
            menuDivider
            messageActionRow(
                title: L10n.tr("messages.scan"),
                systemImage: "qrcode.viewfinder",
                action: .scan
            )
            menuDivider
            messageActionRow(
                title: "创建智能体",
                systemImage: "person.crop.circle.badge.plus",
                action: .createAgent
            )
        }
        .frame(width: 210)
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
        .onDisappear(perform: performPendingMessageAction)
    }

    private var menuDivider: some View {
        Divider()
            .padding(.leading, 48)
    }

    private func messageActionRow(
        title: String,
        systemImage: String,
        action: MessageAction
    ) -> some View {
        Button {
            pendingMessageAction = action
            dismissMessageActions()
            closeOpenSwipeAction()
        } label: {
            HStack(spacing: 13) {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .regular))
                    .foregroundColor(AppColors.primaryText)
                    .frame(width: 22)

                Text(title)
                    .font(.system(size: 16))
                    .foregroundColor(AppColors.primaryText)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func dismissMessageActions() {
        showMessageActions = false
    }

    private func performPendingMessageAction() {
        guard let action = pendingMessageAction else { return }
        pendingMessageAction = nil

        DispatchQueue.main.async {
            switch action {
            case .createGroup:
                showCreateGroup = true
            case .addFriend:
                showAddFriendSheet = true
            case .scan:
                showScannerComingSoon = true
            case .createAgent:
                navigator.push(AgentCreatorView(mode: .create))
            }
        }
    }

    private func matchesSearch(_ conversation: Conversation, query: String) -> Bool {
        [
            conversation.name,
            conversation.subtitle,
            conversation.lastMessage.map(ConversationPreviewFormatter.text)
        ]
        .compactMap { $0 }
        .contains { $0.localizedCaseInsensitiveContains(query) }
    }

    private func deletionWarning(for conversation: Conversation) -> String {
        if conversation.isDM || conversation.isGroup {
            return L10n.tr("messages.deleteConversation.historyMessage")
        }
        return L10n.tr("messages.deleteConversation.listOnlyMessage")
    }

}

private enum MessageAction {
    case createGroup
    case addFriend
    case scan
    case createAgent
}

// MARK: - Chat list swipe container

private enum ConversationSwipeActionID: Hashable {
    case bot(String)
    case conversation(String)
}

private extension View {
    func wrappedInSwipeActions(
        id: ConversationSwipeActionID,
        openID: Binding<ConversationSwipeActionID?>,
        isPinned: Bool,
        pinTitle: String,
        accessibilityLabel: String,
        accessibilityIdentifier: String,
        onRequestClose: @escaping () -> Void,
        onTap: @escaping () -> Void,
        onPin: @escaping () -> Void,
        onDelete: @escaping () -> Void
    ) -> some View {
        SwipeableConversationCell(
            id: id,
            openID: openID,
            isPinned: isPinned,
            pinTitle: pinTitle,
            accessibilityLabel: accessibilityLabel,
            accessibilityIdentifier: accessibilityIdentifier,
            onRequestClose: onRequestClose,
            onTap: onTap,
            onPin: onPin,
            onDelete: onDelete
        ) {
            self
        }
    }
}

private struct SwipeableConversationCell<Content: View>: View {
    let id: ConversationSwipeActionID
    @Binding var openID: ConversationSwipeActionID?
    let isPinned: Bool
    let pinTitle: String
    let accessibilityLabel: String
    let accessibilityIdentifier: String
    let onRequestClose: () -> Void
    let onTap: () -> Void
    let onPin: () -> Void
    let onDelete: () -> Void

    private let content: Content
    private let actionWidth: CGFloat = 144
    private let actionHeight: CGFloat = AppListMetrics.conversationSwipeActionHeight
    private let actionDispatchDelay: TimeInterval = 0.16

    @State private var swipeOffset: CGFloat = 0
    @State private var dragStartOffset: CGFloat = 0
    @State private var isDragging = false

    init(
        id: ConversationSwipeActionID,
        openID: Binding<ConversationSwipeActionID?>,
        isPinned: Bool,
        pinTitle: String,
        accessibilityLabel: String,
        accessibilityIdentifier: String,
        onRequestClose: @escaping () -> Void,
        onTap: @escaping () -> Void,
        onPin: @escaping () -> Void,
        onDelete: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.id = id
        self._openID = openID
        self.isPinned = isPinned
        self.pinTitle = pinTitle
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityIdentifier = accessibilityIdentifier
        self.onRequestClose = onRequestClose
        self.onTap = onTap
        self.onPin = onPin
        self.onDelete = onDelete
        self.content = content()
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            actionButtons
                .frame(width: actionWidth, height: actionHeight)
                .allowsHitTesting(openID == id)

            content
                .background(AppColors.secondaryBackground)
                .contentShape(Rectangle())
                .overlay {
                    HorizontalSwipeGestureSurface(
                        accessibilityLabel: accessibilityLabel,
                        accessibilityIdentifier: accessibilityIdentifier,
                        onTap: handleContentTap,
                        onBegan: handleHorizontalPanBegan,
                        onChanged: handleHorizontalPanChanged,
                        onEnded: handleHorizontalPanEnded,
                        onCancelled: handleHorizontalPanCancelled
                    )
                }
                .offset(x: swipeOffset)
        }
        .clipped()
        .onAppear {
            var transaction = Transaction()
            transaction.animation = nil
            withTransaction(transaction) {
                swipeOffset = openID == id ? -actionWidth : 0
            }
        }
        .onChange(of: openID) { newValue in
            guard !isDragging else { return }
            let shouldBeOpen = newValue == id
            animateOffset(to: shouldBeOpen ? -actionWidth : 0)
        }
    }

    private func boundedOffset(_ value: CGFloat) -> CGFloat {
        min(0, max(-actionWidth, value))
    }

    private var actionButtons: some View {
        HStack(spacing: 0) {
            Button {
                performAfterClosing(onPin)
            } label: {
                actionLabel(title: pinTitle, systemImage: isPinned ? "pin.slash" : "pin.fill")
            }
            .buttonStyle(.plain)
            .foregroundColor(.white)
            .frame(width: actionWidth / 2, height: actionHeight)
            .background(Color(hex: "F0A020"))

            Button {
                // Keep the destructive actions exposed while the confirmation
                // alert is presented. Sliding the row closed at the same time as
                // the system alert transition causes visible frame drops.
                onDelete()
            } label: {
                actionLabel(title: L10n.tr("common.delete"), systemImage: "trash")
            }
            .buttonStyle(.plain)
            .foregroundColor(.white)
            .frame(width: actionWidth / 2, height: actionHeight)
            .background(Color(hex: "E5484D"))
        }
    }

    private func actionLabel(title: String, systemImage: String) -> some View {
        VStack(spacing: 3) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.78)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
    }

    private func handleContentTap() {
        if openID == id {
            closeWithSlide()
        } else if openID != nil {
            onRequestClose()
        } else {
            onTap()
        }
    }

    private func handleHorizontalPanBegan() {
        if openID != nil && openID != id {
            onRequestClose()
        }

        isDragging = true
        dragStartOffset = swipeOffset
    }

    private func handleHorizontalPanChanged(_ translation: CGFloat) {
        var transaction = Transaction()
        transaction.animation = nil
        withTransaction(transaction) {
            swipeOffset = boundedOffset(dragStartOffset + translation)
        }
    }

    private func handleHorizontalPanEnded(translation: CGFloat, velocity: CGFloat) {
        let releaseOffset = boundedOffset(dragStartOffset + translation)
        let projectedOffset = boundedOffset(releaseOffset + velocity * 0.13)
        let shouldOpen: Bool

        if velocity < -420 {
            shouldOpen = true
        } else if velocity > 420 {
            shouldOpen = false
        } else {
            shouldOpen = projectedOffset < -actionWidth * 0.46
        }

        var transaction = Transaction()
        transaction.animation = nil
        withTransaction(transaction) {
            swipeOffset = releaseOffset
            isDragging = false
        }
        setOpen(shouldOpen, releaseVelocity: velocity)
    }

    private func handleHorizontalPanCancelled() {
        isDragging = false
        setOpen(openID == id, updatesSharedState: false)
    }

    private func closeWithSlide() {
        setOpen(false)
    }

    private func performAfterClosing(_ action: @escaping () -> Void) {
        closeWithSlide()
        DispatchQueue.main.asyncAfter(deadline: .now() + actionDispatchDelay) {
            action()
        }
    }

    private func setOpen(
        _ open: Bool,
        updatesSharedState: Bool = true,
        releaseVelocity: CGFloat = 0
    ) {
        let target = open ? -actionWidth : CGFloat.zero

        if updatesSharedState {
            if open {
                openID = id
            } else if openID == id {
                openID = nil
            }
        }

        animateOffset(to: target, releaseVelocity: releaseVelocity)
    }

    private func animateOffset(to target: CGFloat, releaseVelocity: CGFloat = 0) {
        let remainingDistance = target - swipeOffset
        guard abs(remainingDistance) > 0.5 else { return }

        let relativeVelocity = Double(releaseVelocity / remainingDistance)
        let clampedVelocity = min(10, max(-10, relativeVelocity))
        let animation = Animation.interpolatingSpring(
            mass: 1,
            stiffness: 390,
            damping: 40,
            initialVelocity: clampedVelocity
        )

        withAnimation(animation) {
            swipeOffset = target
        }
    }
}

/// A UIKit-backed horizontal pan surface. `gestureRecognizerShouldBegin` rejects
/// vertical motion before recognition, so the ancestor ScrollView receives the
/// same traditional bidirectional scroll behavior as a standard chat list.
private struct HorizontalSwipeGestureSurface: UIViewRepresentable {
    let accessibilityLabel: String
    let accessibilityIdentifier: String
    let onTap: () -> Void
    let onBegan: () -> Void
    let onChanged: (CGFloat) -> Void
    let onEnded: (_ translation: CGFloat, _ velocity: CGFloat) -> Void
    let onCancelled: () -> Void

    func makeUIView(context: Context) -> GestureView {
        let view = GestureView()
        update(view)
        return view
    }

    func updateUIView(_ uiView: GestureView, context: Context) {
        update(uiView)
    }

    private func update(_ view: GestureView) {
        view.isAccessibilityElement = true
        view.accessibilityTraits = .button
        view.accessibilityLabel = accessibilityLabel
        view.accessibilityIdentifier = accessibilityIdentifier
        view.onTap = onTap
        view.onBegan = onBegan
        view.onChanged = onChanged
        view.onEnded = onEnded
        view.onCancelled = onCancelled
    }

    final class GestureView: UIView, UIGestureRecognizerDelegate {
        var onTap: (() -> Void)?
        var onBegan: (() -> Void)?
        var onChanged: ((CGFloat) -> Void)?
        var onEnded: ((CGFloat, CGFloat) -> Void)?
        var onCancelled: (() -> Void)?

        private lazy var panRecognizer: UIPanGestureRecognizer = {
            let recognizer = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
            recognizer.minimumNumberOfTouches = 1
            recognizer.maximumNumberOfTouches = 1
            recognizer.cancelsTouchesInView = true
            recognizer.delegate = self
            return recognizer
        }()

        private lazy var tapRecognizer: UITapGestureRecognizer = {
            let recognizer = UITapGestureRecognizer(target: self, action: #selector(handleTap))
            recognizer.cancelsTouchesInView = true
            return recognizer
        }()

        override init(frame: CGRect) {
            super.init(frame: frame)
            backgroundColor = .clear
            addGestureRecognizer(panRecognizer)
            tapRecognizer.require(toFail: panRecognizer)
            addGestureRecognizer(tapRecognizer)
        }

        required init?(coder: NSCoder) {
            fatalError("init(coder:) has not been implemented")
        }

        override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard gestureRecognizer === panRecognizer else { return true }
            let velocity = panRecognizer.velocity(in: self)
            return abs(velocity.x) > abs(velocity.y)
        }

        @objc private func handleTap() {
            onTap?()
        }

        @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) {
            switch recognizer.state {
            case .began:
                onBegan?()
            case .changed:
                onChanged?(recognizer.translation(in: self).x)
            case .ended:
                onEnded?(
                    recognizer.translation(in: self).x,
                    recognizer.velocity(in: self).x
                )
            case .cancelled, .failed:
                onCancelled?()
            default:
                break
            }
        }
    }
}

// MARK: - Conversation Row

struct ConversationRow: View {
    let conversation: Conversation
    let showsDivider: Bool
    var isPinned: Bool = false
    @ObservedObject private var unreadStore = UnreadBadgeStore.shared
    @ObservedObject private var draftStore = ChatDraftStore.shared
    @ObservedObject private var notificationStore = GroupNotificationSettingsStore.shared

    private var unreadCount: Int {
        unreadStore.conversationUnreadCount(for: conversation.listIdentity)
            ?? conversation.unreadCount
    }

    private var draftPreview: String? {
        _ = draftStore.revision
        return draftStore.preview(for: conversation)
    }

    private var isMuted: Bool {
        guard conversation.isGroup,
              let groupID = conversation.resolvedGroupID else { return false }
        return notificationStore.settings(for: groupID).isMuted || conversation.isMuted
    }

    var body: some View {
        HStack(spacing: 12) {
            if conversation.isAgentConversation {
                AgentAvatarView(
                    assetID: conversation.agentAvatarAssetID,
                    size: 50,
                    cornerRadius: 50 * 0.22
                )
            } else if conversation.isScriptRoom {
                ScriptRemoteImage(
                    urlString: conversation.avatarURL,
                    cornerRadius: 10,
                    fallbackSystemImage: "book.closed.fill"
                )
                .frame(width: 50, height: 50)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            } else if conversation.isGroup {
                if let groupID = conversation.resolvedGroupID {
                    GroupMemberAvatarView(groupID: groupID, size: 50)
                } else {
                    GroupAvatarIcon(size: 50)
                }
            } else {
                AvatarView(url: conversation.avatarURL, size: 50)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(conversation.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)

                    if conversation.isScriptRoom {
                        ConversationKindBadge(text: L10n.tr("script.label"))
                    }

                    if conversation.isAgentConversation {
                        ConversationKindBadge(text: "智能体")
                    }

                    if isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(Color(hex: "F0A020"))
                    }

                    if conversation.isGroup, let count = conversation.memberCount {
                        Text("(\(count))")
                            .font(.system(size: 13))
                            .foregroundColor(AppColors.tertiaryText)
                    }

                    if isMuted {
                        Image(systemName: "bell.slash.fill")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(AppColors.tertiaryText)
                            .accessibilityLabel(L10n.tr("group.notifications.mute"))
                    }
                }

                if let draftPreview {
                    HStack(spacing: 3) {
                        Text(L10n.tr("draft.prefix"))
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.errorColor)
                        Text(draftPreview)
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.secondaryText)
                    }
                    .lineLimit(1)
                } else if let lastMsg = conversation.lastMessage {
                    HStack(spacing: 0) {
                        if let sender = ConversationPreviewFormatter.senderPrefix(
                            conversation.subtitle,
                            content: lastMsg
                        ) {
                            Text("\(sender): ")
                                .font(.system(size: 14))
                                .foregroundColor(AppColors.secondaryText)
                        }
                        Text(ConversationPreviewFormatter.text(for: lastMsg))
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.secondaryText)
                    }
                    .lineLimit(1)
                } else {
                    Text(conversation.isGroup ? L10n.tr("conversation.startGroup") : L10n.tr("conversation.startChat"))
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.tertiaryText)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 6) {
                Text(conversation.formattedTime)
                    .font(.system(size: 12))
                    .foregroundColor(AppColors.tertiaryText)

                if unreadCount > 0 {
                    Text("\(min(unreadCount, 99))\(unreadCount > 99 ? "+" : "")")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(isMuted ? AppColors.mutedUnreadBadge : AppColors.unreadBadge)
                        .cornerRadius(10)
                }
            }
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: AppListMetrics.userCardHeight, alignment: .leading)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            if showsDivider {
                Divider()
                    .padding(.leading, 62)
            }
        }
    }
}

private struct ConversationKindBadge: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundColor(AppColors.accent)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(AppColors.accentLight)
            .cornerRadius(4)
            .fixedSize(horizontal: true, vertical: false)
    }
}
