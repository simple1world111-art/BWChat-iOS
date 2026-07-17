// BWChat/Views/UserProfileView.swift
// Instagram-style public profile screen for any user.

import SwiftUI
import UIKit

struct UserProfileView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel: UserProfileViewModel
    @State private var selectedTab: ProfileContentTab = .moments
    @State private var showMoreActions = false
    @State private var toastMessage: String?

    private let gridSpacing: CGFloat = 1

    init(userID: String) {
        _viewModel = StateObject(wrappedValue: UserProfileViewModel(userID: userID))
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                if viewModel.isLoading && viewModel.profile == nil {
                    ProgressView()
                        .tint(AppColors.accent)
                        .padding(.top, 96)
                } else if let profile = viewModel.profile {
                    profileHeader(profile)
                    profileActions(profile)
                    profileSuggestions(profile)
                    profileHighlights(profile)
                    profileTabs
                    if selectedTab == .moments && profile.isPrivate && !profile.canViewMoments {
                        privateAccountState
                    } else {
                        profileContent
                    }
                } else {
                    emptyState
                        .padding(.top, 96)
                }
            }
            .padding(.bottom, 28)
        }
        .background(AppColors.background)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                HStack(spacing: 2) {
                    AppBackButton {
                        popOrDismiss()
                    }

                    Text(navigationProfileTitle)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                        .frame(maxWidth: 180, alignment: .leading)
                }
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showMoreActions = true
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                }
                .accessibilityLabel(L10n.tr("profile.more"))
            }
        }
        .overlay {
            if showMoreActions, let profile = viewModel.profile {
                ProfileMoreActionsOverlay(
                    onDismiss: { closeMoreActions() },
                    onSelect: { action in handleMoreAction(action, profile: profile) }
                )
                .ignoresSafeArea()
                .zIndex(10)
            }
        }
        .task(id: viewModel.userID) {
            async let profileTask: () = viewModel.loadProfile()
            async let momentsTask: () = viewModel.loadInitialMoments()
            async let suggestionsTask: () = viewModel.loadSuggestedUsers()
            await profileTask
            await momentsTask
            await suggestionsTask
        }
        .task(id: selectedTab) {
            await loadSelectedTab()
        }
        .refreshable {
            async let profileTask: () = viewModel.loadProfile(forceRefresh: true)
            async let contentTask: () = refreshSelectedTab()
            async let suggestionsTask: () = viewModel.loadSuggestedUsers()
            await profileTask
            await contentTask
            await suggestionsTask
        }
        .toast(message: $viewModel.errorMessage)
        .toast(message: $toastMessage)
    }

    private func profileHeader(_ profile: PublicProfile) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 16) {
                AvatarView(url: profile.avatarURL, size: 72)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(profile.highlights.isEmpty ? AppColors.separator : AppColors.accent, lineWidth: profile.highlights.isEmpty ? 1 : 2)
                    )

                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(profile.nickname)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(AppColors.primaryText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.78)

                        if profile.isVerified {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(Color(hex: "1DA1F2"))
                                .accessibilityLabel(L10n.tr("profile.verified"))
                        }

                        relationshipBadge(profile)

                        Spacer(minLength: 0)
                    }

                    HStack(spacing: 0) {
                        statButton(
                            value: resolvedPostsCount(for: profile),
                            title: L10n.tr("profile.posts"),
                            isLeading: true,
                            action: nil
                        )

                        statButton(
                            value: profile.followerCount,
                            title: L10n.tr("follow.followers"),
                            isLeading: true
                        ) {
                            navigator.push(FollowersListView(userID: profile.userID))
                        }

                        statButton(
                            value: profile.followingCount,
                            title: L10n.tr("follow.following"),
                            isLeading: true
                        ) {
                            navigator.push(FollowingListView(userID: profile.userID))
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            }

            VStack(alignment: .leading, spacing: 5) {
                if !profile.pronouns.isBlank {
                    Text(profile.pronouns)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)
                }

                if !profile.category.isBlank {
                    Text(profile.category)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)
                }

                if !profile.bio.isBlank {
                    Text(profile.bio)
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                profileMetadata(profile)
                mutualFollowersText(profile)

                if let websiteURL = profile.websiteURL, !websiteURL.isBlank {
                    Button {
                        openWebsite(websiteURL)
                    } label: {
                        Label(displayWebsite(websiteURL), systemImage: "link")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(Color(hex: "385898"))
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.tr("profile.website"))
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 12)
    }

    private var navigationProfileTitle: String {
        guard let profile = viewModel.profile else {
            return L10n.tr("profile.public.title")
        }
        return profile.nickname.isBlank ? L10n.tr("profile.public.title") : profile.nickname
    }

    private func popOrDismiss() {
        if navigator.canPopPushedController {
            navigator.pop()
        } else {
            dismiss()
        }
    }

    @ViewBuilder
    private func mutualFollowersText(_ profile: PublicProfile) -> some View {
        if !profile.mutualFollowers.isEmpty {
            let names = profile.mutualFollowers.prefix(2).map(\.nickname).joined(separator: ", ")
            Text(String(format: L10n.tr("profile.mutualFollowers.preview"), names))
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
                .lineLimit(1)
        } else if let count = profile.mutualFollowersCount, count > 0 {
            Text(String(format: L10n.tr("profile.mutualFollowers.count"), formatCount(count)))
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private func relationshipBadge(_ profile: PublicProfile) -> some View {
        let text = relationText(profile)
        if !text.isBlank {
            Text(text)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(
                    Capsule()
                        .fill(AppColors.separator)
                )
        }
    }

    @ViewBuilder
    private func profileMetadata(_ profile: PublicProfile) -> some View {
        let values = [profile.location, profile.genderDisplay].filter { !$0.isBlank }
        if !values.isEmpty {
            Text(values.joined(separator: " / "))
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
                .lineLimit(2)
        }
    }

    @ViewBuilder
    private func profileActions(_ profile: PublicProfile) -> some View {
        if !viewModel.isMe {
            HStack(spacing: 8) {
                Button(action: viewModel.toggleFollow) {
                    Text(followButtonTitle(profile))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor((profile.followedByMe || profile.followRequested) ? AppColors.primaryText : .white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill((profile.followedByMe || profile.followRequested) ? AppColors.separator : AppColors.accent)
                        )
                }
                .buttonStyle(.plain)
                .disabled(viewModel.isUpdatingFollow)

                Button {
                    if profile.canMessage {
                        openMessage(with: profile)
                    } else {
                        toastMessage = L10n.tr("profile.message.unavailable")
                    }
                } label: {
                    Text(L10n.tr("profile.message"))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(AppColors.primaryText)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(AppColors.separator)
                        )
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
        }
    }

    @ViewBuilder
    private func profileSuggestions(_ profile: PublicProfile) -> some View {
        if !viewModel.isMe {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(L10n.tr("profile.suggestions.title"))
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(AppColors.primaryText)

                    Spacer()

                    Button {
                        navigator.push(
                            RecommendedUsersListView(
                                excludeUserID: profile.userID,
                                initialUsers: viewModel.suggestedUsers
                            )
                        )
                    } label: {
                        Text(L10n.tr("profile.suggestions.showAll"))
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(AppColors.accent)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)

                if viewModel.isLoadingSuggestions, viewModel.suggestedUsers.isEmpty {
                    ProgressView()
                        .tint(AppColors.accent)
                        .frame(maxWidth: .infinity)
                        .frame(height: 120)
                } else if viewModel.suggestedUsers.isEmpty {
                    Text(L10n.tr("profile.suggestions.unavailable"))
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.secondaryText)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 36)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(spacing: 6) {
                            ForEach(viewModel.suggestedUsers) { user in
                                SuggestedProfileCard(
                                    user: user,
                                    isUpdatingFollow: viewModel.updatingSuggestedUserIDs.contains(user.userID),
                                    onOpenProfile: {
                                        navigator.push(UserProfileView(userID: user.userID))
                                    },
                                    onDismiss: {
                                        viewModel.dismissSuggestedUser(userID: user.userID)
                                    },
                                    onToggleFollow: {
                                        viewModel.toggleSuggestedFollow(userID: user.userID)
                                    }
                                )
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                }
            }
            .padding(.top, 4)
            .padding(.bottom, 14)
        }
    }

    @ViewBuilder
    private func profileHighlights(_ profile: PublicProfile) -> some View {
        if !profile.highlights.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(profile.highlights.prefix(12)) { highlight in
                        Button {
                            toastMessage = L10n.tr("profile.highlights.unavailable")
                        } label: {
                            ProfileHighlightBubble(highlight: highlight)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
        }
    }

    private var profileTabs: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(ProfileContentTab.allCases) { tab in
                    Button {
                        selectedTab = tab
                    } label: {
                        VStack(spacing: 0) {
                            Text(L10n.tr(tab.titleKey))
                                .font(.system(size: 15, weight: selectedTab == tab ? .bold : .semibold))
                                .foregroundColor(selectedTab == tab ? AppColors.primaryText : AppColors.tertiaryText)
                                .lineLimit(1)
                                .minimumScaleFactor(0.72)
                                .frame(maxWidth: .infinity)
                                .frame(height: 43)

                            Rectangle()
                                .fill(selectedTab == tab ? AppColors.primaryText : Color.clear)
                                .frame(height: 1)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.tr(tab.titleKey))
                }
            }

            Divider()
        }
    }

    @ViewBuilder
    private var profileContent: some View {
        switch selectedTab {
        case .moments:
            momentsList
        case .agents:
            agentsList
        case .shortDramas:
            shortDramasList
        }
    }

    @ViewBuilder
    private var agentsList: some View {
        if viewModel.isLoadingAgents && viewModel.agents.isEmpty {
            ProgressView()
                .tint(AppColors.accent)
                .padding(.top, 52)
        } else if viewModel.agents.isEmpty, let message = viewModel.agentsErrorMessage {
            contentError(message: message) {
                Task { await viewModel.loadInitialAgents(refresh: true) }
            }
            .padding(.top, 42)
        } else if viewModel.agents.isEmpty {
            emptyContent
                .padding(.top, 54)
        } else {
            LazyVStack(spacing: 12) {
                ForEach(viewModel.agents) { agent in
                    Button {
                        openAgent(agent)
                    } label: {
                        UserProfileAgentCard(
                            agent: agent,
                            isOpening: viewModel.openingAgentIDs.contains(agent.id)
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(viewModel.openingAgentIDs.contains(agent.id))
                    .onAppear {
                        viewModel.loadMoreAgentsIfNeeded(currentAgentID: agent.id)
                    }
                }

                if viewModel.isLoadingMoreAgents {
                    ProgressView()
                        .tint(AppColors.accent)
                        .padding(.vertical, 16)
                }
            }
            .padding(16)
        }
    }

    @ViewBuilder
    private var momentsList: some View {
        if viewModel.isLoadingMoments && viewModel.moments.isEmpty {
            ProgressView()
                .tint(AppColors.accent)
                .padding(.top, 52)
        } else if viewModel.moments.isEmpty {
            emptyContent
                .padding(.top, 54)
        } else {
            LazyVStack(spacing: 0) {
                ForEach(viewModel.moments) { moment in
                    MomentRow(
                        moment: moment,
                        onLike: {
                            Task { await viewModel.toggleMomentLike(momentID: moment.id) }
                        },
                        onComment: { _, _, _ in
                            navigator.push(MomentDetailView(momentID: moment.id))
                        },
                        onDelete: {},
                        onMediaTap: { _, _ in
                            navigator.push(MomentDetailView(momentID: moment.id))
                        },
                        onUnlock: {
                            navigator.push(MomentDetailView(momentID: moment.id))
                        }
                    )
                    .onAppear {
                        viewModel.loadMoreMomentsIfNeeded(currentMomentID: moment.id)
                    }

                    Divider()
                }
            }
            .frame(maxWidth: .infinity)

            if viewModel.isLoadingMoreMoments {
                ProgressView()
                    .tint(AppColors.accent)
                    .padding(.vertical, 18)
            }
        }
    }

    @ViewBuilder
    private var shortDramasList: some View {
        if viewModel.isLoadingShortDramas && viewModel.shortDramas.isEmpty {
            ProgressView()
                .tint(AppColors.accent)
                .padding(.top, 52)
        } else if viewModel.shortDramas.isEmpty, let message = viewModel.shortDramasErrorMessage {
            contentError(message: message) {
                Task { await viewModel.loadInitialShortDramas(refresh: true) }
            }
            .padding(.top, 42)
        } else if viewModel.shortDramas.isEmpty {
            emptyContent
                .padding(.top, 54)
        } else {
            LazyVStack(spacing: 14) {
                ForEach(viewModel.shortDramas) { series in
                    ShortDramaSeriesCard(
                        series: series,
                        showsCreator: false,
                        showsPublishStatus: false,
                        onOpenSeries: { openShortDrama(series) },
                        onOpenEpisode: { openShortDrama(series, episodeID: $0.id) }
                    )
                    .onAppear {
                        viewModel.loadMoreShortDramasIfNeeded(currentSeriesID: series.id)
                    }
                }

                if viewModel.isLoadingMoreShortDramas {
                    ProgressView()
                        .tint(AppColors.accent)
                        .padding(.vertical, 16)
                }
            }
            .padding(16)
        }
    }

    private func contentError(message: String, retry: @escaping () -> Void) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 30, weight: .semibold))
                .foregroundColor(AppColors.warningColor)

            Text(message)
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.center)

            Button(L10n.tr("common.retry"), action: retry)
                .font(.system(size: 14, weight: .bold))
                .foregroundColor(AppColors.accent)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
    }

    private var emptyContent: some View {
        VStack(spacing: 12) {
            Image(systemName: selectedTab.emptySystemImage)
                .font(.system(size: 34, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)

            Text(L10n.tr(selectedTab.emptyTitleKey))
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(AppColors.secondaryText)
        }
        .frame(maxWidth: .infinity)
    }

    private func loadSelectedTab() async {
        switch selectedTab {
        case .moments:
            break
        case .agents:
            await viewModel.loadInitialAgents()
        case .shortDramas:
            await viewModel.loadInitialShortDramas()
        }
    }

    private func refreshSelectedTab() async {
        switch selectedTab {
        case .moments:
            await viewModel.loadInitialMoments(refresh: true)
        case .agents:
            await viewModel.loadInitialAgents(refresh: true)
        case .shortDramas:
            await viewModel.loadInitialShortDramas(refresh: true)
        }
    }

    private func openAgent(_ agent: AgentSummary) {
        Task {
            guard let conversation = await viewModel.conversation(for: agent) else { return }
            navigator.push(AgentChatView(conversation: conversation))
        }
    }

    private func openShortDrama(_ series: ShortDramaSeries, episodeID: String? = nil) {
        navigator.push(
            ShortDramaFeedView(
                viewModel: ShortDramaFeedViewModel(
                    seriesID: series.id,
                    initialEpisodeID: episodeID ?? series.resumeEpisodeID,
                    initialPositionSeconds: episodeID == nil ? series.resumePositionSeconds : 0
                )
            )
        )
    }

    private var privateAccountState: some View {
        VStack(spacing: 12) {
            Image(systemName: "lock.fill")
                .font(.system(size: 34, weight: .semibold))
                .foregroundColor(AppColors.primaryText)

            Text(L10n.tr("profile.private.title"))
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(AppColors.primaryText)

            Text(L10n.tr("profile.private.subtitle"))
                .font(.system(size: 14))
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 36)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 54)
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

    private func statButton(
        value: Int,
        title: String,
        isLeading: Bool = false,
        action: (() -> Void)?
    ) -> some View {
        Button {
            action?()
        } label: {
            VStack(alignment: isLeading ? .leading : .center, spacing: 1) {
                Text(formatCount(value))
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(.black)
                    .monospacedDigit()

                Text(title)
                    .font(.system(size: 12))
                    .foregroundColor(.black)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .frame(maxWidth: .infinity, alignment: isLeading ? .leading : .center)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .allowsHitTesting(action != nil)
    }

    private func resolvedPostsCount(for profile: PublicProfile) -> Int {
        profile.postsCount ?? profile.momentsCount ?? viewModel.moments.count
    }

    private func followButtonTitle(_ profile: PublicProfile) -> String {
        if profile.followedByMe {
            return L10n.tr("follow.followingButton")
        }
        if profile.followRequested {
            return L10n.tr("follow.requestedButton")
        }
        return L10n.tr("follow.followButton")
    }

    private func formatCount(_ value: Int) -> String {
        let absValue = abs(value)
        if absValue >= 1_000_000 {
            return String(format: "%.1fM", Double(value) / 1_000_000).replacingOccurrences(of: ".0M", with: "M")
        }
        if absValue >= 10_000 {
            return String(format: "%.1fK", Double(value) / 1_000).replacingOccurrences(of: ".0K", with: "K")
        }
        return "\(value)"
    }

    private func openMessage(with profile: PublicProfile) {
        guard !profile.userID.isBlank else { return }
        navigator.push(ChatView(contact: Contact(
            userID: profile.userID,
            nickname: profile.nickname,
            avatarURL: profile.avatarURL,
            lastMessage: nil,
            lastMessageTime: nil,
            unreadCount: 0
        )))
    }

    private func relationText(_ profile: PublicProfile) -> String {
        if profile.isFriend {
            return L10n.tr("follow.relationship.friend")
        }
        if profile.followedByMe && profile.followsMe {
            return L10n.tr("follow.relationship.mutual")
        }
        if profile.followsMe {
            return L10n.tr("follow.relationship.followsMe")
        }
        return ""
    }

    private func closeMoreActions() {
        showMoreActions = false
    }

    private func handleMoreAction(_ action: ProfileMoreAction, profile: PublicProfile) {
        closeMoreActions()

        switch action {
        case .share:
            DispatchQueue.main.async {
                shareProfile(profile)
            }
        case .copyLink:
            copyProfileLink(profile)
        case .about:
            showAboutAccount(profile)
        case .qrCode, .report, .restrict, .block:
            toastMessage = L10n.tr("profile.more.unavailable")
        }
    }

    private func copyProfileLink(_ profile: PublicProfile) {
        UIPasteboard.general.string = profileLink(profile)
        toastMessage = L10n.tr("profile.more.linkCopied")
    }

    private func shareProfile(_ profile: PublicProfile) {
        guard let url = URL(string: profileLink(profile)),
              let root = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows)
                .first(where: \.isKeyWindow)?
                .rootViewController
        else {
            copyProfileLink(profile)
            return
        }

        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.popoverPresentationController?.sourceView = root.view
        controller.popoverPresentationController?.sourceRect = CGRect(x: root.view.bounds.midX, y: root.view.bounds.midY, width: 0, height: 0)
        root.present(controller, animated: true)
    }

    private func profileLink(_ profile: PublicProfile) -> String {
        let id = profile.username.isBlank ? profile.userID : profile.username
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return "bwchat://profile/\(encoded)"
    }

    private func showAboutAccount(_ profile: PublicProfile) {
        if let createdAt = profile.accountCreatedAt, !createdAt.isBlank {
            toastMessage = String(format: L10n.tr("profile.more.about.created"), createdAt)
        } else {
            toastMessage = L10n.tr("profile.more.about.unavailable")
        }
    }

    private func openWebsite(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let normalized = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let url = URL(string: normalized) else { return }
        openURL(url)
    }

    private func displayWebsite(_ raw: String) -> String {
        raw.replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
    }
}

private struct SuggestedProfileCard: View {
    let user: FollowUser
    let isUpdatingFollow: Bool
    let onOpenProfile: () -> Void
    let onDismiss: () -> Void
    let onToggleFollow: () -> Void

    var body: some View {
        VStack(spacing: 7) {
            Button(action: onOpenProfile) {
                VStack(spacing: 6) {
                    AvatarView(url: user.avatarURL, size: 55)

                    VStack(spacing: 2) {
                        Text(user.nickname)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(AppColors.primaryText)
                            .lineLimit(1)

                        Text(user.username.isBlank ? "#\(user.userID)" : user.username)
                            .font(.system(size: 10))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)

            Button(action: onToggleFollow) {
                Text(user.followedByMe ? L10n.tr("follow.followingButton") : L10n.tr("follow.followButton"))
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(user.followedByMe ? AppColors.primaryText : .white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 28)
                    .background(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(user.followedByMe ? AppColors.separator : AppColors.accent)
                    )
            }
            .buttonStyle(.plain)
            .disabled(isUpdatingFollow)
        }
        .padding(.horizontal, 8)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .frame(width: 106, height: 136)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(AppColors.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(AppColors.separator, lineWidth: 1)
        )
        .overlay(alignment: .topTrailing) {
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.tr("common.close"))
        }
    }
}

private enum ProfileContentTab: String, CaseIterable, Identifiable {
    case moments
    case agents
    case shortDramas

    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .moments: return "moments.title"
        case .agents: return "contacts.aiCompanions"
        case .shortDramas: return "shortDrama.title"
        }
    }

    var emptyTitleKey: String {
        switch self {
        case .moments: return "moments.empty"
        case .agents: return "contacts.aiCompanions.emptyTitle"
        case .shortDramas: return "shortDrama.empty"
        }
    }

    var emptySystemImage: String {
        switch self {
        case .moments: return "photo.on.rectangle.angled"
        case .agents: return "sparkles.rectangle.stack"
        case .shortDramas: return "play.rectangle"
        }
    }
}

