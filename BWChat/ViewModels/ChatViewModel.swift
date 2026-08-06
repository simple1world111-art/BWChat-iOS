// BWChat/ViewModels/ChatViewModel.swift
// Chat conversation view model with local caching

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
    private let store = MessageStore.shared
    private let myID: String
    private var isSyncingLatest = false
    private var nextOptimisticMessageID = Int.max / 4
    private var optimisticStickerMessageIDs = Set<Int>()
    private var optimisticStickerSignatures: [Int: StickerSendSignature] = [:]
    private var apiConfirmedMessageIDs = Set<Int>()
    private var webSocketConfirmedMessageIDs = Set<Int>()
    private var isReadingLatest = true
    private var locallyEnqueuedMediaClientIDs = Set<String>()
    private var giftIdempotencyKeys: [String: UUID] = [:]

    private enum MessageSource {
        case apiResponse
        case webSocket
        case history
    }

    private struct StickerSendSignature: Equatable {
        let stickerID: String
        let packID: String
        let assetKey: String
        let replyID: Int?
    }

    // Per-DM "full server history pulled" flag. See GroupChatViewModel for
    // the rationale.
    private var backfilledKey: String { "bbchat.dm_backfilled.\(myID)" }

    private var isBackfilled: Bool {
        let ids = UserDefaults.standard.array(forKey: backfilledKey) as? [String] ?? []
        return ids.contains(contact.userID)
    }

    private func markBackfilled() {
        var ids = UserDefaults.standard.array(forKey: backfilledKey) as? [String] ?? []
        if !ids.contains(contact.userID) {
            ids.append(contact.userID)
            UserDefaults.standard.set(ids, forKey: backfilledKey)
        }
    }

    private func userFacingSendError(_ error: Error, fallbackKey: String) -> String {
        if let localizedError = error as? LocalizedError,
           let message = localizedError.errorDescription?.trimmingCharacters(in: .whitespacesAndNewlines),
           !message.isEmpty {
            return message
        }
        return L10n.tr(fallbackKey)
    }

    init(contact: Contact) {
        self.contact = contact
        let uid = AuthManager.shared.currentUser?.userID ?? ""
        self.myID = uid
        let initial = store.loadMessages(userID: uid, contactID: contact.userID)
        _messages = Published(initialValue: initial)
        let restoredPending = Self.restorePendingMessages(ownerID: uid, contactID: contact.userID)
        _pendingMessages = Published(initialValue: restoredPending)
        locallyEnqueuedMediaClientIDs = Set(
            restoredPending
                .filter { ["image", "video"].contains(MessageDeliveryMatcher.normalizedType($0.msgType)) }
                .map { $0.id.uuidString }
        )
        if !initial.isEmpty {
            _hasMore = Published(initialValue: store.localMessageCount(userID: uid, contactID: contact.userID) >= 30)
        }
        ChatMediaPreviewPreloader.schedule(
            initial.compactMap(Self.mediaPreviewRequest),
            limit: 8
        )
        setupWebSocketListener()
        setupOutboxRecoveryListener()
        Task { [weak self] in await self?.resumeDurableOutboxIfNeeded() }
    }

    private func resumeDurableOutboxIfNeeded() async {
        await UploadEngine.shared.recover(
            ownerID: myID,
            jobIDs: Set(pendingMessages.map { $0.id.uuidString })
        )
        let jobs = OutgoingStore.shared.jobs(ownerID: myID).filter {
            $0.scene == .directMessage && $0.businessKey == contact.userID
        }
        let jobsByID = Dictionary(uniqueKeysWithValues: jobs.map { ($0.id, $0) })
        for pending in pendingMessages {
            guard let job = jobsByID[pending.id.uuidString] else { continue }
            switch job.state {
            case .staging, .queued, .preparing:
                await retryPending(pending)
            case .retryWaiting:
                if job.attemptCount < OutgoingRetryPolicy.maximumAutomaticAttempts {
                    scheduleDurableRetry(job: job, pendingID: pending.id)
                } else {
                    markPendingMessageFailed(id: pending.id)
                    OutgoingStore.shared.updateJob(
                        id: job.id,
                        ownerID: myID,
                        state: .failedPermanent,
                        lastErrorCode: job.lastErrorCode
                    )
                }
            case .confirmationUnknown:
                _ = await scheduleTransientRetry(
                    pendingID: pending.id,
                    error: URLError(.networkConnectionLost)
                )
            case .failedPermanent:
                markPendingMessageFailed(id: pending.id)
            case .uploading, .committing, .cancelled, .succeeded:
                break
            }
        }
    }

    private static func restorePendingMessages(ownerID: String, contactID: String) -> [PendingMessage] {
        guard !ownerID.isEmpty else { return [] }
        return OutgoingStore.shared.jobs(ownerID: ownerID).compactMap { job -> PendingMessage? in
            guard job.scene == .directMessage,
                  job.businessKey == contactID,
                  job.state != .succeeded,
                  job.state != .cancelled,
                  let id = UUID(uuidString: job.clientRequestID),
                  let payload = try? JSONDecoder().decode(ChatOutgoingPayload.self, from: job.payload) else { return nil }
            let part = OutgoingStore.shared.parts(jobID: job.id).first
            return PendingMessage(
                id: id,
                createdAt: job.createdAt,
                receiverID: contactID,
                msgType: payload.msgType,
                content: payload.content,
                localFileURL: part.map { OutgoingFileStore.absoluteURL(for: $0.localRelativePath) },
                filename: payload.filename,
                replyToID: payload.replyToID,
                status: job.state.isUserVisibleFailure ? .failed : .sending
            )
        }
    }

    private func makeOutgoingJob(id: UUID, payload: ChatOutgoingPayload, state: OutgoingState = .queued) -> OutgoingJob {
        OutgoingJob(
            clientRequestID: id.uuidString,
            ownerID: myID,
            scene: .directMessage,
            businessKey: contact.userID,
            payload: (try? JSONEncoder().encode(payload)) ?? Data(),
            state: state
        )
    }

    func loadMessages() async {
        let showBlockingLoader = messages.isEmpty
        if showBlockingLoader { isLoading = true }
        errorMessage = nil
        defer { isLoading = false }

        let cached = await store.loadMessagesAsync(userID: myID, contactID: contact.userID)
        if !cached.isEmpty {
            ChatMediaPreviewPreloader.schedule(
                cached.compactMap(Self.mediaPreviewRequest),
                limit: 6
            )
            messages = cached
            hasMore = await store.localMessageCountAsync(
                userID: myID,
                contactID: contact.userID
            ) >= 30
        }

        // Incremental sync: fetch messages newer than local latest
        let latestID = await store.latestMessageIDAsync(
            userID: myID,
            contactID: contact.userID
        )
        do {
            if let latestID = latestID {
                await mergeFetchedMessages(try await fetchNewerMessages(afterID: latestID))
                await mergeFetchedMessages(try await fetchRecentMessages())
                hasMore = await store.localMessageCountAsync(
                    userID: myID,
                    contactID: contact.userID
                ) >= 30
            } else {
                // First visit to this DM on this device (no local cache).
                let (msgs, _) = try await APIService.shared.getMessages(
                    contactID: contact.userID, limit: 100
                )
                await mergeFetchedMessages(msgs)
                hasMore = false
            }

            // If this install hasn't yet pulled the full server history for
            // this DM, backfill in the background regardless of which branch
            // above ran. Handles the "had a partial cache from a prior build"
            // case that would otherwise stay stuck at the incremental tail.
            if !isBackfilled {
                hasMore = false
                Task { [weak self] in
                    await self?.backfillOlderMessages()
                }
            }
        } catch let error as APIError {
            if messages.isEmpty { errorMessage = error.errorDescription }
        } catch {
            if messages.isEmpty { errorMessage = L10n.tr("messages.loadFailed") }
        }
    }

    /// Paginate through every older page on the server and persist them to
    /// local storage. Runs once per DM per install (guarded by
    /// `isBackfilled`). Marks backfilled only on clean completion.
    private func backfillOlderMessages() async {
        let maxPages = 50  // 50 * 100 = 5000 messages safety cap
        var cursor = messages.first?.id
        for _ in 0..<maxPages {
            guard let before = cursor else {
                markBackfilled()
                await updateHasCachedOlderMessages()
                return
            }
            do {
                let (older, hasOlder) = try await APIService.shared.getMessages(
                    contactID: contact.userID, beforeID: before, limit: 100
                )
                if older.isEmpty {
                    markBackfilled()
                    await updateHasCachedOlderMessages()
                    return
                }
                await store.saveMessagesAsync(older, ownerID: myID)
                cursor = older.first?.id
                if !hasOlder {
                    markBackfilled()
                    await updateHasCachedOlderMessages()
                    return
                }
            } catch {
                await updateHasCachedOlderMessages(fallback: true)
                return
            }
        }
        await updateHasCachedOlderMessages(fallback: true)
    }

    private func updateHasCachedOlderMessages(fallback: Bool = false) async {
        guard let firstID = messages.first?.id else {
            hasMore = false
            return
        }
        let cachedOlder = await store.loadMessagesAsync(
            userID: myID,
            contactID: contact.userID,
            beforeID: firstID,
            limit: 1
        )
        hasMore = cachedOlder.isEmpty ? fallback : true
    }

    func loadMoreMessages() async {
        guard hasMore, let firstMessage = messages.first else { return }

        let cached = await store.loadMessagesAsync(
            userID: myID,
            contactID: contact.userID,
            beforeID: firstMessage.id
        )
        if !cached.isEmpty {
            ChatMediaPreviewPreloader.schedule(
                cached.compactMap(Self.mediaPreviewRequest),
                limit: 6
            )
            messages.insert(contentsOf: cached, at: 0)
            hasMore = await store.loadMessagesAsync(
                userID: myID,
                contactID: contact.userID,
                beforeID: cached.first!.id,
                limit: 1
            ).count > 0
            return
        }

        do {
            let (msgs, more) = try await APIService.shared.getMessages(
                contactID: contact.userID, beforeID: firstMessage.id
            )
            await mergeFetchedMessages(msgs)
            hasMore = more
        } catch {
            print("[Chat] Failed to load more: \(error)")
        }
    }

    func deleteLocally(messageIDs: Set<Int>) {
        guard !messageIDs.isEmpty, !myID.isEmpty else { return }
        store.hideDirectMessages(ownerID: myID, contactID: contact.userID, messageIDs: messageIDs)
        messages.removeAll { messageIDs.contains($0.id) }
        if let replyID = replyingTo?.id, messageIDs.contains(replyID) {
            replyingTo = nil
        }
        let latest = messages.last
        NotificationCenter.default.post(
            name: .conversationPreviewDidChange,
            object: LocalConversationPreviewUpdate(
                target: .direct(userID: contact.userID),
                lastMessage: latest.map(localPreviewText),
                lastMessageTime: latest?.timestamp
            )
        )
    }

    func applyHistoryClear(throughMessageID: Int) {
        messages.removeAll { $0.id <= throughMessageID }
        replyingTo = nil
        hasMore = false
        NotificationCenter.default.post(
            name: .conversationPreviewDidChange,
            object: LocalConversationPreviewUpdate(
                target: .direct(userID: contact.userID),
                lastMessage: messages.last.map(localPreviewText),
                lastMessageTime: messages.last?.timestamp
            )
        )
    }

    func recallMessage(messageID: Int) async throws {
        let recalled = try await APIService.shared.recallMessage(
            contactID: contact.userID,
            messageID: messageID
        )
        await mergeFetchedMessages([recalled])
        NotificationCenter.default.post(name: .conversationPreviewDidChange, object: recalled)
        if replyingTo?.id == messageID {
            replyingTo = nil
        }
    }

    private func localPreviewText(_ message: Message) -> String {
        if message.isRecalled {
            return ChatMessageRecallState.notice(
                senderID: message.senderID,
                viewerID: myID,
                senderName: contact.nickname
            )
        }
        if message.isImage { return L10n.tr("message.image") }
        if message.isVideo { return L10n.tr("message.video") }
        if message.isVoice { return L10n.tr("message.voice") }
        if message.isSticker { return L10n.tr("message.sticker") }
        return message.content
    }

    func loadContext(around messageID: Int) async -> Bool {
        if messages.contains(where: { $0.id == messageID }) { return true }
        do {
            let context = try await APIService.shared.getMessageContext(
                contactID: contact.userID,
                messageID: messageID
            )
            await mergeFetchedMessages(context)
            return messages.contains(where: { $0.id == messageID })
        } catch {
            errorMessage = userFacingSendError(error, fallbackKey: "messages.loadFailed")
            return false
        }
    }

    func submitText(_ submittedText: String? = nil) {
        let sourceText = submittedText ?? inputText
        let text = sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let replyID = replyingTo?.id
        if inputText == sourceText {
            inputText = ""
        }
        replyingTo = nil

        let pending = PendingMessage(
            receiverID: contact.userID,
            msgType: "text",
            content: text,
            imageData: nil,
            videoData: nil,
            replyToID: replyID
        )
        pendingMessages.append(pending)

        let payload = ChatOutgoingPayload(
            conversationID: contact.userID,
            msgType: "text",
            content: text,
            replyToID: replyID
        )
        let outgoingJob = makeOutgoingJob(id: pending.id, payload: payload)

        Task { [weak self] in
            // The optimistic row is already published. Persist on the outbox
            // queue so the main actor can hand SwiftUI an immediate frame.
            try? await OutgoingStore.shared.createAsync(outgoingJob)
            await self?.finishTextSend(pendingID: pending.id, text: text, replyID: replyID)
        }
    }

    private func finishTextSend(pendingID: UUID, text: String, replyID: Int?) async {
        do {
            let response = try await APIService.shared.sendTextMessage(
                receiverID: contact.userID,
                content: text,
                replyToID: replyID,
                clientMessageID: pendingID.uuidString
            )
            let message = normalizedOutgoingMessage(
                response,
                expectedType: "text",
                expectedContent: text,
                replyID: replyID,
                clientMessageID: pendingID.uuidString
            )
            store.saveMessage(message)
            confirmPendingMessage(
                pendingID: pendingID,
                with: message,
                source: .apiResponse
            )
            OutgoingStore.shared.updateJob(
                id: pendingID.uuidString,
                ownerID: myID,
                state: .succeeded,
                serverID: String(message.id)
            )
            ChatDraftStore.shared.removeIfMatching(
                text: text,
                replyID: replyID,
                conversationType: "dm",
                conversationID: contact.userID
            )
        } catch {
            if scheduleTransientTextRetry(pendingID: pendingID, error: error) { return }
            markPendingMessageFailed(id: pendingID)
            OutgoingStore.shared.updateJob(
                id: pendingID.uuidString,
                ownerID: myID,
                state: .failedPermanent,
                lastErrorCode: String(describing: error)
            )
            errorMessage = userFacingSendError(error, fallbackKey: "messages.sendFailed")
        }
    }

    private func scheduleTransientTextRetry(pendingID: UUID, error: Error) -> Bool {
        guard UploadEngine.isTransient(error),
              let job = OutgoingStore.shared.jobs(ownerID: myID).first(where: { $0.id == pendingID.uuidString }),
              job.attemptCount < 5 else { return false }
        Task { await UploadEngine.shared.markRetryWaiting(jobID: job.id, ownerID: myID, error: error, attempt: job.attemptCount) }
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(min(pow(2, Double(job.attemptCount)), 30) * 1_000_000_000))
            guard let self,
                  let pending = pendingMessages.first(where: { $0.id == pendingID }),
                  OutgoingStore.shared.jobs(ownerID: myID).contains(where: { $0.id == job.id && $0.state == .retryWaiting }) else { return }
            OutgoingStore.shared.updateJob(id: job.id, ownerID: myID, state: .queued)
            await retryPending(pending)
        }
        return true
    }

    func retryPending(_ pending: PendingMessage) async {
        if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
            pendingMessages[index].status = .sending
        }

        if pending.msgType == "text" {
            await finishTextSend(pendingID: pending.id, text: pending.content, replyID: pending.replyToID)
        } else if pending.msgType == "sticker",
                  let payload = StickerMessagePayload.parse(pending.content) {
            await finishStickerSend(
                pendingID: pending.id,
                packID: payload.packID,
                stickerID: payload.stickerID,
                replyID: pending.replyToID
            )
        } else if pending.msgType == "image" {
            if let url = pending.localFileURL {
                enqueuePersistedMediaUpload(pendingID: pending.id, fileURL: url, msgType: "image", filename: pending.filename ?? "image.jpg")
            } else if let data = pending.imageData {
                enqueueImageUpload(pendingID: pending.id, data: data, filename: pending.filename ?? "image_\(pending.id.uuidString).jpg")
            }
        } else if pending.msgType == "video" {
            if let url = pending.localFileURL {
                enqueuePersistedMediaUpload(pendingID: pending.id, fileURL: url, msgType: "video", filename: pending.filename ?? "video.mp4")
            } else if let data = pending.videoData {
                enqueueVideoUpload(pendingID: pending.id, data: data, filename: pending.filename ?? "video_\(pending.id.uuidString).mp4")
            }
        }
    }

    func deletePending(_ pending: PendingMessage) {
        OutgoingRetryScheduler.shared.cancel(ownerID: myID, jobID: pending.id.uuidString)
        removePendingMessage(id: pending.id)
        Task {
            await UploadEngine.shared.cancel(
                jobID: pending.id.uuidString,
                ownerID: myID
            )
        }
    }

    func setReply(to message: Message) {
        replyingTo = message
    }

    func cancelReply() {
        replyingTo = nil
    }

    func sendSticker(pack: StickerPack, sticker: StickerItem) async {
        let replyMessage = replyingTo
        let replyID = replyMessage?.id
        let clientMessageID = UUID().uuidString
        let payload = StickerMessagePayload(pack: pack, sticker: sticker)
        let signature = stickerSignature(content: payload.encodedContent, replyID: replyID)

        replyingTo = nil
        let localMessage = makeOptimisticStickerMessage(
            content: payload.encodedContent,
            clientMessageID: clientMessageID,
            replyTo: replyMessage
        )
        optimisticStickerMessageIDs.insert(localMessage.id)
        optimisticStickerSignatures[localMessage.id] = signature
        appendMessageIfNeeded(localMessage)

        do {
            let response = try await APIService.shared.sendStickerMessage(
                receiverID: contact.userID,
                packID: pack.id,
                stickerID: sticker.id,
                replyToID: replyID,
                clientMessageID: clientMessageID
            )
            let message = normalizedOutgoingMessage(
                response,
                expectedType: "sticker",
                expectedContent: payload.encodedContent,
                replyID: replyID,
                clientMessageID: clientMessageID
            )
            store.saveMessage(message)
            appendMessageIfNeeded(
                message,
                source: .apiResponse,
                shouldMergeOutgoingEcho: true
            )
        } catch {
            removeOptimisticStickerMessage(id: localMessage.id)
            errorMessage = userFacingSendError(error, fallbackKey: "messages.stickerSendFailed")
        }
    }

    private func finishStickerSend(
        pendingID: UUID,
        packID: String,
        stickerID: String,
        replyID: Int?
    ) async {
        do {
            let response = try await APIService.shared.sendStickerMessage(
                receiverID: contact.userID,
                packID: packID,
                stickerID: stickerID,
                replyToID: replyID,
                clientMessageID: pendingID.uuidString
            )
            let message = normalizedOutgoingMessage(
                response,
                expectedType: "sticker",
                expectedContent: pendingMessages.first(where: { $0.id == pendingID })?.content,
                replyID: replyID,
                clientMessageID: pendingID.uuidString
            )
            store.saveMessage(message)
            confirmPendingMessage(
                pendingID: pendingID,
                with: message,
                source: .apiResponse
            )
        } catch {
            markPendingMessageFailed(id: pendingID)
            errorMessage = userFacingSendError(error, fallbackKey: "messages.stickerSendFailed")
        }
    }

    func sendImage(data: Data) async {
        await sendMediaBatch([
            OutgoingMediaDraft(kind: .image, data: data, filename: "image_\(UUID().uuidString).jpg")
        ])
    }

    /// Publishes the optimistic rows before doing preview, persistence, file
    /// staging, or networking. Durable jobs are an implementation detail used
    /// only for recovery; fresh sends start immediately and independently.
    func sendMediaBatch(_ drafts: [OutgoingMediaDraft]) async {
        guard !drafts.isEmpty else { return }

        let pendings = drafts.map { draft in
            PendingMessage(
                id: draft.id,
                receiverID: contact.userID,
                msgType: draft.kind == .image ? "image" : "video",
                content: "",
                imageData: draft.kind == .image ? draft.data : nil,
                videoData: draft.kind == .video ? draft.data : nil,
                localFileURL: draft.localFileURL,
                filename: draft.filename
            )
        }

        for pending in pendings {
            locallyEnqueuedMediaClientIDs.insert(pending.id.uuidString)
        }

        // Make the bubble visible in the same main-actor turn as the send.
        pendingMessages.append(contentsOf: pendings)

        // Warm only the lightweight local preview. This is deliberately not
        // awaited: the row already owns the original local bytes/file URL.
        for pending in pendings where pending.msgType == "image" {
            guard let data = pending.imageData else { continue }
            let cacheKey = "pending-media:\(pending.id.uuidString)"
            Task(priority: .userInitiated) {
                await ImageCacheManager.shared.prepareLocalPreview(data: data, for: cacheKey)
            }
        }

        for (pending, draft) in zip(pendings, drafts) {
            if pending.msgType == "image", let data = pending.imageData, let filename = pending.filename {
                enqueueImageUpload(pendingID: pending.id, data: data, filename: filename)
            } else if pending.msgType == "video",
                      let sourceURL = draft.localFileURL,
                      let filename = pending.filename {
                enqueueVideoUpload(pendingID: pending.id, sourceURL: sourceURL, filename: filename)
            } else if pending.msgType == "video", let data = pending.videoData, let filename = pending.filename {
                enqueueVideoUpload(pendingID: pending.id, data: data, filename: filename)
            }
        }
    }

    private func enqueueImageUpload(pendingID: UUID, data: Data, filename: String) {
        enqueueMediaUpload(id: "direct-media-\(pendingID.uuidString)") { [weak self] in
            guard let self else { return }
            await persistMediaJob(
                pendingID: pendingID,
                msgType: "image",
                filename: filename
            )
            do {
                let uploadData = await Task.detached(priority: .userInitiated) {
                    APIService.compressImageForUpload(data)
                }.value
                let fileURL = try await OutgoingFileStore.stage(
                    data: uploadData,
                    ownerID: myID,
                    jobID: pendingID.uuidString,
                    filename: filename
                )
                if let index = pendingMessages.firstIndex(where: { $0.id == pendingID }) {
                    pendingMessages[index].localFileURL = fileURL
                }
                await performPersistedMediaUpload(
                    pendingID: pendingID,
                    fileURL: fileURL,
                    msgType: "image",
                    filename: filename
                )
            } catch {
                await markMediaJobFailed(pendingID: pendingID, error: error, fallbackKey: "messages.imageSendFailed")
            }
        }
    }

    private func finishImageSend(pendingID: UUID, fileURL: URL, filename: String, job: OutgoingJob, part: OutgoingPart) async {
        do {
            let response = try await APIService.shared.sendImageMessage(
                receiverID: contact.userID,
                imageFileURL: fileURL,
                filename: filename,
                job: job,
                part: part
            )
            let message = normalizedOutgoingMessage(response, expectedType: "image", clientMessageID: pendingID.uuidString)
            await ImageCacheManager.shared.adoptLocalFile(
                fileURL,
                for: message.content,
                previewURL: message.thumbnailURL
            )
            store.saveMessage(message)
            confirmPendingMessage(pendingID: pendingID, with: message, source: .apiResponse)
            OutgoingStore.shared.updateJob(id: job.id, ownerID: myID, state: .succeeded, serverID: String(message.id))
        } catch {
            await markMediaJobFailed(pendingID: pendingID, error: error, fallbackKey: "messages.imageSendFailed")
        }
    }

    func sendVideo(data: Data, filename: String) async {
        await sendMediaBatch([
            OutgoingMediaDraft(kind: .video, data: data, filename: filename)
        ])
    }

    private func enqueueVideoUpload(pendingID: UUID, data: Data, filename: String) {
        enqueueMediaUpload(id: "direct-media-\(pendingID.uuidString)") { [weak self] in
            guard let self else { return }
            await persistMediaJob(
                pendingID: pendingID,
                msgType: "video",
                filename: filename
            )
            do {
                let fileURL = try await OutgoingFileStore.stage(
                    data: data,
                    ownerID: myID,
                    jobID: pendingID.uuidString,
                    filename: filename
                )
                if let index = pendingMessages.firstIndex(where: { $0.id == pendingID }) {
                    pendingMessages[index].localFileURL = fileURL
                }
                await performPersistedMediaUpload(
                    pendingID: pendingID,
                    fileURL: fileURL,
                    msgType: "video",
                    filename: filename
                )
            } catch {
                await markMediaJobFailed(pendingID: pendingID, error: error, fallbackKey: "messages.videoSendFailed")
            }
        }
    }

    private func enqueueVideoUpload(pendingID: UUID, sourceURL: URL, filename: String) {
        enqueueMediaUpload(id: "direct-media-\(pendingID.uuidString)") { [weak self] in
            guard let self else { return }
            await persistMediaJob(
                pendingID: pendingID,
                msgType: "video",
                filename: filename
            )
            do {
                let fileURL = try await OutgoingFileStore.stage(
                    file: sourceURL,
                    ownerID: myID,
                    jobID: pendingID.uuidString,
                    filename: filename
                )
                await ImageCacheManager.shared.adoptLocalVideoThumbnail(
                    fileURL,
                    for: fileURL.absoluteString
                )
                if let index = pendingMessages.firstIndex(where: { $0.id == pendingID }) {
                    pendingMessages[index].localFileURL = fileURL
                }
                removeTemporaryMediaSourceIfNeeded(sourceURL)
                await performPersistedMediaUpload(
                    pendingID: pendingID,
                    fileURL: fileURL,
                    msgType: "video",
                    filename: filename
                )
            } catch {
                removeTemporaryMediaSourceIfNeeded(sourceURL)
                await markMediaJobFailed(pendingID: pendingID, error: error, fallbackKey: "messages.videoSendFailed")
            }
        }
    }

    private func removeTemporaryMediaSourceIfNeeded(_ sourceURL: URL) {
        let temporaryRoot = FileManager.default.temporaryDirectory.standardizedFileURL.path + "/"
        guard sourceURL.standardizedFileURL.path.hasPrefix(temporaryRoot) else { return }
        try? FileManager.default.removeItem(at: sourceURL)
    }

    private func finishVideoSend(pendingID: UUID, fileURL: URL, filename: String, job: OutgoingJob, part: OutgoingPart) async {
        do {
            let response = try await APIService.shared.sendVideoMessage(
                receiverID: contact.userID,
                videoFileURL: fileURL,
                filename: filename,
                job: job,
                part: part
            )
            let message = normalizedOutgoingMessage(response, expectedType: "video", clientMessageID: pendingID.uuidString)
            MediaCacheManager.shared.adoptLocalFile(
                mediaID: "chat-video:\(message.content)",
                remoteURL: message.content,
                sourceURL: fileURL
            )
            await ImageCacheManager.shared.adoptLocalVideoThumbnail(
                fileURL,
                for: message.content,
                thumbnailURL: message.thumbnailURL
            )
            store.saveMessage(message)
            confirmPendingMessage(pendingID: pendingID, with: message, source: .apiResponse)
            OutgoingStore.shared.updateJob(id: job.id, ownerID: myID, state: .succeeded, serverID: String(message.id))
        } catch {
            await markMediaJobFailed(pendingID: pendingID, error: error, fallbackKey: "messages.videoSendFailed")
        }
    }

    private func enqueuePersistedMediaUpload(
        pendingID: UUID,
        fileURL: URL,
        msgType: String,
        filename: String
    ) {
        enqueueMediaUpload(id: "direct-media-\(pendingID.uuidString)") { [weak self] in
            guard let self else { return }
            await performPersistedMediaUpload(
                pendingID: pendingID,
                fileURL: fileURL,
                msgType: msgType,
                filename: filename
            )
        }
    }

    private func enqueueMediaUpload(
        id: String,
        _ operation: @escaping @MainActor () async -> Void
    ) {
        // URLSession controls host concurrency. Do not serialize unrelated
        // media messages behind one large video or slow iCloud asset.
        BackgroundUploadCoordinator.shared.enqueue(id: id, operation: operation)
    }

    private func persistMediaJob(
        pendingID: UUID,
        msgType: String,
        filename: String
    ) async {
        let payload = ChatOutgoingPayload(
            conversationID: contact.userID,
            msgType: msgType,
            filename: filename
        )
        try? await OutgoingStore.shared.createAsync(
            makeOutgoingJob(id: pendingID, payload: payload, state: .staging)
        )
    }

    private func performPersistedMediaUpload(
        pendingID: UUID,
        fileURL: URL,
        msgType: String,
        filename: String
    ) async {
        let payload = ChatOutgoingPayload(conversationID: contact.userID, msgType: msgType, filename: filename)
        let job = makeOutgoingJob(id: pendingID, payload: payload)
        let values = try? fileURL.resourceValues(forKeys: [.fileSizeKey])
        let newPart = OutgoingPart(
            jobID: job.id,
            role: msgType,
            ordinal: 0,
            localRelativePath: OutgoingFileStore.relativePath(for: fileURL),
            filename: filename,
            mimeType: msgType == "image" ? "image/jpeg" : "video/mp4",
            byteSize: Int64(values?.fileSize ?? 0),
            state: .queued
        )
        let part = OutgoingStore.shared.parts(jobID: job.id).first ?? newPart
        do {
            try await UploadEngine.shared.enqueue(job: job, parts: [part])
            if msgType == "image" {
                await finishImageSend(pendingID: pendingID, fileURL: fileURL, filename: filename, job: job, part: part)
            } else {
                await finishVideoSend(pendingID: pendingID, fileURL: fileURL, filename: filename, job: job, part: part)
            }
        } catch {
            await markMediaJobFailed(
                pendingID: pendingID,
                error: error,
                fallbackKey: msgType == "image" ? "messages.imageSendFailed" : "messages.videoSendFailed"
            )
        }
    }

    private func markMediaJobFailed(pendingID: UUID, error: Error, fallbackKey: String) async {
        if await scheduleTransientRetry(pendingID: pendingID, error: error) { return }
        markPendingMessageFailed(id: pendingID)
        OutgoingStore.shared.updateJob(
            id: pendingID.uuidString,
            ownerID: myID,
            state: .failedPermanent,
            lastErrorCode: String(describing: error)
        )
        errorMessage = userFacingSendError(error, fallbackKey: fallbackKey)
    }

    private func scheduleTransientRetry(pendingID: UUID, error: Error) async -> Bool {
        guard var job = OutgoingStore.shared.jobs(ownerID: myID).first(where: { $0.id == pendingID.uuidString }),
              OutgoingRetryPolicy.shouldRetry(job: job, error: error) else { return false }
        if job.state != .retryWaiting {
            await UploadEngine.shared.markRetryWaiting(
                jobID: job.id,
                ownerID: myID,
                error: error,
                attempt: job.attemptCount
            )
            guard let refreshed = OutgoingStore.shared.jobs(ownerID: myID)
                .first(where: { $0.id == pendingID.uuidString }) else { return false }
            job = refreshed
        }
        scheduleDurableRetry(job: job, pendingID: pendingID)
        return true
    }

    private func scheduleDurableRetry(job: OutgoingJob, pendingID: UUID) {
        OutgoingRetryScheduler.shared.schedule(
            ownerID: myID,
            jobID: job.id,
            notBefore: OutgoingRetryPolicy.scheduledDate(for: job)
        ) { [self] in
            guard AuthManager.shared.currentUser?.userID == myID,
                  let pending = pendingMessages.first(where: { $0.id == pendingID }),
                  OutgoingStore.shared.jobs(ownerID: myID).contains(where: {
                      $0.id == job.id && ($0.state == .retryWaiting || $0.state == .confirmationUnknown)
                  }) else { return }
            await retryPending(pending)
        }
    }

    func sendVoice(data: Data, duration: Double) async {
        isSending = true

        let pending = PendingMessage(
            receiverID: contact.userID,
            msgType: "voice",
            content: "",
            voiceData: data,
            voiceDuration: duration
        )
        pendingMessages.append(pending)

        do {
            let response = try await APIService.shared.sendVoiceMessage(
                receiverID: contact.userID,
                voiceData: data,
                duration: duration,
                filename: "voice_\(Int(Date().timeIntervalSince1970)).m4a"
            )
            let message = normalizedOutgoingMessage(
                response,
                expectedType: "voice",
                clientMessageID: pending.id.uuidString
            )
            store.saveMessage(message)
            confirmPendingMessage(
                pendingID: pending.id,
                with: message,
                source: .apiResponse
            )
        } catch {
            if let index = pendingMessages.firstIndex(where: { $0.id == pending.id }) {
                pendingMessages[index].status = .failed
            }
            errorMessage = userFacingSendError(error, fallbackKey: "messages.voiceSendFailed")
        }

        isSending = false
    }

    func sendGift(_ gift: GiftCatalogItem) async throws {
        guard contact.userID != AuthManager.shared.currentUser?.userID else {
            throw APIError.serverError(code: 400, message: L10n.tr("gift.cannotSendToSelf"))
        }

        // A failed/ambiguous response keeps the same key so a retry cannot
        // double-charge a gift the server may already have accepted.
        let idempotencyScope = "\(contact.userID)|\(gift.giftID)"
        let idempotencyKey = giftIdempotencyKeys[idempotencyScope] ?? UUID()
        giftIdempotencyKeys[idempotencyScope] = idempotencyKey

        let response = try await APIService.shared.sendGiftMessage(
            receiverID: contact.userID,
            giftID: gift.giftID,
            idempotencyKey: idempotencyKey
        )
        giftIdempotencyKeys.removeValue(forKey: idempotencyScope)
        let message = normalizedOutgoingMessage(response, expectedType: "gift")
        store.saveMessage(message)
        appendMessageIfNeeded(
            message,
            source: .apiResponse,
            shouldMergeOutgoingEcho: true
        )
        Task { await WalletStore.shared.refreshBalanceFromServer() }
    }

    func appendCreatedChatMoneyMessage(_ result: ChatMoneyCreationResult) {
        guard case .direct(let response) = result.message else { return }
        let message = response.replacingChatMoneyPayload(result.payload)
        store.saveMessage(message)
        appendMessageIfNeeded(
            message,
            source: .apiResponse,
            shouldMergeOutgoingEcho: true
        )
    }

    var isSendEnabled: Bool {
        !inputText.isBlank
    }

    /// Pending and confirmed messages are intentionally stored separately, but
    /// they must never be rendered together once either delivery channel has
    /// confirmed the same local send operation.
    var visiblePendingMessages: [PendingMessage] {
        visiblePendingMessages(from: pendingMessages)
    }

    func visiblePendingMessages(
        from candidates: [PendingMessage],
        confirmedBy confirmedMessages: [Message]? = nil
    ) -> [PendingMessage] {
        let confirmedMessages = confirmedMessages ?? messages
        let confirmedClientIDs = Set(confirmedMessages.compactMap(\.clientMessageID))
        let legacyMessages = confirmedMessages.filter { $0.clientMessageID == nil }
        return candidates.filter { pending in
            guard !confirmedClientIDs.contains(pending.id.uuidString) else { return false }
            return !legacyMessages.contains { confirmedMessage($0, matches: pending) }
        }
    }

    func isLocalMediaAcknowledgement(_ message: Message) -> Bool {
        guard ["image", "video"].contains(normalizedMessageType(message.msgType)),
              let clientMessageID = message.clientMessageID else { return false }
        return locallyEnqueuedMediaClientIDs.contains(clientMessageID)
    }

    func markConversationAsReadOnServer(throughMessageID: Int? = nil) {
        Task {
            do {
                let receipt = try await APIService.shared.markMessagesAsRead(
                    contactID: contact.userID,
                    throughMessageID: throughMessageID
                )
                if let receipt, receipt.isMeaningful {
                    await MainActor.run {
                        UnreadBadgeStore.shared.applyReadReceipt(receipt)
                    }
                } else if throughMessageID == nil {
                    await MainActor.run {
                        UnreadBadgeStore.shared.setConversationUnreadCount(
                            0,
                            for: ConversationReadTarget.direct(userID: contact.userID).listIdentity
                        )
                    }
                }
                await MainActor.run {
                    AppMessageSyncCoordinator.shared.requestSync(.notification)
                }
            } catch {
                // A failed read request is not interpreted as zero unread.
            }
            await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
        }
    }

    func setReadingLatest(_ value: Bool) {
        isReadingLatest = value
    }

    private func setupWebSocketListener() {
        WebSocketService.shared.newMessagePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                guard let self = self else { return }
                let isRelevant = (message.senderID == self.contact.userID &&
                                  message.receiverID == AuthManager.shared.currentUser?.userID) ||
                                 (message.senderID == AuthManager.shared.currentUser?.userID &&
                                  message.receiverID == self.contact.userID)
                if isRelevant {
                    if message.senderID == AuthManager.shared.currentUser?.userID,
                       ["image", "video"].contains(self.normalizedMessageType(message.msgType)),
                       let pending = self.pendingMessages.first(where: {
                           self.pendingMessage($0, matches: message)
                       }),
                       let localFileURL = pending.localFileURL {
                        // The WebSocket echo can beat the HTTP response. Keep
                        // rendering the local row until both image cache keys
                        // have been seeded, then confirm it in place.
                        Task { [weak self] in
                            guard let self else { return }
                            if self.normalizedMessageType(message.msgType) == "image" {
                                await ImageCacheManager.shared.adoptLocalFile(
                                    localFileURL,
                                    for: message.content,
                                    previewURL: message.thumbnailURL
                                )
                            } else {
                                MediaCacheManager.shared.adoptLocalFile(
                                    mediaID: "chat-video:\(message.content)",
                                    remoteURL: message.content,
                                    sourceURL: localFileURL
                                )
                                await ImageCacheManager.shared.adoptLocalVideoThumbnail(
                                    localFileURL,
                                    for: message.content,
                                    thumbnailURL: message.thumbnailURL
                                )
                            }
                            self.store.saveMessage(message)
                            self.confirmPendingMessage(
                                pendingID: pending.id,
                                with: message,
                                source: .webSocket
                            )
                        }
                        return
                    }
                    if message.senderID == AuthManager.shared.currentUser?.userID {
                        self.store.saveMessage(message)
                        self.appendMessageIfNeeded(
                            message,
                            source: .webSocket,
                            shouldMergeOutgoingEcho: true
                        )
                        _ = self.removeFirstPendingMessage {
                            self.pendingMessage($0, matches: message)
                        }
                    } else {
                        self.publishIncomingMessageAfterPreviewWarmup(message)
                    }
                }
            }
            .store(in: &cancellables)

        WebSocketService.shared.contactUpdatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self = self,
                      self.isRelevantContactUpdate(data) else { return }
                Task { await self.syncLatestMessages() }
            }
            .store(in: &cancellables)

        WebSocketService.shared.chatMoneyUpdatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] update in
                guard let self else { return }
                if let receipt = update.directReceiptMessage {
                    let relevant = (receipt.senderID == self.contact.userID && receipt.receiverID == self.myID)
                        || (receipt.senderID == self.myID && receipt.receiverID == self.contact.userID)
                    if relevant {
                        self.store.saveMessage(receipt)
                        self.appendMessageIfNeeded(receipt, source: .webSocket)
                    }
                }
                if let current = self.messages.first(where: {
                    $0.chatMoneyPayload?.assetID == update.payload.assetID
                })?.chatMoneyPayload,
                   current.version >= update.payload.version {
                    return
                }
                if let replacement = update.directMessage {
                    let relevant = (replacement.senderID == self.contact.userID && replacement.receiverID == self.myID)
                        || (replacement.senderID == self.myID && replacement.receiverID == self.contact.userID)
                    guard relevant else { return }
                    self.store.saveMessage(replacement)
                    if let index = self.messages.firstIndex(where: { $0.id == replacement.id }) {
                        self.messages[index] = replacement
                    } else {
                        self.appendMessageIfNeeded(replacement, source: .webSocket)
                    }
                    return
                }
                guard let index = self.messages.firstIndex(where: {
                    $0.chatMoneyPayload?.assetID == update.payload.assetID
                }) else { return }
                let replacement = self.messages[index].replacingChatMoneyPayload(update.payload)
                self.messages[index] = replacement
                self.store.saveMessage(replacement)
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .conversationListNeedsReload)
            .debounce(for: .milliseconds(250), scheduler: DispatchQueue.main)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { await self?.syncLatestMessages() }
            }
            .store(in: &cancellables)

        WebSocketService.shared.chatResetPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in
                self?.messages.removeAll()
                self?.pendingMessages.removeAll()
                self?.apiConfirmedMessageIDs.removeAll()
                self?.webSocketConfirmedMessageIDs.removeAll()
            }
            .store(in: &cancellables)
    }

    private func setupOutboxRecoveryListener() {
        NotificationCenter.default.publisher(for: .outgoingUploadNeedsRecovery)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self,
                      notification.object as? String == self.myID,
                      let jobID = notification.userInfo?["job_id"] as? String,
                      self.pendingMessages.contains(where: { $0.id.uuidString == jobID }) else { return }
                Task { [weak self] in
                    await self?.resumeDurableOutboxIfNeeded()
                }
            }
            .store(in: &cancellables)
    }

    private func syncLatestMessages() async {
        guard !isSyncingLatest else { return }
        isSyncingLatest = true
        defer { isSyncingLatest = false }

        let isActivelyVisible = WebSocketService.shared.activeChatUserID == contact.userID
            && isReadingLatest
        if isActivelyVisible {
            UnreadBadgeStore.shared.setConversationUnreadCount(
                0,
                for: ConversationReadTarget.direct(userID: contact.userID).listIdentity
            )
        }

        let latestID = await store.latestMessageIDAsync(
            userID: myID,
            contactID: contact.userID
        )
        do {
            var fetched: [Message] = []
            if let latestID {
                fetched.append(contentsOf: try await fetchNewerMessages(afterID: latestID))
            }
            fetched.append(contentsOf: try await fetchRecentMessages())
            await mergeFetchedMessages(fetched)

            if isActivelyVisible, WebSocketService.shared.activeChatUserID == contact.userID {
                _ = try? await APIService.shared.markMessagesAsRead(
                    contactID: contact.userID,
                    throughMessageID: messages.last?.id
                )
                PushService.shared.syncBadgeFromUnreadState()
            }
        } catch {
            print("[Chat] Failed to sync latest: \(error)")
        }
    }

    private func fetchNewerMessages(afterID latestID: Int) async throws -> [Message] {
        var allNew: [Message] = []
        var fetchMore = true
        var currentAfterID = latestID
        while fetchMore {
            let (msgs, more) = try await APIService.shared.getMessages(
                contactID: contact.userID,
                afterID: currentAfterID,
                limit: 100
            )
            allNew.append(contentsOf: msgs)
            fetchMore = more && !msgs.isEmpty
            if let last = msgs.last {
                currentAfterID = last.id
            }
        }
        return allNew
    }

    private func fetchRecentMessages() async throws -> [Message] {
        let (msgs, _) = try await APIService.shared.getMessages(
            contactID: contact.userID,
            limit: 100
        )
        return msgs
    }

    private func mergeFetchedMessages(_ fetched: [Message]) async {
        guard !fetched.isEmpty else { return }
        let previewRequests = fetched.compactMap(Self.mediaPreviewRequest)
        ChatMediaPreviewPreloader.schedule(previewRequests, limit: 12)
        await store.saveMessagesAsync(fetched, ownerID: myID)
        appendMessagesIfNeeded(
            fetched,
            source: .history,
            shouldMergeOutgoingEcho: true
        )
    }

    private static func mediaPreviewRequest(_ message: Message) -> ChatMediaPreviewRequest? {
        ChatMediaPreviewRequest.resolve(
            messageType: message.msgType,
            content: message.content,
            thumbnailURL: message.thumbnailURL
        )
    }

    private func publishIncomingMessageAfterPreviewWarmup(_ message: Message) {
        // WebSocketService has already persisted the message and started the
        // same shared-cache request before publishing it to this view model.
        guard let request = Self.mediaPreviewRequest(message) else {
            publishIncomingMessage(message)
            return
        }
        ChatMediaPreviewPreloader.schedule([request], limit: 1)
        publishIncomingMessage(message)
    }

    private func publishIncomingMessage(_ message: Message) {
        appendMessageIfNeeded(message, source: .webSocket)
        guard WebSocketService.shared.activeChatUserID == contact.userID,
              isReadingLatest else { return }
        UnreadBadgeStore.shared.setConversationUnreadCount(
            0,
            for: ConversationReadTarget.direct(userID: contact.userID).listIdentity
        )
        Task {
            _ = try? await APIService.shared.markMessagesAsRead(
                contactID: contact.userID,
                throughMessageID: message.id
            )
            await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
        }
    }

    private func appendMessageIfNeeded(
        _ message: Message,
        source: MessageSource = .history,
        shouldMergeOutgoingEcho: Bool = false
    ) {
        appendMessagesIfNeeded(
            [message],
            source: source,
            shouldMergeOutgoingEcho: shouldMergeOutgoingEcho
        )
    }

    /// Replace an optimistic projection without an empty render pass or an
    /// inherited SwiftUI animation. Both rows share the client ID, so this is
    /// one delivery acknowledgement rather than a second visual insertion.
    private func confirmPendingMessage(
        pendingID: UUID,
        with message: Message,
        source: MessageSource
    ) {
        OutgoingRetryScheduler.shared.cancel(ownerID: myID, jobID: pendingID.uuidString)
        OutgoingStore.shared.updateJob(
            id: pendingID.uuidString,
            ownerID: myID,
            state: .succeeded,
            serverID: String(message.id)
        )
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            appendMessageIfNeeded(
                message,
                source: source,
                shouldMergeOutgoingEcho: true
            )
            removePendingMessage(id: pendingID)
        }
    }

    private func nextLocalStickerMessageID() -> Int {
        let id = nextOptimisticMessageID
        nextOptimisticMessageID += 1
        return id
    }

    private func makeOptimisticStickerMessage(
        content: String,
        clientMessageID: String,
        replyTo: Message?
    ) -> Message {
        Message(
            id: nextLocalStickerMessageID(),
            senderID: myID,
            receiverID: contact.userID,
            msgType: "sticker",
            content: content,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            replyToID: replyTo?.id,
            replyTo: replyTo.map {
                ReplyPreview(
                    id: $0.id,
                    senderID: $0.senderID,
                    msgType: $0.msgType,
                    content: $0.content
                )
            },
            clientMessageID: clientMessageID
        )
    }

    private func removeOptimisticStickerMessage(id: Int) {
        clearOptimisticStickerTracking(id)
        messages.removeAll { $0.id == id }
    }

    private func clearOptimisticStickerTracking(_ id: Int) {
        optimisticStickerMessageIDs.remove(id)
        optimisticStickerSignatures.removeValue(forKey: id)
    }

    private func optimisticStickerIndex(for message: Message) -> Int? {
        guard message.senderID == myID,
              message.receiverID == contact.userID,
              message.msgType == "sticker" else {
            return nil
        }
        if let clientMessageID = ChatTimelineIdentity.resolvedClientMessageID(
            primary: message.clientMessageID
        ), let exactIndex = messages.lastIndex(where: { existing in
            optimisticStickerMessageIDs.contains(existing.id)
                && ChatTimelineIdentity.resolvedClientMessageID(
                    primary: existing.clientMessageID
                ) == clientMessageID
        }) {
            return exactIndex
        }
        let incomingSignature = stickerSignature(
            content: message.content,
            replyID: replyTargetID(for: message)
        )

        return messages.lastIndex { existing in
            guard optimisticStickerMessageIDs.contains(existing.id),
                  existing.senderID == message.senderID,
                  existing.receiverID == message.receiverID,
                  existing.msgType == message.msgType,
                  timestampsAreClose(existing.timestamp, message.timestamp) else {
                return false
            }

            let existingSignature = optimisticStickerSignatures[existing.id]
                ?? stickerSignature(content: existing.content, replyID: replyTargetID(for: existing))
            return stickerSignaturesMatch(existingSignature, incomingSignature)
        }
    }

    private func stickerSignature(content: String, replyID: Int?) -> StickerSendSignature {
        if let payload = StickerMessagePayload.parse(content) {
            return StickerSendSignature(
                stickerID: payload.stickerID,
                packID: payload.packID,
                assetKey: payload.assetKey,
                replyID: replyID
            )
        }
        return StickerSendSignature(
            stickerID: content,
            packID: "",
            assetKey: content,
            replyID: replyID
        )
    }

    private func stickerSignaturesMatch(
        _ lhs: StickerSendSignature,
        _ rhs: StickerSendSignature
    ) -> Bool {
        guard lhs.replyID == rhs.replyID else { return false }
        if !lhs.packID.isEmpty, !rhs.packID.isEmpty, lhs.packID != rhs.packID {
            return false
        }
        return lhs.stickerID == rhs.stickerID
            || lhs.assetKey == rhs.assetKey
            || lhs.stickerID == rhs.assetKey
            || lhs.assetKey == rhs.stickerID
    }

    private func replyTargetID(for message: Message) -> Int? {
        message.replyToID ?? message.replyTo?.id
    }

    private func normalizedOutgoingMessage(
        _ message: Message,
        expectedType: String,
        expectedContent: String? = nil,
        replyID: Int? = nil,
        clientMessageID: String? = nil
    ) -> Message {
        let resolvedContent = message.content.isBlank
            ? (expectedContent ?? message.content)
            : message.content
        let content = normalizedMessageType(expectedType) == "text"
            ? resolvedContent.trimmingTrailingLineBreaks
            : resolvedContent
        return Message(
            id: message.id,
            senderID: myID,
            receiverID: contact.userID,
            msgType: expectedType,
            content: content,
            timestamp: message.timestamp.isBlank
                ? ISO8601DateFormatter().string(from: Date())
                : message.timestamp,
            replyToID: message.replyToID ?? replyID,
            replyTo: message.replyTo,
            clientMessageID: message.clientMessageID ?? clientMessageID,
            version: message.version,
            updatedAt: message.updatedAt,
            thumbnailURL: message.thumbnailURL
        )
    }

    private func timestampsAreClose(_ lhs: String, _ rhs: String) -> Bool {
        guard lhs != rhs else { return true }
        guard let lhsDate = TimestampHelper.parse(lhs),
              let rhsDate = TimestampHelper.parse(rhs) else {
            return false
        }
        return abs(lhsDate.timeIntervalSince(rhsDate)) <= 30
    }

    private func pendingMessage(_ pending: PendingMessage, matches message: Message) -> Bool {
        if message.clientMessageID == pending.id.uuidString { return true }
        guard pending.receiverID == contact.userID,
              normalizedMessageType(pending.msgType) == normalizedMessageType(message.msgType),
              pendingReplyMatches(pending.replyToID, replyTargetID(for: message)),
              pendingTimestampMatches(pending, message: message) else {
            return false
        }

        if pending.msgType == "sticker" {
            return stickerSignaturesMatch(
                stickerSignature(content: pending.content, replyID: pending.replyToID),
                stickerSignature(content: message.content, replyID: replyTargetID(for: message))
            )
        }
        if pending.msgType == "text" {
            return pending.content == message.content
        }
        return true
    }

    private func confirmedMessage(_ message: Message, matches pending: PendingMessage) -> Bool {
        guard isOwnOutgoing(message) else { return false }
        return pendingMessage(pending, matches: message)
    }

    private func pendingReplyMatches(_ pendingReplyID: Int?, _ messageReplyID: Int?) -> Bool {
        pendingReplyID == messageReplyID || messageReplyID == nil
    }

    private func pendingTimestampMatches(_ pending: PendingMessage, message: Message) -> Bool {
        if let messageDate = TimestampHelper.parse(message.timestamp) {
            let delta = messageDate.timeIntervalSince(pending.createdAt)
            return delta >= -2 && delta <= 90
        }
        return abs(Date().timeIntervalSince(pending.createdAt)) <= 90
    }

    private func normalizedMessageType(_ value: String) -> String {
        MessageDeliveryMatcher.normalizedType(value)
    }

    private func removePendingMessage(id: UUID) {
        pendingMessages.removeAll { $0.id == id }
    }

    private func markPendingMessageFailed(id: UUID) {
        if let index = pendingMessages.firstIndex(where: { $0.id == id }) {
            pendingMessages[index].status = .failed
        }
    }

    @discardableResult
    private func removeFirstPendingMessage(matching predicate: (PendingMessage) -> Bool) -> Bool {
        if let index = pendingMessages.firstIndex(where: predicate) {
            pendingMessages.remove(at: index)
            return true
        }
        return false
    }

    private func appendMessagesIfNeeded(
        _ newMessages: [Message],
        source: MessageSource = .history,
        shouldMergeOutgoingEcho: Bool = false
    ) {
        var changed = false
        var requiresSort = false
        for message in newMessages {
            guard !store.isDirectMessageHidden(
                ownerID: myID,
                contactID: contact.userID,
                messageID: message.id
            ) else { continue }
            markConfirmed(message.id, source: source)

            if let existingIndex = messages.firstIndex(where: { $0.id == message.id }) {
                let stabilized = message.inheritingClientMessageID(
                    messages[existingIndex].clientMessageID
                )
                if messages[existingIndex] != stabilized {
                    messages[existingIndex] = stabilized
                    changed = true
                }
                continue
            }

            if let optimisticIndex = optimisticStickerIndex(for: message) {
                let localMessage = messages[optimisticIndex]
                let localID = localMessage.id
                clearOptimisticStickerTracking(localID)
                messages[optimisticIndex] = message.inheritingClientMessageID(
                    localMessage.clientMessageID
                )
                changed = true
                continue
            }

            if shouldMergeOutgoingEcho,
               let echoIndex = outgoingEchoIndex(for: message, source: source) {
                let existing = messages[echoIndex]
                let stableClientMessageID = ChatTimelineIdentity.resolvedClientMessageID(
                    primary: existing.clientMessageID,
                    fallback: message.clientMessageID
                )
                let preferred = preferredMessage(
                    existing: existing,
                    incoming: message,
                    source: source
                ).inheritingClientMessageID(stableClientMessageID)

                clearDeliveryTracking(for: existing.id, unlessKeeping: preferred.id)
                clearDeliveryTracking(for: message.id, unlessKeeping: preferred.id)
                if preferred.id == message.id {
                    markConfirmed(preferred.id, source: source)
                }
                if existing.id != message.id {
                    store.deleteMessage(
                        id: preferred.id == existing.id ? message.id : existing.id,
                        ownerID: myID
                    )
                }
                messages[echoIndex] = preferred
                changed = true
                continue
            }

            messages.append(message)
            changed = true
            requiresSort = true
        }
        guard changed else { return }
        // Acknowledgement replaces one row in place. Sorting that unchanged
        // position would publish a second array mutation and visibly refresh
        // the sticker bubble after upload succeeds.
        if requiresSort {
            sortMessagesForDisplay()
        }
        if source == .apiResponse {
            newMessages.forEach {
                NotificationCenter.default.post(name: .conversationPreviewDidChange, object: $0)
            }
        }
    }

    private func outgoingEchoIndex(for message: Message, source: MessageSource) -> Int? {
        guard isOwnOutgoing(message) else { return nil }

        if let clientMessageID = ChatTimelineIdentity.resolvedClientMessageID(
            primary: message.clientMessageID
        ), let exactIndex = messages.lastIndex(where: { existing in
            existing.id != message.id
                && isOwnOutgoing(existing)
                && ChatTimelineIdentity.resolvedClientMessageID(
                    primary: existing.clientMessageID
                ) == clientMessageID
        }) {
            return exactIndex
        }

        return messages.lastIndex { existing in
            guard existing.id != message.id,
                  isOwnOutgoing(existing),
                  normalizedMessageType(existing.msgType) == normalizedMessageType(message.msgType),
                  replyTargetID(for: existing) == replyTargetID(for: message),
                  timestampsAreClose(existing.timestamp, message.timestamp),
                  isEligibleEcho(existing.id, for: source) else {
                return false
            }

            if message.msgType == "sticker" {
                return stickerSignaturesMatch(
                    stickerSignature(content: existing.content, replyID: replyTargetID(for: existing)),
                    stickerSignature(content: message.content, replyID: replyTargetID(for: message))
                )
            }
            return outgoingContentsMatch(existing, message)
        }
    }

    private func outgoingContentsMatch(_ lhs: Message, _ rhs: Message) -> Bool {
        let type = normalizedMessageType(lhs.msgType)
        guard type == normalizedMessageType(rhs.msgType) else { return false }
        return MessageDeliveryMatcher.contentsMatch(
            type: type,
            lhs: lhs.content,
            rhs: rhs.content
        )
    }

    private func isEligibleEcho(_ existingID: Int, for source: MessageSource) -> Bool {
        switch source {
        case .apiResponse:
            return webSocketConfirmedMessageIDs.contains(existingID)
                || optimisticStickerMessageIDs.contains(existingID)
        case .webSocket:
            return apiConfirmedMessageIDs.contains(existingID)
                || optimisticStickerMessageIDs.contains(existingID)
        case .history:
            return apiConfirmedMessageIDs.contains(existingID)
                || webSocketConfirmedMessageIDs.contains(existingID)
                || optimisticStickerMessageIDs.contains(existingID)
        }
    }

    private func preferredMessage(
        existing: Message,
        incoming: Message,
        source: MessageSource
    ) -> Message {
        if existing.id > 0, incoming.id <= 0 {
            return existing
        }
        if source == .webSocket, apiConfirmedMessageIDs.contains(existing.id) {
            return existing
        }
        return incoming
    }

    private func isOwnOutgoing(_ message: Message) -> Bool {
        message.senderID == myID && message.receiverID == contact.userID
    }

    private func markConfirmed(_ id: Int, source: MessageSource) {
        switch source {
        case .apiResponse:
            apiConfirmedMessageIDs.insert(id)
        case .webSocket:
            webSocketConfirmedMessageIDs.insert(id)
        case .history:
            break
        }
    }

    private func clearDeliveryTracking(for id: Int, unlessKeeping keptID: Int) {
        guard id != keptID else { return }
        apiConfirmedMessageIDs.remove(id)
        webSocketConfirmedMessageIDs.remove(id)
        clearOptimisticStickerTracking(id)
    }

    private func sortMessagesForDisplay() {
        messages.sort { lhs, rhs in
            if !optimisticStickerMessageIDs.isEmpty,
               let lhsDate = TimestampHelper.parse(lhs.timestamp),
               let rhsDate = TimestampHelper.parse(rhs.timestamp),
               lhsDate != rhsDate {
                return lhsDate < rhsDate
            }

            return lhs.id < rhs.id
        }
    }

    private func isRelevantContactUpdate(_ data: [String: Any]) -> Bool {
        guard let senderID = Self.stringValue(data["sender_id"]),
              let receiverID = Self.stringValue(data["receiver_id"]) else { return false }
        let myID = AuthManager.shared.currentUser?.userID
        return (senderID == contact.userID && receiverID == myID)
            || (senderID == myID && receiverID == contact.userID)
    }

    private static func stringValue(_ value: Any?) -> String? {
        if let string = value as? String { return string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }
}
