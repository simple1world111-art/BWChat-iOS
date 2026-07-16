// BWChat/Components/ChatMoneyViews.swift

import SwiftUI
import UIKit

struct ChatMoneyRecipient: Identifiable, Hashable {
    let id: String
    let name: String
    let avatarURL: String
}

struct ChatMoneyConversationContext: Equatable {
    let scope: ChatMoneyScope
    let receiverID: String?
    let groupID: Int?
    let title: String
    let avatarURL: String
    let members: [ChatMoneyRecipient]

    static func direct(id: String, name: String, avatarURL: String) -> ChatMoneyConversationContext {
        ChatMoneyConversationContext(
            scope: .direct,
            receiverID: id,
            groupID: nil,
            title: name,
            avatarURL: avatarURL,
            members: [ChatMoneyRecipient(id: id, name: name, avatarURL: avatarURL)]
        )
    }

    static func group(id: Int, name: String, members: [GroupMember]) -> ChatMoneyConversationContext {
        ChatMoneyConversationContext(
            scope: .group,
            receiverID: nil,
            groupID: id,
            title: name,
            avatarURL: "",
            members: members.map {
                ChatMoneyRecipient(id: $0.userID, name: $0.nickname, avatarURL: $0.avatarURL)
            }
        )
    }
}

enum MoneyComposerDestination: Identifiable {
    case chooseRecipient(kind: ChatMoneyKind)
    case compose(kind: ChatMoneyKind, recipient: ChatMoneyRecipient?)
    case detail(payload: ChatMoneyPayload)

    var id: String {
        switch self {
        case .chooseRecipient(let kind): return "recipient-\(kind.rawValue)"
        case .compose(let kind, let recipient):
            return "compose-\(kind.rawValue)-\(recipient?.id ?? "none")"
        case .detail(let payload): return "detail-\(payload.assetID)"
        }
    }
}

struct ChatMoneyRecipientPickerSheet: View {
    @Environment(\.dismiss) private var dismiss

    let context: ChatMoneyConversationContext
    let onSelect: (ChatMoneyRecipient) -> Void

    private var recipients: [ChatMoneyRecipient] {
        let me = AuthManager.shared.currentUser?.userID
        return context.members.filter { $0.id != me }
    }

    var body: some View {
        NavigationStack {
            Group {
                if recipients.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "person.2.slash")
                            .font(.system(size: 34))
                            .foregroundColor(AppColors.tertiaryText)
                        Text(L10n.tr("chatMoney.noRecipients"))
                            .foregroundColor(AppColors.secondaryText)
                    }
                } else {
                    List(recipients) { recipient in
                        Button {
                            dismiss()
                            onSelect(recipient)
                        } label: {
                            HStack(spacing: 12) {
                                AvatarView(url: recipient.avatarURL, size: 42)
                                Text(recipient.name)
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundColor(AppColors.primaryText)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(AppColors.tertiaryText)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(L10n.tr("chatMoney.transfer.chooseRecipientTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.tr("common.cancel")) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

struct ChatMoneyPlusMenuTile: View {
    let kind: ChatMoneyKind
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(kind == .redPacket ? Color(hex: "FFF0ED") : Color(hex: "FFF8D8"))
                        .frame(width: 56, height: 56)
                    Image(systemName: kind == .redPacket ? "envelope.fill" : "arrow.left.arrow.right")
                        .font(.system(size: 22))
                        .foregroundColor(kind == .redPacket ? Color(hex: "F06455") : Color(hex: "D69C00"))
                }
                Text(kind == .redPacket
                     ? L10n.tr("chatMoney.redPacket")
                     : L10n.tr("chatMoney.transfer"))
                    .font(.system(size: 11))
                    .foregroundColor(AppColors.secondaryText)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("chatMoney.plus.\(kind.rawValue)")
    }
}

struct ChatMoneyBubble: View {
    let payload: ChatMoneyPayload
    let timeText: String
    let isFromMe: Bool
    var senderName: String?
    let onTap: () -> Void

    private var isMuted: Bool { payload.status.isTerminal }
    private var cardColor: Color {
        payload.kind == .redPacket ? Color(hex: "F06455") : Color(hex: "F4BD36")
    }

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(Color.white.opacity(0.22))
                            .frame(width: 44, height: 44)
                        Image(systemName: payload.kind == .redPacket ? "pawprint.fill" : "arrow.left.arrow.right")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundColor(.white)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        if let senderName, !senderName.isBlank {
                            Text(senderName)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(.white.opacity(0.8))
                                .lineLimit(1)
                        }
                        Text(primaryTitle)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                            .lineLimit(1)
                        Text(secondaryTitle)
                            .font(.system(size: 12))
                            .foregroundColor(.white.opacity(0.82))
                            .lineLimit(1)
                    }

                    Spacer(minLength: 8)
                }
                .padding(.horizontal, 13)
                .padding(.vertical, 12)

                HStack {
                    Text(payload.kind == .redPacket
                         ? L10n.tr("chatMoney.redPacket.brand")
                         : L10n.tr("chatMoney.transfer.brand"))
                    Spacer()
                    Text(timeText)
                        .monospacedDigit()
                }
                .font(.system(size: 10))
                .foregroundColor(Color.black.opacity(0.42))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.96))
            }
            .frame(width: 238)
            .background(cardColor.opacity(isMuted ? 0.58 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .black.opacity(0.08), radius: 5, y: 2)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("chatMoney.bubble.\(payload.assetID)")
    }

