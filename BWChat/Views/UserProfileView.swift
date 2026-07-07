// BWChat/Views/UserProfileView.swift
// Public profile screen for any user.

import SwiftUI

struct UserProfileView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel: UserProfileViewModel

    init(userID: String) {
        _viewModel = StateObject(wrappedValue: UserProfileViewModel(userID: userID))
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                if viewModel.isLoading && viewModel.profile == nil {
                    ProgressView()
                        .tint(AppColors.accent)
                        .padding(.top, 80)
                } else if let profile = viewModel.profile {
                    profileHero(profile)
                    relationCard(profile)
                } else {
                    emptyState
                        .padding(.top, 80)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 28)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("profile.public.title"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .task(id: viewModel.userID) {
            await viewModel.loadProfile()
        }
        .refreshable {
            await viewModel.loadProfile()
        }
        .toast(message: $viewModel.errorMessage)
    }

    private func profileHero(_ profile: PublicProfile) -> some View {
        VStack(spacing: 16) {
            AvatarView(url: profile.avatarURL, size: 92)
                .overlay(Circle().stroke(AppColors.cardBackground, lineWidth: 3))
                .shadow(color: Color.black.opacity(0.10), radius: 12, x: 0, y: 6)

            VStack(spacing: 6) {
                Text(profile.nickname)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)

                Text(profile.userID.isBlank ? "" : "#\(profile.userID)")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(1)
            }

            if !profile.bio.isBlank {
                Text(profile.bio)
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.secondaryText)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 0) {
                profileStat(
                    title: L10n.tr("follow.following"),
                    value: profile.followingCount
                ) {
                    navigator.push(FollowingListView(userID: profile.userID))
                }

                Divider()
                    .frame(height: 30)

                profileStat(
                    title: L10n.tr("follow.followers"),
                    value: profile.followerCount
                ) {
                    navigator.push(FollowersListView(userID: profile.userID))
                }
            }
            .padding(.top, 2)

            if !viewModel.isMe {
                Button(action: viewModel.toggleFollow) {
                    Text(profile.followedByMe ? L10n.tr("follow.followingButton") : L10n.tr("follow.followButton"))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(profile.followedByMe ? AppColors.accent : .white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(
                            RoundedRectangle(cornerRadius: 22, style: .continuous)
                                .fill(profile.followedByMe ? AppColors.accentLight : AppColors.accent)
                        )
                }
                .buttonStyle(.plain)
                .disabled(viewModel.isUpdatingFollow)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(AppColors.cardBackground)
        .cornerRadius(18)
    }

    private func profileStat(title: String, value: Int, action: @escaping () -> Void) -> some View {
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
    }

    private func relationCard(_ profile: PublicProfile) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            relationRow(
                icon: "person.2.fill",
                title: L10n.tr("follow.relationship"),
                value: relationText(profile)
            )
            if !profile.location.isBlank {
                relationRow(icon: "location.fill", title: L10n.tr("profile.location"), value: profile.location)
            }
            if !profile.genderDisplay.isBlank {
                relationRow(icon: "person.fill", title: L10n.tr("profile.gender"), value: profile.genderDisplay)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppColors.cardBackground)
        .cornerRadius(14)
    }

    private func relationRow(icon: String, title: String, value: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(AppColors.accent)
                .frame(width: 20)

            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(AppColors.secondaryText)

            Spacer()

            Text(value)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
                .lineLimit(1)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.crop.circle.badge.exclamationmark")
                .font(.system(size: 38, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)
            Text(L10n.tr("profile.public.missing"))
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(maxWidth: .infinity)
    }

    private func relationText(_ profile: PublicProfile) -> String {
        if profile.isFriend {
            return L10n.tr("follow.relationship.friend")
        }
        if profile.followedByMe && profile.followsMe {
            return L10n.tr("follow.relationship.mutual")
        }
        if profile.followedByMe {
            return L10n.tr("follow.relationship.following")
        }
        if profile.followsMe {
            return L10n.tr("follow.relationship.followsMe")
        }
        return L10n.tr("follow.relationship.none")
    }
}

private extension PublicProfile {
    var genderDisplay: String {
        switch gender {
        case "male": return L10n.tr("profile.gender.male")
        case "female": return L10n.tr("profile.gender.female")
        case "other": return L10n.tr("profile.gender.other")
        default: return ""
        }
    }
}
