// BWChat/Components/ChatMoneyComposerViews.swift

import SwiftUI
import UIKit

struct ChatMoneyRecipientPickerSheet: View {
    let context: ChatMoneyConversationContext
    let onSelect: (ChatMoneyRecipient) -> Void

    @State private var searchText = ""
    @State private var selectedRecipientID: String?

    init(
        context: ChatMoneyConversationContext,
        selectedRecipientID: String? = nil,
        onSelect: @escaping (ChatMoneyRecipient) -> Void
    ) {
        self.context = context
        self.onSelect = onSelect
        _selectedRecipientID = State(initialValue: selectedRecipientID)
    }

    private var recipients: [ChatMoneyRecipient] {
        let me = AuthManager.shared.currentUser?.userID
        let available = context.members.filter { $0.id != me }
        guard !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return available
        }
        return available.filter {
            $0.name.localizedCaseInsensitiveContains(searchText)
                || $0.id.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        List {
            if recipients.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "person.2.slash")
                        .font(.system(size: 32))
                        .foregroundStyle(.secondary)
                    Text(L10n.tr("chatMoney.noRecipients"))
                        .font(.system(size: 15))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 220)
                .listRowBackground(Color.clear)
            } else {
                ForEach(recipients) { recipient in
                    Button {
                        selectedRecipientID = recipient.id
                        onSelect(recipient)
                    } label: {
                        HStack(spacing: 12) {
                            AvatarView(url: recipient.avatarURL, size: 42)
                            Text(recipient.name)
                                .font(.system(size: 16))
                                .foregroundColor(AppColors.primaryText)
                            Spacer()
                            if recipient.id == selectedRecipientID {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundColor(ChatMoneyTheme.actionGreen)
                            }
                        }
                        .contentShape(Rectangle())
                        .padding(.vertical, 3)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(ChatMoneyTheme.pageBackground)
        .scrollDismissesKeyboard(.interactively)
        .onTapGesture {
            hideKeyboard()
        }
        .searchable(
            text: $searchText,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: Text(L10n.tr("chatMoney.recipient.search"))
        )
        .navigationTitle(L10n.tr("chatMoney.transfer.chooseRecipientTitle"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
    }
}

struct ChatMoneyComposerSheet: View {
    fileprivate enum FocusField: Hashable {
        case amount
        case count
        case message
    }

    @EnvironmentObject private var navigator: UIKitNavigator

    @ObservedObject var store: ChatMoneyStore
    let kind: ChatMoneyKind
    let context: ChatMoneyConversationContext
    let onCreated: (ChatMoneyCreationResult) -> Void
    let onOpenWallet: () -> Void

    @State private var mode: RedPacketMode
    @State private var amountText = ""
    @State private var packetCountText = ""
    @State private var messageText: String
    @State private var selectedRecipient: ChatMoneyRecipient?
    @State private var submissionError: String?
    @State private var isSubmitting = false
    @State private var clientMessageID = UUID().uuidString
    @FocusState private var focusedField: FocusField?

    private var limits: ChatMoneyLimits { store.configuration.limits }
    private var featureEnabled: Bool {
        kind == .redPacket
            ? store.configuration.redPacketEnabled
            : store.configuration.transferEnabled
    }
    private var amount: Int? { Int(amountText) }
    private var packetCount: Int? { Int(packetCountText) }
    private var isGroupRedPacket: Bool { kind == .redPacket && context.scope == .group }
    private var isExclusive: Bool { isGroupRedPacket && mode == .exclusive }
    private var recipients: [ChatMoneyRecipient] {
        let me = AuthManager.shared.currentUser?.userID
        return context.members.filter { $0.id != me }
    }
    private var displayedBalance: Int {
        WalletStore.shared.goldCoinBalanceValue ?? 0
    }
    private var totalAmount: Int? {
        guard let amount, amount > 0 else { return nil }
        if isGroupRedPacket, mode == .equal {
            guard let packetCount, packetCount > 0 else { return nil }
            let value = amount.multipliedReportingOverflow(by: packetCount)
            return value.overflow ? nil : value.partialValue
        }
        return amount
    }
    private var packetCountValidationMessage: String? {
        guard kind == .redPacket,
              isGroupRedPacket,
              mode != .exclusive,
              !packetCountText.isEmpty else { return nil }
        guard let packetCount, packetCount > 0 else {
            return L10n.tr(
                "chatMoney.validation.count",
                limits.maximumPacketCount
            )
        }
        guard packetCount <= limits.maximumPacketCount else {
            return L10n.tr("chatMoney.validation.count", limits.maximumPacketCount)
        }
        guard packetCount <= max(recipients.count + 1, 1) else {
            return L10n.tr(
                "chatMoney.validation.memberCount",
                max(recipients.count + 1, 1)
            )
        }
        return nil
    }
    private var amountValidationMessage: String? {
        guard !amountText.isEmpty else { return nil }
        guard let amount, amount > 0 else {
            return L10n.tr("chatMoney.validation.invalidNumber")
        }
        if isGroupRedPacket, mode == .equal,
           packetCountValidationMessage != nil || packetCount == nil {
            return nil
        }
        guard let totalAmount else {
            return L10n.tr("chatMoney.validation.invalidNumber")
        }
        let minimum = limits.minimumAmount(for: kind)
        let maximum = limits.maximumAmount(for: kind)
        guard totalAmount >= minimum, totalAmount <= maximum else {
            return L10n.tr("chatMoney.validation.amount", minimum, maximum)
        }
        if kind == .redPacket, isGroupRedPacket {
            if mode == .lucky,
               packetCountValidationMessage == nil,
               let packetCount,
               packetCount > 0,
               totalAmount < packetCount {
                return L10n.tr("chatMoney.validation.minimumPerPacket")
            }
        }
        guard totalAmount <= displayedBalance else {
            return L10n.tr("gift.insufficientBalance")
        }
        return nil
    }
    private var currentValidationMessage: String? {
        packetCountValidationMessage ?? amountValidationMessage
    }
    private var canSubmit: Bool {
        guard store.configuration.eligibility.eligible,
              featureEnabled,
              let totalAmount,
              totalAmount > 0,
              currentValidationMessage == nil else { return false }
        if isGroupRedPacket {
            guard let packetCount, packetCount > 0 else { return false }
        }
        if kind == .transfer {
            return (selectedRecipient ?? context.members.first) != nil
        }
        return !isExclusive || selectedRecipient != nil
    }

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
        _mode = State(initialValue: context.scope == .direct ? .direct : .lucky)
        _messageText = State(
            initialValue: kind == .redPacket
                ? L10n.tr("chatMoney.redPacket.defaultGreeting")
                : ""
        )
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if kind == .redPacket {
                    RedPacketComposerContent(
                        context: context,
                        mode: $mode,
                        amountText: $amountText,
                        packetCountText: $packetCountText,
                        messageText: $messageText,
                        selectedRecipient: selectedRecipient,
                        totalAmount: totalAmount,
                        memberCount: max(context.members.count, 1),
                        packetCountValidationMessage: packetCountValidationMessage,
                        amountValidationMessage: amountValidationMessage,
                        amountFocus: $focusedField,
                        onChooseRecipient: chooseExclusiveRecipient,
                        onModeChange: changeMode
                    )
                } else {
                    TransferComposerContent(
                        recipient: selectedRecipient ?? context.members.first,
                        amountText: $amountText,
                        noteText: $messageText,
                        validationMessage: amountValidationMessage,
                        amountFocus: $focusedField
                    )
                }

                ChatMoneyBalanceRow(
                    balance: displayedBalance,
                    onTopUp: openWallet
                )
                .padding(.top, 18)

                VStack(spacing: 12) {
                    ChatMoneyTotalSection(
                        totalAmount: totalAmount ?? 0,
                        buttonTitle: kind == .redPacket
                            ? L10n.tr("chatMoney.redPacket.submit")
                            : L10n.tr("chatMoney.transfer.submit"),
                        canSubmit: canSubmit && !isSubmitting,
                        isProcessing: isSubmitting,
                        errorMessage: submissionError,
                        onSubmit: {
                            dismissInput()
                            Task { await submit() }
                        }
                    )

                    Text(L10n.tr("chatMoney.expiryNotice"))
                        .font(.system(size: 12))
                        .foregroundColor(Color(hex: "B2B2B2"))
                }
                .padding(.top, 34)
                .padding(.bottom, 36)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .onTapGesture {
                    dismissInput()
                }
            }
            .padding(.horizontal, 16)
        }
        .scrollDismissesKeyboard(.interactively)
        .onTapGesture {
            dismissInput()
        }
        .background(ChatMoneyTheme.pageBackground.ignoresSafeArea())
        .navigationTitle(kind == .redPacket
                         ? L10n.tr("chatMoney.redPacket.sendTitle")
                         : L10n.tr("chatMoney.transfer.sendTitle"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .task {
            await store.loadConfiguration()
            focusAmount()
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .onChange(of: amountText) { newValue in
            amountText = sanitizeDigits(newValue)
        }
        .onChange(of: packetCountText) { newValue in
            packetCountText = sanitizeDigits(newValue)
        }
        .onChange(of: messageText) { next in
            let maximum = kind == .redPacket
                ? limits.maximumGreetingLength ?? 60
                : limits.maximumTransferNoteLength ?? 20
            if next.count > maximum {
                messageText = String(next.prefix(maximum))
            }
        }
    }

    private func focusAmount() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            focusedField = .amount
        }
    }

    private func chooseExclusiveRecipient() {
        dismissInput()
        navigator.push(
            ChatMoneyRecipientPickerSheet(
                context: context,
                selectedRecipientID: selectedRecipient?.id
            ) { recipient in
                selectedRecipient = recipient
                packetCountText = "1"
                navigator.pop()
            }
        )
    }

    private func changeMode(_ next: RedPacketMode) {
        dismissInput()
        mode = next
        submissionError = nil
        if next == .exclusive {
            packetCountText = "1"
            if selectedRecipient == nil {
                chooseExclusiveRecipient()
            }
        } else {
            selectedRecipient = nil
            if packetCountText == "1" {
                packetCountText = ""
            }
        }
    }

    private func openWallet() {
        dismissInput()
        onOpenWallet()
    }

    private func dismissInput() {
        focusedField = nil
        hideKeyboard()
    }

    @MainActor
    private func submit() async {
        guard canSubmit, !isSubmitting, let totalAmount else { return }
        submissionError = nil
        isSubmitting = true
        defer { isSubmitting = false }
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
                    packetCount: resolvedMode == .direct || resolvedMode == .exclusive
                        ? 1
                        : packetCount ?? 1,
                    greeting: messageText.isBlank
                        ? L10n.tr("chatMoney.redPacket.defaultGreeting")
                        : messageText
                ))
            } else {
                guard let recipient = selectedRecipient ?? context.members.first else { return }
                result = try await store.createTransfer(CreateTransferRequest(
                    clientMessageID: clientMessageID,
                    scope: context.scope,
                    receiverID: context.receiverID,
                    groupID: context.groupID,
                    recipientID: recipient.id,
                    recipientName: recipient.name,
                    amount: totalAmount,
                    note: messageText
                ))
            }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onCreated(result)
        } catch {
            submissionError = ChatMoneyErrorText.message(
                for: error,
                kind: kind,
                limits: limits
            )
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }

    private func sanitizeDigits(_ raw: String) -> String {
        let digits = raw.filter(\.isNumber)
        guard !digits.isEmpty else { return "" }
        return String(digits.drop(while: { $0 == "0" })).isEmpty
            ? "0"
            : String(digits.drop(while: { $0 == "0" }))
    }
}

