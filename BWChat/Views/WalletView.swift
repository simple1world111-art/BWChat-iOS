// BWChat/Views/WalletView.swift
// Wallet (金币) recharge page backed by StoreKit consumable products.

import SwiftUI
import UIKit

struct WalletView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var walletStore = WalletStore.shared
    @ObservedObject private var appConfig = AppRemoteConfigStore.shared

    @State private var selectedTab = ProcessInfo.processInfo.arguments.contains("-walletEarningsReviewScreenshot") ? 1 : 0
    @State private var selectedAmountIndex = 0
    @State private var agreedToTerms = false
    @State private var alertMessage: String?
    @State private var toastMessage: String?
    @State private var centerToastMessage: String?
    @State private var withdrawalAddressText = ""
    @State private var withdrawalNetwork = ""
    @State private var isWithdrawalNetworkPickerExpanded = false
    @State private var isWithdrawalNetworkPickerLayerRaised = false
    @State private var isUSDTInfoBubbleVisible = false
    @State private var withdrawalAmountText = ""
    @FocusState private var focusedWithdrawalField: WithdrawalField?

    private var packages: [GoldCoinProductConfig] {
        appConfig.config.wallet?.effectiveGoldCoinProducts ?? AppConfig.goldCoinProducts
    }

    private var withdrawalNetworks: [String] {
        appConfig.config.wallet?.effectiveWithdrawalNetworks ?? ["TRC20", "ERC20", "BEP20"]
    }

    private var withdrawalPolicy: WalletWithdrawalPolicy {
        walletStore.withdrawalPolicy(for: withdrawalNetwork.isBlank ? nil : withdrawalNetwork)
    }

    private enum WithdrawalField: Hashable {
        case address
        case amount
    }

    private var selectedPackage: GoldCoinProductConfig {
        packages[min(selectedAmountIndex, max(packages.count - 1, 0))]
    }

    private var selectedPriceText: String {
        rechargeDisplayPrice(walletStore.displayPrice(for: selectedPackage))
    }

    private var hasLoadedAnyBalance: Bool {
        walletStore.hasLoadedWallet
    }

    private var goldCoinBalanceText: String {
        walletStore.goldCoinBalanceValue.map(String.init) ?? L10n.tr("common.loading")
    }

    private var earningsBalanceText: String {
        hasLoadedAnyBalance ? String(walletStore.earningsGoldCoinBalance) : L10n.tr("common.loading")
    }

    private var isGoldCoinBalanceLoading: Bool {
        walletStore.goldCoinBalance == nil
    }

    private var isEarningsBalanceLoading: Bool {
        !hasLoadedAnyBalance
    }

    private var isWithdrawalFormFocused: Bool {
        focusedWithdrawalField != nil
    }

    private var walletKeyboardTransitionAnimation: Animation {
        .interactiveSpring(response: 0.34, dampingFraction: 0.88, blendDuration: 0.08)
    }

    private var isAdRewardConfigured: Bool {
        #if DEBUG
        return true
        #else
        // Production delivery is enabled remotely only after AdMob SSV and
        // server-side wallet crediting are ready. The entry itself stays visible.
        return appConfig.config.wallet?.adRewardEnabled == true
            && appConfig.config.wallet?.adReward?.rewardsGoldCoins == true
            && appConfig.featureFlags.isEnabled("wallet_ad_reward_delivery", default: false)
        #endif
    }

    var body: some View {
        ZStack(alignment: .top) {
            WalletMainBackground()

            Color.white
                .frame(height: 60)
                .frame(maxHeight: .infinity, alignment: .bottom)
                .ignoresSafeArea(.container, edges: .bottom)

            if selectedTab == 0 {
                goldCoinPage
            } else {
                earningsPage
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    performAfterDismissingWalletInput {
                        navigator.pop()
                    }
                }
            }

            ToolbarItem(placement: .principal) {
                tabHeader
            }
        }
        .toolbarBackground(isWithdrawalFormFocused ? Color.white.opacity(0.96) : Color.clear, for: .navigationBar)
        .toolbarBackground(isWithdrawalFormFocused ? .visible : .hidden, for: .navigationBar)
        .task {
            // Remote config is already refreshed at launch, login changes, and
            // foreground entry. Avoid another forced fetch here because each
            // published loading/ETag update invalidates this large wallet view.
            async let balance: Void = walletStore.refreshBalanceFromServer()
            async let products: Void = walletStore.loadProducts()
            async let transactions: Void = walletStore.loadTransactions()
            async let withdrawals: Void = walletStore.loadWithdrawals()
            _ = await (balance, products, transactions, withdrawals)
        }
        .onChange(of: packages.map(\.productID)) { _ in
            selectedAmountIndex = min(selectedAmountIndex, max(packages.count - 1, 0))
            Task { await walletStore.loadProducts(force: true) }
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            Task {
                await walletStore.refreshBalanceFromServer()
            }
        }
        .onDisappear {
            resetWithdrawalForm()
            dismissWalletInputState()
        }
        .alert(L10n.tr("common.notice"), isPresented: Binding(
            get: { alertMessage != nil },
            set: { if !$0 { alertMessage = nil } }
        )) {
            Button(L10n.tr("common.ok"), role: .cancel) {}
        } message: {
            Text(alertMessage ?? "")
        }
        .toast(message: $toastMessage)
        .centerToast(message: $centerToastMessage)
        .background(
            KeyboardDismissTapInstaller(
                isEnabled: selectedTab == 1,
                consumesOutsideTaps: false,
                onBackgroundTap: dismissWalletInputState
            )
        )
    }

    private var goldCoinPage: some View {
        GeometryReader { geo in
            if geo.size.width > 1, geo.size.height > 1 {
                let compact = geo.size.height < 650
                let topPadding: CGFloat = compact ? 30 : 48
                let sectionGap: CGFloat = compact ? 18 : 26
                let bottomPadding = max(geo.safeAreaInsets.bottom, compact ? 10 : 14)

                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 0) {
                        Spacer().frame(height: topPadding)
                        pawIcon(compact: compact)

                        goldCoinBalanceHeader(compact: compact)
                            .padding(.top, compact ? 0 : 2)

                        Spacer(minLength: sectionGap)

                        WalletAdRewardBanner(
                            compact: compact,
                            isConfigured: isAdRewardConfigured,
                            onCenterToast: { centerToastMessage = $0 }
                        )
                        .equatable()
                        .padding(.horizontal, 20)
                        .padding(.bottom, compact ? 10 : 14)

                        rechargePanel(
                            compact: compact,
                            availableWidth: geo.size.width,
                            bottomPadding: bottomPadding
                        )
                    }
                    .frame(width: geo.size.width)
                    .frame(minHeight: geo.size.height, alignment: .top)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
    }

    private var earningsPage: some View {
        GeometryReader { geo in
            if geo.size.width > 1, geo.size.height > 1 {
                let compact = geo.size.height < 650
                let normalTopGap: CGFloat = compact ? 30 : 48
                let cardHeight: CGFloat = compact ? 130 : 148
                let normalPanelGap: CGFloat = compact ? 20 : 28
                let topGap = isWithdrawalFormFocused ? (compact ? 10 : 14) : normalTopGap
                let panelBottomPadding = max(geo.safeAreaInsets.bottom, compact ? 14 : 18)

                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 0) {
                        Spacer().frame(height: topGap)

                        if !isWithdrawalFormFocused {
                            earningsSummaryCard(compact: compact)
                                .frame(height: cardHeight)
                                .padding(.horizontal, 20)
                                .transition(.opacity)

                            Spacer().frame(height: normalPanelGap)
                        }

                        earningsActionPanel(
                            compact: compact,
                            buttonBottomPadding: panelBottomPadding,
                            availableWidth: geo.size.width
                        )

                    }
                    .frame(width: geo.size.width)
                    .frame(minHeight: geo.size.height, alignment: .top)
                    .animation(walletKeyboardTransitionAnimation, value: isWithdrawalFormFocused)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
    }

    private var tabHeader: some View {
        HStack(spacing: 18) {
            tabButton(L10n.tr("wallet.myGoldCoins"), index: 0)
            tabButton(L10n.tr("wallet.creatorEarnings"), index: 1)
        }
        .frame(width: 246)
        .layoutPriority(10)
    }

    private func tabButton(_ title: String, index: Int) -> some View {
        Button {
            performAfterDismissingWalletInput {
                if selectedTab == 1, index != 1 {
                    resetWithdrawalForm()
                }
                selectedTab = index
            }
        } label: {
            VStack(spacing: 3) {
                Text(title)
                    .font(.system(size: 18, weight: selectedTab == index ? .semibold : .medium))
                    .foregroundColor(selectedTab == index ? .black : .black.opacity(0.58))
                    .lineLimit(1)
                    .minimumScaleFactor(0.86)
                    .allowsTightening(true)
                Rectangle()
                    .fill(selectedTab == index ? Color.black : Color.clear)
                    .frame(width: 32, height: 4)
            }
            .frame(width: 114)
        }
        .buttonStyle(.plain)
    }

    private func goldCoinBalanceHeader(compact: Bool) -> some View {
        VStack(spacing: compact ? 7 : 10) {
            walletAssetMetric(
                title: L10n.tr("wallet.goldCoinBalance"),
                value: goldCoinBalanceText,
                isLoading: isGoldCoinBalanceLoading,
                compact: compact
            )
            .frame(maxWidth: 240)

            Button(action: openGoldCoinDetails) {
                walletDetailLink(L10n.tr("wallet.goldCoinDetails"), compact: compact)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, compact ? 16 : 24)
    }

    private func walletAssetMetric(
        title: String,
        value: String,
        isLoading: Bool,
        compact: Bool
    ) -> some View {
        VStack(spacing: compact ? 3 : 5) {
            Text(title)
                .font(.system(size: compact ? 11 : 13, weight: .semibold))
                .foregroundColor(.black.opacity(0.66))
                .lineLimit(1)
                .minimumScaleFactor(0.62)
            Text(value)
                .font(.system(size: isLoading ? (compact ? 13 : 15) : (compact ? 23 : 28), weight: .bold))
                .foregroundColor(.black)
                .lineLimit(1)
                .minimumScaleFactor(0.62)
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity)
    }

    private func walletDetailLink(_ title: String, compact: Bool) -> some View {
        HStack(spacing: 4) {
            Text(title)
                .lineLimit(1)
                .minimumScaleFactor(0.68)
            Image(systemName: "chevron.right")
                .font(.system(size: compact ? 10 : 11, weight: .bold))
        }
        .font(.system(size: compact ? 12 : 13, weight: .medium))
        .foregroundColor(.black.opacity(0.48))
    }

    private var earningsBalanceHeader: some View {
        VStack(spacing: 6) {
            Text(L10n.tr("wallet.creatorEarnings"))
                .font(.system(size: 15))
                .foregroundColor(.black.opacity(0.7))

            Text(earningsBalanceText)
                .font(.system(size: isEarningsBalanceLoading ? 24 : 42, weight: .bold))
                .foregroundColor(.black)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private func pawIcon(compact: Bool) -> some View {
        let size: CGFloat = compact ? 119 : 147
        let containerHeight: CGFloat = compact ? 122 : 153

        return ZStack {
            Image("wallet_gold_coin_badge")
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        }
        .frame(height: containerHeight)
    }

    private var earningsIcon: some View {
        ZStack {
            Image(systemName: "sparkle")
                .font(.system(size: 13))
                .foregroundColor(.white)
                .offset(x: -48, y: -30)

            Image(systemName: "sparkle")
                .font(.system(size: 10))
                .foregroundColor(.white)
                .offset(x: 46, y: -34)

            Image(systemName: "gift.fill")
                .font(.system(size: 68))
                .foregroundStyle(
                    LinearGradient(
                        colors: [Color(hex: "FFD54A"), Color(hex: "F0A020")],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .shadow(color: Color(hex: "F0A020").opacity(0.35), radius: 6, y: 3)
        }
        .frame(height: 100)
    }

    private var goldCoinStatCard: some View {
        VStack(spacing: 0) {
            walletBalanceRow(
                title: L10n.tr("wallet.rechargeClaimBalance"),
                value: walletStore.rechargeGoldCoinBalance,
                systemImage: "plus.circle.fill"
            )
        }
        .padding(.vertical, 2)
        .padding(.horizontal, 16)
    }

    private func walletBalanceRow(title: String, value: Int?, systemImage: String) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color(hex: "FFD54A").opacity(0.2))
                    .frame(width: 36, height: 36)
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color(hex: "C98300"))
            }

            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(.black.opacity(0.72))
                .lineLimit(2)
                .minimumScaleFactor(0.82)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 12)

            Text(balanceDisplayText(value))
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(.black)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 62, alignment: .leading)
    }

    private func balanceDisplayText(_ value: Int?) -> String {
        value.map(String.init) ?? L10n.tr("common.loading")
    }

    private func usdtNumberText(for goldCoinAmount: Int) -> String {
        String(format: "%.2f", withdrawalPolicy.rawUSDTAmount(forGoldCoins: goldCoinAmount))
    }

    private var maxWithdrawableUSDTAmount: Double {
        withdrawalPolicy.maximumUSDTAmount(
            forGoldCoins: walletStore.withdrawableGoldCoinBalanceForAction
        )
    }

    private var maxWithdrawableUSDTNumberText: String {
        String(format: "%.2f", maxWithdrawableUSDTAmount)
    }

    private var hasWithdrawableUSDTAmount: Bool {
        withdrawalPolicy.canWithdraw(
            goldCoinAmount: walletStore.withdrawableGoldCoinBalanceForAction
        )
    }

    private var withdrawalUSDTPlaceholder: String {
        hasWithdrawableUSDTAmount
            ? L10n.tr("wallet.usdt.maxWithdrawable", maxWithdrawableUSDTNumberText)
            : withdrawalMinimumText
    }

    private var withdrawalMinimumText: String {
        L10n.tr(
            "wallet.withdrawal.minimumUSDT",
            String(format: "%.2f", withdrawalPolicy.minimumUSDT)
        )
    }

    private var withdrawalStepText: String {
        String(format: "%.2f", withdrawalPolicy.stepUSDT)
    }

    private var withdrawalNetworkDisplayText: String {
        withdrawalNetwork.isBlank ? L10n.tr("wallet.usdt.network.select") : withdrawalNetwork
    }

    private func rechargePanel(
        compact: Bool,
        availableWidth: CGFloat,
        bottomPadding: CGFloat
    ) -> some View {
        let cardVerticalSpacing: CGFloat = compact ? 12 : 16
        let horizontalPadding: CGFloat = 18
        let columnSpacing: CGFloat = 12
        let contentWidth = max(availableWidth - horizontalPadding * 2, 0)
        let columnWidth = max((contentWidth - columnSpacing * 2) / 3, 0)

        return VStack(spacing: 0) {
            if let productLoadError = walletStore.productLoadError {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.circle")
                    Text(productLoadError)
                }
                .font(.system(size: 12))
                .foregroundColor(Color(hex: "9A6A00"))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 18)
            }

            LazyVGrid(columns: [
                GridItem(.fixed(columnWidth), spacing: columnSpacing),
                GridItem(.fixed(columnWidth), spacing: columnSpacing),
                GridItem(.fixed(columnWidth), spacing: columnSpacing)
            ], spacing: cardVerticalSpacing) {
                ForEach(packages.indices, id: \.self) { amountCard(index: $0, compact: compact) }
            }
            .frame(width: contentWidth)

            Button {
                Task { await purchaseSelectedPackage() }
            } label: {
                HStack(spacing: 8) {
                    if walletStore.isPurchasing || walletStore.isLoadingProducts {
                        ProgressView()
                            .tint(.black)
                    }
                    Text(purchaseButtonTitle)
                        .font(.system(size: compact ? 16 : 19, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.58)
                        .allowsTightening(true)
                }
                .foregroundColor(.black)
                .frame(maxWidth: .infinity)
                .frame(height: compact ? 42 : 52)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color(hex: "FFE500"))
                )
            }
            .disabled(walletStore.isPurchasing || walletStore.isLoadingProducts)
            .opacity(walletStore.isPurchasing || walletStore.isLoadingProducts ? 0.72 : 1)
            .padding(.horizontal, 18)
            .padding(.top, cardVerticalSpacing)

            Button {
                agreedToTerms.toggle()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: agreedToTerms ? "checkmark.circle.fill" : "circle")
                        .foregroundColor(agreedToTerms ? Color(hex: "F0A020") : Color.gray.opacity(0.45))
                        .font(.system(size: compact ? 12 : 14))

                    Text(L10n.tr("wallet.terms.agreePrefix"))
                        .font(.system(size: compact ? 10 : 12))
                        .foregroundColor(.black.opacity(0.6))
                        .lineLimit(1)
                        .minimumScaleFactor(0.62)
                        .allowsTightening(true)

                    Text(L10n.tr("wallet.terms.title"))
                        .font(.system(size: compact ? 10 : 12))
                        .foregroundColor(.black.opacity(0.82))
                        .lineLimit(1)
                        .minimumScaleFactor(0.62)
                        .allowsTightening(true)
                }
                .frame(maxWidth: .infinity)
            }
            .padding(.top, compact ? 6 : 8)
            .padding(.bottom, compact ? 2 : 4)
        }
        .padding(.top, compact ? 10 : 12)
        .padding(.bottom, bottomPadding)
        .frame(width: availableWidth, alignment: .top)
        .background(Color.white)
        .clipShape(WalletTopRoundedShape(radius: 30))
        .ignoresSafeArea(.container, edges: .bottom)
    }

    private func earningsSummaryCard(compact: Bool) -> some View {
        let withdrawableGoldCoins = walletStore.walletBalance?.withdrawableGoldCoinBalance.value
        let totalGoldCoinValue = balanceDisplayText(walletStore.goldCoinBalanceValue)
        let withdrawableGoldCoinValue = balanceDisplayText(withdrawableGoldCoins)
        let usdtValue = withdrawableGoldCoins.map { usdtNumberText(for: $0) }
            ?? L10n.tr("common.loading")

        return VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 0) {
                earningsSummaryMetric(
                    title: L10n.tr("wallet.goldCoinBalance"),
                    value: totalGoldCoinValue,
                    compact: compact
                )

                Rectangle()
                    .fill(Color.black.opacity(0.08))
                    .frame(width: 1, height: compact ? 46 : 52)
                    .padding(.horizontal, compact ? 6 : 8)

                earningsSummaryMetric(
                    title: L10n.tr("wallet.withdrawableBalance"),
                    value: withdrawableGoldCoinValue,
                    compact: compact
                )

                Text("≈")
                    .font(.system(size: compact ? 15 : 17, weight: .bold))
                    .foregroundColor(Color(hex: "B58A00").opacity(0.74))
                    .frame(width: compact ? 22 : 26, alignment: .center)

                earningsSummaryMetric(
                    title: L10n.tr("wallet.usdt.estimated"),
                    value: usdtValue,
                    compact: compact
                )
            }
            .frame(height: compact ? 60 : 68)

            Spacer(minLength: compact ? 8 : 10)

            Divider()
                .opacity(0.28)
                .padding(.horizontal, compact ? 4 : 6)

            withdrawalRecordShortcutRow(compact: compact)
                .frame(height: compact ? 23 : 25)
                .padding(.top, compact ? 5 : 6)
        }
        .padding(.horizontal, compact ? 26 : 34)
        .padding(.top, compact ? 17 : 21)
        .padding(.bottom, compact ? 9 : 11)
        .frame(maxWidth: .infinity, minHeight: compact ? 130 : 148, alignment: .center)
        .background(
            RoundedRectangle(cornerRadius: 30)
                .fill(Color.white)
        )
        .shadow(color: Color.black.opacity(0.035), radius: 12, x: 0, y: 4)
    }

    private func earningsSummaryMetric(
        title: String,
        value: String,
        compact: Bool
    ) -> some View {
        VStack(spacing: compact ? 5 : 7) {
            Text(title)
                .font(.system(size: compact ? 11 : 12, weight: .semibold))
                .foregroundColor(.black.opacity(0.66))
                .lineLimit(1)
                .minimumScaleFactor(0.58)
                .allowsTightening(true)

            Text(value)
                .font(.system(size: compact ? 23 : 27, weight: .bold))
                .monospacedDigit()
                .foregroundColor(.black)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .allowsTightening(true)
        }
        .frame(maxWidth: .infinity)
    }

    private func withdrawalRecordShortcutRow(compact: Bool) -> some View {
        HStack(alignment: .center, spacing: 10) {
            Text(withdrawalMinimumText)
                .font(.system(size: compact ? 11 : 12, weight: .medium))
                .foregroundColor(.black.opacity(0.42))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .allowsTightening(true)

            Spacer(minLength: 8)

            Button {
                performAfterDismissingWalletInput {
                    openWithdrawalDetails()
                }
            } label: {
                HStack(spacing: 3) {
                    Text(L10n.tr("wallet.withdrawals.title"))
                        .font(.system(size: compact ? 11 : 12, weight: .medium))
                    Image(systemName: "chevron.right")
                        .font(.system(size: compact ? 9 : 10, weight: .semibold))
                }
                .foregroundColor(.black.opacity(0.42))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.tr("wallet.withdrawals.title"))
        }
        .padding(.horizontal, compact ? 8 : 10)
        .frame(maxWidth: .infinity)
    }

    private func earningsMetricTitle(
        title: String,
        compact: Bool,
        showsInfo: Bool = false
    ) -> some View {
        HStack(spacing: compact ? 4 : 5) {
            Text(title)
                .font(.system(size: compact ? 14 : 16, weight: .semibold))
                .foregroundColor(.black)
                .lineLimit(1)
                .minimumScaleFactor(0.68)
                .allowsTightening(true)

            if showsInfo {
                Button {
                    closeWithdrawalNetworkPicker()
                    withAnimation(.easeInOut(duration: 0.16)) {
                        isUSDTInfoBubbleVisible.toggle()
                    }
                } label: {
                    Image(systemName: "questionmark.circle.fill")
                        .font(.system(size: compact ? 11 : 13, weight: .semibold))
                        .foregroundColor(Color(hex: "D19A00").opacity(0.82))
                        .frame(width: compact ? 18 : 20, height: compact ? 18 : 20)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .top) {
                    if isUSDTInfoBubbleVisible {
                        Text("100金币≈$0.5")
                            .font(.system(size: compact ? 10 : 11, weight: .semibold))
                            .foregroundColor(.black.opacity(0.82))
                            .lineLimit(1)
                            .padding(.horizontal, compact ? 8 : 10)
                            .padding(.vertical, compact ? 5 : 6)
                            .background(
                                Capsule()
                                    .fill(Color.white)
                                    .shadow(color: Color.black.opacity(0.12), radius: 10, x: 0, y: 4)
                            )
                            .overlay(
                                Capsule()
                                    .stroke(Color(hex: "FFD800").opacity(0.5), lineWidth: 1)
                            )
                            .fixedSize()
                            .offset(x: compact ? -38 : -42, y: compact ? -32 : -36)
                            .transition(.scale(scale: 0.92, anchor: .top).combined(with: .opacity))
                            .zIndex(4)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .zIndex(isUSDTInfoBubbleVisible && showsInfo ? 4 : 0)
    }

    private func earningsMetricValue(_ value: String, compact: Bool) -> some View {
        Text(value)
            .font(.system(size: compact ? 29 : 34, weight: .bold))
            .monospacedDigit()
            .foregroundColor(.black)
            .lineLimit(1)
            .minimumScaleFactor(0.4)
            .allowsTightening(true)
            .frame(maxWidth: .infinity, alignment: .center)
    }

    private func earningsActionPanel(
        compact: Bool,
        buttonBottomPadding: CGFloat,
        availableWidth: CGFloat
    ) -> some View {
        VStack(alignment: .leading, spacing: compact ? 14 : 16) {
            usdtWithdrawalTextField(
                title: L10n.tr("wallet.usdt.address"),
                placeholder: L10n.tr("wallet.usdt.address.placeholder"),
                text: $withdrawalAddressText,
                icon: "wallet.pass",
                compact: compact
            )

            usdtWithdrawalNetworkPicker(compact: compact)

            usdtWithdrawalAmountField(compact: compact)

            Spacer(minLength: compact ? 12 : 16)

            Button {
                dismissWithdrawalKeyboard()
                closeWithdrawalNetworkPicker()
                Task { await submitInlineWithdrawal() }
            } label: {
                HStack(spacing: 8) {
                    if walletStore.isSubmittingWithdrawal {
                        ProgressView()
                            .tint(.black)
                    }

                    Text(hasWithdrawableUSDTAmount ? L10n.tr("wallet.withdraw") : L10n.tr("wallet.usdt.noneWithdrawable"))
                        .font(.system(size: compact ? 16 : 19, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.58)
                        .allowsTightening(true)
                }
                .foregroundColor(.black)
                .frame(maxWidth: .infinity)
                .frame(height: compact ? 42 : 52)
                .background(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color(hex: "FFE500"))
                )
            }
            .disabled(!hasWithdrawableUSDTAmount || walletStore.isSubmittingWithdrawal)
            .opacity(!hasWithdrawableUSDTAmount || walletStore.isSubmittingWithdrawal ? 0.58 : 1)
            .padding(.bottom, buttonBottomPadding)
        }
        .padding(.horizontal, 18)
        .padding(.top, compact ? 22 : 26)
        .frame(width: availableWidth, alignment: .top)
        .background(Color.white)
        .clipShape(WalletTopRoundedShape(radius: 30))
        .ignoresSafeArea(.container, edges: .bottom)
    }

    private func usdtWithdrawalTextField(
        title: String,
        placeholder: String,
        text: Binding<String>,
        icon: String,
        keyboardType: UIKeyboardType = .default,
        compact: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: compact ? 10 : 12) {
            Text(title)
                .font(.system(size: compact ? 13 : 14, weight: .semibold))
                .foregroundColor(.black.opacity(0.62))
                .lineLimit(1)
                .minimumScaleFactor(0.72)

            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: compact ? 15 : 16, weight: .semibold))
                    .foregroundColor(Color(hex: "D19A00"))
                    .frame(width: 22)

                TextField(placeholder, text: text)
                    .keyboardType(keyboardType)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focusedWithdrawalField, equals: .address)
                    .font(.system(size: compact ? 14 : 15, weight: .semibold))
                    .foregroundColor(.black.opacity(0.86))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                    .frame(maxHeight: .infinity)
            }
            .padding(.horizontal, compact ? 15 : 16)
            .frame(height: compact ? 62 : 68)
            .background(Color(hex: "F7F7F7"))
            .cornerRadius(18)
            .contentShape(RoundedRectangle(cornerRadius: 18))
            .onTapGesture {
                withAnimation(walletKeyboardTransitionAnimation) {
                    focusedWithdrawalField = .address
                }
            }
        }
    }

    private func usdtWithdrawalAmountField(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 10 : 12) {
            Text(L10n.tr("wallet.usdt.withdrawTitle"))
                .font(.system(size: compact ? 13 : 14, weight: .semibold))
                .foregroundColor(.black.opacity(0.62))
                .lineLimit(1)
                .minimumScaleFactor(0.72)

            HStack(spacing: 8) {
                Image(systemName: "dollarsign.circle.fill")
                    .font(.system(size: compact ? 15 : 16, weight: .semibold))
                    .foregroundColor(Color(hex: "D19A00"))
                    .frame(width: 22)

                TextField(withdrawalUSDTPlaceholder, text: $withdrawalAmountText)
                    .keyboardType(.decimalPad)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focusedWithdrawalField, equals: .amount)
                    .font(.system(size: compact ? 14 : 15, weight: .semibold))
                    .foregroundColor(.black.opacity(0.86))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                    .layoutPriority(1)
                    .frame(maxHeight: .infinity)

                Button {
                    fillMaxWithdrawalAmount()
                } label: {
                    Text(L10n.tr("wallet.usdt.withdrawAll"))
                        .font(.system(size: compact ? 12 : 13, weight: .semibold))
                        .foregroundColor(Color(hex: "D19A00"))
                        .lineLimit(1)
                        .minimumScaleFactor(0.56)
                        .allowsTightening(true)
                        .frame(width: compact ? 66 : 78, alignment: .trailing)
                }
                .buttonStyle(.plain)
                .disabled(!hasWithdrawableUSDTAmount)
                .opacity(hasWithdrawableUSDTAmount ? 1 : 0.45)
            }
            .padding(.horizontal, compact ? 15 : 16)
            .frame(height: compact ? 62 : 68)
            .background(Color(hex: "F7F7F7"))
            .cornerRadius(18)
            .contentShape(RoundedRectangle(cornerRadius: 18))
            .onTapGesture {
                withAnimation(walletKeyboardTransitionAnimation) {
                    focusedWithdrawalField = .amount
                }
            }
        }
    }

    private func usdtWithdrawalNetworkPicker(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 10 : 12) {
            Text(L10n.tr("wallet.usdt.network"))
                .font(.system(size: compact ? 13 : 14, weight: .semibold))
                .foregroundColor(.black.opacity(0.62))
                .lineLimit(1)
                .minimumScaleFactor(0.72)

            Button {
                dismissWithdrawalKeyboard()
                isUSDTInfoBubbleVisible = false
                if isWithdrawalNetworkPickerExpanded {
                    closeWithdrawalNetworkPicker()
                } else {
                    openWithdrawalNetworkPicker()
                }
            } label: {
                withdrawalNetworkPickerRow(compact: compact)
            }
            .buttonStyle(.plain)
            .overlay(alignment: .topTrailing) {
                if isWithdrawalNetworkPickerExpanded {
                    withdrawalNetworkSelectBox(compact: compact)
                        .frame(width: compact ? 158 : 176)
                        .offset(y: compact ? 70 : 76)
                        .transition(.scale(scale: 0.96, anchor: .topTrailing).combined(with: .opacity))
                        .zIndex(5)
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .zIndex(isWithdrawalNetworkPickerLayerRaised ? 5 : 0)
    }

    private func withdrawalNetworkSelectBox(compact: Bool) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(withdrawalNetworks.enumerated()), id: \.element) { index, network in
                Button {
                    dismissWithdrawalKeyboard()
                    withdrawalNetwork = network
                    closeWithdrawalNetworkPicker()
                } label: {
                    HStack(spacing: 10) {
                        Text(network)
                            .font(.system(size: compact ? 14 : 15, weight: .semibold))
                            .foregroundColor(.black.opacity(0.86))

                        Spacer(minLength: 8)

                        if withdrawalNetwork == network {
                            Image(systemName: "checkmark")
                                .font(.system(size: compact ? 12 : 13, weight: .semibold))
                                .foregroundColor(.black.opacity(0.78))
                        }
                    }
                    .frame(height: compact ? 44 : 48)
                    .padding(.horizontal, 14)
                    .background(withdrawalNetwork == network ? Color.black.opacity(0.035) : Color.clear)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if index < withdrawalNetworks.count - 1 {
                    Divider()
                        .padding(.leading, 14)
                        .opacity(0.58)
                }
            }
        }
        .padding(.vertical, compact ? 4 : 5)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.black.opacity(0.08), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.10), radius: 14, x: 0, y: 8)
    }

    private func withdrawalNetworkPickerRow(compact: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "link")
                .font(.system(size: compact ? 15 : 16, weight: .semibold))
                .foregroundColor(Color(hex: "D19A00"))
                .frame(width: 22)

            Text(withdrawalNetworkDisplayText)
                .font(.system(size: compact ? 14 : 15, weight: .semibold))
                .foregroundColor(withdrawalNetwork.isBlank ? .black.opacity(0.36) : .black.opacity(0.86))
                .lineLimit(1)
                .minimumScaleFactor(0.72)

            Spacer(minLength: 8)

            Image(systemName: "chevron.down")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(.black.opacity(0.36))
                .rotationEffect(.degrees(isWithdrawalNetworkPickerExpanded ? 180 : 0))
        }
        .padding(.horizontal, compact ? 15 : 16)
        .frame(maxWidth: .infinity)
        .frame(height: compact ? 62 : 68)
        .background(Color(hex: "F7F7F7"))
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .contentShape(RoundedRectangle(cornerRadius: 18))
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(
                    isWithdrawalNetworkPickerExpanded ? Color.black.opacity(0.08) : Color.clear,
                    lineWidth: 1.2
                )
        )
    }

    private func fillMaxWithdrawalAmount() {
        guard hasWithdrawableUSDTAmount else { return }
        dismissWithdrawalKeyboard()
        closeWithdrawalNetworkPicker()
        withdrawalAmountText = maxWithdrawableUSDTNumberText
    }

    private func submitInlineWithdrawal() async {
        dismissWithdrawalKeyboard()

        let trimmedAddress = withdrawalAddressText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let normalizedUSDTText = normalizedWithdrawalUSDTAmountText(withdrawalAmountText) else {
            alertMessage = L10n.tr("wallet.withdrawal.amount.invalid")
            return
        }

        let maxGoldCoinAmount = walletStore.withdrawableGoldCoinBalanceForAction
        let maxUSDTAmount = maxWithdrawableUSDTAmount

        guard !withdrawalNetwork.isBlank else {
            alertMessage = L10n.tr("wallet.usdt.invalid")
            return
        }

        guard let usdtAmount = Double(normalizedUSDTText),
              usdtAmount > 0 else {
            alertMessage = L10n.tr("wallet.withdrawal.amount.invalid")
            return
        }

        guard usdtAmount + 0.000_000_1 >= withdrawalPolicy.minimumUSDT else {
            alertMessage = withdrawalMinimumText
            return
        }

        guard withdrawalPolicy.isValidUSDTIncrement(usdtAmount) else {
            alertMessage = L10n.tr(
                "wallet.withdrawal.amount.multipleOfHalfUSDT",
                withdrawalStepText
            )
            return
        }

        guard usdtAmount <= maxUSDTAmount + 0.000_000_1 else {
            alertMessage = L10n.tr("wallet.withdrawal.amount.invalid")
            return
        }

        let amount = min(
            maxGoldCoinAmount,
            withdrawalPolicy.requiredGoldCoins(forUSDT: usdtAmount)
        )

        do {
            try walletStore.saveUSDTPayoutAccount(network: withdrawalNetwork, address: trimmedAddress)
            try await walletStore.requestWithdrawal(
                amount: amount,
                usdtAmount: normalizedUSDTText,
                network: withdrawalNetwork,
                walletAddress: trimmedAddress
            )
            resetWithdrawalForm()
            centerToastMessage = L10n.tr("wallet.withdrawal.request.success")
        } catch let error as LocalizedError {
            alertMessage = error.errorDescription ?? L10n.tr("wallet.withdrawal.request.failed")
        } catch {
            alertMessage = L10n.tr("wallet.withdrawal.request.failedWithError", error.localizedDescription)
        }
    }

    private func normalizedWithdrawalUSDTAmountText(_ rawText: String) -> String? {
        var text = rawText
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: ",", with: ".")

        if text.hasPrefix(".") {
            text = "0" + text
        }
        if text.hasSuffix(".") {
            text += "0"
        }

        guard text.range(of: #"^\d+(\.\d{1,2})?$"#, options: .regularExpression) != nil,
              let amount = Double(text) else {
            return nil
        }

        return String(format: "%.2f", amount)
    }

    private func dismissWithdrawalKeyboard() {
        if focusedWithdrawalField != nil {
            withAnimation(walletKeyboardTransitionAnimation) {
                focusedWithdrawalField = nil
            }
        }
        hideKeyboard()
    }

    private func resetWithdrawalForm() {
        withdrawalAddressText = ""
        withdrawalAmountText = ""
        withdrawalNetwork = ""
        walletStore.deleteUSDTPayoutAccount()
    }

    private func dismissWalletInputState() {
        dismissWithdrawalKeyboard()
        dismissWalletFloatingOverlays()
    }

    private func performAfterDismissingWalletInput(_ action: @escaping () -> Void) {
        guard isWithdrawalFormFocused else {
            action()
            return
        }

        dismissWalletInputState()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
            action()
        }
    }

    private func dismissUSDTInfoBubble() {
        guard isUSDTInfoBubbleVisible else { return }
        withAnimation(.easeInOut(duration: 0.16)) {
            isUSDTInfoBubbleVisible = false
        }
    }

    private func dismissWalletFloatingOverlays() {
        dismissUSDTInfoBubble()
        closeWithdrawalNetworkPicker()
    }

    private func openWithdrawalNetworkPicker() {
        isWithdrawalNetworkPickerLayerRaised = true
        withAnimation(.easeInOut(duration: 0.16)) {
            isWithdrawalNetworkPickerExpanded = true
        }
    }

    private func closeWithdrawalNetworkPicker() {
        guard isWithdrawalNetworkPickerExpanded || isWithdrawalNetworkPickerLayerRaised else { return }
        withAnimation(.easeInOut(duration: 0.16)) {
            isWithdrawalNetworkPickerExpanded = false
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            guard !isWithdrawalNetworkPickerExpanded else { return }
            isWithdrawalNetworkPickerLayerRaised = false
        }
    }

    private var purchaseButtonTitle: String {
        if walletStore.isLoadingProducts { return L10n.tr("wallet.products.loading") }
        if walletStore.isPurchasing { return L10n.tr("wallet.purchase.processing") }
        return L10n.tr("wallet.rechargeNow", selectedPriceText)
    }

    private func rechargeDisplayPrice(_ price: String) -> String {
        price
            .replacingOccurrences(of: "US$", with: "$")
            .replacingOccurrences(of: "US $", with: "$")
            .replacingOccurrences(of: "US\u{00A0}$", with: "$")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func amountCard(index: Int, compact: Bool) -> some View {
        let item = packages[index]
        let selected = selectedAmountIndex == index
        let isUnavailable = !walletStore.isLoadingProducts && !walletStore.isProductAvailable(for: item)

        return Button {
            selectedAmountIndex = index
        } label: {
            VStack(spacing: compact ? 9 : 12) {
                HStack(spacing: compact ? 2 : 3) {
                    Image("wallet_gold_coin_badge")
                        .resizable()
                        .scaledToFit()
                        .frame(width: compact ? 21 : 28, height: compact ? 21 : 28)
                    Text(verbatim: String(item.coins))
                        .font(.system(size: compact ? 14 : 17, weight: .bold))
                        .foregroundColor(.black)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                Text(isUnavailable ? L10n.tr("wallet.product.unavailable") : rechargeDisplayPrice(walletStore.displayPrice(for: item)))
                    .font(.system(size: compact ? 12 : 14, weight: .medium))
                    .foregroundColor(.black.opacity(0.48))
                    .lineLimit(1)
                    .minimumScaleFactor(0.52)
                    .allowsTightening(true)
            }
            .frame(maxWidth: .infinity)
            .frame(height: compact ? 66 : 78)
            .background(
                RoundedRectangle(cornerRadius: compact ? 14 : 18)
                    .fill(selected ? Color.white : Color(hex: "F2F2F2"))
                    .overlay(
                        RoundedRectangle(cornerRadius: compact ? 14 : 18)
                            .stroke(selected ? Color(hex: "FFE200") : Color.clear, lineWidth: compact ? 2.5 : 3)
                    )
            )
        }
        .buttonStyle(.plain)
    }

    private func openGoldCoinDetails() {
        dismissWalletInputState()
        navigator.push(WalletTransactionDetailView().hidesTabBarOnPush())
    }

    private func openWithdrawalDetails() {
        dismissWalletInputState()
        navigator.push(WalletWithdrawalDetailView().hidesTabBarOnPush())
    }

    private func purchaseSelectedPackage() async {
        guard agreedToTerms else {
            alertMessage = L10n.tr("wallet.terms.required")
            return
        }

        guard walletStore.product(for: selectedPackage) != nil else {
            alertMessage = walletStore.productLoadError
                ?? L10n.tr("wallet.product.configMissing")
            return
        }

        do {
            let outcome = try await walletStore.purchase(selectedPackage)
            switch outcome {
            case .success(let coins):
                await walletStore.refreshBalanceFromServer()
                await walletStore.loadTransactions()
                centerToastMessage = coins > 0 ? L10n.tr("wallet.purchase.success", coins) : L10n.tr("wallet.purchase.alreadyHandled")
            case .pending:
                alertMessage = L10n.tr("wallet.purchase.pending")
            case .cancelled:
                toastMessage = L10n.tr("wallet.purchase.cancelled")
            case .deliveryPending:
                alertMessage = L10n.tr("wallet.purchase.deliveryPending")
            }
        } catch let error as LocalizedError {
            alertMessage = error.errorDescription ?? L10n.tr("wallet.purchase.failed")
        } catch {
            alertMessage = L10n.tr("wallet.purchase.failedWithError", error.localizedDescription)
        }
    }

}

/// Keeps AdMob's loading and presentation state out of `WalletView` so the
/// animated entry does not invalidate the balance header, product grid, and
/// withdrawal form on every SDK callback.
private struct WalletAdRewardBanner: View, Equatable {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var adRewardService = AdRewardService()
    @State private var isPreparing = false
    @State private var alertMessage: String?

    let compact: Bool
    let isConfigured: Bool
    let onCenterToast: (String) -> Void

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.compact == rhs.compact && lhs.isConfigured == rhs.isConfigured
    }

    private var isAvailable: Bool {
        isConfigured && adRewardService.serverDeliveryEnabled
    }

    private var isBusy: Bool {
        isPreparing
            || adRewardService.state == .loading
            || adRewardService.state == .presenting
            || adRewardService.isAwaitingServerCredit
    }

    private var title: String {
        if adRewardService.isAwaitingServerCredit {
            return L10n.tr("wallet.adRewardCompletedPending")
        }
        if isBusy {
            return L10n.tr("wallet.adRewardPreparing")
        }
        return L10n.tr("wallet.adReward", adRewardService.remainingViewCount)
    }

    var body: some View {
        Button {
            Task { await presentRewardedAd() }
        } label: {
            row
        }
        .buttonStyle(.plain)
        .disabled(isBusy || !adRewardService.hasRemainingViews)
        .opacity(isBusy || !adRewardService.hasRemainingViews ? 0.62 : 1)
        .task(id: isConfigured) {
            await prepareRewardedAd()
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            adRewardService.refreshDailyCounter()
            Task { await prepareRewardedAd() }
        }
        .alert(L10n.tr("common.notice"), isPresented: Binding(
            get: { alertMessage != nil },
            set: { if !$0 { alertMessage = nil } }
        )) {
            Button(L10n.tr("common.ok"), role: .cancel) {}
        } message: {
            Text(alertMessage ?? "")
        }
    }

    private var row: some View {
        let cornerRadius: CGFloat = compact ? 15 : 18

        return HStack(spacing: compact ? 8 : 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 9)
                    .fill(Color(hex: "FFD400"))
                    .frame(width: compact ? 20 : 24, height: compact ? 20 : 24)

                if isBusy {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(.white)
                } else {
                    Image(systemName: "play.fill")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(.white)
                        .offset(x: 1)
                }
            }

            Text(title)
                .font(.system(size: compact ? 13 : 14, weight: .medium))
                .foregroundColor(.black.opacity(0.68))
                .lineLimit(2)
                .minimumScaleFactor(0.64)
                .allowsTightening(true)
                .frame(maxWidth: .infinity, alignment: .leading)

            Image(systemName: "chevron.right")
                .font(.system(size: compact ? 15 : 18, weight: .semibold))
                .foregroundColor(.black.opacity(0.5))
        }
        .padding(.horizontal, compact ? 13 : 18)
        .frame(height: compact ? 46 : 54)
        .background(
            RoundedRectangle(cornerRadius: cornerRadius)
                // A solid translucent fill avoids continuously recompositing a
                // live blur while ProgressView is animating.
                .fill(Color(hex: "FFF3B5").opacity(0.96))
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius)
                        .stroke(Color.white.opacity(0.74), lineWidth: 1)
                )
        )
        .shadow(color: Color(hex: "C99A10").opacity(0.1), radius: 8, x: 0, y: 4)
    }

    @MainActor
    private func prepareRewardedAd() async {
        guard isConfigured, !isPreparing else { return }
        isPreparing = true
        defer { isPreparing = false }

        await adRewardService.syncServerCounter()
        guard isAvailable, adRewardService.hasRemainingViews else { return }
        await adRewardService.load()
    }

    @MainActor
    private func presentRewardedAd() async {
        guard isAvailable else {
            alertMessage = L10n.tr("wallet.adRewardUnavailable")
            return
        }
        guard adRewardService.hasRemainingViews else {
            alertMessage = L10n.tr("wallet.adRewardDailyLimitReached")
            return
        }

        let earnedReward = await adRewardService.present()
        guard earnedReward else {
            if !adRewardService.hasRemainingViews {
                alertMessage = L10n.tr("wallet.adRewardDailyLimitReached")
            } else if adRewardService.state == .failed
                        || adRewardService.lastErrorMessage != nil {
                alertMessage = L10n.tr("wallet.adRewardLoadFailed")
            }
            return
        }

        onCenterToast(L10n.tr("wallet.adRewardCompletedPending"))
        await adRewardService.waitForServerCredit()
        await WalletStore.shared.refreshBalanceFromServer(forceRefresh: true)
        await WalletStore.shared.loadTransactions(forceRefresh: true)
        if !adRewardService.isAwaitingServerCredit, isAvailable {
            await adRewardService.load(force: true)
        }
    }
}

