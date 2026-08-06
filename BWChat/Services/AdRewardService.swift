import Foundation
import GoogleMobileAds
import OSLog
import UIKit
import UserMessagingPlatform

private let adMobRuntimeLogger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "BWChat",
    category: "AdMobRuntime"
)

enum AdMobConfiguration {
    static let dailyRewardedAdLimit = 10
    static let productionRewardedAdUnitID = "ca-app-pub-1877504503518465/1011630693"
    static let testRewardedAdUnitID = "ca-app-pub-3940256099942544/1712485313"

    static var initialServerDeliveryEnabled: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }

    static var rewardedAdUnitID: String {
        #if DEBUG
        testRewardedAdUnitID
        #else
        productionRewardedAdUnitID
        #endif
    }

    static var bundledGameRewardedAdUnitIDs: [String] {
        #if DEBUG
        return [testRewardedAdUnitID, productionRewardedAdUnitID]
        #else
        return [productionRewardedAdUnitID]
        #endif
    }

    static var applicationIdentifierIsValid: Bool {
        guard let value = Bundle.main.object(
            forInfoDictionaryKey: "GADApplicationIdentifier"
        ) as? String else {
            return false
        }
        let components = value.split(separator: "~", omittingEmptySubsequences: false)
        guard components.count == 2,
              components[0].hasPrefix("ca-app-pub-"),
              !components[1].isEmpty,
              !value.contains("/") else {
            return false
        }
        return components[0].dropFirst("ca-app-pub-".count).allSatisfy(\.isNumber)
            && components[1].allSatisfy(\.isNumber)
    }

    @MainActor
    static var currentWalletRewardedAdUnitID: String {
        let remote = AppRemoteConfigStore.shared.config.wallet?.adReward
        return RewardedAdUnitResolver.walletAdUnitID(
            preferredID: remote?.iosWalletAdUnitID,
            configuredIDs: remote?.iosAdUnitIDs,
            fallbackID: productionRewardedAdUnitID
        )
    }
}

enum RewardedAdUnitResolver {
    static func walletAdUnitID(
        preferredID: String?,
        configuredIDs: [String]?,
        fallbackID: String
    ) -> String {
        // Google's demo rewarded unit is intentionally not associated with the
        // BWChat AdMob account, so it cannot participate in BWChat's SSV wallet
        // credit flow. Simulators are already test devices and can safely use
        // the account-owned wallet unit while still receiving test creatives.
        let configured = normalizedIDs(configuredIDs).filter(isWalletCreditEligible)
        if let preferred = normalizedID(preferredID),
           isWalletCreditEligible(preferred),
           configured.isEmpty || configured.contains(preferred) {
            return preferred
        }
        return configured.first ?? fallbackID
    }

    private static func isWalletCreditEligible(_ adUnitID: String) -> Bool {
        adUnitID != AdMobConfiguration.testRewardedAdUnitID
    }

    static func normalizedIDs(_ values: [String]?) -> [String] {
        var seen = Set<String>()
        return (values ?? []).compactMap { value in
            guard let normalized = normalizedID(value),
                  seen.insert(normalized).inserted else {
                return nil
            }
            return normalized
        }
    }

    private static func normalizedID(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              value.count <= 128 else {
            return nil
        }
        let parts = value.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }
        let prefix = "ca-app-pub-"
        guard parts[0].hasPrefix(prefix) else { return nil }
        let publisherID = parts[0].dropFirst(prefix.count)
        guard !publisherID.isEmpty,
              !parts[1].isEmpty,
              publisherID.allSatisfy(\.isNumber),
              parts[1].allSatisfy(\.isNumber) else {
            return nil
        }
        return value
    }
}

struct WalletAdRewardStatusResponseData: Decodable, Equatable {
    let enabled: Bool
    let dailyLimit: Int
    let watchedCount: Int
    let remainingCount: Int
    let nextResetAt: String

    enum CodingKeys: String, CodingKey {
        case enabled
        case dailyLimit = "daily_limit"
        case watchedCount = "watched_count"
        case remainingCount = "remaining_count"
        case nextResetAt = "next_reset_at"
    }
}

struct WalletAdRewardSessionResponseData: Decodable, Equatable {
    let sessionID: String
    let ssvCustomData: String
    let remainingCount: Int
    let expiresAt: String?
    let nextResetAt: String

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case ssvCustomData = "ssv_custom_data"
        case remainingCount = "remaining_count"
        case expiresAt = "expires_at"
        case nextResetAt = "next_reset_at"
    }
}

/// Device-side fallback for the daily rewarded-ad allowance.
/// The backend remains authoritative so the limit cannot be bypassed by reinstalling
/// the app, changing UserDefaults, or switching devices.
struct AdRewardDailyCounter {
    let defaults: UserDefaults
    let calendar: Calendar
    let dailyLimit: Int
    let now: () -> Date

    init(
        defaults: UserDefaults = .standard,
        calendar: Calendar = AdRewardDailyCounter.defaultCalendar,
        dailyLimit: Int = AdMobConfiguration.dailyRewardedAdLimit,
        now: @escaping () -> Date = Date.init
    ) {
        self.defaults = defaults
        self.calendar = calendar
        self.dailyLimit = dailyLimit
        self.now = now
    }

