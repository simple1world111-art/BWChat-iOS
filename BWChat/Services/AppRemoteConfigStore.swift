import Foundation
import OSLog

enum AppRemoteConfigSource: String {
    case bundled
    case cache
    case remote
    case fixture
}

enum AppRemoteConfigUpdatePolicy {
    static let rewardedAdAllowlistMigrationVersion = "2026.07.31.admob-1011630693"

    /// HTTP 200 replaces the complete cached snapshot. In particular, ad-unit
    /// allowlists are never unioned across config versions. HTTP 304 preserves
    /// the cached snapshot byte-for-byte.
    static func configAfterResponse(
        cached: AppRemoteConfig,
        fetched: AppRemoteConfig?,
        notModified: Bool
    ) -> AppRemoteConfig {
        if notModified {
            return cached
        }
        return fetched ?? cached
    }

    /// Older clients could merge the rewarded-ad allowlist while keeping the
    /// latest config version and ETag. A later 304 would then preserve that
    /// poisoned snapshot forever. Reject only the known migration version when
    /// its allowlist is not the exact production value so the store also drops
    /// its ETag and performs an unconditional fetch.
    static func requiresRewardedAdAllowlistRecovery(
        _ config: AppRemoteConfig
    ) -> Bool {
        guard config.configVersion == rewardedAdAllowlistMigrationVersion else {
            return false
        }
        let configuredIDs = Set(
            RewardedAdUnitResolver.normalizedIDs(
                config.wallet?.adReward?.iosAdUnitIDs
            )
        )
        return configuredIDs != [AdMobConfiguration.productionRewardedAdUnitID]
    }
}

@MainActor
struct FeatureFlagService {
    let flags: [FeatureFlag]
    var subjectID: String = FeatureFlagService.defaultSubjectID

    func isEnabled(_ key: String, default defaultValue: Bool = false) -> Bool {
        let normalizedKey = key.normalizedDynamicToken
        guard let flag = flags.first(where: { $0.key.normalizedDynamicToken == normalizedKey }) else {
            return defaultValue
        }
        guard flag.enabled else { return false }
        if let minBuild = flag.minBuild, AppBuildInfo.buildNumber < minBuild { return false }
        if let maxBuild = flag.maxBuild, AppBuildInfo.buildNumber > maxBuild { return false }

        let rollout = max(0, min(flag.rolloutPercentage ?? 100, 100))
        guard rollout > 0 else { return false }
        guard rollout < 100 else { return true }

        let hashInput = "\(flag.key)|\(flag.salt ?? "")|\(subjectID)"
        return Self.bucket(for: hashInput) < rollout
    }

    private static var defaultSubjectID: String {
        if let userID = AuthManager.shared.currentUser?.userID, !userID.isBlank {
            return "user:\(userID)"
        }
        let key = "bbchat.dynamic.deviceID.v1"
        if let existing = UserDefaults.standard.string(forKey: key), !existing.isBlank {
            return "device:\(existing)"
        }
        let created = UUID().uuidString
        UserDefaults.standard.set(created, forKey: key)
        return "device:\(created)"
    }

    private static func bucket(for value: String) -> Int {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in value.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return Int(hash % 100)
    }
}

@MainActor
final class AppRemoteConfigStore: ObservableObject {
    static let shared = AppRemoteConfigStore()
    private static let logger = Logger(
        subsystem: Bundle.main.bundleIdentifier ?? "BWChat",
        category: "RemoteConfig"
    )

    @Published private(set) var config: AppRemoteConfig
    @Published private(set) var source: AppRemoteConfigSource
    @Published private(set) var isLoading = false
    @Published private(set) var lastFetchDate: Date?
    @Published private(set) var lastETag: String?
    @Published private(set) var lastError: String?

    private let defaults: UserDefaults
    private var scopeID: String
    private var loadTask: (scopeID: String, task: Task<Void, Never>)?

    var featureFlags: FeatureFlagService {
        FeatureFlagService(flags: config.featureFlags)
    }

