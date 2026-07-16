import SwiftUI
import UIKit
import WebKit

protocol GameCenterAPIClient: AnyObject {
    func getRecommendedGames(limit: Int, cursor: String?) async throws -> GameCatalogPage
    func getPlayedGames(limit: Int, cursor: String?) async throws -> GameCatalogPage
    func createGameSession(gameID: String) async throws -> GameSession
}

extension APIService: GameCenterAPIClient {}

@MainActor
struct GameCenterView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var store: GameCenterStore
    @State private var selectedTab: GameCenterTab = .recommended
    @State private var alertMessage: String?
    @State private var refreshPlayedAfterReturn = false

    init(api: GameCenterAPIClient? = nil) {
        let resolvedAPI = api ?? APIService.shared
        _store = StateObject(wrappedValue: GameCenterStore(api: resolvedAPI))
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
            switch selectedTab {
            case .recommended:
                await store.loadRecommended(reset: true)
            case .played:
                await store.loadPlayed(force: true)
            }
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
        guard store.beginLaunching(gameID: game.id) else { return }

        Task {
            defer { store.finishLaunching(gameID: game.id) }
            do {
                let session = try await store.createSession(for: game.id)
                try Task.checkCancellation()
                guard let url = URL(string: session.launchURL),
                      GameWebSecurity.allowsInitialGameURL(url) else {
                    alertMessage = L10n.tr("gameCenter.invalidURL")
                    return
                }

                store.recordPlayed(game)
                refreshPlayedAfterReturn = true
                navigator.push(InAppWebView(
                    url: url,
                    title: game.name,
                    restrictToInitialOrigin: true
                ))
            } catch is CancellationError {
                return
            } catch {
                alertMessage = L10n.tr("gameCenter.sessionFailed")
            }
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

    private let api: GameCenterAPIClient
    private var recommendedNextCursor: String?
    private var requestedRecommendedCursors = Set<String>()
    private var hasLoadedRecommended = false
    private var hasLoadedPlayed = false

    init(api: GameCenterAPIClient) {
        self.api = api
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
            if let key = CacheKey.current(namespace: "games", key: "recommended") {
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
            if let key = CacheKey.current(namespace: "games", key: "recommended") {
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
            if let key = CacheKey.current(namespace: "games", key: "played") {
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

    func createSession(for gameID: String) async throws -> GameSession {
        try await api.createGameSession(gameID: gameID)
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
            HStack(alignment: .center, spacing: 10) {
                GamePosterImage(url: game.displayIconURL, name: game.name)
                    .frame(width: 64, height: 64)
                    .overlay {
                        if isLaunching {
                            ZStack {
                                Color.black.opacity(0.28)
                                ProgressView().tint(.white)
                            }
                        }
                    }
                    .clipShape(Circle())

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

                    Text(normalized(game.gameType) ?? L10n.tr("gameCenter.type.other"))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(AppColors.accent)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .background(AppColors.accent.opacity(0.12))
                        .clipShape(Capsule())
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
    let name: String
    @State private var image: UIImage?
    @State private var finishedLoading = false
    @State private var svgFailed = false

    private var isSVG: Bool {
        URL(string: url)?.pathExtension.lowercased() == "svg"
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [AppColors.accent.opacity(0.16), Color.orange.opacity(0.18)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            if isSVG, let svgURL = URL(string: url), !svgFailed {
                GameSVGPosterView(url: svgURL, failed: $svgFailed)
            } else if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if !isSVG && !finishedLoading && !url.isBlank {
                ProgressView().tint(AppColors.accent)
            } else {
                posterPlaceholder
            }
        }
        .clipped()
        .task(id: url) {
            svgFailed = false
            image = nil
            finishedLoading = false
            guard !isSVG, !url.isBlank else {
                finishedLoading = true
                return
            }
            image = await ImageCacheManager.shared.loadImage(from: url)
            finishedLoading = true
        }
    }

    private var posterPlaceholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "gamecontroller.fill")
                .font(.system(size: 30, weight: .semibold))
            Text(name)
                .font(.system(size: 11, weight: .semibold))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 8)
        }
        .foregroundColor(AppColors.secondaryText)
    }
}

private struct GameSVGPosterView: UIViewRepresentable {
    let url: URL
    @Binding var failed: Bool

    func makeCoordinator() -> Coordinator { Coordinator(failed: $failed) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.isUserInteractionEnabled = false
        webView.navigationDelegate = context.coordinator
        context.coordinator.load(url: url, in: webView)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.load(url: url, in: uiView)
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        coordinator.cancel()
        uiView.stopLoading()
        uiView.navigationDelegate = nil
        uiView.loadHTMLString("", baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding private var failed: Bool
        private var currentURL: URL?
        private var loadTask: Task<Void, Never>?

        init(failed: Binding<Bool>) {
            _failed = failed
        }

        func load(url: URL, in webView: WKWebView) {
            guard currentURL != url else { return }
            currentURL = url
            loadTask?.cancel()
            failed = false

            loadTask = Task { @MainActor [weak self, weak webView] in
                guard let self, let webView,
                      GameWebSecurity.allowsInitialGameURL(url) else {
                    self?.failed = true
                    return
                }

                var request = URLRequest(url: url)
                AuthRequestAuthorizer.addAuthHeader(&request, token: AuthManager.shared.token)
                AuthRequestAuthorizer.logFinalRequest(request, expectsAuthorization: true)

                do {
                    let (data, response) = try await URLSession.shared.data(for: request)
                    try Task.checkCancellation()
                    guard let httpResponse = response as? HTTPURLResponse,
                          (200...299).contains(httpResponse.statusCode),
                          let finalURL = httpResponse.url,
                          GameWebSecurity.allowsInitialGameURL(finalURL),
                          !data.isEmpty,
                          data.count <= GameSVGPosterHTML.maximumByteCount else {
                        failed = true
                        return
                    }
                    webView.loadHTMLString(GameSVGPosterHTML.document(for: data), baseURL: nil)
                } catch is CancellationError {
                    return
                } catch {
                    failed = true
                }
            }
        }

        func cancel() {
            loadTask?.cancel()
            loadTask = nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failed = true
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            failed = true
        }
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
