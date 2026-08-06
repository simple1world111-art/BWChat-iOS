// BWChat/Views/GroupChatView.swift
// Group chat conversation page

import SwiftUI
import PhotosUI
import AVKit
import AVFoundation
import UniformTypeIdentifiers
import UIKit
import Combine

private struct GroupMessageRenderItem: Identifiable {
    let message: GroupMessage
    let showsTimestamp: Bool
    let resolvedReply: GroupReplyPreview?

    var id: Int { message.id }
}

private struct GroupPendingRenderItem: Identifiable {
    let id: String
    let createdAt: Date
    let text: PendingGroupText?
    let sticker: PendingGroupSticker?
    let media: PendingGroupMedia?
    var resolvedReply: GroupReplyPreview? = nil
}

private enum GroupTimelineRenderItem: Identifiable {
    case message(GroupMessageRenderItem)
    case pending(GroupPendingRenderItem)

    var id: String {
        switch self {
        case .message(let row):
            return ChatTimelineIdentity.value(
                clientMessageID: row.message.clientMessageID,
                serverID: row.message.id
            )
        case .pending(let pending):
            return "client:\(pending.id)"
        }
    }

    var chronologicalDate: Date? {
        switch self {
        case .message(let row): return TimestampHelper.parse(row.message.timestamp)
        case .pending(let pending): return pending.createdAt
        }
    }

    var timestamp: String {
        switch self {
        case .message(let row): return row.message.timestamp
        case .pending(let pending): return pending.createdAt.iso8601String
        }
    }

}

struct GroupChatView: View {
    let group: ChatGroup
    let initialReadThroughMessageID: Int?
    var onMarkRead: ((Int?) -> Void)?
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel: GroupChatViewModel
    @ObservedObject private var callManager = CallManager.shared
    @ObservedObject private var appearanceStore = ChatAppearanceStore.shared
    @ObservedObject private var draftStore = ChatDraftStore.shared
    @ObservedObject private var groupInfoPreferencesStore = GroupInfoPreferencesStore.shared
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
    @State private var pendingLocatedMessageID: Int?
    @State private var isVoiceMode = false
    @StateObject private var recorder = AudioRecorderManager()
    @State private var voiceCancelZone = false
    @State private var isInputFocused = false
    @State private var inputTextHeight: CGFloat = 40
    @State private var composerSelection = NSRange(location: 0, length: 0)
    @State private var composerMentions: [MentionSpan] = []
    @State private var pendingMentionTriggerRange: NSRange?
    @State private var isViewVisible = false
    @State private var hasCompletedInitialLoad = false
    @State private var toastMessage: String?
    @State private var memberProfilesByID: [String: GroupMember]
    @State private var memberRevision: Int64 = 0
    @State private var messageMenuTarget: MessageMenuTarget?
    @State private var isMessageMenuTouchSequenceActive = false
    @State private var recalledEditableTexts: [Int: String] = [:]
    @State private var hasRestoredDraft = false
    @State private var isNearBottom = true
    @State private var newMessagesBelowCount = 0
    @State private var mentionLocatorMessageIDs: [Int] = []
    @State private var replyLocatorMessageIDs: [Int] = []
    @State private var interactionMode: ChatInteractionMode = .normal
    @State private var showSelectionDeleteConfirmation = false
    @State private var showForwardModeDialog = false
    @State private var forwardDraft: ForwardFlowDraft?
    @State private var timelineRows: [GroupMessageRenderItem]
    @State private var pendingTimelineRows: [GroupPendingRenderItem]
    @State private var timelineSnapshot: ChatTimelineSnapshot<GroupTimelineRenderItem>
    @State private var lastVisiblePendingCount: Int
    @State private var didSubmitInitialRead = false
    @State private var scrollCommandTask: Task<Void, Never>?

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

    private var groupDisplayName: String {
        groupInfoPreferencesStore.displayName(for: group.groupID, fallback: group.name)
    }

