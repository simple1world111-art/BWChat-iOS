// BWChat/Views/LoginView.swift
// User login page - minimalist design

import SwiftUI

struct LoginView: View {
    @StateObject private var viewModel = AuthViewModel()

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            Spacer()

            // App title
            Text(AppConfig.appName)
                .font(.system(size: 28, weight: .light))
                .foregroundColor(AppColors.primaryText)
                .padding(.bottom, 60)

            // Input fields
            VStack(spacing: 24) {
                // Username
                VStack(spacing: 4) {
                    TextField("用户名", text: $viewModel.username)
                        .textContentType(.username)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .font(.body)
                        .padding(.vertical, 8)

                    Rectangle()
                        .fill(AppColors.separator)
                        .frame(height: 1)
                }

                // Password
                VStack(spacing: 4) {
                    SecureField("密码", text: $viewModel.password)
                        .textContentType(.password)
                        .font(.body)
                        .padding(.vertical, 8)

                    Rectangle()
                        .fill(AppColors.separator)
                        .frame(height: 1)
                }
            }
            .padding(.horizontal, 40)

            // Error message
            if let error = viewModel.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(AppColors.errorColor)
                    .padding(.top, 12)
                    .padding(.horizontal, 40)
            }

            // Login button
            Button {
                Task { await viewModel.login() }
            } label: {
                Group {
                    if viewModel.isLoading {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    } else {
                        Text("登 录")
                            .font(.body.weight(.medium))
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .background(viewModel.isLoginEnabled ? AppColors.accent : AppColors.accent.opacity(0.5))
                .foregroundColor(.white)
                .cornerRadius(12)
            }
            .disabled(!viewModel.isLoginEnabled)
            .padding(.horizontal, 40)
            .padding(.top, 40)

            Spacer()
            Spacer()
            Spacer()
        }
        .background(AppColors.background)
        .onTapGesture { hideKeyboard() }
    }
}