struct WalletTransactionDetailView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var walletStore = WalletStore.shared
    @State private var selectedTab: WalletRecordTab = .income

    private var visibleTransactions: [WalletTransaction] {
        walletStore.transactions.filter { transaction in
            guard transaction.currency == .goldCoins else { return false }
            switch selectedTab {
            case .income:
                return isIncome(transaction)
            case .expense:
                return isExpense(transaction)
            }
        }
    }

    var body: some View {
        ZStack {
            Color.white.ignoresSafeArea()

            VStack(spacing: 0) {
                recordHeader

                Group {
                    if walletStore.isLoadingTransactions && walletStore.transactions.isEmpty {
                        ProgressView()
                            .tint(AppColors.accent)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if let error = walletStore.transactionLoadError,
                              walletStore.transactions.isEmpty,
                              !walletStore.canLoadMoreTransactions {
                        WalletEmptyState(title: error)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if visibleTransactions.isEmpty && !walletStore.canLoadMoreTransactions {
                        WalletEmptyState(title: L10n.tr("wallet.records.empty"))
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 8) {
                                ForEach(visibleTransactions) { transaction in
                                    WalletTransactionRow(transaction: transaction)
                                }
                                WalletTransactionPaginationFooter()
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                        }
                        .refreshable {
                            await walletStore.loadTransactions(forceRefresh: true)
                        }
                        .background(Color(hex: "F7F7F7"))
                    }
                }
            }
        }
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await walletStore.loadTransactions()
        }
    }

    private var recordHeader: some View {
        HStack(alignment: .top, spacing: 0) {
            AppBackButton(tint: .black) {
                navigator.pop()
            }
            .frame(width: 78, alignment: .leading)

            HStack(spacing: 48) {
                recordTabButton(.income)
                recordTabButton(.expense)
            }
            .frame(maxWidth: .infinity)

            Color.clear
                .frame(width: 78, height: 36)
        }
        .padding(.horizontal, 14)
        .padding(.top, 14)
        .padding(.bottom, 18)
        .background(Color.white)
    }

    private func recordTabButton(_ tab: WalletRecordTab) -> some View {
        Button {
            selectedTab = tab
        } label: {
            VStack(spacing: 7) {
                Text(tab.title)
                    .font(.system(size: 20, weight: selectedTab == tab ? .semibold : .regular))
                    .foregroundColor(selectedTab == tab ? .black : .black.opacity(0.56))
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
                Rectangle()
                    .fill(selectedTab == tab ? Color.black : Color.clear)
                    .frame(width: 31, height: 3)
            }
        }
        .buttonStyle(.plain)
    }

    private func isIncome(_ transaction: WalletTransaction) -> Bool {
        (transaction.signedAmountValue ?? 0) > 0
    }

    private func isExpense(_ transaction: WalletTransaction) -> Bool {
        (transaction.signedAmountValue ?? 0) < 0
    }
}

