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
        if username.count < 3 { return L10n.tr("auth.validation.usernameTooShort") }
        if password.isBlank { return nil }
        if password.count < 6 { return L10n.tr("auth.validation.passwordTooShort") }
        if !confirmPassword.isBlank && password != confirmPassword {
            return L10n.tr("auth.validation.passwordMismatch")
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
            errorMessage = Self.localizedLoginError(error)
        } catch {
            errorMessage = L10n.tr("auth.login.failed")
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
            errorMessage = L10n.tr("auth.register.failed")
        }

        isLoading = false
    }

    private static func localizedLoginError(_ error: APIError) -> String {
        switch error {
        case .unauthorized:
            return L10n.tr("auth.login.invalidCredentials")
        case .serverError(_, let message):
            switch message.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "user_not_found", "invalid_credentials", "invalid_username_or_password", "incorrect_username_or_password":
                return L10n.tr("auth.login.invalidCredentials")
            default:
                return message
            }
        default:
            return error.errorDescription ?? L10n.tr("auth.login.failed")
        }
    }
}
