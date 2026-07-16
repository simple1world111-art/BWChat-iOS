// BWChat/Services/ChatMoneyStore.swift

import Foundation

@MainActor
protocol ChatMoneyServicing: AnyObject {
    func configuration() async throws -> ChatMoneyConfiguration
    func createRedPacket(_ request: CreateRedPacketRequest) async throws -> ChatMoneyCreationResult
    func createTransfer(_ request: CreateTransferRequest) async throws -> ChatMoneyCreationResult
    func detail(assetID: String) async throws -> ChatMoneyDetail
    func claim(assetID: String) async throws -> ChatMoneyActionResult
    func accept(assetID: String) async throws -> ChatMoneyActionResult
    func returnTransfer(assetID: String) async throws -> ChatMoneyActionResult
}

@MainActor
final class APIChatMoneyService: ChatMoneyServicing {
    static let shared = APIChatMoneyService()

    func configuration() async throws -> ChatMoneyConfiguration {
        try await APIService.shared.getChatMoneyConfiguration()
    }

    func createRedPacket(_ request: CreateRedPacketRequest) async throws -> ChatMoneyCreationResult {
        try await APIService.shared.createRedPacket(request)
    }

    func createTransfer(_ request: CreateTransferRequest) async throws -> ChatMoneyCreationResult {
        try await APIService.shared.createTransfer(request)
    }

    func detail(assetID: String) async throws -> ChatMoneyDetail {
        try await APIService.shared.getChatMoneyDetail(assetID: assetID)
    }

    func claim(assetID: String) async throws -> ChatMoneyActionResult {
        try await APIService.shared.claimRedPacket(assetID: assetID)
    }

    func accept(assetID: String) async throws -> ChatMoneyActionResult {
        try await APIService.shared.acceptTransfer(assetID: assetID)
    }

    func returnTransfer(assetID: String) async throws -> ChatMoneyActionResult {
        try await APIService.shared.returnTransfer(assetID: assetID)
    }
}

@MainActor
final class ChatMoneyStore: ObservableObject {
    private struct ViewerClaimReceipt: Codable {
        let userID: String
        let nickname: String
        let avatarURL: String?
        let amount: Int
        let claimedAt: String
    }

    private struct TransferActionReceipt: Codable {
        let status: ChatMoneyStatus
        let completedAt: String
    }

    @Published private(set) var configuration: ChatMoneyConfiguration = .unavailable
    @Published private(set) var details: [String: ChatMoneyDetail] = [:]
    @Published private(set) var payloads: [String: ChatMoneyPayload] = [:]
    @Published private(set) var isLoadingConfiguration = false
    @Published private(set) var activeOperationAssetID: String?
    @Published var errorMessage: String?

    private let service: ChatMoneyServicing
    private let defaults: UserDefaults

    init(service: ChatMoneyServicing, defaults: UserDefaults = .standard) {
        self.service = service
        self.defaults = defaults
    }

    convenience init() {
        self.init(service: APIChatMoneyService.shared)
    }

    func loadConfiguration() async {
        guard !isLoadingConfiguration else { return }
        isLoadingConfiguration = true
        defer { isLoadingConfiguration = false }
        do {
            configuration = try await service.configuration()
        } catch {
            // This endpoint is the single source of truth. Missing, malformed,
            // or unreachable configuration fails closed in every build.
            configuration = ChatMoneyConfiguration(
                redPacketEnabled: false,
                transferEnabled: false,
                limits: .fixture,
                eligibility: ChatMoneyEligibility(
                    eligible: false,
                    reasonCode: "service_unavailable",
                    message: L10n.tr("chatMoney.serviceUnavailable"),
                    actionURL: nil
                )
            )
        }
    }

    func createRedPacket(_ request: CreateRedPacketRequest) async throws -> ChatMoneyCreationResult {
        try ensureEligibility(kind: .redPacket)
        let result = try await perform(assetID: request.clientMessageID) {
            try await service.createRedPacket(request)
        }
        apply(result.payload)
        applyWalletBalance(result.walletBalance)
        return result
    }

