// BWChat/Views/ChatView.swift
// Premium chat conversation page

import SwiftUI
import PhotosUI
import AVKit
import AVFoundation
import UniformTypeIdentifiers
import UIKit

private struct ChatMessageRenderItem: Identifiable {
    let message: Message
    let previousTimestamp: String?

    var id: Int { message.id }
}

struct ChatView: View {
    let contact: Contact
    var onMarkRead: (() -> Void)?
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel: ChatViewModel
    @ObservedObject private var callManager = CallManager.shared
    @ObservedObject private var appearanceStore = ChatAppearanceStore.shared
    @State private var selectedMediaItems: [PhotosPickerItem] = []
    @State private var previewVideoURL: String?
    @State private var highlightedMessageID: Int?
    @State private var activeComposerPanel: ComposerPanel?
    @State private var pendingComposerPanel: ComposerPanel?
    @State private var isReplacingStickerPanelWithKeyboard = false
    @State private var isKeyboardLayoutVisible = false
    @State private var showGiftSheet = false
    @State private var redPacketOverlayPayload: ChatMoneyPayload?
    @State private var redPacketOverlayIsSender = false
    @StateObject private var moneyStore = ChatMoneyStore()
    @State private var isVoiceMode = false
    @StateObject private var recorder = AudioRecorderManager()
    @State private var voiceCancelZone = false
    @State private var isInputFocused = false
    @State private var inputTextHeight: CGFloat = 40
    @State private var composerPanelHeight: CGFloat = StickerPanel.preferredHeight
    @State private var composerSelection = NSRange(location: 0, length: 0)
    @State private var isViewVisible = false
    @State private var hasCompletedInitialLoad = false
    @State private var toastMessage: String?

    private let bottomScrollAnchorID = "chat-bottom-anchor"
    private let composerPanelAnimation = Animation.easeInOut(duration: 0.25)
    private let composerActionButtonHeight: CGFloat = 54

    private var showsComposerMicrophone: Bool {
        !isInputFocused && selectedComposerPanel == nil && viewModel.inputText.isEmpty
    }

    private var selectedComposerPanel: ComposerPanel? {
        pendingComposerPanel ?? activeComposerPanel
    }

    private var reservesStickerPanelSpace: Bool {
        !isVoiceMode && (
            activeComposerPanel == .stickers
                || isReplacingStickerPanelWithKeyboard
                || isKeyboardLayoutVisible
        )
    }

    private var isSelfChat: Bool {
        contact.userID == AuthManager.shared.currentUser?.userID
    }

    private var myAvatarURL: String {
        AuthManager.shared.currentUser?.avatarURL ?? ""
    }

    private var moneyContext: ChatMoneyConversationContext {
        .direct(id: contact.userID, name: contact.nickname, avatarURL: contact.avatarURL)
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
        recipient: ChatMoneyRecipient? = nil
    ) {
        navigator.push(
            ChatMoneyComposerSheet(
                store: moneyStore,
                kind: kind,
                context: moneyContext,
                initialRecipient: recipient,
                onCreated: { result in
                    viewModel.appendCreatedChatMoneyMessage(result)
                    navigator.pop()
                },
                onOpenWallet: {
                    showWallet(afterPopping: 1)
                }
            )
        )
    }