    func remainingViews(for userID: String?) -> Int {
        guard let userID = normalizedUserID(userID) else { return 0 }
        let currentDay = dayIdentifier(for: now())
        guard defaults.string(forKey: dayKey(for: userID)) == currentDay else {
            defaults.set(currentDay, forKey: dayKey(for: userID))
            defaults.set(0, forKey: watchedKey(for: userID))
            return dailyLimit
        }

        let watchedCount = min(max(defaults.integer(forKey: watchedKey(for: userID)), 0), dailyLimit)
        return dailyLimit - watchedCount
    }

    @discardableResult
    func recordCompletedView(for userID: String?) -> Int {
        guard let userID = normalizedUserID(userID) else { return 0 }
        let remaining = remainingViews(for: userID)
        guard remaining > 0 else { return 0 }

        let watchedCount = dailyLimit - remaining + 1
        defaults.set(dayIdentifier(for: now()), forKey: dayKey(for: userID))
        defaults.set(watchedCount, forKey: watchedKey(for: userID))
        return dailyLimit - watchedCount
    }

    func nextResetDate() -> Date? {
        let startOfToday = calendar.startOfDay(for: now())
        return calendar.date(byAdding: .day, value: 1, to: startOfToday)
    }

    private func normalizedUserID(_ userID: String?) -> String? {
        guard let userID = userID?.trimmingCharacters(in: .whitespacesAndNewlines),
              !userID.isEmpty else {
            return nil
        }
        return userID
    }

    private func dayIdentifier(for date: Date) -> String {
        let components = calendar.dateComponents([.era, .year, .month, .day], from: date)
        return "\(components.era ?? 0)-\(components.year ?? 0)-\(components.month ?? 0)-\(components.day ?? 0)"
    }

    private func dayKey(for userID: String) -> String {
        "\(namespace(for: userID)).day"
    }

    private func watchedKey(for userID: String) -> String {
        "\(namespace(for: userID)).watched"
    }

    private func namespace(for userID: String) -> String {
        "bbchat.adReward.daily.\(userID)"
    }

    private static var defaultCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")
            ?? TimeZone(secondsFromGMT: 8 * 60 * 60)
            ?? .gmt
        return calendar
    }
}

struct AdRewardPendingCredit: Codable, Equatable {
    let userID: String
    let remainingCountBeforeReward: Int
    let businessDayResetAt: Date
    let sessionExpiresAt: Date

    func isResolved(
        currentUserID: String?,
        serverRemainingCount: Int?,
        now: Date = Date()
    ) -> Bool {
        guard currentUserID == userID else { return true }
        if now >= sessionExpiresAt { return true }

        // Once the business day rolls over, the status endpoint reports the new
        // day's counter and can no longer prove that this prior-day session was
        // credited. Keep it pending until its own TTL expires.
        guard now < businessDayResetAt, let serverRemainingCount else {
            return false
        }
        return serverRemainingCount < remainingCountBeforeReward
    }

    func isServerCreditConfirmed(
        currentUserID: String?,
        serverRemainingCount: Int?,
        now: Date = Date()
    ) -> Bool {
        guard currentUserID == userID,
              now < sessionExpiresAt,
              now < businessDayResetAt,
              let serverRemainingCount else {
            return false
        }
        return serverRemainingCount < remainingCountBeforeReward
    }
}

struct AdRewardPendingCreditStore {
    let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func pendingCredit(for userID: String) -> AdRewardPendingCredit? {
        guard let data = defaults.data(forKey: key(for: userID)) else { return nil }
        return try? JSONDecoder().decode(AdRewardPendingCredit.self, from: data)
    }

    func save(_ pendingCredit: AdRewardPendingCredit) {
        guard let data = try? JSONEncoder().encode(pendingCredit) else { return }
        defaults.set(data, forKey: key(for: pendingCredit.userID))
    }

    func remove(for userID: String) {
        defaults.removeObject(forKey: key(for: userID))
    }

    private func key(for userID: String) -> String {
        "bbchat.adReward.pendingCredit.\(userID)"
    }
}

@MainActor
final class AdMobConsentManager {
    static let shared = AdMobConsentManager()

    private var didStartSDK = false
    private var preparationTask: Task<Bool, Never>?

    private init() {}

    var isSDKInitialized: Bool {
        didStartSDK
    }

    func prepareForAds() async -> Bool {
        if didStartSDK {
            return true
        }
        guard AdMobConfiguration.applicationIdentifierIsValid else {
            adMobRuntimeLogger.fault(
                "sdk_initialization_blocked reason=missing_or_invalid_gad_application_identifier"
            )
            return false
        }
        if let preparationTask {
            return await preparationTask.value
        }

        let task = Task { @MainActor [weak self] in
            await self?.performPreparation() ?? false
        }
        preparationTask = task
        let result = await task.value
        preparationTask = nil
        return result
    }

    private func performPreparation() async -> Bool {
        let parameters = RequestParameters()
        await withCheckedContinuation { continuation in
            ConsentInformation.shared.requestConsentInfoUpdate(with: parameters) { error in
                if let error {
                    adMobRuntimeLogger.error(
                        "consent_info_update_failed domain=\((error as NSError).domain, privacy: .public) code=\((error as NSError).code)"
                    )
                }
                continuation.resume()
            }
        }

        do {
            try await ConsentForm.loadAndPresentIfRequired(from: nil)
        } catch {
            let sdkError = error as NSError
            adMobRuntimeLogger.error(
                "consent_form_failed domain=\(sdkError.domain, privacy: .public) code=\(sdkError.code)"
            )
        }

        guard ConsentInformation.shared.canRequestAds else {
            adMobRuntimeLogger.notice("sdk_initialization_deferred reason=consent_unavailable")
            return false
        }

        await MobileAds.shared.start()
        didStartSDK = true
        adMobRuntimeLogger.notice("sdk_initialized")
        return true
    }
}

