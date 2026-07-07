// BWChat/Models/BotConfig.swift
// Bot (智能体) config + local persistence store.

import Foundation
import SwiftUI

struct BotConfig: Codable, Identifiable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    var emoji: String             // single-emoji avatar
    var avatarURL: String = ""
    var characterBackground: String = ""
    var gender: String = Self.defaultGender
    var openingLine: String = ""
    var temperature: Double = 0.8
    var maxTokens: Int = 400
    var topP: Double = 0.9
    var enableThinking: Bool = false
    var isPublic: Bool = false
    var sourceBotID: String = ""
    var originBotID: String = ""
    var createdAt: Date = Date()
    var promptUpdatedAt: Date = Date()

    static let defaultGender = "female"

    static func normalizedGender(_ value: String) -> String {
        let gender = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        switch gender {
        case "male", "man", "m", "\u{7537}":
            return "male"
        default:
            return defaultGender
        }
    }

    static let defaultBot = BotConfig(
        id: "bot-default-girlfriend",
        name: L10n.tr("bot.label"),
        emoji: "🤖",
        avatarURL: "",
        characterBackground: "",
        temperature: 0.8,
        maxTokens: 400,
        topP: 0.9,
        enableThinking: false,
        createdAt: Date(),
        promptUpdatedAt: Date()
    )
}

extension BotConfig {
    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case emoji
        case avatarURL = "avatar_url"
        case characterBackground
        case gender
        case openingLine
        case temperature
        case maxTokens
        case topP
        case enableThinking
        case isPublic
        case sourceBotID = "source_bot_id"
        case originBotID = "origin_bot_id"
        case createdAt
        case promptUpdatedAt
    }

    private enum DecodingKeys: String, CodingKey {
        case id
        case botID = "bot_id"
        case name
        case displayName = "display_name"
        case emoji
        case avatarURL = "avatar_url"
        case legacyPersona = "persona"
        case characterBackground
        case characterBackgroundSnake = "character_background"
        case gender
        case openingLine
        case openingLineSnake = "opening_line"
        case temperature
        case maxTokens
        case maxTokensSnake = "max_tokens"
        case topP
        case topPSnake = "top_p"
        case enableThinking
        case enableThinkingSnake = "enable_thinking"
        case isPublic
        case isPublicSnake = "is_public"
        case sourceBotID = "source_bot_id"
        case sourceBotIDCamel = "sourceBotID"
        case originBotID = "origin_bot_id"
        case originBotIDCamel = "originBotID"
        case createdAt
        case createdAtSnake = "created_at"
        case promptUpdatedAt
        case promptUpdatedAtSnake = "prompt_updated_at"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DecodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id)
            ?? container.decodeIfPresent(String.self, forKey: .botID)
            ?? UUID().uuidString
        name = try container.decodeIfPresent(String.self, forKey: .name)
            ?? container.decodeIfPresent(String.self, forKey: .displayName)
            ?? L10n.tr("bot.label")
        emoji = try container.decodeIfPresent(String.self, forKey: .emoji) ?? "🤖"
        avatarURL = try container.decodeIfPresent(String.self, forKey: .avatarURL) ?? ""
        let decodedBackground = try container.decodeIfPresent(
            String.self,
            forKey: .characterBackground
        ) ?? container.decodeIfPresent(String.self, forKey: .characterBackgroundSnake) ?? ""
        let legacyPersona = try container.decodeIfPresent(String.self, forKey: .legacyPersona) ?? ""
        characterBackground = decodedBackground
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty ? legacyPersona : decodedBackground
        gender = Self.normalizedGender(
            try container.decodeIfPresent(String.self, forKey: .gender) ?? Self.defaultGender
        )
        openingLine = try container.decodeIfPresent(
            String.self,
            forKey: .openingLine
        ) ?? container.decodeIfPresent(String.self, forKey: .openingLineSnake) ?? ""
        temperature = try container.decodeIfPresent(Double.self, forKey: .temperature) ?? 0.8
        maxTokens = try container.decodeIfPresent(Int.self, forKey: .maxTokens)
            ?? container.decodeIfPresent(Int.self, forKey: .maxTokensSnake)
            ?? 400
        topP = try container.decodeIfPresent(Double.self, forKey: .topP)
            ?? container.decodeIfPresent(Double.self, forKey: .topPSnake)
            ?? 0.9
        enableThinking = try container.decodeIfPresent(Bool.self, forKey: .enableThinking)
            ?? container.decodeIfPresent(Bool.self, forKey: .enableThinkingSnake)
            ?? false
        isPublic = try container.decodeIfPresent(Bool.self, forKey: .isPublic)
            ?? container.decodeIfPresent(Bool.self, forKey: .isPublicSnake)
            ?? false
        sourceBotID = try container.decodeIfPresent(String.self, forKey: .sourceBotID)
            ?? container.decodeIfPresent(String.self, forKey: .sourceBotIDCamel)
            ?? ""
        originBotID = try container.decodeIfPresent(String.self, forKey: .originBotID)
            ?? container.decodeIfPresent(String.self, forKey: .originBotIDCamel)
            ?? ""
        createdAt = (try? container.decodeIfPresent(Date.self, forKey: .createdAt))
            ?? (try? container.decodeIfPresent(Date.self, forKey: .createdAtSnake))
            ?? Date()
        promptUpdatedAt = (try? container.decodeIfPresent(Date.self, forKey: .promptUpdatedAt))
            ?? (try? container.decodeIfPresent(Date.self, forKey: .promptUpdatedAtSnake))
            ?? Date()
    }
}

