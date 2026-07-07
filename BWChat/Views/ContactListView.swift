import SwiftUI

enum ConversationPreviewFormatter {
    static func text(for content: String) -> String {
        if let payload = BotSharePayload.decode(from: content) {
            let name = payload.name.trimmingCharacters(in: .whitespacesAndNewlines)
            return name.isEmpty
                ? L10n.tr("bot.share.preview.generic")
                : L10n.tr("bot.share.preview", name)
        }
        return content
    }
}

struct ContactListView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel = ConversationListViewModel()
    @ObservedObject private var botStore = BotStore.shared
    @State private var showCreateGroup = false
    @State private var showAddFriendSheet = false
    @State private var showScannerComingSoon = false
    @State private var showCreateBot = false
    @State private var initialLoadUserID: String?
    @State private var initialLoadInFlightUserID: String?
    @State private var openSwipeActionID: ConversationSwipeActionID?
    @State private var swipeCloseRequest = 0

    var body: some View {
        Group {
            if viewModel.conversations.isEmpty && botStore.conversationBots.isEmpty && !viewModel.isLoading {
                emptyStateView
            } else {
                conversationListView
            }
        }
        .background(AppColors.secondaryBackground)
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
        .sheet(isPresented: $showCreateBot) {
            BotConfigView(mode: .create)
        }
        .refreshable {
            closeOpenSwipeAction()
            async let conversations: () = viewModel.loadConversations()
            async let bots: () = botStore.syncServerBots()
            await conversations
            await bots
        }
        .sheet(isPresented: $showCreateGroup) {
            CreateGroupView {
                Task { await viewModel.loadConversations() }
            }
        }
        .task(id: AuthManager.shared.currentUser?.userID ?? "") {
            await loadInitialContentIfNeeded()
        }
        .onDisappear {
            closeOpenSwipeAction()
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
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openGroupChat"))) { notif in
            guard let groupID = Self.intValue(notif.userInfo?["group_id"]) else { return }
            navigator.popToRoot()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                if let conv = viewModel.conversations.first(where: { $0.groupID == groupID }) {
                    openConversation(conv)
                }
            }
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
        if let gid = conv.groupID, conv.isGroup {
            let group = ChatGroup(
                groupID: gid,
                name: conv.name,
                avatarURL: conv.avatarURL,
                creatorID: "",
                memberCount: conv.memberCount ?? 0,
                lastMessage: conv.lastMessage,
                lastMessageTime: conv.lastMessageTime,
                lastMessageSender: conv.subtitle,
                unreadCount: conv.unreadCount
            )
            navigator.push(GroupChatView(group: group) {
                viewModel.markGroupAsRead(groupID: gid)
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
            navigator.push(ChatView(contact: contact) {
                viewModel.markAsRead(conversationID: conv.id)
            })
        }
    }

    private func loadInitialContentIfNeeded() async {
        guard let userID = AuthManager.shared.currentUser?.userID, !userID.isEmpty else { return }
        guard initialLoadUserID != userID else { return }
        guard initialLoadInFlightUserID != userID else { return }
        initialLoadInFlightUserID = userID
        defer { initialLoadInFlightUserID = nil }

        async let conversations: () = viewModel.loadConversations()
        async let bots: () = botStore.syncServerBots()
        await conversations
        await bots
        initialLoadUserID = userID
    }

    private func closeOpenSwipeAction() {
        guard openSwipeActionID != nil else { return }
        swipeCloseRequest += 1
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
        List {
            messageHeader
                .simultaneousGesture(TapGesture().onEnded(closeOpenSwipeAction))
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(
                    top: AppSpacing.rootTabTopInset,
                    leading: 16,
                    bottom: 8,
                    trailing: 16
                ))
                .listRowBackground(Color.clear)

            ForEach(Array(botStore.conversationBots.enumerated()), id: \.element.id) { index, bot in
                BotConversationRow(
                    bot: bot,
                    lastMessage: botStore.lastMessage(for: bot.id),
                    showsDivider: index < botStore.conversationBots.count - 1 || !viewModel.conversations.isEmpty,
                    isPinned: botStore.isBotPinned(bot)
                )
                .wrappedInSwipeActions(
                    id: .bot(bot.id),
                    openID: $openSwipeActionID,
                    closeRequest: swipeCloseRequest,
                    isPinned: botStore.isBotPinned(bot),
                    pinTitle: botStore.isBotPinned(bot) ? L10n.tr("messages.unpin") : L10n.tr("messages.pin"),
                    onRequestClose: closeOpenSwipeAction,
                    onTap: {
                        closeOpenSwipeAction()
                        navigator.push(BotChatView(botID: bot.id))
                    },
                    onPin: {
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                            botStore.toggleBotPinned(bot)
                        }
                    },
                    onDelete: {
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                            botStore.hideBotConversation(bot)
                        }
                    }
                )
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                    .listRowBackground(Color.clear)
            }

            ForEach(Array(viewModel.conversations.enumerated()), id: \.element.id) { index, conv in
                ConversationRow(
                    conversation: conv,
                    showsDivider: index < viewModel.conversations.count - 1,
                    isPinned: viewModel.isPinned(conv)
                )
                .wrappedInSwipeActions(
                    id: .conversation(conv.id),
                    openID: $openSwipeActionID,
                    closeRequest: swipeCloseRequest,
                    isPinned: viewModel.isPinned(conv),
                    pinTitle: viewModel.isPinned(conv) ? L10n.tr("messages.unpin") : L10n.tr("messages.pin"),
                    onRequestClose: closeOpenSwipeAction,
                    onTap: {
                        openConversation(conv)
                    },
                    onPin: {
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                            viewModel.togglePinned(conv)
                        }
                    },
                    onDelete: {
                        withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                            viewModel.deleteConversation(conv)
                        }
                    }
                )
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .simultaneousGesture(
            DragGesture(minimumDistance: 6, coordinateSpace: .local)
                .onChanged { value in
                    guard abs(value.translation.height) > abs(value.translation.width) else { return }
                    closeOpenSwipeAction()
                }
        )
    }

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            messageHeader
                .padding(.horizontal, 16)
                .padding(.top, AppSpacing.rootTabTopInset)

            Spacer()
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
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var messageHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            RootTabTitle(localizedKey: "tab.messages")
            messageActionsMenu
        }
        .frame(maxWidth: .infinity, minHeight: 36, alignment: .center)
    }

    private var messageActionsMenu: some View {
        Menu {
            Button {
                closeOpenSwipeAction()
                showCreateGroup = true
            } label: {
                Label(L10n.tr("messages.startGroup"), systemImage: "bubble.left.and.bubble.right")
            }
            Button {
                closeOpenSwipeAction()
                showAddFriendSheet = true
            } label: {
                Label(L10n.tr("messages.addFriend"), systemImage: "person.badge.plus")
            }
            Button {
                closeOpenSwipeAction()
                showScannerComingSoon = true
            } label: {
                Label(L10n.tr("messages.scan"), systemImage: "qrcode.viewfinder")
            }
            Button {
                closeOpenSwipeAction()
                showCreateBot = true
            } label: {
                Label(L10n.tr("messages.createBot"), systemImage: "sparkles")
            }
        } label: {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 25, weight: .semibold))
                .foregroundStyle(AppColors.accentGradient)
                .frame(width: 42, height: 42)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(L10n.tr("messages.moreActions"))
    }
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
        closeRequest: Int,
        isPinned: Bool,
        pinTitle: String,
        onRequestClose: @escaping () -> Void,
        onTap: @escaping () -> Void,
        onPin: @escaping () -> Void,
        onDelete: @escaping () -> Void
    ) -> some View {
        SwipeableConversationCell(
            id: id,
            openID: openID,
            closeRequest: closeRequest,
            isPinned: isPinned,
            pinTitle: pinTitle,
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
    let closeRequest: Int
    let isPinned: Bool
    let pinTitle: String
    let onRequestClose: () -> Void
    let onTap: () -> Void
    let onPin: () -> Void
    let onDelete: () -> Void

    private let content: Content
    private let avatarRevealOffset: CGFloat = 62
    private let actionWidth: CGFloat = 144
    private let actionHeight: CGFloat = AppListMetrics.conversationSwipeActionHeight
    private let closeAnimationDuration: TimeInterval = 0.34

    @State private var dragOffset: CGFloat = 0
    @State private var settledOffset: CGFloat = 0
    @State private var closeAnimationToken = UUID()

    init(
        id: ConversationSwipeActionID,
        openID: Binding<ConversationSwipeActionID?>,
        closeRequest: Int,
        isPinned: Bool,
        pinTitle: String,
        onRequestClose: @escaping () -> Void,
        onTap: @escaping () -> Void,
        onPin: @escaping () -> Void,
        onDelete: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.id = id
        self._openID = openID
        self.closeRequest = closeRequest
        self.isPinned = isPinned
        self.pinTitle = pinTitle
        self.onRequestClose = onRequestClose
        self.onTap = onTap
        self.onPin = onPin
        self.onDelete = onDelete
        self.content = content()
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            content
                .offset(x: dragOffset)
                .contentShape(Rectangle())
                .onTapGesture {
                    if openID == id {
                        closeWithSlide()
                    } else if openID != nil {
                        onRequestClose()
                    } else {
                        onTap()
                    }
                }

            if openID != nil {
                dismissOverlay
            }

            actionButtons
                .frame(width: actionWidth, height: actionHeight)
                .offset(x: actionWidth * (1 - actionProgress) * 0.25)
                .opacity(actionProgress)
                .allowsHitTesting(isOpen)
        }
        .clipped()
        .simultaneousGesture(swipeGesture)
        .onChange(of: openID) { newValue in
            let shouldBeOpen = newValue == id
            guard shouldBeOpen != isOpen else { return }
            setOpen(shouldBeOpen, updatesSharedState: false)
        }
        .onChange(of: closeRequest) { _ in
            guard openID == id || dragOffset < 0 else { return }
            closeWithSlide()
        }
    }

    private var actionProgress: CGFloat {
        guard avatarRevealOffset > 0 else { return 0 }
        return min(1, max(0, -dragOffset / avatarRevealOffset))
    }

    private var isOpen: Bool {
        settledOffset <= -avatarRevealOffset * 0.9
    }

    private var actionButtons: some View {
        HStack(spacing: 0) {
            Button {
                closeWithSlide()
                onPin()
            } label: {
                actionLabel(title: pinTitle, systemImage: isPinned ? "pin.slash" : "pin.fill")
            }
            .buttonStyle(.plain)
            .foregroundColor(.white)
            .frame(width: actionWidth / 2, height: actionHeight)
            .background(Color(hex: "F0A020"))

            Button {
                closeWithSlide()
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

    private var dismissOverlay: some View {
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture {
                closeFromOutsideInteraction()
            }
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .local)
                    .onChanged { _ in
                        closeFromOutsideInteraction()
                    }
            )
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0, maximumDistance: 10_000)
                    .onEnded { _ in
                        closeFromOutsideInteraction()
                    }
            )
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

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .local)
            .onChanged { value in
                guard abs(value.translation.width) > abs(value.translation.height) else {
                    guard openID != nil else { return }
                    if openID == id {
                        closeWithSlide()
                    } else {
                        onRequestClose()
                    }
                    return
                }
                if openID != nil && openID != id {
                    onRequestClose()
                    return
                }
                let nextOffset = settledOffset + value.translation.width
                dragOffset = min(0, max(-avatarRevealOffset, nextOffset))
            }
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                let predictedOffset = settledOffset + value.predictedEndTranslation.width
                let shouldOpen = predictedOffset < -avatarRevealOffset * 0.45
                    || dragOffset < -avatarRevealOffset * 0.5
                setOpen(shouldOpen)
            }
    }

    private func closeFromOutsideInteraction() {
        if openID == id {
            closeWithSlide()
        } else {
            onRequestClose()
        }
    }

    private func closeWithSlide() {
        setOpen(false)
    }

    private func setOpen(_ open: Bool, updatesSharedState: Bool = true) {
        let target = open ? -avatarRevealOffset : CGFloat.zero
        closeAnimationToken = UUID()
        let animationToken = closeAnimationToken

        if updatesSharedState && open {
            openID = id
        }

        let animation: Animation = open
            ? .interactiveSpring(response: 0.28, dampingFraction: 0.88, blendDuration: 0.04)
            : .timingCurve(0.22, 0.61, 0.36, 1, duration: closeAnimationDuration)

        withAnimation(animation) {
            dragOffset = target
        }
        settledOffset = target

        guard updatesSharedState, !open, openID == id else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + closeAnimationDuration) {
            guard closeAnimationToken == animationToken, openID == id, abs(dragOffset) < 1 else { return }
            openID = nil
        }
    }
}