@MainActor
enum AdMobRuntime {
    static var isInitialized: Bool {
        AdMobConsentManager.shared.isSDKInitialized
    }

    @discardableResult
    static func initializeAtAppLaunch() async -> Bool {
        await AdMobConsentManager.shared.prepareForAds()
    }
}

enum GameRewardedAdPresentationOutcome: Equatable {
    case completed
    case dismissed
    case failed(errorCode: String)
    case unavailable(errorCode: String)
}

@MainActor
protocol GameRewardedAdPresenting: AnyObject {
    func preloadGameRewardedAds(adUnitIDs: [String]) async

    func presentGameRewardedAd(
        request: GameRewardedAdRequest
    ) async -> GameRewardedAdPresentationOutcome
}

extension GameRewardedAdPresenting {
    func preloadGameRewardedAds(adUnitIDs: [String]) async { }
}

/// One process-wide presentation owner shared by wallet and game ad entry points.
@MainActor
final class RewardedAdPresentationGate {
    static let shared = RewardedAdPresentationGate()

    private var owner: String?

    func acquire(owner: String) -> Bool {
        guard self.owner == nil else { return false }
        self.owner = owner
        return true
    }

    func release(owner: String) {
        guard self.owner == owner else { return }
        self.owner = nil
    }
}

/// Generic coordinator for every hosted H5 game. It intentionally has no
/// knowledge of a game ID, source slug, placement, wallet reward, or other
/// business rule. A completed result only lets H5 continue its server-verified
/// game-effect claim (for example, revive).
@MainActor
final class RewardedAdCoordinator {
    static let shared = RewardedAdCoordinator(presenter: AdRewardService())

    private let presenter: GameRewardedAdPresenting
    private var activeRequestID: String?

    init(presenter: GameRewardedAdPresenting) {
        self.presenter = presenter
    }

    func preload(adUnitIDs: [String]) async {
        await presenter.preloadGameRewardedAds(adUnitIDs: adUnitIDs)
    }

    func present(request: GameRewardedAdRequest) async -> GameRewardedAdResult {
        guard activeRequestID == nil else {
            return GameRewardedAdResult(
                requestID: request.requestID,
                sessionID: request.sessionID,
                status: .unavailable,
                errorCode: GameRewardedAdErrorCode.alreadyShowing
            )
        }

        activeRequestID = request.requestID
        defer { activeRequestID = nil }

        let outcome = await presenter.presentGameRewardedAd(request: request)
        switch outcome {
        case .completed:
            return GameRewardedAdResult(
                requestID: request.requestID,
                sessionID: request.sessionID,
                status: .completed
            )
        case .dismissed:
            return GameRewardedAdResult(
                requestID: request.requestID,
                sessionID: request.sessionID,
                status: .dismissed
            )
        case .failed(let errorCode):
            return GameRewardedAdResult(
                requestID: request.requestID,
                sessionID: request.sessionID,
                status: .failed,
                errorCode: errorCode
            )
        case .unavailable(let errorCode):
            return GameRewardedAdResult(
                requestID: request.requestID,
                sessionID: request.sessionID,
                status: .unavailable,
                errorCode: errorCode
            )
        }
    }
}

enum AdMobGameErrorMapper {
    static func presentationOutcome(
        forLoadError error: NSError?
    ) -> GameRewardedAdPresentationOutcome {
        if error?.domain == GADErrorDomain, error?.code == 1 {
            return .unavailable(errorCode: GameRewardedAdErrorCode.noFill)
        }
        return .failed(errorCode: GameRewardedAdErrorCode.loadFailed)
    }
}

@MainActor
enum RewardedAdPresenterResolver {
    static func visiblePresenter() -> UIViewController? {
        visiblePresenter(application: UIApplication.shared)
    }

    static func visiblePresenter(application: UIApplication) -> UIViewController? {
        let windowScenes = application.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }
        let window = windowScenes
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
            ?? windowScenes.flatMap(\.windows).first(where: { !$0.isHidden })
        guard let root = window?.rootViewController else { return nil }
        let presenter = visibleContentController(from: root)
        guard !presenter.isBeingDismissed,
              presenter.viewIfLoaded?.window != nil else {
            return nil
        }
        return presenter
    }

    private static func visibleContentController(
        from controller: UIViewController
    ) -> UIViewController {
        if let presented = controller.presentedViewController,
           !presented.isBeingDismissed {
            return visibleContentController(from: presented)
        }
        if let navigation = controller as? UINavigationController,
           let visible = navigation.visibleViewController {
            return visibleContentController(from: visible)
        }
        if let tab = controller as? UITabBarController,
           let selected = tab.selectedViewController {
            return visibleContentController(from: selected)
        }
        for child in controller.children.reversed()
        where child.viewIfLoaded?.window != nil && !child.isBeingDismissed {
            return visibleContentController(from: child)
        }
        return controller
    }
}

@MainActor
private final class TimedRewardedAdLoadAttempt {
    private var continuation: CheckedContinuation<Result<RewardedAd, NSError>, Never>?
    private var timeoutTask: Task<Void, Never>?
    private var didFinish = false