private enum WalletRecordTab: CaseIterable {
    case income
    case expense

    var title: String {
        switch self {
        case .income:
            return L10n.tr("wallet.records.income")
        case .expense:
            return L10n.tr("wallet.records.expense")
        }
    }
}

private struct WalletWithdrawalDetailView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var walletStore = WalletStore.shared
    @State private var alertMessage: String?

    var body: some View {
        ZStack {
            Color.white.ignoresSafeArea()

            VStack(spacing: 0) {
                simpleHeader

                Group {
                    if walletStore.isLoadingWithdrawals && walletStore.withdrawals.isEmpty {
                        ProgressView()
                            .tint(AppColors.accent)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if let error = walletStore.withdrawalLoadError, walletStore.withdrawals.isEmpty {
                        WalletEmptyState(title: error)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if walletStore.withdrawals.isEmpty {
                        WalletEmptyState(title: L10n.tr("wallet.withdrawals.empty"))
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 8) {
                                ForEach(walletStore.withdrawals) { withdrawal in
                                    WalletWithdrawalRow(
                                        withdrawal: withdrawal,
                                        isSubmitting: walletStore.isSubmittingWithdrawal
                                    ) {
                                        Task { await cancelWithdrawal(withdrawal) }
                                    }
                                }
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                        }
                        .background(Color(hex: "F7F7F7"))
                    }
                }
            }
        }
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .task {
            await walletStore.loadWithdrawals()
        }
        .alert(L10n.tr("common.notice"), isPresented: Binding(
            get: { alertMessage != nil },
            set: { if !$0 { alertMessage = nil } }
        )) {
            Button(L10n.tr("common.ok"), role: .cancel) {}
        } message: {
            Text(alertMessage ?? "")
        }
    }

    private var simpleHeader: some View {
        HStack(spacing: 0) {
            AppBackButton(tint: .black) {
                navigator.pop()
            }
            .frame(width: 78, alignment: .leading)

            Text(L10n.tr("wallet.withdrawals.title"))
                .font(.system(size: 20, weight: .semibold))
                .foregroundColor(.black)
                .frame(maxWidth: .infinity)

            Color.clear
                .frame(width: 78, height: 36)
        }
        .padding(.horizontal, 14)
        .padding(.top, 14)
        .padding(.bottom, 18)
        .background(Color.white)
    }

    private func cancelWithdrawal(_ withdrawal: WalletWithdrawal) async {
        do {
            try await walletStore.cancelWithdrawal(withdrawal)
        } catch let error as LocalizedError {
            alertMessage = error.errorDescription ?? L10n.tr("wallet.withdrawal.cancel.failed")
        } catch {
            alertMessage = L10n.tr("wallet.withdrawal.cancel.failedWithError", error.localizedDescription)
        }
    }
}

