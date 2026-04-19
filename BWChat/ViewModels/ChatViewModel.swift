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
                var allNew: [Message] = []
                var fetchMore = true
                var currentAfterID = latestID
                while fetchMore {
                    let (msgs, more) = try await APIService.shared.getMessages(
                        contactID: contact.userID, afterID: currentAfterID, limit: 100
                    )
                    allNew.append(contentsOf: msgs)
                    fetchMore = more && !msgs.isEmpty
                    if let last = msgs.last { currentAfterID = last.id }
                }

                if !allNew.isEmpty {
                    store.saveMessages(allNew)
                    for msg in allNew where !messages.contains(where: { $0.id == msg.id }) {
                        messages.append(msg)
                    }
                }
                hasMore = store.localMessageCount(userID: myID, contactID: contact.userID) >= 30
            } else {
                // First visit to this DM on this device (no local cache).
                // Pull the latest page so the UI renders fast, then silently
                // backfill every older page the server still has (100-day
                // retention) so future launches / reinstalls show the full
                // history without needing to scroll up.
                let (msgs, more) = try await APIService.shared.getMessages(
                    contactID: contact.userID, limit: 100
                )
                store.saveMessages(msgs)
                messages = msgs
                hasMore = false
                if more {
                    Task { [weak self] in
                        await self?.backfillOlderMessages()
                    }
                }
            }
        } catch let error as APIError {
            if case .unauthorized = error {
                AuthManager.shared.logout()
            }
            if messages.isEmpty { errorMessage = error.errorDescription }
        } catch {
            if messages.isEmpty { errorMessage = "加载消息失败" }
        }
    }

    /// Paginate through every older page on the server and persist them to
    /// local storage. Runs once on first visit to a DM; for subsequent
    /// launches the incremental `afterID` sync in `loadMessages` takes over.
    private func backfillOlderMessages() async {
        let maxPages = 50  // 50 * 100 = 5000 messages safety cap
        var cursor = messages.first?.id
        for _ in 0..<maxPages {
            guard let before = cursor else { return }
            do {
                let (older, hasOlder) = try await APIService.shared.getMessages(
                    contactID: contact.userID, beforeID: before, limit: 100
                )
                if older.isEmpty { return }
                store.saveMessages(older)
                messages.insert(contentsOf: older, at: 0)
                cursor = older.first?.id
                if !hasOlder { return }
            } catch {
                hasMore = true
                return
            }
        }
        hasMore = true
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

    func sendText() async {
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

        do {
            let message = try await APIService.shared.sendTextMessage(
                receiverID: contact.userID,
                content: text,
                replyToID: replyID
            )
            store.saveMessage(message)
            if messages.contains(where: { $0.id == message.id }) {
                pendingMessages.removeAll { $0.id == pending.id }
            } else {
                messages.append(message)
                pendingMessages.removeAll { $0.id == pending.id }
            }
        } catch {
            if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
                pendingMessages[index].status = .failed
            }
        }
    }

    func retryPending(_ pending: PendingMessage) async {
        if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
            pendingMessages[index].status = .sending
        }

        if pending.msgType == "text" {
            do {
                let message = try await APIService.shared.sendTextMessage(
                    receiverID: contact.userID,
                    content: pending.content
                )
                store.saveMessage(message)
                pendingMessages.removeAll { $0.id == pending.id }
                if !messages.contains(where: { $0.id == message.id }) {
                    messages.append(message)
                }
            } catch {
                if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
                    pendingMessages[index].status = .failed
                }
            }
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
            messages.append(message)
            pendingMessages.removeAll { $0.id == pending.id }
        } catch {
            if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
                pendingMessages[index].status = .failed
            }
            errorMessage = "图片发送失败"
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
            messages.append(message)
            pendingMessages.removeAll { $0.id == pending.id }
        } catch {
            if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
                pendingMessages[index].status = .failed
            }
            errorMessage = "视频发送失败"
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
            messages.append(message)
            pendingMessages.removeAll { $0.id == pending.id }
        } catch {
            if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
                pendingMessages[index].status = .failed
            }
            errorMessage = "语音发送失败"
        }

        isSending = false
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
                    if !self.messages.contains(where: { $0.id == message.id }) {
                        self.messages.append(message)
                    }
                    if message.senderID == AuthManager.shared.currentUser?.userID {
                        self.pendingMessages.removeAll {
                            $0.msgType == message.msgType && $0.content == message.content
                        }
                    }
                }
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
}