    func load(
        adUnitID: String,
        timeoutNanoseconds: UInt64
    ) async -> Result<RewardedAd, NSError> {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            RewardedAd.load(with: adUnitID, request: Request()) { [weak self] ad, error in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if let ad {
                        self.finish(.success(ad))
                    } else {
                        let sdkError = error.map { $0 as NSError } ?? NSError(
                            domain: "BWChat.AdMob.Load",
                            code: -1
                        )
                        self.finish(.failure(sdkError))
                    }
                }
            }
            timeoutTask = Task { @MainActor in
                do {
                    try await Task.sleep(nanoseconds: timeoutNanoseconds)
                } catch {
                    return
                }
                self.finish(.failure(NSError(
                    domain: "BWChat.AdMob.LoadTimeout",
                    code: 1
                )))
            }
        }
    }

    private func finish(_ result: Result<RewardedAd, NSError>) {
        guard !didFinish else { return }
        didFinish = true
        timeoutTask?.cancel()
        timeoutTask = nil
        let continuation = continuation
        self.continuation = nil
        continuation?.resume(returning: result)
    }
}

@MainActor
final class AdRewardService: NSObject, ObservableObject, GameRewardedAdPresenting {
    private static let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "BWChat",
        category: "RewardedAd"
    )
    private static let gameAdLoadTimeoutNanoseconds: UInt64 = 2_500_000_000

    enum State: Equatable {
        case idle
        case loading
        case ready
        case presenting
        case awaitingServerCredit
        case failed
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var lastErrorMessage: String?
    @Published private(set) var lastErrorCode: String?
    @Published private(set) var remainingViewCount = AdMobConfiguration.dailyRewardedAdLimit
    @Published private(set) var serverDeliveryEnabled = AdMobConfiguration.initialServerDeliveryEnabled

    private var rewardedAd: RewardedAd?
    private var loadedAdUnitID: String?
    private var didEarnReward = false
    private var presentationContinuation: CheckedContinuation<Bool, Never>?
    private var isPresentationRequestInFlight = false
    private var presentingUserID: String?
    private var presentationSession: WalletAdRewardSessionResponseData?
    private var pendingCredit: AdRewardPendingCredit?
    private var loadedForUserID: String?
    private var serverCounterUserID: String?
    private var serverRemainingViewCount: Int?
    private var serverCounterResetDate: Date?
    private var resetTimer: Timer?
    private var dayChangeObservers: [NSObjectProtocol] = []
    private let dailyCounter: AdRewardDailyCounter
    private let pendingCreditStore: AdRewardPendingCreditStore
    private var cachedGameRewardedAds: [String: (ad: RewardedAd, loadedAt: Date)] = [:]
    private var loadingGameRewardedAdUnitIDs = Set<String>()
    private var gameRewardedAdLoadWaiters: [String: [CheckedContinuation<Void, Never>]] = [:]
    private var gameRewardedAdLoadErrors: [String: NSError] = [:]

    init(
        dailyCounter: AdRewardDailyCounter = AdRewardDailyCounter(),
        pendingCreditStore: AdRewardPendingCreditStore = AdRewardPendingCreditStore()
    ) {
        self.dailyCounter = dailyCounter
        self.pendingCreditStore = pendingCreditStore
        super.init()
        refreshDailyCounter()
        startDailyResetMonitoring()
    }

    deinit {
        resetTimer?.invalidate()
        dayChangeObservers.forEach(NotificationCenter.default.removeObserver)
    }

    var isReady: Bool {
        state == .ready && rewardedAd != nil
    }

    var hasRemainingViews: Bool {
        remainingViewCount > 0
    }

    var isAwaitingServerCredit: Bool {
        pendingCredit != nil
    }

    func refreshDailyCounter() {
        let currentUserID = AuthManager.shared.currentUser?.userID
        restorePendingCredit(for: currentUserID)
        resolvePendingCreditIfPossible(
            currentUserID: currentUserID,
            serverRemainingCount: serverRemainingViewCount
        )
        if serverCounterUserID != currentUserID
            || serverCounterResetDate.map({ $0 <= Date() }) == true {
            serverCounterUserID = nil
            serverRemainingViewCount = nil
            serverCounterResetDate = nil
        }
        if loadedForUserID != nil, loadedForUserID != currentUserID, state != .presenting {
            rewardedAd = nil
            loadedAdUnitID = nil
            loadedForUserID = nil
            state = .idle
        }
        remainingViewCount = serverRemainingViewCount
            ?? dailyCounter.remainingViews(for: currentUserID)
        if pendingCredit != nil {
            state = .awaitingServerCredit
        }
        scheduleNextDailyReset()
    }

    func load(force: Bool = false) async {
        refreshDailyCounter()
        guard pendingCredit == nil else {
            state = .awaitingServerCredit
            return
        }
        #if !DEBUG
        guard serverDeliveryEnabled else {
            rewardedAd = nil
            loadedAdUnitID = nil
            loadedForUserID = nil
            state = .idle
            return
        }
        #endif
        guard hasRemainingViews else {
            rewardedAd = nil
            loadedAdUnitID = nil
            state = .idle
            return
        }

        let adUnitID = AdMobConfiguration.currentWalletRewardedAdUnitID

        // Never start a second SDK load while one is already running or while
        // the current ad is on screen. `force` only bypasses the ready cache.
        if state == .loading || state == .presenting {
            return
        }
        if !force, isReady, loadedAdUnitID == adUnitID {
            return
        }

        rewardedAd = nil
        loadedAdUnitID = nil
        loadedForUserID = nil
        state = .loading
        lastErrorMessage = nil
        lastErrorCode = nil

        guard await AdMobConsentManager.shared.prepareForAds() else {
            state = .failed
            lastErrorMessage = "Advertising consent is required."
            lastErrorCode = "ad_consent_unavailable"
            return
        }

        do {
            let ad = try await RewardedAd.load(
                with: adUnitID,
                request: Request()
            )
            ad.fullScreenContentDelegate = self
            rewardedAd = ad
            loadedAdUnitID = adUnitID
            loadedForUserID = AuthManager.shared.currentUser?.userID
            state = .ready
        } catch {
            rewardedAd = nil
            loadedAdUnitID = nil
            loadedForUserID = nil
            if case APIError.serverError(let code, _) = error, code == 429 {
                serverCounterUserID = AuthManager.shared.currentUser?.userID
                serverRemainingViewCount = 0
                remainingViewCount = 0
            }
            if case APIError.serverError(let code, _) = error, code == 403 {
                serverDeliveryEnabled = false
            }
            state = .failed
            lastErrorMessage = error.localizedDescription
            let sdkError = error as NSError
            lastErrorCode = Self.adLoadErrorCode(sdkError)
            print(
                "[AdMob] Wallet rewarded load failed "
                    + "adUnitID=\(adUnitID) errorCode=\(lastErrorCode ?? "ad_load_failed") "
                    + "sdkDomain=\(sdkError.domain) sdkCode=\(sdkError.code)"
            )
        }
    }

    func syncServerCounter() async {
        let currentUserID = AuthManager.shared.currentUser?.userID
        restorePendingCredit(for: currentUserID)
        do {
            let status = try await APIService.shared.getWalletAdRewardStatus()
            serverDeliveryEnabled = status.enabled
            serverCounterUserID = currentUserID
            let dailyLimit = max(status.dailyLimit, 0)
            serverRemainingViewCount = min(max(status.remainingCount, 0), dailyLimit)
            serverCounterResetDate = Self.parseServerDate(status.nextResetAt)
                ?? dailyCounter.nextResetDate()
            remainingViewCount = serverRemainingViewCount ?? 0
            resolvePendingCreditIfPossible(
                currentUserID: currentUserID,
                serverRemainingCount: serverRemainingViewCount
            )
        } catch {
            // Keep the account-scoped device counter as an offline fallback.
            refreshDailyCounter()
            Self.logger.error(
                "wallet_reward_status_sync_failed error=\(String(describing: error), privacy: .public)"
            )
        }
    }

    func waitForServerCredit(maximumAttempts: Int = 6) async {
        guard maximumAttempts > 0 else { return }
        for attempt in 0..<maximumAttempts {
            if attempt > 0 {
                do {
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                } catch {
                    return
                }
            }
            guard !Task.isCancelled, pendingCredit != nil else { return }
            await syncServerCounter()
        }
    }

    func present() async -> Bool {
        // Swift concurrency can re-enter this @MainActor method at every await.
        // Keep one presentation owner so repeated taps cannot replace the ad or
        // the continuation used by the full-screen delegate callbacks.
        guard !isPresentationRequestInFlight,
              state != .loading,
              state != .presenting,
              pendingCredit == nil else {
            return false
        }
        isPresentationRequestInFlight = true
        defer { isPresentationRequestInFlight = false }

        let presentationOwner = "wallet.\(UUID().uuidString)"
        guard RewardedAdPresentationGate.shared.acquire(owner: presentationOwner) else {
            return false
        }
        defer { RewardedAdPresentationGate.shared.release(owner: presentationOwner) }

        refreshDailyCounter()
        guard hasRemainingViews else {
            return false
        }

        let expectedAdUnitID = AdMobConfiguration.currentWalletRewardedAdUnitID
        if rewardedAd != nil, loadedAdUnitID != expectedAdUnitID {
            rewardedAd = nil
            loadedAdUnitID = nil
            loadedForUserID = nil
            state = .idle
        }

        guard let ad = rewardedAd,
              loadedAdUnitID != nil,
              state == .ready else {
            await load(force: true)
            guard let reloadedAd = rewardedAd,
                  loadedAdUnitID != nil,
                  state == .ready else {
                return false
            }
            return await present(reloadedAd)
        }

        return await present(ad)
    }

    func presentGameRewardedAd(
        request: GameRewardedAdRequest
    ) async -> GameRewardedAdPresentationOutcome {
        let presentationOwner = "game.\(request.requestID)"
        guard RewardedAdPresentationGate.shared.acquire(owner: presentationOwner) else {
            return .unavailable(errorCode: GameRewardedAdErrorCode.alreadyShowing)
        }
        defer { RewardedAdPresentationGate.shared.release(owner: presentationOwner) }

        guard AdMobRuntime.isInitialized else {
            return .unavailable(errorCode: GameRewardedAdErrorCode.sdkNotInitialized)
        }
        guard RewardedAdPresenterResolver.visiblePresenter() != nil else {
            Self.logGameAdEvent(
                "presenter_unavailable",
                adUnitID: request.adUnitID,
                sdkError: nil,
                presenterAvailable: false
            )
            return .unavailable(errorCode: GameRewardedAdErrorCode.presenterUnavailable)
        }

        await ensureGameRewardedAdIsCached(adUnitID: request.adUnitID)
        guard let cachedAd = cachedGameRewardedAds.removeValue(forKey: request.adUnitID) else {
            let sdkError = gameRewardedAdLoadErrors[request.adUnitID]
            Self.logGameAdEvent(
                "load_failed",
                adUnitID: request.adUnitID,
                sdkError: sdkError,
                presenterAvailable: RewardedAdPresenterResolver.visiblePresenter() != nil
            )
            return AdMobGameErrorMapper.presentationOutcome(forLoadError: sdkError)
        }
        guard let presenter = RewardedAdPresenterResolver.visiblePresenter() else {
            Self.logGameAdEvent(
                "presenter_unavailable",
                adUnitID: request.adUnitID,
                sdkError: nil,
                responseInfo: cachedAd.ad.responseInfo,
                presenterAvailable: false
            )
            return .unavailable(errorCode: GameRewardedAdErrorCode.presenterUnavailable)
        }

        let verificationOptions = ServerSideVerificationOptions()
        verificationOptions.userIdentifier = request.ssvUserID
        verificationOptions.customRewardText = request.ssvCustomData
        cachedAd.ad.serverSideVerificationOptions = verificationOptions

        do {
            try cachedAd.ad.canPresent(from: presenter)
        } catch {
            Self.logGameAdEvent(
                "can_present_failed",
                adUnitID: request.adUnitID,
                sdkError: error as NSError,
                responseInfo: cachedAd.ad.responseInfo,
                presenterAvailable: true
            )
            return .failed(errorCode: GameRewardedAdErrorCode.presentFailed)
        }

        let session = GameRewardedAdSDKSession()
        let outcome = await session.present(cachedAd.ad, from: presenter)
        Task { [weak self] in
            await self?.preloadGameRewardedAds(adUnitIDs: [request.adUnitID])
        }
        return outcome
    }

    func preloadGameRewardedAds(adUnitIDs: [String]) async {
        guard !adUnitIDs.isEmpty,
              await AdMobConsentManager.shared.prepareForAds() else {
            return
        }
        for adUnitID in Set(adUnitIDs) {
            await ensureGameRewardedAdIsCached(adUnitID: adUnitID)
        }
    }

    private func ensureGameRewardedAdIsCached(adUnitID: String) async {
        if let cached = cachedGameRewardedAds[adUnitID],
           Date().timeIntervalSince(cached.loadedAt) < 50 * 60 {
            return
        }
        cachedGameRewardedAds[adUnitID] = nil

        if loadingGameRewardedAdUnitIDs.contains(adUnitID) {
            await withCheckedContinuation { continuation in
                gameRewardedAdLoadWaiters[adUnitID, default: []].append(continuation)
            }
            return
        }

        loadingGameRewardedAdUnitIDs.insert(adUnitID)
        gameRewardedAdLoadErrors[adUnitID] = nil
        let loadAttempt = TimedRewardedAdLoadAttempt()
        switch await loadAttempt.load(
            adUnitID: adUnitID,
            timeoutNanoseconds: Self.gameAdLoadTimeoutNanoseconds
        ) {
        case .success(let ad):
            cachedGameRewardedAds[adUnitID] = (ad, Date())
        case .failure(let error):
            gameRewardedAdLoadErrors[adUnitID] = error
        }
        loadingGameRewardedAdUnitIDs.remove(adUnitID)
        let waiters = gameRewardedAdLoadWaiters.removeValue(forKey: adUnitID) ?? []
        waiters.forEach { $0.resume() }
    }

    fileprivate static func logGameAdEvent(
        _ event: String,
        adUnitID: String,
        sdkError: NSError?,
        responseInfo explicitResponseInfo: ResponseInfo? = nil,
        presenterAvailable: Bool
    ) {
        let responseInfo = explicitResponseInfo
            ?? sdkError?.userInfo[GADErrorUserInfoKeyResponseInfo] as? ResponseInfo
        let adapterSummary = responseInfo?.adNetworkInfoArray.prefix(6).map { adapter in
            let errorCode = (adapter.error as NSError?)?.code.description ?? "none"
            let latencyMilliseconds = Int((adapter.latency * 1_000).rounded())
            return "\(adapter.adNetworkClassName):\(errorCode):\(latencyMilliseconds)ms"
        }.joined(separator: ",") ?? "none"
        let configVersion = AppRemoteConfigStore.shared.config.configVersion
        let responseIdentifier = responseInfo?.responseIdentifier ?? "none"
        let domain = sdkError?.domain ?? "none"
        let code = sdkError?.code ?? 0
        Self.logger.error(
            "game_ad_event=\(event, privacy: .public) sdk_domain=\(domain, privacy: .public) sdk_code=\(code) response_id=\(responseIdentifier, privacy: .public) adapters=\(adapterSummary, privacy: .public) config_version=\(configVersion, privacy: .public) ad_unit_suffix=\(String(adUnitID.suffix(8)), privacy: .public) presenter=\(presenterAvailable) bridge_origin=true allowlist=true"
        )
    }

    private func present(_ ad: RewardedAd) async -> Bool {
        state = .loading
        lastErrorMessage = nil
        lastErrorCode = nil
        guard let adUnitID = loadedAdUnitID else {
            state = .failed
            lastErrorCode = "ad_unit_id_missing"
            return false
        }
        let session: WalletAdRewardSessionResponseData
        do {
            session = try await prepareServerVerification(for: ad, adUnitID: adUnitID)
        } catch {
            handleSessionCreationFailure(error, retaining: ad)
            return false
        }

        guard let presenter = RewardedAdPresenterResolver.visiblePresenter() else {
            lastErrorCode = GameRewardedAdErrorCode.presenterUnavailable
            state = .ready
            return false
        }

        do {
            try ad.canPresent(from: presenter)
        } catch {
            lastErrorMessage = error.localizedDescription
            lastErrorCode = "ad_present_failed"
            state = .ready
            return false
        }

        rewardedAd = nil
        loadedAdUnitID = nil
        loadedForUserID = nil
        state = .presenting
        didEarnReward = false
        presentingUserID = AuthManager.shared.currentUser?.userID
        presentationSession = session

        return await withCheckedContinuation { continuation in
            presentationContinuation = continuation
            ad.present(from: presenter) { [weak self] in
                self?.didEarnReward = true
            }
        }
    }

    private func finishPresentation(earnedReward: Bool) {
        let completedUserID = presentingUserID
        let completedSession = presentationSession
        var rewardAccepted = earnedReward
        if earnedReward {
            if let completedSession, let completedUserID {
                serverCounterUserID = completedUserID
                // Do not decrement either counter from the client-side earned
                // callback. Only the status endpoint can prove that Google SSV
                // was verified and the wallet was credited.
                remainingViewCount = max(completedSession.remainingCount, 0)
                let pendingCredit = AdRewardPendingCredit(
                    userID: completedUserID,
                    remainingCountBeforeReward: max(completedSession.remainingCount, 0),
                    businessDayResetAt: Self.parseServerDate(completedSession.nextResetAt)
                        ?? dailyCounter.nextResetDate()
                        ?? Date().addingTimeInterval(24 * 60 * 60),
                    sessionExpiresAt: completedSession.expiresAt.flatMap(Self.parseServerDate)
                        ?? Date().addingTimeInterval(30 * 60)
                )
                self.pendingCredit = pendingCredit
                pendingCreditStore.save(pendingCredit)
                scheduleNextDailyReset()
                Self.logger.notice(
                    "wallet_ad_earned awaiting_ssv=true session_suffix=\(String(completedSession.sessionID.suffix(8)), privacy: .public) remaining_before=\(completedSession.remainingCount)"
                )
            } else {
                rewardAccepted = false
                lastErrorMessage = "Wallet reward session is missing."
                lastErrorCode = "reward_session_missing"
                Self.logger.fault("wallet_ad_earned rejected reason=reward_session_missing")
            }
        }
        presentingUserID = nil
        presentationSession = nil
        let continuation = presentationContinuation
        presentationContinuation = nil
        if self.lastErrorCode == "reward_session_missing" {
            self.state = .failed
        } else if self.pendingCredit == nil {
            self.state = .idle
        } else {
            self.state = .awaitingServerCredit
        }
        continuation?.resume(returning: rewardAccepted)

        if self.pendingCredit == nil {
            Task { [weak self] in
                await self?.load(force: true)
            }
        }
    }

    private func prepareServerVerification(
        for ad: RewardedAd,
        adUnitID: String
    ) async throws -> WalletAdRewardSessionResponseData {
        guard let userID = AuthManager.shared.currentUser?.userID, !userID.isBlank else {
            throw APIError.unauthorized
        }
        let session = try await APIService.shared.createWalletAdRewardSession(
            adUnitID: adUnitID
        )
        serverCounterUserID = userID
        serverRemainingViewCount = max(session.remainingCount, 0)
        serverCounterResetDate = Self.parseServerDate(session.nextResetAt)
            ?? dailyCounter.nextResetDate()
        remainingViewCount = serverRemainingViewCount ?? 0
        guard remainingViewCount > 0 else {
            throw APIError.serverError(
                code: 429,
                message: L10n.tr("wallet.adRewardDailyLimitReached")
            )
        }

        let options = ServerSideVerificationOptions()
        options.userIdentifier = userID
        options.customRewardText = session.ssvCustomData
        ad.serverSideVerificationOptions = options
        Self.logger.notice(
            "wallet_reward_session_created session_suffix=\(String(session.sessionID.suffix(8)), privacy: .public) ad_unit_suffix=\(String(adUnitID.suffix(8)), privacy: .public) remaining=\(session.remainingCount)"
        )
        return session
    }

    private func handleSessionCreationFailure(_ error: Error, retaining ad: RewardedAd) {
        lastErrorMessage = error.localizedDescription
        lastErrorCode = Self.rewardSessionErrorCode(error)
        let currentAdUnitID = loadedAdUnitID ?? "missing"
        if case APIError.serverError(let code, _) = error, code == 429 {
            serverCounterUserID = AuthManager.shared.currentUser?.userID
            serverRemainingViewCount = 0
            remainingViewCount = 0
            rewardedAd = nil
            loadedAdUnitID = nil
            loadedForUserID = nil
            state = .failed
        } else if case APIError.serverError(let code, _) = error, code == 403 {
            serverDeliveryEnabled = false
            rewardedAd = nil
            loadedAdUnitID = nil
            loadedForUserID = nil
            state = .failed
        } else {
            // The loaded ad is still reusable because SSV options may be set at
            // any time before presentation. A later tap can retry the session API.
            rewardedAd = ad
            state = .ready
        }
        Self.logger.error(
            "wallet_reward_session_failed ad_unit_suffix=\(String(currentAdUnitID.suffix(8)), privacy: .public) error_code=\(self.lastErrorCode ?? "reward_session_failed", privacy: .public)"
        )
    }

    private static func adLoadErrorCode(_ error: NSError) -> String {
        if error.domain == GADErrorDomain, error.code == 1 {
            return "ad_no_fill"
        }
        return "ad_load_failed"
    }

    private static func rewardSessionErrorCode(_ error: Error) -> String {
        if case APIError.serverError(let code, _) = error {
            return "reward_session_http_\(code)"
        }
        if case APIError.unauthorized = error {
            return "reward_session_unauthorized"
        }
        return "reward_session_failed"
    }

    private func resolvePendingCreditIfPossible(
        currentUserID: String?,
        serverRemainingCount: Int?
    ) {
        guard let pendingCredit,
              pendingCredit.isResolved(
                currentUserID: currentUserID,
                serverRemainingCount: serverRemainingCount
              ) else {
            return
        }
        let serverCreditConfirmed = pendingCredit.isServerCreditConfirmed(
            currentUserID: currentUserID,
            serverRemainingCount: serverRemainingCount
        )
        pendingCreditStore.remove(for: pendingCredit.userID)
        self.pendingCredit = nil
        if serverCreditConfirmed {
            _ = dailyCounter.recordCompletedView(for: pendingCredit.userID)
            Self.logger.notice(
                "wallet_credit_confirmed remaining=\(serverRemainingCount ?? -1)"
            )
        } else {
            Self.logger.error("wallet_credit_abandoned reason=expired_or_account_changed")
        }
        if state == .awaitingServerCredit {
            state = .idle
        }
    }

    private func restorePendingCredit(for currentUserID: String?) {
        guard let currentUserID else {
            pendingCredit = nil
            return
        }
        guard pendingCredit?.userID != currentUserID else { return }
        pendingCredit = pendingCreditStore.pendingCredit(for: currentUserID)
    }

    private func startDailyResetMonitoring() {
        let names: [Notification.Name] = [
            .NSCalendarDayChanged,
            .NSSystemTimeZoneDidChange,
            UIApplication.significantTimeChangeNotification
        ]
        dayChangeObservers = names.map { name in
            NotificationCenter.default.addObserver(
                forName: name,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    await self?.handlePossibleDailyReset()
                }
            }
        }
        scheduleNextDailyReset()
    }

    private func scheduleNextDailyReset() {
        resetTimer?.invalidate()
        let nextResetDate = [dailyCounter.nextResetDate(), pendingCredit?.sessionExpiresAt]
            .compactMap { $0 }
            .filter { $0 > Date() }
            .min()
        guard let nextResetDate else { return }
        let timer = Timer(fire: nextResetDate, interval: 0, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                await self?.handlePossibleDailyReset()
            }
        }
        resetTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func handlePossibleDailyReset() async {
        refreshDailyCounter()
    }

    private static func parseServerDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}

