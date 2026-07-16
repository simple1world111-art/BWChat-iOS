// BWChat/Views/AgentChatView.swift

import PhotosUI
import SwiftUI
import UIKit

struct AgentChatView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var viewModel: AgentChatViewModel
    @State private var inputText = ""
    @State private var selectedItem: PhotosPickerItem?
    @State private var composerImages: [AgentComposerImage] = []
    @State private var isLoadingSelections = false
    @State private var scrollRequest = 0
    @State private var hasCompletedInitialLoad = false
    @State private var isInputFocused = false
    @State private var inputTextHeight: CGFloat = 40
    @State private var composerSelection = NSRange(location: 0, length: 0)
    @State private var isOpeningAgentSettings = false
    @State private var isSubmitting = false
    @State private var isViewVisible = false
    private let onWalletBalanceChange: (Int) -> Void
    private let composerActionButtonHeight: CGFloat = 54
    private let bottomScrollAnchorID = "agent-chat-bottom"

    init(
        conversation: AgentConversation,
        runtimeConfig: AgentRuntimeConfig? = nil,
        walletBalance: Int? = nil,
        onWalletBalanceChange: @escaping (Int) -> Void = { _ in }
    ) {
        _viewModel = StateObject(wrappedValue: AgentChatViewModel(
            conversation: conversation,
            runtimeConfig: runtimeConfig,
            walletBalance: walletBalance
        ))
        self.onWalletBalanceChange = onWalletBalanceChange
    }

    var body: some View {
        messageList
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composer
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(viewModel.agentDisplayName)
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    AgentAvatarView(
                        assetID: viewModel.agentAvatarAssetID,
                        size: 28
                    )
                    Text(viewModel.agentDisplayName)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    Task { await openAgentSettings() }
                } label: {
                    if isOpeningAgentSettings {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "slider.horizontal.3")
                            .font(.system(size: 16, weight: .semibold))
                    }
                }
                .disabled(isOpeningAgentSettings)
                .accessibilityLabel("调整智能体配置")
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button(L10n.tr("common.done")) {
                    isInputFocused = false
                    hideKeyboard()
                }
                .font(.system(size: 15, weight: .semibold))
            }
        }
        .task {
            hasCompletedInitialLoad = false
            await viewModel.load()
            guard !Task.isCancelled, isViewVisible else { return }
            hasCompletedInitialLoad = true
        }
        .onAppear {
            isViewVisible = true
        }
        .onDisappear {
            isViewVisible = false
            viewModel.stop()
            if let balance = viewModel.walletBalance { onWalletBalanceChange(balance) }
        }
        .onChange(of: scenePhase) { phase in
            Task { await viewModel.setSceneActive(phase == .active) }
        }
        .onChange(of: selectedItem) { item in
            guard let item else { return }
            Task { await loadSelectedImage(item) }
        }
        // Watching the last ID, rather than the count, avoids jumping back to
        // the newest message when older history is paged in.
        .onChange(of: viewModel.messages.last?.id) { _ in
            guard hasCompletedInitialLoad else { return }
            scrollRequest += 1
        }
        .onChange(of: viewModel.currentTurn?.status) { _ in
            guard hasCompletedInitialLoad else { return }
            scrollRequest += 1
        }
        .onChange(of: viewModel.errorMessage) { message in
            guard hasCompletedInitialLoad, message != nil else { return }
            scrollRequest += 1
        }
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 0) {
                    Color.clear
                        .frame(height: 1)
                        .id(bottomScrollAnchorID)

                    LazyVStack(spacing: 10) {
                        agentConversationTail
                            .flippedRow()

                        ForEach(viewModel.messages.reversed()) { message in
                            AgentMessageView(
                                message: message,
                                agentAvatarAssetID: viewModel.agentAvatarAssetID,
                                unlockingMediaIDs: viewModel.unlockingMediaIDs,
                                onUnlock: { id in Task { await viewModel.unlockMedia(id: id) } },
                                onImageTap: handleImageTap
                            )
                            .id(message.id)
                            .flippedRow()
                        }

                        if viewModel.hasMore {
                            Button {
                                Task { await viewModel.loadMore() }
                            } label: {
                                if viewModel.isLoadingMore {
                                    ProgressView()
                                } else {
                                    Text("加载更早消息")
                                        .font(.system(size: 13, weight: .semibold))
                                }
                            }
                            .padding(.vertical, 8)
                            .flippedRow()
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 14)
                }
            }
            .rotationEffect(.degrees(180))
            .scaleEffect(x: -1, y: 1, anchor: .center)
            .scrollDismissesKeyboard(.interactively)
            .simultaneousGesture(
                TapGesture().onEnded {
                    isInputFocused = false
                    hideKeyboard()
                }
            )
            .onChange(of: scrollRequest) { _ in
                scrollToBottom(proxy: proxy)
            }
        }
    }

    private var agentConversationTail: some View {
        VStack(spacing: 10) {
            if let turn = viewModel.currentTurn, !turn.isTerminal {
                AgentTurnProgressView(status: turn.status)
            }

            if let notice = viewModel.turnNotice {
                AgentTurnNoticeView(notice: notice) {
                    Task { await viewModel.retryFailedTurn() }
                }
            }

            if viewModel.requiresLatestVersionConversation {
                AgentVersionNoticeView(
                    isWorking: viewModel.isCreatingLatestVersionConversation,
                    startLatestConversation: {
                        Task { await startLatestAgentConversation() }
                    }
                )
            }

            if viewModel.needsWalletTopUp {
                Button { navigator.push(WalletView()) } label: {
                    Label("点数不足，前往充值", systemImage: "wallet.pass")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                        .padding(12)
                        .background(AppColors.accentLight)
                        .cornerRadius(12)
                }
                .buttonStyle(.plain)
            }

            if let error = viewModel.errorMessage {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.circle")
                    Text(error).lineLimit(3)
                    Spacer(minLength: 0)
                    Button("关闭") { viewModel.errorMessage = nil }
                }
                .font(.system(size: 12))
                .foregroundColor(AppColors.errorColor)
                .padding(10)
                .background(AppColors.errorColor.opacity(0.08))
                .cornerRadius(10)
            }
        }
    }

    @MainActor
    private func openAgentSettings() async {
        guard !isOpeningAgentSettings else { return }
        isOpeningAgentSettings = true
        defer { isOpeningAgentSettings = false }

        do {
            let agent = try await APIService.shared.getAgent(id: viewModel.conversation.agentID)
            guard agent.isOwner != false else {
                viewModel.errorMessage = "只能调整自己创建的智能体"
                return
            }
            isInputFocused = false
            hideKeyboard()
            navigator.push(AgentCreatorView(mode: .edit(agent)) { updatedAgent in
                viewModel.applyUpdatedAgent(updatedAgent)
            })
        } catch {
            viewModel.errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private var composer: some View {
        VStack(spacing: 0) {
            if !composerImages.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Label("调整图片", systemImage: "wand.and.stars")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 7)
                            .background(AppColors.accent)
                            .clipShape(Capsule())
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 9)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(composerImages) { image in
                                ZStack(alignment: .topTrailing) {
                                    if let uiImage = UIImage(data: image.data) {
                                        Image(uiImage: uiImage)
                                            .resizable()
                                            .scaledToFill()
                                            .frame(width: 62, height: 62)
                                            .clipShape(RoundedRectangle(cornerRadius: 10))
                                    }
                                    Button {
                                        composerImages.removeAll { $0.id == image.id }
                                    } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .symbolRenderingMode(.palette)
                                            .foregroundStyle(.white, Color.black.opacity(0.6))
                                    }
                                    .offset(x: 5, y: -5)
                                }
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 2)
                    }

                    if let blockReason = imageAdjustmentBlockReason {
                        Label(blockReason, systemImage: "exclamationmark.circle.fill")
                            .font(.system(size: 12))
                            .foregroundColor(AppColors.errorColor)
                            .padding(.horizontal, 12)
                            .padding(.bottom, 4)
                    } else {
                        Text("调整图片模式：描述你希望修改的内容，智能体会基于原图生成调整后的图片")
                            .font(.system(size: 12))
                            .foregroundColor(AppColors.accent)
                            .padding(.horizontal, 12)
                            .padding(.bottom, 4)
                    }
                }
            }

            HStack(alignment: .center, spacing: 6) {
                ZStack(alignment: .leading) {
                    ChatInputTextView(
                        text: $inputText,
                        isFocused: $isInputFocused,
                        height: $inputTextHeight,
                        selectedRange: $composerSelection,
                        onRequestFocus: { isInputFocused = true },
                        onSend: { Task { await send() } }
                    )
                    .frame(height: inputTextHeight)

                    Text(L10n.tr("chat.input.placeholder"))
                        .font(.system(size: 16))
                        .foregroundColor(AppColors.tertiaryText)
                        .padding(.leading, 2)
                        .opacity(inputText.isEmpty && !isInputFocused ? 1 : 0)
                        .allowsHitTesting(false)
                }
                .frame(maxWidth: .infinity)
                .chatComposerFieldChrome(minHeight: inputChromeHeight)

                HStack(spacing: 2) {
                    PhotosPicker(
                        selection: $selectedItem,
                        matching: .images
                    ) {
                        ZStack {
                            if isLoadingSelections {
                                ProgressView()
                                    .tint(AppColors.accent)
                                    .scaleEffect(0.75)
                            } else {
                                Image(systemName: "photo.on.rectangle.angled")
                                    .font(.system(size: 25))
                                    .foregroundColor(AppColors.accent)
                            }
                        }
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(ChatComposerActionButtonStyle(isActive: false))
                    .disabled(isLoadingSelections || !viewModel.canSend)
                    .frame(width: 42, height: composerActionButtonHeight, alignment: .center)

                    Button { Task { await send() } } label: {
                        ZStack {
                            Circle()
                                .fill(canSubmit ? AnyShapeStyle(AppColors.accentGradient) : AnyShapeStyle(AppColors.separator))
                                .frame(width: 40, height: 40)
                            if isSubmitting || viewModel.isSending {
                                ProgressView().tint(.white).scaleEffect(0.7)
                            } else {
                                Image(systemName: "arrow.up")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundColor(canSubmit ? .white : AppColors.tertiaryText)
                            }
                        }
                        .contentShape(Circle())
                    }
                    .buttonStyle(ChatComposerActionButtonStyle(isActive: false))
                    .disabled(!canSubmit)
                    .frame(width: 42, height: composerActionButtonHeight, alignment: .center)
                }
            }
            .padding(.horizontal, 10)
            .padding(.top, 10)
            .padding(.bottom, isInputFocused ? 5 : 12)

        }
        .chatComposerBarBackground()
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

    private var inputChromeHeight: CGFloat {
        inputTextHeight + 14
    }

    private var canSubmit: Bool {
        !isSubmitting
            && viewModel.canSend
            && imageAdjustmentBlockReason == nil
            && (!inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !composerImages.isEmpty)
    }

    private var imageAdjustmentBlockReason: String? {
        guard !composerImages.isEmpty else { return nil }
        return viewModel.imageGenerationPolicy.blockReason
    }

    private func send() async {
        guard !isSubmitting else { return }
        if let blockReason = imageAdjustmentBlockReason {
            viewModel.errorMessage = blockReason
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }
        let sent = await viewModel.send(
            text: inputText,
            images: composerImages,
            imageRequestMode: composerImages.isEmpty ? .analyze : .transform
        )
        if sent {
            inputText = ""
            composerImages = []
            selectedItem = nil
        }
    }

    private func handleImageTap(url: String, frame: CGRect) {
        isInputFocused = false
        hideKeyboard()
        let imageURLs = AgentGalleryMediaResolver.imageURLs(in: viewModel.messages)
        let galleryURLs = imageURLs.contains(url) ? imageURLs : [url]
        ImageGalleryState.shared.show(
            urls: galleryURLs,
            index: galleryURLs.firstIndex(of: url) ?? 0,
            sourceFrame: frame
        )
    }

    @MainActor
    private func startLatestAgentConversation() async {
        guard let conversation = await viewModel.createConversationForLatestAgentVersion() else { return }
        navigator.push(AgentChatView(
            conversation: conversation,
            runtimeConfig: viewModel.runtimeConfig,
            walletBalance: viewModel.walletBalance,
            onWalletBalanceChange: onWalletBalanceChange
        ))
    }

    private func loadSelectedImage(_ item: PhotosPickerItem) async {
        isLoadingSelections = true
        defer {
            isLoadingSelections = false
            selectedItem = nil
        }
        guard !Task.isCancelled,
              let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data),
              let jpeg = image.jpegData(compressionQuality: 0.9) else { return }
        composerImages = [AgentComposerImage(data: jpeg)]
    }
}

