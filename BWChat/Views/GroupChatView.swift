// BWChat/Views/GroupChatView.swift
// Group chat conversation page

import SwiftUI
import PhotosUI
import AVKit
import AVFoundation
import UniformTypeIdentifiers
import UIKit

private struct GroupMessageRenderItem: Identifiable {
    let message: GroupMessage
    let previousTimestamp: String?

    var id: Int { message.id }
}

private struct GroupPendingRenderItem: Identifiable {
    let id: String
    let createdAt: Date
    let text: PendingGroupText?
    let sticker: PendingGroupSticker?
    let media: PendingGroupMedia?
}

struct GroupChatView: View {
    let group: ChatGroup
    var onMarkRead: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel: GroupChatViewModel
    @ObservedObject private var callManager = CallManager.shared
    @ObservedObject private var appearanceStore = ChatAppearanceStore.shared
    @State private var selectedMediaItems: [PhotosPickerItem] = []
    @State private var previewVideoURL: String?
    @State private var showAddMembers = false
    @State private var showGroupDetail = false
    @State private var memberCount: Int
    @State private var shouldPopToRoot = false
    @State private var activeComposerPanel: ComposerPanel?
    @State private var pendingComposerPanel: ComposerPanel?
    @State private var composerSurfaceHeights = ComposerSurfaceHeights(
        stickerHeight: StickerPanel.preferredHeight,
        plusHeight: ComposerPlusPanelMetrics.preferredHeight(itemCount: 6)
    )
    @State private var composerSurfaceTransition: ComposerSurfaceTransition?
    @State private var showGiftSheet = false
    @State private var redPacketOverlayPayload: ChatMoneyPayload?
    @State private var redPacketOverlayIsSender = false
    @State private var groupTransferRecipient: ChatMoneyRecipient?
    @StateObject private var moneyStore = ChatMoneyStore()
    @State private var highlightedMessageID: Int?
    @State private var isVoiceMode = false
    @StateObject private var recorder = AudioRecorderManager()
    @State private var voiceCancelZone = false
    @State private var isInputFocused = false
    @State private var inputTextHeight: CGFloat = 40
    @State private var composerSelection = NSRange(location: 0, length: 0)
    @State private var isViewVisible = false
    @State private var hasCompletedInitialLoad = false
    @State private var toastMessage: String?
    @State private var memberProfilesByID: [String: GroupMember]

    private let bottomScrollAnchorID = "group-chat-bottom-anchor"
    private let composerPanelAnimation = Animation.easeInOut(duration: 0.25)
    private let composerActionButtonHeight: CGFloat = 54

    private var showsComposerMicrophone: Bool {
        !isInputFocused && selectedComposerPanel == nil && viewModel.inputText.isEmpty
    }

    private var selectedComposerPanel: ComposerPanel? {
        pendingComposerPanel ?? activeComposerPanel
    }

    private var reservesComposerPanelSpace: Bool {
        !isVoiceMode && (activeComposerPanel != nil || composerSurfaceTransition != nil)
    }

    private var composerPanelLayoutHeight: CGFloat? {
        if let transition = composerSurfaceTransition {
            return transition.reservedHeight
        }
        guard let panel = activeComposerPanel else { return nil }
        return composerSurfaceHeights.height(for: ComposerSurface(panel: panel))
    }

    private var myAvatarURL: String {
        AuthManager.shared.currentUser?.avatarURL ?? ""
    }

    private var moneyContext: ChatMoneyConversationContext {
        let members = memberProfilesByID.values.sorted {
            $0.nickname.localizedCaseInsensitiveCompare($1.nickname) == .orderedAscending
        }
        return .group(id: group.groupID, name: group.name, members: members)
    }

    private func handleChatMoneyTap(_ payload: ChatMoneyPayload, isSender: Bool) {
        pendingComposerPanel = nil
        isInputFocused = false
        hideKeyboard()

        if ChatMoneyRedPacketPresentationPolicy.shouldShowEnvelope(
            payload: payload,
            isSender: isSender,
            hasLocalClaim: moneyStore.hasViewerClaimed(assetID: payload.assetID)
        ) {
            redPacketOverlayIsSender = isSender
            redPacketOverlayPayload = payload
        } else {
            showChatMoneyDetail(payload)
        }
    }

    private func showChatMoneyDetail(_ payload: ChatMoneyPayload) {
        navigator.push(
            ChatMoneyDetailView(store: moneyStore, initialPayload: payload)
        )
    }

    private func showRedPacketDetail(_ payload: ChatMoneyPayload) {
        withAnimation(.easeOut(duration: 0.18)) {
            redPacketOverlayPayload = nil
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            showChatMoneyDetail(payload)
        }
    }

    private func showChatMoneyComposer(
        kind: ChatMoneyKind,
        recipient: ChatMoneyRecipient? = nil,
        flowDepth: Int
    ) {
        navigator.push(
            ChatMoneyComposerSheet(
                store: moneyStore,
                kind: kind,
                context: moneyContext,
                initialRecipient: recipient,
                onCreated: { result in
                    if kind == .transfer {
                        groupTransferRecipient = nil
                    }
                    viewModel.appendCreatedChatMoneyMessage(result)
                    navigator.pop(count: flowDepth)
                },
                onOpenWallet: {
                    showWallet(afterPopping: flowDepth)
                }
            )
        )
    }

    private func showTransferRecipientPicker() {
        navigator.push(
            ChatMoneyRecipientPickerSheet(
                context: moneyContext,
                selectedRecipientID: groupTransferRecipient?.id
            ) { recipient in
                groupTransferRecipient = recipient
                showChatMoneyComposer(
                    kind: .transfer,
                    recipient: recipient,
                    flowDepth: 2
                )
            }
        )
    }

