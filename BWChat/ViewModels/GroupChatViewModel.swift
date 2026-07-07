// BWChat/ViewModels/GroupChatViewModel.swift
// Group chat conversation view model with local caching

import SwiftUI
import Combine
import AudioToolbox

@MainActor
class GroupChatViewModel: ObservableObject {
    @Published var messages: [GroupMessage] = []
    @Published var inputText: String = ""
    @Published var isLoading = false
    @Published var isSending = false
    @Published var hasMore = false
    @Published var errorMessage: String?
    @Published var pendingTexts: [PendingGroupText] = []
    @Published var replyingTo: GroupMessage?
    @Published var mentionedUserIDs: [String] = []
    @Published var showMentionPicker = false
    @Published var mentionAlertMessage: GroupMessage?

    let group: ChatGroup
    private var cancellables = Set<AnyCancellable>()
    private let store = MessageStore.shared
    private var isSyncingLatest = false
    private var lastTextSubmit: (signature: String, date: Date)?
    private var webSocketConfirmedMessageIDs = Set<Int>()

    private enum GroupMessageSource {
        case apiResponse
        case webSocket
        case history
    }

    // Per-group "we've already backfilled the full server history" flag.
    // Persisted across launches so we only do the one-time backfill once
    // per group per install. Cleared on logout via LocalCache.clear().
    private static let backfilledKey = "bbchat.group_backfilled"

    private var isBackfilled: Bool {
        let ids = UserDefaults.standard.array(forKey: Self.backfilledKey) as? [Int] ?? []
        return ids.contains(group.groupID)
    }

    private func markBackfilled() {
        var ids = UserDefaults.standard.array(forKey: Self.backfilledKey) as? [Int] ?? []
        if !ids.contains(group.groupID) {
            ids.append(group.groupID)
            UserDefaults.standard.set(ids, forKey: Self.backfilledKey)
        }
    }

    init(group: ChatGroup) {
        self.group = group
        let initial = store.loadGroupMessages(groupID: group.groupID)
        _messages = Published(initialValue: initial)
        if !initial.isEmpty {
            _hasMore = Published(initialValue: initial.count >= 30)
        }
        setupWebSocketListener()
    }

    func loadMessages() async {
        let showBlockingLoader = messages.isEmpty
        if showBlockingLoader { isLoading = true }
        defer { isLoading = false }

        let cached = store.loadGroupMessages(groupID: group.groupID)
        if !cached.isEmpty {
            messages = cached
            hasMore = cached.count >= 30
        }

        let latestID = store.latestGroupMessageID(groupID: group.groupID)
        do {
            if let latestID = latestID {
                let allNew = try await fetchNewerGroupMessages(afterID: latestID)
                mergeFetchedGroupMessages(allNew)
                let recent = try await fetchRecentGroupMessages()
                mergeFetchedGroupMessages(recent)
            } else {
                // First visit to this group on this device (no local cache).
                // Pull the latest page so the UI renders fast; backfill below.
                let (msgs, _) = try await APIService.shared.getGroupMessages(
                    groupID: group.groupID, limit: 100
                )
                store.saveGroupMessages(msgs)
                messages = msgs
                hasMore = false
            }

            // Whichever branch ran, if we haven't yet pulled the full server
            // history for this group on this device, kick off the backfill.
            // Handles both the fresh-install case and the "user had a tiny
            // cache from a prior broken build" case that used to leave them
            // stuck at 30 messages.
            if !isBackfilled {
                // Suppress manual scroll-up trigger during backfill so it
                // doesn't race with our background pagination.
                hasMore = false
                Task { [weak self] in
                    await self?.backfillOlderMessages()
                }
            }
        } catch {
            if messages.isEmpty { errorMessage = L10n.tr("messages.loadFailed") }
        }
    }

