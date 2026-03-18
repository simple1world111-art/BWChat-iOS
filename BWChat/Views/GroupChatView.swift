// BWChat/Views/GroupChatView.swift
// Group chat conversation page

import SwiftUI
import PhotosUI
import AVKit

struct GroupChatView: View {
    let group: ChatGroup
    var onMarkRead: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: GroupChatViewModel
    @State private var selectedItem: PhotosPickerItem?
    @State private var selectedVideoItem: PhotosPickerItem?
    @State private var previewImageURL: String?
    @State private var previewVideoURL: String?
    @State private var showAddMembers = false
    @State private var showGroupDetail = false
    @State private var memberCount: Int = 0
    @State private var shouldPopToRoot = false
    @State private var hasInitiallyScrolled = false

    init(group: ChatGroup, onMarkRead: (() -> Void)? = nil) {
        self.group = group
        self.onMarkRead = onMarkRead
        _viewModel = StateObject(wrappedValue: GroupChatViewModel(group: group))
    }

    private func setActiveGroupChat(_ active: Bool) {
        WebSocketService.shared.activeGroupID = active ? group.id : nil
    }

    var body: some View {
        VStack(spacing: 0) {
            // Messages - flipped ScrollView for reliable bottom-first display
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 4) {
                        // Pending messages (content top = visual bottom after flip)
                        ForEach(viewModel.pendingTexts.reversed()) { pending in
                            PendingGroupBubble(pending: pending)
                                .scaleEffect(x: 1, y: -1, anchor: .center)
                        }

                        // Messages newest-first (visual: newest at bottom after flip)
                        ForEach(viewModel.messages.reversed()) { message in
                            GroupMessageBubble(
                                message: message,
                                isFromMe: message.senderID == AuthManager.shared.currentUser?.userID,
                                onImageTap: { url in previewImageURL = url },
                                onVideoTap: { url in previewVideoURL = url }
                            )
                            .id(message.id)
                            .scaleEffect(x: 1, y: -1, anchor: .center)
                        }

                        // Load more (content bottom = visual top after flip)
                        if viewModel.hasMore {
                            ProgressView()
                                .tint(AppColors.accent)
                                .padding()
                                .scaleEffect(x: 1, y: -1, anchor: .center)
                                .onAppear {
                                    Task { await viewModel.loadMoreMessages() }
                                }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .scaleEffect(x: 1, y: -1, anchor: .center)
                .scrollIndicators(.hidden)
                .contentShape(Rectangle())
                .onTapGesture { hideKeyboard() }
                .onChange(of: viewModel.messages.last?.id) { _ in
                    guard let newest = viewModel.messages.last else { return }
                    if !hasInitiallyScrolled {
                        proxy.scrollTo(newest.id, anchor: .top)
                        hasInitiallyScrolled = true
                    } else {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(newest.id, anchor: .top)
                        }
                    }
                }
            }

            // Input bar - outside tap gesture
            groupInputBar
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(memberCount > 0 ? "\(group.name) (\(memberCount))" : group.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    showGroupDetail = true
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(AppColors.accent)
                }
            }
        }
        .sheet(isPresented: $showAddMembers) {
            AddGroupMembersView(groupID: group.groupID)
        }
        .navigationDestination(isPresented: $showGroupDetail) {
            GroupDetailView(groupID: group.groupID) {
                shouldPopToRoot = true
            }
        }
        .onAppear { setActiveGroupChat(true) }
        .onDisappear { setActiveGroupChat(false) }
        .task {
            await viewModel.loadMessages()
            // Load member count for title
            if let detail = try? await APIService.shared.getGroupDetail(groupID: group.groupID) {
                memberCount = detail.members.count
            }
            onMarkRead?()
        }
        .onReceive(WebSocketService.shared.groupRemovedPublisher) { removedID in
            if removedID == group.groupID {
                shouldPopToRoot = true
            }
        }
        .onChange(of: shouldPopToRoot) { pop in
            if pop {
                dismiss()
            }
        }
        .fullScreenCover(item: Binding(
            get: { previewImageURL.map { ImagePreviewItem(url: $0) } },
            set: { previewImageURL = $0?.url }
        )) { item in
            ImagePreviewView(imageURL: item.url)
        }
        .fullScreenCover(item: Binding(
            get: { previewVideoURL.map { VideoPreviewItem(url: $0) } },
            set: { previewVideoURL = $0?.url }
        )) { item in
            VideoPlayerView(videoURL: item.url)
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
                        .frame(width: 36, height: 40)
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

                // Video picker
                PhotosPicker(selection: $selectedVideoItem, matching: .videos) {
                    Image(systemName: "video.fill")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundColor(AppColors.accent)
                        .frame(width: 36, height: 40)
                        .contentShape(Rectangle())
                }
                .onChange(of: selectedVideoItem) { item in
                    guard let item = item else { return }
                    Task {
                        do {
                            if let movie = try await item.loadTransferable(type: VideoTransferable.self) {
                                let data = try Data(contentsOf: movie.url)
                                let ext = movie.url.pathExtension.lowercased()
                                let filename = "video_\(Int(Date().timeIntervalSince1970)).\(ext.isEmpty ? "mp4" : ext)"
                                await viewModel.sendVideo(data: data, filename: filename)
                                try? FileManager.default.removeItem(at: movie.url)
                            }
                        } catch {
                            print("[GroupChat] Video pick failed: \(error)")
                            viewModel.errorMessage = "视频读取失败"
                        }
                        selectedVideoItem = nil
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
    var onVideoTap: ((String) -> Void)?

    var body: some View {
        if message.isSystem {
            HStack {
                Spacer()
                Text(message.content)
                    .font(.system(size: 12))
                    .foregroundColor(AppColors.secondaryText)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(AppColors.separator.opacity(0.5))
                    .cornerRadius(10)
                Spacer()
            }
            .padding(.vertical, 4)
        } else {
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
                } else if message.isVideo {
                    ZStack {
                        VideoThumbnailView(videoURL: message.content)
                            .frame(maxWidth: 200, maxHeight: 250)
                            .cornerRadius(16)

                        Image(systemName: "play.circle.fill")
                            .font(.system(size: 44))
                            .foregroundColor(.white)
                            .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 2)
                    }
                    .cornerRadius(16)
                    .onTapGesture { onVideoTap?(message.content) }
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
                        .contextMenu {
                            Button {
                                UIPasteboard.general.string = message.content
                            } label: {
                                Label("复制", systemImage: "doc.on.doc")
                            }
                        }
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