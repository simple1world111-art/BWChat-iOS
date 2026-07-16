// BWChat/ViewModels/GroupsViewModel.swift
// Groups management view model

import Foundation
import Combine
import UIKit

@MainActor
class GroupsViewModel: ObservableObject {
    @Published var groups: [ChatGroup]
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()
    private var processedIncomingEvents: Set<String> = []

    init() {
        // Seed from disk before any network call — avoids empty-state flash.
        let legacy = LocalCache.load([ChatGroup].self, key: Self.cacheKey(for: AuthManager.shared.currentUser?.userID)) ?? []
        if let key = Self.snapshotKey(),
           let cached: CachedSnapshot<[ChatGroup]> = AppCacheRepository.shared.cachedValue(for: key) {
            groups = cached.value
        } else {
            groups = legacy
            if let key = Self.snapshotKey(), !legacy.isEmpty {
                AppCacheRepository.shared.save(legacy, for: key, policy: .list)
                LocalCache.clear(key: Self.cacheKey(for: AuthManager.shared.currentUser?.userID))
            }
        }
        setupWebSocketListeners()
        setupForegroundReload()
    }

    private func persist() {
        if let key = Self.snapshotKey() {
            AppCacheRepository.shared.save(groups, for: key, policy: .list)
        }
    }

    private static func cacheKey(for userID: String?) -> String {
        let normalized = userID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return "groups.\(normalized.isEmpty ? "anonymous" : normalized)"
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

    func loadGroups(forceRefresh: Bool = false) async {
        // Only block the UI on first load; subsequent refreshes happen
        // silently in the background with the cached list still visible.
        let showLoader = groups.isEmpty
        if showLoader { isLoading = true }
        defer { isLoading = false }
        guard let key = Self.snapshotKey() else { return }
        do {
            let fetched: [ChatGroup] = try await AppCacheRepository.shared.loadValue(
                key: key,
                policy: .list,
                forceRefresh: forceRefresh
            ) {
                Self.normalizedMessagePreviews(try await APIService.shared.getGroups())
            }
            if groups != fetched {
                groups = fetched
            }
            persist()
        } catch {
            if groups.isEmpty { errorMessage = L10n.tr("group.loadListFailed") }
        }
    }

    private static func snapshotKey() -> CacheKey? {
        CacheKey.current(namespace: "groups", key: "list")
    }

    func createGroup(name: String, memberIDs: [String], isPublic: Bool = false) async -> Bool {
        do {
            _ = try await APIService.shared.createGroup(name: name, memberIDs: memberIDs, isPublic: isPublic)
            await loadGroups()
            return true
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("group.createFailed")
        }
        return false
    }

    func markGroupAsRead(groupID: Int) {
        applyLocalRead(groupID: groupID)
        // Tell server in background + sync app icon badge
        Task {
            try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID)
            await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
        }
    }

