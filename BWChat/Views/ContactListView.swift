// BWChat/Views/ContactListView.swift
// Messages page - adaptive for all iPhone sizes

import SwiftUI

struct ContactListView: View {
    @StateObject private var viewModel = ContactsViewModel()
    @StateObject private var authManager = AuthManager.shared
    @State private var showLogoutAlert = false

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.contacts.isEmpty && !viewModel.isLoading {
                    emptyStateView
                } else {
                    contactListView
                }
            }
            .background(AppColors.secondaryBackground)
            .navigationTitle("消息")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showLogoutAlert = true
                    } label: {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(AppColors.secondaryText)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                }
            }
            .refreshable {
                await viewModel.loadContacts()
            }
            .alert("确定要退出登录吗？", isPresented: $showLogoutAlert) {
                Button("取消", role: .cancel) {}
                Button("退出", role: .destructive) {
                    Task { await viewModel.logout() }
                }
            }
        }
        .task {
            await viewModel.loadContacts()
        }
    }

    private var contactListView: some View {
        List {
            ForEach(viewModel.contacts) { contact in
                NavigationLink(value: contact) {
                    ContactRow(contact: contact)
                }
                .listRowSeparator(.hidden)
                .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.plain)
        .navigationDestination(for: Contact.self) { contact in
            ChatView(contact: contact) {
                viewModel.markAsRead(contactID: contact.userID)
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
            Text("添加好友后开始聊天")
                .font(.system(size: 14))
                .foregroundColor(AppColors.secondaryText)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Contact Row

struct ContactRow: View {
    let contact: Contact

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(url: contact.avatarURL, size: 50)

            VStack(alignment: .leading, spacing: 4) {
                Text(contact.nickname)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)

                if let lastMessage = contact.lastMessage {
                    Text(lastMessage)
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)
                } else {
                    Text("开始聊天吧~")
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.tertiaryText)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 6) {
                Text(contact.formattedTime)
                    .font(.system(size: 12))
                    .foregroundColor(AppColors.tertiaryText)

                if contact.unreadCount > 0 {
                    Text("\(min(contact.unreadCount, 99))\(contact.unreadCount > 99 ? "+" : "")")
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
