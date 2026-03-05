// BWChat/Views/ChatView.swift
// Chat conversation page - minimalist design

import SwiftUI
import PhotosUI

struct ChatView: View {
    let contact: Contact
    @StateObject private var viewModel: ChatViewModel
    @State private var showImagePicker = false
    @State private var selectedItem: PhotosPickerItem?
    @State private var previewImageURL: String?

    init(contact: Contact) {
        self.contact = contact
        _viewModel = StateObject(wrappedValue: ChatViewModel(contact: contact))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Messages list
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 4) {
                        // Load more indicator
                        if viewModel.hasMore {
                            ProgressView()
                                .padding()
                                .onAppear {
                                    Task { await viewModel.loadMoreMessages() }
                                }
                        }

                        // Messages
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

                        // Pending messages
                        ForEach(viewModel.pendingMessages) { pending in
                            PendingMessageBubble(pending: pending)
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
            inputBar
        }
        .navigationTitle(contact.nickname)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(false)
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

    // MARK: - Input Bar

    private var inputBar: some View {
        VStack(spacing: 0) {
            Divider()

            HStack(spacing: 8) {
                // Image picker button
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

                // Text input
                TextField("输入消息...", text: $viewModel.inputText)
                    .font(.body)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(AppColors.separator)
                    .cornerRadius(20)
                    .onSubmit {
                        Task { await viewModel.sendText() }
                    }

                // Send button
                Button {
                    Task { await viewModel.sendText() }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .foregroundColor(viewModel.isSendEnabled ? AppColors.accent : AppColors.secondaryText.opacity(0.5))
                }
                .disabled(!viewModel.isSendEnabled)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(AppColors.background)
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
                        .cornerRadius(12)
                        .opacity(pending.status == .sending ? 0.6 : 1)
                }

                if pending.status == .sending {
                    ProgressView()
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
