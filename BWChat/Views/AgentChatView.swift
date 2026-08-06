// BWChat/Views/AgentChatView.swift

import Combine
import PhotosUI
import SceneKit
import SwiftUI
import UIKit

private struct AgentOptimisticTextSubmission: Identifiable, Equatable {
    let id = UUID()
    let text: String
}

struct AgentChatView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var viewModel: AgentChatViewModel
    @State private var inputText = ""
    @State private var selectedItem: PhotosPickerItem?
    @State private var composerImages: [AgentComposerImage] = []
    @State private var isLoadingSelections = false
    @State private var imageReplyTarget: AgentImageReplyTarget?
    @State private var isLoadingReplyImage = false
    @State private var imageMessageMenuTarget: MessageMenuTarget?
    @State private var pendingImageReplyTarget: AgentImageReplyTarget?
    @State private var isImageMenuTouchSequenceActive = false
    @State private var scrollRequest = 0
    @State private var hasCompletedInitialLoad = false
    @State private var isInputFocused = false
    @State private var inputTextHeight: CGFloat = 40
    @State private var composerSelection = NSRange(location: 0, length: 0)
    @State private var isOpeningAgentSettings = false
    @State private var isVideoRoleDialogPresented = false
    @State private var isLoadingVideoRoleDialog = false
    @StateObject private var videoMatchCoordinator = AgentLiveVideoMatchCoordinator()
    @State private var isSubmitting = false
    @State private var optimisticTextSubmission: AgentOptimisticTextSubmission?
    @State private var isViewVisible = false
    private let onSpendableBalanceChange: (Int) -> Void
    private let composerActionButtonHeight: CGFloat = 54
    private let composerActionButtonWidth: CGFloat = 42
    private let composerActionsSpacing: CGFloat = 2
    private let composerFocusAnimation = Animation.easeInOut(duration: 0.25)
    private let bottomScrollAnchorID = "agent-chat-bottom"

    init(
        conversation: AgentConversation,
        runtimeConfig: AgentRuntimeConfig? = nil,
        spendableBalance: Int? = nil,
        onSpendableBalanceChange: @escaping (Int) -> Void = { _ in }
    ) {
        let model = AgentChatViewModel(
            conversation: conversation,
            runtimeConfig: runtimeConfig,
            spendableBalance: spendableBalance
        )
        _viewModel = StateObject(wrappedValue: model)
        self.onSpendableBalanceChange = onSpendableBalanceChange
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
            dismissImageMessageMenu()
            dismissVideoRoleDialog(animated: false)
            videoMatchCoordinator.cancel()
            viewModel.stop()
            if let balance = viewModel.spendableBalance { onSpendableBalanceChange(balance) }
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
                                onUnlock: { id, paymentMethod in
                                    Task {
                                        await viewModel.unlockMedia(
                                            id: id,
                                            paymentMethod: paymentMethod
                                        )
                                    }
                                },
                                onImageTap: handleImageTap,
                                replyImageTarget: replyImageTarget(for: message),
                                onImageMenuRequested: presentImageMessageMenu,
                                onImageMenuTouchSequenceEnded: finishImageMenuTouchSequence
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
                    dismissImageMessageMenuFromBackgroundInteraction()
                    isInputFocused = false
                    hideKeyboard()
                }
            )
            .simultaneousGesture(
                DragGesture(minimumDistance: 8).onChanged { _ in
                    dismissImageMessageMenuFromBackgroundInteraction()
                }
            )
            .onChange(of: scrollRequest) { _ in
                scrollToBottom(proxy: proxy)
            }
        }
    }

    private var agentConversationTail: some View {
        VStack(spacing: 10) {
            if let optimisticTextSubmission {
                AgentOptimisticTextBubble(text: optimisticTextSubmission.text)
                    .id(optimisticTextSubmission.id)
            }

            if let status = viewModel.turnProgressStatus {
                AgentTurnProgressView(status: status)
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
            if isLoadingReplyImage {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("正在载入回复图片…")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }

            if !composerImages.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    if let imageReplyTarget {
                        ImageReplyReferenceView(
                            senderName: imageReplyTarget.senderLabel,
                            detailText: "输入调整要求",
                            style: .composer,
                            onCancel: clearImageReply
                        ) {
                            AgentAuthenticatedImage(path: imageReplyTarget.imagePath)
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 9)
                        .padding(.bottom, imageAdjustmentBlockReason == nil ? 8 : 0)
                    }

                    if imageReplyTarget == nil {
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
                    }

                    if let blockReason = imageAdjustmentBlockReason {
                        Label(blockReason, systemImage: "exclamationmark.circle.fill")
                            .font(.system(size: 12))
                            .foregroundColor(AppColors.errorColor)
                            .padding(.horizontal, 12)
                            .padding(.bottom, 4)
                    } else if imageReplyTarget == nil {
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
                        returnKeyType: .send,
                        enablesReturnKeyAutomatically: true,
                        onRequestFocus: { isInputFocused = true },
                        onSend: { submittedText in
                            Task { await send(submittedText: submittedText) }
                        }
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

                composerActions
            }
            .padding(.horizontal, 10)
            .padding(.top, 10)
            .padding(.bottom, isInputFocused ? 5 : 12)
            .animation(composerFocusAnimation, value: isInputFocused)

        }
        .chatComposerBarBackground()
    }

    private var composerActions: some View {
        ZStack(alignment: .trailing) {
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
            .disabled(isLoadingSelections || isLoadingReplyImage || !viewModel.canSend)
            .frame(
                width: composerActionButtonWidth,
                height: composerActionButtonHeight,
                alignment: .center
            )
            .offset(x: -(composerActionButtonWidth + composerActionsSpacing))
            .opacity(isInputFocused ? 0 : 1)
            .allowsHitTesting(!isInputFocused)
            .accessibilityHidden(isInputFocused)

            Button {
                Task { await presentVideoRoleDialog() }
            } label: {
                ZStack {
                    if isLoadingVideoRoleDialog {
                        ProgressView()
                            .tint(AppColors.accent)
                            .scaleEffect(0.75)
                    } else {
                        Image(systemName: "video.fill")
                            .font(.system(size: 23))
                            .foregroundColor(AppColors.accent)
                    }
                }
                .frame(width: 40, height: 40)
                .contentShape(Rectangle())
            }
            .buttonStyle(ChatComposerActionButtonStyle(isActive: false))
            .disabled(
                isLoadingSelections
                    || isLoadingReplyImage
                    || isLoadingVideoRoleDialog
                    || !viewModel.canSend
            )
            .frame(
                width: composerActionButtonWidth,
                height: composerActionButtonHeight,
                alignment: .center
            )
            .accessibilityLabel("发送视频")
            .opacity(isInputFocused ? 0 : 1)
            .allowsHitTesting(!isInputFocused)
            .accessibilityHidden(isInputFocused)

            Button { Task { await send() } } label: {
                ZStack {
                    Circle()
                        .fill(
                            canSubmit
                                ? AnyShapeStyle(AppColors.accentGradient)
                                : AnyShapeStyle(AppColors.separator)
                        )
                        .frame(width: 40, height: 40)
                    if isSubmitting || viewModel.isSending {
                        ProgressView()
                            .tint(.white)
                            .scaleEffect(0.7)
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
            .frame(
                width: composerActionButtonWidth,
                height: composerActionButtonHeight,
                alignment: .center
            )
            .opacity(isInputFocused ? 1 : 0)
            .allowsHitTesting(isInputFocused)
            .accessibilityHidden(!isInputFocused)
        }
        .frame(
            width: isInputFocused
                ? composerActionButtonWidth
                : composerActionButtonWidth * 2 + composerActionsSpacing,
            height: composerActionButtonHeight,
            alignment: .trailing
        )
    }

    private func scrollToBottom(proxy: ScrollViewProxy, animated: Bool = true) {
        guard isViewVisible else { return }
        Task { @MainActor in
            await Task.yield()
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

    @MainActor
    private func presentVideoRoleDialog() async {
        guard !isLoadingVideoRoleDialog, !isVideoRoleDialogPresented else { return }
        isLoadingVideoRoleDialog = true
        defer { isLoadingVideoRoleDialog = false }

        await LiveLobbyStore.shared.synchronizeCurrentUserLiveStatus(
            user: AuthManager.shared.currentUser
        )
        guard LiveCallInitiationPolicy.canInitiate(
            isCurrentUserLive: LiveLobbyStore.shared.isCurrentUserLive
        ) else {
            viewModel.errorMessage = LiveCallInitiationPolicy.hostingBlockMessage
            return
        }

        isInputFocused = false
        hideKeyboard()

        var role = defaultVideoRole
        if let agent = try? await APIService.shared.getAgent(id: viewModel.conversation.agentID),
           let identity = agent.definition?.identity?.trimmingCharacters(in: .whitespacesAndNewlines),
           !identity.isEmpty {
            role = identity
        }

        guard !Task.isCancelled, isViewVisible else { return }
        videoMatchCoordinator.reset()
        isVideoRoleDialogPresented = true
        navigator.presentAppModalOverlay {
            AgentVideoRoleMatchDialog(
                initialRole: role,
                sourceAgentID: viewModel.conversation.agentID,
                coordinator: videoMatchCoordinator,
                onMatchConnected: { result in
                    dismissVideoRoleDialog()
                    LiveAcceptedCallLauncher.open(
                        peer: result.peer,
                        response: result.response,
                        isOutgoing: true,
                        liveRoleContext: result.liveRoleContext,
                        fallbackCallType: .video,
                        fallbackBillingPolicy: .fallback
                    )
                },
                onDismiss: { dismissVideoRoleDialog() }
            )
        }
    }

    private func dismissVideoRoleDialog(animated: Bool = true) {
        guard isVideoRoleDialogPresented else { return }
        isVideoRoleDialogPresented = false
        navigator.dismissAppOverlay(animated: animated)
    }

    private var defaultVideoRole: String {
        let profile = viewModel.conversation.agentProfile
        return [profile.description, profile.tagline, profile.name]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first(where: { !$0.isEmpty }) ?? "智能体"
    }

    private var canSubmit: Bool {
        !isSubmitting
            && !isLoadingReplyImage
            && viewModel.canSend
            && imageAdjustmentBlockReason == nil
            && (!inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !composerImages.isEmpty)
    }

    private var imageAdjustmentBlockReason: String? {
        guard !composerImages.isEmpty else { return nil }
        return viewModel.imageGenerationPolicy.blockReason
    }

    private func send(submittedText: String? = nil) async {
        guard !isSubmitting else { return }
        if let blockReason = imageAdjustmentBlockReason {
            viewModel.errorMessage = blockReason
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }
        let sourceText = submittedText ?? inputText
        let visibleText = AgentImageRequestMode.userVisibleText(from: sourceText)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let optimisticSubmission = visibleText.isEmpty
            ? nil
            : AgentOptimisticTextSubmission(text: visibleText)
        optimisticTextSubmission = optimisticSubmission
        if optimisticSubmission != nil {
            scrollRequest += 1
        }
        let sent = await viewModel.send(
            text: sourceText,
            images: composerImages,
            imageRequestMode: composerImages.isEmpty ? .analyze : .transform,
            replyToID: imageReplyTarget?.messageID
        )
        if optimisticTextSubmission?.id == optimisticSubmission?.id {
            optimisticTextSubmission = nil
        }
        if sent {
            if submittedText == nil || inputText == sourceText {
                inputText = ""
            }
            composerImages = []
            imageReplyTarget = nil
            selectedItem = nil
        } else if submittedText != nil, inputText.isEmpty {
            // Keyboard submit clears the composer before starting the async
            // request. Restore that snapshot only when the user has not begun
            // composing the next message while the request was in flight.
            inputText = sourceText
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
            sourceFrame: frame,
            sourceContentMode: .fill,
            sourceCornerRadius: ChatMediaLayout.mediaCornerRadius
        )
    }

    @MainActor
    private func startLatestAgentConversation() async {
        guard let conversation = await viewModel.createConversationForLatestAgentVersion() else { return }
        navigator.push(AgentChatView(
            conversation: conversation,
            runtimeConfig: viewModel.runtimeConfig,
            spendableBalance: viewModel.spendableBalance,
            onSpendableBalanceChange: onSpendableBalanceChange
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
        imageReplyTarget = nil
        composerImages = [AgentComposerImage(data: jpeg)]
    }

    @MainActor
    private func beginImageReply(_ target: AgentImageReplyTarget) async {
        guard !isLoadingReplyImage, viewModel.canSend else { return }
        isLoadingReplyImage = true
        defer { isLoadingReplyImage = false }

        do {
            let sourceData = try await APIService.shared.loadImage(path: target.imagePath)
            guard !Task.isCancelled,
                  let sourceImage = UIImage(data: sourceData),
                  let jpeg = sourceImage.jpegData(compressionQuality: 0.9) else {
                throw APIError.invalidResponse
            }
            composerImages = [AgentComposerImage(data: jpeg)]
            imageReplyTarget = target
            isInputFocused = true
            scrollRequest += 1
        } catch is CancellationError {
            return
        } catch {
            viewModel.errorMessage = "无法读取这张图片，请确认图片已解锁后重试"
        }
    }

    private func clearImageReply() {
        imageReplyTarget = nil
        composerImages = []
    }

    private func presentImageMessageMenu(
        target: AgentImageReplyTarget,
        frame: CGRect
    ) {
        guard imageMessageMenuTarget == nil else { return }
        isImageMenuTouchSequenceActive = true
        pendingImageReplyTarget = target
        let menuTarget = MessageMenuTarget(
            pendingID: target.id,
            anchorFrame: frame,
            actions: [.quote]
        )
        imageMessageMenuTarget = menuTarget
        navigator.presentAppOverlay(animated: false) {
            WeChatMessageActionOverlay(
                target: menuTarget,
                onSelect: handleImageMessageMenuAction,
                onDismiss: dismissImageMessageMenuFromBackgroundInteraction
            )
        }
    }

    private func finishImageMenuTouchSequence() {
        DispatchQueue.main.async {
            isImageMenuTouchSequenceActive = false
        }
    }

    private func dismissImageMessageMenuFromBackgroundInteraction() {
        guard !isImageMenuTouchSequenceActive else { return }
        dismissImageMessageMenu()
    }

    private func dismissImageMessageMenu() {
        guard imageMessageMenuTarget != nil else { return }
        imageMessageMenuTarget = nil
        pendingImageReplyTarget = nil
        navigator.dismissAppOverlay(animated: false)
    }

    private func handleImageMessageMenuAction(_ action: MessageMenuAction) {
        guard action == .quote, let target = pendingImageReplyTarget else {
            dismissImageMessageMenu()
            return
        }
        imageMessageMenuTarget = nil
        pendingImageReplyTarget = nil
        navigator.dismissAppOverlay(animated: false)
        Task { await beginImageReply(target) }
    }

    private func replyImageTarget(for message: AgentMessage) -> AgentImageReplyTarget? {
        AgentHistoryImageReplyResolver.target(for: message, messages: viewModel.messages)
    }
}

private struct AgentOptimisticTextBubble: View {
    let text: String

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Spacer(minLength: 48)
            VStack(alignment: .trailing, spacing: 4) {
                Text(text)
                    .font(.system(size: 15))
                    .foregroundColor(AppColors.sentBubbleText)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 9)
                    .background {
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(AppColors.sentBubbleGradient)
                    }

                ProgressView()
                    .controlSize(.mini)
                    .tint(AppColors.secondaryText)
                    .accessibilityLabel("发送中")
            }
            .frame(maxWidth: 290, alignment: .trailing)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct AgentLiveVideoMatchResult {
    let peer: LiveCallPeer
    let response: CallJoinResponse
    let liveRoleContext: LiveCallRoleContext?
}

@MainActor
private final class AgentLiveVideoMatchCoordinator: ObservableObject {
    enum Status: Equatable {
        case idle
        case matching
        case connecting
        case unavailable(String)
    }

    private enum PendingTerminalEvent {
        case accepted([String: Any])
        case unavailable([String: Any], String)
    }

    @Published private(set) var status: Status = .idle

    private var currentMatchID: String?
    private var acceptedCallID: String?
    private var operationID: UUID?
    private var requestTask: Task<Void, Never>?
    private var pendingTerminalEvent: PendingTerminalEvent?
    private var requestedRoleSetting: String?
    private var onConnected: ((AgentLiveVideoMatchResult) -> Void)?
    private var cancellables = Set<AnyCancellable>()

    init() {
        WebSocketService.shared.liveCallAcceptedPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.receiveAccepted(data)
            }
            .store(in: &cancellables)

        WebSocketService.shared.liveMatchExhaustedPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.receiveUnavailable(data, message: "暂时没有主播接听")
            }
            .store(in: &cancellables)

        WebSocketService.shared.liveMatchCancelledPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                self?.receiveUnavailable(data, message: "匹配已结束")
            }
            .store(in: &cancellables)
    }

    var isActive: Bool {
        status == .matching || status == .connecting
    }

    func start(
        roleSetting: String,
        sourceAgentID: String,
        onConnected: @escaping (AgentLiveVideoMatchResult) -> Void
    ) {
        guard !isActive else { return }
        guard LiveCallInitiationPolicy.canInitiate(
            isCurrentUserLive: LiveLobbyStore.shared.isCurrentUserLive
        ) else {
            status = .unavailable(LiveCallInitiationPolicy.hostingBlockMessage)
            return
        }
        guard CallManager.shared.currentCall == nil,
              !LiveCallCoordinator.shared.hasInvitation else {
            status = .unavailable("当前已有通话或视频邀请")
            return
        }

        clearOperation()
        let newOperationID = UUID()
        let clientMatchID = "match_\(newOperationID.uuidString.lowercased())"
        operationID = newOperationID
        currentMatchID = clientMatchID
        requestedRoleSetting = roleSetting.trimmingCharacters(in: .whitespacesAndNewlines)
        self.onConnected = onConnected
        status = .matching

        requestTask = Task { [weak self] in
            await WalletStore.shared.refreshBalanceFromServer(forceRefresh: true)
            guard let self, self.operationID == newOperationID else { return }
            guard let balance = WalletStore.shared.spendableBalance else {
                self.clearOperation()
                self.status = .unavailable(L10n.tr("activityCatFood.balanceUnavailable"))
                return
            }
            guard LiveCallBillingPolicy.canStart(balance: balance) else {
                self.clearOperation()
                self.status = .unavailable(L10n.tr("activityCatFood.videoInsufficient"))
                return
            }

            do {
                let response = try await APIService.shared.startAgentOneToOneLiveMatch(
                    roleSetting: roleSetting,
                    sourceAgentID: sourceAgentID,
                    clientMatchID: clientMatchID
                )
                guard self.operationID == newOperationID else {
                    try? await APIService.shared.cancelAgentOneToOneLiveMatch(
                        matchID: response.matchID
                    )
                    return
                }
                guard response.matchID == clientMatchID else {
                    try? await APIService.shared.cancelAgentOneToOneLiveMatch(
                        matchID: response.matchID
                    )
                    self.clearOperation()
                    self.status = .unavailable("匹配服务返回异常，请稍后重试")
                    return
                }

                self.currentMatchID = response.matchID
                self.consumePendingTerminalEventIfNeeded()
            } catch {
                guard self.operationID == newOperationID,
                      !TransientHTTPRetryPolicy.isCancellation(error) else { return }
                self.clearOperation()
                let fallback = "暂时无法开始匹配，请稍后重试"
                let message = (error as? LocalizedError)?.errorDescription?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                self.status = .unavailable(
                    (message?.isEmpty == false ? message : nil) ?? fallback
                )
            }
        }
    }

    func cancel() {
        guard isActive else { return }
        let wasConnecting = status == .connecting
        let matchID = currentMatchID
        let callID = acceptedCallID
        clearOperation()
        status = .idle

        Task {
            if wasConnecting, let callID {
                try? await APIService.shared.endCall(callID: callID)
            } else if let matchID {
                try? await APIService.shared.cancelAgentOneToOneLiveMatch(matchID: matchID)
            }
        }
    }

    func reset() {
        if isActive {
            cancel()
        } else {
            clearOperation()
            status = .idle
        }
    }

    private func receiveAccepted(_ data: [String: Any]) {
        guard status == .matching,
              let eventMatchID = Self.string(data, keys: ["match_id"]) else { return }

        guard let currentMatchID else {
            pendingTerminalEvent = .accepted(data)
            return
        }
        guard currentMatchID == eventMatchID else { return }
        connectAcceptedMatch(data)
    }

    private func receiveUnavailable(_ data: [String: Any], message: String) {
        guard status == .matching,
              let eventMatchID = Self.string(data, keys: ["match_id"]) else { return }

        guard let currentMatchID else {
            pendingTerminalEvent = .unavailable(data, message)
            return
        }
        guard currentMatchID == eventMatchID else { return }
        clearOperation()
        status = .unavailable(message)
    }

    private func consumePendingTerminalEventIfNeeded() {
        guard let pendingTerminalEvent else { return }
        self.pendingTerminalEvent = nil

        switch pendingTerminalEvent {
        case .accepted(let data):
            receiveAccepted(data)
        case .unavailable(let data, let message):
            receiveUnavailable(data, message: message)
        }
    }

    private func connectAcceptedMatch(_ data: [String: Any]) {
        guard let operationID,
              let callID = Self.string(data, keys: ["call_id"]),
              let hostUserID = Self.string(data, keys: ["host_id", "callee_id", "user_id"])
        else {
            clearOperation()
            status = .unavailable("主播已接受，但视频信息不完整")
            return
        }

        let peer = LiveCallPeer(
            userID: hostUserID,
            username: Self.string(
                data,
                keys: ["host_username", "callee_username", "username"]
            ) ?? hostUserID,
            avatarURL: Self.string(
                data,
                keys: ["host_avatar_url", "callee_avatar_url", "avatar_url"]
            ) ?? "",
            characterSetting: Self.string(
                data,
                keys: ["character_setting", "role_setting"]
            ) ?? ""
        )
        status = .connecting
        acceptedCallID = callID

        requestTask = Task { [weak self] in
            do {
                let response = try await APIService.shared.joinAcceptedOneToOneLiveCall(
                    callID: callID
                )
                guard let self, self.operationID == operationID else { return }
                let completion = self.onConnected
                let roleContext = LiveCallRoleContext(
                    source: .agentMatch,
                    roleSetting: self.requestedRoleSetting
                )
                self.clearOperation()
                self.status = .idle
                completion?(
                    AgentLiveVideoMatchResult(
                        peer: peer,
                        response: response,
                        liveRoleContext: roleContext
                    )
                )
            } catch {
                guard let self,
                      self.operationID == operationID,
                      !TransientHTTPRetryPolicy.isCancellation(error) else { return }
                self.clearOperation()
                self.status = .unavailable("主播已接受，但视频连接失败，请重新匹配")
                Task { try? await APIService.shared.endCall(callID: callID) }
            }
        }
    }

    private func clearOperation() {
        requestTask?.cancel()
        requestTask = nil
        currentMatchID = nil
        acceptedCallID = nil
        operationID = nil
        pendingTerminalEvent = nil
        requestedRoleSetting = nil
        onConnected = nil
    }

    private static func string(_ data: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let value = data[key] as? String,
               !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return value
            }
            if let value = data[key] as? NSNumber {
                return value.stringValue
            }
        }
        return nil
    }
}

private struct AgentVideoRoleMatchDialog: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var role: String
    @State private var isRoleFocused = false
    @ObservedObject var coordinator: AgentLiveVideoMatchCoordinator

    let sourceAgentID: String
    let onMatchConnected: (AgentLiveVideoMatchResult) -> Void
    let onDismiss: () -> Void

    init(
        initialRole: String,
        sourceAgentID: String,
        coordinator: AgentLiveVideoMatchCoordinator,
        onMatchConnected: @escaping (AgentLiveVideoMatchResult) -> Void,
        onDismiss: @escaping () -> Void
    ) {
        _role = State(initialValue: initialRole)
        _coordinator = ObservedObject(wrappedValue: coordinator)
        self.sourceAgentID = sourceAgentID
        self.onMatchConnected = onMatchConnected
        self.onDismiss = onDismiss
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.34)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture {
                    if isRoleFocused {
                        isRoleFocused = false
                        hideKeyboard()
                    } else if !coordinator.isActive {
                        onDismiss()
                    }
                }

            dialogCard
                .padding(.horizontal, 28)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            KeyboardDismissTapInstaller(
                isEnabled: coordinator.status == .idle && isRoleFocused,
                consumesOutsideTaps: false,
                dismissesOnControls: true
            ) {
                isRoleFocused = false
                hideKeyboard()
            }
        )
        .onDisappear {
            isRoleFocused = false
            hideKeyboard()
            coordinator.cancel()
        }
    }

    private var dialogCard: some View {
        ZStack {
            switch coordinator.status {
            case .idle:
                editorContent
                    .transition(
                        .opacity.combined(with: .scale(scale: 0.98))
                    )
            case .matching:
                AgentMatchingGlobeView(
                    title: "正在匹配",
                    detail: "正在依次联系正在直播的用户",
                    cancel: cancelMatching
                )
                    .transition(
                        .opacity.combined(with: .scale(scale: reduceMotion ? 1 : 0.86))
                    )
            case .connecting:
                AgentMatchingGlobeView(
                    title: "主播已接受",
                    detail: "正在连接视频",
                    cancel: nil
                )
                    .transition(.opacity)
            case .unavailable(let message):
                unavailableContent(message: message)
                    .transition(
                        .opacity.combined(with: .scale(scale: 0.98))
                    )
            }
        }
        .frame(height: coordinator.isActive ? 326 : 224)
        .padding(.horizontal, 18)
        .padding(.vertical, coordinator.isActive ? 10 : 18)
        .frame(maxWidth: 330)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.white.opacity(0.72), lineWidth: 1)
                .allowsHitTesting(false)
        }
        .shadow(color: Color.black.opacity(0.18), radius: 24, x: 0, y: 10)
        .animation(
            reduceMotion
                ? .easeOut(duration: 0.16)
                : .spring(response: 0.38, dampingFraction: 0.82),
            value: coordinator.status
        )
    }

    private func unavailableContent(message: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "video.slash.fill")
                .font(.system(size: 34, weight: .medium))
                .foregroundColor(AppColors.secondaryText)

            Text(message)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
                .multilineTextAlignment(.center)

            Text("可以稍后再试，或调整角色设定后重新匹配")
                .font(.system(size: 13))
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.center)

            HStack(spacing: 12) {
                Button("关闭", action: onDismiss)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .frame(maxWidth: .infinity)
                    .frame(height: 42)
                    .background(AppColors.secondaryBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))

                Button("重新匹配") {
                    coordinator.reset()
                }
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
                .background(AppColors.accentGradient)
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }

    private var editorContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("我希望你能扮演")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(AppColors.primaryText)

            ZStack(alignment: .topLeading) {
                AgentVideoRoleTextView(
                    text: $role,
                    isFocused: $isRoleFocused
                )
                .padding(.horizontal, 12)
                .frame(height: 112)

                if role.isEmpty {
                    Text("请输入角色定位")
                        .font(.system(size: 15))
                        .foregroundColor(AppColors.tertiaryText)
                        .padding(.horizontal, 13)
                        .padding(.vertical, 14)
                        .allowsHitTesting(false)
                }
            }
            .frame(height: 124)
            .background(AppColors.secondaryBackground)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(
                        isRoleFocused ? AppColors.accent.opacity(0.72) : AppColors.separator,
                        lineWidth: isRoleFocused ? 1.5 : 1
                    )
                    .allowsHitTesting(false)
            }
            .animation(.easeOut(duration: 0.16), value: isRoleFocused)

            Button(action: match) {
                HStack(spacing: 9) {
                    Text("匹配")
                        .font(.system(size: 16, weight: .semibold))

                    HStack(spacing: 4) {
                        Image(systemName: "pawprint.fill")
                            .font(.system(size: 11, weight: .semibold))
                        Text("100金币/分钟")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundStyle(Color.white.opacity(0.86))
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 46)
                .background(AppColors.accentGradient)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(trimmedRole.isEmpty)
            .opacity(trimmedRole.isEmpty ? 0.5 : 1)
            .accessibilityLabel("匹配，视频通话每分钟消耗100金币")
        }
    }

    private var trimmedRole: String {
        role.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func match() {
        guard !trimmedRole.isEmpty else { return }
        let requestedRole = trimmedRole
        isRoleFocused = false
        hideKeyboard()
        UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        coordinator.start(
            roleSetting: requestedRole,
            sourceAgentID: sourceAgentID,
            onConnected: onMatchConnected
        )
    }

    private func cancelMatching() {
        coordinator.cancel()
    }
}

