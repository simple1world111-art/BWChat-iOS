// BWChat/ViewModels/ChatViewModel.swift
// Chat conversation view model with local caching

import Foundation
import Combine
import PhotosUI
import SwiftUI

@MainActor
class ChatViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var inputText: String = ""
    @Published var isLoading: Bool = false
    @Published var isSending: Bool = false
    @Published var hasMore: Bool = false
    @Published var errorMessage: String?
    @Published var pendingMessages: [PendingMessage] = []
    @Published var selectedImageData: Data?
    @Published var replyingTo: Message?

    let contact: Contact
    private var cancellables = Set<AnyCancellable>()
    private let store = MessageStore.shared
    private var myID: String { AuthManager.shared.currentUser?.userID ?? "" }
    private var isSyncingLatest = false
    private var nextOptimisticMessageID = Int.max / 4
    private var optimisticStickerMessageIDs = Set<Int>()
    private var optimisticStickerSignatures: [Int: StickerSendSignature] = [:]
    private var apiConfirmedMessageIDs = Set<Int>()
    private var webSocketConfirmedMessageIDs = Set<Int>()

    private enum MessageSource {
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

    // Per-DM "full server history pulled" flag. See GroupChatViewModel for
    // the rationale.
    private var backfilledKey: String { "bbchat.dm_backfilled.\(myID)" }

    private var isBackfilled: Bool {
        let ids = UserDefaults.standard.array(forKey: backfilledKey) as? [String] ?? []
        return ids.contains(contact.userID)
    }

    private func markBackfilled() {
        var ids = UserDefaults.standard.array(forKey: backfilledKey) as? [String] ?? []
        if !ids.contains(contact.userID) {
            ids.append(contact.userID)
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

    init(contact: Contact) {
        self.contact = contact
        let uid = AuthManager.shared.currentUser?.userID ?? ""
        let initial = store.loadMessages(userID: uid, contactID: contact.userID)
        _messages = Published(initialValue: initial)
        if !initial.isEmpty {
            _hasMore = Published(initialValue: store.localMessageCount(userID: uid, contactID: contact.userID) >= 30)
        }
        setupWebSocketListener()
    }

    func loadMessages() async {
        let showBlockingLoader = messages.isEmpty
        if showBlockingLoader { isLoading = true }
        errorMessage = nil
        defer { isLoading = false }

        let cached = store.loadMessages(userID: myID, contactID: contact.userID)
        if !cached.isEmpty {
            messages = cached
            hasMore = store.localMessageCount(userID: myID, contactID: contact.userID) >= 30
        }

        // Incremental sync: fetch messages newer than local latest
        let latestID = store.latestMessageID(userID: myID, contactID: contact.userID)
        do {
            if let latestID = latestID {
                mergeFetchedMessages(try await fetchNewerMessages(afterID: latestID))
                mergeFetchedMessages(try await fetchRecentMessages())
                hasMore = store.localMessageCount(userID: myID, contactID: contact.userID) >= 30
            } else {
                // First visit to this DM on this device (no local cache).
                let (msgs, _) = try await APIService.shared.getMessages(
                    contactID: contact.userID, limit: 100
                )
                store.saveMessages(msgs)
                messages = msgs
                hasMore = false
            }

            // If this install hasn't yet pulled the full server history for
            // this DM, backfill in the background regardless of which branch
            // above ran. Handles the "had a partial cache from a prior build"
            // case that would otherwise stay stuck at the incremental tail.
            if !isBackfilled {
                hasMore = false
                Task { [weak self] in
                    await self?.backfillOlderMessages()
                }
            }
        } catch let error as APIError {
            if messages.isEmpty { errorMessage = error.errorDescription }
        } catch {
            if messages.isEmpty { errorMessage = L10n.tr("messages.loadFailed") }
        }
    }

    /// Paginate through every older page on the server and persist them to
    /// local storage. Runs once per DM per install (guarded by
    /// `isBackfilled`). Marks backfilled only on clean completion.
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
                let (older, hasOlder) = try await APIService.shared.getMessages(
                    contactID: contact.userID, beforeID: before, limit: 100
                )
                if older.isEmpty {
                    markBackfilled()
                    updateHasCachedOlderMessages()
                    return
                }
                store.saveMessages(older)
                cursor = older.first?.id
                if !hasOlder {
                    markBackfilled()
                    updateHasCachedOlderMessages()
                    return
                }
            } catch {
                updateHasCachedOlderMessages(fallback: true)
                return
            }
        }
        updateHasCachedOlderMessages(fallback: true)
    }

    private func updateHasCachedOlderMessages(fallback: Bool = false) {
        guard let firstID = messages.first?.id else {
            hasMore = false
            return
        }
        let cachedOlder = store.loadMessages(userID: myID, contactID: contact.userID, beforeID: firstID, limit: 1)
        hasMore = cachedOlder.isEmpty ? fallback : true
    }

    func loadMoreMessages() async {
        guard hasMore, let firstMessage = messages.first else { return }

        let cached = store.loadMessages(userID: myID, contactID: contact.userID, beforeID: firstMessage.id)
        if !cached.isEmpty {
            messages.insert(contentsOf: cached, at: 0)
            hasMore = store.loadMessages(userID: myID, contactID: contact.userID, beforeID: cached.first!.id, limit: 1).count > 0
            return
        }

        do {
            let (msgs, more) = try await APIService.shared.getMessages(
                contactID: contact.userID, beforeID: firstMessage.id
            )
            store.saveMessages(msgs)
            messages.insert(contentsOf: msgs, at: 0)
            hasMore = more
        } catch {
            print("[Chat] Failed to load more: \(error)")
        }
    }

    func submitText() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let replyID = replyingTo?.id
        inputText = ""
        replyingTo = nil

        let pending = PendingMessage(
            receiverID: contact.userID,
            msgType: "text",
            content: text,
            imageData: nil,
            videoData: nil,
            replyToID: replyID
        )
        pendingMessages.append(pending)

        Task { [weak self] in
            await self?.finishTextSend(pendingID: pending.id, text: text, replyID: replyID)
        }
    }

    private func finishTextSend(pendingID: UUID, text: String, replyID: Int?) async {
        do {
            let response = try await APIService.shared.sendTextMessage(
                receiverID: contact.userID,
                content: text,
                replyToID: replyID
            )
            let message = normalizedOutgoingMessage(
                response,
                expectedType: "text",
                expectedContent: text,
                replyID: replyID
            )
            store.saveMessage(message)
            removePendingMessage(id: pendingID)
            appendMessageIfNeeded(
                message,
                source: .apiResponse,
                shouldMergeOutgoingEcho: true
            )
        } catch {
            markPendingMessageFailed(id: pendingID)
            errorMessage = userFacingSendError(error, fallbackKey: "messages.sendFailed")
        }
    }

    func retryPending(_ pending: PendingMessage) async {
        if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
            pendingMessages[index].status = .sending
        }

        if pending.msgType == "text" {
            await finishTextSend(pendingID: pending.id, text: pending.content, replyID: pending.replyToID)
        } else if pending.msgType == "sticker",
                  let payload = StickerMessagePayload.parse(pending.content) {
            await finishStickerSend(
                pendingID: pending.id,
                packID: payload.packID,
                stickerID: payload.stickerID,
                replyID: pending.replyToID
            )
        } else if pending.msgType == "image", let data = pending.imageData {
            enqueueImageUpload(pendingID: pending.id, data: data, filename: pending.filename ?? "image_\(pending.id.uuidString).jpg")
        } else if pending.msgType == "video", let data = pending.videoData {
            enqueueVideoUpload(pendingID: pending.id, data: data, filename: pending.filename ?? "video_\(pending.id.uuidString).mp4")
        }
    }

    func setReply(to message: Message) {
        replyingTo = message
    }

    func cancelReply() {
        replyingTo = nil
    }

    func sendSticker(pack: StickerPack, sticker: StickerItem) async {
        isSending = true
        defer { isSending = false }

        let replyMessage = replyingTo
        let replyID = replyMessage?.id
        let payload = StickerMessagePayload(pack: pack, sticker: sticker)
        let signature = stickerSignature(content: payload.encodedContent, replyID: replyID)

        replyingTo = nil
        let localMessage = makeOptimisticStickerMessage(
            content: payload.encodedContent,
            replyTo: replyMessage
        )
        optimisticStickerMessageIDs.insert(localMessage.id)
        optimisticStickerSignatures[localMessage.id] = signature
        appendMessageIfNeeded(localMessage)

        do {
            let response = try await APIService.shared.sendStickerMessage(
                receiverID: contact.userID,
                packID: pack.id,
                stickerID: sticker.id,
                replyToID: replyID
            )
            let message = normalizedOutgoingMessage(
                response,
                expectedType: "sticker",
                expectedContent: payload.encodedContent,
                replyID: replyID
            )
            store.saveMessage(message)
            appendMessageIfNeeded(
                message,
                source: .apiResponse,
                shouldMergeOutgoingEcho: true
            )
        } catch {
            removeOptimisticStickerMessage(id: localMessage.id)
            errorMessage = userFacingSendError(error, fallbackKey: "messages.stickerSendFailed")
        }
    }

    private func finishStickerSend(
        pendingID: UUID,
        packID: String,
        stickerID: String,
        replyID: Int?
    ) async {
        do {
            let response = try await APIService.shared.sendStickerMessage(
                receiverID: contact.userID,
                packID: packID,
                stickerID: stickerID,
                replyToID: replyID
            )
            let message = normalizedOutgoingMessage(
                response,
                expectedType: "sticker",
                expectedContent: pendingMessages.first(where: { $0.id == pendingID })?.content,
                replyID: replyID
            )
            store.saveMessage(message)
            removePendingMessage(id: pendingID)
            appendMessageIfNeeded(
                message,
                source: .apiResponse,
                shouldMergeOutgoingEcho: true
            )
        } catch {
            markPendingMessageFailed(id: pendingID)
            errorMessage = userFacingSendError(error, fallbackKey: "messages.stickerSendFailed")
        }
    }

    func sendImage(data: Data) async {
        let filename = "image_\(UUID().uuidString).jpg"
        let pending = PendingMessage(
            receiverID: contact.userID,
            msgType: "image",
            content: "",
            imageData: data,
            videoData: nil,
            filename: filename
        )
        pendingMessages.append(pending)
        enqueueImageUpload(pendingID: pending.id, data: data, filename: filename)
    }

    private func enqueueImageUpload(pendingID: UUID, data: Data, filename: String) {
        BackgroundUploadCoordinator.shared.enqueue(id: "direct-image-\(pendingID.uuidString)") { [self] in
            await finishImageSend(pendingID: pendingID, data: data, filename: filename)
        }
    }

    private func finishImageSend(pendingID: UUID, data: Data, filename: String) async {
        do {
            let response = try await APIService.shared.sendImageMessage(
                receiverID: contact.userID,
                imageData: data,
                filename: filename
            )
            let message = normalizedOutgoingMessage(response, expectedType: "image")
            store.saveMessage(message)
            removePendingMessage(id: pendingID)
            appendMessageIfNeeded(
                message,
                source: .apiResponse,
                shouldMergeOutgoingEcho: true
            )
        } catch {
            markPendingMessageFailed(id: pendingID)
            errorMessage = userFacingSendError(error, fallbackKey: "messages.imageSendFailed")
        }
    }

    func sendVideo(data: Data, filename: String) async {
        let pending = PendingMessage(
            receiverID: contact.userID,
            msgType: "video",
            content: "",
            imageData: nil,
            videoData: data,
            filename: filename
        )
        pendingMessages.append(pending)
        enqueueVideoUpload(pendingID: pending.id, data: data, filename: filename)
    }

    private func enqueueVideoUpload(pendingID: UUID, data: Data, filename: String) {
        BackgroundUploadCoordinator.shared.enqueue(id: "direct-video-\(pendingID.uuidString)") { [self] in
            await finishVideoSend(pendingID: pendingID, data: data, filename: filename)
        }
    }

    private func finishVideoSend(pendingID: UUID, data: Data, filename: String) async {
        do {
            let response = try await APIService.shared.sendVideoMessage(
                receiverID: contact.userID,
                videoData: data,
                filename: filename
            )
            let message = normalizedOutgoingMessage(response, expectedType: "video")
            store.saveMessage(message)
            removePendingMessage(id: pendingID)
            appendMessageIfNeeded(
                message,
                source: .apiResponse,
                shouldMergeOutgoingEcho: true
            )
        } catch {
            markPendingMessageFailed(id: pendingID)
            errorMessage = userFacingSendError(error, fallbackKey: "messages.videoSendFailed")
        }
    }

    func sendVoice(data: Data, duration: Double) async {
        isSending = true

        let pending = PendingMessage(
            receiverID: contact.userID,
            msgType: "voice",
            content: "",
            voiceData: data,
            voiceDuration: duration
        )
        pendingMessages.append(pending)

        do {
            let response = try await APIService.shared.sendVoiceMessage(
                receiverID: contact.userID,
                voiceData: data,
                duration: duration,
                filename: "voice_\(Int(Date().timeIntervalSince1970)).m4a"
            )
            let message = normalizedOutgoingMessage(response, expectedType: "voice")
            store.saveMessage(message)
            pendingMessages.removeAll { $0.id == pending.id }
            appendMessageIfNeeded(
                message,
                source: .apiResponse,
                shouldMergeOutgoingEcho: true
            )
        } catch {
            if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
                pendingMessages[index].status = .failed
            }
            errorMessage = userFacingSendError(error, fallbackKey: "messages.voiceSendFailed")
        }

        isSending = false
    }

    func sendGift(_ gift: GiftCatalogItem) async throws {
        guard contact.userID != AuthManager.shared.currentUser?.userID else {
            throw APIError.serverError(code: 400, message: L10n.tr("gift.cannotSendToSelf"))
        }

        isSending = true
        defer { isSending = false }

        do {
            let response = try await APIService.shared.sendGiftMessage(
                receiverID: contact.userID,
                giftID: gift.giftID
            )
            let message = normalizedOutgoingMessage(response, expectedType: "gift")
            store.saveMessage(message)
            appendMessageIfNeeded(
                message,
                source: .apiResponse,
                shouldMergeOutgoingEcho: true
            )
            Task { await WalletStore.shared.refreshBalanceFromServer() }
        } catch {
            errorMessage = userFacingSendError(error, fallbackKey: "gift.sendFailed")
            throw error
        }
    }

    var isSendEnabled: Bool {
        !inputText.isBlank
    }

    /// Pending and confirmed messages are intentionally stored separately, but
    /// they must never be rendered together once either delivery channel has
    /// confirmed the same local send operation.
    var visiblePendingMessages: [PendingMessage] {
        pendingMessages.filter { pending in
            !messages.contains { confirmedMessage($0, matches: pending) }
        }
    }

    func markConversationAsReadOnServer() {
        UnreadBadgeStore.shared.setConversationUnreadCount(
            0,
            for: ConversationReadTarget.direct(userID: contact.userID).listIdentity
        )
        Task {
            try? await APIService.shared.markMessagesAsRead(contactID: contact.userID)
            await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
        }
    }

    private func setupWebSocketListener() {
        WebSocketService.shared.newMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                guard let self = self else { return }
                let isRelevant = (message.senderID == self.contact.userID &&
                                  message.receiverID == AuthManager.shared.currentUser?.userID) ||
                                 (message.senderID == AuthManager.shared.currentUser?.userID &&
                                  message.receiverID == self.contact.userID)
                if isRelevant {
                    self.store.saveMessage(message)
                    if message.senderID == AuthManager.shared.currentUser?.userID {
                        _ = self.removeFirstPendingMessage {
                            self.pendingMessage($0, matches: message)
                        }
                        self.appendMessageIfNeeded(
                            message,
                            source: .webSocket,
                            shouldMergeOutgoingEcho: true
                        )
                    } else {
                        self.appendMessageIfNeeded(message, source: .webSocket)
                        if WebSocketService.shared.activeChatUserID == self.contact.userID {
                            UnreadBadgeStore.shared.setConversationUnreadCount(
                                0,
                                for: ConversationReadTarget.direct(userID: self.contact.userID).listIdentity
                            )
                            Task {
                                try? await APIService.shared.markMessagesAsRead(contactID: self.contact.userID)
                                await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
                            }
                        }
                    }
                }
            }
            .store(in: &cancellables)

        WebSocketService.shared.contactUpdatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self = self,
                      self.isRelevantContactUpdate(data) else { return }
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
                self?.pendingMessages.removeAll()
                self?.apiConfirmedMessageIDs.removeAll()
                self?.webSocketConfirmedMessageIDs.removeAll()
            }
            .store(in: &cancellables)
    }

    private func syncLatestMessages() async {
        guard !isSyncingLatest else { return }
        isSyncingLatest = true
        defer { isSyncingLatest = false }

        let isActivelyVisible = WebSocketService.shared.activeChatUserID == contact.userID
        if isActivelyVisible {
            UnreadBadgeStore.shared.setConversationUnreadCount(
                0,
                for: ConversationReadTarget.direct(userID: contact.userID).listIdentity
            )
        }

        let latestID = store.latestMessageID(userID: myID, contactID: contact.userID)
        do {
            var fetched: [Message] = []
            if let latestID {
                fetched.append(contentsOf: try await fetchNewerMessages(afterID: latestID))
            }
            fetched.append(contentsOf: try await fetchRecentMessages())
            mergeFetchedMessages(fetched)

            if isActivelyVisible, WebSocketService.shared.activeChatUserID == contact.userID {
                try? await APIService.shared.markMessagesAsRead(contactID: contact.userID)
                PushService.shared.syncBadgeFromUnreadState()
            }
        } catch {
            print("[Chat] Failed to sync latest: \(error)")
        }
    }

    private func fetchNewerMessages(afterID latestID: Int) async throws -> [Message] {
        var allNew: [Message] = []
        var fetchMore = true
        var currentAfterID = latestID
        while fetchMore {
            let (msgs, more) = try await APIService.shared.getMessages(
                contactID: contact.userID,
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

    private func fetchRecentMessages() async throws -> [Message] {
        let (msgs, _) = try await APIService.shared.getMessages(
            contactID: contact.userID,
            limit: 100
        )
        return msgs
    }

    private func mergeFetchedMessages(_ fetched: [Message]) {
        guard !fetched.isEmpty else { return }
        store.saveMessages(fetched)
        appendMessagesIfNeeded(
            fetched,
            source: .history,
            shouldMergeOutgoingEcho: true
        )
    }

    private func appendMessageIfNeeded(
        _ message: Message,
        source: MessageSource = .history,
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

    private func makeOptimisticStickerMessage(content: String, replyTo: Message?) -> Message {
        Message(
            id: nextLocalStickerMessageID(),
            senderID: myID,
            receiverID: contact.userID,
            msgType: "sticker",
            content: content,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            replyToID: replyTo?.id,
            replyTo: replyTo.map {
                ReplyPreview(
                    id: $0.id,
                    senderID: $0.senderID,
                    msgType: $0.msgType,
                    content: $0.content
                )
            }
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

    private func optimisticStickerIndex(for message: Message) -> Int? {
        guard message.senderID == myID,
              message.receiverID == contact.userID,
              message.msgType == "sticker" else {
            return nil
        }
        let incomingSignature = stickerSignature(
            content: message.content,
            replyID: replyTargetID(for: message)
        )

        return messages.lastIndex { existing in
            guard optimisticStickerMessageIDs.contains(existing.id),
                  existing.senderID == message.senderID,
                  existing.receiverID == message.receiverID,
                  existing.msgType == message.msgType,
                  timestampsAreClose(existing.timestamp, message.timestamp) else {
                return false
            }

            let existingSignature = optimisticStickerSignatures[existing.id]
                ?? stickerSignature(content: existing.content, replyID: replyTargetID(for: existing))
            return stickerSignaturesMatch(existingSignature, incomingSignature)
        }
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

    private func replyTargetID(for message: Message) -> Int? {
        message.replyToID ?? message.replyTo?.id
    }

    private func normalizedOutgoingMessage(
        _ message: Message,
        expectedType: String,
        expectedContent: String? = nil,
        replyID: Int? = nil
    ) -> Message {
        let content = message.content.isBlank
            ? (expectedContent ?? message.content)
            : message.content
        return Message(
            id: message.id,
            senderID: myID,
            receiverID: contact.userID,
            msgType: expectedType,
            content: content,
            timestamp: message.timestamp.isBlank
                ? ISO8601DateFormatter().string(from: Date())
                : message.timestamp,
            replyToID: message.replyToID ?? replyID,
            replyTo: message.replyTo
        )
    }

    private func timestampsAreClose(_ lhs: String, _ rhs: String) -> Bool {
        guard lhs != rhs else { return true }
        guard let lhsDate = TimestampHelper.parse(lhs),
              let rhsDate = TimestampHelper.parse(rhs) else {
            return false
        }
        return abs(lhsDate.timeIntervalSince(rhsDate)) <= 30
    }

    private func pendingMessage(_ pending: PendingMessage, matches message: Message) -> Bool {
        guard pending.receiverID == contact.userID,
              normalizedMessageType(pending.msgType) == normalizedMessageType(message.msgType),
              pendingReplyMatches(pending.replyToID, replyTargetID(for: message)),
              pendingTimestampMatches(pending, message: message) else {
            return false
        }

        if pending.msgType == "sticker" {
            return stickerSignaturesMatch(
                stickerSignature(content: pending.content, replyID: pending.replyToID),
                stickerSignature(content: message.content, replyID: replyTargetID(for: message))
            )
        }
        if pending.msgType == "text" {
            return pending.content == message.content
        }
        return true
    }

    private func confirmedMessage(_ message: Message, matches pending: PendingMessage) -> Bool {
        guard isOwnOutgoing(message) else { return false }
        return pendingMessage(pending, matches: message)
    }

    private func pendingReplyMatches(_ pendingReplyID: Int?, _ messageReplyID: Int?) -> Bool {
        pendingReplyID == messageReplyID || messageReplyID == nil
    }

    private func pendingTimestampMatches(_ pending: PendingMessage, message: Message) -> Bool {
        if let messageDate = TimestampHelper.parse(message.timestamp) {
            let delta = messageDate.timeIntervalSince(pending.createdAt)
            return delta >= -2 && delta <= 90
        }
        return abs(Date().timeIntervalSince(pending.createdAt)) <= 90
    }

    private func normalizedMessageType(_ value: String) -> String {
        MessageDeliveryMatcher.normalizedType(value)
    }

    private func removePendingMessage(id: UUID) {
        pendingMessages.removeAll { $0.id == id }
    }

    private func markPendingMessageFailed(id: UUID) {
        if let index = pendingMessages.firstIndex(where: { $0.id == id }) {
            pendingMessages[index].status = .failed
        }
    }

    @discardableResult
    private func removeFirstPendingMessage(matching predicate: (PendingMessage) -> Bool) -> Bool {
        if let index = pendingMessages.firstIndex(where: predicate) {
            pendingMessages.remove(at: index)
            return true
        }
        return false
    }

    private func appendMessagesIfNeeded(
        _ newMessages: [Message],
        source: MessageSource = .history,
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

            if let optimisticIndex = optimisticStickerIndex(for: message) {
                let localID = messages[optimisticIndex].id
                clearOptimisticStickerTracking(localID)
                messages[optimisticIndex] = message
                changed = true
                continue
            }

            if shouldMergeOutgoingEcho,
               let echoIndex = outgoingEchoIndex(for: message, source: source) {
                let existing = messages[echoIndex]
                let preferred = preferredMessage(existing: existing, incoming: message, source: source)

                clearDeliveryTracking(for: existing.id, unlessKeeping: preferred.id)
                clearDeliveryTracking(for: message.id, unlessKeeping: preferred.id)
                if preferred.id == message.id {
                    markConfirmed(preferred.id, source: source)
                }
                if existing.id != message.id {
                    store.deleteMessage(id: preferred.id == existing.id ? message.id : existing.id)
                }
                messages[echoIndex] = preferred
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

    private func outgoingEchoIndex(for message: Message, source: MessageSource) -> Int? {
        guard isOwnOutgoing(message) else { return nil }

        return messages.lastIndex { existing in
            guard existing.id != message.id,
                  isOwnOutgoing(existing),
                  normalizedMessageType(existing.msgType) == normalizedMessageType(message.msgType),
                  replyTargetID(for: existing) == replyTargetID(for: message),
                  timestampsAreClose(existing.timestamp, message.timestamp),
                  isEligibleEcho(existing.id, for: source) else {
                return false
            }

            if message.msgType == "sticker" {
                return stickerSignaturesMatch(
                    stickerSignature(content: existing.content, replyID: replyTargetID(for: existing)),
                    stickerSignature(content: message.content, replyID: replyTargetID(for: message))
                )
            }
            return outgoingContentsMatch(existing, message)
        }
    }

    private func outgoingContentsMatch(_ lhs: Message, _ rhs: Message) -> Bool {
        let type = normalizedMessageType(lhs.msgType)
        guard type == normalizedMessageType(rhs.msgType) else { return false }
        return MessageDeliveryMatcher.contentsMatch(
            type: type,
            lhs: lhs.content,
            rhs: rhs.content
        )
    }

    private func isEligibleEcho(_ existingID: Int, for source: MessageSource) -> Bool {
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

    private func preferredMessage(
        existing: Message,
        incoming: Message,
        source: MessageSource
    ) -> Message {
        if existing.id > 0, incoming.id <= 0 {
            return existing
        }
        if source == .webSocket, apiConfirmedMessageIDs.contains(existing.id) {
            return existing
        }
        return incoming
    }

    private func isOwnOutgoing(_ message: Message) -> Bool {
        message.senderID == myID && message.receiverID == contact.userID
    }

    private func markConfirmed(_ id: Int, source: MessageSource) {
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

    private func isRelevantContactUpdate(_ data: [String: Any]) -> Bool {
        guard let senderID = Self.stringValue(data["sender_id"]),
              let receiverID = Self.stringValue(data["receiver_id"]) else { return false }
        let myID = AuthManager.shared.currentUser?.userID
        return (senderID == contact.userID && receiverID == myID)
            || (senderID == myID && receiverID == contact.userID)
    }

    private static func stringValue(_ value: Any?) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }
}
