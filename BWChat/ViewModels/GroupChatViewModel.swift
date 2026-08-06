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
    @Published var pendingStickers: [PendingGroupSticker] = []
    @Published var pendingMedia: [PendingGroupMedia] = []
    @Published var replyingTo: GroupMessage?
    @Published var showMentionPicker = false
    @Published var mentionAlertMessage: GroupMessage?

    let group: ChatGroup
    private let ownerID: String
    private var cancellables = Set<AnyCancellable>()
    private let store = MessageStore.shared
    private var isSyncingLatest = false
    private var apiConfirmedMessageIDs = Set<Int>()
    private var webSocketConfirmedMessageIDs = Set<Int>()
    private var isReadingLatest = true
    private var nextOptimisticMessageID = Int.max / 4
    private var optimisticStickerMessageIDs = Set<Int>()
    private var optimisticStickerSignatures: [Int: StickerSendSignature] = [:]
    private var locallyEnqueuedMediaClientIDs = Set<String>()
    private var giftIdempotencyKeys: [String: UUID] = [:]

    private enum GroupMessageSource {
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

    // Per-group "we've already backfilled the full server history" flag.
    // Persisted across launches so we only do the one-time backfill once
    // per group per install. Cleared on logout via LocalCache.clear().
    private var backfilledKey: String {
        "bbchat.group_backfilled.\(AuthManager.shared.currentUser?.userID ?? "locked")"
    }

    private var isBackfilled: Bool {
        let ids = UserDefaults.standard.array(forKey: backfilledKey) as? [Int] ?? []
        return ids.contains(group.groupID)
    }

    private func markBackfilled() {
        var ids = UserDefaults.standard.array(forKey: backfilledKey) as? [Int] ?? []
        if !ids.contains(group.groupID) {
            ids.append(group.groupID)
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

    init(group: ChatGroup) {
        self.group = group
        self.ownerID = AuthManager.shared.currentUser?.userID ?? ""
        let initial = store.loadGroupMessages(ownerID: ownerID, groupID: group.groupID)
        _messages = Published(initialValue: initial)
        let restored = Self.restorePending(ownerID: ownerID, groupID: group.groupID)
        _pendingTexts = Published(initialValue: restored.texts)
        _pendingMedia = Published(initialValue: restored.media)
        locallyEnqueuedMediaClientIDs = Set(restored.media.map(\.id))
        if !initial.isEmpty {
            _hasMore = Published(initialValue: initial.count >= 30)
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
            ownerID: ownerID,
            jobIDs: Set(pendingTexts.map(\.id) + pendingMedia.map(\.id))
        )
        let jobs = OutgoingStore.shared.jobs(ownerID: ownerID).filter {
            $0.scene == .groupMessage && $0.businessKey == String(group.groupID)
        }
        let jobsByID = Dictionary(uniqueKeysWithValues: jobs.map { ($0.id, $0) })

        for pending in pendingTexts {
            guard let job = jobsByID[pending.id] else { continue }
            switch job.state {
            case .staging, .queued, .preparing:
                await retryPendingText(pending)
            case .retryWaiting where job.nextAttemptAt.map({ $0 <= Date() }) ?? true:
                await retryPendingText(pending)
            case .failedPermanent:
                markPendingTextFailed(id: pending.id)
            default:
                break
            }
        }

        for pending in pendingMedia {
            guard let job = jobsByID[pending.id] else { continue }
            switch job.state {
            case .staging, .queued, .preparing:
                retryPendingMedia(pending)
            case .retryWaiting:
                if job.attemptCount < OutgoingRetryPolicy.maximumAutomaticAttempts {
                    scheduleDurableMediaRetry(job: job, pendingID: pending.id)
                } else {
                    markPendingMediaFailed(id: pending.id)
                    OutgoingStore.shared.updateJob(
                        id: job.id,
                        ownerID: ownerID,
                        state: .failedPermanent,
                        lastErrorCode: job.lastErrorCode
                    )
                }
            case .confirmationUnknown:
                _ = await scheduleTransientMediaRetry(
                    pendingID: pending.id,
                    error: URLError(.networkConnectionLost)
                )
            case .failedPermanent:
                markPendingMediaFailed(id: pending.id)
            case .uploading, .committing, .cancelled, .succeeded:
                break
            }
        }
    }

    private static func restorePending(ownerID: String, groupID: Int) -> (texts: [PendingGroupText], media: [PendingGroupMedia]) {
        guard !ownerID.isEmpty else { return ([], []) }
        var texts: [PendingGroupText] = []
        var media: [PendingGroupMedia] = []
        for job in OutgoingStore.shared.jobs(ownerID: ownerID) {
            guard job.scene == .groupMessage,
                  job.businessKey == String(groupID),
                  job.state != .succeeded,
                  job.state != .cancelled,
                  let payload = try? JSONDecoder().decode(ChatOutgoingPayload.self, from: job.payload) else { continue }
            if payload.msgType == "text" {
                texts.append(PendingGroupText(
                    id: job.id,
                    content: payload.content,
                    replyID: payload.replyToID,
                    mentions: payload.mentions,
                    mentionAll: payload.mentionAll,
                    status: job.state.isUserVisibleFailure ? .failed : .sending,
                    createdAt: job.createdAt
                ))
            } else if payload.msgType == "image" || payload.msgType == "video" {
                let part = OutgoingStore.shared.parts(jobID: job.id).first
                media.append(PendingGroupMedia(
                    id: job.id,
                    msgType: payload.msgType,
                    data: nil,
                    localFileURL: part.map { OutgoingFileStore.absoluteURL(for: $0.localRelativePath) },
                    filename: payload.filename ?? (payload.msgType == "image" ? "image.jpg" : "video.mp4"),
                    createdAt: job.createdAt,
                    status: job.state.isUserVisibleFailure ? .failed : .sending
                ))
            }
        }
        return (texts, media)
    }

    private func makeOutgoingJob(id: String, payload: ChatOutgoingPayload, state: OutgoingState = .queued) -> OutgoingJob {
        OutgoingJob(
            clientRequestID: id,
            ownerID: ownerID,
            scene: .groupMessage,
            businessKey: String(group.groupID),
            payload: (try? JSONEncoder().encode(payload)) ?? Data(),
            state: state
        )
    }

    func loadMessages() async {
        let showBlockingLoader = messages.isEmpty
        if showBlockingLoader { isLoading = true }
        defer { isLoading = false }

        let cached = await store.loadGroupMessagesAsync(
            ownerID: ownerID,
            groupID: group.groupID
        )
        if !cached.isEmpty {
            ChatMediaPreviewPreloader.schedule(
                cached.compactMap(Self.mediaPreviewRequest),
                limit: 6
            )
            messages = cached
            hasMore = cached.count >= 30
        }

        let latestID = await store.latestGroupMessageIDAsync(
            ownerID: ownerID,
            groupID: group.groupID
        )
        do {
            if let latestID = latestID {
                let allNew = try await fetchNewerGroupMessages(afterID: latestID)
                await mergeFetchedGroupMessages(allNew)
                let recent = try await fetchRecentGroupMessages()
                await mergeFetchedGroupMessages(recent)
            } else {
                // First visit to this group on this device (no local cache).
                // Pull the latest page so the UI renders fast; backfill below.
                let (msgs, _) = try await APIService.shared.getGroupMessages(
                    groupID: group.groupID, limit: 100
                )
                await mergeFetchedGroupMessages(msgs)
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
            if messages.isEmpty { errorMessage = L10n.tr("messages.loadFailed") }
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
                await updateHasCachedOlderMessages()
                return
            }
            do {
                let (older, hasOlder) = try await APIService.shared.getGroupMessages(
                    groupID: group.groupID, beforeID: before, limit: 100
                )
                if older.isEmpty {
                    markBackfilled()
                    await updateHasCachedOlderMessages()
                    return
                }
                await store.saveGroupMessagesAsync(older, ownerID: ownerID)
                cursor = older.first?.id
                if !hasOlder {
                    markBackfilled()
                    await updateHasCachedOlderMessages()
                    return
                }
            } catch {
                // Give up silently; surface the manual scroll-up path so
                // the user can retry later. Don't mark as backfilled so
                // next app open will retry.
                await updateHasCachedOlderMessages(fallback: true)
                return
            }
        }
        // Hit the safety cap — leave scroll-up enabled for older history.
        // Don't mark as backfilled; next open may pick up more history.
        await updateHasCachedOlderMessages(fallback: true)
    }

    private func updateHasCachedOlderMessages(fallback: Bool = false) async {
        guard let firstID = messages.first?.id else {
            hasMore = false
            return
        }
        let cachedOlder = await store.loadGroupMessagesAsync(
            ownerID: ownerID,
            groupID: group.groupID,
            beforeID: firstID,
            limit: 1
        )
        hasMore = cachedOlder.isEmpty ? fallback : true
    }

    func loadMoreMessages() async {
        guard hasMore, let first = messages.first else { return }

        let cached = await store.loadGroupMessagesAsync(
            ownerID: ownerID,
            groupID: group.groupID,
            beforeID: first.id
        )
        if !cached.isEmpty {
            ChatMediaPreviewPreloader.schedule(
                cached.compactMap(Self.mediaPreviewRequest),
                limit: 6
            )
            messages.insert(contentsOf: cached, at: 0)
            hasMore = await store.loadGroupMessagesAsync(
                ownerID: ownerID,
                groupID: group.groupID,
                beforeID: cached.first!.id,
                limit: 1
            ).count > 0
            return
        }

        do {
            let (msgs, more) = try await APIService.shared.getGroupMessages(groupID: group.groupID, beforeID: first.id)
            let visible = store.visibleGroupMessages(
                msgs,
                ownerID: ownerID,
                groupID: group.groupID
            )
            await mergeFetchedGroupMessages(visible)
            hasMore = more && !visible.isEmpty
        } catch {
            errorMessage = userFacingSendError(error, fallbackKey: "messages.loadFailed")
        }
    }

    func deleteLocally(messageIDs: Set<Int>) {
        guard !messageIDs.isEmpty, !ownerID.isEmpty else { return }
        store.hideGroupMessages(ownerID: ownerID, groupID: group.groupID, messageIDs: messageIDs)
        messages.removeAll { messageIDs.contains($0.id) }
        if let replyID = replyingTo?.id, messageIDs.contains(replyID) {
            replyingTo = nil
        }
        let latest = messages.last
        NotificationCenter.default.post(
            name: .conversationPreviewDidChange,
            object: LocalConversationPreviewUpdate(
                target: .group(groupID: group.groupID),
                lastMessage: latest.map(localPreviewText),
                lastMessageTime: latest?.timestamp
            )
        )
    }

    func applyHistoryClear(throughSequence: Int64) {
        messages.removeAll { message in
            guard let sequence = message.historySequence else { return true }
            return sequence <= throughSequence
        }
        replyingTo = nil
        hasMore = false
        NotificationCenter.default.post(
            name: .conversationPreviewDidChange,
            object: LocalConversationPreviewUpdate(
                target: .group(groupID: group.groupID),
                lastMessage: messages.last.map(localPreviewText),
                lastMessageTime: messages.last?.timestamp
            )
        )
    }

    func recallMessage(messageID: Int) async throws {
        let recalled = try await APIService.shared.recallGroupMessage(
            groupID: group.groupID,
            messageID: messageID
        )
        await mergeFetchedGroupMessages([recalled])
        NotificationCenter.default.post(name: .conversationPreviewDidChange, object: recalled)
        if replyingTo?.id == messageID {
            replyingTo = nil
        }
    }

    private func localPreviewText(_ message: GroupMessage) -> String {
        if message.isRecalled {
            return ChatMessageRecallState.notice(
                senderID: message.senderID,
                viewerID: ownerID,
                senderName: message.senderNickname
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
            let context = try await APIService.shared.getGroupMessageContext(
                groupID: group.groupID,
                messageID: messageID
            )
            await mergeFetchedGroupMessages(context)
            return messages.contains(where: { $0.id == messageID })
        } catch {
            errorMessage = userFacingSendError(error, fallbackKey: "messages.loadFailed")
            return false
        }
    }

    func submitText(
        text submittedText: String? = nil,
        mentions: [String] = [],
        mentionAll: Bool = false
    ) {
        let sourceText = submittedText ?? inputText
        let text = sourceText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let replyID = replyingTo?.id
        if inputText == sourceText {
            inputText = ""
        }
        replyingTo = nil

        let pendingID = UUID().uuidString
        let pending = PendingGroupText(
            id: pendingID,
            content: text,
            replyID: replyID,
            mentions: mentions,
            mentionAll: mentionAll,
            status: .sending
        )
        pendingTexts.append(pending)
        let payload = ChatOutgoingPayload(
            conversationID: String(group.groupID),
            msgType: "text",
            content: text,
            replyToID: replyID,
            mentions: mentions,
            mentionAll: mentionAll
        )
        let outgoingJob = makeOutgoingJob(id: pendingID, payload: payload)

        Task { [weak self] in
            // Keep durable persistence off MainActor so the pending bubble can
            // be rendered before SQLite or the network send starts.
            try? await OutgoingStore.shared.createAsync(outgoingJob)
            await self?.finishTextSend(
                pendingID: pendingID,
                text: text,
                replyID: replyID,
                mentions: mentions,
                mentionAll: mentionAll
            )
        }
    }

    private func finishTextSend(
        pendingID: String,
        text: String,
        replyID: Int?,
        mentions: [String] = [],
        mentionAll: Bool = false
    ) async {
        do {
            let response = try await APIService.shared.sendGroupText(
                groupID: group.groupID,
                content: text,
                replyToID: replyID,
                mentions: mentions,
                mentionAll: mentionAll,
                clientMessageID: pendingID
            )
            let msg = normalizedOutgoingMessage(
                response,
                expectedType: "text",
                expectedContent: text,
                replyID: replyID,
                mentions: mentions,
                mentionAll: mentionAll,
                clientMessageID: pendingID
            )
            store.saveGroupMessage(msg)
            confirmPendingText(
                pendingID: pendingID,
                with: msg,
                source: .apiResponse
            )
            OutgoingStore.shared.updateJob(
                id: pendingID,
                ownerID: ownerID,
                state: .succeeded,
                serverID: String(msg.id)
            )
            ChatDraftStore.shared.removeIfMatching(
                text: text,
                replyID: replyID,
                conversationType: "group",
                conversationID: String(group.groupID)
            )
        } catch {
            if scheduleTransientTextRetry(pendingID: pendingID, error: error) { return }
            markPendingTextFailed(id: pendingID)
            OutgoingStore.shared.updateJob(
                id: pendingID,
                ownerID: ownerID,
                state: .failedPermanent,
                lastErrorCode: String(describing: error)
            )
            errorMessage = userFacingSendError(error, fallbackKey: "messages.sendFailed")
        }
    }

    private func scheduleTransientTextRetry(pendingID: String, error: Error) -> Bool {
        guard UploadEngine.isTransient(error),
              let job = OutgoingStore.shared.jobs(ownerID: ownerID).first(where: { $0.id == pendingID }),
              job.attemptCount < 5 else { return false }
        Task { await UploadEngine.shared.markRetryWaiting(jobID: job.id, ownerID: ownerID, error: error, attempt: job.attemptCount) }
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(min(pow(2, Double(job.attemptCount)), 30) * 1_000_000_000))
            guard let self,
                  let pending = pendingTexts.first(where: { $0.id == pendingID }),
                  OutgoingStore.shared.jobs(ownerID: ownerID).contains(where: { $0.id == job.id && $0.state == .retryWaiting }) else { return }
            OutgoingStore.shared.updateJob(id: job.id, ownerID: ownerID, state: .queued)
            await retryPendingText(pending)
        }
        return true
    }

    func retryPendingText(_ pending: PendingGroupText) async {
        if let idx = pendingTexts.firstIndex(where: { $0.id == pending.id }) {
            pendingTexts[idx].status = .sending
        }
        await finishTextSend(
            pendingID: pending.id,
            text: pending.content,
            replyID: pending.replyID,
            mentions: pending.mentions,
            mentionAll: pending.mentionAll
        )
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
            let response = try await APIService.shared.sendGroupSticker(
                groupID: group.groupID,
                packID: pack.id,
                stickerID: sticker.id,
                replyToID: replyID,
                clientMessageID: clientMessageID
            )
            let msg = normalizedOutgoingMessage(
                response,
                expectedType: "sticker",
                expectedContent: payload.encodedContent,
                replyID: replyID,
                clientMessageID: clientMessageID
            )
            store.saveGroupMessage(msg)
            appendMessageIfNeeded(msg, source: .apiResponse, shouldMergeOutgoingEcho: true)
        } catch {
            removeOptimisticStickerMessage(id: localMessage.id)
            errorMessage = userFacingSendError(error, fallbackKey: "messages.stickerSendFailed")
        }
    }

    private func finishStickerSend(
        pendingID: String,
        packID: String,
        stickerID: String,
        replyID: Int?
    ) async {
        do {
            let response = try await APIService.shared.sendGroupSticker(
                groupID: group.groupID,
                packID: packID,
                stickerID: stickerID,
                replyToID: replyID,
                clientMessageID: pendingID
            )
            let msg = normalizedOutgoingMessage(
                response,
                expectedType: "sticker",
                expectedContent: pendingStickers.first(where: { $0.id == pendingID })?.content,
                replyID: replyID,
                clientMessageID: pendingID
            )
            store.saveGroupMessage(msg)
            confirmPendingSticker(
                pendingID: pendingID,
                with: msg,
                source: .apiResponse
            )
        } catch {
            markPendingStickerFailed(id: pendingID)
            errorMessage = userFacingSendError(error, fallbackKey: "messages.stickerSendFailed")
        }
    }

    func retryPendingSticker(_ pending: PendingGroupSticker) async {
        if let idx = pendingStickers.firstIndex(where: { $0.id == pending.id }) {
            pendingStickers[idx].status = .sending
        }
        await finishStickerSend(
            pendingID: pending.id,
            packID: pending.packID,
            stickerID: pending.stickerID,
            replyID: pending.replyID
        )
    }

    func deletePending(id: String) {
        OutgoingRetryScheduler.shared.cancel(ownerID: ownerID, jobID: id)
        pendingTexts.removeAll { $0.id == id }
        pendingStickers.removeAll { $0.id == id }
        pendingMedia.removeAll { $0.id == id }
        Task {
            await UploadEngine.shared.cancel(jobID: id, ownerID: ownerID)
        }
    }

    func setReply(to message: GroupMessage) {
        replyingTo = message
    }

    func cancelReply() {
        replyingTo = nil
    }

    func sendImage(data: Data) async {
        await sendMediaBatch([
            OutgoingMediaDraft(kind: .image, data: data, filename: "img_\(UUID().uuidString).jpg")
        ])
    }

    func sendVideo(data: Data, filename: String) async {
        await sendMediaBatch([
            OutgoingMediaDraft(kind: .video, data: data, filename: filename)
        ])
    }

    /// Publish local rows immediately. Preview generation, durable recovery,
    /// staging, and uploads all run after the timeline mutation.
    func sendMediaBatch(_ drafts: [OutgoingMediaDraft]) async {
        guard !drafts.isEmpty else { return }

        let pendings = drafts.map { draft in
            PendingGroupMedia(
                id: draft.id.uuidString,
                msgType: draft.kind == .image ? "image" : "video",
                data: draft.data,
                localFileURL: draft.localFileURL,
                filename: draft.filename
            )
        }

        for pending in pendings {
            locallyEnqueuedMediaClientIDs.insert(pending.id)
        }

        pendingMedia.append(contentsOf: pendings)

        for pending in pendings where pending.msgType == "image" {
            guard let data = pending.data else { continue }
            let cacheKey = "pending-media:\(pending.id)"
            Task(priority: .userInitiated) {
                await ImageCacheManager.shared.prepareLocalPreview(data: data, for: cacheKey)
            }
        }

        for (pending, draft) in zip(pendings, drafts) {
            if let sourceURL = draft.localFileURL {
                enqueueMediaUpload(pending, sourceURL: sourceURL)
            } else {
                enqueueMediaUpload(pending)
            }
        }
    }

    func retryPendingMedia(_ pending: PendingGroupMedia) {
        guard let index = pendingMedia.firstIndex(where: { $0.id == pending.id }) else { return }
        pendingMedia[index].status = .sending
        enqueueMediaUpload(pendingMedia[index])
    }

    private func enqueueMediaUpload(_ pending: PendingGroupMedia) {
        if let fileURL = pending.localFileURL {
            enqueuePersistedMediaUpload(pending, fileURL: fileURL)
            return
        }
        guard let data = pending.data else { return }
        enqueueMediaUploadTask(id: "group-media-\(pending.id)") { [weak self] in
            guard let self else { return }
            await persistMediaJob(pending)
            do {
                let uploadData: Data
                if pending.msgType == "image" {
                    uploadData = await Task.detached(priority: .userInitiated) {
                        APIService.compressImageForUpload(data)
                    }.value
                } else {
                    uploadData = data
                }
                let fileURL = try await OutgoingFileStore.stage(
                    data: uploadData,
                    ownerID: ownerID,
                    jobID: pending.id,
                    filename: pending.filename
                )
                if let index = pendingMedia.firstIndex(where: { $0.id == pending.id }) {
                    pendingMedia[index].localFileURL = fileURL
                }
                await performPersistedMediaUpload(pending, fileURL: fileURL)
            } catch {
                await markMediaFailed(pending, error: error)
            }
        }
    }

    private func enqueueMediaUpload(_ pending: PendingGroupMedia, sourceURL: URL) {
        enqueueMediaUploadTask(id: "group-media-\(pending.id)") { [weak self] in
            guard let self else { return }
            await persistMediaJob(pending)
            do {
                let fileURL = try await OutgoingFileStore.stage(
                    file: sourceURL,
                    ownerID: ownerID,
                    jobID: pending.id,
                    filename: pending.filename
                )
                if pending.msgType == "video" {
                    await ImageCacheManager.shared.adoptLocalVideoThumbnail(
                        fileURL,
                        for: fileURL.absoluteString
                    )
                }
                if let index = pendingMedia.firstIndex(where: { $0.id == pending.id }) {
                    pendingMedia[index].localFileURL = fileURL
                }
                removeTemporaryMediaSourceIfNeeded(sourceURL)
                await performPersistedMediaUpload(pending, fileURL: fileURL)
            } catch {
                removeTemporaryMediaSourceIfNeeded(sourceURL)
                await markMediaFailed(pending, error: error)
            }
        }
    }

    private func removeTemporaryMediaSourceIfNeeded(_ sourceURL: URL) {
        let temporaryRoot = FileManager.default.temporaryDirectory.standardizedFileURL.path + "/"
        guard sourceURL.standardizedFileURL.path.hasPrefix(temporaryRoot) else { return }
        try? FileManager.default.removeItem(at: sourceURL)
    }

    private func enqueuePersistedMediaUpload(_ pending: PendingGroupMedia, fileURL: URL) {
        enqueueMediaUploadTask(id: "group-media-\(pending.id)") { [weak self] in
            guard let self else { return }
            await performPersistedMediaUpload(pending, fileURL: fileURL)
        }
    }

    private func enqueueMediaUploadTask(
        id: String,
        _ operation: @escaping @MainActor () async -> Void
    ) {
        BackgroundUploadCoordinator.shared.enqueue(id: id, operation: operation)
    }

    private func performPersistedMediaUpload(
        _ pending: PendingGroupMedia,
        fileURL: URL
    ) async {
        let payload = ChatOutgoingPayload(
            conversationID: String(group.groupID),
            msgType: pending.msgType,
            filename: pending.filename
        )
        let job = makeOutgoingJob(id: pending.id, payload: payload)
        let values = try? fileURL.resourceValues(forKeys: [.fileSizeKey])
        let newPart = OutgoingPart(
            jobID: job.id,
            role: pending.msgType,
            ordinal: 0,
            localRelativePath: OutgoingFileStore.relativePath(for: fileURL),
            filename: pending.filename,
            mimeType: pending.msgType == "image" ? "image/jpeg" : "video/mp4",
            byteSize: Int64(values?.fileSize ?? 0),
            state: .queued
        )
        let part = OutgoingStore.shared.parts(jobID: job.id).first ?? newPart
        do {
            try await UploadEngine.shared.enqueue(job: job, parts: [part])
            await finishMediaSend(pending, fileURL: fileURL, job: job, part: part)
        } catch {
            await markMediaFailed(pending, error: error)
        }
    }

    private func finishMediaSend(_ pending: PendingGroupMedia, fileURL: URL, job: OutgoingJob, part: OutgoingPart) async {
        do {
            let response: GroupMessage
            if pending.msgType == "video" {
                response = try await APIService.shared.sendGroupVideo(
                    groupID: group.groupID,
                    videoFileURL: fileURL,
                    filename: pending.filename,
                    job: job,
                    part: part
                )
            } else {
                response = try await APIService.shared.sendGroupImage(
                    groupID: group.groupID,
                    imageFileURL: fileURL,
                    filename: pending.filename,
                    job: job,
                    part: part
                )
            }
            let msg = normalizedOutgoingMessage(response, expectedType: pending.msgType, clientMessageID: pending.id)
            if pending.msgType == "video" {
                MediaCacheManager.shared.adoptLocalFile(
                    mediaID: "chat-video:\(msg.content)",
                    remoteURL: msg.content,
                    sourceURL: fileURL
                )
                await ImageCacheManager.shared.adoptLocalVideoThumbnail(
                    fileURL,
                    for: msg.content,
                    thumbnailURL: msg.thumbnailURL
                )
            } else {
                await ImageCacheManager.shared.adoptLocalFile(
                    fileURL,
                    for: msg.content,
                    previewURL: msg.thumbnailURL
                )
            }
            store.saveGroupMessage(msg)
            confirmPendingMedia(pendingID: pending.id, with: msg, source: .apiResponse)
            OutgoingStore.shared.updateJob(id: job.id, ownerID: ownerID, state: .succeeded, serverID: String(msg.id))
        } catch {
            await markMediaFailed(pending, error: error)
        }
    }

    private func persistMediaJob(_ pending: PendingGroupMedia) async {
        let payload = ChatOutgoingPayload(
            conversationID: String(group.groupID),
            msgType: pending.msgType,
            filename: pending.filename
        )
        try? await OutgoingStore.shared.createAsync(
            makeOutgoingJob(id: pending.id, payload: payload, state: .staging)
        )
    }

    private func markMediaFailed(_ pending: PendingGroupMedia, error: Error) async {
        if await scheduleTransientMediaRetry(pendingID: pending.id, error: error) { return }
        markPendingMediaFailed(id: pending.id)
        OutgoingStore.shared.updateJob(
            id: pending.id,
            ownerID: ownerID,
            state: .failedPermanent,
            lastErrorCode: String(describing: error)
        )
        let key = pending.msgType == "video" ? "messages.videoSendFailed" : "messages.imageSendFailed"
        errorMessage = userFacingSendError(error, fallbackKey: key)
    }

    private func scheduleTransientMediaRetry(pendingID: String, error: Error) async -> Bool {
        guard var job = OutgoingStore.shared.jobs(ownerID: ownerID).first(where: { $0.id == pendingID }),
              OutgoingRetryPolicy.shouldRetry(job: job, error: error) else { return false }
        if job.state != .retryWaiting {
            await UploadEngine.shared.markRetryWaiting(
                jobID: job.id,
                ownerID: ownerID,
                error: error,
                attempt: job.attemptCount
            )
            guard let refreshed = OutgoingStore.shared.jobs(ownerID: ownerID)
                .first(where: { $0.id == pendingID }) else { return false }
            job = refreshed
        }
        scheduleDurableMediaRetry(job: job, pendingID: pendingID)
        return true
    }

    private func scheduleDurableMediaRetry(job: OutgoingJob, pendingID: String) {
        OutgoingRetryScheduler.shared.schedule(
            ownerID: ownerID,
            jobID: job.id,
            notBefore: OutgoingRetryPolicy.scheduledDate(for: job)
        ) { [self] in
            guard AuthManager.shared.currentUser?.userID == ownerID,
                  let current = pendingMedia.first(where: { $0.id == pendingID }),
                  OutgoingStore.shared.jobs(ownerID: ownerID).contains(where: {
                      $0.id == job.id && ($0.state == .retryWaiting || $0.state == .confirmationUnknown)
                  }) else { return }
            retryPendingMedia(current)
        }
    }

    private func markPendingMediaFailed(id: String) {
        if let index = pendingMedia.firstIndex(where: { $0.id == id }) {
            pendingMedia[index].status = .failed
        }
    }

    func sendVoice(data: Data, duration: Double) async {
        isSending = true
        do {
            let response = try await APIService.shared.sendGroupVoice(
                groupID: group.groupID,
                voiceData: data,
                duration: duration,
                filename: "voice_\(Int(Date().timeIntervalSince1970)).m4a"
            )
            let msg = normalizedOutgoingMessage(response, expectedType: "voice")
            store.saveGroupMessage(msg)
            appendMessageIfNeeded(msg, source: .apiResponse, shouldMergeOutgoingEcho: true)
        } catch {
            errorMessage = userFacingSendError(error, fallbackKey: "messages.voiceSendFailed")
        }
        isSending = false
    }

    func sendGift(_ gift: GiftCatalogItem, recipientID: String) async throws {
        guard recipientID != AuthManager.shared.currentUser?.userID else {
            throw APIError.serverError(code: 400, message: L10n.tr("gift.cannotSendToSelf"))
        }

        // Do not route gift transport through the composer's global sending
        // state. Retain the key across ambiguous failures to avoid duplicate
        // charges while the local gift animation remains responsive.
        let idempotencyScope = "\(recipientID)|\(gift.giftID)"
        let idempotencyKey = giftIdempotencyKeys[idempotencyScope] ?? UUID()
        giftIdempotencyKeys[idempotencyScope] = idempotencyKey

        let response = try await APIService.shared.sendGroupGift(
            groupID: group.groupID,
            recipientID: recipientID,
            giftID: gift.giftID,
            idempotencyKey: idempotencyKey
        )
        giftIdempotencyKeys.removeValue(forKey: idempotencyScope)
        let msg = normalizedOutgoingMessage(response, expectedType: "gift")
        store.saveGroupMessage(msg)
        appendMessageIfNeeded(msg, source: .apiResponse, shouldMergeOutgoingEcho: true)
        Task { await WalletStore.shared.refreshBalanceFromServer() }
    }

    func appendCreatedChatMoneyMessage(_ result: ChatMoneyCreationResult) {
        guard case .group(let response) = result.message,
              response.groupID == group.groupID else { return }
        let message = response.replacingChatMoneyPayload(result.payload)
        store.saveGroupMessage(message)
        appendMessageIfNeeded(
            message,
            source: .apiResponse,
            shouldMergeOutgoingEcho: true
        )
    }

    var isSendEnabled: Bool {
        !inputText.isBlank
    }

    var visiblePendingTexts: [PendingGroupText] {
        visiblePendingTexts(from: pendingTexts)
    }

    func visiblePendingTexts(
        from candidates: [PendingGroupText],
        confirmedBy confirmedMessages: [GroupMessage]? = nil
    ) -> [PendingGroupText] {
        let confirmedMessages = confirmedMessages ?? messages
        let confirmedClientIDs = Set(confirmedMessages.compactMap(\.clientMessageID))
        let legacyMessages = confirmedMessages.filter { $0.clientMessageID == nil }
        return candidates.filter { pending in
            guard !confirmedClientIDs.contains(pending.id) else { return false }
            return !legacyMessages.contains {
                isOwnOutgoingMergeable($0) && pendingText(pending, matches: $0)
            }
        }
    }

    var visiblePendingStickers: [PendingGroupSticker] {
        visiblePendingStickers(from: pendingStickers)
    }

    func visiblePendingStickers(
        from candidates: [PendingGroupSticker],
        confirmedBy confirmedMessages: [GroupMessage]? = nil
    ) -> [PendingGroupSticker] {
        let confirmedMessages = confirmedMessages ?? messages
        let confirmedClientIDs = Set(confirmedMessages.compactMap(\.clientMessageID))
        let legacyMessages = confirmedMessages.filter { $0.clientMessageID == nil }
        return candidates.filter { pending in
            guard !confirmedClientIDs.contains(pending.id) else { return false }
            return !legacyMessages.contains {
                isOwnOutgoingMergeable($0) && pendingSticker(pending, matches: $0)
            }
        }
    }

    var visiblePendingMedia: [PendingGroupMedia] {
        visiblePendingMedia(from: pendingMedia)
    }

    func visiblePendingMedia(
        from candidates: [PendingGroupMedia],
        confirmedBy confirmedMessages: [GroupMessage]? = nil
    ) -> [PendingGroupMedia] {
        let confirmedClientIDs = Set((confirmedMessages ?? messages).compactMap(\.clientMessageID))
        return candidates.filter { pending in
            !confirmedClientIDs.contains(pending.id)
        }
    }

    func isLocalMediaAcknowledgement(_ message: GroupMessage) -> Bool {
        guard ["image", "video"].contains(MessageDeliveryMatcher.normalizedType(message.msgType)),
              let clientMessageID = nonBlank(message.clientMessageID) else { return false }
        return locallyEnqueuedMediaClientIDs.contains(clientMessageID)
    }

    func markConversationAsReadOnServer(throughMessageID: Int? = nil) {
        Task {
            do {
                let receipt = try await APIService.shared.markGroupMessagesAsRead(
                    groupID: group.groupID,
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
                            for: ConversationReadTarget.group(groupID: group.groupID).listIdentity
                        )
                    }
                }
                await MainActor.run {
                    AppMessageSyncCoordinator.shared.requestSync(.notification)
                }
            } catch {
                // Keep the current projection until a later sync succeeds.
            }
            await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
        }
    }

    func setReadingLatest(_ value: Bool) {
        isReadingLatest = value
    }

    private func triggerMentionAlertIfNeeded(_ msg: GroupMessage) {
        guard let myID = AuthManager.shared.currentUser?.userID,
              msg.mentions?.contains(myID) == true || msg.mentionAll,
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
                    if msg.senderID == AuthManager.shared.currentUser?.userID,
                       ["image", "video"].contains(MessageDeliveryMatcher.normalizedType(msg.msgType)),
                       let clientMessageID = msg.clientMessageID,
                       let pending = self.pendingMedia.first(where: {
                           $0.id == clientMessageID
                       }),
                       let localFileURL = pending.localFileURL {
                        // Preserve the local image across an early WebSocket
                        // acknowledgement. The pending row remains visible
                        // until the confirmed bubble can render synchronously.
                        Task { [weak self] in
                            if MessageDeliveryMatcher.normalizedType(msg.msgType) == "image" {
                                await ImageCacheManager.shared.adoptLocalFile(
                                    localFileURL,
                                    for: msg.content,
                                    previewURL: msg.thumbnailURL
                                )
                            } else {
                                MediaCacheManager.shared.adoptLocalFile(
                                    mediaID: "chat-video:\(msg.content)",
                                    remoteURL: msg.content,
                                    sourceURL: localFileURL
                                )
                                await ImageCacheManager.shared.adoptLocalVideoThumbnail(
                                    localFileURL,
                                    for: msg.content,
                                    thumbnailURL: msg.thumbnailURL
                                )
                            }
                            guard let self else { return }
                            self.store.saveGroupMessage(msg)
                            self.confirmPendingMedia(
                                pendingID: clientMessageID,
                                with: msg,
                                source: .webSocket
                            )
                            self.triggerMentionAlertIfNeeded(msg)
                        }
                        return
                    }
                    self.publishGroupMessageAfterPreviewWarmup(msg)
                }
            }
            .store(in: &cancellables)

        WebSocketService.shared.groupContactUpdatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] data in
                guard let self = self,
                      Self.intValue(data["group_id"]) == self.group.groupID else { return }
                Task { await self.syncLatestMessages() }
            }
            .store(in: &cancellables)

        WebSocketService.shared.chatMoneyUpdatePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] update in
                guard let self else { return }
                if let receipt = update.groupReceiptMessage,
                   receipt.groupID == self.group.groupID {
                    self.store.saveGroupMessage(receipt)
                    self.appendMessageIfNeeded(receipt, source: .webSocket)
                }
                if let current = self.messages.first(where: {
                    $0.chatMoneyPayload?.assetID == update.payload.assetID
                })?.chatMoneyPayload,
                   current.version >= update.payload.version {
                    return
                }
                if let replacement = update.groupMessage {
                    guard replacement.groupID == self.group.groupID else { return }
                    self.store.saveGroupMessage(replacement)
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
                self.store.saveGroupMessage(replacement)
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
                self?.pendingTexts.removeAll()
                self?.pendingStickers.removeAll()
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
                      notification.object as? String == self.ownerID,
                      let jobID = notification.userInfo?["job_id"] as? String,
                      self.pendingMedia.contains(where: { $0.id == jobID }) else { return }
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

        let isActivelyVisible = WebSocketService.shared.activeGroupID == group.groupID
            && isReadingLatest
        if isActivelyVisible {
            UnreadBadgeStore.shared.setConversationUnreadCount(
                0,
                for: ConversationReadTarget.group(groupID: group.groupID).listIdentity
            )
        }

        let latestID = await store.latestGroupMessageIDAsync(
            ownerID: ownerID,
            groupID: group.groupID
        )
        do {
            var fetched: [GroupMessage] = []
            if let latestID {
                fetched.append(contentsOf: try await fetchNewerGroupMessages(afterID: latestID))
            }
            fetched.append(contentsOf: try await fetchRecentGroupMessages())
            await mergeFetchedGroupMessages(fetched, triggerMentions: true)

            if isActivelyVisible, WebSocketService.shared.activeGroupID == group.groupID {
                _ = try? await APIService.shared.markGroupMessagesAsRead(
                    groupID: group.groupID,
                    throughMessageID: messages.last?.id
                )
                PushService.shared.syncBadgeFromUnreadState()
            }
        } catch {
            print("[GroupChat] Failed to sync latest: \(error)")
        }
    }

    private func fetchNewerGroupMessages(afterID latestID: Int) async throws -> [GroupMessage] {
        var allNew: [GroupMessage] = []
        var fetchMore = true
        var currentAfterID = latestID
        while fetchMore {
            let (msgs, more) = try await APIService.shared.getGroupMessages(
                groupID: group.groupID,
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

    private func fetchRecentGroupMessages() async throws -> [GroupMessage] {
        let (msgs, _) = try await APIService.shared.getGroupMessages(
            groupID: group.groupID,
            limit: 100
        )
        return msgs
    }

    private func mergeFetchedGroupMessages(
        _ fetched: [GroupMessage],
        triggerMentions: Bool = false
    ) async {
        let scoped = store.visibleGroupMessages(
            fetched.filter { $0.groupID == group.groupID },
            ownerID: ownerID,
            groupID: group.groupID
        )
        guard !scoped.isEmpty else { return }

        let existingIDs = Set(messages.map(\.id))
        let previewRequests = scoped.compactMap(Self.mediaPreviewRequest)
        ChatMediaPreviewPreloader.schedule(previewRequests, limit: 12)
        await store.saveGroupMessagesAsync(scoped, ownerID: ownerID)
        appendMessagesIfNeeded(
            scoped,
            source: .history,
            shouldMergeOutgoingEcho: true
        )

        guard triggerMentions else { return }
        scoped
            .filter { !existingIDs.contains($0.id) }
            .forEach(triggerMentionAlertIfNeeded)
    }

    private static func mediaPreviewRequest(
        _ message: GroupMessage
    ) -> ChatMediaPreviewRequest? {
        ChatMediaPreviewRequest.resolve(
            messageType: message.msgType,
            content: message.content,
            thumbnailURL: message.thumbnailURL
        )
    }

    private func publishGroupMessageAfterPreviewWarmup(_ message: GroupMessage) {
        // WebSocketService has already persisted the message and started the
        // same shared-cache request before publishing it to this view model.
        guard let request = Self.mediaPreviewRequest(message) else {
            publishGroupMessage(message)
            return
        }
        ChatMediaPreviewPreloader.schedule([request], limit: 1)
        publishGroupMessage(message)
    }

    private func publishGroupMessage(_ message: GroupMessage) {
        let isOwnMessage = message.senderID == AuthManager.shared.currentUser?.userID
        if isOwnMessage {
            let resolvedPending = removeFirstPendingText {
                pendingText($0, matches: message)
            }
            if !resolvedPending {
                _ = removeFirstPendingSticker {
                    pendingSticker($0, matches: message)
                }
            }
        }
        appendMessageIfNeeded(
            message,
            source: .webSocket,
            shouldMergeOutgoingEcho: isOwnMessage
        )
        triggerMentionAlertIfNeeded(message)

        guard !isOwnMessage,
              WebSocketService.shared.activeGroupID == group.groupID,
              isReadingLatest else { return }
        UnreadBadgeStore.shared.setConversationUnreadCount(
            0,
            for: ConversationReadTarget.group(groupID: group.groupID).listIdentity
        )
        Task {
            _ = try? await APIService.shared.markGroupMessagesAsRead(
                groupID: group.groupID,
                throughMessageID: message.id
            )
            await MainActor.run { PushService.shared.syncBadgeFromUnreadState() }
        }
    }

    private func appendMessageIfNeeded(
        _ message: GroupMessage,
        source: GroupMessageSource = .history,
        shouldMergeOutgoingEcho: Bool = false
    ) {
        appendMessagesIfNeeded(
            [message],
            source: source,
            shouldMergeOutgoingEcho: shouldMergeOutgoingEcho
        )
    }

    private func confirmPendingText(
        pendingID: String,
        with message: GroupMessage,
        source: GroupMessageSource
    ) {
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            // Publish the confirmed row first. It has the same client identity,
            // so the timeline never observes an empty slot between the local
            // bubble and its server acknowledgement.
            appendMessageIfNeeded(
                message,
                source: source,
                shouldMergeOutgoingEcho: true
            )
            pendingTexts.removeAll { $0.id == pendingID }
        }
    }

    private func confirmPendingSticker(
        pendingID: String,
        with message: GroupMessage,
        source: GroupMessageSource
    ) {
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            appendMessageIfNeeded(
                message,
                source: source,
                shouldMergeOutgoingEcho: true
            )
            pendingStickers.removeAll { $0.id == pendingID }
        }
    }

    /// A media acknowledgement must not look like a new animated row. Keep the
    /// client identity and perform the pending/confirmed replacement in a
    /// transaction that explicitly disables inherited layout animations.
    private func confirmPendingMedia(
        pendingID: String,
        with message: GroupMessage,
        source: GroupMessageSource
    ) {
        OutgoingRetryScheduler.shared.cancel(ownerID: ownerID, jobID: pendingID)
        OutgoingStore.shared.updateJob(
            id: pendingID,
            ownerID: ownerID,
            state: .succeeded,
            serverID: String(message.id)
        )
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            // Keep the optimistic image projected until the confirmed row is
            // present. visiblePendingMedia then swaps the two representations
            // under one stable client identity without an empty render pass.
            appendMessageIfNeeded(
                message,
                source: source,
                shouldMergeOutgoingEcho: true
            )
            pendingMedia.removeAll { $0.id == pendingID }
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
        replyTo: GroupMessage?
    ) -> GroupMessage {
        let currentUser = AuthManager.shared.currentUser
        return GroupMessage(
            id: nextLocalStickerMessageID(),
            groupID: group.groupID,
            senderID: currentUser?.userID ?? "",
            msgType: "sticker",
            content: content,
            timestamp: ISO8601DateFormatter().string(from: Date()),
            senderNickname: currentUser?.nickname ?? L10n.tr("common.me"),
            senderAvatar: currentUser?.avatarURL ?? "",
            replyToID: replyTo?.id,
            replyTo: replyTo.map {
                GroupReplyPreview(
                    id: $0.id,
                    senderID: $0.senderID,
                    msgType: $0.msgType,
                    content: $0.content
                )
            },
            mentions: nil,
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

    private func removePendingText(id: String) {
        pendingTexts.removeAll { $0.id == id }
    }

    private func markPendingTextFailed(id: String) {
        if let idx = pendingTexts.firstIndex(where: { $0.id == id }) {
            pendingTexts[idx].status = .failed
        }
    }

    private func removePendingSticker(id: String) {
        pendingStickers.removeAll { $0.id == id }
    }

    private func markPendingStickerFailed(id: String) {
        if let idx = pendingStickers.firstIndex(where: { $0.id == id }) {
            pendingStickers[idx].status = .failed
        }
    }

    @discardableResult
    private func removeFirstPendingText(matching predicate: (PendingGroupText) -> Bool) -> Bool {
        guard let idx = pendingTexts.firstIndex(where: predicate) else { return false }
        pendingTexts.remove(at: idx)
        return true
    }

    @discardableResult
    private func removeFirstPendingSticker(matching predicate: (PendingGroupSticker) -> Bool) -> Bool {
        guard let idx = pendingStickers.firstIndex(where: predicate) else { return false }
        pendingStickers.remove(at: idx)
        return true
    }

    private func appendMessagesIfNeeded(
        _ newMessages: [GroupMessage],
        source: GroupMessageSource = .history,
        shouldMergeOutgoingEcho: Bool = false
    ) {
        var changed = false
        var requiresSort = false
        for message in newMessages {
            guard let ownerID = AuthManager.shared.currentUser?.userID,
                  !store.isGroupMessageHidden(
                      ownerID: ownerID,
                      groupID: group.groupID,
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

            if shouldMergeOutgoingEcho,
               let echoIndex = outgoingEchoIndex(for: message, source: source) {
                let existing = messages[echoIndex]
                clearOptimisticStickerTracking(existing.id)
                let stableClientMessageID = ChatTimelineIdentity.resolvedClientMessageID(
                    primary: existing.clientMessageID,
                    fallback: message.clientMessageID
                )
                let merged = preferredMessage(
                    existing: existing,
                    incoming: message,
                    source: source
                ).inheritingClientMessageID(stableClientMessageID)
                clearDeliveryTracking(for: existing.id, unlessKeeping: merged.id)
                clearDeliveryTracking(for: message.id, unlessKeeping: merged.id)
                if merged.id == message.id {
                    markConfirmed(merged.id, source: source)
                }
                if existing.id != message.id {
                    store.deleteGroupMessage(
                        id: merged.id == existing.id ? message.id : existing.id,
                        ownerID: ownerID
                    )
                }
                messages[echoIndex] = merged
                changed = true
                continue
            }

            messages.append(message)
            changed = true
            requiresSort = true
        }
        guard changed else { return }
        // HTTP/WebSocket acknowledgement is an in-place state change for one
        // logical row. Do not emit a second @Published mutation by re-sorting
        // an already-correct position after upload completion.
        if requiresSort {
            sortMessagesForDisplay()
        }
        if source == .apiResponse {
            newMessages.forEach {
                NotificationCenter.default.post(name: .conversationPreviewDidChange, object: $0)
            }
        }
    }

    private func pendingText(_ pending: PendingGroupText, matches message: GroupMessage) -> Bool {
        if message.clientMessageID == pending.id {
            return true
        }

        return pending.content == message.content
            && pendingReplyMatches(pending.replyID, replyTargetID(for: message))
            && (message.mentions == nil
                || normalizedMentions(pending.mentions) == normalizedMentions(message.mentions))
            && (!message.mentionAll || pending.mentionAll)
            && MessageDeliveryMatcher.normalizedType(message.msgType) == "text"
            && pendingTimestampMatches(pending.createdAt, messageTimestamp: message.timestamp)
    }

    private func pendingSticker(_ pending: PendingGroupSticker, matches message: GroupMessage) -> Bool {
        if message.clientMessageID == pending.id {
            return true
        }

        return stickerSignaturesMatch(
                stickerSignature(content: pending.content, replyID: pending.replyID),
                stickerSignature(content: message.content, replyID: replyTargetID(for: message))
            )
            && pendingReplyMatches(pending.replyID, replyTargetID(for: message))
            && MessageDeliveryMatcher.normalizedType(message.msgType) == "sticker"
            && pendingTimestampMatches(pending.createdAt, messageTimestamp: message.timestamp)
    }

    private func outgoingEchoIndex(
        for message: GroupMessage,
        source: GroupMessageSource
    ) -> Int? {
        guard isOwnOutgoingMergeable(message) else { return nil }

        if let clientMessageID = nonBlank(message.clientMessageID),
           let clientMatch = messages.lastIndex(where: { existing in
               existing.id != message.id
                   && isOwnOutgoingMergeable(existing)
                   && nonBlank(existing.clientMessageID) == clientMessageID
           }) {
            return clientMatch
        }

        return messages.lastIndex { existing in
            guard existing.id != message.id,
                  isOwnOutgoingMergeable(existing),
                  MessageDeliveryMatcher.normalizedType(existing.msgType)
                    == MessageDeliveryMatcher.normalizedType(message.msgType),
                  replyTargetID(for: existing) == replyTargetID(for: message),
                  normalizedMentions(existing.mentions) == normalizedMentions(message.mentions),
                  timestampsAreClose(existing.timestamp, message.timestamp),
                  isEligibleEcho(existing.id, for: source) else {
                return false
            }

            return outgoingContentsMatch(existing, message)
        }
    }

    private func isEligibleEcho(_ existingID: Int, for source: GroupMessageSource) -> Bool {
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

    private func outgoingContentsMatch(_ lhs: GroupMessage, _ rhs: GroupMessage) -> Bool {
        if lhs.msgType == "sticker" {
            return stickerSignaturesMatch(
                stickerSignature(content: lhs.content, replyID: replyTargetID(for: lhs)),
                stickerSignature(content: rhs.content, replyID: replyTargetID(for: rhs))
            )
        }
        guard MessageDeliveryMatcher.normalizedType(lhs.msgType)
                == MessageDeliveryMatcher.normalizedType(rhs.msgType) else {
            return false
        }
        return MessageDeliveryMatcher.contentsMatch(
            type: lhs.msgType,
            lhs: lhs.content,
            rhs: rhs.content
        )
    }

    private func preferredMessage(
        existing: GroupMessage,
        incoming: GroupMessage,
        source: GroupMessageSource
    ) -> GroupMessage {
        if source == .webSocket {
            return incoming
        }
        if webSocketConfirmedMessageIDs.contains(existing.id) {
            return existing
        }
        return incoming
    }

    private func isOwnOutgoingMergeable(_ message: GroupMessage) -> Bool {
        message.groupID == group.groupID
            && message.senderID == AuthManager.shared.currentUser?.userID
            && message.msgType != "system"
    }

    private func markConfirmed(_ id: Int, source: GroupMessageSource) {
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

    private func outgoingSignature(for message: GroupMessage) -> String {
        outgoingSignature(
            content: message.content,
            msgType: message.msgType,
            replyID: replyTargetID(for: message),
            mentions: message.mentions,
            mentionAll: message.mentionAll
        )
    }

    private func outgoingSignature(
        content: String,
        msgType: String,
        replyID: Int?,
        mentions: [String]?,
        mentionAll: Bool
    ) -> String {
        [
            msgType,
            replyID.map(String.init) ?? "",
            normalizedMentions(mentions).joined(separator: ","),
            mentionAll ? "all" : "",
            content
        ].joined(separator: "\u{1F}")
    }

    private func replyTargetID(for message: GroupMessage) -> Int? {
        message.replyToID ?? message.replyTo?.id
    }

    private func normalizedOutgoingMessage(
        _ message: GroupMessage,
        expectedType: String,
        expectedContent: String? = nil,
        replyID: Int? = nil,
        mentions: [String]? = nil,
        mentionAll: Bool = false,
        clientMessageID: String? = nil
    ) -> GroupMessage {
        let currentUser = AuthManager.shared.currentUser
        let resolvedContent = message.content.isBlank
            ? (expectedContent ?? message.content)
            : message.content
        let content = MessageDeliveryMatcher.normalizedType(expectedType) == "text"
            ? resolvedContent.trimmingTrailingLineBreaks
            : resolvedContent
        return GroupMessage(
            id: message.id,
            groupID: group.groupID,
            senderID: currentUser?.userID ?? message.senderID,
            msgType: expectedType,
            content: content,
            timestamp: message.timestamp.isBlank
                ? ISO8601DateFormatter().string(from: Date())
                : message.timestamp,
            senderNickname: message.senderNickname.isBlank
                ? (currentUser?.nickname ?? message.senderID)
                : message.senderNickname,
            senderAvatar: message.senderAvatar.isBlank
                ? (currentUser?.avatarURL ?? "")
                : message.senderAvatar,
            replyToID: message.replyToID ?? replyID,
            replyTo: message.replyTo,
            mentions: message.mentions ?? mentions,
            mentionAll: message.mentionAll || mentionAll,
            clientMessageID: nonBlank(message.clientMessageID) ?? nonBlank(clientMessageID),
            scriptContext: message.scriptContext,
            historySequence: message.historySequence,
            version: message.version,
            updatedAt: message.updatedAt,
            thumbnailURL: message.thumbnailURL
        )
    }

    private func pendingTimestampMatches(_ createdAt: Date, messageTimestamp: String) -> Bool {
        if let messageDate = TimestampHelper.parse(messageTimestamp) {
            let delta = messageDate.timeIntervalSince(createdAt)
            return delta >= -2 && delta <= 90
        }
        return abs(Date().timeIntervalSince(createdAt)) <= 90
    }

    private func pendingReplyMatches(_ pendingReplyID: Int?, _ messageReplyID: Int?) -> Bool {
        pendingReplyID == messageReplyID || messageReplyID == nil
    }

    private func normalizedMentions(_ mentions: [String]?) -> [String] {
        Array(Set(mentions ?? [])).sorted()
    }

    private func nonBlank(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func timestampsAreClose(_ lhs: String, _ rhs: String) -> Bool {
        guard lhs != rhs else { return true }
        guard let lhsDate = TimestampHelper.parse(lhs),
              let rhsDate = TimestampHelper.parse(rhs) else {
            return false
        }
        return abs(lhsDate.timeIntervalSince(rhsDate)) <= 30
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

    private static func intValue(_ value: Any?) -> Int? {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let string = value as? String { return Int(string) }
        return nil
    }
}

struct PendingGroupText: Identifiable {
    let id: String
    let content: String
    let replyID: Int?
    let mentions: [String]
    let mentionAll: Bool
    let createdAt: Date
    var status: PendingStatus = .sending

    enum PendingStatus {
        case sending, failed
    }

    init(
        id: String,
        content: String,
        replyID: Int? = nil,
        mentions: [String] = [],
        mentionAll: Bool = false,
        status: PendingStatus = .sending,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.content = content
        self.replyID = replyID
        self.mentions = mentions
        self.mentionAll = mentionAll
        self.status = status
        self.createdAt = createdAt
    }

    var formattedTime: String {
        TimestampHelper.formatTime(createdAt)
    }
}

struct PendingGroupSticker: Identifiable {
    let id: String
    let content: String
    let packID: String
    let stickerID: String
    let replyID: Int?
    let createdAt: Date
    var status: PendingStatus = .sending

    enum PendingStatus {
        case sending, failed
    }

    init(
        id: String,
        content: String,
        packID: String,
        stickerID: String,
        replyID: Int? = nil,
        status: PendingStatus = .sending,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.content = content
        self.packID = packID
        self.stickerID = stickerID
        self.replyID = replyID
        self.status = status
        self.createdAt = createdAt
    }

    var formattedTime: String {
        TimestampHelper.formatTime(createdAt)
    }
}

struct PendingGroupMedia: Identifiable {
    let id: String
    let msgType: String
    let data: Data?
    var localFileURL: URL?
    let filename: String
    let createdAt: Date
    var status: PendingStatus

    enum PendingStatus {
        case sending, failed
    }

    init(
        id: String = UUID().uuidString,
        msgType: String,
        data: Data?,
        localFileURL: URL? = nil,
        filename: String,
        createdAt: Date = Date(),
        status: PendingStatus = .sending
    ) {
        self.id = id
        self.msgType = msgType
        self.data = data
        self.localFileURL = localFileURL
        self.filename = filename
        self.createdAt = createdAt
        self.status = status
    }

    var formattedTime: String {
        TimestampHelper.formatTime(createdAt)
    }
}
