// BWChat/BWChatApp.swift
// App entry point

import SwiftUI

@main
struct BWChatApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            SplashScreen()
                .preferredColorScheme(nil) // Support both light and dark
        }
    }
}

// MARK: - AppDelegate for Push Notifications

class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self

        // Register for remote notifications EARLY — iOS returns a device token
        // regardless of whether the user has granted notification permission.
        // This ensures we have a token ready when the user logs in.
        Task { @MainActor in
            PushService.shared.registerForRemoteNotifications()
        }

        return true
    }

    // MARK: - APNs Registration

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            PushService.shared.didRegisterForRemoteNotifications(deviceToken: deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in
            PushService.shared.didFailToRegisterForRemoteNotifications(error: error)
        }
    }

    // MARK: - Background Push (content-available)

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        // Background wake: update badge count on app icon
        if let badge = (userInfo["aps"] as? [String: Any])?["badge"] as? Int {
            Task { @MainActor in
                UIApplication.shared.applicationIconBadgeNumber = badge
            }
        }
        completionHandler(.newData)
    }

    // MARK: - Push Notification Handling

    /// Foreground notification display
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let userInfo = notification.request.content.userInfo
        let senderID = userInfo["sender_id"] as? String ?? ""

        // If user is currently viewing this chat, suppress the notification banner
        if let activeChatID = WebSocketService.shared.activeChatUserID, activeChatID == senderID {
            completionHandler([])
            return
        }

        // If group notification and user is viewing that group, suppress
        if let groupID = userInfo["group_id"] as? Int,
           let activeGroupID = WebSocketService.shared.activeGroupID,
           activeGroupID == groupID {
            completionHandler([])
            return
        }

        // Show notification banner + sound
        completionHandler([.banner, .sound, .badge])
    }

    /// Notification tap handling
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo

        if let groupID = userInfo["group_id"] as? Int {
            NotificationCenter.default.post(
                name: .init("openGroupChat"),
                object: nil,
                userInfo: ["group_id": groupID]
            )
        } else if let senderID = userInfo["sender_id"] as? String {
            NotificationCenter.default.post(
                name: .init("openChat"),
                object: nil,
                userInfo: ["sender_id": senderID]
            )
        }

        Task { @MainActor in
            PushService.shared.clearBadge()
        }
        completionHandler()
    }
}
