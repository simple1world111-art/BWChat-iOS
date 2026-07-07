// BWChat/Views/BotChatView.swift
// Chat UI for talking to a bot (AI agent) via ChatbotAPI.

import SwiftUI
import UIKit

struct BotChatView: View {
    let botID: String
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var store = BotStore.shared
    @ObservedObject private var appearanceStore = ChatAppearanceStore.shared

    @State private var messages: [BotChatMessage] = []
    @State private var inputText: String = ""
    @State private var isStreaming = false
    @State private var streamingTask: Task<Void, Never>?
    @State private var errorMessage: String?
    @State private var inputFocused = false
    @State private var inputTextHeight: CGFloat = 40
    @State private var showPlusMenu = false
    @State private var showShareSheet = false
    @State private var toastMessage: String?
    @State private var scrollToBottomRequest = 0
    @State private var isViewVisible = false

    private let bottomScrollAnchorID = "bot-chat-bottom-anchor"

    private var bot: BotConfig {
        store.bot(for: botID) ?? BotConfig.defaultBot
    }

    var body: some View {
        content
            .background(AppColors.secondaryBackground)
            .navigationTitle(bot.name)
            .navigationBarTitleDisplayMode(.inline)
            .hidesTabBarOnPush()
            .withUIKitBackButton()
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Button(action: openBotSettings) {
                        HStack(spacing: 8) {
                            BotAvatar(avatarURL: bot.avatarURL, emoji: bot.emoji, size: 28)
                            Text(bot.name)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(AppColors.primaryText)
                                .lineLimit(1)
                                .minimumScaleFactor(0.85)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.tr("bot.settings"))
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showShareSheet = true
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(AppColors.accent)
                    }
                    .accessibilityLabel(L10n.tr("bot.share.title"))
                }
            }
            .toolbarBackground(AppColors.secondaryBackground.opacity(0.96), for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .sheet(isPresented: $showShareSheet) {
                BotShareSheet(
                    bot: bot,
                    payload: botSharePayload,
                    shareText: botShareText,
                    toastMessage: $toastMessage
                )
            }
            .toast(message: $toastMessage)
            .onAppear {
                isViewVisible = true
                // Reload unconditionally so changes made in BotConfigView
                // (cleared history, edited display info) show up when we pop
                // back to the chat.
                messages = store.loadMessages(for: bot.id)
                scrollToBottomRequest += 1
            }
            .task {
                await store.syncServerBots()
                await appearanceStore.loadIfNeeded()
                let syncedMessages = store.loadMessages(for: bot.id)
                if syncedMessages != messages {
                    messages = syncedMessages
                    scrollToBottomRequest += 1
                }
            }
            .onDisappear {
                isViewVisible = false
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
            ZStack {
                ChatBackgroundLayer(
                    background: appearanceStore.effectiveBackground(
                        targetType: .bot,
                        targetID: bot.id
                    )
                )

                GeometryReader { geometry in
                    let horizontalPadding: CGFloat = 16
                    let contentWidth = max(geometry.size.width - horizontalPadding * 2, 0)
                    let maxBubbleWidth = min(contentWidth * 0.72, 292)

                    ScrollView {
                        VStack(spacing: 0) {
                            LazyVStack(spacing: 10) {
                                if messages.isEmpty {
                                    emptyHint.padding(.top, 60)
                                }
                                ForEach(messages) { msg in
                                    BotMessageBubble(
                                        message: msg,
                                        botAvatarURL: bot.avatarURL,
                                        botEmoji: bot.emoji,
                                        maxBubbleWidth: maxBubbleWidth,
                                        onBotAvatarTap: openBotSettings
                                    )
                                    .id(msg.id)
                                }
                            }
                            .frame(width: contentWidth)
                            .padding(.horizontal, horizontalPadding)
                            .padding(.top, 14)
                            .padding(.bottom, 10)

                            Color.clear
                                .frame(height: 1)
                                .id(bottomScrollAnchorID)
                        }
                    }
                    .scrollIndicators(.hidden)
                    .scrollDismissesKeyboard(.interactively)
                }
            }
            .contentShape(Rectangle())
            .simultaneousGesture(
                TapGesture().onEnded {
                    inputFocused = false
                    showPlusMenu = false
                    hideKeyboard()
                }
            )
            .onAppear {
                scheduleScrollToLatest(proxy, animated: false)
            }
            .onChange(of: scrollToBottomRequest) { _ in
                scheduleScrollToLatest(proxy, animated: false)
            }
            .onChange(of: messages.count) { _ in
                scheduleScrollToLatest(proxy)
            }
            .onChange(of: messages.last?.content) { _ in
                scrollToLatest(proxy, animated: false)
            }
            .onChange(of: inputFocused) { focused in
                guard focused else { return }
                scrollToLatestForKeyboard(proxy)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { notification in
                scrollToLatestForKeyboard(proxy, notification: notification)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in
                scrollToLatest(proxy, animated: false)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { notification in
                scrollToLatestAfterKeyboardDismiss(proxy, notification: notification)
            }
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in
                scheduleScrollToLatest(proxy, animated: false)
            }
        }
    }

    private func scrollToLatest(_ proxy: ScrollViewProxy, animated: Bool = true) {
        guard isViewVisible else { return }

        let scrollAction = {
            proxy.scrollTo(bottomScrollAnchorID, anchor: .bottom)
        }

        if animated {
            withAnimation(.easeOut(duration: 0.24), scrollAction)
        } else {
            scrollAction()
        }
    }

    private func scheduleScrollToLatest(_ proxy: ScrollViewProxy, animated: Bool = true) {
        guard isViewVisible else { return }
        scrollToLatest(proxy, animated: animated)

        [0.05, 0.16, 0.32].forEach { delay in
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                guard isViewVisible else { return }
                scrollToLatest(proxy, animated: false)
            }
        }
    }

    private func scrollToLatestForKeyboard(
        _ proxy: ScrollViewProxy,
        notification: Notification? = nil
    ) {
        scrollToLatest(proxy)

        let duration = (notification?.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let checkpoints = [0.08, max(duration * 0.55, 0.14), duration + 0.04]

        checkpoints.forEach { delay in
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                guard isViewVisible else { return }
                scrollToLatest(proxy, animated: false)
            }
        }
    }

    private func scrollToLatestAfterKeyboardDismiss(
        _ proxy: ScrollViewProxy,
        notification: Notification? = nil
    ) {
        let duration = (notification?.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let checkpoints = [0.02, max(duration * 0.5, 0.12), duration + 0.05, duration + 0.18]

        checkpoints.forEach { delay in
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                guard isViewVisible else { return }
                scrollToLatest(proxy, animated: false)
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
            Button(action: openBotSettings) {
                BotAvatar(avatarURL: bot.avatarURL, emoji: bot.emoji, size: 64)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.tr("bot.settings"))

            Text(L10n.tr("bot.chat.prompt", bot.name))
                .font(.system(size: 14))
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(maxWidth: .infinity)
    }

    private var inputBar: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 10) {
                Button {
                    inputFocused = false
                    toastMessage = L10n.tr("bot.unsupported.voiceInput")
                } label: {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 20))
                        .foregroundColor(AppColors.accent)
                        .frame(width: 32, height: inputChromeHeight)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr("chat.voiceInput"))

                ZStack(alignment: .topLeading) {
                    ChatInputTextView(
                        text: $inputText,
                        isFocused: $inputFocused,
                        height: $inputTextHeight
                    ) {
                        send()
                    }
                    .frame(height: inputTextHeight)

                    Text(L10n.tr("chat.input.placeholder"))
                        .font(.system(size: 16))
                        .foregroundColor(AppColors.tertiaryText)
                        .padding(.top, 11)
                        .padding(.leading, 2)
                        .opacity(inputText.isEmpty && !inputFocused ? 1 : 0)
                        .allowsHitTesting(false)
                }
                    .chatComposerFieldChrome(minHeight: inputChromeHeight)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        showPlusMenu = false
                        inputFocused = true
                    }

                trailingInputButton
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 12)

            if showPlusMenu {
                botPlusMenu
            }
        }
        .chatComposerBarBackground()
    }

    private var inputChromeHeight: CGFloat {
        inputTextHeight + 14
    }

    @ViewBuilder
    private var trailingInputButton: some View {
        if isStreaming || !inputText.isBlank {
            sendButton
                .frame(width: 42, height: inputChromeHeight, alignment: .center)
        } else {
            Button {
                inputFocused = false
                withAnimation(.easeInOut(duration: 0.2)) { showPlusMenu.toggle() }
            } label: {
                Image(systemName: showPlusMenu ? "xmark.circle.fill" : "plus.circle.fill")
                    .font(.system(size: 28))
                    .foregroundColor(AppColors.accent)
                    .frame(width: 40, height: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(width: 42, height: inputChromeHeight, alignment: .center)
            .accessibilityLabel(showPlusMenu ? L10n.tr("accessibility.collapseMore") : L10n.tr("accessibility.moreActions"))
        }
    }

    private var sendButton: some View {
        Button {
            send()
        } label: {
            ZStack {
                Circle()
                    .fill(isStreaming ? AnyShapeStyle(AppColors.errorColor) : AnyShapeStyle(AppColors.accentGradient))
                    .frame(width: 40, height: 40)
                Image(systemName: isStreaming ? "stop.fill" : "arrow.up")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(.white)
            }
            .contentShape(Circle())
            .shadow(
                color: isStreaming ? AppColors.errorColor.opacity(0.22) : AppColors.accent.opacity(0.24),
                radius: 10,
                x: 0,
                y: 4
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isStreaming ? L10n.tr("bot.stopGenerating") : L10n.tr("common.send"))
    }

    private var botPlusMenu: some View {
        HStack(spacing: 24) {
            Button {
                showPlusMenu = false
                toastMessage = L10n.tr("bot.unsupported.media")
            } label: {
                botPlusMenuTile(icon: "photo", title: L10n.tr("chat.album"))
            }

            GiftPlusMenuTile {
                showPlusMenu = false
                inputFocused = false
                toastMessage = L10n.tr("bot.unsupported.gift")
            }

            Button {
                showPlusMenu = false
                toastMessage = L10n.tr("bot.unsupported.voiceCall")
            } label: {
                botPlusMenuTile(icon: "phone.fill", title: L10n.tr("call.voice"))
            }

            Button {
                showPlusMenu = false
                toastMessage = L10n.tr("bot.unsupported.videoCall")
            } label: {
                botPlusMenuTile(icon: "video.fill", title: L10n.tr("call.video"))
            }
        }
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private func botPlusMenuTile(icon: String, title: String) -> some View {
        VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(AppColors.separator)
                    .frame(width: 56, height: 56)
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .foregroundColor(AppColors.primaryText)
            }
            Text(title)
                .font(.system(size: 11))
                .foregroundColor(AppColors.secondaryText)
        }
    }

    private var botSharePayload: BotSharePayload {
        BotSharePayload(bot: bot, sourceBotID: store.shareSourceID(for: bot.id))
    }

    private var botShareText: String {
        botSharePayload.encodedMessage
    }

    private func openBotSettings() {
        navigator.push(
            BotConfigView(mode: .edit(bot)) {
                messages.removeAll()
                store.clearMessages(for: bot.id)
                scrollToBottomRequest += 1
            }
        )
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
        showPlusMenu = false
        errorMessage = nil

        let assistantMsg = BotChatMessage(role: "assistant", content: "", timestamp: Date())
        messages.append(assistantMsg)
        let assistantID = assistantMsg.id

        let history: [ChatbotMessage] = messages
            .filter { $0.timestamp >= bot.promptUpdatedAt }
            .filter { !(($0.role == "assistant") && $0.content.isEmpty) }
            .suffix(40)
            .map { ChatbotMessage(role: $0.role, content: $0.content) }

        isStreaming = true
        streamingTask = Task { @MainActor in
            do {
                let serverBotID = try await store.ensureServerBotID(for: bot.id)
                if Task.isCancelled {
                    isStreaming = false
                    return
                }

                streamingTask = ChatbotAPI.shared.stream(
                    messages: history,
                    botID: serverBotID,
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
            } catch {
                isStreaming = false
                errorMessage = error.localizedDescription
                if let idx = messages.firstIndex(where: { $0.id == assistantID }),
                   messages[idx].content.isEmpty {
                    messages.remove(at: idx)
                }
                store.saveMessages(messages, for: bot.id)
            }
        }
    }
}

// MARK: - Bubble (prefixed to avoid clash with project-wide MessageBubble)

private struct BotMessageBubble: View {
    let message: BotChatMessage
    let botAvatarURL: String
    let botEmoji: String
    let maxBubbleWidth: CGFloat
    var onBotAvatarTap: (() -> Void)?

    var body: some View {
        Group {
            if message.role == "user" {
                userBubble
            } else if message.content.isEmpty {
                BotTypingIndicatorBubble(
                    botAvatarURL: botAvatarURL,
                    botEmoji: botEmoji,
                    onBotAvatarTap: onBotAvatarTap
                )
            } else {
                assistantBubble
            }
        }
        .padding(.vertical, 1)
    }

    private var userBubble: some View {
        HStack(alignment: .bottom, spacing: 0) {
            Spacer(minLength: 64)
            Text(message.content)
                .font(.system(size: 16))
                .foregroundColor(AppColors.sentBubbleText)
                .lineSpacing(3)
                .lineLimit(nil)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 15)
                .padding(.vertical, 10)
                .background(
                    AppColors.sentBubbleGradient
                )
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .shadow(
                    color: AppColors.accent.opacity(0.18),
                    radius: 8,
                    x: 0,
                    y: 3
                )
                .frame(maxWidth: maxBubbleWidth, alignment: .trailing)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private var assistantBubble: some View {
        HStack(alignment: .bottom, spacing: 9) {
            Button {
                onBotAvatarTap?()
            } label: {
                BotAvatar(avatarURL: botAvatarURL, emoji: botEmoji, size: 32)
                    .shadow(color: Color.black.opacity(0.08), radius: 5, x: 0, y: 2)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.tr("bot.settings"))

            Text(message.content.isEmpty ? "…" : message.content)
                .font(.system(size: 16))
                .foregroundColor(AppColors.receivedBubbleText)
                .lineSpacing(3)
                .lineLimit(nil)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 15)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(Color.white.opacity(0.93))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Color.white.opacity(0.8), lineWidth: 1)
                )
                .shadow(
                    color: Color.black.opacity(0.06),
                    radius: 8,
                    x: 0,
                    y: 3
                )
                .frame(maxWidth: maxBubbleWidth, alignment: .leading)

            Spacer(minLength: 46)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct BotTypingIndicatorBubble: View {
    let botAvatarURL: String
    let botEmoji: String
    var onBotAvatarTap: (() -> Void)?

    var body: some View {
        HStack(alignment: .bottom, spacing: 9) {
            Button {
                onBotAvatarTap?()
            } label: {
                BotAvatar(avatarURL: botAvatarURL, emoji: botEmoji, size: 32)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.tr("bot.settings"))

            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(AppColors.secondaryText.opacity(0.72))
                        .frame(width: 5, height: 5)
                        .opacity(index == 1 ? 0.75 : 0.45)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color.white.opacity(0.93))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            Spacer(minLength: 46)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Share Sheet

struct BotSharePayload: Codable, Equatable {
    private static let messagePrefix = "bbchat://bot-share/v1#"
    private static let legacyMessagePrefix = "bw" + "chat://bot-share/v1#"

    let version: Int
    let sourceBotID: String
    let name: String
    let emoji: String
    let avatarURL: String
    let characterBackground: String
    let gender: String
    let openingLine: String
    let temperature: Double
    let maxTokens: Int
    let topP: Double
    let enableThinking: Bool

    init(bot: BotConfig, sourceBotID: String? = nil) {
        version = 1
        let resolvedSourceID = sourceBotID?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        self.sourceBotID = resolvedSourceID?.isEmpty == false ? resolvedSourceID! : bot.id
        name = bot.name
        emoji = bot.emoji
        avatarURL = bot.avatarURL
        characterBackground = bot.characterBackground
        gender = BotConfig.normalizedGender(bot.gender)
        openingLine = bot.openingLine
        temperature = bot.temperature
        maxTokens = bot.maxTokens
        topP = bot.topP
        enableThinking = bot.enableThinking
    }

    var encodedMessage: String {
        guard let data = try? JSONEncoder().encode(self) else {
            return "\(Self.messagePrefix)e30="
        }
        return Self.messagePrefix + data.base64EncodedString()
    }

    var summary: String {
        if !characterBackground.isBlank {
            return characterBackground
        }
        return L10n.tr("bot.share.importHint")
    }

    var genderTitle: String {
        BotConfig.normalizedGender(gender) == "male" ? L10n.tr("bot.gender.male") : L10n.tr("bot.gender.female")
    }

    var stableBotID: String {
        let trimmed = sourceBotID.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? UUID().uuidString : trimmed
    }

    static func decode(from content: String) -> BotSharePayload? {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix: String
        if trimmed.hasPrefix(messagePrefix) {
            prefix = messagePrefix
        } else if trimmed.hasPrefix(legacyMessagePrefix) {
            prefix = legacyMessagePrefix
        } else {
            return nil
        }
        let raw = String(trimmed.dropFirst(prefix.count))
        guard let data = Data(base64Encoded: raw),
              let payload = try? JSONDecoder().decode(BotSharePayload.self, from: data),
              payload.version == 1
        else { return nil }
        return payload
    }

    func importedBot() -> BotConfig {
        var bot = BotConfig(
            id: stableBotID,
            name: name,
            emoji: emoji.isBlank ? "🤖" : emoji,
            avatarURL: avatarURL,
            characterBackground: characterBackground,
            gender: BotConfig.normalizedGender(gender),
            openingLine: openingLine,
            temperature: temperature,
            maxTokens: maxTokens,
            topP: topP,
            enableThinking: enableThinking,
            createdAt: Date(),
            promptUpdatedAt: Date()
        )
        bot.sourceBotID = stableBotID
        bot.originBotID = stableBotID
        return bot
    }

}

struct BotShareCard: View {
    let payload: BotSharePayload
    var isFromMe: Bool = false
    var allowsImport: Bool = true

    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var botStore = BotStore.shared
    @State private var isImporting = false
    @State private var importedBotID: String?
    @State private var toastMessage: String?

    var body: some View {
        Button {
            importIfNeeded()
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    BotAvatar(avatarURL: payload.avatarURL, emoji: payload.emoji, size: 44)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(payload.name)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(AppColors.primaryText)
                            .lineLimit(1)

                        Text(payload.genderTitle)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 8)

                    Image(systemName: "sparkles")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                }

                Text(payload.summary)
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 6) {
                    Image(systemName: "person.badge.plus")
                        .font(.system(size: 12, weight: .semibold))

                    Text(actionTitle)
                        .font(.system(size: 13, weight: .bold))

                    Spacer(minLength: 0)

                    if isImporting {
                        ProgressView()
                            .scaleEffect(0.72)
                            .tint(AppColors.accent)
                    } else if hasImportedBot {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 14, weight: .semibold))
                    }
                }
                .foregroundColor(AppColors.accent)
                .padding(.top, 2)
            }
            .padding(12)
            .frame(maxWidth: 286, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(AppColors.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(AppColors.accent.opacity(isFromMe ? 0.18 : 0.12), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.06), radius: 8, x: 0, y: 3)
        }
        .buttonStyle(.plain)
        .disabled(isImporting)
        .toast(message: $toastMessage)
    }

    private var actionTitle: String {
        guard allowsImport else { return L10n.tr("bot.share.card") }
        if isImporting { return L10n.tr("bot.share.importing") }
        if hasImportedBot { return L10n.tr("bot.share.imported") }
        return L10n.tr("bot.share.addAndTry")
    }

    private var hasImportedBot: Bool {
        existingImportedBot != nil
    }

    private var existingImportedBot: BotConfig? {
        botStore.botImported(from: payload.stableBotID)
    }

    private func importIfNeeded() {
        guard allowsImport, !isImporting else { return }
        if let existing = existingImportedBot {
            botStore.registerSharedSourceID(payload.stableBotID, for: existing.id)
            toastMessage = L10n.tr("bot.share.alreadyInList")
            return
        }
        if let importedBotID, botStore.bot(for: importedBotID) != nil {
            toastMessage = L10n.tr("bot.share.alreadyInList")
            return
        }

        isImporting = true

        Task { @MainActor in
            defer { isImporting = false }

            do {
                await botStore.syncServerBots()
                if let existing = existingImportedBot {
                    botStore.registerSharedSourceID(payload.stableBotID, for: existing.id)
                    toastMessage = L10n.tr("bot.share.alreadyInList")
                    return
                }

                let draft = payload.importedBot()
                let saved = try await botStore.saveSharedCopyToServerAndStore(draft)
                importedBotID = saved.id
                toastMessage = L10n.tr("bot.share.addedToList")
                navigator.push(BotChatView(botID: saved.id))
            } catch {
                toastMessage = apiMessage(error)
            }
        }
    }

    private func apiMessage(_ error: Error) -> String {
        if let apiError = error as? APIError {
            return apiError.errorDescription ?? L10n.tr("common.operationFailed")
        }
        return error.localizedDescription
    }
}

