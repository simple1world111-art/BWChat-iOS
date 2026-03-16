// BWChat/ViewModels/GroupChatViewModel.swift
// Group chat conversation view model

import Foundation
import Combine

@MainActor
class GroupChatViewModel: ObservableObject {
    @Published var messages: [GroupMessage] = []
    @Published var inputText: String = ""
    @Published var isLoading = false
    @Published var isSending = false
    @Published var hasMore = false
    @Published var errorMessage: String?
    @Published var pendingTexts: [PendingGroupText] = []

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
        inputText = ""

        // Optimistic: add a pending placeholder immediately
        let pendingID = UUID().uuidString
        let pending = PendingGroupText(id: pendingID, content: text, status: .sending)
        pendingTexts.append(pending)

        do {
            let msg = try await APIService.shared.sendGroupText(groupID: group.groupID, content: text)
            // Remove pending, add real message
            pendingTexts.removeAll { $0.id == pendingID }
            if !messages.contains(where: { $0.id == msg.id }) {
                messages.append(msg)
            }
        } catch {
            // Mark pending as failed
            if let idx = pendingTexts.firstIndex(where: { $0.id == pendingID }) {
                pendingTexts[idx].status = .failed
            }
            errorMessage = "发送失败"
        }
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

    private func setupWebSocketListener() {
        WebSocketService.shared.groupMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] msg in
                guard let self = self else { return }
                if msg.groupID == self.group.groupID {
                    if !self.messages.contains(where: { $0.id == msg.id }) {
                        self.messages.append(msg)
                    }
                }
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
