import SwiftUI

struct DiscoverConfigData: Codable, Equatable {
    var schemaVersion: Int?
    var sections: [DiscoverSection]
    var meta: DiscoverConfigMeta?

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case sections
        case meta
    }

    var effectiveSections: [DiscoverSection] {
        let normalizedSections = sections
            .filter(\.isEnabled)
            .sorted { $0.sortOrder < $1.sortOrder }
            .compactMap { section in
                var next = section
                next.items = section.items
                    .filter(\.isVisible)
                    .sorted { $0.sortOrder < $1.sortOrder }
                return next.items.isEmpty ? nil : next
            }
        return Self.sectionsPreservingDefaultBlocks(normalizedSections)
    }

    init(
        schemaVersion: Int? = 1,
        sections: [DiscoverSection],
        meta: DiscoverConfigMeta? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.sections = sections
        self.meta = meta
    }

    static let fallback = DiscoverConfigData(sections: defaultSections)

    static let defaultSections: [DiscoverSection] = [
        DiscoverSection(
            id: "social",
            order: 10,
            items: [
                DiscoverItem(
                    id: "moments",
                    titleKey: "discover.moments",
                    systemImage: "camera.fill",
                    colors: ["667EEA", "764BA2"],
                    badgeKey: "moments_unread",
                    dotKey: "moments_new",
                    order: 10,
                    route: DiscoverRoute(type: "native", name: "moments")
                )
            ]
        ),
        DiscoverSection(
            id: "entertainment",
            order: 20,
            items: [
                DiscoverItem(
                    id: "games",
                    titleKey: "discover.games",
                    systemImage: "gamecontroller.fill",
                    colors: ["FF6B6B", "FF8E53"],
                    order: 10,
                    route: DiscoverRoute(type: "native", name: "game_center")
                ),
                DiscoverItem(
                    id: "short_drama",
                    titleKey: "discover.shortDrama",
                    systemImage: "play.rectangle.fill",
                    colors: ["00C6FF", "0072FF"],
                    order: 20,
                    route: DiscoverRoute(type: "native", name: "short_drama")
                ),
                DiscoverItem(
                    id: "live",
                    titleKey: "discover.live",
                    systemImage: "dot.radiowaves.left.and.right",
                    colors: ["FF4D8D", "FF8A3D"],
                    order: 30,
                    route: DiscoverRoute(type: "coming_soon")
                )
            ]
        ),
        DiscoverSection(
            id: "community",
            order: 30,
            items: [
                DiscoverItem(
                    id: "stories",
                    titleKey: "discover.stories",
                    systemImage: "book.closed.fill",
                    colors: ["7F5AF0", "FF7A90"],
                    order: 10,
                    route: DiscoverRoute(type: "native", name: "script_center")
                ),
                DiscoverItem(
                    id: "groups",
                    titleKey: "discover.groups",
                    systemImage: "person.3.fill",
                    colors: ["34C759", "00B894"],
                    order: 20,
                    route: DiscoverRoute(type: "native", name: "groups")
                )
            ]
        ),
        DiscoverSection(
            id: "benefits",
            order: 40,
            items: [
                DiscoverItem(
                    id: "benefits",
                    titleKey: "discover.benefits",
                    systemImage: "gift.fill",
                    colors: ["FFB703", "FB8500"],
                    order: 10,
                    route: DiscoverRoute(type: "coming_soon")
                )
            ]
        )
    ]

    private static let defaultSectionIDs = ["social", "entertainment", "community", "benefits"]

    private static let defaultSectionOrders: [String: Int] = [
        "social": 10,
        "entertainment": 20,
        "community": 30,
        "benefits": 40
    ]

    private static let defaultItemSectionIDs: [String: String] = [
        "moments": "social",
        "games": "entertainment",
        "short_drama": "entertainment",
        "live": "entertainment",
        "stories": "community",
        "groups": "community",
        "benefits": "benefits"
    ]

    private static let movedOutOfDiscoverItemIDs: Set<String> = [
        "nearby",
        "map",
        "map_dating"
    ]

    private static func sectionsPreservingDefaultBlocks(_ sections: [DiscoverSection]) -> [DiscoverSection] {
        var defaultItemsBySectionID: [String: [DiscoverItem]] = [:]
        var customSections: [DiscoverSection] = []

        for section in sections {
            var customItems: [DiscoverItem] = []
            for item in section.items {
                guard !movedOutOfDiscoverItemIDs.contains(item.id.normalizedDiscoverToken) else {
                    continue
                }
                if let sectionID = defaultItemSectionIDs[item.id.normalizedDiscoverToken] {
                    defaultItemsBySectionID[sectionID, default: []].append(item)
                } else {
                    customItems.append(item)
                }
            }

            if !customItems.isEmpty {
                var customSection = section
                customSection.items = customItems.sorted { $0.sortOrder < $1.sortOrder }
                customSections.append(customSection)
            }
        }

        let defaultSections = defaultSectionIDs.compactMap { sectionID -> DiscoverSection? in
            guard let items = defaultItemsBySectionID[sectionID], !items.isEmpty else { return nil }
            let sourceSection = sections.first { $0.id.normalizedDiscoverToken == sectionID }
            return DiscoverSection(
                id: sectionID,
                enabled: true,
                order: sourceSection?.order ?? defaultSectionOrders[sectionID],
                items: items.sorted { $0.sortOrder < $1.sortOrder }
            )
        }

        return (defaultSections + customSections)
            .sorted { $0.sortOrder < $1.sortOrder }
    }
}

