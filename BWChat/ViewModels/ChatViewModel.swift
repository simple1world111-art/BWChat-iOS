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

    // Per-DM "full server history pulled" flag. See GroupChatViewModel for
    // the rationale.
    private static let backfilledKey = "bbchat.dm_backfilled"

    private var isBackfilled: Bool {
        let ids = UserDefaults.standard.array(forKey: Self.backfilledKey) as? [String] ?? []
        return ids.contains(contact.userID)
    }

    private func markBackfilled() {
        var ids = UserDefaults.standard.array(forKey: Self.backfilledKey) as? [String] ?? []
        if !ids.contains(contact.userID) {
            ids.append(contact.userID)
            UserDefaults.standard.set(ids, forKey: Self.backfilledKey)
        }
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
            if case .unauthorized = error {
                AuthManager.shared.logout()
            }
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
            videoData: nil
        )
        pendingMessages.append(pending)

        Task { [weak self] in
            await self?.finishTextSend(pendingID: pending.id, text: text, replyID: replyID)
        }
    }

    private func finishTextSend(pendingID: UUID, text: String, replyID: Int?) async {
        do {
            let message = try await APIService.shared.sendTextMessage(
                receiverID: contact.userID,
                content: text,
                replyToID: replyID
            )
            store.saveMessage(message)
            removePendingMessage(id: pendingID)
            appendMessageIfNeeded(message)
        } catch {
            markPendingMessageFailed(id: pendingID)
        }
    }

    func retryPending(_ pending: PendingMessage) async {
        if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
            pendingMessages[index].status = .sending
        }

        if pending.msgType == "text" {
            await finishTextSend(pendingID: pending.id, text: pending.content, replyID: nil)
        } else if pending.msgType == "image", let data = pending.imageData {
            await sendImage(data: data)
            pendingMessages.removeAll { $0.id == pending.id }
        } else if pending.msgType == "video", let data = pending.videoData {
            await sendVideo(data: data, filename: "video_\(Int(Date().timeIntervalSince1970)).mp4")
            pendingMessages.removeAll { $0.id == pending.id }
        }
    }

    func setReply(to message: Message) {
        replyingTo = message
    }

    func cancelReply() {
        replyingTo = nil
    }

    func sendImage(data: Data) async {
        isSending = true

        let pending = PendingMessage(
            receiverID: contact.userID,
            msgType: "image",
            content: "",
            imageData: data,
            videoData: nil
        )
        pendingMessages.append(pending)

        do {
            let message = try await APIService.shared.sendImageMessage(
                receiverID: contact.userID,
                imageData: data,
                filename: "image_\(Int(Date().timeIntervalSince1970)).jpg"
            )
            store.saveMessage(message)
            pendingMessages.removeAll { $0.id == pending.id }
            appendMessageIfNeeded(message)
        } catch {
            if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
                pendingMessages[index].status = .failed
            }
            errorMessage = L10n.tr("messages.imageSendFailed")
        }

        isSending = false
    }

    func sendVideo(data: Data, filename: String) async {
        isSending = true

        let pending = PendingMessage(
            receiverID: contact.userID,
            msgType: "video",
            content: "",
            imageData: nil,
            videoData: data
        )
        pendingMessages.append(pending)

        do {
            let message = try await APIService.shared.sendVideoMessage(
                receiverID: contact.userID,
                videoData: data,
                filename: filename
            )
            store.saveMessage(message)
            pendingMessages.removeAll { $0.id == pending.id }
            appendMessageIfNeeded(message)
        } catch {
            if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
                pendingMessages[index].status = .failed
            }
            errorMessage = L10n.tr("messages.videoSendFailed")
        }

        isSending = false
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
            let message = try await APIService.shared.sendVoiceMessage(
                receiverID: contact.userID,
                voiceData: data,
                duration: duration,
                filename: "voice_\(Int(Date().timeIntervalSince1970)).m4a"
            )
            store.saveMessage(message)
            pendingMessages.removeAll { $0.id == pending.id }
            appendMessageIfNeeded(message)
        } catch {
            if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
                pendingMessages[index].status = .failed
            }
            errorMessage = L10n.tr("messages.voiceSendFailed")
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
            let message = try await APIService.shared.sendGiftMessage(
                receiverID: contact.userID,
                giftID: gift.giftID
            )
            store.saveMessage(message)
            appendMessageIfNeeded(message)
            Task { await WalletStore.shared.refreshBalanceFromServer() }
        } catch {
            errorMessage = L10n.tr("gift.sendFailed")
            throw error
        }
    }

    var isSendEnabled: Bool {
        !inputText.isBlank
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
                        self.removeFirstPendingMessage {
                            $0.msgType == message.msgType && $0.content == message.content
                        }
                        self.appendMessageIfNeeded(message)
                    } else {
                        self.appendMessageIfNeeded(message)
                        Task {
                            try? await APIService.shared.markMessagesAsRead(contactID: self.contact.userID)
                            await MainActor.run { PushService.shared.clearBadge() }
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
            }
            .store(in: &cancellables)
    }

    private func syncLatestMessages() async {
        guard !isSyncingLatest else { return }
        isSyncingLatest = true
        defer { isSyncingLatest = false }

        let latestID = store.latestMessageID(userID: myID, contactID: contact.userID)
        do {
            var fetched: [Message] = []
            if let latestID {
                fetched.append(contentsOf: try await fetchNewerMessages(afterID: latestID))
            }
            fetched.append(contentsOf: try await fetchRecentMessages())
            mergeFetchedMessages(fetched)

            try? await APIService.shared.markMessagesAsRead(contactID: contact.userID)
            PushService.shared.clearBadge()
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
        appendMessagesIfNeeded(fetched)
    }

    private func appendMessageIfNeeded(_ message: Message) {
        appendMessagesIfNeeded([message])
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
        guard let index = pendingMessages.firstIndex(where: predicate) else { return false }
        pendingMessages.remove(at: index)
        return true
    }

    private func appendMessagesIfNeeded(_ newMessages: [Message]) {
        var appended = false
        for message in newMessages where !messages.contains(where: { $0.id == message.id }) {
            messages.append(message)
            appended = true
        }
        guard appended else { return }
        messages.sort { $0.id < $1.id }
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
