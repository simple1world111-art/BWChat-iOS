// BBchat/Views/LoginView.swift
// Branded login page using the plush BBchat visual system.

import SwiftUI

struct LoginView: View {
    @StateObject private var viewModel = AuthViewModel()
    @State private var showRegister = false
    @State private var showPassword = false
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case username
        case password
    }

    var body: some View {
        GeometryReader { geo in
            let isEditing = focusedField != nil

            ZStack {
                AuthPlushBackground()

                ScrollView(showsIndicators: false) {
                    VStack(spacing: isEditing ? 10 : 15) {
                        Spacer()
                            .frame(height: AuthLayout.loginTopSpacing(height: geo.size.height, isEditing: isEditing))

                        AuthTitleLockup(
                            title: AppConfig.appName,
                            subtitle: L10n.tr("auth.login.subtitle")
                        )

                        AuthFormCard {
                            VStack(spacing: 14) {
                                AuthFieldChrome(
                                    systemImage: "person.fill",
                                    isFocused: focusedField == .username
                                ) {
                                    HStack(spacing: 8) {
                                        ZStack(alignment: .leading) {
                                            if viewModel.username.isEmpty {
                                                AuthFieldPlaceholder(L10n.tr("auth.username"))
                                            }

                                            TextField("", text: $viewModel.username)
                                                .textContentType(.username)
                                                .autocapitalization(.none)
                                                .disableAutocorrection(true)
                                                .font(.system(size: 16, weight: .medium))
                                                .foregroundColor(AuthPalette.inputText)
                                                .focused($focusedField, equals: .username)
                                                .submitLabel(.next)
                                                .onSubmit { focusedField = .password }
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
                                        }
                                    }
                                }
                                .contentShape(Rectangle())
                                .onTapGesture { focusedField = .username }

                                AuthFieldChrome(
                                    systemImage: "lock.fill",
                                    isFocused: focusedField == .password
                                ) {
                                    HStack(spacing: 8) {
                                        ZStack(alignment: .leading) {
                                            if viewModel.password.isEmpty {
                                                AuthFieldPlaceholder(L10n.tr("auth.password"))
                                            }

                                            Group {
                                                if showPassword {
                                                    TextField("", text: $viewModel.password)
                                                        .textContentType(.password)
                                                } else {
                                                    SecureField("", text: $viewModel.password)
                                                        .textContentType(.password)
                                                }
                                            }
                                            .font(.system(size: 16, weight: .medium))
                                            .foregroundColor(AuthPalette.inputText)
                                            .focused($focusedField, equals: .password)
                                            .submitLabel(.go)
                                            .onSubmit { submitLoginIfPossible() }
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
                                    }
                                }
                                .contentShape(Rectangle())
                                .onTapGesture { focusedField = .password }

                                if let error = viewModel.errorMessage {
                                    AuthInlineMessage(
                                        message: error,
                                        systemImage: "exclamationmark.triangle.fill",
                                        color: AppColors.errorColor
                                    )
                                }

                                AuthPrimaryButton(
                                    title: L10n.tr("auth.login.action"),
                                    isLoading: viewModel.isLoading,
                                    isEnabled: viewModel.isLoginEnabled
                                ) {
                                    submitLoginIfPossible()
                                }
                                .padding(.top, 4)

                                Button {
                                    showRegister = true
                                } label: {
                                    HStack(spacing: 4) {
                                        Text(L10n.tr("auth.noAccount"))
                                            .foregroundColor(AuthPalette.mutedText)
                                        Text(L10n.tr("auth.registerNow"))
                                            .foregroundColor(AuthPalette.coral)
                                            .fontWeight(.semibold)
                                    }
                                    .font(.system(size: 14, weight: .medium))
                                    .frame(maxWidth: .infinity)
                                    .padding(.top, 2)
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        Spacer()
                            .frame(height: isEditing ? 18 : 30)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, max(geo.safeAreaInsets.bottom, 14))
                    .frame(minHeight: geo.size.height)
                    .animation(.easeInOut(duration: 0.24), value: isEditing)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button(L10n.tr("common.done")) { focusedField = nil }
                    .font(.system(size: 15, weight: .semibold))
            }
        }
        .fullScreenCover(isPresented: $showRegister) {
            RegisterView()
        }
    }

    private func submitLoginIfPossible() {
        guard viewModel.isLoginEnabled else { return }
        focusedField = nil
        Task { await viewModel.login() }
    }
}

enum AuthPalette {
    static let blue = Color(hex: "55C7F2")
    static let coral = Color(hex: "FF6C7C")
    static let amber = Color(hex: "FFC76D")
    static let violet = Color(hex: "24103F")
    static let deepViolet = Color(hex: "130826")
    static let cardFill = Color(hex: "24103F").opacity(0.72)
    static let cardStroke = Color.white.opacity(0.18)
    static let fieldFill = Color.white.opacity(0.13)
    static let fieldStroke = Color.white.opacity(0.18)
    static let inputText = Color(hex: "FFF9FF")
    static let placeholderText = Color(hex: "E5DDF2").opacity(0.72)
    static let mutedText = Color(hex: "D8D0EA")
    static let disabledFill = Color.white.opacity(0.12)

    static let actionGradient = LinearGradient(
        colors: [blue, coral],
        startPoint: .leading,
        endPoint: .trailing
    )
}

enum AuthLayout {
    static func loginTopSpacing(height: CGFloat, isEditing: Bool) -> CGFloat {
        if isEditing {
            return max(min(height * 0.18, 156), 118)
        }
        return max(min(height * 0.42, 348), 286)
    }

    static func registerTopSpacing(height: CGFloat, isEditing: Bool) -> CGFloat {
        if isEditing {
            return max(min(height * 0.08, 74), 28)
        }
        return max(min(height * 0.34, 286), 220)
    }
}

struct AuthPlushBackground: View {
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .top) {
                Image("AuthPortraitBackdrop")
                    .resizable()
                    .scaledToFill()
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
                    .blur(radius: 20)
                    .scaleEffect(1.08)
                    .opacity(0.50)
                    .ignoresSafeArea()

                LinearGradient(
                    colors: [
                        AuthPalette.deepViolet,
                        AuthPalette.violet,
                        Color(hex: "1A0C2C")
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()

                Image("AuthPortraitBackdrop")
                    .resizable()
                    .scaledToFit()
                    .frame(width: geo.size.width)
                    .offset(y: -max(geo.safeAreaInsets.top * 0.22, 8))
                    .ignoresSafeArea(edges: .top)

                LinearGradient(
                    colors: [
                        Color.clear,
                        AuthPalette.deepViolet.opacity(0.20),
                        AuthPalette.deepViolet.opacity(0.86)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()

                RadialGradient(
                    colors: [AuthPalette.amber.opacity(0.18), Color.clear],
                    center: .top,
                    startRadius: 20,
                    endRadius: max(geo.size.width * 0.85, 320)
                )
                .ignoresSafeArea()
            }
        }
    }
}

struct AuthTitleLockup: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(.system(size: 35, weight: .heavy, design: .rounded))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.78)

            Text(subtitle)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white.opacity(0.78))
                .lineLimit(1)
                .minimumScaleFactor(0.82)
        }
        .frame(maxWidth: .infinity)
        .shadow(color: Color.black.opacity(0.22), radius: 10, x: 0, y: 4)
    }
}

