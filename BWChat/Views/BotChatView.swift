// BWChat/Views/BotChatView.swift
// Chat UI for talking to a bot (AI agent) via ChatbotAPI.

import SwiftUI

struct BotChatView: View {
    let botID: String
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var store = BotStore.shared

    @State private var messages: [BotChatMessage] = []
    @State private var inputText: String = ""
    @State private var isStreaming = false
    @State private var streamingTask: Task<Void, Never>?
    @State private var errorMessage: String?
    @FocusState private var inputFocused: Bool

    private var bot: BotConfig {
        store.bots.first(where: { $0.id == botID }) ?? BotConfig.defaultGirlfriend
    }

    var body: some View {
        content
            .background(AppColors.secondaryBackground)
            .navigationTitle(bot.name)
            .navigationBarTitleDisplayMode(.inline)
            .hidesTabBarOnPush()
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        navigator.push(BotConfigView(mode: .edit(bot)))
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(AppColors.accent)
                    }
                }
            }
            .onAppear {
                if messages.isEmpty {
                    messages = store.loadMessages(for: bot.id)
                }
            }
            .onDisappear {
                streamingTask?.cancel()
                store.saveMessages(messages, for: bot.id)
            }
    }

    @ViewBuilder
    private var content: some View {
        VStack(spacing: 0) {
            messagesList

            if let err = errorMessage {
                errorBanner(err)
            }

            inputBar
        }
    }

    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if messages.isEmpty {
                        emptyHint.padding(.top, 60)
                    }
                    ForEach(messages) { msg in
                        BotMessageBubble(message: msg, botEmoji: bot.emoji)
                            .id(msg.id)
                    }
                    Color.clear.frame(height: 8).id("bottom")
                }
                .padding(.horizontal, 12)
                .padding(.top, 12)
            }
            .background(AppColors.secondaryBackground)
            .onChange(of: messages.count) { _ in
                withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: messages.last?.content) { _ in
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }

    private func errorBanner(_ err: String) -> some View {
        Text(err)
            .font(.system(size: 12))
            .foregroundColor(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.red.opacity(0.85))
            .cornerRadius(8)
            .padding(.bottom, 6)
    }

    private var emptyHint: some View {
        VStack(spacing: 10) {
            Text(bot.emoji.isEmpty ? "🤖" : bot.emoji)
                .font(.system(size: 48))
            Text("跟 \(bot.name) 说点什么吧")
                .font(.system(size: 14))
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(maxWidth: .infinity)
    }

    private var inputBar: some View {
        VStack(spacing: 0) {
            Divider().opacity(0.3)
            HStack(alignment: .bottom, spacing: 10) {
                TextField("", text: $inputText, axis: .vertical)
                    .font(.system(size: 16))
                    .focused($inputFocused)
                    .lineLimit(1...5)
                    .padding(.vertical, 8)
                    .padding(.horizontal, 12)
                    .background(Color(hex: "F4F4F8"))
                    .cornerRadius(18)

                sendButton
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color.white)
        }
    }

    private var sendButton: some View {
        Button {
            send()
        } label: {
            Image(systemName: isStreaming ? "stop.circle.fill" : "paperplane.fill")
                .font(.system(size: 22))
                .foregroundColor(sendIconColor)
        }
        .disabled(!isStreaming && inputText.isBlank)
    }

    private var sendIconColor: Color {
        if isStreaming { return AppColors.errorColor }
        return inputText.isBlank ? AppColors.tertiaryText : AppColors.accent
    }

    private func send() {
        if isStreaming {
            streamingTask?.cancel()
            isStreaming = false
            return
        }
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let userMsg = BotChatMessage(role: "user", content: text, timestamp: Date())
        messages.append(userMsg)
        inputText = ""
        errorMessage = nil

        let assistantMsg = BotChatMessage(role: "assistant", content: "", timestamp: Date())
        messages.append(assistantMsg)
        let assistantID = assistantMsg.id

        let history: [ChatbotMessage] = messages
            .filter { !(($0.role == "assistant") && $0.content.isEmpty) }
            .suffix(40)
            .map { ChatbotMessage(role: $0.role, content: $0.content) }

        isStreaming = true
        streamingTask = ChatbotAPI.shared.stream(
            messages: history,
            persona: bot.systemPrompt.isEmpty ? bot.persona : nil,
            system: bot.systemPrompt.isEmpty ? nil : bot.systemPrompt,
            temperature: bot.temperature,
            maxTokens: bot.maxTokens,
            topP: bot.topP,
            enableThinking: bot.enableThinking,
            onDelta: { delta in
                if let idx = messages.firstIndex(where: { $0.id == assistantID }) {
                    messages[idx].content.append(delta)
                }
            },
            onFinish: { err in
                isStreaming = false
                if let err {
                    errorMessage = err.localizedDescription
                    if let idx = messages.firstIndex(where: { $0.id == assistantID }),
                       messages[idx].content.isEmpty {
                        messages.remove(at: idx)
                    }
                }
                store.saveMessages(messages, for: bot.id)
            }
        )
    }
}

// MARK: - Bubble (prefixed to avoid clash with project-wide MessageBubble)

private struct BotMessageBubble: View {
    let message: BotChatMessage
    let botEmoji: String

    var body: some View {
        if message.role == "user" {
            userBubble
        } else {
            assistantBubble
        }
    }

    private var userBubble: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Spacer(minLength: 44)
            Text(message.content)
                .font(.system(size: 16))
                .foregroundColor(AppColors.sentBubbleText)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(AppColors.sentBubble)
                .cornerRadius(18)
        }
    }

    private var assistantBubble: some View {
        HStack(alignment: .bottom, spacing: 8) {
            BotAvatar(emoji: botEmoji)
                .frame(width: 36, height: 36)
            Text(message.content.isEmpty ? "…" : message.content)
                .font(.system(size: 16))
                .foregroundColor(AppColors.receivedBubbleText)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(AppColors.receivedBubble)
                .cornerRadius(18)
            Spacer(minLength: 44)
        }
    }
}

// MARK: - Avatar (used here and in the conversation-list bot row)

struct BotAvatar: View {
    let emoji: String

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(hex: "667EEA"), Color(hex: "F093FB")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .clipShape(Circle())
            Text(emoji.isEmpty ? "🤖" : emoji)
                .font(.system(size: 20))
        }
    }
}