private struct AgentMatchingGlobeView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathes = false

    let title: String
    let detail: String
    let cancel: (() -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            globe
                .frame(width: 252, height: 252)

            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
                .padding(.top, 4)

            Text(detail)
                .font(.system(size: 13))
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.top, 2)

            if let cancel {
                Button("取消匹配", action: cancel)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(AppColors.accent)
                    .buttonStyle(.plain)
                    .padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title)，\(detail)")
        .accessibilityAction(named: "取消匹配") { cancel?() }
        .onAppear(perform: startAnimation)
        .onChange(of: reduceMotion) { isReduced in
            if isReduced {
                breathes = false
            } else {
                startAnimation()
            }
        }
    }

    private var globe: some View {
        ZStack {
            RadialGradient(
                colors: [
                    AppColors.accent.opacity(breathes ? 0.22 : 0.13),
                    AppColors.accent.opacity(0)
                ],
                center: .center,
                startRadius: 32,
                endRadius: 134
            )
            .scaleEffect(breathes ? 1.04 : 0.94)

            AgentMatchingEarthSceneView(isMotionReduced: reduceMotion)
                .frame(width: 248, height: 248)
        }
        .accessibilityHidden(true)
    }

    private func startAnimation() {
        guard !reduceMotion else { return }

        withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true)) {
            breathes = true
        }
    }
}

