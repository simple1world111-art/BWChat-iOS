import Combine
import Foundation

extension Notification.Name {
    static let scriptLibraryDidChange = Notification.Name("bbchat.scriptLibraryDidChange")
}

private enum ScriptCacheKeys {
    @MainActor
    static func categories() -> CacheKey? {
        CacheKey.current(namespace: "scripts", key: "categories")
    }

    @MainActor
    static func page(scope: ScriptScope, categoryID: String?) -> CacheKey? {
        CacheKey.current(
            namespace: "scripts",
            // v3 intentionally drops legacy public snapshots that could contain
            // placeholder covers while enabling cache reads for public scripts.
            key: "list-v3:\(scope.rawValue):\(categoryID ?? "all")"
        )
    }
}

@MainActor
final class ScriptCenterViewModel: ObservableObject {
    @Published private(set) var categories: [ScriptCategory] = []
    @Published private(set) var scripts: [InteractiveScript] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var hasMore = false
    @Published var errorMessage: String?
    @Published var scope: ScriptScope = .public
    @Published var selectedCategoryID: String?

    private var nextCursor: String?
    private var hasLoadedInitialState = false

    init() {
        if let key = ScriptCacheKeys.categories(),
           let cached: CachedSnapshot<[ScriptCategory]> = AppCacheRepository.shared.cachedValue(for: key) {
            categories = cached.value
        }
        restoreCachedPage(scope: scope, categoryID: selectedCategoryID, clearWhenMissing: false)
    }

    func loadInitial(force: Bool = false) async {
        guard force || !hasLoadedInitialState else { return }
        hasLoadedInitialState = true
        await load(
            reset: true,
            reloadCategories: true,
            forceRefresh: force
        )
    }

    func selectScope(_ value: ScriptScope) async {
        guard scope != value else { return }
        scope = value
        restoreCachedPage(scope: value, categoryID: selectedCategoryID, clearWhenMissing: true)
        guard !isLoading else { return }
        await load(reset: true, reloadCategories: false, forceRefresh: false)
    }

    func selectCategory(_ id: String?) async {
        guard selectedCategoryID != id else { return }
        selectedCategoryID = id
        restoreCachedPage(scope: scope, categoryID: id, clearWhenMissing: true)
        guard !isLoading else { return }
        await load(reset: true, reloadCategories: false, forceRefresh: false)
    }

    func refresh() async {
        await load(reset: true, reloadCategories: true, forceRefresh: true)
    }

    func handleLibraryChange() async {
        let categoryIDs: [String?] = [nil] + categories.map { Optional($0.id) }
        for targetScope in ScriptScope.allCases {
            for categoryID in categoryIDs {
                if let key = ScriptCacheKeys.page(scope: targetScope, categoryID: categoryID) {
                    AppCacheRepository.shared.invalidate(key)
                }
            }
        }
        await refresh()
    }

    func loadMoreIfNeeded(currentScriptID: String) {
        guard hasMore,
              !isLoading,
              !isLoadingMore,
              scripts.suffix(4).contains(where: { $0.id == currentScriptID }) else { return }
        Task { await load(reset: false, reloadCategories: false, forceRefresh: false) }
    }