    private func showWallet(afterPopping count: Int) {
        navigator.pop(count: count)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            navigator.push(WalletView())
        }
    }

    private var renderedMessages: [ChatMessageRenderItem] {
        var rows: [ChatMessageRenderItem] = []
        rows.reserveCapacity(viewModel.messages.count)

        var previous: String?
        for message in viewModel.messages {
            rows.append(ChatMessageRenderItem(message: message, previousTimestamp: previous))
            previous = message.timestamp
        }
        return rows
    }

    init(contact: Contact, onMarkRead: (() -> Void)? = nil) {
        self.contact = contact
        self.onMarkRead = onMarkRead
        _viewModel = StateObject(wrappedValue: ChatViewModel(contact: contact))
    }

    private func setActiveChat(_ active: Bool) {
        WebSocketService.shared.activeChatUserID = active ? contact.userID : nil
    }

    private func markConversationRead() {
        NotificationCenter.default.post(
            name: .conversationDidMarkRead,
            object: ConversationReadTarget.direct(userID: contact.userID)
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
        // `keyboardWillShow` can arrive after the user has already tapped the
        // sticker/plus button and requested a keyboard -> panel transition.
        // Keep that newer request authoritative instead of closing it again.
        guard pendingComposerPanel == nil else { return }
        guard activeComposerPanel != nil else { return }

        // SwiftUI applies the keyboard's final safe-area inset before the
        // keyboard finishes moving onscreen. The panel must stop contributing
        // layout height in that same update or the composer is lifted by both
        // the keyboard inset and the still-animating panel.
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            activeComposerPanel = nil
        }
    }

    private func focusComposerTextInput() {
        pendingComposerPanel = nil
        isReplacingStickerPanelWithKeyboard = activeComposerPanel == .stickers
        if isReplacingStickerPanelWithKeyboard {
            isKeyboardLayoutVisible = true
        }
        if isVoiceMode {
            withAnimation(.easeOut(duration: 0.12)) {
                isVoiceMode = false
            }
        }

        // Keep the current panel in place until UIKit starts presenting the
        // keyboard. `handleKeyboardWillShow` then removes it using the same
        // duration as the keyboard, producing one continuous height swap.
        isInputFocused = true
    }

    private func dismissComposerInput() {
        pendingComposerPanel = nil
        isReplacingStickerPanelWithKeyboard = false
        isInputFocused = false
        withAnimation(composerPanelAnimation) {
            activeComposerPanel = nil
        }
        hideKeyboard()
    }

    private func activateVoiceComposer() {
        pendingComposerPanel = nil
        isReplacingStickerPanelWithKeyboard = false
        activeComposerPanel = nil
        isInputFocused = false
        hideKeyboard()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.easeOut(duration: 0.14)) {
            isVoiceMode = true
        }
    }

    private func toggleComposerPanel(_ panel: ComposerPanel) {
        isReplacingStickerPanelWithKeyboard = false
        let isClosing = selectedComposerPanel == panel
        UISelectionFeedbackGenerator().selectionChanged()

        if isClosing {
            pendingComposerPanel = nil
            withAnimation(composerPanelAnimation) {
                activeComposerPanel = nil
            }
            return
        }

        isVoiceMode = false
        if isInputFocused {
            // Resign the UIKit text view before changing panel layout. If the
            // panel is inserted first, SwiftUI can refresh the representable
            // while focus is still true and immediately request the keyboard
            // again, which clears the just-opened panel.
            isInputFocused = false
            hideKeyboard()
            pendingComposerPanel = panel
            withAnimation(composerPanelAnimation) {
                activeComposerPanel = panel
            }
            completeComposerPanelTransitionAfterKeyboardDismiss(panel)
        } else {
            pendingComposerPanel = nil
            hideKeyboard()
            withAnimation(composerPanelAnimation) {
                activeComposerPanel = panel
            }
        }
    }

    private func completeComposerPanelTransitionAfterKeyboardDismiss(_ panel: ComposerPanel) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
            guard pendingComposerPanel == panel, !isInputFocused, !isVoiceMode else { return }
            withAnimation(composerPanelAnimation) {
                activeComposerPanel = panel
            }
            pendingComposerPanel = nil
        }
    }

    private func handleKeyboardWillShow(_ notification: Notification) {
        // Preserve the exact height currently occupied by the sticker panel
        // during a sticker -> keyboard replacement. The first will-show frame
        // can report a transient keyboard height; applying it here makes the
        // reserved spacer grow before the keyboard is visible and briefly
        // lifts the composer.
        if !isReplacingStickerPanelWithKeyboard {
            updateComposerPanelHeight(from: notification)
        }
        if isReplacingStickerPanelWithKeyboard {
            isKeyboardLayoutVisible = true
        } else {
            withAnimation(keyboardAnimation(from: notification)) {
                isKeyboardLayoutVisible = true
            }
        }
        closeComposerPanelForKeyboard()
    }

    private func handleKeyboardWillHide(_ notification: Notification) {
        withAnimation(keyboardAnimation(from: notification)) {
            isKeyboardLayoutVisible = false
        }
        isInputFocused = false
        isReplacingStickerPanelWithKeyboard = false
        guard let panel = pendingComposerPanel, !isVoiceMode else { return }
        withAnimation(keyboardAnimation(from: notification)) {
            activeComposerPanel = panel
        }
    }

    private func handleKeyboardDidShow() {
        guard isReplacingStickerPanelWithKeyboard else { return }
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            isReplacingStickerPanelWithKeyboard = false
        }
    }

    private func updateComposerPanelHeight(from notification: Notification) {
        guard let keyboardFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
            return
        }
        let bottomInset = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .safeAreaInsets.bottom ?? 0
        let availableHeight = keyboardFrame.height - bottomInset
        // Match the custom panel to the keyboard's actual safe-area height.
        // Capping this at the old 250pt preferred height made the composer
        // jump upward when a taller system keyboard replaced the panel.
        composerPanelHeight = max(StickerPanel.minimumHeight, availableHeight)
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

    private func pendingScrollID(_ id: UUID) -> String {
        "pending-\(id.uuidString)"
    }

    private func scrollChatToBottom(proxy: ScrollViewProxy, animated: Bool = true) {
        guard isViewVisible else { return }

        let scrollAction = {
            proxy.scrollTo(bottomScrollAnchorID, anchor: .top)
        }

        // The bottom anchor is outside the message padding, so scrolling to it
        // reaches the true end of the flipped ScrollView instead of stopping on
        // the newest bubble with a little remaining scroll range.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            guard isViewVisible else { return }
            if animated {
                withAnimation(.easeOut(duration: 0.2), scrollAction)
            } else {
                scrollAction()
            }
        }
    }

    private func previousTimestamp(for pending: PendingMessage) -> String? {
        let visiblePending = viewModel.visiblePendingMessages
        guard let idx = visiblePending.firstIndex(where: { $0.id == pending.id }) else {
            return viewModel.messages.last?.timestamp
        }
        if idx > 0 {
            return visiblePending[idx - 1].createdAt.iso8601String
        }
        return viewModel.messages.last?.timestamp
    }

    private func handleImageTap(url: String, frame: CGRect) {
        pendingComposerPanel = nil
        isInputFocused = false
        hideKeyboard()
        let allImages = viewModel.messages.filter(\.isImage).map(\.content)
        ImageGalleryState.shared.show(
            urls: allImages,
            index: allImages.firstIndex(of: url) ?? 0,
            sourceFrame: frame,
            loadMoreOlder: {
                await loadMoreGalleryImages()
            }
        )
    }

    private func loadMoreGalleryImages() async -> Int {
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

    @ViewBuilder
    private func messageRow(_ message: Message, previousTimestamp: String?, proxy: ScrollViewProxy) -> some View {
        let isFromMe = message.senderID == AuthManager.shared.currentUser?.userID

        VStack(spacing: 4) {
            if TimestampHelper.shouldShowTime(
                current: message.timestamp,
                previous: previousTimestamp
            ) {
                TimeSeparatorView(timestamp: message.timestamp)
            }

            MessageBubble(
                message: message,
                isFromMe: isFromMe,
                avatarURL: isFromMe ? myAvatarURL : contact.avatarURL,
                onImageTap: handleImageTap,
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
                peerName: contact.nickname,
                peerUserID: contact.userID,
                recipientAvatarURL: isFromMe ? contact.avatarURL : myAvatarURL,
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

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ZStack {
                    ChatBackgroundLayer(
                        background: appearanceStore.effectiveBackground(
                            targetType: .dm,
                            targetID: contact.userID
                        )
                    )

                    ScrollView {
                        VStack(spacing: 0) {
                            Color.clear
                                .frame(height: 1)
                                .id(bottomScrollAnchorID)

                            LazyVStack(spacing: 4) {
                                ForEach(viewModel.visiblePendingMessages.reversed()) { pending in
                                    VStack(spacing: 4) {
                                        if TimestampHelper.shouldShowTime(
                                            current: pending.createdAt.iso8601String,
                                            previous: previousTimestamp(for: pending)
                                        ) {
                                            TimeSeparatorView(timestamp: pending.createdAt.iso8601String)
                                        }

                                        PendingMessageBubble(pending: pending, avatarURL: myAvatarURL) {
                                            Task { await viewModel.retryPending(pending) }
                                        }
                                    }
                                    .id(pendingScrollID(pending.id))
                                    .flippedRow()
                                }

                                ForEach(renderedMessages.reversed()) { row in
                                    messageRow(row.message, previousTimestamp: row.previousTimestamp, proxy: proxy)
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
                        scrollChatToBottom(proxy: proxy)
                    }
                    .onChange(of: viewModel.visiblePendingMessages.count) { count in
                        guard count > 0 else { return }
                        scrollChatToBottom(proxy: proxy)
                    }
                    .task {
                        guard !hasCompletedInitialLoad else { return }
                        await viewModel.loadMessages()
                        await appearanceStore.loadIfNeeded()
                        guard !Task.isCancelled, isViewVisible else { return }
                        hasCompletedInitialLoad = true
                        scrollChatToBottom(proxy: proxy, animated: false)
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
                let senderName = replyMsg.senderID == AuthManager.shared.currentUser?.userID ? L10n.tr("common.me") : contact.nickname
                ReplyPreviewBar(
                    senderName: senderName,
                    content: replyMsg.content,
                    msgType: replyMsg.msgType,
                    onCancel: { viewModel.cancelReply() }
                )
            }

            inputBar
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .background(AppColors.secondaryBackground)
        .navigationTitle(contact.nickname)
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button(L10n.tr("common.done")) {
                    dismissComposerInput()
                }
                .font(.system(size: 15, weight: .semibold))
            }
        }
        .overlay { voiceRecordingOverlay }
        .sheet(isPresented: $showGiftSheet) {
            GiftPickerSheet(
                source: .fixed(GiftRecipient(
                    id: contact.userID,
                    name: contact.nickname,
                    avatarURL: contact.avatarURL
                )),
                onSend: { gift, _ in
                    try await viewModel.sendGift(gift)
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
        .onAppear {
            isViewVisible = true
            setActiveChat(true)
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
        .onReceive(WebSocketService.shared.chatMoneyUpdatePublisher) { update in
            moneyStore.apply(update)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { notification in
            handleKeyboardWillHide(notification)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
            handleKeyboardDidShow()
        }
        .onDisappear {
            isViewVisible = false
            isKeyboardLayoutVisible = false
            setActiveChat(false)
        }
        .onChange(of: callManager.currentCall != nil) { hasCalling in
            if hasCalling {
                pendingComposerPanel = nil
                isInputFocused = false
                activeComposerPanel = nil
                hideKeyboard()
            }
        }
        .onChange(of: callManager.currentCall?.state) { newState in
            if newState == .connected || newState == .connecting {
                pendingComposerPanel = nil
                isInputFocused = false
                activeComposerPanel = nil
                hideKeyboard()
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

    private var inputBar: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 6) {
                if isVoiceMode {
                    holdToRecordButton
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
                            Button {
                                toggleComposerPanel(.stickers)
                            } label: {
                                Image(systemName: activeComposerPanel == .stickers ? "face.smiling.fill" : "face.smiling")
                                    .font(.system(size: 28))
                                    .foregroundColor(AppColors.accent)
                                    .frame(width: 40, height: 40)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(
                                ChatComposerActionButtonStyle(
                                    isActive: activeComposerPanel == .stickers,
                                    showsActiveBackground: false
                                )
                            )
                            .accessibilityLabel(L10n.tr("chat.stickers"))
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

                                Button {
                                    toggleComposerPanel(.plus)
                                } label: {
                                    Image(systemName: activeComposerPanel == .plus ? "xmark.circle.fill" : "plus.circle.fill")
                                        .font(.system(size: 28))
                                        .foregroundColor(AppColors.accent)
                                        .frame(width: 40, height: 40)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(
                                    ChatComposerActionButtonStyle(
                                        isActive: activeComposerPanel == .plus,
                                        showsActiveBackground: false
                                    )
                                )
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
                    chatPlusMenu
                }
            }
            .frame(maxWidth: .infinity)
            .frame(
                height: reservesStickerPanelSpace
                    ? composerPanelHeight
                    : nil,
                alignment: .top
            )
            .clipped()
            .background {
                if reservesStickerPanelSpace {
                    Color(uiColor: .secondarySystemBackground)
                        .opacity(0.98)
                        .ignoresSafeArea(edges: .bottom)
                }
            }
        }
        .chatComposerBarBackground(
            showsStickerPanel: selectedComposerPanel == .stickers || isReplacingStickerPanelWithKeyboard
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

    private var holdToRecordButton: some View {
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
                            finishVoiceRecording()
                        }
                    }
            )
    }

    @ViewBuilder
    private var voiceRecordingOverlay: some View {
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
                            voiceWaveAnimation
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

    private var voiceWaveAnimation: some View {
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

    private func finishVoiceRecording() {
        guard let result = recorder.stopRecording() else { return }
        Task {
            await viewModel.sendVoice(data: result.data, duration: result.duration)
        }
    }

    private var chatPlusMenu: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4),
            spacing: 18
        ) {
            PhotosPicker(selection: $selectedMediaItems, maxSelectionCount: 9, matching: .any(of: [.images, .videos])) {
                VStack(spacing: 6) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(AppColors.separator)
                            .frame(width: 56, height: 56)
                        Image(systemName: "photo")
                            .font(.system(size: 22))
                            .foregroundColor(AppColors.primaryText)
                    }
                    Text(L10n.tr("chat.album"))
                        .font(.system(size: 11))
                        .foregroundColor(AppColors.secondaryText)
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

            if !isSelfChat {
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
                    showChatMoneyComposer(kind: .redPacket)
                }

                ChatMoneyPlusMenuTile(kind: .transfer) {
                    pendingComposerPanel = nil
                    activeComposerPanel = nil
                    isInputFocused = false
                    showChatMoneyComposer(kind: .transfer)
                }

                Button {
                    pendingComposerPanel = nil
                    activeComposerPanel = nil
                    CallManager.shared.startCall(to: contact.userID, nickname: contact.nickname, avatarURL: contact.avatarURL, type: .voice)
                } label: {
                    VStack(spacing: 6) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 12).fill(AppColors.separator).frame(width: 56, height: 56)
                            Image(systemName: "phone.fill").font(.system(size: 22)).foregroundColor(AppColors.primaryText)
                        }
                        Text(L10n.tr("call.voice")).font(.system(size: 11)).foregroundColor(AppColors.secondaryText)
                    }
                }

                Button {
                    pendingComposerPanel = nil
                    activeComposerPanel = nil
                    CallManager.shared.startCall(to: contact.userID, nickname: contact.nickname, avatarURL: contact.avatarURL, type: .video)
                } label: {
                    VStack(spacing: 6) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 12).fill(AppColors.separator).frame(width: 56, height: 56)
                            Image(systemName: "video.fill").font(.system(size: 22)).foregroundColor(AppColors.primaryText)
                        }
                        Text(L10n.tr("call.video")).font(.system(size: 11)).foregroundColor(AppColors.secondaryText)
                    }
                }
            }
        }
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

// MARK: - Pending Message Bubble

struct PendingMessageBubble: View {
    let pending: PendingMessage
    var avatarURL: String = ""
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Spacer(minLength: 40)

            VStack(alignment: .trailing, spacing: 2) {
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

                    if pending.msgType == "text" && !pending.content.isEmpty {
                        TimestampedTextBubble(
                            content: pending.content,
                            timeText: pending.formattedTime,
                            isFromMe: true
                        )
                    } else if let imageData = pending.imageData, let uiImage = UIImage(data: imageData) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: 200)
                            .cornerRadius(14)
                    } else if pending.videoData != nil {
                        ZStack {
                            RoundedRectangle(cornerRadius: 14)
                                .fill(Color.blue.opacity(0.1))
                                .frame(width: 200, height: 140)

                            Image(systemName: "video.fill")
                                .font(.system(size: 32))
                                .foregroundColor(AppColors.secondaryText)
                        }
                    } else if pending.msgType == "voice" {
                        HStack(spacing: 6) {
                            Text("\(Int(pending.voiceDuration))\"")
                                .font(.system(size: 14))
                                .foregroundColor(.white)
                            Spacer()
                            HStack(spacing: 2) {
                                ForEach(0..<3, id: \.self) { i in
                                    RoundedRectangle(cornerRadius: 1)
                                        .fill(Color.white)
                                        .frame(width: 2, height: CGFloat([6, 10, 6][i]))
                                }
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .frame(width: 100)
                        .background(AppColors.sentBubbleGradient)
                        .cornerRadius(18, corners: [.topLeft, .topRight, .bottomLeft])
                    } else if pending.msgType == "sticker",
                              let payload = StickerMessagePayload.parse(pending.content) {
                        StickerMessageBubble(
                            payload: payload,
                            timeText: pending.formattedTime,
                            isFromMe: true
                        )
                    }
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

// Helper for fullScreenCover binding
struct ImagePreviewItem: Identifiable {
    let id = UUID()
    let url: String
}

struct VideoPreviewItem: Identifiable {
    let id = UUID()
    let url: String
}

// Transferable for picking videos from PhotosPicker
struct VideoTransferable: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let tempDir = FileManager.default.temporaryDirectory
            let filename = "video_\(UUID().uuidString).\(received.file.pathExtension)"
            let copy = tempDir.appendingPathComponent(filename)
            if FileManager.default.fileExists(atPath: copy.path) {
                try FileManager.default.removeItem(at: copy)
            }
            try FileManager.default.copyItem(at: received.file, to: copy)
            return Self(url: copy)
        }
    }
}

// MARK: - Audio Recorder Manager

struct VoiceRecordingResult {
    let data: Data
    let duration: Double
}

@MainActor
class AudioRecorderManager: ObservableObject {
    @Published var isRecording = false
    @Published var recordingDuration: Double = 0

    private var audioRecorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var timer: Timer?
    private var startTime: Date?

    var formattedDuration: String {
        let secs = Int(recordingDuration)
        let mins = secs / 60
        let rem = secs % 60
        return String(format: "%d:%02d", mins, rem)
    }

    func startRecording() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
        } catch {
            return
        }

        let tempDir = FileManager.default.temporaryDirectory
        let url = tempDir.appendingPathComponent("voice_\(UUID().uuidString).m4a")
        recordingURL = url

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 22050,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue
        ]

        do {
            audioRecorder = try AVAudioRecorder(url: url, settings: settings)
            audioRecorder?.record()
            isRecording = true
            startTime = Date()
            recordingDuration = 0
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self = self, let start = self.startTime else { return }
                    self.recordingDuration = Date().timeIntervalSince(start)
                }
            }
        } catch { }
    }

    func stopRecording() -> VoiceRecordingResult? {
        timer?.invalidate()
        timer = nil
        audioRecorder?.stop()
        isRecording = false

        guard let url = recordingURL,
              let start = startTime else { return nil }

        let duration = Date().timeIntervalSince(start)
        startTime = nil

        guard duration >= 1.0 else {
            try? FileManager.default.removeItem(at: url)
            recordingURL = nil
            return nil
        }

        guard let data = try? Data(contentsOf: url) else {
            recordingURL = nil
            return nil
        }

        try? FileManager.default.removeItem(at: url)
        recordingURL = nil

        return VoiceRecordingResult(data: data, duration: duration)
    }

    func cancelRecording() {
        timer?.invalidate()
        timer = nil
        audioRecorder?.stop()
        isRecording = false
        startTime = nil
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        recordingURL = nil
        recordingDuration = 0
    }
}