private struct AgentMatchingEarthSceneView: UIViewRepresentable {
    let isMotionReduced: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> SCNView {
        let sceneView = SCNView(frame: .zero)
        sceneView.backgroundColor = .clear
        sceneView.isOpaque = false
        sceneView.isUserInteractionEnabled = false
        sceneView.antialiasingMode = .multisampling2X
        sceneView.preferredFramesPerSecond = 30
        sceneView.rendersContinuously = false

        let scene = SCNScene()
        sceneView.scene = scene

        let camera = SCNCamera()
        camera.usesOrthographicProjection = true
        camera.orthographicScale = 2.14
        camera.zNear = 0.1
        camera.zFar = 10
        let cameraNode = SCNNode()
        cameraNode.camera = camera
        cameraNode.position = SCNVector3(0, 0, 3)
        scene.rootNode.addChildNode(cameraNode)

        let ambientLight = SCNLight()
        ambientLight.type = .ambient
        ambientLight.intensity = 760
        ambientLight.color = UIColor.white
        let ambientNode = SCNNode()
        ambientNode.light = ambientLight
        scene.rootNode.addChildNode(ambientNode)

        let keyLight = SCNLight()
        keyLight.type = .directional
        keyLight.intensity = 480
        keyLight.color = UIColor.white
        let keyLightNode = SCNNode()
        keyLightNode.light = keyLight
        keyLightNode.eulerAngles = SCNVector3(-0.45, -0.65, 0)
        scene.rootNode.addChildNode(keyLightNode)

        let sphere = SCNSphere(radius: 1)
        sphere.segmentCount = 40
        let material = SCNMaterial()
        material.lightingModel = .blinn
        let earthTexture = UIImage(named: "agent_matching_earth_texture")
        material.diffuse.contents = earthTexture
        material.diffuse.wrapS = .repeat
        material.diffuse.wrapT = .clamp
        material.diffuse.mipFilter = .linear
        material.ambient.contents = earthTexture
        material.ambient.intensity = 0.38
        material.emission.contents = earthTexture
        material.emission.intensity = 0.16
        material.specular.contents = UIColor(white: 1, alpha: 0.08)
        material.shininess = 0.05
        material.isDoubleSided = false
        sphere.firstMaterial = material

        let tiltNode = SCNNode()
        tiltNode.eulerAngles = SCNVector3(0.08, 0, -0.13)
        let earthNode = SCNNode(geometry: sphere)
        tiltNode.addChildNode(earthNode)
        scene.rootNode.addChildNode(tiltNode)

        context.coordinator.sceneView = sceneView
        context.coordinator.earthNode = earthNode
        context.coordinator.setMotionReduced(isMotionReduced)
        return sceneView
    }

