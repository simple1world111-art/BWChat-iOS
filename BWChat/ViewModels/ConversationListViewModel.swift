import Foundation
import Combine
import UIKit

extension Notification.Name {
    static let conversationListNeedsReload = Notification.Name("conversationListNeedsReload")
    static let conversationPreviewDidChange = Notification.Name("conversationPreviewDidChange")
    static let conversationDidMarkRead = Notification.Name("conversationDidMarkRead")
}

@MainActor
class ConversationListViewModel: ObservableObject {
    @Published var conversations: [Conversation] = [] {
        didSet {
            scheduleChatUnreadBadgeSync()
        }
    }
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()
    private var badgeSyncTask: Task<Void, Never>?
    private let store = MessageStore.shared
    private var pinnedConversationKeys: Set<String> = []
    private var hiddenConversationSnapshots: [String: String] = [:]
    private var locallyInitiatedDMIDs: Set<String> = []
    private var readWatermarks: [String: String] = [:]
    /// A locally observed incoming message is an immediate unread fact. Keep
    /// that fact as a floor until the server catches up or the user reads the
    /// conversation, so an older HTTP/cache snapshot cannot make the badge
    /// briefly disappear.
    private var localUnreadFloors: [String: Int] = [:]
    private var processedIncomingDMEvents: Set<String> = []
    private var processedIncomingGroupEvents: Set<String> = []

    init() {
        loadCachedConversations()
        setupWebSocketListeners()
        setupLocalPreviewListener()
        setupReadStateListener()
        setupForegroundReload()
        setupPushReload()
    }

    private func loadCachedConversations() {
        loadLocalListState()
        guard let userID = currentUserID else { return }
        let cached = store.loadConversations(ownerID: userID)
        if !cached.isEmpty {
            let visible = visibleConversations(
                from: cached,
                friendIDs: cachedFriendIDs(for: userID),
                userID: userID
            )
            conversations = applyLocalListState(
                to: reconcileLatestPreviews(visible, liveConversations: [], userID: userID)
            )
        }
    }

