import SwiftUI

struct ScriptRoomChatView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel: ScriptRoomViewModel
    @FocusState private var isInputFocused: Bool
    @State private var showEndConfirmation = false
    @State private var scrollRequest = 0
    @State private var hasCompletedInitialLoad = false
    @State private var isViewVisible = false

    private let bottomScrollAnchorID = "script-chat-bottom"

    init(roomID: String, initialRoom: ScriptRoom? = nil) {
        let model = ScriptRoomViewModel(roomID: roomID, initialRoom: initialRoom)
        _viewModel = StateObject(wrappedValue: model)
    }

    var body: some View {
        VStack(spacing: 0) {
            if let room = viewModel.room {
                roleRoster(room)
                messages(room)
            } else if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScriptEmptyState(
                    icon: "bubble.left.and.exclamationmark.bubble.right",
                    title: ScriptText.value("无法恢复房间", "Unable to restore room"),
                    subtitle: viewModel.errorMessage ?? ScriptText.value("请稍后重试", "Please try again")
                )
            }

            inputBar
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(viewModel.room?.scriptSnapshot.title ?? ScriptText.value("剧本房间", "Script Room"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(AppColors.cardBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .hidesTabBarOnPush()
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton { navigator.pop() }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    if viewModel.hasAuthoritativeRoom, viewModel.room?.status == .active {
                        Button(role: .destructive) { showEndConfirmation = true } label: {
                            Label(ScriptText.value("结束剧情", "End story"), systemImage: "stop.circle")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundColor(AppColors.primaryText)
                }
            }
        }
        .onAppear {
            isViewVisible = true
            viewModel.setVisible(true)
        }
        .task {
            hasCompletedInitialLoad = false
            await viewModel.load()
            guard !Task.isCancelled, isViewVisible else { return }
            hasCompletedInitialLoad = true
        }
        .onDisappear {
            isViewVisible = false
            viewModel.setVisible(false)
        }
        .confirmationDialog(
            ScriptText.value("结束当前剧情？", "End this story?"),
            isPresented: $showEndConfirmation,
            titleVisibility: .visible
        ) {
            Button(ScriptText.value("结束剧情", "End story"), role: .destructive) {
                Task { _ = await viewModel.endRoom() }
            }
            Button(ScriptText.value("取消", "Cancel"), role: .cancel) { }
        } message: {
            Text(ScriptText.value("结束后仍可查看历史消息，但不能继续发送。", "History remains readable, but no new turns can be sent."))
        }
        .toast(message: $viewModel.errorMessage, duration: 3)
    }

    private func roleRoster(_ room: ScriptRoom) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(room.scriptSnapshot.roles) { role in
                    let assignment = room.assignments.first { $0.roleID == role.roleID }
                    VStack(spacing: 4) {
                        ZStack(alignment: .bottomTrailing) {
                            ScriptRemoteImage(
                                urlString: role.avatarURL,
                                cornerRadius: 20,
                                fallbackSystemImage: "person.fill"
                            )
                                .frame(width: 40, height: 40)
                                .clipShape(Circle())
                            Circle()
                                .fill(assignment?.actorType == .user ? AppColors.online : AppColors.accent)
                                .frame(width: 12, height: 12)
                                .overlay(
                                    Image(systemName: assignment?.actorType == .user ? "person.fill" : "sparkles")
                                        .font(.system(size: 6, weight: .bold))
                                        .foregroundColor(.white)
                                )
                                .overlay(Circle().stroke(AppColors.cardBackground, lineWidth: 1.5))
                        }
                        Text(role.name)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                    }
                    .frame(width: 52)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .background(AppColors.cardBackground)
        .overlay(Divider(), alignment: .bottom)
        .onTapGesture { dismissInput() }
    }

    private func messages(_ room: ScriptRoom) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    Color.clear
                        .frame(height: 1)
                        .id(bottomScrollAnchorID)

                    LazyVStack(spacing: 13) {
                        turnStateView
                            .id("script-turn-state")
                            .flippedRow()

                        ForEach(viewModel.messages.reversed()) { message in
                            let isPlayer = isCurrentPlayer(message)
                            ScriptRoomMessageRow(
                                message: message,
                                role: role(for: message, in: room),
                                isCurrentPlayer: isPlayer
                            )
                            .id(message.id)
                            .flippedRow()
                        }

                        storyHeader(room)
                            .flippedRow()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 14)
                }
            }
            .rotationEffect(.degrees(180))
            .scaleEffect(x: -1, y: 1, anchor: .center)
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .simultaneousGesture(
                TapGesture().onEnded { dismissInput() }
            )
            // Match direct/group chat: opening the conversation lands on the
            // latest message without animating through the history. Only a
            // message that arrives after the initial load should animate.
            .onChange(of: viewModel.messages.last?.id) { _ in
                guard hasCompletedInitialLoad else { return }
                requestScrollToBottom()
            }
            .onChange(of: viewModel.turnState?.status) { _ in
                guard hasCompletedInitialLoad else { return }
                requestScrollToBottom()
            }
            .onChange(of: scrollRequest) { _ in
                scrollToBottom(proxy: proxy)
            }
        }
    }

    private func storyHeader(_ room: ScriptRoom) -> some View {
        HStack(alignment: .top, spacing: 10) {
            ScriptRemoteImage(urlString: room.scriptSnapshot.coverURL, cornerRadius: 12)
                .frame(width: 96, height: 72)
                .clipped()
            Text(room.scriptSnapshot.synopsis)
                .font(.system(size: 13))
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .background(AppColors.cardBackground.opacity(0.92))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder
    private var turnStateView: some View {
        if viewModel.isGenerating {
            HStack(spacing: 9) {
                ProgressView().tint(AppColors.accent)
                Text(
                    viewModel.turnState?.status == .queued
                        ? ScriptText.value("剧情回合排队中…", "Turn queued…")
                        : ScriptText.value("AI 角色正在接续剧情…", "AI character is continuing the story…")
                )
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
            }
            .padding(12)
            .background(AppColors.cardBackground)
            .clipShape(Capsule())
        } else if viewModel.failedTurnID != nil {
            VStack(spacing: 8) {
                Label(ScriptText.value("本轮生成失败", "This turn failed"), systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(AppColors.errorColor)
                Button(ScriptText.value("重试 AI 回复", "Retry AI reply")) {
                    Task { await viewModel.retryFailedTurn() }
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(AppColors.accent)
            }
            .padding(12)
            .frame(maxWidth: .infinity)
            .background(AppColors.errorColor.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        } else if viewModel.room?.status == .ended {
            Text(ScriptText.value("剧情已结束", "Story ended"))
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(AppColors.secondaryText)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(AppColors.cardBackground)
                .clipShape(Capsule())
        }
    }

    private var inputBar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(alignment: .bottom, spacing: 10) {
                TextField(
                    viewModel.room?.status == .ended
                        ? ScriptText.value("剧情已结束", "Story ended")
                        : ScriptText.value("以角色身份推进剧情…", "Continue in character…"),
                    text: $viewModel.inputText,
                    axis: .vertical
                )
                .lineLimit(1...5)
                .focused($isInputFocused)
                .disabled(
                    !viewModel.hasAuthoritativeRoom
                        || viewModel.room?.status != .active
                        || viewModel.isGenerating
                )
                .padding(.horizontal, 13)
                .padding(.vertical, 10)
                .background(AppColors.secondaryBackground)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .onChange(of: viewModel.inputText) {
                    viewModel.inputText = String($0.prefix(1000))
                }

                Button { viewModel.submit() } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 38, height: 38)
                        .background(viewModel.canSend ? AnyShapeStyle(AppColors.accentGradient) : AnyShapeStyle(AppColors.tertiaryText))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(!viewModel.canSend)
                .accessibilityLabel(ScriptText.value("发送回合", "Send turn"))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        }
        .background(AppColors.cardBackground)
    }

    private func requestScrollToBottom() {
        scrollRequest += 1
    }

    private func scrollToBottom(proxy: ScrollViewProxy, animated: Bool = true) {
        guard isViewVisible else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            guard isViewVisible else { return }
            let action = {
                proxy.scrollTo(bottomScrollAnchorID, anchor: .top)
            }
            if animated {
                withAnimation(.easeOut(duration: 0.2), action)
            } else {
                action()
            }
        }
    }

    private func role(for message: GroupMessage, in room: ScriptRoom) -> ScriptRole? {
        guard let roleID = message.scriptContext?.roleID else { return nil }
        return room.scriptSnapshot.roles.first { $0.roleID == roleID }
    }

    private func isCurrentPlayer(_ message: GroupMessage) -> Bool {
        if let actorType = message.scriptContext?.actorType { return actorType == .user }
        return message.senderID == AuthManager.shared.currentUser?.userID
    }

    private func dismissInput() {
        isInputFocused = false
        hideKeyboard()
    }
}

private struct ScriptRoomMessageRow: View {
    let message: GroupMessage
    let role: ScriptRole?
    let isCurrentPlayer: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isCurrentPlayer { Spacer(minLength: 52) }

            if !isCurrentPlayer { avatar }

            VStack(alignment: isCurrentPlayer ? .trailing : .leading, spacing: 4) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 5) {
                        Text(role?.name ?? message.senderNickname)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(
                                isCurrentPlayer
                                    ? Color.white.opacity(0.82)
                                    : AppColors.secondaryText
                            )
                        if !isCurrentPlayer {
                            Text("AI")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundColor(AppColors.accent)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(AppColors.accentLight)
                                .clipShape(Capsule())
                        }
                    }

                    Text(message.content)
                        .font(.system(size: 15))
                        .foregroundColor(isCurrentPlayer ? .white : AppColors.receivedBubbleText)
                        .textSelection(.enabled)
                }
                .padding(.horizontal, 13)
                .padding(.vertical, 10)
                .background(
                    isCurrentPlayer
                        ? AnyShapeStyle(AppColors.sentBubbleGradient)
                        : AnyShapeStyle(AppColors.cardBackground)
                )
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    if !isCurrentPlayer {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(AppColors.separator, lineWidth: 1)
                    }
                }
                .shadow(
                    color: isCurrentPlayer ? .clear : Color.black.opacity(0.055),
                    radius: 4,
                    y: 2
                )

            }

            if isCurrentPlayer { avatar }
            if !isCurrentPlayer { Spacer(minLength: 52) }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var avatar: some View {
        if let scriptAvatarURL {
            ScriptRemoteImage(
                urlString: scriptAvatarURL,
                cornerRadius: 16,
                fallbackSystemImage: "person.fill"
            )
                .frame(width: 32, height: 32)
                .clipShape(Circle())
        } else {
            AvatarView(url: message.senderAvatar, size: 32)
        }
    }

    private var scriptAvatarURL: String? {
        guard message.senderID.hasPrefix("script-role:") || message.scriptContext != nil else {
            return nil
        }
        if isCurrentPlayer, let role, !role.avatarURL.isBlank { return role.avatarURL }
        if !message.senderAvatar.isBlank { return message.senderAvatar }
        if let role, !role.avatarURL.isBlank { return role.avatarURL }
        return ""
    }
}
