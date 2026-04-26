// BWChat/Views/RegisterView.swift
// Registration screen — same visual language as LoginView.

import SwiftUI

struct RegisterView: View {
    @StateObject private var viewModel = AuthViewModel()
    @Environment(\.dismiss) private var dismiss
    @State private var animateGradient = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                LinearGradient(
                    colors: [Color(hex: "667EEA").opacity(0.08), Color(hex: "764BA2").opacity(0.05), AppColors.background],
                    startPoint: animateGradient ? .topLeading : .topTrailing,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
                .onAppear {
                    withAnimation(.easeInOut(duration: 6).repeatForever(autoreverses: true)) {
                        animateGradient.toggle()
                    }
                }

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        Spacer().frame(height: max(geo.size.height * 0.06, 24))

                        ZStack {
                            Circle()
                                .fill(AppColors.accentGradient)
                                .frame(width: min(72, geo.size.width * 0.18), height: min(72, geo.size.width * 0.18))
                            Image(systemName: "person.crop.circle.badge.plus")
                                .font(.system(size: min(30, geo.size.width * 0.075)))
                                .foregroundColor(.white)
                        }
                        .shadow(color: AppColors.accent.opacity(0.3), radius: 18, y: 8)
                        .padding(.bottom, 12)

                        Text("创建账号")
                            .font(.system(size: 26, weight: .bold, design: .rounded))
                            .foregroundColor(AppColors.primaryText)
                            .padding(.bottom, 6)

                        Text("注册即可开始聊天")
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.secondaryText)
                            .padding(.bottom, max(geo.size.height * 0.035, 18))

                        VStack(spacing: 14) {
                            HStack(spacing: 12) {
                                Image(systemName: "person.fill")
                                    .foregroundColor(AppColors.accent)
                                    .font(.system(size: 16))
                                    .frame(width: 20)
                                TextField("用户名 (3-20 位字母 / 数字 / _)", text: $viewModel.username)
                                    .textContentType(.username)
                                    .autocapitalization(.none)
                                    .disableAutocorrection(true)
                                    .font(.system(size: 16))
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .background(AppColors.separator.opacity(0.6))
                            .cornerRadius(14)

                            HStack(spacing: 12) {
                                Image(systemName: "face.smiling")
                                    .foregroundColor(AppColors.accent)
                                    .font(.system(size: 16))
                                    .frame(width: 20)
                                TextField("昵称 (可选)", text: $viewModel.nickname)
                                    .autocapitalization(.none)
                                    .disableAutocorrection(true)
                                    .font(.system(size: 16))
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .background(AppColors.separator.opacity(0.6))
                            .cornerRadius(14)

                            HStack(spacing: 12) {
                                Image(systemName: "lock.fill")
                                    .foregroundColor(AppColors.accent)
                                    .font(.system(size: 16))
                                    .frame(width: 20)
                                SecureField("密码 (至少 6 位)", text: $viewModel.password)
                                    .textContentType(.newPassword)
                                    .font(.system(size: 16))
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .background(AppColors.separator.opacity(0.6))
                            .cornerRadius(14)

                            HStack(spacing: 12) {
                                Image(systemName: "lock.rotation")
                                    .foregroundColor(AppColors.accent)
                                    .font(.system(size: 16))
                                    .frame(width: 20)
                                SecureField("确认密码", text: $viewModel.confirmPassword)
                                    .textContentType(.newPassword)
                                    .font(.system(size: 16))
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .background(AppColors.separator.opacity(0.6))
                            .cornerRadius(14)
                        }
                        .padding(.horizontal, 24)

                        // Inline validation hint OR server error
                        if let hint = viewModel.registerValidationHint {
                            HStack(spacing: 6) {
                                Image(systemName: "info.circle.fill")
                                    .font(.system(size: 12))
                                Text(hint)
                                    .font(.system(size: 13))
                            }
                            .foregroundColor(AppColors.secondaryText)
                            .padding(.top, 12)
                            .padding(.horizontal, 24)
                        } else if let error = viewModel.errorMessage {
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.system(size: 12))
                                Text(error)
                                    .font(.system(size: 13))
                            }
                            .foregroundColor(AppColors.errorColor)
                            .padding(.top, 12)
                            .padding(.horizontal, 24)
                        }

                        Button {
                            Task { await viewModel.register() }
                        } label: {
                            ZStack {
                                if viewModel.isLoading {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                } else {
                                    Text("注 册")
                                        .font(.system(size: 17, weight: .semibold))
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .foregroundColor(.white)
                            .background(
                                viewModel.isRegisterEnabled
                                    ? AppColors.accentGradient
                                    : LinearGradient(colors: [AppColors.tertiaryText], startPoint: .leading, endPoint: .trailing)
                            )
                            .cornerRadius(14)
                            .shadow(color: viewModel.isRegisterEnabled ? AppColors.accent.opacity(0.3) : .clear, radius: 12, y: 6)
                        }
                        .disabled(!viewModel.isRegisterEnabled)
                        .padding(.horizontal, 24)
                        .padding(.top, 22)

                        Button {
                            dismiss()
                        } label: {
                            Text("已有账号，去登录")
                                .font(.system(size: 14))
                                .foregroundColor(AppColors.accent)
                        }
                        .padding(.top, 18)

                        Spacer().frame(height: 40)
                    }
                    .frame(minHeight: geo.size.height)
                }
            }
        }
        .onTapGesture { hideKeyboard() }
        .ignoresSafeArea(.keyboard)
    }
}