    func createTransfer(_ request: CreateTransferRequest) async throws -> ChatMoneyCreationResult {
        try ensureEligibility(kind: .transfer)
        let result = try await perform(assetID: request.clientMessageID) {
            try await service.createTransfer(request)
        }
        apply(result.payload)
        applyWalletBalance(result.walletBalance)
        return result
    }

    func loadDetail(assetID: String, force: Bool = false) async throws -> ChatMoneyDetail {
        if !force, let cached = details[assetID] { return cached }
        let serverDetail = try await perform(assetID: assetID) {
            try await service.detail(assetID: assetID)
        }
        let detail = normalizedForLocalReceipts(serverDetail)
        merge(detail)
        return details[assetID] ?? detail
    }

    func claim(assetID: String) async throws -> ChatMoneyActionResult {
        guard !hasViewerClaimed(assetID: assetID) else {
            throw APIError.serverError(
                code: 409,
                message: L10n.tr("chatMoney.redPacket.alreadyClaimed")
            )
        }
        let result = try await perform(assetID: assetID) {
            try await service.claim(assetID: assetID)
        }
        apply(result)
        let resolved = resolvedClaimResult(result)
        recordViewerClaim(assetID: assetID, detail: resolved.detail)
        let normalizedDetail = normalizedForViewerClaimReceipt(resolved.detail)
        details[assetID] = normalizedDetail
        return ChatMoneyActionResult(
            detail: normalizedDetail,
            payload: resolved.payload,
            walletBalance: resolved.walletBalance
        )
    }

    func hasViewerClaimed(assetID: String) -> Bool {
        Set(defaults.stringArray(forKey: viewerClaimReceiptKey) ?? []).contains(assetID)
    }

    func accept(assetID: String) async throws -> ChatMoneyActionResult {
        try ensureTransferNotFinalized(assetID: assetID)
        let result = try await perform(assetID: assetID) {
            try await service.accept(assetID: assetID)
        }
        return finalizeTransfer(result, status: .accepted)
    }

    func returnTransfer(assetID: String) async throws -> ChatMoneyActionResult {
        try ensureTransferNotFinalized(assetID: assetID)
        let result = try await perform(assetID: assetID) {
            try await service.returnTransfer(assetID: assetID)
        }
        return finalizeTransfer(result, status: .returned)
    }

    func hasFinalizedTransfer(assetID: String) -> Bool {
        transferActionReceipts()[assetID] != nil
    }

    func apply(_ event: ChatMoneyUpdateEvent) {
        guard event.payload.version > (payloads[event.payload.assetID]?.version ?? 0) else { return }
        apply(event.payload)
        if let detail = details[event.payload.assetID], event.payload.version >= detail.version {
            let updatedDetail = ChatMoneyDetail(
                assetID: detail.assetID,
                kind: detail.kind,
                scope: detail.scope,
                mode: detail.mode,
                senderID: detail.senderID,
                senderName: detail.senderName,
                senderAvatarURL: detail.senderAvatarURL,
                recipientID: detail.recipientID,
                recipientName: detail.recipientName,
                totalAmount: detail.totalAmount,
                claimedAmount: detail.claimedAmount,
                packetCount: event.payload.packetCount ?? detail.packetCount,
                claimedCount: event.payload.claimedCount ?? detail.claimedCount,
                greeting: event.payload.greeting ?? detail.greeting,
                note: event.payload.note ?? detail.note,
                status: event.payload.status,
                expiresAt: event.payload.expiresAt ?? detail.expiresAt,
                canClaim: detail.canClaim && !event.payload.status.isTerminal,
                canAccept: detail.canAccept && !event.payload.status.isTerminal,
                canReturn: detail.canReturn && !event.payload.status.isTerminal,
                viewerClaimAmount: detail.viewerClaimAmount,
                claims: detail.claims,
                version: event.payload.version
            )
            details[event.payload.assetID] = normalizedForLocalReceipts(updatedDetail)
        }
        applyWalletBalance(event.walletBalance)
    }

