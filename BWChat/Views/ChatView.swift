// BWChat/Views/ChatView.swift
// Premium chat conversation page

import SwiftUI
import PhotosUI
import AVKit
import AVFoundation
import UniformTypeIdentifiers
import UIKit
import Combine

private struct ChatMessageRenderItem: Identifiable {
    let message: Message
    let showsTimestamp: Bool
    let resolvedReply: ReplyPreview?

    var id: Int { message.id }
}

private struct ChatPendingMessageRenderItem: Identifiable {
    let pending: PendingMessage
    let resolvedReply: ReplyPreview?

    var id: UUID { pending.id }
}

private enum ChatTimelineRenderItem: Identifiable {
    case message(ChatMessageRenderItem)
    case pending(ChatPendingMessageRenderItem)

    var id: String {
        switch self {
        case .message(let row):
            return ChatTimelineIdentity.value(
                clientMessageID: row.message.clientMessageID,
                serverID: row.message.id
            )
        case .pending(let row):
            return "client:\(row.pending.id.uuidString)"
        }
    }

    var chronologicalDate: Date? {
        switch self {
        case .message(let row): return TimestampHelper.parse(row.message.timestamp)
        case .pending(let row): return row.pending.createdAt
        }
    }

    var timestamp: String {
        switch self {
        case .message(let row): return row.message.timestamp
        case .pending(let row): return row.pending.createdAt.iso8601String
        }
    }

}

/// Import selected assets concurrently and preserve the Photos picker order.
/// Keep this step limited to obtaining the transferable bytes/file URL: image
/// compression and thumbnail generation must not delay the optimistic bubble
/// or the start of the upload.
func prepareOutgoingMediaDrafts(from items: [PhotosPickerItem]) async -> [OutgoingMediaDraft] {
    await withTaskGroup(of: (Int, OutgoingMediaDraft)?.self) { group in
        for (index, item) in items.enumerated() {
            group.addTask {
                if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
                    guard let movie = try? await item.loadTransferable(type: VideoTransferable.self) else {
                        return nil
                    }
                    let movieURL = movie.url
                    let ext = movieURL.pathExtension.lowercased()
                    return (index, OutgoingMediaDraft(
                        kind: .video,
                        localFileURL: movieURL,
                        filename: "video_\(UUID().uuidString)_\(index).\(ext.isEmpty ? "mp4" : ext)"
                    ))
                }

                guard item.supportedContentTypes.contains(where: { $0.conforms(to: .image) }),
                      let sourceData = try? await item.loadTransferable(type: Data.self) else {
                    return nil
                }
                return (index, OutgoingMediaDraft(
                    kind: .image,
                    data: sourceData,
                    filename: "image_\(UUID().uuidString)_\(index).jpg"
                ))
            }
        }

        var prepared: [(Int, OutgoingMediaDraft)] = []
        prepared.reserveCapacity(items.count)
        for await result in group {
            if let result { prepared.append(result) }
        }
        return prepared.sorted { $0.0 < $1.0 }.map(\.1)
    }
}

struct ChatView: View {
    let contact: Contact
    let initialReadThroughMessageID: Int?
    var onMarkRead: ((Int?) -> Void)?
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel: ChatViewModel
    @ObservedObject private var callManager = CallManager.shared
    @ObservedObject private var appearanceStore = ChatAppearanceStore.shared
    @ObservedObject private var draftStore = ChatDraftStore.shared
    @State private var selectedMediaItems: [PhotosPickerItem] = []
    @State private var previewVideoURL: String?
    @State private var highlightedMessageID: Int?
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
    @StateObject private var moneyStore = ChatMoneyStore()
    @State private var isVoiceMode = false
    @StateObject private var recorder = AudioRecorderManager()
    @State private var voiceCancelZone = false
    @State private var isInputFocused = false
    @State private var inputTextHeight: CGFloat = 40
    @State private var composerSelection = NSRange(location: 0, length: 0)
    @State private var isViewVisible = false
    @State private var hasCompletedInitialLoad = false
    @State private var toastMessage: String?
    @State private var messageMenuTarget: MessageMenuTarget?
    @State private var isMessageMenuTouchSequenceActive = false
    @State private var recalledEditableTexts: [Int: String] = [:]
    @State private var hasRestoredDraft = false
    @State private var isNearBottom = true
    @State private var newMessagesBelowCount = 0
    @State private var replyLocatorMessageIDs: [Int] = []
    @State private var interactionMode: ChatInteractionMode = .normal
    @State private var showSelectionDeleteConfirmation = false
    @State private var showForwardModeDialog = false
    @State private var forwardDraft: ForwardFlowDraft?
    @State private var timelineRows: [ChatMessageRenderItem]
    @State private var timelineSnapshot: ChatTimelineSnapshot<ChatTimelineRenderItem>
    @State private var lastVisiblePendingCount: Int
    @State private var didSubmitInitialRead = false
    @State private var scrollCommandTask: Task<Void, Never>?

    private let bottomScrollAnchorID = "chat-bottom-anchor"
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

    private var isSelfChat: Bool {
        contact.userID == AuthManager.shared.currentUser?.userID
    }

    private var selectionState: MessageSelectionState? {
        guard case .selecting(let state) = interactionMode else { return nil }
        return state
    }

    private var isSelectingMessages: Bool { selectionState != nil }

    private var localDeleteEnabled: Bool {
        AppRemoteConfigStore.shared.featureFlags.isEnabled("chat_local_delete_v1", default: true)
    }

    private var multiselectEnabled: Bool {
        AppRemoteConfigStore.shared.featureFlags.isEnabled("chat_multiselect_v1", default: true)
    }