private struct WalletTransactionsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var walletStore = WalletStore.shared

    var body: some View {
        NavigationStack {
            Group {
                if walletStore.isLoadingTransactions && walletStore.transactions.isEmpty {
                    ProgressView()
                        .tint(AppColors.accent)
                } else if let error = walletStore.transactionLoadError,
                          walletStore.transactions.isEmpty,
                          !walletStore.canLoadMoreTransactions {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.circle")
                            .font(.system(size: 34))
                            .foregroundColor(AppColors.tertiaryText)
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.secondaryText)
                    }
                } else if walletStore.transactions.isEmpty && !walletStore.canLoadMoreTransactions {
                    VStack(spacing: 12) {
                        Image(systemName: "doc.text")
                            .font(.system(size: 34))
                            .foregroundColor(AppColors.tertiaryText)
                        Text(L10n.tr("wallet.transactions.empty"))
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                    }
                } else {
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(walletStore.transactions) { transaction in
                                WalletTransactionRow(transaction: transaction)
                            }
                            WalletTransactionPaginationFooter()
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                    }
                    .background(AppColors.secondaryBackground)
                }
            }
            .navigationTitle(L10n.tr("wallet.transactions.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(L10n.tr("common.close")) { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        Task { await walletStore.loadTransactions(forceRefresh: true) }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(walletStore.isLoadingTransactions)
                }
            }
            .task {
                await walletStore.loadTransactions()
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

private struct WalletTransactionPaginationFooter: View {
    @ObservedObject private var walletStore = WalletStore.shared

    @ViewBuilder
    var body: some View {
        if let cursor = walletStore.transactionNextCursor, !cursor.isBlank {
            if let error = walletStore.transactionLoadError {
                VStack(spacing: 8) {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundColor(AppColors.secondaryText)
                        .multilineTextAlignment(.center)
                    Button(L10n.tr("common.retry")) {
                        Task { await walletStore.loadMoreTransactions() }
                    }
                    .font(.system(size: 14, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            } else {
                ProgressView()
                    .tint(AppColors.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .task(id: cursor) {
                        await walletStore.loadMoreTransactions()
                    }
            }
        }
    }
}

private struct WalletWithdrawalsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var walletStore = WalletStore.shared
    @State private var alertMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if walletStore.isLoadingWithdrawals && walletStore.withdrawals.isEmpty {
                    ProgressView()
                        .tint(AppColors.accent)
                } else if let error = walletStore.withdrawalLoadError, walletStore.withdrawals.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.circle")
                            .font(.system(size: 34))
                            .foregroundColor(AppColors.tertiaryText)
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.secondaryText)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }
                } else if walletStore.withdrawals.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "arrow.down.doc")
                            .font(.system(size: 34))
                            .foregroundColor(AppColors.tertiaryText)
                        Text(L10n.tr("wallet.withdrawals.empty"))
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                    }
                } else {
                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(walletStore.withdrawals) { withdrawal in
                                WalletWithdrawalRow(
                                    withdrawal: withdrawal,
                                    isSubmitting: walletStore.isSubmittingWithdrawal
                                ) {
                                    Task { await cancelWithdrawal(withdrawal) }
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                    }
                    .background(AppColors.secondaryBackground)
                }
            }
            .navigationTitle(L10n.tr("wallet.withdrawals.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(L10n.tr("common.close")) { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        Task { await walletStore.loadWithdrawals() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(walletStore.isLoadingWithdrawals)
                }
            }
            .task {
                await walletStore.loadWithdrawals()
            }
            .alert(L10n.tr("common.notice"), isPresented: Binding(
                get: { alertMessage != nil },
                set: { if !$0 { alertMessage = nil } }
            )) {
                Button(L10n.tr("common.ok"), role: .cancel) {}
            } message: {
                Text(alertMessage ?? "")
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func cancelWithdrawal(_ withdrawal: WalletWithdrawal) async {
        do {
            try await walletStore.cancelWithdrawal(withdrawal)
        } catch let error as LocalizedError {
            alertMessage = error.errorDescription ?? L10n.tr("wallet.withdrawal.cancel.failed")
        } catch {
            alertMessage = L10n.tr("wallet.withdrawal.cancel.failedWithError", error.localizedDescription)
        }
    }
}

