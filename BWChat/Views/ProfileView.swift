// BWChat/Views/ProfileView.swift
// User profile page - view & navigate to edit

import SwiftUI
import UIKit

struct ProfileView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel = ProfileViewModel()
    @ObservedObject private var walletStore = WalletStore.shared
    @State private var toastMessage: String?

    private var profile: User? {
        viewModel.profile ?? AuthManager.shared.currentUser
    }

    private var displayName: String {
        displayValue(profile?.nickname, fallback: L10n.tr("profile.defaultUser"))
    }

    private var userID: String {
        displayValue(profile?.userID, fallback: "")
    }

    private var bioText: String {
        displayValue(profile?.bio, fallback: L10n.tr("profile.emptyBio"))
    }

    private var walletBalanceSubtitle: String {
        if let balance = walletStore.balance {
            return L10n.tr("profile.wallet.balance", balance)
        }
        return walletStore.isLoadingBalance ? L10n.tr("common.loading") : L10n.tr("common.tapToView")
    }

    private var profileCompleteness: Int {
        let fields = [
            hasValue(profile?.avatarURL),
            hasValue(profile?.nickname),
            hasValue(profile?.bio),
            hasValue(profile?.gender),
            hasValue(profile?.birthday),
            hasValue(profile?.location)
        ]
        let completed = fields.filter { $0 }.count
        return Int((Double(completed) / Double(fields.count) * 100).rounded())
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                RootTabTitle(localizedKey: "tab.profile")
                    .padding(.bottom, 2)

                profileHero

                if let errorMessage = viewModel.errorMessage, !errorMessage.isBlank {
                    ProfileNoticeBanner(message: errorMessage)
                }

                featureCards
                settingsCard
            }
            .padding(.horizontal, 16)
            .padding(.top, AppSpacing.rootTabTopInset)
            .padding(.bottom, 28)
        }
        .background(AppColors.secondaryBackground)
        .refreshable {
            await walletStore.refreshBalanceFromServer()
            await viewModel.loadProfile()
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task(id: AuthManager.shared.currentUser?.userID ?? "") {
            await walletStore.refreshBalanceFromServer()
            await viewModel.loadProfile()
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            Task { await walletStore.refreshBalanceFromServer() }
        }
        .toast(message: $toastMessage)
    }

    // MARK: - Hero

    private var profileHero: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 14) {
                heroAvatar

                VStack(alignment: .leading, spacing: 9) {
                    Text(displayName)
                        .font(.system(size: 25, weight: .bold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)

                    Button(action: copyUserID) {
                        HStack(spacing: 6) {
                            Text(userID.isEmpty ? L10n.tr("profile.idMissing") : "#\(userID)")
                                .lineLimit(1)
                            if !userID.isEmpty {
                                Image(systemName: "doc.on.doc")
                                    .font(.system(size: 12, weight: .bold))
                            }
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                    }
                    .buttonStyle(.plain)
                    .disabled(userID.isEmpty)

                    Text(bioText)
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Button(action: openEditProfile) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(AppColors.tertiaryText)
                        .frame(width: 44, height: 44, alignment: .trailing)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr("profile.editIdentity"))
            }

            followStats

            if profileCompleteness < 100 {
                ProfileCompletionMeter(progress: profileCompleteness)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 20)
        .frame(minHeight: 154, alignment: .center)
        .background(AppColors.cardBackground)
        .cornerRadius(18)
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(AppColors.separator.opacity(0.7), lineWidth: 1)
        )
    }

    private var heroAvatar: some View {
        ZStack(alignment: .bottomTrailing) {
            ZStack {
                Circle()
                    .strokeBorder(AppColors.accentGradient, lineWidth: 2)
                    .frame(width: 98, height: 98)

                AvatarView(url: profile?.avatarURL ?? "", size: 90)
                    .overlay(Circle().stroke(AppColors.cardBackground, lineWidth: 2))
            }

            Circle()
                .fill(AppColors.online)
                .frame(width: 17, height: 17)
                .overlay(Circle().stroke(AppColors.cardBackground, lineWidth: 3))
                .offset(x: -4, y: -4)
                .accessibilityLabel(L10n.tr("profile.online"))
        }
        .frame(width: 98, height: 98)
    }

    private var followStats: some View {
        HStack(spacing: 0) {
            profileStatButton(title: L10n.tr("follow.following"), value: profile?.followingCount ?? 0) {
                guard !userID.isBlank else { return }
                navigator.push(FollowingListView(userID: userID))
            }

            Divider()
                .frame(height: 28)

            profileStatButton(title: L10n.tr("follow.followers"), value: profile?.followerCount ?? 0) {
                guard !userID.isBlank else { return }
                navigator.push(FollowersListView(userID: userID))
            }
        }
        .padding(.top, 2)
    }

    private func profileStatButton(title: String, value: Int, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Text("\(value)")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(AppColors.primaryText)

                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(AppColors.secondaryText)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(userID.isBlank)
    }

    // MARK: - Feature Cards

    private var featureCards: some View {
        ProfileGroupedCard {
            VStack(spacing: 0) {
                ProfileMenuRow(
                    title: L10n.tr("profile.wallet"),
                    trailingText: walletBalanceSubtitle,
                    systemImage: "pawprint.fill",
                    colors: [Color(hex: "FFB703"), Color(hex: "FB8500")]
                ) {
                    navigator.push(WalletView())
                }

                ProfileRowDivider()

                ProfileMenuRow(
                    title: L10n.tr("profile.moments"),
                    systemImage: "camera.fill",
                    colors: [Color(hex: "3A86FF"), Color(hex: "8ECAE6")]
                ) {
                    navigator.push(MomentsView(
                        filterUserID: AuthManager.shared.currentUser?.userID,
                        pageTitleKey: "profile.moments"
                    ))
                }
            }
        }
    }

    // MARK: - Settings

    private var settingsCard: some View {
        ProfileGroupedCard {
            ProfileMenuRow(
                title: L10n.tr("settings.title"),
                systemImage: "gearshape.fill",
                colors: [Color(hex: "5E6AD2"), Color(hex: "2EC4B6")]
            ) {
                navigator.push(ProfileSettingsView(viewModel: viewModel))
            }
        }
    }

    // MARK: - Actions

    private func openEditProfile() {
        if let user = profile {
            viewModel.populateEditFields(from: user)
        }
        navigator.push(EditProfileView(viewModel: viewModel))
    }

    private func copyUserID() {
        guard !userID.isEmpty else { return }
        UIPasteboard.general.string = userID
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        toastMessage = L10n.tr("profile.idCopied")
    }

    private func displayValue(_ value: String?, fallback: String) -> String {
        let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : trimmed
    }

    private func hasValue(_ value: String?) -> Bool {
        !(value ?? "").isBlank
    }
}