// MARK: - Bot row in conversation list

struct BotConversationRow: View {
    let bot: BotConfig
    let lastMessage: BotChatMessage?
    let showsDivider: Bool
    var isPinned: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            BotAvatar(avatarURL: bot.avatarURL, emoji: bot.emoji, size: 50)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(bot.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                    Text(L10n.tr("bot.label"))
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(AppColors.accentLight)
                        .cornerRadius(4)

                    if isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundColor(Color(hex: "F0A020"))
                    }
                }

                if let msg = lastMessage {
                    Text((msg.role == "user" ? L10n.tr("common.me.withColon") : "") + msg.content)
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)
                } else {
                    Text(bot.characterBackground.isEmpty ? L10n.tr("bot.chat.start") : bot.characterBackground)
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.tertiaryText)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)
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

// MARK: - Conversation Row

struct ConversationRow: View {
    let conversation: Conversation
    let showsDivider: Bool
    var isPinned: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            if conversation.isGroup {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [Color(hex: "5856D6").opacity(0.8), Color(hex: "764BA2").opacity(0.6)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 50, height: 50)
                    Image(systemName: "person.3.fill")
                        .font(.system(size: 16))
                        .foregroundColor(.white)
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
                }

                if let lastMsg = conversation.lastMessage {
                    HStack(spacing: 0) {
                        if let sender = conversation.subtitle {
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

                if conversation.unreadCount > 0 {
                    Text("\(min(conversation.unreadCount, 99))\(conversation.unreadCount > 99 ? "+" : "")")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(AppColors.unreadBadge)
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
