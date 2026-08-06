import Foundation
import SwiftUI

// MARK: - Flexible JSON

enum JSONValue: Codable, Equatable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            self = .null
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    var stringValue: String? {
        switch self {
        case .string(let value): return value
        case .number(let value): return String(Int(value))
        case .bool(let value): return value ? "true" : "false"
        default: return nil
        }
    }

    var intValue: Int? {
        switch self {
        case .number(let value): return Int(value)
        case .string(let value): return Int(value)
        default: return nil
        }
    }

    var boolValue: Bool? {
        switch self {
        case .bool(let value): return value
        case .string(let value):
            let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if ["true", "1", "yes", "y"].contains(normalized) { return true }
            if ["false", "0", "no", "n"].contains(normalized) { return false }
            return nil
        default:
            return nil
        }
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let value) = self { return value }
        return nil
    }

    var arrayValue: [JSONValue]? {
        if case .array(let value) = self { return value }
        return nil
    }
}

extension Dictionary where Key == String, Value == JSONValue {
    func string(_ key: String) -> String? { self[key]?.stringValue }
    func int(_ key: String) -> Int? { self[key]?.intValue }
    func bool(_ key: String) -> Bool? { self[key]?.boolValue }
    func object(_ key: String) -> [String: JSONValue]? { self[key]?.objectValue }
}

// MARK: - App Remote Config

struct AppRemoteConfig: Codable, Equatable {
    var schemaVersion: Int
    var configVersion: String
    var generatedAt: String?
    var minSupportedAppVersion: String?
    var minSupportedBuild: Int?
    var refreshIntervalSeconds: Int?
    var killSwitch: AppKillSwitch?
    var featureFlags: [FeatureFlag]
    var tabs: [DynamicTabDescriptor]
    var discover: DiscoverConfigData?
    var profileSections: [DynamicSection]
    var contactModules: [DynamicSection]
    var theme: DynamicTheme?
    var webViewPolicy: WebViewPolicy
    var assetManifest: RemoteAssetManifest?
    var stickerPacks: [StickerPack]?
    var wallet: WalletRemoteConfig?
    var reviewMode: ReviewModeConfig?
    var screens: [DynamicScreen]?

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case configVersion = "config_version"
        case generatedAt = "generated_at"
        case minSupportedAppVersion = "min_supported_app_version"
        case minSupportedBuild = "min_supported_build"
        case refreshIntervalSeconds = "refresh_interval_seconds"
        case killSwitch = "kill_switch"
        case featureFlags = "feature_flags"
        case tabs
        case discover
        case profileSections = "profile_sections"
        case contactModules = "contact_modules"
        case theme
        case webViewPolicy = "web_view_policy"
        case assetManifest = "asset_manifest"
        case stickerPacks = "sticker_packs"
        case wallet
        case reviewMode = "review_mode"
        case screens
    }

    init(
        schemaVersion: Int = 1,
        configVersion: String = "bundled-default",
        generatedAt: String? = nil,
        minSupportedAppVersion: String? = nil,
        minSupportedBuild: Int? = nil,
        refreshIntervalSeconds: Int? = 300,
        killSwitch: AppKillSwitch? = nil,
        featureFlags: [FeatureFlag] = [],
        tabs: [DynamicTabDescriptor] = DynamicTabDescriptor.defaultTabs,
        discover: DiscoverConfigData? = DiscoverConfigData.fallback,
        profileSections: [DynamicSection] = DynamicSection.defaultProfileSections,
        contactModules: [DynamicSection] = DynamicSection.defaultContactModules,
        theme: DynamicTheme? = nil,
        webViewPolicy: WebViewPolicy = .default,
        assetManifest: RemoteAssetManifest? = nil,
        stickerPacks: [StickerPack]? = nil,
        wallet: WalletRemoteConfig? = WalletRemoteConfig.default,
        reviewMode: ReviewModeConfig? = nil,
        screens: [DynamicScreen]? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.configVersion = configVersion
        self.generatedAt = generatedAt
        self.minSupportedAppVersion = minSupportedAppVersion
        self.minSupportedBuild = minSupportedBuild
        self.refreshIntervalSeconds = refreshIntervalSeconds
        self.killSwitch = killSwitch
        self.featureFlags = featureFlags
        self.tabs = tabs
        self.discover = discover
        self.profileSections = profileSections
        self.contactModules = contactModules
        self.theme = theme
        self.webViewPolicy = webViewPolicy
        self.assetManifest = assetManifest
        self.stickerPacks = stickerPacks
        self.wallet = wallet
        self.reviewMode = reviewMode
        self.screens = screens
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        self.configVersion = try container.decodeIfPresent(String.self, forKey: .configVersion) ?? "remote"
        self.generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
        self.minSupportedAppVersion = try container.decodeIfPresent(String.self, forKey: .minSupportedAppVersion)
        self.minSupportedBuild = try container.decodeIfPresent(Int.self, forKey: .minSupportedBuild)
        self.refreshIntervalSeconds = try container.decodeIfPresent(Int.self, forKey: .refreshIntervalSeconds) ?? 300
        self.killSwitch = try container.decodeIfPresent(AppKillSwitch.self, forKey: .killSwitch)
        if let featureFlags = try? container.decodeIfPresent([FeatureFlag].self, forKey: .featureFlags) {
            self.featureFlags = featureFlags
        } else if let featureFlagMap = try? container.decodeIfPresent([String: FeatureFlag].self, forKey: .featureFlags) {
            self.featureFlags = featureFlagMap
                .map { key, value in
                    var flag = value
                    if flag.key.isBlank {
                        flag.key = key
                    }
                    return flag
                }
                .sorted { $0.key.localizedStandardCompare($1.key) == .orderedAscending }
        } else if let featureFlagToggles = try? container.decodeIfPresent([String: Bool].self, forKey: .featureFlags) {
            self.featureFlags = featureFlagToggles
                .map { FeatureFlag(key: $0.key, enabled: $0.value) }
                .sorted { $0.key.localizedStandardCompare($1.key) == .orderedAscending }
        } else {
            self.featureFlags = []
        }
        self.tabs = (try? container.decodeIfPresent([DynamicTabDescriptor].self, forKey: .tabs)) ?? DynamicTabDescriptor.defaultTabs
        self.discover = (try? container.decodeIfPresent(DiscoverConfigData.self, forKey: .discover)) ?? .fallback
        self.profileSections = (try? container.decodeIfPresent([DynamicSection].self, forKey: .profileSections)) ?? DynamicSection.defaultProfileSections
        self.contactModules = (try? container.decodeIfPresent([DynamicSection].self, forKey: .contactModules)) ?? DynamicSection.defaultContactModules
        self.theme = try? container.decodeIfPresent(DynamicTheme.self, forKey: .theme)
        self.webViewPolicy = (try? container.decodeIfPresent(WebViewPolicy.self, forKey: .webViewPolicy)) ?? .default
        self.assetManifest = try? container.decodeIfPresent(RemoteAssetManifest.self, forKey: .assetManifest)
        self.stickerPacks = try? container.decodeIfPresent([StickerPack].self, forKey: .stickerPacks)
        StickerPackDiagnostics.logDecoded(self.stickerPacks ?? [], configVersion: self.configVersion)
        self.wallet = (try? container.decodeIfPresent(WalletRemoteConfig.self, forKey: .wallet)) ?? .default
        self.reviewMode = try? container.decodeIfPresent(ReviewModeConfig.self, forKey: .reviewMode)
        self.screens = try? container.decodeIfPresent([DynamicScreen].self, forKey: .screens)
    }

    static let bundledDefault = AppRemoteConfig()

    var minimumRefreshInterval: TimeInterval {
        TimeInterval(max(refreshIntervalSeconds ?? 300, 60))
    }

    var effectiveTabs: [DynamicTabDescriptor] {
        let hiddenTabIDs: Set<String> = ["contacts"]
        let remote = tabs.filter {
            $0.isEnabled
                && $0.isSupportedByCurrentBuild
                && !hiddenTabIDs.contains($0.id.normalizedDynamicToken)
                && !hiddenTabIDs.contains($0.route?.normalizedName ?? "")
        }
        guard !remote.isEmpty else { return DynamicTabDescriptor.defaultTabs }

        var merged: [DynamicTabDescriptor] = []
        var seen = Set<String>()
        for tab in remote.sorted(by: DynamicTabDescriptor.sort) {
            let id = tab.id.normalizedDynamicToken
            guard !seen.contains(id) else { continue }
            merged.append(tab)
            seen.insert(id)
        }

        for core in DynamicTabDescriptor.requiredCoreTabs {
            guard !seen.contains(core.id.normalizedDynamicToken) else { continue }
            merged.append(core)
        }

        return merged.sorted(by: DynamicTabDescriptor.sort)
    }

    var effectiveProfileSections: [DynamicSection] {
        DynamicSection.withProfileContactsEntry(
            DynamicSection.effective(remote: profileSections, fallback: DynamicSection.defaultProfileSections)
        )
    }

    var effectiveContactModules: [DynamicSection] {
        DynamicSection.effective(remote: contactModules, fallback: DynamicSection.defaultContactModules)
            .compactMap { section in
                var filtered = section
                filtered.items.removeAll {
                    ["agent_hub", "ai_companions"].contains($0.id.normalizedDynamicToken)
                }
                return filtered.items.isEmpty ? nil : filtered
            }
    }
}