// MARK: - Local chat history per bot

struct BotChatMessage: Codable, Identifiable, Equatable {
    var id: String = UUID().uuidString
    let role: String               // "user" | "assistant"
    var content: String
    let timestamp: Date
}

// MARK: - Persistent store

@MainActor
final class BotStore: ObservableObject {
    static let shared = BotStore()

    @Published private(set) var bots: [BotConfig] = []
    @Published private(set) var conversationBots: [BotConfig] = []
    @Published private(set) var lastMessagesByBotID: [String: BotChatMessage] = [:]

    private let botsKey = "bbchat.bots.v1"
    private let botAliasesKey = "bbchat.bot_aliases.v1"
    private let botSourceIDsKey = "bbchat.bot_source_ids.v1"
    private let pinnedBotListKeyPrefix = "bbchat.bot_list.pinned.v1"
    private let hiddenBotListKeyPrefix = "bbchat.bot_list.hidden.v1"
    private var serverBotIDs: Set<String> = []
    private var botIDAliases: [String: String] = [:]
    private var sourceBotIDsByBotID: [String: String] = [:]
    private var pinnedBotIDs: Set<String> = []
    private var hiddenBotIDs: Set<String> = []
    private var loadedListStateUserID: String?

    private func msgsKey(_ botID: String) -> String { "bbchat.bot_messages.v1.\(botID)" }

    init() {
        loadAliases()
        loadSourceIDs()
        loadConversationListState()
        loadBots()
        if bots.isEmpty {
            bots = [BotConfig.defaultBot]
            persistBots()
        }
        rebuildLastMessageCache()
    }

    // Bots

    private func loadBots() {
        guard let data = UserDefaults.standard.data(forKey: botsKey),
              let list = try? JSONDecoder().decode([BotConfig].self, from: data)
        else { return }
        let migrated = list.map { bot in
            var migrated = bot
            migrated.gender = BotConfig.normalizedGender(migrated.gender)
            if migrated.id == BotConfig.defaultBot.id {
                if migrated.name == "\u{5973}\u{53CB}" { migrated.name = BotConfig.defaultBot.name }
                if migrated.emoji == "💕" { migrated.emoji = BotConfig.defaultBot.emoji }
            }
            return migrated
        }
        bots = migrated
        persistBots()
    }

    private func loadAliases() {
        guard let data = UserDefaults.standard.data(forKey: botAliasesKey),
              let aliases = try? JSONDecoder().decode([String: String].self, from: data)
        else { return }
        botIDAliases = aliases
    }

    private func loadSourceIDs() {
        guard let data = UserDefaults.standard.data(forKey: botSourceIDsKey),
              let sourceIDs = try? JSONDecoder().decode([String: String].self, from: data)
        else { return }
        sourceBotIDsByBotID = sourceIDs
    }

    private func persistAliases() {
        if let data = try? JSONEncoder().encode(botIDAliases) {
            UserDefaults.standard.set(data, forKey: botAliasesKey)
        }
    }

