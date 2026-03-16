// BWChat/ViewModels/GroupsViewModel.swift
// Groups management view model

import Foundation
import Combine

@MainActor
class GroupsViewModel: ObservableObject {
    @Published var groups: [ChatGroup] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()

    init() {
        setupWebSocketListeners()
    }

    func loadGroups() async {
        isLoading = true
        do {
            groups = try await APIService.shared.getGroups()
        } catch {
            errorMessage = "加载群聊失败"
        }
        isLoading = false
    }

    func createGroup(name: String, memberIDs: [String]) async -> Bool {
        do {
            _ = try await APIService.shared.createGroup(name: name, memberIDs: memberIDs)
            await loadGroups()
            return true
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "创建失败"
        }
        return false
    }

    func markGroupAsRead(groupID: Int) {
        // Clear unread count locally
        if let index = groups.firstIndex(where: { $0.id == groupID }) {
            let g = groups[index]
            if g.unreadCount > 0 {
                // Reload groups to get fresh data with unread=0
                Task {
                    try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID)
                    await loadGroups()
                }
            }
        } else {
            // No local group found, just tell server
            Task {
                try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID)
            }
        }
    }

    private func setupWebSocketListeners() {
        WebSocketService.shared.groupMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.loadGroups() }
            }
            .store(in: &cancellables)

        WebSocketService.shared.groupCreatedPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.loadGroups() }
            }
            .store(in: &cancellables)

        WebSocketService.shared.groupContactUpdatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.handleGroupContactUpdate(data)
            }
            .store(in: &cancellables)
    }

    private func handleGroupContactUpdate(_ data: [String: Any]) {
        guard let groupID = data["group_id"] as? Int,
              let lastMessage = data["last_message"] as? String,
              let lastMessageTime = data["last_message_time"] as? String else { return }

        let senderNickname = data["sender_nickname"] as? String
        let senderID = data["sender_id"] as? String
        let myID = AuthManager.shared.currentUser?.userID

        if let index = groups.firstIndex(where: { $0.groupID == groupID }) {
            let g = groups[index]
            let updated = ChatGroup(
                groupID: g.groupID,
                name: g.name,
                avatarURL: g.avatarURL,
                creatorID: g.creatorID,
                memberCount: g.memberCount,
                lastMessage: lastMessage,
                lastMessageTime: lastMessageTime,
                lastMessageSender: senderNickname ?? g.lastMessageSender,
                unreadCount: g.unreadCount + (senderID != myID ? 1 : 0)
            )
            groups[index] = updated
            groups.sort { ($0.lastMessageTime ?? "") > ($1.lastMessageTime ?? "") }

            // Show local notification if message is from someone else
            // and user is NOT currently viewing this group chat
            if senderID != myID && WebSocketService.shared.activeGroupID != groupID {
                let title = g.name
                let body = "\(senderNickname ?? "")\u{ff1a}\(lastMessage)"
                PushService.shared.showLocalNotification(
                    title: title,
                    body: body,
                    userInfo: ["sender_id": senderID ?? "", "group_id": groupID]
                )
            }
        }
    }
}
