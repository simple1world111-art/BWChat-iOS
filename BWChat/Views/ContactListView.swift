// BWChat/Views/ContactListView.swift
// Contact list page - minimalist design

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
            .navigationTitle("消息")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showLogoutAlert = true
                    } label: {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .foregroundColor(AppColors.secondaryText)
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
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }
        }
        .listStyle(.plain)
        .navigationDestination(for: Contact.self) { contact in
            ChatView(contact: contact)
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 48))
                .foregroundColor(AppColors.secondaryText.opacity(0.5))
            Text("暂无聊天记录")
                .font(.body)
                .foregroundColor(AppColors.secondaryText)
            Text("开始和朋友聊天吧")
                .font(.body)
                .foregroundColor(AppColors.secondaryText.opacity(0.7))
            Spacer()
        }
    }
}

// MARK: - Contact Row

struct ContactRow: View {
    let contact: Contact

    var body: some View {
        HStack(spacing: 12) {
            // Avatar
            AvatarView(url: contact.avatarURL, size: 44)

            // Name and message preview
            VStack(alignment: .leading, spacing: 4) {
                Text(contact.nickname)
                    .font(.body.weight(.medium))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)

                if let lastMessage = contact.lastMessage {
                    Text(lastMessage)
                        .font(.subheadline)
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(1)
                }
            }

            Spacer()

            // Time and unread
            VStack(alignment: .trailing, spacing: 6) {
                Text(contact.formattedTime)
                    .font(.caption)
                    .foregroundColor(AppColors.secondaryText)

                if contact.unreadCount > 0 {
                    Circle()
                        .fill(AppColors.unreadDot)
                        .frame(width: 8, height: 8)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
