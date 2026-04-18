// BWChat/Models/BotConfig.swift
// Bot (智能体) config + local persistence store.

import Foundation
import SwiftUI

struct BotConfig: Codable, Identifiable, Equatable {
    var id: String = UUID().uuidString
    var name: String
    var emoji: String             // single-emoji avatar
    var persona: String
    var systemPrompt: String = "" // advanced override; empty = use persona
    var temperature: Double = 0.8
    var maxTokens: Int = 400
    var topP: Double = 0.9
    var enableThinking: Bool = false
    var createdAt: Date = Date()

    static let defaultGirlfriend = BotConfig(
        id: "bot-default-girlfriend",
        name: "女友",
        emoji: "💕",
        persona: "你是林悦，25岁的上海女孩，说话温柔带点撒娇，偶尔开玩笑。喜欢用表情，爱听对方分享生活。",
        systemPrompt: "",
        temperature: 0.9,
        maxTokens: 400,
        topP: 0.9,
        enableThinking: false,
        createdAt: Date()
    )
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

    private let botsKey = "bwchat.bots.v1"
    private func msgsKey(_ botID: String) -> String { "bwchat.bot_messages.v1.\(botID)" }

    init() {
        loadBots()
        if bots.isEmpty {
            bots = [BotConfig.defaultGirlfriend]
            persistBots()
        }
    }

    // Bots

    private func loadBots() {
        guard let data = UserDefaults.standard.data(forKey: botsKey),
              let list = try? JSONDecoder().decode([BotConfig].self, from: data)
        else { return }
        bots = list
    }

    private func persistBots() {
        if let data = try? JSONEncoder().encode(bots) {
            UserDefaults.standard.set(data, forKey: botsKey)
        }
    }

    func addOrUpdate(_ bot: BotConfig) {
        if let idx = bots.firstIndex(where: { $0.id == bot.id }) {
            bots[idx] = bot
        } else {
            bots.insert(bot, at: 0)
        }
        persistBots()
    }

    func delete(_ botID: String) {
        bots.removeAll { $0.id == botID }
        persistBots()
        UserDefaults.standard.removeObject(forKey: msgsKey(botID))
    }

    // Messages

    func loadMessages(for botID: String) -> [BotChatMessage] {
        guard let data = UserDefaults.standard.data(forKey: msgsKey(botID)),
              let list = try? JSONDecoder().decode([BotChatMessage].self, from: data)
        else { return [] }
        return list
    }

    func saveMessages(_ msgs: [BotChatMessage], for botID: String) {
        // Cap history to last 100 messages to keep UserDefaults small.
        let trimmed = msgs.suffix(100)
        if let data = try? JSONEncoder().encode(Array(trimmed)) {
            UserDefaults.standard.set(data, forKey: msgsKey(botID))
        }
    }

    func lastMessage(for botID: String) -> BotChatMessage? {
        loadMessages(for: botID).last
    }
}
