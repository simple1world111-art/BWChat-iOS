// BWChat/Views/BotConfigView.swift
// Create-or-edit form for a bot (智能体). Two modes:
//   .create  — shown as a sheet, Save dismisses via @Environment(\.dismiss)
//   .edit    — pushed onto UIKitNav, Save persists and pops back to chat

import SwiftUI
import PhotosUI
import UIKit

struct BotConfigView: View {
    enum Mode {
        case create
        case edit(BotConfig)
    }

    let mode: Mode
    var onClearHistory: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var store = BotStore.shared

    @State private var draft: BotConfig
    @State private var draftEmoji: String
    @State private var draftName: String
    @State private var draftAvatarURL: String
    @State private var draftCharacterBackground: String
    @State private var draftGender: String
    @State private var draftOpeningLine: String
    @State private var draftIsPublic: Bool
    @State private var nameHeight: CGFloat = 40
    @State private var characterBackgroundHeight: CGFloat = 186
    @State private var openingLineHeight: CGFloat = 88
    @State private var selectedAvatarPhoto: PhotosPickerItem?
    @State private var isUploadingAvatar = false
    @State private var isSaving = false
    @State private var isDeletingBot = false
    @State private var isGeneratingCharacterBackground = false
    @State private var isGeneratingOpeningLine = false
    @State private var activeAlert: BotConfigAlert?
    @State private var activeConfirmation: BotConfigConfirmation?
    @State private var toastMessage: String?
    @State private var focusedField: Field?

    private enum Field: Hashable {
        case name, characterBackground, openingLine
    }

    private enum BotConfigAlert: Identifiable {
        case operationFailed(String)

        var id: String {
            switch self {
            case .operationFailed(let message):
                return "operationFailed-\(message)"
            }
        }
    }

    private enum BotConfigConfirmation: String, Identifiable {
        case clearHistory
        case deleteBot

        var id: String { rawValue }

        var title: String {
            switch self {
            case .clearHistory:
                return L10n.tr("bot.config.clearHistory.title")
            case .deleteBot:
                return L10n.tr("bot.config.delete.title")
            }
        }

        var message: String {
            switch self {
            case .clearHistory:
                return L10n.tr("common.irreversible")
            case .deleteBot:
                return L10n.tr("bot.config.delete.message")
            }
        }

        var actionTitle: String {
            switch self {
            case .clearHistory:
                return L10n.tr("bot.config.clearHistory.action")
            case .deleteBot:
                return L10n.tr("bot.config.delete.action")
            }
        }

        var icon: String {
            switch self {
            case .clearHistory:
                return "trash.fill"
            case .deleteBot:
                return "person.crop.circle.badge.xmark"
            }
        }
    }

    init(mode: Mode, onClearHistory: (() -> Void)? = nil) {
        self.mode = mode
        self.onClearHistory = onClearHistory
        let initialBot: BotConfig
        switch mode {
        case .create:
            initialBot = BotConfig(
                name: "",
                emoji: "🤖",
                characterBackground: ""
            )
        case .edit(let bot):
            initialBot = bot
        }

        _draft = State(initialValue: initialBot)
        _draftEmoji = State(initialValue: initialBot.emoji)
        _draftName = State(initialValue: initialBot.name)
        _draftAvatarURL = State(initialValue: initialBot.avatarURL)
        _draftCharacterBackground = State(initialValue: initialBot.characterBackground)
        _draftGender = State(initialValue: BotConfig.normalizedGender(initialBot.gender))
        _draftOpeningLine = State(initialValue: initialBot.openingLine)
        _draftIsPublic = State(initialValue: initialBot.isPublic)
    }

    private var isCreate: Bool {
        if case .create = mode { return true }
        return false
    }

