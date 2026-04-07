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
    @State private var scrollAnchor: Int = 0

    init(contact: Contact, onMarkRead: (() -> Void)? = nil) {
        self.contact = contact
        self.onMarkRead = onMarkRead
        _viewModel = StateObject(wrappedValue: ChatViewModel(contact: contact))
    }

    private func setActiveChat(_ active: Bool) {
        WebSocketService.shared.activeChatUserID = active ? contact.userID : nil
    }

    var body: some View {
        VStack(spacing: 0) {
            // Messages list
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
                            MessageBubble(
                                message: message,
                                isFromMe: message.senderID == AuthManager.shared.currentUser?.userID,
                                onImageTap: { url in previewImageURL = url },
                                onVideoTap: { url in previewVideoURL = url },
                                onReply: { msg in viewModel.setReply(to: msg) }
                            )
                            .id(message.id)
                        }

                        ForEach(viewModel.pendingMessages) { pending in
                            PendingMessageBubble(pending: pending)
                        }

                        Color.clear
                            .frame(height: 1)
                            .id("chatBottom")
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .contentShape(Rectangle())
                .onTapGesture { hideKeyboard() }
                .onChange(of: viewModel.messages.last?.id) { _ in
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo("chatBottom", anchor: .bottom)
                    }
                }
                .onChange(of: viewModel.pendingMessages.count) { _ in
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo("chatBottom", anchor: .bottom)
                    }
                }
                .onChange(of: scrollAnchor) { _ in
                    proxy.scrollTo("chatBottom", anchor: .bottom)
                }
                .task {
                    await viewModel.loadMessages()
                    onMarkRead?()
                    scrollAnchor += 1
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    guard !Task.isCancelled else { return }
                    scrollAnchor += 1
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
                HStack(spacing: 4) {
                    Button {
                        CallManager.shared.startCall(
                            to: contact.userID,
                            nickname: contact.nickname,
                            avatarURL: contact.avatarURL,
                        type: .voice
                    )
                    } label: {
                        Image(systemName: "phone.fill")
                            .font(.system(size: 15))
                            .foregroundColor(AppColors.accent)
                    }
                    Button {
                        CallManager.shared.startCall(
                            to: contact.userID,
                            nickname: contact.nickname,
                            avatarURL: contact.avatarURL,
                            type: .video
                        )
                    } label: {
                        Image(systemName: "video.fill")
                            .font(.system(size: 15))
                            .foregroundColor(AppColors.accent)
                    }
                }
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
            .padding(.bottom, safeAreaBottomPadding)
        }
        .background(AppColors.secondaryBackground)
    }

    private var safeAreaBottomPadding: CGFloat {
        let scenes = UIApplication.shared.connectedScenes
        let windowScene = scenes.first as? UIWindowScene
        return windowScene?.windows.first?.safeAreaInsets.bottom ?? 0 > 0 ? 0 : 0
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