private struct ProfileSettingsView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @EnvironmentObject private var languageStore: AppLanguageStore
    @ObservedObject var viewModel: ProfileViewModel
    @State private var showLogoutAlert = false

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                preferencesCard
                accountCard
                logoutCard
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 30)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("settings.title"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    navigator.pop()
                }
            }
        }
        .alert(L10n.tr("settings.logout.confirmTitle"), isPresented: $showLogoutAlert) {
            Button(L10n.tr("common.cancel"), role: .cancel) {}
            Button(L10n.tr("settings.logout.confirm"), role: .destructive) {
                Task {
                    try? await APIService.shared.logout()
                    AuthManager.shared.logout()
                }
            }
        } message: {
            Text(L10n.tr("settings.logout.message"))
        }
    }

    private var preferencesCard: some View {
        ProfileGroupedCard {
            ProfileMenuRow(
                title: L10n.tr("settings.language"),
                trailingText: languageStore.selectedLanguageName,
                systemImage: "globe",
                colors: [Color(hex: "2EC4B6"), Color(hex: "3A86FF")]
            ) {
                navigator.push(LanguageSettingsView())
            }
        }
    }

    private var accountCard: some View {
        ProfileGroupedCard {
            VStack(spacing: 0) {
                ProfileMenuRow(
                    title: L10n.tr("settings.usernameReset"),
                    trailingText: currentUsername,
                    systemImage: "person.text.rectangle.fill",
                    colors: [Color(hex: "7C3AED"), Color(hex: "3A86FF")]
                ) {
                    navigator.push(UsernameResetView(viewModel: viewModel))
                }

                ProfileRowDivider()

                ProfileMenuRow(
                    title: L10n.tr("settings.changePassword"),
                    systemImage: "key.fill",
                    colors: [Color(hex: "3A86FF"), Color(hex: "2EC4B6")]
                ) {
                    navigator.push(ChangePasswordView())
                }
            }
        }
    }

    private var currentUsername: String {
        (viewModel.profile ?? AuthManager.shared.currentUser)?.username ?? ""
    }

    private var logoutCard: some View {
        ProfileGroupedCard {
            Button {
                showLogoutAlert = true
            } label: {
                HStack(spacing: 13) {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(AppColors.errorColor.opacity(0.12))
                        .frame(width: 40, height: 40)
                        .overlay(
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundColor(AppColors.errorColor)
                        )

                    Text(L10n.tr("settings.logout"))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(AppColors.errorColor)

                    Spacer()
                }
                .contentShape(Rectangle())
                .padding(.vertical, 5)
            }
            .buttonStyle(.plain)
        }
    }
}