private struct RedPacketComposerContent: View {
    let context: ChatMoneyConversationContext
    @Binding var mode: RedPacketMode
    @Binding var amountText: String
    @Binding var packetCountText: String
    @Binding var messageText: String
    let selectedRecipient: ChatMoneyRecipient?
    let totalAmount: Int?
    let memberCount: Int
    let packetCountValidationMessage: String?
    let amountValidationMessage: String?
    let amountFocus: FocusState<ChatMoneyComposerSheet.FocusField?>.Binding
    let onChooseRecipient: () -> Void
    let onModeChange: (RedPacketMode) -> Void

    var body: some View {
        VStack(spacing: 0) {
            if context.scope == .group {
                ChatMoneyModeSelector(
                    mode: mode,
                    onSelect: onModeChange
                )
                .padding(.top, 6)
                .padding(.bottom, 12)

                if mode == .exclusive {
                    ChatMoneyRecipientRow(
                        recipient: selectedRecipient,
                        onTap: onChooseRecipient
                    )
                    .padding(.bottom, 12)
                } else {
                    ChatMoneyInputRow(
                        title: L10n.tr("chatMoney.redPacket.count"),
                        text: $packetCountText,
                        trailing: L10n.tr("chatMoney.redPacket.unit"),
                        placeholder: "0",
                        fontSize: 20,
                        focus: amountFocus,
                        focusValue: .count
                    )

                    if let packetCountValidationMessage {
                        Text(packetCountValidationMessage)
                            .font(.system(size: 12))
                            .foregroundColor(ChatMoneyTheme.actionRed)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 4)
                            .padding(.top, 7)
                    }

                    Text(L10n.tr("chatMoney.redPacket.groupMemberHint", memberCount))
                        .font(.system(size: 12))
                        .foregroundColor(Color(hex: "B2B2B2"))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
                        .padding(.top, 7)
                        .padding(.bottom, 12)
                }
            } else {
                Color.clear.frame(height: 22)
            }

            ChatMoneyInputRow(
                title: amountTitle,
                text: $amountText,
                trailing: L10n.tr("wallet.currency.goldCoins"),
                placeholder: "0",
                fontSize: 28,
                focus: amountFocus,
                focusValue: .amount
            )

            if let amountValidationMessage {
                Text(amountValidationMessage)
                    .font(.system(size: 12))
                    .foregroundColor(ChatMoneyTheme.actionRed)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                    .padding(.top, 7)
            }

            ChatMoneyMessageRow(
                title: L10n.tr("chatMoney.greeting"),
                text: $messageText,
                placeholder: L10n.tr("chatMoney.redPacket.defaultGreeting"),
                focus: amountFocus
            )
            .padding(.top, 12)
        }
    }

    private var amountTitle: String {
        context.scope == .group && mode == .equal
            ? L10n.tr("chatMoney.redPacket.amountEach")
            : L10n.tr("chatMoney.amount")
    }
}