private struct AgentVersionNoticeView: View {
    let isWorking: Bool
    let startLatestConversation: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Label("智能体新版本已发布", systemImage: "arrow.triangle.2.circlepath")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
            Text("当前对话仍使用旧版本。新配置和图片能力需要在新会话中生效。")
                .font(.system(size: 12))
                .foregroundColor(AppColors.secondaryText)
            Button(action: startLatestConversation) {
                HStack(spacing: 7) {
                    if isWorking { ProgressView().controlSize(.small) }
                    Text(isWorking ? "正在创建…" : "使用新版本开始对话")
                        .font(.system(size: 13, weight: .semibold))
                }
                .foregroundColor(AppColors.accent)
            }
            .buttonStyle(.plain)
            .disabled(isWorking)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(AppColors.accentLight)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct AgentTurnProgressView: View {
    let status: String
    var body: some View {
        HStack(spacing: 9) {
            ProgressView().scaleEffect(0.8)
            Text(status == "waiting_tools" ? "文字回复已到达，图片仍在生成…" : "智能体正在回复…")
                .font(.system(size: 13))
                .foregroundColor(AppColors.secondaryText)
            Spacer()
        }
        .padding(12)
        .background(AppColors.cardBackground)
        .cornerRadius(12)
    }
}

private struct AgentTurnNoticeView: View {
    let notice: AgentTurnNotice
    let retry: () -> Void

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: notice.isFailure ? "exclamationmark.triangle.fill" : "info.circle.fill")
            Text(notice.message)
                .font(.system(size: 13))
                .multilineTextAlignment(.leading)
            Spacer()
            if notice.allowsRetry {
                Button("重试", action: retry)
                    .font(.system(size: 13, weight: .semibold))
            }
        }
        .foregroundColor(notice.isFailure ? AppColors.errorColor : AppColors.warningColor)
        .padding(12)
        .background((notice.isFailure ? AppColors.errorColor : AppColors.warningColor).opacity(0.08))
        .cornerRadius(12)
    }
}