private struct LanguageSettingsView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @EnvironmentObject private var languageStore: AppLanguageStore

    var body: some View {
        ScrollView(showsIndicators: false) {
            ProfileGroupedCard {
                VStack(spacing: 0) {
                    ForEach(Array(AppLanguage.settingsOptions.enumerated()), id: \.element.id) { index, language in
                        LanguageSettingsRow(
                            language: language,
                            isSelected: languageStore.selectedLanguage == language
                        ) {
                            languageStore.setLanguage(language)
                        }

                        if index < AppLanguage.settingsOptions.count - 1 {
                            ProfileRowDivider()
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 30)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("language.title"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    navigator.pop()
                }
            }
        }
    }
}

private struct LanguageSettingsRow: View {
    let language: AppLanguage
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 13) {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(AppColors.accent.opacity(isSelected ? 0.16 : 0.08))
                    .frame(width: 40, height: 40)
                    .overlay(
                        Image(systemName: "character.bubble.fill")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(isSelected ? AppColors.accent : AppColors.tertiaryText)
                    )

                Text(language.nativeName)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)

                Spacer(minLength: 10)

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                }
            }
            .contentShape(Rectangle())
            .padding(.vertical, 5)
        }
        .buttonStyle(.plain)
    }
}

private struct UsernameResetView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject var viewModel: ProfileViewModel
    @State private var usernameText = ""
    @State private var isSubmitting = false
    @State private var toastMessage: String?

    private var currentUsername: String {
        (viewModel.profile ?? AuthManager.shared.currentUser)?.username ?? ""
    }

    private var trimmedUsername: String {
        usernameText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var validationMessage: String? {
        if trimmedUsername.isEmpty {
            return L10n.tr("username.reset.empty")
        }
        if trimmedUsername.count < 3 {
            return L10n.tr("username.reset.tooShort")
        }
        if trimmedUsername.count > 20 {
            return L10n.tr("username.reset.tooLong")
        }
        if trimmedUsername == currentUsername {
            return L10n.tr("username.reset.same")
        }
        return nil
    }

    private var canSubmit: Bool {
        validationMessage == nil && !isSubmitting
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 26) {
                    heroSection
                    inputSection

                    if !usernameText.isBlank, let validationMessage {
                        ProfileNoticeBanner(message: validationMessage)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 84)
                .padding(.bottom, 110)
            }
            .scrollDismissesKeyboard(.interactively)
            .onTapGesture {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
        }
        .background(Color.white)
        .navigationTitle(L10n.tr("username.reset.title"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    navigator.pop()
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            submitButton
                .padding(.horizontal, 46)
                .padding(.top, 12)
                .padding(.bottom, 24)
                .background(Color.white.opacity(0.96))
        }
        .toast(message: $toastMessage)
        .onAppear {
            if usernameText.isBlank {
                usernameText = currentUsername
            }
        }
    }

    private var heroSection: some View {
        VStack(spacing: 20) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 62, weight: .semibold))
                .foregroundColor(Color.black.opacity(0.12))

            VStack(spacing: 14) {
                Text(L10n.tr("username.reset.current", currentUsername))
                    .font(.system(size: 25, weight: .bold))
                    .foregroundColor(AppColors.primaryText)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.68)

                Text(L10n.tr("username.reset.description"))
                    .font(.system(size: 13, weight: .regular))
                    .foregroundColor(AppColors.secondaryText)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 10)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var inputSection: some View {
        ProfileGroupedCard {
            HStack(spacing: 12) {
                Text(L10n.tr("username.reset.field"))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)

                TextField(L10n.tr("username.reset.placeholder"), text: $usernameText)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(AppColors.primaryText)
                    .multilineTextAlignment(.trailing)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
            }
            .padding(.vertical, 7)
        }
    }

    private var submitButton: some View {
        Button {
            submit()
        } label: {
            HStack(spacing: 8) {
                if isSubmitting {
                    ProgressView()
                        .tint(AppColors.primaryText)
                }

                Text(isSubmitting ? L10n.tr("common.saving") : L10n.tr("username.reset.action"))
                    .font(.system(size: 17, weight: .semibold))
            }
            .foregroundColor(AppColors.primaryText)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(canSubmit ? AppColors.secondaryBackground : Color(hex: "EFEFEF"))
            )
        }
        .buttonStyle(.plain)
        .disabled(!canSubmit)
    }

    private func submit() {
        if let validationMessage {
            toastMessage = validationMessage
            return
        }

        Task {
            await updateUsername()
        }
    }

    private func updateUsername() async {
        guard !isSubmitting else { return }
        isSubmitting = true
        defer { isSubmitting = false }

        do {
            let updatedUser = try await APIService.shared.updateUsername(trimmedUsername)
            viewModel.profile = updatedUser
            viewModel.populateEditFields(from: updatedUser)
            AuthManager.shared.updateUser(updatedUser)
            toastMessage = L10n.tr("username.reset.updated")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.65) {
                navigator.pop()
            }
        } catch {
            toastMessage = localizedUsernameError(error)
        }
    }

    private func localizedUsernameError(_ error: Error) -> String {
        guard case APIError.serverError(_, let message) = error else {
            return error.localizedDescription
        }

        let payload = Self.usernameErrorPayload(from: message)
        let errorCode = payload?.code ?? message

        switch errorCode.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "invalid_username":
            return L10n.tr("username.reset.invalid")
        case "username_already_taken", "username_exists":
            return L10n.tr("username.reset.taken")
        case "username_change_too_soon", "username_change_cooldown":
            if let nextChangeText = Self.formattedCooldownDate(payload?.data?.usernameNextChangeAt) {
                return L10n.tr("username.reset.cooldownWithDate", nextChangeText)
            }
            return L10n.tr("username.reset.cooldown")
        default:
            if let payloadMessage = payload?.message?.trimmingCharacters(in: .whitespacesAndNewlines),
               !payloadMessage.isEmpty {
                return payloadMessage
            }
            return message.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    private static func usernameErrorPayload(from message: String) -> UsernameResetErrorPayload? {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{"),
              let data = trimmed.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(UsernameResetErrorPayload.self, from: data)
    }

    private static func formattedCooldownDate(_ rawValue: String?) -> String? {
        guard let rawValue, !rawValue.isEmpty else { return nil }

        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        let plainFormatter = ISO8601DateFormatter()
        plainFormatter.formatOptions = [.withInternetDateTime]

        guard let date = fractionalFormatter.date(from: rawValue) ?? plainFormatter.date(from: rawValue) else {
            return nil
        }

        let formatter = DateFormatter()
        formatter.locale = AppLanguageStore.shared.locale
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

private struct UsernameResetErrorPayload: Decodable {
    let code: String?
    let message: String?
    let data: UsernameResetErrorData?
}

private struct UsernameResetErrorData: Decodable {
    let usernameNextChangeAt: String?

    enum CodingKeys: String, CodingKey {
        case usernameNextChangeAt = "username_next_change_at"
    }
}

private struct ChangePasswordView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var showsCurrentPassword = false
    @State private var showsNewPassword = false
    @State private var showsConfirmPassword = false
    @State private var isSubmitting = false
    @State private var toastMessage: String?

    private var hasAnyInput: Bool {
        !currentPassword.isEmpty || !newPassword.isEmpty || !confirmPassword.isEmpty
    }

    private var validationMessage: String? {
        if currentPassword.isEmpty {
            return L10n.tr("password.validation.currentRequired")
        }
        if newPassword.count < 6 {
            return L10n.tr("password.validation.tooShort")
        }
        if newPassword == currentPassword {
            return L10n.tr("password.validation.sameAsCurrent")
        }
        if confirmPassword != newPassword {
            return L10n.tr("password.validation.confirmMismatch")
        }
        return nil
    }

    private var canSubmit: Bool {
        validationMessage == nil && !isSubmitting
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 16) {
                passwordForm

                if hasAnyInput, let validationMessage {
                    ProfileNoticeBanner(message: validationMessage)
                }

                submitButton
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .onTapGesture {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("password.title"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    navigator.pop()
                }
            }
        }
        .toast(message: $toastMessage)
    }

    private var passwordForm: some View {
        ProfileGroupedCard {
            VStack(spacing: 0) {
                SettingsPasswordRow(
                    title: L10n.tr("password.current"),
                    placeholder: L10n.tr("password.current.placeholder"),
                    text: $currentPassword,
                    isVisible: $showsCurrentPassword
                )

                ProfileRowDivider()

                SettingsPasswordRow(
                    title: L10n.tr("password.new"),
                    placeholder: L10n.tr("password.new.placeholder"),
                    text: $newPassword,
                    isVisible: $showsNewPassword
                )

                ProfileRowDivider()

                SettingsPasswordRow(
                    title: L10n.tr("password.confirm"),
                    placeholder: L10n.tr("password.confirm.placeholder"),
                    text: $confirmPassword,
                    isVisible: $showsConfirmPassword
                )
            }
        }
    }

    private var submitButton: some View {
        Button {
            submit()
        } label: {
            HStack(spacing: 8) {
                if isSubmitting {
                    ProgressView()
                        .tint(.white)
                }

                Text(isSubmitting ? L10n.tr("common.saving") : L10n.tr("password.save"))
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(canSubmit ? AppColors.accent : AppColors.tertiaryText)
            )
        }
        .buttonStyle(.plain)
        .disabled(!canSubmit)
    }

    private func submit() {
        if let message = validationMessage {
            toastMessage = message
            return
        }

        Task {
            await changePassword()
        }
    }

    private func changePassword() async {
        guard !isSubmitting else { return }
        isSubmitting = true
        defer { isSubmitting = false }

        do {
            try await APIService.shared.changePassword(
                currentPassword: currentPassword,
                newPassword: newPassword
            )
            currentPassword = ""
            newPassword = ""
            confirmPassword = ""
            toastMessage = L10n.tr("password.updated")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.65) {
                navigator.pop()
            }
        } catch {
            toastMessage = error.localizedDescription
        }
    }
}