struct DiscoverConfigMeta: Codable, Equatable {
    var refreshIntervalSeconds: Int?
    var generatedAt: String?

    enum CodingKeys: String, CodingKey {
        case refreshIntervalSeconds = "refresh_interval_seconds"
        case generatedAt = "generated_at"
    }
}

struct DiscoverSection: Codable, Equatable, Identifiable {
    var id: String
    var enabled: Bool?
    var order: Int?
    var items: [DiscoverItem]

    enum CodingKeys: String, CodingKey {
        case id
        case enabled
        case order
        case items
    }

    init(
        id: String,
        enabled: Bool? = nil,
        order: Int? = nil,
        items: [DiscoverItem]
    ) {
        self.id = id
        self.enabled = enabled
        self.order = order
        self.items = items
    }

    var isEnabled: Bool { enabled ?? true }
    var sortOrder: Int { order ?? 0 }
}

struct DiscoverItem: Codable, Equatable, Identifiable {
    var id: String
    var titleKey: String?
    var title: String?
    var titleI18n: [String: String]?
    var systemImage: String?
    var colors: [String]?
    var badgeKey: String?
    var badgeCount: Int?
    var dotKey: String?
    var showsDot: Bool?
    var enabled: Bool?
    var order: Int?
    var route: DiscoverRoute?

    enum CodingKeys: String, CodingKey {
        case id
        case titleKey = "title_key"
        case title
        case titleI18n = "title_i18n"
        case systemImage = "system_image"
        case colors
        case badgeKey = "badge_key"
        case badgeCount = "badge_count"
        case dotKey = "dot_key"
        case showsDot = "shows_dot"
        case enabled
        case order
        case route
    }

    init(
        id: String,
        titleKey: String? = nil,
        title: String? = nil,
        titleI18n: [String: String]? = nil,
        systemImage: String? = nil,
        colors: [String]? = nil,
        badgeKey: String? = nil,
        badgeCount: Int? = nil,
        dotKey: String? = nil,
        showsDot: Bool? = nil,
        enabled: Bool? = nil,
        order: Int? = nil,
        route: DiscoverRoute? = nil
    ) {
        self.id = id
        self.titleKey = titleKey
        self.title = title
        self.titleI18n = titleI18n
        self.systemImage = systemImage
        self.colors = colors
        self.badgeKey = badgeKey
        self.badgeCount = badgeCount
        self.dotKey = dotKey
        self.showsDot = showsDot
        self.enabled = enabled
        self.order = order
        self.route = route
    }

