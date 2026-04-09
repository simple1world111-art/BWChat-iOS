// BWChat/Views/ChatView.swift
// Premium chat conversation page

import SwiftUI
import PhotosUI
import AVKit
import UniformTypeIdentifiers

struct ChatView: View {
    let contact: Contact
    var onMarkRead: (() -> Void)?
    @StateObject private var viewModel: ChatViewModel
    @State private var selectedMediaItems: [PhotosPickerItem] = []
    @State private var preparedMedia: [PreparedMediaItem] = []
    @State private var showMediaPreview = false
    @State private var isLoadingMedia = false
    @State private var previewImageURL: String?
    @State private var previewVideoURL: String?
    @State private var highlightedMessageID: Int?
    @State private var showPlusMenu = false

    init(contact: Contact, onMarkRead: (() -> Void)? = nil) {
        self.contact = contact
        self.onMarkRead = onMarkRead
        _viewModel = StateObject(wrappedValue: ChatViewModel(contact: contact))
    }

    private func setActiveChat(_ active: Bool) {
        WebSocketService.shared.activeChatUserID = active ? contact.userID : nil
    }

    private func scrollToMessage(_ messageID: Int, proxy: ScrollViewProxy) {
        withAnimation(.easeInOut(duration: 0.3)) {
            proxy.scrollTo(messageID, anchor: .center)
        }
        highlightedMessageID = messageID
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            withAnimation(.easeOut(duration: 0.5)) {
                if highlightedMessageID == messageID {
                    highlightedMessageID = nil
                }
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Messages list
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(viewModel.pendingMessages.reversed()) { pending in
                            PendingMessageBubble(pending: pending)
                                .flippedRow()
                        }

                        ForEach(viewModel.messages.reversed()) { message in
                            MessageBubble(
                                message: message,
                                isFromMe: message.senderID == AuthManager.shared.currentUser?.userID,
                                onImageTap: { url in previewImageURL = url },
                                onVideoTap: { url in previewVideoURL = url },
                                onReply: { msg in viewModel.setReply(to: msg) },
                                onQuoteTap: { targetID in
                                    scrollToMessage(targetID, proxy: proxy)
                                }
                            )
                            .id(message.id)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(highlightedMessageID == message.id ? AppColors.accent.opacity(0.15) : Color.clear)
                            )
                            .flippedRow()
                        }

                        if viewModel.hasMore {
                            ProgressView()
                                .tint(AppColors.accent)
                                .padding()
                                .flippedRow()
                                .onAppear {
                                    Task { await viewModel.loadMoreMessages() }
                                }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .rotationEffect(.degrees(180))
                .scaleEffect(x: -1, y: 1, anchor: .center)
                .scrollIndicators(.hidden)
                .contentShape(Rectangle())
                .onTapGesture { hideKeyboard() }
                .task {
                    await viewModel.loadMessages()
                    onMarkRead?()
                }
            }

            // Reply preview bar
            if let replyMsg = viewModel.replyingTo {
                let senderName = replyMsg.senderID == AuthManager.shared.currentUser?.userID ? "我" : contact.nickname
                ReplyPreviewBar(
                    senderName: senderName,
                    content: replyMsg.content,
                    msgType: replyMsg.msgType,
                    onCancel: { viewModel.cancelReply() }
                )
            }

            // Input Bar
            inputBar
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(contact.nickname)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                EmptyView()
            }
        }
        .onAppear { setActiveChat(true) }
        .onDisappear { setActiveChat(false) }
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

    private var inputBar: some View {
        VStack(spacing: 0) {
            Divider().opacity(0.3)

            HStack(spacing: 10) {
                // "+" button - opens action menu
                Button { showPlusMenu.toggle() } label: {
                    Image(systemName: showPlusMenu ? "xmark.circle.fill" : "plus.circle.fill")
                        .font(.system(size: 24))
                        .foregroundColor(AppColors.accent)
                        .frame(width: 36, height: 40)
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

            // Expandable action menu
            if showPlusMenu {
                chatPlusMenu
            }
        }
        .background(AppColors.secondaryBackground)
    }

    private var chatPlusMenu: some View {
        HStack(spacing: 24) {
            PhotosPicker(selection: $selectedMediaItems, maxSelectionCount: 9, matching: .any(of: [.images, .videos])) {
                VStack(spacing: 6) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(AppColors.separator)
                            .frame(width: 56, height: 56)
                        Image(systemName: "photo")
                            .font(.system(size: 22))
                            .foregroundColor(AppColors.primaryText)
                    }
                    Text("相册")
                        .font(.system(size: 11))
                        .foregroundColor(AppColors.secondaryText)
                }
            }
            .onChange(of: selectedMediaItems) { items in
                guard !items.isEmpty else { return }
                showPlusMenu = false
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
                                    prepared.append(PreparedMediaItem(type: .video, data: data, thumbnail: thumbnail, filename: "video_\(Int(Date().timeIntervalSince1970))_\(index).\(ext.isEmpty ? "mp4" : ext)"))
                                }
                            }
                        } else if item.supportedContentTypes.contains(where: { $0.conforms(to: .image) }) {
                            if let data = try? await item.loadTransferable(type: Data.self),
                               let uiImage = UIImage(data: data),
                               let jpegData = uiImage.jpegData(compressionQuality: 0.9) {
                                prepared.append(PreparedMediaItem(type: .image, data: jpegData, thumbnail: uiImage, filename: "image_\(Int(Date().timeIntervalSince1970))_\(index).jpg"))
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

            Button {
                showPlusMenu = false
                CallManager.shared.startCall(to: contact.userID, nickname: contact.nickname, avatarURL: contact.avatarURL, type: .voice)
            } label: {
                VStack(spacing: 6) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12).fill(AppColors.separator).frame(width: 56, height: 56)
                        Image(systemName: "phone.fill").font(.system(size: 22)).foregroundColor(AppColors.primaryText)
                    }
                    Text("语音通话").font(.system(size: 11)).foregroundColor(AppColors.secondaryText)
                }
            }

            Button {
                showPlusMenu = false
                CallManager.shared.startCall(to: contact.userID, nickname: contact.nickname, avatarURL: contact.avatarURL, type: .video)
            } label: {
                VStack(spacing: 6) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12).fill(AppColors.separator).frame(width: 56, height: 56)
                        Image(systemName: "video.fill").font(.system(size: 22)).foregroundColor(AppColors.primaryText)
                    }
                    Text("视频通话").font(.system(size: 11)).foregroundColor(AppColors.secondaryText)
                }
            }
        }
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