    private var showsMemberNicknames: Bool {
        groupInfoPreferencesStore.settings(for: group.groupID).showMemberNicknames
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

    private var allowsMentionAll: Bool {
        guard let myID = AuthManager.shared.currentUser?.userID else { return false }
        if group.creatorID == myID { return true }
        let role = memberProfilesByID[myID]?.role.lowercased()
        return role == "owner" || role == "admin"
    }

    private var mentionCandidates: [GroupMember] {
        let myID = AuthManager.shared.currentUser?.userID
        var candidates = memberProfilesByID
        for message in viewModel.messages where message.senderID != myID {
            guard candidates[message.senderID] == nil,
                  !message.senderID.isBlank else { continue }
            candidates[message.senderID] = GroupMember(
                userID: message.senderID,
                nickname: message.senderNickname.isBlank
                    ? message.senderID
                    : message.senderNickname,
                avatarURL: message.senderAvatar,
                role: "member"
            )
        }
        return MentionMemberResolver.visibleMembers(
            from: Array(candidates.values),
            excludingUserID: myID
        )
    }

    private var composerDocument: ComposerDocument {
        ComposerDocument(text: viewModel.inputText, mentions: composerMentions)
    }

    private var currentDraftQuote: ChatDraftQuote? {
        guard let message = viewModel.replyingTo else { return nil }
        let senderName = message.senderID == AuthManager.shared.currentUser?.userID
            ? L10n.tr("common.me")
            : resolvedSenderNickname(for: message, isFromMe: false) ?? message.senderNickname
        return ChatDraftQuote(
            messageID: message.id,
            senderID: message.senderID,
            senderName: senderName,
            msgType: message.msgType,
            content: message.content,
            timestamp: message.timestamp
        )
    }

    private func restoreDraftIfNeeded() {
        guard !hasRestoredDraft else { return }
        hasRestoredDraft = true
        guard let draft = draftStore.draft(
            conversationType: "group",
            conversationID: String(group.groupID)
        ) else { return }
        viewModel.inputText = draft.document.text
        composerMentions = draft.document.mentions
        composerSelection = NSRange(
            location: (draft.document.text as NSString).length,
            length: 0
        )
        if let quote = draft.quote {
            viewModel.replyingTo = viewModel.messages.first(where: { $0.id == quote.messageID })
                ?? GroupMessage(
                    id: quote.messageID,
                    groupID: group.groupID,
                    senderID: quote.senderID,
                    msgType: quote.msgType,
                    content: quote.content,
                    timestamp: quote.timestamp,
                    senderNickname: quote.senderName,
                    senderAvatar: "",
                    replyToID: nil,
                    replyTo: nil,
                    mentions: nil
                )
        }
    }

    private func scheduleDraftSave() {
        guard hasRestoredDraft else { return }
        draftStore.scheduleSave(
            document: composerDocument,
            quote: currentDraftQuote,
            conversationType: "group",
            conversationID: String(group.groupID)
        )
    }

    private func flushDraft() {
        guard hasRestoredDraft else { return }
        draftStore.flush(
            document: composerDocument,
            quote: currentDraftQuote,
            conversationType: "group",
            conversationID: String(group.groupID)
        )
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
        timelineRows
    }

    private static func makeTimelineRows(_ messages: [GroupMessage]) -> [GroupMessageRenderItem] {
        var rows: [GroupMessageRenderItem] = []
        rows.reserveCapacity(messages.count)
        let messagesByID = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })

        var previous: String?
        for message in messages {
            rows.append(GroupMessageRenderItem(
                message: message,
                showsTimestamp: TimestampHelper.shouldShowTime(current: message.timestamp, previous: previous),
                resolvedReply: ChatHistoryReplyResolver.groupReply(
                    for: message,
                    messagesByID: messagesByID
                )
            ))
            previous = message.timestamp
        }
        return rows
    }

    private var renderedPendingItems: [GroupPendingRenderItem] {
        pendingTimelineRows
    }

    private static func makePendingTimelineRows(
        texts: [PendingGroupText],
        stickers: [PendingGroupSticker],
        media: [PendingGroupMedia]
    ) -> [GroupPendingRenderItem] {
        let textRows = texts.map {
            GroupPendingRenderItem(id: $0.id, createdAt: $0.createdAt, text: $0, sticker: nil, media: nil)
        }
        let stickerRows = stickers.map {
            GroupPendingRenderItem(id: $0.id, createdAt: $0.createdAt, text: nil, sticker: $0, media: nil)
        }
        let mediaRows = media.map {
            GroupPendingRenderItem(id: $0.id, createdAt: $0.createdAt, text: nil, sticker: nil, media: $0)
        }
        return (textRows + stickerRows + mediaRows).sorted { $0.createdAt < $1.createdAt }
    }

    private var renderedTimeline: [GroupTimelineRenderItem] {
        timelineSnapshot.items
    }

    private static func makeTimelineSnapshot(
        rows: [GroupMessageRenderItem],
        pending: [GroupPendingRenderItem]
    ) -> ChatTimelineSnapshot<GroupTimelineRenderItem> {
        // API acknowledgement and WebSocket echo can briefly publish the same
        // client message more than once. A LazyVStack requires every rendered
        // identity to be unique; otherwise it can retain a stale layout slot
        // until the whole chat view is recreated.
        var confirmedIDs = Set<String>()
        let uniqueRows = Array(rows.reversed().filter { row in
            confirmedIDs.insert(GroupTimelineRenderItem.message(row).id).inserted
        }.reversed())

        let confirmedTimelineIDs = Set(
            uniqueRows.map { GroupTimelineRenderItem.message($0).id }
        )
        let messagesByID = Dictionary(
            uniqueRows.map { ($0.message.id, $0.message) },
            uniquingKeysWith: { _, latest in latest }
        )
        let resolvedPending = pending.map { item -> GroupPendingRenderItem in
            var item = item
            let replyID = item.text?.replyID ?? item.sticker?.replyID
            item.resolvedReply = ChatHistoryReplyResolver.groupReply(
                to: replyID,
                messagesByID: messagesByID
            )
            return item
        }
        var pendingIDs = Set<String>()
        let uniquePending = resolvedPending.filter { item in
            let timelineID = GroupTimelineRenderItem.pending(item).id
            guard !confirmedTimelineIDs.contains(timelineID) else { return false }
            return pendingIDs.insert(timelineID).inserted
        }

        let items = ChatTimelineOrdering.merge(
            uniqueRows.map(GroupTimelineRenderItem.message),
            uniquePending.map(GroupTimelineRenderItem.pending)
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
        rows: [GroupMessageRenderItem]? = nil,
        pending: [GroupPendingRenderItem]? = nil
    ) {
        let nextSnapshot = Self.makeTimelineSnapshot(
            rows: rows ?? timelineRows,
            pending: pending ?? pendingTimelineRows
        )
        timelineSnapshot = nextSnapshot
    }

    init(
        group: ChatGroup,
        initialReadThroughMessageID: Int? = nil,
        onMarkRead: ((Int?) -> Void)? = nil
    ) {
        self.group = group
        self.initialReadThroughMessageID = initialReadThroughMessageID
        self.onMarkRead = onMarkRead
        let model = GroupChatViewModel(group: group)
        let rows = Self.makeTimelineRows(model.messages)
        let pendingRows = Self.makePendingTimelineRows(
            texts: model.visiblePendingTexts,
            stickers: model.visiblePendingStickers,
            media: model.visiblePendingMedia
        )
        _viewModel = StateObject(wrappedValue: model)
        _timelineRows = State(initialValue: rows)
        _pendingTimelineRows = State(initialValue: pendingRows)
        _timelineSnapshot = State(initialValue: Self.makeTimelineSnapshot(
            rows: rows,
            pending: pendingRows
        ))
        _lastVisiblePendingCount = State(
            initialValue: model.visiblePendingTexts.count
                + model.visiblePendingStickers.count
                + model.visiblePendingMedia.count
        )

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
        if let member = memberProfilesByID[message.senderID], !member.displayNickname.isBlank {
            return member.displayNickname
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
        composerMentions.removeAll()
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

    private func presentMessageMenu(for message: GroupMessage, frame: CGRect) {
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

    private func presentPendingMessageMenu(for pending: GroupPendingRenderItem, frame: CGRect) {
        guard !isSelectingMessages else { return }
        let isFailed = pending.text?.status == .failed
            || pending.sticker?.status == .failed
            || pending.media?.status == .failed
        guard isFailed else { return }

        var actions: [MessageMenuAction] = []
        if let text = pending.text, !text.content.isBlank {
            actions.append(.copy)
        }
        actions.append(contentsOf: [.retry, .delete])
        isMessageMenuTouchSequenceActive = true
        let target = MessageMenuTarget(
            pendingID: pending.id,
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
           let pending = renderedPendingItems.first(where: { $0.id == pendingID }) {
            dismissMessageMenu()
            switch action {
            case .copy:
                UIPasteboard.general.string = pending.text?.content
            case .retry:
                if let text = pending.text {
                    Task { await viewModel.retryPendingText(text) }
                } else if let sticker = pending.sticker {
                    Task { await viewModel.retryPendingSticker(sticker) }
                } else if let media = pending.media {
                    viewModel.retryPendingMedia(media)
                }
            case .delete:
                viewModel.deletePending(id: pending.id)
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

    private func canRecall(_ message: GroupMessage) -> Bool {
        guard message.senderID == AuthManager.shared.currentUser?.userID else { return false }
        let type = message.stickerPayload == nil ? message.msgType : "sticker"
        guard ["text", "image", "video", "voice", "sticker"].contains(type),
              let sentAt = TimestampHelper.parse(message.timestamp) else { return false }
        let elapsed = Date().timeIntervalSince(sentAt)
        return elapsed >= -300 && elapsed <= 120
    }

    private func messageReference(_ message: GroupMessage) -> MessageRef? {
        guard let accountID = AuthManager.shared.currentUser?.userID, !accountID.isEmpty else { return nil }
        return MessageRef(
            accountID: accountID,
            conversation: .group(groupID: group.groupID),
            messageID: message.id
        )
    }

    private func selectionDescriptor(for message: GroupMessage) -> MessageSelectionDescriptor {
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

    private func isMessageSelectable(_ message: GroupMessage) -> Bool {
        !message.isSystem
            && !message.isRecalled
            && message.callRecord == nil
            && message.chatMoneyReceiptPayload == nil
    }

    private func enterSelection(with message: GroupMessage) {
        guard let reference = messageReference(message) else { return }
        dismissComposerInput()
        dismissMessageMenu()
        var state = MessageSelectionState()
        _ = state.toggle(reference, descriptor: selectionDescriptor(for: message))
        interactionMode = .selecting(state)
    }

    private func toggleSelection(for message: GroupMessage) {
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

    private func forwardSource(for message: GroupMessage) -> ForwardMessageSource {
        ForwardMessageSource(
            conversationType: .group,
            conversationID: String(group.groupID),
            messageID: message.id,
            expectedVersion: message.version
        )
    }

    private func beginSingleForward(_ message: GroupMessage) {
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

    private func messagePreview(_ message: GroupMessage) -> String {
        switch message.msgType {
        case "image": return L10n.tr("message.image")
        case "video": return L10n.tr("message.video")
        case "voice": return L10n.tr("message.voice")
        case "sticker": return L10n.tr("message.sticker")
        default: return message.content
        }
    }

    private func scrollGroupChatToBottom(proxy: ScrollViewProxy, animated: Bool = true) {
        guard isViewVisible else { return }

        let scrollAction = {
            proxy.scrollTo(bottomScrollAnchorID, anchor: .top)
        }

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
        if !mentionLocatorMessageIDs.isEmpty { return .mention }
        if !replyLocatorMessageIDs.isEmpty { return .reply }
        if newMessagesBelowCount > 0 { return .newMessages(newMessagesBelowCount) }
        return isNearBottom ? nil : .bottom
    }

    private func handleIncomingTimelineMessage(_ message: GroupMessage, proxy: ScrollViewProxy) {
        guard hasCompletedInitialLoad else { return }
        let myID = AuthManager.shared.currentUser?.userID
        let isMine = message.senderID == myID
        if isMine, viewModel.isLocalMediaAcknowledgement(message) {
            return
        }
        if isMine || isNearBottom {
            scrollGroupChatToBottom(proxy: proxy)
            return
        }

        newMessagesBelowCount += 1
        if message.mentions?.contains(myID ?? "") == true,
           !mentionLocatorMessageIDs.contains(message.id) {
            mentionLocatorMessageIDs.append(message.id)
        }
        if let replyID = message.replyToID ?? message.replyTo?.id,
           viewModel.messages.contains(where: { $0.id == replyID && $0.senderID == myID }),
           !replyLocatorMessageIDs.contains(message.id) {
            replyLocatorMessageIDs.append(message.id)
        }
    }

    private func activateTimelineLocator(_ kind: TimelineLocatorKind, proxy: ScrollViewProxy) {
        switch kind {
        case .mention:
            guard let target = mentionLocatorMessageIDs.first else { return }
            mentionLocatorMessageIDs.removeFirst()
            scrollToMessage(target, proxy: proxy)
        case .reply:
            guard let target = replyLocatorMessageIDs.first else { return }
            replyLocatorMessageIDs.removeFirst()
            scrollToMessage(target, proxy: proxy)
        case .newMessages, .bottom:
            newMessagesBelowCount = 0
            mentionLocatorMessageIDs.removeAll()
            replyLocatorMessageIDs.removeAll()
            scrollGroupChatToBottom(proxy: proxy)
        }
    }

    private func openImageGallery(url: String, frame: CGRect) {
        pendingComposerPanel = nil
        isInputFocused = false
        hideKeyboard()
        let allImages = viewModel.messages.compactMap { message in
            message.isImage ? message.content : nil
        }
        ImageGalleryState.shared.show(
            urls: allImages,
            index: allImages.firstIndex(of: url) ?? 0,
            sourceFrame: frame,
            sourceContentMode: .fill,
            sourceCornerRadius: ChatMediaLayout.mediaCornerRadius,
            loadMoreOlder: {
                let before = viewModel.messages.reduce(into: 0) { count, message in
                    if message.isImage { count += 1 }
                }
                await viewModel.loadMoreMessages()
                let after = viewModel.messages.compactMap { message in
                    message.isImage ? message.content : nil
                }
                let added = after.count - before
                if added > 0 {
                    return ImageGalleryState.shared.prependUnique(after.prefix(added))
                }
                return 0
            }
        )
    }

    @ViewBuilder
    private func groupMessageRow(_ row: GroupMessageRenderItem, proxy: ScrollViewProxy) -> some View {
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

                GroupMessageBubble(
                message: message,
                isFromMe: isFromMe,
                resolvedReply: row.resolvedReply,
                myAvatarURL: myAvatarURL,
                senderAvatarURL: resolvedSenderAvatarURL(for: message, isFromMe: isFromMe),
                senderNickname: resolvedSenderNickname(for: message, isFromMe: isFromMe),
                showsSenderNickname: showsMemberNicknames,
                hasViewerClaimedRedPacket: message.chatMoneyPayload.map {
                    moneyStore.hasViewerClaimed(assetID: $0.assetID)
                } ?? false,
                onImageTap: { url, frame in
                    openImageGallery(url: url, frame: frame)
                },
                onVideoTap: { url in
                    pendingComposerPanel = nil
                    isInputFocused = false
                    hideKeyboard()
                    previewVideoURL = url
                },
                onQuoteTap: { scrollToMessage($0, proxy: proxy) },
                onMention: { userID, nickname in
                    insertMentions([
                        MentionSelection(userID: userID, nickname: nickname, kind: .direct)
                    ], replacing: nil)
                },
                onMenuRequested: { presentMessageMenu(for: message, frame: $0) },
                onMenuTouchSequenceEnded: finishMessageMenuTouchSequence,
                recalledEditableText: recalledEditableTexts[message.id],
                onReeditRecalledText: restoreRecalledText,
                onChatMoneyTap: { handleChatMoneyTap($0, isSender: $1) },
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

                Color.clear
                    .frame(width: 1, height: 1)
                    .id(messageScrollID(message.id))
            }
        }
        .flippedRow()
    }

    private func previousTimestamp(for pending: GroupPendingRenderItem) -> String? {
        let timeline = renderedTimeline
        guard let idx = timeline.firstIndex(where: { $0.id == "client:\(pending.id)" }),
              idx > 0 else { return nil }
        return timeline[idx - 1].timestamp
    }

    private var groupTimeline: some View {
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
                            .onAppear {
                                isNearBottom = true
                                newMessagesBelowCount = 0
                                mentionLocatorMessageIDs.removeAll()
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
                                    case .pending(let pending):
                                        pendingRow(pending)
                                    case .message(let row):
                                        groupMessageRow(row, proxy: proxy)
                                    }
                                }
                            }
                            if viewModel.hasMore {
                                ProgressView()
                                    .tint(AppColors.accent)
                                    .padding()
                                    .flippedRow()
                                    .onAppear { Task { await viewModel.loadMoreMessages() } }
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
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
                .onChange(of: viewModel.visiblePendingTexts.count
                    + viewModel.visiblePendingStickers.count
                    + viewModel.visiblePendingMedia.count) { count in
                    let previousCount = lastVisiblePendingCount
                    lastVisiblePendingCount = count
                    guard count > previousCount else { return }
                    scrollGroupChatToBottom(proxy: proxy, animated: false)
                }
                .onChange(of: pendingLocatedMessageID) { messageID in
                    guard let messageID else { return }
                    pendingLocatedMessageID = nil
                    scrollToMessage(messageID, proxy: proxy)
                }
                .task { await loadInitialTimeline(proxy: proxy) }

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
            .simultaneousGesture(TapGesture().onEnded {
                dismissMessageMenuFromBackgroundInteraction()
                dismissComposerInput()
            })
        }
    }

    @ViewBuilder
    private func pendingRow(_ pending: GroupPendingRenderItem) -> some View {
        VStack(spacing: 4) {
            if TimestampHelper.shouldShowTime(
                current: pending.createdAt.iso8601String,
                previous: previousTimestamp(for: pending)
            ) {
                TimeSeparatorView(timestamp: pending.createdAt.iso8601String)
            }
            if let text = pending.text {
                PendingGroupBubble(
                    pending: text,
                    resolvedReply: pending.resolvedReply,
                    avatarURL: myAvatarURL,
                    onRetry: { Task { await viewModel.retryPendingText(text) } }
                )
            } else if let sticker = pending.sticker {
                PendingGroupStickerBubble(
                    pending: sticker,
                    resolvedReply: pending.resolvedReply,
                    avatarURL: myAvatarURL,
                    onRetry: { Task { await viewModel.retryPendingSticker(sticker) } }
                )
            } else if let media = pending.media {
                PendingGroupMediaBubble(pending: media, avatarURL: myAvatarURL) {
                    viewModel.retryPendingMedia(media)
                }
            }
        }
        .if(
            pending.text?.status == .failed
                || pending.sticker?.status == .failed
                || pending.media?.status == .failed
        ) { row in
            row.messageMenuLongPress(
                onLongPress: { frame in
                    presentPendingMessageMenu(for: pending, frame: frame)
                },
                onTouchSequenceEnded: finishMessageMenuTouchSequence
            )
        }
        .flippedRow()
    }

    private func loadInitialTimeline(proxy: ScrollViewProxy) async {
        guard !hasCompletedInitialLoad else { return }
        async let messagesTask: () = viewModel.loadMessages()
        async let detailTask = APIService.shared.getGroupDetail(groupID: group.groupID)
        await messagesTask
        if let targetID = initialReadThroughMessageID,
           !viewModel.messages.contains(where: { $0.id == targetID }) {
            _ = await viewModel.loadContext(around: targetID)
        }
        await appearanceStore.loadIfNeeded()
        if let detail = try? await detailTask {
            memberCount = detail.members.count
            memberProfilesByID = Self.memberProfilesByID(from: detail.members)
            groupInfoPreferencesStore.apply(detail.viewerSettings)
            cacheMembers(detail.members)
            if let key = CacheKey.current(namespace: "group-detail", key: "\(group.groupID)") {
                AppCacheRepository.shared.save(detail, for: key, policy: .profile)
            }
            LocalCache.save(detail, key: "group_detail_\(group.groupID)")
        }
        guard !Task.isCancelled, isViewVisible else { return }
        hasCompletedInitialLoad = true
        if let targetID = initialReadThroughMessageID,
           viewModel.messages.contains(where: { $0.id == targetID }) {
            proxy.scrollTo(messageScrollID(targetID), anchor: .center)
        } else {
            scrollGroupChatToBottom(proxy: proxy, animated: false)
        }
        markConversationRead()
    }

    var body: some View {
        VStack(spacing: 0) {
            groupTimeline

            if !isSelectingMessages, let replyMsg = viewModel.replyingTo {
                ReplyPreviewBar(
                    senderName: replyMsg.senderNickname,
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
                groupInputBar
                    .simultaneousGesture(TapGesture().onEnded {
                        dismissMessageMenuFromBackgroundInteraction()
                    })
            }
        }
        .ignoresSafeArea(
            composerSurfaceTransition == nil ? [] : .keyboard,
            edges: .bottom
        )
        .fullScreenCover(isPresented: $viewModel.showMentionPicker) {
            MentionPickerView(
                groupID: group.groupID,
                allowsMentionAll: allowsMentionAll,
                initialMembers: mentionCandidates
            ) { selections in
                insertMentions(selections, replacing: pendingMentionTriggerRange)
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
        .navigationTitle(selectionState.map { L10n.tr("selection.count", $0.selected.count) }
            ?? (memberCount > 0 ? "\(groupDisplayName) (\(memberCount))" : groupDisplayName))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton(onBack: handleBack)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showGroupDetail = true } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.accent)
                }
                .opacity(isSelectingMessages ? 0 : 1)
                .disabled(isSelectingMessages)
            }
        }
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
        .onChange(of: showGroupDetail) { show in
            if show {
                showGroupDetail = false
                navigator.push(GroupDetailView(
                    groupID: group.groupID,
                    onGroupLeft: { shouldPopToRoot = true },
                    onLocateMessage: { messageID in
                        navigator.pop(count: 2)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                            pendingLocatedMessageID = messageID
                        }
                    }
                ))
            }
        }
        .overlay { groupVoiceRecordingOverlay }
        .onAppear {
            isViewVisible = true
            restoreDraftIfNeeded()
            setActiveGroupChat(true)
        }
        .onChange(of: viewModel.inputText) { _ in
            scheduleDraftSave()
        }
        .onChange(of: composerMentions) { _ in
            scheduleDraftSave()
        }
        .onChange(of: viewModel.replyingTo?.id) { _ in
            scheduleDraftSave()
        }
        .onReceive(viewModel.$messages) { messages in
            let rows = Self.makeTimelineRows(messages)
            let pendingRows = Self.makePendingTimelineRows(
                texts: viewModel.visiblePendingTexts(
                    from: viewModel.pendingTexts,
                    confirmedBy: messages
                ),
                stickers: viewModel.visiblePendingStickers(
                    from: viewModel.pendingStickers,
                    confirmedBy: messages
                ),
                media: viewModel.visiblePendingMedia(
                    from: viewModel.pendingMedia,
                    confirmedBy: messages
                )
            )
            timelineRows = rows
            pendingTimelineRows = pendingRows
            rebuildTimelineSnapshot(rows: rows, pending: pendingRows)
            reconcileSelection()
        }
        .onReceive(Publishers.CombineLatest3(
            viewModel.$pendingTexts,
            viewModel.$pendingStickers,
            viewModel.$pendingMedia
        )) { pendingTexts, pendingStickers, pendingMedia in
            let pendingRows = Self.makePendingTimelineRows(
                texts: viewModel.visiblePendingTexts(from: pendingTexts),
                stickers: viewModel.visiblePendingStickers(from: pendingStickers),
                media: viewModel.visiblePendingMedia(from: pendingMedia)
            )
            pendingTimelineRows = pendingRows
            rebuildTimelineSnapshot(pending: pendingRows)
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
            flushDraft()
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
            scrollCommandTask?.cancel()
            flushDraft()
            dismissMessageMenu()
            if redPacketOverlayPayload != nil {
                closeRedPacketOverlay()
            }
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
        .onReceive(WebSocketService.shared.groupMemberUpdatePublisher) { update in
            guard update.groupID == group.groupID,
                  update.revision >= memberRevision else { return }
            memberRevision = update.revision
            memberProfilesByID[update.member.userID] = update.member
            memberCount = max(memberCount, memberProfilesByID.count)
        }
        .onReceive(NotificationCenter.default.publisher(for: .groupHistoryCleared)) { notification in
            guard let receipt = notification.object as? GroupHistoryClearReceipt,
                  receipt.groupID == group.groupID else { return }
            viewModel.applyHistoryClear(throughSequence: receipt.clearedBeforeSequence)
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
                            mentionSpans: $composerMentions,
                            onRequestFocus: focusComposerTextInput,
                            onSend: { submittedText in
                                submitGroupText(submittedText)
                            },
                            onStandaloneAt: { range in
                                pendingMentionTriggerRange = range
                                viewModel.showMentionPicker = true
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
                                    submitGroupText()
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
        let result = MentionTextEditing.applyingUserEdit(
            range: composerSelection,
            replacementText: value,
            to: composerDocument
        )
        viewModel.inputText = result.document.text
        composerMentions = result.document.mentions
        composerSelection = result.selectedRange
    }

    private func submitGroupText(_ submittedText: String? = nil) {
        let document = ComposerDocument(
            text: submittedText ?? viewModel.inputText,
            mentions: composerMentions
        )
        let mentions = document.mentionedUserIDs
        viewModel.submitText(
            text: submittedText,
            mentions: mentions,
            mentionAll: document.mentionsAll
        )
        composerMentions = []
        pendingMentionTriggerRange = nil
    }

    private func insertMentions(
        _ selections: [MentionSelection],
        replacing replacementRange: NSRange?
    ) {
        guard !selections.isEmpty else { return }
        let result = MentionTextEditing.inserting(
            selections,
            replacing: replacementRange,
            in: composerDocument,
            selectedRange: composerSelection
        )
        viewModel.inputText = result.document.text
        composerMentions = result.document.mentions
        composerSelection = result.selectedRange
        pendingMentionTriggerRange = nil
        viewModel.showMentionPicker = false
        focusComposerTextInput()
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
                Task {
                    let drafts = await prepareOutgoingMediaDrafts(from: captured)
                    guard !drafts.isEmpty else {
                        toastMessage = L10n.tr("common.operationFailed")
                        return
                    }
                    await viewModel.sendMediaBatch(drafts)
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
    let resolvedReply: GroupReplyPreview?
    var myAvatarURL: String = ""
    var senderAvatarURL: String? = nil
    var senderNickname: String? = nil
    var showsSenderNickname = true
    var hasViewerClaimedRedPacket = false
    /// Second arg: the thumbnail's global-coordinate frame at tap time
    /// (used by the full-screen gallery for a hero grow-from-thumbnail).
    var onImageTap: ((String, CGRect) -> Void)?
    var onVideoTap: ((String) -> Void)?
    var onQuoteTap: ((Int) -> Void)?
    var onMention: ((String, String) -> Void)?
    var onMenuRequested: ((CGRect) -> Void)?
    var onMenuTouchSequenceEnded: (() -> Void)?
    var recalledEditableText: String?
    var onReeditRecalledText: ((String) -> Void)?
    /// Use the group-message direction instead of the embedded asset sender
    /// while independently delivered snapshots are being reconciled.
    var onChatMoneyTap: ((ChatMoneyPayload, Bool) -> Void)?
    var onForwardBundleTap: ((String) -> Void)?
    @ObservedObject private var appConfig = AppRemoteConfigStore.shared
    @State private var menuOwnsTouchSequence = false

    private var displaySenderAvatarURL: String {
        if let senderAvatarURL, !senderAvatarURL.isBlank { return senderAvatarURL }
        return message.senderAvatar
    }

    private var displaySenderNickname: String {
        if let senderNickname, !senderNickname.isBlank { return senderNickname }
        return message.senderNickname
    }

    var body: some View {
        if message.isRecalled {
            RecalledMessageTip(
                senderName: displaySenderNickname,
                isFromMe: isFromMe,
                canReedit: isFromMe && recalledEditableText != nil,
                onReedit: {
                    guard let recalledEditableText else { return }
                    onReeditRecalledText?(recalledEditableText)
                }
            )
        } else if let receipt = message.chatMoneyReceiptPayload {
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
        HStack(alignment: .top, spacing: 8) {
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
                if !isFromMe, showsSenderNickname {
                    Text(displaySenderNickname)
                        .font(.caption)
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)
                        .accessibilityLabel(L10n.tr("group.member.nickname.accessibility", displaySenderNickname))
                }

                if let reply = resolvedReply {
                    QuotedMessageView(
                        senderName: reply.senderID == AuthManager.shared.currentUser?.userID ? L10n.tr("common.me") : (UserCacheManager.shared.getUser(reply.senderID)?.nickname ?? reply.senderID),
                        content: reply.content,
                        msgType: reply.msgType,
                        isFromMe: isFromMe,
                        onTap: { onQuoteTap?(reply.id) }
                    )
                }

                messageContent
                    .messageMenuLongPress(
                        onLongPress: { frame in
                            menuOwnsTouchSequence = true
                            onMenuRequested?(frame)
                        },
                        onTouchSequenceEnded: releaseMenuTouchOwnership
                    )
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
        }
    }

    @ViewBuilder
    private var messageContent: some View {
        if appConfig.featureFlags.isEnabled("message_forward_merged_render_v1", default: true),
           let bundle = ForwardBundleMessagePayload.parse(message.content, messageType: message.msgType) {
            ForwardBundleMessageCard(payload: bundle, isFromMe: isFromMe) {
                guard !menuOwnsTouchSequence else { return }
                onForwardBundleTap?(bundle.bundleID)
            }
        } else if message.isImage {
            CachedAsyncImage(
                url: message.content,
                previewURL: message.thumbnailURL
            )
                .onTapCaptureFrame(sourceID: message.content) { frame in
                    guard !menuOwnsTouchSequence else { return }
                    onImageTap?(message.content, frame)
                }
        } else if message.isVideo {
            VideoThumbnailView(
                videoURL: message.content,
                thumbnailURL: message.thumbnailURL,
                showsPlayIndicator: true
            )
            .onTapGesture {
                guard !menuOwnsTouchSequence else { return }
                onVideoTap?(message.content)
            }
        } else if message.isVoice {
            VoiceBubbleView(
                url: message.voiceURL ?? "",
                duration: message.voiceDuration,
                isFromMe: isFromMe
            )
        } else if let moneyPayload = message.chatMoneyPayload {
            ChatMoneyBubble(
                payload: moneyPayload,
                isFromMe: isFromMe,
                senderName: nil,
                hasViewerClaimedRedPacket: hasViewerClaimedRedPacket,
                onTap: {
                    guard !menuOwnsTouchSequence else { return }
                    onChatMoneyTap?(moneyPayload, isFromMe)
                }
            )
        } else if let stickerPayload = message.stickerPayload {
            StickerMessageBubble(
                payload: stickerPayload,
                isFromMe: isFromMe,
                senderName: nil
            )
        } else if let giftPayload = message.giftPayload {
            GiftMessageBubble(
                payload: giftPayload,
                isFromMe: isFromMe,
                senderName: nil,
                recipientFallback: L10n.tr("group.member"),
                recipientAvatarFallback: giftPayload.recipientID == AuthManager.shared.currentUser?.userID
                    ? myAvatarURL
                    : nil
            )
        } else {
            TimestampedTextBubble(
                content: message.content,
                isFromMe: isFromMe,
                senderName: nil
            )
        }
    }

    private func releaseMenuTouchOwnership() {
        onMenuTouchSequenceEnded?()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            menuOwnsTouchSequence = false
        }
    }
}

// MARK: - Pending Group Bubble

struct PendingGroupBubble: View {
    let pending: PendingGroupText
    let resolvedReply: GroupReplyPreview?
    var avatarURL: String = ""
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Spacer(minLength: 40)
            VStack(alignment: .trailing, spacing: 3) {
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
                    }

                    TimestampedTextBubble(
                        content: pending.content,
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

struct PendingGroupStickerBubble: View {
    let pending: PendingGroupSticker
    let resolvedReply: GroupReplyPreview?
    var avatarURL: String = ""
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Spacer(minLength: 40)
            VStack(alignment: .trailing, spacing: 3) {
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
                    }

                    if let payload = StickerMessagePayload.parse(pending.content) {
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

struct PendingGroupMediaBubble: View {
    let pending: PendingGroupMedia
    var avatarURL: String = ""
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Spacer(minLength: 40)
            HStack(alignment: .center, spacing: 6) {
                if pending.status == .failed {
                    Button(action: { onRetry?() }) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(.red)
                            .font(.system(size: 20))
                    }
                } else if pending.status == .sending {
                    Image(systemName: "clock")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                        .accessibilityLabel(L10n.tr("common.uploading"))
                }

                Group {
                    if pending.msgType == "image" {
                        LocalFirstPendingImage(
                            identity: pending.id,
                            data: pending.data,
                            fileURL: pending.localFileURL
                        )
                    } else if pending.msgType == "video", let fileURL = pending.localFileURL {
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
                    }
                }
                .clipShape(RoundedRectangle(
                    cornerRadius: ChatMediaLayout.mediaCornerRadius,
                    style: .continuous
                ))
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
