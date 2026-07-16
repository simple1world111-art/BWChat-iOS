// BWChat/Components/GiftViews.swift
// Gift image assets, picker sheet, gift bubbles, and send animation.

import SwiftUI
import UIKit

@MainActor
final class GiftPanelViewModel: ObservableObject {
    @Published var gifts: [GiftCatalogItem] = GiftCatalogItem.fixedCatalog
    @Published var recipients: [GiftRecipient] = []
    @Published var selectedRecipient: GiftRecipient?
    @Published var selectedGift: GiftCatalogItem = GiftCatalogItem.fixedCatalog[0]
    @Published var balance: Int? = WalletStore.shared.balance
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load(source: GiftRecipientSource) async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        await loadRecipients(source: source)
        await loadGifts()
        await refreshBalance()
    }

    func refreshBalance() async {
        do {
            let serverBalance = try await APIService.shared.getWalletBalance()
            WalletStore.shared.applyServerBalance(serverBalance)
            balance = serverBalance.balance
        } catch {
            balance = WalletStore.shared.balance
        }
    }

    private func loadGifts() async {
        do {
            let fetched: [GiftCatalogItem]
            if let key = CacheKey.current(namespace: "gift", key: "catalog") {
                fetched = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .catalog,
                    forceRefresh: false
                ) {
                    try await APIService.shared.getGiftCatalog()
                }
            } else {
                fetched = try await APIService.shared.getGiftCatalog()
            }
            let remoteGifts = fetched
                .filter(\.isActive)
                .sorted {
                    let lhs = $0.sortOrder ?? Int.max
                    let rhs = $1.sortOrder ?? Int.max
                    return lhs == rhs ? $0.giftID < $1.giftID : lhs < rhs
                }
            gifts = remoteGifts.isEmpty ? GiftCatalogItem.fixedCatalog : remoteGifts
            if !gifts.contains(selectedGift) {
                selectedGift = gifts.first ?? GiftCatalogItem.fixedCatalog[0]
            }
        } catch {
            gifts = GiftCatalogItem.fixedCatalog
            selectedGift = gifts.first ?? GiftCatalogItem.fixedCatalog[0]
            errorMessage = L10n.tr("gift.catalogFallback")
        }
    }

    private func loadRecipients(source: GiftRecipientSource) async {
        switch source {
        case .fixed(let recipient):
            recipients = [recipient]
            selectedRecipient = recipient
        case .group(let groupID, _):
            let myID = AuthManager.shared.currentUser?.userID ?? ""
            let cached = LocalCache.load(GroupDetail.self, key: "group_detail_\(groupID)")
            if let cached {
                setGroupRecipients(cached.members, myID: myID)
            }

            do {
                let detail: GroupDetail
                if let key = CacheKey.current(namespace: "group-detail", key: "\(groupID)") {
                    detail = try await AppCacheRepository.shared.loadValue(
                        key: key,
                        policy: .profile,
                        forceRefresh: false
                    ) {
                        try await APIService.shared.getGroupDetail(groupID: groupID)
                    }
                } else {
                    detail = try await APIService.shared.getGroupDetail(groupID: groupID)
                }
                LocalCache.save(detail, key: "group_detail_\(groupID)")
                setGroupRecipients(detail.members, myID: myID)
            } catch {
                if recipients.isEmpty {
                    errorMessage = L10n.tr("gift.groupMembersLoadFailed")
                }
            }
        }
    }

    private func setGroupRecipients(_ members: [GroupMember], myID: String) {
        recipients = members
            .filter { $0.userID != myID }
            .map { GiftRecipient(id: $0.userID, name: $0.nickname, avatarURL: $0.avatarURL) }
        if let selectedRecipient, recipients.contains(selectedRecipient) {
            return
        }
        selectedRecipient = nil
    }
}

struct GiftPickerSheet: View {
    let source: GiftRecipientSource
    let onSend: (GiftCatalogItem, GiftRecipient) async throws -> Void
    let onOpenWallet: () -> Void
    let onSendFailure: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = GiftPanelViewModel()
    @State private var isSending = false
    @State private var sendSucceeded = false
    @State private var sendError: String?
    @State private var animatingGift: GiftCatalogItem?

    private var shouldPickRecipient: Bool {
        if case .group = source {
            return viewModel.selectedRecipient == nil
        }
        return false
    }

    init(
        source: GiftRecipientSource,
        onSend: @escaping (GiftCatalogItem, GiftRecipient) async throws -> Void,
        onOpenWallet: @escaping () -> Void,
        onSendFailure: @escaping (String) -> Void = { _ in }
    ) {
        self.source = source
        self.onSend = onSend
        self.onOpenWallet = onOpenWallet
        self.onSendFailure = onSendFailure
    }

