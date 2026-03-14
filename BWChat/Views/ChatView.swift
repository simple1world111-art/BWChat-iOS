// BWChat/Views/ChatView.swift
// Premium chat conversation page

import SwiftUI
import PhotosUI

struct ChatView: View {
    let contact: Contact
    var onMarkRead: (() -> Void)?
    @StateObject private var viewModel: ChatViewModel
    @State private var showImagePicker = false
    @State private var selectedItem: PhotosPickerItem?
    @State private var previewImageURL: String?

    init(contact: Contact, onMarkRead: (() -> Void)? = nil) {
        self.contact = contact
        self.onMarkRead = onMarkRead
        _viewModel = StateObject(wrappedValue: ChatViewModel(contact: contact))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Messages list - tap to dismiss keyboard only on scroll area
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
                                onImageTap: { url in
                                    previewImageURL = url
                                }
                            )
                            .id(message.id)
                        }

                        ForEach(viewModel.pendingMessages) { pending in
                            PendingMessageBubble(pending: pending)
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

            // Input Bar - outside tap gesture so buttons work
            inputBar
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(contact.nickname)
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

    private var inputBar: some View {
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
            .padding(.bottom, safeAreaBottomPadding)
        }
        .background(.ultraThinMaterial)
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