struct AppKillSwitch: Codable, Equatable {
    var enabled: Bool
    var message: [String: String]?

    func displayMessage(language: AppLanguage = AppLanguageStore.shared.activeLanguage) -> String {
        message.localizedDynamicValue(for: language) ?? L10n.tr("common.operationFailed")
    }
}

struct FeatureFlag: Codable, Equatable, Identifiable {
    var key: String
    var enabled: Bool
    var rolloutPercentage: Int?
    var salt: String?
    var minAppVersion: String?
    var maxAppVersion: String?
    var minBuild: Int?
    var maxBuild: Int?

    var id: String { key }

    init(
        key: String,
        enabled: Bool,
        rolloutPercentage: Int? = nil,
        salt: String? = nil,
        minAppVersion: String? = nil,
        maxAppVersion: String? = nil,
        minBuild: Int? = nil,
        maxBuild: Int? = nil
    ) {
        self.key = key
        self.enabled = enabled
        self.rolloutPercentage = rolloutPercentage
        self.salt = salt
        self.minAppVersion = minAppVersion
        self.maxAppVersion = maxAppVersion
        self.minBuild = minBuild
        self.maxBuild = maxBuild
    }

    enum CodingKeys: String, CodingKey {
        case key
        case enabled
        case rolloutPercentage = "rollout_percentage"
        case salt
        case minAppVersion = "min_app_version"
        case maxAppVersion = "max_app_version"
        case minBuild = "min_build"
        case maxBuild = "max_build"
    }
}

struct DynamicTheme: Codable, Equatable {
    var colors: [String: String]?
    var cornerRadius: [String: Double]?
    var spacing: [String: Double]?

    enum CodingKeys: String, CodingKey {
        case colors
        case cornerRadius = "corner_radius"
        case spacing
    }
}

struct ReviewModeConfig: Codable, Equatable {
    var enabled: Bool?
    var label: String?
}

// MARK: - Routes

struct DynamicRoute: Codable, Equatable, Hashable {
    var type: String?
    var name: String?
    var url: String?
    var screenID: String?
    var titleKey: String?
    var title: String?
    var titleI18n: [String: String]?
    var messageKey: String?
    var message: String?
    var messageI18n: [String: String]?
    var params: [String: JSONValue]?

    enum CodingKeys: String, CodingKey {
        case type
        case name
        case url
        case screenID = "screen_id"
        case titleKey = "title_key"
        case title
        case titleI18n = "title_i18n"
        case messageKey = "message_key"
        case message
        case messageI18n = "message_i18n"
        case params
    }

    init(
        type: String? = nil,
        name: String? = nil,
        url: String? = nil,
        screenID: String? = nil,
        titleKey: String? = nil,
        title: String? = nil,
        titleI18n: [String: String]? = nil,
        messageKey: String? = nil,
        message: String? = nil,
        messageI18n: [String: String]? = nil,
        params: [String: JSONValue]? = nil
    ) {
        self.type = type
        self.name = name
        self.url = url
        self.screenID = screenID
        self.titleKey = titleKey
        self.title = title
        self.titleI18n = titleI18n
        self.messageKey = messageKey
        self.message = message
        self.messageI18n = messageI18n
        self.params = params
    }

    init(discoverRoute: DiscoverRoute) {
        self.init(
            type: discoverRoute.type,
            name: discoverRoute.name,
            url: discoverRoute.url,
            titleKey: discoverRoute.titleKey,
            title: discoverRoute.title,
            titleI18n: discoverRoute.titleI18n,
            messageKey: discoverRoute.messageKey,
            message: discoverRoute.message,
            messageI18n: discoverRoute.messageI18n
        )
    }

    var normalizedType: String {
        (type ?? "coming_soon").normalizedDynamicToken
    }

    var normalizedName: String {
        (name ?? "").normalizedDynamicToken
    }

    func displayTitle(language: AppLanguage = AppLanguageStore.shared.activeLanguage, fallback: String) -> String {
        if let localized = titleI18n.localizedDynamicValue(for: language) {
            return localized
        }
        if let titleKey, !titleKey.isDynamicBlank {
            let localized = L10n.tr(titleKey)
            if localized != titleKey { return localized }
        }
        if let title, !title.isDynamicBlank {
            return title
        }
        return fallback
    }

    func displayMessage(language: AppLanguage = AppLanguageStore.shared.activeLanguage) -> String? {
        if let localized = messageI18n.localizedDynamicValue(for: language) {
            return localized
        }
        if let messageKey, !messageKey.isDynamicBlank {
            let localized = L10n.tr(messageKey)
            if localized != messageKey { return localized }
        }
        return message?.isDynamicBlank == false ? message : nil
    }
}

// MARK: - Dynamic Sections and Tabs

struct DynamicSection: Codable, Equatable, Identifiable {
    var id: String
    var titleKey: String?
    var title: String?
    var titleI18n: [String: String]?
    var enabled: Bool?
    var order: Int?
    var items: [DynamicSectionItem]

