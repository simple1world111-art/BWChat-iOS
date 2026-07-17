// BWChat/Components/ChatMoneyDetailViews.swift

import SwiftUI
import UIKit

struct ChatMoneyDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var navigator: UIKitNavigator

    @ObservedObject var store: ChatMoneyStore
    let initialPayload: ChatMoneyPayload

    @State private var detail: ChatMoneyDetail?
    @State private var loadError: String?
    @State private var showsReturnConfirmation = false

    private var payload: ChatMoneyPayload {
        store.payloads[initialPayload.assetID] ?? initialPayload
    }

    var body: some View {
        ZStack {
            ChatMoneyTheme.pageBackground.ignoresSafeArea()

            if let detail {
                if detail.kind == .redPacket {
                    RedPacketDetailContent(detail: detail)
                } else {
                    TransferDetailContent(
                        detail: detail,
                        isProcessing: store.activeOperationAssetID != nil,
                        onAccept: acceptTransfer,
                        onReturn: { showsReturnConfirmation = true },
                        onShowBalance: {
                            navigator.push(WalletView().hidesTabBarOnPush())
                        },
                        onShowBillDetails: {
                            navigator.push(
                                WalletTransactionDetailView().hidesTabBarOnPush()
                            )
                        }
                    )
                }
            } else if let loadError {
                ChatMoneyLoadErrorView(message: loadError, onRetry: retryLoad)
            } else {
                ProgressView()
                    .tint(AppColors.accent)
            }
        }
        .navigationTitle(
            payload.kind == .redPacket
                ? L10n.tr("chatMoney.redPacket.detailTitle")
                : ""
        )
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(
            payload.kind == .redPacket
                ? ChatMoneyTheme.envelopeRed
                : ChatMoneyTheme.pageBackground,
            for: .navigationBar
        )
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(
            payload.kind == .redPacket ? .dark : .light,
            for: .navigationBar
        )
        .hidesTabBarOnPush()
        .withUIKitBackButton(
            tint: payload.kind == .redPacket ? .white : AppColors.primaryText
        )
        .toolbar(
            payload.kind == .transfer ? .hidden : .visible,
            for: .navigationBar
        )
        .overlay(alignment: .topLeading) {
            if payload.kind == .transfer {
                AppBackButton {
                    if navigator.canPopPushedController {
                        navigator.pop()
                    } else {
                        dismiss()
                    }
                }
                .padding(.leading, 8)
                .padding(.top, 4)
            }
        }
        .confirmationDialog(
            L10n.tr("chatMoney.transfer.returnConfirmTitle"),
            isPresented: $showsReturnConfirmation,
            titleVisibility: .visible
        ) {
            Button(L10n.tr("chatMoney.transfer.return"), role: .destructive) {
                Task { await returnTransfer() }
            }
            Button(L10n.tr("common.cancel"), role: .cancel) {}
        } message: {
            Text(L10n.tr("chatMoney.transfer.returnConfirmMessage"))
        }
        .task { await load(force: false) }
        .onChange(of: store.details[initialPayload.assetID]) { updated in
            guard let updated,
                  updated.version > (detail?.version ?? -1) else { return }
            detail = updated
        }
    }

    private func retryLoad() {
        Task { await load(force: true) }
    }

    @MainActor
    private func load(force: Bool) async {
        loadError = nil
        do {
            let loaded = try await store.loadDetail(
                assetID: initialPayload.assetID,
                force: force
            )
            detail = loaded
        } catch is CancellationError {
            return
        } catch {
            loadError = ChatMoneyErrorText.message(for: error)
        }
    }

    private func acceptTransfer() {
        Task { await acceptTransferAsync() }
    }

    @MainActor
    private func acceptTransferAsync() async {
        guard let detail else { return }
        do {
            let result = try await store.accept(assetID: detail.assetID)
            self.detail = result.detail
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            loadError = ChatMoneyErrorText.message(for: error)
        }
    }

    @MainActor
    private func returnTransfer() async {
        guard let detail else { return }
        do {
            let result = try await store.returnTransfer(assetID: detail.assetID)
            self.detail = result.detail
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            loadError = ChatMoneyErrorText.message(for: error)
        }
    }
}

struct ChatMoneyRedPacketEntryOverlay: View {
    @ObservedObject var store: ChatMoneyStore
    let initialPayload: ChatMoneyPayload
    let isSender: Bool
    let onClose: () -> Void
    let onShowDetail: () -> Void