private struct UserProfileAgentCard: View {
    let agent: AgentSummary
    let isOpening: Bool

    var body: some View {
        HStack(spacing: 13) {
            AgentAvatarView(assetID: agent.resolvedAvatarAssetID, size: 58)

            VStack(alignment: .leading, spacing: 5) {
                Text(agent.displayName)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)

                if let subtitle = agent.profile?.tagline ?? agent.profile?.description,
                   !subtitle.isBlank {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(2)
                }

                if let tags = agent.profile?.tags, !tags.isEmpty {
                    Text(tags.prefix(3).joined(separator: " · "))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(AppColors.accent)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            if isOpening {
                ProgressView()
                    .controlSize(.small)
                    .tint(AppColors.accent)
            } else {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(AppColors.accent)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(AppColors.accentLight))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(AppColors.separator, lineWidth: 1)
        )
    }
}

private enum ProfileMoreAction: String, Identifiable {
    case share
    case copyLink
    case about
    case qrCode
    case report
    case restrict
    case block

    var id: String { rawValue }

    static let primaryActions: [ProfileMoreAction] = [.share, .copyLink, .about, .qrCode]
    static let safetyActions: [ProfileMoreAction] = [.report, .restrict, .block]

    var titleKey: String {
        switch self {
        case .share: return "profile.more.share"
        case .copyLink: return "profile.more.copyLink"
        case .about: return "profile.more.about"
        case .qrCode: return "profile.more.qrCode"
        case .report: return "profile.more.report"
        case .restrict: return "profile.more.restrict"
        case .block: return "profile.more.block"
        }
    }