    private var primaryTitle: String {
        if payload.kind == .transfer {
            return L10n.tr("chatMoney.amountValue", payload.amount ?? 0)
        }
        if payload.mode == .exclusive, let name = payload.recipientName {
            return L10n.tr("chatMoney.redPacket.for", name)
        }
        return payload.greeting?.isBlank == false
            ? payload.greeting!
            : L10n.tr("chatMoney.redPacket.defaultGreeting")
    }

    private var secondaryTitle: String {
        if payload.status != .pending && payload.status != .partial {
            return payload.status.localizedTitle
        }
        if payload.kind == .transfer, let name = payload.recipientName {
            return L10n.tr("chatMoney.transfer.to", name)
        }
        if let count = payload.packetCount, count > 1 {
            return L10n.tr("chatMoney.redPacket.progress", payload.claimedCount ?? 0, count)
        }
        return L10n.tr("chatMoney.redPacket.openPrompt")
    }
}

struct ChatMoneyComposerSheet: View {
    private enum FocusField: Hashable {
        case amount
        case packetCount
        case message
    }

    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ChatMoneyStore

    let kind: ChatMoneyKind
    let context: ChatMoneyConversationContext
    let onCreated: (ChatMoneyCreationResult) -> Void
    let onOpenWallet: () -> Void

    @State private var mode: RedPacketMode = .lucky
    @State private var amountText = ""
    @State private var packetCountText = "1"
    @State private var greeting = L10n.tr("chatMoney.redPacket.defaultGreeting")
    @State private var note = ""
    @State private var selectedRecipient: ChatMoneyRecipient?
    @State private var isRecipientPickerExpanded = false
    @State private var showConfirmation = false
    @State private var localError: String?
    @State private var clientMessageID = UUID().uuidString
    @FocusState private var focusedField: FocusField?

    init(
        store: ChatMoneyStore,
        kind: ChatMoneyKind,
        context: ChatMoneyConversationContext,
        initialRecipient: ChatMoneyRecipient? = nil,
        onCreated: @escaping (ChatMoneyCreationResult) -> Void,
        onOpenWallet: @escaping () -> Void
    ) {
        self.store = store
        self.kind = kind
        self.context = context
        self.onCreated = onCreated
        self.onOpenWallet = onOpenWallet
        _selectedRecipient = State(initialValue: initialRecipient)
    }

    private var limits: ChatMoneyLimits { store.configuration.limits }
    private var amount: Int? { Int(amountText) }
    private var packetCount: Int? { Int(packetCountText) }

    private var totalAmount: Int? {
        guard let amount, amount > 0 else { return nil }
        if kind == .redPacket, context.scope == .group, mode == .equal {
            guard let packetCount else { return nil }
            let result = amount.multipliedReportingOverflow(by: packetCount)
            return result.overflow ? nil : result.partialValue
        }
        return amount
    }

    private var requiresRecipient: Bool {
        context.scope == .group && (kind == .transfer || mode == .exclusive)
    }

