import Foundation
import Combine
import UIKit

extension Notification.Name {
    static let conversationListNeedsReload = Notification.Name("conversationListNeedsReload")
}

@MainActor
class ConversationListViewModel: ObservableObject {
    @Published var conversations: [Conversation] = []
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()
    private let store = MessageStore.shared
    private var pinnedConversationKeys: Set<String> = []
    private var hiddenConversationSnapshots: [String: String] = [:]

    init() {
        loadCachedConversations()
        setupWebSocketListeners()
        setupForegroundReload()
        setupPushReload()
    }

    private func loadCachedConversations() {
        loadLocalListState()
        let cached = store.loadConversations()
        if !cached.isEmpty {
            conversations = applyLocalListState(to: cached)
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

    private func setupPushReload() {
        NotificationCenter.default.publisher(for: .conversationListNeedsReload)
            .debounce(for: .milliseconds(250), scheduler: DispatchQueue.main)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.loadConversations() }
            }
            .store(in: &cancellables)
    }

    func loadConversations() async {
        loadLocalListState()
        let showBlockingLoader = conversations.isEmpty
        if showBlockingLoader { isLoading = true }
        errorMessage = nil
        defer { isLoading = false }

        do {
            let serverConvs = applyLocalListState(
                to: Self.normalizedGiftPreviews(try await APIService.shared.getConversations())
            )
            // Avoid visual diff when data is identical — prevents the List from
            // redrawing (and its avatars from flashing) when the tab reappears
            // after a NavigationStack pop triggers a silent .task re-run.
            if conversations != serverConvs {
                conversations = serverConvs
            }
            store.saveConversations(serverConvs)
        } catch let error as APIError {
            if case .unauthorized = error {
                AuthManager.shared.logout()
            }
            if conversations.isEmpty { errorMessage = error.errorDescription }
        } catch {
            if conversations.isEmpty { errorMessage = L10n.tr("conversation.loadFailed") }
        }
    }

    func isPinned(_ conversation: Conversation) -> Bool {
        pinnedConversationKeys.contains(conversationKey(conversation))
    }

    func togglePinned(_ conversation: Conversation) {
        let key = conversationKey(conversation)
        if pinnedConversationKeys.contains(key) {
            pinnedConversationKeys.remove(key)
        } else {
            pinnedConversationKeys.insert(key)
            hiddenConversationSnapshots.removeValue(forKey: key)
        }
        savePinnedConversationKeys()
        saveHiddenConversationSnapshots()
        conversations = sortConversations(conversations)
        store.saveConversations(conversations)
    }

    func deleteConversation(_ conversation: Conversation) {
        let key = conversationKey(conversation)
        hiddenConversationSnapshots[key] = hiddenSnapshot(for: conversation)
        pinnedConversationKeys.remove(key)
        savePinnedConversationKeys()
        saveHiddenConversationSnapshots()
        conversations.removeAll { conversationKey($0) == key }
        store.saveConversations(conversations)
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

        WebSocketService.shared.groupMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                self?.handleNewGroupMessage(message)
            }
            .store(in: &cancellables)

