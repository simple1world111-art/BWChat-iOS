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
    @State private var showImagePicker = false
    @State private var selectedItem: PhotosPickerItem?
    @State private var selectedVideoItem: PhotosPickerItem?
    @State private var previewImageURL: String?
    @State private var previewVideoURL: String?

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
                        // Flipped scroll view: content order is reversed so newest is at visual bottom
                        Color.clear
                            .frame(height: 1)
                            .id("chatBottom")

                        ForEach(viewModel.pendingMessages.reversed()) { pending in
                            PendingMessageBubble(pending: pending)
                                .scaleEffect(x: 1, y: -1)
                        }

                        ForEach(viewModel.messages.reversed()) { message in
                            MessageBubble(
                                message: message,
                                isFromMe: message.senderID == AuthManager.shared.currentUser?.userID,
                                onImageTap: { url in
                                    previewImageURL = url
                                },
                                onVideoTap: { url in
                                    previewVideoURL = url
                                }
                            )
                            .scaleEffect(x: 1, y: -1)
                            .id(message.id)
                        }

                        if viewModel.hasMore {
                            ProgressView()
                                .tint(AppColors.accent)
                                .padding()
                                .scaleEffect(x: 1, y: -1)
                                .onAppear {
                                    Task { await viewModel.loadMoreMessages() }
                                }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                }
                .scaleEffect(x: 1, y: -1)
                .scrollIndicators(.hidden)
                .contentShape(Rectangle())
                .onTapGesture { hideKeyboard() }
                .onChange(of: viewModel.messages.last?.id) { _ in
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo("chatBottom")
                    }
                }
                .onChange(of: viewModel.pendingMessages.count) { _ in
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo("chatBottom")
                    }
                }
                .task {
                    await viewModel.loadMessages()
                    onMarkRead?()
                }
            }

            // Input Bar - outside tap gesture so buttons work
            inputBar
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(contact.nickname)
        .navigationBarTitleDisplayMode(.inline)
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
    }

    // MARK: - Input Bar

    private var inputBar: some View {
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
                            print("[Chat] Video pick failed: \(error)")
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
