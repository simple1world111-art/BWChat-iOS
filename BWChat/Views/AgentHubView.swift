// BWChat/Views/AgentHubView.swift

import SwiftUI

struct AgentHubView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var viewModel = AgentCatalogViewModel()

    var body: some View {
        content
        .background(AppColors.secondaryBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("智能体")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    navigator.push(AgentCreatorView(mode: .create, onSaved: viewModel.upsertInstalled))
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .semibold))
                }
                .accessibilityLabel("创建智能体")
            }
        }
        .task { await viewModel.load() }
        .onReceive(NotificationCenter.default.publisher(for: .conversationListNeedsReload)) { _ in
            Task { await viewModel.load(forceRefresh: true) }
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            Task { await viewModel.refreshRuntimeConfigIfStale() }
        }
        .refreshable { await viewModel.load(forceRefresh: true) }
        .overlay(alignment: .bottom) { errorBanner }
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading && !viewModel.hasLoadedContent {
            ProgressView("正在加载智能体…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            myAgentsContent
        }
    }

    private var myAgentsContent: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if !viewModel.conversations.isEmpty {
                    sectionTitle("最近会话")
                    ForEach(viewModel.conversations) { conversation in
                        Button { open(conversation) } label: {
                            AgentConversationRow(conversation: conversation)
                        }
                        .buttonStyle(.plain)
                    }
                }

                if !viewModel.joinedScriptRooms.isEmpty {
                    sectionTitle("我加入的剧本")
                    ForEach(viewModel.joinedScriptRooms) { conversation in
                        Button { openScriptRoom(conversation) } label: {
                            JoinedScriptRoomRow(conversation: conversation)
                        }
                        .buttonStyle(.plain)
                    }
                }

                sectionTitle("我的智能体")
                if viewModel.installedAgents.isEmpty {
                    VStack(spacing: 16) {
                        AgentHubEmptyState(
                            title: "还没有创建智能体",
                            subtitle: "创建一个有独立形象和性格的智能体"
                        )
                        Button {
                            navigator.push(AgentCreatorView(mode: .create, onSaved: viewModel.upsertInstalled))
                        } label: {
                            Label("创建智能体", systemImage: "plus.circle.fill")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 22)
                                .frame(height: 44)
                                .background(AppColors.accent)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                } else {
                    ForEach(viewModel.installedAgents) { agent in
                        Button { open(agent) } label: {
                            AgentCatalogRow(
                                agent: agent,
                                trailingTitle: "聊天",
                                isWorking: viewModel.openingAgentIDs.contains(agent.id)
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(viewModel.openingAgentIDs.contains(agent.id))
                        .contextMenu {
                            if agent.isOwner == true {
                                Button {
                                    navigator.push(AgentCreatorView(
                                        mode: .edit(agent),
                                        onSaved: viewModel.upsertInstalled
                                    ))
                                } label: {
                                    Label("调整智能体", systemImage: "slider.horizontal.3")
                                }
                            }
                            Button(role: .destructive) {
                                Task { await viewModel.uninstall(agent) }
                            } label: {
                                Label("从我的智能体中移除", systemImage: "trash")
                            }
                        }
                        .disabled(viewModel.removingAgentIDs.contains(agent.id))
                    }
                }
            }
            .padding(16)
            .padding(.bottom, 60)
        }
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 13, weight: .semibold))
            .foregroundColor(AppColors.secondaryText)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 4)
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let error = viewModel.errorMessage {
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.circle.fill")
                Text(error).font(.system(size: 13)).lineLimit(2)
                Spacer(minLength: 0)
                Button("关闭") { viewModel.errorMessage = nil }
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundColor(.white)
            .padding(12)
            .background(AppColors.errorColor.opacity(0.95))
            .cornerRadius(12)
            .padding(16)
        }
    }

    private func open(_ agent: AgentSummary) {
        Task {
            guard let conversation = await viewModel.conversation(for: agent) else { return }
            open(conversation)
        }
    }

    private func open(_ conversation: AgentConversation) {
        navigator.push(AgentChatView(
            conversation: conversation,
            runtimeConfig: viewModel.runtimeConfig,
            spendableBalance: viewModel.spendableBalance,
            onSpendableBalanceChange: viewModel.updateSpendableBalance
        ))
    }

    private func openScriptRoom(_ conversation: Conversation) {
        guard let roomID = conversation.scriptRoomID, !roomID.isBlank else { return }
        let initialRoom = ScriptRoomLocalCache.cachedRoom(roomID: roomID)
            ?? ScriptRoom(provisionalConversationRow: conversation)
        navigator.push(ScriptRoomChatView(roomID: roomID, initialRoom: initialRoom))
    }
}

private struct AgentCatalogRow: View {
    let agent: AgentSummary
    let trailingTitle: String
    let isWorking: Bool