    func apply(_ payload: ChatMoneyPayload) {
        guard payload.version > (payloads[payload.assetID]?.version ?? 0) else { return }
        payloads[payload.assetID] = payload
    }

    private func merge(_ detail: ChatMoneyDetail) {
        let normalized = normalizedForLocalReceipts(detail)
        guard normalized.version > (details[normalized.assetID]?.version ?? 0) else { return }
        details[normalized.assetID] = normalized
    }

    private func apply(_ result: ChatMoneyActionResult) {
        apply(result.payload)
        merge(result.detail)
        applyWalletBalance(result.walletBalance)
    }

    private func resolvedClaimResult(_ result: ChatMoneyActionResult) -> ChatMoneyActionResult {
        let currentDetail = details[result.detail.assetID] ?? result.detail
        let currentPayload = payloads[result.payload.assetID] ?? result.payload
        let payloadIsNewest = currentPayload.version > currentDetail.version
        let viewerClaimAmount = currentDetail.viewerClaimAmount
            ?? result.detail.viewerClaimAmount
            ?? currentDetail.claims.first(where: {
                $0.userID == AuthManager.shared.currentUser?.userID
            })?.amount

        let packetCount = payloadIsNewest
            ? currentPayload.packetCount ?? currentDetail.packetCount
            : currentDetail.packetCount
        let claimedCount = payloadIsNewest
            ? currentPayload.claimedCount ?? currentDetail.claimedCount
            : currentDetail.claimedCount
        let snapshotStatus: ChatMoneyStatus
        if currentPayload.version == currentDetail.version {
            snapshotStatus = mostAdvancedRedPacketStatus(currentDetail.status, currentPayload.status)
        } else {
            snapshotStatus = payloadIsNewest ? currentPayload.status : currentDetail.status
        }
        let resolvedStatus: ChatMoneyStatus
        if currentDetail.scope == .direct
            || packetCount == 1
            || (claimedCount != nil && claimedCount == packetCount) {
            resolvedStatus = .completed
        } else if snapshotStatus == .pending, (claimedCount ?? 0) > 0 {
            resolvedStatus = .partial
        } else {
            resolvedStatus = snapshotStatus
        }

        let resolvedDetail = ChatMoneyDetail(
            assetID: currentDetail.assetID,
            kind: currentDetail.kind,
            scope: currentDetail.scope,
            mode: currentDetail.mode,
            senderID: currentDetail.senderID,
            senderName: currentDetail.senderName,
            senderAvatarURL: currentDetail.senderAvatarURL,
            recipientID: currentDetail.recipientID,
            recipientName: currentDetail.recipientName,
            totalAmount: currentDetail.totalAmount,
            claimedAmount: currentDetail.claimedAmount,
            packetCount: packetCount,
            claimedCount: claimedCount,
            greeting: currentDetail.greeting ?? currentPayload.greeting,
            note: currentDetail.note ?? currentPayload.note,
            status: resolvedStatus,
            expiresAt: currentDetail.expiresAt ?? currentPayload.expiresAt,
            canClaim: false,
            canAccept: currentDetail.canAccept,
            canReturn: currentDetail.canReturn,
            viewerClaimAmount: viewerClaimAmount,
            claims: currentDetail.claims,
            version: max(currentDetail.version, currentPayload.version)
        )

        return ChatMoneyActionResult(
            detail: resolvedDetail,
            payload: currentPayload,
            walletBalance: result.walletBalance
        )
    }

    private func mostAdvancedRedPacketStatus(
        _ first: ChatMoneyStatus,
        _ second: ChatMoneyStatus
    ) -> ChatMoneyStatus {
        func rank(_ status: ChatMoneyStatus) -> Int {
            switch status {
            case .pending: return 0
            case .partial: return 1
            case .completed, .expiredRefunded: return 2
            case .accepted, .returned: return 0
            }
        }
        return rank(second) > rank(first) ? second : first
    }