    enum CodingKeys: String, CodingKey {
        case id
        case titleKey = "title_key"
        case title
        case titleI18n = "title_i18n"
        case enabled
        case order
        case items
    }

    init(
        id: String,
        titleKey: String? = nil,
        title: String? = nil,
        titleI18n: [String: String]? = nil,
        enabled: Bool? = nil,
        order: Int? = nil,
        items: [DynamicSectionItem]
    ) {
        self.id = id
        self.titleKey = titleKey
        self.title = title
        self.titleI18n = titleI18n
        self.enabled = enabled
        self.order = order
        self.items = items
    }

    var isEnabled: Bool { enabled ?? true }
    var sortOrder: Int { order ?? 0 }

    static func effective(remote: [DynamicSection], fallback: [DynamicSection]) -> [DynamicSection] {
        let sections = remote
            .filter(\.isEnabled)
            .sorted { $0.sortOrder < $1.sortOrder }
            .compactMap { section -> DynamicSection? in
                var next = section
                next.items = section.items
                    .filter { $0.isVisible && $0.isSupportedByCurrentBuild }
                    .sorted { $0.sortOrder < $1.sortOrder }
                return next.items.isEmpty ? nil : next
            }
        return sections.isEmpty ? fallback : sections
    }

    static let defaultProfileSections: [DynamicSection] = [
        DynamicSection(
            id: "profile_core",
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
                profilePropBagEntry,
                DynamicSectionItem(
                    id: "my_moments",
                    type: "row",
                    titleKey: "profile.moments",
                    systemImage: "camera.fill",
                    colors: ["3A86FF", "8ECAE6"],
                    order: 20,
                    route: DynamicRoute(type: "native", name: "my_moments")
                ),
                profileAgentEntry,
                profileShortDramaEntry,
                profileContactsEntry
            ]
        )
    ]

    static let profilePropBagEntry = DynamicSectionItem(
        id: "prop_bag",
        type: "row",
        titleKey: "propBag.title",
        systemImage: "shippingbox.fill",
        colors: ["675AF5", "9D64F4"],
        order: 15,
        route: DynamicRoute(type: "native", name: "prop_bag")
    )

    static let profileAgentEntry = DynamicSectionItem(
        id: "agent_hub",
        type: "row",
        titleKey: "contacts.aiCompanions",
        systemImage: "sparkles",
        colors: ["8B7CFF", "C779FF"],
        order: 25,
        route: DynamicRoute(type: "native", name: "agent_hub")
    )

    static let profileShortDramaEntry = DynamicSectionItem(
        id: "my_short_dramas",
        type: "row",
        titleKey: "profile.shortDramaStudio",
        systemImage: "play.rectangle.fill",
        colors: ["FF4D8D", "7C3AED"],
        order: 30,
        route: DynamicRoute(type: "native", name: "my_short_dramas")
    )

    static let profileContactsEntry = DynamicSectionItem(
        id: "contacts",
        type: "row",
        titleKey: "tab.contacts",
        systemImage: "person.2.fill",
        colors: ["34C759", "30B0C7"],
        order: 40,
        route: DynamicRoute(type: "native", name: "contacts")
    )

    static func withProfileContactsEntry(_ sections: [DynamicSection]) -> [DynamicSection] {
        var nextSections = sections

        if nextSections.isEmpty {
            return [
                DynamicSection(
                    id: "profile_core",
                    order: 10,
                    items: [profileAgentEntry, profileShortDramaEntry, profileContactsEntry]
                )
            ]
        }

        if !nextSections.contains(where: { section in
            section.items.contains { $0.id.normalizedDynamicToken == profileAgentEntry.id }
        }) {
            if let sectionIndex = nextSections.firstIndex(where: { section in
                section.items.contains { $0.id.normalizedDynamicToken == "my_moments" }
            }) {
                var section = nextSections[sectionIndex]
                if let momentsIndex = section.items.firstIndex(where: { $0.id.normalizedDynamicToken == "my_moments" }) {
                    section.items.insert(profileAgentEntry, at: section.items.index(after: momentsIndex))
                } else {
                    section.items.append(profileAgentEntry)
                }
                nextSections[sectionIndex] = section
            } else {
                nextSections[0].items.append(profileAgentEntry)
            }
        }

        if !nextSections.contains(where: { section in
            section.items.contains { $0.id.normalizedDynamicToken == profileShortDramaEntry.id }
        }) {
            if let sectionIndex = nextSections.firstIndex(where: { section in
                section.items.contains { $0.id.normalizedDynamicToken == "my_moments" }
            }) {
                var section = nextSections[sectionIndex]
                if let agentIndex = section.items.firstIndex(where: { $0.id.normalizedDynamicToken == profileAgentEntry.id }) {
                    section.items.insert(profileShortDramaEntry, at: section.items.index(after: agentIndex))
                } else if let momentsIndex = section.items.firstIndex(where: { $0.id.normalizedDynamicToken == "my_moments" }) {
                    section.items.insert(profileShortDramaEntry, at: section.items.index(after: momentsIndex))
                } else {
                    section.items.append(profileShortDramaEntry)
                }
                nextSections[sectionIndex] = section
            } else {
                nextSections[0].items.append(profileShortDramaEntry)
            }
        }

        if !nextSections.contains(where: { section in
            section.items.contains { $0.id.normalizedDynamicToken == profileContactsEntry.id }
        }) {
            if let sectionIndex = nextSections.firstIndex(where: { section in
                section.items.contains { $0.id.normalizedDynamicToken == profileShortDramaEntry.id }
            }) {
                var section = nextSections[sectionIndex]
                if let shortDramaIndex = section.items.firstIndex(where: { $0.id.normalizedDynamicToken == profileShortDramaEntry.id }) {
                    section.items.insert(profileContactsEntry, at: section.items.index(after: shortDramaIndex))
                } else {
                    section.items.append(profileContactsEntry)
                }
                nextSections[sectionIndex] = section
            } else {
                nextSections[0].items.append(profileContactsEntry)
            }
        }

        return nextSections
    }

    static let defaultContactModules: [DynamicSection] = [
        DynamicSection(
            id: "contacts_core",
            order: 10,
            items: [
                DynamicSectionItem(
                    id: "friend_requests",
                    type: "row",
                    titleKey: "contacts.friendRequests",
                    systemImage: "person.crop.circle.badge.clock",
                    colors: ["FF9500"],
                    order: 10,
                    route: DynamicRoute(type: "native", name: "friend_requests")
                ),
                DynamicSectionItem(
                    id: "my_groups",
                    type: "row",
                    titleKey: "contacts.myGroups",
                    systemImage: "person.3.fill",
                    colors: ["34C759", "00B894"],
                    order: 20,
                    route: DynamicRoute(type: "native", name: "my_groups")
                )
            ]
        )
    ]
}

