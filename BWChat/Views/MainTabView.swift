// BWChat/Views/MainTabView.swift
// Main tab bar: Messages (unified), Contacts, Discover, Profile

import SwiftUI

struct MainTabView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = 0
    @State private var tabBarRepairID = 0
    @ObservedObject private var mediaSaveFeedback = MediaSaveFeedback.shared
    @ObservedObject private var appearanceStore = ChatAppearanceStore.shared
    @ObservedObject private var languageStore = AppLanguageStore.shared

    var body: some View {
        ZStack {
            MainTabController(
                selectedIndex: $selectedTab,
                repairID: tabBarRepairID,
                languageIdentifier: languageStore.activeLanguage.rawValue
            )
                .ignoresSafeArea(.container)

            ImageGalleryOverlay()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openChat"))) { _ in
            selectedTab = 0
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openGroupChat"))) { _ in
            selectedTab = 0
        }
        .task(id: AuthManager.shared.currentUser?.userID ?? "") {
            await appearanceStore.load()
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                tabBarRepairID += 1
            }
        }
        .toast(message: $mediaSaveFeedback.toastMessage)
    }
}

// MARK: - Contacts Tab (Friends + Requests)

struct ContactsTabView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel = FriendsViewModel()
    @StateObject private var groupsViewModel = GroupsViewModel()
    @ObservedObject private var botStore = BotStore.shared

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                RootTabTitle(localizedKey: "tab.contacts")
                    .padding(.horizontal, 16)
                    .padding(.top, AppSpacing.rootTabTopInset)
                    .padding(.bottom, 12)

                // Quick actions - friend requests link
                VStack(spacing: 0) {
                    Button {
                        navigator.push(FriendRequestsView())
                    } label: {
                        HStack(spacing: 12) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(AppColors.warningColor.opacity(0.12))
                                    .frame(width: 40, height: 40)
                                Image(systemName: "person.crop.circle.badge.clock")
                                    .font(.system(size: 17))
                                    .foregroundColor(AppColors.warningColor)
                            }

                            Text(L10n.tr("contacts.friendRequests"))
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(AppColors.primaryText)

                            Spacer()

                            if !viewModel.friendRequests.isEmpty {
                                Text("\(viewModel.friendRequests.count)")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(AppColors.unreadBadge)
                                    .cornerRadius(10)
                            }

                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(AppColors.tertiaryText)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .contentShape(Rectangle())
                    }
                }
                .background(AppColors.cardBackground)
                .cornerRadius(14)
                .padding(.horizontal, 16)
                .padding(.bottom, 12)

                myGroupsCard
                    .padding(.bottom, 12)

                aiCompanionCard

                // Friends list
                if viewModel.friends.isEmpty && !viewModel.isLoading {
                    VStack(spacing: 14) {
                        Image(systemName: "person.2.slash")
                            .font(.system(size: 36))
                            .foregroundColor(AppColors.tertiaryText)
                        Text(L10n.tr("contacts.empty.title"))
                            .font(.system(size: 15))
                            .foregroundColor(AppColors.secondaryText)
                        Text(L10n.tr("contacts.empty.subtitle"))
                            .font(.system(size: 13))
                            .foregroundColor(AppColors.tertiaryText)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(L10n.tr("contacts.friends.count", viewModel.friends.count))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                            .textCase(.uppercase)
                            .padding(.leading, 16 + RootTabTitle.leadingContentInset)
                            .padding(.trailing, 16)
                            .padding(.top, 20)
                            .padding(.bottom, 8)

                        VStack(spacing: 0) {
                            ForEach(viewModel.friends) { friend in
                                Button {
                                    navigator.push(ChatView(contact: Contact(
                                        userID: friend.userID,
                                        nickname: friend.nickname,
                                        avatarURL: friend.avatarURL,
                                        lastMessage: nil,
                                        lastMessageTime: nil,
                                        unreadCount: 0
                                    )))
                                } label: {
                                    HStack(spacing: 12) {
                                        AvatarView(url: friend.avatarURL, size: 42)

                                        Text(friend.nickname)
                                            .font(.system(size: 16, weight: .medium))
                                            .foregroundColor(AppColors.primaryText)

                                        Spacer()

                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundColor(AppColors.tertiaryText)
                                    }
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 10)
                                    .frame(minHeight: AppListMetrics.userCardHeight)
                                    .contentShape(Rectangle())
                                }

                                if friend.id != viewModel.friends.last?.id {
                                    Divider().padding(.leading, 70)
                                }
                            }
                        }
                        .background(AppColors.cardBackground)
                        .cornerRadius(14)
                        .padding(.horizontal, 16)
                    }
                }
            }
            .padding(.bottom, 20)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task(id: AuthManager.shared.currentUser?.userID ?? "") {
            async let friends: () = viewModel.loadFriends()
            async let requests: () = viewModel.loadFriendRequests()
            async let bots: () = botStore.syncServerBots()
            async let groups: () = groupsViewModel.loadGroups()
            await friends
            await requests
            await bots
            await groups
        }
        .refreshable {
            async let friends: () = viewModel.loadFriends()
            async let requests: () = viewModel.loadFriendRequests()
            async let bots: () = botStore.syncServerBots()
            async let groups: () = groupsViewModel.loadGroups()
            await friends
            await requests
            await bots
            await groups
        }
    }

    private var myGroupsCard: some View {
        Button {
            navigator.push(GroupListView(mode: .myGroups).withUIKitBackButton())
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [Color(hex: "34C759"), Color(hex: "00B894")],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 42, height: 42)

                    Image(systemName: "person.3.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(.white)
                }

                Text(L10n.tr("contacts.myGroups"))
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)

                Spacer()

                Text(L10n.tr("contacts.myGroups.count", groupsViewModel.groups.count))
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(1)

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(AppColors.tertiaryText)
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: AppListMetrics.userCardHeight, alignment: .leading)
            .background(AppColors.cardBackground)
            .cornerRadius(14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
    }

    private var aiCompanionCard: some View {
        Button {
            navigator.push(AIBotListView())
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [Color(hex: "8B7CFF"), Color(hex: "C779FF")],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 42, height: 42)

                    Image(systemName: "sparkles")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(.white)
                }

                Text(L10n.tr("contacts.aiCompanions"))
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)

                Spacer()

                Text(L10n.tr("contacts.aiCompanions.count", botStore.bots.count))
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(1)

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(AppColors.tertiaryText)
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: AppListMetrics.userCardHeight, alignment: .leading)
            .background(AppColors.cardBackground)
            .cornerRadius(14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
    }
}

