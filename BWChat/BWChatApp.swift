// BWChat/BWChatApp.swift
// App entry point

import SwiftUI

@main
struct BWChatApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    @ObservedObject private var callManager = CallManager.shared
    @ObservedObject private var walletStore = WalletStore.shared


    var body: some Scene {
        WindowGroup {
            ZStack {
                SplashScreen()
                    .appLocalizedEnvironment()
                    .preferredColorScheme(nil)
                    .onChange(of: scenePhase) { newPhase in
                        handleScenePhase(newPhase)
                    }

                if callManager.currentCall != nil && !callManager.isMinimized {
                    Group {
                        if callManager.currentCall?.groupID != nil && callManager.currentCall?.state == .connected {
                            GroupCallView()
                        } else {
                            CallView()
                        }
                    }
                    .transition(.move(edge: .bottom))
                    .zIndex(100)
                }
            }
            .overlay {
                if callManager.currentCall != nil && callManager.isMinimized {
                    CallPipBubble()
                        .zIndex(200)
                }
            }
            .onChange(of: callManager.currentCall != nil) { hasCalling in
                if hasCalling {
                    UIApplication.shared.sendAction(
                        #selector(UIResponder.resignFirstResponder),
                        to: nil, from: nil, for: nil
                    )
                }
            }
            .onChange(of: callManager.currentCall?.state) { newState in
                if newState == .connected {
                    UIApplication.shared.sendAction(
                        #selector(UIResponder.resignFirstResponder),
                        to: nil, from: nil, for: nil
                    )
                }
            }
            .onAppear {
                Task { await refreshWalletBalanceIfNeeded() }
            }
        }
    }

    private func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .active:
            // App returned to foreground — ensure push & WebSocket are alive
            Task { @MainActor in
                await refreshWalletBalanceIfNeeded()
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

    @MainActor
    private func refreshWalletBalanceIfNeeded() async {
        guard AuthManager.shared.isLoggedIn else { return }
        await walletStore.refreshBalanceFromServer()
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
        postConversationReloadIfNeeded(userInfo)

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
        postConversationReloadIfNeeded(userInfo)

        // Incoming 1v1 call push — show call UI directly
        if let pushType = userInfo["push_type"] as? String, pushType == "call",
           let callerID = Self.stringValue(userInfo["caller_id"]),
           let callerName = userInfo["caller_name"] as? String,
           let roomName = userInfo["room_name"] as? String,
           let callTypeStr = userInfo["call_type"] as? String,
           let callType = CallType(rawValue: callTypeStr) {
            let callerAvatar = userInfo["caller_avatar"] as? String ?? ""
            Task { @MainActor in
                guard CallManager.shared.currentCall == nil else { return }
                CallManager.shared.currentCall = CallSession(
                    remoteUserID: callerID,
                    remoteNickname: callerName,
                    remoteAvatarURL: callerAvatar,
                    callType: callType,
                    isOutgoing: false,
                    state: .incoming,
                    startedAt: Date(),
                    roomName: roomName
                )
            }
            completionHandler([.sound])
            return
        }

        // Incoming group call push — show group call UI directly
        if let pushType = userInfo["push_type"] as? String, pushType == "group_call",
           let groupID = Self.intValue(userInfo["group_id"]),
           let groupName = userInfo["group_name"] as? String,
           let roomName = userInfo["room_name"] as? String,
           let callTypeStr = userInfo["call_type"] as? String,
           let callType = CallType(rawValue: callTypeStr) {
            Task { @MainActor in
                guard CallManager.shared.currentCall == nil else { return }
                CallManager.shared.currentCall = CallSession(
                    remoteUserID: Self.stringValue(userInfo["caller_id"]) ?? "",
                    remoteNickname: groupName,
                    remoteAvatarURL: "",
                    callType: callType,
                    isOutgoing: false,
                    state: .incoming,
                    startedAt: Date(),
                    roomName: roomName,
                    groupID: groupID,
                    groupName: groupName
                )
            }
            completionHandler([.sound])
            return
        }

        // Moments interaction push — increment badge
        if let pushType = userInfo["push_type"] as? String, pushType == "moments_update" {
            Task { @MainActor in
                MomentsNotificationManager.shared.incrementBadge()
            }
            completionHandler([.banner, .sound])
            return
        }

        // Suppress DM notification banner if viewing that chat
        if let senderID = Self.stringValue(userInfo["sender_id"]),
           let activeChatID = WebSocketService.shared.activeChatUserID,
           activeChatID == senderID,
           userInfo["group_id"] == nil {
            completionHandler([])
            return
        }

        // Suppress group notification banner if viewing that group,
        // UNLESS the user was @mentioned — always show those
        let isMention = Self.boolValue(userInfo["is_mention"]) ?? false
        if !isMention,
           let groupID = Self.intValue(userInfo["group_id"]),
           let activeGroupID = WebSocketService.shared.activeGroupID,
           activeGroupID == groupID {
            completionHandler([])
            return
        }

        // Show notification banner + sound
        completionHandler([.banner, .sound])
    }

    /// Notification tap handling
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        postConversationReloadIfNeeded(userInfo)

        // Handle incoming 1v1 call push
        if let pushType = userInfo["push_type"] as? String, pushType == "call",
           let callerID = Self.stringValue(userInfo["caller_id"]),
           let callerName = userInfo["caller_name"] as? String,
           let roomName = userInfo["room_name"] as? String,
           let callTypeStr = userInfo["call_type"] as? String,
           let callType = CallType(rawValue: callTypeStr) {
            let callerAvatar = userInfo["caller_avatar"] as? String ?? ""
            Task { @MainActor in
                guard CallManager.shared.currentCall == nil else { return }
                CallManager.shared.currentCall = CallSession(
                    remoteUserID: callerID,
                    remoteNickname: callerName,
                    remoteAvatarURL: callerAvatar,
                    callType: callType,
                    isOutgoing: false,
                    state: .incoming,
                    startedAt: Date(),
                    roomName: roomName
                )
            }
            completionHandler()
            return
        }

        // Handle incoming group call push
        if let pushType = userInfo["push_type"] as? String, pushType == "group_call",
           let groupID = Self.intValue(userInfo["group_id"]),
           let groupName = userInfo["group_name"] as? String,
           let roomName = userInfo["room_name"] as? String,
           let callTypeStr = userInfo["call_type"] as? String,
           let callType = CallType(rawValue: callTypeStr) {
            Task { @MainActor in
                guard CallManager.shared.currentCall == nil else { return }
                CallManager.shared.currentCall = CallSession(
                    remoteUserID: Self.stringValue(userInfo["caller_id"]) ?? "",
                    remoteNickname: groupName,
                    remoteAvatarURL: "",
                    callType: callType,
                    isOutgoing: false,
                    state: .incoming,
                    startedAt: Date(),
                    roomName: roomName,
                    groupID: groupID,
                    groupName: groupName
                )
            }
            completionHandler()
            return
        }

        if let groupID = Self.intValue(userInfo["group_id"]) {
            NotificationCenter.default.post(
                name: .init("openGroupChat"),
                object: nil,
                userInfo: ["group_id": groupID]
            )
        } else if let senderID = Self.stringValue(userInfo["sender_id"]) {
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

    private func postConversationReloadIfNeeded(_ userInfo: [AnyHashable: Any]) {
        guard userInfo["sender_id"] != nil || userInfo["group_id"] != nil else { return }
        NotificationCenter.default.post(name: .conversationListNeedsReload, object: nil)
    }

    private static func intValue(_ value: Any?) -> Int? {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) }
        return nil
    }

    private static func stringValue(_ value: Any?) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    private static func boolValue(_ value: Any?) -> Bool? {
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.boolValue }
        if let string = value as? String {
            switch string.lowercased() {
            case "true", "1", "yes": return true
            case "false", "0", "no": return false
            default: return nil
            }
        }
        return nil
    }
}