    var systemImage: String {
        switch self {
        case .share: return "square.and.arrow.up"
        case .copyLink: return "link"
        case .about: return "info.circle"
        case .qrCode: return "qrcode"
        case .report: return "exclamationmark.triangle"
        case .restrict: return "hand.raised"
        case .block: return "nosign"
        }
    }

    var isDestructive: Bool {
        switch self {
        case .report, .restrict, .block: return true
        case .share, .copyLink, .about, .qrCode: return false
        }
    }
}

private struct ProfileMoreActionsOverlay: View {
    let onDismiss: () -> Void
    let onSelect: (ProfileMoreAction) -> Void
    @State private var isSheetVisible = false

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .bottom) {
                Color.black.opacity(isSheetVisible ? 0.06 : 0)
                    .ignoresSafeArea()
                    .onTapGesture(perform: onDismiss)
                    .animation(.easeOut(duration: 0.12), value: isSheetVisible)

                VStack(spacing: 0) {
                    Capsule()
                        .fill(AppColors.tertiaryText.opacity(0.42))
                        .frame(width: 36, height: 4)
                        .padding(.top, 9)
                        .padding(.bottom, 5)

                    ProfileMoreActionSection(actions: ProfileMoreAction.primaryActions, onSelect: onSelect)

                    Rectangle()
                        .fill(AppColors.separator)
                        .frame(height: 8)

                    ProfileMoreActionSection(actions: ProfileMoreAction.safetyActions, onSelect: onSelect)

                    Color(.systemBackground)
                        .frame(height: max(proxy.safeAreaInsets.bottom, 0))
                }
                .frame(maxWidth: .infinity)
                .background(
                    ProfileTopRoundedShape(radius: 24)
                        .fill(Color(.systemBackground))
                        .shadow(color: Color.black.opacity(0.06), radius: 10, x: 0, y: -2)
                )
                .offset(y: isSheetVisible ? 0 : proxy.size.height)
                .animation(.spring(response: 0.24, dampingFraction: 0.92), value: isSheetVisible)
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .bottom)
        }
        .onAppear {
            isSheetVisible = true
        }
    }
}

