// BWChat/ViewModels/AgentChatViewModel.swift

import Foundation

struct AgentComposerImage: Identifiable, Equatable {
    let id: UUID
    let data: Data

    init(id: UUID = UUID(), data: Data) {
        self.id = id
        self.data = data
    }
}

struct AgentTurnNotice: Equatable {
    let message: String
    let allowsRetry: Bool
    let isFailure: Bool
}

enum AgentImageRequestMode: String, CaseIterable, Equatable {
    case analyze
    case transform

    static let transformInstructionPrefix = "请基于我上传的图片进行调整并生成一张新的图片。"

    func outboundText(userText: String) -> String {
        let trimmed = userText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard self == .transform else { return trimmed }
        guard !trimmed.isEmpty else {
            return Self.transformInstructionPrefix + "请保持主体特征和整体构图。"
        }
        return Self.transformInstructionPrefix + "请实际调用图片生成工具，不要只用文字描述。调整要求：" + trimmed
    }

    static func isTransformRequest(text: String) -> Bool {
        text.hasPrefix(transformInstructionPrefix)
    }
}

struct AgentImageGenerationPolicy: Equatable {
    let isRuntimeConfigLoaded: Bool
    let isGloballyEnabled: Bool
    let isEnabledForAgentVersion: Bool
    let hasBlockingLockedMedia: Bool

    var blockReason: String? {
        if !isRuntimeConfigLoaded { return "正在加载图片生成能力，请稍后再试" }
        if !isGloballyEnabled { return "图片生成功能当前未开放" }
        if !isEnabledForAgentVersion { return "当前会话使用的智能体版本未开启图片能力" }
        if hasBlockingLockedMedia { return "请先解锁上一张图片，再继续调整图片" }
        return nil
    }

    var canGenerate: Bool { blockReason == nil }
}

@MainActor
final class AgentChatViewModel: ObservableObject {
    @Published private(set) var messages: [AgentMessage] = []
    @Published private(set) var runtimeConfig: AgentRuntimeConfig?
    @Published private(set) var walletBalance: Int?
    @Published private(set) var currentTurn: AgentTurn?
    @Published private(set) var agentDisplayName: String
    @Published private(set) var agentAvatarAssetID: String?
    @Published private(set) var hasMore = false
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var isSending = false
    @Published private(set) var isCreatingLatestVersionConversation = false
    @Published private(set) var requiresLatestVersionConversation = false
    @Published private(set) var unlockingMediaIDs: Set<String> = []
    @Published private(set) var turnNotice: AgentTurnNotice?
    @Published var errorMessage: String?
    @Published var needsWalletTopUp = false

    let conversation: AgentConversation

    private struct SendOperation {
        let text: String
        let images: [AgentComposerImage]
        let imageRequestMode: AgentImageRequestMode
        let clientMessageID: UUID
        let turnIdempotencyKey: UUID
        let uploadIdempotencyKeys: [UUID]
    }

    private struct LastPayload {
        let text: String
        let images: [AgentComposerImage]
        let imageRequestMode: AgentImageRequestMode
    }

    private var pendingSend: SendOperation?
    private var lastPayload: LastPayload?
    private var unlockIdempotencyKeys: [String: UUID] = [:]
    private var expectedMediaTurnIDs: Set<String> = []
    private var latestVersionConversationIdempotencyKey = UUID()
    private var pollingTask: Task<Void, Never>?
    private var isSceneActive = true

    init(
        conversation: AgentConversation,
        runtimeConfig: AgentRuntimeConfig? = nil,
        walletBalance: Int? = nil
    ) {
        self.conversation = conversation
        self.agentDisplayName = conversation.agentProfile.name
        self.agentAvatarAssetID = conversation.agentProfile.avatarAssetID
        self.runtimeConfig = runtimeConfig
        self.walletBalance = walletBalance
    }

    deinit {
        pollingTask?.cancel()
    }

    var maxImagesPerTurn: Int { runtimeConfig?.vision.maxImagesPerTurn ?? 1 }

