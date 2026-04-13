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
    @State private var previewVideoURL: String?
    @State private var highlightedMessageID: Int?
    @State private var showPlusMenu = false

    private var isSelfChat: Bool {
        contact.userID == AuthManager.shared.currentUser?.userID
    }

    private var myAvatarURL: String {
        AuthManager.shared.currentUser?.avatarURL ?? ""
    }

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

    private func previousTimestamp(for message: Message) -> String? {
        guard let idx = viewModel.messages.firstIndex(where: { $0.id == message.id }),
              idx > 0 else { return nil }
        return viewModel.messages[idx - 1].timestamp
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(viewModel.pendingMessages.reversed()) { pending in
                            PendingMessageBubble(pending: pending, avatarURL: myAvatarURL) {
                                Task { await viewModel.retryPending(pending) }
                            }
                            .flippedRow()
                        }

                        ForEach(viewModel.messages.reversed()) { message in
                            let isFromMe = message.senderID == AuthManager.shared.currentUser?.userID
                            VStack(spacing: 4) {
                                MessageBubble(
                                    message: message,
                                    isFromMe: isFromMe,
                                    avatarURL: isFromMe ? myAvatarURL : contact.avatarURL,
                                    onImageTap: { url in
                                        let allImages = viewModel.messages.filter(\.isImage).map(\.content)
                                        ImageGalleryState.shared.show(urls: allImages, index: allImages.firstIndex(of: url) ?? 0)
                                    },
                                    onVideoTap: { url in previewVideoURL = url },
                                    onReply: { msg in viewModel.setReply(to: msg) },
                                    onQuoteTap: { targetID in
                                        scrollToMessage(targetID, proxy: proxy)
                                    }
                                )

                                if TimestampHelper.shouldShowTime(
                                    current: message.timestamp,
                                    previous: previousTimestamp(for: message)
                                ) {
                                    TimeSeparatorView(timestamp: message.timestamp)
                                }
                            }
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

            if let replyMsg = viewModel.replyingTo {
                let senderName = replyMsg.senderID == AuthManager.shared.currentUser?.userID ? "我" : contact.nickname
                ReplyPreviewBar(
                    senderName: senderName,
                    content: replyMsg.content,
                    msgType: replyMsg.msgType,
                    onCancel: { viewModel.cancelReply() }
                )
            }

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
            get: { previewVideoURL.map { VideoPreviewItem(url: $0) } },
            set: { previewVideoURL = $0?.url }
        )) { item in
            VideoPlayerView(videoURL: item.url)
        }
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        VStack(spacing: 0) {
            Divider().opacity(0.3)

            HStack(spacing: 10) {
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

                if viewModel.isSendEnabled {
                    Button {
                        Task { await viewModel.sendText() }
                    } label: {
                        ZStack {
                            Circle()
                                .fill(AppColors.accentGradient)
                                .frame(width: 40, height: 40)
                            Image(systemName: "arrow.up")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundColor(.white)
                        }
                        .contentShape(Circle())
                    }
                } else {
                    Button { withAnimation(.easeInOut(duration: 0.2)) { showPlusMenu.toggle() } } label: {
                        Image(systemName: showPlusMenu ? "xmark.circle.fill" : "plus.circle.fill")
                            .font(.system(size: 28))
                            .foregroundColor(AppColors.accent)
                            .frame(width: 40, height: 40)
                            .contentShape(Rectangle())
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

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
                let captured = items
                selectedMediaItems = []
                Task {
                    for (index, item) in captured.enumerated() {
                        if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
                            if let movie = try? await item.loadTransferable(type: VideoTransferable.self) {
                                let data = try? Data(contentsOf: movie.url)
                                let ext = movie.url.pathExtension.lowercased()
                                try? FileManager.default.removeItem(at: movie.url)
                                if let data = data {
                                    await viewModel.sendVideo(data: data, filename: "video_\(Int(Date().timeIntervalSince1970))_\(index).\(ext.isEmpty ? "mp4" : ext)")
                                }
                            }
                        } else if item.supportedContentTypes.contains(where: { $0.conforms(to: .image) }) {
                            if let data = try? await item.loadTransferable(type: Data.self),
                               let uiImage = UIImage(data: data),
                               let jpegData = uiImage.jpegData(compressionQuality: 0.9) {
                                await viewModel.sendImage(data: jpegData)
                            }
                        }
                    }
                }
            }

            if !isSelfChat {
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
        }
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

// MARK: - Pending Message Bubble

struct PendingMessageBubble: View {
    let pending: PendingMessage
    var avatarURL: String = ""
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Spacer()
            HStack(alignment: .center, spacing: 6) {
                if pending.status == .failed {
                    Button {
                        onRetry?()
                    } label: {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(.red)
                            .font(.system(size: 20))
                    }
                }

                if pending.msgType == "text" && !pending.content.isEmpty {
                    Text(pending.content)
                        .font(.system(size: 16))
                        .foregroundColor(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(AppColors.accentGradient)
                        .cornerRadius(18)
                } else if let imageData = pending.imageData, let uiImage = UIImage(data: imageData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 200)
                        .cornerRadius(14)
                } else if pending.videoData != nil {
                    ZStack {
                        RoundedRectangle(cornerRadius: 14)
                            .fill(Color.blue.opacity(0.1))
                            .frame(width: 200, height: 140)

                        Image(systemName: "video.fill")
                            .font(.system(size: 32))
                            .foregroundColor(AppColors.secondaryText)
                    }
                }
            }

            AvatarView(url: avatarURL, size: 36)
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
