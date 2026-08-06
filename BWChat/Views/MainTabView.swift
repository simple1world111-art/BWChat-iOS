// BWChat/Views/MainTabView.swift
// Main tab bar: Messages (unified), Contacts, Discover, Profile

import SwiftUI
import UIKit

struct MainTabView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab = 0
    @State private var tabBarRepairID = 0
    @ObservedObject private var mediaSaveFeedback = MediaSaveFeedback.shared
    @ObservedObject private var appearanceStore = ChatAppearanceStore.shared
    @ObservedObject private var languageStore = AppLanguageStore.shared
    @ObservedObject private var unreadBadgeStore = UnreadBadgeStore.shared
    @ObservedObject private var messageSyncCoordinator = AppMessageSyncCoordinator.shared
    @ObservedObject private var groupInviteRouteStore = GroupInviteRouteStore.shared
    @ObservedObject private var activityInviteRouteStore = ActivityInviteRouteStore.shared
    @State private var tabs = DynamicTabDescriptor.defaultTabs

    private var tabBadges: [String: Int] {
        [
            "messages": unreadBadgeStore.chatUnreadCount,
            "discover": unreadBadgeStore.momentsUnreadCount
        ]
    }

    var body: some View {
        ZStack {
            MainTabController(
                selectedIndex: $selectedTab,
                repairID: tabBarRepairID,
                languageIdentifier: languageStore.activeLanguage.rawValue,
                tabs: tabs,
                tabBadges: tabBadges
            )
                .ignoresSafeArea(.container)
                .ignoresSafeArea(.keyboard, edges: .bottom)

            ImageGalleryOverlay()
        }
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openChat"))) { _ in
            selectedTab = 0
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openGroupChat"))) { _ in
            selectedTab = 0
        }
        .onReceive(messageSyncCoordinator.$pendingRoute.compactMap { $0 }) { _ in
            if let index = tabs.firstIndex(where: {
                $0.id.normalizedDynamicToken == "messages"
            }) {
                selectedTab = index
            } else {
                selectedTab = 0
            }
        }
        .onReceive(groupInviteRouteStore.$pendingToken.compactMap { $0 }) { _ in
            if let index = tabs.firstIndex(where: {
                $0.id.normalizedDynamicToken == "messages"
            }) {
                selectedTab = index
            } else {
                selectedTab = 0
            }
        }
        .onReceive(activityInviteRouteStore.$pendingToken.compactMap { $0 }) { _ in
            if let index = tabs.firstIndex(where: {
                $0.id.normalizedDynamicToken == "discover"
            }) {
                selectedTab = index
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .openMainTab)) { notification in
            guard let tabID = notification.userInfo?["tabID"] as? String else { return }
            if let index = tabs.firstIndex(where: { $0.id.normalizedDynamicToken == tabID.normalizedDynamicToken }) {
                selectedTab = index
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .openLivePairChat)) { notification in
            guard let contact = notification.object as? Contact else { return }
            if let index = tabs.firstIndex(where: { $0.id.normalizedDynamicToken == "messages" }) {
                selectedTab = index
            }
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: .pushLivePairChat, object: contact)
            }
        }
        .task(id: AuthManager.shared.currentUser?.userID ?? "") {
            await refreshTabs()
            await appearanceStore.load()
        }
        .onChange(of: tabs.map(\.id)) { _ in
            selectedTab = min(selectedTab, max(tabs.count - 1, 0))
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                tabBarRepairID += 1
                Task { await refreshTabs() }
            }
        }
        .toast(message: $mediaSaveFeedback.toastMessage)
    }

    @MainActor
    private func refreshTabs(force: Bool = false) async {
        await AppRemoteConfigStore.shared.load(force: force)
        let nextTabs = AppRemoteConfigStore.shared.config.effectiveTabs
        guard nextTabs != tabs else { return }
        tabs = nextTabs
        selectedTab = min(selectedTab, max(nextTabs.count - 1, 0))
    }
}

// MARK: - Contacts Tab (Friends + Requests)

struct ContactsTabView: View {
    let isRootTab: Bool

    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel = FriendsViewModel()
    @StateObject private var groupsViewModel = GroupsViewModel()
    @ObservedObject private var appConfig = AppRemoteConfigStore.shared
    @State private var routeAlert: DynamicRouteAlert?

