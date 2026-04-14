// BWChat/Views/GroupChatView.swift
// Group chat conversation page

import SwiftUI
import PhotosUI
import AVKit
import AVFoundation
import UniformTypeIdentifiers

struct GroupChatView: View {
    let group: ChatGroup
    var onMarkRead: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: GroupChatViewModel
    @State private var selectedMediaItems: [PhotosPickerItem] = []
    @State private var previewVideoURL: String?
    @State private var showAddMembers = false
    @State private var showGroupDetail = false
    @State private var memberCount: Int = 0
    @State private var shouldPopToRoot = false
    @State private var showPlusMenu = false
    @State private var highlightedMessageID: Int?
    @State private var isVoiceMode = false
    @StateObject private var recorder = AudioRecorderManager()
    @State private var voiceCancelZone = false

    private var myAvatarURL: String {
        AuthManager.shared.currentUser?.avatarURL ?? ""
    }

    init(group: ChatGroup, onMarkRead: (() -> Void)? = nil) {
        self.group = group
        self.onMarkRead = onMarkRead
        _viewModel = StateObject(wrappedValue: GroupChatViewModel(group: group))
    }

    private func setActiveGroupChat(_ active: Bool) {
        WebSocketService.shared.activeGroupID = active ? group.id : nil
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

    private func previousTimestamp(for message: GroupMessage) -> String? {
        guard let idx = viewModel.messages.firstIndex(where: { $0.id == message.id }),
              idx > 0 else { return nil }
        return viewModel.messages[idx - 1].timestamp
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(viewModel.pendingTexts.reversed()) { pending in
                            PendingGroupBubble(pending: pending, avatarURL: myAvatarURL) {
                                Task { await viewModel.retryPendingText(pending) }
                            }
                            .flippedRow()
                        }

                        ForEach(viewModel.messages.reversed()) { message in
                            let isFromMe = message.senderID == AuthManager.shared.currentUser?.userID

                            VStack(spacing: 4) {
                                if TimestampHelper.shouldShowTime(
                                    current: message.timestamp,
                                    previous: previousTimestamp(for: message)
                                ) {
                                    TimeSeparatorView(timestamp: message.timestamp)
                                }

                                GroupMessageBubble(
                                    message: message,
                                    isFromMe: isFromMe,
                                    myAvatarURL: myAvatarURL,
                                    onImageTap: { url in
                                        let allImages = viewModel.messages.filter(\.isImage).map(\.content)
                                        ImageGalleryState.shared.show(urls: allImages, index: allImages.firstIndex(of: url) ?? 0)
                                    },
                                    onVideoTap: { url in previewVideoURL = url },
                                    onReply: { msg in viewModel.setReply(to: msg) },
                                    onQuoteTap: { targetID in
                                        scrollToMessage(targetID, proxy: proxy)
                                    },
                                    onMention: { userID, nickname in
                                        viewModel.addMention(userID: userID, nickname: nickname)
                                    }
                                )
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
                    async let messagesTask: () = viewModel.loadMessages()
                    async let detailTask = APIService.shared.getGroupDetail(groupID: group.groupID)
                    await messagesTask
                    if let detail = try? await detailTask {
                        memberCount = detail.members.count
                    }
                    onMarkRead?()
                }
            }

            if let replyMsg = viewModel.replyingTo {
                ReplyPreviewBar(
                    senderName: replyMsg.senderNickname,
                    content: replyMsg.content,
                    msgType: replyMsg.msgType,
                    onCancel: { viewModel.cancelReply() }
                )
            }

            groupInputBar
        }
        .sheet(isPresented: $viewModel.showMentionPicker) {
            MentionPickerView(groupID: group.groupID) { userID, nickname in
                viewModel.addMention(userID: userID, nickname: nickname)
            }
        }
        .background(AppColors.secondaryBackground)
        .overlay(alignment: .top) {
            if let alertMsg = viewModel.mentionAlertMessage {
                HStack(spacing: 10) {
                    Image(systemName: "at.badge.plus")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(.white)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(alertMsg.senderNickname) 提到了你")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.white)
                        Text(alertMsg.content.prefix(50))
                            .font(.system(size: 13))
                            .foregroundColor(.white.opacity(0.9))
                            .lineLimit(1)
                    }
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color.red.opacity(0.92))
                        .shadow(color: .black.opacity(0.2), radius: 8, y: 4)
                )
                .padding(.horizontal, 12)
                .padding(.top, 4)
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: viewModel.mentionAlertMessage?.id)
                .onTapGesture {
                    withAnimation { viewModel.mentionAlertMessage = nil }
                }
            }
        }
        .navigationTitle(memberCount > 0 ? "\(group.name) (\(memberCount))" : group.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showGroupDetail = true } label: {
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
        .overlay { groupVoiceRecordingOverlay }
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
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { isVoiceMode.toggle() }
                } label: {
                    Image(systemName: isVoiceMode ? "keyboard" : "mic.fill")
                        .font(.system(size: 20))
                        .foregroundColor(AppColors.accent)
                        .frame(width: 32, height: 40)
                }

                if isVoiceMode {
                    groupHoldToRecordButton
                } else {
                    TextField("输入消息...", text: $viewModel.inputText, axis: .vertical)
                        .font(.system(size: 16))
                        .lineLimit(1...5)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 22)
                                .fill(AppColors.separator)
                        )
                }

                if viewModel.isSendEnabled && !isVoiceMode {
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
                } else if !isVoiceMode {
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

            if showPlusMenu && !isVoiceMode {
                groupPlusMenu
            }
        }
        .background(AppColors.secondaryBackground)
    }

    private var groupHoldToRecordButton: some View {
        Text(recorder.isRecording ? (voiceCancelZone ? "松开 取消" : "松开 发送") : "按住 说话")
            .font(.system(size: 16, weight: .medium))
            .foregroundColor(recorder.isRecording ? .white : AppColors.primaryText)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 22)
                    .fill(recorder.isRecording ? (voiceCancelZone ? Color.red.opacity(0.8) : AppColors.accent) : AppColors.separator)
            )
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        if !recorder.isRecording {
                            recorder.startRecording()
                        }
                        let inCancel = value.translation.height < -80
                        if inCancel != voiceCancelZone {
                            withAnimation(.easeInOut(duration: 0.15)) { voiceCancelZone = inCancel }
                        }
                    }
                    .onEnded { _ in
                        if voiceCancelZone {
                            recorder.cancelRecording()
                            voiceCancelZone = false
                        } else {
                            finishGroupVoiceRecording()
                        }
                    }
            )
    }

    @ViewBuilder
    private var groupVoiceRecordingOverlay: some View {
        if recorder.isRecording {
            ZStack {
                Color.black.opacity(0.6)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)

                VStack(spacing: 24) {
                    Spacer()

                    ZStack {
                        Circle()
                            .fill(voiceCancelZone ? Color.red.opacity(0.9) : AppColors.accent)
                            .frame(width: 100, height: 100)

                        if voiceCancelZone {
                            Image(systemName: "xmark")
                                .font(.system(size: 36, weight: .bold))
                                .foregroundColor(.white)
                        } else {
                            HStack(spacing: 4) {
                                ForEach(0..<5, id: \.self) { i in
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(Color.white)
                                        .frame(width: 4, height: CGFloat([16, 24, 32, 24, 16][i]))
                                        .animation(
                                            .easeInOut(duration: 0.4)
                                            .repeatForever(autoreverses: true)
                                            .delay(Double(i) * 0.1),
                                            value: recorder.isRecording
                                        )
                                }
                            }
                        }
                    }
                    .scaleEffect(voiceCancelZone ? 1.1 : 1.0)
                    .animation(.easeInOut(duration: 0.2), value: voiceCancelZone)

                    Text(recorder.formattedDuration)
                        .font(.system(size: 48, weight: .light, design: .monospaced))
                        .foregroundColor(.white)

                    Text(voiceCancelZone ? "松开 取消发送" : "上滑 取消")
                        .font(.system(size: 15))
                        .foregroundColor(.white.opacity(0.7))
                        .padding(.bottom, 120)
                }
            }
            .transition(.opacity)
        }
    }

    private func finishGroupVoiceRecording() {
        guard let result = recorder.stopRecording() else { return }
        Task {
            await viewModel.sendVoice(data: result.data, duration: result.duration)
        }
    }

    private var groupPlusMenu: some View {
        HStack(spacing: 24) {
            PhotosPicker(selection: $selectedMediaItems, maxSelectionCount: 9, matching: .any(of: [.images, .videos])) {
                VStack(spacing: 6) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12).fill(AppColors.separator).frame(width: 56, height: 56)
                        Image(systemName: "photo").font(.system(size: 22)).foregroundColor(AppColors.primaryText)
                    }
                    Text("相册").font(.system(size: 11)).foregroundColor(AppColors.secondaryText)
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

            Button {
                showPlusMenu = false
                CallManager.shared.startGroupCall(groupID: group.groupID, groupName: group.name, type: .voice)
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
                CallManager.shared.startGroupCall(groupID: group.groupID, groupName: group.name, type: .video)
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

// MARK: - Group Message Bubble

struct GroupMessageBubble: View {
    let message: GroupMessage
    let isFromMe: Bool
    var myAvatarURL: String = ""
    var onImageTap: ((String) -> Void)?
    var onVideoTap: ((String) -> Void)?
    var onReply: ((GroupMessage) -> Void)?
    var onQuoteTap: ((Int) -> Void)?
    var onMention: ((String, String) -> Void)?

    @State private var swipeOffset: CGFloat = 0
    @State private var showMenu = false

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
                AvatarView(url: message.senderAvatar, size: 36)
                    .onTapGesture {
                        onMention?(message.senderID, message.senderNickname)
                    }
            }

            VStack(alignment: isFromMe ? .trailing : .leading, spacing: 3) {
                if !isFromMe {
                    Text(message.senderNickname)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                }

                if let reply = message.replyTo {
                    QuotedMessageView(
                        senderName: reply.senderID == AuthManager.shared.currentUser?.userID ? "我" : (UserCacheManager.shared.getUser(reply.senderID)?.nickname ?? reply.senderID),
                        content: reply.content,
                        msgType: reply.msgType,
                        isFromMe: isFromMe,
                        onTap: { onQuoteTap?(reply.id) }
                    )
                }

                if message.isImage {
                    CachedAsyncImage(url: message.content)
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
                } else if message.isVoice {
                    VoiceBubbleView(
                        url: message.voiceURL ?? "",
                        duration: message.voiceDuration,
                        isFromMe: isFromMe
                    )
                } else {
                    Text(message.content)
                        .font(.system(size: 16))
                        .foregroundColor(isFromMe ? .white : AppColors.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
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
                        .onLongPressGesture(minimumDuration: 0.5) {
                            let impactFeedback = UIImpactFeedbackGenerator(style: .medium)
                            impactFeedback.impactOccurred()
                            showMenu = true
                        }
                        .confirmationDialog("", isPresented: $showMenu, titleVisibility: .hidden) {
                            Button("复制") { UIPasteboard.general.string = message.content }
                            Button("回复") { onReply?(message) }
                            if !isFromMe {
                                Button("@\(message.senderNickname)") {
                                    onMention?(message.senderID, message.senderNickname)
                                }
                            }
                            Button("取消", role: .cancel) {}
                        }
                }
            }

            if isFromMe {
                AvatarView(url: myAvatarURL, size: 36)
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
    var avatarURL: String = ""
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Spacer(minLength: 40)
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

                Text(pending.content)
                    .font(.system(size: 16))
                    .foregroundColor(.white)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(AppColors.sentBubbleGradient)
                    .cornerRadius(18, corners: [.topLeft, .topRight, .bottomLeft])
            }

            AvatarView(url: avatarURL, size: 36)
        }
        .padding(.vertical, 2)
    }
}
