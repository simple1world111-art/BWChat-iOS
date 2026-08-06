import SwiftUI
import UIKit
import WebKit

protocol GameCenterAPIClient: AnyObject {
    func getRecommendedGames(limit: Int, cursor: String?) async throws -> GameCatalogPage
    func getPlayedGames(limit: Int, cursor: String?) async throws -> GameCatalogPage
    func createGameLobbySession(
        gameID: String,
        idempotencyKey: UUID
    ) async throws -> GameSession
    func startGameRound(
        gameID: String,
        sessionID: String,
        idempotencyKey: UUID
    ) async throws -> GameRoundStart
}

extension APIService: GameCenterAPIClient {}

@MainActor
struct GameCenterView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var store: GameCenterStore
    @ObservedObject private var walletStore: WalletStore
    @ObservedObject private var remoteConfig = AppRemoteConfigStore.shared
    @State private var selectedTab: GameCenterTab = .recommended
    @State private var alertMessage: String?
    @State private var refreshPlayedAfterReturn = false

    init(
        api: GameCenterAPIClient? = nil,
        walletStore: WalletStore? = nil
    ) {
        let resolvedAPI = api ?? APIService.shared
        _store = StateObject(wrappedValue: GameCenterStore(api: resolvedAPI))
        _walletStore = ObservedObject(wrappedValue: walletStore ?? .shared)
    }

    var body: some View {
        ScrollView {
            Group {
                switch selectedTab {
                case .recommended:
                    recommendedContent
                case .played:
                    playedContent
                }
            }
            .padding(.vertical, 18)
        }
        .refreshable {
            await refreshSelectedTab()
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.clear, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbarColorScheme(.light, for: .navigationBar)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
        .toolbar {
            ToolbarItem(placement: .principal) {
                GameCenterTabBar(selection: $selectedTab)
            }
        }
        .task {
            GameWebViewPool.shared.prewarm()
            await store.loadInitial()
        }
        .onAppear {
            guard refreshPlayedAfterReturn else { return }
            refreshPlayedAfterReturn = false
            Task { await store.loadPlayed(force: true) }
        }
        .alert(
            L10n.tr("common.operationFailed"),
            isPresented: Binding(
                get: { alertMessage != nil },
                set: { if !$0 { alertMessage = nil } }
            )
        ) {
            Button(L10n.tr("common.ok"), role: .cancel) { alertMessage = nil }
        } message: {
            Text(alertMessage ?? L10n.tr("common.operationFailed"))
        }
    }

    @ViewBuilder
    private var recommendedContent: some View {
        if store.isLoadingRecommended && store.recommendedGames.isEmpty {
            loadingState
        } else if store.recommendedLoadFailed && store.recommendedGames.isEmpty {
            GameCenterMessageState(
                systemImage: "wifi.exclamationmark",
                message: L10n.tr("gameCenter.loadFailed"),
                actionTitle: L10n.tr("common.retry"),
                action: { Task { await store.loadRecommended(reset: true) } }
            )
            .frame(minHeight: 320)
        } else if store.recommendedGames.isEmpty {
            GameCenterMessageState(
                systemImage: "gamecontroller",
                message: L10n.tr("gameCenter.recommended.empty")
            )
            .frame(minHeight: 320)
        } else {
            LazyVStack(spacing: 12) {
                ForEach(store.recommendedGames) { game in
                    gameCard(game)
                        .onAppear {
                            Task { await store.loadMoreRecommendedIfNeeded(current: game) }
                        }
                }
                .padding(.horizontal, 16)

                if store.isLoadingNextRecommendedPage {
                    ProgressView()
                        .tint(AppColors.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
            }
        }
    }

    @ViewBuilder
    private var playedContent: some View {
        if store.isLoadingPlayed && store.playedGames.isEmpty {
            loadingState
        } else if store.playedLoadFailed && store.playedGames.isEmpty {
            GameCenterMessageState(
                systemImage: "wifi.exclamationmark",
                message: L10n.tr("gameCenter.loadFailed"),
                actionTitle: L10n.tr("common.retry"),
                action: { Task { await store.loadPlayed(force: true) } }
            )
            .frame(minHeight: 320)
        } else if store.playedGames.isEmpty {
            GameCenterMessageState(
                systemImage: "clock.arrow.circlepath",
                message: L10n.tr("gameCenter.played.empty")
            )
            .frame(minHeight: 320)
        } else {
            LazyVStack(spacing: 12) {
                ForEach(store.playedGames) { game in
                    gameCard(game)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private var loadingState: some View {
        ProgressView()
            .tint(AppColors.accent)
            .frame(maxWidth: .infinity, minHeight: 320)
    }

    private func gameCard(_ game: GameCatalogItem) -> some View {
        GameListCard(
            game: game,
            isLaunching: store.launchingGameID == game.id,
            action: { openGame(game) }
        )
    }

    private func openGame(_ game: GameCatalogItem) {
        guard !store.isLaunching else { return }
        guard store.beginLaunching(gameID: game.id) else { return }
        let idempotencyKey = UUID()

        Task {
            defer { store.finishLaunching(gameID: game.id) }
            do {
                let session = try await store.createLobbySession(
                    for: game.id,
                    idempotencyKey: idempotencyKey
                )
                try Task.checkCancellation()
                let gamePolicy = remoteConfig.config.webViewPolicy.gameLaunchPolicy
                guard let url = URL(string: session.launchURL),
                      GameWebSecurity.allowsInitialGameURL(url, policy: gamePolicy) else {
                    alertMessage = L10n.tr("gameCenter.invalidURL")
                    return
                }

                navigator.push(InAppWebView(
                    url: url,
                    title: game.name,
                    restrictToInitialOrigin: true,
                    gameEntryContext: GameEntryContext(
                        gameID: game.id,
                        sessionID: session.sessionID,
                        walletStore: walletStore,
                        startRound: { request in
                            let round = try await store.startRound(
                                gameID: game.id,
                                sessionID: session.sessionID,
                                idempotencyKey: request.idempotencyKey
                            )
                            store.recordPlayed(game)
                            refreshPlayedAfterReturn = true
                            return round
                        }
                    )
                ), allowsSwipeBack: false)
            } catch is CancellationError {
                return
            } catch {
                alertMessage = GameRoundStartErrorText.message(for: error)
            }
        }
    }

    private func refreshSelectedTab() async {
        switch selectedTab {
        case .recommended:
            await store.loadRecommended(reset: true)
        case .played:
            await store.loadPlayed(force: true)
        }
    }
}

enum GameCenterTab: String, CaseIterable, Identifiable {
    case recommended
    case played

    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .recommended: return "gameCenter.tab.recommended"
        case .played: return "gameCenter.tab.played"
        }
    }
}

enum GameRoundStartErrorText {
    static func message(for error: Error) -> String {
        guard let apiError = error as? APIError else {
            return L10n.tr("gameCenter.sessionFailed")
        }

        let candidates: [String]
        switch apiError {
        case .businessError(let code, let message, _):
            candidates = [code, message]
        case .serverError(_, let message):
            candidates = [message]
        default:
            return L10n.tr("gameCenter.sessionFailed")
        }

        let normalized = candidates.joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        if normalized.contains("insufficient_gold_coins")
            || normalized.contains("insufficient_balance")
            || normalized.contains("金币余额不足") {
            return L10n.tr("gameRound.error.insufficientCoins")
        }
        if normalized.contains("idempotency_conflict") {
            return L10n.tr("gameRound.error.requestConflict")
        }
        if normalized.contains("game_session_rate_limited") {
            return L10n.tr("gameRound.error.rateLimited")
        }
        if normalized.contains("game_not_found")
            || normalized.contains("game_unavailable") {
            return L10n.tr("gameRound.error.gameUnavailable")
        }
        return L10n.tr("gameCenter.sessionFailed")
    }
}

private struct GameCenterTabBar: View {
    @Binding var selection: GameCenterTab

    var body: some View {
        SystemSegmentedTabs(
            items: GameCenterTab.allCases,
            selection: $selection,
            title: { L10n.tr($0.titleKey) },
            accessibilityIdentifier: "gameCenter.top.tabs"
        )
        .frame(width: 196)
    }
}

@MainActor
final class GameCenterStore: ObservableObject {
    @Published private(set) var recommendedGames: [GameCatalogItem] = []
    @Published private(set) var playedGames: [GameCatalogItem] = []
    @Published private(set) var isLoadingRecommended = false
    @Published private(set) var isLoadingNextRecommendedPage = false
    @Published private(set) var recommendedLoadFailed = false
    @Published private(set) var isLoadingPlayed = false
    @Published private(set) var playedLoadFailed = false
    @Published private(set) var launchingGameID: String?

    var isLaunching: Bool { launchingGameID != nil }

    private let api: GameCenterAPIClient
    private let usesCache: Bool
    private var recommendedNextCursor: String?
    private var requestedRecommendedCursors = Set<String>()
    private var hasLoadedRecommended = false
    private var hasLoadedPlayed = false

    init(api: GameCenterAPIClient, usesCache: Bool = true) {
        self.api = api
        self.usesCache = usesCache
        guard usesCache else { return }
        if let key = CacheKey.current(namespace: "games", key: "recommended"),
           let cached: CachedSnapshot<GameCatalogPage> = AppCacheRepository.shared.cachedValue(for: key) {
            recommendedGames = cached.value.items
            recommendedNextCursor = cached.value.nextCursor
        }
        if let key = CacheKey.current(namespace: "games", key: "played"),
           let cached: CachedSnapshot<GameCatalogPage> = AppCacheRepository.shared.cachedValue(for: key) {
            playedGames = cached.value.items
        }
    }

    func loadInitial() async {
        async let recommended: Void = loadRecommended(reset: false)
        async let played: Void = loadPlayed(force: false)
        _ = await (recommended, played)
    }

    func refreshAll() async {
        async let recommended: Void = loadRecommended(reset: true)
        async let played: Void = loadPlayed(force: true)
        _ = await (recommended, played)
    }

    func loadRecommended(reset: Bool) async {
        if !reset, hasLoadedRecommended { return }
        guard !isLoadingRecommended, !isLoadingNextRecommendedPage else { return }

        isLoadingRecommended = true
        recommendedLoadFailed = false
        defer { isLoadingRecommended = false }

        do {
            let page: GameCatalogPage
            if usesCache,
               let key = CacheKey.current(namespace: "games", key: "recommended") {
                page = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .profile,
                    forceRefresh: reset
                ) {
                    try await self.api.getRecommendedGames(limit: 50, cursor: nil)
                }
            } else {
                page = try await api.getRecommendedGames(limit: 50, cursor: nil)
            }
            try Task.checkCancellation()
            recommendedGames = Self.deduplicated(page.items)
            recommendedNextCursor = page.nextCursor
            requestedRecommendedCursors.removeAll()
            hasLoadedRecommended = true
        } catch is CancellationError {
            return
        } catch {
            recommendedLoadFailed = true
        }
    }

    func loadMoreRecommendedIfNeeded(current: GameCatalogItem) async {
        guard let index = recommendedGames.firstIndex(where: { $0.id == current.id }),
              index >= max(recommendedGames.count - 4, 0),
              let cursor = recommendedNextCursor,
              !cursor.isEmpty,
              !requestedRecommendedCursors.contains(cursor),
              !isLoadingRecommended,
              !isLoadingNextRecommendedPage else {
            return
        }

        requestedRecommendedCursors.insert(cursor)
        isLoadingNextRecommendedPage = true
        defer { isLoadingNextRecommendedPage = false }

        do {
            let page = try await api.getRecommendedGames(limit: 50, cursor: cursor)
            try Task.checkCancellation()
            recommendedGames = Self.deduplicated(recommendedGames + page.items)
            recommendedNextCursor = page.nextCursor
            if usesCache,
               let key = CacheKey.current(namespace: "games", key: "recommended") {
                AppCacheRepository.shared.save(
                    GameCatalogPage(items: Array(recommendedGames.prefix(200)), nextCursor: recommendedNextCursor),
                    for: key,
                    policy: .profile
                )
            }
        } catch is CancellationError {
            requestedRecommendedCursors.remove(cursor)
        } catch {
            requestedRecommendedCursors.remove(cursor)
        }
    }

    func loadPlayed(force: Bool) async {
        if !force, hasLoadedPlayed { return }
        guard !isLoadingPlayed else { return }
        isLoadingPlayed = true
        playedLoadFailed = false
        defer { isLoadingPlayed = false }

        do {
            let page: GameCatalogPage
            if usesCache,
               let key = CacheKey.current(namespace: "games", key: "played") {
                page = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .profile,
                    forceRefresh: force
                ) {
                    try await self.api.getPlayedGames(limit: 50, cursor: nil)
                }
            } else {
                page = try await api.getPlayedGames(limit: 50, cursor: nil)
            }
            try Task.checkCancellation()
            playedGames = Self.deduplicated(page.items)
            hasLoadedPlayed = true
        } catch is CancellationError {
            return
        } catch {
            playedLoadFailed = true
        }
    }

    func createLobbySession(
        for gameID: String,
        idempotencyKey: UUID
    ) async throws -> GameSession {
        let session = try await api.createGameLobbySession(
            gameID: gameID,
            idempotencyKey: idempotencyKey
        )
        try GameLobbySessionResponseValidator.validate(session)
        return session
    }

    func startRound(
        gameID: String,
        sessionID: String,
        idempotencyKey: UUID
    ) async throws -> GameRoundStart {
        let round = try await api.startGameRound(
            gameID: gameID,
            sessionID: sessionID,
            idempotencyKey: idempotencyKey
        )
        try GameRoundStartResponseValidator.validate(round)
        return round
    }

    func beginLaunching(gameID: String) -> Bool {
        guard launchingGameID == nil else { return false }
        launchingGameID = gameID
        return true
    }

    func finishLaunching(gameID: String) {
        guard launchingGameID == gameID else { return }
        launchingGameID = nil
    }

    func recordPlayed(_ game: GameCatalogItem) {
        let recent = GameCatalogItem(
            id: game.id,
            name: game.name,
            posterURL: game.posterURL,
            iconURL: game.iconURL,
            summary: game.summary,
            gameType: game.gameType,
            entryPriceGoldCoins: game.entryPriceGoldCoins,
            sortOrder: game.sortOrder,
            lastPlayedAt: ISO8601DateFormatter().string(from: Date())
        )
        playedGames.removeAll { $0.id == game.id }
        playedGames.insert(recent, at: 0)
    }

    static func deduplicated(_ games: [GameCatalogItem]) -> [GameCatalogItem] {
        var seen = Set<String>()
        return games.filter { seen.insert($0.id).inserted }
    }
}

private struct GameListCard: View {
    let game: GameCatalogItem
    let isLaunching: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 12) {
                GamePosterImage(url: game.displayIconURL)
                    .frame(width: 50, height: 50)
                    .overlay {
                        if isLaunching {
                            ZStack {
                                Color.black.opacity(0.28)
                                ProgressView().tint(.white)
                            }
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))

                VStack(alignment: .leading, spacing: 7) {
                    Text(game.name)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)

                    Text(normalized(game.summary) ?? L10n.tr("gameCenter.description.empty"))
                        .font(.system(size: 14, weight: .regular))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 8) {
                        Text(normalized(game.gameType) ?? L10n.tr("gameCenter.type.other"))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(AppColors.accent)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .background(AppColors.accent.opacity(0.12))
                            .clipShape(Capsule())
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
            .background(AppColors.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(isLaunching)
        .accessibilityLabel(game.name)
        .accessibilityHint(L10n.tr("gameCenter.open.hint"))
    }

    private func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

private struct GamePosterImage: View {
    let url: String
    @State private var image: UIImage?
    @State private var finishedLoading = false

    private var isSVG: Bool {
        URL(string: url)?.pathExtension.lowercased() == "svg"
    }

    var body: some View {
        ZStack {
            AppColors.accentGradient

            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if !finishedLoading && !url.isBlank {
                ProgressView().tint(.white)
            } else {
                posterPlaceholder
            }
        }
        .clipped()
        .task(id: url) {
            let requestedURL = url
            image = nil
            finishedLoading = false
            guard !requestedURL.isBlank else {
                finishedLoading = true
                return
            }
            let loaded: UIImage?
            if isSVG, let svgURL = URL(string: requestedURL) {
                loaded = await GameSVGPosterRenderer.shared.image(for: svgURL)
            } else {
                loaded = await ImageCacheManager.shared.loadImage(from: requestedURL)
            }
            guard !Task.isCancelled, requestedURL == url else { return }
            image = loaded
            finishedLoading = true
        }
    }

    private var posterPlaceholder: some View {
        Image(systemName: "gamecontroller.fill")
            .font(.system(size: 19, weight: .medium))
            .foregroundColor(.white.opacity(0.8))
    }
}

/// Rasterizes all SVG game posters through one off-screen WKWebView instead of
/// allocating a separate WebContent-backed view for every visible list cell.
@MainActor
private final class GameSVGPosterRenderer: NSObject, WKNavigationDelegate {
    static let shared = GameSVGPosterRenderer()

    private final class PendingRequest {
        let url: URL
        var continuations: [CheckedContinuation<UIImage?, Never>]

        init(url: URL, continuations: [CheckedContinuation<UIImage?, Never>]) {
            self.url = url
            self.continuations = continuations
        }
    }

    private let imageCache = NSCache<NSURL, UIImage>()
    private let webView: WKWebView
    private var queuedURLs: [URL] = []
    private var waiters: [URL: [CheckedContinuation<UIImage?, Never>]] = [:]
    private var activeRequest: PendingRequest?

    private override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false

        webView = WKWebView(
            frame: CGRect(origin: .zero, size: CGSize(width: 160, height: 160)),
            configuration: configuration
        )
        super.init()
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.isUserInteractionEnabled = false
        webView.navigationDelegate = self
        imageCache.countLimit = 100
    }

    func image(for url: URL) async -> UIImage? {
        if let cached = imageCache.object(forKey: url as NSURL) {
            return cached
        }

        return await withCheckedContinuation { continuation in
            if activeRequest?.url == url {
                activeRequest?.continuations.append(continuation)
                return
            }
            if waiters[url] != nil {
                waiters[url, default: []].append(continuation)
                return
            }
            waiters[url] = [continuation]
            queuedURLs.append(url)
            processNextIfNeeded()
        }
    }

    private func processNextIfNeeded() {
        guard activeRequest == nil, !queuedURLs.isEmpty else { return }
        let url = queuedURLs.removeFirst()
        let continuations = waiters.removeValue(forKey: url) ?? []
        activeRequest = PendingRequest(url: url, continuations: continuations)

        Task { [weak self] in
            guard let self else { return }

            var request = URLRequest(url: url)
            AuthRequestAuthorizer.addAuthHeader(&request, token: AuthManager.shared.token)
            AuthRequestAuthorizer.logFinalRequest(request, expectsAuthorization: true)

            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                try Task.checkCancellation()
                guard let httpResponse = response as? HTTPURLResponse,
                      (200...299).contains(httpResponse.statusCode),
                      let finalURL = httpResponse.url,
                      GameWebSecurity.allowsInitialGameURL(
                          finalURL,
                          policy: AppRemoteConfigStore.shared.config.webViewPolicy.gameLaunchPolicy
                      ),
                      !data.isEmpty,
                      data.count <= GameSVGPosterHTML.maximumByteCount else {
                    finishActiveRequest(with: nil)
                    return
                }
                webView.loadHTMLString(GameSVGPosterHTML.document(for: data), baseURL: nil)
            } catch {
                finishActiveRequest(with: nil)
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let snapshot = WKSnapshotConfiguration()
        snapshot.rect = webView.bounds
        snapshot.afterScreenUpdates = true
        webView.takeSnapshot(with: snapshot) { [weak self] image, _ in
            Task { @MainActor [weak self] in
                self?.finishActiveRequest(with: image.flatMap(Self.croppingTransparentPadding))
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finishActiveRequest(with: nil)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finishActiveRequest(with: nil)
    }

    private func finishActiveRequest(with image: UIImage?) {
        guard let activeRequest else { return }
        self.activeRequest = nil

        if let image {
            imageCache.setObject(image, forKey: activeRequest.url as NSURL)
        }
        activeRequest.continuations.forEach { $0.resume(returning: image) }
        processNextIfNeeded()
    }

    /// SVG favicon files often include transparent canvas padding. `scaledToFill`
    /// cannot remove that internal padding, so the icon appears too small inside
    /// the avatar frame. Crop only transparent pixels and keep a small
    /// anti-aliasing margin before SwiftUI applies its final rounded-rectangle clip.
    private static func croppingTransparentPadding(_ image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        let width = cgImage.width
        let height = cgImage.height
        guard width > 0, height > 0 else { return image }

        let bytesPerRow = width * 4
        var pixels = [UInt8](repeating: 0, count: bytesPerRow * height)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue
            | CGImageAlphaInfo.premultipliedLast.rawValue

        let visibleBounds: CGRect? = pixels.withUnsafeMutableBytes { buffer in
            let bytes = buffer.bindMemory(to: UInt8.self)
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: colorSpace,
                bitmapInfo: bitmapInfo
            ) else {
                return nil
            }
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

            var minX = width
            var minY = height
            var maxX = -1
            var maxY = -1
            let alphaThreshold: UInt8 = 8

            for y in 0..<height {
                let rowOffset = y * bytesPerRow
                for x in 0..<width where bytes[rowOffset + x * 4 + 3] > alphaThreshold {
                    minX = min(minX, x)
                    minY = min(minY, y)
                    maxX = max(maxX, x)
                    maxY = max(maxY, y)
                }
            }

            guard maxX >= minX, maxY >= minY else { return nil }
            let margin = max(2, min(width, height) / 50)
            let cropMinX = max(0, minX - margin)
            let cropMinY = max(0, minY - margin)
            let cropMaxX = min(width - 1, maxX + margin)
            let cropMaxY = min(height - 1, maxY + margin)
            return CGRect(
                x: cropMinX,
                y: cropMinY,
                width: cropMaxX - cropMinX + 1,
                height: cropMaxY - cropMinY + 1
            )
        }

        guard let visibleBounds,
              visibleBounds.width < CGFloat(width) || visibleBounds.height < CGFloat(height),
              let cropped = cgImage.cropping(to: visibleBounds) else {
            return image
        }
        return UIImage(cgImage: cropped, scale: image.scale, orientation: image.imageOrientation)
    }
}

enum GameSVGPosterHTML {
    static let maximumByteCount = 5 * 1_024 * 1_024

    static func document(for svgData: Data) -> String {
        let encodedSVG = svgData.base64EncodedString()
        return """
        <!doctype html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
          <style>
            html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: transparent; }
            img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; object-position: center; }
          </style>
        </head>
        <body><img alt="" src="data:image/svg+xml;base64,\(encodedSVG)"></body>
        </html>
        """
    }
}

private struct GameCenterMessageState: View {
    let systemImage: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 38, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)

            Text(message)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(AppColors.secondaryText)
                .multilineTextAlignment(.center)

            if let actionTitle, let action {
                Button(action: action) {
                    Text(actionTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .background(AppColors.accentGradient)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
