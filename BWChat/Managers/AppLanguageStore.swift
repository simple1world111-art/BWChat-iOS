import SwiftUI

enum AppLanguage: String, CaseIterable, Identifiable {
    case system
    case english = "en"
    case japanese = "ja"
    case korean = "ko"
    case spanish = "es"
    case french = "fr"
    case german = "de"
    case portugueseBrazil = "pt-BR"
    case russian = "ru"
    case simplifiedChinese = "zh-Hans"
    case traditionalChinese = "zh-Hant"

    var id: String { rawValue }

    static let fallbackLanguage: AppLanguage = .simplifiedChinese

    static let settingsOptions: [AppLanguage] = [
        .system,
        .english,
        .japanese,
        .korean,
        .spanish,
        .french,
        .german,
        .portugueseBrazil,
        .russian,
        .simplifiedChinese,
        .traditionalChinese,
    ]

    var localeIdentifier: String {
        switch self {
        case .system:
            return Self.fallbackLanguage.rawValue
        default:
            return rawValue
        }
    }

    var nativeName: String {
        switch self {
        case .system:
            return L10n.tr("language.option.system")
        case .english:
            return "English"
        case .japanese:
            return "日本語"
        case .korean:
            return "한국어"
        case .spanish:
            return "Español"
        case .french:
            return "Français"
        case .german:
            return "Deutsch"
        case .portugueseBrazil:
            return "Português (Brasil)"
        case .russian:
            return "Русский"
        case .simplifiedChinese:
            return "简体中文"
        case .traditionalChinese:
            return "繁體中文"
        }
    }

    static func preferredSystemLanguage() -> AppLanguage {
        for preferred in Locale.preferredLanguages {
            if let language = match(preferred) {
                return language
            }
        }
        return fallbackLanguage
    }

    private static func match(_ identifier: String) -> AppLanguage? {
        let normalized = identifier
            .replacingOccurrences(of: "_", with: "-")
            .lowercased()

        if normalized.hasPrefix("zh-hant") || normalized.hasPrefix("zh-tw") || normalized.hasPrefix("zh-hk") {
            return .traditionalChinese
        }
        if normalized.hasPrefix("zh") {
            return .simplifiedChinese
        }
        if normalized.hasPrefix("pt-br") {
            return .portugueseBrazil
        }

        return settingsOptions.first { option in
            option != .system && normalized.hasPrefix(option.rawValue.lowercased())
        }
    }
}

final class AppLanguageStore: ObservableObject {
    static let shared = AppLanguageStore()

    private static let defaultsKey = "app.language.selection"
    private let defaults: UserDefaults

    @Published private(set) var selectedLanguage: AppLanguage

    var activeLanguage: AppLanguage {
        selectedLanguage == .system ? AppLanguage.preferredSystemLanguage() : selectedLanguage
    }

    var locale: Locale {
        Locale(identifier: activeLanguage.localeIdentifier)
    }

    var selectedLanguageName: String {
        selectedLanguage.nativeName
    }

    private var activeBundle: Bundle {
        guard let path = Bundle.main.path(forResource: activeLanguage.rawValue, ofType: "lproj"),
              let bundle = Bundle(path: path)
        else {
            return .main
        }
        return bundle
    }

    private init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let savedValue = defaults.string(forKey: Self.defaultsKey)
        self.selectedLanguage = savedValue.flatMap(AppLanguage.init(rawValue:)) ?? AppLanguage.fallbackLanguage
    }

    func setLanguage(_ language: AppLanguage) {
        guard selectedLanguage != language else { return }
        selectedLanguage = language
        defaults.set(language.rawValue, forKey: Self.defaultsKey)
    }

    func localizedString(forKey key: String) -> String {
        activeBundle.localizedString(forKey: key, value: nil, table: nil)
    }
}

enum L10n {
    static func tr(_ key: String, _ args: CVarArg...) -> String {
        let format = AppLanguageStore.shared.localizedString(forKey: key)
        guard !args.isEmpty else { return format }
        return String(format: format, locale: AppLanguageStore.shared.locale, arguments: args)
    }
}

private struct AppLocalizedEnvironmentModifier: ViewModifier {
    @ObservedObject private var languageStore = AppLanguageStore.shared

    func body(content: Content) -> some View {
        content
            .environmentObject(languageStore)
            .environment(\.locale, languageStore.locale)
    }
}

extension View {
    func appLocalizedEnvironment() -> some View {
        modifier(AppLocalizedEnvironmentModifier())
    }
}