    private var viewerClaimReceiptKey: String {
        let userID = AuthManager.shared.currentUser?.userID ?? "anonymous"
        return "bbchat.chat-money.claimed-assets.\(userID)"
    }

    private var viewerClaimReceiptMetadataKey: String {
        "\(viewerClaimReceiptKey).metadata"
    }

    private func recordViewerClaim(assetID: String, detail: ChatMoneyDetail) {
        var assetIDs = Set(defaults.stringArray(forKey: viewerClaimReceiptKey) ?? [])
        assetIDs.insert(assetID)
        defaults.set(Array(assetIDs), forKey: viewerClaimReceiptKey)

        let currentUser = AuthManager.shared.currentUser
        let serverRecord = detail.claims.first {
            $0.userID == currentUser?.userID
        }
        guard let amount = detail.viewerClaimAmount ?? serverRecord?.amount else { return }

        var receipts = viewerClaimReceipts()
        receipts[assetID] = ViewerClaimReceipt(
            userID: currentUser?.userID ?? serverRecord?.userID ?? "anonymous",
            nickname: currentUser?.nickname ?? serverRecord?.nickname ?? L10n.tr("common.me"),
            avatarURL: currentUser?.avatarURL ?? serverRecord?.avatarURL,
            amount: amount,
            claimedAt: serverRecord?.claimedAt ?? ISO8601DateFormatter().string(from: Date())
        )
        saveViewerClaimReceipts(receipts)
    }

    private func normalizedForViewerClaimReceipt(_ detail: ChatMoneyDetail) -> ChatMoneyDetail {
        guard detail.kind == .redPacket,
              hasViewerClaimed(assetID: detail.assetID) else { return detail }

        let status: ChatMoneyStatus
        if detail.scope == .direct
            || detail.packetCount == 1
            || (detail.claimedCount != nil && detail.claimedCount == detail.packetCount) {
            status = .completed
        } else if detail.status == .pending {
            status = .partial
        } else {
            status = detail.status
        }

        var claims = detail.claims
        if let viewerRecord = viewerClaimRecord(for: detail),
           !claims.contains(where: { $0.userID == viewerRecord.userID }) {
            claims.append(viewerRecord)
        }

        return ChatMoneyDetail(
            assetID: detail.assetID,
            kind: detail.kind,
            scope: detail.scope,
            mode: detail.mode,
            senderID: detail.senderID,
            senderName: detail.senderName,
            senderAvatarURL: detail.senderAvatarURL,
            recipientID: detail.recipientID,
            recipientName: detail.recipientName,
            totalAmount: detail.totalAmount,
            claimedAmount: detail.claimedAmount,
            packetCount: detail.packetCount,
            claimedCount: detail.claimedCount,
            greeting: detail.greeting,
            note: detail.note,
            status: status,
            expiresAt: detail.expiresAt,
            canClaim: false,
            canAccept: detail.canAccept,
            canReturn: detail.canReturn,
            viewerClaimAmount: detail.viewerClaimAmount,
            claims: claims,
            version: detail.version
        )
    }

    private func viewerClaimRecord(for detail: ChatMoneyDetail) -> ChatMoneyClaimRecord? {
        let currentUser = AuthManager.shared.currentUser
        let currentUserID = currentUser?.userID ?? "anonymous"
        if detail.claims.contains(where: { $0.userID == currentUserID }) { return nil }

        var receipts = viewerClaimReceipts()
        var receipt = receipts[detail.assetID]
        if receipt == nil, let amount = detail.viewerClaimAmount {
            receipt = ViewerClaimReceipt(
                userID: currentUserID,
                nickname: currentUser?.nickname ?? L10n.tr("common.me"),
                avatarURL: currentUser?.avatarURL,
                amount: amount,
                claimedAt: ISO8601DateFormatter().string(from: Date())
            )
            receipts[detail.assetID] = receipt
            saveViewerClaimReceipts(receipts)
        }
        guard let receipt else { return nil }

        return ChatMoneyClaimRecord(
            userID: receipt.userID,
            nickname: receipt.nickname,
            avatarURL: receipt.avatarURL,
            amount: receipt.amount,
            claimedAt: receipt.claimedAt,
            isLuckiest: false
        )
    }

