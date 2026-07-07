// BWChat/ViewModels/ShortDramaFeedViewModel.swift
// TikTok-style short drama feed playback and optimistic interactions.

import AVFoundation
import Foundation

@MainActor
final class ShortDramaFeedViewModel: ObservableObject {
    @Published private(set) var videos: [ShortDramaVideo] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var players: [String: AVPlayer] = [:]
    @Published private(set) var isManuallyPaused = false
    @Published var selectedVideoID: String?
    @Published var errorMessage: String?

    private var activeVideoID: String?
    private var nextCursor: String?
    private var hasMore = true
    private var didLoadInitial = false
    private var initialLoadTask: Task<Bool, Never>?
    private var progressReportTasks: [String: Task<Void, Never>] = [:]
    private var progressReportTokens: [String: UUID] = [:]
    private var lastReportedProgressSeconds: [String: Double] = [:]
    private var warmingVideoIDs = Set<String>()
    private var warmedVideoIDs = Set<String>()

    var visibleVideos: [ShortDramaVideo] {
        guard !videos.isEmpty else { return [] }
        let index = activeIndex ?? selectedIndex ?? 0
        let lowerBound = max(0, index - 1)
        let upperBound = min(videos.count - 1, index + 1)
        return Array(videos[lowerBound...upperBound])
    }

    var hasContent: Bool {
        !videos.isEmpty
    }

    func player(for videoID: String) -> AVPlayer? {
        players[videoID]
    }

    func isPlaybackPaused(videoID: String) -> Bool {
        activeVideoID == videoID && isManuallyPaused
    }

    func isPlaybackTarget(videoID: String) -> Bool {
        activeVideoID == videoID
    }

    func startInitialPreload() {
        guard !didLoadInitial else { return }
        _ = initialLoadTaskForLoad()
    }

