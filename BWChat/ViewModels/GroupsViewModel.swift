// BWChat/ViewModels/GroupsViewModel.swift
// Groups management view model

import Foundation
import Combine
import UIKit

@MainActor
class GroupsViewModel: ObservableObject {
    @Published var groups: [ChatGroup] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()

    init() {
        setupWebSocketListeners()
        setupForegroundReload()
    }

    /// Reload groups whenever app returns to foreground to pick up any
    /// messages delivered while the WebSocket was disconnected.
    private func setupForegroundReload() {
        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.loadGroups() }
            }
            .store(in: &cancellables)
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
        // Clear unread count locally first for instant UI update
        if let index = groups.firstIndex(where: { $0.id == groupID }) {
            let g = groups[index]
            if g.unreadCount > 0 {
                let updated = ChatGroup(
                    groupID: g.groupID,
                    name: g.name,
                    avatarURL: g.avatarURL,
                    creatorID: g.creatorID,
                    memberCount: g.memberCount,
                    lastMessage: g.lastMessage,
                    lastMessageTime: g.lastMessageTime,
                    lastMessageSender: g.lastMessageSender,
                    unreadCount: 0
                )
                groups[index] = updated
            }
        }
        // Tell server in background + sync app icon badge
        Task {
            try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID)
            await MainActor.run { PushService.shared.clearBadge() }
        }
    }

    private func setupWebSocketListeners() {
        WebSocketService.shared.groupMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { _ in
                // Contact update handler takes care of updating preview/unread.
                // Only reload if we need fresh member counts etc.
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

        WebSocketService.shared.groupRemovedPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] groupID in
                self?.groups.removeAll { $0.groupID == groupID }
            }
            .store(in: &cancellables)

        WebSocketService.shared.groupRenamedPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] (groupID, newName) in
                guard let self = self else { return }
                if let index = self.groups.firstIndex(where: { $0.groupID == groupID }) {
                    let g = self.groups[index]
                    self.groups[index] = ChatGroup(
                        groupID: g.groupID,
                        name: newName,
                        avatarURL: g.avatarURL,
                        creatorID: g.creatorID,
                        memberCount: g.memberCount,
                        lastMessage: g.lastMessage,
                        lastMessageTime: g.lastMessageTime,
                        lastMessageSender: g.lastMessageSender,
                        unreadCount: g.unreadCount
                    )
                }
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

        // Suppress unread increment if user is actively viewing this group chat
        let isViewingThisGroup = senderID != myID && WebSocketService.shared.activeGroupID == groupID
        let unreadDelta = (senderID != myID && !isViewingThisGroup) ? 1 : 0

        // Auto-mark as read on server if viewing this group
        if isViewingThisGroup {
            Task { try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID) }
        }

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
                unreadCount: g.unreadCount + unreadDelta
            )
            groups[index] = updated
            groups.sort { ($0.lastMessageTime ?? "") > ($1.lastMessageTime ?? "") }
        } else {
            // New group not yet in list — reload to pick it up
            Task { await loadGroups() }
        }
    }
}