    private var canSave: Bool {
        !draftName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !draftGender.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !draftCharacterBackground.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !draftOpeningLine.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func focusBinding(_ field: Field) -> Binding<Bool> {
        Binding(
            get: { focusedField == field },
            set: { isFocused in
                if isFocused {
                    focusedField = field
                } else if focusedField == field {
                    focusedField = nil
                }
            }
        )
    }

    var body: some View {
        Group {
            if isCreate {
                NavigationStack { form }
            } else {
                form
            }
        }
    }

    @ViewBuilder
    private var form: some View {
        ScrollView {
            VStack(spacing: 18) {
                basicInfoCard
                settingDescriptionCard
                disclaimerText

                if !isCreate {
                    clearHistorySection
                    if draft.id != BotConfig.defaultBot.id {
                        deleteSection
                    }
                }
            }
            .padding(.horizontal, 15)
            .padding(.top, 16)
            .padding(.bottom, 118)
        }
        .background(formBackground)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            bottomActionBar
        }
        .navigationTitle(isCreate ? L10n.tr("bot.config.createTitle") : L10n.tr("bot.config.editTitle"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                leadingNavigationButton
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button(L10n.tr("common.done")) { focusedField = nil }
            }
        }
        .alert(item: $activeAlert) { alert in
            botConfigAlert(for: alert)
        }
        .centerToast(message: $toastMessage)
        .overlay {
            confirmationOverlay
        }
        .animation(.easeOut(duration: 0.18), value: activeConfirmation?.id)
    }