    private var candidateRecipients: [ChatMoneyRecipient] {
        let me = AuthManager.shared.currentUser?.userID
        return context.members.filter { $0.id != me }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    recipientHeader
                    if kind == .redPacket && context.scope == .group {
                        modePicker
                    }
                    if requiresRecipient {
                        recipientPicker
                    }
                    amountCard
                    messageCard
                    balanceRow
                    submitButton
                    complianceFootnote
                }
                .padding(20)
                .contentShape(Rectangle())
                .onTapGesture { dismissKeyboard() }
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color(hex: "F7F7F8").ignoresSafeArea())
            .navigationTitle(kind == .redPacket
                             ? L10n.tr("chatMoney.redPacket.sendTitle")
                             : L10n.tr("chatMoney.transfer.sendTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.tr("common.cancel")) { dismiss() }
                }
            }
            .task { await store.loadConfiguration() }
            .alert(
                L10n.tr("chatMoney.confirm.title"),
                isPresented: $showConfirmation,
                actions: {
                    Button(L10n.tr("common.cancel"), role: .cancel) {}
                    Button(L10n.tr("chatMoney.confirm.pay", totalAmount ?? 0)) {
                        Task { await submit() }
                    }
                },
                message: {
                    Text(confirmationMessage)
                }
            )
            .alert(
                L10n.tr("common.notice"),
                isPresented: Binding(
                    get: { localError != nil },
                    set: { if !$0 { localError = nil } }
                )
            ) {
                Button(L10n.tr("common.ok"), role: .cancel) {}
            } message: {
                Text(localError ?? "")
            }
        }
        .presentationDetents([.large])
    }

    private var recipientHeader: some View {
        VStack(spacing: 10) {
            AvatarView(url: selectedRecipient?.avatarURL ?? context.avatarURL, size: 58)
            Text(selectedRecipient?.name ?? context.title)
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
            Text(kind == .redPacket
                 ? L10n.tr("chatMoney.redPacket.headerHint")
                 : L10n.tr("chatMoney.transfer.headerHint"))
                .font(.system(size: 13))
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    private var modePicker: some View {
        Picker(L10n.tr("chatMoney.redPacket.mode"), selection: $mode) {
            Text(RedPacketMode.lucky.localizedTitle).tag(RedPacketMode.lucky)
            Text(RedPacketMode.equal.localizedTitle).tag(RedPacketMode.equal)
            Text(RedPacketMode.exclusive.localizedTitle).tag(RedPacketMode.exclusive)
        }
        .pickerStyle(.segmented)
        .onChange(of: mode) { next in
            dismissKeyboard()
            if next != .exclusive { selectedRecipient = nil }
            packetCountText = next == .exclusive ? "1" : packetCountText
        }
    }

    private var recipientPicker: some View {
        VStack(spacing: 0) {
            Button {
                dismissKeyboard()
                withAnimation(.easeInOut(duration: 0.2)) {
                    isRecipientPickerExpanded.toggle()
                }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "person.crop.circle.badge.checkmark")
                        .font(.system(size: 21))
                        .foregroundColor(AppColors.accent)
                    Text(selectedRecipient?.name ?? L10n.tr("chatMoney.chooseRecipient"))
                        .foregroundColor(selectedRecipient == nil ? AppColors.secondaryText : AppColors.primaryText)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(AppColors.tertiaryText)
                        .rotationEffect(.degrees(isRecipientPickerExpanded ? 180 : 0))
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isRecipientPickerExpanded {
                Divider()
                    .padding(.leading, 16)

                VStack(spacing: 0) {
                    ForEach(Array(candidateRecipients.enumerated()), id: \.element.id) { index, member in
                        Button {
                            dismissKeyboard()
                            selectedRecipient = member
                            withAnimation(.easeInOut(duration: 0.2)) {
                                isRecipientPickerExpanded = false
                            }
                        } label: {
                            HStack(spacing: 12) {
                                AvatarView(url: member.avatarURL, size: 36)
                                Text(member.name)
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundColor(AppColors.primaryText)
                                Spacer()
                                if member.id == selectedRecipient?.id {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 18, weight: .semibold))
                                        .foregroundColor(AppColors.accent)
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 11)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        if index < candidateRecipients.count - 1 {
                            Divider()
                                .padding(.leading, 64)
                        }
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 15))
        .disabled(candidateRecipients.isEmpty)
    }

    private var amountCard: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(amountLabel)
                    .font(.system(size: 15, weight: .medium))
                Spacer()
                TextField("0", text: $amountText)
                    .font(.system(size: 32, weight: .bold))
                    .keyboardType(.numberPad)
                    .focused($focusedField, equals: .amount)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 150)
                Text(L10n.tr("wallet.currency.catFood"))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(AppColors.secondaryText)
            }
            .padding(16)

            if kind == .redPacket && context.scope == .group && mode != .exclusive {
                Divider().padding(.leading, 16)
                HStack {
                    Text(L10n.tr("chatMoney.redPacket.count"))
                        .font(.system(size: 15, weight: .medium))
                    Spacer()
                    TextField("1", text: $packetCountText)
                        .keyboardType(.numberPad)
                        .focused($focusedField, equals: .packetCount)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 80)
                    Text(L10n.tr("chatMoney.redPacket.unit"))
                        .foregroundColor(AppColors.secondaryText)
                }
                .padding(16)
            }

            if mode == .equal, let totalAmount {
                Divider().padding(.leading, 16)
                HStack {
                    Text(L10n.tr("chatMoney.total"))
                    Spacer()
                    Text(L10n.tr("chatMoney.amountValue", totalAmount))
                        .fontWeight(.semibold)
                }
                .font(.system(size: 14))
                .foregroundColor(AppColors.secondaryText)
                .padding(16)
            }
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 15))
    }

    private var messageCard: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(kind == .redPacket ? L10n.tr("chatMoney.greeting") : L10n.tr("chatMoney.note"))
                .font(.system(size: 15, weight: .medium))
                .padding(.top, 2)
            TextField(
                kind == .redPacket
                    ? L10n.tr("chatMoney.redPacket.defaultGreeting")
                    : L10n.tr("chatMoney.transfer.notePlaceholder"),
                text: kind == .redPacket ? $greeting : $note,
                axis: .vertical
            )
            .lineLimit(1...3)
            .focused($focusedField, equals: .message)
            .multilineTextAlignment(.trailing)
            .onChange(of: note) { value in
                if value.count > 20 { note = String(value.prefix(20)) }
            }
            .onChange(of: greeting) { value in
                if value.count > 60 { greeting = String(value.prefix(60)) }
            }
        }
        .padding(16)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 15))
    }

    private var balanceRow: some View {
        HStack {
            Text(L10n.tr("chatMoney.availableBalance"))
            Spacer()
            Text(L10n.tr("chatMoney.amountValue", WalletStore.shared.rechargeClaimBalance ?? WalletStore.shared.balance ?? 0))
                .fontWeight(.semibold)
            Button(L10n.tr("chatMoney.topUp")) {
                dismiss()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: onOpenWallet)
            }
            .fontWeight(.semibold)
            .foregroundColor(AppColors.accent)
        }
        .font(.system(size: 13))
        .foregroundColor(AppColors.secondaryText)
    }

    private var submitButton: some View {
        Button {
            dismissKeyboard()
            guard validate() else { return }
            showConfirmation = true
        } label: {
            HStack(spacing: 8) {
                if store.activeOperationAssetID != nil { ProgressView().tint(.white) }
                Text(kind == .redPacket
                     ? L10n.tr("chatMoney.redPacket.submit")
                     : L10n.tr("chatMoney.transfer.submit"))
                    .font(.system(size: 17, weight: .bold))
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(kind == .redPacket ? Color(hex: "F06455") : Color(hex: "D8A20A"))
            .clipShape(RoundedRectangle(cornerRadius: 15))
        }
        .buttonStyle(.plain)
        .disabled(store.activeOperationAssetID != nil)
        .opacity(store.activeOperationAssetID == nil ? 1 : 0.7)
        .accessibilityIdentifier("chatMoney.submit")
    }

    private var complianceFootnote: some View {
        Text(L10n.tr("chatMoney.expiryNotice"))
            .font(.system(size: 12))
            .foregroundColor(AppColors.tertiaryText)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 12)
    }

    private var amountLabel: String {
        if kind == .redPacket && context.scope == .group && mode == .equal {
            return L10n.tr("chatMoney.redPacket.amountEach")
        }
        return L10n.tr("chatMoney.amount")
    }

    private var confirmationMessage: String {
        let recipient = selectedRecipient?.name ?? context.title
        return kind == .redPacket
            ? L10n.tr("chatMoney.confirm.redPacket", totalAmount ?? 0, recipient)
            : L10n.tr("chatMoney.confirm.transfer", totalAmount ?? 0, recipient)
    }

    private func dismissKeyboard() {
        focusedField = nil
        hideKeyboard()
    }

    private func validate() -> Bool {
        guard let totalAmount,
              totalAmount >= limits.minimumAmount,
              totalAmount <= limits.maximumAmount else {
            localError = L10n.tr("chatMoney.validation.amount", limits.minimumAmount, limits.maximumAmount)
            return false
        }
        if kind == .redPacket {
            guard let count = packetCount,
                  count > 0,
                  count <= limits.maximumPacketCount else {
                localError = L10n.tr("chatMoney.validation.count", limits.maximumPacketCount)
                return false
            }
            if context.scope == .group, !context.members.isEmpty, count > context.members.count {
                localError = L10n.tr("chatMoney.validation.memberCount", context.members.count)
                return false
            }
            if mode == .lucky, totalAmount < count {
                localError = L10n.tr("chatMoney.validation.minimumPerPacket")
                return false
            }
        }
        if requiresRecipient, selectedRecipient == nil {
            localError = candidateRecipients.isEmpty
                ? L10n.tr("chatMoney.noRecipients")
                : L10n.tr("chatMoney.chooseRecipient")
            return false
        }
        let balance = WalletStore.shared.rechargeClaimBalance ?? WalletStore.shared.balance ?? 0
        guard totalAmount <= balance else {
            localError = L10n.tr("gift.insufficientBalance")
            return false
        }
        return true
    }

    @MainActor
    private func submit() async {
        guard validate(), let totalAmount else { return }
        do {
            let result: ChatMoneyCreationResult
            if kind == .redPacket {
                let resolvedMode: RedPacketMode = context.scope == .direct ? .direct : mode
                result = try await store.createRedPacket(CreateRedPacketRequest(
                    clientMessageID: clientMessageID,
                    scope: context.scope,
                    receiverID: context.receiverID,
                    groupID: context.groupID,
                    recipientID: selectedRecipient?.id,
                    recipientName: selectedRecipient?.name,
                    mode: resolvedMode,
                    totalAmount: totalAmount,
                    amountPerPacket: resolvedMode == .equal ? amount : nil,
                    packetCount: context.scope == .direct || resolvedMode == .exclusive ? 1 : (packetCount ?? 1),
                    greeting: greeting.isBlank ? L10n.tr("chatMoney.redPacket.defaultGreeting") : greeting
                ))
            } else {
                let recipient = selectedRecipient ?? context.members.first
                guard let recipient else { return }
                result = try await store.createTransfer(CreateTransferRequest(
                    clientMessageID: clientMessageID,
                    scope: context.scope,
                    receiverID: context.receiverID,
                    groupID: context.groupID,
                    recipientID: recipient.id,
                    recipientName: recipient.name,
                    amount: totalAmount,
                    note: note
                ))
            }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onCreated(result)
            dismiss()
        } catch {
            localError = (error as? LocalizedError)?.errorDescription
                ?? L10n.tr("chatMoney.operationFailed")
        }
    }
}

