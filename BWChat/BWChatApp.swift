// BWChat/BWChatApp.swift
// App entry point

import SwiftUI

@main
struct BWChatApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    @ObservedObject private var callManager = CallManager.shared
    @ObservedObject private var liveCallCoordinator = LiveCallCoordinator.shared
    @ObservedObject private var walletStore = WalletStore.shared
    @ObservedObject private var remoteConfigStore = AppRemoteConfigStore.shared
    @ObservedObject private var authManager = AuthManager.shared


    var body: some Scene {
        WindowGroup {
            ZStack {
                SplashScreen()
                    .appLocalizedEnvironment()
                    .environmentObject(remoteConfigStore)
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
            .overlay(alignment: .top) {
                if liveCallCoordinator.hasInvitation {
                    LiveCallInvitationBanner()
                        .zIndex(300)
                }
            }
            .animation(.spring(response: 0.36, dampingFraction: 0.86), value: liveCallCoordinator.hasInvitation)
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
            .onChange(of: authManager.currentUser?.userID) { _ in
                Task { @MainActor in
                    await remoteConfigStore.load(force: true)
                }
            }
            .onAppear {
                Task {
                    configureOutgoingUploads()
                    async let configLoad: Void = remoteConfigStore.load(force: true)
                    async let adMobInitialization: Bool = AdMobRuntime.initializeAtAppLaunch()
                    await configLoad
                    _ = await adMobInitialization
                    await refreshWalletBalanceIfNeeded()
                }
            }
            .onOpenURL { url in
                if !ActivityInviteRouteStore.shared.handle(url) {
                    _ = GroupInviteRouteStore.shared.handle(url)
                }
            }
            .toast(message: $callManager.errorMessage, duration: 4)
            .toast(message: $liveCallCoordinator.errorMessage, duration: 4)
            #if DEBUG
            .overlay {
                if ProcessInfo.processInfo.arguments.contains("-ActivityCenterPreview") {
                    NavigationStack {
                        ActivityCenterView(
                            store: ActivityCenterStore(
                                initialSnapshot: .preview,
                                initialMatchedUsers: ActivityCenterPreviewSupport.matchedUsers
                            ),
                            initialWheelResult: ProcessInfo.processInfo.arguments.contains("-ActivityWheelResultPreview")
                                ? ActivityCenterPreviewSupport.wheelResult
                                : nil,
                            initialShowsMatches: ProcessInfo.processInfo.arguments.contains("-ActivityContactMatchesPreview"),
                            initialShowsPhoneBinding: ProcessInfo.processInfo.arguments.contains("-ActivityPhoneBindingPreview"),
                            initialShowsWheel: ProcessInfo.processInfo.arguments.contains("-ActivityWheelPreview")
                        )
                    }
                    .appLocalizedEnvironment()
                    .environmentObject(ActivityCenterPreviewSupport.navigator)
                }
            }
            #endif
        }
    }

    private func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .active:
            // App returned to foreground — ensure push & WebSocket are alive
            Task { @MainActor in
                AppMessageSyncCoordinator.shared.requestSync(.foreground)
                configureOutgoingUploads()
                await remoteConfigStore.load(force: true)
                await refreshWalletBalanceIfNeeded()
                PushService.shared.reregisterIfNeeded()
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

    @MainActor
    private func configureOutgoingUploads() {
        guard let ownerID = AuthManager.shared.currentUser?.userID, !ownerID.isEmpty else { return }
        UploadProjectionStore.shared.setOwner(ownerID)
        BackgroundUploadCoordinator.shared.activate()
    }
}

#if DEBUG
@MainActor
private enum ActivityCenterPreviewSupport {
    static let navigator = UIKitNavigator()
    static let wheelResult = ActivityWheelSpinResult(
        spinID: "wheel-result-preview",
        tierID: "tier_10",
        costGoldCoins: 10,
        prizeID: "tier_10_p20",
        payoutGoldCoins: 20,
        netDeltaGoldCoins: 10,
        nextTierID: "tier_100"
    )
    static let matchedUsers = [
        ActivityMatchedUser(
            userID: "preview-friend-1",
            nickname: "Momo",
            avatarURL: "",
            relation: "none"
        ),
        ActivityMatchedUser(
            userID: "preview-friend-2",
            nickname: "小可",
            avatarURL: "",
            relation: "none"
        ),
        ActivityMatchedUser(
            userID: "preview-friend-3",
            nickname: "Sunny",
            avatarURL: "",
            relation: "none"
        )
    ]
}
#endif

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

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        BackgroundUploadCoordinator.shared.handleEvents(
            forBackgroundURLSession: identifier,
            completionHandler: completionHandler
        )
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
        Task { @MainActor in
            AppMessageSyncCoordinator.shared.receive(
                userInfo,
                opensConversation: false,
                reason: .silentPush
            )
        }
        // APNs has already applied `aps.badge` while the app was suspended.
        // Do not copy that aggregate into UIKit here: the in-app source of
        // truth is the per-conversation unread store, refreshed above.
        completionHandler(.newData)
    }

    // MARK: - Push Notification Handling

    /// Foreground notification display
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let userInfo = NotificationPayloadNormalizer.flatten(
            notification.request.content.userInfo
        )
        let callPayload = userInfo
        Task { @MainActor in
            AppMessageSyncCoordinator.shared.receive(
                userInfo,
                opensConversation: false,
                reason: .notification
            )
        }

        if scheduleIncomingCall(from: callPayload) {
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

        let notificationMode = Self.firstString(
            userInfo,
            keys: ["notification_mode", "notificationMode"]
        )?.lowercased()
        if notificationMode == "badge_only" {
            completionHandler([])
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

        // A visible conversation already renders its messages in-app. Never
        // duplicate those with a system banner or sound, including mentions.
        if let groupID = Self.intValue(userInfo["group_id"]),
           let activeGroupID = WebSocketService.shared.activeGroupID,
           activeGroupID == groupID {
            completionHandler([])
            return
        }

        // Defensive foreground filtering for old push providers. The server
        // remains the source of truth; this only prevents a stale alert from
        // being reintroduced while the feature is enabled.
        if AppRemoteConfigStore.shared.featureFlags.isEnabled(
            "group_notification_settings_v1",
            default: false
        ),
           let route = NotificationRoute.parse(userInfo),
           route.conversationType == .group,
           let groupID = route.groupID {
            let settings = GroupNotificationSettingsStore.shared.settings(for: groupID)
            if settings.isMuted,
               !settings.shouldAlert(
                senderID: route.senderID,
                isDirectMention: route.isDirectMention,
                isMentionAll: route.isMentionAll
               ) {
                completionHandler([])
                return
            }
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
        let userInfo = NotificationPayloadNormalizer.flatten(
            response.notification.request.content.userInfo
        )
        let callPayload = userInfo
        Task { @MainActor in
            AppMessageSyncCoordinator.shared.receive(
                userInfo,
                opensConversation: true,
                reason: .notification
            )
        }

        if scheduleIncomingCall(from: callPayload) {
            completionHandler()
            return
        }

        completionHandler()
    }

    private func scheduleIncomingCall(from payload: [AnyHashable: Any]) -> Bool {
        guard let pushType = Self.firstString(payload, keys: ["push_type", "event_type"])?.lowercased(),
              let roomName = Self.firstString(payload, keys: ["room_name", "room"]),
              let callType = Self.callTypeValue(payload["call_type"] ?? payload["media_type"]) else {
            return false
        }

        if pushType == "call" || pushType == "call_invite" {
            guard let callerID = Self.firstString(payload, keys: ["caller_id", "from_user_id", "user_id"]) else {
                return false
            }
            let callerName = Self.firstString(payload, keys: ["caller_name", "caller_nickname", "nickname"]) ?? callerID
            let callerAvatar = Self.firstString(payload, keys: ["caller_avatar", "avatar_url", "avatar"]) ?? ""
            Task { @MainActor in
                CallManager.shared.receiveIncomingCall(
                    callerID: callerID,
                    callerName: callerName,
                    callerAvatar: callerAvatar,
                    serverCallID: Self.firstString(payload, keys: ["call_id"]),
                    roomName: roomName,
                    callType: callType
                )
            }
            return true
        }

        if pushType == "group_call" || pushType == "group_call_invite" {
            guard let groupID = Self.intValue(payload["group_id"]),
                  let groupName = Self.firstString(payload, keys: ["group_name", "name"]) else {
                return false
            }
            let callerID = Self.firstString(payload, keys: ["caller_id", "from_user_id", "user_id"]) ?? ""
            Task { @MainActor in
                CallManager.shared.receiveIncomingGroupCall(
                    callerID: callerID,
                    groupID: groupID,
                    groupName: groupName,
                    serverCallID: Self.firstString(payload, keys: ["call_id"]),
                    roomName: roomName,
                    callType: callType
                )
            }
            return true
        }

        return false
    }

    private static func firstString(_ data: [AnyHashable: Any], keys: [String]) -> String? {
        keys.lazy.compactMap { stringValue(data[$0]) }.first
    }

    private static func callTypeValue(_ value: Any?) -> CallType? {
        guard let value = stringValue(value)?.lowercased() else { return nil }
        switch value {
        case "voice", "audio": return .voice
        case "video": return .video
        default: return nil
        }
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