    var body: some View {
        ZStack {
            AppColors.secondaryBackground.ignoresSafeArea()

            Group {
                if viewModel.isLoading && viewModel.recipients.isEmpty {
                    ProgressView()
                        .tint(AppColors.accent)
                } else if shouldPickRecipient {
                    recipientPicker
                } else {
                    giftPicker
                }
            }
        }
        .task {
            await viewModel.load(source: source)
        }
        .overlay {
            if let animatingGift {
                GiftSendAnimationOverlay(gift: animatingGift)
                    .transition(.opacity)
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .toolbar(.hidden, for: .navigationBar)
    }

    private var recipientPicker: some View {
        VStack(spacing: 0) {
            recipientPickerTitle

            if viewModel.recipients.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "person.2.slash")
                        .font(.system(size: 34))
                        .foregroundColor(AppColors.tertiaryText)
                    Text(viewModel.errorMessage ?? L10n.tr("gift.noRecipients"))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(viewModel.recipients) { recipient in
                            Button {
                                withAnimation(.spring(response: 0.35, dampingFraction: 0.82)) {
                                    viewModel.selectedRecipient = recipient
                                }
                            } label: {
                                HStack(spacing: 12) {
                                    AvatarView(url: recipient.avatarURL, size: 42)
                                    Text(recipient.name)
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundColor(AppColors.primaryText)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 13, weight: .bold))
                                        .foregroundColor(AppColors.tertiaryText)
                                }
                                .padding(14)
                                .background(AppColors.cardBackground)
                                .cornerRadius(14)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(16)
                }
            }
        }
    }

    private var recipientPickerTitle: some View {
        Text(L10n.tr("gift.chooseRecipient"))
            .font(.system(size: 17, weight: .semibold))
            .foregroundColor(AppColors.primaryText)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 10)
    }

    private var giftPicker: some View {
        VStack(spacing: 0) {
            balanceHeader

            if let selectedRecipient = viewModel.selectedRecipient {
                recipientSummary(selectedRecipient)
            }

            ScrollView {
                LazyVGrid(columns: [
                    GridItem(.flexible(), spacing: 10),
                    GridItem(.flexible(), spacing: 10),
                    GridItem(.flexible(), spacing: 10)
                ], spacing: 10) {
                    ForEach(viewModel.gifts) { gift in
                        giftCard(gift)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }

            sendBar
        }
    }

    private var balanceHeader: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(Color(hex: "FFF4C9"))
                    .frame(width: 34, height: 34)
                Image(systemName: "pawprint.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Color(hex: "F0A020"))
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(L10n.tr("wallet.balance"))
                    .font(.system(size: 12))
                    .foregroundColor(AppColors.secondaryText)
                Text(viewModel.balance.map(String.init) ?? L10n.tr("common.loading"))
                    .font(.system(size: viewModel.balance == nil ? 16 : 22, weight: .bold))
                    .foregroundColor(AppColors.primaryText)
            }

            Spacer()

            Button {
                Task { await viewModel.refreshBalance() }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(AppColors.accent)
                    .frame(width: 32, height: 32)
                    .background(AppColors.accentLight)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 18)
    }

    private func recipientSummary(_ recipient: GiftRecipient) -> some View {
        HStack(spacing: 10) {
            Text(L10n.tr("gift.to"))
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(AppColors.secondaryText)

            AvatarView(url: recipient.avatarURL, size: 30)

            Text(recipient.name)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.84)

            Spacer()

            if case .group = source {
                Button(L10n.tr("common.change")) {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        viewModel.selectedRecipient = nil
                    }
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(AppColors.accent)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
        .frame(minHeight: 52)
    }

    private func giftCard(_ gift: GiftCatalogItem) -> some View {
        let selected = gift.id == viewModel.selectedGift.id
        let affordable = viewModel.balance.map { gift.price <= $0 } ?? true
        let cardCorner: CGFloat = 16

        return Button {
            viewModel.selectedGift = gift
        } label: {
            VStack(spacing: 8) {
                GiftAssetIcon(assetKey: gift.displayAssetKey, size: 52)
                    .opacity(affordable ? 1 : 0.46)

                Text(gift.localizedName)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)

                HStack(spacing: 4) {
                    Image(systemName: "pawprint.fill")
                        .font(.system(size: 10))
                        .foregroundColor(Color(hex: "F0A020"))
                    Text("\(gift.price)")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(affordable ? AppColors.secondaryText : AppColors.errorColor)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 116)
            .padding(.vertical, 12)
            .background {
                RoundedRectangle(cornerRadius: cardCorner, style: .continuous)
                    .fill(LinearGradient(
                        colors: selected
                            ? [Color.white, Color(hex: "FFF8DF")]
                            : [AppColors.cardBackground, AppColors.cardBackground],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ))
                    .shadow(
                        color: selected ? Color(hex: "F0A020").opacity(0.18) : Color.black.opacity(0.035),
                        radius: selected ? 10 : 3,
                        x: 0,
                        y: selected ? 4 : 2
                    )
            }
            .overlay {
                if selected {
                    ZStack {
                        RoundedRectangle(cornerRadius: cardCorner, style: .continuous)
                            .strokeBorder(
                                LinearGradient(
                                    colors: [Color(hex: "FFE08A"), Color(hex: "F0A020")],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ),
                                lineWidth: 1.6
                            )

                        RoundedRectangle(cornerRadius: cardCorner - 2, style: .continuous)
                            .inset(by: 2)
                            .strokeBorder(Color.white.opacity(0.82), lineWidth: 0.8)
                    }
                } else {
                    RoundedRectangle(cornerRadius: cardCorner, style: .continuous)
                        .strokeBorder(AppColors.separator.opacity(0.62), lineWidth: 1)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: cardCorner, style: .continuous))
            .scaleEffect(selected ? 1.012 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.86), value: selected)
        }
        .buttonStyle(.plain)
    }

    private var sendBar: some View {
        let gift = viewModel.selectedGift
        let isBalanceLoaded = viewModel.balance != nil
        let affordable = viewModel.balance.map { gift.price <= $0 } ?? false
        let buttonIcon = sendSucceeded
            ? "checkmark"
            : (!isBalanceLoaded ? "arrow.clockwise" : (affordable ? "paperplane.fill" : "cart.fill"))
        let buttonTitle = sendSucceeded
            ? L10n.tr("addFriend.sent")
            : (!isBalanceLoaded ? L10n.tr("wallet.balance.loading") : (affordable ? L10n.tr("gift.sendGift", gift.localizedName) : L10n.tr("gift.insufficientBalance")))

        return VStack(spacing: 8) {
            if let sendError {
                Text(sendError)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(AppColors.errorColor)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                if !isBalanceLoaded {
                    Task { await viewModel.refreshBalance() }
                } else if affordable {
                    sendSelectedGift()
                } else {
                    dismiss()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        onOpenWallet()
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: buttonIcon)
                        .font(.system(size: 14, weight: .bold))
                    Text(buttonTitle)
                        .font(.system(size: 16, weight: .bold))
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(affordable ? AppColors.accentGradient : LinearGradient(
                            colors: [Color(hex: "FFB703"), Color(hex: "FB8500")],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ))
                )
            }
            .disabled(isSending || !isBalanceLoaded)
            .opacity(isSending || !isBalanceLoaded ? 0.76 : 1)
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 14)
        .background(AppColors.cardBackground)
    }

    private func sendSelectedGift() {
        guard let recipient = viewModel.selectedRecipient, !isSending else { return }
        let gift = viewModel.selectedGift
        let previousBalance = viewModel.balance
        isSending = true
        sendSucceeded = true
        sendError = nil
        applyOptimisticBalanceSpend(gift.price)

        UINotificationFeedbackGenerator().notificationOccurred(.success)
        withAnimation(.easeOut(duration: 0.16)) {
            animatingGift = gift
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.58) {
            dismiss()
        }

        Task { @MainActor in
            do {
                try await onSend(gift, recipient)
                await viewModel.refreshBalance()
            } catch let error as APIError {
                rollbackOptimisticBalance(to: previousBalance)
                onSendFailure(error.errorDescription ?? L10n.tr("gift.sendFailed"))
            } catch {
                rollbackOptimisticBalance(to: previousBalance)
                onSendFailure(L10n.tr("gift.sendFailed"))
            }

            isSending = false
            sendSucceeded = false
        }
    }

    private func applyOptimisticBalanceSpend(_ amount: Int) {
        guard let currentBalance = viewModel.balance else { return }
        let nextBalance = max(currentBalance - amount, 0)
        viewModel.balance = nextBalance
        WalletStore.shared.applyServerBalance(nextBalance)
    }

    private func rollbackOptimisticBalance(to previousBalance: Int?) {
        guard let previousBalance else { return }
        viewModel.balance = previousBalance
        WalletStore.shared.applyServerBalance(previousBalance)
    }
}