    private func persistSourceIDs() {
        if let data = try? JSONEncoder().encode(sourceBotIDsByBotID) {
            UserDefaults.standard.set(data, forKey: botSourceIDsKey)
        }
    }

    private func persistBots() {
        if let data = try? JSONEncoder().encode(bots) {
            UserDefaults.standard.set(data, forKey: botsKey)
        }
    }

    func syncServerBots() async {
        loadConversationListState()
        guard AuthManager.shared.token != nil else { return }
        do {
            let serverBots = try await APIService.shared.getChatbotBots()
            mergeServerBots(serverBots)
        } catch {
            print("[BotStore] sync server bots failed: \(error)")
        }
    }

    func saveToServerAndStore(_ bot: BotConfig) async throws -> BotConfig {
        var localBot = preparedBot(bot)
        guard AuthManager.shared.token != nil else {
            addOrUpdate(localBot)
            ensureOpeningLineMessage(for: localBot)
            return localBot
        }

        await syncServerBots()

        let originalID = localBot.id
        if let serverID = knownServerID(for: originalID) {
            localBot.id = serverID
            let serverBot = try await APIService.shared.updateChatbotBot(localBot)
            let saved = mergedServerBot(serverBot, preserving: localBot)
            upsertSyncedBot(saved, replacing: originalID)
            ensureOpeningLineMessage(for: saved)
            return saved
        }

        let serverBot = try await APIService.shared.createChatbotBot(localBot)
        let saved = mergedServerBot(serverBot, preserving: localBot)
        upsertSyncedBot(saved, replacing: originalID)
        ensureOpeningLineMessage(for: saved)
        return saved
    }

    func saveSharedCopyToServerAndStore(_ bot: BotConfig) async throws -> BotConfig {
        let draftID = bot.id
        let sourceID = firstNonBlank(bot.sourceBotID, bot.originBotID, draftID)
        var importedBot = bot
        importedBot.sourceBotID = sourceID
        importedBot.originBotID = firstNonBlank(bot.originBotID, sourceID)
        let saved = try await saveToServerAndStore(importedBot)
        registerSharedSourceID(sourceID, for: saved.id)
        ensureOpeningLineMessage(for: saved)
        return saved
    }

    func ensureServerBotID(for botID: String) async throws -> String {
        if let id = await resolveServerBotID(for: botID) {
            return id
        }
        guard let bot = bot(for: botID) else {
            throw APIError.serverError(code: 2001, message: L10n.tr("bot.currentNotFound"))
        }
        let saved = try await saveToServerAndStore(bot)
        return saved.id
    }

    func deleteFromServerAndStore(_ botID: String) async throws {
        let serverID = await resolveServerBotID(for: botID)
        guard let serverID else {
            removeVisibleBotLocally(botID, preserveMessages: true)
            await syncServerBots()
            return
        }

        do {
            try await APIService.shared.deleteChatbotBot(botID: serverID)
        } catch let error as APIError where Self.isAlreadyRemovedError(error) {
            removeVisibleBotLocally(botID, resolvedID: serverID, preserveMessages: true)
            await syncServerBots()
            return
        } catch {
            throw error
        }

        removeVisibleBotLocally(botID, resolvedID: serverID, preserveMessages: true)
        await syncServerBots()
    }

    func isVisibleBotImported(from sourceBotID: String) -> Bool {
        botImported(from: sourceBotID) != nil
    }

    func isBotPinned(_ bot: BotConfig) -> Bool {
        return pinnedBotIDs.contains(botListID(bot.id))
    }

    func toggleBotPinned(_ bot: BotConfig) {
        loadConversationListState()
        let targetID = botListID(bot.id)
        if pinnedBotIDs.contains(targetID) {
            pinnedBotIDs.remove(targetID)
        } else {
            pinnedBotIDs.insert(targetID)
            hiddenBotIDs.remove(targetID)
        }
        saveConversationListState()
        rebuildConversationBots()
    }

    func hideBotConversation(_ bot: BotConfig) {
        loadConversationListState()
        let targetID = botListID(bot.id)
        hiddenBotIDs.insert(targetID)
        pinnedBotIDs.remove(targetID)
        saveConversationListState()
        rebuildConversationBots()
    }

