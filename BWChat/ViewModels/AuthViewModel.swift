// BWChat/ViewModels/AuthViewModel.swift
// Authentication view model

import Foundation

@MainActor
class AuthViewModel: ObservableObject {
    @Published var username: String = ""
    @Published var password: String = ""
    @Published var confirmPassword: String = ""
    @Published var nickname: String = ""
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    var isLoginEnabled: Bool {
        !username.isBlank && !password.isBlank && !isLoading
    }

    /// Register button stays disabled until both passwords are non-empty
    /// AND match, plus username/password meet minimum lengths matching
    /// the server-side validation. Lets users see "passwords don't match"
    /// without making a round-trip.
    var isRegisterEnabled: Bool {
        !username.isBlank
            && username.count >= 3
            && password.count >= 6
            && password == confirmPassword
            && !isLoading
    }

    /// Inline validation hint for the register form, shown only when the
    /// user has typed something. Returns nil when the form is valid.
    var registerValidationHint: String? {
        if username.isBlank { return nil }
        if username.count < 3 { return "用户名至少 3 位" }
        if password.isBlank { return nil }
        if password.count < 6 { return "密码至少 6 位" }
        if !confirmPassword.isBlank && password != confirmPassword {
            return "两次输入的密码不一致"
        }
        return nil
    }

    func login() async {
        guard isLoginEnabled else { return }

        isLoading = true
        errorMessage = nil

        do {
            let deviceToken = PushService.shared.deviceToken
            let (token, refreshToken, user) = try await APIService.shared.login(
                username: username,
                password: password,
                deviceToken: deviceToken
            )
            AuthManager.shared.login(token: token, refreshToken: refreshToken, user: user)

            // Connect WebSocket
            WebSocketService.shared.connect()

            // Request push permission & ensure device token uploaded
            PushService.shared.requestPermission()
            PushService.shared.ensureTokenUploaded()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "登录失败，请稍后再试"
        }

        isLoading = false
    }

    func register() async {
        guard isRegisterEnabled else { return }

        isLoading = true
        errorMessage = nil

        do {
            let deviceToken = PushService.shared.deviceToken
            let (token, refreshToken, user) = try await APIService.shared.register(
                username: username,
                password: password,
                nickname: nickname.isBlank ? nil : nickname,
                deviceToken: deviceToken
            )
            AuthManager.shared.login(token: token, refreshToken: refreshToken, user: user)

            WebSocketService.shared.connect()
            PushService.shared.requestPermission()
            PushService.shared.ensureTokenUploaded()
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "注册失败，请稍后再试"
        }

        isLoading = false
    }
}
