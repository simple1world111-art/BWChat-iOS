// BWChat/Views/GroupChatView.swift
// Group chat conversation page

import SwiftUI
import PhotosUI

struct GroupChatView: View {
    let group: ChatGroup
    @StateObject private var viewModel: GroupChatViewModel
    @State private var selectedItem: PhotosPickerItem?
    @State private var previewImageURL: String?

    init(group: ChatGroup) {
        self.group = group
        _viewModel = StateObject(wrappedValue: GroupChatViewModel(group: group))
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 4) {
                        if viewModel.hasMore {
                            ProgressView()
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
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .onChange(of: viewModel.messages.count) { _ in
                    if let last = viewModel.messages.last {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
                .onAppear {
                    if let last = viewModel.messages.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }

            // Input bar
            groupInputBar
        }
        .navigationTitle(group.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await viewModel.loadMessages()
        }
        .fullScreenCover(item: Binding(
            get: { previewImageURL.map { ImagePreviewItem(url: $0) } },
            set: { previewImageURL = $0?.url }
        )) { item in
            ImagePreviewView(imageURL: item.url)
        }
        .onTapGesture { hideKeyboard() }
    }

    private var groupInputBar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 8) {
                PhotosPicker(selection: $selectedItem, matching: .images) {
                    Image(systemName: "photo")
                        .font(.system(size: 20))
                        .foregroundColor(AppColors.secondaryText)
                        .frame(width: 36, height: 36)
                }
                .onChange(of: selectedItem) { item in
                    guard let item = item else { return }
                    Task {
                        if let data = try? await item.loadTransferable(type: Data.self) {
                            await viewModel.sendImage(data: data)
                        }
                        selectedItem = nil
                    }
                }

                TextField("输入消息...", text: $viewModel.inputText)
                    .font(.system(size: 16))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(AppColors.receivedBubble)
                    .cornerRadius(20)
                    .onSubmit {
                        Task { await viewModel.sendText() }
                    }

                Button {
                    Task { await viewModel.sendText() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(viewModel.isSendEnabled ? AppColors.accentGradient : LinearGradient(colors: [AppColors.tertiaryText], startPoint: .top, endPoint: .bottom))
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
            if isFromMe { Spacer(minLength: 50) }

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
                        .foregroundColor(isFromMe ? AppColors.sentBubbleText : AppColors.receivedBubbleText)
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
                        .cornerRadius(18)
                }

                Text(message.formattedTime)
                    .font(.system(size: 10))
                    .foregroundColor(AppColors.tertiaryText)
                    .padding(.horizontal, 4)
            }

            if !isFromMe { Spacer(minLength: 50) }
        }
        .padding(.vertical, 2)
    }
}
