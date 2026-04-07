// BWChat/BWChatApp.swift
// App entry point

import SwiftUI

@main
struct BWChatApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    @StateObject private var callManager = CallManager.shared
    @State private var showIncomingCall = false

    var body: some Scene {
        WindowGroup {
            SplashScreen()
                .preferredColorScheme(nil)
                .onChange(of: scenePhase) { newPhase in
                    handleScenePhase(newPhase)
                }
                .onReceive(callManager.$currentCall) { call in
                    if let call = call, call.state == .incoming && !showIncomingCall {
                        showIncomingCall = true
                    } else if call == nil {
                        showIncomingCall = false
                    }
                }
                .fullScreenCover(isPresented: $showIncomingCall) {
                    CallView()
                }
        }
    }

    private func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .active:
            // App returned to foreground — ensure push & WebSocket are alive
            Task { @MainActor in
                PushService.shared.reregisterIfNeeded()
                PushService.shared.clearBadge()
                if AuthManager.shared.isLoggedIn && !WebSocketService.shared.isConnected {
                    WebSocketService.shared.connect()
                }
            }
        case .background:
            // Nothing needed — APNs delivers while we're in background/killed
            break
        case .inactive:
            break
        @unknown default:
            break
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
        // Update badge count from the push payload
        if let aps = userInfo["aps"] as? [String: Any],
           let badge = aps["badge"] as? Int {
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

        // Suppress DM notification banner if viewing that chat
        if let senderID = userInfo["sender_id"] as? String,
           let activeChatID = WebSocketService.shared.activeChatUserID,
           activeChatID == senderID,
           userInfo["group_id"] == nil {
            completionHandler([])
            return
        }

        // Suppress group notification banner if viewing that group,
        // UNLESS the user was @mentioned — always show those
        let isMention = userInfo["is_mention"] as? Bool ?? false
        if !isMention,
           let groupID = userInfo["group_id"] as? Int,
           let activeGroupID = WebSocketService.shared.activeGroupID,
           activeGroupID == groupID {
            completionHandler([])
            return
        }

        // Show notification banner + sound (no badge — WebSocket handles unread state in foreground)
        completionHandler([.banner, .sound])
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