private struct TransferComposerContent: View {
    let recipient: ChatMoneyRecipient?
    @Binding var amountText: String
    @Binding var noteText: String
    let validationMessage: String?
    let amountFocus: FocusState<ChatMoneyComposerSheet.FocusField?>.Binding

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                AvatarView(url: recipient?.avatarURL ?? "", size: 56)
                Text(L10n.tr("chatMoney.transfer.to", recipient?.name ?? ""))
                    .font(.system(size: 15))
                    .foregroundColor(ChatMoneyTheme.secondary)
            }
            .padding(.vertical, 24)

            ChatMoneyInputRow(
                title: L10n.tr("chatMoney.amount"),
                text: $amountText,
                trailing: L10n.tr("wallet.currency.goldCoins"),
                placeholder: "0",
                fontSize: 30,
                focus: amountFocus,
                focusValue: .amount
            )

            if let validationMessage {
                Text(validationMessage)
                    .font(.system(size: 12))
                    .foregroundColor(ChatMoneyTheme.actionRed)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
                    .padding(.top, 7)
            }

            ChatMoneyMessageRow(
                title: L10n.tr("chatMoney.note"),
                text: $noteText,
                placeholder: L10n.tr("chatMoney.transfer.notePlaceholder"),
                focus: amountFocus
            )
            .padding(.top, 12)
        }
    }
}

