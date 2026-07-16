// BWChat/ViewModels/ShortDramaFeedViewModel.swift
// TikTok-style short drama feed playback and optimistic interactions.

import AVFoundation
import Foundation

enum ShortDramaMediaSecurity {
    static func authorizationHeaders(
        for mediaURL: URL,
        apiBaseURL: String,
        token: String?
    ) -> [String: String]? {
        guard let apiURL = URL(string: apiBaseURL),
              sameOrigin(mediaURL, apiURL),
              isInsideAPIPath(mediaURL.path, apiBasePath: apiURL.path) else {
            return nil
        }
        var request = URLRequest(url: mediaURL)
        guard AuthRequestAuthorizer.addAuthHeader(&request, token: token),
              let authorization = request.value(forHTTPHeaderField: "Authorization") else {
            return nil
        }
        return ["Authorization": authorization]
    }

    private static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        lhs.scheme?.lowercased() == rhs.scheme?.lowercased()
            && lhs.host?.lowercased() == rhs.host?.lowercased()
            && effectivePort(for: lhs) == effectivePort(for: rhs)
    }

    private static func effectivePort(for url: URL) -> Int? {
        if let port = url.port { return port }
        switch url.scheme?.lowercased() {
        case "http": return 80
        case "https": return 443
        default: return nil
        }
    }

    private static func isInsideAPIPath(_ mediaPath: String, apiBasePath: String) -> Bool {
        let normalizedBasePath = apiBasePath.hasSuffix("/")
            ? String(apiBasePath.dropLast())
            : apiBasePath
        guard !normalizedBasePath.isEmpty, normalizedBasePath != "/" else { return true }
        return mediaPath == normalizedBasePath || mediaPath.hasPrefix(normalizedBasePath + "/")
    }
}

@MainActor
final class ShortDramaFeedViewModel: ObservableObject {
    @Published private(set) var videos: [ShortDramaVideo] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published private(set) var players: [String: AVPlayer] = [:]
    @Published private(set) var isManuallyPaused = false
    @Published var selectedVideoID: String?
    @Published var errorMessage: String?

    let seriesID: String?
    private let initialEpisodeID: String?
    private let initialPositionSeconds: Double

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
    private var audioProbeTasks: [String: Task<Void, Never>] = [:]
    private var loopObservers: [String: PlaybackLoopObserver] = [:]
    private var loopingVideoIDs = Set<String>()
    private var didConfigurePlaybackAudioSession = false

