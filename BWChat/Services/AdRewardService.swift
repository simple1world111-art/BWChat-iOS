import Foundation
import GoogleMobileAds
import UserMessagingPlatform

enum AdMobConfiguration {
    static let dailyRewardedAdLimit = 10
    static let productionRewardedAdUnitID = "ca-app-pub-1877504503518465/7354329102"
    static let testRewardedAdUnitID = "ca-app-pub-3940256099942544/1712485313"
    // Enable only after the backend verifies AdMob SSV callbacks and credits the wallet.
    static let productionRewardDeliveryEnabled = false

    static var rewardedAdUnitID: String {
        #if DEBUG
        testRewardedAdUnitID
        #else
        productionRewardedAdUnitID
        #endif
    }
}

@MainActor
private final class AdMobConsentManager {
    static let shared = AdMobConsentManager()

    private var didStartSDK = false

    private init() {}

    func prepareForAds() async -> Bool {
        if didStartSDK {
            return true
        }

        let parameters = RequestParameters()
        await withCheckedContinuation { continuation in
            ConsentInformation.shared.requestConsentInfoUpdate(with: parameters) { error in
                if let error {
                    print("[AdMob] Consent update failed: \(error.localizedDescription)")
                }
                continuation.resume()
            }
        }

        do {
            try await ConsentForm.loadAndPresentIfRequired(from: nil)
        } catch {
            print("[AdMob] Consent form failed: \(error.localizedDescription)")
        }

        guard ConsentInformation.shared.canRequestAds else {
            return false
        }

        await MobileAds.shared.start()
        didStartSDK = true
        return true
    }
}

@MainActor
final class AdRewardService: NSObject, ObservableObject {
    enum State: Equatable {
        case idle
        case loading
        case ready
        case presenting
        case failed
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var lastErrorMessage: String?
    @Published private(set) var remainingViewCount = AdMobConfiguration.dailyRewardedAdLimit

    private var rewardedAd: RewardedAd?
    private var didEarnReward = false
    private var presentationContinuation: CheckedContinuation<Bool, Never>?

    override init() {
        super.init()
        refreshDailyCounter()
    }

    var isReady: Bool {
        state == .ready && rewardedAd != nil
    }

    var hasRemainingViews: Bool {
        remainingViewCount > 0
    }

    func refreshDailyCounter() {
        let defaults = UserDefaults.standard
        let storedDay = defaults.string(forKey: counterDayKey)
        guard storedDay == todayKey else {
            defaults.set(todayKey, forKey: counterDayKey)
            defaults.set(0, forKey: counterWatchedKey)
            remainingViewCount = AdMobConfiguration.dailyRewardedAdLimit
            return
        }

        let watchedCount = min(
            max(defaults.integer(forKey: counterWatchedKey), 0),
            AdMobConfiguration.dailyRewardedAdLimit
        )
        remainingViewCount = AdMobConfiguration.dailyRewardedAdLimit - watchedCount
    }

    func load(force: Bool = false) async {
        refreshDailyCounter()
        guard hasRemainingViews else {
            rewardedAd = nil
            state = .idle
            return
        }

        if !force, state == .loading || isReady {
            return
        }

        state = .loading
        lastErrorMessage = nil

        guard await AdMobConsentManager.shared.prepareForAds() else {
            state = .failed
            lastErrorMessage = "Advertising consent is required."
            return
        }

        do {
            let ad = try await RewardedAd.load(
                with: AdMobConfiguration.rewardedAdUnitID,
                request: Request()
            )
            ad.fullScreenContentDelegate = self
            rewardedAd = ad
            state = .ready
        } catch {
            rewardedAd = nil
            state = .failed
            lastErrorMessage = error.localizedDescription
            print("[AdMob] Rewarded ad load failed: \(error.localizedDescription)")
        }
    }

    func present() async -> Bool {
        refreshDailyCounter()
        guard hasRemainingViews else {
            return false
        }

        guard let ad = rewardedAd, state == .ready else {
            await load(force: true)
            guard let reloadedAd = rewardedAd, state == .ready else {
                return false
            }
            return await present(reloadedAd)
        }

        return await present(ad)
    }

    private func present(_ ad: RewardedAd) async -> Bool {
        rewardedAd = nil
        state = .presenting
        didEarnReward = false

        return await withCheckedContinuation { continuation in
            presentationContinuation = continuation
            ad.present(from: nil) { [weak self] in
                self?.didEarnReward = true
            }
        }
    }

    private func finishPresentation(earnedReward: Bool) {
        if earnedReward {
            recordCompletedView()
        }
        let continuation = presentationContinuation
        presentationContinuation = nil
        state = .idle
        continuation?.resume(returning: earnedReward)

        Task { [weak self] in
            await self?.load(force: true)
        }
    }

    private func recordCompletedView() {
        refreshDailyCounter()
        guard remainingViewCount > 0 else { return }

        let watchedCount = AdMobConfiguration.dailyRewardedAdLimit - remainingViewCount + 1
        UserDefaults.standard.set(todayKey, forKey: counterDayKey)
        UserDefaults.standard.set(watchedCount, forKey: counterWatchedKey)
        remainingViewCount = AdMobConfiguration.dailyRewardedAdLimit - watchedCount
    }

    private var counterNamespace: String {
        let userID = AuthManager.shared.currentUser?.userID ?? "anonymous"
        return "bbchat.adReward.daily.\(userID)"
    }

    private var counterDayKey: String {
        "\(counterNamespace).day"
    }

    private var counterWatchedKey: String {
        "\(counterNamespace).watched"
    }

    private var todayKey: String {
        let components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        return "\(components.year ?? 0)-\(components.month ?? 0)-\(components.day ?? 0)"
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
        finishPresentation(earnedReward: false)
    }
}
