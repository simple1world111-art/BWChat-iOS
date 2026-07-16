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
    @Published var pendingStickers: [PendingGroupSticker] = []
    @Published var pendingMedia: [PendingGroupMedia] = []
    @Published var replyingTo: GroupMessage?
    @Published var mentionedUserIDs: [String] = []
    @Published var showMentionPicker = false
    @Published var mentionAlertMessage: GroupMessage?

    let group: ChatGroup
    private var cancellables = Set<AnyCancellable>()
    private let store = MessageStore.shared
    private var isSyncingLatest = false
    private var apiConfirmedMessageIDs = Set<Int>()
    private var webSocketConfirmedMessageIDs = Set<Int>()
    private var nextOptimisticMessageID = Int.max / 4
    private var optimisticStickerMessageIDs = Set<Int>()
    private var optimisticStickerSignatures: [Int: StickerSendSignature] = [:]

    private enum GroupMessageSource {
        case apiResponse
        case webSocket
        case history
    }

    private struct StickerSendSignature: Equatable {
        let stickerID: String
        let packID: String
        let assetKey: String
        let replyID: Int?
    }

    // Per-group "we've already backfilled the full server history" flag.
    // Persisted across launches so we only do the one-time backfill once
    // per group per install. Cleared on logout via LocalCache.clear().
    private var backfilledKey: String {
        "bbchat.group_backfilled.\(AuthManager.shared.currentUser?.userID ?? "locked")"
    }

    private var isBackfilled: Bool {
        let ids = UserDefaults.standard.array(forKey: backfilledKey) as? [Int] ?? []
        return ids.contains(group.groupID)
    }

    private func markBackfilled() {
        var ids = UserDefaults.standard.array(forKey: backfilledKey) as? [Int] ?? []
        if !ids.contains(group.groupID) {
            ids.append(group.groupID)
            UserDefaults.standard.set(ids, forKey: backfilledKey)
        }
    }

    private func userFacingSendError(_ error: Error, fallbackKey: String) -> String {
        if let localizedError = error as? LocalizedError,
           let message = localizedError.errorDescription?.trimmingCharacters(in: .whitespacesAndNewlines),
           !message.isEmpty {
            return message
        }
        return L10n.tr(fallbackKey)
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
        } catch {
            errorMessage = userFacingSendError(error, fallbackKey: "messages.loadFailed")
        }
    }

    func submitText() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let replyID = replyingTo?.id
        let mentions = mentionedUserIDs
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
            let response = try await APIService.shared.sendGroupText(
                groupID: group.groupID,
                content: text,
                replyToID: replyID,
                mentions: mentions,
                clientMessageID: pendingID
            )
            let msg = normalizedOutgoingMessage(
                response,
                expectedType: "text",
                expectedContent: text,
                replyID: replyID,
                mentions: mentions,
                clientMessageID: pendingID
            )
            store.saveGroupMessage(msg)
            removePendingText(id: pendingID)
            appendMessageIfNeeded(msg, source: .apiResponse, shouldMergeOutgoingEcho: true)
        } catch {
            markPendingTextFailed(id: pendingID)
            errorMessage = userFacingSendError(error, fallbackKey: "messages.sendFailed")
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

    func sendSticker(pack: StickerPack, sticker: StickerItem) async {
        isSending = true
        defer { isSending = false }

        let replyMessage = replyingTo
        let replyID = replyMessage?.id
        let clientMessageID = UUID().uuidString
        let payload = StickerMessagePayload(pack: pack, sticker: sticker)
        let signature = stickerSignature(content: payload.encodedContent, replyID: replyID)

        replyingTo = nil
        let localMessage = makeOptimisticStickerMessage(
            content: payload.encodedContent,
            clientMessageID: clientMessageID,
            replyTo: replyMessage
        )
        optimisticStickerMessageIDs.insert(localMessage.id)
        optimisticStickerSignatures[localMessage.id] = signature
        appendMessageIfNeeded(localMessage)

        do {
            let response = try await APIService.shared.sendGroupSticker(
                groupID: group.groupID,
                packID: pack.id,
                stickerID: sticker.id,
                replyToID: replyID,
                clientMessageID: clientMessageID
            )
            let msg = normalizedOutgoingMessage(
                response,
                expectedType: "sticker",
                expectedContent: payload.encodedContent,
                replyID: replyID,
                clientMessageID: clientMessageID
            )
            store.saveGroupMessage(msg)
            appendMessageIfNeeded(msg, source: .apiResponse, shouldMergeOutgoingEcho: true)
        } catch {
            removeOptimisticStickerMessage(id: localMessage.id)
            errorMessage = userFacingSendError(error, fallbackKey: "messages.stickerSendFailed")
        }
    }

    private func finishStickerSend(
        pendingID: String,
        packID: String,
        stickerID: String,
        replyID: Int?
    ) async {
        do {
            let response = try await APIService.shared.sendGroupSticker(
                groupID: group.groupID,
                packID: packID,
                stickerID: stickerID,
                replyToID: replyID,
                clientMessageID: pendingID
            )
            let msg = normalizedOutgoingMessage(
                response,
                expectedType: "sticker",
                expectedContent: pendingStickers.first(where: { $0.id == pendingID })?.content,
                replyID: replyID,
                clientMessageID: pendingID
            )
            store.saveGroupMessage(msg)
            removePendingSticker(id: pendingID)
            appendMessageIfNeeded(msg, source: .apiResponse, shouldMergeOutgoingEcho: true)
        } catch {
            markPendingStickerFailed(id: pendingID)
            errorMessage = userFacingSendError(error, fallbackKey: "messages.stickerSendFailed")
        }
    }

    func retryPendingSticker(_ pending: PendingGroupSticker) async {
        if let idx = pendingStickers.firstIndex(where: { $0.id == pending.id }) {
            pendingStickers[idx].status = .sending
        }
        await finishStickerSend(
            pendingID: pending.id,
            packID: pending.packID,
            stickerID: pending.stickerID,
            replyID: pending.replyID
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
        let pending = PendingGroupMedia(msgType: "image", data: data, filename: "img_\(UUID().uuidString).jpg")
        pendingMedia.append(pending)
        enqueueMediaUpload(pending)
    }

    func sendVideo(data: Data, filename: String) async {
        let pending = PendingGroupMedia(msgType: "video", data: data, filename: filename)
        pendingMedia.append(pending)
        enqueueMediaUpload(pending)
    }

    func retryPendingMedia(_ pending: PendingGroupMedia) {
        guard let index = pendingMedia.firstIndex(where: { $0.id == pending.id }) else { return }
        pendingMedia[index].status = .sending
        enqueueMediaUpload(pendingMedia[index])
    }

    private func enqueueMediaUpload(_ pending: PendingGroupMedia) {
        BackgroundUploadCoordinator.shared.enqueue(id: "group-\(group.groupID)-\(pending.id)") { [self] in
            await finishMediaSend(pending)
        }
    }

    private func finishMediaSend(_ pending: PendingGroupMedia) async {
        do {
            let response: GroupMessage
            if pending.msgType == "video" {
                response = try await APIService.shared.sendGroupVideo(
                    groupID: group.groupID,
                    videoData: pending.data,
                    filename: pending.filename
                )
            } else {
                response = try await APIService.shared.sendGroupImage(
                    groupID: group.groupID,
                    imageData: pending.data,
                    filename: pending.filename
                )
            }
            let msg = normalizedOutgoingMessage(response, expectedType: pending.msgType)
            store.saveGroupMessage(msg)
            pendingMedia.removeAll { $0.id == pending.id }
            appendMessageIfNeeded(msg, source: .apiResponse, shouldMergeOutgoingEcho: true)
        } catch {
            if let index = pendingMedia.firstIndex(where: { $0.id == pending.id }) {
                pendingMedia[index].status = .failed
            }
            let key = pending.msgType == "video" ? "messages.videoSendFailed" : "messages.imageSendFailed"
            errorMessage = userFacingSendError(error, fallbackKey: key)
        }
    }

    func sendVoice(data: Data, duration: Double) async {
        isSending = true
        do {
            let response = try await APIService.shared.sendGroupVoice(
                groupID: group.groupID,
                voiceData: data,
                duration: duration,
                filename: "voice_\(Int(Date().timeIntervalSince1970)).m4a"
            )
            let msg = normalizedOutgoingMessage(response, expectedType: "voice")
            store.saveGroupMessage(msg)
            appendMessageIfNeeded(msg, source: .apiResponse, shouldMergeOutgoingEcho: true)
        } catch {
            errorMessage = userFacingSendError(error, fallbackKey: "messages.voiceSendFailed")
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
            let response = try await APIService.shared.sendGroupGift(
                groupID: group.groupID,
                recipientID: recipientID,
                giftID: gift.giftID
            )
            let msg = normalizedOutgoingMessage(response, expectedType: "gift")
            store.saveGroupMessage(msg)
            appendMessageIfNeeded(msg, source: .apiResponse, shouldMergeOutgoingEcho: true)
            Task { await WalletStore.shared.refreshBalanceFromServer() }
        } catch {
            errorMessage = userFacingSendError(error, fallbackKey: "gift.sendFailed")
            throw error
        }
    }

    func appendCreatedChatMoneyMessage(_ result: ChatMoneyCreationResult) {
        guard case .group(let response) = result.message,
              response.groupID == group.groupID else { return }
        let message = response.replacingChatMoneyPayload(result.payload)
        store.saveGroupMessage(message)
        appendMessageIfNeeded(
            message,
            source: .apiResponse,
            shouldMergeOutgoingEcho: true
        )
    }

    var isSendEnabled: Bool {
        !inputText.isBlank
    }

    var visiblePendingTexts: [PendingGroupText] {
        pendingTexts.filter { pending in
            !messages.contains {
                isOwnOutgoingMergeable($0) && pendingText(pending, matches: $0)
            }
        }
    }

    var visiblePendingStickers: [PendingGroupSticker] {
        pendingStickers.filter { pending in
            !messages.contains {
                isOwnOutgoingMergeable($0) && pendingSticker(pending, matches: $0)
            }
        }
    }

    var visiblePendingMedia: [PendingGroupMedia] {
        pendingMedia
    }

    func markConversationAsReadOnServer() {
        UnreadBadgeStore.shared.setConversationUnreadCount(
            0,
            for: ConversationReadTarget.group(groupID: group.groupID).listIdentity
        )
        Task {
            try? await APIService.shared.markGroupMessagesAsRead(groupID: group.groupID)
            await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
        }
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
                    if msg.senderID == AuthManager.shared.currentUser?.userID {
                        var resolvedPending = self.removeFirstPendingText {
                            self.pendingText($0, matches: msg)
                        }
                        if !resolvedPending {
                            resolvedPending = self.removeFirstPendingSticker {
                                self.pendingSticker($0, matches: msg)
                            }
                        }
                    }
                    self.appendMessageIfNeeded(
                        msg,
                        source: .webSocket,
                        shouldMergeOutgoingEcho: msg.senderID == AuthManager.shared.currentUser?.userID
                    )
                    self.triggerMentionAlertIfNeeded(msg)
                    if msg.senderID != AuthManager.shared.currentUser?.userID,
                       WebSocketService.shared.activeGroupID == self.group.groupID {
                        UnreadBadgeStore.shared.setConversationUnreadCount(
                            0,
                            for: ConversationReadTarget.group(groupID: self.group.groupID).listIdentity
                        )
                        Task {
                            try? await APIService.shared.markGroupMessagesAsRead(groupID: self.group.groupID)
                            await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
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

        WebSocketService.shared.chatMoneyUpdatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] update in
                guard let self else { return }
                if let current = self.messages.first(where: {
                    $0.chatMoneyPayload?.assetID == update.payload.assetID
                })?.chatMoneyPayload,
                   current.version >= update.payload.version {
                    return
                }
                if let replacement = update.groupMessage {
                    guard replacement.groupID == self.group.groupID else { return }
                    self.store.saveGroupMessage(replacement)
                    if let index = self.messages.firstIndex(where: { $0.id == replacement.id }) {
                        self.messages[index] = replacement
                    } else {
                        self.appendMessageIfNeeded(replacement, source: .webSocket)
                    }
                    return
                }
                guard let index = self.messages.firstIndex(where: {
                    $0.chatMoneyPayload?.assetID == update.payload.assetID
                }) else { return }
                let replacement = self.messages[index].replacingChatMoneyPayload(update.payload)
                self.messages[index] = replacement
                self.store.saveGroupMessage(replacement)
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
                self?.pendingStickers.removeAll()
                self?.apiConfirmedMessageIDs.removeAll()
                self?.webSocketConfirmedMessageIDs.removeAll()
            }
            .store(in: &cancellables)
    }

    private func syncLatestMessages() async {
        guard !isSyncingLatest else { return }
        isSyncingLatest = true
        defer { isSyncingLatest = false }

        let isActivelyVisible = WebSocketService.shared.activeGroupID == group.groupID
        if isActivelyVisible {
            UnreadBadgeStore.shared.setConversationUnreadCount(
                0,
                for: ConversationReadTarget.group(groupID: group.groupID).listIdentity
            )
        }

        let latestID = store.latestGroupMessageID(groupID: group.groupID)
        do {
            var fetched: [GroupMessage] = []
            if let latestID {
                fetched.append(contentsOf: try await fetchNewerGroupMessages(afterID: latestID))
            }
            fetched.append(contentsOf: try await fetchRecentGroupMessages())
            mergeFetchedGroupMessages(fetched, triggerMentions: true)

            if isActivelyVisible, WebSocketService.shared.activeGroupID == group.groupID {
                try? await APIService.shared.markGroupMessagesAsRead(groupID: group.groupID)
                PushService.shared.syncBadgeFromUnreadState()
            }
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
        appendMessagesIfNeeded(
            scoped,
            source: .history,
            shouldMergeOutgoingEcho: true
        )

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

    private func nextLocalStickerMessageID() -> Int {
        let id = nextOptimisticMessageID
        nextOptimisticMessageID += 1
        return id
    }

    private func makeOptimisticStickerMessage(
        content: String,
        clientMessageID: String,
        replyTo: GroupMessage?
    ) -> GroupMessage {
        let currentUser = AuthManager.shared.currentUser
        return GroupMessage(
            id: nextLocalStickerMessageID(),
            groupID: group.groupID,
            senderID: currentUser?.userID ?? "",
            msgType: "sticker",
            content: content,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            senderNickname: currentUser?.nickname ?? L10n.tr("common.me"),
            senderAvatar: currentUser?.avatarURL ?? "",
            replyToID: replyTo?.id,
            replyTo: replyTo.map {
                GroupReplyPreview(
                    id: $0.id,
                    senderID: $0.senderID,
                    msgType: $0.msgType,
                    content: $0.content
                )
            },
            mentions: nil,
            clientMessageID: clientMessageID
        )
    }

    private func removeOptimisticStickerMessage(id: Int) {
        clearOptimisticStickerTracking(id)
        messages.removeAll { $0.id == id }
    }

    private func clearOptimisticStickerTracking(_ id: Int) {
        optimisticStickerMessageIDs.remove(id)
        optimisticStickerSignatures.removeValue(forKey: id)
    }

    private func removePendingText(id: String) {
        pendingTexts.removeAll { $0.id == id }
    }

    private func markPendingTextFailed(id: String) {
        if let idx = pendingTexts.firstIndex(where: { $0.id == id }) {
            pendingTexts[idx].status = .failed
        }
    }

    private func removePendingSticker(id: String) {
        pendingStickers.removeAll { $0.id == id }
    }

    private func markPendingStickerFailed(id: String) {
        if let idx = pendingStickers.firstIndex(where: { $0.id == id }) {
            pendingStickers[idx].status = .failed
        }
    }

    @discardableResult
    private func removeFirstPendingText(matching predicate: (PendingGroupText) -> Bool) -> Bool {
        guard let idx = pendingTexts.firstIndex(where: predicate) else { return false }
        pendingTexts.remove(at: idx)
        return true
    }

    @discardableResult
    private func removeFirstPendingSticker(matching predicate: (PendingGroupSticker) -> Bool) -> Bool {
        guard let idx = pendingStickers.firstIndex(where: predicate) else { return false }
        pendingStickers.remove(at: idx)
        return true
    }

    private func appendMessagesIfNeeded(
        _ newMessages: [GroupMessage],
        source: GroupMessageSource = .history,
        shouldMergeOutgoingEcho: Bool = false
    ) {
        var changed = false
        for message in newMessages {
            markConfirmed(message.id, source: source)

            if let existingIndex = messages.firstIndex(where: { $0.id == message.id }) {
                if messages[existingIndex] != message {
                    messages[existingIndex] = message
                    changed = true
                }
                continue
            }

            if shouldMergeOutgoingEcho,
               let echoIndex = outgoingEchoIndex(for: message, source: source) {
                let existing = messages[echoIndex]
                clearOptimisticStickerTracking(existing.id)
                let merged = preferredMessage(existing: existing, incoming: message, source: source)
                clearDeliveryTracking(for: existing.id, unlessKeeping: merged.id)
                clearDeliveryTracking(for: message.id, unlessKeeping: merged.id)
                if merged.id == message.id {
                    markConfirmed(merged.id, source: source)
                }
                if existing.id != message.id {
                    store.deleteGroupMessage(id: merged.id == existing.id ? message.id : existing.id)
                }
                messages[echoIndex] = merged
                changed = true
                continue
            }

            messages.append(message)
            changed = true
        }
        guard changed else { return }
        sortMessagesForDisplay()
        if source == .apiResponse {
            newMessages.forEach {
                NotificationCenter.default.post(name: .conversationPreviewDidChange, object: $0)
            }
        }
    }

    private func pendingText(_ pending: PendingGroupText, matches message: GroupMessage) -> Bool {
        if message.clientMessageID == pending.id {
            return true
        }

        return pending.content == message.content
            && pendingReplyMatches(pending.replyID, replyTargetID(for: message))
            && (message.mentions == nil
                || normalizedMentions(pending.mentions) == normalizedMentions(message.mentions))
            && MessageDeliveryMatcher.normalizedType(message.msgType) == "text"
            && pendingTimestampMatches(pending.createdAt, messageTimestamp: message.timestamp)
    }

    private func pendingSticker(_ pending: PendingGroupSticker, matches message: GroupMessage) -> Bool {
        if message.clientMessageID == pending.id {
            return true
        }

        return stickerSignaturesMatch(
                stickerSignature(content: pending.content, replyID: pending.replyID),
                stickerSignature(content: message.content, replyID: replyTargetID(for: message))
            )
            && pendingReplyMatches(pending.replyID, replyTargetID(for: message))
            && MessageDeliveryMatcher.normalizedType(message.msgType) == "sticker"
            && pendingTimestampMatches(pending.createdAt, messageTimestamp: message.timestamp)
    }

    private func outgoingEchoIndex(
        for message: GroupMessage,
        source: GroupMessageSource
    ) -> Int? {
        guard isOwnOutgoingMergeable(message) else { return nil }

        if let clientMessageID = nonBlank(message.clientMessageID),
           let clientMatch = messages.lastIndex(where: { existing in
               existing.id != message.id
                   && isOwnOutgoingMergeable(existing)
                   && nonBlank(existing.clientMessageID) == clientMessageID
           }) {
            return clientMatch
        }

        return messages.lastIndex { existing in
            guard existing.id != message.id,
                  isOwnOutgoingMergeable(existing),
                  MessageDeliveryMatcher.normalizedType(existing.msgType)
                    == MessageDeliveryMatcher.normalizedType(message.msgType),
                  replyTargetID(for: existing) == replyTargetID(for: message),
                  normalizedMentions(existing.mentions) == normalizedMentions(message.mentions),
                  timestampsAreClose(existing.timestamp, message.timestamp),
                  isEligibleEcho(existing.id, for: source) else {
                return false
            }

            return outgoingContentsMatch(existing, message)
        }
    }

    private func isEligibleEcho(_ existingID: Int, for source: GroupMessageSource) -> Bool {
        switch source {
        case .apiResponse:
            return webSocketConfirmedMessageIDs.contains(existingID)
                || optimisticStickerMessageIDs.contains(existingID)
        case .webSocket:
            return apiConfirmedMessageIDs.contains(existingID)
                || optimisticStickerMessageIDs.contains(existingID)
        case .history:
            return apiConfirmedMessageIDs.contains(existingID)
                || webSocketConfirmedMessageIDs.contains(existingID)
                || optimisticStickerMessageIDs.contains(existingID)
        }
    }

    private func outgoingContentsMatch(_ lhs: GroupMessage, _ rhs: GroupMessage) -> Bool {
        if lhs.msgType == "sticker" {
            return stickerSignaturesMatch(
                stickerSignature(content: lhs.content, replyID: replyTargetID(for: lhs)),
                stickerSignature(content: rhs.content, replyID: replyTargetID(for: rhs))
            )
        }
        guard MessageDeliveryMatcher.normalizedType(lhs.msgType)
                == MessageDeliveryMatcher.normalizedType(rhs.msgType) else {
            return false
        }
        return MessageDeliveryMatcher.contentsMatch(
            type: lhs.msgType,
            lhs: lhs.content,
            rhs: rhs.content
        )
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

    private func isOwnOutgoingMergeable(_ message: GroupMessage) -> Bool {
        message.groupID == group.groupID
            && message.senderID == AuthManager.shared.currentUser?.userID
            && message.msgType != "system"
    }

    private func markConfirmed(_ id: Int, source: GroupMessageSource) {
        switch source {
        case .apiResponse:
            apiConfirmedMessageIDs.insert(id)
        case .webSocket:
            webSocketConfirmedMessageIDs.insert(id)
        case .history:
            break
        }
    }

    private func clearDeliveryTracking(for id: Int, unlessKeeping keptID: Int) {
        guard id != keptID else { return }
        apiConfirmedMessageIDs.remove(id)
        webSocketConfirmedMessageIDs.remove(id)
        clearOptimisticStickerTracking(id)
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

    private func normalizedOutgoingMessage(
        _ message: GroupMessage,
        expectedType: String,
        expectedContent: String? = nil,
        replyID: Int? = nil,
        mentions: [String]? = nil,
        clientMessageID: String? = nil
    ) -> GroupMessage {
        let currentUser = AuthManager.shared.currentUser
        let content = message.content.isBlank
            ? (expectedContent ?? message.content)
            : message.content
        return GroupMessage(
            id: message.id,
            groupID: group.groupID,
            senderID: currentUser?.userID ?? message.senderID,
            msgType: expectedType,
            content: content,
            timestamp: message.timestamp.isBlank
                ? ISO8601DateFormatter().string(from: Date())
                : message.timestamp,
            senderNickname: message.senderNickname.isBlank
                ? (currentUser?.nickname ?? message.senderID)
                : message.senderNickname,
            senderAvatar: message.senderAvatar.isBlank
                ? (currentUser?.avatarURL ?? "")
                : message.senderAvatar,
            replyToID: message.replyToID ?? replyID,
            replyTo: message.replyTo,
            mentions: message.mentions ?? mentions,
            clientMessageID: nonBlank(message.clientMessageID) ?? nonBlank(clientMessageID)
        )
    }

    private func pendingTimestampMatches(_ createdAt: Date, messageTimestamp: String) -> Bool {
        if let messageDate = TimestampHelper.parse(messageTimestamp) {
            let delta = messageDate.timeIntervalSince(createdAt)
            return delta >= -2 && delta <= 90
        }
        return abs(Date().timeIntervalSince(createdAt)) <= 90
    }

    private func pendingReplyMatches(_ pendingReplyID: Int?, _ messageReplyID: Int?) -> Bool {
        pendingReplyID == messageReplyID || messageReplyID == nil
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

    private func stickerSignature(content: String, replyID: Int?) -> StickerSendSignature {
        if let payload = StickerMessagePayload.parse(content) {
            return StickerSendSignature(
                stickerID: payload.stickerID,
                packID: payload.packID,
                assetKey: payload.assetKey,
                replyID: replyID
            )
        }
        return StickerSendSignature(
            stickerID: content,
            packID: "",
            assetKey: content,
            replyID: replyID
        )
    }

    private func stickerSignaturesMatch(
        _ lhs: StickerSendSignature,
        _ rhs: StickerSendSignature
    ) -> Bool {
        guard lhs.replyID == rhs.replyID else { return false }
        if !lhs.packID.isEmpty, !rhs.packID.isEmpty, lhs.packID != rhs.packID {
            return false
        }
        return lhs.stickerID == rhs.stickerID
            || lhs.assetKey == rhs.assetKey
            || lhs.stickerID == rhs.assetKey
            || lhs.assetKey == rhs.stickerID
    }

    private func sortMessagesForDisplay() {
        messages.sort { lhs, rhs in
            if !optimisticStickerMessageIDs.isEmpty,
               let lhsDate = TimestampHelper.parse(lhs.timestamp),
               let rhsDate = TimestampHelper.parse(rhs.timestamp),
               lhsDate != rhsDate {
                return lhsDate < rhsDate
            }

            return lhs.id < rhs.id
        }
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

struct PendingGroupSticker: Identifiable {
    let id: String
    let content: String
    let packID: String
    let stickerID: String
    let replyID: Int?
    let createdAt: Date
    var status: PendingStatus = .sending

    enum PendingStatus {
        case sending, failed
    }

    init(
        id: String,
        content: String,
        packID: String,
        stickerID: String,
        replyID: Int? = nil,
        status: PendingStatus = .sending,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.content = content
        self.packID = packID
        self.stickerID = stickerID
        self.replyID = replyID
        self.status = status
        self.createdAt = createdAt
    }

    var formattedTime: String {
        TimestampHelper.formatTime(createdAt)
    }
}

struct PendingGroupMedia: Identifiable {
    let id: String
    let msgType: String
    let data: Data
    let filename: String
    let createdAt: Date
    var status: PendingStatus

    enum PendingStatus {
        case sending, failed
    }

    init(
        id: String = UUID().uuidString,
        msgType: String,
        data: Data,
        filename: String,
        createdAt: Date = Date(),
        status: PendingStatus = .sending
    ) {
        self.id = id
        self.msgType = msgType
        self.data = data
        self.filename = filename
        self.createdAt = createdAt
        self.status = status
    }

    var formattedTime: String {
        TimestampHelper.formatTime(createdAt)
    }
}