private struct ProfileMoreActionSection: View {
    let actions: [ProfileMoreAction]
    let onSelect: (ProfileMoreAction) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(actions) { action in
                Button {
                    onSelect(action)
                } label: {
                    HStack(spacing: 14) {
                        Image(systemName: action.systemImage)
                            .font(.system(size: 17, weight: .semibold))
                            .frame(width: 24)

                        Text(L10n.tr(action.titleKey))
                            .font(.system(size: 15, weight: .semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.82)

                        Spacer(minLength: 0)
                    }
                    .foregroundColor(action.isDestructive ? AppColors.errorColor : AppColors.primaryText)
                    .frame(height: 46)
                    .padding(.horizontal, 22)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if action.id != actions.last?.id {
                    Divider()
                        .padding(.leading, 60)
                }
            }
        }
    }
}

private struct ProfileTopRoundedShape: Shape {
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: [.topLeft, .topRight],
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

private struct ProfileHighlightBubble: View {
    let highlight: ProfileHighlight

    var body: some View {
        VStack(spacing: 6) {
            ProfileHighlightCover(url: highlight.coverURL)
                .frame(width: 64, height: 64)
                .overlay(
                    Circle()
                        .stroke(AppColors.separator, lineWidth: 1)
                )

            Text(highlight.title.isBlank ? L10n.tr("profile.highlights.default") : highlight.title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(AppColors.primaryText)
                .lineLimit(1)
                .frame(width: 72)
        }
    }
}

private struct ProfileHighlightCover: View {
    let url: String

