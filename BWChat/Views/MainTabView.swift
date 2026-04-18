// BWChat/Views/MainTabView.swift
// Main tab bar: Messages (unified), Contacts, Discover, Profile

import SwiftUI
import UIKit

/// Native UITabBar's background is UIBlurEffect(.systemChromeMaterial).
/// SwiftUI's `.bar` / `.ultraThinMaterial` approximate but don't exactly
/// match, so we bridge UIBlurEffect directly.
private struct SystemChromeBlur: UIViewRepresentable {
    func makeUIView(context: Context) -> UIVisualEffectView {
        UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
    }
    func updateUIView(_ uiView: UIVisualEffectView, context: Context) {}
}

// The selected-tab binding is injected into the environment so each tab's
// root can attach the bottom bar via `.withBottomTabBar()` from inside its
// own NavigationStack. The bar becomes part of the stack's root view, so
// a pushed detail naturally covers it during push and uncovers it during
// pop — identical to UITabBarController's native behavior, with the bar
// visible throughout the pop animation rather than flashing in at the end.
private struct SelectedTabKey: EnvironmentKey {
    static let defaultValue: Binding<Int> = .constant(0)
}

extension EnvironmentValues {
    var selectedTabBinding: Binding<Int> {
        get { self[SelectedTabKey.self] }
        set { self[SelectedTabKey.self] = newValue }
    }
}

extension View {
    /// Attach the custom bottom tab bar. Apply this *inside* a
    /// NavigationStack root so pushed detail views (which live inside
    /// the same NavigationStack) cover the bar.
    func withBottomTabBar() -> some View {
        modifier(BottomTabBarInsetModifier())
    }
}

private struct BottomTabBarInsetModifier: ViewModifier {
    @Environment(\.selectedTabBinding) private var selectedTab

    func body(content: Content) -> some View {
        content
            // Reserve content inset equal to the bar's height without
            // rendering anything here; the actual bar is drawn as an
            // overlay so that scroll content can pass behind its
            // translucent blur — the "floating" feel of a native
            // UITabBar comes from seeing blurred content through the
            // bar, which an opaque safe-area inset couldn't do.
            .safeAreaInset(edge: .bottom, spacing: 0) {
                Color.clear.frame(height: Self.barHeight)
            }
            .overlay(alignment: .bottom) {
                CustomTabBar(selectedTab: selectedTab)
            }
    }

    /// Approximate rendered height of the bar's content (icon + label +
    /// padding + separator). The bar's background extends past this
    /// into the bottom safe area via its own ignoresSafeArea.
    static let barHeight: CGFloat = 49
}

struct MainTabView: View {
    @State private var selectedTab = 0
    @ObservedObject private var mediaSaveFeedback = MediaSaveFeedback.shared

    var body: some View {
        ZStack {
            // Keep every tab alive so navigating between them preserves each
            // NavigationStack's state (same behavior as a native TabView).
            // Use opacity + allowsHitTesting to switch which one is active.
            ContactListView()
                .opacity(selectedTab == 0 ? 1 : 0)
                .allowsHitTesting(selectedTab == 0)
            ContactsTabView()
                .opacity(selectedTab == 1 ? 1 : 0)
                .allowsHitTesting(selectedTab == 1)
            DiscoverView()
                .opacity(selectedTab == 2 ? 1 : 0)
                .allowsHitTesting(selectedTab == 2)
            ProfileView()
                .opacity(selectedTab == 3 ? 1 : 0)
                .allowsHitTesting(selectedTab == 3)

            ImageGalleryOverlay()
        }
        .environment(\.selectedTabBinding, $selectedTab)
        .ignoresSafeArea(.keyboard)
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openChat"))) { _ in
            selectedTab = 0
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openGroupChat"))) { _ in
            selectedTab = 0
        }
        .toast(message: $mediaSaveFeedback.toastMessage)
    }
}

// MARK: - Custom Tab Bar

private struct CustomTabBar: View {
    @Binding var selectedTab: Int

    private struct Item {
        let icon: String
        let selectedIcon: String
        let title: String
    }