// MARK: - Pending Message Bubble

struct PendingMessageBubble: View {
    let pending: PendingMessage

    var body: some View {
        HStack {
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                if let imageData = pending.imageData, let uiImage = UIImage(data: imageData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 200)
                        .cornerRadius(14)
                        .opacity(pending.status == .sending ? 0.6 : 1)
                } else if pending.videoData != nil {
                    ZStack {
                        RoundedRectangle(cornerRadius: 14)
                            .fill(Color.blue.opacity(0.1))
                            .frame(width: 200, height: 140)
                            .opacity(pending.status == .sending ? 0.6 : 1)

                        VStack(spacing: 6) {
                            Image(systemName: "video.fill")
                                .font(.system(size: 32))
                                .foregroundColor(AppColors.secondaryText)
                            Text("发送中...")
                                .font(.system(size: 12))
                                .foregroundColor(AppColors.secondaryText)
                        }
                    }
                }

                if pending.status == .sending {
                    ProgressView()
                        .tint(AppColors.accent)
                        .scaleEffect(0.7)
                } else if pending.status == .failed {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundColor(AppColors.errorColor)
                        .font(.caption)
                }
            }
        }
    }
}

// Helper for fullScreenCover binding
struct ImagePreviewItem: Identifiable {
    let id = UUID()
    let url: String
}

struct VideoPreviewItem: Identifiable {
    let id = UUID()
    let url: String
}

// Transferable for picking videos from PhotosPicker
struct VideoTransferable: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let tempDir = FileManager.default.temporaryDirectory
            let filename = "video_\(UUID().uuidString).\(received.file.pathExtension)"
            let copy = tempDir.appendingPathComponent(filename)
            if FileManager.default.fileExists(atPath: copy.path) {
                try FileManager.default.removeItem(at: copy)
            }
            try FileManager.default.copyItem(at: received.file, to: copy)
            return Self(url: copy)
        }
    }
}