    private var forwardingEnabled: Bool {
        AppRemoteConfigStore.shared.featureFlags.isEnabled("message_forward_single_v1", default: true)
    }

    private var multiForwardingEnabled: Bool {
        AppRemoteConfigStore.shared.featureFlags.isEnabled("message_forward_multi_v1", default: true)
    }

    private var mergedForwardingEnabled: Bool {
        AppRemoteConfigStore.shared.featureFlags.isEnabled("message_forward_merged_create_v1", default: true)
    }

    private var recallEnabled: Bool {
        AppRemoteConfigStore.shared.featureFlags.isEnabled("message_recall_v1", default: true)
    }

    private var myAvatarURL: String {
        AuthManager.shared.currentUser?.avatarURL ?? ""
    }

    private var currentDraftDocument: ComposerDocument {
        ComposerDocument(text: viewModel.inputText, mentions: [])
    }

    private var currentDraftQuote: ChatDraftQuote? {
        guard let message = viewModel.replyingTo else { return nil }
        return ChatDraftQuote(
            messageID: message.id,
            senderID: message.senderID,
            senderName: message.senderID == AuthManager.shared.currentUser?.userID
                ? L10n.tr("common.me")
                : contact.nickname,
            msgType: message.msgType,
            content: message.content,
            timestamp: message.timestamp
        )
    }

    private func restoreDraftIfNeeded() {
        guard !hasRestoredDraft else { return }
        hasRestoredDraft = true
        guard let draft = draftStore.draft(
            conversationType: "dm",
            conversationID: contact.userID
        ) else { return }
        viewModel.inputText = draft.document.text
        composerSelection = NSRange(
            location: (draft.document.text as NSString).length,
            length: 0
        )
        if let quote = draft.quote {
            viewModel.replyingTo = viewModel.messages.first(where: { $0.id == quote.messageID })
                ?? Message(
                    id: quote.messageID,
                    senderID: quote.senderID,
                    receiverID: contact.userID,
                    msgType: quote.msgType,
                    content: quote.content,
                    timestamp: quote.timestamp,
                    replyToID: nil,
                    replyTo: nil
                )
        }
    }

    private func scheduleDraftSave() {
        guard hasRestoredDraft else { return }
        draftStore.scheduleSave(
            document: currentDraftDocument,
            quote: currentDraftQuote,
            conversationType: "dm",
            conversationID: contact.userID
        )
    }