    private func showWallet(afterPopping count: Int) {
        navigator.pop(count: count)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            navigator.push(WalletView())
        }
    }

    private var renderedMessages: [GroupMessageRenderItem] {
        var rows: [GroupMessageRenderItem] = []
        rows.reserveCapacity(viewModel.messages.count)

        var previous: String?
        for message in viewModel.messages {
            rows.append(GroupMessageRenderItem(message: message, previousTimestamp: previous))
            previous = message.timestamp
        }
        return rows
    }

    private var renderedPendingItems: [GroupPendingRenderItem] {
        let texts = viewModel.visiblePendingTexts.map {
            GroupPendingRenderItem(id: $0.id, createdAt: $0.createdAt, text: $0, sticker: nil, media: nil)
        }
        let stickers = viewModel.visiblePendingStickers.map {
            GroupPendingRenderItem(id: $0.id, createdAt: $0.createdAt, text: nil, sticker: $0, media: nil)
        }
        let media = viewModel.visiblePendingMedia.map {
            GroupPendingRenderItem(id: $0.id, createdAt: $0.createdAt, text: nil, sticker: nil, media: $0)
        }
        return (texts + stickers + media).sorted { $0.createdAt < $1.createdAt }
    }

    init(group: ChatGroup, onMarkRead: (() -> Void)? = nil) {
        self.group = group
        self.onMarkRead = onMarkRead
        _viewModel = StateObject(wrappedValue: GroupChatViewModel(group: group))

        // Seed member count from whatever we already know: the freshest value
        // is the cached GroupDetail (written by GroupDetailView), then the
        // ChatGroup we were pushed with (from the conversation row). Zero
        // only if neither source has anything — in which case .task will
        // fill it in shortly.
        let cached = LocalCache.load(GroupDetail.self, key: "group_detail_\(group.groupID)")
        let seed = cached?.members.count ?? group.memberCount
        _memberCount = State(initialValue: seed)
        _memberProfilesByID = State(initialValue: Self.memberProfilesByID(from: cached?.members ?? []))
    }

    private static func memberProfilesByID(from members: [GroupMember]) -> [String: GroupMember] {
        members.reduce(into: [:]) { result, member in
            result[member.userID] = member
        }
    }

    private func cacheMembers(_ members: [GroupMember]) {
        for member in members {
            UserCacheManager.shared.cacheUser(
                userID: member.userID,
                nickname: member.nickname,
                avatarURL: member.avatarURL
            )
        }
    }

    private func resolvedSenderAvatarURL(for message: GroupMessage, isFromMe: Bool) -> String {
        if isFromMe { return myAvatarURL }
        if let member = memberProfilesByID[message.senderID], !member.avatarURL.isBlank {
            return member.avatarURL
        }
        if let cached = UserCacheManager.shared.getUser(message.senderID), !cached.avatarURL.isBlank {
            return cached.avatarURL
        }
        return message.senderAvatar
    }

    private func resolvedSenderNickname(for message: GroupMessage, isFromMe: Bool) -> String? {
        guard !isFromMe else { return nil }
        if let member = memberProfilesByID[message.senderID], !member.nickname.isBlank {
            return member.nickname
        }
        if let cached = UserCacheManager.shared.getUser(message.senderID), !cached.nickname.isBlank {
            return cached.nickname
        }
        return message.senderNickname
    }

    private func setActiveGroupChat(_ active: Bool) {
        WebSocketService.shared.activeGroupID = active ? group.id : nil
    }

    private func markConversationRead() {
        NotificationCenter.default.post(
            name: .conversationDidMarkRead,
            object: ConversationReadTarget.group(groupID: group.groupID)
        )
        if let onMarkRead {
            onMarkRead()
        } else {
            viewModel.markConversationAsReadOnServer()
        }
    }

    private func keyboardAnimation(from notification: Notification) -> Animation {
        let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        return .easeInOut(duration: max(duration, 0.18))
    }

    private func closeComposerPanelForKeyboard() {
        guard composerSurfaceTransition?.from != .keyboard else { return }
        guard pendingComposerPanel == nil else { return }
        guard activeComposerPanel != nil else { return }
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            activeComposerPanel = nil
        }
    }

    private func focusComposerTextInput() {
        pendingComposerPanel = nil
        if isVoiceMode {
            withAnimation(.easeOut(duration: 0.12)) {
                isVoiceMode = false
            }
        }

        if let panel = activeComposerPanel {
            let surface = ComposerSurface(panel: panel)
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                composerSurfaceTransition = ComposerSurfaceTransition(
                    from: surface,
                    to: .keyboard,
                    reservedHeight: composerSurfaceHeights.height(for: surface)
                )
            }
        } else {
            composerSurfaceTransition = nil
        }
        isInputFocused = true
    }

    private func dismissComposerInput() {
        pendingComposerPanel = nil
        composerSurfaceTransition = nil
        isInputFocused = false
        withAnimation(composerPanelAnimation) {
            activeComposerPanel = nil
        }
        hideKeyboard()
    }

    private func activateVoiceComposer() {
        pendingComposerPanel = nil
        composerSurfaceTransition = nil
        activeComposerPanel = nil
        isInputFocused = false
        hideKeyboard()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.easeOut(duration: 0.14)) {
            isVoiceMode = true
        }
    }

    private func toggleComposerPanel(_ panel: ComposerPanel) {
        let targetSurface = ComposerSurface(panel: panel)
        let isClosing = selectedComposerPanel == panel
        UISelectionFeedbackGenerator().selectionChanged()

        if isClosing {
            pendingComposerPanel = nil
            composerSurfaceTransition = nil
            withAnimation(composerPanelAnimation) {
                activeComposerPanel = nil
            }
            return
        }

        isVoiceMode = false
        if isInputFocused {
            let keyboardHeight = composerSurfaceHeights.height(for: .keyboard)
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                pendingComposerPanel = panel
                composerSurfaceTransition = ComposerSurfaceTransition(
                    from: .keyboard,
                    to: targetSurface,
                    reservedHeight: keyboardHeight
                )
                activeComposerPanel = panel
                isInputFocused = false
            }
            hideKeyboard()
            completeComposerSurfaceTransitionAfterKeyboardDismiss(to: targetSurface)
        } else {
            pendingComposerPanel = nil
            hideKeyboard()
            if let currentPanel = activeComposerPanel {
                let currentSurface = ComposerSurface(panel: currentPanel)
                let currentHeight = composerSurfaceHeights.height(for: currentSurface)
                let targetHeight = composerSurfaceHeights.height(for: targetSurface)
                var transaction = Transaction(animation: nil)
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    activeComposerPanel = panel
                    composerSurfaceTransition = ComposerSurfaceTransition(
                        from: currentSurface,
                        to: targetSurface,
                        reservedHeight: currentHeight
                    )
                }
                DispatchQueue.main.async {
                    guard composerSurfaceTransition?.from == currentSurface,
                          composerSurfaceTransition?.to == targetSurface else { return }
                    withAnimation(composerPanelAnimation) {
                        composerSurfaceTransition?.reservedHeight = targetHeight
                    }
                }
                completeComposerPanelTransition(
                    from: currentSurface,
                    to: targetSurface
                )
            } else {
                composerSurfaceTransition = nil
                withAnimation(composerPanelAnimation) {
                    activeComposerPanel = panel
                }
            }
        }
    }

    private func completeComposerSurfaceTransitionAfterKeyboardDismiss(to surface: ComposerSurface) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
            guard composerSurfaceTransition?.from == .keyboard,
                  composerSurfaceTransition?.to == surface,
                  activeComposerPanel == surface.panel,
                  !isInputFocused,
                  !isVoiceMode else { return }
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                pendingComposerPanel = nil
                composerSurfaceTransition = nil
            }
        }
    }

    private func handleKeyboardWillShow(_ notification: Notification) {
        let keyboardHeight = updateKeyboardHeight(from: notification)
        if composerSurfaceTransition?.to == .keyboard {
            withAnimation(keyboardAnimation(from: notification)) {
                composerSurfaceTransition?.reservedHeight = keyboardHeight
            }
        }
        closeComposerPanelForKeyboard()
    }

    private func handleKeyboardWillHide(_ notification: Notification) {
        isInputFocused = false
        guard composerSurfaceTransition?.from == .keyboard,
              let targetSurface = composerSurfaceTransition?.to,
              let panel = targetSurface.panel,
              !isVoiceMode else { return }
        withAnimation(keyboardAnimation(from: notification)) {
            composerSurfaceTransition?.reservedHeight =
                composerSurfaceHeights.height(for: targetSurface)
            activeComposerPanel = panel
        }
    }

    private func handleKeyboardDidShow() {
        guard composerSurfaceTransition?.to == .keyboard else { return }
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            composerSurfaceTransition = nil
        }
    }

    private func handleKeyboardDidHide() {
        guard composerSurfaceTransition?.from == .keyboard else { return }
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            pendingComposerPanel = nil
            composerSurfaceTransition = nil
        }
    }

    private func completeComposerPanelTransition(
        from source: ComposerSurface,
        to target: ComposerSurface
    ) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.27) {
            guard composerSurfaceTransition?.from == source,
                  composerSurfaceTransition?.to == target else { return }
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                composerSurfaceTransition = nil
            }
        }
    }

    @discardableResult
    private func updateKeyboardHeight(from notification: Notification) -> CGFloat {
        guard let keyboardFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
            return composerSurfaceHeights.height(for: .keyboard)
        }
        let bottomInset = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .safeAreaInsets.bottom ?? 0
        let availableHeight = max(StickerPanel.minimumHeight, keyboardFrame.height - bottomInset)
        composerSurfaceHeights.record(availableHeight, for: .keyboard)
        return availableHeight
    }

    private func scrollToMessage(_ messageID: Int, proxy: ScrollViewProxy) {
        guard isViewVisible else { return }
        withAnimation(.easeInOut(duration: 0.3)) {
            proxy.scrollTo(messageScrollID(messageID), anchor: .center)
        }
        highlightedMessageID = messageID
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            guard isViewVisible else { return }
            withAnimation(.easeOut(duration: 0.5)) {
                if highlightedMessageID == messageID {
                    highlightedMessageID = nil
                }
            }
        }
    }

    private func messageScrollID(_ id: Int) -> String {
        "message-\(id)"
    }

    private func pendingScrollID(_ id: String) -> String {
        "pending-\(id)"
    }

    private func scrollGroupChatToBottom(proxy: ScrollViewProxy, animated: Bool = true) {
        guard isViewVisible else { return }

        let scrollAction = {
            proxy.scrollTo(bottomScrollAnchorID, anchor: .top)
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            guard isViewVisible else { return }
            if animated {
                withAnimation(.easeOut(duration: 0.2), scrollAction)
            } else {
                scrollAction()
            }
        }
    }

    private func previousTimestamp(for pending: GroupPendingRenderItem) -> String? {
        let pendingItems = renderedPendingItems
        guard let idx = pendingItems.firstIndex(where: { $0.id == pending.id }) else {
            return viewModel.messages.last?.timestamp
        }
        if idx > 0 {
            return pendingItems[idx - 1].createdAt.iso8601String
        }
        return viewModel.messages.last?.timestamp
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ZStack {
                    ChatBackgroundLayer(
                        background: appearanceStore.effectiveBackground(
                            targetType: .group,
                            targetID: String(group.groupID)
                        )
                    )

                    ScrollView {
                        VStack(spacing: 0) {
                            Color.clear
                                .frame(height: 1)
                                .id(bottomScrollAnchorID)

                            LazyVStack(spacing: 4) {
                                ForEach(renderedPendingItems.reversed()) { pending in
                                    VStack(spacing: 4) {
                                        if TimestampHelper.shouldShowTime(
                                            current: pending.createdAt.iso8601String,
                                            previous: previousTimestamp(for: pending)
                                        ) {
                                            TimeSeparatorView(timestamp: pending.createdAt.iso8601String)
                                        }

                                        if let text = pending.text {
                                            PendingGroupBubble(pending: text, avatarURL: myAvatarURL) {
                                                Task { await viewModel.retryPendingText(text) }
                                            }
                                        } else if let sticker = pending.sticker {
                                            PendingGroupStickerBubble(pending: sticker, avatarURL: myAvatarURL) {
                                                Task { await viewModel.retryPendingSticker(sticker) }
                                            }
                                        } else if let media = pending.media {
                                            PendingGroupMediaBubble(pending: media, avatarURL: myAvatarURL) {
                                                viewModel.retryPendingMedia(media)
                                            }
                                        }
                                    }
                                    .id(pendingScrollID(pending.id))
                                    .flippedRow()
                                }

                                ForEach(renderedMessages.reversed()) { row in
                                    let message = row.message
                                    let isFromMe = message.senderID == AuthManager.shared.currentUser?.userID

                                    VStack(spacing: 4) {
                                        if TimestampHelper.shouldShowTime(
                                            current: message.timestamp,
                                            previous: row.previousTimestamp
                                        ) {
                                            TimeSeparatorView(timestamp: message.timestamp)
                                        }

                                        GroupMessageBubble(
                                            message: message,
                                            isFromMe: isFromMe,
                                            myAvatarURL: myAvatarURL,
                                            senderAvatarURL: resolvedSenderAvatarURL(for: message, isFromMe: isFromMe),
                                            senderNickname: resolvedSenderNickname(for: message, isFromMe: isFromMe),
                                            onImageTap: { url, frame in
                                                pendingComposerPanel = nil
                                                isInputFocused = false
                                                hideKeyboard()
                                                let allImages = viewModel.messages.filter(\.isImage).map(\.content)
                                                ImageGalleryState.shared.show(
                                                    urls: allImages,
                                                    index: allImages.firstIndex(of: url) ?? 0,
                                                    sourceFrame: frame,
                                                    loadMoreOlder: {
                                                        // When the gallery nears its leftmost image,
                                                        // page in more group history and tell the gallery
                                                        // how many NEW older image URLs that added.
                                                        let before = viewModel.messages.filter(\.isImage).map(\.content).count
                                                        await viewModel.loadMoreMessages()
                                                        let after = viewModel.messages.filter(\.isImage).map(\.content)
                                                        let added = after.count - before
                                                        if added > 0 {
                                                            let newOlder = Array(after.prefix(added))
                                                            ImageGalleryState.shared.imageURLs.insert(contentsOf: newOlder, at: 0)
                                                        }
                                                        return added
                                                    }
                                                )
                                            },
                                            onVideoTap: { url in
                                                pendingComposerPanel = nil
                                                isInputFocused = false
                                                hideKeyboard()
                                                previewVideoURL = url
                                            },
                                            onReply: { msg in viewModel.setReply(to: msg) },
                                            onQuoteTap: { targetID in
                                                scrollToMessage(targetID, proxy: proxy)
                                            },
                                            onMention: { userID, nickname in
                                                viewModel.addMention(userID: userID, nickname: nickname)
                                            },
                                            onChatMoneyTap: { payload, isSender in
                                                handleChatMoneyTap(payload, isSender: isSender)
                                            }
                                        )
                                    }
                                    .id(messageScrollID(message.id))
                                    .background(
                                        RoundedRectangle(cornerRadius: 12)
                                            .fill(highlightedMessageID == message.id ? AppColors.accent.opacity(0.15) : Color.clear)
                                    )
                                    .flippedRow()
                                }

                                if viewModel.hasMore {
                                    ProgressView()
                                        .tint(AppColors.accent)
                                        .padding()
                                        .flippedRow()
                                        .onAppear {
                                            Task { await viewModel.loadMoreMessages() }
                                        }
                                }
                            }
                            .padding(.horizontal, 12)
                            .padding(.top, 8)
                            .padding(.bottom, 8)
                        }
                    }
                    .rotationEffect(.degrees(180))
                    .scaleEffect(x: -1, y: 1, anchor: .center)
                    .scrollIndicators(.hidden)
                    .scrollDismissesKeyboard(.interactively)
                    // Only scroll to latest when a NEW message arrives at the
                    // end of the list (last.id changes). Watching messages.count
                    // also fires when loadMoreMessages prepends older history,
                    // yanking the user back to the bottom mid-scroll.
                    .onChange(of: viewModel.messages.last?.id) { _ in
                        scrollGroupChatToBottom(proxy: proxy)
                    }
                    .onChange(of: viewModel.visiblePendingTexts.count) { count in
                        guard count > 0 else { return }
                        scrollGroupChatToBottom(proxy: proxy)
                    }
                    .onChange(of: viewModel.visiblePendingStickers.count) { count in
                        guard count > 0 else { return }
                        scrollGroupChatToBottom(proxy: proxy)
                    }
                    .task {
                        guard !hasCompletedInitialLoad else { return }
                        async let messagesTask: () = viewModel.loadMessages()
                        async let detailTask = APIService.shared.getGroupDetail(groupID: group.groupID)
                        await messagesTask
                        await appearanceStore.loadIfNeeded()
                        if let detail = try? await detailTask {
                            memberCount = detail.members.count
                            memberProfilesByID = Self.memberProfilesByID(from: detail.members)
                            cacheMembers(detail.members)
                            // Persist for the next open + for GroupDetailView.
                            LocalCache.save(detail, key: "group_detail_\(group.groupID)")
                        }
                        guard !Task.isCancelled, isViewVisible else { return }
                        hasCompletedInitialLoad = true
                        scrollGroupChatToBottom(proxy: proxy, animated: false)
                    }
                }
                .contentShape(Rectangle())
                .simultaneousGesture(
                    TapGesture().onEnded {
                        dismissComposerInput()
                    }
                )
            }

            if let replyMsg = viewModel.replyingTo {
                ReplyPreviewBar(
                    senderName: replyMsg.senderNickname,
                    content: replyMsg.content,
                    msgType: replyMsg.msgType,
                    onCancel: { viewModel.cancelReply() }
                )
            }

            groupInputBar
        }
        .ignoresSafeArea(
            composerSurfaceTransition == nil ? [] : .keyboard,
            edges: .bottom
        )
        .sheet(isPresented: $viewModel.showMentionPicker) {
            MentionPickerView(groupID: group.groupID) { userID, nickname in
                viewModel.addMention(userID: userID, nickname: nickname)
            }
        }
        .background(AppColors.secondaryBackground)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button(L10n.tr("common.done")) {
                    dismissComposerInput()
                }
                .font(.system(size: 15, weight: .semibold))
            }
        }
        .overlay(alignment: .top) {
            if let alertMsg = viewModel.mentionAlertMessage {
                HStack(spacing: 10) {
                    Image(systemName: "at.badge.plus")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(.white)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L10n.tr("mention.alert", alertMsg.senderNickname))
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white)
                        Text(alertMsg.content.prefix(50))
                            .font(.system(size: 13))
                            .foregroundColor(.white.opacity(0.9))
                            .lineLimit(1)
                    }
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.red.opacity(0.92))
                        .shadow(color: .black.opacity(0.2), radius: 8, y: 4)
                )
                .padding(.horizontal, 12)
                .padding(.top, 4)
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: viewModel.mentionAlertMessage?.id)
                .onTapGesture {
                    withAnimation { viewModel.mentionAlertMessage = nil }
                }
            }
        }
        .navigationTitle(memberCount > 0 ? "\(group.name) (\(memberCount))" : group.name)
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showGroupDetail = true } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.accent)
                }
            }
        }
        .sheet(isPresented: $showAddMembers) {
            AddGroupMembersView(groupID: group.groupID)
        }
        .sheet(isPresented: $showGiftSheet) {
            GiftPickerSheet(
                source: .group(groupID: group.groupID, groupName: group.name),
                onSend: { gift, recipient in
                    try await viewModel.sendGift(gift, recipientID: recipient.id)
                },
                onOpenWallet: {
                    navigator.push(WalletView())
                },
                onSendFailure: { message in
                    toastMessage = message
                }
            )
        }
        .overlay {
            if let payload = redPacketOverlayPayload {
                ChatMoneyRedPacketEntryOverlay(
                    store: moneyStore,
                    initialPayload: payload,
                    isSender: redPacketOverlayIsSender,
                    onClose: {
                        withAnimation(.easeOut(duration: 0.18)) {
                            redPacketOverlayPayload = nil
                        }
                    },
                    onShowDetail: {
                        showRedPacketDetail(payload)
                    }
                )
                .zIndex(500)
            }
        }
        .onChange(of: showGroupDetail) { show in
            if show {
                showGroupDetail = false
                navigator.push(GroupDetailView(groupID: group.groupID) {
                    shouldPopToRoot = true
                })
            }
        }
        .overlay { groupVoiceRecordingOverlay }
        .onAppear {
            isViewVisible = true
            setActiveGroupChat(true)
            markConversationRead()
        }
        .task {
            await moneyStore.loadConfiguration()
        }
        .onChange(of: viewModel.errorMessage) { message in
            guard let message,
                  !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
            toastMessage = message
            viewModel.errorMessage = nil
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { notification in
            handleKeyboardWillShow(notification)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { notification in
            handleKeyboardWillHide(notification)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
            handleKeyboardDidShow()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in
            handleKeyboardDidHide()
        }
        .onDisappear {
            isViewVisible = false
            composerSurfaceTransition = nil
            setActiveGroupChat(false)
        }
        .onChange(of: callManager.currentCall != nil) { hasCalling in
            if hasCalling {
                pendingComposerPanel = nil
                composerSurfaceTransition = nil
                isInputFocused = false
                activeComposerPanel = nil
                hideKeyboard()
            }
        }
        .onChange(of: callManager.currentCall?.state) { newState in
            if newState == .connected || newState == .connecting {
                pendingComposerPanel = nil
                composerSurfaceTransition = nil
                isInputFocused = false
                activeComposerPanel = nil
                hideKeyboard()
            }
        }
        .onReceive(WebSocketService.shared.groupRemovedPublisher) { removedID in
            if removedID == group.groupID {
                shouldPopToRoot = true
            }
        }
        .onReceive(WebSocketService.shared.chatMoneyUpdatePublisher) { update in
            moneyStore.apply(update)
        }
        .onChange(of: shouldPopToRoot) { pop in
            if pop {
                if navigator.canPopPushedController {
                    navigator.popToRoot()
                } else {
                    dismiss()
                }
            }
        }
        
        .fullScreenCover(item: Binding(
            get: { previewVideoURL.map { VideoPreviewItem(url: $0) } },
            set: { previewVideoURL = $0?.url }
        )) { item in
            VideoPlayerView(videoURL: item.url)
        }
        .toast(message: $toastMessage)
        
    }

    // MARK: - Input Bar

    private var groupInputBar: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 6) {
                if isVoiceMode {
                    groupHoldToRecordButton
                        .overlay(alignment: .leading) {
                            Button {
                                focusComposerTextInput()
                            } label: {
                                Image(systemName: "keyboard")
                                    .font(.system(size: 20, weight: .medium))
                                    .foregroundColor(recorder.isRecording ? .white : AppColors.accent)
                                    .frame(width: 42, height: inputChromeHeight)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(recorder.isRecording)
                        }
                } else {
                    ZStack(alignment: .leading) {
                        ChatInputTextView(
                            text: $viewModel.inputText,
                            isFocused: $isInputFocused,
                            height: $inputTextHeight,
                            selectedRange: $composerSelection,
                            onRequestFocus: focusComposerTextInput,
                            onSend: { viewModel.submitText() }
                        )
                        .padding(.leading, showsComposerMicrophone ? 34 : 0)
                        .frame(height: inputTextHeight)

                        Text(L10n.tr("chat.input.placeholder"))
                            .font(.system(size: 16))
                            .foregroundColor(AppColors.tertiaryText)
                            .padding(.leading, showsComposerMicrophone ? 36 : 2)
                            .opacity(viewModel.inputText.isEmpty && !isInputFocused ? 1 : 0)
                            .allowsHitTesting(false)

                        Button(action: activateVoiceComposer) {
                            Image(systemName: "mic.fill")
                                .font(.system(size: 20, weight: .medium))
                                .foregroundColor(AppColors.accent)
                                .frame(width: 34, height: inputTextHeight)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .opacity(showsComposerMicrophone ? 1 : 0)
                        .scaleEffect(showsComposerMicrophone ? 1 : 0.82)
                        .allowsHitTesting(showsComposerMicrophone)
                        .animation(.easeOut(duration: 0.12), value: showsComposerMicrophone)
                    }
                    .frame(maxWidth: .infinity)
                    .chatComposerFieldChrome(minHeight: inputChromeHeight)
                }

                if !isVoiceMode {
                    HStack(spacing: 2) {
                            ComposerPanelToggleButton(
                                inactiveSystemName: "face.smiling",
                                activeSystemName: "face.smiling.fill",
                                isActive: selectedComposerPanel == .stickers,
                                accessibilityLabel: L10n.tr("chat.stickers")
                            ) {
                                toggleComposerPanel(.stickers)
                            }
                            .frame(width: 42, height: composerActionButtonHeight, alignment: .center)

                            ZStack {
                                Button {
                                    viewModel.submitText()
                                } label: {
                                    ZStack {
                                        Circle()
                                            .fill(AppColors.accentGradient)
                                            .frame(width: 40, height: 40)
                                        Image(systemName: "arrow.up")
                                            .font(.system(size: 15, weight: .bold))
                                            .foregroundColor(.white)
                                    }
                                    .contentShape(Circle())
                                }
                                .buttonStyle(ChatComposerActionButtonStyle(isActive: false))
                                .opacity(viewModel.isSendEnabled ? 1 : 0)
                                .allowsHitTesting(viewModel.isSendEnabled)

                                ComposerPanelToggleButton(
                                    inactiveSystemName: "plus.circle.fill",
                                    activeSystemName: "xmark.circle.fill",
                                    isActive: selectedComposerPanel == .plus,
                                    accessibilityLabel: L10n.tr("accessibility.moreActions")
                                ) {
                                    toggleComposerPanel(.plus)
                                }
                                .opacity(viewModel.isSendEnabled ? 0 : 1)
                                .allowsHitTesting(!viewModel.isSendEnabled)
                            }
                            .frame(width: 42, height: composerActionButtonHeight, alignment: .center)
                        }
                    }
                }
            .padding(.horizontal, 10)
            .padding(.top, 10)
            .padding(.bottom, isInputFocused || selectedComposerPanel != nil ? 5 : 12)

            ZStack(alignment: .top) {
                if activeComposerPanel == .stickers && !isVoiceMode {
                    StickerPanel(
                        onSend: { pack, sticker in
                            Task { await viewModel.sendSticker(pack: pack, sticker: sticker) }
                        },
                        onInsertEmoji: insertEmoji
                    )
                } else if activeComposerPanel == .plus && !isVoiceMode {
                    groupPlusMenu
                }
            }
            .frame(maxWidth: .infinity)
            .frame(
                height: reservesComposerPanelSpace ? composerPanelLayoutHeight : nil,
                alignment: .top
            )
            .onPreferenceChange(ComposerPanelRenderedHeightPreferenceKey.self) { height in
                guard height > 0 else { return }
                composerSurfaceHeights.record(height, for: .plus)
                guard composerSurfaceTransition?.to == .plus,
                      composerSurfaceTransition?.from != .keyboard else { return }
                withAnimation(composerPanelAnimation) {
                    composerSurfaceTransition?.reservedHeight = height
                }
            }
            .clipped()
            .background {
                if reservesComposerPanelSpace {
                    Color(uiColor: .secondarySystemBackground)
                        .opacity(0.98)
                        .ignoresSafeArea(edges: .bottom)
                }
            }
        }
        .chatComposerBarBackground(
            showsStickerPanel: selectedComposerPanel == .stickers
                || composerSurfaceTransition?.from == .stickers
        )
    }

    private var inputChromeHeight: CGFloat {
        inputTextHeight + 14
    }

    private func insertEmoji(_ value: String) {
        ComposerTextInsertion.insert(
            value,
            into: &viewModel.inputText,
            selectedRange: &composerSelection
        )
    }

    private var groupHoldToRecordButton: some View {
        Text(recorder.isRecording ? (voiceCancelZone ? L10n.tr("voice.releaseCancel") : L10n.tr("voice.releaseSend")) : L10n.tr("voice.holdToTalk"))
            .font(.system(size: 16, weight: .medium))
            .foregroundColor(recorder.isRecording ? .white : AppColors.primaryText)
            .chatComposerRecordChrome(
                isRecording: recorder.isRecording,
                isCanceling: voiceCancelZone,
                minHeight: inputChromeHeight
            )
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        if !recorder.isRecording {
                            recorder.startRecording()
                        }
                        let inCancel = value.translation.height < -80
                        if inCancel != voiceCancelZone {
                            withAnimation(.easeInOut(duration: 0.15)) { voiceCancelZone = inCancel }
                        }
                    }
                    .onEnded { _ in
                        if voiceCancelZone {
                            recorder.cancelRecording()
                            voiceCancelZone = false
                        } else {
                            finishGroupVoiceRecording()
                        }
                    }
            )
    }

    @ViewBuilder
    private var groupVoiceRecordingOverlay: some View {
        if recorder.isRecording {
            ZStack {
                Color.black.opacity(0.6)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)

                VStack(spacing: 24) {
                    Spacer()

                    ZStack {
                        Circle()
                            .fill(voiceCancelZone ? Color.red.opacity(0.9) : AppColors.accent)
                            .frame(width: 100, height: 100)

                        if voiceCancelZone {
                            Image(systemName: "xmark")
                                .font(.system(size: 36, weight: .bold))
                                .foregroundColor(.white)
                        } else {
                            HStack(spacing: 4) {
                                ForEach(0..<5, id: \.self) { i in
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(Color.white)
                                        .frame(width: 4, height: CGFloat([16, 24, 32, 24, 16][i]))
                                        .animation(
                                            .easeInOut(duration: 0.4)
                                            .repeatForever(autoreverses: true)
                                            .delay(Double(i) * 0.1),
                                            value: recorder.isRecording
                                        )
                                }
                            }
                        }
                    }
                    .scaleEffect(voiceCancelZone ? 1.1 : 1.0)
                    .animation(.easeInOut(duration: 0.2), value: voiceCancelZone)

                    Text(recorder.formattedDuration)
                        .font(.system(size: 48, weight: .light, design: .monospaced))
                        .foregroundColor(.white)

                    Text(voiceCancelZone ? L10n.tr("voice.releaseCancelSend") : L10n.tr("voice.slideUpCancel"))
                        .font(.system(size: 15))
                        .foregroundColor(.white.opacity(0.7))
                        .padding(.bottom, 120)
                }
            }
            .transition(.opacity)
        }
    }

    private func finishGroupVoiceRecording() {
        guard let result = recorder.stopRecording() else { return }
        Task {
            await viewModel.sendVoice(data: result.data, duration: result.duration)
        }
    }

    private var groupPlusMenu: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4),
            spacing: 18
        ) {
            PhotosPicker(selection: $selectedMediaItems, maxSelectionCount: 9, matching: .any(of: [.images, .videos])) {
                VStack(spacing: 6) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12).fill(AppColors.composerPanelIconBackground).frame(width: 56, height: 56)
                        Image(systemName: "photo").font(.system(size: 22)).foregroundColor(AppColors.primaryText)
                    }
                    Text(L10n.tr("chat.album")).font(.system(size: 11)).foregroundColor(AppColors.secondaryText)
                }
            }
            .onChange(of: selectedMediaItems) { items in
                guard !items.isEmpty else { return }
                pendingComposerPanel = nil
                activeComposerPanel = nil
                let captured = items
                selectedMediaItems = []
                for (index, item) in captured.enumerated() {
                    Task {
                        if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
                            if let movie = try? await item.loadTransferable(type: VideoTransferable.self) {
                                let data = try? Data(contentsOf: movie.url)
                                let ext = movie.url.pathExtension.lowercased()
                                try? FileManager.default.removeItem(at: movie.url)
                                if let data = data {
                                    await viewModel.sendVideo(data: data, filename: "video_\(Int(Date().timeIntervalSince1970))_\(index).\(ext.isEmpty ? "mp4" : ext)")
                                }
                            }
                        } else if item.supportedContentTypes.contains(where: { $0.conforms(to: .image) }) {
                            if let data = try? await item.loadTransferable(type: Data.self),
                               let uiImage = UIImage(data: data),
                               let jpegData = uiImage.jpegData(compressionQuality: 0.9) {
                                await viewModel.sendImage(data: jpegData)
                            }
                        }
                    }
                }
            }

            GiftPlusMenuTile {
                pendingComposerPanel = nil
                activeComposerPanel = nil
                isInputFocused = false
                showGiftSheet = true
            }

            ChatMoneyPlusMenuTile(kind: .redPacket) {
                pendingComposerPanel = nil
                activeComposerPanel = nil
                isInputFocused = false
                showChatMoneyComposer(
                    kind: .redPacket,
                    flowDepth: 1
                )
            }

            ChatMoneyPlusMenuTile(kind: .transfer) {
                pendingComposerPanel = nil
                activeComposerPanel = nil
                isInputFocused = false
                showTransferRecipientPicker()
            }

            Button {
                pendingComposerPanel = nil
                activeComposerPanel = nil
                CallManager.shared.startGroupCall(groupID: group.groupID, groupName: group.name, type: .voice)
            } label: {
                VStack(spacing: 6) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12).fill(AppColors.composerPanelIconBackground).frame(width: 56, height: 56)
                        Image(systemName: "phone.fill").font(.system(size: 22)).foregroundColor(AppColors.primaryText)
                    }
                    Text(L10n.tr("call.voice")).font(.system(size: 11)).foregroundColor(AppColors.secondaryText)
                }
            }

            Button {
                pendingComposerPanel = nil
                activeComposerPanel = nil
                CallManager.shared.startGroupCall(groupID: group.groupID, groupName: group.name, type: .video)
            } label: {
                VStack(spacing: 6) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12).fill(AppColors.composerPanelIconBackground).frame(width: 56, height: 56)
                        Image(systemName: "video.fill").font(.system(size: 22)).foregroundColor(AppColors.primaryText)
                    }
                    Text(L10n.tr("call.video")).font(.system(size: 11)).foregroundColor(AppColors.secondaryText)
                }
            }
        }
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity)
        .background {
            GeometryReader { proxy in
                Color.clear.preference(
                    key: ComposerPanelRenderedHeightPreferenceKey.self,
                    value: proxy.size.height
                )
            }
        }
    }
}

