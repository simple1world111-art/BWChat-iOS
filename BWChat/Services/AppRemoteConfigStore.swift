import Foundation

enum AppRemoteConfigSource: String {
    case bundled
    case cache
    case remote
    case fixture
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

    @Published private(set) var config: AppRemoteConfig
    @Published private(set) var source: AppRemoteConfigSource
    @Published private(set) var isLoading = false
    @Published private(set) var lastFetchDate: Date?
    @Published private(set) var lastETag: String?
    @Published private(set) var lastError: String?

    private let defaults: UserDefaults
    private var scopeID: String
    private var loadTask: Task<Void, Never>?

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
    }

    func load(force: Bool = false, ignoreETag: Bool = false) async {
        syncScopeIfNeeded()
        if !force,
           let lastFetchDate,
           Date().timeIntervalSince(lastFetchDate) < config.minimumRefreshInterval {
            return
        }

        if let loadTask {
            await loadTask.value
            return
        }

        let task = Task { [weak self] in
            guard let self else { return }
            await self.performLoad(ignoreETag: ignoreETag)
        }
        loadTask = task
        await task.value
        loadTask = nil
    }

    private func performLoad(ignoreETag: Bool) async {

        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await APIService.shared.fetchAppRemoteConfig(ifNoneMatch: ignoreETag ? nil : lastETag)
            let now = Date()
            lastFetchDate = now
            defaults.set(now, forKey: Self.lastFetchKey(scopeID: scopeID))

            if result.notModified {
                lastError = nil
                if let etag = result.etag {
                    lastETag = etag
                    defaults.set(etag, forKey: Self.etagKey(scopeID: scopeID))
                }
                return
            }

            guard let remoteConfig = result.config else { return }
            apply(remoteConfig, source: .remote)
            if let etag = result.etag {
                lastETag = etag
                defaults.set(etag, forKey: Self.etagKey(scopeID: scopeID))
            }
            persist(remoteConfig)
            lastError = nil
        } catch {
            lastError = error.localizedDescription
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
    }

    private func isConfigUsable(_ nextConfig: AppRemoteConfig) -> Bool {
        if nextConfig.schemaVersion > 1 { return false }
        if let minBuild = nextConfig.minSupportedBuild, AppBuildInfo.buildNumber > 0, AppBuildInfo.buildNumber < minBuild {
            return false
        }
        return true
    }

    private func persist(_ config: AppRemoteConfig) {
        guard let data = try? JSONEncoder().encode(config) else { return }
        defaults.set(data, forKey: Self.configKey(scopeID: scopeID))
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