    private func viewerClaimReceipts() -> [String: ViewerClaimReceipt] {
        guard let data = defaults.data(forKey: viewerClaimReceiptMetadataKey),
              let receipts = try? JSONDecoder().decode(
                  [String: ViewerClaimReceipt].self,
                  from: data
              ) else { return [:] }
        return receipts
    }

    private func saveViewerClaimReceipts(_ receipts: [String: ViewerClaimReceipt]) {
        guard let data = try? JSONEncoder().encode(receipts) else { return }
        defaults.set(data, forKey: viewerClaimReceiptMetadataKey)
    }

    private var transferActionReceiptKey: String {
        let userID = AuthManager.shared.currentUser?.userID ?? "anonymous"
        return "bbchat.chat-money.transfer-actions.\(userID)"
    }

    private func ensureTransferNotFinalized(assetID: String) throws {
        guard !hasFinalizedTransfer(assetID: assetID) else {
            throw APIError.serverError(
                code: 409,
                message: L10n.tr("chatMoney.transfer.alreadyFinalized")
            )
        }
    }

    private func finalizeTransfer(
        _ result: ChatMoneyActionResult,
        status: ChatMoneyStatus
    ) -> ChatMoneyActionResult {
        recordTransferAction(assetID: result.detail.assetID, status: status)
        apply(result)

        let currentDetail = details[result.detail.assetID] ?? result.detail
        let normalizedDetail = normalizedForTransferActionReceipt(currentDetail)
        details[result.detail.assetID] = normalizedDetail
        return ChatMoneyActionResult(
            detail: normalizedDetail,
            payload: payloads[result.payload.assetID] ?? result.payload,
            walletBalance: result.walletBalance
        )
    }

    private func recordTransferAction(assetID: String, status: ChatMoneyStatus) {
        var receipts = transferActionReceipts()
        receipts[assetID] = TransferActionReceipt(
            status: status,
            completedAt: ISO8601DateFormatter().string(from: Date())
        )
        saveTransferActionReceipts(receipts)
    }

    private func normalizedForLocalReceipts(_ detail: ChatMoneyDetail) -> ChatMoneyDetail {
        normalizedForTerminalPermissions(
            normalizedForTransferActionReceipt(normalizedForViewerClaimReceipt(detail))
        )
    }

    private func normalizedForTerminalPermissions(_ detail: ChatMoneyDetail) -> ChatMoneyDetail {
        guard detail.status.isTerminal,
              detail.canClaim || detail.canAccept || detail.canReturn else { return detail }

        return ChatMoneyDetail(
            assetID: detail.assetID,
            kind: detail.kind,
            scope: detail.scope,
            mode: detail.mode,
            senderID: detail.senderID,
            senderName: detail.senderName,
            senderAvatarURL: detail.senderAvatarURL,
            recipientID: detail.recipientID,
            recipientName: detail.recipientName,
            totalAmount: detail.totalAmount,
            claimedAmount: detail.claimedAmount,
            packetCount: detail.packetCount,
            claimedCount: detail.claimedCount,
            greeting: detail.greeting,
            note: detail.note,
            status: detail.status,
            expiresAt: detail.expiresAt,
            canClaim: false,
            canAccept: false,
            canReturn: false,
            viewerClaimAmount: detail.viewerClaimAmount,
            claims: detail.claims,
            version: detail.version
        )
    }