private struct SettingsPasswordRow: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    @Binding var isVisible: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)

                Group {
                    if isVisible {
                        TextField(placeholder, text: $text)
                    } else {
                        SecureField(placeholder, text: $text)
                    }
                }
                .font(.system(size: 15))
                .foregroundColor(AppColors.primaryText)
                .textContentType(.password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            }

            Button {
                isVisible.toggle()
            } label: {
                Image(systemName: isVisible ? "eye.slash" : "eye")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.tertiaryText)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isVisible ? L10n.tr("password.hide") : L10n.tr("password.show"))
        }
        .padding(.vertical, 5)
    }
}

private struct ProfileGroupedCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(AppColors.cardBackground)
            .cornerRadius(14)
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(AppColors.separator.opacity(0.7), lineWidth: 1)
            )
    }
}

private struct ProfileCompletionMeter: View {
    let progress: Int

    private var normalizedProgress: CGFloat {
        min(max(CGFloat(progress) / 100, 0), 1)
    }

    var body: some View {
        HStack(spacing: 10) {
            Text(L10n.tr("profile.completeness"))
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(AppColors.secondaryText)

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(AppColors.separator)

                    Capsule()
                        .fill(AppColors.accentGradient)
                        .frame(width: proxy.size.width * normalizedProgress)
                }
            }
            .frame(height: 5)

            Text("\(progress)%")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(AppColors.accent)
        }
    }
}

private struct ProfileMenuRow: View {
    let title: String
    var subtitle: String? = nil
    var trailingText: String? = nil
    let systemImage: String
    let colors: [Color]
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 13) {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: colors,
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 40, height: 40)
                    .overlay(
                        Image(systemName: systemImage)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white)
                    )

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)

                    if let subtitle, !subtitle.isBlank {
                        Text(subtitle)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.82)
                    }
                }

                Spacer()

                HStack(spacing: 5) {
                    if let trailingText, !trailingText.isBlank {
                        Text(trailingText)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.78)
                    }

                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(AppColors.tertiaryText)
                }
            }
            .contentShape(Rectangle())
            .padding(.vertical, 5)
        }
        .buttonStyle(.plain)
    }
}

private struct ProfileNoticeBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 15, weight: .semibold))
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .foregroundColor(Color(hex: "8A4B00"))
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(hex: "FFF2CC"))
        )
    }
}

private struct ProfileRowDivider: View {
    var body: some View {
        Rectangle()
            .fill(AppColors.separator)
            .frame(height: 1)
            .padding(.leading, 55)
            .padding(.vertical, 10)
    }
}
