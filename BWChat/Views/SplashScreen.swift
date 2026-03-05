// BWChat/Views/SplashScreen.swift
// Launch screen with auto-login check

import SwiftUI

struct SplashScreen: View {
    @StateObject private var authManager = AuthManager.shared
    @State private var isCheckingToken = true

    var body: some View {
        Group {
            if isCheckingToken {
                splashView
            } else if authManager.isLoggedIn {
                ContactListView()
            } else {
                LoginView()
            }
        }
        .task {
            await checkToken()
        }
    }

    private var splashView: some View {
        VStack(spacing: 16) {
            Spacer()
            Text(AppConfig.appName)
                .font(.system(size: 28, weight: .light))
                .foregroundColor(AppColors.primaryText)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppColors.background)
    }

    private func checkToken() async {
        guard authManager.token != nil else {
            isCheckingToken = false
            return
        }

        do {
            let user = try await APIService.shared.verifyToken()
            authManager.updateUser(user)
            authManager.isLoggedIn = true

            // Connect WebSocket
            WebSocketService.shared.connect()

            // Request push permission
            PushService.shared.requestPermission()
        } catch {
            authManager.logout()
        }

        isCheckingToken = false
    }
}