    private func normalizedForTransferActionReceipt(_ detail: ChatMoneyDetail) -> ChatMoneyDetail {
        guard detail.kind == .transfer,
              let receipt = transferActionReceipts()[detail.assetID] else { return detail }

        return ChatMoneyDetail(
            assetID: detail.assetID,
            kind: detail.kind,
            scope: detail.scope,
            mode: detail.mode,
            senderID: detail.senderID,
            senderName: detail.senderName,
            senderAvatarURL: detail.senderAvatarURL,
            recipientID: detail.recipientID,
            recipientName: detail.recipientName,
            totalAmount: detail.totalAmount,
            claimedAmount: detail.claimedAmount,
            packetCount: detail.packetCount,
            claimedCount: detail.claimedCount,
            greeting: detail.greeting,
            note: detail.note,
            status: receipt.status,
            expiresAt: detail.expiresAt,
            canClaim: detail.canClaim,
            canAccept: false,
            canReturn: false,
            viewerClaimAmount: detail.viewerClaimAmount,
            claims: detail.claims,
            version: detail.version
        )
    }

    private func transferActionReceipts() -> [String: TransferActionReceipt] {
        guard let data = defaults.data(forKey: transferActionReceiptKey),
              let receipts = try? JSONDecoder().decode(
                  [String: TransferActionReceipt].self,
                  from: data
              ) else { return [:] }
        return receipts
    }

    private func saveTransferActionReceipts(_ receipts: [String: TransferActionReceipt]) {
        guard let data = try? JSONEncoder().encode(receipts) else { return }
        defaults.set(data, forKey: transferActionReceiptKey)
    }

    private func ensureEligibility(kind: ChatMoneyKind) throws {
        let enabled = kind == .redPacket
            ? configuration.redPacketEnabled
            : configuration.transferEnabled
        guard enabled else {
            throw APIError.serverError(code: 403, message: L10n.tr("chatMoney.featureDisabled"))
        }
        guard configuration.eligibility.eligible else {
            throw APIError.serverError(
                code: 403,
                message: configuration.eligibility.message ?? L10n.tr("chatMoney.notEligible")
            )
        }
    }

    private func perform<T>(assetID: String, operation: () async throws -> T) async throws -> T {
        guard activeOperationAssetID == nil else {
            throw APIError.serverError(code: 409, message: L10n.tr("chatMoney.operationInProgress"))
        }
        activeOperationAssetID = assetID
        errorMessage = nil
        defer { activeOperationAssetID = nil }
        do {
            return try await operation()
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            let message = (error as? LocalizedError)?.errorDescription
                ?? L10n.tr("chatMoney.operationFailed")
            errorMessage = message
            throw error
        }
    }

    private func applyWalletBalance(_ balance: WalletBalanceResponseData?) {
        guard let balance else { return }
        WalletStore.shared.applyServerBalance(balance)
        Task { await WalletStore.shared.loadTransactions(forceRefresh: true) }
    }
}

@MainActor
final class MockChatMoneyService: ChatMoneyServicing {
    private var nextMessageID = 900_000
    private var detailsByID: [String: ChatMoneyDetail] = [:]

    func configuration() async throws -> ChatMoneyConfiguration { .fixture }

    func createRedPacket(_ request: CreateRedPacketRequest) async throws -> ChatMoneyCreationResult {
        let payload = ChatMoneyPayload(
            assetID: request.clientMessageID,
            kind: .redPacket,
            scope: request.scope,
            mode: request.mode,
            senderID: AuthManager.shared.currentUser?.userID ?? "preview-me",
            recipientID: request.recipientID ?? request.receiverID,
            recipientName: request.recipientName,
            greeting: request.greeting,
            packetCount: request.packetCount,
            claimedCount: 0,
            status: .pending,
            expiresAt: Self.expiryString,
            version: 1
        )
        return creationResult(payload: payload, amount: request.totalAmount, groupID: request.groupID)
    }

    func createTransfer(_ request: CreateTransferRequest) async throws -> ChatMoneyCreationResult {
        let payload = ChatMoneyPayload(
            assetID: request.clientMessageID,
            kind: .transfer,
            scope: request.scope,
            senderID: AuthManager.shared.currentUser?.userID ?? "preview-me",
            recipientID: request.recipientID,
            recipientName: request.recipientName,
            note: request.note,
            amount: request.amount,
            status: .pending,
            expiresAt: Self.expiryString,
            version: 1
        )
        return creationResult(payload: payload, amount: request.amount, groupID: request.groupID)
    }