    /// Paginate through every older page on the server and persist them to
    /// local storage. Runs once per group per install (guarded by the
    /// `isBackfilled` flag). Marks the group as backfilled only on clean
    /// completion (server said no more, or earliest message reached).
    private func backfillOlderMessages() async {
        let maxPages = 50  // 50 * 100 = 5000 messages safety cap
        var cursor = messages.first?.id
        for _ in 0..<maxPages {
            guard let before = cursor else {
                markBackfilled()
                updateHasCachedOlderMessages()
                return
            }
            do {
                let (older, hasOlder) = try await APIService.shared.getGroupMessages(
                    groupID: group.groupID, beforeID: before, limit: 100
                )
                if older.isEmpty {
                    markBackfilled()
                    updateHasCachedOlderMessages()
                    return
                }
                store.saveGroupMessages(older)
                cursor = older.first?.id
                if !hasOlder {
                    markBackfilled()
                    updateHasCachedOlderMessages()
                    return
                }
            } catch {
                // Give up silently; surface the manual scroll-up path so
                // the user can retry later. Don't mark as backfilled so
                // next app open will retry.
                updateHasCachedOlderMessages(fallback: true)
                return
            }
        }
        // Hit the safety cap — leave scroll-up enabled for older history.
        // Don't mark as backfilled; next open may pick up more history.
        updateHasCachedOlderMessages(fallback: true)
    }

    private func updateHasCachedOlderMessages(fallback: Bool = false) {
        guard let firstID = messages.first?.id else {
            hasMore = false
            return
        }
        let cachedOlder = store.loadGroupMessages(groupID: group.groupID, beforeID: firstID, limit: 1)
        hasMore = cachedOlder.isEmpty ? fallback : true
    }

    func loadMoreMessages() async {
        guard hasMore, let first = messages.first else { return }

        let cached = store.loadGroupMessages(groupID: group.groupID, beforeID: first.id)
        if !cached.isEmpty {
            messages.insert(contentsOf: cached, at: 0)
            hasMore = store.loadGroupMessages(groupID: group.groupID, beforeID: cached.first!.id, limit: 1).count > 0
            return
        }

        do {
            let (msgs, more) = try await APIService.shared.getGroupMessages(groupID: group.groupID, beforeID: first.id)
            store.saveGroupMessages(msgs)
            messages.insert(contentsOf: msgs, at: 0)
            hasMore = more
        } catch { }
    }

    func submitText() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let replyID = replyingTo?.id
        let mentions = mentionedUserIDs
        let signature = outgoingSignature(
            content: text,
            msgType: "text",
            replyID: replyID,
            mentions: mentions
        )
        let now = Date()
        if let lastTextSubmit,
           lastTextSubmit.signature == signature,
           now.timeIntervalSince(lastTextSubmit.date) < 0.8 {
            return
        }
        lastTextSubmit = (signature, now)

        inputText = ""
        replyingTo = nil
        mentionedUserIDs = []

        let pendingID = UUID().uuidString
        let pending = PendingGroupText(
            id: pendingID,
            content: text,
            replyID: replyID,
            mentions: mentions,
            status: .sending
        )
        pendingTexts.append(pending)