private enum BotShareTab: String, CaseIterable, Identifiable {
    case contacts
    case groups
    case moments

    var id: String { rawValue }

    var title: String {
        switch self {
        case .contacts: return L10n.tr("bot.share.contacts")
        case .groups: return L10n.tr("bot.share.groups")
        case .moments: return L10n.tr("profile.moments")
        }
    }
}

private struct BotShareSheet: View {
    let bot: BotConfig
    let payload: BotSharePayload
    let shareText: String
    @Binding var toastMessage: String?

    @Environment(\.dismiss) private var dismiss
    @State private var selectedTab: BotShareTab = .contacts
    @State private var contacts: [Contact] = []
    @State private var groups: [ChatGroup] = []
    @State private var isLoadingTargets = false
    @State private var isSharingKey: String?
    @State private var errorMessage: String?
    @State private var didLoadTargets = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                header

                Picker("", selection: $selectedTab) {
                    ForEach(BotShareTab.allCases) { tab in
                        Text(tab.title).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.top, 12)

                content
            }
            .background(AppColors.secondaryBackground)
            .navigationTitle(L10n.tr("bot.share.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(L10n.tr("common.done")) { dismiss() }
                        .foregroundColor(AppColors.accent)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task {
            await loadTargetsIfNeeded()
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            BotAvatar(avatarURL: bot.avatarURL, emoji: bot.emoji, size: 52)

            VStack(alignment: .leading, spacing: 5) {
                Text(bot.name)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)
                Text(BotConfig.normalizedGender(bot.gender) == "male" ? L10n.tr("bot.gender.male") : L10n.tr("bot.gender.female"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
            }

            Spacer()
        }
        .padding(16)
        .background(AppColors.cardBackground)
    }

    @ViewBuilder
    private var content: some View {
        if isLoadingTargets {
            Spacer()
            ProgressView(L10n.tr("common.loading"))
                .tint(AppColors.accent)
                .foregroundColor(AppColors.secondaryText)
            Spacer()
        } else if let errorMessage {
            Spacer()
            VStack(spacing: 12) {
                Text(errorMessage)
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.secondaryText)
                    .multilineTextAlignment(.center)
                Button(L10n.tr("common.retry")) {
                    Task { await reloadTargets() }
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(AppColors.accent)
            }
            .padding(.horizontal, 24)
            Spacer()
        } else {
            ScrollView {
                VStack(spacing: 10) {
                    switch selectedTab {
                    case .contacts:
                        if contacts.isEmpty {
                            emptyState(L10n.tr("bot.share.emptyContacts"))
                        } else {
                            ForEach(contacts) { contact in
                                contactRow(contact)
                            }
                        }
                    case .groups:
                        if groups.isEmpty {
                            emptyState(L10n.tr("bot.share.emptyGroups"))
                        } else {
                            ForEach(groups) { group in
                                groupRow(group)
                            }
                        }
                    case .moments:
                        momentsPanel
                    }
                }
                .padding(16)
            }
        }
    }

    private func emptyState(_ text: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "tray")
                .font(.system(size: 28, weight: .medium))
                .foregroundColor(AppColors.tertiaryText)
            Text(text)
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 44)
    }

