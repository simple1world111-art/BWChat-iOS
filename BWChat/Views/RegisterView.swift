// BBchat/Views/RegisterView.swift
// Registration screen using the BBchat cat mascot system.

import SwiftUI

struct RegisterView: View {
    @StateObject private var viewModel = AuthViewModel()
    @Environment(\.dismiss) private var dismiss
    @State private var showPassword = false
    @State private var showConfirmPassword = false
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case username
        case nickname
        case password
        case confirmPassword
    }

    private var catMood: AuthCatMood {
        switch focusedField {
        case .some(.username), .some(.nickname):
            return .peek
        case .some(.password), .some(.confirmPassword):
            return .coverEyes
        case .none:
            return .idle
        }
    }

    var body: some View {
        GeometryReader { geo in
            let isEditing = focusedField != nil

            ZStack {
                AuthWhiteBackground()

                ScrollView(showsIndicators: false) {
                    VStack(spacing: isEditing ? 10 : 16) {
                        Spacer()
                            .frame(height: AuthLayout.registerTopSpacing(height: geo.size.height, isEditing: isEditing))

                        AuthTitleLockup(
                            title: L10n.tr("auth.register.title"),
                            subtitle: L10n.tr("auth.register.subtitle")
                        )

                        AuthCatFormStack(mood: catMood) {
                            AuthFormCard {
                                VStack(spacing: 13) {
                                    AuthFieldChrome(
                                        systemImage: "person.fill",
                                        isFocused: focusedField == .username
                                    ) {
                                        HStack(spacing: 8) {
                                            ZStack(alignment: .leading) {
                                                if viewModel.username.isEmpty {
                                                    AuthFieldPlaceholder(L10n.tr("auth.username.rules"))
                                                }

                                                TextField("", text: $viewModel.username)
                                                    .textContentType(.username)
                                                    .autocapitalization(.none)
                                                    .disableAutocorrection(true)
                                                    .font(.system(size: 16, weight: .medium))
                                                    .foregroundColor(AuthPalette.inputText)
                                                    .focused($focusedField, equals: .username)
                                                    .submitLabel(.next)
                                                    .onSubmit { focusedField = .nickname }
                                            }
                                            .frame(maxWidth: .infinity, alignment: .leading)

                                            if !viewModel.username.isEmpty {
                                                Button {
                                                    viewModel.username = ""
                                                } label: {
                                                    Image(systemName: "xmark.circle.fill")
                                                        .font(.system(size: 15, weight: .semibold))
                                                        .foregroundColor(AuthPalette.mutedText.opacity(0.55))
                                                }
                                                .buttonStyle(.plain)
                                                .accessibilityLabel(L10n.tr("common.clear"))
                                            }
                                        }
                                    }
                                    .contentShape(Rectangle())
                                    .onTapGesture { focusField(.username) }

                                    AuthFieldChrome(
                                        systemImage: "face.smiling",
                                        isFocused: focusedField == .nickname
                                    ) {
                                        HStack(spacing: 8) {
                                            ZStack(alignment: .leading) {
                                                if viewModel.nickname.isEmpty {
                                                    AuthFieldPlaceholder(L10n.tr("auth.nickname.optional"))
                                                }

                                                TextField("", text: $viewModel.nickname)
                                                    .autocapitalization(.none)
                                                    .disableAutocorrection(true)
                                                    .font(.system(size: 16, weight: .medium))
                                                    .foregroundColor(AuthPalette.inputText)
                                                    .focused($focusedField, equals: .nickname)
                                                    .submitLabel(.next)
                                                    .onSubmit { focusedField = .password }
                                            }
                                            .frame(maxWidth: .infinity, alignment: .leading)

                                            if !viewModel.nickname.isEmpty {
                                                Button {
                                                    viewModel.nickname = ""
                                                } label: {
                                                    Image(systemName: "xmark.circle.fill")
                                                        .font(.system(size: 15, weight: .semibold))
                                                        .foregroundColor(AuthPalette.mutedText.opacity(0.55))
                                                }
                                                .buttonStyle(.plain)
                                                .accessibilityLabel(L10n.tr("common.clear"))
                                            }
                                        }
                                    }
                                    .contentShape(Rectangle())
                                    .onTapGesture { focusField(.nickname) }

                                    AuthFieldChrome(
                                        systemImage: "lock.fill",
                                        isFocused: focusedField == .password
                                    ) {
                                        HStack(spacing: 8) {
                                            ZStack(alignment: .leading) {
                                                if viewModel.password.isEmpty {
                                                    AuthFieldPlaceholder(L10n.tr("auth.password.rules"))
                                                }

                                                Group {
                                                    if showPassword {
                                                        TextField("", text: $viewModel.password)
                                                            .textContentType(.newPassword)
                                                    } else {
                                                        SecureField("", text: $viewModel.password)
                                                            .textContentType(.newPassword)
                                                    }
                                                }
                                                .font(.system(size: 16, weight: .medium))
                                                .foregroundColor(AuthPalette.inputText)
                                                .focused($focusedField, equals: .password)
                                                .submitLabel(.next)
                                                .onSubmit { focusedField = .confirmPassword }
                                            }
                                            .frame(maxWidth: .infinity, alignment: .leading)

                                            Button {
                                                showPassword.toggle()
                                            } label: {
                                                Image(systemName: showPassword ? "eye.slash.fill" : "eye.fill")
                                                    .font(.system(size: 15, weight: .semibold))
                                                    .foregroundColor(AuthPalette.mutedText.opacity(0.72))
                                            }
                                            .buttonStyle(.plain)
                                            .accessibilityLabel(L10n.tr(showPassword ? "password.hide" : "password.show"))
                                        }
                                    }
                                    .contentShape(Rectangle())
                                    .onTapGesture { focusField(.password) }

                                    AuthFieldChrome(
                                        systemImage: "lock.rotation",
                                        isFocused: focusedField == .confirmPassword
                                    ) {
                                        HStack(spacing: 8) {
                                            ZStack(alignment: .leading) {
                                                if viewModel.confirmPassword.isEmpty {
                                                    AuthFieldPlaceholder(L10n.tr("auth.confirmPassword"))
                                                }

                                                Group {
                                                    if showConfirmPassword {
                                                        TextField("", text: $viewModel.confirmPassword)
                                                            .textContentType(.newPassword)
                                                    } else {
                                                        SecureField("", text: $viewModel.confirmPassword)
                                                            .textContentType(.newPassword)
                                                    }
                                                }
                                                .font(.system(size: 16, weight: .medium))
                                                .foregroundColor(AuthPalette.inputText)
                                                .focused($focusedField, equals: .confirmPassword)
                                                .submitLabel(.go)
                                                .onSubmit { submitRegisterIfPossible() }
                                            }
                                            .frame(maxWidth: .infinity, alignment: .leading)

                                            Button {
                                                showConfirmPassword.toggle()
                                            } label: {
                                                Image(systemName: showConfirmPassword ? "eye.slash.fill" : "eye.fill")
                                                    .font(.system(size: 15, weight: .semibold))
                                                    .foregroundColor(AuthPalette.mutedText.opacity(0.72))
                                            }
                                            .buttonStyle(.plain)
                                            .accessibilityLabel(L10n.tr(showConfirmPassword ? "password.hide" : "password.show"))
                                        }
                                    }
                                    .contentShape(Rectangle())
                                    .onTapGesture { focusField(.confirmPassword) }

                                    if let hint = viewModel.registerValidationHint {
                                        AuthInlineMessage(
                                            message: hint,
                                            systemImage: "info.circle.fill",
                                            color: AuthPalette.mutedText
                                        )
                                    } else if let error = viewModel.errorMessage {
                                        AuthInlineMessage(
                                            message: error,
                                            systemImage: "exclamationmark.triangle.fill",
                                            color: AppColors.errorColor
                                        )
                                    }

                                    AuthPrimaryButton(
                                        title: L10n.tr("auth.register.action"),
                                        isLoading: viewModel.isLoading,
                                        isEnabled: viewModel.isRegisterEnabled
                                    ) {
                                        submitRegisterIfPossible()
                                    }
                                    .padding(.top, 4)

                                    Button {
                                        dismiss()
                                    } label: {
                                        Text(L10n.tr("auth.haveAccount"))
                                            .font(.system(size: 14, weight: .semibold))
                                            .foregroundColor(AuthPalette.coral)
                                            .frame(maxWidth: .infinity)
                                            .padding(.top, 2)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }

                        Spacer()
                            .frame(height: isEditing ? 18 : 28)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, max(geo.safeAreaInsets.bottom, 14))
                    .frame(minHeight: geo.size.height)
                    .contentShape(Rectangle())
                    .onTapGesture { dismissKeyboard() }
                    .animation(AuthMotion.focusShift, value: isEditing)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button(L10n.tr("common.done")) { dismissKeyboard() }
                    .font(.system(size: 15, weight: .semibold))
            }
        }
    }

    private func submitRegisterIfPossible() {
        guard viewModel.isRegisterEnabled else { return }
        dismissKeyboard()
        Task { await viewModel.register() }
    }

    private func focusField(_ field: Field) {
        DispatchQueue.main.async {
            focusedField = field
        }
    }

    private func dismissKeyboard() {
        focusedField = nil
        hideKeyboard()
    }
}