    @State private var image: UIImage?
    @State private var isLoading = true

    private var cacheKey: String { url + "?profile-highlight=1" }

    var body: some View {
        ZStack {
            Circle()
                .fill(AppColors.separator)

            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .clipShape(Circle())
            } else if isLoading {
                ProgressView()
                    .tint(AppColors.accent)
                    .scaleEffect(0.58)
            } else {
                Image(systemName: "star.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(AppColors.secondaryText)
            }
        }
        .clipShape(Circle())
        .onAppear {
            if image == nil, let cached = ImageCacheManager.shared.image(for: cacheKey) {
                image = cached
                isLoading = false
            }
        }
        .task(id: url) {
            await loadImage()
        }
    }

    private func loadImage() async {
        guard !url.isBlank else {
            image = nil
            isLoading = false
            return
        }
        isLoading = true
        let loaded = await ImageCacheManager.shared.loadImage(from: url, thumbnail: true)
        if let loaded {
            ImageCacheManager.shared.setImage(loaded, for: cacheKey)
        }
        image = loaded
        isLoading = false
    }
}

private struct UserProfileGridItem: Identifiable {
    let moment: Moment
    let media: MomentMedia
    let isLockedForViewer: Bool

    var id: Int { moment.id }

    var displayURL: String {
        if media.type == .video {
            return media.thumbnailDisplayURL(isLockedForViewer: isLockedForViewer)
                ?? media.lockedPreviewURL
                ?? media.thumbnailURL
                ?? ""
        }
        return media.imageDisplayURL(isLockedForViewer: isLockedForViewer)
    }

