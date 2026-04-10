// BWChat/Views/EditProfileView.swift
// Edit profile form - avatar, nickname, bio, gender, birthday, location

import SwiftUI
import PhotosUI

@MainActor
struct EditProfileView: View {
    @ObservedObject var viewModel: ProfileViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var selectedPhoto: PhotosPickerItem?
    @State private var showToast = false
    @State private var toastMessage = ""
    @State private var showBirthdayPicker = false

    var body: some View {
        NavigationStack {
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
            .navigationTitle("编辑资料")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        dismiss()
                    }
                    .foregroundColor(AppColors.secondaryText)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        Task {
                            await viewModel.saveProfile()
                            if viewModel.errorMessage == nil {
                                dismiss()
                            }
                        }
                    } label: {
                        if viewModel.isSaving {
                            ProgressView()
                                .tint(AppColors.accent)
                        } else {
                            Text("保存")
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

            Text("点击更换头像")
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
            editRow(title: "昵称") {
                TextField("请输入昵称", text: $viewModel.editNickname)
                    .font(.system(size: 15))
                    .foregroundColor(AppColors.primaryText)
                    .multilineTextAlignment(.trailing)
            }
            Divider().padding(.leading, 16)

            // Bio
            editRow(title: "个性签名") {
                TextField("介绍一下自己", text: $viewModel.editBio)
                    .font(.system(size: 15))
                    .foregroundColor(AppColors.primaryText)
                    .multilineTextAlignment(.trailing)
            }
            Divider().padding(.leading, 16)

            // Gender
            editRow(title: "性别") {
                Picker("", selection: $viewModel.editGender) {
                    Text("未设置").tag("")
                    Text("男").tag("male")
                    Text("女").tag("female")
                    Text("其他").tag("other")
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
                    Text("生日")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(AppColors.primaryText)

                    Spacer()

                    Text(viewModel.editBirthday.isEmpty ? "未设置" : formattedEditBirthday)
                        .font(.system(size: 15))
                        .foregroundColor(viewModel.editBirthday.isEmpty ? AppColors.tertiaryText : AppColors.primaryText)

                    Image(systemName: showBirthdayPicker ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(AppColors.tertiaryText)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
                .contentShape(Rectangle())
            }
            Divider().padding(.leading, 16)

            // Location
            editRow(title: "地区") {
                TextField("请输入所在地区", text: $viewModel.editLocation)
                    .font(.system(size: 15))
                    .foregroundColor(AppColors.primaryText)
                    .multilineTextAlignment(.trailing)
            }
        }
        .background(AppColors.cardBackground)
        .cornerRadius(14)
        .padding(.horizontal, 16)
    }

    // MARK: - Birthday Picker

    private var birthdayPickerSection: some View {
        VStack(spacing: 8) {
            DatePicker(
                "选择生日",
                selection: $viewModel.editBirthdayDate,
                in: ...Date(),
                displayedComponents: .date
            )
            .datePickerStyle(.wheel)
            .labelsHidden()
            .environment(\.locale, Locale(identifier: "zh_CN"))
            .onChange(of: viewModel.editBirthdayDate) { _ in
                viewModel.updateBirthdayFromDate()
            }

            Button {
                viewModel.editBirthday = ""
                withAnimation {
                    showBirthdayPicker = false
                }
            } label: {
                Text("清除生日")
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.errorColor)
            }
        }
        .padding()
        .background(AppColors.cardBackground)
        .cornerRadius(14)
        .padding(.horizontal, 16)
    }

    // MARK: - Helpers

    private var formattedEditBirthday: String {
        guard !viewModel.editBirthday.isEmpty else { return "未设置" }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: viewModel.editBirthday) else { return viewModel.editBirthday }
        let displayFormatter = DateFormatter()
        displayFormatter.dateFormat = "yyyy年M月d日"
        return displayFormatter.string(from: date)
    }

    private func editRow<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack {
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(AppColors.primaryText)
                .frame(width: 72, alignment: .leading)

            Spacer()

            content()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
    }

    private func showToastMessage(_ message: String) {
        toastMessage = message
        showToast = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            showToast = false
        }
    }
}