    private init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.scopeID = Self.currentScopeID
        if let cached = Self.cachedConfig(defaults: defaults, scopeID: scopeID) {
            self.config = cached
            self.source = .cache
        } else {
            Self.removeCachedMetadata(defaults: defaults, scopeID: scopeID)
            self.config = .bundledDefault
            self.source = .bundled
        }
        self.lastETag = defaults.string(forKey: Self.etagKey(scopeID: scopeID))
        self.lastFetchDate = defaults.object(forKey: Self.lastFetchKey(scopeID: scopeID)) as? Date
        RemoteAssetManager.shared.apply(config.assetManifest)
        logActiveConfig(reason: "startup_cache")
    }

    func load(force: Bool = false, ignoreETag: Bool = false) async {
        syncScopeIfNeeded()
        if !force,
           let lastFetchDate,
           Date().timeIntervalSince(lastFetchDate) < config.minimumRefreshInterval {
            return
        }

        let requestedScopeID = scopeID
        if let activeLoad = loadTask {
            await activeLoad.task.value
            if loadTask?.scopeID == activeLoad.scopeID {
                loadTask = nil
            }
            syncScopeIfNeeded()
            if activeLoad.scopeID != requestedScopeID || scopeID != requestedScopeID {
                await load(force: force, ignoreETag: ignoreETag)
            }
            return
        }

        let requestETag = ignoreETag ? nil : lastETag
        let task = Task { [weak self] in
            guard let self else { return }
            await self.performLoad(
                scopeID: requestedScopeID,
                ifNoneMatch: requestETag
            )
        }
        loadTask = (requestedScopeID, task)
        await task.value
        if loadTask?.scopeID == requestedScopeID {
            loadTask = nil
        }
        syncScopeIfNeeded()
        if scopeID != requestedScopeID {
            await load(force: force, ignoreETag: ignoreETag)
        }
    }

    private func performLoad(scopeID requestedScopeID: String, ifNoneMatch: String?) async {
        if scopeID == requestedScopeID {
            isLoading = true
        }
        defer {
            if scopeID == requestedScopeID {
                isLoading = false
            }
        }

        do {
            let result = try await APIService.shared.fetchAppRemoteConfig(ifNoneMatch: ifNoneMatch)
            let now = Date()
            defaults.set(now, forKey: Self.lastFetchKey(scopeID: requestedScopeID))
            if scopeID == requestedScopeID {
                lastFetchDate = now
            }

            if result.notModified {
                if let etag = result.etag {
                    defaults.set(etag, forKey: Self.etagKey(scopeID: requestedScopeID))
                    if scopeID == requestedScopeID {
                        lastETag = etag
                    }
                }
                if scopeID == requestedScopeID {
                    lastError = nil
                    logActiveConfig(reason: "http_304")
                }
                return
            }

            guard let fetchedConfig = result.config else {
                if scopeID == requestedScopeID {
                    lastError = "Remote config response did not include a config"
                }
                return
            }
            let cachedConfig = Self.cachedConfig(
                defaults: defaults,
                scopeID: requestedScopeID
            ) ?? .bundledDefault
            let remoteConfig = AppRemoteConfigUpdatePolicy.configAfterResponse(
                cached: cachedConfig,
                fetched: fetchedConfig,
                notModified: false
            )
            guard isConfigUsable(remoteConfig) else {
                if scopeID == requestedScopeID {
                    lastError = "Unsupported remote config"
                }
                return
            }
            persist(remoteConfig, scopeID: requestedScopeID)
            if let etag = result.etag {
                defaults.set(etag, forKey: Self.etagKey(scopeID: requestedScopeID))
            } else {
                defaults.removeObject(forKey: Self.etagKey(scopeID: requestedScopeID))
            }
            if scopeID == requestedScopeID {
                apply(remoteConfig, source: .remote)
                lastETag = result.etag
                lastError = nil
            }
        } catch {
            if scopeID == requestedScopeID {
                lastError = error.localizedDescription
            }
        }
    }

    func forceRefresh(ignoreETag: Bool = false) async {
        await load(force: true, ignoreETag: ignoreETag)
    }

    func clearCache() {
        defaults.removeObject(forKey: Self.configKey(scopeID: scopeID))
        defaults.removeObject(forKey: Self.etagKey(scopeID: scopeID))
        defaults.removeObject(forKey: Self.lastFetchKey(scopeID: scopeID))
        lastETag = nil
        lastFetchDate = nil
        apply(.bundledDefault, source: .bundled)
    }

    func loadBundledFixture() {
        var fixture = AppRemoteConfig.bundledDefault
        fixture.configVersion = "local-fixture"
        fixture.generatedAt = ISO8601DateFormatter().string(from: Date())
        fixture.screens = DynamicScreen.bundledFixtures
        fixture.profileSections = Self.fixtureProfileSections
        fixture.contactModules = DynamicSection.defaultContactModules
        apply(fixture, source: .fixture)
    }

    private func syncScopeIfNeeded() {
        let nextScope = Self.currentScopeID
        guard nextScope != scopeID else { return }
        scopeID = nextScope
        lastETag = defaults.string(forKey: Self.etagKey(scopeID: scopeID))
        lastFetchDate = defaults.object(forKey: Self.lastFetchKey(scopeID: scopeID)) as? Date
        if let cached = Self.cachedConfig(defaults: defaults, scopeID: scopeID) {
            apply(cached, source: .cache)
        } else {
            Self.removeCachedMetadata(defaults: defaults, scopeID: scopeID)
            lastETag = nil
            lastFetchDate = nil
            apply(.bundledDefault, source: .bundled)
        }
    }

    private func apply(_ nextConfig: AppRemoteConfig, source: AppRemoteConfigSource) {
        guard isConfigUsable(nextConfig) else {
            lastError = "Unsupported remote config"
            return
        }
        config = nextConfig
        self.source = source
        RemoteAssetManager.shared.apply(nextConfig.assetManifest)
        logActiveConfig(reason: "apply_\(source.rawValue)")
    }

    private func isConfigUsable(_ nextConfig: AppRemoteConfig) -> Bool {
        if nextConfig.schemaVersion > 1 { return false }
        if let minBuild = nextConfig.minSupportedBuild, AppBuildInfo.buildNumber > 0, AppBuildInfo.buildNumber < minBuild {
            return false
        }
        return true
    }

    private func persist(_ config: AppRemoteConfig, scopeID: String) {
        guard let data = try? JSONEncoder().encode(config) else { return }
        defaults.set(data, forKey: Self.configKey(scopeID: scopeID))
    }

    private func logActiveConfig(reason: String) {
        let configuredIDs = RewardedAdUnitResolver.normalizedIDs(
            config.wallet?.adReward?.iosAdUnitIDs
        )
        let effectiveIDs = configuredIDs.isEmpty
            ? AdMobConfiguration.bundledGameRewardedAdUnitIDs
            : configuredIDs
        let suffixes = effectiveIDs.map { String($0.suffix(8)) }.joined(separator: ",")
        Self.logger.notice(
            "active reason=\(reason, privacy: .public) source=\(self.source.rawValue, privacy: .public) config_version=\(self.config.configVersion, privacy: .public) ad_unit_suffixes=\(suffixes, privacy: .public)"
        )
    }

    private static var currentScopeID: String {
        let userID = AuthManager.shared.currentUser?.userID
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return userID?.isEmpty == false ? "user.\(userID!)" : "guest"
    }

    private static func cachedConfig(defaults: UserDefaults, scopeID: String) -> AppRemoteConfig? {
        guard let data = defaults.data(forKey: configKey(scopeID: scopeID)) else { return nil }
        guard let config = try? JSONDecoder().decode(AppRemoteConfig.self, from: data) else { return nil }
        guard isCurrentStickerConfigVersion(config.configVersion) else {
            print("[StickerConfig] invalidating cached config_version=\(config.configVersion), minimum=2026.07.12.1")
            return nil
        }
        if AppRemoteConfigUpdatePolicy.requiresRewardedAdAllowlistRecovery(config) {
            let suffixes = RewardedAdUnitResolver.normalizedIDs(
                config.wallet?.adReward?.iosAdUnitIDs
            )
            .map { String($0.suffix(8)) }
            .joined(separator: ",")
            logger.error(
                "invalidating poisoned rewarded-ad config config_version=\(config.configVersion, privacy: .public) ad_unit_suffixes=\(suffixes, privacy: .public)"
            )
            return nil
        }
        return config
    }

    private static func isCurrentStickerConfigVersion(_ version: String) -> Bool {
        let required = [2026, 7, 12, 1]
        let components = version.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
        guard components.count >= required.count else { return false }
        for index in required.indices {
            if components[index] != required[index] {
                return components[index] > required[index]
            }
        }
        return true
    }

    private static func removeCachedMetadata(defaults: UserDefaults, scopeID: String) {
        defaults.removeObject(forKey: configKey(scopeID: scopeID))
        defaults.removeObject(forKey: etagKey(scopeID: scopeID))
        defaults.removeObject(forKey: lastFetchKey(scopeID: scopeID))
    }

    private static func configKey(scopeID: String) -> String {
        "bbchat.app.remoteConfig.v1.\(scopeID)"
    }

    private static func etagKey(scopeID: String) -> String {
        "bbchat.app.remoteConfig.etag.v1.\(scopeID)"
    }

    private static func lastFetchKey(scopeID: String) -> String {
        "bbchat.app.remoteConfig.lastFetch.v1.\(scopeID)"
    }

    private static var fixtureProfileSections: [DynamicSection] {
        [
            DynamicSection(
                id: "profile_dynamic_fixture",
                order: 10,
                items: [
                    DynamicSectionItem(
                        id: "wallet",
                        type: "row",
                        titleKey: "profile.wallet",
                        systemImage: "pawprint.fill",
                        colors: ["FFB703", "FB8500"],
                        order: 10,
                        route: DynamicRoute(type: "native", name: "wallet")
                    ),
                    DynamicSectionItem(
                        id: "my_moments",
                        type: "row",
                        titleKey: "profile.moments",
                        systemImage: "camera.fill",
                        colors: ["3A86FF", "8ECAE6"],
                        order: 20,
                        route: DynamicRoute(type: "native", name: "my_moments")
                    ),
                    DynamicSection.profileShortDramaEntry,
                    DynamicSection.profileContactsEntry,
                    DynamicSectionItem(
                        id: "daily_rewards",
                        type: "row",
                        titleI18n: ["zh-Hans": "每日奖励", "en": "Daily Rewards"],
                        subtitleI18n: ["zh-Hans": "本地 fixture 动态页面", "en": "Local fixture screen"],
                        systemImage: "gift.fill",
                        colors: ["FF4D8D", "FFB703"],
                        order: 40,
                        route: DynamicRoute(type: "screen", screenID: "daily_rewards")
                    )
                ]
            )
        ]
    }
}
