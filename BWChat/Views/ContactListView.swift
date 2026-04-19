import SwiftUI

struct ContactListView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel = ConversationListViewModel()
    @ObservedObject private var botStore = BotStore.shared
    @State private var showCreateGroup = false
    @State private var showAddFriendSheet = false
    @State private var showScannerComingSoon = false
    @State private var showCreateBot = false

    var body: some View {
        Group {
            if viewModel.conversations.isEmpty && botStore.bots.isEmpty && !viewModel.isLoading {
                emptyStateView
            } else {
                conversationListView
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle("消息")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button {
                        showCreateGroup = true
                    } label: {
                        Label("发起群聊", systemImage: "bubble.left.and.bubble.right")
                    }
                    Button {
                        showAddFriendSheet = true
                    } label: {
                        Label("添加朋友", systemImage: "person.badge.plus")
                    }
                    Button {
                        showScannerComingSoon = true
                    } label: {
                        Label("扫一扫", systemImage: "qrcode.viewfinder")
                    }
                    Button {
                        showCreateBot = true
                    } label: {
                        Label("创建智能体", systemImage: "sparkles")
                    }
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(AppColors.accentGradient)
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
            }
        }
        .sheet(isPresented: $showAddFriendSheet) {
            AddFriendView()
        }
        .alert("扫一扫", isPresented: $showScannerComingSoon) {
            Button("好的", role: .cancel) {}
        } message: {
            Text("功能开发中，敬请期待。")
        }
        .sheet(isPresented: $showCreateBot) {
            BotConfigView(mode: .create)
        }
        .refreshable {
            await viewModel.loadConversations()
        }
        .sheet(isPresented: $showCreateGroup) {
            CreateGroupView {
                Task { await viewModel.loadConversations() }
            }
        }
        .task(id: AuthManager.shared.currentUser?.userID ?? "") {
            await viewModel.loadConversations()
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openChat"))) { notif in
            guard let senderID = notif.userInfo?["sender_id"] as? String else { return }
            navigator.popToRoot()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                if let conv = viewModel.conversations.first(where: { $0.isDM && $0.id == senderID }) {
                    openConversation(conv)
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
                    openConversation(conv)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("openGroupChat"))) { notif in
            guard let groupID = notif.userInfo?["group_id"] as? Int else { return }
            navigator.popToRoot()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                if let conv = viewModel.conversations.first(where: { $0.groupID == groupID }) {
                    openConversation(conv)
                }
            }
        }
    }

    /// Push directly into the right concrete destination view. Earlier we
    /// funneled this through a `@ViewBuilder` helper returning `some View`,
    /// but the resulting `_ConditionalContent` wrapper + environmentObject
    /// injection inside `UIKitNavigator.push` produced an intermittent
    /// breakage where DM rows wouldn't push (groups and bots still did).
    /// Calling `navigator.push` with a concrete `ChatView`/`GroupChatView`
    /// value side-steps the type-erasure mismatch.
    private func openConversation(_ conv: Conversation) {
        if let gid = conv.groupID, conv.isGroup {
            let group = ChatGroup(
                groupID: gid,
                name: conv.name,
                avatarURL: conv.avatarURL,
                creatorID: "",
                memberCount: conv.memberCount ?? 0,
                lastMessage: conv.lastMessage,
                lastMessageTime: conv.lastMessageTime,
                lastMessageSender: conv.subtitle,
                unreadCount: conv.unreadCount
            )
            navigator.push(GroupChatView(group: group) {
                viewModel.markGroupAsRead(groupID: gid)
            })
        } else {
            let contact = Contact(
                userID: conv.id,
                nickname: conv.name,
                avatarURL: conv.avatarURL,
                lastMessage: conv.lastMessage,
                lastMessageTime: conv.lastMessageTime,
                unreadCount: conv.unreadCount
            )
            navigator.push(ChatView(contact: contact) {
                viewModel.markAsRead(conversationID: conv.id)
            })
        }
    }

    private var conversationListView: some View {
        List {
            ForEach(botStore.bots) { bot in
                Button {
                    navigator.push(BotChatView(botID: bot.id))
                } label: {
                    BotConversationRow(bot: bot)
                }
                .buttonStyle(.plain)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                .listRowBackground(Color.clear)
            }

            ForEach(viewModel.conversations) { conv in
                Button {
                    openConversation(conv)
                } label: {
                    ConversationRow(conversation: conv)
                }
                .buttonStyle(.plain)
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
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

// MARK: - Bot row in conversation list

struct BotConversationRow: View {
    let bot: BotConfig
    @ObservedObject private var store = BotStore.shared

    private var lastMessage: BotChatMessage? {
        store.lastMessage(for: bot.id)
    }

    var body: some View {
        HStack(spacing: 12) {
            BotAvatar(emoji: bot.emoji)
                .frame(width: 50, height: 50)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(bot.name)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)
                    Text("智能体")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(AppColors.accentLight)
                        .cornerRadius(4)
                }

                if let msg = lastMessage {
                    Text((msg.role == "user" ? "我: " : "") + msg.content)
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)
                } else {
                    Text(bot.persona)
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.tertiaryText)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
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
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}