struct GiftAssetIcon: View {
    let assetKey: String
    var size: CGFloat = 48

    @ObservedObject private var assetManager = RemoteAssetManager.shared

    var body: some View {
        ZStack {
            Circle()
                .fill(haloColor.opacity(0.16))
                .frame(width: size * 0.86, height: size * 0.86)
                .blur(radius: size * 0.08)
                .offset(y: size * 0.08)

            Circle()
                .fill(Color.white.opacity(0.92))
                .frame(width: size * 0.72, height: size * 0.72)
                .shadow(color: Color.black.opacity(0.045), radius: size * 0.08, x: 0, y: size * 0.04)

            artwork
                .frame(width: size * 1.04, height: size * 1.04)
        }
        .frame(width: size, height: size)
        .shadow(color: outlineColor.opacity(0.18), radius: size * 0.07, x: 0, y: size * 0.035)
        .accessibilityLabel(accessibilityName)
    }

    private var haloColor: Color {
        switch assetKey {
        case "gift_fish": return Color(hex: "FF8A5B")
        case "gift_wand": return Color(hex: "9B7CFF")
        case "gift_yarn": return Color(hex: "FF7AAE")
        case "gift_can": return Color(hex: "67D6B3")
        case "gift_tree": return Color(hex: "62C96B")
        case "gift_bell": return Color(hex: "FFC94A")
        default: return AppColors.accent
        }
    }