    @State private var detail: ChatMoneyDetail?
    @State private var loadError: String?
    @State private var isOpening = false

    var body: some View {
        ZStack {
            if let detail {
                RedPacketOpenEnvelope(
                    detail: detail,
                    isSender: isSender,
                    canOpen: ChatMoneyRedPacketPresentationPolicy.canShowOpenAction(
                        detail: detail,
                        isSender: isSender
                    ),
                    isOpening: isOpening,
                    errorMessage: loadError,
                    onClose: onClose,
                    onOpen: openRedPacket,
                    onViewDetails: onShowDetail
                )
            } else {
                Color.black.opacity(0.56)
                    .ignoresSafeArea()

                if let loadError {
                    VStack(spacing: 18) {
                        ChatMoneyLoadErrorView(
                            message: loadError,
                            onRetry: retryLoad
                        )

                        Button(L10n.tr("common.close"), action: onClose)
                            .font(.system(size: 15))
                            .foregroundColor(AppColors.primaryText)
                    }
                    .padding(.vertical, 22)
                    .frame(width: 300)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                } else {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(1.15)
                }
            }
        }
        .transition(.opacity)
        .task {
            await load(force: false)
        }
    }

    private func retryLoad() {
        Task { await load(force: true) }
    }

    @MainActor
    private func load(force: Bool) async {
        loadError = nil
        do {
            let loaded = try await store.loadDetail(
                assetID: initialPayload.assetID,
                force: force
            )
            guard shouldShowEnvelope(for: loaded) else {
                onShowDetail()
                return
            }
            detail = loaded
        } catch is CancellationError {
            return
        } catch {
            loadError = ChatMoneyErrorText.message(for: error)
        }
    }

    private func shouldShowEnvelope(for detail: ChatMoneyDetail) -> Bool {
        ChatMoneyRedPacketPresentationPolicy.shouldShowEnvelope(
            detail: detail,
            viewerID: AuthManager.shared.currentUser?.userID,
            isSender: isSender,
            hasLocalClaim: store.hasViewerClaimed(assetID: detail.assetID)
        )
    }

    private func openRedPacket() {
        guard !isOpening, let detail else { return }
        isOpening = true
        loadError = nil
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task { await claim(detail) }
    }

    @MainActor
    private func claim(_ current: ChatMoneyDetail) async {
        let startedAt = Date()
        do {
            _ = try await store.claim(assetID: current.assetID)
            let elapsed = Date().timeIntervalSince(startedAt)
            if elapsed < 0.75 {
                try? await Task.sleep(
                    nanoseconds: UInt64((0.75 - elapsed) * 1_000_000_000)
                )
            }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onShowDetail()
        } catch {
            loadError = ChatMoneyErrorText.message(for: error)
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            isOpening = false
        }
    }
}

