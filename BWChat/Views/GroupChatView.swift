// BWChat/Views/GroupChatView.swift
// Group chat conversation page

import SwiftUI
import PhotosUI

struct GroupChatView: View {
    let group: ChatGroup
    var onMarkRead: (() -> Void)?
    @StateObject private var viewModel: GroupChatViewModel
    @State private var selectedItem: PhotosPickerItem?
    @State private var previewImageURL: String?

    init(group: ChatGroup, onMarkRead: (() -> Void)? = nil) {
        self.group = group
        self.onMarkRead = onMarkRead
        _viewModel = StateObject(wrappedValue: GroupChatViewModel(group: group))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Messages - tap gesture only on scroll area
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 4) {
                        if viewModel.hasMore {
                            ProgressView()
                                .tint(AppColors.accent)
                                .padding()
                                .onAppear {
                                    Task { await viewModel.loadMoreMessages() }
                                }
                        }

                        ForEach(viewModel.messages) { message in
                            GroupMessageBubble(
                                message: message,
                                isFromMe: message.senderID == AuthManager.shared.currentUser?.userID,
                                onImageTap: { url in previewImageURL = url }
                            )
                            .id(message.id)
                        }

                        // Pending messages (optimistic)
                        ForEach(viewModel.pendingTexts) { pending in
                            PendingGroupBubble(pending: pending)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .contentShape(Rectangle())
                .onTapGesture { hideKeyboard() }
                .onChange(of: viewModel.messages.count) { _ in
                    if let last = viewModel.messages.last {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        if let last = viewModel.messages.last {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }

            // Input bar - outside tap gesture
            groupInputBar
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(group.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadMessages()
            onMarkRead?()
        }
        .fullScreenCover(item: Binding(
            get: { previewImageURL.map { ImagePreviewItem(url: $0) } },
            set: { previewImageURL = $0?.url }
        )) { item in
            ImagePreviewView(imageURL: item.url)
        }
    }

    // MARK: - Input Bar

    private var groupInputBar: some View {
        VStack(spacing: 0) {
            Divider().opacity(0.3)

            HStack(spacing: 10) {
                // Image picker
                PhotosPicker(selection: $selectedItem, matching: .images) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(AppColors.accent)
                        .frame(width: 40, height: 40)
                        .contentShape(Rectangle())
                }
                .onChange(of: selectedItem) { item in
                    guard let item = item else { return }
                    Task {
                        if let data = try? await item.loadTransferable(type: Data.self),
                           let uiImage = UIImage(data: data),
                           let jpegData = uiImage.jpegData(compressionQuality: 0.9) {
                            await viewModel.sendImage(data: jpegData)
                        }
                        selectedItem = nil
                    }
                }

                // Text input
                TextField("输入消息...", text: $viewModel.inputText)
                    .font(.system(size: 16))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 22)
                            .fill(AppColors.separator)
                    )
                    .onSubmit {
                        Task { await viewModel.sendText() }
                    }

                // Send button
                Button {
                    Task { await viewModel.sendText() }
                } label: {
                    ZStack {
                        Circle()
                            .fill(viewModel.isSendEnabled ? AppColors.accentGradient : LinearGradient(colors: [AppColors.separator, AppColors.separator], startPoint: .top, endPoint: .bottom))
                            .frame(width: 40, height: 40)
                        Image(systemName: "arrow.up")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(viewModel.isSendEnabled ? .white : AppColors.tertiaryText)
                    }
                    .contentShape(Circle())
                }
                .disabled(!viewModel.isSendEnabled)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(.ultraThinMaterial)
    }
}

// MARK: - Group Message Bubble

struct GroupMessageBubble: View {
    let message: GroupMessage
    let isFromMe: Bool
    var onImageTap: ((String) -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if isFromMe { Spacer(minLength: 40) }

            if !isFromMe {
                AvatarView(url: message.senderAvatar, size: 32)
            }

            VStack(alignment: isFromMe ? .trailing : .leading, spacing: 3) {
                if !isFromMe {
                    Text(message.senderNickname)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                }

                if message.isImage {
                    CachedAsyncImage(url: message.content)
                        .frame(maxWidth: 200, maxHeight: 250)
                        .cornerRadius(16)
                        .onTapGesture { onImageTap?(message.content) }
                } else {
                    Text(message.content)
                        .font(.system(size: 16))
                        .foregroundColor(isFromMe ? .white : AppColors.primaryText)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(
                            Group {
                                if isFromMe {
                                    AppColors.sentBubbleGradient
                                } else {
                                    LinearGradient(colors: [AppColors.receivedBubble], startPoint: .top, endPoint: .bottom)
                                }
                            }
                        )
                        .cornerRadius(18, corners: isFromMe ? [.topLeft, .topRight, .bottomLeft] : [.topLeft, .topRight, .bottomRight])
                }

                Text(message.formattedTime)
                    .font(.system(size: 10))
                    .foregroundColor(AppColors.tertiaryText)
                    .padding(.horizontal, 4)
            }

            if !isFromMe { Spacer(minLength: 40) }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Pending Group Bubble

struct PendingGroupBubble: View {
    let pending: PendingGroupText

    var body: some View {
        HStack {
            Spacer(minLength: 40)
            VStack(alignment: .trailing, spacing: 4) {
                Text(pending.content)
                    .font(.system(size: 16))
                    .foregroundColor(.white.opacity(pending.status == .sending ? 0.7 : 1))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(AppColors.sentBubbleGradient.opacity(pending.status == .sending ? 0.5 : 1))
                    .cornerRadius(18, corners: [.topLeft, .topRight, .bottomLeft])

                if pending.status == .sending {
                    ProgressView()
                        .tint(AppColors.accent)
                        .scaleEffect(0.6)
                } else if pending.status == .failed {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundColor(AppColors.errorColor)
                        .font(.caption)
                }
            }
        }
        .padding(.vertical, 2)
    }
}