    init?(moment: Moment, preferredType: MomentMediaType? = nil, currentUserID: String) {
        let selectedMedia: MomentMedia?
        if let preferredType {
            selectedMedia = moment.media.first { $0.type == preferredType }
        } else {
            selectedMedia = moment.media.first
        }
        guard let firstMedia = selectedMedia else { return nil }
        self.moment = moment
        self.media = firstMedia
        self.isLockedForViewer = (moment.unlockPriceCatFood ?? 0) > 0
            && !moment.isUnlocked
            && moment.author.userID != currentUserID
    }
}

private struct UserProfileMomentTile: View {
    let item: UserProfileGridItem

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ProfileGridImage(url: item.displayURL, placeholderSystemImage: item.media.type == .video ? "video.fill" : "photo")
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            HStack(spacing: 6) {
                if item.isLockedForViewer {
                    Image(systemName: "lock.fill")
                }
                if item.moment.media.count > 1 {
                    Image(systemName: "square.on.square")
                }
                if item.media.type == .video {
                    Image(systemName: "play.fill")
                }
            }
            .font(.system(size: 13, weight: .bold))
            .foregroundColor(.white)
            .shadow(color: .black.opacity(0.45), radius: 4, x: 0, y: 1)
            .padding(7)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .accessibilityLabel(L10n.tr("moments.detail.title"))
    }
}

private struct ProfileSquareGridLayout<Content: View>: View {
    let columns: Int
    let spacing: CGFloat
    @ViewBuilder let content: Content