    private var outlineColor: Color {
        switch assetKey {
        case "gift_fish": return Color(hex: "D85D34")
        case "gift_wand": return Color(hex: "7557D8")
        case "gift_yarn": return Color(hex: "D94E83")
        case "gift_can": return Color(hex: "2FAE88")
        case "gift_tree": return Color(hex: "319244")
        case "gift_bell": return Color(hex: "B96A18")
        default: return AppColors.accent
        }
    }

    private var accessibilityName: String {
        GiftCatalogItem.fixedCatalog.first { $0.assetKey == assetKey }?.localizedName ?? L10n.tr("gift.title")
    }

    private var imageAssetName: String? {
        switch assetKey {
        case "gift_fish", "gift_wand", "gift_yarn", "gift_can", "gift_tree", "gift_bell":
            return assetKey
        default:
            return nil
        }
    }

    @ViewBuilder
    private var artwork: some View {
        if assetManager.trustedRemoteURL(for: assetKey) != nil {
            RemoteAssetImage(
                assetKey: assetKey,
                fallbackAssetName: imageAssetName,
                fallbackSystemImage: "gift.fill"
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        } else if let imageAssetName {
            Image(imageAssetName)
                .resizable()
                .interpolation(.high)
                .antialiased(true)
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        } else {
            Image(systemName: "gift.fill")
                .resizable()
                .scaledToFit()
                .foregroundColor(AppColors.accent)
        }
    }
}

struct GiftPlusMenuTile: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(AppColors.separator)
                        .frame(width: 56, height: 56)
                    Image(systemName: "gift.fill")
                        .font(.system(size: 22))
                        .foregroundColor(AppColors.primaryText)
                }
                Text(L10n.tr("gift.title"))
                    .font(.system(size: 11))
                    .foregroundColor(AppColors.secondaryText)
            }
        }
        .buttonStyle(.plain)
    }
}

struct GiftMessageBubble: View {
    let payload: GiftMessagePayload
    let timeText: String
    let isFromMe: Bool
    var senderName: String?
    var recipientFallback: String?
    var recipientIDFallback: String?
    var recipientAvatarFallback: String?

    private var recipientName: String {
        if let name = payload.recipientName, !name.isBlank { return name }
        return recipientFallback ?? L10n.tr("gift.recipientFallback")
    }

    private var recipientAvatarURL: String {
        if let recipientID = payload.recipientID, !recipientID.isBlank {
            let cachedURL = UserCacheManager.shared.avatarURL(for: recipientID)
            if !cachedURL.isBlank { return cachedURL }
        }
        return recipientAvatarFallback ?? ""
    }

    private var recipientUserID: String {
        if let recipientID = payload.recipientID, !recipientID.isBlank { return recipientID }
        return recipientIDFallback ?? ""
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 4) {
                VStack(spacing: 5) {
                    GiftAssetIcon(assetKey: payload.assetKey, size: 68)

                    Text(payload.localizedGiftName)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                }
                .frame(width: 80)

                VStack(spacing: 7) {
                    Image("gift_whimsical_arrow")
                        .resizable()
                        .renderingMode(.original)
                        .scaledToFit()
                        .frame(width: 44, height: 30)
                        .accessibilityHidden(true)

                    Text(L10n.tr("gift.to"))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)
                }
                .padding(.top, 20)

