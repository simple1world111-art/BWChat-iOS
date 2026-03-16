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
            if isCheckingToken {
                splashView
            } else if authManager.isLoggedIn {
                MainTabView()
            } else {
                LoginView()
            }
        }
        .task {
            await checkToken()
        }
    }

    private var splashView: some View {
        ZStack {
            // Gradient background
            LinearGradient(
                colors: [Color(hex: "667EEA"), Color(hex: "764BA2")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 20) {
                // App icon
                ZStack {
                    Circle()
                        .fill(.white.opacity(0.15))
                        .frame(width: 100, height: 100)
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .font(.system(size: 40))
                        .foregroundColor(.white)
                }
                .scaleEffect(logoScale)
                .opacity(logoOpacity)

                Text(AppConfig.appName)
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                    .opacity(logoOpacity)
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
        // Show splash for at least 0.8s
        async let minDelay: Void = Task.sleep(nanoseconds: 800_000_000)

        guard authManager.token != nil else {
            try? await minDelay
            isCheckingToken = false
            return
        }

        do {
            let user = try await APIService.shared.verifyToken()
            authManager.updateUser(user)
            authManager.isLoggedIn = true
            WebSocketService.shared.connect()
            PushService.shared.requestPermission()
            // Re-upload device token (may have been cleared by previous logout)
            PushService.shared.ensureTokenUploaded()
        } catch {
            authManager.logout()
        }

        try? await minDelay
        isCheckingToken = false
    }
}
