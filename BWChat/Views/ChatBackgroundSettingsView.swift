// BWChat/Views/ChatBackgroundSettingsView.swift
// Shared chat background picker for global, DM, group, and bot conversations.

import SwiftUI
import PhotosUI

struct ChatBackgroundSettingsView: View {
    let targetType: ChatBackgroundTargetType
    let targetID: String
    let title: String

    @ObservedObject private var appearanceStore = ChatAppearanceStore.shared
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var isUploading = false
    @State private var errorMessage: String?
    @State private var resolvedBotID: String?

    private var currentTargetID: String {
        resolvedBotID ?? targetID
    }

    private var exactBackground: ChatBackground? {
        appearanceStore.exactBackground(targetType: targetType, targetID: currentTargetID)
    }

    private var effectiveBackground: ChatBackground? {
        appearanceStore.effectiveBackground(targetType: targetType, targetID: currentTargetID)
    }

    private var restoreTitle: String {
        targetType == .global ? L10n.tr("chatBackground.restoreGlobal") : L10n.tr("chatBackground.restoreChat")
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                previewCard
                actionCard
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 28)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .task {
            await appearanceStore.loadIfNeeded()
            await resolveBotIDIfNeeded()
        }
        .onChange(of: selectedPhoto) { item in
            guard let item else { return }
            selectedPhoto = nil
            Task { await upload(item) }
        }
        .alert(L10n.tr("common.operationFailed"), isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button(L10n.tr("common.ok"), role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var previewCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(L10n.tr("chatBackground.currentPreview"))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                Spacer()
                Text(effectiveBackground == nil ? L10n.tr("chatBackground.default") : (exactBackground == nil ? L10n.tr("chatBackground.usingGlobal") : L10n.tr("chatBackground.set")))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(AppColors.secondaryText)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(hex: "F4F4F8"))
                    .cornerRadius(8)
            }

            ZStack {
                ChatBackgroundLayer(background: effectiveBackground)
                    .frame(height: 280)
                    .cornerRadius(8)

                if effectiveBackground == nil {
                    VStack(spacing: 8) {
                        Image(systemName: "photo")
                            .font(.system(size: 28, weight: .medium))
                        Text(L10n.tr("chatBackground.defaultGray"))
                            .font(.system(size: 14, weight: .medium))
                    }
                    .foregroundColor(AppColors.tertiaryText)
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.black.opacity(0.05), lineWidth: 1)
            )
        }
        .padding(14)
        .background(AppColors.cardBackground)
        .cornerRadius(8)
    }

    private var actionCard: some View {
        VStack(spacing: 0) {
            PhotosPicker(selection: $selectedPhoto, matching: .images) {
                settingsActionRow(
                    icon: "photo.on.rectangle",
                    title: isUploading ? L10n.tr("common.uploading") : L10n.tr("chatBackground.chooseFromAlbum"),
                    tint: AppColors.accent,
                    showProgress: isUploading
                )
            }
            .disabled(isUploading)

            Divider().padding(.leading, 56)

            Button {
                Task { await restoreDefault() }
            } label: {
                settingsActionRow(
                    icon: "arrow.counterclockwise",
                    title: restoreTitle,
                    tint: exactBackground == nil ? AppColors.tertiaryText : AppColors.errorColor
                )
            }
            .disabled(exactBackground == nil || isUploading)
        }
        .background(AppColors.cardBackground)
        .cornerRadius(8)
    }

    private func settingsActionRow(
        icon: String,
        title: String,
        tint: Color,
        showProgress: Bool = false
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(tint)
                .frame(width: 28, height: 28)
                .background(tint.opacity(0.10))
                .cornerRadius(8)

            Text(title)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(tint)

            Spacer()

            if showProgress {
                ProgressView()
                    .tint(tint)
            } else {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(AppColors.tertiaryText)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 13)
        .contentShape(Rectangle())
    }

    private func upload(_ item: PhotosPickerItem) async {
        isUploading = true
        defer { isUploading = false }

        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                throw APIError.invalidResponse
            }
            let uploadTargetID = try await resolvedTargetID()
            try await appearanceStore.uploadBackground(
                targetType: targetType,
                targetID: uploadTargetID,
                imageData: data
            )
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("chatBackground.uploadFailed")
        }
    }

    private func restoreDefault() async {
        do {
            let deleteTargetID = try await resolvedTargetID()
            try await appearanceStore.deleteBackground(targetType: targetType, targetID: deleteTargetID)
        } catch let error as APIError {
            errorMessage = error.errorDescription
        } catch {
            errorMessage = L10n.tr("chatBackground.restoreFailed")
        }
    }

    private func resolveBotIDIfNeeded() async {
        guard targetType == .bot else { return }
        resolvedBotID = await BotStore.shared.resolveServerBotID(for: targetID)
    }

    private func resolvedTargetID() async throws -> String {
        guard targetType == .bot else { return targetID }
        if let resolvedBotID {
            return resolvedBotID
        }
        let id = try await BotStore.shared.ensureServerBotID(for: targetID)
        resolvedBotID = id
        return id
    }
}
