// BWChat/Services/WalletStore.swift
// StoreKit-backed wallet for consumable cat-food purchases and withdrawals.

import Foundation
import StoreKit

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
    @Published private(set) var balance: Int?
    @Published private(set) var balanceDetail: WalletBalanceResponseData?
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
    @Published private(set) var withdrawals: [WalletWithdrawal] = []
    @Published private(set) var usdtPayoutAccount = WalletUSDTPayoutAccount.load()

    private var updatesTask: Task<Void, Never>?

    private var productIDs: [String] {
        AppConfig.catFoodProducts.map(\.productID)
    }

    private var coinsByProductID: [String: Int] {
        Dictionary(uniqueKeysWithValues: AppConfig.catFoodProducts.map { ($0.productID, $0.coins) })
    }

    private var currentUserID: String {
        AuthManager.shared.currentUser?.userID ?? "anonymous"
    }

    private var balanceKey: String {
        "bbchat.wallet.catfood.balance.\(currentUserID)"
    }

    private var processedTransactionsKey: String {
        "bbchat.wallet.catfood.processedTransactions.\(currentUserID)"
    }

    private var isReviewScreenshotMode: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-walletReviewScreenshot")
        #else
        false
        #endif
    }

    private init() {
        if isReviewScreenshotMode {
            applyServerBalance(0)
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
        guard UserDefaults.standard.object(forKey: balanceKey) != nil else { return }
        applyServerBalance(UserDefaults.standard.integer(forKey: balanceKey))
    }

    func applyServerBalance(_ serverBalance: Int) {
        applyServerBalance(WalletBalanceResponseData(balance: serverBalance))
    }

    func applyServerBalance(_ serverBalance: WalletBalanceResponseData) {
        balanceDetail = serverBalance
        balance = serverBalance.balance
        balanceLoadError = nil
        UserDefaults.standard.set(serverBalance.balance, forKey: balanceKey)
    }

    var totalBalance: Int? {
        balanceDetail?.totalBalance ?? balance
    }

    var rechargeClaimBalance: Int? {
        balanceDetail?.rechargeClaimBalance ?? balance
    }

    var earningsCatFoodBalance: Int {
        totalBalance ?? balance ?? 0
    }

    var withdrawableCatFoodBalanceForAction: Int {
        guard balanceDetail != nil || balance != nil else { return 0 }
        return max(earningsCatFoodBalance, 0)
    }

    static let usdtPerCatFood: Double = 0.005

    func usdtAmount(for catFoodAmount: Int) -> Double {
        Double(max(catFoodAmount, 0)) * Self.usdtPerCatFood
    }

    func usdtDisplayText(for catFoodAmount: Int) -> String {
        String(format: "%.2f USDT", usdtAmount(for: catFoodAmount))
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

    func refreshBalanceFromServer() async {
        if isReviewScreenshotMode {
            balance = balance ?? 0
            balanceLoadError = nil
            return
        }

        guard !isLoadingBalance else { return }
        isLoadingBalance = true
        balanceLoadError = nil
        defer { isLoadingBalance = false }

        do {
            let serverBalance = try await APIService.shared.getWalletBalance()
            applyServerBalance(serverBalance)
        } catch {
            balanceLoadError = L10n.tr("wallet.balance.loadFailedWithError", error.localizedDescription)
        }
    }

    func loadTransactions() async {
        if isReviewScreenshotMode {
            transactions = []
            transactionLoadError = nil
            return
        }

        guard !isLoadingTransactions else { return }
        isLoadingTransactions = true
        transactionLoadError = nil
        defer { isLoadingTransactions = false }

        do {
            transactions = try await APIService.shared.getWalletTransactions()
        } catch {
            transactionLoadError = L10n.tr("wallet.transactions.loadFailedWithError", error.localizedDescription)
        }
    }

    func loadWithdrawals() async {
        if isReviewScreenshotMode {
            withdrawals = []
            withdrawalLoadError = nil
            return
        }

        guard !isLoadingWithdrawals else { return }
        isLoadingWithdrawals = true
        withdrawalLoadError = nil
        defer { isLoadingWithdrawals = false }

        do {
            withdrawals = try await APIService.shared.getWalletWithdrawals()
        } catch let error where isMissingWithdrawalEndpoint(error) {
            withdrawals = []
            withdrawalLoadError = L10n.tr("wallet.withdrawal.serviceUnavailable")
        } catch {
            withdrawalLoadError = L10n.tr("wallet.withdrawals.loadFailedWithError", error.localizedDescription)
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
        guard amount <= withdrawableCatFoodBalanceForAction else {
            throw APIError.serverError(code: 400, message: L10n.tr("wallet.withdrawal.amount.insufficientCatFood"))
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
                amount: amount,
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
        case "insufficient_withdrawable_cat_food_balance",
             "insufficient_withdrawable_balance",
             "insufficient_withdrawable_cat_hair_balance":
            localizedMessage = L10n.tr("wallet.withdrawal.amount.insufficientCatFood")
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

        guard force || products.isEmpty else { return }
        guard !isLoadingProducts else { return }

        isLoadingProducts = true
        productLoadError = nil
        defer { isLoadingProducts = false }

        do {
            let fetched = try await Product.products(for: productIDs)
            let order = Dictionary(uniqueKeysWithValues: productIDs.enumerated().map { ($0.element, $0.offset) })
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

    func product(for package: CatFoodProductConfig) -> Product? {
        products.first { $0.id == package.productID }
    }

    func isProductAvailable(for package: CatFoodProductConfig) -> Bool {
        isReviewScreenshotMode || product(for: package) != nil
    }

    func displayPrice(for package: CatFoodProductConfig) -> String {
        product(for: package)?.displayPrice ?? package.fallbackPriceUSD
    }

    func purchase(_ package: CatFoodProductConfig) async throws -> WalletPurchaseOutcome {
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
        expectedPackage: CatFoodProductConfig? = nil
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

        return confirmed.coins
            ?? coinsByProductID[transaction.productID]
            ?? expectedPackage?.coins
            ?? 0
    }

    private func isAlreadyConfirmedPurchase(_ error: Error) -> Bool {
        guard case APIError.serverError(let code, let message) = error else { return false }
        return code == 409 || message.localizedCaseInsensitiveContains("already")
    }
}