// MARK: - AI Bot List

private struct AIBotListView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var botStore = BotStore.shared
    @State private var showCreateBot = false

    var body: some View {
        Group {
            if botStore.bots.isEmpty {
                emptyState
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(Array(botStore.bots.enumerated()), id: \.element.id) { index, bot in
                            Button {
                                navigator.push(BotChatView(botID: bot.id))
                            } label: {
                                AIBotListRow(
                                    bot: bot,
                                    lastMessage: botStore.lastMessage(for: bot.id),
                                    showsDivider: index < botStore.bots.count - 1
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .background(AppColors.cardBackground)
                    .cornerRadius(14)
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 24)
                }
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("contacts.aiCompanions"))
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showCreateBot = true
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(AppColors.accentGradient)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(L10n.tr("messages.createBot"))
            }
        }
        .sheet(isPresented: $showCreateBot) {
            BotConfigView(mode: .create)
        }
        .task {
            await botStore.syncServerBots()
        }
        .refreshable {
            await botStore.syncServerBots()
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer()
            ZStack {
                Circle()
                    .fill(AppColors.accent.opacity(0.08))
                    .frame(width: 74, height: 74)
                Image(systemName: "sparkles")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(AppColors.accentGradient)
            }
            Text(L10n.tr("contacts.aiCompanions.emptyTitle"))
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
            Button {
                showCreateBot = true
            } label: {
                Text(L10n.tr("messages.createBot"))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(AppColors.accentGradient)
                    .cornerRadius(12)
            }
            .buttonStyle(.plain)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct AIBotListRow: View {
    let bot: BotConfig
    let lastMessage: BotChatMessage?
    let showsDivider: Bool

    var body: some View {
        HStack(spacing: 12) {
            BotAvatar(avatarURL: bot.avatarURL, emoji: bot.emoji, size: 48)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(bot.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)

                    Text(L10n.tr("bot.label"))
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(AppColors.accentLight)
                        .cornerRadius(4)
                }

                Text(subtitle)
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            if showsDivider {
                Divider()
                    .padding(.leading, 76)
            }
        }
    }

    private var subtitle: String {
        if let lastMessage {
            return (lastMessage.role == "user" ? L10n.tr("common.me.withColon") : "")
                + ConversationPreviewFormatter.text(for: lastMessage.content)
        }
        return bot.characterBackground.isEmpty ? L10n.tr("bot.chat.start") : bot.characterBackground
    }
}

// MARK: - Group List View

struct GroupListView: View {
    enum Mode: Equatable {
        case publicGroups
        case myGroups

        var navigationTitleKey: String {
            switch self {
            case .publicGroups:
                return "discover.groups"
            case .myGroups:
                return "contacts.myGroups"
            }
        }

        var emptyTitleKey: String {
            switch self {
            case .publicGroups:
                return "groups.empty.title"
            case .myGroups:
                return "contacts.myGroups.emptyTitle"
            }
        }

        var emptySubtitleKey: String {
            switch self {
            case .publicGroups:
                return "groups.empty.subtitle"
            case .myGroups:
                return "contacts.myGroups.emptySubtitle"
            }
        }
    }

    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel = GroupsViewModel()
    @State private var showCreateGroup = false
    let mode: Mode

    init(mode: Mode = .publicGroups) {
        self.mode = mode
    }

    private var displayedGroups: [ChatGroup] {
        switch mode {
        case .publicGroups:
            return viewModel.groups.filter(\.isPublic)
        case .myGroups:
            return viewModel.groups
        }
    }

    var body: some View {
        Group {
            if displayedGroups.isEmpty && !viewModel.isLoading {
                VStack(spacing: 14) {
                    Spacer()
                    ZStack {
                        Circle()
                            .fill(AppColors.groupAccent.opacity(0.08))
                            .frame(width: 70, height: 70)
                        Image(systemName: "person.3")
                            .font(.system(size: 28))
                            .foregroundColor(AppColors.groupAccent.opacity(0.5))
                    }
                    Text(L10n.tr(mode.emptyTitleKey))
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                    Text(L10n.tr(mode.emptySubtitleKey))
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.tertiaryText)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                List {
                    ForEach(displayedGroups) { group in
                        Button {
                            navigator.push(GroupChatView(group: group) {
                                viewModel.markGroupAsRead(groupID: group.id)
                            })
                        } label: {
                            GroupRow(group: group)
                        }
                        .buttonStyle(.plain)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                        .listRowBackground(Color.clear)
                    }
                }
                .listStyle(.plain)
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr(mode.navigationTitleKey))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showCreateGroup = true
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(AppColors.accentGradient)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
            }
        }
        .sheet(isPresented: $showCreateGroup) {
            CreateGroupView(initialIsPublic: mode == .publicGroups) {
                Task { await viewModel.loadGroups() }
            }
        }
        .task(id: AuthManager.shared.currentUser?.userID ?? "") {
            await viewModel.loadGroups()
        }
        .refreshable {
            await viewModel.loadGroups()
        }
    }
}