        WebSocketService.shared.groupContactUpdatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.handleGroupContactUpdate(data)
            }
            .store(in: &cancellables)

        // DM contact_update fires on the SENDER too (new_message does not),
        // so this is how the sender's own conversation list reflects a just-
        // sent message without waiting for a full /conversations reload.
        WebSocketService.shared.contactUpdatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.handleDMContactUpdate(data)
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
        if isViewingThisChat {
            Task { try? await APIService.shared.markMessagesAsRead(contactID: contactID) }
        }

        let lastMsg: String
        if message.isImage { lastMsg = L10n.tr("message.image") }
        else if message.isVideo { lastMsg = L10n.tr("message.video") }
        else if message.isGift { lastMsg = GiftMessagePayload.previewText(content: message.content) }
        else if message.isVoice {
            let dur = Int(message.voiceDuration)
            lastMsg = dur > 0 ? "\(L10n.tr("message.voice")) \(dur)''" : L10n.tr("message.voice")
        }
        else { lastMsg = message.content }

        if let index = conversations.firstIndex(where: { $0.id == contactID && $0.isDM }) {
            let c = conversations[index]
            let isDuplicatePreview = c.lastMessageTime == message.timestamp && c.lastMessage == lastMsg
            let unreadDelta = (isFromOther && !isViewingThisChat && !isDuplicatePreview) ? 1 : 0
            let updated = Conversation(
                type: "dm", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: lastMsg, lastMessageTime: message.timestamp,
                unreadCount: c.unreadCount + unreadDelta, subtitle: nil,
                groupID: nil, memberCount: nil
            )
            conversations[index] = updated
            sortKeepingSelfPinned()
            store.updateConversation(updated)
        } else {
            Task { await loadConversations() }
        }
    }

    /// Fired for DMs the current user SENT (and also received, as a backup).
    /// Reflects the new preview + timestamp in the list instantly so the
    /// sender doesn't have to leave the chat and come back to see it move.
    private func handleDMContactUpdate(_ data: [String: Any]) {
        guard let senderID = Self.stringValue(data["sender_id"]),
              let receiverID = Self.stringValue(data["receiver_id"]),
              let lastMessage = Self.stringValue(data["last_message"]),
              let lastMessageTime = Self.stringValue(data["last_message_time"]) else { return }
        let lastMessageType = Self.stringValue(data["msg_type"] ?? data["last_message_type"])
        let previewMessage = Self.normalizedGiftPreview(lastMessage, msgType: lastMessageType)

        let myID = AuthManager.shared.currentUser?.userID
        // For self-chat both ids equal myID — the conversation id is myID.
        let contactID = (senderID == myID) ? receiverID : senderID
        let isFromOther = senderID != myID
        let isViewingThisChat = isFromOther && WebSocketService.shared.activeChatUserID == contactID

        if isViewingThisChat {
            Task { try? await APIService.shared.markMessagesAsRead(contactID: contactID) }
        }

        if let index = conversations.firstIndex(where: { $0.id == contactID && $0.isDM }) {
            let c = conversations[index]
            // Don't overwrite a newer preview with a stale one (can happen if
            // new_message arrived first and contact_update is the late follower).
            if let existingTime = c.lastMessageTime, existingTime > lastMessageTime { return }
            let unreadCount: Int
            if isViewingThisChat {
                unreadCount = 0
            } else if let serverUnread = Self.intValue(data["unread_count"] ?? data["unread"]) {
                unreadCount = serverUnread
            } else if isFromOther && c.lastMessageTime != lastMessageTime {
                unreadCount = c.unreadCount + 1
            } else {
                unreadCount = c.unreadCount
            }
            let updated = Conversation(
                type: "dm", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: previewMessage, lastMessageTime: lastMessageTime,
                unreadCount: unreadCount, subtitle: nil,
                groupID: nil, memberCount: nil
            )
            conversations[index] = updated
            sortKeepingSelfPinned()
            store.updateConversation(updated)
        } else {
            Task { await loadConversations() }
        }
    }

    /// Sort by pinned state + last_message_time while keeping the self-chat row
    /// at the top (mirrors the backend's get_conversations behavior).
    private func sortKeepingSelfPinned() {
        conversations = sortConversations(conversations)
    }

    /// Updates list preview when the server sends `new_group_message` without a separate contact_update payload.
    private func handleNewGroupMessage(_ message: GroupMessage) {
        let myID = AuthManager.shared.currentUser?.userID
        let isFromOther = message.senderID != myID
        let isViewingThisGroup = isFromOther && WebSocketService.shared.activeGroupID == message.groupID
        if isViewingThisGroup {
            Task { try? await APIService.shared.markGroupMessagesAsRead(groupID: message.groupID) }
        }

        let lastMsg: String
        if message.isImage { lastMsg = L10n.tr("message.image") }
        else if message.isVideo { lastMsg = L10n.tr("message.video") }
        else if message.isGift { lastMsg = GiftMessagePayload.previewText(content: message.content) }
        else if message.isVoice {
            let dur = Int(message.voiceDuration)
            lastMsg = dur > 0 ? "\(L10n.tr("message.voice")) \(dur)''" : L10n.tr("message.voice")
        }
        else { lastMsg = message.content }

        let gidStr = String(message.groupID)
        if let index = conversations.firstIndex(where: { $0.id == gidStr && $0.isGroup }) {
            let c = conversations[index]
            let isDuplicatePreview = c.lastMessageTime == message.timestamp && c.lastMessage == lastMsg
            let unreadDelta = (isFromOther && !isViewingThisGroup && !isDuplicatePreview) ? 1 : 0
            let updated = Conversation(
                type: "group", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: lastMsg, lastMessageTime: message.timestamp,
                unreadCount: c.unreadCount + unreadDelta, subtitle: message.senderNickname,
                groupID: c.groupID, memberCount: c.memberCount
            )
            conversations[index] = updated
            sortKeepingSelfPinned()
            store.updateConversation(updated)
        } else {
            Task { await loadConversations() }
        }
    }

    private func handleGroupContactUpdate(_ data: [String: Any]) {
        guard let groupID = Self.intValue(data["group_id"]),
              let lastMessage = Self.stringValue(data["last_message"]),
              let lastMessageTime = Self.stringValue(data["last_message_time"]) else { return }
        let lastMessageType = Self.stringValue(data["msg_type"] ?? data["last_message_type"])
        let previewMessage = Self.normalizedGiftPreview(lastMessage, msgType: lastMessageType)

        let senderNickname = Self.stringValue(data["sender_nickname"])
        let senderID = Self.stringValue(data["sender_id"])
        let myID = AuthManager.shared.currentUser?.userID
        let isFromOther = senderID != myID

        let isViewingThisGroup = isFromOther && WebSocketService.shared.activeGroupID == groupID

        if isViewingThisGroup {
            Task { try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID) }
        }

        let gidStr = String(groupID)
        if let index = conversations.firstIndex(where: { $0.id == gidStr && $0.isGroup }) {
            let c = conversations[index]
            let unreadCount: Int
            if isViewingThisGroup {
                unreadCount = 0
            } else if let serverUnread = Self.intValue(data["unread_count"] ?? data["unread"]) {
                unreadCount = serverUnread
            } else if isFromOther && c.lastMessageTime != lastMessageTime {
                unreadCount = c.unreadCount + 1
            } else {
                unreadCount = c.unreadCount
            }
            let updated = Conversation(
                type: "group", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: previewMessage, lastMessageTime: lastMessageTime,
                unreadCount: unreadCount, subtitle: senderNickname ?? c.subtitle,
                groupID: c.groupID, memberCount: c.memberCount
            )
            conversations[index] = updated
            sortKeepingSelfPinned()
            store.updateConversation(updated)
        } else {
            Task { await loadConversations() }
        }
    }

    private var userScopedListPrefix: String {
        AuthManager.shared.currentUser?.userID ?? "anonymous"
    }

    private var pinnedConversationStorageKey: String {
        "bbchat.conversationList.pinned.\(userScopedListPrefix)"
    }

    private var hiddenConversationStorageKey: String {
        "bbchat.conversationList.hidden.\(userScopedListPrefix)"
    }

    private func loadLocalListState() {
        pinnedConversationKeys = Set(UserDefaults.standard.stringArray(forKey: pinnedConversationStorageKey) ?? [])
        hiddenConversationSnapshots = UserDefaults.standard.dictionary(forKey: hiddenConversationStorageKey) as? [String: String] ?? [:]
    }

    private func savePinnedConversationKeys() {
        UserDefaults.standard.set(Array(pinnedConversationKeys), forKey: pinnedConversationStorageKey)
    }

    private func saveHiddenConversationSnapshots() {
        UserDefaults.standard.set(hiddenConversationSnapshots, forKey: hiddenConversationStorageKey)
    }

    private func conversationKey(_ conversation: Conversation) -> String {
        "\(conversation.type):\(conversation.id)"
    }

    private func hiddenSnapshot(for conversation: Conversation) -> String {
        conversation.lastMessageTime ?? ""
    }

    private func applyLocalListState(to source: [Conversation]) -> [Conversation] {
        var hidden = hiddenConversationSnapshots
        var hiddenChanged = false

        let visible = source.filter { conversation in
            let key = conversationKey(conversation)
            guard let hiddenSnapshot = hidden[key] else { return true }

            if hiddenSnapshot == self.hiddenSnapshot(for: conversation) {
                return false
            }

            hidden.removeValue(forKey: key)
            hiddenChanged = true
            return true
        }

        if hiddenChanged {
            hiddenConversationSnapshots = hidden
            saveHiddenConversationSnapshots()
        }

        return sortConversations(visible)
    }

    private func sortConversations(_ source: [Conversation]) -> [Conversation] {
        let myID = AuthManager.shared.currentUser?.userID
        return source.sorted { lhs, rhs in
            let lhsIsSelf = lhs.isDM && lhs.id == myID
            let rhsIsSelf = rhs.isDM && rhs.id == myID
            if lhsIsSelf != rhsIsSelf { return lhsIsSelf }

            let lhsPinned = pinnedConversationKeys.contains(conversationKey(lhs))
            let rhsPinned = pinnedConversationKeys.contains(conversationKey(rhs))
            if lhsPinned != rhsPinned { return lhsPinned }

            return (lhs.lastMessageTime ?? "") > (rhs.lastMessageTime ?? "")
        }
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

    private static func normalizedGiftPreviews(_ conversations: [Conversation]) -> [Conversation] {
        conversations.map { conversation in
            let preview = normalizedGiftPreview(conversation.lastMessage, msgType: nil)
            guard preview != conversation.lastMessage else { return conversation }
            return Conversation(
                type: conversation.type,
                id: conversation.id,
                name: conversation.name,
                avatarURL: conversation.avatarURL,
                lastMessage: preview,
                lastMessageTime: conversation.lastMessageTime,
                unreadCount: conversation.unreadCount,
                subtitle: conversation.subtitle,
                groupID: conversation.groupID,
                memberCount: conversation.memberCount
            )
        }
    }

    private static func normalizedGiftPreview(_ content: String?, msgType: String?) -> String? {
        guard let content else { return nil }
        if msgType == "gift" || GiftMessagePayload.parse(content) != nil {
            return GiftMessagePayload.previewText(content: content)
        }
        return content
    }

}