private struct RedPacketOpenEnvelope: View {
    let detail: ChatMoneyDetail
    let isSender: Bool
    let canOpen: Bool
    let isOpening: Bool
    let errorMessage: String?
    let onClose: () -> Void
    let onOpen: () -> Void
    let onViewDetails: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.56).ignoresSafeArea()

            VStack(spacing: 0) {
                ZStack(alignment: .topLeading) {
                    ChatMoneyTheme.envelopeRed

                    Circle()
                        .fill(ChatMoneyTheme.envelopeDarkRed)
                        .frame(width: 470, height: 260)
                        .offset(x: -52, y: 230)

                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundColor(.white.opacity(0.85))
                            .frame(width: 44, height: 44)
                    }
                    .padding(4)

                    VStack(spacing: 12) {
                        AvatarView(url: detail.senderAvatarURL ?? "", size: 52)
                        Text(
                            isSender
                                ? L10n.tr("chatMoney.redPacket.sentByMe")
                                : L10n.tr(
                                    "chatMoney.redPacket.from",
                                    detail.senderName ?? L10n.tr("chatMoney.sender")
                                )
                        )
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(ChatMoneyTheme.gold)

                        Text(detail.greeting ?? L10n.tr("chatMoney.redPacket.defaultGreeting"))
                            .font(.system(size: 20, weight: .medium))
                            .foregroundColor(ChatMoneyTheme.gold)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .padding(.horizontal, 26)

                        Spacer()

                        if !canOpen {
                            VStack(spacing: 10) {
                                ZStack {
                                    Circle()
                                        .fill(ChatMoneyTheme.gold.opacity(0.92))
                                        .frame(width: 84, height: 84)
                                    Image(systemName: "clock")
                                        .font(.system(size: 31, weight: .medium))
                                        .foregroundColor(ChatMoneyTheme.envelopeDarkRed)
                                }
                                Text(waitingText)
                                    .font(.system(size: 14))
                                    .foregroundColor(ChatMoneyTheme.gold.opacity(0.92))
                            }
                        } else {
                            VStack(spacing: 10) {
                                Button(action: onOpen) {
                                    ZStack {
                                        Circle()
                                            .fill(ChatMoneyTheme.gold)
                                            .frame(width: 84, height: 84)
                                            .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
                                        if isOpening {
                                            ProgressView()
                                                .tint(ChatMoneyTheme.envelopeDarkRed)
                                        } else {
                                            Text(L10n.tr("chatMoney.redPacket.open"))
                                                .font(.system(size: 30, weight: .medium))
                                                .foregroundColor(ChatMoneyTheme.envelopeDarkRed)
                                        }
                                    }
                                    .rotation3DEffect(
                                        .degrees(isOpening ? 720 : 0),
                                        axis: (x: 0, y: 1, z: 0)
                                    )
                                    .animation(
                                        .linear(duration: 0.75).repeatCount(isOpening ? 20 : 1),
                                        value: isOpening
                                    )
                                }
                                .buttonStyle(.plain)
                                .disabled(isOpening)
                                .accessibilityIdentifier("chatMoney.claim")

                                Text(L10n.tr("chatMoney.redPacket.claimPrompt"))
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(ChatMoneyTheme.gold.opacity(0.96))
                            }
                        }

                        if let errorMessage {
                            Text(errorMessage)
                                .font(.system(size: 12))
                                .foregroundColor(.white.opacity(0.9))
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 24)
                        }

                        Button(L10n.tr("chatMoney.redPacket.viewDetails"), action: onViewDetails)
                            .font(.system(size: 14))
                            .foregroundColor(ChatMoneyTheme.gold.opacity(0.92))
                            .disabled(isOpening)
                            .padding(.bottom, 22)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
                }
            }
            .frame(width: 318, height: 472)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .shadow(color: .black.opacity(0.28), radius: 24, y: 12)
        }
    }

    private var waitingText: String {
        if isSender, detail.mode == .exclusive {
            return L10n.tr("chatMoney.redPacket.waitingForExclusiveRecipient")
        }
        return L10n.tr("chatMoney.redPacket.waitingForRecipient")
    }
}

private struct RedPacketDetailContent: View {
    let detail: ChatMoneyDetail

    private var senderHeading: String {
        if detail.senderID == AuthManager.shared.currentUser?.userID {
            return L10n.tr("chatMoney.redPacket.sentByMe")
        }
        return L10n.tr(
            "chatMoney.redPacket.from",
            detail.senderName ?? L10n.tr("chatMoney.sender")
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 0) {
                    VStack(spacing: 10) {
                        AvatarView(url: detail.senderAvatarURL ?? "", size: 54)
                        Text(senderHeading)
                            .font(.system(size: 15))
                            .foregroundColor(.white.opacity(0.82))
                        Text(detail.greeting ?? L10n.tr("chatMoney.redPacket.defaultGreeting"))
                            .font(.system(size: 18, weight: .medium))
                            .foregroundColor(ChatMoneyTheme.gold)
                            .multilineTextAlignment(.center)

                        if let amount = detail.viewerClaimAmount {
                            HStack(alignment: .firstTextBaseline, spacing: 5) {
                                Text("\(amount)")
                                    .font(.system(size: 48, weight: .medium))
                                    .monospacedDigit()
                                Text(L10n.tr("wallet.currency.catFood"))
                                    .font(.system(size: 14))
                            }
                            .foregroundColor(ChatMoneyTheme.gold)
                            .padding(.top, 8)
                        } else {
                            Text(statusText)
                                .font(.system(size: 15))
                                .foregroundColor(.white.opacity(0.78))
                                .padding(.top, 8)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 26)
                    .padding(.bottom, 28)
                    .background(ChatMoneyTheme.envelopeRed)

                    HStack {
                        Text(summaryText)
                            .font(.system(size: 13))
                            .foregroundColor(ChatMoneyTheme.secondary)
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .frame(height: 44)

                    Divider()

                    if detail.claims.isEmpty {
                        Text(L10n.tr("chatMoney.redPacket.noClaims"))
                            .font(.system(size: 14))
                            .foregroundColor(Color(hex: "B2B2B2"))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 36)
                    } else {
                        LazyVStack(spacing: 0) {
                            ForEach(detail.claims) { claim in
                                ChatMoneyClaimRow(
                                    claim: claim,
                                    showsLuckiest: detail.status == .completed
                                        || (detail.claimedCount != nil
                                            && detail.claimedCount == detail.packetCount)
                                )
                                Divider().padding(.leading, 66)
                            }
                        }
                        .background(Color.white)
                    }
                }
            }

            ChatMoneyDetailTimeFooter(
                detail: detail,
                backgroundColor: ChatMoneyTheme.pageBackground
            )
        }
    }

    private var statusText: String {
        if detail.senderID == AuthManager.shared.currentUser?.userID,
           !ChatMoneyRedPacketPresentationPolicy.senderCanClaimOwnPacket(
               scope: detail.scope,
               mode: detail.mode
           ),
           detail.unavailableReason == nil,
           detail.status == .pending || detail.status == .partial {
            return L10n.tr("chatMoney.redPacket.waitingForRecipient")
        }
        switch detail.unavailableReason {
        case .alreadyClaimed:
            return L10n.tr("chatMoney.redPacket.alreadyClaimed")
        case .empty:
            return L10n.tr("chatMoney.redPacket.empty")
        case .expired:
            return L10n.tr("chatMoney.redPacket.expired")
        case .recipientOnly:
            return L10n.tr("chatMoney.redPacket.exclusiveOnly")
        case .notConversationMember:
            return L10n.tr("chatMoney.redPacket.notConversationMember")
        default:
            return detail.status.localizedTitle
        }
    }

    private var summaryText: String {
        guard let claimed = detail.claimedCount, let total = detail.packetCount else {
            return L10n.tr("chatMoney.redPacket.claims")
        }
        return L10n.tr("chatMoney.redPacket.summary", claimed, total)
    }
}

