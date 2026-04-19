// BWChat/ViewModels/GroupChatViewModel.swift
// Group chat conversation view model with local caching

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
    private let store = MessageStore.shared

    // Per-group "we've already backfilled the full server history" flag.
    // Persisted across launches so we only do the one-time backfill once
    // per group per install. Cleared on logout via LocalCache.clear().
    private static let backfilledKey = "bwchat.group_backfilled"

    private var isBackfilled: Bool {
        let ids = UserDefaults.standard.array(forKey: Self.backfilledKey) as? [Int] ?? []
        return ids.contains(group.groupID)
    }

    private func markBackfilled() {
        var ids = UserDefaults.standard.array(forKey: Self.backfilledKey) as? [Int] ?? []
        if !ids.contains(group.groupID) {
            ids.append(group.groupID)
            UserDefaults.standard.set(ids, forKey: Self.backfilledKey)
        }
    }

    init(group: ChatGroup) {
        self.group = group
        let initial = store.loadGroupMessages(groupID: group.groupID)
        _messages = Published(initialValue: initial)
        if !initial.isEmpty {
            _hasMore = Published(initialValue: initial.count >= 30)
        }
        setupWebSocketListener()
    }

    func loadMessages() async {
        let showBlockingLoader = messages.isEmpty
        if showBlockingLoader { isLoading = true }
        defer { isLoading = false }

        let cached = store.loadGroupMessages(groupID: group.groupID)
        if !cached.isEmpty {
            messages = cached
            hasMore = cached.count >= 30
        }

        let latestID = store.latestGroupMessageID(groupID: group.groupID)
        do {
            if let latestID = latestID {
                var allNew: [GroupMessage] = []
                var fetchMore = true
                var currentAfterID = latestID
                while fetchMore {
                    let (msgs, more) = try await APIService.shared.getGroupMessages(
                        groupID: group.groupID, afterID: currentAfterID
                    )
                    allNew.append(contentsOf: msgs)
                    fetchMore = more && !msgs.isEmpty
                    if let last = msgs.last { currentAfterID = last.id }
                }

                if !allNew.isEmpty {
                    store.saveGroupMessages(allNew)
                    for msg in allNew where !messages.contains(where: { $0.id == msg.id }) {
                        messages.append(msg)
                    }
                }
            } else {
                // First visit to this group on this device (no local cache).
                // Pull the latest page so the UI renders fast; backfill below.
                let (msgs, _) = try await APIService.shared.getGroupMessages(
                    groupID: group.groupID, limit: 100
                )
                store.saveGroupMessages(msgs)
                messages = msgs
                hasMore = false
            }

            // Whichever branch ran, if we haven't yet pulled the full server
            // history for this group on this device, kick off the backfill.
            // Handles both the fresh-install case and the "user had a tiny
            // cache from a prior broken build" case that used to leave them
            // stuck at 30 messages.
            if !isBackfilled {
                // Suppress manual scroll-up trigger during backfill so it
                // doesn't race with our background pagination.
                hasMore = false
                Task { [weak self] in
                    await self?.backfillOlderMessages()
                }
            }
        } catch {
            if messages.isEmpty { errorMessage = "加载消息失败" }
        }
    }

    /// Paginate through every older page on the server and persist them to
    /// local storage. Runs once per group per install (guarded by the
    /// `isBackfilled` flag). Marks the group as backfilled only on clean
    /// completion (server said no more, or earliest message reached).
    private func backfillOlderMessages() async {
        let maxPages = 50  // 50 * 100 = 5000 messages safety cap
        var cursor = messages.first?.id
        for _ in 0..<maxPages {
            guard let before = cursor else {
                markBackfilled()
                return
            }
            do {
                let (older, hasOlder) = try await APIService.shared.getGroupMessages(
                    groupID: group.groupID, beforeID: before, limit: 100
                )
                if older.isEmpty {
                    markBackfilled()
                    return
                }
                store.saveGroupMessages(older)
                messages.insert(contentsOf: older, at: 0)
                cursor = older.first?.id
                if !hasOlder {
                    markBackfilled()
                    return
                }
            } catch {
                // Give up silently; surface the manual scroll-up path so
                // the user can retry later. Don't mark as backfilled so
                // next app open will retry.
                hasMore = true
                return
            }
        }
        // Hit the safety cap — leave scroll-up enabled for older history.
        // Don't mark as backfilled; next open may pick up more history.
        hasMore = true
    }

    func loadMoreMessages() async {
        guard hasMore, let first = messages.first else { return }

        let cached = store.loadGroupMessages(groupID: group.groupID, beforeID: first.id)
        if !cached.isEmpty {
            messages.insert(contentsOf: cached, at: 0)
            hasMore = store.loadGroupMessages(groupID: group.groupID, beforeID: cached.first!.id, limit: 1).count > 0
            return
        }

        do {
            let (msgs, more) = try await APIService.shared.getGroupMessages(groupID: group.groupID, beforeID: first.id)
            store.saveGroupMessages(msgs)
            messages.insert(contentsOf: msgs, at: 0)
            hasMore = more
        } catch { }
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
            store.saveGroupMessage(msg)
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
            store.saveGroupMessage(msg)
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
            store.saveGroupMessage(msg)
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
            store.saveGroupMessage(msg)
            if !messages.contains(where: { $0.id == msg.id }) {
                messages.append(msg)
            }
        } catch {
            errorMessage = "视频发送失败"
        }
        isSending = false
    }

    func sendVoice(data: Data, duration: Double) async {
        isSending = true
        do {
            let msg = try await APIService.shared.sendGroupVoice(
                groupID: group.groupID,
                voiceData: data,
                duration: duration,
                filename: "voice_\(Int(Date().timeIntervalSince1970)).m4a"
            )
            store.saveGroupMessage(msg)
            if !messages.contains(where: { $0.id == msg.id }) {
                messages.append(msg)
            }
        } catch {
            errorMessage = "语音发送失败"
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
                    self.store.saveGroupMessage(msg)
                    if !self.messages.contains(where: { $0.id == msg.id }) {
                        self.messages.append(msg)
                    }
                    self.triggerMentionAlertIfNeeded(msg)
                }
            }
            .store(in: &cancellables)

        WebSocketService.shared.chatResetPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in
                self?.messages.removeAll()
                self?.pendingTexts.removeAll()
            }
            .store(in: &cancellables)
    }
}

struct PendingGroupText: Identifiable {
    let id: String
    let content: String
    var status: PendingStatus = .sending

    enum PendingStatus {
        case sending, failed
    }
}
