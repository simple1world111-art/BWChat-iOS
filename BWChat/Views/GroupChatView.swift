// BWChat/Views/GroupChatView.swift
// Group chat conversation page

import SwiftUI
import PhotosUI
import AVKit
import UniformTypeIdentifiers

struct GroupChatView: View {
    let group: ChatGroup
    var onMarkRead: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: GroupChatViewModel
    @State private var selectedMediaItems: [PhotosPickerItem] = []
    @State private var preparedMedia: [PreparedMediaItem] = []
    @State private var showMediaPreview = false
    @State private var isLoadingMedia = false
    @State private var previewImageURL: String?
    @State private var previewVideoURL: String?
    @State private var showAddMembers = false
    @State private var showGroupDetail = false
    @State private var memberCount: Int = 0
    @State private var shouldPopToRoot = false
    @State private var scrollAnchor: Int = 0

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
            // Messages
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
                                onImageTap: { url in previewImageURL = url },
                                onVideoTap: { url in previewVideoURL = url },
                                onReply: { msg in viewModel.setReply(to: msg) }
                            )
                            .id(message.id)
                        }

                        ForEach(viewModel.pendingTexts) { pending in
                            PendingGroupBubble(pending: pending)
                        }

                        Color.clear
                            .frame(height: 1)
                            .id("groupBottom")
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .contentShape(Rectangle())
                .onTapGesture { hideKeyboard() }
                .onChange(of: viewModel.messages.last?.id) { _ in
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo("groupBottom", anchor: .bottom)
                    }
                }
                .onChange(of: viewModel.pendingTexts.count) { _ in
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo("groupBottom", anchor: .bottom)
                    }
                }
                .onChange(of: scrollAnchor) { _ in
                    proxy.scrollTo("groupBottom", anchor: .bottom)
                }
                .task {
                    await viewModel.loadMessages()
                    if let detail = try? await APIService.shared.getGroupDetail(groupID: group.groupID) {
                        memberCount = detail.members.count
                    }
                    onMarkRead?()
                    scrollAnchor += 1
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    guard !Task.isCancelled else { return }
                    scrollAnchor += 1
                }
            }

            // Reply preview bar
            if let replyMsg = viewModel.replyingTo {
                ReplyPreviewBar(
                    senderName: replyMsg.senderNickname,
                    content: replyMsg.content,
                    msgType: replyMsg.msgType,
                    onCancel: { viewModel.cancelReply() }
                )
            }

            // Input bar
            groupInputBar
        }
        .sheet(isPresented: $viewModel.showMentionPicker) {
            MentionPickerView(groupID: group.groupID) { userID, nickname in
                viewModel.addMention(userID: userID, nickname: nickname)
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(memberCount > 0 ? "\(group.name) (\(memberCount))" : group.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 8) {
                    Button {
                        CallManager.shared.startGroupCall(groupID: group.groupID, groupName: group.name, type: .voice)
                    } label: {
                        Image(systemName: "phone.fill")
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.accent)
                    }
                    Button {
                        CallManager.shared.startGroupCall(groupID: group.groupID, groupName: group.name, type: .video)
                    } label: {
                        Image(systemName: "video.fill")
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.accent)
                    }
                    Button {
                        showGroupDetail = true
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(AppColors.accent)
                    }
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
        .sheet(isPresented: $showMediaPreview) {
            MediaPickerPreview(mediaItems: $preparedMedia) { items in
                Task {
                    for item in items {
                        switch item.type {
                        case .image:
                            await viewModel.sendImage(data: item.data)
                        case .video:
                            await viewModel.sendVideo(data: item.data, filename: item.filename)
                        }
                    }
                }
            }
        }
        .overlay {
            if isLoadingMedia {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()
                    .overlay {
                        ProgressView("加载中...")
                            .tint(.white)
                            .foregroundColor(.white)
                            .padding(20)
                            .background(Color.black.opacity(0.7))
                            .cornerRadius(12)
                    }
            }
        }
    }

    // MARK: - Input Bar

    private var groupInputBar: some View {
        VStack(spacing: 0) {
            Divider().opacity(0.3)

            HStack(spacing: 10) {
                // Media picker (images + videos, multi-select)
                PhotosPicker(selection: $selectedMediaItems, maxSelectionCount: 9, matching: .any(of: [.images, .videos])) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundColor(AppColors.accent)
                        .frame(width: 36, height: 40)
                        .contentShape(Rectangle())
                }
                .onChange(of: selectedMediaItems) { items in
                    guard !items.isEmpty else { return }
                    isLoadingMedia = true
                    Task {
                        var prepared: [PreparedMediaItem] = []
                        for (index, item) in items.enumerated() {
                            if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
                                if let movie = try? await item.loadTransferable(type: VideoTransferable.self) {
                                    let thumbnail = generateVideoThumbnail(from: movie.url)
                                    let data = try? Data(contentsOf: movie.url)
                                    let ext = movie.url.pathExtension.lowercased()
                                    try? FileManager.default.removeItem(at: movie.url)
                                    if let data = data {
                                        prepared.append(PreparedMediaItem(
                                            type: .video,
                                            data: data,
                                            thumbnail: thumbnail,
                                            filename: "video_\(Int(Date().timeIntervalSince1970))_\(index).\(ext.isEmpty ? "mp4" : ext)"
                                        ))
                                    }
                                }
                            } else if item.supportedContentTypes.contains(where: { $0.conforms(to: .image) }) {
                                if let data = try? await item.loadTransferable(type: Data.self),
                                   let uiImage = UIImage(data: data),
                                   let jpegData = uiImage.jpegData(compressionQuality: 0.9) {
                                    prepared.append(PreparedMediaItem(
                                        type: .image,
                                        data: jpegData,
                                        thumbnail: uiImage,
                                        filename: "image_\(Int(Date().timeIntervalSince1970))_\(index).jpg"
                                    ))
                                }
                            }
                        }
                        selectedMediaItems = []
                        isLoadingMedia = false
                        if !prepared.isEmpty {
                            preparedMedia = prepared
                            showMediaPreview = true
                        }
                    }
                }

                // @ mention
                Button {
                    viewModel.showMentionPicker = true
                } label: {
                    Text("@")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundColor(AppColors.accent)
                        .frame(width: 30, height: 40)
                        .contentShape(Rectangle())
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
        .background(AppColors.secondaryBackground)
    }
}

