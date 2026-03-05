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

    static let appName = "BWChat"
    static let maxImageSize = 10 * 1024 * 1024 // 10 MB
    static let messagePageSize = 30
    static let wsHeartbeatInterval: TimeInterval = 30
}

enum AppColors {
    // Light mode colors
    static let background = Color(.systemBackground)
    static let primaryText = Color(hex: "1C1C1E")
    static let secondaryText = Color(hex: "8E8E93")
    static let separator = Color(hex: "F2F2F7")
    static let accent = Color(hex: "007AFF")
    static let sentBubble = Color(hex: "007AFF")
    static let sentBubbleText = Color.white
    static let receivedBubble = Color(hex: "F2F2F7")
    static let receivedBubbleText = Color(hex: "1C1C1E")
    static let errorColor = Color(hex: "FF3B30")
    static let unreadDot = Color(hex: "007AFF")
}

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6: // RGB
            (a, r, g, b) = (255, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        case 8: // ARGB
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
