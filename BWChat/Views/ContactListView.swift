import SwiftUI

struct ContactListView: View {
    @StateObject private var viewModel = ConversationListViewModel()
    @State private var showCreateGroup = false
    @State private var showComposeMenu = false
    @State private var showAddFriendSheet = false
    @State private var showScannerComingSoon = false
    @State private var showAgentComingSoon = false
    @State private var navigationPath = NavigationPath()

    var body: some View {
        NavigationStack(path: $navigationPath) {
            Group {
                if viewModel.conversations.isEmpty && !viewModel.isLoading {
                    emptyStateView
                } else {
                    conversationListView
                }
            }
            .background(AppColors.secondaryBackground)
            .navigationTitle("消息")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showComposeMenu = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(AppColors.accentGradient)
                            .frame(width: 36, height: 36)
                            .contentShape(Rectangle())
                    }
                }
            }
            .confirmationDialog("", isPresented: $showComposeMenu, titleVisibility: .hidden) {
                Button("发起群聊") { showCreateGroup = true }
                Button("添加朋友") { showAddFriendSheet = true }
                Button("扫一扫") { showScannerComingSoon = true }
                Button("创建智能体") { showAgentComingSoon = true }
                Button("取消", role: .cancel) {}
            }
            .sheet(isPresented: $showAddFriendSheet) {
                AddFriendView()
            }
            .alert("扫一扫", isPresented: $showScannerComingSoon) {
                Button("好的", role: .cancel) {}
            } message: {
                Text("功能开发中，敬请期待。")
            }
            .alert("创建智能体", isPresented: $showAgentComingSoon) {
                Button("好的", role: .cancel) {}
            } message: {
                Text("智能体功能开发中，敬请期待。")
            }
            .refreshable {
                await viewModel.loadConversations()
            }
            .sheet(isPresented: $showCreateGroup) {
                CreateGroupView {
                    Task { await viewModel.loadConversations() }
                }
            }
            .withBottomTabBar()
        }
        .task(id: AuthManager.shared.currentUser?.userID ?? "") {
            await viewModel.loadConversations()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openChat"))) { notif in
            guard let senderID = notif.userInfo?["sender_id"] as? String else { return }
            navigationPath = NavigationPath()
            if let conv = viewModel.conversations.first(where: { $0.isDM && $0.id == senderID }) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    navigationPath.append(conv)
                }
            } else {
                let user = UserCacheManager.shared.getUser(senderID)
                let conv = Conversation(
                    type: "dm",
                    id: senderID,
                    name: user?.nickname ?? senderID,
                    avatarURL: user?.avatarURL ?? "",
                    lastMessage: nil,
                    lastMessageTime: nil,
                    unreadCount: 0,
                    subtitle: nil,
                    groupID: nil,
                    memberCount: nil
                )
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    navigationPath.append(conv)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openGroupChat"))) { notif in
            guard let groupID = notif.userInfo?["group_id"] as? Int else { return }
            navigationPath = NavigationPath()
            if let conv = viewModel.conversations.first(where: { $0.groupID == groupID }) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    navigationPath.append(conv)
                }
            }
        }
    }

    private var conversationListView: some View {
        List {
            ForEach(viewModel.conversations) { conv in
                if conv.isDM {
                    NavigationLink(value: conv) {
                        ConversationRow(conversation: conv)
                    }
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
                } else {
                    NavigationLink(value: conv) {
                        ConversationRow(conversation: conv)
                    }
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                    .listRowBackground(Color.clear)
                }
            }
        }
        .listStyle(.plain)
        .navigationDestination(for: Conversation.self) { conv in
            if conv.isDM {
                ChatView(contact: Contact(
                    userID: conv.id,
                    nickname: conv.name,
                    avatarURL: conv.avatarURL,
                    lastMessage: conv.lastMessage,
                    lastMessageTime: conv.lastMessageTime,
                    unreadCount: conv.unreadCount
                )) {
                    viewModel.markAsRead(conversationID: conv.id)
                }
            } else if let gid = conv.groupID {
                GroupChatView(group: ChatGroup(
                    groupID: gid,
                    name: conv.name,
                    avatarURL: conv.avatarURL,
                    creatorID: "",
                    memberCount: conv.memberCount ?? 0,
                    lastMessage: conv.lastMessage,
                    lastMessageTime: conv.lastMessageTime,
                    lastMessageSender: conv.subtitle,
                    unreadCount: conv.unreadCount
                )) {
                    viewModel.markGroupAsRead(groupID: gid)
                }
            }
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Spacer()
            ZStack {
                Circle()
                    .fill(AppColors.accent.opacity(0.08))
                    .frame(width: 80, height: 80)
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: 32))
                    .foregroundColor(AppColors.accent.opacity(0.5))
            }
            Text("暂无聊天记录")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(AppColors.primaryText)
            Text("添加好友或创建群聊后开始聊天")
                .font(.system(size: 14))
                .foregroundColor(AppColors.secondaryText)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Conversation Row

struct ConversationRow: View {
    let conversation: Conversation

    var body: some View {
        HStack(spacing: 12) {
            if conversation.isGroup {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [Color(hex: "5856D6").opacity(0.8), Color(hex: "764BA2").opacity(0.6)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 50, height: 50)
                    Image(systemName: "person.3.fill")
                        .font(.system(size: 16))
                        .foregroundColor(.white)
                }
            } else {
                AvatarView(url: conversation.avatarURL, size: 50)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(conversation.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)

                    if conversation.isGroup, let count = conversation.memberCount {
                        Text("(\(count))")
                            .font(.system(size: 13))
                            .foregroundColor(AppColors.tertiaryText)
                    }
                }

                if let lastMsg = conversation.lastMessage {
                    HStack(spacing: 0) {
                        if let sender = conversation.subtitle {
                            Text("\(sender): ")
                                .font(.system(size: 14))
                                .foregroundColor(AppColors.secondaryText)
                        }
                        Text(lastMsg)
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.secondaryText)
                    }
                    .lineLimit(1)
                } else {
                    Text(conversation.isGroup ? "开始群聊吧~" : "开始聊天吧~")
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.tertiaryText)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 6) {
                Text(conversation.formattedTime)
                    .font(.system(size: 12))
                    .foregroundColor(AppColors.tertiaryText)

                if conversation.unreadCount > 0 {
                    Text("\(min(conversation.unreadCount, 99))\(conversation.unreadCount > 99 ? "+" : "")")
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