                VStack(spacing: 6) {
                    recipientAvatar

                    Text(recipientName)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                }
                .frame(width: 74)
                .padding(.top, 11)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 4) {
                receiverValue
                    .frame(width: 80, alignment: .center)

                Spacer(minLength: 6)

                Text(timeText)
                    .font(.system(size: 12))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 9)
        .frame(width: 232)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(LinearGradient(
                    colors: isFromMe
                        ? [Color(hex: "FFF4C9"), Color(hex: "FFE8A3")]
                        : [Color.white, Color(hex: "FFF8DF")],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(Color(hex: "FFD54A").opacity(0.7), lineWidth: 1)
                )
        )
        .cornerRadius(18, corners: isFromMe ? [.topLeft, .topRight, .bottomLeft] : [.topLeft, .topRight, .bottomRight])
    }

    @ViewBuilder
    private var recipientAvatar: some View {
        if recipientUserID.isBlank {
            styledRecipientAvatar
        } else {
            UserAvatarButton(
                userID: recipientUserID,
                avatarURL: recipientAvatarURL,
                size: 54,
                accessibilityName: recipientName
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.white.opacity(0.95), lineWidth: 2)
                    .allowsHitTesting(false)
            )
            .shadow(color: Color.black.opacity(0.08), radius: 4, x: 0, y: 2)
        }
    }

    private var styledRecipientAvatar: some View {
        AvatarView(url: recipientAvatarURL, size: 54)
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.white.opacity(0.95), lineWidth: 2)
                    .allowsHitTesting(false)
            )
            .shadow(color: Color.black.opacity(0.08), radius: 4, x: 0, y: 2)
    }

    private var receiverValue: some View {
        HStack(spacing: 3) {
            if payload.receiverCurrency == .catHair {
                Image("wallet_cat_hair")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 13, height: 13)
            } else {
                Image(systemName: "pawprint.fill")
                    .font(.system(size: 9))
                    .foregroundColor(Color(hex: "F0A020"))
            }

            Text(
                payload.receiverCurrency == .catHair
                    ? L10n.tr("gift.receiverValue.catHair", payload.amount)
                    : L10n.tr("gift.receiverValue.catFood", payload.amount)
            )
            .font(.system(size: 11, weight: .semibold))
            .foregroundColor(Color(hex: "A76500"))
            .lineLimit(1)
        }
    }
}

struct GiftSendAnimationOverlay: View {
    let gift: GiftCatalogItem

    @State private var animate = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.22)
                .ignoresSafeArea()

            ZStack {
                ForEach(0..<6, id: \.self) { index in
                    particle(index)
                }

                GiftAssetIcon(assetKey: gift.displayAssetKey, size: 96)
                    .scaleEffect(animate ? 1.05 : 0.62)
                    .rotationEffect(.degrees(animate ? finalRotation : initialRotation))
                    .offset(y: animate && gift.assetKey == "gift_tree" ? -8 : 0)
                    .animation(.spring(response: 0.38, dampingFraction: 0.62), value: animate)
            }
        }
        .onAppear {
            animate = true
        }
        .allowsHitTesting(false)
    }

    private var initialRotation: Double {
        switch gift.assetKey {
        case "gift_fish": return -12
        case "gift_wand": return -18
        case "gift_yarn": return -35
        case "gift_bell": return -14
        default: return 0
        }
    }

    private var finalRotation: Double {
        switch gift.assetKey {
        case "gift_fish": return 10
        case "gift_wand": return 8
        case "gift_yarn": return 360
        case "gift_bell": return 14
        default: return 0
        }
    }

    private func particle(_ index: Int) -> some View {
        let angle = Double(index) / 6.0 * Double.pi * 2
        let distance: CGFloat = animate ? 76 : 18
        let x = cos(angle) * distance
        let y = sin(angle) * distance
        let colors = [Color(hex: "FFD54A"), Color(hex: "FF8AC8"), Color(hex: "67D6B3"), Color(hex: "9B7CFF")]

        return Image(systemName: particleSymbol)
            .font(.system(size: index.isMultiple(of: 2) ? 15 : 11, weight: .bold))
            .foregroundColor(colors[index % colors.count])
            .offset(x: x, y: y)
            .opacity(animate ? 0 : 1)
            .scaleEffect(animate ? 1.35 : 0.5)
            .animation(.easeOut(duration: 0.95).delay(Double(index) * 0.04), value: animate)
    }

    private var particleSymbol: String {
        switch gift.assetKey {
        case "gift_can": return "heart.fill"
        case "gift_tree": return "pawprint.fill"
        case "gift_bell": return "dot.radiowaves.left.and.right"
        default: return "sparkle"
        }
    }
}
