// BWChat/Views/EditProfileView.swift
// Edit profile form - avatar, nickname, bio, gender, birthday, location

import SwiftUI
import PhotosUI

@MainActor
struct EditProfileView: View {
    @ObservedObject var viewModel: ProfileViewModel
    @EnvironmentObject private var navigator: UIKitNavigator

    @State private var selectedPhoto: PhotosPickerItem?
    @State private var showToast = false
    @State private var toastMessage = ""
    @State private var showBirthdayPicker = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                avatarSection(avatarURL: viewModel.profile?.avatarURL ?? "")

                formSection

                if showBirthdayPicker {
                    birthdayPickerSection
                }
            }
            .padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .onTapGesture {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("profile.edit.title"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    navigator.pop()
                }
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    Task {
                        await viewModel.saveProfile()
                        if viewModel.errorMessage == nil {
                            navigator.pop()
                        }
                    }
                } label: {
                    if viewModel.isSaving {
                        ProgressView()
                            .tint(AppColors.accent)
                    } else {
                        Text(L10n.tr("common.save"))
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(AppColors.accent)
                    }
                }
                .disabled(viewModel.isSaving || viewModel.editNickname.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .overlay {
            if showToast {
                VStack {
                    Spacer()
                    Text(toastMessage)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.black.opacity(0.75))
                        .cornerRadius(20)
                        .padding(.bottom, 30)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .animation(.easeInOut, value: showToast)
            }
        }
        .onChange(of: viewModel.errorMessage) { msg in
            if let msg = msg {
                showToastMessage(msg)
            }
        }
    }

    // MARK: - Avatar Section

    private func avatarSection(avatarURL: String) -> some View {
        VStack(spacing: 12) {
            PhotosPicker(selection: $selectedPhoto, matching: .images) {
                ZStack(alignment: .bottomTrailing) {
                    AvatarView(url: avatarURL, size: 88)
                        .shadow(color: AppColors.accent.opacity(0.2), radius: 6, x: 0, y: 3)

                    ZStack {
                        Circle()
                            .fill(AppColors.accent)
                            .frame(width: 28, height: 28)
                        Image(systemName: "camera.fill")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.white)
                    }
                    .offset(x: -2, y: -2)
                }
            }
            .onChange(of: selectedPhoto) { newValue in
                guard let item = newValue else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self) {
                        await viewModel.uploadAvatar(imageData: data)
                    }
                }
            }

            Text(L10n.tr("profile.avatar.change"))
                .font(.system(size: 13))
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 20)
    }

    // MARK: - Form Section

    private var formSection: some View {
        VStack(spacing: 0) {
            // Nickname
            editRow(title: L10n.tr("profile.nickname")) {
                TextField(L10n.tr("profile.nickname.placeholder"), text: $viewModel.editNickname)
                    .font(.system(size: 15))
                    .foregroundColor(AppColors.primaryText)
                    .multilineTextAlignment(.trailing)
            }
            Divider().padding(.leading, 16)

            // Bio
            editRow(title: L10n.tr("profile.bio")) {
                TextField(L10n.tr("profile.bio.placeholder"), text: $viewModel.editBio)
                    .font(.system(size: 15))
                    .foregroundColor(AppColors.primaryText)
                    .multilineTextAlignment(.trailing)
            }
            Divider().padding(.leading, 16)

            // Gender
            editRow(title: L10n.tr("profile.gender")) {
                Picker("", selection: $viewModel.editGender) {
                    Text(L10n.tr("profile.unset")).tag("")
                    Text(L10n.tr("profile.gender.male")).tag("male")
                    Text(L10n.tr("profile.gender.female")).tag("female")
                    Text(L10n.tr("profile.gender.other")).tag("other")
                }
                .pickerStyle(.menu)
                .tint(AppColors.primaryText)
            }
            Divider().padding(.leading, 16)

            // Birthday
            Button {
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                withAnimation(.easeInOut(duration: 0.25)) {
                    showBirthdayPicker.toggle()
                }
            } label: {
                HStack {
                    Text(L10n.tr("profile.birthday"))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(AppColors.primaryText)

                    Spacer()

                    Text(viewModel.editBirthday.isEmpty ? L10n.tr("profile.unset") : formattedEditBirthday)
                        .font(.system(size: 15))
                        .foregroundColor(viewModel.editBirthday.isEmpty ? AppColors.tertiaryText : AppColors.primaryText)

                    Image(systemName: showBirthdayPicker ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(AppColors.tertiaryText)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 18)
                .contentShape(Rectangle())
            }
            Divider().padding(.leading, 16)

            // Location
            editRow(title: L10n.tr("profile.location")) {
                TextField(L10n.tr("profile.location.placeholder"), text: $viewModel.editLocation)
                    .font(.system(size: 15))
                    .foregroundColor(AppColors.primaryText)
                    .multilineTextAlignment(.trailing)
            }
        }
        .padding(.vertical, 4)
        .background(AppColors.cardBackground)
        .cornerRadius(14)
        .padding(.horizontal, 16)
    }

    // MARK: - Birthday Picker

    private var birthdayPickerSection: some View {
        VStack(spacing: 8) {
            DatePicker(
                L10n.tr("profile.birthday.select"),
                selection: birthdayDateBinding,
                in: ...Date(),
                displayedComponents: .date
            )
            .datePickerStyle(.wheel)
            .labelsHidden()
            .environment(\.locale, AppLanguageStore.shared.locale)

            HStack {
                Button {
                    viewModel.clearBirthday()
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showBirthdayPicker = false
                    }
                } label: {
                    Text(L10n.tr("profile.birthday.clear"))
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.errorColor)
                }

                Spacer()

                Button {
                    viewModel.updateBirthdayFromDate()
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showBirthdayPicker = false
                    }
                } label: {
                    Text(L10n.tr("common.done"))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                }
            }
            .padding(.horizontal, 4)
        }
        .padding()
        .background(AppColors.cardBackground)
        .cornerRadius(14)
        .padding(.horizontal, 16)
    }

    // MARK: - Helpers

    private var birthdayDateBinding: Binding<Date> {
        Binding(
            get: { viewModel.editBirthdayDate },
            set: { viewModel.setBirthdayDate($0) }
        )
    }

    private var formattedEditBirthday: String {
        guard !viewModel.editBirthday.isEmpty else { return L10n.tr("profile.unset") }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: viewModel.editBirthday) else { return viewModel.editBirthday }
        let displayFormatter = DateFormatter()
        displayFormatter.locale = AppLanguageStore.shared.locale
        displayFormatter.dateStyle = .medium
        return displayFormatter.string(from: date)
    }

    private func editRow<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(AppColors.primaryText)
                .lineLimit(1)
                .minimumScaleFactor(0.78)
                .frame(width: 96, alignment: .leading)

            Spacer()

            content()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 18)
    }

    private func showToastMessage(_ message: String) {
        toastMessage = message
        showToast = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            showToast = false
        }
    }
}
