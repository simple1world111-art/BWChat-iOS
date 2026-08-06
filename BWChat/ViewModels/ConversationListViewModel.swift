import Foundation
import Combine
import UIKit

extension Notification.Name {
    static let conversationListNeedsReload = Notification.Name("conversationListNeedsReload")
    static let conversationPreviewDidChange = Notification.Name("conversationPreviewDidChange")
    static let conversationDidMarkRead = Notification.Name("conversationDidMarkRead")
}

struct LocalConversationPreviewUpdate {
    let target: ConversationReadTarget
    let lastMessage: String?
    let lastMessageTime: String?

    init(target: ConversationReadTarget, lastMessage: String?, lastMessageTime: String?) {
        self.target = target
        self.lastMessage = lastMessage
        self.lastMessageTime = lastMessageTime
    }
}

struct AgentConversationPreviewUpdate {
    let conversationID: String
    let lastMessage: String
    let lastMessageTime: String
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
    @Published private(set) var isShowingCachedData = false
    @Published private(set) var lastSuccessfulSyncAt: Date?
    @Published private(set) var deletingConversationIDs: Set<String> = []

    private var cancellables = Set<AnyCancellable>()
    private var badgeSyncTask: Task<Void, Never>?
    private let store = MessageStore.shared
    private let preferenceStore = ConversationPreferenceStore.shared
    private var hiddenConversationSnapshots: [String: String] = [:]
    private var locallyInitiatedDMIDs: Set<String> = []
    private var livePairConversationIDs: Set<String> = []
    private var readWatermarks: [String: String] = [:]
    /// A locally observed incoming message is an immediate unread fact. Keep
    /// that fact as a floor until the server catches up or the user reads the
    /// conversation, so an older HTTP/cache snapshot cannot make the badge
    /// briefly disappear.
    private var localUnreadFloors: [String: Int] = [:]
    private var processedIncomingDMEvents: Set<String> = []
    private var processedIncomingGroupEvents: Set<String> = []
    private var conversationLoadInFlight = false
    private var queuedForcedReload = false
    private var activeLoadIsForced = false
    private var activeLoadSyncGeneration = 0
    private var remoteSnapshotOwnerID: String?
    private var cachedConversationOwnerID: String?
    private var initialCacheLoadTask: Task<Void, Never>?
    private var lastAcceptedSnapshotRevision: Int64?

    init() {
        isLoading = currentUserID != nil
        setupWebSocketListeners()
        setupLocalPreviewListener()
        setupReadStateListener()
        setupForegroundReload()
        setupPushReload()
        setupMessageSyncCoordinator()
        setupGroupInfoListener()
        preferenceStore.$pinnedKeys
            .dropFirst()
            .sink { [weak self] _ in
                guard let self else { return }
                self.conversations = self.sortConversations(self.conversations)
                if let userID = self.currentUserID {
                    self.store.saveConversations(self.conversations, ownerID: userID)
                }
            }
            .store(in: &cancellables)
        initialCacheLoadTask = Task { [weak self] in
            await self?.loadCachedConversations()
        }
    }