    var imageGenerationPolicy: AgentImageGenerationPolicy {
        AgentImageGenerationPolicy(
            isRuntimeConfigLoaded: runtimeConfig != nil,
            isGloballyEnabled: runtimeConfig?.agentsEnabled == true
                && runtimeConfig?.imageInputEnabled == true
                && runtimeConfig?.paidImagesEnabled == true,
            isEnabledForAgentVersion: conversation.agentCapabilities.paidImages,
            hasBlockingLockedMedia: messages.contains { message in
                message.parts.contains { part in
                    guard part.type == "paid_media", part.metadata.mediaType != "video" else { return false }
                    let status = part.metadata.generationStatus ?? "queued"
                    return ["queued", "generating", "ready_locked"].contains(status)
                        && part.metadata.access != "unlocked"
                }
            }
        )
    }

    var canSend: Bool {
        !isSending && (currentTurn?.isTerminal ?? true)
    }

    func applyUpdatedAgent(_ agent: AgentSummary) {
        if let name = agent.profile?.name, !name.isEmpty {
            agentDisplayName = name
        }
        agentAvatarAssetID = agent.resolvedAvatarAssetID ?? agentAvatarAssetID
        requiresLatestVersionConversation = true
    }

    func createConversationForLatestAgentVersion() async -> AgentConversation? {
        guard !isCreatingLatestVersionConversation else { return nil }
        isCreatingLatestVersionConversation = true
        errorMessage = nil
        defer { isCreatingLatestVersionConversation = false }

        do {
            let latestConversation = try await APIService.shared.createAgentConversation(
                agentID: conversation.agentID,
                greetingID: "default",
                idempotencyKey: latestVersionConversationIdempotencyKey
            )
            guard latestConversation.agentVersionID != conversation.agentVersionID
                    || latestConversation.id != conversation.id else {
                throw APIError.serverError(
                    code: 409,
                    message: "服务端仍返回当前旧版本会话，请稍后重新进入智能体后再试"
                )
            }
            latestVersionConversationIdempotencyKey = UUID()
            requiresLatestVersionConversation = false
            NotificationCenter.default.post(name: .conversationListNeedsReload, object: nil)
            return latestConversation
        } catch {
            errorMessage = message(for: error)
            return nil
        }
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        if runtimeConfig == nil {
            do { runtimeConfig = try await APIService.shared.getAgentRuntimeConfig() }
            catch { errorMessage = message(for: error) }
        }
        if walletBalance == nil {
            do { walletBalance = try await APIService.shared.getWalletBalance().balance }
            catch { errorMessage = message(for: error) }
        }

        await reloadMessages()
        await resumeUnfinishedTurnIfNeeded()
    }

    func reloadMessages() async {
        do {
            let result = try await APIService.shared.getAgentMessages(
                conversationID: conversation.id,
                limit: 30
            )
            merge(result.0)
            hasMore = result.1
        } catch is CancellationError {
            return
        } catch {
            errorMessage = message(for: error)
        }
    }