struct DynamicSectionItem: Codable, Equatable, Identifiable {
    var id: String
    var type: String?
    var titleKey: String?
    var title: String?
    var titleI18n: [String: String]?
    var subtitleKey: String?
    var subtitle: String?
    var subtitleI18n: [String: String]?
    var systemImage: String?
    var remoteIconKey: String?
    var colors: [String]?
    var badgeKey: String?
    var badgeCount: Int?
    var dotKey: String?
    var showsDot: Bool?
    var enabled: Bool?
    var order: Int?
    var minAppVersion: String?
    var minBuild: Int?
    var route: DynamicRoute?

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case titleKey = "title_key"
        case title
        case titleI18n = "title_i18n"
        case subtitleKey = "subtitle_key"
        case subtitle
        case subtitleI18n = "subtitle_i18n"
        case systemImage = "system_image"
        case remoteIconKey = "remote_icon_key"
        case colors
        case badgeKey = "badge_key"
        case badgeCount = "badge_count"
        case dotKey = "dot_key"
        case showsDot = "shows_dot"
        case enabled
        case order
        case minAppVersion = "min_app_version"
        case minBuild = "min_build"
        case route
    }

    init(
        id: String,
        type: String? = nil,
        titleKey: String? = nil,
        title: String? = nil,
        titleI18n: [String: String]? = nil,
        subtitleKey: String? = nil,
        subtitle: String? = nil,
        subtitleI18n: [String: String]? = nil,
        systemImage: String? = nil,
        remoteIconKey: String? = nil,
        colors: [String]? = nil,
        badgeKey: String? = nil,
        badgeCount: Int? = nil,
        dotKey: String? = nil,
        showsDot: Bool? = nil,
        enabled: Bool? = nil,
        order: Int? = nil,
        minAppVersion: String? = nil,
        minBuild: Int? = nil,
        route: DynamicRoute? = nil
    ) {
        self.id = id
        self.type = type
        self.titleKey = titleKey
        self.title = title
        self.titleI18n = titleI18n
        self.subtitleKey = subtitleKey
        self.subtitle = subtitle
        self.subtitleI18n = subtitleI18n
        self.systemImage = systemImage
        self.remoteIconKey = remoteIconKey
        self.colors = colors
        self.badgeKey = badgeKey
        self.badgeCount = badgeCount
        self.dotKey = dotKey
        self.showsDot = showsDot
        self.enabled = enabled
        self.order = order
        self.minAppVersion = minAppVersion
        self.minBuild = minBuild
        self.route = route
    }

    var isEnabled: Bool { enabled ?? true }
    var isVisible: Bool { isEnabled && route?.normalizedType != "disabled" }
    var sortOrder: Int { order ?? 0 }

    var isSupportedByCurrentBuild: Bool {
        guard let minBuild else { return true }
        return AppBuildInfo.buildNumber >= minBuild
    }

    var displayColors: [Color] {
        let hexValues = (colors ?? [])
            .filter(\.isDynamicHexColor)
            .prefix(2)
        guard let first = hexValues.first else { return [] }
        guard hexValues.count > 1 else { return [Color(hex: first)] }
        return hexValues.map(Color.init(hex:))
    }

    func displayTitle(language: AppLanguage = AppLanguageStore.shared.activeLanguage) -> String {
        if let localized = titleI18n.localizedDynamicValue(for: language) {
            return localized
        }
        if let titleKey, !titleKey.isDynamicBlank {
            let localized = L10n.tr(titleKey)
            if localized != titleKey { return localized }
        }
        if let title, !title.isDynamicBlank {
            return title
        }
        return id
    }

    func displaySubtitle(language: AppLanguage = AppLanguageStore.shared.activeLanguage) -> String? {
        if let localized = subtitleI18n.localizedDynamicValue(for: language) {
            return localized
        }
        if let subtitleKey, !subtitleKey.isDynamicBlank {
            let localized = L10n.tr(subtitleKey)
            if localized != subtitleKey { return localized }
        }
        return subtitle?.isDynamicBlank == false ? subtitle : nil
    }
}

struct DynamicTabDescriptor: Codable, Equatable, Identifiable {
    var id: String
    var type: String?
    var titleKey: String?
    var title: String?
    var titleI18n: [String: String]?
    var systemImage: String?
    var selectedSystemImage: String?
    var order: Int?
    var enabled: Bool?
    var route: DynamicRoute?
    var badgeKey: String?
    var minAppVersion: String?
    var minBuild: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case titleKey = "title_key"
        case title
        case titleI18n = "title_i18n"
        case systemImage = "system_image"
        case selectedSystemImage = "selected_system_image"
        case order
        case enabled
        case route
        case badgeKey = "badge_key"
        case minAppVersion = "min_app_version"
        case minBuild = "min_build"
    }

    init(
        id: String,
        type: String? = nil,
        titleKey: String? = nil,
        title: String? = nil,
        titleI18n: [String: String]? = nil,
        systemImage: String? = nil,
        selectedSystemImage: String? = nil,
        order: Int? = nil,
        enabled: Bool? = nil,
        route: DynamicRoute? = nil,
        badgeKey: String? = nil,
        minAppVersion: String? = nil,
        minBuild: Int? = nil
    ) {
        self.id = id
        self.type = type
        self.titleKey = titleKey
        self.title = title
        self.titleI18n = titleI18n
        self.systemImage = systemImage
        self.selectedSystemImage = selectedSystemImage
        self.order = order
        self.enabled = enabled
        self.route = route
        self.badgeKey = badgeKey
        self.minAppVersion = minAppVersion
        self.minBuild = minBuild
    }

    var isEnabled: Bool { enabled ?? true }
    var normalizedType: String { (type ?? route?.type ?? "native").normalizedDynamicToken }
    var sortOrder: Int { order ?? 0 }

    var isSupportedByCurrentBuild: Bool {
        guard let minBuild else { return true }
        return AppBuildInfo.buildNumber >= minBuild
    }

    func displayTitle(language: AppLanguage = AppLanguageStore.shared.activeLanguage) -> String {
        if let localized = titleI18n.localizedDynamicValue(for: language) {
            return localized
        }
        if let titleKey, !titleKey.isDynamicBlank {
            let localized = L10n.tr(titleKey)
            if localized != titleKey { return localized }
        }
        if let title, !title.isDynamicBlank {
            return title
        }
        return id
    }

    static func sort(lhs: DynamicTabDescriptor, rhs: DynamicTabDescriptor) -> Bool {
        if lhs.sortOrder == rhs.sortOrder { return lhs.id < rhs.id }
        return lhs.sortOrder < rhs.sortOrder
    }

    static let defaultTabs: [DynamicTabDescriptor] = [
        DynamicTabDescriptor(
            id: "messages",
            type: "native",
            titleKey: "tab.messages",
            systemImage: "bubble.left.and.bubble.right",
            selectedSystemImage: "bubble.left.and.bubble.right.fill",
            order: 10,
            route: DynamicRoute(type: "native", name: "messages")
        ),
        DynamicTabDescriptor(
            id: "map",
            type: "native",
            titleKey: "tab.map",
            systemImage: "map",
            selectedSystemImage: "map.fill",
            order: 30,
            route: DynamicRoute(type: "native", name: "map")
        ),
        DynamicTabDescriptor(
            id: "discover",
            type: "native",
            titleKey: "tab.discover",
            systemImage: "safari",
            selectedSystemImage: "safari.fill",
            order: 40,
            route: DynamicRoute(type: "native", name: "discover")
        ),
        DynamicTabDescriptor(
            id: "profile",
            type: "native",
            titleKey: "tab.profile",
            systemImage: "gearshape",
            selectedSystemImage: "gearshape.fill",
            order: 50,
            route: DynamicRoute(type: "native", name: "profile")
        )
    ]

    static let requiredCoreTabs = defaultTabs.filter { ["messages", "discover", "profile"].contains($0.id) }
}