    func bot(for botID: String) -> BotConfig? {
        if let bot = bots.first(where: { $0.id == botID }) {
            return bot
        }
        if let alias = botIDAliases[botID] {
            return bots.first(where: { $0.id == alias })
        }
        return nil
    }

    func botImported(from sourceBotID: String) -> BotConfig? {
        let sourceID = sourceBotID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sourceID.isEmpty else { return nil }
        if let bot = bot(for: sourceID) {
            return bot
        }
        if let importedID = sourceBotIDsByBotID.first(where: { $0.value == sourceID })?.key {
            return bot(for: importedID)
        }
        return nil
    }

    func shareSourceID(for botID: String) -> String {
        let targetID = botIDAliases[botID] ?? botID
        if let sourceID = sourceBotIDsByBotID[targetID], !sourceID.isBlank {
            return sourceID
        }
        if let sourceID = botIDAliases.first(where: { $0.value == targetID })?.key, !sourceID.isBlank {
            return sourceID
        }
        return targetID
    }

    func registerSharedSourceID(_ sourceBotID: String, for botID: String) {
        let sourceID = sourceBotID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sourceID.isEmpty else { return }
        let targetID = botIDAliases[botID] ?? botID
        guard bot(for: targetID) != nil else { return }

        if sourceID != targetID {
            botIDAliases[sourceID] = targetID
        }
        sourceBotIDsByBotID[targetID] = sourceID
        normalizeConversationListStateIDs()
        persistAliases()
        persistSourceIDs()
    }

    func resolveServerBotID(for botID: String) async -> String? {
        if serverBotIDs.contains(botID) {
            return botID
        }
        if let alias = botIDAliases[botID], serverBotIDs.contains(alias) {
            return alias
        }

        await syncServerBots()

        if serverBotIDs.contains(botID) {
            return botID
        }
        if let alias = botIDAliases[botID], serverBotIDs.contains(alias) {
            return alias
        }
        return nil
    }

    private func knownServerID(for botID: String) -> String? {
        if serverBotIDs.contains(botID) {
            return botID
        }
        if let alias = botIDAliases[botID], serverBotIDs.contains(alias) {
            return alias
        }
        return nil
    }

    private func mergeServerBots(_ serverBots: [BotConfig]) {
        let incomingServerIDs = Set(serverBots.map(\.id))
        let removedServerIDs = serverBotIDs.subtracting(incomingServerIDs)
        serverBotIDs = incomingServerIDs
        var next = bots
        var changed = false

        if !removedServerIDs.isEmpty {
            next.removeAll { bot in
                removedServerIDs.contains(botListID(bot.id))
                    || removedServerIDs.contains(bot.id)
            }
            pinnedBotIDs.subtract(removedServerIDs)
            hiddenBotIDs.subtract(removedServerIDs)
            botIDAliases = botIDAliases.filter { _, value in
                !removedServerIDs.contains(value)
            }
            sourceBotIDsByBotID = sourceBotIDsByBotID.filter { key, _ in
                !removedServerIDs.contains(key)
            }
            for id in removedServerIDs {
                removeCachedLastMessage(for: id)
            }
            changed = true
        }

        for serverBot in serverBots {
            if let idx = next.firstIndex(where: { $0.id == serverBot.id }) {
                next[idx] = mergedServerBot(serverBot, preserving: next[idx])
                changed = true
                continue
            }

            if let idx = next.firstIndex(where: {
                !serverBotIDs.contains($0.id)
                    && normalizedName($0.name) == normalizedName(serverBot.name)
            }) {
                let localBot = next[idx]
                next[idx] = mergedServerBot(serverBot, preserving: localBot)
                botIDAliases[localBot.id] = serverBot.id
                if let sourceID = sourceBotIDsByBotID.removeValue(forKey: localBot.id) {
                    sourceBotIDsByBotID[serverBot.id] = sourceID
                }
                migrateMessages(from: localBot.id, to: serverBot.id)
                changed = true
                continue
            }

            next.append(serverBot)
            changed = true
        }

        if changed {
            bots = next
            normalizeConversationListStateIDs()
            rebuildLastMessageCache()
            saveConversationListState()
            persistBots()
            persistAliases()
            persistSourceIDs()
        }
    }

