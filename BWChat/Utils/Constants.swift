// BWChat/Utils/Constants.swift
// App-wide constants and configuration

import SwiftUI

struct CatFoodProductConfig: Identifiable, Equatable {
    let productID: String
    let coins: Int
    let fallbackPriceUSD: String

    var id: String { productID }
}

enum AppConfig {
    // Backend entry points. Media paths intentionally remain server-relative
    // (/api/v1/images/..., /api/v1/avatars/..., etc.) for legacy compatibility.
    #if DEBUG
    static let apiBaseURL = "http://52.193.78.191/api/v1"
    static let wsBaseURL  = "ws://52.193.78.191/ws"
    #else
    static let apiBaseURL = "http://52.193.78.191/api/v1"
    static let wsBaseURL  = "ws://52.193.78.191/ws"
    #endif
    static let livekitURL = "http://52.193.78.191/livekit"

    static let appName = "BBchat"
    static let messagePageSize = 30
    static let wsHeartbeatInterval: TimeInterval = 15
    static let catFoodProducts: [CatFoodProductConfig] = [
        CatFoodProductConfig(productID: "com.bwchat.app.catfood.100", coins: 100, fallbackPriceUSD: "$0.99"),
        CatFoodProductConfig(productID: "com.bwchat.app.catfood.800", coins: 800, fallbackPriceUSD: "$7.99"),
        CatFoodProductConfig(productID: "com.bwchat.app.catfood.1800", coins: 1800, fallbackPriceUSD: "$17.99"),
        CatFoodProductConfig(productID: "com.bwchat.app.catfood.3000", coins: 3000, fallbackPriceUSD: "$29.99"),
        CatFoodProductConfig(productID: "com.bwchat.app.catfood.9800", coins: 9800, fallbackPriceUSD: "$99.99"),
        CatFoodProductConfig(productID: "com.bwchat.app.catfood.19800", coins: 19800, fallbackPriceUSD: "$199.99")
    ]

}

enum MediaURLResolver {
    static func resolve(
        _ rawValue: String?,
        apiBaseURL: String = AppConfig.apiBaseURL
    ) -> URL? {
        guard let rawValue else { return nil }
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }

        if let absoluteURL = URL(string: value),
           let scheme = absoluteURL.scheme?.lowercased(),
           (scheme == "https" || scheme == "http"),
           absoluteURL.host != nil {
            return absoluteURL
        }

        guard let apiURL = URL(string: apiBaseURL),
              let scheme = apiURL.scheme,
              let host = apiURL.host else { return nil }

        let urlString: String
        if value.hasPrefix("/api/") {
            var origin = "\(scheme)://\(host)"
            if let port = apiURL.port { origin += ":\(port)" }
            urlString = origin + value
        } else {
            urlString = apiBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                + "/"
                + value.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        }

        guard let resolvedURL = URL(string: urlString),
              let resolvedScheme = resolvedURL.scheme?.lowercased(),
              (resolvedScheme == "https" || resolvedScheme == "http"),
              resolvedURL.host != nil else { return nil }
        return resolvedURL
    }
}

enum AppSpacing {
    static let rootTabTopInset: CGFloat = 0
}

enum AppListMetrics {
    static let userCardHeight: CGFloat = 72
    static let conversationSwipeActionHeight: CGFloat = 72
    /// Scrollable tail room that lets the last root-list card clear the floating tab bar.
    static let rootTabBottomScrollableClearance: CGFloat = 160
}

// MARK: - Premium Color Palette

enum AppColors {
    // Gradient accent
    static let gradientStart = Color(hex: "667EEA")
    static let gradientEnd = Color(hex: "764BA2")
    static let accentGradient = LinearGradient(
        colors: [gradientStart, gradientEnd],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    // Core
    static let background = Color(.systemBackground)
    static let secondaryBackground = Color(.secondarySystemBackground)
    static let cardBackground = Color(.systemBackground)
    static let primaryText = Color(hex: "1A1A2E")
    static let secondaryText = Color(hex: "9E9EB8")
    static let tertiaryText = Color(hex: "C4C4D4")
    static let separator = Color(hex: "F0F0F5")
    static let accent = Color(hex: "667EEA")
    static let accentLight = Color(hex: "667EEA").opacity(0.12)

    // Chat bubbles
    static let sentBubbleGradient = LinearGradient(
        colors: [Color(hex: "667EEA"), Color(hex: "764BA2")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
    static let sentBubble = Color(hex: "667EEA")
    static let sentBubbleText = Color.white
    static let receivedBubble = Color(hex: "F4F4F8")
    static let receivedBubbleText = Color(hex: "1A1A2E")

    // Status
    static let online = Color(hex: "34C759")
    static let errorColor = Color(hex: "FF3B30")
    static let warningColor = Color(hex: "FF9500")
    static let unreadBadge = Color(hex: "FF3B30")
    static let unreadDot = Color(hex: "667EEA")

    // Yellow / black / white identity palette
    static let iconYellow = Color(hex: "FFD43B")
    static let iconYellowDeep = Color(hex: "F4B400")
    static let iconBlack = Color(hex: "171717")
    static let iconWhite = Color.white

    // Groups
    static let groupAccent = Color(hex: "5856D6")
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6:
            (a, r, g, b) = (255, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = ((int >> 24) & 0xFF, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - Flipped ScrollView (reliable bottom-anchored chat)

extension View {
    func flippedRow() -> some View {
        self.rotationEffect(.degrees(180))
            .scaleEffect(x: -1, y: 1, anchor: .center)
    }
}