    private func flushDraft() {
        guard hasRestoredDraft else { return }
        draftStore.flush(
            document: currentDraftDocument,
            quote: currentDraftQuote,
            conversationType: "dm",
            conversationID: contact.userID
        )
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
            presentRedPacketOverlay(payload)
        } else {
            showChatMoneyDetail(payload)
        }
    }

    private func presentRedPacketOverlay(_ payload: ChatMoneyPayload) {
        navigator.presentAppOverlay {
            ChatMoneyRedPacketEntryOverlay(
                store: moneyStore,
                initialPayload: payload,
                isSender: redPacketOverlayIsSender,
                onClose: closeRedPacketOverlay,
                onShowDetail: {
                    showRedPacketDetail(payload)
                }
            )
        }
    }

    private func closeRedPacketOverlay() {
        redPacketOverlayPayload = nil
        navigator.dismissAppOverlay()
    }

    private func showChatMoneyDetail(_ payload: ChatMoneyPayload) {
        navigator.push(
            ChatMoneyDetailView(store: moneyStore, initialPayload: payload)
        )
    }

    private func showRedPacketDetail(_ payload: ChatMoneyPayload) {
        redPacketOverlayPayload = nil
        navigator.dismissAppOverlay()
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
        timelineRows
    }

    private var renderedTimeline: [ChatTimelineRenderItem] {
        timelineSnapshot.items
    }

    private static func makeTimelineSnapshot(
        rows: [ChatMessageRenderItem],
        pending: [PendingMessage]
    ) -> ChatTimelineSnapshot<ChatTimelineRenderItem> {
        // HTTP acknowledgement and WebSocket echo can publish a confirmed row
        // while its optimistic row is still present. Prefer the confirmed
        // projection for a shared client identity so LazyVStack never renders
        // two copies (or runs two arrival effects) for one send action.
        var confirmedIDs = Set<String>()
        let uniqueRows = Array(rows.reversed().filter { row in
            confirmedIDs.insert(ChatTimelineRenderItem.message(row).id).inserted
        }.reversed())

        let confirmedTimelineIDs = Set(
            uniqueRows.map { ChatTimelineRenderItem.message($0).id }
        )
        let messagesByID = Dictionary(
            uniqueRows.map { ($0.message.id, $0.message) },
            uniquingKeysWith: { _, latest in latest }
        )
        let pendingRows = pending.map { item in
            ChatPendingMessageRenderItem(
                pending: item,
                resolvedReply: ChatHistoryReplyResolver.directReply(
                    to: item.replyToID,
                    messagesByID: messagesByID
                )
            )
        }
        var pendingIDs = Set<String>()
        let uniquePending = pendingRows.filter { item in
            let timelineID = ChatTimelineRenderItem.pending(item).id
            guard !confirmedTimelineIDs.contains(timelineID) else { return false }
            return pendingIDs.insert(timelineID).inserted
        }

        let items = ChatTimelineOrdering.merge(
            uniqueRows.map(ChatTimelineRenderItem.message),
            uniquePending.map(ChatTimelineRenderItem.pending)
        ) {
            ChatTimelineOrdering.precedes(
                date: $0.chronologicalDate,
                stableID: $0.id,
                date: $1.chronologicalDate,
                stableID: $1.id
            )
        }
        return ChatTimelineSnapshot(items: items)
    }

    private func rebuildTimelineSnapshot(
        rows: [ChatMessageRenderItem]? = nil,
        pending: [PendingMessage]? = nil
    ) {
        let nextSnapshot = Self.makeTimelineSnapshot(
            rows: rows ?? timelineRows,
            pending: pending ?? viewModel.visiblePendingMessages
        )
        timelineSnapshot = nextSnapshot
    }

    private static func makeTimelineRows(_ messages: [Message]) -> [ChatMessageRenderItem] {
        var rows: [ChatMessageRenderItem] = []
        rows.reserveCapacity(messages.count)
        let messagesByID = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })

        var previous: String?
        for message in messages {
            rows.append(ChatMessageRenderItem(
                message: message,
                showsTimestamp: TimestampHelper.shouldShowTime(current: message.timestamp, previous: previous),
                resolvedReply: ChatHistoryReplyResolver.directReply(
                    for: message,
                    messagesByID: messagesByID
                )
            ))
            previous = message.timestamp
        }
        return rows
    }

    init(
        contact: Contact,
        initialReadThroughMessageID: Int? = nil,
        onMarkRead: ((Int?) -> Void)? = nil
    ) {
        self.contact = contact
        self.initialReadThroughMessageID = initialReadThroughMessageID
        self.onMarkRead = onMarkRead
        let model = ChatViewModel(contact: contact)
        let rows = Self.makeTimelineRows(model.messages)
        _viewModel = StateObject(wrappedValue: model)
        _timelineRows = State(initialValue: rows)
        _timelineSnapshot = State(initialValue: Self.makeTimelineSnapshot(
            rows: rows,
            pending: model.visiblePendingMessages
        ))
        _lastVisiblePendingCount = State(initialValue: model.visiblePendingMessages.count)
        let isSelfConversation =
            contact.userID == AuthManager.shared.currentUser?.userID
        _composerSurfaceHeights = State(
            initialValue: ComposerSurfaceHeights(
                stickerHeight: StickerPanel.preferredHeight,
                plusHeight: ComposerPlusPanelMetrics.preferredHeight(
                    itemCount: isSelfConversation ? 1 : 6
                )
            )
        )
    }

    private func setActiveChat(_ active: Bool) {
        WebSocketService.shared.activeChatUserID = active ? contact.userID : nil
    }

    private func markConversationRead() {
        guard hasCompletedInitialLoad else { return }
        let throughMessageID = initialReadThroughMessageID ?? viewModel.messages.last?.id
        guard throughMessageID != nil else { return }
        if let targetID = initialReadThroughMessageID {
            guard viewModel.messages.contains(where: { $0.id == targetID }),
                  !didSubmitInitialRead else { return }
            didSubmitInitialRead = true
        }
        if let onMarkRead {
            onMarkRead(throughMessageID)
        } else {
            viewModel.markConversationAsReadOnServer(
                throughMessageID: throughMessageID
            )
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

    private func restoreRecalledText(_ text: String) {
        viewModel.inputText = text
        composerSelection = NSRange(location: (text as NSString).length, length: 0)
        focusComposerTextInput()
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
        if !viewModel.messages.contains(where: { $0.id == messageID }) {
            Task {
                guard await viewModel.loadContext(around: messageID), isViewVisible else { return }
                await Task.yield()
                revealMessage(messageID, proxy: proxy)
            }
            return
        }
        revealMessage(messageID, proxy: proxy)
    }

    private func revealMessage(_ messageID: Int, proxy: ScrollViewProxy) {
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

    private func presentMessageMenu(for message: Message, frame: CGRect) {
        guard !isSelectingMessages,
              !message.isSystem,
              !message.isRecalled,
              message.chatMoneyReceiptPayload == nil,
              message.callRecord == nil else { return }

        var actions: [MessageMenuAction]
        if message.msgType == "text" && message.stickerPayload == nil && message.chatMoneyPayload == nil {
            actions = [.copy]
            if forwardingEnabled { actions.append(.forward) }
            actions.append(.quote)
        } else if message.isImage || message.isVideo {
            actions = []
            if forwardingEnabled { actions.append(.forward) }
            actions.append(contentsOf: [.save, .quote])
        } else if message.msgType == "voice" {
            actions = [.quote]
        } else if message.stickerPayload != nil || message.msgType == "sticker" {
            actions = []
            if forwardingEnabled { actions.append(.forward) }
            actions.append(.quote)
        } else if message.msgType == "chat_history" || message.msgType == "forward_bundle" {
            actions = []
            if forwardingEnabled { actions.append(.forward) }
        } else {
            actions = [.quote]
        }
        if recallEnabled, canRecall(message) { actions.append(.recall) }
        if localDeleteEnabled { actions.append(.delete) }
        if multiselectEnabled { actions.append(.multiSelect) }
        guard !actions.isEmpty else { return }
        isMessageMenuTouchSequenceActive = true
        let target = MessageMenuTarget(
            messageID: message.id,
            anchorFrame: frame,
            actions: actions
        )
        messageMenuTarget = target
        navigator.presentAppOverlay(animated: false) {
            WeChatMessageActionOverlay(
                target: target,
                onSelect: handleMessageMenuAction,
                onDismiss: dismissMessageMenuFromBackgroundInteraction
            )
        }
    }

    private func presentPendingMessageMenu(for pending: PendingMessage, frame: CGRect) {
        guard !isSelectingMessages, pending.status == .failed else { return }
        var actions: [MessageMenuAction] = []
        if pending.msgType == "text", !pending.content.isBlank {
            actions.append(.copy)
        }
        actions.append(contentsOf: [.retry, .delete])
        isMessageMenuTouchSequenceActive = true
        let target = MessageMenuTarget(
            pendingID: pending.id.uuidString,
            anchorFrame: frame,
            actions: actions
        )
        messageMenuTarget = target
        navigator.presentAppOverlay(animated: false) {
            WeChatMessageActionOverlay(
                target: target,
                onSelect: handleMessageMenuAction,
                onDismiss: dismissMessageMenuFromBackgroundInteraction
            )
        }
    }

    private func finishMessageMenuTouchSequence() {
        // Keep the opening touch protected through the current UIKit event
        // delivery pass. The root TapGesture may finish after the long press.
        DispatchQueue.main.async {
            isMessageMenuTouchSequenceActive = false
        }
    }

    private func dismissMessageMenuFromBackgroundInteraction() {
        guard !isMessageMenuTouchSequenceActive else { return }
        dismissMessageMenu()
    }

    private func dismissMessageMenu() {
        guard messageMenuTarget != nil else { return }
        messageMenuTarget = nil
        navigator.dismissAppOverlay(animated: false)
    }

    private func handleMessageMenuAction(_ action: MessageMenuAction) {
        guard let target = messageMenuTarget else {
            dismissMessageMenu()
            return
        }
        if let pendingID = target.pendingID,
           let id = UUID(uuidString: pendingID),
           let pending = viewModel.pendingMessages.first(where: { $0.id == id }) {
            dismissMessageMenu()
            switch action {
            case .copy:
                UIPasteboard.general.string = pending.content
            case .retry:
                Task { await viewModel.retryPending(pending) }
            case .delete:
                viewModel.deletePending(pending)
            default:
                break
            }
            return
        }
        guard let messageID = target.messageID,
              let message = viewModel.messages.first(where: { $0.id == messageID }) else {
            dismissMessageMenu()
            return
        }
        dismissMessageMenu()

        switch action {
        case .copy:
            UIPasteboard.general.string = message.content
        case .retry:
            break
        case .quote:
            viewModel.setReply(to: message)
            focusComposerTextInput()
        case .recall:
            let editableText = message.msgType == "text" && !message.content.isBlank
                ? message.content
                : nil
            Task {
                do {
                    try await viewModel.recallMessage(messageID: message.id)
                    if let editableText {
                        recalledEditableTexts[message.id] = editableText
                    }
                } catch {
                    toastMessage = (error as? LocalizedError)?.errorDescription
                        ?? L10n.tr("chat.recall.failed")
                }
            }
        case .save:
            Task {
                if message.isImage {
                    await MediaLibrarySaver.saveImage(mediaPath: message.content)
                } else if message.isVideo {
                    await MediaLibrarySaver.saveVideo(mediaPath: message.content)
                }
            }
        case .delete:
            viewModel.deleteLocally(messageIDs: [message.id])
        case .multiSelect:
            enterSelection(with: message)
        case .forward:
            beginSingleForward(message)
        }
    }

    private func canRecall(_ message: Message) -> Bool {
        guard message.senderID == AuthManager.shared.currentUser?.userID else { return false }
        let type = message.stickerPayload == nil ? message.msgType : "sticker"
        guard ["text", "image", "video", "voice", "sticker"].contains(type),
              let sentAt = TimestampHelper.parse(message.timestamp) else { return false }
        let elapsed = Date().timeIntervalSince(sentAt)
        return elapsed >= -300 && elapsed <= 120
    }

    private func messageReference(_ message: Message) -> MessageRef? {
        guard let accountID = AuthManager.shared.currentUser?.userID, !accountID.isEmpty else { return nil }
        return MessageRef(
            accountID: accountID,
            conversation: .direct(userID: contact.userID),
            messageID: message.id
        )
    }

    private func selectionDescriptor(for message: Message) -> MessageSelectionDescriptor {
        let type = message.stickerPayload != nil ? "sticker" : message.msgType
        let individual = ["text", "image", "video", "sticker", "chat_history", "forward_bundle"].contains(type)
        let paymentLike = message.chatMoneyPayload != nil || ["gift", "red_packet", "transfer"].contains(type)
        return MessageSelectionDescriptor(
            timestamp: TimestampHelper.parse(message.timestamp) ?? .distantPast,
            messageType: type,
            canForwardIndividually: individual,
            canMerge: !paymentLike && !message.isSystem && !["chat_history", "forward_bundle"].contains(type),
            canDelete: true
        )
    }

    private func isMessageSelectable(_ message: Message) -> Bool {
        !message.isSystem
            && !message.isRecalled
            && message.callRecord == nil
            && message.chatMoneyReceiptPayload == nil
    }

    private func enterSelection(with message: Message) {
        guard let reference = messageReference(message) else { return }
        dismissComposerInput()
        dismissMessageMenu()
        var state = MessageSelectionState()
        _ = state.toggle(reference, descriptor: selectionDescriptor(for: message))
        interactionMode = .selecting(state)
    }

    private func toggleSelection(for message: Message) {
        guard isMessageSelectable(message),
              case .selecting(var state) = interactionMode,
              let reference = messageReference(message) else { return }
        guard state.toggle(reference, descriptor: selectionDescriptor(for: message)) else {
            toastMessage = L10n.tr("selection.maximum99")
            return
        }
        interactionMode = .selecting(state)
    }

    private func exitSelection() {
        interactionMode = .normal
        showSelectionDeleteConfirmation = false
    }

    private func handleBack() {
        if isSelectingMessages {
            exitSelection()
        } else if navigator.canPopPushedController {
            navigator.pop()
        } else {
            dismiss()
        }
    }

    private func deleteSelectedMessages() {
        guard let state = selectionState else { return }
        viewModel.deleteLocally(messageIDs: Set(state.selected.map(\.messageID)))
        exitSelection()
    }

    private func reconcileSelection() {
        guard case .selecting(var state) = interactionMode else { return }
        let visible = Set(viewModel.messages.filter(isMessageSelectable).compactMap(messageReference))
        let removed = state.selected.subtracting(visible)
        guard !removed.isEmpty else { return }
        state.selected.subtract(removed)
        removed.forEach { state.descriptors.removeValue(forKey: $0) }
        interactionMode = .selecting(state)
        toastMessage = L10n.tr("selection.removedUnavailable")
    }

    private func forwardSource(for message: Message) -> ForwardMessageSource {
        ForwardMessageSource(
            conversationType: .dm,
            conversationID: contact.userID,
            messageID: message.id,
            expectedVersion: message.version
        )
    }

    private func beginSingleForward(_ message: Message) {
        forwardDraft = ForwardFlowDraft(
            mode: .single,
            sources: [forwardSource(for: message)],
            preview: messagePreview(message)
        )
    }

    private func beginSelectedForward(_ mode: ForwardMode) {
        guard let state = selectionState else { return }
        let descriptors = state.orderedSelection.compactMap { state.descriptors[$0] }
        if mode == .individual, descriptors.contains(where: { !$0.canForwardIndividually }) {
            toastMessage = L10n.tr("forward.unsupportedIndividual")
            return
        }
        if mode == .merged, descriptors.contains(where: { !$0.canMerge }) {
            toastMessage = L10n.tr("forward.unsupportedMerged")
            return
        }
        let messagesByID = Dictionary(uniqueKeysWithValues: viewModel.messages.map { ($0.id, $0) })
        let messages = state.orderedSelection.compactMap { messagesByID[$0.messageID] }
        guard messages.count == state.selected.count else {
            toastMessage = L10n.tr("selection.removedUnavailable")
            return
        }
        forwardDraft = ForwardFlowDraft(
            mode: mode,
            sources: messages.map(forwardSource),
            preview: mode == .merged
                ? L10n.tr("forward.chatRecordCount", messages.count)
                : L10n.tr("forward.messageCount", messages.count)
        )
    }

    private func messagePreview(_ message: Message) -> String {
        switch message.msgType {
        case "image": return L10n.tr("message.image")
        case "video": return L10n.tr("message.video")
        case "voice": return L10n.tr("message.voice")
        case "sticker": return L10n.tr("message.sticker")
        default: return message.content
        }
    }

    private func scrollChatToBottom(proxy: ScrollViewProxy, animated: Bool = true) {
        guard isViewVisible else { return }

        let scrollAction = {
            proxy.scrollTo(bottomScrollAnchorID, anchor: .top)
        }

        // The bottom anchor is outside the message padding, so scrolling to it
        // reaches the true end of the flipped ScrollView instead of stopping on
        // the newest bubble with a little remaining scroll range.
        scrollCommandTask?.cancel()
        scrollCommandTask = Task { @MainActor in
            await Task.yield()
            guard !Task.isCancelled else { return }
            guard isViewVisible else { return }
            if animated {
                withAnimation(.easeOut(duration: 0.2), scrollAction)
            } else {
                scrollAction()
            }
        }
    }

    private var timelineLocatorKind: TimelineLocatorKind? {
        if !replyLocatorMessageIDs.isEmpty { return .reply }
        if newMessagesBelowCount > 0 { return .newMessages(newMessagesBelowCount) }
        return isNearBottom ? nil : .bottom
    }

    private func handleIncomingTimelineMessage(_ message: Message, proxy: ScrollViewProxy) {
        guard hasCompletedInitialLoad else { return }
        let isMine = message.senderID == AuthManager.shared.currentUser?.userID
        // The optimistic media row was already placed at the bottom when the
        // user selected it. Its HTTP/WS acknowledgement is not a new visual
        // insertion and must not trigger another animated scroll.
        if isMine, viewModel.isLocalMediaAcknowledgement(message) {
            return
        }
        if isMine || isNearBottom {
            scrollChatToBottom(proxy: proxy)
            return
        }

        newMessagesBelowCount += 1
        if let replyID = message.replyToID ?? message.replyTo?.id,
           viewModel.messages.contains(where: {
               $0.id == replyID && $0.senderID == AuthManager.shared.currentUser?.userID
           }),
           !replyLocatorMessageIDs.contains(message.id) {
            replyLocatorMessageIDs.append(message.id)
        }
    }

    private func activateTimelineLocator(_ kind: TimelineLocatorKind, proxy: ScrollViewProxy) {
        switch kind {
        case .reply:
            guard let target = replyLocatorMessageIDs.first else { return }
            replyLocatorMessageIDs.removeFirst()
            scrollToMessage(target, proxy: proxy)
        case .mention:
            break
        case .newMessages, .bottom:
            newMessagesBelowCount = 0
            replyLocatorMessageIDs.removeAll()
            scrollChatToBottom(proxy: proxy)
        }
    }

    private func previousTimestamp(for pending: ChatPendingMessageRenderItem) -> String? {
        let timeline = renderedTimeline
        guard let idx = timeline.firstIndex(where: { $0.id == "client:\(pending.pending.id.uuidString)" }),
              idx > 0 else { return nil }
        return timeline[idx - 1].timestamp
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
            sourceContentMode: .fill,
            sourceCornerRadius: ChatMediaLayout.mediaCornerRadius,
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
            return ImageGalleryState.shared.prependUnique(newOlder)
        }
        return 0
    }

    @ViewBuilder
    private func messageRow(_ row: ChatMessageRenderItem, proxy: ScrollViewProxy) -> some View {
        let message = row.message
        let isFromMe = message.senderID == AuthManager.shared.currentUser?.userID

        VStack(spacing: 4) {
            if row.showsTimestamp {
                TimeSeparatorView(timestamp: message.timestamp)
            }

            HStack(spacing: 4) {
                if isMessageSelectable(message),
                   let state = selectionState,
                   let reference = messageReference(message) {
                    MessageSelectionIndicator(isSelected: state.selected.contains(reference))
                }

                MessageBubble(
                message: message,
                isFromMe: isFromMe,
                resolvedReply: row.resolvedReply,
                avatarURL: isFromMe ? myAvatarURL : contact.avatarURL,
                onImageTap: handleImageTap,
                onVideoTap: { url in
                    pendingComposerPanel = nil
                    isInputFocused = false
                    hideKeyboard()
                    previewVideoURL = url
                },
                onQuoteTap: { targetID in
                    scrollToMessage(targetID, proxy: proxy)
                },
                onMenuRequested: { frame in
                    presentMessageMenu(for: message, frame: frame)
                },
                onMenuTouchSequenceEnded: finishMessageMenuTouchSequence,
                recalledEditableText: recalledEditableTexts[message.id],
                onReeditRecalledText: restoreRecalledText,
                peerName: contact.nickname,
                peerUserID: contact.userID,
                recipientAvatarURL: isFromMe ? contact.avatarURL : myAvatarURL,
                hasViewerClaimedRedPacket: message.chatMoneyPayload.map {
                    moneyStore.hasViewerClaimed(assetID: $0.assetID)
                } ?? false,
                onChatMoneyTap: { payload, isSender in
                    handleChatMoneyTap(payload, isSender: isSender)
                },
                onForwardBundleTap: { bundleID in
                    navigator.push(ForwardBundleDetailView(bundleID: bundleID).withUIKitBackButton())
                }
                )
                .allowsHitTesting(!isSelectingMessages)
            }
            .contentShape(Rectangle())
            .if(isSelectingMessages) { row in
                row.onTapGesture {
                    toggleSelection(for: message)
                }
            }
        }
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(highlightedMessageID == message.id ? AppColors.accent.opacity(0.15) : Color.clear)

                // ScrollViewReader needs a server-ID target for quote jumps,
                // but assigning that ID to the whole row destroys the stable
                // client identity when pending media is acknowledged.
                Color.clear
                    .frame(width: 1, height: 1)
                    .id(messageScrollID(message.id))
            }
        }
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
                                .onAppear {
                                    isNearBottom = true
                                    newMessagesBelowCount = 0
                                    replyLocatorMessageIDs.removeAll()
                                    viewModel.setReadingLatest(true)
                                    if hasCompletedInitialLoad { markConversationRead() }
                                }
                                .onDisappear {
                                    isNearBottom = false
                                    viewModel.setReadingLatest(false)
                                }

                            LazyVStack(spacing: 4) {
                                ForEach(renderedTimeline.reversed()) { item in
                                    Group {
                                        switch item {
                                        case .pending(let row):
                                            let pending = row.pending
                                            VStack(spacing: 4) {
                                                if TimestampHelper.shouldShowTime(
                                                    current: pending.createdAt.iso8601String,
                                                    previous: previousTimestamp(for: row)
                                                ) {
                                                    TimeSeparatorView(timestamp: pending.createdAt.iso8601String)
                                                }

                                                PendingMessageBubble(
                                                    pending: pending,
                                                    resolvedReply: row.resolvedReply,
                                                    avatarURL: myAvatarURL,
                                                    onRetry: {
                                                        Task { await viewModel.retryPending(pending) }
                                                    }
                                                )
                                                .if(pending.status == .failed) { bubble in
                                                    bubble.messageMenuLongPress(
                                                        onLongPress: { frame in
                                                            presentPendingMessageMenu(for: pending, frame: frame)
                                                        },
                                                        onTouchSequenceEnded: finishMessageMenuTouchSequence
                                                    )
                                                }
                                            }
                                            .flippedRow()
                                        case .message(let row):
                                            messageRow(row, proxy: proxy)
                                        }
                                    }
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
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 8).onChanged { _ in
                            if messageMenuTarget != nil {
                                dismissMessageMenuFromBackgroundInteraction()
                            }
                        }
                    )
                    // Observe the logical delivery identity, not the server ID.
                    // Upload acknowledgement changes the server ID of an
                    // optimistic sticker but must not look like a new row.
                    .onChange(of: viewModel.messages.last.map {
                        ChatTimelineIdentity.value(
                            clientMessageID: $0.clientMessageID,
                            serverID: $0.id
                        )
                    }) { timelineID in
                        guard let timelineID,
                              let message = viewModel.messages.last,
                              ChatTimelineIdentity.value(
                                clientMessageID: message.clientMessageID,
                                serverID: message.id
                              ) == timelineID else { return }
                        handleIncomingTimelineMessage(message, proxy: proxy)
                    }
                    .onChange(of: viewModel.visiblePendingMessages.count) { count in
                        let previousCount = lastVisiblePendingCount
                        lastVisiblePendingCount = count
                        // A decreasing count is only an HTTP/WS acknowledgement
                        // replacing an existing optimistic row. It must never
                        // animate or move the user's viewport.
                        guard count > previousCount else { return }
                        scrollChatToBottom(proxy: proxy, animated: false)
                    }
                    .task {
                        guard !hasCompletedInitialLoad else { return }
                        await viewModel.loadMessages()
                        if let targetID = initialReadThroughMessageID,
                           !viewModel.messages.contains(where: { $0.id == targetID }) {
                            _ = await viewModel.loadContext(around: targetID)
                        }
                        await appearanceStore.loadIfNeeded()
                        guard !Task.isCancelled, isViewVisible else { return }
                        hasCompletedInitialLoad = true
                        if let targetID = initialReadThroughMessageID,
                           viewModel.messages.contains(where: { $0.id == targetID }) {
                            proxy.scrollTo(messageScrollID(targetID), anchor: .center)
                        } else {
                            scrollChatToBottom(proxy: proxy, animated: false)
                        }
                        markConversationRead()
                    }

                    if let locator = timelineLocatorKind {
                        VStack {
                            Spacer()
                            HStack {
                                Spacer()
                                ChatTimelineLocatorButton(kind: locator) {
                                    activateTimelineLocator(locator, proxy: proxy)
                                }
                                .padding(.trailing, 12)
                                .padding(.bottom, 14)
                            }
                        }
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                }
                .contentShape(Rectangle())
                .simultaneousGesture(
                    TapGesture().onEnded {
                        dismissMessageMenuFromBackgroundInteraction()
                        dismissComposerInput()
                    }
                )
            }

            if !isSelectingMessages, let replyMsg = viewModel.replyingTo {
                let senderName = replyMsg.senderID == AuthManager.shared.currentUser?.userID ? L10n.tr("common.me") : contact.nickname
                ReplyPreviewBar(
                    senderName: senderName,
                    content: replyMsg.content,
                    msgType: replyMsg.msgType,
                    onCancel: { viewModel.cancelReply() }
                )
            }

            if let state = selectionState {
                ChatSelectionToolbar(
                    selectionCount: state.selected.count,
                    showsForward: multiForwardingEnabled,
                    onForward: { showForwardModeDialog = true },
                    onDelete: { showSelectionDeleteConfirmation = true }
                )
            } else {
                inputBar
                    .simultaneousGesture(TapGesture().onEnded {
                        dismissMessageMenuFromBackgroundInteraction()
                    })
            }
        }
        .ignoresSafeArea(
            composerSurfaceTransition == nil ? [] : .keyboard,
            edges: .bottom
        )
        .background(AppColors.secondaryBackground)
        .navigationTitle(selectionState.map { L10n.tr("selection.count", $0.selected.count) } ?? contact.nickname)
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton(onBack: handleBack)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    navigator.push(DirectChatSettingsView(contact: contact))
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.accent)
                }
                .opacity(isSelectingMessages ? 0 : 1)
                .disabled(isSelectingMessages)
                .accessibilityLabel(L10n.tr("chat.info"))
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button(L10n.tr("common.done")) {
                    dismissComposerInput()
                }
                .font(.system(size: 15, weight: .semibold))
            }
        }
        .overlay { voiceRecordingOverlay }
        .alert(L10n.tr("selection.delete.title"), isPresented: $showSelectionDeleteConfirmation) {
            Button(L10n.tr("common.cancel"), role: .cancel) {}
            Button(L10n.tr("common.delete"), role: .destructive, action: deleteSelectedMessages)
        } message: {
            Text(L10n.tr("selection.delete.message", selectionState?.selected.count ?? 0))
        }
        .confirmationDialog(L10n.tr("forward.chooseMode"), isPresented: $showForwardModeDialog) {
            Button(L10n.tr("forward.individual")) { beginSelectedForward(.individual) }
            if mergedForwardingEnabled {
                Button(L10n.tr("forward.merged")) { beginSelectedForward(.merged) }
            }
            Button(L10n.tr("common.cancel"), role: .cancel) {}
        }
        .sheet(item: $forwardDraft) { draft in
            ForwardFlowView(mode: draft.mode, sources: draft.sources, preview: draft.preview) {
                exitSelection()
                toastMessage = L10n.tr("forward.sent")
            }
        }
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
        .onAppear {
            isViewVisible = true
            restoreDraftIfNeeded()
            setActiveChat(true)
        }
        .onChange(of: viewModel.inputText) { _ in
            scheduleDraftSave()
        }
        .onChange(of: viewModel.replyingTo?.id) { _ in
            scheduleDraftSave()
        }
        .onReceive(viewModel.$messages) { messages in
            let rows = Self.makeTimelineRows(messages)
            let pending = viewModel.visiblePendingMessages(
                from: viewModel.pendingMessages,
                confirmedBy: messages
            )
            timelineRows = rows
            rebuildTimelineSnapshot(rows: rows, pending: pending)
            reconcileSelection()
        }
        .onReceive(viewModel.$pendingMessages) { pendingMessages in
            rebuildTimelineSnapshot(
                pending: viewModel.visiblePendingMessages(from: pendingMessages)
            )
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
            flushDraft()
        }
        .onReceive(NotificationCenter.default.publisher(for: .directHistoryCleared)) { notification in
            guard let receipt = notification.object as? DirectHistoryClearReceipt,
                  receipt.conversationID == contact.userID else { return }
            viewModel.applyHistoryClear(throughMessageID: receipt.clearedBeforeMessageID)
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
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in
            handleKeyboardDidHide()
        }
        .onDisappear {
            scrollCommandTask?.cancel()
            flushDraft()
            dismissMessageMenu()
            if redPacketOverlayPayload != nil {
                closeRedPacketOverlay()
            }
            isViewVisible = false
            composerSurfaceTransition = nil
            setActiveChat(false)
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
                            onSend: { submittedText in
                                viewModel.submitText(submittedText)
                            }
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
                    chatPlusMenu
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
                            .fill(AppColors.composerPanelIconBackground)
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
                Task {
                    let drafts = await prepareOutgoingMediaDrafts(from: captured)
                    guard !drafts.isEmpty else {
                        toastMessage = L10n.tr("common.operationFailed")
                        return
                    }
                    await viewModel.sendMediaBatch(drafts)
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
                            RoundedRectangle(cornerRadius: 12).fill(AppColors.composerPanelIconBackground).frame(width: 56, height: 56)
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
                            RoundedRectangle(cornerRadius: 12).fill(AppColors.composerPanelIconBackground).frame(width: 56, height: 56)
                            Image(systemName: "video.fill").font(.system(size: 22)).foregroundColor(AppColors.primaryText)
                        }
                        Text(L10n.tr("call.video")).font(.system(size: 11)).foregroundColor(AppColors.secondaryText)
                    }
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