    private func upsertSyncedBot(_ bot: BotConfig, replacing oldID: String) {
        var next = bots
        let newID = bot.id

        if oldID != newID {
            botIDAliases[oldID] = newID
            let aliasesPointingToOldID = botIDAliases
                .filter { $0.value == oldID }
                .map(\.key)
            for aliasID in aliasesPointingToOldID {
                botIDAliases[aliasID] = newID
            }
            if let sourceID = sourceBotIDsByBotID.removeValue(forKey: oldID) {
                sourceBotIDsByBotID[newID] = sourceID
            }
            migrateMessages(from: oldID, to: newID)
            next.removeAll { $0.id == oldID }
        }

        serverBotIDs.insert(newID)
        if let idx = next.firstIndex(where: { $0.id == newID }) {
            next[idx] = bot
        } else {
            next.insert(bot, at: 0)
        }
        bots = next
        normalizeConversationListStateIDs()
        rebuildLastMessageCache()
        persistBots()
        persistAliases()
        persistSourceIDs()
    }

    private func mergedServerBot(_ serverBot: BotConfig, preserving localBot: BotConfig) -> BotConfig {
        var merged = serverBot
        merged.name = localBot.name.isEmpty ? serverBot.name : localBot.name
        merged.emoji = localBot.emoji.isEmpty ? serverBot.emoji : localBot.emoji
        merged.characterBackground = localBot.characterBackground
        merged.gender = BotConfig.normalizedGender(localBot.gender)
        merged.openingLine = localBot.openingLine
        merged.temperature = localBot.temperature
        merged.maxTokens = localBot.maxTokens
        merged.topP = localBot.topP
        merged.enableThinking = localBot.enableThinking
        merged.isPublic = localBot.isPublic
        merged.sourceBotID = firstNonBlank(
            serverBot.sourceBotID,
            localBot.sourceBotID,
            sourceBotIDsByBotID[localBot.id],
            sourceBotIDsByBotID[serverBot.id]
        )
        merged.originBotID = firstNonBlank(
            serverBot.originBotID,
            localBot.originBotID,
            merged.sourceBotID
        )
        merged.createdAt = localBot.createdAt
        merged.promptUpdatedAt = localBot.promptUpdatedAt
        if serverBot.avatarURL.isEmpty {
            merged.avatarURL = localBot.avatarURL
        }
        return merged
    }

    private func preparedBot(_ bot: BotConfig) -> BotConfig {
        var prepared = bot
        prepared.name = prepared.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if prepared.name.isEmpty { prepared.name = L10n.tr("bot.label") }
        prepared.emoji = prepared.emoji.trimmingCharacters(in: .whitespacesAndNewlines)
        if prepared.emoji.isEmpty { prepared.emoji = "🤖" }
        prepared.characterBackground = prepared.characterBackground
            .trimmingCharacters(in: .whitespacesAndNewlines)
        prepared.gender = BotConfig.normalizedGender(prepared.gender)
        prepared.openingLine = prepared.openingLine
            .trimmingCharacters(in: .whitespacesAndNewlines)
        prepared.sourceBotID = prepared.sourceBotID
            .trimmingCharacters(in: .whitespacesAndNewlines)
        prepared.originBotID = prepared.originBotID
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return prepared
    }

    private func firstNonBlank(_ values: String?...) -> String {
        for value in values {
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !trimmed.isEmpty {
                return trimmed
            }
        }
        return ""
    }

    private static func isAlreadyRemovedError(_ error: APIError) -> Bool {
        guard case .serverError(let code, _) = error else { return false }
        return code == 404
    }