// MARK: - Web and Assets

struct WebViewPolicy: Codable, Equatable {
    /// Bundled rollout baseline for production-hosted games. This is merged
    /// into the effective `allowedDomains` list before game URL validation;
    /// `blockedDomains` still has final precedence.
    static let bundledGameDomains = ["id7.com"]

    var allowedDomains: [String]
    var blockedDomains: [String]?
    var allowedBridgeMethods: [String]
    var externalDomainsOpenInSafari: Bool?
    var requireHTTPS: Bool?
    var permissionPolicy: [String: String]?

    enum CodingKeys: String, CodingKey {
        case allowedDomains = "allowed_domains"
        case blockedDomains = "blocked_domains"
        case allowedBridgeMethods = "allowed_bridge_methods"
        case externalDomainsOpenInSafari = "external_domains_open_in_safari"
        case requireHTTPS = "require_https"
        case permissionPolicy = "permission_policy"
    }

    init(
        allowedDomains: [String],
        blockedDomains: [String]? = nil,
        allowedBridgeMethods: [String] = ["close", "openRoute", "getAppInfo", "setNavigationTitle"],
        externalDomainsOpenInSafari: Bool? = true,
        requireHTTPS: Bool? = true,
        permissionPolicy: [String: String]? = nil
    ) {
        self.allowedDomains = allowedDomains
        self.blockedDomains = blockedDomains
        self.allowedBridgeMethods = allowedBridgeMethods
        self.externalDomainsOpenInSafari = externalDomainsOpenInSafari
        self.requireHTTPS = requireHTTPS
        self.permissionPolicy = permissionPolicy
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.allowedDomains = try container.decodeIfPresent([String].self, forKey: .allowedDomains) ?? []
        self.blockedDomains = try container.decodeIfPresent([String].self, forKey: .blockedDomains)
        self.allowedBridgeMethods = try container.decodeIfPresent([String].self, forKey: .allowedBridgeMethods)
            ?? ["close", "openRoute", "getAppInfo", "setNavigationTitle"]
        self.externalDomainsOpenInSafari = try container.decodeIfPresent(Bool.self, forKey: .externalDomainsOpenInSafari) ?? true
        self.requireHTTPS = try container.decodeIfPresent(Bool.self, forKey: .requireHTTPS) ?? true
        self.permissionPolicy = try container.decodeIfPresent([String: String].self, forKey: .permissionPolicy)
    }

    static let `default` = WebViewPolicy(
        allowedDomains: ["id7.com", "playdot.games"],
        blockedDomains: [],
        allowedBridgeMethods: ["close", "openRoute", "getAppInfo", "setNavigationTitle"],
        externalDomainsOpenInSafari: true,
        requireHTTPS: true,
        permissionPolicy: nil
    )

    func allows(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let host = url.host?.lowercased() else {
            return false
        }

        if requireHTTPS ?? true, scheme != "https" {
            #if DEBUG
            if host == "localhost" || host == "127.0.0.1" { return true }
            #endif
            return false
        }

        if (blockedDomains ?? []).contains(where: { host.matchesDynamicDomain($0) }) {
            return false
        }
        return allowedDomains.contains { host.matchesDynamicDomain($0) }
    }

    var gameLaunchPolicy: WebViewPolicy {
        var policy = self
        for domain in Self.bundledGameDomains where !policy.allowedDomains.contains(where: {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
                .caseInsensitiveCompare(domain) == .orderedSame
        }) {
            policy.allowedDomains.append(domain)
        }
        return policy
    }
}

struct RemoteAssetManifest: Codable, Equatable {
    var version: String?
    var generatedAt: String?
    var assets: [RemoteAsset]

    enum CodingKeys: String, CodingKey {
        case version
        case generatedAt = "generated_at"
        case assets
    }

    var assetsByKey: [String: RemoteAsset] {
        Dictionary(uniqueKeysWithValues: assets.map { ($0.key, $0) })
    }
}

struct RemoteAsset: Codable, Equatable, Identifiable {
    var key: String
    var url: String
    var sha256: String?
    var contentType: String?
    var byteSize: Int?
    var width: Int?
    var height: Int?
    var tags: [String]?
    var cachePolicy: String?
    var expiresAt: String?
    var fallbackAssetName: String?
    var minAppVersion: String?

    enum CodingKeys: String, CodingKey {
        case key
        case url
        case sha256
        case contentType = "content_type"
        case byteSize = "byte_size"
        case width
        case height
        case tags
        case cachePolicy = "cache_policy"
        case expiresAt = "expires_at"
        case fallbackAssetName = "fallback_asset_name"
        case minAppVersion = "min_app_version"
    }

    init(
        key: String,
        url: String,
        sha256: String? = nil,
        contentType: String? = nil,
        byteSize: Int? = nil,
        width: Int? = nil,
        height: Int? = nil,
        tags: [String]? = nil,
        cachePolicy: String? = nil,
        expiresAt: String? = nil,
        fallbackAssetName: String? = nil,
        minAppVersion: String? = nil
    ) {
        self.key = key
        self.url = url
        self.sha256 = sha256
        self.contentType = contentType
        self.byteSize = byteSize
        self.width = width
        self.height = height
        self.tags = tags
        self.cachePolicy = cachePolicy
        self.expiresAt = expiresAt
        self.fallbackAssetName = fallbackAssetName
        self.minAppVersion = minAppVersion
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.key = try container.decode(String.self, forKey: .key)
        self.url = try container.decode(String.self, forKey: .url)
        self.sha256 = try container.decodeIfPresent(String.self, forKey: .sha256)
        self.contentType = try container.decodeIfPresent(String.self, forKey: .contentType)
        self.byteSize = try container.decodeIfPresent(Int.self, forKey: .byteSize)
        self.width = try container.decodeIfPresent(Int.self, forKey: .width)
        self.height = try container.decodeIfPresent(Int.self, forKey: .height)
        self.tags = try container.decodeIfPresent([String].self, forKey: .tags)
        self.cachePolicy = (try? container.decodeIfPresent(String.self, forKey: .cachePolicy)) ?? nil
        self.expiresAt = try container.decodeIfPresent(String.self, forKey: .expiresAt)
        self.fallbackAssetName = try container.decodeIfPresent(String.self, forKey: .fallbackAssetName)
        self.minAppVersion = try container.decodeIfPresent(String.self, forKey: .minAppVersion)
    }

    var id: String { key }
}

// MARK: - Wallet

struct WalletRemoteConfig: Codable, Equatable {
    var goldCoinProducts: [WalletRemoteProduct]?
    var withdrawalNetworks: [WalletWithdrawalNetworkRemoteConfig]?
    var exchangeRateDisplay: String?
    var usdtPerGoldCoin: Double?
    var minimumWithdrawalUSDT: Double?
    var withdrawalStepUSDT: Double?
    var termsURL: String?
    var adRewardEnabled: Bool?
    var adReward: WalletAdRewardRemoteConfig?
    var activityCatFood: WalletActivityCatFoodRemoteConfig?
    var activityCatFoodEnabled: Bool?