    private func applyLocalRead(groupID: Int) {
        UnreadBadgeStore.shared.setConversationUnreadCount(
            0,
            for: ConversationReadTarget.group(groupID: groupID).listIdentity
        )
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
                    unreadCount: 0,
                    isPublic: g.isPublic
                )
                groups[index] = updated
                persist()
            }
        }
    }

    private func setupWebSocketListeners() {
        WebSocketService.shared.groupMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                self?.handleNewGroupMessage(message)
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
                self?.persist()
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
                        unreadCount: g.unreadCount,
                        isPublic: g.isPublic
                    )
                    self.persist()
                }
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .conversationDidMarkRead)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let target = notification.object as? ConversationReadTarget,
                      case .group(let groupID) = target else { return }
                self?.applyLocalRead(groupID: groupID)
            }
            .store(in: &cancellables)
    }

    private func handleNewGroupMessage(_ message: GroupMessage) {
        let myID = AuthManager.shared.currentUser?.userID
        let isFromOther = message.senderID != myID
        let isViewing = isFromOther && WebSocketService.shared.activeGroupID == message.groupID
        let isNewIncomingEvent = !isFromOther || processedIncomingEvents.insert(
            "\(message.groupID):\(message.id):\(message.timestamp)"
        ).inserted

        if isViewing {
            Task { try? await APIService.shared.markGroupMessagesAsRead(groupID: message.groupID) }
        }

        guard let index = groups.firstIndex(where: { $0.groupID == message.groupID }) else {
            Task { await loadGroups(forceRefresh: true) }
            return
        }
        let group = groups[index]
        guard Conversation.compareMessageTimes(group.lastMessageTime, message.timestamp) != .orderedDescending else {
            return
        }
        let unreadDelta = (isFromOther && !isViewing && isNewIncomingEvent) ? 1 : 0
        groups[index] = ChatGroup(
            groupID: group.groupID,
            name: group.name,
            avatarURL: group.avatarURL,
            creatorID: group.creatorID,
            memberCount: group.memberCount,
            lastMessage: Self.normalizedMessagePreview(message.content, msgType: message.msgType),
            lastMessageTime: message.timestamp,
            lastMessageSender: message.senderNickname,
            unreadCount: isViewing ? 0 : group.unreadCount + unreadDelta,
            isPublic: group.isPublic
        )
        sortGroupsByLatestMessage()
        persist()
    }

    private func handleGroupContactUpdate(_ data: [String: Any]) {
        guard let groupID = Self.intValue(data["group_id"]),
              let lastMessage = Self.stringValue(data["last_message"]),
              let lastMessageTime = Self.stringValue(data["last_message_time"]) else { return }
        let lastMessageType = Self.stringValue(data["msg_type"] ?? data["last_message_type"])
        let previewMessage = Self.normalizedMessagePreview(lastMessage, msgType: lastMessageType)

        let senderNickname = Self.stringValue(data["sender_nickname"])
        let senderID = Self.stringValue(data["sender_id"])
        let myID = AuthManager.shared.currentUser?.userID

        let isViewingThisGroup = senderID != myID && WebSocketService.shared.activeGroupID == groupID

        // Auto-mark as read on server if viewing this group
        if isViewingThisGroup {
            Task { try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID) }
        }

        if let index = groups.firstIndex(where: { $0.groupID == groupID }) {
            let g = groups[index]
            guard Conversation.compareMessageTimes(g.lastMessageTime, lastMessageTime) != .orderedDescending else {
                return
            }
            let unreadCount: Int
            if isViewingThisGroup {
                unreadCount = 0
            } else if senderID != myID,
                      let serverUnread = Self.intValue(data["unread_count"] ?? data["unread"] ?? data["unreadCount"]) {
                unreadCount = max(g.unreadCount, serverUnread)
            } else {
                unreadCount = g.unreadCount
            }
            let updated = ChatGroup(
                groupID: g.groupID,
                name: g.name,
                avatarURL: g.avatarURL,
                creatorID: g.creatorID,
                memberCount: g.memberCount,
                lastMessage: previewMessage,
                lastMessageTime: lastMessageTime,
                lastMessageSender: senderNickname ?? g.lastMessageSender,
                unreadCount: unreadCount,
                isPublic: g.isPublic
            )
            groups[index] = updated
            sortGroupsByLatestMessage()
            persist()
        } else {
            // New group not yet in list — reload to pick it up
            Task { await loadGroups() }
        }
    }

    private func sortGroupsByLatestMessage() {
        groups.sort {
            Conversation.compareMessageTimes($0.lastMessageTime, $1.lastMessageTime) == .orderedDescending
        }
    }

    private static func normalizedMessagePreviews(_ groups: [ChatGroup]) -> [ChatGroup] {
        groups.map { group in
            let preview = normalizedMessagePreview(group.lastMessage, msgType: nil)
            guard preview != group.lastMessage else { return group }
            return ChatGroup(
                groupID: group.groupID,
                name: group.name,
                avatarURL: group.avatarURL,
                creatorID: group.creatorID,
                memberCount: group.memberCount,
                lastMessage: preview,
                lastMessageTime: group.lastMessageTime,
                lastMessageSender: group.lastMessageSender,
                unreadCount: group.unreadCount,
                isPublic: group.isPublic
            )
        }
    }

    private static func normalizedMessagePreview(_ content: String?, msgType: String?) -> String? {
        guard let content else { return nil }
        if let stickerPreview = StickerMessagePayload.previewText(content: content, msgType: msgType) {
            return stickerPreview
        }
        if let moneyPreview = ChatMoneyPreview.text(content: content, msgType: msgType) {
            return moneyPreview
        }
        if msgType == "gift" || GiftMessagePayload.parse(content) != nil {
            return GiftMessagePayload.previewText(content: content)
        }
        return content
    }

    private static func stringValue(_ value: Any?) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) }
        return nil
    }
}
