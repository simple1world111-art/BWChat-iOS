// BWChat/ViewModels/GroupChatViewModel.swift
// Group chat conversation view model

import SwiftUI
import Combine
import AudioToolbox

@MainActor
class GroupChatViewModel: ObservableObject {
    @Published var messages: [GroupMessage] = []
    @Published var inputText: String = ""
    @Published var isLoading = false
    @Published var isSending = false
    @Published var hasMore = false
    @Published var errorMessage: String?
    @Published var pendingTexts: [PendingGroupText] = []
    @Published var replyingTo: GroupMessage?
    @Published var mentionedUserIDs: [String] = []
    @Published var showMentionPicker = false
    @Published var mentionAlertMessage: GroupMessage?

    let group: ChatGroup
    private var cancellables = Set<AnyCancellable>()

    init(group: ChatGroup) {
        self.group = group
        setupWebSocketListener()
    }

    func loadMessages() async {
        isLoading = true
        do {
            let (msgs, more) = try await APIService.shared.getGroupMessages(groupID: group.groupID)
            messages = msgs
            hasMore = more
        } catch {
            errorMessage = "加载消息失败"
        }
        isLoading = false
    }

    func loadMoreMessages() async {
        guard hasMore, let first = messages.first else { return }
        do {
            let (msgs, more) = try await APIService.shared.getGroupMessages(groupID: group.groupID, beforeID: first.id)
            messages.insert(contentsOf: msgs, at: 0)
            hasMore = more
        } catch {
            // silently fail
        }
    }

    func sendText() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let replyID = replyingTo?.id
        let mentions = mentionedUserIDs
        inputText = ""
        replyingTo = nil
        mentionedUserIDs = []

        let pendingID = UUID().uuidString
        let pending = PendingGroupText(id: pendingID, content: text, status: .sending)
        pendingTexts.append(pending)

        do {
            let msg = try await APIService.shared.sendGroupText(
                groupID: group.groupID,
                content: text,
                replyToID: replyID,
                mentions: mentions
            )
            pendingTexts.removeAll { $0.id == pendingID }
            if !messages.contains(where: { $0.id == msg.id }) {
                messages.append(msg)
            }
        } catch {
            if let idx = pendingTexts.firstIndex(where: { $0.id == pendingID }) {
                pendingTexts[idx].status = .failed
            }
            errorMessage = "发送失败"
        }
    }

    func retryPendingText(_ pending: PendingGroupText) async {
        if let idx = pendingTexts.firstIndex(where: { $0.id == pending.id }) {
            pendingTexts[idx].status = .sending
        }
        do {
            let msg = try await APIService.shared.sendGroupText(
                groupID: group.groupID,
                content: pending.content
            )
            pendingTexts.removeAll { $0.id == pending.id }
            if !messages.contains(where: { $0.id == msg.id }) {
                messages.append(msg)
            }
        } catch {
            if let idx = pendingTexts.firstIndex(where: { $0.id == pending.id }) {
                pendingTexts[idx].status = .failed
            }
        }
    }

    func setReply(to message: GroupMessage) {
        replyingTo = message
    }

    func cancelReply() {
        replyingTo = nil
    }

    func addMention(userID: String, nickname: String) {
        if !mentionedUserIDs.contains(userID) {
            mentionedUserIDs.append(userID)
        }
        inputText += "@\(nickname) "
        showMentionPicker = false
    }

    func sendImage(data: Data) async {
        isSending = true
        do {
            let msg = try await APIService.shared.sendGroupImage(groupID: group.groupID, imageData: data, filename: "img_\(Int(Date().timeIntervalSince1970)).jpg")
            if !messages.contains(where: { $0.id == msg.id }) {
                messages.append(msg)
            }
        } catch {
            errorMessage = "图片发送失败"
        }
        isSending = false
    }

    func sendVideo(data: Data, filename: String) async {
        isSending = true
        do {
            let msg = try await APIService.shared.sendGroupVideo(groupID: group.groupID, videoData: data, filename: filename)
            if !messages.contains(where: { $0.id == msg.id }) {
                messages.append(msg)
            }
        } catch {
            errorMessage = "视频发送失败"
        }
        isSending = false
    }

    var isSendEnabled: Bool {
        !inputText.isBlank
    }

    private func triggerMentionAlertIfNeeded(_ msg: GroupMessage) {
        guard let myID = AuthManager.shared.currentUser?.userID,
              let mentions = msg.mentions,
              mentions.contains(myID),
              msg.senderID != myID else { return }
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.warning)
        AudioServicesPlaySystemSound(1315)
        mentionAlertMessage = msg
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            if self?.mentionAlertMessage?.id == msg.id {
                withAnimation(.easeOut(duration: 0.3)) {
                    self?.mentionAlertMessage = nil
                }
            }
        }
    }

    private func setupWebSocketListener() {
        WebSocketService.shared.groupMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] msg in
                guard let self = self else { return }
                if msg.groupID == self.group.groupID {
                    if !self.messages.contains(where: { $0.id == msg.id }) {
                        self.messages.append(msg)
                    }
                    self.triggerMentionAlertIfNeeded(msg)
                }
            }
            .store(in: &cancellables)

        // Clear messages when chat is reset (e.g., logout)
        WebSocketService.shared.chatResetPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in
                self?.messages.removeAll()
                self?.pendingTexts.removeAll()
            }
            .store(in: &cancellables)
    }
}

// Pending text message placeholder for optimistic UI
struct PendingGroupText: Identifiable {
    let id: String
    let content: String
    var status: PendingStatus = .sending

    enum PendingStatus {
        case sending, failed
    }
}
