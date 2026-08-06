// BWChat/ViewModels/AgentCatalogViewModel.swift

import Foundation

@MainActor
final class AgentCatalogViewModel: ObservableObject {
    @Published private(set) var runtimeConfig: AgentRuntimeConfig?
    @Published private(set) var installedAgents: [AgentSummary] = []
    @Published private(set) var conversations: [AgentConversation] = []
    @Published private(set) var joinedScriptRooms: [Conversation] = []
    @Published private(set) var spendableBalance: Int?
    @Published private(set) var isLoading = false
    @Published private(set) var hasLoadedContent = false
    @Published private(set) var removingAgentIDs: Set<String> = []
    @Published private(set) var openingAgentIDs: Set<String> = []
    @Published var errorMessage: String?

    private var conversationIdempotencyKeys: [String: UUID] = [:]
    private var lastRuntimeConfigLoadDate: Date?

    func load(forceRefresh: Bool = false) async {
        if isLoading { return }

        let cached = AgentCatalogLocalCache.cachedSnapshot()
        if let cached {
            apply(cached.value)
            lastRuntimeConfigLoadDate = cached.updatedAt
            if !cached.isStale && !forceRefresh { return }
        }

        isLoading = true
        errorMessage = nil
        defer {
            isLoading = false
            hasLoadedContent = true
        }

        async let runtimeResult = capture { try await APIService.shared.getAgentRuntimeConfig() }
        async let installedResult = capture { try await APIService.shared.getInstalledAgents() }
        async let conversationsResult = capture { try await APIService.shared.getAgentConversations() }
        async let joinedScriptsResult = capture {
            try await APIService.shared.getConversationSyncSnapshot().conversations
        }
        async let walletResult = capture { try await APIService.shared.getWalletBalance() }

        let (runtime, installed, conversationList, joinedScripts, wallet) = await (
            runtimeResult,
            installedResult,
            conversationsResult,
            joinedScriptsResult,
            walletResult
        )

        apply(runtime) { config in
            runtimeConfig = config
            lastRuntimeConfigLoadDate = Date()
        }
        apply(installed) { installedAgents = $0 }
        apply(conversationList) { conversations = $0.sorted { $0.updatedAt > $1.updatedAt } }
        apply(joinedScripts) { joinedScriptRooms = JoinedScriptRoomResolver.rows(from: $0) }
        apply(wallet) { spendableBalance = $0.spendableBalance }

        let errors = [
            runtime.failure,
            installed.failure,
            conversationList.failure,
            joinedScripts.failure,
            wallet.failure
        ]
            .compactMap { $0 }
        if let first = errors.first { errorMessage = message(for: first) }

        let receivedRemoteValue = runtime.failure == nil
            || installed.failure == nil
            || conversationList.failure == nil
            || joinedScripts.failure == nil
            || wallet.failure == nil
        if receivedRemoteValue { persistSnapshot() }
    }

    func refreshRuntimeConfigIfStale() async {
        guard lastRuntimeConfigLoadDate.map({ Date().timeIntervalSince($0) >= 5 * 60 }) ?? true else { return }
        do {
            runtimeConfig = try await APIService.shared.getAgentRuntimeConfig()
            lastRuntimeConfigLoadDate = Date()
            persistSnapshot()
        } catch {
            errorMessage = message(for: error)
        }
    }

    func uninstall(_ agent: AgentSummary) async {
        guard !removingAgentIDs.contains(agent.id) else { return }
        removingAgentIDs.insert(agent.id)
        defer { removingAgentIDs.remove(agent.id) }
        do {
            try await APIService.shared.uninstallAgent(id: agent.id)
            installedAgents.removeAll { $0.id == agent.id }
            persistSnapshot()
        } catch {
            errorMessage = message(for: error)
        }
    }

