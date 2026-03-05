// BWChat/ViewModels/AuthViewModel.swift
// Authentication view model

import Foundation

@MainActor
class AuthViewModel: ObservableObject {
    @Published var username: String = ""
    @Published var password: String = ""
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    var isLoginEnabled: Bool {
        !username.isBlank && !password.isBlank && !isLoading
    }

    func login() async {
        guard isLoginEnabled else { return }

        isLoading = true
        errorMessage = nil

        do {
            let deviceToken = PushService.shared.deviceToken
            let (token, user) = try await APIService.shared.login(
                username: username,
                password: password,
                deviceToken: deviceToken
            )
            AuthManager.shared.login(token: token, user: user)

            // Connect WebSocket
            WebSocketService.shared.connect()

            // Request push permission
            PushService.shared.requestPermission()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "登录失败，请稍后再试"
        }

        isLoading = false
    }
}