    private func loadCachedConversations() async {
        loadLocalListState()
        guard let userID = currentUserID else { return }
        let cached = await store.loadConversationsAsync(ownerID: userID)
        cachedConversationOwnerID = userID
        guard remoteSnapshotOwnerID != userID, currentUserID == userID else { return }
        if !cached.isEmpty {
            isShowingCachedData = true
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

    private func setupMessageSyncCoordinator() {
        AppMessageSyncCoordinator.shared.$syncGeneration
            .dropFirst()
            .debounce(for: .milliseconds(180), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.loadConversations(forceRefresh: true) }
            }
            .store(in: &cancellables)
    }

    private func setupGroupInfoListener() {
        NotificationCenter.default.publisher(for: .groupInfoDidChange)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self,
                      let groupID = notification.object as? Int,
                      let index = self.conversations.firstIndex(where: {
                          $0.isGroup && $0.resolvedGroupID == groupID
                      }) else { return }
                let conversation = self.conversations[index]
                let canonicalName = LocalCache.load(
                    GroupDetail.self,
                    key: "group_detail_\(groupID)"
                )?.name ?? conversation.name
                let displayName = GroupInfoPreferencesStore.shared.displayName(
                    for: groupID,
                    fallback: canonicalName
                )
                guard displayName != conversation.name else { return }
                let updated = conversation.replacingName(displayName)
                self.conversations[index] = updated
                if let userID = self.currentUserID {
                    self.store.updateConversation(updated, ownerID: userID)
                }
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
                } else if let update = notification.object as? LocalConversationPreviewUpdate {
                    self.applyLocalPreviewUpdate(update)
                } else if let update = notification.object as? AgentConversationPreviewUpdate {
                    self.applyAgentPreviewUpdate(update)
                }
            }
            .store(in: &cancellables)
    }

    private func applyAgentPreviewUpdate(_ update: AgentConversationPreviewUpdate) {
        let identity = "agent:\(update.conversationID)"
        guard let index = conversations.firstIndex(where: { $0.listIdentity == identity }) else { return }
        let current = conversations[index]
        let replacement = replacingPreview(
            in: current,
            message: update.lastMessage,
            timestamp: update.lastMessageTime,
            unreadCount: current.unreadCount,
            subtitle: current.subtitle
        )
        guard replacement != current else { return }
        conversations[index] = replacement
        if let ownerID = currentUserID { store.updateConversation(replacement, ownerID: ownerID) }
    }

    private func applyLocalPreviewUpdate(_ update: LocalConversationPreviewUpdate) {
        let identity = update.target.listIdentity
        guard let index = conversations.firstIndex(where: { conversation in
            if conversation.type == "group", let groupID = conversation.groupID {
                return "group:\(groupID)" == identity
            }
            return "dm:\(conversation.id)" == identity
        }) else { return }
        let current = conversations[index]
        let replacement = Conversation(
            type: current.type,
            id: current.id,
            name: current.name,
            avatarURL: current.avatarURL,
            lastMessage: update.lastMessage,
            lastMessageTime: update.lastMessageTime,
            unreadCount: 0,
            subtitle: current.subtitle,
            groupID: current.groupID,
            memberCount: current.memberCount,
            conversationKind: current.conversationKind,
            scriptRoomID: current.scriptRoomID,
            scriptID: current.scriptID,
            agentConversationID: current.agentConversationID,
            agentID: current.agentID,
            agentAvatarAssetID: current.agentAvatarAssetID,
            agentGreetingID: current.agentGreetingID,
            isMuted: current.isMuted
        )
        conversations[index] = replacement
        if let ownerID = currentUserID { store.updateConversation(replacement, ownerID: ownerID) }
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
        let requestedSyncGeneration = AppMessageSyncCoordinator.shared.syncGeneration
        if conversationLoadInFlight {
            queuedForcedReload = queuedForcedReload
                || (forceRefresh && (
                    !activeLoadIsForced
                        || requestedSyncGeneration > activeLoadSyncGeneration
                ))
            return
        }
        conversationLoadInFlight = true
        activeLoadIsForced = forceRefresh
        activeLoadSyncGeneration = requestedSyncGeneration
        let syncGenerationAtStart = requestedSyncGeneration
        defer {
            conversationLoadInFlight = false
            activeLoadIsForced = false
            if queuedForcedReload {
                queuedForcedReload = false
                Task { await loadConversations(forceRefresh: true) }
            }
        }
        loadLocalListState()
        guard let userID = currentUserID else {
            conversations = []
            isShowingCachedData = false
            return
        }
        if let initialCacheLoadTask {
            await initialCacheLoadTask.value
            self.initialCacheLoadTask = nil
        }
        let ownerChanged = (cachedConversationOwnerID != nil && cachedConversationOwnerID != userID)
            || (remoteSnapshotOwnerID != nil && remoteSnapshotOwnerID != userID)
        if ownerChanged {
            conversations = []
            localUnreadFloors.removeAll()
            processedIncomingDMEvents.removeAll()
            processedIncomingGroupEvents.removeAll()
            cachedConversationOwnerID = nil
            remoteSnapshotOwnerID = nil
            lastAcceptedSnapshotRevision = nil
            lastSuccessfulSyncAt = nil
        }
        if lastAcceptedSnapshotRevision == nil {
            lastAcceptedSnapshotRevision = storedSnapshotRevision(ownerID: userID)
        }
        if cachedConversationOwnerID != userID {
            await loadCachedConversations()
        }
        let showBlockingLoader = conversations.isEmpty
        if showBlockingLoader { isLoading = true }
        errorMessage = nil
        defer { isLoading = false }
        do {
            async let agentConversationsRequest = try? APIService.shared.getAgentConversations()
            async let installedAgentsRequest = try? APIService.shared.getInstalledAgents()
            var latestSnapshot: ConversationSyncSnapshot?
            let fetch: () async throws -> [Conversation] = {
                async let fetchedSnapshot = APIService.shared.getConversationSyncSnapshot()
                async let fetchedFriends = APIService.shared.getFriendList()
                let snapshot = try await fetchedSnapshot
                let localChatCount = self.conversations.reduce(into: 0) { count, row in
                    if !row.isAgentConversation { count += 1 }
                }
                guard ConversationSnapshotReplacementPolicy.shouldAccept(
                    snapshot,
                    replacingLocalCount: localChatCount,
                    lastAcceptedRevision: self.lastAcceptedSnapshotRevision
                ) else {
                    throw APIError.invalidResponse
                }
                latestSnapshot = snapshot
                let friendList = (try? await fetchedFriends) ?? self.cachedFriends(for: userID)
                if !friendList.isEmpty {
                    LocalCache.save(friendList, key: FriendCacheKeys.friends(for: userID))
                }
                return self.visibleConversations(
                    from: Self.normalizedGiftPreviews(snapshot.conversations),
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
            guard !Task.isCancelled, currentUserID == userID else { return }
            let offlineSafeChatRows = latestSnapshot?.snapshotComplete != true
                ? Self.preservingLiveChatRows(
                    cachedRows: rawChatConversations,
                    liveRows: conversations
                )
                : rawChatConversations
            let chatConversations = Self.reconciledLivePairRows(
                serverRows: offlineSafeChatRows,
                liveRows: conversations,
                registeredPeerIDs: livePairConversationIDs
            )
            remoteSnapshotOwnerID = userID
            if let latestSnapshot {
                preferenceStore.applyServerSnapshot(latestSnapshot.conversations)
                for conversation in latestSnapshot.conversations {
                    UnreadBadgeStore.shared.applyServerSnapshot(
                        identity: conversation.listIdentity,
                        unreadCount: conversation.unreadCount,
                        revision: conversation.revision,
                        lastMessageID: conversation.lastMessageID,
                        readThroughMessageID: conversation.readThroughMessageID
                    )
                }
            }
            let provisionalSource = Self.preservingLiveAgentRows(
                chatRows: chatConversations,
                liveRows: conversations
            )
            let provisionalRows = applyLocalListState(
                to: reconcileLatestPreviews(
                    provisionalSource,
                    liveConversations: conversations,
                    userID: userID
                )
            )
            if conversations != provisionalRows {
                conversations = provisionalRows
            }
            // nil means the request failed; an empty array means the server
            // successfully confirmed that no rows exist. Keeping that
            // distinction prevents a transient agent API/decoding failure
            // from being interpreted as deletion of every agent card.
            let agentConversations = await agentConversationsRequest
            let installedAgents = await installedAgentsRequest
            guard !Task.isCancelled, currentUserID == userID else { return }
            if let agentConversations {
                AgentChatLocalCache.saveConversations(agentConversations)
            }
            let fetchedAgentConversationRows = agentConversations?.map(Conversation.init(agentConversation:))
            let fetchedInstalledAgentRows = installedAgents?.filter { $0.isOwner != false }
                .map(Conversation.init(createdAgent:))
            let agentRows = Self.reconciledAgentRows(
                liveConversations: conversations,
                fetchedConversationRows: fetchedAgentConversationRows,
                fetchedInstalledRows: fetchedInstalledAgentRows
            )
            let rawServerConvs = chatConversations
                + agentRows
            let resolvedServerConvs = await resolvingScriptRoomAvatars(in: rawServerConvs)
            guard !Task.isCancelled, currentUserID == userID else { return }
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
            for conversation in serverConvs where conversation.isGroup {
                if let groupID = conversation.resolvedGroupID {
                    GroupNotificationSettingsStore.shared.applyMutedSummary(
                        groupID: groupID,
                        isMuted: conversation.isMuted
                    )
                }
            }
            await store.saveConversationsAsync(serverConvs, ownerID: userID)
            guard currentUserID == userID else { return }
            if let revision = latestSnapshot?.revision {
                lastAcceptedSnapshotRevision = revision
                storeSnapshotRevision(revision, ownerID: userID)
            }
            if latestSnapshot != nil {
                isShowingCachedData = false
                lastSuccessfulSyncAt = Date()
            } else {
                isShowingCachedData = true
            }
            AppMessageSyncCoordinator.shared.markSynced(generation: syncGenerationAtStart)
        } catch let error as APIError {
            if conversations.isEmpty {
                errorMessage = error.errorDescription
            } else {
                isShowingCachedData = true
            }
        } catch is CancellationError {
            return
        } catch {
            if conversations.isEmpty {
                errorMessage = L10n.tr("conversation.loadFailed")
            } else {
                isShowingCachedData = true
            }
        }
    }

    /// Makes an accepted one-to-one live connection a real message-list row
    /// immediately. The backend owns the direct conversation; this local seed
    /// bridges the interval before `/chat/conversations` is refreshed and also
    /// keeps an empty, non-friend live conversation from being filtered out.
    func ensureLivePairConversation(for contact: Contact, ownerID ownerIDOverride: String? = nil) {
        let peerID = contact.userID.trimmingCharacters(in: .whitespacesAndNewlines)
        let ownerID = ownerIDOverride ?? currentUserID
        guard let ownerID, !ownerID.isEmpty, !peerID.isEmpty, peerID != ownerID else { return }

        locallyInitiatedDMIDs.insert(peerID)
        livePairConversationIDs.insert(peerID)
        UserDefaults.standard.set(
            Array(livePairConversationIDs),
            forKey: livePairConversationStorageKey(for: ownerID)
        )

        let identity = ConversationReadTarget.direct(userID: peerID).listIdentity
        hiddenConversationSnapshots.removeValue(forKey: identity)
        saveHiddenConversationSnapshots(ownerID: ownerID)

        if let index = conversations.firstIndex(where: { $0.isDM && $0.id == peerID }) {
            let current = conversations[index]
            let resolvedName = contact.nickname.isBlank ? current.name : contact.nickname
            let resolvedAvatarURL = contact.avatarURL.isBlank ? current.avatarURL : contact.avatarURL
            let updated = Conversation(
                type: current.type,
                id: current.id,
                name: resolvedName,
                avatarURL: resolvedAvatarURL,
                lastMessage: current.lastMessage ?? contact.lastMessage,
                lastMessageTime: current.lastMessageTime ?? contact.lastMessageTime,
                unreadCount: max(current.unreadCount, contact.unreadCount),
                subtitle: current.subtitle,
                groupID: current.groupID,
                memberCount: current.memberCount,
                conversationKind: current.conversationKind ?? "live_call",
                scriptRoomID: current.scriptRoomID,
                scriptID: current.scriptID,
                agentConversationID: current.agentConversationID,
                agentID: current.agentID,
                agentAvatarAssetID: current.agentAvatarAssetID,
                agentGreetingID: current.agentGreetingID
            )
            conversations[index] = updated
            store.updateConversation(updated, ownerID: ownerID)
        } else {
            let conversation = Conversation(
                type: "dm",
                id: peerID,
                name: contact.nickname.isBlank ? peerID : contact.nickname,
                avatarURL: contact.avatarURL,
                lastMessage: contact.lastMessage,
                lastMessageTime: contact.lastMessageTime,
                unreadCount: contact.unreadCount,
                subtitle: nil,
                groupID: nil,
                memberCount: nil,
                conversationKind: "live_call"
            )
            conversations.append(conversation)
            store.updateConversation(conversation, ownerID: ownerID)
        }

        saveHiddenConversationSnapshots(ownerID: ownerID)
        conversations = sortConversations(conversations)
    }

    /// Reconciles the two independently loaded agent row sources.
    /// A nil source preserves its live rows because that request failed;
    /// a non-nil empty source removes them because the server answered
    /// successfully with no matching records.
    static func reconciledAgentRows(
        liveConversations: [Conversation],
        fetchedConversationRows: [Conversation]?,
        fetchedInstalledRows: [Conversation]?
    ) -> [Conversation] {
        let liveAgentRows = liveConversations.filter(\.isAgentConversation)
        let liveConversationRows = liveAgentRows.filter(\.isAgentChatThread)
        let liveInstalledRows = liveAgentRows.filter { !$0.isAgentChatThread }

        let conversationRows = fetchedConversationRows ?? liveConversationRows
        let activeAgentIDs: Set<String> = Set(conversationRows.compactMap { row in
            let value = row.agentID?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return value.isEmpty ? nil : value
        })
        let installedRows = (fetchedInstalledRows ?? liveInstalledRows).filter { row in
            guard let agentID = row.agentID, !agentID.isBlank else { return true }
            return !activeAgentIDs.contains(agentID)
        }

        var rowsByIdentity: [String: Conversation] = [:]
        for row in conversationRows + installedRows {
            rowsByIdentity[row.listIdentity] = row
        }
        return Array(rowsByIdentity.values)
    }

    /// Publishing the ordinary chat request before the independent agent
    /// request completes must not temporarily remove agent cards from a list
    /// that was already restored from disk.
    static func preservingLiveAgentRows(
        chatRows: [Conversation],
        liveRows: [Conversation]
    ) -> [Conversation] {
        var result = chatRows
        var identities = Set(chatRows.map(\.listIdentity))
        for row in liveRows where row.isAgentConversation {
            guard identities.insert(row.listIdentity).inserted else { continue }
            result.append(row)
        }
        return result
    }

    /// A cache hit is not an authoritative deletion snapshot. Preserve any
    /// locally restored chat row missing from the secondary API snapshot so an
    /// older or previously poisoned empty cache cannot erase MessageStore.
    static func preservingLiveChatRows(
        cachedRows: [Conversation],
        liveRows: [Conversation]
    ) -> [Conversation] {
        var result = cachedRows.filter { !$0.isAgentConversation }
        var identities = Set(result.map(\.listIdentity))
        for row in liveRows where !row.isAgentConversation {
            guard identities.insert(row.listIdentity).inserted else { continue }
            result.append(row)
        }
        return result
    }

    /// Keeps an accepted live-pair card stable while the conversation endpoint
    /// catches up. Server rows always win; only a missing registered live DM is
    /// filled from the current local snapshot.
    static func reconciledLivePairRows(
        serverRows: [Conversation],
        liveRows: [Conversation],
        registeredPeerIDs: Set<String>
    ) -> [Conversation] {
        var result = serverRows
        var identities = Set(serverRows.map(\.listIdentity))
        for row in liveRows where row.isDM && registeredPeerIDs.contains(row.id) {
            guard identities.insert(row.listIdentity).inserted else { continue }
            result.append(row)
        }
        return result
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
        preferenceStore.isPinned(conversation)
    }

    func togglePinned(_ conversation: Conversation) {
        let next = !preferenceStore.isPinned(conversation)
        let previous = preferenceStore.setPinnedLocally(conversation, isPinned: next)
        if next {
            hiddenConversationSnapshots.removeValue(forKey: conversationKey(conversation))
        }
        saveHiddenConversationSnapshots()
        Task {
            do {
                try await preferenceStore.setPinned(
                    conversation,
                    isPinned: next,
                    optimisticPrevious: previous
                )
            } catch let error as APIError {
                errorMessage = error.errorDescription
            } catch {
                errorMessage = L10n.tr("common.operationFailed")
            }
        }
    }

    func deleteConversation(_ conversation: Conversation) {
        let key = conversationKey(conversation)
        localUnreadFloors.removeValue(forKey: conversation.listIdentity)
        UnreadBadgeStore.shared.setConversationUnreadCount(0, for: conversation.listIdentity)
        hiddenConversationSnapshots[key] = hiddenSnapshot(for: conversation)
        preferenceStore.clearPinnedLocally(conversation)
        saveHiddenConversationSnapshots()
        conversations.removeAll { conversationKey($0) == key }
        if let userID = currentUserID {
            store.saveConversations(conversations, ownerID: userID)
        }
    }

    @discardableResult
    func deleteConversationAndHistory(_ conversation: Conversation) async -> Bool {
        let identity = conversation.listIdentity
        guard !deletingConversationIDs.contains(identity) else { return false }
        deletingConversationIDs.insert(identity)
        defer { deletingConversationIDs.remove(identity) }

        do {
            if conversation.isDM {
                let receipt = try await APIService.shared.clearDirectMessageHistory(
                    contactID: conversation.id
                )
                DirectHistoryClearCoordinator.apply(receipt)
            } else if conversation.isGroup {
                guard let groupID = conversation.resolvedGroupID else {
                    throw APIError.invalidURL
                }
                let receipt = try await APIService.shared.clearGroupMessageHistory(groupID: groupID)
                GroupInfoPreferencesStore.shared.applyHistoryClear(receipt)
            }

            if conversation.isDM || conversation.isGroup,
               AppRemoteConfigStore.shared.featureFlags.isEnabled(
                   "conversation_preferences_v1",
                   default: false
               ) {
                let targetID = conversation.isGroup
                    ? (conversation.resolvedGroupID.map(String.init) ?? conversation.id)
                    : conversation.id
                if let preference = try? await APIService.shared.hideConversation(
                    conversationType: conversation.normalizedType,
                    targetID: targetID
                ) {
                    preferenceStore.apply(preference)
                }
            }

            deleteConversation(conversation)
            return true
        } catch let error as APIError {
            errorMessage = error.errorDescription
            return false
        } catch {
            errorMessage = L10n.tr("common.operationFailed")
            return false
        }
    }

    func logout() async {
        do {
            try await APIService.shared.logout()
        } catch { }
        AuthManager.shared.logout()
    }

    func markAsRead(conversationID: String, throughMessageID: Int? = nil) {
        if throughMessageID == nil {
            applyLocalRead(.direct(userID: conversationID))
        }
        Task {
            do {
                if let receipt = try await APIService.shared.markMessagesAsRead(
                    contactID: conversationID,
                    throughMessageID: throughMessageID
                ), receipt.isMeaningful {
                    UnreadBadgeStore.shared.applyReadReceipt(receipt)
                }
            } catch {
                // Preserve the current projection until a later sync succeeds.
            }
            AppMessageSyncCoordinator.shared.requestSync(.notification)
            PushService.shared.syncBadgeFromUnreadState()
        }
    }

    func markGroupAsRead(groupID: Int, throughMessageID: Int? = nil) {
        if throughMessageID == nil {
            applyLocalRead(.group(groupID: groupID))
        }
        Task {
            do {
                if let receipt = try await APIService.shared.markGroupMessagesAsRead(
                    groupID: groupID,
                    throughMessageID: throughMessageID
                ), receipt.isMeaningful {
                    UnreadBadgeStore.shared.applyReadReceipt(receipt)
                }
            } catch {
                // Preserve the current projection until a later sync succeeds.
            }
            AppMessageSyncCoordinator.shared.requestSync(.notification)
            PushService.shared.syncBadgeFromUnreadState()
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
            Task {
                _ = try? await APIService.shared.markMessagesAsRead(
                    contactID: contactID,
                    throughMessageID: message.id
                )
            }
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
                ? recordIncomingUnread(
                    identity: identity,
                    currentCount: c.unreadCount,
                    messageID: message.id,
                    timestamp: message.timestamp
                )
                : ((isViewingThisChat || isReadThrough) ? 0 : c.unreadCount)
            let updated = Conversation(
                type: "dm", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: lastMsg, lastMessageTime: message.timestamp,
                unreadCount: unreadCount, subtitle: nil,
                groupID: nil, memberCount: nil,
                lastMessageID: max(c.lastMessageID ?? message.id, message.id),
                readThroughMessageID: c.readThroughMessageID,
                revision: c.revision,
                isMuted: c.isMuted
            )
            conversations[index] = updated
            sortKeepingSelfPinned()
            if let userID = currentUserID {
                store.updateConversation(updated, ownerID: userID)
            }
        } else {
            if isFromOther && !isViewingThisChat && !isReadThrough && isNewIncomingEvent {
                _ = recordIncomingUnread(
                    identity: identity,
                    currentCount: nil,
                    messageID: message.id,
                    timestamp: message.timestamp
                )
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

        let myID = AuthManager.shared.currentUser?.userID
        // For self-chat both ids equal myID — the conversation id is myID.
        let contactID = (senderID == myID) ? receiverID : senderID
        let senderName = conversations.first(where: { $0.id == contactID && $0.isDM })?.name
            ?? UserCacheManager.shared.getUser(senderID)?.nickname
        let previewMessage = Self.normalizedGiftPreview(
            lastMessage,
            msgType: lastMessageType,
            senderID: senderID,
            senderName: senderName
        )
        if senderID == myID {
            locallyInitiatedDMIDs.insert(contactID)
        }
        let isFromOther = senderID != myID
        let isViewingThisChat = isFromOther && WebSocketService.shared.activeChatUserID == contactID
        let identity = ConversationReadTarget.direct(userID: contactID).listIdentity
        let serverUnread = Self.intValue(data["unread_count"] ?? data["unread"])
        let messageID = Self.intValue(data["message_id"] ?? data["last_message_id"])
        let revision = Self.intValue(
            data["conversation_revision"] ?? data["revision"]
        ).map(Int64.init)

        if isViewingThisChat {
            recordReadWatermark(.direct(userID: contactID), timestamp: lastMessageTime)
            Task {
                _ = try? await APIService.shared.markMessagesAsRead(
                    contactID: contactID,
                    throughMessageID: messageID
                )
            }
        } else if isFromOther,
                  !hasReadThrough(identity: identity, timestamp: lastMessageTime),
                  let serverUnread,
                  serverUnread > 0 {
            recordObservedUnreadFloor(
                identity: identity,
                count: serverUnread,
                messageID: messageID,
                revision: revision
            )
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
                groupID: nil, memberCount: nil,
                lastMessageID: messageID ?? c.lastMessageID,
                readThroughMessageID: c.readThroughMessageID,
                revision: revision ?? c.revision,
                isMuted: c.isMuted
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
        let mutedIdentities = Set(conversations.compactMap { conversation -> String? in
            guard conversation.isGroup else { return nil }
            if conversation.isMuted {
                return conversation.listIdentity
            }
            guard let groupID = conversation.resolvedGroupID,
                  GroupNotificationSettingsStore.shared.settings(for: groupID).isMuted else {
                return nil
            }
            return conversation.listIdentity
        })
        UnreadBadgeStore.shared.replaceChatUnreadCounts(
            counts,
            mutedIdentities: mutedIdentities
        )
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
            Task {
                _ = try? await APIService.shared.markGroupMessagesAsRead(
                    groupID: message.groupID,
                    throughMessageID: message.id
                )
            }
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
                ? recordIncomingUnread(
                    identity: identity,
                    currentCount: c.unreadCount,
                    messageID: message.id,
                    timestamp: message.timestamp
                )
                : ((isViewingThisGroup || isReadThrough) ? 0 : c.unreadCount)
            let updated = Conversation(
                type: "group", id: c.id, name: c.name, avatarURL: c.avatarURL,
                lastMessage: lastMsg, lastMessageTime: message.timestamp,
                unreadCount: unreadCount,
                subtitle: (isChatMoneyReceipt || message.isRecalled) ? nil : message.senderNickname,
                groupID: c.groupID ?? message.groupID, memberCount: c.memberCount,
                conversationKind: c.conversationKind,
                scriptRoomID: c.scriptRoomID,
                scriptID: c.scriptID,
                lastMessageID: max(c.lastMessageID ?? message.id, message.id),
                readThroughMessageID: c.readThroughMessageID,
                revision: c.revision,
                isMuted: c.isMuted
            )
            conversations[index] = updated
            sortKeepingSelfPinned()
            if let userID = currentUserID {
                store.updateConversation(updated, ownerID: userID)
            }
        } else {
            if isFromOther && !isViewingThisGroup && !isReadThrough && isNewIncomingEvent {
                _ = recordIncomingUnread(
                    identity: identity,
                    currentCount: nil,
                    messageID: message.id,
                    timestamp: message.timestamp
                )
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
        let senderNickname = Self.stringValue(data["sender_nickname"])
        let senderID = Self.stringValue(data["sender_id"])
        let previewMessage = Self.normalizedGiftPreview(
            lastMessage,
            msgType: lastMessageType,
            senderID: senderID,
            senderName: senderNickname
        )
        let isChatMoneyReceipt = ChatMoneyPreview.isReceipt(
            content: lastMessage,
            msgType: lastMessageType
        )

        let myID = AuthManager.shared.currentUser?.userID
        let isFromOther = senderID.map { $0 != myID } ?? false

        let isViewingThisGroup = isFromOther && WebSocketService.shared.activeGroupID == groupID
        let identity = ConversationReadTarget.group(groupID: groupID).listIdentity
        let serverUnread = Self.intValue(data["unread_count"] ?? data["unread"])
        let messageID = Self.intValue(data["message_id"] ?? data["last_message_id"])
        let revision = Self.intValue(
            data["conversation_revision"] ?? data["revision"]
        ).map(Int64.init)

        if isViewingThisGroup {
            recordReadWatermark(.group(groupID: groupID), timestamp: lastMessageTime)
            Task {
                _ = try? await APIService.shared.markGroupMessagesAsRead(
                    groupID: groupID,
                    throughMessageID: messageID
                )
            }
        } else if isFromOther,
                  !hasReadThrough(identity: identity, timestamp: lastMessageTime),
                  let serverUnread,
                  serverUnread > 0 {
            recordObservedUnreadFloor(
                identity: identity,
                count: serverUnread,
                messageID: messageID,
                revision: revision
            )
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
                subtitle: (isChatMoneyReceipt || ChatMessageRecallState.isRecalledPreview(
                    messageType: lastMessageType,
                    content: lastMessage
                )) ? nil : (senderNickname ?? c.subtitle),
                groupID: c.groupID ?? groupID, memberCount: c.memberCount,
                conversationKind: c.conversationKind,
                scriptRoomID: c.scriptRoomID,
                scriptID: c.scriptID,
                lastMessageID: messageID ?? c.lastMessageID,
                readThroughMessageID: c.readThroughMessageID,
                revision: revision ?? c.revision,
                isMuted: c.isMuted
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

    private func snapshotRevisionStorageKey(ownerID: String) -> String {
        "bbchat.conversationList.snapshotRevision.\(ownerID)"
    }

    private func storedSnapshotRevision(ownerID: String) -> Int64? {
        let key = snapshotRevisionStorageKey(ownerID: ownerID)
        guard let raw = UserDefaults.standard.string(forKey: key) else { return nil }
        return Int64(raw)
    }

    private func storeSnapshotRevision(_ revision: Int64, ownerID: String) {
        UserDefaults.standard.set(
            String(revision),
            forKey: snapshotRevisionStorageKey(ownerID: ownerID)
        )
    }

    private var hiddenConversationStorageKey: String {
        "bbchat.conversationList.hidden.\(userScopedListPrefix)"
    }

    private var readWatermarkStorageKey: String {
        "bbchat.conversationList.readWatermarks.\(userScopedListPrefix)"
    }

    private func livePairConversationStorageKey(for ownerID: String) -> String {
        "bbchat.conversationList.livePairConversations.\(ownerID)"
    }

    private func loadLocalListState() {
        preferenceStore.resetForCurrentAccount()
        hiddenConversationSnapshots = UserDefaults.standard.dictionary(forKey: hiddenConversationStorageKey) as? [String: String] ?? [:]
        livePairConversationIDs = Set(
            UserDefaults.standard.stringArray(
                forKey: livePairConversationStorageKey(for: userScopedListPrefix)
            ) ?? []
        )
        readWatermarks = UserDefaults.standard.dictionary(forKey: readWatermarkStorageKey) as? [String: String] ?? [:]
    }

    private func saveHiddenConversationSnapshots() {
        UserDefaults.standard.set(hiddenConversationSnapshots, forKey: hiddenConversationStorageKey)
    }

    private func saveHiddenConversationSnapshots(ownerID: String) {
        UserDefaults.standard.set(
            hiddenConversationSnapshots,
            forKey: "bbchat.conversationList.hidden.\(ownerID)"
        )
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
    private func recordIncomingUnread(
        identity: String,
        currentCount: Int?,
        messageID: Int?,
        timestamp: String?
    ) -> Int {
        let localKnownCount = max(currentCount ?? 0, localUnreadFloors[identity] ?? 0)
        let knownCount = max(
            localKnownCount,
            UnreadBadgeStore.shared.conversationUnreadCount(for: identity) ?? 0
        )
        let fallbackEventID = [
            identity,
            messageID.map(String.init) ?? "",
            timestamp ?? ""
        ].joined(separator: ":")
        let next = UnreadBadgeStore.shared.recordIncomingMessage(
            identity: identity,
            messageID: messageID,
            eventID: fallbackEventID,
            baselineUnreadCount: knownCount
        )
        localUnreadFloors[identity] = next
        return next
    }

    private func recordObservedUnreadFloor(
        identity: String,
        count: Int,
        messageID: Int?,
        revision: Int64?
    ) {
        UnreadBadgeStore.shared.applyServerSnapshot(
            identity: identity,
            unreadCount: count,
            revision: revision,
            lastMessageID: messageID,
            readThroughMessageID: nil
        )
        let localKnownCount = max(count, localUnreadFloors[identity] ?? 0)
        let next = max(
            localKnownCount,
            UnreadBadgeStore.shared.conversationUnreadCount(for: identity) ?? 0
        )
        localUnreadFloors[identity] = next
    }

    private func acknowledgeServerUnreadCounts(_ serverConversations: [Conversation]) {
        for conversation in serverConversations {
            let identity = conversation.listIdentity
            guard let floor = localUnreadFloors[identity] else { continue }
            if conversation.revision != nil || conversation.unreadCount >= floor {
                localUnreadFloors.removeValue(forKey: identity)
            }
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
            if livePairConversationIDs.contains(conversation.id) { return true }
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
                    subtitle: (message.isRecalled || ChatMoneyPreview.isReceipt(
                        content: message.content,
                        msgType: message.msgType
                    )) ? nil : message.senderNickname
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
                        unreadCount: result.revision == nil
                            ? max(result.unreadCount, live.unreadCount)
                            : result.unreadCount,
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
            agentGreetingID: conversation.agentGreetingID,
            lastMessageID: conversation.lastMessageID,
            readThroughMessageID: conversation.readThroughMessageID,
            revision: conversation.revision,
            isMuted: conversation.isMuted
        )
    }

    private func sortConversations(_ source: [Conversation]) -> [Conversation] {
        let myID = AuthManager.shared.currentUser?.userID
        return source.sorted { lhs, rhs in
            let lhsIsSelf = lhs.isDM && lhs.id == myID
            let rhsIsSelf = rhs.isDM && rhs.id == myID
            if lhsIsSelf != rhsIsSelf { return lhsIsSelf }

            let lhsPinned = preferenceStore.isPinned(lhs)
            let rhsPinned = preferenceStore.isPinned(rhs)
            if lhsPinned != rhsPinned { return lhsPinned }

            let timeOrder = Conversation.compareMessageTimes(lhs.lastMessageTime, rhs.lastMessageTime)
            if timeOrder != .orderedSame {
                return timeOrder == .orderedDescending
            }
            return lhs.listIdentity < rhs.listIdentity
        }
    }

    private static func listPreview(for message: Message) -> String {
        if message.isRecalled {
            return ChatMessageRecallState.notice(
                senderID: message.senderID,
                viewerID: AuthManager.shared.currentUser?.userID,
                senderName: UserCacheManager.shared.getUser(message.senderID)?.nickname
            )
        }
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
        if message.isRecalled {
            return ChatMessageRecallState.notice(
                senderID: message.senderID,
                viewerID: AuthManager.shared.currentUser?.userID,
                senderName: message.senderNickname
            )
        }
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
                scriptID: conversation.scriptID,
                agentConversationID: conversation.agentConversationID,
                agentID: conversation.agentID,
                agentAvatarAssetID: conversation.agentAvatarAssetID,
                agentGreetingID: conversation.agentGreetingID,
                lastMessageID: conversation.lastMessageID,
                readThroughMessageID: conversation.readThroughMessageID,
                revision: conversation.revision,
                isMuted: conversation.isMuted
            )
        }
    }

    private static func normalizedGiftPreview(
        _ content: String?,
        msgType: String?,
        senderID: String? = nil,
        senderName: String? = nil
    ) -> String? {
        guard let content else { return nil }
        if ChatMessageRecallState.isRecalledPreview(messageType: msgType, content: content) {
            return ChatMessageRecallState.notice(
                senderID: senderID,
                viewerID: AuthManager.shared.currentUser?.userID,
                senderName: senderName
            )
        }
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