    @ViewBuilder
    private var leadingNavigationButton: some View {
        if isCreate {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(Color(hex: "151722"))
                    .frame(width: 38, height: 38)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.tr("common.cancel"))
        } else {
            AppBackButton {
                navigator.pop()
            }
        }
    }

    private var formBackground: some View {
        LinearGradient(
            colors: [
                Color(hex: "F0EDFF"),
                Color(hex: "F7F7FA"),
                Color(hex: "F7F7FA")
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }

    private var basicInfoCard: some View {
        formCard {
            Text(L10n.tr("bot.config.basicInfo"))
                .font(.system(size: 19, weight: .bold))
                .foregroundColor(AppColors.primaryText)

            VStack(spacing: 0) {
                formInlineRow(title: L10n.tr("bot.config.avatar"), required: false) {
                    PhotosPicker(selection: $selectedAvatarPhoto, matching: .images) {
                        HStack(spacing: 10) {
                            ZStack {
                                BotAvatar(avatarURL: draftAvatarURL, emoji: displayEmoji, size: 42)
                                if isUploadingAvatar {
                                    Circle()
                                        .fill(Color.black.opacity(0.28))
                                    ProgressView()
                                        .scaleEffect(0.7)
                                        .tint(.white)
                                }
                            }
                            .frame(width: 42, height: 42)

                            Text(isUploadingAvatar ? L10n.tr("common.uploading") : L10n.tr("bot.config.changeAvatar"))
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(AppColors.accent)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .disabled(isUploadingAvatar)
                    .onChange(of: selectedAvatarPhoto) { item in
                        guard let item else { return }
                        selectedAvatarPhoto = nil
                        Task { await uploadAvatar(item) }
                    }
                }

                formDivider

                formInlineRow(title: L10n.tr("profile.nickname"), required: true) {
                    singleLineInput(
                        text: $draftName,
                        height: $nameHeight,
                        field: .name,
                        placeholder: L10n.tr("bot.config.name.placeholder")
                    )
                }

                formDivider

                formInlineRow(title: L10n.tr("profile.gender"), required: true) {
                    HStack(spacing: 42) {
                        genderChoice(title: L10n.tr("profile.gender.male"), symbol: "♂", tag: "male", tint: Color(hex: "4D9CFF"))
                        genderChoice(title: L10n.tr("profile.gender.female"), symbol: "♀", tag: "female", tint: Color(hex: "FF6AA2"))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                formDivider

                formInlineRow(title: L10n.tr("group.isPublic"), required: false) {
                    HStack(spacing: 10) {
                        Text(draftIsPublic ? L10n.tr("group.public") : L10n.tr("group.private"))
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(draftIsPublic ? AppColors.accent : AppColors.secondaryText)

                        Spacer(minLength: 8)

                        Toggle("", isOn: $draftIsPublic)
                            .labelsHidden()
                            .tint(AppColors.accent)
                    }
                }
            }
        }
    }

    private var settingDescriptionCard: some View {
        formCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center) {
                    requiredLabel(L10n.tr("bot.config.characterBackground"), required: true)
                    Spacer()
                    Button {
                        generateCharacterBackground()
                    } label: {
                        generationButtonLabel(isGenerating: isGeneratingCharacterBackground)
                    }
                    .buttonStyle(.plain)
                    .disabled(isGeneratingCharacterBackground)
                }

                multilineInput(
                    text: $draftCharacterBackground,
                    height: $characterBackgroundHeight,
                    field: .characterBackground,
                    placeholder: L10n.tr("bot.config.characterBackground.placeholder"),
                    minHeight: 186,
                    maxHeight: 240
                )
            }

            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center) {
                    requiredLabel(L10n.tr("bot.config.openingLine"), required: true)
                    Spacer()
                    Button {
                        generateOpeningLine()
                    } label: {
                        generationButtonLabel(isGenerating: isGeneratingOpeningLine)
                    }
                    .buttonStyle(.plain)
                    .disabled(isGeneratingOpeningLine)
                }

                multilineInput(
                    text: $draftOpeningLine,
                    height: $openingLineHeight,
                    field: .openingLine,
                    placeholder: L10n.tr("bot.config.openingLine.placeholder"),
                    minHeight: 88,
                    maxHeight: 150
                )
            }
        }
    }

    private var disclaimerText: some View {
        Text(L10n.tr("bot.config.disclaimer"))
            .font(.system(size: 13))
            .foregroundColor(AppColors.tertiaryText)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 2)
            .padding(.horizontal, 8)
    }

    private var bottomActionBar: some View {
        VStack(spacing: 0) {
            Button {
                save()
            } label: {
                Text(isSaving ? L10n.tr("bot.config.saving") : (isCreate ? L10n.tr("bot.config.next") : L10n.tr("common.save")))
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.white.opacity(canSave && !isSaving ? 1 : 0.42))
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                    .background(
                        LinearGradient(
                            colors: [
                                Color(hex: "7617E8"),
                                Color(hex: "B865FF")
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .cornerRadius(11)
                    .opacity(canSave && !isSaving ? 1 : 0.78)
            }
            .buttonStyle(.plain)
            .disabled(!canSave || isSaving)
            .padding(.horizontal, 15)
            .padding(.top, 12)
            .padding(.bottom, 12)
        }
        .background(
            LinearGradient(
                colors: [
                    Color(hex: "F7F7FA").opacity(0),
                    Color(hex: "F7F7FA")
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
        )
    }

    private func formCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 26) {
            content()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .cornerRadius(14)
    }

    private func formInlineRow<Content: View>(
        title: String,
        required: Bool,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(alignment: .center, spacing: 18) {
            requiredLabel(title, required: required)
                .frame(width: 84, alignment: .leading)
            content()
        }
        .frame(minHeight: 54)
    }

    private func requiredLabel(_ title: String, required: Bool) -> some View {
        HStack(spacing: 4) {
            Text(title)
                .font(.system(size: 17, weight: .medium))
                .foregroundColor(AppColors.primaryText)
            if required {
                Text("*")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(Color(hex: "FF4F7B"))
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private var formDivider: some View {
        Rectangle()
            .fill(Color(hex: "ECECF2"))
            .frame(height: 1)
            .padding(.leading, 102)
    }

    private func singleLineInput(
        text: Binding<String>,
        height: Binding<CGFloat>,
        field: Field,
        placeholder: String
    ) -> some View {
        ZStack(alignment: .leading) {
            ChatInputTextView(
                text: text,
                isFocused: focusBinding(field),
                height: height,
                minHeight: 40,
                maxHeight: 40,
                returnKeyType: .done,
                enablesReturnKeyAutomatically: false,
                allowsNewline: false
            )
            .frame(height: height.wrappedValue)

            Text(placeholder)
                .font(.system(size: 16))
                .foregroundColor(AppColors.tertiaryText)
                .opacity(text.wrappedValue.isEmpty && focusedField != field ? 1 : 0)
                .allowsHitTesting(false)
        }
        .contentShape(Rectangle())
        .onTapGesture { focusedField = field }
    }

    private func multilineInput(
        text: Binding<String>,
        height: Binding<CGFloat>,
        field: Field,
        placeholder: String,
        minHeight: CGFloat,
        maxHeight: CGFloat
    ) -> some View {
        ZStack(alignment: .topLeading) {
            ChatInputTextView(
                text: text,
                isFocused: focusBinding(field),
                height: height,
                minHeight: minHeight,
                maxHeight: maxHeight,
                returnKeyType: .default,
                enablesReturnKeyAutomatically: false,
                allowsNewline: true
            )
            .frame(height: height.wrappedValue)

            Text(placeholder)
                .font(.system(size: 16))
                .foregroundColor(AppColors.tertiaryText)
                .padding(.top, 12)
                .padding(.leading, 2)
                .opacity(text.wrappedValue.isEmpty && focusedField != field ? 1 : 0)
                .allowsHitTesting(false)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .topLeading)
        .background(Color(hex: "F8F8F9"))
        .cornerRadius(7)
        .contentShape(Rectangle())
        .onTapGesture { focusedField = field }
    }

    private func genderChoice(title: String, symbol: String, tag: String, tint: Color) -> some View {
        let selected = draftGender == tag
        return Button {
            draftGender = tag
        } label: {
            HStack(spacing: 9) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundColor(selected ? tint : Color(hex: "C7C8CF"))
                Text(title)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(AppColors.primaryText)
                Text(symbol)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(tint)
            }
        }
        .buttonStyle(.plain)
    }

    private func generationButtonLabel(isGenerating: Bool) -> some View {
        HStack(spacing: 6) {
            if isGenerating {
                ProgressView()
                    .scaleEffect(0.72)
                    .tint(Color(hex: "B88CFF"))
            }
            Text(isGenerating ? L10n.tr("bot.config.generating") : L10n.tr("bot.config.randomGenerate"))
                .font(.system(size: 16, weight: .semibold))
        }
        .foregroundColor(Color(hex: "B88CFF"))
    }

    private func generateCharacterBackground() {
        focusedField = nil
        Task { await generateCharacterBackgroundAsync() }
    }

    private func generateOpeningLine() {
        focusedField = nil
        Task { await generateOpeningLineAsync() }
    }

    private func generateCharacterBackgroundAsync() async {
        guard !isGeneratingCharacterBackground else { return }
        isGeneratingCharacterBackground = true
        defer { isGeneratingCharacterBackground = false }

        do {
            let generated = try await APIService.shared.generateChatbotCharacterBackground(
                name: draftNameForGeneration,
                gender: draftGender
            )
            draftCharacterBackground = generated
        } catch let error as APIError {
            activeAlert = .operationFailed(error.errorDescription ?? L10n.tr("bot.config.characterBackground.generateFailed"))
        } catch {
            activeAlert = .operationFailed(L10n.tr("bot.config.characterBackground.generateFailed"))
        }
    }

    private func generateOpeningLineAsync() async {
        guard !isGeneratingOpeningLine else { return }
        isGeneratingOpeningLine = true
        defer { isGeneratingOpeningLine = false }

        do {
            let generated = try await APIService.shared.generateChatbotOpeningLine(
                name: draftNameForGeneration,
                gender: draftGender,
                characterBackground: draftCharacterBackground
            )
            draftOpeningLine = generated
        } catch let error as APIError {
            activeAlert = .operationFailed(error.errorDescription ?? L10n.tr("bot.config.openingLine.generateFailed"))
        } catch {
            activeAlert = .operationFailed(L10n.tr("bot.config.openingLine.generateFailed"))
        }
    }

    private var draftNameForGeneration: String {
        draftName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var displayName: String {
        let trimmed = draftName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? L10n.tr("bot.config.unnamed") : trimmed
    }

    private var displayEmoji: String {
        let trimmed = draftEmoji.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "🤖" : trimmed
    }

    private var profilePreview: some View {
        let genderTint = draftGender == "male" ? Color(hex: "4D9CFF") : Color(hex: "FF6AA2")
        let genderTitle = draftGender == "male" ? L10n.tr("bot.gender.male") : L10n.tr("bot.gender.female")

        return HStack(spacing: 12) {
            ZStack {
                BotAvatar(avatarURL: draftAvatarURL, emoji: displayEmoji, size: 58)
                if isUploadingAvatar {
                    Circle()
                        .fill(Color.black.opacity(0.28))
                    ProgressView()
                        .tint(.white)
                }
            }
            .frame(width: 58, height: 58)

            VStack(alignment: .leading, spacing: 7) {
                Text(displayName)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Image(systemName: draftGender == "male" ? "person.fill" : "person.fill")
                        .font(.system(size: 11, weight: .semibold))
                    Text(genderTitle)
                        .font(.system(size: 12, weight: .semibold))
                }
                .foregroundColor(genderTint)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(genderTint.opacity(0.10))
                .cornerRadius(8)
            }

            Spacer()

            Image(systemName: "sparkles")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)
        }
        .padding(14)
        .background(AppColors.cardBackground)
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.black.opacity(0.04), lineWidth: 1)
        )
    }

    private var basicsSection: some View {
        settingsSection(title: L10n.tr("bot.config.appearance"), systemImage: "person.crop.circle") {
            settingsRow(icon: "face.smiling", title: L10n.tr("bot.config.avatar")) {
                PhotosPicker(selection: $selectedAvatarPhoto, matching: .images) {
                    HStack(spacing: 8) {
                        Text(isUploadingAvatar ? L10n.tr("common.uploading") : L10n.tr("common.change"))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(AppColors.accent)
                        BotAvatar(avatarURL: draftAvatarURL, emoji: draftEmoji, size: 36)
                            .overlay(
                                Circle()
                                    .stroke(AppColors.separator, lineWidth: 1)
                            )
                    }
                }
                .disabled(isUploadingAvatar)
                .onChange(of: selectedAvatarPhoto) { item in
                    guard let item else { return }
                    selectedAvatarPhoto = nil
                    Task { await uploadAvatar(item) }
                }
            }
            sectionDivider
            settingsRow(icon: "textformat", title: L10n.tr("bot.config.name")) {
                ZStack(alignment: .trailing) {
                    ChatInputTextView(
                        text: $draftName,
                        isFocused: focusBinding(.name),
                        height: $nameHeight,
                        minHeight: 40,
                        maxHeight: 40,
                        returnKeyType: .done,
                        enablesReturnKeyAutomatically: false,
                        allowsNewline: false,
                        textAlignment: .right
                    )
                    .frame(height: nameHeight)

                    Text(L10n.tr("bot.config.name.example"))
                        .foregroundColor(AppColors.tertiaryText)
                        .opacity(draftName.isEmpty && focusedField != .name ? 1 : 0)
                        .allowsHitTesting(false)
                }
                .padding(.horizontal, 10)
                .background(Color(hex: "F8F8FC"))
                .cornerRadius(8)
                .contentShape(Rectangle())
                .frame(maxWidth: 220, minHeight: 40, alignment: .trailing)
                .onTapGesture { focusedField = .name }
            }
        }
    }

    private var characterSection: some View {
        settingsSection(title: L10n.tr("bot.config.characterSettings"), systemImage: "sparkles") {
            VStack(alignment: .leading, spacing: 10) {
                controlHeader(L10n.tr("bot.config.characterHeader"))

                ZStack(alignment: .topLeading) {
                    ChatInputTextView(
                        text: $draftCharacterBackground,
                        isFocused: focusBinding(.characterBackground),
                        height: $characterBackgroundHeight,
                        minHeight: 120,
                        maxHeight: 220,
                        returnKeyType: .default,
                        enablesReturnKeyAutomatically: false,
                        allowsNewline: true
                    )
                    .frame(height: characterBackgroundHeight)

                    Text(L10n.tr("bot.config.characterBackground.example"))
                        .font(.system(size: 15))
                        .foregroundColor(AppColors.tertiaryText)
                        .padding(.top, 8)
                        .padding(.horizontal, 5)
                        .opacity(
                            draftCharacterBackground.isEmpty
                            && focusedField != .characterBackground ? 1 : 0
                        )
                        .allowsHitTesting(false)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Color(hex: "F8F8FC"))
                .cornerRadius(8)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(
                            focusedField == .characterBackground
                                ? AppColors.accent.opacity(0.32)
                                : Color.black.opacity(0.04),
                            lineWidth: 1
                        )
                )
                .contentShape(Rectangle())
                .frame(maxWidth: .infinity, alignment: .leading)
                .onTapGesture { focusedField = .characterBackground }
            }
        }
    }

    private var clearHistorySection: some View {
        settingsSection {
            actionButton(
                title: L10n.tr("bot.config.clearHistory.action"),
                icon: "trash",
                tint: AppColors.errorColor
            ) {
                requestClearHistoryConfirmation()
            }
        }
    }

    private var deleteSection: some View {
        settingsSection {
            actionButton(
                title: L10n.tr("bot.config.delete.action"),
                icon: "person.crop.circle.badge.xmark",
                tint: AppColors.errorColor,
                isLoading: isDeletingBot
            ) {
                requestDeleteBotConfirmation()
            }
        }
    }

    @ViewBuilder
    private var confirmationOverlay: some View {
        if let activeConfirmation {
            GeometryReader { proxy in
                let frame = proxy.frame(in: .global)
                let screenBounds = UIScreen.main.bounds
                let dialogCenter = CGPoint(
                    x: screenBounds.midX - frame.minX,
                    y: screenBounds.midY - frame.minY
                )

                ZStack {
                    Color.black.opacity(0.10)
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture {
                            self.activeConfirmation = nil
                        }

                    BotConfigConfirmationDialog(
                        icon: activeConfirmation.icon,
                        title: activeConfirmation.title,
                        message: activeConfirmation.message,
                        actionTitle: activeConfirmation.actionTitle,
                        actionTint: AppColors.errorColor
                    ) {
                        self.activeConfirmation = nil
                    } onConfirm: {
                        confirm(activeConfirmation)
                    }
                    .padding(.horizontal, 28)
                    .position(dialogCenter)
                    .transition(.scale(scale: 0.96).combined(with: .opacity))
                }
                .ignoresSafeArea()
            }
            .zIndex(20)
        }
    }

    private func settingsSection<Content: View>(
        title: String? = nil,
        systemImage: String? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title {
                HStack(spacing: 6) {
                    if let systemImage {
                        Image(systemName: systemImage)
                            .font(.system(size: 12, weight: .semibold))
                    }
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                }
                .foregroundColor(AppColors.secondaryText)
                .padding(.horizontal, 2)
            }

            VStack(spacing: 0) {
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(AppColors.cardBackground)
            .cornerRadius(8)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.black.opacity(0.04), lineWidth: 1)
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func settingsRow<Content: View>(
        icon: String,
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: 12) {
            rowIcon(icon)
            rowTitle(title)
            Spacer(minLength: 12)
            content()
        }
        .frame(minHeight: 52)
    }

    private func rowTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 16, weight: .medium))
            .foregroundColor(AppColors.primaryText)
            .lineLimit(1)
            .minimumScaleFactor(0.82)
    }

    private func controlHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(AppColors.secondaryText)
            .padding(.leading, 2)
    }

    private func rowIcon(_ name: String) -> some View {
        Image(systemName: name)
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(AppColors.accent)
            .frame(width: 28, height: 28)
            .background(AppColors.accentLight)
            .cornerRadius(8)
    }

    private var sectionDivider: some View {
        Rectangle()
            .fill(AppColors.separator)
            .frame(height: 1)
            .padding(.leading, 40)
    }

    private func actionButton(
        title: String,
        icon: String,
        tint: Color,
        isLoading: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(role: .destructive, action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                Spacer()
                if isLoading {
                    ProgressView()
                        .scaleEffect(0.72)
                        .tint(tint)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .opacity(0.45)
                }
            }
            .foregroundColor(tint)
            .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(BotConfigActionButtonStyle(tint: tint))
        .disabled(isSaving || isLoading)
        .opacity((isSaving || isLoading) ? 0.55 : 1)
    }

    private func requestClearHistoryConfirmation() {
        focusedField = nil
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        activeConfirmation = .clearHistory
    }

    private func requestDeleteBotConfirmation() {
        focusedField = nil
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        activeConfirmation = .deleteBot
    }

    private func confirm(_ confirmation: BotConfigConfirmation) {
        activeConfirmation = nil
        switch confirmation {
        case .clearHistory:
            clearHistory()
        case .deleteBot:
            Task { await deleteBot() }
        }
    }

    private func botConfigAlert(for alert: BotConfigAlert) -> Alert {
        switch alert {
        case .operationFailed(let message):
            return Alert(
                title: Text(L10n.tr("common.operationFailed")),
                message: Text(message),
                dismissButton: .default(Text(L10n.tr("common.ok")))
            )
        }
    }

    private func clearHistory() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        store.clearMessages(for: draft.id)
        onClearHistory?()
        toastMessage = L10n.tr("bot.config.clearHistory.success")
    }

    private func currentDraftBot() -> BotConfig {
        var bot = draft
        bot.name = draftName.trimmingCharacters(in: .whitespaces)
        bot.emoji = draftEmoji.trimmingCharacters(in: .whitespaces)
        if bot.emoji.isEmpty { bot.emoji = "🤖" }
        bot.avatarURL = draftAvatarURL
        bot.characterBackground = draftCharacterBackground
            .trimmingCharacters(in: .whitespacesAndNewlines)
        bot.gender = BotConfig.normalizedGender(draftGender)
        bot.openingLine = draftOpeningLine
            .trimmingCharacters(in: .whitespacesAndNewlines)
        bot.isPublic = draftIsPublic
        return bot
    }

    private func save() {
        focusedField = nil
        Task { await saveAsync() }
    }

    private func saveAsync() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }

        do {
            let saved = try await store.saveToServerAndStore(currentDraftBot())
            draft = saved
            draftAvatarURL = saved.avatarURL
            draftGender = BotConfig.normalizedGender(saved.gender)
            draftOpeningLine = saved.openingLine
            draftIsPublic = saved.isPublic
            if isCreate {
                dismiss()
            } else {
                navigator.pop()
            }
        } catch let error as APIError {
            activeAlert = .operationFailed(error.errorDescription ?? L10n.tr("bot.config.saveFailed"))
        } catch {
            activeAlert = .operationFailed(L10n.tr("bot.config.saveFailed"))
        }
    }

    private func deleteBot() async {
        guard !isSaving, !isDeletingBot else { return }
        isSaving = true
        isDeletingBot = true
        defer {
            isSaving = false
            isDeletingBot = false
        }

        do {
            try await store.deleteFromServerAndStore(draft.id)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            toastMessage = L10n.tr("bot.config.delete.success")
            try? await Task.sleep(nanoseconds: 650_000_000)
            navigator.popToRoot()
        } catch let error as APIError {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            activeAlert = .operationFailed(error.errorDescription ?? L10n.tr("bot.config.deleteFailed"))
        } catch {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            activeAlert = .operationFailed(L10n.tr("bot.config.deleteFailed"))
        }
    }

    private func uploadAvatar(_ item: PhotosPickerItem) async {
        isUploadingAvatar = true
        defer { isUploadingAvatar = false }

        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                throw APIError.invalidResponse
            }
            let serverBotID = try await resolvedBotIDForUpload()
            let oldURL = draftAvatarURL
            let avatarURL = try await APIService.shared.uploadBotAvatar(
                botID: serverBotID,
                imageData: data,
                filename: "bot_avatar_\(Int(Date().timeIntervalSince1970)).jpg"
            )
            if !oldURL.isEmpty {
                ImageCacheManager.shared.removeImage(for: ChatAppearanceStore.resolvedImagePath(oldURL))
            }
            ImageCacheManager.shared.removeImage(for: ChatAppearanceStore.resolvedImagePath(avatarURL))
            draftAvatarURL = avatarURL
            draft.id = serverBotID
            draft.avatarURL = avatarURL

            if !isCreate {
                var updated = draft
                updated.id = serverBotID
                updated.name = draftName.trimmingCharacters(in: .whitespaces)
                updated.emoji = draftEmoji.trimmingCharacters(in: .whitespaces)
                if updated.emoji.isEmpty { updated.emoji = "🤖" }
                updated.avatarURL = avatarURL
                updated.characterBackground = draftCharacterBackground
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                updated.gender = BotConfig.normalizedGender(draftGender)
                updated.openingLine = draftOpeningLine
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                updated.isPublic = draftIsPublic
                store.addOrUpdate(updated)
            } else {
                draft.avatarURL = avatarURL
                draftAvatarURL = avatarURL
            }
        } catch let error as APIError {
            activeAlert = .operationFailed(error.errorDescription ?? L10n.tr("bot.config.avatarUploadFailed"))
        } catch {
            activeAlert = .operationFailed(L10n.tr("bot.config.avatarUploadFailed"))
        }
    }

    private func resolvedBotIDForUpload() async throws -> String {
        let saved = try await store.saveToServerAndStore(currentDraftBot())
        draft = saved
        draftAvatarURL = saved.avatarURL
        draftName = saved.name
        draftEmoji = saved.emoji
        draftCharacterBackground = saved.characterBackground
        draftGender = BotConfig.normalizedGender(saved.gender)
        draftOpeningLine = saved.openingLine
        draftIsPublic = saved.isPublic
        return saved.id
    }
}