    enum CodingKeys: String, CodingKey {
        case goldCoinProducts = "gold_coin_products"
        case withdrawalNetworks = "withdrawal_networks"
        case exchangeRateDisplay = "exchange_rate_display"
        case usdtPerGoldCoin = "usdt_per_gold_coin"
        case minimumWithdrawalUSDT = "minimum_withdrawal_usdt"
        case withdrawalStepUSDT = "withdrawal_step_usdt"
        case termsURL = "terms_url"
        case adRewardEnabled = "ad_reward_enabled"
        case adReward = "ad_reward"
        case activityCatFood = "activity_cat_food"
        case activityCatFoodEnabled = "activity_cat_food_enabled"
    }

    init(
        goldCoinProducts: [WalletRemoteProduct]? = nil,
        withdrawalNetworks: [String]? = nil,
        exchangeRateDisplay: String? = nil,
        usdtPerGoldCoin: Double? = nil,
        minimumWithdrawalUSDT: Double? = nil,
        withdrawalStepUSDT: Double? = nil,
        termsURL: String? = nil,
        adRewardEnabled: Bool? = nil,
        adReward: WalletAdRewardRemoteConfig? = nil,
        activityCatFood: WalletActivityCatFoodRemoteConfig? = nil,
        activityCatFoodEnabled: Bool? = nil
    ) {
        self.goldCoinProducts = goldCoinProducts
        self.withdrawalNetworks = withdrawalNetworks?.map {
            WalletWithdrawalNetworkRemoteConfig(network: $0)
        }
        self.exchangeRateDisplay = exchangeRateDisplay
        self.usdtPerGoldCoin = usdtPerGoldCoin
        self.minimumWithdrawalUSDT = minimumWithdrawalUSDT
        self.withdrawalStepUSDT = withdrawalStepUSDT
        self.termsURL = termsURL
        self.adRewardEnabled = adRewardEnabled
        self.adReward = adReward
        self.activityCatFood = activityCatFood
        self.activityCatFoodEnabled = activityCatFoodEnabled
    }

    /// Wallet configuration is owned by several backend modules and some fields
    /// have evolved from scalar values to structured payloads. Decode every
    /// section independently so an unrelated schema change cannot discard the
    /// rewarded-ad configuration.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.goldCoinProducts = try? container.decodeIfPresent(
            [WalletRemoteProduct].self,
            forKey: .goldCoinProducts
        )

        if let networks = try? container.decodeIfPresent(
            [String].self,
            forKey: .withdrawalNetworks
        ) {
            self.withdrawalNetworks = networks.map {
                WalletWithdrawalNetworkRemoteConfig(network: $0)
            }
        } else if let networks = try? container.decodeIfPresent(
            [WalletWithdrawalNetworkRemoteConfig].self,
            forKey: .withdrawalNetworks
        ) {
            self.withdrawalNetworks = networks
        } else {
            self.withdrawalNetworks = nil
        }

        self.exchangeRateDisplay = try? container.decodeIfPresent(
            String.self,
            forKey: .exchangeRateDisplay
        )
        self.usdtPerGoldCoin = container.flexDouble(for: .usdtPerGoldCoin)
        self.minimumWithdrawalUSDT = container.flexDouble(for: .minimumWithdrawalUSDT)
        self.withdrawalStepUSDT = container.flexDouble(for: .withdrawalStepUSDT)
        self.termsURL = try? container.decodeIfPresent(String.self, forKey: .termsURL)
        self.adRewardEnabled = try? container.decodeIfPresent(Bool.self, forKey: .adRewardEnabled)
        self.adReward = try? container.decodeIfPresent(
            WalletAdRewardRemoteConfig.self,
            forKey: .adReward
        )
        self.activityCatFood = try? container.decodeIfPresent(
            WalletActivityCatFoodRemoteConfig.self,
            forKey: .activityCatFood
        )
        self.activityCatFoodEnabled = try? container.decodeIfPresent(
            Bool.self,
            forKey: .activityCatFoodEnabled
        )
    }

    static let `default` = WalletRemoteConfig(
        goldCoinProducts: AppConfig.goldCoinProducts.enumerated().map { index, product in
            WalletRemoteProduct(
                productID: product.productID,
                goldCoinAmount: product.coins,
                order: (index + 1) * 10,
                recommended: false,
                badgeI18n: nil
            )
        },
        withdrawalNetworks: ["TRC20", "ERC20", "BEP20"],
        exchangeRateDisplay: nil,
        usdtPerGoldCoin: WalletWithdrawalPolicy.fallback.usdtPerGoldCoin,
        minimumWithdrawalUSDT: WalletWithdrawalPolicy.fallback.minimumUSDT,
        withdrawalStepUSDT: WalletWithdrawalPolicy.fallback.stepUSDT,
        termsURL: nil,
        adRewardEnabled: true,
        adReward: WalletAdRewardRemoteConfig(
            iosAdUnitIDs: AdMobConfiguration.bundledGameRewardedAdUnitIDs,
            rewardItem: WalletCurrency.goldCoins.rawValue
        ),
        activityCatFood: nil,
        activityCatFoodEnabled: nil
    )

    var effectiveGoldCoinProducts: [GoldCoinProductConfig] {
        let knownByID = Dictionary(uniqueKeysWithValues: AppConfig.goldCoinProducts.map { ($0.productID, $0) })
        let remoteProducts = (goldCoinProducts ?? [])
            .filter { knownByID[$0.productID] != nil }
            .sorted { ($0.order ?? Int.max) < ($1.order ?? Int.max) }
            .compactMap { remote -> GoldCoinProductConfig? in
                guard let fallback = knownByID[remote.productID] else { return nil }
                return GoldCoinProductConfig(
                    productID: remote.productID,
                    coins: remote.goldCoinAmount ?? fallback.coins,
                    fallbackPriceUSD: fallback.fallbackPriceUSD
                )
            }
        return remoteProducts.isEmpty ? AppConfig.goldCoinProducts : remoteProducts
    }

    var effectiveWithdrawalNetworks: [String] {
        let cleaned = (withdrawalNetworks ?? [])
            .filter { $0.enabled != false }
            .map { $0.network.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return cleaned.isEmpty ? ["TRC20", "ERC20", "BEP20"] : cleaned
    }

    func effectiveWithdrawalPolicy(for network: String?) -> WalletWithdrawalPolicy {
        let normalizedNetwork = network?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let networkConfig = withdrawalNetworks?
            .filter { $0.enabled != false }
            .first { item in
                guard let normalizedNetwork, !normalizedNetwork.isEmpty else { return false }
                return item.network.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                    == normalizedNetwork
            }
        let enabledNetworkMinimum = withdrawalNetworks?
            .filter { $0.enabled != false }
            .compactMap(\.minimumUSDT)
            .filter { $0 > 0 }
            .min()

        return WalletWithdrawalPolicy(
            usdtPerGoldCoin: networkConfig?.usdtPerGoldCoin
                ?? usdtPerGoldCoin
                ?? WalletWithdrawalPolicy.fallback.usdtPerGoldCoin,
            minimumUSDT: networkConfig?.minimumUSDT
                ?? minimumWithdrawalUSDT
                ?? enabledNetworkMinimum
                ?? WalletWithdrawalPolicy.fallback.minimumUSDT,
            stepUSDT: networkConfig?.stepUSDT
                ?? withdrawalStepUSDT
                ?? WalletWithdrawalPolicy.fallback.stepUSDT
        )
    }

    var effectiveActivityCatFoodEnabled: Bool {
        activityCatFood?.enabled == true || activityCatFoodEnabled == true
    }
}

