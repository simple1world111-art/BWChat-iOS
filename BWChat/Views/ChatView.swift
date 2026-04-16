// BWChat/Views/ChatView.swift
// Premium chat conversation page

import SwiftUI
import PhotosUI
import AVKit
import AVFoundation
import UniformTypeIdentifiers

struct ChatView: View {
    let contact: Contact
    var onMarkRead: (() -> Void)?
    @StateObject private var viewModel: ChatViewModel
    @State private var selectedMediaItems: [PhotosPickerItem] = []
    @State private var previewVideoURL: String?
    @State private var highlightedMessageID: Int?
    @State private var showPlusMenu = false
    @State private var isVoiceMode = false
    @StateObject private var recorder = AudioRecorderManager()
    @State private var voiceCancelZone = false

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

    private func scrollChatToLatest(proxy: ScrollViewProxy) {
        if let pending = viewModel.pendingMessages.last {
            DispatchQueue.main.async {
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(pending.id, anchor: .top)
                }
            }
        } else if let last = viewModel.messages.last {
            DispatchQueue.main.async {
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(last.id, anchor: .top)
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
                            .id(pending.id)
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

                                MessageBubble(
                                    message: message,
                                    isFromMe: isFromMe,
                                    avatarURL: isFromMe ? myAvatarURL : contact.avatarURL,
                                    onImageTap: { url, anchor in
                                        hideKeyboard()
                                        let allImages = viewModel.messages.filter(\.isImage).map(\.content)
                                        ImageGalleryState.shared.show(urls: allImages, index: allImages.firstIndex(of: url) ?? 0, tapAnchor: anchor)
                                    },
                                    onVideoTap: { url, _ in
                                        hideKeyboard()
                                        previewVideoURL = url
                                    },
                                    onReply: { msg in viewModel.setReply(to: msg) },
                                    onQuoteTap: { targetID in
                                        scrollToMessage(targetID, proxy: proxy)
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
                .onChange(of: viewModel.messages.count) { _ in scrollChatToLatest(proxy: proxy) }
                .onChange(of: viewModel.messages.last?.id) { _ in scrollChatToLatest(proxy: proxy) }
                .onChange(of: viewModel.pendingMessages.count) { _ in scrollChatToLatest(proxy: proxy) }
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
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                EmptyView()
            }
        }
        .overlay { voiceRecordingOverlay }
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
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { isVoiceMode.toggle() }
                } label: {
                    Image(systemName: isVoiceMode ? "keyboard" : "mic.fill")
                        .font(.system(size: 20))
                        .foregroundColor(AppColors.accent)
                        .frame(width: 32, height: 40)
                }

                if isVoiceMode {
                    holdToRecordButton
                } else {
                    TextField("输入消息...", text: $viewModel.inputText, axis: .vertical)
                        .font(.system(size: 16))
                        .lineLimit(1...5)
                        .submitLabel(.send)
                        .onSubmit {
                            Task { await viewModel.sendText() }
                        }
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
                chatPlusMenu
            }
        }
        .background(AppColors.secondaryBackground)
    }

    private var holdToRecordButton: some View {
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
                            finishVoiceRecording()
                        }
                    }
            )
    }

    @ViewBuilder
    private var voiceRecordingOverlay: some View {
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
                            voiceWaveAnimation
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

    private var voiceWaveAnimation: some View {
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

    private func finishVoiceRecording() {
        guard let result = recorder.stopRecording() else { return }
        Task {
            await viewModel.sendVoice(data: result.data, duration: result.duration)
        }
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
            Spacer(minLength: 40)

            VStack(alignment: .trailing, spacing: 2) {
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
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(AppColors.accentGradient)
                            .cornerRadius(18, corners: [.topLeft, .topRight, .bottomLeft])
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
                    } else if pending.msgType == "voice" {
                        HStack(spacing: 6) {
                            Text("\(Int(pending.voiceDuration))\"")
                                .font(.system(size: 14))
                                .foregroundColor(.white)
                            Spacer()
                            HStack(spacing: 2) {
                                ForEach(0..<3, id: \.self) { i in
                                    RoundedRectangle(cornerRadius: 1)
                                        .fill(Color.white)
                                        .frame(width: 2, height: CGFloat([6, 10, 6][i]))
                                }
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .frame(width: 100)
                        .background(AppColors.accentGradient)
                        .cornerRadius(18, corners: [.topLeft, .topRight, .bottomLeft])
                    }
                }
            }

            AvatarView(url: avatarURL, size: 36)
        }
        .padding(.vertical, 2)
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

// MARK: - Audio Recorder Manager

struct VoiceRecordingResult {
    let data: Data
    let duration: Double
}

@MainActor
class AudioRecorderManager: ObservableObject {
    @Published var isRecording = false
    @Published var recordingDuration: Double = 0

    private var audioRecorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var timer: Timer?
    private var startTime: Date?

    var formattedDuration: String {
        let secs = Int(recordingDuration)
        let mins = secs / 60
        let rem = secs % 60
        return String(format: "%d:%02d", mins, rem)
    }

    func startRecording() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)
        } catch {
            return
        }

        let tempDir = FileManager.default.temporaryDirectory
        let url = tempDir.appendingPathComponent("voice_\(UUID().uuidString).m4a")
        recordingURL = url

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 22050,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue
        ]

        do {
            audioRecorder = try AVAudioRecorder(url: url, settings: settings)
            audioRecorder?.record()
            isRecording = true
            startTime = Date()
            recordingDuration = 0
            timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self = self, let start = self.startTime else { return }
                    self.recordingDuration = Date().timeIntervalSince(start)
                }
            }
        } catch { }
    }

    func stopRecording() -> VoiceRecordingResult? {
        timer?.invalidate()
        timer = nil
        audioRecorder?.stop()
        isRecording = false

        guard let url = recordingURL,
              let start = startTime else { return nil }

        let duration = Date().timeIntervalSince(start)
        startTime = nil

        guard duration >= 1.0 else {
            try? FileManager.default.removeItem(at: url)
            recordingURL = nil
            return nil
        }

        guard let data = try? Data(contentsOf: url) else {
            recordingURL = nil
            return nil
        }

        try? FileManager.default.removeItem(at: url)
        recordingURL = nil

        return VoiceRecordingResult(data: data, duration: duration)
    }

    func cancelRecording() {
        timer?.invalidate()
        timer = nil
        audioRecorder?.stop()
        isRecording = false
        startTime = nil
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        recordingURL = nil
        recordingDuration = 0
    }
}