    init(columns: Int, spacing: CGFloat, @ViewBuilder content: () -> Content) {
        self.columns = columns
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        ProfileSquareGrid(columns: columns, spacing: spacing) {
            content
        }
    }
}

private struct ProfileSquareGrid: Layout {
    let columns: Int
    let spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard !subviews.isEmpty else { return .zero }

        let width = max(0, proposal.width ?? UIScreen.main.bounds.width)
        let tileSize = tileSize(for: width)
        let rowCount = rows(for: subviews.count)
        let height = CGFloat(rowCount) * tileSize + CGFloat(max(0, rowCount - 1)) * spacing
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let tileSize = tileSize(for: bounds.width)
        let columnCount = max(1, columns)

        for (index, subview) in subviews.enumerated() {
            let row = index / columnCount
            let column = index % columnCount
            let x = bounds.minX + CGFloat(column) * (tileSize + spacing)
            let y = bounds.minY + CGFloat(row) * (tileSize + spacing)
            subview.place(
                at: CGPoint(x: x, y: y),
                anchor: .topLeading,
                proposal: ProposedViewSize(width: tileSize, height: tileSize)
            )
        }
    }

    private func tileSize(for width: CGFloat) -> CGFloat {
        let columnCount = max(1, columns)
        let totalSpacing = CGFloat(columnCount - 1) * spacing
        return max(0, floor((width - totalSpacing) / CGFloat(columnCount)))
    }