private struct ChatMoneyModeSelector: View {
    let mode: RedPacketMode
    let onSelect: (RedPacketMode) -> Void

    var body: some View {
        Menu {
            Button(RedPacketMode.lucky.localizedTitle) { onSelect(.lucky) }
            Button(RedPacketMode.equal.localizedTitle) { onSelect(.equal) }
            Button(RedPacketMode.exclusive.localizedTitle) { onSelect(.exclusive) }
        } label: {
            HStack(spacing: 5) {
                Text(mode.localizedTitle)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
            }
            .font(.system(size: 14))
            .foregroundColor(Color(hex: "576B95"))
        }
    }
}

private struct ChatMoneyInputRow: View {
    let title: String
    @Binding var text: String
    let trailing: String
    let placeholder: String
    let fontSize: CGFloat
    let focus: FocusState<ChatMoneyComposerSheet.FocusField?>.Binding
    let focusValue: ChatMoneyComposerSheet.FocusField

    var body: some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.system(size: 16))
            Spacer()
            TextField(placeholder, text: $text)
                .keyboardType(.numberPad)
                .font(.system(size: fontSize, weight: .medium))
                .multilineTextAlignment(.trailing)
                .focused(focus, equals: focusValue)
                .frame(maxWidth: 170)
                .accessibilityIdentifier(
                    focusValue == .amount ? "chatMoney.amount" : "chatMoney.packetCount"
                )
            Text(trailing)
                .font(.system(size: 16))
        }
        .padding(.horizontal, 16)
        .frame(height: 64)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