private struct WalletTransactionRow: View {
    let transaction: WalletTransaction

    private var amountColor: Color {
        guard transaction.hasDisplayableAmount else { return AppColors.tertiaryText }
        return (transaction.signedAmountValue ?? 0) < 0 ? AppColors.errorColor : Color(hex: "2FAE88")
    }

    private var iconName: String {
        switch transaction.type {
        case "ios_iap": return "cart.fill"
        case "gift_sent": return "paperplane.fill"
        case "gift_received": return "gift.fill"
        case "red_packet_sent": return "envelope.fill"
        case "red_packet_received", "red_packet_refund": return "envelope.open.fill"
        case "transfer_sent": return "arrow.up.right.circle.fill"
        case "transfer_received": return "arrow.down.left.circle.fill"
        case "transfer_returned": return "arrow.uturn.backward.circle.fill"
        default: return "pawprint.fill"
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(amountColor.opacity(0.12))
                    .frame(width: 36, height: 36)
                Image(systemName: iconName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(amountColor)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(transaction.displayTitle)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                Text(transaction.displaySubtitle)
                    .font(.system(size: 12))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(1)
                if let createdAt = transaction.createdAt {
                    Text(TimestampHelper.formatDetailedDateTime(createdAt))
                        .font(.system(size: 11))
                        .foregroundColor(AppColors.tertiaryText)
                }
            }

            Spacer()

            Text(transaction.signedAmountText)
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(amountColor)
                .lineLimit(1)
                .minimumScaleFactor(0.68)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(AppColors.cardBackground)
        .cornerRadius(12)
    }
}

private struct WalletWithdrawalRow: View {
    let withdrawal: WalletWithdrawal
    let isSubmitting: Bool
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(Color(hex: "FFD54A").opacity(0.18))
                    .frame(width: 36, height: 36)
                Image("wallet_gold_coin_badge")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 24, height: 24)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(L10n.tr("wallet.withdrawal.amountValue", withdrawal.goldCoinAmount.value))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.68)
                Text(L10n.tr("wallet.withdrawal.payoutValue", withdrawal.payoutDisplayText))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color(hex: "A76500"))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                if let destination = withdrawal.payoutDestinationText, !destination.isBlank {
                    Text(destination)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.72)
                }
                HStack(spacing: 6) {
                    Text(withdrawal.displayStatus)
                        .font(.system(size: 12))
                        .foregroundColor(AppColors.secondaryText)
                    if let createdAt = withdrawal.createdAt {
                        Text(TimestampHelper.formatDetailedDateTime(createdAt))
                            .font(.system(size: 11))
                            .foregroundColor(AppColors.tertiaryText)
                    }
                }
                if let note = withdrawal.note, !note.isBlank {
                    Text(note)
                        .font(.system(size: 11))
                        .foregroundColor(AppColors.tertiaryText)
                        .lineLimit(1)
                }
            }

            Spacer()

            if withdrawal.canCancel {
                Button(action: onCancel) {
                    Text(L10n.tr("wallet.withdrawal.cancel"))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(Color(hex: "C98300"))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color(hex: "FFF4C9"))
                        .cornerRadius(12)
                }
                .disabled(isSubmitting)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(hex: "FFF8DE"))
        .cornerRadius(12)
    }

}