    var body: some View {
        HStack(spacing: 12) {
            AgentAvatarView(assetID: agent.resolvedAvatarAssetID, size: 54)
            VStack(alignment: .leading, spacing: 5) {
                Text(agent.displayName)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)
                Text(agent.profile?.tagline ?? agent.profile?.description ?? "开始一段新对话")
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    if let visibility = agent.visibility {
                        AgentTag(text: visibility == "public" ? "公开" : "私有")
                    }
                    if agent.capabilities?.paidImages == true {
                        AgentTag(text: "图片")
                    }
                }
            }
            Spacer(minLength: 8)
            if isWorking {
                ProgressView().scaleEffect(0.8)
            } else {
                Text(trailingTitle)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(AppColors.accent)
            }
        }
        .padding(14)
        .background(AppColors.cardBackground)
        .cornerRadius(14)
    }
}

private struct AgentConversationRow: View {
    let conversation: AgentConversation

    var body: some View {
        HStack(spacing: 12) {
            AgentAvatarView(assetID: conversation.agentProfile.avatarAssetID, size: 50)
            VStack(alignment: .leading, spacing: 5) {
                Text(conversation.agentProfile.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                Text(previewText)
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)
        }
        .padding(14)
        .background(AppColors.cardBackground)
        .cornerRadius(14)
    }

    private var previewText: String {
        AgentConversationPreviewResolver.text(
            for: conversation.latestMessage,
            fallback: conversation.title
        )
    }
}

private struct JoinedScriptRoomRow: View {
    let conversation: Conversation

    var body: some View {
        HStack(spacing: 12) {
            ScriptRemoteImage(
                urlString: conversation.avatarURL,
                cornerRadius: 11,
                fallbackSystemImage: "book.closed.fill"
            )
            .frame(width: 54, height: 54)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    Text(conversation.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                    AgentTag(text: "剧本")
                }
                Text(previewText)
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 7) {
                if !conversation.formattedTime.isBlank {
                    Text(conversation.formattedTime)
                        .font(.system(size: 11))
                        .foregroundColor(AppColors.tertiaryText)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(AppColors.tertiaryText)
            }
        }
        .padding(14)
        .background(AppColors.cardBackground)
        .cornerRadius(14)
        .contentShape(Rectangle())
    }

    private var previewText: String {
        guard let value = conversation.lastMessage?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return "继续你的剧情" }
        return value
    }
}

struct AgentAvatarView: View {
    let assetID: String?
    let size: CGFloat
    var cornerRadius: CGFloat? = nil
    @State private var image: UIImage?

    init(assetID: String?, size: CGFloat, cornerRadius: CGFloat? = nil) {
        self.assetID = assetID
        self.size = size
        self.cornerRadius = cornerRadius

        let path = Self.resolvedPath(for: assetID)
        _image = State(initialValue: path.flatMap(ImageCacheManager.shared.image(for:)))
    }

    private var resolvedCornerRadius: CGFloat {
        cornerRadius ?? size * 0.22
    }

    private var resolvedPath: String? {
        Self.resolvedPath(for: assetID)
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: resolvedCornerRadius, style: .continuous))
        .onAppear {
            guard let resolvedPath else { return }
            if let cached = ImageCacheManager.shared.image(for: resolvedPath) {
                setImageWithoutAnimation(cached)
            }
        }
        .task(id: assetID) {
            let requestedPath = resolvedPath
            guard let requestedPath else {
                setImageWithoutAnimation(nil)
                return
            }

            if let cached = ImageCacheManager.shared.image(for: requestedPath) {
                setImageWithoutAnimation(cached)
                return
            }

            setImageWithoutAnimation(nil)
            let loaded = await ImageCacheManager.shared.loadImage(from: requestedPath)
            guard !Task.isCancelled, requestedPath == resolvedPath else { return }
            setImageWithoutAnimation(loaded)
        }
    }

    private func setImageWithoutAnimation(_ newImage: UIImage?) {
        var transaction = Transaction()
        transaction.animation = nil
        withTransaction(transaction) {
            image = newImage
        }
    }

    private static func resolvedPath(for assetID: String?) -> String? {
        guard let assetID, !assetID.isBlank else { return nil }
        return MediaURLResolver.resolve("/agent-assets/\(assetID)")?.absoluteString
    }

    private var placeholder: some View {
        ZStack {
            AppColors.accentGradient
            Image(systemName: "sparkles")
                .font(.system(size: size * 0.34, weight: .semibold))
                .foregroundColor(.white)
        }
    }
}

private struct AgentTag: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundColor(AppColors.accent)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(AppColors.accentLight)
            .clipShape(Capsule())
    }
}

private struct AgentHubEmptyState: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "sparkles.rectangle.stack")
                .font(.system(size: 34, weight: .medium))
                .foregroundColor(AppColors.tertiaryText)
            Text(title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
            Text(subtitle)
                .font(.system(size: 13))
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 70)
    }
}
