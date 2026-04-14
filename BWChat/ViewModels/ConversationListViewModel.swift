import Foundation
import Combine
import UIKit

@MainActor
class ConversationListViewModel: ObservableObject {
    @Published var conversations: [Conversation] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()
    private let store = MessageStore.shared

    init() {
        loadCachedConversations()
        setupWebSocketListeners()
        setupForegroundReload()
    }

    private func loadCachedConversations() {
        let cached = store.loadConversations()
        if !cached.isEmpty {
            conversations = cached
        }
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
            let serverConvs = try await APIService.shared.getConversations()
            conversations = serverConvs
            store.saveConversations(serverConvs)
        } catch let error as APIError {
            if case .unauthorized = error {
                AuthManager.shared.logout()
            }
            if conversations.isEmpty { errorMessage = error.errorDescription }
        } catch {
            if conversations.isEmpty { errorMessage = "加载会话失败" }
        }

        isLoading = false
    }

    func logout() async {
        do {
            try await APIService.shared.logout()
        } catch { }
        store.clearAll()
        AuthManager.shared.logout()
    }

    func markAsRead(conversationID: String) {
        if let index = conversations.firstIndex(where: { $0.id == conversationID && $0.isDM }) {
            let c = conversations[index]
            if c.unreadCount > 0 {
                let updated = Conversation(
                    type: c.type, id: c.id, name: c.name, avatarURL: c.avatarURL,
                    lastMessage: c.lastMessage, lastMessageTime: c.lastMessageTime,
                    unreadCount: 0, subtitle: c.subtitle, groupID: c.groupID,
                    memberCount: c.memberCount
                )
                conversations[index] = updated
                store.updateConversation(updated)
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
                let updated = Conversation(
                    type: c.type, id: c.id, name: c.name, avatarURL: c.avatarURL,
                    lastMessage: c.lastMessage, lastMessageTime: c.lastMessageTime,
                    unreadCount: 0, subtitle: c.subtitle, groupID: c.groupID,
                    memberCount: c.memberCount
                )
                conversations[index] = updated
                store.updateConversation(updated)
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

        WebSocketService.shared.groupContactUpdatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.handleGroupContactUpdate(data)
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
        else if message.isVoice {
            let dur = Int(message.voiceDuration)
            lastMsg = dur > 0 ? "[语音] \(dur)''" : "[语音]"
        }
        else { lastMsg = message.content }

        if let index = conversations.firstIndex(where: { $0.id == contactID && $0.isDM }) {
            let c = conversations[index]
            let updated = Conversation(
                type: "dm", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: lastMsg, lastMessageTime: message.timestamp,
                unreadCount: c.unreadCount + unreadDelta, subtitle: nil,
                groupID: nil, memberCount: nil
            )
            conversations[index] = updated
            conversations.sort { ($0.lastMessageTime ?? "") > ($1.lastMessageTime ?? "") }
            store.updateConversation(updated)
        } else {
            Task { await loadConversations() }
        }
    }

    private func handleGroupContactUpdate(_ data: [String: Any]) {
        guard let groupID = data["group_id"] as? Int,
              let lastMessage = data["last_message"] as? String,
              let lastMessageTime = data["last_message_time"] as? String else { return }

        let senderNickname = data["sender_nickname"] as? String
        let senderID = data["sender_id"] as? String
        let myID = AuthManager.shared.currentUser?.userID
        let isFromOther = senderID != myID

        let isViewingThisGroup = isFromOther && WebSocketService.shared.activeGroupID == groupID
        let unreadDelta = (isFromOther && !isViewingThisGroup) ? 1 : 0

        if isViewingThisGroup {
            Task { try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID) }
        }

        let gidStr = String(groupID)
        if let index = conversations.firstIndex(where: { $0.id == gidStr && $0.isGroup }) {
            let c = conversations[index]
            let updated = Conversation(
                type: "group", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: lastMessage, lastMessageTime: lastMessageTime,
                unreadCount: c.unreadCount + unreadDelta, subtitle: senderNickname ?? c.subtitle,
                groupID: c.groupID, memberCount: c.memberCount
            )
            conversations[index] = updated
            conversations.sort { ($0.lastMessageTime ?? "") > ($1.lastMessageTime ?? "") }
            store.updateConversation(updated)
        } else {
            Task { await loadConversations() }
        }
    }
}