        Task { [weak self] in
            await self?.finishTextSend(pendingID: pendingID, text: text, replyID: replyID, mentions: mentions)
        }
    }

    private func finishTextSend(pendingID: String, text: String, replyID: Int?, mentions: [String] = []) async {
        do {
            let msg = try await APIService.shared.sendGroupText(
                groupID: group.groupID,
                content: text,
                replyToID: replyID,
                mentions: mentions,
                clientMessageID: pendingID
            )
            store.saveGroupMessage(msg)
            let shouldMergeOutgoingEcho = !pendingTexts.contains { $0.id == pendingID }
            removePendingText(id: pendingID)
            appendMessageIfNeeded(msg, source: .apiResponse, shouldMergeOutgoingEcho: shouldMergeOutgoingEcho)
        } catch {
            markPendingTextFailed(id: pendingID)
            errorMessage = L10n.tr("messages.sendFailed")
        }
    }

    func retryPendingText(_ pending: PendingGroupText) async {
        if let idx = pendingTexts.firstIndex(where: { $0.id == pending.id }) {
            pendingTexts[idx].status = .sending
        }
        await finishTextSend(
            pendingID: pending.id,
            text: pending.content,
            replyID: pending.replyID,
            mentions: pending.mentions
        )
    }

    func setReply(to message: GroupMessage) {
        replyingTo = message
    }

    func cancelReply() {
        replyingTo = nil
    }

    func addMention(userID: String, nickname: String) {
        if !mentionedUserIDs.contains(userID) {
            mentionedUserIDs.append(userID)
        }
        inputText += "@\(nickname) "
        showMentionPicker = false
    }

    func sendImage(data: Data) async {
        isSending = true
        do {
            let msg = try await APIService.shared.sendGroupImage(groupID: group.groupID, imageData: data, filename: "img_\(Int(Date().timeIntervalSince1970)).jpg")
            store.saveGroupMessage(msg)
            appendMessageIfNeeded(msg)
        } catch {
            errorMessage = L10n.tr("messages.imageSendFailed")
        }
        isSending = false
    }

    func sendVideo(data: Data, filename: String) async {
        isSending = true
        do {
            let msg = try await APIService.shared.sendGroupVideo(groupID: group.groupID, videoData: data, filename: filename)
            store.saveGroupMessage(msg)
            appendMessageIfNeeded(msg)
        } catch {
            errorMessage = L10n.tr("messages.videoSendFailed")
        }
        isSending = false
    }

    func sendVoice(data: Data, duration: Double) async {
        isSending = true
        do {
            let msg = try await APIService.shared.sendGroupVoice(
                groupID: group.groupID,
                voiceData: data,
                duration: duration,
                filename: "voice_\(Int(Date().timeIntervalSince1970)).m4a"
            )
            store.saveGroupMessage(msg)
            appendMessageIfNeeded(msg)
        } catch {
            errorMessage = L10n.tr("messages.voiceSendFailed")
        }
        isSending = false
    }

    func sendGift(_ gift: GiftCatalogItem, recipientID: String) async throws {
        guard recipientID != AuthManager.shared.currentUser?.userID else {
            throw APIError.serverError(code: 400, message: L10n.tr("gift.cannotSendToSelf"))
        }

        isSending = true
        defer { isSending = false }

        do {
            let msg = try await APIService.shared.sendGroupGift(
                groupID: group.groupID,
                recipientID: recipientID,
                giftID: gift.giftID
            )
            store.saveGroupMessage(msg)
            appendMessageIfNeeded(msg)
            Task { await WalletStore.shared.refreshBalanceFromServer() }
        } catch {
            errorMessage = L10n.tr("gift.sendFailed")
            throw error
        }
    }

    var isSendEnabled: Bool {
        !inputText.isBlank
    }

    private func triggerMentionAlertIfNeeded(_ msg: GroupMessage) {
        guard let myID = AuthManager.shared.currentUser?.userID,
              let mentions = msg.mentions,
              mentions.contains(myID),
              msg.senderID != myID else { return }
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.warning)
        AudioServicesPlaySystemSound(1315)
        mentionAlertMessage = msg
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            if self?.mentionAlertMessage?.id == msg.id {
                withAnimation(.easeOut(duration: 0.3)) {
                    self?.mentionAlertMessage = nil
                }
            }
        }
    }

    private func setupWebSocketListener() {
        WebSocketService.shared.groupMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] msg in
                guard let self = self else { return }
                if msg.groupID == self.group.groupID {
                    self.store.saveGroupMessage(msg)
                    var shouldMergeOutgoingEcho = false
                    if msg.senderID == AuthManager.shared.currentUser?.userID {
                        self.webSocketConfirmedMessageIDs.insert(msg.id)
                        let resolvedPending = self.removeFirstPendingText {
                            self.pendingText($0, matches: msg)
                        }
                        shouldMergeOutgoingEcho = !resolvedPending
                    }
                    self.appendMessageIfNeeded(
                        msg,
                        source: .webSocket,
                        shouldMergeOutgoingEcho: shouldMergeOutgoingEcho
                    )
                    self.triggerMentionAlertIfNeeded(msg)
                    if msg.senderID != AuthManager.shared.currentUser?.userID {
                        Task {
                            try? await APIService.shared.markGroupMessagesAsRead(groupID: self.group.groupID)
                            await MainActor.run { PushService.shared.clearBadge() }
                        }
                    }
                }
            }
            .store(in: &cancellables)

        WebSocketService.shared.groupContactUpdatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self = self,
                      Self.intValue(data["group_id"]) == self.group.groupID else { return }
                Task { await self.syncLatestMessages() }
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .conversationListNeedsReload)
            .debounce(for: .milliseconds(250), scheduler: DispatchQueue.main)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.syncLatestMessages() }
            }
            .store(in: &cancellables)

        WebSocketService.shared.chatResetPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in
                self?.messages.removeAll()
                self?.pendingTexts.removeAll()
            }
            .store(in: &cancellables)
    }

    private func syncLatestMessages() async {
        guard !isSyncingLatest else { return }
        isSyncingLatest = true
        defer { isSyncingLatest = false }

        let latestID = store.latestGroupMessageID(groupID: group.groupID)
        do {
            var fetched: [GroupMessage] = []
            if let latestID {
                fetched.append(contentsOf: try await fetchNewerGroupMessages(afterID: latestID))
            }
            fetched.append(contentsOf: try await fetchRecentGroupMessages())
            mergeFetchedGroupMessages(fetched, triggerMentions: true)

            try? await APIService.shared.markGroupMessagesAsRead(groupID: group.groupID)
            PushService.shared.clearBadge()
        } catch {
            print("[GroupChat] Failed to sync latest: \(error)")
        }
    }

    private func fetchNewerGroupMessages(afterID latestID: Int) async throws -> [GroupMessage] {
        var allNew: [GroupMessage] = []
        var fetchMore = true
        var currentAfterID = latestID
        while fetchMore {
            let (msgs, more) = try await APIService.shared.getGroupMessages(
                groupID: group.groupID,
                afterID: currentAfterID,
                limit: 100
            )
            allNew.append(contentsOf: msgs)
            fetchMore = more && !msgs.isEmpty
            if let last = msgs.last {
                currentAfterID = last.id
            }
        }
        return allNew
    }

    private func fetchRecentGroupMessages() async throws -> [GroupMessage] {
        let (msgs, _) = try await APIService.shared.getGroupMessages(
            groupID: group.groupID,
            limit: 100
        )
        return msgs
    }

    private func mergeFetchedGroupMessages(_ fetched: [GroupMessage], triggerMentions: Bool = false) {
        let scoped = fetched.filter { $0.groupID == group.groupID }
        guard !scoped.isEmpty else { return }

        let existingIDs = Set(messages.map(\.id))
        store.saveGroupMessages(scoped)
        appendMessagesIfNeeded(scoped)

        guard triggerMentions else { return }
        scoped
            .filter { !existingIDs.contains($0.id) }
            .forEach(triggerMentionAlertIfNeeded)
    }

    private func appendMessageIfNeeded(
        _ message: GroupMessage,
        source: GroupMessageSource = .history,
        shouldMergeOutgoingEcho: Bool = false
    ) {
        appendMessagesIfNeeded(
            [message],
            source: source,
            shouldMergeOutgoingEcho: shouldMergeOutgoingEcho
        )
    }

    private func removePendingText(id: String) {
        pendingTexts.removeAll { $0.id == id }
    }

    private func markPendingTextFailed(id: String) {
        if let idx = pendingTexts.firstIndex(where: { $0.id == id }) {
            pendingTexts[idx].status = .failed
        }
    }

    @discardableResult
    private func removeFirstPendingText(matching predicate: (PendingGroupText) -> Bool) -> Bool {
        guard let idx = pendingTexts.firstIndex(where: predicate) else { return false }
        pendingTexts.remove(at: idx)
        return true
    }

    private func appendMessagesIfNeeded(
        _ newMessages: [GroupMessage],
        source: GroupMessageSource = .history,
        shouldMergeOutgoingEcho: Bool = false
    ) {
        var changed = false
        for message in newMessages {
            if source == .webSocket {
                webSocketConfirmedMessageIDs.insert(message.id)
            }

            if let existingIndex = messages.firstIndex(where: { $0.id == message.id }) {
                if messages[existingIndex] != message {
                    messages[existingIndex] = message
                    changed = true
                }
                continue
            }

            if shouldMergeOutgoingEcho,
               let echoIndex = outgoingEchoIndex(for: message) {
                let existing = messages[echoIndex]
                let merged = preferredMessage(existing: existing, incoming: message, source: source)
                messages[echoIndex] = merged
                changed = true
                continue
            }

            messages.append(message)
            changed = true
        }
        guard changed else { return }
        messages.sort { $0.id < $1.id }
    }

    private func pendingText(_ pending: PendingGroupText, matches message: GroupMessage) -> Bool {
        if message.clientMessageID == pending.id {
            return true
        }

        return pending.content == message.content
            && pending.replyID == replyTargetID(for: message)
            && normalizedMentions(pending.mentions) == normalizedMentions(message.mentions)
            && message.msgType == "text"
    }

    private func outgoingEchoIndex(for message: GroupMessage) -> Int? {
        guard isOwnOutgoingText(message),
              let clientMessageID = nonBlank(message.clientMessageID) else { return nil }
        return messages.lastIndex { existing in
            existing.id != message.id
                && isOwnOutgoingText(existing)
                && nonBlank(existing.clientMessageID) == clientMessageID
        }
    }

    private func preferredMessage(
        existing: GroupMessage,
        incoming: GroupMessage,
        source: GroupMessageSource
    ) -> GroupMessage {
        if source == .webSocket {
            return incoming
        }
        if webSocketConfirmedMessageIDs.contains(existing.id) {
            return existing
        }
        return incoming
    }

    private func isOwnOutgoingText(_ message: GroupMessage) -> Bool {
        message.groupID == group.groupID
            && message.senderID == AuthManager.shared.currentUser?.userID
            && message.msgType == "text"
    }

    private func outgoingSignature(for message: GroupMessage) -> String {
        outgoingSignature(
            content: message.content,
            msgType: message.msgType,
            replyID: replyTargetID(for: message),
            mentions: message.mentions
        )
    }

    private func outgoingSignature(
        content: String,
        msgType: String,
        replyID: Int?,
        mentions: [String]?
    ) -> String {
        [
            msgType,
            replyID.map(String.init) ?? "",
            normalizedMentions(mentions).joined(separator: ","),
            content
        ].joined(separator: "\u{1F}")
    }

    private func replyTargetID(for message: GroupMessage) -> Int? {
        message.replyToID ?? message.replyTo?.id
    }

    private func normalizedMentions(_ mentions: [String]?) -> [String] {
        Array(Set(mentions ?? [])).sorted()
    }

    private func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func timestampsAreClose(_ lhs: String, _ rhs: String) -> Bool {
        guard lhs != rhs else { return true }
        guard let lhsDate = TimestampHelper.parse(lhs),
              let rhsDate = TimestampHelper.parse(rhs) else {
            return false
        }
        return abs(lhsDate.timeIntervalSince(rhsDate)) <= 30
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) }
        return nil
    }
}

struct PendingGroupText: Identifiable {
    let id: String
    let content: String
    let replyID: Int?
    let mentions: [String]
    let createdAt: Date
    var status: PendingStatus = .sending

    enum PendingStatus {
        case sending, failed
    }

    init(
        id: String,
        content: String,
        replyID: Int? = nil,
        mentions: [String] = [],
        status: PendingStatus = .sending,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.content = content
        self.replyID = replyID
        self.mentions = mentions
        self.status = status
        self.createdAt = createdAt
    }

    var formattedTime: String {
        TimestampHelper.formatTime(createdAt)
    }
}
