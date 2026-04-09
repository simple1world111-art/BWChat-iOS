import Foundation
import Combine
import UIKit

@MainActor
class ConversationListViewModel: ObservableObject {
    @Published var conversations: [Conversation] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()

    init() {
        setupWebSocketListeners()
        setupForegroundReload()
    }

    private func setupForegroundReload() {
        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.loadConversations() }
            }
            .store(in: &cancellables)
    }

    func loadConversations() async {
        isLoading = true
        errorMessage = nil

        do {
            conversations = try await APIService.shared.getConversations()
        } catch let error as APIError {
            if case .unauthorized = error {
                AuthManager.shared.logout()
            }
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "加载会话失败"
        }

        isLoading = false
    }

    func logout() async {
        do {
            try await APIService.shared.logout()
        } catch { }
        AuthManager.shared.logout()
    }

    func markAsRead(conversationID: String) {
        if let index = conversations.firstIndex(where: { $0.id == conversationID && $0.isDM }) {
            let c = conversations[index]
            if c.unreadCount > 0 {
                conversations[index] = Conversation(
                    type: c.type, id: c.id, name: c.name, avatarURL: c.avatarURL,
                    lastMessage: c.lastMessage, lastMessageTime: c.lastMessageTime,
                    unreadCount: 0, subtitle: c.subtitle, groupID: c.groupID,
                    memberCount: c.memberCount
                )
            }
        }
        Task {
            try? await APIService.shared.markMessagesAsRead(contactID: conversationID)
            await MainActor.run { PushService.shared.clearBadge() }
        }
    }

    func markGroupAsRead(groupID: Int) {
        let gidStr = String(groupID)
        if let index = conversations.firstIndex(where: { $0.id == gidStr && $0.isGroup }) {
            let c = conversations[index]
            if c.unreadCount > 0 {
                conversations[index] = Conversation(
                    type: c.type, id: c.id, name: c.name, avatarURL: c.avatarURL,
                    lastMessage: c.lastMessage, lastMessageTime: c.lastMessageTime,
                    unreadCount: 0, subtitle: c.subtitle, groupID: c.groupID,
                    memberCount: c.memberCount
                )
            }
        }
        Task {
            try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID)
            await MainActor.run { PushService.shared.clearBadge() }
        }
    }

    private func setupWebSocketListeners() {
        WebSocketService.shared.newMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                self?.handleNewDM(message)
            }
            .store(in: &cancellables)

        WebSocketService.shared.groupMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] groupMsg in
                self?.handleNewGroupMessage(groupMsg)
            }
            .store(in: &cancellables)

        WebSocketService.shared.chatResetPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in
                self?.conversations = []
            }
            .store(in: &cancellables)

        WebSocketService.shared.cacheCleanupPublisher
            .receive(on: DispatchQueue.main)
            .sink { urls in
                ImageCacheManager.shared.removeImages(for: urls)
            }
            .store(in: &cancellables)
    }

    private func handleNewDM(_ message: Message) {
        let isFromOther = message.senderID != AuthManager.shared.currentUser?.userID
        let contactID = isFromOther ? message.senderID : message.receiverID

        let isViewingThisChat = isFromOther && WebSocketService.shared.activeChatUserID == contactID
        let unreadDelta = (isFromOther && !isViewingThisChat) ? 1 : 0

        if isViewingThisChat {
            Task { try? await APIService.shared.markMessagesAsRead(contactID: contactID) }
        }

        let lastMsg: String
        if message.isImage { lastMsg = "[图片]" }
        else if message.isVideo { lastMsg = "[视频]" }
        else { lastMsg = message.content }

        if let index = conversations.firstIndex(where: { $0.id == contactID && $0.isDM }) {
            let c = conversations[index]
            conversations[index] = Conversation(
                type: "dm", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: lastMsg, lastMessageTime: message.timestamp,
                unreadCount: c.unreadCount + unreadDelta, subtitle: nil,
                groupID: nil, memberCount: nil
            )
            conversations.sort { ($0.lastMessageTime ?? "") > ($1.lastMessageTime ?? "") }
        } else {
            Task { await loadConversations() }
        }
    }

    private func handleNewGroupMessage(_ msg: GroupMessage) {
        let gidStr = String(msg.groupID)
        let myID = AuthManager.shared.currentUser?.userID
        let isFromOther = msg.senderID != myID
        let isViewingThisGroup = isFromOther && WebSocketService.shared.activeGroupID == msg.groupID
        let unreadDelta = (isFromOther && !isViewingThisGroup) ? 1 : 0

        let lastMsg: String
        if msg.isImage { lastMsg = "[图片]" }
        else if msg.isVideo { lastMsg = "[视频]" }
        else { lastMsg = msg.content }

        if let index = conversations.firstIndex(where: { $0.id == gidStr && $0.isGroup }) {
            let c = conversations[index]
            conversations[index] = Conversation(
                type: "group", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: lastMsg, lastMessageTime: msg.timestamp,
                unreadCount: c.unreadCount + unreadDelta, subtitle: msg.senderNickname,
                groupID: c.groupID, memberCount: c.memberCount
            )
            conversations.sort { ($0.lastMessageTime ?? "") > ($1.lastMessageTime ?? "") }
        } else {
            Task { await loadConversations() }
        }
    }
}
