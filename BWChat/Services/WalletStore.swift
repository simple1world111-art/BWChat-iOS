// BWChat/Services/WalletStore.swift
// StoreKit-backed wallet for consumable gold-coin purchases and withdrawals.

import Foundation
import OSLog
import StoreKit

enum WalletTelemetry {
    private static let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "BWChat",
        category: "wallet"
    )

    static func recordMixedCharge(_ charge: MixedAssetCharge, operation: String) {
        logger.notice(
            "mixed_charge operation=\(operation, privacy: .public) charged_activity_cat_food=\(charge.chargedActivityCatFood.value) charged_gold_coins=\(charge.chargedGoldCoins.value) total_charged=\(charge.totalCharged) gold_coin_balance_after=\(charge.walletBalance.goldCoinBalance.value) activity_cat_food_balance_after=\(charge.walletBalance.activityCatFoodBalance.value) spendable_balance_after=\(charge.walletBalance.spendableBalance)"
        )
    }

    static func recordLiveBilling(
        operation: String,
        chargedActivityCatFood: Int,
        chargedGoldCoins: Int,
        totalCharged: Int,
        goldCoinBalanceAfter: Int,
        activityCatFoodBalanceAfter: Int,
        spendableBalanceAfter: Int
    ) {
        logger.notice(
            "live_billing operation=\(operation, privacy: .public) charged_activity_cat_food=\(chargedActivityCatFood) charged_gold_coins=\(chargedGoldCoins) total_charged=\(totalCharged) gold_coin_balance_after=\(goldCoinBalanceAfter) activity_cat_food_balance_after=\(activityCatFoodBalanceAfter) spendable_balance_after=\(spendableBalanceAfter)"
        )
    }

    static func recordGoldCoinPurchase(productID: String, goldCoinAmount: Int) {
        logger.notice(
            "iap_delivery currency=gold_coin gold_coin_amount=\(goldCoinAmount) product_id=\(productID, privacy: .public)"
        )
    }
}

enum WalletPurchaseOutcome: Equatable {
    case success(coins: Int)
    case pending
    case cancelled
    case deliveryPending
}

enum WalletPurchaseError: LocalizedError {
    case productUnavailable
    case verificationFailed
    case purchaseInProgress

    var errorDescription: String? {
        switch self {
        case .productUnavailable:
            return L10n.tr("wallet.product.configMissing")
        case .verificationFailed:
            return L10n.tr("wallet.purchase.verificationFailed")
        case .purchaseInProgress:
            return L10n.tr("wallet.purchase.inProgress")
        }
    }
}

@MainActor
struct WalletUSDTPayoutAccount: Equatable {
    var network: String = ""
    var address: String = ""

    private static var networkKey: String {
        "bbchat.wallet.usdt.network.\(AuthManager.shared.currentUser?.userID ?? "anonymous")"
    }

    private static var addressKey: String {
        "bbchat.wallet.usdt.address.\(AuthManager.shared.currentUser?.userID ?? "anonymous")"
    }

    init(network: String = "", address: String = "") {
        self.network = Self.normalizedNetwork(network)
        self.address = address.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var isConfigured: Bool {
        !network.isBlank && address.count >= 12
    }

    var displayText: String {
        guard isConfigured else { return L10n.tr("wallet.usdt.unconfigured") }
        let prefix = String(address.prefix(6))
        let suffix = String(address.suffix(6))
        return "\(network)  \(prefix)...\(suffix)"
    }

    var payoutAccountValue: String {
        "\(network):\(address)"
    }

    func save() {
        UserDefaults.standard.set(network, forKey: Self.networkKey)
        UserDefaults.standard.set(address, forKey: Self.addressKey)
    }

    static func load() -> WalletUSDTPayoutAccount {
        WalletUSDTPayoutAccount(
            network: UserDefaults.standard.string(forKey: networkKey) ?? "",
            address: UserDefaults.standard.string(forKey: addressKey) ?? ""
        )
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: networkKey)
        UserDefaults.standard.removeObject(forKey: addressKey)
    }

    private static func normalizedNetwork(_ network: String) -> String {
        let trimmed = network.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.uppercased().hasPrefix("USDT-") else { return trimmed }
        return String(trimmed.dropFirst(5))
    }
}

@MainActor
final class WalletStore: ObservableObject {
    static let shared = WalletStore()