    private func rows(for itemCount: Int) -> Int {
        let columnCount = max(1, columns)
        return Int(ceil(Double(itemCount) / Double(columnCount)))
    }
}

private struct ProfileGridImage: View {
    let url: String
    let placeholderSystemImage: String

    @State private var image: UIImage?
    @State private var isLoading = true

    private var thumbCacheKey: String { url + "?thumb=1" }

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size

            ZStack {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: size.width, height: size.height)
                } else if isLoading {
                    Rectangle()
                        .fill(AppColors.separator)
                        .overlay(ProgressView().tint(AppColors.accent).scaleEffect(0.65))
                } else {
                    Rectangle()
                        .fill(AppColors.separator)
                        .overlay(
                            Image(systemName: placeholderSystemImage)
                                .font(.system(size: 24, weight: .semibold))
                                .foregroundColor(AppColors.secondaryText)
                        )
                }
            }
            .frame(width: size.width, height: size.height)
            .clipped()
        }
        .clipped()
        .onAppear {
            if image == nil, let cached = ImageCacheManager.shared.image(for: thumbCacheKey) {
                image = cached
                isLoading = false
            }
        }
        .task(id: url) {
            await loadImage()
        }
    }

    private func loadImage() async {
        guard !url.isBlank else {
            image = nil
            isLoading = false
            return
        }

        if image == nil {
            image = await ImageCacheManager.shared.loadImage(from: url, thumbnail: true)
        }
        isLoading = false
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