// MARK: - Group Message Bubble

struct GroupMessageBubble: View {
    let message: GroupMessage
    let isFromMe: Bool
    var onImageTap: ((String) -> Void)?
    var onVideoTap: ((String) -> Void)?
    var onReply: ((GroupMessage) -> Void)?

    @State private var swipeOffset: CGFloat = 0

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

                // Quoted message
                if let reply = message.replyTo {
                    QuotedMessageView(
                        senderName: reply.senderID == AuthManager.shared.currentUser?.userID ? "我" : (UserCacheManager.shared.getUser(reply.senderID)?.nickname ?? reply.senderID),
                        content: reply.content,
                        msgType: reply.msgType,
                        isFromMe: isFromMe
                    )
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
                            Button {
                                onReply?(message)
                            } label: {
                                Label("回复", systemImage: "arrowshape.turn.up.left")
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
        .offset(x: swipeOffset)
        .gesture(
            DragGesture(minimumDistance: 30)
                .onChanged { value in
                    let h = value.translation.width
                    if (isFromMe && h < 0) || (!isFromMe && h > 0) {
                        swipeOffset = h * 0.4
                    }
                }
                .onEnded { value in
                    if abs(value.translation.width) > 50 {
                        onReply?(message)
                    }
                    withAnimation(.spring(response: 0.3)) { swipeOffset = 0 }
                }
        )
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