    @Published private(set) var products: [Product] = []
    @Published private(set) var goldCoinBalance: GoldCoinAmount?
    @Published private(set) var activityCatFoodBalance: ActivityCatFoodAmount?
    @Published private(set) var spendableBalance: Int?
    @Published private(set) var walletBalance: WalletBalanceResponseData?
    @Published private(set) var isLoadingBalance = false
    @Published private(set) var isLoadingProducts = false
    @Published private(set) var isLoadingTransactions = false
    @Published private(set) var isLoadingWithdrawals = false
    @Published private(set) var isPurchasing = false
    @Published private(set) var isSubmittingWithdrawal = false
    @Published private(set) var balanceLoadError: String?
    @Published private(set) var productLoadError: String?
    @Published private(set) var transactionLoadError: String?
    @Published private(set) var withdrawalLoadError: String?
    @Published private(set) var transactions: [WalletTransaction] = []
    @Published private(set) var transactionNextCursor: String?
    @Published private(set) var activityCatFoodTransactions: [ActivityCatFoodTransaction] = []
    @Published private(set) var withdrawals: [WalletWithdrawal] = []
    @Published private(set) var isLoadingActivityCatFoodTransactions = false
    @Published private(set) var activityCatFoodTransactionLoadError: String?
    @Published private(set) var activityCatFoodNextCursor: String?
    @Published private(set) var usdtPayoutAccount = WalletUSDTPayoutAccount.load()

    private var updatesTask: Task<Void, Never>?
    private var transactionsUserID: String?
    private var requestedTransactionCursors: Set<String> = []
    private var activityCatFoodTransactionsUserID: String?
    private var activityCatFoodDisabledByServer = false

    private var productIDs: [String] {
        (AppRemoteConfigStore.shared.config.wallet?.effectiveGoldCoinProducts ?? AppConfig.goldCoinProducts)
            .map(\.productID)
    }

    private var coinsByProductID: [String: Int] {
        Dictionary(uniqueKeysWithValues: (AppRemoteConfigStore.shared.config.wallet?.effectiveGoldCoinProducts ?? AppConfig.goldCoinProducts).map {
            ($0.productID, $0.coins)
        })
    }

    private var currentUserID: String {
        AuthManager.shared.currentUser?.userID ?? "anonymous"
    }

    private var balanceKey: String {
        "bbchat.wallet.gold_coin.balance.\(currentUserID)"
    }

    private var processedTransactionsKey: String {
        "bbchat.wallet.gold_coin.processedTransactions.\(currentUserID)"
    }

    private var isReviewScreenshotMode: Bool {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        return arguments.contains("-walletReviewScreenshot")
            || arguments.contains("-walletEarningsReviewScreenshot")
            || arguments.contains("-propBagReviewScreenshot")
        #else
        false
        #endif
    }