// MARK: - Group Row

struct GroupRow: View {
    let group: ChatGroup

    var body: some View {
        HStack(spacing: 12) {
            // Group avatar
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: "5856D6").opacity(0.8), Color(hex: "764BA2").opacity(0.6)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 48, height: 48)
                Image(systemName: "person.3.fill")
                    .font(.system(size: 16))
                    .foregroundColor(.white)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(group.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)

                    Text("(\(group.memberCount))")
                        .font(.system(size: 13))
                        .foregroundColor(AppColors.tertiaryText)
                }

                if let lastMsg = group.lastMessage {
                    HStack(spacing: 0) {
                        if let sender = group.lastMessageSender {
                            Text("\(sender): ")
                                .font(.system(size: 14))
                                .foregroundColor(AppColors.secondaryText)
                        }
                        Text(ConversationPreviewFormatter.text(for: lastMsg))
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.secondaryText)
                    }
                    .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 6) {
                Text(group.formattedTime)
                    .font(.system(size: 12))
                    .foregroundColor(AppColors.tertiaryText)

                if group.unreadCount > 0 {
                    Text("\(group.unreadCount)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(AppColors.unreadBadge)
                        .cornerRadius(10)
                }
            }
        }
        .padding(.vertical, 10)
        .frame(minHeight: AppListMetrics.userCardHeight)
    }
}