// MARK: - Group Message Bubble

struct GroupMessageBubble: View {
    let message: GroupMessage
    let isFromMe: Bool
    var myAvatarURL: String = ""
    var senderAvatarURL: String? = nil
    var senderNickname: String? = nil
    /// Second arg: the thumbnail's global-coordinate frame at tap time
    /// (used by the full-screen gallery for a hero grow-from-thumbnail).
    var onImageTap: ((String, CGRect) -> Void)?
    var onVideoTap: ((String) -> Void)?
    var onReply: ((GroupMessage) -> Void)?
    var onQuoteTap: ((Int) -> Void)?
    var onMention: ((String, String) -> Void)?
    /// Use the group-message direction instead of the embedded asset sender
    /// while independently delivered snapshots are being reconciled.
    var onChatMoneyTap: ((ChatMoneyPayload, Bool) -> Void)?

    @State private var swipeOffset: CGFloat = 0
    @State private var showMenu = false

    private var displaySenderAvatarURL: String {
        if let senderAvatarURL, !senderAvatarURL.isBlank { return senderAvatarURL }
        return message.senderAvatar
    }

    private var displaySenderNickname: String {
        if let senderNickname, !senderNickname.isBlank { return senderNickname }
        return message.senderNickname
    }

    var body: some View {
        if let receipt = message.chatMoneyReceiptPayload {
            ChatMoneyReceiptTip(payload: receipt)
        } else if message.isSystem {
            HStack {
                Spacer()
                Text(message.content)
                    .font(.system(size: 12))
                    .foregroundColor(AppColors.secondaryText)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(AppColors.separator.opacity(0.5))
                    .cornerRadius(10)
                Spacer()
            }
            .padding(.vertical, 4)
        } else {
        HStack(alignment: .bottom, spacing: 8) {
            if isFromMe { Spacer(minLength: 40) }

            if !isFromMe {
                UserAvatarButton(
                    userID: message.senderID,
                    avatarURL: displaySenderAvatarURL,
                    size: 36,
                    accessibilityName: displaySenderNickname,
                    onLongPress: {
                        onMention?(message.senderID, displaySenderNickname)
                    }
                )
            }

            VStack(alignment: isFromMe ? .trailing : .leading, spacing: 3) {
                if let reply = message.replyTo {
                    QuotedMessageView(
                        senderName: reply.senderID == AuthManager.shared.currentUser?.userID ? L10n.tr("common.me") : (UserCacheManager.shared.getUser(reply.senderID)?.nickname ?? reply.senderID),
                        content: reply.content,
                        msgType: reply.msgType,
                        isFromMe: isFromMe,
                        onTap: { onQuoteTap?(reply.id) }
                    )
                }

                if message.isImage {
                    CachedAsyncImage(url: message.content)
                        .onTapCaptureFrame { frame in
                            onImageTap?(message.content, frame)
                        }
                        .longPressToSaveImage(url: message.content)
                } else if message.isVideo {
                    ZStack {
                        VideoThumbnailView(videoURL: message.content)
                            .frame(maxWidth: 200, maxHeight: 250)
                            .cornerRadius(16)

                        Image(systemName: "play.circle.fill")
                            .font(.system(size: 44))
                            .foregroundColor(.white)
                            .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 2)
                    }
                    .cornerRadius(16)
                    .onTapGesture {
                        onVideoTap?(message.content)
                    }
                    .longPressToSaveVideo(url: message.content)
                } else if message.isVoice {
                    VoiceBubbleView(
                        url: message.voiceURL ?? "",
                        duration: message.voiceDuration,
                        isFromMe: isFromMe
                    )
                } else if let moneyPayload = message.chatMoneyPayload {
                    ChatMoneyBubble(
                        payload: moneyPayload,
                        timeText: message.formattedTime,
                        isFromMe: isFromMe,
                        senderName: isFromMe ? nil : displaySenderNickname,
                        onTap: { onChatMoneyTap?(moneyPayload, isFromMe) }
                    )
                    .onLongPressGesture(minimumDuration: 0.5) {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        showMenu = true
                    }
                    .confirmationDialog("", isPresented: $showMenu, titleVisibility: .hidden) {
                        Button(L10n.tr("common.reply")) { onReply?(message) }
                        if !isFromMe {
                            Button("@\(displaySenderNickname)") {
                                onMention?(message.senderID, displaySenderNickname)
                            }
                        }
                        Button(L10n.tr("common.cancel"), role: .cancel) {}
                    }
                } else if let stickerPayload = message.stickerPayload {
                    StickerMessageBubble(
                        payload: stickerPayload,
                        timeText: message.formattedTime,
                        isFromMe: isFromMe,
                        senderName: isFromMe ? nil : displaySenderNickname
                    )
                    .onLongPressGesture(minimumDuration: 0.5) {
                        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                        impactFeedback.impactOccurred()
                        showMenu = true
                    }
                    .confirmationDialog("", isPresented: $showMenu, titleVisibility: .hidden) {
                        Button(L10n.tr("common.reply")) { onReply?(message) }
                        if !isFromMe {
                            Button("@\(displaySenderNickname)") {
                                onMention?(message.senderID, displaySenderNickname)
                            }
                        }
                        Button(L10n.tr("common.cancel"), role: .cancel) {}
                    }
                } else if let giftPayload = message.giftPayload {
                    GiftMessageBubble(
                        payload: giftPayload,
                        timeText: message.formattedTime,
                        isFromMe: isFromMe,
                        senderName: isFromMe ? nil : displaySenderNickname,
                        recipientFallback: L10n.tr("group.member"),
                        recipientAvatarFallback: giftPayload.recipientID == AuthManager.shared.currentUser?.userID
                            ? myAvatarURL
                            : nil
                    )
                    .onLongPressGesture(minimumDuration: 0.5) {
                        let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                        impactFeedback.impactOccurred()
                        showMenu = true
                    }
                    .confirmationDialog("", isPresented: $showMenu, titleVisibility: .hidden) {
                        Button(L10n.tr("common.reply")) { onReply?(message) }
                        if !isFromMe {
                            Button("@\(displaySenderNickname)") {
                                onMention?(message.senderID, displaySenderNickname)
                            }
                        }
                        Button(L10n.tr("common.cancel"), role: .cancel) {}
                    }
                } else {
                    TimestampedTextBubble(
                        content: message.content,
                        timeText: message.formattedTime,
                        isFromMe: isFromMe,
                        senderName: isFromMe ? nil : displaySenderNickname
                    )
                        .onLongPressGesture(minimumDuration: 0.5) {
                            let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                            impactFeedback.impactOccurred()
                            showMenu = true
                        }
                        .confirmationDialog("", isPresented: $showMenu, titleVisibility: .hidden) {
                            Button(L10n.tr("common.copy")) { UIPasteboard.general.string = message.content }
                            Button(L10n.tr("common.reply")) { onReply?(message) }
                            if !isFromMe {
                                Button("@\(displaySenderNickname)") {
                                    onMention?(message.senderID, displaySenderNickname)
                                }
                            }
                            Button(L10n.tr("common.cancel"), role: .cancel) {}
                        }
                }
            }

            if isFromMe {
                UserAvatarButton(
                    userID: AuthManager.shared.currentUser?.userID ?? message.senderID,
                    avatarURL: myAvatarURL,
                    size: 36,
                    accessibilityName: L10n.tr("common.me")
                )
            }

            if !isFromMe { Spacer(minLength: 40) }
        }
        .padding(.vertical, 2)
        .offset(x: swipeOffset)
        .gesture(
            DragGesture(minimumDistance: 30)
                .onChanged { value in
                    let h = value.translation.width
                    if (isFromMe && h < 0) || (!isFromMe && h > 0) {
                        swipeOffset = h * 0.4
                    }
                }
                .onEnded { value in
                    if abs(value.translation.width) > 50 {
                        onReply?(message)
                    }
                    withAnimation(.spring(response: 0.3)) { swipeOffset = 0 }
                }
        )
        }
    }
}

