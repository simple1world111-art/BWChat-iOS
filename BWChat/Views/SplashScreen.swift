// BWChat/Views/SplashScreen.swift
// Launch screen aligned with the white BBchat auth system.

import SwiftUI

struct SplashScreen: View {
    @StateObject private var authManager = AuthManager.shared
    @State private var isCheckingToken = true
    @State private var logoScale: CGFloat = 0.6
    @State private var logoOpacity: Double = 0

    var body: some View {
        Group {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-chatMoneyTransferPreview") {
                ChatMoneyTransferFeedbackPreviewView()
            } else if ProcessInfo.processInfo.arguments.contains("-gameReentryReview") {
                GameReentryReviewView()
            } else if ProcessInfo.processInfo.arguments.contains("-walletReviewScreenshot")
                || ProcessInfo.processInfo.arguments.contains("-walletEarningsReviewScreenshot") {
                NavigationStack {
                    WalletView()
                        .environmentObject(UIKitNavigator())
                }
            } else if ProcessInfo.processInfo.arguments.contains("-propBagReviewScreenshot") {
                NavigationStack {
                    PropBagView()
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
            AuthWhiteBackground()

            VStack(spacing: 14) {
                Spacer()

                Text(AppConfig.appName)
                    .font(.system(size: 36, weight: .heavy, design: .rounded))
                    .foregroundColor(AuthPalette.ink)
                    .scaleEffect(logoScale)
                    .opacity(logoOpacity)

                Text(L10n.tr("splash.entering"))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(AuthPalette.mutedText)
                    .opacity(logoOpacity)

                Text(L10n.tr("splash.tagline"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(AuthPalette.mutedText.opacity(0.72))
                    .multilineTextAlignment(.center)
                    .opacity(logoOpacity)

                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: AuthPalette.tailGreen))
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

        // The watchdog is a UI escape hatch, not an authentication verdict.
        // A slow or unreachable server must never erase a previously valid
        // session or make its account-scoped cache disappear.
        let watchdog = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            guard !Task.isCancelled else { return }
            if isCheckingToken {
                if authManager.restoreCachedIdentityIfAvailable() {
                    authManager.markSessionUnverified()
                    resumeAuthenticatedSession()
                } else {
                    // No account identity means there is no safe cache scope to
                    // open. Show LoginView without deleting Keychain tokens;
                    // the still-running validation may recover the session.
                    authManager.isLoggedIn = false
                }
                isCheckingToken = false
            }
        }

        do {
            let user = try await APIService.shared.verifyToken()
            authManager.updateUser(user)
            authManager.markSessionVerified()
            resumeAuthenticatedSession()
        } catch {
            if error is CancellationError {
                watchdog.cancel()
                return
            }

            // Access token may be expired. Attempt refresh once, but distinguish
            // an explicit credential rejection from a temporary inability to
            // reach or decode the refresh endpoint.
            do {
                let (newToken, newRefreshToken, user) = try await APIService.shared.refreshTokens()
                try authManager.updateSessionTokens(
                    accessToken: newToken,
                    refreshToken: newRefreshToken,
                    source: "splash-refresh"
                )
                authManager.updateUser(user)
                authManager.markSessionVerified()
                resumeAuthenticatedSession()
            } catch let refreshError {
                if CachedSessionValidationFailurePolicy.shouldInvalidateSession(for: refreshError) {
                    authManager.logout()
                } else if authManager.restoreCachedIdentityIfAvailable() {
                    authManager.markSessionUnverified()
                    resumeAuthenticatedSession()
                } else {
                    authManager.isLoggedIn = false
                }
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

#if DEBUG
@MainActor
private struct GameReentryReviewView: View {
    private struct Launch {
        let game: GameCatalogItem
        let session: GameSession
        let url: URL
    }

    @StateObject private var navigator = UIKitNavigator()
    @State private var launch: Launch?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if let launch {
                    InAppWebView(
                        url: launch.url,
                        title: launch.game.name,
                        restrictToInitialOrigin: true,
                        gameEntryContext: GameEntryContext(
                            gameID: launch.game.id,
                            sessionID: launch.session.sessionID,
                            walletStore: .shared,
                            startRound: { request in
                                try await APIService.shared.startGameRound(
                                    gameID: launch.game.id,
                                    sessionID: launch.session.sessionID,
                                    idempotencyKey: request.idempotencyKey
                                )
                            }
                        )
                    )
                } else if let errorMessage {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 32, weight: .semibold))
                        Text(L10n.tr("common.operationFailed"))
                            .font(.headline)
                        Text(errorMessage)
                            .font(.subheadline)
                            .foregroundColor(AppColors.secondaryText)
                    }
                    .multilineTextAlignment(.center)
                    .padding(24)
                } else {
                    ProgressView()
                }
            }
        }
        .environmentObject(navigator)
        .task {
            guard launch == nil, errorMessage == nil else { return }
            do {
                let page = try await APIService.shared.getRecommendedGames(limit: 50)
                guard let game = page.items.first(where: { $0.id == "just_clear" }) else {
                    throw APIError.invalidResponse
                }
                let session = try await APIService.shared.createGameLobbySession(gameID: game.id)
                try GameLobbySessionResponseValidator.validate(session)
                let policy = AppRemoteConfigStore.shared.config.webViewPolicy.gameLaunchPolicy
                guard let url = URL(string: session.launchURL),
                      GameWebSecurity.allowsInitialGameURL(url, policy: policy) else {
                    throw APIError.invalidURL
                }
                launch = Launch(game: game, session: session, url: url)
            } catch {
                errorMessage = GameRoundStartErrorText.message(for: error)
            }
        }
    }
}
#endif
