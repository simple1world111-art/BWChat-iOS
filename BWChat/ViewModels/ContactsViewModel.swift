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
    }

    private func handleNewMessage(_ message: Message) {
        // Update the contact list with the new message
        let contactID: String
        if message.senderID == AuthManager.shared.currentUser?.userID {
            contactID = message.receiverID
        } else {
            contactID = message.senderID
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
                unreadCount: existing.unreadCount + (message.senderID != AuthManager.shared.currentUser?.userID ? 1 : 0)
            )
            contacts[index] = updated
            // Re-sort
            contacts.sort { ($0.lastMessageTime ?? "") > ($1.lastMessageTime ?? "") }
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
}