    private func setupForegroundReload() {
        NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.loadConversations(forceRefresh: true) }
            }
            .store(in: &cancellables)
    }

    private func setupPushReload() {
        NotificationCenter.default.publisher(for: .conversationListNeedsReload)
            .debounce(for: .milliseconds(250), scheduler: DispatchQueue.main)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.loadConversations(forceRefresh: true) }
            }
            .store(in: &cancellables)
    }

    private func setupLocalPreviewListener() {
        NotificationCenter.default.publisher(for: .conversationPreviewDidChange)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self else { return }
                if let message = notification.object as? Message {
                    self.handleNewDM(message)
                } else if let message = notification.object as? GroupMessage {
                    self.handleNewGroupMessage(message)
                }
            }
            .store(in: &cancellables)
    }

    private func setupReadStateListener() {
        NotificationCenter.default.publisher(for: .conversationDidMarkRead)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self,
                      let target = notification.object as? ConversationReadTarget else { return }
                self.applyLocalRead(target)
            }
            .store(in: &cancellables)
    }

    func loadConversations(forceRefresh: Bool = false) async {
        loadLocalListState()
        let showBlockingLoader = conversations.isEmpty
        if showBlockingLoader { isLoading = true }
        errorMessage = nil
        defer { isLoading = false }
        guard let userID = currentUserID else {
            conversations = []
            return
        }

        do {
            async let agentConversationsRequest = try? APIService.shared.getAgentConversations()
            async let installedAgentsRequest = try? APIService.shared.getInstalledAgents()
            let fetch: () async throws -> [Conversation] = {
                async let fetchedConversations = APIService.shared.getConversations()
                async let fetchedFriends = APIService.shared.getFriendList()
                let rawConversations = try await fetchedConversations
                let friendList = (try? await fetchedFriends) ?? self.cachedFriends(for: userID)
                if !friendList.isEmpty {
                    LocalCache.save(friendList, key: FriendCacheKeys.friends(for: userID))
                }
                return self.visibleConversations(
                    from: Self.normalizedGiftPreviews(rawConversations),
                    friendIDs: Set(friendList.map(\.userID)),
                    userID: userID
                )
            }
            let rawChatConversations: [Conversation]
            if let key = CacheKey.current(namespace: "conversations", key: "list") {
                rawChatConversations = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .list,
                    forceRefresh: forceRefresh,
                    fetch: fetch
                )
            } else {
                rawChatConversations = try await fetch()
            }
            let agentConversations = (await agentConversationsRequest) ?? []
            let installedAgents = (await installedAgentsRequest) ?? []
            let activeAgentIDs = Set(agentConversations.map(\.agentID))
            let createdAgentsWithoutConversation = installedAgents.filter {
                $0.isOwner != false && !activeAgentIDs.contains($0.id)
            }
            let rawServerConvs = rawChatConversations
                + agentConversations.map(Conversation.init(agentConversation:))
                + createdAgentsWithoutConversation.map(Conversation.init(createdAgent:))
            let resolvedServerConvs = await resolvingScriptRoomAvatars(in: rawServerConvs)
            acknowledgeServerUnreadCounts(resolvedServerConvs)
            let serverConvs = applyLocalListState(
                to: reconcileLatestPreviews(
                    resolvedServerConvs,
                    liveConversations: conversations,
                    userID: userID
                )
            )
            // Avoid visual diff when data is identical — prevents the List from
            // redrawing (and its avatars from flashing) when the tab reappears
            // after a NavigationStack pop triggers a silent .task re-run.
            if conversations != serverConvs {
                conversations = serverConvs
            }
            store.saveConversations(serverConvs, ownerID: userID)
        } catch let error as APIError {
            if conversations.isEmpty { errorMessage = error.errorDescription }
        } catch {
            if conversations.isEmpty { errorMessage = L10n.tr("conversation.loadFailed") }
        }
    }

    private func resolvingScriptRoomAvatars(in source: [Conversation]) async -> [Conversation] {
        var result = source
        for index in result.indices where result[index].isScriptRoom {
            guard let roomID = result[index].scriptRoomID, !roomID.isBlank else { continue }
            let coverURL: String?
            if let key = CacheKey.current(namespace: "script-room-cover", key: roomID) {
                coverURL = try? await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .profile,
                    forceRefresh: false
                ) {
                    let room = try await APIService.shared.getScriptRoom(roomID: roomID)
                    return room.scriptSnapshot.coverURL
                }
            } else {
                coverURL = try? await APIService.shared.getScriptRoom(roomID: roomID).scriptSnapshot.coverURL
            }
            guard let coverURL, !coverURL.isBlank else { continue }
            result[index] = result[index].replacingAvatarURL(coverURL)
        }
        return result
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
        if let userID = currentUserID {
            store.saveConversations(conversations, ownerID: userID)
        }
    }

    func deleteConversation(_ conversation: Conversation) {
        let key = conversationKey(conversation)
        localUnreadFloors.removeValue(forKey: conversation.listIdentity)
        UnreadBadgeStore.shared.setConversationUnreadCount(0, for: conversation.listIdentity)
        hiddenConversationSnapshots[key] = hiddenSnapshot(for: conversation)
        pinnedConversationKeys.remove(key)
        savePinnedConversationKeys()
        saveHiddenConversationSnapshots()
        conversations.removeAll { conversationKey($0) == key }
        if let userID = currentUserID {
            store.saveConversations(conversations, ownerID: userID)
        }
    }

    func logout() async {
        do {
            try await APIService.shared.logout()
        } catch { }
        AuthManager.shared.logout()
    }

    func markAsRead(conversationID: String) {
        applyLocalRead(.direct(userID: conversationID))
        Task {
            try? await APIService.shared.markMessagesAsRead(contactID: conversationID)
            await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
        }
    }

    func markGroupAsRead(groupID: Int) {
        applyLocalRead(.group(groupID: groupID))
        Task {
            try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID)
            await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
        }
    }

    private func applyLocalRead(_ target: ConversationReadTarget) {
        localUnreadFloors.removeValue(forKey: target.listIdentity)
        // Clear immediately for the row/tab animation. The full-array badge
        // aggregation is coalesced onto the next run-loop turn below.
        UnreadBadgeStore.shared.setConversationUnreadCount(0, for: target.listIdentity)
        guard let index = conversations.firstIndex(where: { $0.listIdentity == target.listIdentity }) else {
            readWatermarks[target.listIdentity] = ISO8601DateFormatter().string(from: Date())
            saveReadWatermarks()
            UnreadBadgeStore.shared.setConversationUnreadCount(0, for: target.listIdentity)
            return
        }

        let conversation = conversations[index]
        readWatermarks[target.listIdentity] = conversation.lastMessageTime
            ?? ISO8601DateFormatter().string(from: Date())
        saveReadWatermarks()

        let updated = replacingPreview(
            in: conversation,
            message: conversation.lastMessage,
            timestamp: conversation.lastMessageTime,
            unreadCount: 0,
            subtitle: conversation.subtitle
        )
        if conversation != updated {
            conversations[index] = updated
        } else {
            UnreadBadgeStore.shared.setConversationUnreadCount(0, for: target.listIdentity)
        }
        if let userID = currentUserID {
            store.updateConversation(updated, ownerID: userID)
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
        if !isFromOther {
            locallyInitiatedDMIDs.insert(contactID)
        }

        let isViewingThisChat = isFromOther && WebSocketService.shared.activeChatUserID == contactID
        let identity = ConversationReadTarget.direct(userID: contactID).listIdentity
        if isViewingThisChat {
            recordReadWatermark(.direct(userID: contactID), timestamp: message.timestamp)
            Task { try? await APIService.shared.markMessagesAsRead(contactID: contactID) }
        }
        let isNewIncomingEvent = !isFromOther || processedIncomingDMEvents.insert(
            "\(contactID):\(message.id):\(message.timestamp)"
        ).inserted
        let isReadThrough = hasReadThrough(identity: identity, timestamp: message.timestamp)

        let lastMsg = Self.listPreview(for: message)

        if let index = conversations.firstIndex(where: { $0.id == contactID && $0.isDM }) {
            let c = conversations[index]
            guard Conversation.compareMessageTimes(c.lastMessageTime, message.timestamp) != .orderedDescending else {
                return
            }
            let shouldIncrementUnread = isFromOther && !isViewingThisChat && !isReadThrough && isNewIncomingEvent
            let unreadCount = shouldIncrementUnread
                ? recordIncomingUnread(identity: identity, currentCount: c.unreadCount)
                : ((isViewingThisChat || isReadThrough) ? 0 : c.unreadCount)
            let updated = Conversation(
                type: "dm", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: lastMsg, lastMessageTime: message.timestamp,
                unreadCount: unreadCount, subtitle: nil,
                groupID: nil, memberCount: nil
            )
            conversations[index] = updated
            sortKeepingSelfPinned()
            if let userID = currentUserID {
                store.updateConversation(updated, ownerID: userID)
            }
        } else {
            if isFromOther && !isViewingThisChat && !isReadThrough && isNewIncomingEvent {
                _ = recordIncomingUnread(identity: identity, currentCount: nil)
                syncChatUnreadBadge()
            }
            Task { await loadConversations(forceRefresh: true) }
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
        if senderID == myID {
            locallyInitiatedDMIDs.insert(contactID)
        }
        let isFromOther = senderID != myID
        let isViewingThisChat = isFromOther && WebSocketService.shared.activeChatUserID == contactID
        let identity = ConversationReadTarget.direct(userID: contactID).listIdentity
        let serverUnread = Self.intValue(data["unread_count"] ?? data["unread"])

        if isViewingThisChat {
            recordReadWatermark(.direct(userID: contactID), timestamp: lastMessageTime)
            Task { try? await APIService.shared.markMessagesAsRead(contactID: contactID) }
        } else if isFromOther,
                  !hasReadThrough(identity: identity, timestamp: lastMessageTime),
                  let serverUnread,
                  serverUnread > 0 {
            recordObservedUnreadFloor(identity: identity, count: serverUnread)
        }

        if let index = conversations.firstIndex(where: { $0.id == contactID && $0.isDM }) {
            let c = conversations[index]
            // Don't overwrite a newer preview with a stale one (can happen if
            // new_message arrived first and contact_update is the late follower).
            if Conversation.compareMessageTimes(c.lastMessageTime, lastMessageTime) == .orderedDescending {
                return
            }
            let unreadCount: Int
            if isViewingThisChat || hasReadThrough(identity: c.listIdentity, timestamp: lastMessageTime) {
                unreadCount = 0
            } else if isFromOther, let serverUnread {
                // `contact_update` is a preview event and can arrive before or
                // after `new_message`. Never let a stale/zero count erase a
                // locally observed unread message.
                unreadCount = max(c.unreadCount, serverUnread)
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
            if let userID = currentUserID {
                store.updateConversation(updated, ownerID: userID)
            }
        } else {
            Task { await loadConversations(forceRefresh: true) }
        }
    }

    /// Sort by pinned state + last_message_time while keeping the self-chat row
    /// at the top (mirrors the backend's get_conversations behavior).
    private func sortKeepingSelfPinned() {
        conversations = sortConversations(conversations)
    }

    private func syncChatUnreadBadge() {
        var counts = Dictionary(
            conversations.map { ($0.listIdentity, max(0, $0.unreadCount)) },
            uniquingKeysWith: { max($0, $1) }
        )
        for (identity, floor) in localUnreadFloors {
            counts[identity] = max(counts[identity, default: 0], floor)
        }
        UnreadBadgeStore.shared.replaceChatUnreadCounts(counts)
    }

    private func scheduleChatUnreadBadgeSync() {
        badgeSyncTask?.cancel()
        badgeSyncTask = Task { @MainActor [weak self] in
            // Publishing another observed object from an @Published didSet can
            // otherwise happen during SwiftUI's view-update transaction.
            await Task.yield()
            guard !Task.isCancelled else { return }
            self?.syncChatUnreadBadge()
        }
    }

    /// Updates list preview when the server sends `new_group_message` without a separate contact_update payload.
    private func handleNewGroupMessage(_ message: GroupMessage) {
        let myID = AuthManager.shared.currentUser?.userID
        let isFromOther = message.senderID != myID
        let isChatMoneyReceipt = ChatMoneyPreview.isReceipt(
            content: message.content,
            msgType: message.msgType
        )
        let isViewingThisGroup = isFromOther && WebSocketService.shared.activeGroupID == message.groupID
        let identity = ConversationReadTarget.group(groupID: message.groupID).listIdentity
        if isViewingThisGroup {
            recordReadWatermark(.group(groupID: message.groupID), timestamp: message.timestamp)
            Task { try? await APIService.shared.markGroupMessagesAsRead(groupID: message.groupID) }
        }
        let isNewIncomingEvent = !isFromOther || processedIncomingGroupEvents.insert(
            "\(message.groupID):\(message.id):\(message.timestamp)"
        ).inserted
        let isReadThrough = hasReadThrough(identity: identity, timestamp: message.timestamp)

        let lastMsg = Self.listPreview(for: message)

        if let index = groupConversationIndex(groupID: message.groupID) {
            let c = conversations[index]
            guard Conversation.compareMessageTimes(c.lastMessageTime, message.timestamp) != .orderedDescending else {
                return
            }
            let shouldIncrementUnread = isFromOther && !isViewingThisGroup && !isReadThrough && isNewIncomingEvent
            let unreadCount = shouldIncrementUnread
                ? recordIncomingUnread(identity: identity, currentCount: c.unreadCount)
                : ((isViewingThisGroup || isReadThrough) ? 0 : c.unreadCount)
            let updated = Conversation(
                type: "group", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: lastMsg, lastMessageTime: message.timestamp,
                unreadCount: unreadCount,
                subtitle: isChatMoneyReceipt ? nil : message.senderNickname,
                groupID: c.groupID ?? message.groupID, memberCount: c.memberCount,
                conversationKind: c.conversationKind,
                scriptRoomID: c.scriptRoomID,
                scriptID: c.scriptID
            )
            conversations[index] = updated
            sortKeepingSelfPinned()
            if let userID = currentUserID {
                store.updateConversation(updated, ownerID: userID)
            }
        } else {
            if isFromOther && !isViewingThisGroup && !isReadThrough && isNewIncomingEvent {
                _ = recordIncomingUnread(identity: identity, currentCount: nil)
                syncChatUnreadBadge()
            }
            Task { await loadConversations(forceRefresh: true) }
        }
    }

    private func handleGroupContactUpdate(_ data: [String: Any]) {
        guard let groupID = Self.intValue(data["group_id"]),
              let lastMessage = Self.stringValue(data["last_message"]),
              let lastMessageTime = Self.stringValue(data["last_message_time"]) else { return }
        let lastMessageType = Self.stringValue(data["msg_type"] ?? data["last_message_type"])
        let previewMessage = Self.normalizedGiftPreview(lastMessage, msgType: lastMessageType)
        let isChatMoneyReceipt = ChatMoneyPreview.isReceipt(
            content: lastMessage,
            msgType: lastMessageType
        )

        let senderNickname = Self.stringValue(data["sender_nickname"])
        let senderID = Self.stringValue(data["sender_id"])
        let myID = AuthManager.shared.currentUser?.userID
        let isFromOther = senderID.map { $0 != myID } ?? false

        let isViewingThisGroup = isFromOther && WebSocketService.shared.activeGroupID == groupID
        let identity = ConversationReadTarget.group(groupID: groupID).listIdentity
        let serverUnread = Self.intValue(data["unread_count"] ?? data["unread"])

        if isViewingThisGroup {
            recordReadWatermark(.group(groupID: groupID), timestamp: lastMessageTime)
            Task { try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID) }
        } else if isFromOther,
                  !hasReadThrough(identity: identity, timestamp: lastMessageTime),
                  let serverUnread,
                  serverUnread > 0 {
            recordObservedUnreadFloor(identity: identity, count: serverUnread)
        }

        if let index = groupConversationIndex(groupID: groupID) {
            let c = conversations[index]
            if Conversation.compareMessageTimes(c.lastMessageTime, lastMessageTime) == .orderedDescending {
                return
            }
            let unreadCount: Int
            if isViewingThisGroup || hasReadThrough(identity: c.listIdentity, timestamp: lastMessageTime) {
                unreadCount = 0
            } else if isFromOther, let serverUnread {
                unreadCount = max(c.unreadCount, serverUnread)
            } else {
                unreadCount = c.unreadCount
            }
            let updated = Conversation(
                type: "group", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: previewMessage, lastMessageTime: lastMessageTime,
                unreadCount: unreadCount,
                subtitle: isChatMoneyReceipt ? nil : (senderNickname ?? c.subtitle),
                groupID: c.groupID ?? groupID, memberCount: c.memberCount,
                conversationKind: c.conversationKind,
                scriptRoomID: c.scriptRoomID,
                scriptID: c.scriptID
            )
            conversations[index] = updated
            sortKeepingSelfPinned()
            if let userID = currentUserID {
                store.updateConversation(updated, ownerID: userID)
            }
        } else {
            Task { await loadConversations(forceRefresh: true) }
        }
    }

    private var currentUserID: String? {
        let id = AuthManager.shared.currentUser?.userID.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return id.isEmpty ? nil : id
    }

    private var userScopedListPrefix: String {
        currentUserID ?? "anonymous"
    }

    private var pinnedConversationStorageKey: String {
        "bbchat.conversationList.pinned.\(userScopedListPrefix)"
    }

    private var hiddenConversationStorageKey: String {
        "bbchat.conversationList.hidden.\(userScopedListPrefix)"
    }

    private var readWatermarkStorageKey: String {
        "bbchat.conversationList.readWatermarks.\(userScopedListPrefix)"
    }

    private func loadLocalListState() {
        pinnedConversationKeys = Set(UserDefaults.standard.stringArray(forKey: pinnedConversationStorageKey) ?? [])
        hiddenConversationSnapshots = UserDefaults.standard.dictionary(forKey: hiddenConversationStorageKey) as? [String: String] ?? [:]
        readWatermarks = UserDefaults.standard.dictionary(forKey: readWatermarkStorageKey) as? [String: String] ?? [:]
    }

    private func savePinnedConversationKeys() {
        UserDefaults.standard.set(Array(pinnedConversationKeys), forKey: pinnedConversationStorageKey)
    }

    private func saveHiddenConversationSnapshots() {
        UserDefaults.standard.set(hiddenConversationSnapshots, forKey: hiddenConversationStorageKey)
    }

    private func saveReadWatermarks() {
        UserDefaults.standard.set(readWatermarks, forKey: readWatermarkStorageKey)
    }

    private func recordReadWatermark(_ target: ConversationReadTarget, timestamp: String) {
        let current = readWatermarks[target.listIdentity]
        guard Conversation.compareMessageTimes(timestamp, current) != .orderedAscending else { return }
        readWatermarks[target.listIdentity] = timestamp
        localUnreadFloors.removeValue(forKey: target.listIdentity)
        saveReadWatermarks()
        UnreadBadgeStore.shared.setConversationUnreadCount(0, for: target.listIdentity)
    }

    private func hasReadThrough(identity: String, timestamp: String?) -> Bool {
        guard let watermark = readWatermarks[identity] else { return false }
        return Conversation.compareMessageTimes(watermark, timestamp) != .orderedAscending
    }

    /// Records a unique incoming event as an absolute lower bound. The value
    /// is not a delta because snapshots may arrive out of order; taking max at
    /// merge time is stable and cannot double-count the same HTTP baseline.
    @discardableResult
    private func recordIncomingUnread(identity: String, currentCount: Int?) -> Int {
        let localKnownCount = max(currentCount ?? 0, localUnreadFloors[identity] ?? 0)
        let knownCount = max(
            localKnownCount,
            UnreadBadgeStore.shared.conversationUnreadCount(for: identity) ?? 0
        )
        let next = knownCount + 1
        localUnreadFloors[identity] = next
        UnreadBadgeStore.shared.setConversationUnreadCount(next, for: identity)
        return next
    }

    private func recordObservedUnreadFloor(identity: String, count: Int) {
        let localKnownCount = max(count, localUnreadFloors[identity] ?? 0)
        let next = max(
            localKnownCount,
            UnreadBadgeStore.shared.conversationUnreadCount(for: identity) ?? 0
        )
        localUnreadFloors[identity] = next
        UnreadBadgeStore.shared.setConversationUnreadCount(next, for: identity)
    }

    private func acknowledgeServerUnreadCounts(_ serverConversations: [Conversation]) {
        for conversation in serverConversations {
            let identity = conversation.listIdentity
            guard let floor = localUnreadFloors[identity],
                  conversation.unreadCount >= floor else { continue }
            localUnreadFloors.removeValue(forKey: identity)
        }
    }

    private func conversationKey(_ conversation: Conversation) -> String {
        conversation.listIdentity
    }

    private func hiddenSnapshot(for conversation: Conversation) -> String {
        [conversation.lastMessageTime ?? "", conversation.lastMessage ?? ""]
            .joined(separator: "\u{1F}")
    }

    private func hiddenSnapshotMatches(_ stored: String, conversation: Conversation) -> Bool {
        let components = stored.split(separator: "\u{1F}", maxSplits: 1, omittingEmptySubsequences: false)
        if components.count == 2 {
            return Conversation.compareMessageTimes(String(components[0]), conversation.lastMessageTime) == .orderedSame
                && String(components[1]) == (conversation.lastMessage ?? "")
        }

        // Backward compatibility for snapshots written by earlier builds,
        // which persisted only the raw timestamp string.
        return Conversation.compareMessageTimes(stored, conversation.lastMessageTime) == .orderedSame
    }

    private func groupConversationIndex(groupID: Int) -> Int? {
        conversations.firstIndex { matchesGroupConversation($0, groupID: groupID) }
    }

    private func matchesGroupConversation(_ conversation: Conversation, groupID: Int) -> Bool {
        guard conversation.isGroup else { return false }
        if conversation.resolvedGroupID == groupID { return true }
        return conversation.id == String(groupID)
    }

    private func cachedFriends(for userID: String) -> [FriendInfo] {
        LocalCache.load([FriendInfo].self, key: FriendCacheKeys.friends(for: userID)) ?? []
    }

    private func cachedFriendIDs(for userID: String) -> Set<String> {
        Set(cachedFriends(for: userID).map(\.userID))
    }

    private func visibleConversations(
        from source: [Conversation],
        friendIDs: Set<String>,
        userID: String
    ) -> [Conversation] {
        source.filter { conversation in
            guard conversation.isDM else { return true }
            if conversation.id == userID { return true }
            // The message list is event-driven, not address-book-driven. A
            // real incoming conversation must remain visible even when the
            // friend request/cache is temporarily unavailable; otherwise the
            // tab can show unread messages with no row to open.
            if conversation.lastMessage != nil
                || conversation.lastMessageTime != nil
                || conversation.unreadCount > 0 {
                return true
            }
            if friendIDs.contains(conversation.id) { return true }
            if locallyInitiatedDMIDs.contains(conversation.id) { return true }
            return store.hasOutgoingMessage(from: userID, to: conversation.id)
        }
    }

    private func applyLocalListState(to source: [Conversation]) -> [Conversation] {
        var hidden = hiddenConversationSnapshots
        var hiddenChanged = false

        let visible = source.filter { conversation in
            let key = conversationKey(conversation)
            guard let hiddenSnapshot = hidden[key] else { return true }

            if hiddenSnapshotMatches(hiddenSnapshot, conversation: conversation) {
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

    private func reconcileLatestPreviews(
        _ source: [Conversation],
        liveConversations: [Conversation],
        userID: String
    ) -> [Conversation] {
        let directMessages = store.loadLatestDirectMessages(ownerID: userID)
        let groupMessages = store.loadLatestGroupMessages()
        let liveByIdentity = Dictionary(
            liveConversations.map { ($0.listIdentity, $0) },
            uniquingKeysWith: { current, candidate in
                Conversation.compareMessageTimes(
                    candidate.lastMessageTime,
                    current.lastMessageTime
                ) == .orderedDescending ? candidate : current
            }
        )

        return source.map { conversation in
            var result = conversation

            if conversation.isDM, let message = directMessages[conversation.id],
               Conversation.compareMessageTimes(message.timestamp, result.lastMessageTime) != .orderedAscending {
                result = replacingPreview(
                    in: result,
                    message: Self.listPreview(for: message),
                    timestamp: message.timestamp,
                    unreadCount: result.unreadCount,
                    subtitle: nil
                )
            } else if conversation.isGroup,
                      let groupID = conversation.resolvedGroupID,
                      let message = groupMessages[groupID],
                      Conversation.compareMessageTimes(message.timestamp, result.lastMessageTime) != .orderedAscending {
                result = replacingPreview(
                    in: result,
                    message: Self.listPreview(for: message),
                    timestamp: message.timestamp,
                    unreadCount: result.unreadCount,
                    subtitle: ChatMoneyPreview.isReceipt(
                        content: message.content,
                        msgType: message.msgType
                    ) ? nil : message.senderNickname
                )
            }

            if let live = liveByIdentity[conversation.listIdentity] {
                let liveOrder = Conversation.compareMessageTimes(live.lastMessageTime, result.lastMessageTime)
                if liveOrder == .orderedDescending {
                    result = replacingPreview(
                        in: result,
                        message: live.lastMessage,
                        timestamp: live.lastMessageTime,
                        unreadCount: live.unreadCount,
                        subtitle: live.subtitle
                    )
                } else if liveOrder == .orderedSame {
                    result = replacingPreview(
                        in: result,
                        message: result.lastMessage ?? live.lastMessage,
                        timestamp: result.lastMessageTime ?? live.lastMessageTime,
                        unreadCount: max(result.unreadCount, live.unreadCount),
                        subtitle: result.subtitle ?? live.subtitle
                    )
                }
            }

            if let watermark = readWatermarks[result.listIdentity],
               Conversation.compareMessageTimes(watermark, result.lastMessageTime) != .orderedAscending {
                result = replacingPreview(
                    in: result,
                    message: result.lastMessage,
                    timestamp: result.lastMessageTime,
                    unreadCount: 0,
                    subtitle: result.subtitle
                )
            } else if let floor = localUnreadFloors[result.listIdentity],
                      floor > result.unreadCount {
                result = replacingPreview(
                    in: result,
                    message: result.lastMessage,
                    timestamp: result.lastMessageTime,
                    unreadCount: floor,
                    subtitle: result.subtitle
                )
            }

            return result
        }
    }

    private func replacingPreview(
        in conversation: Conversation,
        message: String?,
        timestamp: String?,
        unreadCount: Int,
        subtitle: String?
    ) -> Conversation {
        Conversation(
            type: conversation.type,
            id: conversation.id,
            name: conversation.name,
            avatarURL: conversation.avatarURL,
            lastMessage: message,
            lastMessageTime: timestamp,
            unreadCount: unreadCount,
            subtitle: subtitle,
            groupID: conversation.groupID,
            memberCount: conversation.memberCount,
            conversationKind: conversation.conversationKind,
            scriptRoomID: conversation.scriptRoomID,
            scriptID: conversation.scriptID,
            agentConversationID: conversation.agentConversationID,
            agentID: conversation.agentID,
            agentAvatarAssetID: conversation.agentAvatarAssetID,
            agentGreetingID: conversation.agentGreetingID
        )
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

            let timeOrder = Conversation.compareMessageTimes(lhs.lastMessageTime, rhs.lastMessageTime)
            if timeOrder != .orderedSame {
                return timeOrder == .orderedDescending
            }
            return lhs.listIdentity < rhs.listIdentity
        }
    }

    private static func listPreview(for message: Message) -> String {
        if message.isImage { return L10n.tr("message.image") }
        if message.isVideo { return L10n.tr("message.video") }
        if message.isSticker { return message.stickerPayload?.previewText ?? L10n.tr("message.sticker") }
        if message.isGift { return GiftMessagePayload.previewText(content: message.content) }
        if let preview = ChatMoneyPreview.text(
            content: message.content,
            msgType: message.msgType,
            viewerID: AuthManager.shared.currentUser?.userID
        ) { return preview }
        if message.isVoice {
            let duration = Int(message.voiceDuration)
            return duration > 0
                ? "\(L10n.tr("message.voice")) \(duration)''"
                : L10n.tr("message.voice")
        }
        return message.content
    }

    private static func listPreview(for message: GroupMessage) -> String {
        if message.isImage { return L10n.tr("message.image") }
        if message.isVideo { return L10n.tr("message.video") }
        if message.isSticker { return message.stickerPayload?.previewText ?? L10n.tr("message.sticker") }
        if message.isGift { return GiftMessagePayload.previewText(content: message.content) }
        if let preview = ChatMoneyPreview.text(
            content: message.content,
            msgType: message.msgType,
            viewerID: AuthManager.shared.currentUser?.userID
        ) { return preview }
        if message.isVoice {
            let duration = Int(message.voiceDuration)
            return duration > 0
                ? "\(L10n.tr("message.voice")) \(duration)''"
                : L10n.tr("message.voice")
        }
        return message.content
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
            let isChatMoneyReceipt = ChatMoneyPreview.isReceipt(
                content: conversation.lastMessage,
                msgType: nil
            )
            let preview = normalizedGiftPreview(conversation.lastMessage, msgType: nil)
            guard preview != conversation.lastMessage || isChatMoneyReceipt else { return conversation }
            return Conversation(
                type: conversation.type,
                id: conversation.id,
                name: conversation.name,
                avatarURL: conversation.avatarURL,
                lastMessage: preview,
                lastMessageTime: conversation.lastMessageTime,
                unreadCount: conversation.unreadCount,
                subtitle: isChatMoneyReceipt ? nil : conversation.subtitle,
                groupID: conversation.groupID,
                memberCount: conversation.memberCount,
                conversationKind: conversation.conversationKind,
                scriptRoomID: conversation.scriptRoomID,
                scriptID: conversation.scriptID
            )
        }
    }

    private static func normalizedGiftPreview(_ content: String?, msgType: String?) -> String? {
        guard let content else { return nil }
        if let stickerPreview = StickerMessagePayload.previewText(content: content, msgType: msgType) {
            return stickerPreview
        }
        if let moneyPreview = ChatMoneyPreview.text(
            content: content,
            msgType: msgType,
            viewerID: AuthManager.shared.currentUser?.userID
        ) {
            return moneyPreview
        }
        if msgType == "gift" || GiftMessagePayload.parse(content) != nil {
            return GiftMessagePayload.previewText(content: content)
        }
        return content
    }

}