    var isEnabled: Bool { enabled ?? true }
    var isVisible: Bool { isEnabled && route?.normalizedType != "disabled" }
    var sortOrder: Int { order ?? 0 }

    var displayColors: [Color] {
        let hexValues = (colors ?? [])
            .filter(\.isDiscoverHexColor)
            .prefix(2)
        guard let first = hexValues.first else { return [] }
        guard hexValues.count > 1 else {
            return [Color(hex: first)]
        }
        return hexValues.map(Color.init(hex:))
    }

    func displayTitle(language: AppLanguage) -> String {
        if let preferredTitleKey = preferredLocalTitleKey {
            let localized = L10n.tr(preferredTitleKey)
            if localized != preferredTitleKey { return localized }
        }
        if let localized = titleI18n?.localizedDiscoverValue(for: language) {
            return localized
        }
        if let titleKey, !titleKey.isDiscoverBlank {
            let localized = L10n.tr(titleKey)
            if localized != titleKey { return localized }
        }
        if let title, !title.isDiscoverBlank {
            return title
        }
        return id
    }

    private var preferredLocalTitleKey: String? {
        switch id.normalizedDiscoverToken {
        case "groups", "group", "group_list":
            return "discover.groups"
        case "benefits":
            return "discover.benefits"
        default:
            return nil
        }
    }
}

struct DiscoverRoute: Codable, Equatable {
    var type: String?
    var name: String?
    var url: String?
    var titleKey: String?
    var title: String?
    var titleI18n: [String: String]?
    var messageKey: String?
    var message: String?
    var messageI18n: [String: String]?

    enum CodingKeys: String, CodingKey {
        case type
        case name
        case url
        case titleKey = "title_key"
        case title
        case titleI18n = "title_i18n"
        case messageKey = "message_key"
        case message
        case messageI18n = "message_i18n"
    }

    init(
        type: String? = nil,
        name: String? = nil,
        url: String? = nil,
        titleKey: String? = nil,
        title: String? = nil,
        titleI18n: [String: String]? = nil,
        messageKey: String? = nil,
        message: String? = nil,
        messageI18n: [String: String]? = nil
    ) {
        self.type = type
        self.name = name
        self.url = url
        self.titleKey = titleKey
        self.title = title
        self.titleI18n = titleI18n
        self.messageKey = messageKey
        self.message = message
        self.messageI18n = messageI18n
    }

    var normalizedType: String {
        (type ?? "coming_soon").normalizedDiscoverToken
    }

    func displayTitle(language: AppLanguage, fallback: String) -> String {
        if let localized = titleI18n?.localizedDiscoverValue(for: language) {
            return localized
        }
        if let titleKey, !titleKey.isDiscoverBlank {
            let localized = L10n.tr(titleKey)
            if localized != titleKey { return localized }
        }
        if let title, !title.isDiscoverBlank {
            return title
        }
        return fallback
    }

    func displayMessage(language: AppLanguage) -> String? {
        if let localized = messageI18n?.localizedDiscoverValue(for: language) {
            return localized
        }
        if let messageKey, !messageKey.isDiscoverBlank {
            let localized = L10n.tr(messageKey)
            if localized != messageKey { return localized }
        }
        return message?.isDiscoverBlank == false ? message : nil
    }
}

extension Dictionary where Key == String, Value == String {
    func localizedDiscoverValue(for language: AppLanguage) -> String? {
        let languageCode = language.rawValue
        let candidates = [
            languageCode,
            language.localeIdentifier,
            languageCode.split(separator: "-").first.map(String.init) ?? "",
            "en"
        ]
        for key in candidates {
            if let value = self[key], !value.isDiscoverBlank {
                return value
            }
        }
        return nil
    }
}

extension String {
    var isDiscoverBlank: Bool {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var normalizedDiscoverToken: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "-", with: "_")
            .lowercased()
    }

    var isDiscoverHexColor: Bool {
        let value = trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        guard value.count == 6 || value.count == 8 else { return false }
        return UInt64(value, radix: 16) != nil
    }
}