private struct ChatMoneyMessageRow: View {
    let title: String
    @Binding var text: String
    let placeholder: String
    let focus: FocusState<ChatMoneyComposerSheet.FocusField?>.Binding

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(title)
                .font(.system(size: 16))
                .padding(.top, 2)
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(1...2)
                .multilineTextAlignment(.trailing)
                .focused(focus, equals: .message)
                .accessibilityIdentifier("chatMoney.message")
        }
        .padding(16)
        .frame(minHeight: 56)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

private struct ChatMoneyRecipientRow: View {
    let recipient: ChatMoneyRecipient?
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Text(L10n.tr("chatMoney.redPacket.exclusiveRecipient"))
                    .font(.system(size: 16))
                    .foregroundColor(AppColors.primaryText)
                Spacer()
                if let recipient {
                    AvatarView(url: recipient.avatarURL, size: 30)
                    Text(recipient.name)
                        .foregroundColor(AppColors.primaryText)
                } else {
                    Text(L10n.tr("chatMoney.chooseRecipient"))
                        .foregroundColor(ChatMoneyTheme.secondary)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color(hex: "B2B2B2"))
            }
            .padding(.horizontal, 16)
            .frame(height: 56)
            .background(Color.white)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct ChatMoneyBalanceRow: View {
    let balance: Int
    let onTopUp: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Text(L10n.tr("chatMoney.availableBalance"))
            Text(L10n.tr("chatMoney.amountValue", balance))
            Button(L10n.tr("chatMoney.topUp"), action: onTopUp)
                .foregroundColor(Color(hex: "576B95"))
        }
        .font(.system(size: 13))
        .foregroundColor(ChatMoneyTheme.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ChatMoneyTotalSection: View {
    let totalAmount: Int
    let buttonTitle: String
    let canSubmit: Bool
    let isProcessing: Bool
    let errorMessage: String?
    let onSubmit: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(totalAmount)")
                    .font(.system(size: 46, weight: .medium))
                    .monospacedDigit()
                Text(L10n.tr("wallet.currency.goldCoins"))
                    .font(.system(size: 15))
            }

            VStack(spacing: 10) {
                Button(action: onSubmit) {
                    HStack(spacing: 8) {
                        if isProcessing {
                            ProgressView().tint(.white)
                        }
                        Text(buttonTitle)
                            .font(.system(size: 17, weight: .medium))
                    }
                    .foregroundColor(.white)
                    .frame(width: 188, height: 48)
                    .background(canSubmit ? ChatMoneyTheme.actionRed : ChatMoneyTheme.disabledRed)
                    .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(!canSubmit)
                .accessibilityIdentifier("chatMoney.submit")

                if let errorMessage {
                    Text(errorMessage)
                        .font(.system(size: 12))
                        .foregroundColor(ChatMoneyTheme.actionRed)
                        .multilineTextAlignment(.center)
                }
            }
        }
    }
}

#if DEBUG
@MainActor
private struct ChatMoneyComposerPreview: View {
    @StateObject private var store = ChatMoneyStore(service: MockChatMoneyService())
    @StateObject private var navigator = UIKitNavigator()

    var body: some View {
        NavigationStack {
            ChatMoneyComposerSheet(
                store: store,
                kind: .redPacket,
                context: .group(id: 42, name: "猫友群", members: []),
                onCreated: { _ in },
                onOpenWallet: {}
            )
        }
        .environmentObject(navigator)
    }
}

@MainActor
private struct ChatMoneyComposerViews_Previews: PreviewProvider {
    static var previews: some View {
        ChatMoneyComposerPreview()
    }
}
#endif