    private func load(reset: Bool, reloadCategories: Bool, forceRefresh: Bool) async {
        if reset {
            guard !isLoading else { return }
            isLoading = true
        } else {
            guard !isLoadingMore, hasMore else { return }
            isLoadingMore = true
        }
        errorMessage = nil
        defer {
            isLoading = false
            isLoadingMore = false
        }

        if reloadCategories {
            await loadCategories(forceRefresh: forceRefresh)
        }
        let requestedScope = scope
        let requestedCategoryID = selectedCategoryID

        do {
            let page: ScriptPage
            if reset,
               let key = ScriptCacheKeys.page(scope: requestedScope, categoryID: requestedCategoryID) {
                page = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .scriptCatalog,
                    forceRefresh: forceRefresh
                ) {
                    try await APIService.shared.getScripts(
                        scope: requestedScope,
                        categoryID: requestedCategoryID,
                        cursor: nil
                    )
                }
            } else {
                page = try await APIService.shared.getScripts(
                    scope: requestedScope,
                    categoryID: requestedCategoryID,
                    cursor: reset ? nil : nextCursor
                )
            }
            try Task.checkCancellation()
            guard requestedScope == scope, requestedCategoryID == selectedCategoryID else {
                scheduleLoadForCurrentSelection()
                return
            }
            if reset {
                scripts = page.scripts
            } else {
                let existing = Set(scripts.map(\.id))
                scripts.append(contentsOf: page.scripts.filter { !existing.contains($0.id) })
            }
            hasMore = page.hasMore
            nextCursor = page.nextCursor
            saveCurrentPageToCache()
        } catch is CancellationError {
            return
        } catch {
            guard requestedScope == scope, requestedCategoryID == selectedCategoryID else {
                scheduleLoadForCurrentSelection()
                return
            }
            if scripts.isEmpty || reset { errorMessage = error.localizedDescription }
        }
    }

    private func scheduleLoadForCurrentSelection() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            await self.load(reset: true, reloadCategories: false, forceRefresh: false)
        }
    }

    private func loadCategories(forceRefresh: Bool) async {
        do {
            let loaded: [ScriptCategory]
            if let key = ScriptCacheKeys.categories() {
                loaded = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .catalog,
                    forceRefresh: forceRefresh
                ) {
                    try await APIService.shared.getScriptCategories()
                }
            } else {
                loaded = try await APIService.shared.getScriptCategories()
            }
            try Task.checkCancellation()
            categories = loaded
            if let selectedCategoryID,
               !loaded.contains(where: { $0.id == selectedCategoryID }) {
                self.selectedCategoryID = nil
            }
        } catch is CancellationError {
            return
        } catch {
            if categories.isEmpty { errorMessage = error.localizedDescription }
        }
    }

    private func restoreCachedPage(
        scope: ScriptScope,
        categoryID: String?,
        clearWhenMissing: Bool
    ) {
        guard let key = ScriptCacheKeys.page(scope: scope, categoryID: categoryID),
              let cached: CachedSnapshot<ScriptPage> = AppCacheRepository.shared.cachedValue(for: key),
              Date().timeIntervalSince(cached.expiresAt) <= CachePolicy.scriptCatalog.staleRetention else {
            if clearWhenMissing {
                scripts = []
                hasMore = false
                nextCursor = nil
            }
            return
        }
        scripts = cached.value.scripts
        hasMore = cached.value.hasMore
        nextCursor = cached.value.nextCursor
    }

    private func saveCurrentPageToCache() {
        guard let key = ScriptCacheKeys.page(scope: scope, categoryID: selectedCategoryID) else { return }
        AppCacheRepository.shared.save(
            ScriptPage(scripts: scripts, hasMore: hasMore, nextCursor: nextCursor),
            for: key,
            policy: .scriptCatalog
        )
    }
}

@MainActor
final class ScriptDetailViewModel: ObservableObject {
    @Published private(set) var script: InteractiveScript?
    @Published private(set) var isLoading = false
    @Published private(set) var isWorking = false
    @Published var errorMessage: String?

    let scriptID: String

    init(scriptID: String, initialScript: InteractiveScript? = nil) {
        self.scriptID = scriptID
        self.script = initialScript
    }

