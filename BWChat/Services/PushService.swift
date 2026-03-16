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
    /// Track whether we need to upload once we receive a token
    private var pendingUpload: Bool = false
    /// Track whether we've already successfully uploaded the current token
    private var tokenUploaded: Bool = false
    /// Retry count for failed uploads
    private var uploadRetryCount: Int = 0
    private let maxUploadRetries: Int = 3

    private init() {}

    /// Register for remote notifications immediately at app launch.
    /// This should be called from didFinishLaunchingWithOptions, before login.
    /// iOS will return a device token regardless of notification permission.
    func registerForRemoteNotifications() {
        UIApplication.shared.registerForRemoteNotifications()
        print("[Push] Registered for remote notifications")
    }

    /// Request push notification permission (separate from registration).
    /// Call this after login to prompt the user.
    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        ) { granted, error in
            Task { @MainActor in
                self.isAuthorized = granted
                print("[Push] Permission granted: \(granted), error: \(String(describing: error))")
                if granted {
                    // Re-register in case token needs refresh
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }

    /// Re-register for push notifications when app becomes active.
    /// This ensures the device token stays fresh and is re-uploaded
    /// after the app returns from background or after being killed.
    func reregisterIfNeeded() {
        // Always ask iOS for a fresh token when becoming active
        UIApplication.shared.registerForRemoteNotifications()

        // If we have a token and are logged in but haven't uploaded, upload now
        if let token = deviceToken, AuthManager.shared.token != nil, !tokenUploaded {
            print("[Push] Re-uploading token on foreground return")
            uploadRetryCount = 0
            uploadTokenToServer(token)
        }
    }

    /// Handle device token registration from APNs callback.
    /// Called by AppDelegate when APNs returns a device token.
    func didRegisterForRemoteNotifications(deviceToken: Data) {
        let tokenString = deviceToken.hexString
        let previousToken = cachedDeviceToken
        print("[Push] Device token received: \(tokenString.prefix(16))...")

        UserDefaults.standard.set(tokenString, forKey: "device_token")
        cachedDeviceToken = tokenString

        // Reset upload state if token changed
        if previousToken != tokenString {
            tokenUploaded = false
            uploadRetryCount = 0
        }

        // Upload to server if we're logged in
        if AuthManager.shared.token != nil {
            uploadTokenToServer(tokenString)
        } else if pendingUpload {
            // Will be uploaded when ensureTokenUploaded() is called after login
            print("[Push] Token received but not logged in yet, waiting for login")
        }

        // If ensureTokenUploaded() was called before we got the token,
        // fulfill that pending request now
        if pendingUpload && AuthManager.shared.token != nil {
            pendingUpload = false
            uploadTokenToServer(tokenString)
        }
    }

    /// Handle registration failure
    func didFailToRegisterForRemoteNotifications(error: Error) {
        print("[Push] FAILED to register for remote notifications: \(error.localizedDescription)")
        print("[Push] Error details: \(error)")
    }

    /// Ensure the device token is uploaded to the server.
    /// Call this after every successful login (manual or auto-login).
    func ensureTokenUploaded() {
        uploadRetryCount = 0
        tokenUploaded = false

        if let token = deviceToken {
            print("[Push] ensureTokenUploaded: uploading existing token \(token.prefix(16))...")
            uploadTokenToServer(token)
        } else {
            // Token not yet received from APNs - mark as pending.
            // When didRegisterForRemoteNotifications fires, it will upload.
            pendingUpload = true
            print("[Push] ensureTokenUploaded: no token yet, marked as pending")
            // Also re-register in case the system hasn't called back yet
            UIApplication.shared.registerForRemoteNotifications()
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

    // MARK: - Private

    private func uploadTokenToServer(_ token: String) {
        guard AuthManager.shared.token != nil else {
            print("[Push] Cannot upload token: not logged in")
            pendingUpload = true
            return
        }

        Task {
            do {
                try await APIService.shared.registerDeviceToken(token)
                print("[Push] Device token uploaded successfully")
                tokenUploaded = true
                uploadRetryCount = 0
            } catch {
                print("[Push] Failed to upload device token: \(error)")
                uploadRetryCount += 1

                // Retry with exponential backoff
                if uploadRetryCount <= maxUploadRetries {
                    let delay = UInt64(pow(2.0, Double(uploadRetryCount))) * 1_000_000_000
                    print("[Push] Retrying upload in \(uploadRetryCount * 2)s (attempt \(uploadRetryCount)/\(maxUploadRetries))")
                    try? await Task.sleep(nanoseconds: delay)
                    if !tokenUploaded {
                        uploadTokenToServer(token)
                    }
                } else {
                    print("[Push] Max retries reached, will retry on next app launch")
                }
            }
        }
    }
}