private struct ChatMoneyClaimRow: View {
    let claim: ChatMoneyClaimRecord
    let showsLuckiest: Bool

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(url: claim.avatarURL ?? "", size: 40)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(claim.nickname)
                        .font(.system(size: 15))
                    if claim.isLuckiest && showsLuckiest {
                        Text(L10n.tr("chatMoney.redPacket.luckiest"))
                            .font(.system(size: 10))
                            .foregroundColor(ChatMoneyTheme.cardOrange)
                    }
                }
                Text(TimestampHelper.formatTime(claim.claimedAt))
                    .font(.system(size: 11))
                    .foregroundColor(Color(hex: "B2B2B2"))
            }
            Spacer()
            Text(L10n.tr("chatMoney.amountValue", claim.amount))
                .font(.system(size: 15))
        }
        .padding(.horizontal, 16)
        .frame(height: 68)
    }
}

private struct TransferDetailContent: View {
    let detail: ChatMoneyDetail
    let isProcessing: Bool
    let onAccept: () -> Void
    let onReturn: () -> Void
    let onShowBalance: () -> Void
    let onShowBillDetails: () -> Void

    var body: some View {
        GeometryReader { proxy in
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    statusSummary
                    transferTimes

                    if showsReceivedBalance {
                        walletCenterEntry
                    }

                    Spacer(minLength: 32)
                    bottomActions
                }
                .frame(maxWidth: .infinity)
                .frame(minHeight: proxy.size.height)
            }
        }
        .background(Color.white)
    }

    private var statusSummary: some View {
        VStack(spacing: 0) {
            statusSymbol
                .padding(.top, 110)

            Text(statusTitle)
                .font(.system(size: 18))
                .foregroundColor(AppColors.primaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 30)
                .padding(.top, 42)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(verbatim: "\(detail.totalAmount ?? 0)")
                    .font(.system(size: 48, weight: .medium))
                    .monospacedDigit()
                Text(L10n.tr("wallet.currency.catFood"))
                    .font(.system(size: 15))
            }
            .foregroundColor(AppColors.primaryText)
            .padding(.top, 22)

            if let note = detail.note, !note.isBlank {
                Text(note)
                    .font(.system(size: 14))
                    .foregroundColor(ChatMoneyTheme.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 30)
                    .padding(.top, 12)
            }

            if showsReceivedBalance {
                Button(action: onShowBalance) {
                    Text(L10n.tr("wallet.balance"))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(linkColor)
                }
                .buttonStyle(.plain)
                .padding(.top, 22)
                .accessibilityIdentifier("chatMoney.transfer.balance")
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var statusSymbol: some View {
        if isPending {
            Image(systemName: "clock")
                .font(.system(size: 64, weight: .regular))
                .foregroundColor(Color(hex: "10AEFF"))
                .accessibilityHidden(true)
        } else {
            ZStack {
                Circle()
                    .fill(statusColor)
                    .frame(width: 62, height: 62)
                Image(systemName: statusIcon)
                    .font(.system(size: 29, weight: .bold))
                    .foregroundColor(.white)
            }
            .accessibilityHidden(true)
        }
    }

    private var transferTimes: some View {
        VStack(spacing: 0) {
            Divider()

            VStack(spacing: 12) {
                if let createdAt = detail.createdAt {
                    TransferDetailTimeRow(
                        title: L10n.tr("chatMoney.transfer.transferTime"),
                        timestamp: createdAt
                    )
                }

                if !isPending, let finalizedAt = detail.finalizedAt {
                    TransferDetailTimeRow(
                        title: finalTimeTitle,
                        timestamp: finalizedAt
                    )
                }
            }
            .padding(.vertical, 18)

            if !isPending {
                Divider()
            }
        }
        .padding(.horizontal, 30)
        .padding(.top, showsReceivedBalance ? 40 : 52)
    }

    private var walletCenterEntry: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color(hex: "F7F7F7"))
                    .frame(width: 54, height: 54)
                Image(systemName: "pawprint.fill")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundColor(Color(hex: "F4B400"))
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(L10n.tr("chatMoney.transfer.walletCenter"))
                    .font(.system(size: 14))
                    .foregroundColor(ChatMoneyTheme.secondary)
                Text(L10n.tr("chatMoney.transfer.walletCenterSubtitle"))
                    .font(.system(size: 16))
                    .foregroundColor(AppColors.primaryText)
            }

            Spacer(minLength: 8)

            Button(action: onShowBalance) {
                Text(L10n.tr("chatMoney.transfer.enterWallet"))
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.white)
                    .padding(.horizontal, 15)
                    .frame(height: 39)
                    .background(ChatMoneyTheme.actionGreen)
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("chatMoney.transfer.walletCenter")
        }
        .padding(.vertical, 20)
        .padding(.horizontal, 30)
    }

    @ViewBuilder
    private var bottomActions: some View {
        if isPending {
            VStack(spacing: 24) {
                if detail.canAccept {
                    Button(action: onAccept) {
                        HStack(spacing: 8) {
                            if isProcessing {
                                ProgressView().tint(.white)
                            }
                            Text(L10n.tr("chatMoney.transfer.acceptShort"))
                                .font(.system(size: 18, weight: .medium))
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(ChatMoneyTheme.actionGreen)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .disabled(isProcessing)
                    .accessibilityIdentifier("chatMoney.transfer.accept")
                }

                HStack(spacing: 3) {
                    Text(L10n.tr("chatMoney.transfer.expiryActionNotice"))
                        .foregroundColor(ChatMoneyTheme.secondary)

                    if detail.canReturn {
                        Button(L10n.tr("chatMoney.transfer.return"), action: onReturn)
                            .foregroundColor(linkColor)
                            .disabled(isProcessing)
                    }
                }
                .font(.system(size: 14))
                .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 42)
            .padding(.bottom, 36)
        } else if !isPending {
            Button(action: onShowBillDetails) {
                Text(L10n.tr("chatMoney.transfer.billDetails"))
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(linkColor)
            }
            .buttonStyle(.plain)
            .padding(.bottom, 42)
            .accessibilityIdentifier("chatMoney.transfer.billDetails")
        }
    }

    private var statusTitle: String {
        if isAccepted {
            if viewerIsRecipient {
                return L10n.tr("chatMoney.transfer.receivedIntoBalance")
            }
            if viewerIsSender, let recipientName = detail.recipientName, !recipientName.isBlank {
                return L10n.tr("chatMoney.receipt.transferAcceptedMine", recipientName)
            }
            return L10n.tr("chatMoney.receipt.transferAccepted")
        }

        switch detail.viewerState {
        case .transferReceivable:
            return L10n.tr("chatMoney.transfer.waitingForYou")
        case .transferSenderWaiting:
            return L10n.tr("chatMoney.transfer.waitingForRecipient")
        case .transferObserver:
            return L10n.tr("chatMoney.transfer.pendingReceipt")
        case .returned:
            return L10n.tr("chatMoney.status.returned")
        case .expiredRefunded:
            return L10n.tr("chatMoney.status.expiredRefunded")
        default:
            return detail.status.localizedTitle
        }
    }

    private var finalTimeTitle: String {
        isAccepted
            ? L10n.tr("chatMoney.transfer.receivedTime")
            : L10n.tr("chatMoney.transfer.returnedTime")
    }

    private var isPending: Bool {
        detail.status == .pending || detail.status == .partial
    }

    private var isAccepted: Bool {
        detail.status == .accepted || detail.viewerState == .accepted
    }

    private var viewerIsSender: Bool {
        detail.senderID == AuthManager.shared.currentUser?.userID
    }

    private var viewerIsRecipient: Bool {
        if detail.viewerState == .transferReceivable {
            return true
        }
        guard let viewerID = AuthManager.shared.currentUser?.userID else {
            return detail.viewerState == .accepted
        }
        return detail.recipientID == viewerID
    }

    private var showsReceivedBalance: Bool {
        isAccepted && viewerIsRecipient
    }

    private var statusColor: Color {
        switch detail.status {
        case .accepted:
            return ChatMoneyTheme.actionGreen
        case .returned, .expiredRefunded:
            return Color(hex: "B2B2B2")
        default:
            return ChatMoneyTheme.cardOrange
        }
    }

    private var statusIcon: String {
        switch detail.status {
        case .accepted: return "checkmark"
        case .returned, .expiredRefunded: return "arrow.uturn.backward"
        default: return "arrow.left.arrow.right"
        }
    }

    private var linkColor: Color {
        Color(hex: "576B95")
    }
}

private struct TransferDetailTimeRow: View {
    let title: String
    let timestamp: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(title)
                .foregroundColor(ChatMoneyTheme.secondary)
            Spacer(minLength: 10)
            Text(TimestampHelper.formatDetailedDateTime(timestamp))
                .foregroundColor(AppColors.primaryText)
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
        }
        .font(.system(size: 15))
    }
}