// MARK: - Pending Group Bubble

struct PendingGroupBubble: View {
    let pending: PendingGroupText
    var avatarURL: String = ""
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Spacer(minLength: 40)
            HStack(alignment: .center, spacing: 6) {
                if pending.status == .failed {
                    Button {
                        onRetry?()
                    } label: {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(.red)
                            .font(.system(size: 20))
                    }
                }

                TimestampedTextBubble(
                    content: pending.content,
                    timeText: pending.formattedTime,
                    isFromMe: true
                )
            }

            UserAvatarButton(
                userID: AuthManager.shared.currentUser?.userID ?? "",
                avatarURL: avatarURL,
                size: 36,
                accessibilityName: L10n.tr("common.me")
            )
        }
        .padding(.vertical, 2)
    }
}

struct PendingGroupStickerBubble: View {
    let pending: PendingGroupSticker
    var avatarURL: String = ""
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Spacer(minLength: 40)
            HStack(alignment: .center, spacing: 6) {
                if pending.status == .failed {
                    Button {
                        onRetry?()
                    } label: {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(.red)
                            .font(.system(size: 20))
                    }
                }

                if let payload = StickerMessagePayload.parse(pending.content) {
                    StickerMessageBubble(
                        payload: payload,
                        timeText: pending.formattedTime,
                        isFromMe: true
                    )
                }
            }

