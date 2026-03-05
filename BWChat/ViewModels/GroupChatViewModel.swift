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
        isSending = true

        do {
            let msg = try await APIService.shared.sendGroupText(groupID: group.groupID, content: text)
            messages.append(msg)
        } catch {
            errorMessage = "发送失败"
        }
        isSending = false
    }

    func sendImage(data: Data) async {
        isSending = true
        do {
            let msg = try await APIService.shared.sendGroupImage(groupID: group.groupID, imageData: data, filename: "img_\(Int(Date().timeIntervalSince1970)).jpg")
            messages.append(msg)
        } catch {
            errorMessage = "图片发送失败"
        }
        isSending = false
    }

    var isSendEnabled: Bool {
        !inputText.isBlank && !isSending
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
