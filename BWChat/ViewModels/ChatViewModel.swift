// BWChat/ViewModels/ChatViewModel.swift
// Chat conversation view model

import Foundation
import Combine
import PhotosUI
import SwiftUI

@MainActor
class ChatViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var inputText: String = ""
    @Published var isLoading: Bool = false
    @Published var isSending: Bool = false
    @Published var hasMore: Bool = false
    @Published var errorMessage: String?
    @Published var pendingMessages: [PendingMessage] = []
    @Published var selectedImageData: Data?
    @Published var replyingTo: Message?

    let contact: Contact
    private var cancellables = Set<AnyCancellable>()

    init(contact: Contact) {
        self.contact = contact
        setupWebSocketListener()
    }

    func loadMessages() async {
        isLoading = true
        errorMessage = nil

        do {
            let (msgs, more) = try await APIService.shared.getMessages(contactID: contact.userID)
            messages = msgs
            hasMore = more
        } catch let error as APIError {
            if case .unauthorized = error {
                AuthManager.shared.logout()
            }
            errorMessage = error.errorDescription
        } catch {
            errorMessage = "加载消息失败"
        }

        isLoading = false
    }

    func loadMoreMessages() async {
        guard hasMore, let firstMessage = messages.first else { return }

        do {
            let (msgs, more) = try await APIService.shared.getMessages(
                contactID: contact.userID,
                beforeID: firstMessage.id
            )
            messages.insert(contentsOf: msgs, at: 0)
            hasMore = more
        } catch {
            print("[Chat] Failed to load more: \(error)")
        }
    }

    func sendText() async {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let replyID = replyingTo?.id
        inputText = ""
        replyingTo = nil

        do {
            let message = try await APIService.shared.sendTextMessage(
                receiverID: contact.userID,
                content: text,
                replyToID: replyID
            )
            if !messages.contains(where: { $0.id == message.id }) {
                messages.append(message)
            }
        } catch {
            errorMessage = "发送失败，请重试"
        }
    }

    func setReply(to message: Message) {
        replyingTo = message
    }

    func cancelReply() {
        replyingTo = nil
    }

    func sendImage(data: Data) async {
        isSending = true

        // Add pending message for optimistic UI
        let pending = PendingMessage(
            receiverID: contact.userID,
            msgType: "image",
            content: "",
            imageData: data,
            videoData: nil
        )
        pendingMessages.append(pending)

        do {
            let message = try await APIService.shared.sendImageMessage(
                receiverID: contact.userID,
                imageData: data,
                filename: "image_\(Int(Date().timeIntervalSince1970)).jpg"
            )
            messages.append(message)
            // Remove pending
            pendingMessages.removeAll { $0.id == pending.id }
        } catch {
            // Mark as failed
            if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
                pendingMessages[index].status = .failed
            }
            errorMessage = "图片发送失败"
        }

        isSending = false
    }

    func sendVideo(data: Data, filename: String) async {
        isSending = true

        let pending = PendingMessage(
            receiverID: contact.userID,
            msgType: "video",
            content: "",
            imageData: nil,
            videoData: data
        )
        pendingMessages.append(pending)

        do {
            let message = try await APIService.shared.sendVideoMessage(
                receiverID: contact.userID,
                videoData: data,
                filename: filename
            )
            messages.append(message)
            pendingMessages.removeAll { $0.id == pending.id }
        } catch {
            if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
                pendingMessages[index].status = .failed
            }
            errorMessage = "视频发送失败"
        }

        isSending = false
    }

    var isSendEnabled: Bool {
        !inputText.isBlank
    }

    private func setupWebSocketListener() {
        WebSocketService.shared.newMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                guard let self = self else { return }
                // Only add messages from/to this contact
                let isRelevant = (message.senderID == self.contact.userID &&
                                  message.receiverID == AuthManager.shared.currentUser?.userID) ||
                                 (message.senderID == AuthManager.shared.currentUser?.userID &&
                                  message.receiverID == self.contact.userID)
                if isRelevant {
                    // Avoid duplicates
                    if !self.messages.contains(where: { $0.id == message.id }) {
                        self.messages.append(message)
                    }
                }
            }
            .store(in: &cancellables)

        WebSocketService.shared.chatResetPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in
                self?.messages.removeAll()
                self?.pendingMessages.removeAll()
            }
            .store(in: &cancellables)
    }
}