    func conversation(for agent: AgentSummary) async -> AgentConversation? {
        if let existing = conversations
            .filter({ $0.agentID == agent.id && $0.status != "closed" })
            .sorted(by: { $0.updatedAt > $1.updatedAt })
            .first {
            return existing
        }

        guard !openingAgentIDs.contains(agent.id) else { return nil }
        openingAgentIDs.insert(agent.id)
        defer { openingAgentIDs.remove(agent.id) }
        let key = conversationIdempotencyKeys[agent.id] ?? UUID()
        conversationIdempotencyKeys[agent.id] = key

        do {
            let greetingID = agent.greetings?.first?.id ?? "default"
            let conversation = try await APIService.shared.createAgentConversation(
                agentID: agent.id,
                greetingID: greetingID,
                idempotencyKey: key
            )
            conversationIdempotencyKeys.removeValue(forKey: agent.id)
            conversations.removeAll { $0.id == conversation.id }
            conversations.insert(conversation, at: 0)
            persistSnapshot()
            NotificationCenter.default.post(name: .conversationListNeedsReload, object: nil)
            return conversation
        } catch {
            errorMessage = message(for: error)
            await refreshRuntimeConfigAfterCapabilityError(error)
            return nil
        }
    }

    func updateSpendableBalance(_ balance: Int) {
        spendableBalance = balance
        persistSnapshot()
    }

    func upsertInstalled(_ agent: AgentSummary) {
        installedAgents.removeAll { $0.id == agent.id }
        installedAgents.append(agent)
        persistSnapshot()
    }

    private func apply(_ snapshot: CachedAgentCatalogSnapshot) {
        runtimeConfig = snapshot.runtimeConfig
        installedAgents = snapshot.installedAgents
        conversations = snapshot.conversations.sorted { $0.updatedAt > $1.updatedAt }
        joinedScriptRooms = JoinedScriptRoomResolver.rows(from: snapshot.joinedScriptRooms)
        spendableBalance = snapshot.spendableBalance
        hasLoadedContent = true
    }

    private func persistSnapshot() {
        AgentCatalogLocalCache.save(CachedAgentCatalogSnapshot(
            runtimeConfig: runtimeConfig,
            installedAgents: installedAgents,
            conversations: conversations,
            joinedScriptRooms: joinedScriptRooms,
            spendableBalance: spendableBalance
        ))
    }

    private func refreshRuntimeConfigAfterCapabilityError(_ error: Error) async {
        guard case APIError.serverError(let code, _) = error,
              (6000...6399).contains(code) else { return }
        lastRuntimeConfigLoadDate = nil
        await refreshRuntimeConfigIfStale()
    }

    private func capture<T>(_ operation: () async throws -> T) async -> Result<T, Error> {
        do { return .success(try await operation()) }
        catch { return .failure(error) }
    }

    private func apply<T>(_ result: Result<T, Error>, success: (T) -> Void) {
        if case .success(let value) = result { success(value) }
    }

    private func message(for error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}

enum JoinedScriptRoomResolver {
    static func rows(from conversations: [Conversation]) -> [Conversation] {
        var latestByRoomID: [String: Conversation] = [:]

        for conversation in conversations where conversation.isScriptRoom {
            guard let roomID = conversation.scriptRoomID, !roomID.isBlank else { continue }
            guard let existing = latestByRoomID[roomID] else {
                latestByRoomID[roomID] = conversation
                continue
            }
            if Conversation.compareMessageTimes(
                conversation.lastMessageTime,
                existing.lastMessageTime
            ) == .orderedDescending {
                latestByRoomID[roomID] = conversation
            }
        }

        return latestByRoomID.values.sorted { lhs, rhs in
            let ordering = Conversation.compareMessageTimes(lhs.lastMessageTime, rhs.lastMessageTime)
            if ordering != .orderedSame { return ordering == .orderedDescending }
            return lhs.listIdentity < rhs.listIdentity
        }
    }
}

private extension Result where Failure == Error {
    var failure: Error? {
        guard case .failure(let error) = self else { return nil }
        return error
    }
}