private struct BotConfigConfirmationDialog: View {
    let icon: String
    let title: String
    let message: String
    let actionTitle: String
    let actionTint: Color
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: icon)
                .font(.system(size: 22, weight: .bold))
                .foregroundColor(actionTint)
                .frame(width: 52, height: 52)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(
                    Circle()
                        .fill(actionTint.opacity(0.07))
                )
                .overlay(
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color.white.opacity(0.24),
                                    Color.white.opacity(0.03)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                )
                .overlay(
                    Circle()
                        .stroke(
                            LinearGradient(
                                colors: [
                                    Color.white.opacity(0.68),
                                    actionTint.opacity(0.12)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                )
                .shadow(color: actionTint.opacity(0.10), radius: 12, x: 0, y: 7)

            VStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(AppColors.primaryText)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.84)

                Text(message)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 12) {
                Button(action: onCancel) {
                    Text(L10n.tr("common.cancel"))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Color.white.opacity(0.13))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            Color.white.opacity(0.18),
                                            Color.white.opacity(0.02)
                                        ],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(
                                    LinearGradient(
                                        colors: [
                                            Color.white.opacity(0.58),
                                            Color.white.opacity(0.12)
                                        ],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    ),
                                    lineWidth: 1
                                )
                        )
                        .shadow(color: Color.black.opacity(0.04), radius: 8, x: 0, y: 4)
                }
                .buttonStyle(.plain)

                Button(action: onConfirm) {
                    Text(actionTitle)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(actionTint)
                        .lineLimit(1)
                        .minimumScaleFactor(0.70)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .background(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(actionTint.opacity(0.08))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(
                                    LinearGradient(
                                        colors: [
                                            Color.white.opacity(0.16),
                                            actionTint.opacity(0.06)
                                        ],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(
                                    LinearGradient(
                                        colors: [
                                            Color.white.opacity(0.46),
                                            actionTint.opacity(0.20)
                                        ],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    ),
                                    lineWidth: 1
                                )
                        )
                        .shadow(color: actionTint.opacity(0.08), radius: 10, x: 0, y: 5)
                }
                .buttonStyle(.plain)
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 22)
        .padding(.top, 24)
        .padding(.bottom, 20)
        .frame(maxWidth: 338)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color.white.opacity(0.14))
        )
        .shadow(color: Color.black.opacity(0.10), radius: 22, x: 0, y: 12)
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.76),
                            Color.white.opacity(0.18)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(Color.black.opacity(0.025), lineWidth: 0.5)
        )
    }
}

private struct BotConfigActionButtonStyle: ButtonStyle {
    let tint: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 4)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(tint.opacity(configuration.isPressed ? 0.09 : 0))
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
