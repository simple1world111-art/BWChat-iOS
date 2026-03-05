// BWChat/Services/PushService.swift
// APNs push notification management

import Foundation
import UserNotifications
import UIKit

@MainActor
class PushService: ObservableObject {
    static let shared = PushService()

    @Published var isAuthorized: Bool = false
    private var cachedDeviceToken: String?

    private init() {}

    /// Request push notification permission
    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, _ in
            Task { @MainActor in
                self.isAuthorized = granted
                if granted {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }

    /// Handle device token registration
    func didRegisterForRemoteNotifications(deviceToken: Data) {
        let tokenString = deviceToken.hexString
        print("[Push] Device token: \(tokenString)")

        let previousToken = UserDefaults.standard.string(forKey: "device_token")

        if tokenString != previousToken {
            UserDefaults.standard.set(tokenString, forKey: "device_token")
            cachedDeviceToken = tokenString

            // Upload to server
            Task {
                try? await APIService.shared.registerDeviceToken(tokenString)
            }
        }
    }

    /// Get the current device token
    var deviceToken: String? {
        cachedDeviceToken ?? UserDefaults.standard.string(forKey: "device_token")
    }

    /// Clear badge count
    func clearBadge() {
        UIApplication.shared.applicationIconBadgeNumber = 0
    }

    /// Show local notification (when app is in foreground)
    func showLocalNotification(title: String, body: String, senderID: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["sender_id": senderID]

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }
}