    func detail(assetID: String) async throws -> ChatMoneyDetail {
        guard let detail = detailsByID[assetID] else { throw APIError.invalidResponse }
        return detail
    }

    func claim(assetID: String) async throws -> ChatMoneyActionResult {
        try action(assetID: assetID, status: .completed)
    }

    func accept(assetID: String) async throws -> ChatMoneyActionResult {
        try action(assetID: assetID, status: .accepted)
    }

    func returnTransfer(assetID: String) async throws -> ChatMoneyActionResult {
        try action(assetID: assetID, status: .returned)
    }

    private func creationResult(
        payload: ChatMoneyPayload,
        amount: Int,
        groupID: Int?
    ) -> ChatMoneyCreationResult {
        nextMessageID += 1
        let content = payload.encodedContent ?? "{}"
        let now = ISO8601DateFormatter().string(from: Date())
        let message: ChatMoneyCreatedMessage
        if payload.scope == .direct {
            message = .direct(Message(
                id: nextMessageID,
                senderID: payload.senderID,
                receiverID: payload.recipientID ?? "preview-peer",
                msgType: payload.kind.rawValue,
                content: content,
                timestamp: now,
                replyToID: nil,
                replyTo: nil
            ))
        } else {
            message = .group(GroupMessage(
                id: nextMessageID,
                groupID: groupID ?? 1,
                senderID: payload.senderID,
                msgType: payload.kind.rawValue,
                content: content,
                timestamp: now,
                senderNickname: L10n.tr("common.me"),
                senderAvatar: "",
                replyToID: nil,
                replyTo: nil,
                mentions: nil,
                clientMessageID: payload.assetID
            ))
        }
        detailsByID[payload.assetID] = makeDetail(payload: payload, amount: amount)
        return ChatMoneyCreationResult(message: message, payload: payload, walletBalance: nil)
    }

    private func action(assetID: String, status: ChatMoneyStatus) throws -> ChatMoneyActionResult {
        guard let old = detailsByID[assetID] else { throw APIError.invalidResponse }
        let payload = ChatMoneyPayload(
            assetID: old.assetID,
            kind: old.kind,
            scope: old.scope,
            mode: old.mode,
            senderID: old.senderID,
            recipientID: old.recipientID,
            recipientName: old.recipientName,
            greeting: old.greeting,
            note: old.note,
            amount: old.kind == .transfer ? old.totalAmount : nil,
            packetCount: old.packetCount,
            claimedCount: status == .returned ? old.claimedCount : old.packetCount,
            status: status,
            expiresAt: old.expiresAt,
            version: old.version + 1
        )
        let detail = makeDetail(payload: payload, amount: old.totalAmount ?? 0)
        detailsByID[assetID] = detail
        return ChatMoneyActionResult(detail: detail, payload: payload, walletBalance: nil)
    }

    private func makeDetail(payload: ChatMoneyPayload, amount: Int) -> ChatMoneyDetail {
        ChatMoneyDetail(
            assetID: payload.assetID,
            kind: payload.kind,
            scope: payload.scope,
            mode: payload.mode,
            senderID: payload.senderID,
            senderName: L10n.tr("common.me"),
            senderAvatarURL: nil,
            recipientID: payload.recipientID,
            recipientName: payload.recipientName,
            totalAmount: amount,
            claimedAmount: payload.status.isTerminal ? amount : 0,
            packetCount: payload.packetCount,
            claimedCount: payload.claimedCount,
            greeting: payload.greeting,
            note: payload.note,
            status: payload.status,
            expiresAt: payload.expiresAt,
            canClaim: payload.kind == .redPacket && !payload.status.isTerminal,
            canAccept: payload.kind == .transfer && !payload.status.isTerminal,
            canReturn: payload.kind == .transfer && !payload.status.isTerminal,
            viewerClaimAmount: payload.status == .completed ? amount : nil,
            claims: [],
            version: payload.version
        )
    }

    private static var expiryString: String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(86_400))
    }
}