struct WalletActivityCatFoodRemoteConfig: Codable, Equatable {
    let enabled: Bool?
}

/// Trusted app configuration for rewarded ads initiated by hosted H5 games.
/// The backend can replace this list without requiring an App Store release.
struct WalletAdRewardRemoteConfig: Codable, Equatable {
    var iosAdUnitIDs: [String]?
    var iosWalletAdUnitID: String?
    var rewardItem: String?

    enum CodingKeys: String, CodingKey {
        case iosAdUnitIDs = "ios_ad_unit_ids"
        case iosWalletAdUnitID = "ios_wallet_ad_unit_id"
        case rewardItem = "reward_item"
    }

    init(
        iosAdUnitIDs: [String]? = nil,
        iosWalletAdUnitID: String? = nil,
        rewardItem: String? = nil
    ) {
        self.iosAdUnitIDs = iosAdUnitIDs
        self.iosWalletAdUnitID = iosWalletAdUnitID
        self.rewardItem = rewardItem
    }

    var rewardsGoldCoins: Bool {
        rewardItem?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            == WalletCurrency.goldCoins.rawValue
    }
}

struct WalletWithdrawalPolicy: Equatable {
    let usdtPerGoldCoin: Double
    let minimumUSDT: Double
    let stepUSDT: Double

    static let fallback = WalletWithdrawalPolicy(
        usdtPerGoldCoin: 0.005,
        minimumUSDT: 0.5,
        stepUSDT: 0.5
    )

    init(usdtPerGoldCoin: Double, minimumUSDT: Double, stepUSDT: Double) {
        self.usdtPerGoldCoin = usdtPerGoldCoin > 0 ? usdtPerGoldCoin : 0.005
        self.minimumUSDT = minimumUSDT > 0 ? minimumUSDT : 0.5
        self.stepUSDT = stepUSDT > 0 ? stepUSDT : 0.5
    }

    func rawUSDTAmount(forGoldCoins goldCoinAmount: Int) -> Double {
        Double(max(goldCoinAmount, 0)) * usdtPerGoldCoin
    }

    func maximumUSDTAmount(forGoldCoins goldCoinAmount: Int) -> Double {
        let rawAmount = rawUSDTAmount(forGoldCoins: goldCoinAmount)
        guard rawAmount + 0.000_000_1 >= stepUSDT else { return 0 }
        return floor((rawAmount + 0.000_000_1) / stepUSDT) * stepUSDT
    }

    func canWithdraw(goldCoinAmount: Int) -> Bool {
        maximumUSDTAmount(forGoldCoins: goldCoinAmount) + 0.000_000_1 >= minimumUSDT
    }

    func isValidUSDTIncrement(_ amount: Double) -> Bool {
        guard amount > 0 else { return false }
        let units = amount / stepUSDT
        return abs(units - units.rounded()) < 0.000_001
    }

    func requiredGoldCoins(forUSDT amount: Double) -> Int {
        max(1, Int((amount / usdtPerGoldCoin).rounded(.up)))
    }
}

struct WalletWithdrawalNetworkRemoteConfig: Codable, Equatable, Identifiable {
    let network: String
    let enabled: Bool?
    let minimumUSDT: Double?
    let stepUSDT: Double?
    let usdtPerGoldCoin: Double?

    var id: String { network }

    enum CodingKeys: String, CodingKey {
        case network
        case enabled
        case minimumUSDT = "min_usdt"
        case stepUSDT = "step_usdt"
        case usdtPerGoldCoin = "usdt_per_gold_coin"
    }

    init(
        network: String,
        enabled: Bool? = true,
        minimumUSDT: Double? = nil,
        stepUSDT: Double? = nil,
        usdtPerGoldCoin: Double? = nil
    ) {
        self.network = network
        self.enabled = enabled
        self.minimumUSDT = minimumUSDT
        self.stepUSDT = stepUSDT
        self.usdtPerGoldCoin = usdtPerGoldCoin
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        network = container.flexString(for: .network) ?? ""
        enabled = container.flexBool(for: .enabled)
        minimumUSDT = container.flexDouble(for: .minimumUSDT)
        stepUSDT = container.flexDouble(for: .stepUSDT)
        usdtPerGoldCoin = container.flexDouble(for: .usdtPerGoldCoin)
    }
}

struct WalletRemoteProduct: Codable, Equatable, Identifiable {
    var productID: String
    var goldCoinAmount: Int?
    var order: Int?
    var recommended: Bool?
    var badgeI18n: [String: String]?

    var id: String { productID }

    enum CodingKeys: String, CodingKey {
        case productID = "product_id"
        case goldCoinAmount = "gold_coin_amount"
        case order = "sort_order"
        case recommended
        case badgeI18n = "badge_i18n"
    }
}

// MARK: - Dynamic Screens

struct DynamicScreen: Codable, Equatable, Identifiable {
    var screenID: String
    var schemaVersion: Int?
    var configVersion: String?
    var titleKey: String?
    var title: String?
    var titleI18n: [String: String]?
    var refreshIntervalSeconds: Int?
    var components: [DynamicComponent]

    enum CodingKeys: String, CodingKey {
        case screenID = "screen_id"
        case schemaVersion = "schema_version"
        case configVersion = "config_version"
        case titleKey = "title_key"
        case title
        case titleI18n = "title_i18n"
        case refreshIntervalSeconds = "refresh_interval_seconds"
        case components
    }

    init(
        screenID: String,
        schemaVersion: Int? = 1,
        configVersion: String? = nil,
        titleKey: String? = nil,
        title: String? = nil,
        titleI18n: [String: String]? = nil,
        refreshIntervalSeconds: Int? = nil,
        components: [DynamicComponent]
    ) {
        self.screenID = screenID
        self.schemaVersion = schemaVersion
        self.configVersion = configVersion
        self.titleKey = titleKey
        self.title = title
        self.titleI18n = titleI18n
        self.refreshIntervalSeconds = refreshIntervalSeconds
        self.components = components
    }

    var id: String { screenID }

    func displayTitle(language: AppLanguage = AppLanguageStore.shared.activeLanguage) -> String {
        if let localized = titleI18n.localizedDynamicValue(for: language) {
            return localized
        }
        if let titleKey, !titleKey.isDynamicBlank {
            let localized = L10n.tr(titleKey)
            if localized != titleKey { return localized }
        }
        if let title, !title.isDynamicBlank { return title }
        return screenID
    }