    init(seriesID: String? = nil, initialEpisodeID: String? = nil, initialPositionSeconds: Double = 0) {
        self.seriesID = seriesID
        self.initialEpisodeID = initialEpisodeID
        self.initialPositionSeconds = max(0, initialPositionSeconds)
        if let key = Self.cacheKey(seriesID: seriesID),
           let cached: CachedSnapshot<ShortDramaFeedPage> = AppCacheRepository.shared.cachedValue(for: key) {
            videos = cached.value.videos
            hasMore = cached.value.hasMore
            nextCursor = cached.value.nextCursor
            selectedVideoID = initialEpisodeID.flatMap { id in videos.contains(where: { $0.id == id }) ? id : nil }
                ?? videos.first?.id
        }
    }

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
            let page = try await loadPage(forceRefresh: false)
            guard !Task.isCancelled else { return false }
            videos = normalizedVideos(page.videos)
            hasMore = page.hasMore
            nextCursor = page.nextCursor
            persistFeed()
            if let initialEpisodeID,
               let initialIndex = videos.firstIndex(where: { $0.id == initialEpisodeID }) {
                videos[initialIndex].playbackPositionSeconds = initialPositionSeconds
                selectedVideoID = initialEpisodeID
                preparePlayerWindow(around: initialIndex)
                preloadNext(after: initialIndex)
            } else if let first = videos.first {
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
        cancelAudioProbes()
        removeAllLoopObservers()
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
            let page = try await loadPage(forceRefresh: true)
            videos = normalizedVideos(page.videos)
            hasMore = page.hasMore
            nextCursor = page.nextCursor
            persistFeed()
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
            configurePlaybackAudioSession()
            makeAudible(players[videoID])
            players[videoID]?.play()
            scheduleMediaCache(for: videos[index])
        } else {
            isManuallyPaused = true
            players[videoID]?.pause()
            scheduleProgressReport(videoID: videoID)
        }
    }

    private func focus(videoID: String, updateSelection: Bool) {
        guard let index = videos.firstIndex(where: { $0.id == videoID }) else { return }
        let video = videos[index]
        ShortDramaHistoryStore.shared.save(
            seriesID: video.dramaID.isBlank ? (seriesID ?? "") : video.dramaID,
            episodeID: video.id,
            positionSeconds: video.playbackPositionSeconds
        )
        guard !video.requiresUnlock else {
            players[videoID]?.pause()
            activeVideoID = videoID
            if updateSelection { selectedVideoID = videoID }
            return
        }
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
            configurePlaybackAudioSession()
            warmPlayerIfNeeded(videoID)
            makeAudible(players[videoID])
            players[videoID]?.play()
            scheduleMediaCache(for: video)
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
        configurePlaybackAudioSession()
        makeAudible(players[activeVideoID])
        players[activeVideoID]?.play()
    }

    func leaveFeed() {
        if let activeVideoID {
            scheduleProgressReport(videoID: activeVideoID)
        }
        pauseAll()
        videos.forEach { MediaCacheManager.shared.cancelScheduledCache(mediaID: "short-drama:\($0.id)") }
        cancelAudioProbes()
        removeAllLoopObservers()
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
            audioProbeTasks[videoID]?.cancel()
            audioProbeTasks[videoID] = nil
            removeLoopObserver(for: videoID)
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
        guard !video.requiresUnlock else { return nil }
        let candidates = mediaCandidates(for: video)
        guard let primary = candidates.first else { return nil }
        let url = primary.url
        let playbackURL = MediaCacheManager.shared.localURL(mediaID: "short-drama:\(video.id)") ?? url
        let asset = makeAsset(for: playbackURL)
        let item = makePlayerItem(asset: asset)

        let player = AVPlayer(playerItem: item)
        player.actionAtItemEnd = .none
        player.automaticallyWaitsToMinimizeStalling = true
        makeAudible(player)
        observeLoop(for: video.id, player: player, item: item)
        if video.playbackPositionSeconds > 1 {
            player.seek(to: CMTime(seconds: video.playbackPositionSeconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        }
        probeAudioAndFallbackIfNeeded(
            videoID: video.id,
            primaryLabel: primary.label,
            primaryURL: url,
            primaryAsset: asset,
            player: player,
            fallbackCandidates: Array(candidates.dropFirst())
        )
        return player
    }

    private func makePlayerItem(asset: AVURLAsset) -> AVPlayerItem {
        let item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = 3
        item.canUseNetworkResourcesForLiveStreamingWhilePaused = true
        return item
    }

    private func makeAsset(for url: URL) -> AVURLAsset {
        let headers = ShortDramaMediaSecurity.authorizationHeaders(
            for: url,
            apiBaseURL: APIService.shared.baseURL,
            token: AuthManager.shared.token
        )
        let options: [String: Any]? = headers.map { ["AVURLAssetHTTPHeaderFieldsKey": $0] }
        return AVURLAsset(url: url, options: options)
    }

    private func scheduleMediaCache(for video: ShortDramaVideo) {
        guard !video.requiresUnlock, let remoteURL = mediaCandidates(for: video).first?.url else { return }
        let headers = ShortDramaMediaSecurity.authorizationHeaders(
            for: remoteURL,
            apiBaseURL: APIService.shared.baseURL,
            token: AuthManager.shared.token
        )
        MediaCacheManager.shared.scheduleCache(
            mediaID: "short-drama:\(video.id)",
            remoteURL: remoteURL,
            authorizationHeaders: headers
        )
    }

    private func mediaCandidates(for video: ShortDramaVideo) -> [(label: String, url: URL)] {
        var candidates: [(String, String)] = [("primary", video.streamingURLString)]
        if let mp4URL = nonEmpty(video.mp4URL) {
            candidates.append(("mp4_url", mp4URL))
        }
        if let playURL = nonEmpty(video.playURL) {
            candidates.append(("play_url", playURL))
        }
        if let hlsURL = nonEmpty(video.hlsURL) {
            candidates.append(("hls_url", hlsURL))
        }

        var seen = Set<String>()
        return candidates.compactMap { label, rawValue in
            guard let url = resolvedMediaURL(rawValue) else { return nil }
            let key = url.absoluteString
            guard seen.insert(key).inserted else { return nil }
            return (label, url)
        }
    }

    private func nonEmpty(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private func probeAudioAndFallbackIfNeeded(
        videoID: String,
        primaryLabel: String,
        primaryURL: URL,
        primaryAsset: AVURLAsset,
        player: AVPlayer,
        fallbackCandidates: [(label: String, url: URL)]
    ) {
        guard !fallbackCandidates.isEmpty else { return }
        audioProbeTasks[videoID]?.cancel()
        audioProbeTasks[videoID] = Task { [weak self, weak player] in
            let hasAudio = await Self.assetHasAudio(primaryAsset)
            guard !Task.isCancelled, hasAudio == false else { return }
            await MainActor.run { [weak self, weak player] in
                guard let self,
                      let player,
                      player.currentItem?.asset === primaryAsset,
                      let fallback = fallbackCandidates.first else { return }

                #if DEBUG
                print("[ShortDrama] \(videoID) primary \(primaryLabel) has no audio track: \(primaryURL.absoluteString). Fallback to \(fallback.label): \(fallback.url.absoluteString)")
                #endif

                let fallbackAsset = self.makeAsset(for: fallback.url)
                let fallbackItem = self.makePlayerItem(asset: fallbackAsset)
                let currentTime = player.currentTime()
                let shouldResume = player.rate > 0
                player.replaceCurrentItem(with: fallbackItem)
                self.makeAudible(player)
                self.observeLoop(for: videoID, player: player, item: fallbackItem)
                if currentTime.seconds.isFinite, currentTime.seconds > 0 {
                    player.seek(to: currentTime, toleranceBefore: .zero, toleranceAfter: .zero)
                }
                if shouldResume {
                    player.play()
                }
                self.audioProbeTasks[videoID] = nil
            }
        }
    }

    private static func assetHasAudio(_ asset: AVURLAsset) async -> Bool? {
        await withCheckedContinuation { continuation in
            asset.loadValuesAsynchronously(forKeys: ["tracks"]) {
                var error: NSError?
                let status = asset.statusOfValue(forKey: "tracks", error: &error)
                guard status == .loaded else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: !asset.tracks(withMediaType: .audio).isEmpty)
            }
        }
    }

    private func configurePlaybackAudioSession() {
        guard !didConfigurePlaybackAudioSession else { return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .moviePlayback, options: [.allowAirPlay])
            try session.setActive(true)
            didConfigurePlaybackAudioSession = true
        } catch {
            didConfigurePlaybackAudioSession = false
        }
    }

    private func makeAudible(_ player: AVPlayer?) {
        player?.isMuted = false
        player?.volume = 1
    }

    private func observeLoop(for videoID: String, player: AVPlayer, item: AVPlayerItem) {
        removeLoopObserver(for: videoID)

        let endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self, weak player, weak item] _ in
            Task { @MainActor [weak self, weak player, weak item] in
                guard let player, let item else { return }
                self?.loopIfNeeded(videoID: videoID, player: player, item: item, requireNearEnd: false)
            }
        }

        let timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.35, preferredTimescale: 600),
            queue: .main
        ) { [weak self, weak player, weak item] _ in
            Task { @MainActor [weak self, weak player, weak item] in
                guard let player, let item else { return }
                self?.loopIfNeeded(videoID: videoID, player: player, item: item, requireNearEnd: true)
            }
        }

        let failureObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: item,
            queue: .main
        ) { notification in
            #if DEBUG
            let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
            print("[ShortDrama] \(videoID) playback failed: \(error?.localizedDescription ?? item.error?.localizedDescription ?? "unknown error")")
            #endif
        }

        let statusObservation = item.observe(\.status, options: [.new]) { item, _ in
            guard item.status == .failed else { return }
            #if DEBUG
            let details = item.errorLog()?.events
                .suffix(3)
                .map { "status=\($0.errorStatusCode) domain=\($0.errorDomain) comment=\($0.errorComment ?? "")" }
                .joined(separator: " | ") ?? ""
            print("[ShortDrama] \(videoID) item failed: \(item.error?.localizedDescription ?? "unknown error") \(details)")
            #endif
        }

        loopObservers[videoID] = PlaybackLoopObserver(
            player: player,
            endObserver: endObserver,
            timeObserver: timeObserver,
            failureObserver: failureObserver,
            statusObservation: statusObservation
        )
    }

    private func loopIfNeeded(videoID: String, player: AVPlayer, item: AVPlayerItem, requireNearEnd: Bool) {
        guard activeVideoID == videoID,
              !isManuallyPaused,
              player.currentItem === item,
              !loopingVideoIDs.contains(videoID) else { return }

        if requireNearEnd {
            let duration = item.duration.seconds
            let current = player.currentTime().seconds
            guard player.rate > 0,
                  duration.isFinite,
                  duration > 0.5,
                  current.isFinite,
                  current >= max(0, duration - 0.25) else { return }
        }

        loopingVideoIDs.insert(videoID)
        makeAudible(player)
        player.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self, weak player, weak item] _ in
            Task { @MainActor [weak self, weak player, weak item] in
                guard let self else { return }
                self.loopingVideoIDs.remove(videoID)
                guard let player,
                      let item,
                      self.activeVideoID == videoID,
                      !self.isManuallyPaused,
                      player.currentItem === item else { return }
                self.makeAudible(player)
                player.play()
            }
        }
    }

    private func removeLoopObserver(for videoID: String) {
        guard let observer = loopObservers.removeValue(forKey: videoID) else { return }
        NotificationCenter.default.removeObserver(observer.endObserver)
        NotificationCenter.default.removeObserver(observer.failureObserver)
        observer.statusObservation.invalidate()
        observer.player.removeTimeObserver(observer.timeObserver)
        loopingVideoIDs.remove(videoID)
    }

    private func removeAllLoopObservers() {
        Array(loopObservers.keys).forEach(removeLoopObserver)
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
        guard seriesID == nil else { return }
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
            persistFeed()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func scheduleProgressReport(videoID: String) {
        guard let player = players[videoID] else { return }
        let seconds = player.currentTime().seconds
        guard seconds.isFinite, seconds >= 0 else { return }
        let duration = player.currentItem?.duration.seconds
        let safeDuration = duration?.isFinite == true ? duration : nil

        if let index = videos.firstIndex(where: { $0.id == videoID }) {
            videos[index].playbackPositionSeconds = seconds
            let video = videos[index]
            ShortDramaHistoryStore.shared.save(
                seriesID: video.dramaID.isBlank ? (seriesID ?? "") : video.dramaID,
                episodeID: video.id,
                positionSeconds: seconds
            )
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

    private func cancelAudioProbes() {
        audioProbeTasks.values.forEach { $0.cancel() }
        audioProbeTasks.removeAll()
    }

    private struct PlaybackLoopObserver {
        let player: AVPlayer
        let endObserver: NSObjectProtocol
        let timeObserver: Any
        let failureObserver: NSObjectProtocol
        let statusObservation: NSKeyValueObservation
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

    func video(videoID: String?) -> ShortDramaVideo? {
        guard let videoID else { return nil }
        return videos.first { $0.id == videoID }
    }

    func unlock(videoID: String) async -> Bool {
        guard let index = videos.firstIndex(where: { $0.id == videoID }) else { return false }
        do {
            let result = try await APIService.shared.unlockShortDramaEpisode(videoID: videoID)
            if let balance = result.walletBalance {
                WalletStore.shared.applyServerBalance(balance)
            }
            if let unlocked = result.video {
                videos[index] = unlocked
            } else {
                videos[index].isUnlocked = true
            }
            preparePlayerWindow(around: index)
            activate(videoID: videoID)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    private func loadPage(forceRefresh: Bool) async throws -> ShortDramaFeedPage {
        let fetch: () async throws -> ShortDramaFeedPage = {
            guard let seriesID = self.seriesID else {
                return try await APIService.shared.getShortDramaFeed()
            }
            let series = try await APIService.shared.getShortDramaSeriesDetail(seriesID: seriesID)
            return ShortDramaFeedPage(videos: series.episodes, hasMore: false, nextCursor: nil)
        }
        guard let key = Self.cacheKey(seriesID: seriesID) else { return try await fetch() }
        return try await AppCacheRepository.shared.loadValue(
            key: key,
            policy: .mediaFeed,
            forceRefresh: forceRefresh,
            fetch: fetch
        )
    }

    private func persistFeed() {
        guard let key = Self.cacheKey(seriesID: seriesID) else { return }
        AppCacheRepository.shared.save(
            ShortDramaFeedPage(
                videos: Array(videos.prefix(200)),
                hasMore: hasMore,
                nextCursor: nextCursor
            ),
            for: key,
            policy: .mediaFeed
        )
    }

    private static func cacheKey(seriesID: String?) -> CacheKey? {
        CacheKey.current(namespace: "short-drama-feed", key: seriesID ?? "recommended")
    }

    private func normalizedVideos(_ source: [ShortDramaVideo]) -> [ShortDramaVideo] {
        source
            .filter { !$0.streamingURLString.isBlank || $0.requiresUnlock }
            .sorted {
                let lhs = $0.episodeNumber ?? Int.max
                let rhs = $1.episodeNumber ?? Int.max
                return lhs == rhs ? $0.id < $1.id : lhs < rhs
            }
    }
}