    private let items: [Item] = [
        Item(icon: "bubble.left.and.bubble.right", selectedIcon: "bubble.left.and.bubble.right.fill", title: "消息"),
        Item(icon: "person.crop.circle", selectedIcon: "person.crop.circle.fill", title: "通讯录"),
        Item(icon: "safari", selectedIcon: "safari.fill", title: "发现"),
        Item(icon: "gearshape", selectedIcon: "gearshape.fill", title: "我"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Native UITabBar uses a hairline separator, not a full Divider.
            Rectangle()
                .fill(Color(uiColor: .separator))
                .frame(height: 0.5)
            HStack(spacing: 0) {
                ForEach(0..<items.count, id: \.self) { i in
                    let item = items[i]
                    let isSelected = selectedTab == i
                    Button {
                        if selectedTab != i { selectedTab = i }
                    } label: {
                        VStack(spacing: 3) {
                            Image(systemName: isSelected ? item.selectedIcon : item.icon)
                                .font(.system(size: 24))
                            Text(item.title)
                                .font(.system(size: 10))
                        }
                        // `.secondaryLabel` is what UITabBar uses for
                        // unselected items — matches the native look.
                        .foregroundColor(isSelected ? AppColors.accent : Color(uiColor: .secondaryLabel))
                        .frame(maxWidth: .infinity)
                        .padding(.top, 6)
                        .padding(.bottom, 2)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        // UIBlurEffect(.systemChromeMaterial) is the exact effect native
        // UITabBar renders. Extended past the bottom safe area so the blur
        // runs under the home indicator.
        .background {
            SystemChromeBlur()
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

// MARK: - Contacts Tab (Friends + Requests)

struct ContactsTabView: View {
    @StateObject private var viewModel = FriendsViewModel()
    @State private var showAddFriend = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    // Quick actions - friend requests link
                    VStack(spacing: 0) {
                        NavigationLink {
                            FriendRequestsView()
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

                                Text("好友请求")
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
                    .padding(.top, 12)

                    // Friends list
                    if viewModel.friends.isEmpty && !viewModel.isLoading {
                        VStack(spacing: 14) {
                            Image(systemName: "person.2.slash")
                                .font(.system(size: 36))
                                .foregroundColor(AppColors.tertiaryText)
                            Text("还没有好友")
                                .font(.system(size: 15))
                                .foregroundColor(AppColors.secondaryText)
                            Text("点击右上角添加好友吧")
                                .font(.system(size: 13))
                                .foregroundColor(AppColors.tertiaryText)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                    } else {
                        VStack(alignment: .leading, spacing: 0) {
                            Text("好友 (\(viewModel.friends.count))")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundColor(AppColors.secondaryText)
                                .textCase(.uppercase)
                                .padding(.horizontal, 16)
                                .padding(.top, 20)
                                .padding(.bottom, 8)

                            VStack(spacing: 0) {
                                ForEach(viewModel.friends) { friend in
                                    NavigationLink {
                                        ChatView(contact: Contact(
                                            userID: friend.userID,
                                            nickname: friend.nickname,
                                            avatarURL: friend.avatarURL,
                                            lastMessage: nil,
                                            lastMessageTime: nil,
                                            unreadCount: 0
                                        ))
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
            .navigationTitle("通讯录")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showAddFriend = true
                    } label: {
                        Image(systemName: "person.badge.plus")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(AppColors.accent)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                }
            }
            .sheet(isPresented: $showAddFriend) {
                AddFriendView()
            }
            .task(id: AuthManager.shared.currentUser?.userID ?? "") {
                await viewModel.loadFriends()
                await viewModel.loadFriendRequests()
            }
            .refreshable {
                await viewModel.loadFriends()
                await viewModel.loadFriendRequests()
            }
            .withBottomTabBar()
        }
    }
}

// MARK: - Group List View

struct GroupListView: View {
    @StateObject private var viewModel = GroupsViewModel()
    @State private var showCreateGroup = false

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.groups.isEmpty && !viewModel.isLoading {
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
                        Text("暂无群聊")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                        Text("创建一个群聊开始聊天吧")
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.tertiaryText)
                        Spacer()
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    List {
                        ForEach(viewModel.groups) { group in
                            NavigationLink(value: group) {
                                GroupRow(group: group)
                            }
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                            .listRowBackground(Color.clear)
                        }
                    }
                    .listStyle(.plain)
                    .navigationDestination(for: ChatGroup.self) { group in
                        GroupChatView(group: group) {
                            viewModel.markGroupAsRead(groupID: group.id)
                        }
                    }
                }
            }
            .background(AppColors.secondaryBackground)
            .navigationTitle("群聊")
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
                CreateGroupView {
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
                        Text(lastMsg)
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
        .padding(.vertical, 6)
    }
}