    static let dailyRewardsFixture = DynamicScreen(
        screenID: "daily_rewards",
        schemaVersion: 1,
        configVersion: "bundled-fixture",
        titleI18n: ["zh-Hans": "每日奖励", "en": "Daily Rewards"],
        components: [
            DynamicComponent(
                id: "hero",
                type: "banner",
                props: [
                    "title": .object(["zh-Hans": .string("今天也来领金币"), "en": .string("Claim today's gold coins")]),
                    "subtitle": .object(["zh-Hans": .string("完成聊天、发动态、送礼物获得奖励"), "en": .string("Chat, post, and gift to earn rewards")]),
                    "system_image": .string("gift.fill")
                ],
                action: nil,
                children: nil
            ),
            DynamicComponent(
                id: "wallet",
                type: "walletBalance",
                props: [:],
                action: DynamicRoute(type: "native", name: "wallet"),
                children: nil
            ),
            DynamicComponent(
                id: "open_moments",
                type: "button",
                props: [
                    "title": .object(["zh-Hans": .string("去发动态"), "en": .string("Post a Moment")])
                ],
                action: DynamicRoute(type: "native", name: "moments"),
                children: nil
            )
        ]
    )

    static let festivalHomeFixture = DynamicScreen(
        screenID: "festival_home",
        schemaVersion: 1,
        configVersion: "bundled-fixture",
        titleI18n: ["zh-Hans": "节日活动", "en": "Festival"],
        components: [
            DynamicComponent(
                id: "festival_banner",
                type: "banner",
                props: [
                    "title": .object(["zh-Hans": .string("限时活动进行中"), "en": .string("Limited-time event")]),
                    "subtitle": .object(["zh-Hans": .string("入口、文案、图片都可以由配置更新"), "en": .string("Entry, copy, and artwork are config-driven")]),
                    "system_image": .string("sparkles")
                ],
                action: DynamicRoute(type: "native", name: "moments")
            ),
            DynamicComponent(
                id: "open_rewards",
                type: "actionRow",
                props: [
                    "title": .object(["zh-Hans": .string("领取每日奖励"), "en": .string("Claim daily rewards")]),
                    "system_image": .string("gift.fill")
                ],
                action: DynamicRoute(type: "screen", screenID: "daily_rewards")
            )
        ]
    )

    static let agentHubFixture = DynamicScreen(
        screenID: "agent_hub",
        schemaVersion: 1,
        configVersion: "bundled-fixture",
        titleI18n: ["zh-Hans": "我的智能体", "en": "My Agents"],
        components: [
            DynamicComponent(
                id: "agent_intro",
                type: "text",
                props: [
                    "title": .object(["zh-Hans": .string("我的智能体"), "en": .string("My Agents")]),
                    "style": .string("title")
                ]
            ),
            DynamicComponent(
                id: "agent_list",
                type: "agentList",
                props: [:],
                action: DynamicRoute(type: "native", name: "agent_hub")
            )
        ]
    )

    static let helpCenterFixture = DynamicScreen(
        screenID: "help_center",
        schemaVersion: 1,
        configVersion: "bundled-fixture",
        titleI18n: ["zh-Hans": "帮助中心", "en": "Help Center"],
        components: [
            DynamicComponent(
                id: "help_rows",
                type: "card",
                children: [
                    DynamicComponent(
                        id: "wallet_help",
                        type: "row",
                        props: [
                            "title": .object(["zh-Hans": .string("钱包与金币"), "en": .string("Wallet and gold coins")]),
                            "system_image": .string("pawprint.fill")
                        ],
                        action: DynamicRoute(type: "screen", screenID: "wallet_terms")
                    ),
                    DynamicComponent(
                        id: "settings",
                        type: "row",
                        props: [
                            "title": .object(["zh-Hans": .string("账号设置"), "en": .string("Account settings")]),
                            "system_image": .string("gearshape.fill")
                        ],
                        action: DynamicRoute(type: "native", name: "settings")
                    )
                ]
            )
        ]
    )

    static let walletTermsFixture = DynamicScreen(
        screenID: "wallet_terms",
        schemaVersion: 1,
        configVersion: "bundled-fixture",
        titleI18n: ["zh-Hans": "钱包说明", "en": "Wallet Terms"],
        components: [
            DynamicComponent(
                id: "wallet_terms_text",
                type: "text",
                props: [
                    "title": .object(["zh-Hans": .string("金币购买始终通过 App Store StoreKit 完成。价格以系统展示为准。"), "en": .string("Gold Coins purchases always use App Store StoreKit. System price display is authoritative.")])
                ]
            )
        ]
    )

    static let bundledFixtures: [DynamicScreen] = [
        dailyRewardsFixture,
        festivalHomeFixture,
        agentHubFixture,
        helpCenterFixture,
        walletTermsFixture
    ]
}

struct DynamicComponent: Codable, Equatable, Identifiable {
    var id: String
    var type: String
    var visible: Bool?
    var minAppVersion: String?
    var maxAppVersion: String?
    var props: [String: JSONValue]
    var action: DynamicRoute?
    var children: [DynamicComponent]?

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case visible
        case minAppVersion = "min_app_version"
        case maxAppVersion = "max_app_version"
        case props
        case action
        case children
    }

    init(
        id: String,
        type: String,
        visible: Bool? = nil,
        minAppVersion: String? = nil,
        maxAppVersion: String? = nil,
        props: [String: JSONValue] = [:],
        action: DynamicRoute? = nil,
        children: [DynamicComponent]? = nil
    ) {
        self.id = id
        self.type = type
        self.visible = visible
        self.minAppVersion = minAppVersion
        self.maxAppVersion = maxAppVersion
        self.props = props
        self.action = action
        self.children = children
    }

    var isVisible: Bool { visible ?? true }
}

// MARK: - Shared Helpers

enum AppBuildInfo {
    static var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }

    static var buildNumber: Int {
        if let value = Bundle.main.infoDictionary?["CFBundleVersion"] as? String,
           let intValue = Int(value) {
            return intValue
        }
        if let value = Bundle.main.infoDictionary?["CFBundleVersion"] as? Int {
            return value
        }
        return 0
    }
}

extension Optional where Wrapped == [String: String] {
    func localizedDynamicValue(for language: AppLanguage) -> String? {
        guard let dictionary = self else { return nil }
        return dictionary.localizedDynamicValue(for: language)
    }
}

extension Dictionary where Key == String, Value == String {
    func localizedDynamicValue(for language: AppLanguage) -> String? {
        let languageCode = language.rawValue
        let candidates = [
            languageCode,
            language.localeIdentifier,
            languageCode.split(separator: "-").first.map(String.init) ?? "",
            "en",
            "zh-Hans"
        ]
        for key in candidates {
            if let value = self[key], !value.isDynamicBlank {
                return value
            }
        }
        return nil
    }
}

extension String {
    var isDynamicBlank: Bool {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var normalizedDynamicToken: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "-", with: "_")
            .lowercased()
    }

    var isDynamicHexColor: Bool {
        let value = trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        guard value.count == 6 || value.count == 8 else { return false }
        return UInt64(value, radix: 16) != nil
    }

    func matchesDynamicDomain(_ pattern: String) -> Bool {
        let host = lowercased()
        let normalized = pattern
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard !normalized.isEmpty else { return false }
        if host == normalized { return true }
        return host.hasSuffix("." + normalized)
    }
}
