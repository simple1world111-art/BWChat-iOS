// BWChat/Utils/Constants.swift
// App-wide constants and configuration

import SwiftUI

enum AppConfig {
    #if DEBUG
    static let apiBaseURL = "http://52.69.26.53:8000/api/v1"
    static let wsBaseURL  = "ws://52.69.26.53:8000/ws"
    #else
    static let apiBaseURL = "http://52.69.26.53:8000/api/v1"
    static let wsBaseURL  = "ws://52.69.26.53:8000/ws"
    #endif

    static let livekitURL = "ws://52.69.26.53:7880"
    static let appName = "BWChat"
    static let messagePageSize = 30
    static let wsHeartbeatInterval: TimeInterval = 15
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
    func flippedScroll() -> some View {
        self.scaleEffect(x: 1, y: -1, anchor: .center)
    }

    func flippedRow() -> some View {
        self.scaleEffect(x: 1, y: -1, anchor: .center)
    }
}
