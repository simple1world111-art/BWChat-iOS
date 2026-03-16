// BWChat/ViewModels/ContactsViewModel.swift
// Contacts list view model

import Foundation
import Combine

@MainActor
class ContactsViewModel: ObservableObject {
    @Published var contacts: [Contact] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()

    init() {
        setupWebSocketListeners()
    }

    func loadContacts() async {
        isLoading = true
        errorMessage = nil

        do {
            contacts = try await APIService.shared.getContacts()
        } catch let error as APIError {
            if case .unauthorized = error {
                AuthManager.shared.logout()
            }
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "加载联系人失败"
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
        // Clear unread count locally
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
        // Tell server
        Task {
            try? await APIService.shared.markMessagesAsRead(contactID: contactID)
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

        if let index = contacts.firstIndex(where: { $0.userID == contactID }) {
            let existing = contacts[index]
            let lastMsg = message.isImage ? "[图片]" : message.content
            let updated = Contact(
                userID: existing.userID,
                nickname: existing.nickname,
                avatarURL: existing.avatarURL,
                lastMessage: lastMsg,
                lastMessageTime: message.timestamp,
                unreadCount: existing.unreadCount + (isFromOther ? 1 : 0)
            )
            contacts[index] = updated
            // Re-sort
            contacts.sort { ($0.lastMessageTime ?? "") > ($1.lastMessageTime ?? "") }

            // Show local notification if message is from someone else
            // and user is NOT currently viewing that chat
            if isFromOther && WebSocketService.shared.activeChatUserID != contactID {
                PushService.shared.showLocalNotification(
                    title: existing.nickname,
                    body: lastMsg,
                    senderID: contactID
                )
            }
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

        let myID = AuthManager.shared.currentUser?.userID
        let contactID = (senderID == myID) ? receiverID : senderID

        if let index = contacts.firstIndex(where: { $0.userID == contactID }) {
            let existing = contacts[index]
            let updated = Contact(
                userID: existing.userID,
                nickname: existing.nickname,
                avatarURL: existing.avatarURL,
                lastMessage: lastMessage,
                lastMessageTime: lastMessageTime,
                unreadCount: existing.unreadCount + (senderID != myID ? 1 : 0)
            )
            contacts[index] = updated
            contacts.sort { ($0.lastMessageTime ?? "") > ($1.lastMessageTime ?? "") }
        }
    }
}