private struct WalletMainBackground: View {
    var body: some View {
        GeometryReader { geo in
            Image("wallet_gold_coin_background")
                .resizable()
                .scaledToFill()
                .frame(width: geo.size.width, height: geo.size.height)
                .clipped()
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

private struct WalletTopRoundedShape: Shape {
    var radius: CGFloat

    func path(in rect: CGRect) -> Path {
        let radius = min(radius, min(rect.width, rect.height) / 2)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX + radius, y: rect.minY),
            control: CGPoint(x: rect.minX, y: rect.minY)
        )
        path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY + radius),
            control: CGPoint(x: rect.maxX, y: rect.minY)
        )
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

private struct WalletEmptyState: View {
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(spacing: 18) {
            WalletEmptyCatIllustration()

            VStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(.black)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)

                if let subtitle, !subtitle.isBlank {
                    Text(subtitle)
                        .font(.system(size: 16, weight: .regular))
                        .foregroundColor(.black.opacity(0.42))
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .minimumScaleFactor(0.72)
                }
            }
        }
        .padding(.horizontal, 24)
    }
}

private struct WalletEmptyCatIllustration: View {
    var body: some View {
        Image("wallet_empty_cat")
            .resizable()
            .scaledToFit()
            .frame(width: 154, height: 142)
    }
}