struct AuthFormCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .fill(AuthPalette.cardFill)
            )
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .stroke(AuthPalette.cardStroke, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.32), radius: 24, x: 0, y: 14)
    }
}

struct AuthFieldPlaceholder: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.system(size: 16, weight: .medium))
            .foregroundColor(AuthPalette.placeholderText)
            .allowsHitTesting(false)
    }
}

struct AuthFieldChrome<Content: View>: View {
    let systemImage: String
    let isFocused: Bool
    let content: Content

    init(systemImage: String, isFocused: Bool, @ViewBuilder content: () -> Content) {
        self.systemImage = systemImage
        self.isFocused = isFocused
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(isFocused ? AuthPalette.coral : AuthPalette.blue)
                .frame(width: 22)

            content
        }
        .padding(.horizontal, 16)
        .frame(height: 52)
        .background(
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .fill(AuthPalette.fieldFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .stroke(isFocused ? AuthPalette.coral.opacity(0.78) : AuthPalette.fieldStroke, lineWidth: 1)
        )
    }
}

struct AuthPrimaryButton: View {
    let title: String
    let isLoading: Bool
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Text(title)
                        .font(.system(size: 17, weight: .bold))
                }
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(isEnabled ? AuthPalette.actionGradient : LinearGradient(colors: [AuthPalette.disabledFill], startPoint: .leading, endPoint: .trailing))
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(color: isEnabled ? AuthPalette.coral.opacity(0.30) : .clear, radius: 14, x: 0, y: 8)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
    }
}

struct AuthInlineMessage: View {
    let message: String
    let systemImage: String
    let color: Color

    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .padding(.top, 2)
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .foregroundColor(color)
        .padding(.horizontal, 2)
    }
}