struct GameRewardedAdTerminalState {
    private(set) var didEarnReward = false
    private(set) var didFinish = false

    mutating func recordEarnedReward() {
        guard !didFinish else { return }
        didEarnReward = true
    }

    mutating func outcomeForDismissal() -> GameRewardedAdPresentationOutcome? {
        finish(didEarnReward ? .completed : .dismissed)
    }

    mutating func outcomeForPresentationFailure() -> GameRewardedAdPresentationOutcome? {
        finish(
            didEarnReward
                ? .completed
                : .failed(errorCode: GameRewardedAdErrorCode.presentFailed)
        )
    }

    private mutating func finish(
        _ outcome: GameRewardedAdPresentationOutcome
    ) -> GameRewardedAdPresentationOutcome? {
        guard !didFinish else { return nil }
        didFinish = true
        return outcome
    }
}

@MainActor
private final class GameRewardedAdSDKSession: NSObject, FullScreenContentDelegate {
    private var ad: RewardedAd?
    private var continuation: CheckedContinuation<GameRewardedAdPresentationOutcome, Never>?
    private var terminalState = GameRewardedAdTerminalState()

    func present(
        _ ad: RewardedAd,
        from presenter: UIViewController
    ) async -> GameRewardedAdPresentationOutcome {
        self.ad = ad
        ad.fullScreenContentDelegate = self

        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            ad.present(from: presenter) { [weak self] in
                self?.terminalState.recordEarnedReward()
            }
        }
    }

    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        guard let outcome = terminalState.outcomeForDismissal() else { return }
        finish(outcome)
    }

    func ad(
        _ ad: FullScreenPresentingAd,
        didFailToPresentFullScreenContentWithError error: Error
    ) {
        if let rewardedAd = self.ad {
            AdRewardService.logGameAdEvent(
                "present_failed",
                adUnitID: rewardedAd.adUnitID,
                sdkError: error as NSError,
                responseInfo: rewardedAd.responseInfo,
                presenterAvailable: RewardedAdPresenterResolver.visiblePresenter() != nil
            )
        }
        guard let outcome = terminalState.outcomeForPresentationFailure() else { return }
        finish(outcome)
    }

    private func finish(_ outcome: GameRewardedAdPresentationOutcome) {
        ad?.fullScreenContentDelegate = nil
        ad = nil
        let continuation = continuation
        self.continuation = nil
        continuation?.resume(returning: outcome)
    }
}

extension AdRewardService: FullScreenContentDelegate {
    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        finishPresentation(earnedReward: didEarnReward)
    }

    func ad(
        _ ad: FullScreenPresentingAd,
        didFailToPresentFullScreenContentWithError error: Error
    ) {
        lastErrorMessage = error.localizedDescription
        lastErrorCode = "ad_present_failed"
        finishPresentation(earnedReward: false)
    }
}
