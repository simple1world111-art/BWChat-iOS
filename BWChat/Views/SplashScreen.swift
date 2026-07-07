// BWChat/Views/SplashScreen.swift
// Premium launch screen with gradient animation

import SwiftUI

struct SplashScreen: View {
    @StateObject private var authManager = AuthManager.shared
    @State private var isCheckingToken = true
    @State private var logoScale: CGFloat = 0.6
    @State private var logoOpacity: Double = 0

    var body: some View {
        Group {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-walletReviewScreenshot") {
                NavigationStack {
                    WalletView()
                        .environmentObject(UIKitNavigator())
                }
            } else if isCheckingToken {
                splashView
            } else if authManager.isLoggedIn {
                MainTabView()
            } else {
                LoginView()
            }
            #else
            if isCheckingToken {
                splashView
            } else if authManager.isLoggedIn {
                MainTabView()
            } else {
                LoginView()
            }
            #endif
        }
        .task {
            await checkToken()
        }
    }

    private var splashView: some View {
        ZStack {
            AuthPlushBackground()

            VStack(spacing: 14) {
                Spacer()

                Text(AppConfig.appName)
                    .font(.system(size: 36, weight: .heavy, design: .rounded))
                    .foregroundColor(.white)
                    .scaleEffect(logoScale)
                    .opacity(logoOpacity)

                Text(L10n.tr("splash.entering"))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white.opacity(0.76))
                    .opacity(logoOpacity)

                Text(L10n.tr("splash.tagline"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(.white.opacity(0.58))
                    .multilineTextAlignment(.center)
                    .opacity(logoOpacity)

                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    .padding(.top, 6)
                    .opacity(logoOpacity)

                Spacer()
                    .frame(height: 86)
            }
        }
        .onAppear {
            withAnimation(.spring(response: 0.8, dampingFraction: 0.6)) {
                logoScale = 1.0
                logoOpacity = 1.0
            }
        }
    }

    private func checkToken() async {
        guard authManager.token != nil else {
            try? await Task.sleep(nanoseconds: 500_000_000)
            isCheckingToken = false
            return
        }

        if authManager.currentUser != nil {
            resumeAuthenticatedSession()
            isCheckingToken = false
            Task {
                await validateCachedSession()
            }
            return
        }

        await validateCachedSession()
        isCheckingToken = false
    }

    private func validateCachedSession() async {
        guard authManager.token != nil else { return }

        // Watchdog: regardless of what happens to the verify+refresh chain
        // (URLSession hang, retry loop, deadlock in older code paths),
        // guarantee the user lands on the LoginView within ~20s instead of
        // staring at the splash forever. URLSession's per-request timeout
        // is 15s, so this is purely a safety net for paths that bypass it.
        // Reproduced with peter (u005) — refresh token rejected, but the
        // app never advanced past splash. The watchdog ensures that even
        // if a future bug strands the auth chain, the user can recover
        // by simply reopening LoginView and entering credentials.
        let watchdog = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            // CRITICAL: Task.cancel() doesn't stop a task's body — it just
            // marks Task.isCancelled = true and lets Task.sleep throw a
            // CancellationError. Because we wrap that in `try?`, the
            // throw gets swallowed and the rest of THIS body continues
            // running. Without the guard below, every successful login
            // (which calls `watchdog.cancel()` on its way out) would
            // immediately resume this task and fire authManager.logout()
            // — nuking the freshly-restored session and bouncing the
            // user back to LoginView on every app launch. The guard
            // makes "cancelled" mean what we actually want: don't run.
            guard !Task.isCancelled else { return }
            if isCheckingToken {
                authManager.logout()
                isCheckingToken = false
            }
        }

        do {
            let user = try await APIService.shared.verifyToken()
            authManager.updateUser(user)
            resumeAuthenticatedSession()
        } catch {
            // Access token expired — attempt refresh
            do {
                let (newToken, newRefreshToken, user) = try await APIService.shared.refreshTokens()
                authManager.token = newToken
                authManager.refreshToken = newRefreshToken
                authManager.updateUser(user)
                resumeAuthenticatedSession()
            } catch {
                authManager.logout()
            }
        }

        watchdog.cancel()
    }

    private func resumeAuthenticatedSession() {
        authManager.isLoggedIn = true
        WebSocketService.shared.connect()
        PushService.shared.requestPermission()
        PushService.shared.ensureTokenUploaded()
    }
}
