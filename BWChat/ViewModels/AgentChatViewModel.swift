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
    private static let toolInvocationInstruction = "请实际调用图片生成工具，不要只用文字描述。调整要求："
    private static let defaultTransformInstruction = "请保持主体特征和整体构图。"

    func outboundText(userText: String) -> String {
        let trimmed = userText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard self == .transform else { return trimmed }
        guard !trimmed.isEmpty else {
            return Self.transformInstructionPrefix
                + Self.toolInvocationInstruction
                + Self.defaultTransformInstruction
        }
        return Self.transformInstructionPrefix + Self.toolInvocationInstruction + trimmed
    }

    static func isTransformRequest(text: String) -> Bool {
        text.hasPrefix(transformInstructionPrefix)
    }

    static func userVisibleText(from outboundText: String) -> String {
        let trimmed = outboundText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isTransformRequest(text: trimmed) else { return trimmed }

        let payload = String(trimmed.dropFirst(transformInstructionPrefix.count))
        guard payload != defaultTransformInstruction,
              payload != toolInvocationInstruction + defaultTransformInstruction else { return "" }
        if payload.hasPrefix(toolInvocationInstruction) {
            return String(payload.dropFirst(toolInvocationInstruction.count))
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let marker = payload.range(of: "调整要求：") {
            return String(payload[marker.upperBound...])
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return ""
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

enum AgentGeneratedMediaPollingDecision: Equatable {
    case stop
    case waitForMediaPart
    case waitForGeneration
}

struct AgentGeneratedMediaPollingPolicy {
    private static let inProgressStatuses: Set<String> = [
        "queued", "pending", "processing", "generating"
    ]

    static func decision(
        expectsGeneratedMedia: Bool,
        mediaParts: [AgentMessagePart]
    ) -> AgentGeneratedMediaPollingDecision {
        guard expectsGeneratedMedia else { return .stop }
        guard !mediaParts.isEmpty else { return .waitForMediaPart }

        let hasUnsettledPart = mediaParts.contains { part in
            let status = part.metadata.generationStatus?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()

            if let status, inProgressStatuses.contains(status) { return true }
            if status == "failed" || status == "expired" { return false }

            if status == "ready" || status == "ready_locked" || status == "completed" {
                if part.metadata.access == "unlocked" {
                    return part.metadata.contentURL == nil
                        && part.metadata.downloadURL == nil
                }
                if part.metadata.access == "locked" {
                    return part.metadata.previewURL == nil
                        && part.metadata.contentURL == nil
                }
                return true
            }

            // Older responses may omit generation_status. A usable media URL
            // still proves that the generated asset has settled.
            return part.metadata.previewURL == nil
                && part.metadata.contentURL == nil
                && part.metadata.downloadURL == nil
        }
        return hasUnsettledPart ? .waitForGeneration : .stop
    }
}

struct AgentTurnProgressPresentationPolicy {
    static func status(
        turnStatus: String?,
        turnIsTerminal: Bool,
        isAwaitingGeneratedMedia: Bool,
        isAwaitingTerminalResponse: Bool,
        mediaDecision: AgentGeneratedMediaPollingDecision?
    ) -> String? {
        if isAwaitingGeneratedMedia {
            // Once a paid-media part exists, its own bubble renders the image
            // generation placeholder. The standalone card is only needed while
            // the completed turn has not exposed that part yet.
            return mediaDecision == .waitForGeneration ? nil : "waiting_image"
        }
        if isAwaitingTerminalResponse { return "waiting_response" }
        guard !turnIsTerminal else { return nil }
        return turnStatus
    }
}

struct AgentTerminalResponsePollingPolicy {
    static func shouldWait(turnStatus: String, hasRenderableResponse: Bool) -> Bool {
        ["completed", "completed_with_errors"].contains(turnStatus)
            && !hasRenderableResponse
    }
}

@MainActor
final class AgentChatViewModel: ObservableObject {
    @Published private(set) var messages: [AgentMessage] = []
    @Published private(set) var runtimeConfig: AgentRuntimeConfig?
    @Published private(set) var spendableBalance: Int?
    @Published private(set) var currentTurn: AgentTurn?
    @Published private(set) var agentDisplayName: String
    @Published private(set) var agentAvatarAssetID: String?
    @Published private(set) var hasMore = false
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var isSending = false
    @Published private(set) var isAwaitingGeneratedMedia = false
    @Published private(set) var isAwaitingTerminalResponse = false
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
        let replyToID: String?
        let clientMessageID: UUID
        let turnIdempotencyKey: UUID
        let uploadIdempotencyKeys: [UUID]
    }

    private struct LastPayload {
        let text: String
        let images: [AgentComposerImage]
        let imageRequestMode: AgentImageRequestMode
        let replyToID: String?
    }

    private var pendingSend: SendOperation?
    private var lastPayload: LastPayload?
    private var unlockIdempotencyKeys: [String: UUID] = [:]
    private var expectedMediaTurnIDs: Set<String> = []
    private var latestVersionConversationIdempotencyKey = UUID()
    private var pollingTask: Task<Void, Never>?
    private var isSceneActive = true
    private let terminalMediaAppearanceGracePeriod: TimeInterval = 45
    private let terminalResponseAppearanceGracePeriod: TimeInterval = 45

    init(
        conversation: AgentConversation,
        runtimeConfig: AgentRuntimeConfig? = nil,
        spendableBalance: Int? = nil
    ) {
        self.conversation = conversation
        self.agentDisplayName = conversation.agentProfile.name
        self.agentAvatarAssetID = conversation.agentProfile.avatarAssetID
        self.runtimeConfig = runtimeConfig
        self.spendableBalance = spendableBalance
        if let cached = AgentChatLocalCache.cachedMessagePage(conversationID: conversation.id) {
            self.messages = cached.messages.sorted { lhs, rhs in
                if lhs.sequenceNo == rhs.sequenceNo { return lhs.id < rhs.id }
                return lhs.sequenceNo < rhs.sequenceNo
            }
            self.hasMore = cached.hasMore
        }
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
                    let status = AgentPaidMediaStatePolicy.displayStatus(for: part.metadata)
                    return ["queued", "generating", "ready_locked"].contains(status)
                        && part.metadata.access != "unlocked"
                }
            }
        )
    }

    var canSend: Bool {
        !isSending
            && !isAwaitingGeneratedMedia
            && !isAwaitingTerminalResponse
            && (currentTurn?.isTerminal ?? true)
    }

    var turnProgressStatus: String? {
        AgentTurnProgressPresentationPolicy.status(
            turnStatus: currentTurn?.status,
            turnIsTerminal: currentTurn?.isTerminal ?? true,
            isAwaitingGeneratedMedia: isAwaitingGeneratedMedia,
            isAwaitingTerminalResponse: isAwaitingTerminalResponse,
            mediaDecision: currentTurn.map { generatedMediaPollingDecision(for: $0) }
        )
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
            runtimeConfig = try? await APIService.shared.getAgentRuntimeConfig()
        }
        if spendableBalance == nil {
            spendableBalance = try? await APIService.shared.getWalletBalance().spendableBalance
        }

        await reloadMessages(reportErrors: messages.isEmpty)
        await resumeUnfinishedTurnIfNeeded()
    }

    func reloadMessages(reportErrors: Bool = true) async {
        do {
            let result = try await APIService.shared.getAgentMessages(
                conversationID: conversation.id,
                limit: 30
            )
            merge(result.0)
            hasMore = result.1
            persistMessages()
        } catch is CancellationError {
            return
        } catch {
            if reportErrors { errorMessage = message(for: error) }
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
            persistMessages()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = message(for: error)
        }
    }

    func send(
        text rawText: String,
        images: [AgentComposerImage],
        imageRequestMode: AgentImageRequestMode = .analyze,
        replyToID: String? = nil
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
            replyToID: replyToID,
            clientMessageID: UUID(),
            turnIdempotencyKey: UUID(),
            uploadIdempotencyKeys: limitedImages.map { _ in UUID() }
        )
        pendingSend = operation
        lastPayload = LastPayload(
            text: text,
            images: limitedImages,
            imageRequestMode: imageRequestMode,
            replyToID: replyToID
        )
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
            imageRequestMode: lastPayload.imageRequestMode,
            replyToID: lastPayload.replyToID
        )
    }

    func unlockMedia(
        id: String,
        paymentMethod: MediaUnlockPaymentMethod
    ) async {
        guard !unlockingMediaIDs.contains(id) else { return }
        unlockingMediaIDs.insert(id)
        let idempotencyScope = "\(id)|\(paymentMethod.idempotencyScope)"
        let key = unlockIdempotencyKeys[idempotencyScope] ?? UUID()
        unlockIdempotencyKeys[idempotencyScope] = key
        defer { unlockingMediaIDs.remove(id) }

        do {
            let result = try await APIService.shared.unlockAgentMedia(
                id: id,
                paymentMethod: paymentMethod,
                idempotencyKey: key
            )
            unlockIdempotencyKeys.removeValue(forKey: idempotencyScope)
            if let charge = result.charge {
                WalletStore.shared.applyServerBalance(charge.walletBalance)
                WalletTelemetry.recordMixedCharge(charge, operation: "agent_media_unlock")
                spendableBalance = charge.walletBalance.spendableBalance
            }
            needsWalletTopUp = false
            if !result.alreadyUnlocked,
               let consumedProp = result.consumedProp,
               let cardKind = paymentMethod.cardKind {
                PropInventoryStore.shared.applyConsumption(
                    consumedProp,
                    fallbackKind: cardKind
                )
            }
            await refreshUntilMediaUnlockIsVisible(id: id)
        } catch {
            if case APIError.serverError(let code, _) = error, code == 6303 {
                needsWalletTopUp = true
            }
            errorMessage = message(for: error)
            await refreshRuntimeConfigAfterCapabilityError(error)
        }
    }

    private func refreshUntilMediaUnlockIsVisible(id: String) async {
        let startedAt = Date()
        repeat {
            await reloadMessages(reportErrors: false)
            if AgentPaidMediaStatePolicy.hasVisibleUnlockedMedia(id: id, messages: messages) {
                return
            }
            guard Date().timeIntervalSince(startedAt) < 30 else { return }
            do {
                try await Task.sleep(nanoseconds: 750_000_000)
            } catch {
                return
            }
        } while !Task.isCancelled
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
                replyToID: operation.replyToID,
                idempotencyKey: operation.turnIdempotencyKey
            )
            pendingSend = nil
            merge([accepted.message])
            currentTurn = accepted.turn
            if operation.imageRequestMode == .transform {
                expectedMediaTurnIDs.insert(accepted.turn.id)
                isAwaitingGeneratedMedia = true
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
        var terminalWithoutMediaSince: Date?
        var terminalWithoutResponseSince: Date?
        while !Task.isCancelled, isSceneActive, Date().timeIntervalSince(startedAt) < 20 * 60 {
            do {
                let result = try await APIService.shared.getAgentTurn(id: turnID)
                currentTurn = result.turn
                if let responseMessage = result.responseMessage { merge([responseMessage]) }
                await reloadMessages()

                if result.turn.isTerminal {
                    var shouldHandleTerminalState = true
                    if shouldWaitForTerminalResponse(result.turn) {
                        isAwaitingTerminalResponse = true
                        let waitingSince = terminalWithoutResponseSince ?? Date()
                        terminalWithoutResponseSince = waitingSince
                        shouldHandleTerminalState = Date().timeIntervalSince(waitingSince)
                            >= terminalResponseAppearanceGracePeriod
                    } else {
                        isAwaitingTerminalResponse = false
                        terminalWithoutResponseSince = nil
                    }

                    if shouldHandleTerminalState {
                        isAwaitingTerminalResponse = false
                        switch generatedMediaPollingDecision(for: result.turn) {
                        case .stop:
                            isAwaitingGeneratedMedia = false
                            applyTerminalState(result.turn)
                            pollingTask = nil
                            return
                        case .waitForMediaPart:
                            isAwaitingGeneratedMedia = true
                            let waitingSince = terminalWithoutMediaSince ?? Date()
                            terminalWithoutMediaSince = waitingSince
                            if Date().timeIntervalSince(waitingSince) >= terminalMediaAppearanceGracePeriod {
                                isAwaitingGeneratedMedia = false
                                applyTerminalState(result.turn)
                                pollingTask = nil
                                return
                            }
                        case .waitForGeneration:
                            isAwaitingGeneratedMedia = true
                            terminalWithoutMediaSince = nil
                        }
                    }
                } else {
                    isAwaitingTerminalResponse = false
                    terminalWithoutMediaSince = nil
                    terminalWithoutResponseSince = nil
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
            isAwaitingGeneratedMedia = false
            isAwaitingTerminalResponse = false
            turnNotice = AgentTurnNotice(
                message: "智能体仍在处理，可稍后返回继续查看",
                allowsRetry: false,
                isFailure: false
            )
        }
    }

    private func applyTerminalState(_ turn: AgentTurn) {
        let expectsMedia = expectsGeneratedMedia(for: turn)
        let responseMessages = agentResponseMessages(for: turn)
        let mediaParts = responseMessages
            .flatMap(\.parts)
            .filter { $0.type == "paid_media" && $0.metadata.mediaType != "video" }
        let hasFailedMedia = mediaParts.contains { $0.metadata.generationStatus == "failed" }
        let hasRenderableResponse = responseMessages.contains(where: isRenderableAgentResponse)

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
        case "completed" where !expectsMedia && !hasRenderableResponse:
            turnNotice = AgentTurnNotice(
                message: "后端已完成处理，但回复消息尚未返回，请重试",
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

    private func generatedMediaPollingDecision(for turn: AgentTurn) -> AgentGeneratedMediaPollingDecision {
        let mediaParts = agentResponseMessages(for: turn)
            .flatMap(\.parts)
            .filter { $0.type == "paid_media" && $0.metadata.mediaType != "video" }
        return AgentGeneratedMediaPollingPolicy.decision(
            expectsGeneratedMedia: expectsGeneratedMedia(for: turn),
            mediaParts: mediaParts
        )
    }

    private func shouldWaitForTerminalResponse(_ turn: AgentTurn) -> Bool {
        AgentTerminalResponsePollingPolicy.shouldWait(
            turnStatus: turn.status,
            hasRenderableResponse: agentResponseMessages(for: turn)
                .contains(where: isRenderableAgentResponse)
        )
    }

    private func agentResponseMessages(for turn: AgentTurn) -> [AgentMessage] {
        messages.filter {
            $0.sender.type == "agent"
                && ($0.turnID == turn.id || $0.id == turn.responseMessageID)
        }
    }

    private func isRenderableAgentResponse(_ message: AgentMessage) -> Bool {
        message.parts.contains { part in
            switch part.type {
            case "text": return !part.text.isBlank
            case "input_image", "paid_media": return true
            default: return false
            }
        }
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
                    if newestTerminalResult == nil, shouldWaitForTerminalResponse(result.turn) {
                        currentTurn = result.turn
                        isAwaitingTerminalResponse = true
                        startPolling(turnID: result.turn.id)
                        return
                    }
                    switch generatedMediaPollingDecision(for: result.turn) {
                    case .stop:
                        if newestTerminalResult == nil { newestTerminalResult = result }
                    case .waitForMediaPart, .waitForGeneration:
                        currentTurn = result.turn
                        isAwaitingGeneratedMedia = true
                        startPolling(turnID: result.turn.id)
                        return
                    }
                } else {
                    currentTurn = result.turn
                    isAwaitingTerminalResponse = false
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
            isAwaitingGeneratedMedia = false
            isAwaitingTerminalResponse = false
            applyTerminalState(newestTerminalResult.turn)
        }
    }

    private func merge(_ incoming: [AgentMessage]) {
        let previousLatest = messages.last
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
        persistMessages()
        guard let latest = messages.last, latest != previousLatest else { return }
        NotificationCenter.default.post(
            name: .conversationPreviewDidChange,
            object: AgentConversationPreviewUpdate(
                conversationID: conversation.id,
                lastMessage: AgentConversationPreviewResolver.text(
                    for: latest,
                    fallback: conversation.title
                ),
                lastMessageTime: latest.updatedAt
            )
        )
    }

    private func persistMessages() {
        AgentChatLocalCache.saveMessages(
            messages,
            hasMore: hasMore,
            conversationID: conversation.id
        )
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
