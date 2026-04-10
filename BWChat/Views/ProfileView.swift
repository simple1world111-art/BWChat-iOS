// BWChat/Views/ProfileView.swift
// User profile page - view & navigate to edit

import SwiftUI

struct ProfileView: View {
    @StateObject private var viewModel = ProfileViewModel()
    @State private var showEditProfile = false
    @State private var showLogoutAlert = false
    

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    profileHeaderCard

                    myMomentsSection

                    profileInfoSection

                    actionSection
                }
                .padding(.bottom, 30)
            }
            .background(AppColors.secondaryBackground)
            .navigationTitle("我")
            .sheet(isPresented: $showEditProfile) {
                EditProfileView(viewModel: viewModel)
            }
            .alert("确认退出登录", isPresented: $showLogoutAlert) {
                Button("取消", role: .cancel) {}
                Button("退出", role: .destructive) {
                    Task {
                        try? await APIService.shared.logout()
                        AuthManager.shared.logout()
                    }
                }
            } message: {
                Text("退出后将无法接收新消息")
            }
            .task {
                await viewModel.loadProfile()
            }
            .refreshable {
                await viewModel.loadProfile()
            }
        }
    }

    // MARK: - Header Card

    private var profileHeaderCard: some View {
        VStack(spacing: 16) {
            ZStack(alignment: .bottomTrailing) {
                AvatarView(url: viewModel.profile?.avatarURL ?? "", size: 88)
                    .shadow(color: AppColors.accent.opacity(0.3), radius: 8, x: 0, y: 4)

                Circle()
                    .fill(AppColors.online)
                    .frame(width: 16, height: 16)
                    .overlay(Circle().stroke(Color.white, lineWidth: 2))
                    .offset(x: -2, y: -2)
            }

            VStack(spacing: 4) {
                Text(viewModel.profile?.nickname ?? "")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(AppColors.primaryText)

                Text("@\(viewModel.profile?.username ?? "")")
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.secondaryText)
            }

            if let bio = viewModel.profile?.bio, !bio.isEmpty {
                Text(bio)
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.secondaryText)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .padding(.horizontal, 20)
            }

            HStack(spacing: 4) {
                Image(systemName: "number")
                    .font(.system(size: 11, weight: .semibold))
                Text(viewModel.profile?.userID ?? "")
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundColor(AppColors.accent)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(AppColors.accentLight)
            .cornerRadius(12)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .background(AppColors.cardBackground)
        .cornerRadius(18)
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    // MARK: - My Moments (right after header)

    private var myMomentsSection: some View {
        NavigationLink {
            MomentsView(
                filterUserID: AuthManager.shared.currentUser?.userID,
                pageTitle: "我的朋友圈"
            )
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(
                            LinearGradient(
                                colors: [Color(hex: "667eea"), Color(hex: "764ba2")],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 40, height: 40)
                    Image(systemName: "camera.fill")
                        .font(.system(size: 17))
                        .foregroundColor(.white)
                }

                Text("我的朋友圈")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(AppColors.primaryText)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(AppColors.tertiaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 13)
        }
        .background(AppColors.cardBackground)
        .cornerRadius(14)
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }

    // MARK: - Info Section (tap to open edit page)

    private var profileInfoSection: some View {
        Button {
            if let user = viewModel.profile {
                viewModel.populateEditFields(from: user)
            }
            showEditProfile = true
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(AppColors.accent.opacity(0.12))
                        .frame(width: 40, height: 40)
                    Image(systemName: "person.text.rectangle")
                        .font(.system(size: 17))
                        .foregroundColor(AppColors.accent)
                }

                Text("个人信息")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(AppColors.primaryText)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(AppColors.tertiaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 13)
        }
        .background(AppColors.cardBackground)
        .cornerRadius(14)
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }

    // MARK: - Action Section

    private var actionSection: some View {
        VStack(spacing: 12) {
            Button {
                showLogoutAlert = true
            } label: {
                HStack {
                    Spacer()
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                        .font(.system(size: 15))
                    Text("退出登录")
                        .font(.system(size: 16, weight: .medium))
                    Spacer()
                }
                .foregroundColor(AppColors.errorColor)
                .padding(.vertical, 14)
                .background(AppColors.cardBackground)
                .cornerRadius(14)
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
        }
    }
}