    func loadInitial() async {
        if didLoadInitial {
            activatePreparedVideoIfNeeded()
            return
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        let loaded = await initialLoadTaskForLoad().value
        initialLoadTask = nil
        if loaded {
            activatePreparedVideoIfNeeded()
        }
    }

    @discardableResult
    func preloadInitial() async -> Bool {
        guard !didLoadInitial else { return true }
        let loaded = await initialLoadTaskForLoad().value
        initialLoadTask = nil
        return loaded
    }

    private func initialLoadTaskForLoad() -> Task<Bool, Never> {
        if let initialLoadTask {
            return initialLoadTask
        }

        let task = Task { [weak self] in
            guard let self else { return false }
            let loaded = await self.performInitialLoad()
            await MainActor.run {
                self.initialLoadTask = nil
            }
            return loaded
        }
        initialLoadTask = task
        return task
    }

    private func performInitialLoad() async -> Bool {
        errorMessage = nil
        do {
            let page = try await APIService.shared.getShortDramaFeed()
            guard !Task.isCancelled else { return false }
            videos = page.videos.filter { !$0.streamingURLString.isBlank }
            hasMore = page.hasMore
            nextCursor = page.nextCursor
            if let first = videos.first {
                selectedVideoID = first.id
                preparePlayerWindow(around: 0)
                preloadNext(after: 0)
            }
            didLoadInitial = true
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func refresh() async {
        pauseAll()
        cancelProgressReports()
        players.removeAll()
        initialLoadTask?.cancel()
        initialLoadTask = nil
        activeVideoID = nil
        selectedVideoID = nil
        nextCursor = nil
        hasMore = true
        didLoadInitial = true
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let page = try await APIService.shared.getShortDramaFeed()
            videos = page.videos.filter { !$0.streamingURLString.isBlank }
            hasMore = page.hasMore
            nextCursor = page.nextCursor
            if let first = videos.first {
                selectedVideoID = first.id
                activate(videoID: first.id)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func activate(videoID: String) {
        focus(videoID: videoID, updateSelection: true)
    }

    func activateUpcoming(videoID: String) {
        focus(videoID: videoID, updateSelection: false)
    }

    func togglePlayback(videoID: String) {
        guard let index = videos.firstIndex(where: { $0.id == videoID }) else { return }
        if activeVideoID != videoID {
            focus(videoID: videoID, updateSelection: true)
            return
        }

        preparePlayerWindow(around: index)
        if isManuallyPaused {
            isManuallyPaused = false
            players[videoID]?.playImmediately(atRate: 1)
        } else {
            isManuallyPaused = true
            players[videoID]?.pause()
            scheduleProgressReport(videoID: videoID)
        }
    }

    private func focus(videoID: String, updateSelection: Bool) {
        guard let index = videos.firstIndex(where: { $0.id == videoID }) else { return }
        let previousID = activeVideoID
        if previousID != videoID {
            if let previousID {
                players[previousID]?.pause()
                scheduleProgressReport(videoID: previousID)
            }
            activeVideoID = videoID
            isManuallyPaused = false
        }

        if updateSelection {
            selectedVideoID = videoID
        }
        preparePlayerWindow(around: index)
        if !isManuallyPaused {
            warmPlayerIfNeeded(videoID)
            players[videoID]?.playImmediately(atRate: 1)
        }
        preloadNext(after: index)
        loadMoreIfNeeded(currentIndex: index)
    }

    private func activatePreparedVideoIfNeeded() {
        guard let targetID = selectedVideoID ?? videos.first?.id else { return }
        activate(videoID: targetID)
    }

    func pauseForBackground() {
        if let activeVideoID {
            players[activeVideoID]?.pause()
            scheduleProgressReport(videoID: activeVideoID)
        }
    }

    func resumeAfterForeground() {
        guard let activeVideoID, !isManuallyPaused else { return }
        players[activeVideoID]?.playImmediately(atRate: 1)
    }

    func leaveFeed() {
        if let activeVideoID {
            scheduleProgressReport(videoID: activeVideoID)
        }
        pauseAll()
    }

    func toggleLike(videoID: String) {
        guard let index = videos.firstIndex(where: { $0.id == videoID }) else { return }
        let previous = videos[index]
        let targetState = !previous.likedByMe
        videos[index].likedByMe = targetState
        videos[index].likeCount = max(0, previous.likeCount + (targetState ? 1 : -1))

        Task {
            do {
                let result = try await APIService.shared.setShortDramaLiked(videoID: videoID, liked: targetState)
                applyInteractionResult(result, videoID: videoID)
            } catch {
                if let rollbackIndex = videos.firstIndex(where: { $0.id == videoID }) {
                    videos[rollbackIndex] = previous
                }
            }
        }
    }

    func toggleFavorite(videoID: String) {
        guard let index = videos.firstIndex(where: { $0.id == videoID }) else { return }
        let previous = videos[index]
        let targetState = !previous.favoritedByMe
        videos[index].favoritedByMe = targetState
        videos[index].favoriteCount = max(0, previous.favoriteCount + (targetState ? 1 : -1))

        Task {
            do {
                let result = try await APIService.shared.setShortDramaFavorited(videoID: videoID, favorited: targetState)
                applyInteractionResult(result, videoID: videoID)
            } catch {
                if let rollbackIndex = videos.firstIndex(where: { $0.id == videoID }) {
                    videos[rollbackIndex] = previous
                }
            }
        }
    }

    func toggleFollowCreator(userID: String) {
        guard let firstIndex = videos.firstIndex(where: { $0.creator.userID == userID }) else { return }
        let previousVideos = videos
        let targetState = !videos[firstIndex].creator.followedByMe
        updateCreatorFollowState(userID: userID, followed: targetState)

        Task {
            do {
                let relationship = targetState
                    ? try await APIService.shared.followUser(userID: userID)
                    : try await APIService.shared.unfollowUser(userID: userID)
                updateCreatorFollowState(userID: userID, followed: relationship.followedByMe)
            } catch {
                videos = previousVideos
            }
        }
    }

    func incrementCommentCount(videoID: String) {
        guard let index = videos.firstIndex(where: { $0.id == videoID }) else { return }
        videos[index].commentCount += 1
    }

    private func preparePlayerWindow(around index: Int) {
        guard videos.indices.contains(index) else { return }
        let keepRange = max(0, index - 1)...min(videos.count - 1, index + 1)
        let keepIDs = Set(keepRange.map { videos[$0].id })

        for videoIndex in keepRange {
            let video = videos[videoIndex]
            if players[video.id] == nil, let player = makePlayer(for: video) {
                players[video.id] = player
            }
            warmPlayerIfNeeded(video.id)
        }

        let removeIDs = players.keys.filter { !keepIDs.contains($0) }
        for videoID in removeIDs {
            players[videoID]?.pause()
            players[videoID] = nil
            warmingVideoIDs.remove(videoID)
            warmedVideoIDs.remove(videoID)
            lastReportedProgressSeconds.removeValue(forKey: videoID)
        }
    }

    private func preloadNext(after index: Int) {
        let nextIndex = index + 1
        guard videos.indices.contains(nextIndex) else { return }
        let nextVideo = videos[nextIndex]
        if players[nextVideo.id] == nil, let player = makePlayer(for: nextVideo) {
            player.pause()
            players[nextVideo.id] = player
        }
        warmPlayerIfNeeded(nextVideo.id)
    }

    private func makePlayer(for video: ShortDramaVideo) -> AVPlayer? {
        guard let url = resolvedMediaURL(video.streamingURLString) else { return nil }
        let asset = AVURLAsset(url: url)
        let item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = 3
        item.canUseNetworkResourcesForLiveStreamingWhilePaused = true

        let player = AVPlayer(playerItem: item)
        player.actionAtItemEnd = .none
        player.automaticallyWaitsToMinimizeStalling = false
        if video.playbackPositionSeconds > 1 {
            player.seek(to: CMTime(seconds: video.playbackPositionSeconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        }
        return player
    }

    private func warmPlayerIfNeeded(_ videoID: String) {
        guard !warmingVideoIDs.contains(videoID),
              !warmedVideoIDs.contains(videoID),
              let item = players[videoID]?.currentItem else { return }

        warmingVideoIDs.insert(videoID)
        item.preferredForwardBufferDuration = 3
        item.canUseNetworkResourcesForLiveStreamingWhilePaused = true

        let asset = item.asset
        asset.loadValuesAsynchronously(forKeys: ["playable", "tracks"]) { [weak self] in
            Task { @MainActor [weak self] in
                self?.warmingVideoIDs.remove(videoID)
                self?.warmedVideoIDs.insert(videoID)
            }
        }
    }

    private func resolvedMediaURL(_ rawValue: String) -> URL? {
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let url = URL(string: trimmed), url.scheme?.hasPrefix("http") == true {
            return url
        }

        let baseURL = APIService.shared.baseURL
        let urlString: String
        if trimmed.hasPrefix("/api/v1/") {
            urlString = baseURL.replacingOccurrences(of: "/api/v1", with: "") + trimmed
        } else if trimmed.hasPrefix("/") {
            urlString = baseURL + trimmed
        } else {
            urlString = baseURL + "/" + trimmed
        }
        return URL(string: urlString)
    }

    private func loadMoreIfNeeded(currentIndex: Int) {
        guard currentIndex >= videos.count - 3,
              hasMore,
              !isLoadingMore else { return }

        Task { await loadMore() }
    }

    private func loadMore() async {
        guard hasMore, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }

        do {
            let page = try await APIService.shared.getShortDramaFeed(cursor: nextCursor)
            let existingIDs = Set(videos.map(\.id))
            videos.append(contentsOf: page.videos.filter { !existingIDs.contains($0.id) && !$0.streamingURLString.isBlank })
            hasMore = page.hasMore
            nextCursor = page.nextCursor
        } catch { }
    }

    private func scheduleProgressReport(videoID: String) {
        guard let player = players[videoID] else { return }
        let seconds = player.currentTime().seconds
        guard seconds.isFinite, seconds >= 0 else { return }
        let duration = player.currentItem?.duration.seconds
        let safeDuration = duration?.isFinite == true ? duration : nil

        if let index = videos.firstIndex(where: { $0.id == videoID }) {
            videos[index].playbackPositionSeconds = seconds
        }

        if let lastSeconds = lastReportedProgressSeconds[videoID],
           abs(seconds - lastSeconds) < 0.75 {
            return
        }
        lastReportedProgressSeconds[videoID] = seconds

        progressReportTasks[videoID]?.cancel()
        let token = UUID()
        progressReportTokens[videoID] = token
        progressReportTasks[videoID] = Task { [weak self] in
            do {
                try await APIService.shared.reportShortDramaProgress(
                    videoID: videoID,
                    positionSeconds: seconds,
                    durationSeconds: safeDuration
                )
            } catch { }

            await MainActor.run { [weak self] in
                guard let self, self.progressReportTokens[videoID] == token else { return }
                self.progressReportTasks[videoID] = nil
                self.progressReportTokens[videoID] = nil
            }
        }
    }

    private func cancelProgressReports() {
        progressReportTasks.values.forEach { $0.cancel() }
        progressReportTasks.removeAll()
        progressReportTokens.removeAll()
    }

    private func pauseAll() {
        players.values.forEach { $0.pause() }
    }

    private func applyInteractionResult(_ result: ShortDramaInteractionResult, videoID: String) {
        guard let index = videos.firstIndex(where: { $0.id == videoID }) else { return }
        if let liked = result.liked {
            videos[index].likedByMe = liked
        }
        if let favorited = result.favorited {
            videos[index].favoritedByMe = favorited
        }
        if let likeCount = result.likeCount {
            videos[index].likeCount = max(0, likeCount)
        }
        if let favoriteCount = result.favoriteCount {
            videos[index].favoriteCount = max(0, favoriteCount)
        }
    }

    private func updateCreatorFollowState(userID: String, followed: Bool) {
        for index in videos.indices where videos[index].creator.userID == userID {
            videos[index].creator.followedByMe = followed
        }
    }

    private var activeIndex: Int? {
        guard let activeVideoID else { return nil }
        return videos.firstIndex { $0.id == activeVideoID }
    }

    private var selectedIndex: Int? {
        guard let selectedVideoID else { return nil }
        return videos.firstIndex { $0.id == selectedVideoID }
    }
}