// MARK: - Pending Message Bubble

struct PendingMessageBubble: View {
    let pending: PendingMessage
    let resolvedReply: ReplyPreview?
    var avatarURL: String = ""
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Spacer(minLength: 40)

            VStack(alignment: .trailing, spacing: 2) {
                if let reply = resolvedReply {
                    QuotedMessageView(
                        senderName: reply.senderID == AuthManager.shared.currentUser?.userID
                            ? L10n.tr("common.me")
                            : (UserCacheManager.shared.getUser(reply.senderID)?.nickname ?? reply.senderID),
                        content: reply.content,
                        msgType: reply.msgType,
                        isFromMe: true
                    )
                }

                HStack(alignment: .center, spacing: 6) {
                    if pending.status == .failed {
                        Button {
                            onRetry?()
                        } label: {
                            Image(systemName: "exclamationmark.circle.fill")
                                .foregroundColor(.red)
                                .font(.system(size: 20))
                        }
                    } else if pending.status == .sending,
                              pending.msgType == "image" || pending.msgType == "video" {
                        Image(systemName: "clock")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                            .accessibilityLabel(L10n.tr("common.uploading"))
                    }

                    if pending.msgType == "text" && !pending.content.isEmpty {
                        TimestampedTextBubble(
                            content: pending.content,
                            isFromMe: true
                        )
                    } else if pending.msgType == "image" {
                        LocalFirstPendingImage(
                            identity: pending.id.uuidString,
                            data: pending.imageData,
                            fileURL: pending.localFileURL
                        )
                    } else if pending.msgType == "video" {
                        if let fileURL = pending.localFileURL {
                            VideoThumbnailView(
                                videoURL: fileURL.absoluteString,
                                showsPlayIndicator: true
                            )
                        } else {
                            ZStack {
                                Color.black.opacity(0.1)
                                Circle()
                                    .fill(Color.black.opacity(0.42))
                                    .frame(width: 44, height: 44)
                                Image(systemName: "play.fill")
                                    .font(.system(size: 17, weight: .bold))
                                    .foregroundColor(.white)
                                    .offset(x: 1)
                            }
                            .frame(
                                width: ChatMediaLayout.landscapeVideoSize.width,
                                height: ChatMediaLayout.landscapeVideoSize.height
                            )
                            .clipShape(RoundedRectangle(
                                cornerRadius: ChatMediaLayout.mediaCornerRadius,
                                style: .continuous
                            ))
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

struct LocalFirstPendingImage: View {
    let identity: String
    let data: Data?
    let fileURL: URL?
    @State private var image: UIImage?

    private var cacheKey: String { "pending-media:\(identity)" }

    private var displaySize: CGSize {
        ChatMediaLayout.imageThumbnailSize(for: image?.size)
    }

    init(identity: String, data: Data?, fileURL: URL?) {
        self.identity = identity
        self.data = data
        self.fileURL = fileURL
        _image = State(initialValue: ImageCacheManager.shared.image(for: "pending-media:\(identity)"))
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                RoundedRectangle(cornerRadius: ChatMediaLayout.mediaCornerRadius)
                    .fill(AppColors.separator)
                    .aspectRatio(4 / 3, contentMode: .fit)
            }
        }
        .frame(
            width: displaySize.width,
            height: displaySize.height
        )
        .clipped()
        .clipShape(RoundedRectangle(
            cornerRadius: ChatMediaLayout.mediaCornerRadius,
            style: .continuous
        ))
        .overlay {
            RoundedRectangle(
                cornerRadius: ChatMediaLayout.mediaCornerRadius,
                style: .continuous
            )
            .stroke(Color.black.opacity(0.08), lineWidth: 0.5)
        }
        .transaction { transaction in
            transaction.animation = nil
        }
        .task(id: identity) {
            if let cached = ImageCacheManager.shared.image(for: cacheKey) {
                image = cached
                return
            }
            let requestedIdentity = identity
            let capturedData = data
            let capturedURL = fileURL
            image = nil
            let loaded: UIImage?
            if let capturedData {
                await ImageCacheManager.shared.prepareLocalPreview(
                    data: capturedData,
                    for: cacheKey
                )
                loaded = ImageCacheManager.shared.image(for: cacheKey)
            } else if let capturedURL {
                loaded = await ImageCacheManager.shared.loadImage(
                    from: capturedURL.absoluteString,
                    thumbnail: true
                )
            } else {
                loaded = nil
            }
            guard !Task.isCancelled, requestedIdentity == identity else { return }
            if let loaded {
                ImageCacheManager.shared.setImage(loaded, for: cacheKey)
            }
            image = loaded
        }
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