    init(isRootTab: Bool = true) {
        self.isRootTab = isRootTab
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                if isRootTab {
                    RootTabTitle(localizedKey: "tab.contacts")
                        .padding(.horizontal, 16)
                        .padding(.top, AppSpacing.rootTabTopInset)
                        .padding(.bottom, 12)
                } else {
                    Color.clear
                        .frame(height: 16)
                }

                dynamicContactModules
                    .padding(.bottom, 12)

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
        .navigationBarTitleDisplayMode(.inline)
        .modifier(ContactsNavigationChrome(isRootTab: isRootTab))
        .task(id: AuthManager.shared.currentUser?.userID ?? "") {
            async let config: () = appConfig.load()
            async let friends: () = viewModel.loadFriends()
            async let requests: () = viewModel.loadFriendRequests()
            async let groups: () = groupsViewModel.loadGroups()
            await config
            await friends
            await requests
            await groups
        }
        .refreshable {
            async let config: () = appConfig.load(force: true)
            async let friends: () = viewModel.loadFriends(forceRefresh: true)
            async let requests: () = viewModel.loadFriendRequests(forceRefresh: true)
            async let groups: () = groupsViewModel.loadGroups(forceRefresh: true)
            await config
            await friends
            await requests
            await groups
        }
        .alert(item: $routeAlert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text(L10n.tr("common.ok")))
            )
        }
    }

    private var dynamicContactModules: some View {
        VStack(spacing: 10) {
            ForEach(appConfig.config.effectiveContactModules) { section in
                ForEach(section.items) { item in
                    contactModuleRow(item)
                        .frame(maxWidth: .infinity, minHeight: AppListMetrics.userCardHeight, alignment: .leading)
                        .background(AppColors.cardBackground)
                        .cornerRadius(14)
                        .padding(.horizontal, 16)
                }
            }
        }
    }

    private func contactModuleRow(_ item: DynamicSectionItem) -> some View {
        Button {
            switch DynamicRouteHandler.open(
                item.route ?? DynamicRoute(type: "native", name: item.id),
                navigator: navigator,
                fallbackTitle: item.displayTitle()
            ) {
            case .handled:
                break
            case .alert(let alert):
                routeAlert = alert
            }
        } label: {
            HStack(spacing: 12) {
                if item.id.normalizedDynamicToken == "my_groups" {
                    GroupAvatarIcon(size: 40)
                } else if ["agent_hub", "ai_companions"].contains(item.id.normalizedDynamicToken) {
                    AgentAvatarView(assetID: nil, size: 40)
                } else {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(iconFill(for: item.displayColors))
                            .frame(width: 40, height: 40)
                        Image(systemName: resolvedSystemImage(item.systemImage))
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white)
                    }
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(item.displayTitle())
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                    if let subtitle = item.displaySubtitle() {
                        Text(subtitle)
                            .font(.system(size: 12))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                    }
                }

                Spacer()

                if let trailingText = contactTrailingText(for: item) {
                    Text(trailingText)
                        .font(.system(size: 13))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)
                }

                if item.id.normalizedDynamicToken == "friend_requests", !viewModel.friendRequests.isEmpty {
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
            .frame(maxWidth: .infinity, minHeight: AppListMetrics.userCardHeight, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func contactTrailingText(for item: DynamicSectionItem) -> String? {
        switch item.id.normalizedDynamicToken {
        case "my_groups":
            return L10n.tr("contacts.myGroups.count", groupsViewModel.groups.count)
        case "agent_hub", "ai_companions":
            return "Agent Platform"
        default:
            return nil
        }
    }

    private func iconFill(for colors: [Color]) -> AnyShapeStyle {
        if colors.count >= 2 {
            return AnyShapeStyle(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing))
        }
        return AnyShapeStyle(colors.first ?? AppColors.accent)
    }

    private func resolvedSystemImage(_ image: String?) -> String {
        guard let image, UIImage(systemName: image) != nil else { return "sparkles" }
        return image
    }

    private var myGroupsCard: some View {
        Button {
            navigator.push(GroupListView(mode: .myGroups).withUIKitBackButton())
        } label: {
            HStack(spacing: 12) {
                GroupAvatarIcon(size: 42)

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

}

private struct ContactsNavigationChrome: ViewModifier {
    let isRootTab: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if isRootTab {
            content
                .navigationTitle("")
                .toolbar(.hidden, for: .navigationBar)
        } else {
            content
                .navigationTitle(L10n.tr("tab.contacts"))
                .hidesTabBarOnPush()
                .withUIKitBackButton()
        }
    }
}

// MARK: - Group List View

struct GroupListView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case publicGroups
        case myGroups

        var id: String { rawValue }

        var tabTitleKey: String {
            switch self {
            case .publicGroups:
                return "groups.tab.recommended"
            case .myGroups:
                return "groups.tab.myGroups"
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
    @State private var selectedMode: Mode

    init(mode: Mode = .publicGroups) {
        _selectedMode = State(initialValue: mode)
    }

    private var displayedGroups: [ChatGroup] {
        switch selectedMode {
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
                    GroupAvatarIcon(size: 70)
                    Text(L10n.tr(selectedMode.emptyTitleKey))
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                    Text(L10n.tr(selectedMode.emptySubtitleKey))
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.tertiaryText)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                List {
                    ForEach(displayedGroups) { group in
                        Button {
                            navigator.push(GroupChatView(group: group) { throughMessageID in
                                viewModel.markGroupAsRead(
                                    groupID: group.id,
                                    throughMessageID: throughMessageID
                                )
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
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                GroupListModePicker(selection: $selectedMode)
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showCreateGroup = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr("group.create.title"))
            }
        }
        .sheet(isPresented: $showCreateGroup) {
            CreateGroupView(initialIsPublic: selectedMode == .publicGroups) {
                Task { await viewModel.loadGroups() }
            }
        }
        .task(id: AuthManager.shared.currentUser?.userID ?? "") {
            await viewModel.loadGroups()
        }
        .refreshable {
            await viewModel.loadGroups(forceRefresh: true)
        }
    }
}

private struct GroupListModePicker: View {
    @Binding var selection: GroupListView.Mode

    var body: some View {
        SystemSegmentedTabs(
            items: GroupListView.Mode.allCases,
            selection: $selection,
            title: { L10n.tr($0.tabTitleKey) },
            accessibilityIdentifier: "group.top.tabs"
        )
        .frame(width: 196)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Group Row

struct GroupRow: View {
    let group: ChatGroup
    @ObservedObject private var unreadStore = UnreadBadgeStore.shared
    @ObservedObject private var notificationStore = GroupNotificationSettingsStore.shared
    @ObservedObject private var groupInfoPreferencesStore = GroupInfoPreferencesStore.shared

    private var unreadCount: Int {
        unreadStore.conversationUnreadCount(
            for: ConversationReadTarget.group(groupID: group.groupID).listIdentity
        ) ?? group.unreadCount
    }

    private var isMuted: Bool {
        return notificationStore.settings(for: group.groupID).isMuted || group.isMuted
    }

    var body: some View {
        HStack(spacing: 12) {
            GroupMemberAvatarView(groupID: group.groupID, size: 48)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(groupInfoPreferencesStore.displayName(
                        for: group.groupID,
                        fallback: group.name
                    ))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)

                    Text("(\(group.memberCount))")
                        .font(.system(size: 13))
                        .foregroundColor(AppColors.tertiaryText)

                    if isMuted {
                        Image(systemName: "bell.slash.fill")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(AppColors.tertiaryText)
                            .accessibilityLabel(L10n.tr("group.notifications.mute"))
                    }
                }

                if let lastMsg = group.lastMessage {
                    HStack(spacing: 0) {
                        if let sender = ConversationPreviewFormatter.senderPrefix(
                            group.lastMessageSender,
                            content: lastMsg
                        ) {
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

                if unreadCount > 0 {
                    Text("\(min(unreadCount, 99))\(unreadCount > 99 ? "+" : "")")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(isMuted ? AppColors.mutedUnreadBadge : AppColors.unreadBadge)
                        .cornerRadius(10)
                }
            }
        }
        .padding(.vertical, 10)
        .frame(minHeight: AppListMetrics.userCardHeight)
    }
}
