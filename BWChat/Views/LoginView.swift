// BWChat/Views/LoginView.swift
// Premium login page with gradient accents

import SwiftUI

struct LoginView: View {
    @StateObject private var viewModel = AuthViewModel()
    @State private var animateGradient = false

    var body: some View {
        ZStack {
            // Animated gradient background
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

            ScrollView {
                VStack(spacing: 0) {
                    Spacer().frame(height: 80)

                    // Logo
                    ZStack {
                        Circle()
                            .fill(AppColors.accentGradient)
                            .frame(width: 80, height: 80)
                        Image(systemName: "bubble.left.and.bubble.right.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.white)
                    }
                    .shadow(color: AppColors.accent.opacity(0.3), radius: 20, y: 10)
                    .padding(.bottom, 16)

                    Text(AppConfig.appName)
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                        .foregroundColor(AppColors.primaryText)
                        .padding(.bottom, 8)

                    Text("连接你我，即刻开始")
                        .font(.system(size: 15))
                        .foregroundColor(AppColors.secondaryText)
                        .padding(.bottom, 48)

                    // Input card
                    VStack(spacing: 20) {
                        // Username
                        HStack(spacing: 14) {
                            Image(systemName: "person.fill")
                                .foregroundColor(AppColors.accent)
                                .font(.system(size: 16))
                                .frame(width: 20)
                            TextField("用户名", text: $viewModel.username)
                                .textContentType(.username)
                                .autocapitalization(.none)
                                .disableAutocorrection(true)
                                .font(.system(size: 16))
                        }
                        .padding(.horizontal, 18)
                        .padding(.vertical, 16)
                        .background(AppColors.separator.opacity(0.6))
                        .cornerRadius(14)

                        // Password
                        HStack(spacing: 14) {
                            Image(systemName: "lock.fill")
                                .foregroundColor(AppColors.accent)
                                .font(.system(size: 16))
                                .frame(width: 20)
                            SecureField("密码", text: $viewModel.password)
                                .textContentType(.password)
                                .font(.system(size: 16))
                        }
                        .padding(.horizontal, 18)
                        .padding(.vertical, 16)
                        .background(AppColors.separator.opacity(0.6))
                        .cornerRadius(14)
                    }
                    .padding(.horizontal, 32)

                    // Error message
                    if let error = viewModel.errorMessage {
                        HStack(spacing: 6) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 12))
                            Text(error)
                                .font(.system(size: 13))
                        }
                        .foregroundColor(AppColors.errorColor)
                        .padding(.top, 14)
                        .padding(.horizontal, 32)
                    }

                    // Login button
                    Button {
                        Task { await viewModel.login() }
                    } label: {
                        ZStack {
                            if viewModel.isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            } else {
                                Text("登 录")
                                    .font(.system(size: 17, weight: .semibold))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 54)
                        .foregroundColor(.white)
                        .background(
                            viewModel.isLoginEnabled
                                ? AppColors.accentGradient
                                : LinearGradient(colors: [AppColors.tertiaryText], startPoint: .leading, endPoint: .trailing)
                        )
                        .cornerRadius(16)
                        .shadow(color: viewModel.isLoginEnabled ? AppColors.accent.opacity(0.3) : .clear, radius: 12, y: 6)
                    }
                    .disabled(!viewModel.isLoginEnabled)
                    .padding(.horizontal, 32)
                    .padding(.top, 32)

                    Spacer().frame(height: 60)
                }
            }
        }
        .onTapGesture { hideKeyboard() }
    }
}