    func updateUIView(_ sceneView: SCNView, context: Context) {
        context.coordinator.setMotionReduced(isMotionReduced)
    }

    static func dismantleUIView(_ sceneView: SCNView, coordinator: Coordinator) {
        coordinator.earthNode?.removeAllActions()
        sceneView.isPlaying = false
        sceneView.scene = nil
    }

    final class Coordinator {
        weak var sceneView: SCNView?
        weak var earthNode: SCNNode?
        private var lastReducedMotionValue: Bool?

        func setMotionReduced(_ isReduced: Bool) {
            guard lastReducedMotionValue != isReduced else { return }
            lastReducedMotionValue = isReduced

            earthNode?.removeAction(forKey: "earth-rotation")
            guard !isReduced else {
                sceneView?.isPlaying = false
                return
            }

            let rotation = SCNAction.rotateBy(x: 0, y: .pi * 2, z: 0, duration: 7.2)
            rotation.timingMode = .linear
            earthNode?.runAction(.repeatForever(rotation), forKey: "earth-rotation")
            sceneView?.isPlaying = true
        }
    }
}

private struct AgentVideoRoleTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.delegate = context.coordinator
        textView.backgroundColor = .clear
        textView.font = .systemFont(ofSize: 16)
        textView.textColor = UIColor(AppColors.primaryText)
        textView.tintColor = UIColor(AppColors.accent)
        textView.textContainerInset = UIEdgeInsets(top: 10, left: 0, bottom: 10, right: 0)
        textView.textContainer.lineFragmentPadding = 0
        textView.returnKeyType = .default
        textView.keyboardDismissMode = .interactive
        textView.isScrollEnabled = true
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        context.coordinator.parent = self
        if textView.text != text, textView.markedTextRange == nil {
            textView.text = text
        }
        if !isFocused, textView.isFirstResponder {
            textView.resignFirstResponder()
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: AgentVideoRoleTextView

        init(_ parent: AgentVideoRoleTextView) {
            self.parent = parent
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            if !parent.isFocused {
                parent.isFocused = true
            }
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            if parent.isFocused {
                parent.isFocused = false
            }
        }

        func textViewDidChange(_ textView: UITextView) {
            guard textView.markedTextRange == nil else { return }
            if parent.text != textView.text {
                parent.text = textView.text
            }
        }
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

    private var message: String {
        switch status {
        case "waiting_tools": return "文字回复已到达，图片仍在生成…"
        case "waiting_image": return "正在处理图片，请稍候…"
        case "waiting_response": return "正在同步智能体回复…"
        default: return "智能体正在回复…"
        }
    }

    var body: some View {
        HStack(spacing: 9) {
            ProgressView().scaleEffect(0.8)
            Text(message)
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