    func loadMore() async {
        guard hasMore, !isLoadingMore, let minimum = messages.map(\.sequenceNo).min() else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let result = try await APIService.shared.getAgentMessages(
                conversationID: conversation.id,
                beforeSequence: minimum,
                limit: 30
            )
            merge(result.0)
            hasMore = result.1
        } catch is CancellationError {
            return
        } catch {
            errorMessage = message(for: error)
        }
    }

    func send(
        text rawText: String,
        images: [AgentComposerImage],
        imageRequestMode: AgentImageRequestMode = .analyze
    ) async -> Bool {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || !images.isEmpty, canSend else { return false }

        if imageRequestMode == .transform {
            guard !images.isEmpty else {
                errorMessage = "请先选择一张需要调整的图片"
                return false
            }
            if let blockReason = imageGenerationPolicy.blockReason {
                errorMessage = blockReason
                return false
            }
        }

        let limitedImages = Array(images.prefix(maxImagesPerTurn))
        let operation = SendOperation(
            text: imageRequestMode.outboundText(userText: text),
            images: limitedImages,
            imageRequestMode: imageRequestMode,
            clientMessageID: UUID(),
            turnIdempotencyKey: UUID(),
            uploadIdempotencyKeys: limitedImages.map { _ in UUID() }
        )
        pendingSend = operation
        lastPayload = LastPayload(text: text, images: limitedImages, imageRequestMode: imageRequestMode)
        return await execute(operation)
    }

    func retryPendingSend() async -> Bool {
        guard let pendingSend, !isSending else { return false }
        return await execute(pendingSend)
    }

    func retryFailedTurn() async {
        guard let lastPayload, !isSending else { return }
        turnNotice = nil
        _ = await send(
            text: lastPayload.text,
            images: lastPayload.images,
            imageRequestMode: lastPayload.imageRequestMode
        )
    }

    func unlockMedia(id: String) async {
        guard !unlockingMediaIDs.contains(id) else { return }
        unlockingMediaIDs.insert(id)
        let key = unlockIdempotencyKeys[id] ?? UUID()
        unlockIdempotencyKeys[id] = key
        defer { unlockingMediaIDs.remove(id) }

        do {
            let result = try await APIService.shared.unlockAgentMedia(id: id, idempotencyKey: key)
            unlockIdempotencyKeys.removeValue(forKey: id)
            walletBalance = result.balance
            needsWalletTopUp = false
            await reloadMessages()
        } catch {
            if case APIError.serverError(let code, _) = error, code == 6303 {
                needsWalletTopUp = true
            }
            errorMessage = message(for: error)
            await refreshRuntimeConfigAfterCapabilityError(error)
        }
    }

    func setSceneActive(_ active: Bool) async {
        isSceneActive = active
        if !active {
            pollingTask?.cancel()
            pollingTask = nil
            return
        }
        await reloadMessages()
        await resumeUnfinishedTurnIfNeeded()
    }

    func stop() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    private func execute(_ operation: SendOperation) async -> Bool {
        isSending = true
        turnNotice = nil
        errorMessage = nil
        defer { isSending = false }

        do {
            var parts: [[String: Any]] = []
            if !operation.text.isEmpty {
                parts.append(["type": "text", "text": operation.text])
            }

            for (index, image) in operation.images.enumerated() {
                let assetID = try await APIService.shared.uploadAgentChatImage(
                    image.data,
                    filename: "agent_\(image.id.uuidString).jpg",
                    idempotencyKey: operation.uploadIdempotencyKeys[index]
                )
                parts.append(["type": "input_image", "asset_id": assetID])
            }

            let accepted = try await APIService.shared.createAgentTurn(
                conversationID: conversation.id,
                clientMessageID: operation.clientMessageID,
                parts: parts,
                idempotencyKey: operation.turnIdempotencyKey
            )
            pendingSend = nil
            merge([accepted.message])
            currentTurn = accepted.turn
            if operation.imageRequestMode == .transform {
                expectedMediaTurnIDs.insert(accepted.turn.id)
            }
            startPolling(turnID: accepted.turn.id)
            return true
        } catch is CancellationError {
            return false
        } catch {
            errorMessage = message(for: error)
            turnNotice = AgentTurnNotice(
                message: "发送失败，点击重试",
                allowsRetry: true,
                isFailure: true
            )
            await refreshRuntimeConfigAfterCapabilityError(error)
            return false
        }
    }

    private func startPolling(turnID: String) {
        pollingTask?.cancel()
        pollingTask = Task { [weak self] in
            await self?.poll(turnID: turnID)
        }
    }

    private func poll(turnID: String) async {
        let startedAt = Date()
        while !Task.isCancelled, isSceneActive, Date().timeIntervalSince(startedAt) < 20 * 60 {
            do {
                let result = try await APIService.shared.getAgentTurn(id: turnID)
                currentTurn = result.turn
                if let responseMessage = result.responseMessage { merge([responseMessage]) }
                await reloadMessages()

                if result.turn.isTerminal {
                    applyTerminalState(result.turn)
                    pollingTask = nil
                    return
                }
            } catch is CancellationError {
                return
            } catch {
                errorMessage = message(for: error)
            }

            do { try await Task.sleep(nanoseconds: 1_000_000_000) }
            catch { return }
        }

        if !Task.isCancelled, isSceneActive {
            turnNotice = AgentTurnNotice(
                message: "智能体仍在处理，可稍后返回继续查看",
                allowsRetry: false,
                isFailure: false
            )
        }
    }

    private func applyTerminalState(_ turn: AgentTurn) {
        let expectsMedia = expectsGeneratedMedia(for: turn)
        let mediaParts = messages
            .filter {
                $0.sender.type == "agent"
                    && ($0.turnID == turn.id || $0.id == turn.responseMessageID)
            }
            .flatMap(\.parts)
            .filter { $0.type == "paid_media" && $0.metadata.mediaType != "video" }
        let hasFailedMedia = mediaParts.contains { $0.metadata.generationStatus == "failed" }

        #if DEBUG
        print(
            "[AgentChat] turn=\(turn.id) status=\(turn.status) "
                + "expects_media=\(expectsMedia) paid_media_parts=\(mediaParts.count) "
                + "error_code=\(turn.errorCode.isEmpty ? "-" : turn.errorCode)"
        )
        #endif

        switch turn.status {
        case "failed":
            turnNotice = AgentTurnNotice(
                message: turn.errorDetail.isBlank ? "智能体回复失败，点击重试" : turn.errorDetail,
                allowsRetry: lastPayload != nil,
                isFailure: true
            )
        case "completed_with_errors":
            turnNotice = AgentTurnNotice(
                message: turn.errorDetail.isBlank
                    ? (expectsMedia ? "图片调整失败，请重试" : "部分内容生成失败")
                    : turn.errorDetail,
                allowsRetry: expectsMedia && lastPayload != nil,
                isFailure: expectsMedia
            )
        case "completed" where expectsMedia && mediaParts.isEmpty:
            turnNotice = AgentTurnNotice(
                message: "后端已完成回复，但没有返回调整后的图片。请重试；若持续出现，请检查该会话的图片能力。",
                allowsRetry: lastPayload != nil,
                isFailure: true
            )
        case "completed" where expectsMedia && hasFailedMedia:
            turnNotice = AgentTurnNotice(
                message: "图片生成失败，请重试",
                allowsRetry: lastPayload != nil,
                isFailure: true
            )
        default:
            turnNotice = nil
        }
        expectedMediaTurnIDs.remove(turn.id)
    }

    private func expectsGeneratedMedia(for turn: AgentTurn) -> Bool {
        if expectedMediaTurnIDs.contains(turn.id) { return true }
        guard let triggerMessage = messages.first(where: { $0.id == turn.triggerMessageID }) else {
            return false
        }
        let hasInputImage = triggerMessage.parts.contains { $0.type == "input_image" }
        let text = triggerMessage.parts
            .filter { $0.type == "text" }
            .map(\.text)
            .joined(separator: "\n")
        return hasInputImage && AgentImageRequestMode.isTransformRequest(text: text)
    }

    private func resumeUnfinishedTurnIfNeeded() async {
        guard isSceneActive else { return }
        var seenTurnIDs: Set<String> = []
        let turnIDs = messages
            .sorted { $0.sequenceNo > $1.sequenceNo }
            .compactMap(\.turnID)
            .filter { seenTurnIDs.insert($0).inserted }
        var newestTerminalResult: AgentTurnResult?

        for id in turnIDs.prefix(5) {
            do {
                let result = try await APIService.shared.getAgentTurn(id: id)
                if let responseMessage = result.responseMessage { merge([responseMessage]) }
                if result.turn.isTerminal {
                    if newestTerminalResult == nil { newestTerminalResult = result }
                } else {
                    currentTurn = result.turn
                    startPolling(turnID: result.turn.id)
                    return
                }
            } catch is CancellationError {
                return
            } catch {
                continue
            }
        }

        if let newestTerminalResult {
            currentTurn = newestTerminalResult.turn
            applyTerminalState(newestTerminalResult.turn)
        }
    }

    private func merge(_ incoming: [AgentMessage]) {
        var bySequence = Dictionary(uniqueKeysWithValues: messages.map { ($0.sequenceNo, $0) })
        for message in incoming {
            if let existing = bySequence[message.sequenceNo], existing.updatedAt > message.updatedAt {
                continue
            }
            bySequence[message.sequenceNo] = message
        }
        messages = bySequence.values.sorted { lhs, rhs in
            if lhs.sequenceNo == rhs.sequenceNo { return lhs.id < rhs.id }
            return lhs.sequenceNo < rhs.sequenceNo
        }
    }

    private func refreshRuntimeConfigAfterCapabilityError(_ error: Error) async {
        guard case APIError.serverError(let code, _) = error,
              (6000...6399).contains(code) else { return }
        do { runtimeConfig = try await APIService.shared.getAgentRuntimeConfig() }
        catch { }
    }

    private func message(for error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }
}