private struct ChatMoneyDetailTimeFooter: View {
    let detail: ChatMoneyDetail
    let backgroundColor: Color

    private var timestamp: String? {
        detail.finalizedAt ?? detail.createdAt
    }

    private var showsExpiryNotice: Bool {
        detail.status == .pending || detail.status == .partial
    }

    var body: some View {
        if timestamp != nil || showsExpiryNotice {
            VStack(spacing: 5) {
                if let timestamp {
                    Text(TimestampHelper.formatTime(timestamp))
                }

                if showsExpiryNotice {
                    Text(L10n.tr("chatMoney.expiryNotice"))
                }
            }
            .font(.system(size: 11))
            .foregroundColor(Color(hex: "B2B2B2"))
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 20)
            .padding(.top, 5)
            .padding(.bottom, 2)
            .background(backgroundColor)
        }
    }
}

#if DEBUG
struct ChatMoneyTransferFeedbackPreviewView: View {
    private let detail = ChatMoneyDetail(
        assetID: "preview-transfer",
        kind: .transfer,
        scope: .direct,
        mode: nil,
        senderID: "preview-sender",
        senderName: "Simple",
        senderAvatarURL: nil,
        recipientID: "preview-recipient",
        recipientName: "Peter",
        totalAmount: 200,
        claimedAmount: nil,
        packetCount: nil,
        claimedCount: nil,
        greeting: nil,
        note: "晚饭猫粮",
        status: .pending,
        expiresAt: nil,
        canClaim: false,
        canAccept: true,
        canReturn: true,
        viewerClaimAmount: nil,
        claims: [],
        version: 1,
        createdAt: "2026-07-17T16:05:00Z",
        viewerState: .transferReceivable
    )

    var body: some View {
        NavigationStack {
            TransferDetailContent(
                detail: detail,
                isProcessing: false,
                onAccept: {},
                onReturn: {},
                onShowBalance: {},
                onShowBillDetails: {}
            )
            .navigationTitle(L10n.tr("chatMoney.transfer.detailTitle"))
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
#endif

private struct ChatMoneyLoadErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 36))
                .foregroundColor(ChatMoneyTheme.actionRed)
            Text(message)
                .font(.system(size: 14))
                .foregroundColor(ChatMoneyTheme.secondary)
                .multilineTextAlignment(.center)
            Button(L10n.tr("common.retry"), action: onRetry)
                .buttonStyle(.borderedProminent)
                .tint(AppColors.accent)
        }
        .padding(28)
    }
}
