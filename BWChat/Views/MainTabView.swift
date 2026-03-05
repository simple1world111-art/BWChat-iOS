// BWChat/Views/MainTabView.swift
// Main tab bar with Messages, Groups, Contacts

import SwiftUI

struct MainTabView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            ContactListView()
                .tabItem {
                    Image(systemName: selectedTab == 0 ? "bubble.left.and.bubble.right.fill" : "bubble.left.and.bubble.right")
                    Text("消息")
                }
                .tag(0)

            GroupListView()
                .tabItem {
                    Image(systemName: selectedTab == 1 ? "person.3.fill" : "person.3")
                    Text("群聊")
                }
                .tag(1)

            ContactsTabView()
                .tabItem {
                    Image(systemName: selectedTab == 2 ? "person.crop.circle.fill" : "person.crop.circle")
                    Text("通讯录")
                }
                .tag(2)
        }
        .tint(AppColors.accent)
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
                    // Quick actions
                    VStack(spacing: 0) {
                        NavigationLink {
                            FriendRequestsView()
                        } label: {
                            HStack(spacing: 14) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 10)
                                        .fill(AppColors.warningColor.opacity(0.12))
                                        .frame(width: 42, height: 42)
                                    Image(systemName: "person.crop.circle.badge.clock")
                                        .font(.system(size: 18))
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
                            .padding(.vertical, 14)
                        }

                        Divider().padding(.leading, 72)
                    }
                    .background(AppColors.cardBackground)
                    .cornerRadius(16)
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                    // Friends list
                    if viewModel.friends.isEmpty && !viewModel.isLoading {
                        VStack(spacing: 16) {
                            Image(systemName: "person.2.slash")
                                .font(.system(size: 40))
                                .foregroundColor(AppColors.tertiaryText)
                            Text("还没有好友")
                                .font(.system(size: 15))
                                .foregroundColor(AppColors.secondaryText)
                            Text("点击右上角添加好友吧")
                                .font(.system(size: 13))
                                .foregroundColor(AppColors.tertiaryText)
                        }
                        .padding(.top, 80)
                    } else {
                        VStack(alignment: .leading, spacing: 0) {
                            Text("好友 (\(viewModel.friends.count))")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundColor(AppColors.secondaryText)
                                .textCase(.uppercase)
                                .padding(.horizontal, 16)
                                .padding(.top, 24)
                                .padding(.bottom, 8)

                            VStack(spacing: 0) {
                                ForEach(viewModel.friends) { friend in
                                    HStack(spacing: 14) {
                                        AvatarView(url: friend.avatarURL, size: 44)

                                        Text(friend.nickname)
                                            .font(.system(size: 16, weight: .medium))
                                            .foregroundColor(AppColors.primaryText)

                                        Spacer()
                                    }
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 10)

                                    if friend.id != viewModel.friends.last?.id {
                                        Divider().padding(.leading, 74)
                                    }
                                }
                            }
                            .background(AppColors.cardBackground)
                            .cornerRadius(16)
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
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(AppColors.accent)
                    }
                }
            }
            .sheet(isPresented: $showAddFriend) {
                AddFriendView()
            }
            .task {
                await viewModel.loadFriends()
                await viewModel.loadFriendRequests()
            }
            .refreshable {
                await viewModel.loadFriends()
                await viewModel.loadFriendRequests()
            }
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
                    VStack(spacing: 16) {
                        Spacer()
                        ZStack {
                            Circle()
                                .fill(AppColors.groupAccent.opacity(0.08))
                                .frame(width: 80, height: 80)
                            Image(systemName: "person.3")
                                .font(.system(size: 32))
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
                } else {
                    List {
                        ForEach(viewModel.groups) { group in
                            NavigationLink(value: group) {
                                GroupRow(group: group)
                            }
                            .listRowSeparator(.hidden)
                            .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                        }
                    }
                    .listStyle(.plain)
                    .navigationDestination(for: ChatGroup.self) { group in
                        GroupChatView(group: group)
                    }
                }
            }
            .navigationTitle("群聊")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showCreateGroup = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(AppColors.accentGradient)
                    }
                }
            }
            .sheet(isPresented: $showCreateGroup) {
                CreateGroupView {
                    Task { await viewModel.loadGroups() }
                }
            }
            .task {
                await viewModel.loadGroups()
            }
            .refreshable {
                await viewModel.loadGroups()
            }
        }
    }
}

struct GroupRow: View {
    let group: ChatGroup

    var body: some View {
        HStack(spacing: 14) {
            // Group avatar
            ZStack {
                RoundedRectangle(cornerRadius: 14)
                    .fill(
                        LinearGradient(
                            colors: [Color(hex: "5856D6").opacity(0.8), Color(hex: "764BA2").opacity(0.6)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 50, height: 50)
                Image(systemName: "person.3.fill")
                    .font(.system(size: 18))
                    .foregroundColor(.white)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
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

            Spacer()

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