    private func contactRow(_ contact: Contact) -> some View {
        Button {
            Task { await shareToContact(contact) }
        } label: {
            HStack(spacing: 12) {
                AvatarView(url: contact.avatarURL, size: 42)
                VStack(alignment: .leading, spacing: 3) {
                    Text(contact.nickname)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                    Text(L10n.tr("bot.share.sendToFriend"))
                        .font(.system(size: 12))
                        .foregroundColor(AppColors.secondaryText)
                }
                Spacer()
                trailingShareIcon(key: "contact-\(contact.userID)")
            }
            .padding(12)
            .background(AppColors.cardBackground)
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
        .disabled(isSharingKey != nil)
    }

    private func groupRow(_ group: ChatGroup) -> some View {
        Button {
            Task { await shareToGroup(group) }
        } label: {
            HStack(spacing: 12) {
                AvatarView(url: group.avatarURL, size: 42)
                VStack(alignment: .leading, spacing: 3) {
                    Text(group.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                    Text(L10n.tr("group.members.shortCount", group.memberCount))
                        .font(.system(size: 12))
                        .foregroundColor(AppColors.secondaryText)
                }
                Spacer()
                trailingShareIcon(key: "group-\(group.groupID)")
            }
            .padding(12)
            .background(AppColors.cardBackground)
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
        .disabled(isSharingKey != nil)
    }

    private var momentsPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L10n.tr("bot.share.momentsPrompt"))
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(AppColors.primaryText)

            BotShareCard(payload: payload, allowsImport: false)
                .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                Task { await shareToMoments() }
            } label: {
                HStack(spacing: 8) {
                    if isSharingKey == "moments" {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 15, weight: .semibold))
                    }
                    Text(isSharingKey == "moments" ? L10n.tr("common.publishing") : L10n.tr("bot.share.publishToMoments"))
                        .font(.system(size: 15, weight: .bold))
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(AppColors.accentGradient)
                .cornerRadius(22)
            }
            .disabled(isSharingKey != nil)
        }
        .padding(14)
        .background(AppColors.cardBackground)
        .cornerRadius(14)
    }

    @ViewBuilder
    private func trailingShareIcon(key: String) -> some View {
        if isSharingKey == key {
            ProgressView()
                .tint(AppColors.accent)
        } else {
            Image(systemName: "paperplane.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(AppColors.accent)
        }
    }

    private func loadTargetsIfNeeded() async {
        guard !didLoadTargets else { return }
        await reloadTargets()
    }

    private func reloadTargets() async {
        didLoadTargets = true
        isLoadingTargets = true
        errorMessage = nil
        defer { isLoadingTargets = false }

        do {
            async let contactsTask = APIService.shared.getContacts()
            async let groupsTask = APIService.shared.getGroups()
            let loadedContacts = try await contactsTask
            let loadedGroups = try await groupsTask
            contacts = loadedContacts.filter { $0.userID != AuthManager.shared.currentUser?.userID }
            groups = loadedGroups
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    private func shareToContact(_ contact: Contact) async {
        let key = "contact-\(contact.userID)"
        isSharingKey = key
        defer { isSharingKey = nil }

        do {
            _ = try await APIService.shared.sendTextMessage(
                receiverID: contact.userID,
                content: shareText
            )
            toastMessage = L10n.tr("bot.share.sharedToContact", contact.nickname)
            dismiss()
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    private func shareToGroup(_ group: ChatGroup) async {
        let key = "group-\(group.groupID)"
        isSharingKey = key
        defer { isSharingKey = nil }

        do {
            _ = try await APIService.shared.sendGroupText(
                groupID: group.groupID,
                content: shareText
            )
            toastMessage = L10n.tr("bot.share.sharedToGroup", group.name)
            dismiss()
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    private func shareToMoments() async {
        isSharingKey = "moments"
        defer { isSharingKey = nil }

        do {
            _ = try await APIService.shared.createMoment(
                content: shareText,
                imageDataList: []
            )
            toastMessage = L10n.tr("bot.share.publishedToMoments")
            dismiss()
        } catch {
            errorMessage = apiMessage(error)
        }
    }

    private func apiMessage(_ error: Error) -> String {
        if let apiError = error as? APIError {
            return apiError.errorDescription ?? L10n.tr("bot.share.failed")
        }
        return error.localizedDescription
    }
}

// MARK: - Avatar (used here and in the conversation-list bot row)

struct BotAvatar: View {
    let avatarURL: String
    let emoji: String
    let size: CGFloat

    @State private var image: UIImage?

    init(avatarURL: String = "", emoji: String = "", size: CGFloat = 50) {
        self.avatarURL = avatarURL
        self.emoji = emoji
        self.size = size
    }

    private var resolvedPath: String {
        if avatarURL.isEmpty { return "" }
        if avatarURL.hasPrefix("/") || avatarURL.hasPrefix("http") { return avatarURL }
        return "/api/v1/" + avatarURL
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                ZStack {
                    LinearGradient(
                        colors: [Color(hex: "667EEA"), Color(hex: "F093FB")],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Image(systemName: "sparkles")
                        .font(.system(size: size * 0.34, weight: .semibold))
                        .foregroundColor(.white.opacity(0.9))
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .onAppear {
            let path = resolvedPath
            guard !path.isEmpty else { return }
            if let cached = ImageCacheManager.shared.image(for: path) {
                image = cached
            }
        }
        .task(id: avatarURL) {
            let path = resolvedPath
            guard !path.isEmpty else {
                image = nil
                return
            }
            if image != nil, ImageCacheManager.shared.image(for: path) == nil {
                image = nil
            }
            if let loaded = await ImageCacheManager.shared.loadImage(from: path) {
                image = loaded
            }
        }
    }
}