    func load(force: Bool = false) async {
        guard force || script == nil else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            script = try await APIService.shared.getScript(scriptID: scriptID)
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setVisibility(_ visibility: ScriptVisibility) async {
        guard let script, script.visibility != visibility, !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            self.script = try await APIService.shared.updateScript(
                scriptID: scriptID,
                body: ["visibility": visibility.rawValue]
            )
            NotificationCenter.default.post(name: .scriptLibraryDidChange, object: self.script)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func createRoom(playerRoleID: String) async -> ScriptRoom? {
        guard !isWorking else { return nil }
        isWorking = true
        defer { isWorking = false }
        do {
            let result = try await APIService.shared.createScriptRoom(
                scriptID: scriptID,
                playerRoleID: playerRoleID,
                idempotencyKey: UUID().uuidString
            )
            ScriptRoomLocalCache.saveRoom(result.room)
            AgentCatalogLocalCache.invalidate()
            NotificationCenter.default.post(name: .conversationListNeedsReload, object: nil)
            return result.room
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func deleteScript() async -> Bool {
        guard !isWorking else { return false }
        isWorking = true
        defer { isWorking = false }
        do {
            try await APIService.shared.deleteScript(scriptID: scriptID)
            NotificationCenter.default.post(name: .scriptLibraryDidChange, object: scriptID)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }
}

struct ScriptEditorValidationError: LocalizedError {
    let messages: [String]

    var errorDescription: String? { messages.joined(separator: "\n") }
}

@MainActor
final class ScriptEditorViewModel: ObservableObject {
    @Published var draft: ScriptDraft
    @Published private(set) var categories: [ScriptCategory] = []
    @Published private(set) var isSaving = false
    @Published private(set) var savedScript: InteractiveScript?
    @Published var errorMessage: String?

    private let originalScript: InteractiveScript?

    init(script: InteractiveScript?) {
        originalScript = script
        savedScript = script
        draft = ScriptDraft(script: script)
    }

    var isEditing: Bool { originalScript != nil }

    func loadCategories() async {
        guard categories.isEmpty else { return }
        do {
            if let key = ScriptCacheKeys.categories() {
                categories = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .catalog,
                    forceRefresh: false
                ) {
                    try await APIService.shared.getScriptCategories()
                }
            } else {
                categories = try await APIService.shared.getScriptCategories()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func save() async -> InteractiveScript? {
        guard !isSaving else { return nil }
        let messages = draft.validationMessages(requiresComplete: draft.visibility == .public)
        guard messages.isEmpty else {
            errorMessage = ScriptEditorValidationError(messages: messages).localizedDescription
            return nil
        }

        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            if let coverData = draft.coverData {
                let asset = try await APIService.shared.uploadScriptAsset(
                    business: .cover,
                    imageData: coverData,
                    filename: "script-cover-\(UUID().uuidString).jpg"
                )
                draft.coverURL = asset.url
                draft.coverData = nil
            }

            for index in draft.roles.indices where draft.roles[index].avatarData != nil {
                guard let data = draft.roles[index].avatarData else { continue }
                let asset = try await APIService.shared.uploadScriptAsset(
                    business: .roleAvatar,
                    imageData: data,
                    filename: "script-role-\(UUID().uuidString).jpg"
                )
                draft.roles[index].avatarURL = asset.url
                draft.roles[index].avatarData = nil
            }

            let result: InteractiveScript
            if let scriptID = originalScript?.scriptID ?? savedScript?.scriptID {
                result = try await APIService.shared.updateScript(
                    scriptID: scriptID,
                    body: draft.requestBody
                )
            } else {
                result = try await APIService.shared.createScript(body: draft.requestBody)
            }
            savedScript = result
            NotificationCenter.default.post(name: .scriptLibraryDidChange, object: result)
            return result
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }
}

@MainActor
final class ScriptRoomViewModel: ObservableObject {
    @Published private(set) var room: ScriptRoom?
    @Published private(set) var messages: [GroupMessage] = []
    @Published private(set) var turnState: ScriptTurnState?
    @Published private(set) var isLoading = false
    @Published private(set) var isSending = false
    @Published private(set) var hasAuthoritativeRoom = false
    @Published var inputText = ""
    @Published var errorMessage: String?

    let roomID: String

    private let store = MessageStore.shared
    private var cancellables = Set<AnyCancellable>()
    private var isVisible = false

    init(roomID: String, initialRoom: ScriptRoom? = nil) {
        self.roomID = roomID
        let cachedRoom = ScriptRoomLocalCache.cachedRoom(roomID: roomID)
        room = initialRoom ?? cachedRoom
        hasAuthoritativeRoom = cachedRoom != nil || initialRoom.map(Self.isCompleteRoom) == true
        if let groupID = room?.groupID {
            messages = store.loadGroupMessages(groupID: groupID, limit: 100)
        }
        observeWebSocket()
    }

    var isGenerating: Bool {
        turnState?.status == .queued || turnState?.status == .generating || isSending
    }

    var canSend: Bool {
        hasAuthoritativeRoom
            && room?.status == .active
            && !isGenerating
            && !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var failedTurnID: String? {
        turnState?.status == .failed ? turnState?.turnID : nil
    }

    func load() async {
        guard !isLoading else { return }
        if room == nil, let cached = ScriptRoomLocalCache.cachedRoom(roomID: roomID) {
            room = cached
            merge(store.loadGroupMessages(groupID: cached.groupID, limit: 100))
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        let roomSnapshot = ScriptRoomLocalCache.cachedSnapshot(roomID: roomID)
        if roomSnapshot == nil || roomSnapshot?.isStale == true {
            do {
                let loadedRoom = try await APIService.shared.getScriptRoom(roomID: roomID)
                try Task.checkCancellation()
                hasAuthoritativeRoom = true
                room = loadedRoom
                ScriptRoomLocalCache.saveRoom(loadedRoom)
            } catch is CancellationError {
                return
            } catch {
                if room == nil {
                    errorMessage = error.localizedDescription
                    return
                }
            }
        }

        guard let room else { return }
        markRoomReadIfVisible()
        await syncMessages(groupID: room.groupID)
    }

    private func syncMessages(groupID: Int) async {
        let cached = await store.loadGroupMessagesAsync(groupID: groupID, limit: 100)
        merge(cached)

        do {
            if var latestID = cached.last?.id ?? messages.last?.id {
                var shouldContinue = true
                while shouldContinue {
                    let (remote, hasMore) = try await APIService.shared.getGroupMessages(
                        groupID: groupID,
                        afterID: latestID,
                        limit: 100
                    )
                    try Task.checkCancellation()
                    let scoped = remote.filter { $0.groupID == groupID }
                    if !scoped.isEmpty {
                        await store.saveGroupMessagesAsync(scoped)
                        merge(scoped)
                    }
                    guard let nextID = scoped.map(\.id).max(), nextID > latestID else {
                        shouldContinue = false
                        continue
                    }
                    latestID = nextID
                    shouldContinue = hasMore
                }
            } else {
                let (remote, _) = try await APIService.shared.getGroupMessages(
                    groupID: groupID,
                    limit: 100
                )
                try Task.checkCancellation()
                let scoped = remote.filter { $0.groupID == groupID }
                await store.saveGroupMessagesAsync(scoped)
                merge(scoped)
            }
        } catch is CancellationError {
            return
        } catch {
            if messages.isEmpty { errorMessage = error.localizedDescription }
        }
    }

    func submit() {
        let content = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty, !isGenerating, room?.status == .active else { return }
        let clientMessageID = UUID().uuidString
        inputText = ""
        isSending = true

        Task {
            defer { isSending = false }
            do {
                let response = try await APIService.shared.submitScriptTurn(
                    roomID: roomID,
                    content: content,
                    clientMessageID: clientMessageID
                )
                if let message = response.userMessage {
                    store.saveGroupMessage(message)
                    merge([message])
                    NotificationCenter.default.post(name: .conversationPreviewDidChange, object: message)
                }
                if let message = response.aiMessage {
                    store.saveGroupMessage(message)
                    merge([message])
                }
                turnState = ScriptTurnState(
                    roomID: roomID,
                    turnID: response.turnID,
                    status: response.status,
                    errorCode: nil,
                    message: nil
                )
            } catch {
                inputText = content
                errorMessage = error.localizedDescription
            }
        }
    }

    func retryFailedTurn() async {
        guard let turnID = failedTurnID, !isSending else { return }
        isSending = true
        defer { isSending = false }
        do {
            let response = try await APIService.shared.retryScriptTurn(roomID: roomID, turnID: turnID)
            turnState = ScriptTurnState(
                roomID: roomID,
                turnID: response.turnID,
                status: response.status,
                errorCode: nil,
                message: nil
            )
            if let message = response.aiMessage {
                store.saveGroupMessage(message)
                merge([message])
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func endRoom() async -> Bool {
        guard room?.status == .active else { return true }
        do {
            try await APIService.shared.endScriptRoom(roomID: roomID)
            if let room {
                self.room = ScriptRoom(
                    roomID: room.roomID,
                    scriptID: room.scriptID,
                    groupID: room.groupID,
                    status: .ended,
                    playerRoleID: room.playerRoleID,
                    assignments: room.assignments,
                    scriptSnapshot: room.scriptSnapshot
                )
                if let endedRoom = self.room {
                    ScriptRoomLocalCache.saveRoom(endedRoom)
                }
            }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func setVisible(_ visible: Bool) {
        isVisible = visible
        if visible {
            markRoomReadIfVisible()
        } else if WebSocketService.shared.activeGroupID == room?.groupID {
            WebSocketService.shared.activeGroupID = nil
        }
    }

    func clearActiveRoom() {
        setVisible(false)
    }

    private func markRoomReadIfVisible() {
        guard isVisible, let groupID = room?.groupID, groupID > 0 else { return }
        WebSocketService.shared.activeGroupID = groupID
        let target = ConversationReadTarget.group(groupID: groupID)
        UnreadBadgeStore.shared.setConversationUnreadCount(0, for: target.listIdentity)
        NotificationCenter.default.post(name: .conversationDidMarkRead, object: target)
        Task {
            _ = try? await APIService.shared.markGroupMessagesAsRead(groupID: groupID)
            await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
        }
    }

    private func observeWebSocket() {
        WebSocketService.shared.groupMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                guard let self, message.groupID == self.room?.groupID else { return }
                self.merge([message])
                if self.isVisible, WebSocketService.shared.activeGroupID == message.groupID {
                    UnreadBadgeStore.shared.setConversationUnreadCount(
                        0,
                        for: ConversationReadTarget.group(groupID: message.groupID).listIdentity
                    )
                    Task {
                        _ = try? await APIService.shared.markGroupMessagesAsRead(
                            groupID: message.groupID,
                            throughMessageID: message.id
                        )
                    }
                }
            }
            .store(in: &cancellables)

        WebSocketService.shared.scriptTurnStatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self, state.roomID == self.roomID else { return }
                self.turnState = state
                if state.status == .failed {
                    self.errorMessage = state.message
                }
            }
            .store(in: &cancellables)
    }

    private func merge(_ incoming: [GroupMessage]) {
        var keyed = Dictionary(uniqueKeysWithValues: messages.map { ($0.id, $0) })
        for message in incoming {
            keyed[message.id] = message
        }
        messages = keyed.values.sorted { lhs, rhs in
            if lhs.id != rhs.id { return lhs.id < rhs.id }
            return lhs.timestamp < rhs.timestamp
        }
    }

    private static func isCompleteRoom(_ room: ScriptRoom) -> Bool {
        !room.playerRoleID.isBlank
            || !room.assignments.isEmpty
            || !room.scriptSnapshot.roles.isEmpty
    }
}

extension ScriptTurnState {
    init(
        roomID: String,
        turnID: String,
        status: ScriptTurnStatus,
        errorCode: String?,
        message: String?
    ) {
        self.roomID = roomID
        self.turnID = turnID
        self.status = status
        self.errorCode = errorCode
        self.message = message
    }
}