    private init() {
        WalletLegacyUserDefaultsMigration.run(userID: currentUserID)
        LocalCache.migrateWalletCurrencySchemaIfNeeded()
        if isReviewScreenshotMode {
            applyServerBalance(WalletBalanceResponseData(
                goldCoinBalance: 85,
                activityCatFoodBalance: 20,
                spendableBalance: 105,
                rechargeGoldCoinBalance: 50,
                giftIncomeGoldCoinBalance: 35,
                withdrawableGoldCoinBalance: 35
            ))
        } else {
            restoreSnapshots()
        }
        updatesTask = Task { [weak self] in
            await self?.syncUnfinishedTransactions()
            await self?.observeTransactionUpdates()
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    func reloadBalance() {
        WalletLegacyUserDefaultsMigration.run(userID: currentUserID)
        guard UserDefaults.standard.object(forKey: balanceKey) != nil else { return }
        // The legacy scalar cache can render the Gold Coin balance only. It
        // must never synthesize activity Cat Food or an authoritative
        // spendable balance; the next wallet sync installs the full snapshot.
        goldCoinBalance = GoldCoinAmount(UserDefaults.standard.integer(forKey: balanceKey))
        walletBalance = nil
        spendableBalance = nil
    }

    func applySpendableBalances(
        goldCoinBalance: Int,
        activityCatFoodBalance: Int,
        spendableBalance: Int
    ) {
        let current = walletBalance
        applyServerBalance(WalletBalanceResponseData(
            goldCoinBalance: goldCoinBalance,
            activityCatFoodBalance: activityCatFoodBalance,
            spendableBalance: spendableBalance,
            rechargeGoldCoinBalance: current?.rechargeGoldCoinBalance.value,
            giftIncomeGoldCoinBalance: current?.giftIncomeGoldCoinBalance.value ?? 0,
            withdrawFrozenGoldCoinBalance: current?.withdrawFrozenGoldCoinBalance.value ?? 0,
            withdrawableGoldCoinBalance: current?.withdrawableGoldCoinBalance.value ?? 0,
            chatMoneyFrozenGoldCoinBalance: current?.chatMoneyFrozenGoldCoinBalance.value ?? 0,
            hasServerActivityCatFoodBalance: true
        ))
    }

    func applyServerBalance(_ serverBalance: WalletBalanceResponseData) {
        walletBalance = serverBalance
        goldCoinBalance = serverBalance.goldCoinBalance
        activityCatFoodBalance = serverBalance.activityCatFoodBalance
        spendableBalance = serverBalance.spendableBalance
        if serverBalance.hasServerActivityCatFoodBalance,
           AppRemoteConfigStore.shared.config.wallet?.effectiveActivityCatFoodEnabled == true {
            activityCatFoodDisabledByServer = false
        }
        balanceLoadError = nil
        UserDefaults.standard.set(serverBalance.goldCoinBalance.value, forKey: balanceKey)
    }

    var hasLoadedWallet: Bool {
        walletBalance != nil || goldCoinBalance != nil
    }

    var canLoadMoreTransactions: Bool {
        transactionNextCursor?.isBlank == false
    }

    var goldCoinBalanceValue: Int? {
        goldCoinBalance?.value
    }

    var activityCatFoodBalanceValue: Int? {
        activityCatFoodBalance?.value
    }

    var isActivityCatFoodEnabled: Bool {
        isReviewScreenshotMode
            || (!activityCatFoodDisabledByServer
            && AppRemoteConfigStore.shared.config.wallet?.effectiveActivityCatFoodEnabled == true
            )
    }

    var rechargeGoldCoinBalance: Int? {
        walletBalance?.rechargeGoldCoinBalance.value
    }

    var earningsGoldCoinBalance: Int {
        walletBalance?.giftIncomeGoldCoinBalance.value ?? 0
    }

    var withdrawableGoldCoinBalanceForAction: Int {
        max(walletBalance?.withdrawableGoldCoinBalance.value ?? 0, 0)
    }

    func withdrawalPolicy(for network: String? = nil) -> WalletWithdrawalPolicy {
        AppRemoteConfigStore.shared.config.wallet?.effectiveWithdrawalPolicy(for: network)
            ?? .fallback
    }

    func usdtAmount(for goldCoinAmount: Int, network: String? = nil) -> Double {
        withdrawalPolicy(for: network).rawUSDTAmount(forGoldCoins: goldCoinAmount)
    }

    func usdtDisplayText(for goldCoinAmount: Int, network: String? = nil) -> String {
        String(format: "%.2f USDT", usdtAmount(for: goldCoinAmount, network: network))
    }

    func saveUSDTPayoutAccount(network: String, address: String) throws {
        let account = WalletUSDTPayoutAccount(network: network, address: address)
        guard account.isConfigured else {
            throw APIError.serverError(code: 400, message: L10n.tr("wallet.usdt.invalid"))
        }
        account.save()
        usdtPayoutAccount = account
    }

    func deleteUSDTPayoutAccount() {
        WalletUSDTPayoutAccount.clear()
        usdtPayoutAccount = WalletUSDTPayoutAccount()
    }

    func refreshBalanceFromServer(forceRefresh: Bool = false) async {
        WalletLegacyUserDefaultsMigration.run(userID: currentUserID)
        if isReviewScreenshotMode {
            balanceLoadError = nil
            return
        }

        guard !isLoadingBalance else { return }
        isLoadingBalance = true
        balanceLoadError = nil
        defer { isLoadingBalance = false }

        guard let key = CacheKey.current(namespace: "wallet", key: "balance") else { return }
        do {
            let serverBalance: WalletBalanceResponseData = try await AppCacheRepository.shared.loadValue(
                key: key,
                policy: .walletBalance,
                forceRefresh: forceRefresh
            ) {
                try await APIService.shared.getWalletBalance()
            }
            applyServerBalance(serverBalance)
        } catch {
            if WalletBusinessError.isActivityCatFoodDisabled(error) {
                activityCatFoodDisabledByServer = true
                activityCatFoodTransactions = []
                activityCatFoodNextCursor = nil
            }
            balanceLoadError = L10n.tr("wallet.balance.loadFailedWithError", error.localizedDescription)
        }
    }

    func loadTransactions(forceRefresh: Bool = false) async {
        if isReviewScreenshotMode {
            transactions = []
            transactionNextCursor = nil
            transactionLoadError = nil
            return
        }

        let userID = currentUserID
        prepareTransactionHistory(for: userID)
        guard !isLoadingTransactions else { return }
        isLoadingTransactions = true
        transactionLoadError = nil
        defer { isLoadingTransactions = false }

        guard let key = CacheKey.current(namespace: "wallet", key: "transaction-history-v2") else { return }
        let result: CacheResult<WalletTransactionsResponseData> = await AppCacheRepository.shared.load(
            key: key,
            policy: .list,
            forceRefresh: forceRefresh
        ) {
            try await APIService.shared.getWalletTransactionPage()
        }
        guard !Task.isCancelled, currentUserID == userID else { return }

        switch result {
        case .cache(let page, _), .staleCache(let page, _):
            applyInitialTransactionPage(page)
        case .remote(let page):
            applyInitialTransactionPage(page)
            persistTransactionHistory()
        case .failure(let error):
            transactionLoadError = L10n.tr("wallet.transactions.loadFailedWithError", error.localizedDescription)
        }
    }

    func loadMoreTransactions() async {
        guard !isReviewScreenshotMode,
              let cursor = transactionNextCursor,
              !cursor.isBlank,
              !requestedTransactionCursors.contains(cursor),
              !isLoadingTransactions else { return }

        let userID = currentUserID
        requestedTransactionCursors.insert(cursor)
        isLoadingTransactions = true
        transactionLoadError = nil
        defer { isLoadingTransactions = false }

        do {
            let page = try await APIService.shared.getWalletTransactionPage(cursor: cursor)
            guard !Task.isCancelled, currentUserID == userID else { return }

            transactions = Self.deduplicatedTransactions(transactions + page.transactions)
            let nextCursor = page.nextCursor?.isBlank == false ? page.nextCursor : nil
            transactionNextCursor = nextCursor == cursor || requestedTransactionCursors.contains(nextCursor ?? "")
                ? nil
                : nextCursor
            persistTransactionHistory()
        } catch is CancellationError {
            requestedTransactionCursors.remove(cursor)
        } catch {
            requestedTransactionCursors.remove(cursor)
            transactionLoadError = L10n.tr("wallet.transactions.loadFailedWithError", error.localizedDescription)
        }
    }

    private func prepareTransactionHistory(for userID: String) {
        guard transactionsUserID != userID else { return }
        transactions = []
        transactionNextCursor = nil
        transactionLoadError = nil
        requestedTransactionCursors.removeAll()
        transactionsUserID = userID

        if let key = CacheKey.current(namespace: "wallet", key: "transaction-history-v2"),
           let cached: CachedSnapshot<WalletTransactionsResponseData> = AppCacheRepository.shared.cachedValue(for: key) {
            transactions = cached.value.transactions
            transactionNextCursor = cached.value.nextCursor
        } else if let key = CacheKey.current(namespace: "wallet", key: "transactions"),
                  let cached: CachedSnapshot<[WalletTransaction]> = AppCacheRepository.shared.cachedValue(for: key) {
            transactions = cached.value
        }
    }

    private func applyInitialTransactionPage(_ page: WalletTransactionsResponseData) {
        requestedTransactionCursors.removeAll()
        transactions = Self.deduplicatedTransactions(page.transactions + transactions)
        transactionNextCursor = page.nextCursor
        transactionLoadError = nil
    }

    private func persistTransactionHistory() {
        guard let key = CacheKey.current(namespace: "wallet", key: "transaction-history-v2") else { return }
        AppCacheRepository.shared.save(
            WalletTransactionsResponseData(
                transactions: transactions,
                nextCursor: transactionNextCursor
            ),
            for: key,
            policy: .list
        )
    }

    private static func deduplicatedTransactions(
        _ transactions: [WalletTransaction]
    ) -> [WalletTransaction] {
        var seenIDs: Set<String> = []
        return transactions.filter { seenIDs.insert($0.id).inserted }
    }

    func loadActivityCatFoodTransactions(reset: Bool = true) async {
        guard isActivityCatFoodEnabled else { return }
        let userID = currentUserID
        if activityCatFoodTransactionsUserID != userID {
            activityCatFoodTransactions = []
            activityCatFoodNextCursor = nil
            activityCatFoodTransactionsUserID = userID
        }
        guard !isLoadingActivityCatFoodTransactions else { return }
        if !reset, activityCatFoodNextCursor == nil { return }

        isLoadingActivityCatFoodTransactions = true
        if reset { activityCatFoodTransactionLoadError = nil }
        defer { isLoadingActivityCatFoodTransactions = false }

        do {
            let page = try await APIService.shared.getActivityCatFoodTransactions(
                cursor: reset ? nil : activityCatFoodNextCursor
            )
            guard !Task.isCancelled, currentUserID == userID else { return }
            if reset {
                activityCatFoodTransactions = page.items
            } else {
                let existingIDs = Set(activityCatFoodTransactions.map(\.id))
                activityCatFoodTransactions.append(contentsOf: page.items.filter { !existingIDs.contains($0.id) })
            }
            activityCatFoodNextCursor = page.nextCursor
            activityCatFoodTransactionLoadError = nil
            activityCatFoodTransactionsUserID = userID
        } catch is CancellationError {
            return
        } catch {
            if WalletBusinessError.isActivityCatFoodDisabled(error) {
                activityCatFoodDisabledByServer = true
                activityCatFoodTransactions = []
                activityCatFoodNextCursor = nil
                return
            }
            activityCatFoodTransactionLoadError = error.localizedDescription
        }
    }

    func loadWithdrawals(forceRefresh: Bool = false) async {
        if isReviewScreenshotMode {
            withdrawals = []
            withdrawalLoadError = nil
            return
        }

        guard !isLoadingWithdrawals else { return }
        isLoadingWithdrawals = true
        withdrawalLoadError = nil
        defer { isLoadingWithdrawals = false }

        guard let key = CacheKey.current(namespace: "wallet", key: "withdrawals") else { return }
        do {
            withdrawals = Array(try await AppCacheRepository.shared.loadValue(
                key: key,
                policy: .list,
                forceRefresh: forceRefresh
            ) {
                try await APIService.shared.getWalletWithdrawals()
            }.prefix(500))
        } catch let error where isMissingWithdrawalEndpoint(error) {
            withdrawals = []
            withdrawalLoadError = L10n.tr("wallet.withdrawal.serviceUnavailable")
        } catch {
            withdrawalLoadError = L10n.tr("wallet.withdrawals.loadFailedWithError", error.localizedDescription)
        }
    }

    private func restoreSnapshots() {
        if let key = CacheKey.current(namespace: "wallet", key: "balance"),
           let cached: CachedSnapshot<WalletBalanceResponseData> = AppCacheRepository.shared.cachedValue(for: key) {
            applyServerBalance(cached.value)
        } else {
            reloadBalance()
        }
        transactionsUserID = currentUserID
        if let key = CacheKey.current(namespace: "wallet", key: "transaction-history-v2"),
           let cached: CachedSnapshot<WalletTransactionsResponseData> = AppCacheRepository.shared.cachedValue(for: key) {
            transactions = cached.value.transactions
            transactionNextCursor = cached.value.nextCursor
        } else if let key = CacheKey.current(namespace: "wallet", key: "transactions"),
                  let cached: CachedSnapshot<[WalletTransaction]> = AppCacheRepository.shared.cachedValue(for: key) {
            transactions = cached.value
        }
        if let key = CacheKey.current(namespace: "wallet", key: "withdrawals"),
           let cached: CachedSnapshot<[WalletWithdrawal]> = AppCacheRepository.shared.cachedValue(for: key) {
            withdrawals = cached.value
        }
    }

    func requestWithdrawal(
        amount: Int,
        usdtAmount: String,
        network: String,
        walletAddress: String
    ) async throws {
        guard amount > 0 else {
            throw APIError.serverError(code: 400, message: L10n.tr("wallet.withdrawal.amount.invalid"))
        }
        guard amount <= withdrawableGoldCoinBalanceForAction else {
            throw APIError.serverError(code: 400, message: L10n.tr("wallet.withdrawal.amount.insufficientGoldCoins"))
        }
        let policy = withdrawalPolicy(for: network)
        guard let requestedUSDT = Double(usdtAmount),
              requestedUSDT + 0.000_000_1 >= policy.minimumUSDT,
              policy.isValidUSDTIncrement(requestedUSDT),
              requestedUSDT <= policy.maximumUSDTAmount(forGoldCoins: withdrawableGoldCoinBalanceForAction) + 0.000_000_1,
              amount == policy.requiredGoldCoins(forUSDT: requestedUSDT) else {
            throw APIError.serverError(code: 400, message: L10n.tr("wallet.withdrawal.amount.invalid"))
        }
        let payoutAccount = WalletUSDTPayoutAccount(network: network, address: walletAddress)
        guard payoutAccount.isConfigured else {
            throw APIError.serverError(code: 400, message: L10n.tr("wallet.withdrawal.usdt.required"))
        }
        guard !isSubmittingWithdrawal else { return }

        isSubmittingWithdrawal = true
        withdrawalLoadError = nil
        defer { isSubmittingWithdrawal = false }

        do {
            _ = try await APIService.shared.createWalletWithdrawal(
                goldCoinAmount: amount,
                usdtAmount: usdtAmount,
                payoutMethod: "usdt",
                payoutAccount: payoutAccount.payoutAccountValue,
                network: payoutAccount.network,
                walletAddress: payoutAccount.address
            )
        } catch let error where isMissingWithdrawalEndpoint(error) {
            throw APIError.serverError(code: 404, message: L10n.tr("wallet.withdrawal.serviceUnavailable"))
        } catch let error as APIError {
            throw localizedWithdrawalError(error) ?? error
        }
        await refreshBalanceFromServer()
        await loadWithdrawals()
    }

    func cancelWithdrawal(_ withdrawal: WalletWithdrawal) async throws {
        guard !isSubmittingWithdrawal else { return }

        isSubmittingWithdrawal = true
        withdrawalLoadError = nil
        defer { isSubmittingWithdrawal = false }

        do {
            _ = try await APIService.shared.cancelWalletWithdrawal(id: withdrawal.id)
        } catch let error where isMissingWithdrawalEndpoint(error) {
            throw APIError.serverError(code: 404, message: L10n.tr("wallet.withdrawal.serviceUnavailable"))
        }
        await refreshBalanceFromServer()
        await loadWithdrawals()
    }

    private func isMissingWithdrawalEndpoint(_ error: Error) -> Bool {
        guard case APIError.serverError(let code, _) = error else { return false }
        return code == 404
    }

    private func localizedWithdrawalError(_ error: APIError) -> APIError? {
        guard case APIError.serverError(let code, let message) = error else { return nil }
        let parsedError = parsedWithdrawalError(from: message)
        let normalized = (parsedError.code ?? message)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        let localizedMessage: String?
        switch normalized {
        case "invalid_withdrawal_amount":
            localizedMessage = L10n.tr("wallet.withdrawal.amount.invalid")
        case "insufficient_gold_coins", "insufficient_withdrawable_gold_coin_balance":
            localizedMessage = L10n.tr("wallet.withdrawal.amount.insufficientGoldCoins")
        case "usdt_account_required", "payout_account_required":
            localizedMessage = L10n.tr("wallet.withdrawal.usdt.required")
        case "invalid_usdt_account", "invalid_payout_account":
            localizedMessage = L10n.tr("wallet.usdt.invalid")
        default:
            localizedMessage = nil
        }

        if let localizedMessage {
            return APIError.serverError(code: code, message: localizedMessage)
        }

        if let parsedMessage = parsedError.message,
           !parsedMessage.isBlank {
            return APIError.serverError(code: code, message: parsedMessage)
        }

        return nil
    }

    private func parsedWithdrawalError(from rawMessage: String) -> (code: String?, message: String?) {
        let trimmed = rawMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{"),
              let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return (nil, nil)
        }

        let code = (object["code"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let message = (object["message"] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (
            code?.isBlank == false ? code : nil,
            message?.isBlank == false ? message : nil
        )
    }

    func loadProducts(force: Bool = false) async {
        if isReviewScreenshotMode {
            productLoadError = nil
            return
        }

        let ids = productIDs
        let loadedIDs = Set(products.map(\.id))
        guard force || !ids.allSatisfy({ loadedIDs.contains($0) }) else { return }
        guard !isLoadingProducts else { return }

        isLoadingProducts = true
        productLoadError = nil
        defer { isLoadingProducts = false }

        do {
            let fetched = try await Product.products(for: ids)
            let order = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($0.element, $0.offset) })
            products = fetched.sorted {
                (order[$0.id] ?? Int.max) < (order[$1.id] ?? Int.max)
            }
            if products.isEmpty {
                productLoadError = L10n.tr("wallet.product.configMissing")
            }
        } catch {
            productLoadError = L10n.tr("wallet.products.loadFailedWithError", error.localizedDescription)
        }
    }

    func product(for package: GoldCoinProductConfig) -> Product? {
        products.first { $0.id == package.productID }
    }

    func isProductAvailable(for package: GoldCoinProductConfig) -> Bool {
        isReviewScreenshotMode || product(for: package) != nil
    }

    func displayPrice(for package: GoldCoinProductConfig) -> String {
        product(for: package)?.displayPrice ?? package.fallbackPriceUSD
    }

    func purchase(_ package: GoldCoinProductConfig) async throws -> WalletPurchaseOutcome {
        guard !isPurchasing else { throw WalletPurchaseError.purchaseInProgress }
        guard let product = product(for: package) else { throw WalletPurchaseError.productUnavailable }

        isPurchasing = true
        defer { isPurchasing = false }

        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            let transaction = try checkVerified(verification)
            do {
                let confirmedCoins = try await confirmAndFinish(
                    transaction: transaction,
                    signedPayload: verification.jwsRepresentation,
                    expectedPackage: package
                )
                return .success(coins: confirmedCoins)
            } catch {
                print("[WalletStore] IAP server confirmation failed for transaction \(transaction.id): \(error)")
                await refreshBalanceFromServer()
                return .deliveryPending
            }
        case .pending:
            return .pending
        case .userCancelled:
            return .cancelled
        @unknown default:
            return .cancelled
        }
    }

    private func syncUnfinishedTransactions() async {
        for await result in Transaction.unfinished {
            do {
                let transaction = try checkVerified(result)
                _ = try await confirmAndFinish(
                    transaction: transaction,
                    signedPayload: result.jwsRepresentation
                )
            } catch {
                print("[WalletStore] Unfinished transaction confirmation deferred: \(error)")
            }
        }
    }

    private func observeTransactionUpdates() async {
        for await result in Transaction.updates {
            do {
                let transaction = try checkVerified(result)
                _ = try await confirmAndFinish(
                    transaction: transaction,
                    signedPayload: result.jwsRepresentation
                )
            } catch {
                print("[WalletStore] Transaction update ignored: \(error)")
            }
        }
    }

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .verified(let value):
            return value
        case .unverified:
            throw WalletPurchaseError.verificationFailed
        }
    }