    private func normalizedName(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private func migrateMessages(from oldID: String, to newID: String) {
        guard oldID != newID,
              UserDefaults.standard.object(forKey: msgsKey(oldID)) != nil
        else { return }
        if UserDefaults.standard.object(forKey: msgsKey(newID)) == nil,
           let oldData = UserDefaults.standard.data(forKey: msgsKey(oldID)) {
            UserDefaults.standard.set(oldData, forKey: msgsKey(newID))
        }
        UserDefaults.standard.removeObject(forKey: msgsKey(oldID))
    }

    func addOrUpdate(_ bot: BotConfig) {
        loadConversationListState()
        var next = bot
        let targetID = botIDAliases[bot.id] ?? bot.id
        next.id = targetID

        if let idx = bots.firstIndex(where: { $0.id == targetID }) {
            let current = bots[idx]
            if current.characterBackground != bot.characterBackground
                || current.gender != bot.gender
                || current.openingLine != bot.openingLine {
                next.promptUpdatedAt = Date()
            }
            bots[idx] = next
        } else {
            next.promptUpdatedAt = Date()
            bots.insert(next, at: 0)
        }
        hiddenBotIDs.remove(targetID)
        saveConversationListState()
        rebuildConversationBots()
        persistBots()
    }

    func delete(_ botID: String) {
        loadConversationListState()
        let targetID = botIDAliases[botID] ?? botID
        bots.removeAll { $0.id == targetID }
        serverBotIDs.remove(targetID)
        pinnedBotIDs.remove(targetID)
        hiddenBotIDs.remove(targetID)
        saveConversationListState()
        rebuildConversationBots()
        persistBots()
        UserDefaults.standard.removeObject(forKey: msgsKey(targetID))
        removeCachedLastMessage(for: targetID)
        botIDAliases.removeValue(forKey: botID)
        botIDAliases = botIDAliases.filter { $0.value != targetID }
        sourceBotIDsByBotID.removeValue(forKey: targetID)
        sourceBotIDsByBotID.removeValue(forKey: botID)
        persistAliases()
        persistSourceIDs()
        if targetID != botID {
            UserDefaults.standard.removeObject(forKey: msgsKey(botID))
            removeCachedLastMessage(for: botID)
        }
    }

    private func removeVisibleBotLocally(
        _ botID: String,
        resolvedID: String? = nil,
        preserveMessages: Bool
    ) {
        loadConversationListState()
        let targetID = resolvedID ?? botIDAliases[botID] ?? botID
        let aliasesToTarget = botIDAliases
            .filter { $0.value == targetID || $0.key == botID || $0.value == botID }
            .map(\.key)
        let idsToRemove = Set([botID, targetID] + aliasesToTarget)

        bots.removeAll { bot in
            idsToRemove.contains(bot.id) || idsToRemove.contains(botIDAliases[bot.id] ?? "")
        }
        serverBotIDs.subtract(idsToRemove)
        pinnedBotIDs.subtract(idsToRemove)
        hiddenBotIDs.subtract(idsToRemove)
        botIDAliases = botIDAliases.filter { key, value in
            !idsToRemove.contains(key) && !idsToRemove.contains(value)
        }
        sourceBotIDsByBotID = sourceBotIDsByBotID.filter { key, _ in
            !idsToRemove.contains(key)
        }

        saveConversationListState()
        persistBots()
        persistAliases()
        persistSourceIDs()

        for id in idsToRemove {
            removeCachedLastMessage(for: id)
            if !preserveMessages {
                UserDefaults.standard.removeObject(forKey: msgsKey(id))
            }
        }
        rebuildConversationBots()
    }

    // Messages

    func loadMessages(for botID: String) -> [BotChatMessage] {
        let targetID = botIDAliases[botID] ?? botID
        let data = UserDefaults.standard.data(forKey: msgsKey(targetID))
            ?? UserDefaults.standard.data(forKey: msgsKey(botID))
        guard let data,
              let list = try? JSONDecoder().decode([BotChatMessage].self, from: data)
        else { return [] }
        return list
    }

    func saveMessages(_ msgs: [BotChatMessage], for botID: String) {
        loadConversationListState()
        let targetID = botIDAliases[botID] ?? botID
        // Cap history to last 100 messages to keep UserDefaults small.
        let trimmed = Array(msgs.suffix(100))
        if let data = try? JSONEncoder().encode(trimmed) {
            UserDefaults.standard.set(data, forKey: msgsKey(targetID))
        }
        setCachedLastMessage(trimmed.last, for: targetID)
        if targetID != botID {
            UserDefaults.standard.removeObject(forKey: msgsKey(botID))
            removeCachedLastMessage(for: botID)
        }
    }

    func clearMessages(for botID: String) {
        loadConversationListState()
        let targetID = botIDAliases[botID] ?? botID
        UserDefaults.standard.removeObject(forKey: msgsKey(targetID))
        setCachedLastMessage(nil, for: targetID)
        UserDefaults.standard.removeObject(forKey: msgsKey(botID))
        setCachedLastMessage(nil, for: botID)
    }

    func ensureOpeningLineMessage(for bot: BotConfig) {
        let openingLine = bot.openingLine.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !openingLine.isEmpty else { return }

        let targetID = botIDAliases[bot.id] ?? bot.id
        var messages = loadMessages(for: targetID)
        let openingMessage = BotChatMessage(
            role: "assistant",
            content: openingLine,
            timestamp: Date()
        )

        if messages.isEmpty {
            messages = [openingMessage]
        } else if messages[0].role == "assistant" {
            messages[0] = openingMessage
        } else {
            messages.insert(openingMessage, at: 0)
        }

        saveMessages(messages, for: targetID)
    }

    func lastMessage(for botID: String) -> BotChatMessage? {
        let targetID = botIDAliases[botID] ?? botID
        return lastMessagesByBotID[targetID] ?? lastMessagesByBotID[botID]
    }

    private func rebuildLastMessageCache() {
        var next: [String: BotChatMessage] = [:]
        for bot in bots {
            if let message = loadMessages(for: bot.id).last {
                next[bot.id] = message
            }
        }
        lastMessagesByBotID = next
        rebuildConversationBots()
    }

    private func setCachedLastMessage(_ message: BotChatMessage?, for botID: String) {
        let targetID = botIDAliases[botID] ?? botID
        var next = lastMessagesByBotID
        if let message {
            next[targetID] = message
            if targetID != botID {
                next[botID] = message
            }
        } else {
            next.removeValue(forKey: targetID)
            next.removeValue(forKey: botID)
        }
        lastMessagesByBotID = next
        rebuildConversationBots()
    }

    private func removeCachedLastMessage(for botID: String) {
        var next = lastMessagesByBotID
        next.removeValue(forKey: botID)
        lastMessagesByBotID = next
        rebuildConversationBots()
    }

    private var conversationListUserID: String {
        let raw = AuthManager.shared.currentUser?.userID ?? "anonymous"
        return raw.isEmpty ? "anonymous" : raw
    }

    private var pinnedBotListKey: String {
        "\(pinnedBotListKeyPrefix).\(conversationListUserID)"
    }

    private var hiddenBotListKey: String {
        "\(hiddenBotListKeyPrefix).\(conversationListUserID)"
    }

    private func loadConversationListState() {
        let userID = conversationListUserID
        guard loadedListStateUserID != userID else { return }
        loadedListStateUserID = userID
        pinnedBotIDs = Set(UserDefaults.standard.stringArray(forKey: pinnedBotListKey) ?? [])
        hiddenBotIDs = Set(UserDefaults.standard.stringArray(forKey: hiddenBotListKey) ?? [])
        normalizeConversationListStateIDs()
        rebuildConversationBots()
    }

    private func saveConversationListState() {
        UserDefaults.standard.set(Array(pinnedBotIDs), forKey: pinnedBotListKey)
        UserDefaults.standard.set(Array(hiddenBotIDs), forKey: hiddenBotListKey)
    }

    private func botListID(_ botID: String) -> String {
        botIDAliases[botID] ?? botID
    }

    private func normalizeConversationListStateIDs() {
        var changed = false
        for (oldID, newID) in botIDAliases {
            if pinnedBotIDs.remove(oldID) != nil {
                pinnedBotIDs.insert(newID)
                changed = true
            }
            if hiddenBotIDs.remove(oldID) != nil {
                hiddenBotIDs.insert(newID)
                changed = true
            }
        }
        if changed {
            saveConversationListState()
        }
    }

    private func rebuildConversationBots() {
        let visible = bots.filter { !hiddenBotIDs.contains(botListID($0.id)) }
        conversationBots = visible.sorted { lhs, rhs in
            let lhsPinned = pinnedBotIDs.contains(botListID(lhs.id))
            let rhsPinned = pinnedBotIDs.contains(botListID(rhs.id))
            if lhsPinned != rhsPinned { return lhsPinned && !rhsPinned }

            let lhsTime = lastMessagesByBotID[botListID(lhs.id)]?.timestamp ?? lhs.createdAt
            let rhsTime = lastMessagesByBotID[botListID(rhs.id)]?.timestamp ?? rhs.createdAt
            if lhsTime != rhsTime { return lhsTime > rhsTime }

            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }
    }
}
