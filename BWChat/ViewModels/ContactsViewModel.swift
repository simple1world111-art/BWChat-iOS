// BWChat/ViewModels/ContactsViewModel.swift
// Contacts list view model

import Foundation
import Combine
import UIKit

@MainActor
class ContactsViewModel: ObservableObject {
    @Published var contacts: [Contact] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()
    private var processedIncomingEvents: Set<String> = []

    init() {
        setupWebSocketListeners()
        setupForegroundReload()
    }

    /// Reload contacts whenever app returns to foreground to pick up any
    /// messages delivered while the WebSocket was disconnected.
    private func setupForegroundReload() {
        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.loadContacts() }
            }
            .store(in: &cancellables)
    }

    func loadContacts() async {
        isLoading = true
        errorMessage = nil

        do {
            contacts = try await APIService.shared.getContacts()
            UserCacheManager.shared.cacheContacts(contacts)
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("contacts.loadFailed")
        }

        isLoading = false
    }

    func logout() async {
        do {
            try await APIService.shared.logout()
        } catch {
            // Logout locally even if server call fails
        }
        AuthManager.shared.logout()
    }

    func markAsRead(contactID: String) {
        applyLocalRead(contactID: contactID)
        // Tell server + sync app icon badge
        Task {
            try? await APIService.shared.markMessagesAsRead(contactID: contactID)
            await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
        }
    }

    private func applyLocalRead(contactID: String) {
        UnreadBadgeStore.shared.setConversationUnreadCount(
            0,
            for: ConversationReadTarget.direct(userID: contactID).listIdentity
        )
        if let index = contacts.firstIndex(where: { $0.userID == contactID }) {
            let c = contacts[index]
            if c.unreadCount > 0 {
                contacts[index] = Contact(
                    userID: c.userID,
                    nickname: c.nickname,
                    avatarURL: c.avatarURL,
                    lastMessage: c.lastMessage,
                    lastMessageTime: c.lastMessageTime,
                    unreadCount: 0
                )
            }
        }
    }

    private func setupWebSocketListeners() {
        WebSocketService.shared.newMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                self?.handleNewMessage(message)
            }
            .store(in: &cancellables)

        WebSocketService.shared.chatResetPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in
                self?.handleChatReset()
            }
            .store(in: &cancellables)

        WebSocketService.shared.contactUpdatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.handleContactUpdate(data)
            }
            .store(in: &cancellables)

        WebSocketService.shared.cacheCleanupPublisher
            .receive(on: DispatchQueue.main)
            .sink { urls in
                ImageCacheManager.shared.removeImages(for: urls)
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .conversationDidMarkRead)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let target = notification.object as? ConversationReadTarget,
                      case .direct(let userID) = target else { return }
                self?.applyLocalRead(contactID: userID)
            }
            .store(in: &cancellables)
    }

    private func handleNewMessage(_ message: Message) {
        // Update the contact list with the new message
        let contactID: String
        let isFromOther = message.senderID != AuthManager.shared.currentUser?.userID
        if isFromOther {
            contactID = message.senderID
        } else {
            contactID = message.receiverID
        }

        // Suppress unread increment if user is actively viewing this chat
        let isViewingThisChat = isFromOther && WebSocketService.shared.activeChatUserID == contactID
        let isNewIncomingEvent = !isFromOther || processedIncomingEvents.insert(
            "\(contactID):\(message.id):\(message.timestamp)"
        ).inserted
        let unreadDelta = (isFromOther && !isViewingThisChat && isNewIncomingEvent) ? 1 : 0

        // Auto-mark as read on server if viewing this chat
        if isViewingThisChat {
            Task { try? await APIService.shared.markMessagesAsRead(contactID: contactID) }
        }

        if let index = contacts.firstIndex(where: { $0.userID == contactID }) {
            let existing = contacts[index]
            guard Conversation.compareMessageTimes(existing.lastMessageTime, message.timestamp) != .orderedDescending else {
                return
            }
            let lastMsg: String
            if message.isImage {
                lastMsg = L10n.tr("message.image")
            } else if message.isVideo {
                lastMsg = L10n.tr("message.video")
            } else if message.isSticker {
                lastMsg = message.stickerPayload?.previewText ?? L10n.tr("message.sticker")
            } else if message.isGift {
                lastMsg = GiftMessagePayload.previewText(content: message.content)
            } else {
                lastMsg = message.content
            }
            let updated = Contact(
                userID: existing.userID,
                nickname: existing.nickname,
                avatarURL: existing.avatarURL,
                lastMessage: lastMsg,
                lastMessageTime: message.timestamp,
                unreadCount: isViewingThisChat ? 0 : existing.unreadCount + unreadDelta
            )
            contacts[index] = updated
            // Re-sort
            contacts.sort {
                Conversation.compareMessageTimes($0.lastMessageTime, $1.lastMessageTime) == .orderedDescending
            }
        } else {
            // New contact not yet in list — reload to pick it up
            Task { await loadContacts() }
        }
    }

    private func handleChatReset() {
        // Clear all message previews
        contacts = contacts.map { contact in
            Contact(
                userID: contact.userID,
                nickname: contact.nickname,
                avatarURL: contact.avatarURL,
                lastMessage: nil,
                lastMessageTime: nil,
                unreadCount: 0
            )
        }
        ImageCacheManager.shared.clearCache()
    }

    private func handleContactUpdate(_ data: [String: Any]) {
        guard let senderID = data["sender_id"] as? String,
              let receiverID = data["receiver_id"] as? String,
              let lastMessage = data["last_message"] as? String,
              let lastMessageTime = data["last_message_time"] as? String else { return }
        let msgType = data["msg_type"] as? String ?? data["last_message_type"] as? String
        let previewMessage: String
        if let stickerPreview = StickerMessagePayload.previewText(content: lastMessage, msgType: msgType) {
            previewMessage = stickerPreview
        } else if msgType == "gift" || GiftMessagePayload.parse(lastMessage) != nil {
            previewMessage = GiftMessagePayload.previewText(content: lastMessage)
        } else {
            previewMessage = lastMessage
        }

        let myID = AuthManager.shared.currentUser?.userID
        let contactID = (senderID == myID) ? receiverID : senderID

        // Only update preview text and time here.
        // Unread count is handled exclusively by handleNewMessage to avoid double-counting.
        if let index = contacts.firstIndex(where: { $0.userID == contactID }) {
            let existing = contacts[index]
            guard Conversation.compareMessageTimes(existing.lastMessageTime, lastMessageTime) != .orderedDescending else {
                return
            }
            let updated = Contact(
                userID: existing.userID,
                nickname: existing.nickname,
                avatarURL: existing.avatarURL,
                lastMessage: previewMessage,
                lastMessageTime: lastMessageTime,
                unreadCount: existing.unreadCount
            )
            contacts[index] = updated
            contacts.sort {
                Conversation.compareMessageTimes($0.lastMessageTime, $1.lastMessageTime) == .orderedDescending
            }
        } else {
            // New contact not yet in list — reload to pick it up
            Task { await loadContacts() }
        }
    }
}