struct ChatMoneyDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ChatMoneyStore
    let initialPayload: ChatMoneyPayload

    @State private var detail: ChatMoneyDetail?
    @State private var loadError: String?
    @State private var isOpening = false
    @State private var showClaimSuccess = false
    @State private var claimSuccessScale: CGFloat = 0.72
    @State private var claimSuccessRotation = -12.0
    @State private var claimSuccessAmount: Int?
    @State private var viewerClaimedInSession = false

    private var payload: ChatMoneyPayload {
        store.payloads[initialPayload.assetID] ?? initialPayload
    }

    private var detailDetents: Set<PresentationDetent> {
        initialPayload.kind == .transfer ? [.height(380)] : [.medium, .large]
    }

    var body: some View {
        NavigationStack {
            Group {
                if let detail {
                    detailContent(detail)
                } else if let loadError {
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 38))
                            .foregroundColor(Color(hex: "F06455"))
                        Text(loadError)
                            .multilineTextAlignment(.center)
                            .foregroundColor(AppColors.secondaryText)
                        Button(L10n.tr("common.retry")) { Task { await load(force: true) } }
                            .buttonStyle(.borderedProminent)
                            .tint(AppColors.accent)
                    }
                    .padding(28)
                } else {
                    ProgressView().tint(AppColors.accent)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(hex: "F7F7F8").ignoresSafeArea())
            .navigationTitle(payload.kind == .redPacket
                             ? L10n.tr("chatMoney.redPacket.detailTitle")
                             : L10n.tr("chatMoney.transfer.detailTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.tr("common.close")) { dismiss() }
                }
            }
        }
        .overlay {
            if showClaimSuccess {
                claimSuccessOverlay
                    .transition(.opacity)
            }
        }
        .presentationDetents(detailDetents)
        .task { await load(force: false) }
        .onChange(of: store.details[initialPayload.assetID]) { updated in
            guard !isOpening,
                  let updated,
                  updated.version > (detail?.version ?? -1) else { return }
            detail = updated
        }
    }

    @ViewBuilder
    private func detailContent(_ detail: ChatMoneyDetail) -> some View {
        ScrollView {
            VStack(spacing: 20) {
                VStack(spacing: 10) {
                    AvatarView(url: detail.senderAvatarURL ?? "", size: 64)
                    Text(detail.senderName ?? L10n.tr("chatMoney.sender"))
                        .font(.system(size: 18, weight: .semibold))
                    Text(detail.greeting ?? detail.note ?? L10n.tr("chatMoney.redPacket.defaultGreeting"))
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.secondaryText)
                        .multilineTextAlignment(.center)
                }

                if let amount = detail.viewerClaimAmount ?? (detail.kind == .transfer ? detail.totalAmount : nil) {
                    VStack(spacing: 3) {
                        Text("\(amount)")
                            .font(.system(size: 48, weight: .bold, design: .rounded))
                        Text(L10n.tr("wallet.currency.catFood"))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                    }
                }

                Text(displayedStatusTitle(for: detail))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(
                        viewerHasClaimed(detail) || detail.status.isTerminal
                            ? AppColors.secondaryText
                            : Color(hex: "D99A00")
                    )

                if detail.canClaim {
                    openButton(detail)
                } else if detail.kind == .redPacket,
                          detail.mode == .exclusive,
                          !detail.status.isTerminal,
                          detail.recipientID != AuthManager.shared.currentUser?.userID {
                    Label(
                        L10n.tr("chatMoney.redPacket.exclusiveOnly"),
                        systemImage: "person.crop.circle.badge.exclamationmark"
                    )
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                }
                if detail.canAccept || detail.canReturn {
                    transferActions(detail)
                }

                if detail.kind == .redPacket {
                    claimSummary(detail)
                }
            }
            .padding(22)
        }
    }

    private func openButton(_ detail: ChatMoneyDetail) -> some View {
        Button {
            guard !isOpening else { return }
            withAnimation(.spring(response: 0.5, dampingFraction: 0.68)) {
                isOpening = true
            }
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            Task { await claim(detail) }
        } label: {
            ZStack {
                Circle()
                    .fill(Color(hex: "F2B535"))
                    .frame(width: 82, height: 82)
                    .shadow(color: Color(hex: "F2B535").opacity(0.35), radius: 12, y: 5)
                if store.activeOperationAssetID == detail.assetID {
                    ProgressView().tint(.white)
                } else {
                    Text(L10n.tr("chatMoney.redPacket.open"))
                        .font(.system(size: 26, weight: .bold))
                        .foregroundColor(.white)
                }
            }
            .rotation3DEffect(.degrees(isOpening ? 540 : 0), axis: (x: 0, y: 1, z: 0))
            .scaleEffect(isOpening ? 0.88 : 1)
            .animation(.spring(response: 0.45, dampingFraction: 0.7), value: isOpening)
        }
        .buttonStyle(.plain)
        .disabled(store.activeOperationAssetID != nil)
        .accessibilityIdentifier("chatMoney.claim")
    }

    private func transferActions(_ detail: ChatMoneyDetail) -> some View {
        HStack(spacing: 12) {
            if detail.canReturn {
                Button(L10n.tr("chatMoney.transfer.return")) {
                    Task { await returnTransfer(detail) }
                }
                .buttonStyle(.bordered)
                .tint(Color(hex: "F06455"))
            }
            if detail.canAccept {
                Button(L10n.tr("chatMoney.transfer.accept")) {
                    Task { await accept(detail) }
                }
                .buttonStyle(.borderedProminent)
                .tint(Color(hex: "D8A20A"))
            }
        }
        .disabled(store.activeOperationAssetID != nil)
    }

    private func claimSummary(_ detail: ChatMoneyDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(L10n.tr("chatMoney.redPacket.claims"))
                    .font(.system(size: 16, weight: .semibold))
                Spacer()
                if let claimed = detail.claimedCount, let total = detail.packetCount {
                    Text(L10n.tr("chatMoney.redPacket.progress", claimed, total))
                        .font(.system(size: 13))
                        .foregroundColor(AppColors.secondaryText)
                }
            }

            if detail.claims.isEmpty {
                Text(L10n.tr("chatMoney.redPacket.noClaims"))
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.tertiaryText)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 14)
            } else {
                ForEach(detail.claims) { claim in
                    HStack(spacing: 10) {
                        AvatarView(url: claim.avatarURL ?? "", size: 38)
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(claim.nickname).fontWeight(.medium)
                                if claim.isLuckiest {
                                    Text(L10n.tr("chatMoney.redPacket.luckiest"))
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundColor(Color(hex: "D99A00"))
                                }
                            }
                            Text(TimestampHelper.formatTime(claim.claimedAt))
                                .font(.system(size: 11))
                                .foregroundColor(AppColors.tertiaryText)
                        }
                        Spacer()
                        Text(L10n.tr("chatMoney.amountValue", claim.amount))
                            .font(.system(size: 14, weight: .semibold))
                    }
                }
            }
        }
        .padding(16)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    @MainActor
    private func load(force: Bool) async {
        loadError = nil
        do {
            detail = try await store.loadDetail(assetID: initialPayload.assetID, force: force)
        } catch is CancellationError {
            return
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription
                ?? L10n.tr("chatMoney.operationFailed")
        }
    }

    @MainActor
    private func claim(_ detail: ChatMoneyDetail) async {
        let animationStartedAt = Date()
        defer {
            withAnimation(.easeOut(duration: 0.2)) {
                isOpening = false
            }
        }
        do {
            let result = try await store.claim(assetID: detail.assetID)
            // A successful claim response is authoritative for the current viewer,
            // even when the packet itself remains pending/partial for other members.
            viewerClaimedInSession = true
            let refreshed = try? await store.loadDetail(assetID: detail.assetID, force: true)
            let resolvedDetail = resolvedClaimDetail(
                result.detail,
                refreshed: refreshed,
                payload: store.payloads[detail.assetID] ?? result.payload
            )

            let elapsed = Date().timeIntervalSince(animationStartedAt)
            if elapsed < 0.7 {
                let remaining = UInt64((0.7 - elapsed) * 1_000_000_000)
                try? await Task.sleep(nanoseconds: remaining)
            }

            self.detail = resolvedDetail
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            await presentClaimSuccess(amount: resolvedDetail.viewerClaimAmount)
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription
        }
    }

    private var claimSuccessOverlay: some View {
        ZStack {
            Color.black.opacity(0.14)
                .ignoresSafeArea()

            VStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(Color(hex: "FFF1C7"))
                        .frame(width: 82, height: 82)
                    Circle()
                        .stroke(Color(hex: "F2B535").opacity(0.35), lineWidth: 8)
                        .frame(width: 98, height: 98)
                    Image(systemName: "pawprint.fill")
                        .font(.system(size: 38, weight: .bold))
                        .foregroundColor(Color(hex: "E7A80B"))
                        .rotationEffect(.degrees(claimSuccessRotation))
                }

                Text(L10n.tr("chatMoney.redPacket.claimSuccess"))
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(AppColors.primaryText)

                if let claimSuccessAmount {
                    Text(L10n.tr("chatMoney.redPacket.receivedAmount", claimSuccessAmount))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Color(hex: "D99A00"))
                }
            }
            .padding(.horizontal, 34)
            .padding(.vertical, 28)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .shadow(color: .black.opacity(0.16), radius: 18, y: 8)
            .scaleEffect(claimSuccessScale)
        }
        .allowsHitTesting(false)
    }

    @MainActor
    private func presentClaimSuccess(amount: Int?) async {
        claimSuccessAmount = amount
        claimSuccessScale = 0.72
        claimSuccessRotation = -12
        withAnimation(.spring(response: 0.45, dampingFraction: 0.66)) {
            showClaimSuccess = true
            claimSuccessScale = 1
            claimSuccessRotation = 0
        }
        try? await Task.sleep(nanoseconds: 1_150_000_000)
        withAnimation(.easeOut(duration: 0.22)) {
            showClaimSuccess = false
        }
    }

    private func resolvedClaimDetail(
        _ claimed: ChatMoneyDetail,
        refreshed: ChatMoneyDetail?,
        payload: ChatMoneyPayload
    ) -> ChatMoneyDetail {
        let base: ChatMoneyDetail
        if let refreshed, refreshed.version > claimed.version {
            base = refreshed
        } else {
            base = claimed
        }
        let payloadIsNewest = payload.version > base.version
        let viewerAmount = base.viewerClaimAmount
            ?? refreshed?.viewerClaimAmount
            ?? claimed.viewerClaimAmount
            ?? base.claims.first(where: {
                $0.userID == AuthManager.shared.currentUser?.userID
            })?.amount

        let packetCount = payloadIsNewest ? payload.packetCount ?? base.packetCount : base.packetCount
        let claimedCount = payloadIsNewest ? payload.claimedCount ?? base.claimedCount : base.claimedCount
        let snapshotStatus: ChatMoneyStatus
        if payload.version == base.version {
            snapshotStatus = mostAdvancedRedPacketStatus(base.status, payload.status)
        } else {
            snapshotStatus = payloadIsNewest ? payload.status : base.status
        }
        let resolvedStatus: ChatMoneyStatus
        if base.scope == .direct || packetCount == 1 || (claimedCount != nil && claimedCount == packetCount) {
            resolvedStatus = .completed
        } else if snapshotStatus == .pending, (claimedCount ?? 0) > 0 {
            resolvedStatus = .partial
        } else {
            resolvedStatus = snapshotStatus
        }

        return ChatMoneyDetail(
            assetID: base.assetID,
            kind: base.kind,
            scope: base.scope,
            mode: base.mode,
            senderID: base.senderID,
            senderName: base.senderName,
            senderAvatarURL: base.senderAvatarURL,
            recipientID: base.recipientID,
            recipientName: base.recipientName,
            totalAmount: base.totalAmount,
            claimedAmount: base.claimedAmount,
            packetCount: packetCount,
            claimedCount: claimedCount,
            greeting: base.greeting ?? payload.greeting,
            note: base.note ?? payload.note,
            status: resolvedStatus,
            expiresAt: base.expiresAt ?? payload.expiresAt,
            canClaim: false,
            canAccept: base.canAccept,
            canReturn: base.canReturn,
            viewerClaimAmount: viewerAmount,
            claims: base.claims.isEmpty ? claimed.claims : base.claims,
            version: max(base.version, payload.version)
        )
    }

    private func viewerHasClaimed(_ detail: ChatMoneyDetail) -> Bool {
        guard detail.kind == .redPacket else { return false }
        if viewerClaimedInSession
            || store.hasViewerClaimed(assetID: detail.assetID)
            || detail.viewerClaimAmount != nil { return true }
        guard let currentUserID = AuthManager.shared.currentUser?.userID else { return false }
        return detail.claims.contains { $0.userID == currentUserID }
    }

    private func displayedStatusTitle(for detail: ChatMoneyDetail) -> String {
        viewerHasClaimed(detail)
            ? L10n.tr("chatMoney.status.claimed")
            : detail.status.localizedTitle
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

    @MainActor
    private func accept(_ detail: ChatMoneyDetail) async {
        do {
            let result = try await store.accept(assetID: detail.assetID)
            self.detail = result.detail
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription
        }
    }

    @MainActor
    private func returnTransfer(_ detail: ChatMoneyDetail) async {
        do {
            let result = try await store.returnTransfer(assetID: detail.assetID)
            self.detail = result.detail
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription
        }
    }
}

#if DEBUG
@MainActor
private struct ChatMoneyComposerPreview: View {
    @StateObject private var store = ChatMoneyStore(service: MockChatMoneyService())

    var body: some View {
        ChatMoneyComposerSheet(
            store: store,
            kind: .redPacket,
            context: .group(
                id: 42,
                name: "猫友群",
                members: []
            ),
            onCreated: { _ in },
            onOpenWallet: {}
        )
    }
}

private struct ChatMoneyPlusMenuPreview: View {
    var body: some View {
        HStack(spacing: 20) {
            ChatMoneyPlusMenuTile(kind: .redPacket, action: {})
            ChatMoneyPlusMenuTile(kind: .transfer, action: {})
        }
        .padding(24)
        .background(Color(hex: "F7F7F8"))
    }
}

@MainActor
private struct ChatMoneyViews_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            ChatMoneyPlusMenuPreview()
                .previewDisplayName("Chat Money Plus Menu")
            ChatMoneyComposerPreview()
                .previewDisplayName("Chat Money Composer · Mock")
        }
    }
}
#endif