    @discardableResult
    private func confirmAndFinish(
        transaction: Transaction,
        signedPayload: String,
        expectedPackage: GoldCoinProductConfig? = nil
    ) async throws -> Int {
        let confirmed: WalletIAPConfirmationResponseData
        do {
            confirmed = try await APIService.shared.confirmWalletIAPPurchase(
                productID: transaction.productID,
                transactionID: String(transaction.id),
                originalTransactionID: String(transaction.originalID),
                signedPayload: signedPayload,
                purchaseDate: transaction.purchaseDate,
                appAccountToken: transaction.appAccountToken?.uuidString
            )
        } catch let error where isAlreadyConfirmedPurchase(error) {
            await refreshBalanceFromServer()
            await loadTransactions()
            await transaction.finish()
            return 0
        }

        if let confirmedBalance = confirmed.balance {
            applyServerBalance(confirmedBalance)
        } else {
            await refreshBalanceFromServer()
        }
        await loadTransactions()
        await transaction.finish()

        let deliveredGoldCoins = confirmed.goldCoinAmount
            ?? coinsByProductID[transaction.productID]
            ?? expectedPackage?.coins
            ?? 0
        WalletTelemetry.recordGoldCoinPurchase(
            productID: transaction.productID,
            goldCoinAmount: deliveredGoldCoins
        )
        return deliveredGoldCoins
    }

    private func isAlreadyConfirmedPurchase(_ error: Error) -> Bool {
        guard case APIError.serverError(let code, let message) = error else { return false }
        return code == 409 || message.localizedCaseInsensitiveContains("already")
    }
}