            UserAvatarButton(
                userID: AuthManager.shared.currentUser?.userID ?? "",
                avatarURL: avatarURL,
                size: 36,
                accessibilityName: L10n.tr("common.me")
            )
        }
        .padding(.vertical, 2)
    }
}

struct PendingGroupMediaBubble: View {
    let pending: PendingGroupMedia
    var avatarURL: String = ""
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Spacer(minLength: 40)
            HStack(alignment: .center, spacing: 6) {
                if pending.status == .failed {
                    Button(action: { onRetry?() }) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(.red)
                            .font(.system(size: 20))
                    }
                }

                Group {
                    if pending.msgType == "image", let image = UIImage(data: pending.data) {
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFit()
                    } else {
                        ZStack {
                            Color.blue.opacity(0.1)
                            Image(systemName: "video.fill")
                                .font(.system(size: 32))
                                .foregroundColor(AppColors.secondaryText)
                        }
                    }
                }
                .frame(width: 200, height: 140)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(alignment: .bottomTrailing) {
                    Text(pending.formattedTime)
                        .font(.system(size: 10))
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(.black.opacity(0.45), in: Capsule())
                        .padding(6)
                }
                .opacity(pending.status == .sending ? 0.72 : 1)
            }

            UserAvatarButton(
                userID: AuthManager.shared.currentUser?.userID ?? "",
                avatarURL: avatarURL,
                size: 36,
                accessibilityName: L10n.tr("common.me")
            )
        }
        .padding(.vertical, 2)
    }
}
