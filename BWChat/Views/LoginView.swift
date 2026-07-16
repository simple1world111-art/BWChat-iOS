// BBchat/Views/LoginView.swift
// Branded login page using the BBchat cat mascot system.

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

    private var catMood: AuthCatMood {
        switch focusedField {
        case .some(.username):
            return .peek
        case .some(.password):
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
                    VStack(spacing: isEditing ? 10 : 15) {
                        Spacer()
                            .frame(height: AuthLayout.loginTopSpacing(height: geo.size.height, isEditing: isEditing))

                        AuthTitleLockup(
                            title: AppConfig.appName,
                            subtitle: L10n.tr("auth.login.subtitle")
                        )

                        AuthCatFormStack(mood: catMood) {
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
                                                .accessibilityLabel(L10n.tr("common.clear"))
                                            }
                                        }
                                    }
                                    .contentShape(Rectangle())
                                    .onTapGesture { focusField(.username) }

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
                                            .accessibilityLabel(L10n.tr(showPassword ? "password.hide" : "password.show"))
                                        }
                                    }
                                    .contentShape(Rectangle())
                                    .onTapGesture { focusField(.password) }

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
                        }

                        Spacer()
                            .frame(height: isEditing ? 18 : 30)
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
        .fullScreenCover(isPresented: $showRegister) {
            RegisterView()
        }
    }

    private func submitLoginIfPossible() {
        guard viewModel.isLoginEnabled else { return }
        dismissKeyboard()
        Task { await viewModel.login() }
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

enum AuthPalette {
    static let blue = Color(hex: "4BB7E8")
    static let coral = Color(hex: "FF6C7C")
    static let tailGreen = Color(hex: "57DDBB")
    static let amber = Color(hex: "F4B642")
    static let ink = Color(hex: "20222E")
    static let softInk = Color(hex: "4A5160")
    static let cardFill = Color.white
    static let cardStroke = Color(hex: "E9ECF2")
    static let fieldFill = Color(hex: "F6F8FB")
    static let fieldStroke = Color(hex: "E2E7EF")
    static let inputText = ink
    static let placeholderText = Color(hex: "8E96A6")
    static let mutedText = Color(hex: "6B7280")
    static let disabledFill = Color(hex: "D9DEE7")

    static let actionGradient = LinearGradient(
        colors: [tailGreen, coral],
        startPoint: .leading,
        endPoint: .trailing
    )
}

enum AuthLayout {
    static func loginTopSpacing(height: CGFloat, isEditing: Bool) -> CGFloat {
        if isEditing {
            return max(min(height * 0.05, 44), 14)
        }
        return max(min(height * 0.10, 84), 54)
    }

    static func registerTopSpacing(height: CGFloat, isEditing: Bool) -> CGFloat {
        if isEditing {
            return max(min(height * 0.035, 30), 10)
        }
        return max(min(height * 0.07, 58), 28)
    }

    static let catFormTopPadding: CGFloat = 142
    static let catSize: CGFloat = 258
    static let catFloatingPeekOffset: CGFloat = -43
}

enum AuthMotion {
    static let focusShift: Animation = .spring(response: 0.36, dampingFraction: 0.88, blendDuration: 0.04)
    static let catMood: Animation = .spring(response: 0.42, dampingFraction: 0.90, blendDuration: 0.08)
}

enum AuthCatMood: CaseIterable, Equatable, Identifiable {
    case idle
    case peek
    case coverEyes

    var id: String { assetName }

    var assetName: String {
        switch self {
        case .idle:
            return "auth_cat_idle"
        case .peek:
            return "auth_cat_peek"
        case .coverEyes:
            return "auth_cat_cover"
        }
    }

    var artworkScale: CGFloat {
        switch self {
        case .idle:
            return 1.26
        case .peek:
            return 0.90
        case .coverEyes:
            return 1.22
        }
    }

    var artworkOffset: CGSize {
        switch self {
        case .idle:
            return CGSize(width: 0, height: 0)
        case .peek:
            return CGSize(width: 0, height: 0)
        case .coverEyes:
            return CGSize(width: 0, height: -3)
        }
    }
}

struct AuthWhiteBackground: View {
    var body: some View {
        Color.white.ignoresSafeArea()
    }
}

struct AuthCatFormStack<Content: View>: View {
    let mood: AuthCatMood
    let content: Content

    init(mood: AuthCatMood, @ViewBuilder content: () -> Content) {
        self.mood = mood
        self.content = content()
    }

    var body: some View {
        ZStack(alignment: .top) {
            AuthPeekCatView(mood: mood, hiddenMood: .peek)
                .frame(width: AuthLayout.catSize, height: AuthLayout.catSize)
                .zIndex(0)

            content
                .padding(.top, AuthLayout.catFormTopPadding)
                .zIndex(1)

            AuthFloatingPeekCatView(mood: mood)
                .frame(width: AuthLayout.catSize, height: AuthLayout.catSize)
                .offset(y: AuthLayout.catFloatingPeekOffset)
                .zIndex(3)
        }
        .frame(maxWidth: .infinity)
    }
}

struct AuthPeekCatView: View {
    let mood: AuthCatMood
    var hiddenMood: AuthCatMood?

    var body: some View {
        ZStack {
            ForEach(AuthCatMood.allCases) { candidate in
                Image(candidate.assetName)
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(candidate == mood ? candidate.artworkScale : candidate.artworkScale * 0.98)
                    .offset(candidate == mood ? candidate.artworkOffset : candidate.inactiveArtworkOffset)
                    .opacity(candidate == mood && candidate != hiddenMood ? 1 : 0)
            }
        }
        .animation(AuthMotion.catMood, value: mood)
        .compositingGroup()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct AuthFloatingPeekCatView: View {
    let mood: AuthCatMood

    var body: some View {
        Image(AuthCatMood.peek.assetName)
            .resizable()
            .scaledToFit()
            .scaleEffect(mood == .peek ? AuthCatMood.peek.artworkScale : AuthCatMood.peek.artworkScale * 0.98)
            .offset(mood == .peek ? AuthCatMood.peek.artworkOffset : AuthCatMood.peek.inactiveArtworkOffset)
            .opacity(mood == .peek ? 1 : 0)
            .animation(AuthMotion.catMood, value: mood)
            .compositingGroup()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

private extension AuthCatMood {
    var inactiveArtworkOffset: CGSize {
        CGSize(width: artworkOffset.width, height: artworkOffset.height + 4)
    }
}

struct AuthTitleLockup: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(.system(size: 35, weight: .heavy, design: .rounded))
                .foregroundColor(AuthPalette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.78)

            Text(subtitle)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(AuthPalette.mutedText)
                .lineLimit(1)
                .minimumScaleFactor(0.82)
        }
        .frame(maxWidth: .infinity)
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
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(AuthPalette.cardFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(AuthPalette.cardStroke, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.08), radius: 20, x: 0, y: 10)
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
                .foregroundColor(isFocused ? AuthPalette.tailGreen : AuthPalette.softInk.opacity(0.62))
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
                .stroke(isFocused ? AuthPalette.tailGreen.opacity(0.82) : AuthPalette.fieldStroke, lineWidth: 1)
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
