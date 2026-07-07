import SwiftUI
import UIKit
import WebKit

struct DiscoverView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var languageStore = AppLanguageStore.shared
    @ObservedObject private var authManager = AuthManager.shared
    @StateObject private var momentsNotif = MomentsNotificationManager.shared
    @StateObject private var discoverConfig = DiscoverConfigStore()
    @StateObject private var shortDramaFeed = ShortDramaFeedViewModel()
    @State private var comingSoonItem: DiscoverComingSoonItem?

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                RootTabTitle(localizedKey: "tab.discover")
                    .padding(.bottom, 2)

                ForEach(discoverConfig.sections) { section in
                    discoverCard {
                        ForEach(section.items) { item in
                            discoverRow(for: item, isLast: item.id == section.items.last?.id)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, AppSpacing.rootTabTopInset)
            .padding(.bottom, 20)
        }
        .id(languageStore.activeLanguage.rawValue)
        .background(AppColors.secondaryBackground)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task(id: authManager.currentUser?.userID ?? "guest") {
            await discoverConfig.load(force: true)
            await momentsNotif.fetchFromServer()
            preloadShortDramaIfAvailable()
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            Task {
                await discoverConfig.load()
                await momentsNotif.fetchFromServer()
                preloadShortDramaIfAvailable()
            }
        }
        .alert(item: $comingSoonItem) { item in
            Alert(
                title: Text(item.title),
                message: Text(item.message ?? L10n.tr("discover.comingSoon")),
                dismissButton: .default(Text(L10n.tr("common.ok")))
            )
        }
    }

    private func discoverRow(for item: DiscoverItem, isLast: Bool) -> some View {
        VStack(spacing: 0) {
            discoverRow(
                title: item.displayTitle(language: languageStore.activeLanguage),
                systemImage: resolvedSystemImage(item.systemImage),
                colors: item.displayColors,
                badge: badgeValue(for: item),
                showsDot: showsDot(for: item)
            ) {
                handleTap(item)
            }

            if !isLast {
                discoverDivider
            }
        }
    }

    @ViewBuilder
    private func discoverCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .background(AppColors.cardBackground)
        .cornerRadius(14)
    }

    private func discoverRow(
        title: String,
        systemImage: String,
        colors: [Color],
        badge: Int? = nil,
        showsDot: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                ZStack(alignment: .topTrailing) {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(iconFill(for: colors))
                        .frame(width: 40, height: 40)
                        .overlay(
                            Image(systemName: systemImage)
                                .font(.system(size: 17))
                                .foregroundColor(.white)
                        )

                    if showsDot {
                        Circle()
                            .fill(Color.red)
                            .frame(width: 10, height: 10)
                            .offset(x: 3, y: -3)
                    }
                }

                Text(title)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)

                Spacer()

                if let badge, badge > 0 {
                    Text("\(badge)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Color.red)
                        .cornerRadius(10)
                }

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(AppColors.tertiaryText)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func iconFill(for colors: [Color]) -> AnyShapeStyle {
        guard let first = colors.first else {
            return AnyShapeStyle(AppColors.accentGradient)
        }
        guard colors.count > 1 else {
            return AnyShapeStyle(first)
        }
        return AnyShapeStyle(LinearGradient(
            colors: Array(colors.prefix(2)),
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        ))
    }

    private func resolvedSystemImage(_ rawName: String?) -> String {
        guard let rawName,
              !rawName.isDiscoverBlank,
              UIImage(systemName: rawName) != nil else {
            return "sparkles"
        }
        return rawName
    }

    private var discoverDivider: some View {
        Rectangle()
            .fill(AppColors.separator)
            .frame(height: 1)
            .padding(.leading, 70)
    }

    private func badgeValue(for item: DiscoverItem) -> Int? {
        switch item.badgeKey?.normalizedDiscoverToken {
        case "moments_unread", "moments":
            return momentsNotif.unreadCount
        default:
            return item.badgeCount
        }
    }

    private func showsDot(for item: DiscoverItem) -> Bool {
        switch item.dotKey?.normalizedDiscoverToken {
        case "moments_new", "moments":
            return momentsNotif.hasNewMoments
        default:
            return item.showsDot ?? false
        }
    }

    private func handleTap(_ item: DiscoverItem) {
        let route = item.route ?? DiscoverRoute(type: "native", name: item.id)
        switch route.normalizedType {
        case "native":
            handleNativeRoute(route.name ?? item.id, item: item)
        case "web", "h5", "url":
            openWebRoute(route, item: item)
        case "coming_soon", "comingsoon", "disabled":
            showComingSoon(item, route: route)
        default:
            if route.url != nil {
                openWebRoute(route, item: item)
            } else {
                showComingSoon(item, route: route)
            }
        }
    }

    private func handleNativeRoute(_ rawName: String, item: DiscoverItem) {
        switch rawName.normalizedDiscoverToken {
        case "moments":
            momentsNotif.markFeedViewed()
            navigator.push(MomentsView())
        case "groups", "group", "group_list":
            navigator.push(GroupListView().withUIKitBackButton())
        case "nearby", "map", "map_dating":
            navigator.push(MapDatingView())
        case "short_drama", "shortdrama", "drama":
            shortDramaFeed.startInitialPreload()
            navigator.push(ShortDramaFeedView(viewModel: shortDramaFeed))
        default:
            showComingSoon(item, route: item.route)
        }
    }

    private func preloadShortDramaIfAvailable() {
        guard discoverConfig.sections.contains(where: { section in
            section.items.contains { item in
                item.id.normalizedDiscoverToken == "short_drama"
                    || item.route?.name?.normalizedDiscoverToken == "short_drama"
            }
        }) else { return }
        shortDramaFeed.startInitialPreload()
    }

    private func openWebRoute(_ route: DiscoverRoute, item: DiscoverItem) {
        guard let urlString = route.url,
              let url = URL(string: urlString),
              ["http", "https"].contains(url.scheme?.lowercased() ?? "")
        else {
            showComingSoon(item, route: route)
            return
        }

        let title = route.displayTitle(
            language: languageStore.activeLanguage,
            fallback: item.displayTitle(language: languageStore.activeLanguage)
        )
        navigator.push(InAppWebView(url: url, title: title))
    }

    private func showComingSoon(_ item: DiscoverItem, route: DiscoverRoute?) {
        comingSoonItem = DiscoverComingSoonItem(
            title: item.displayTitle(language: languageStore.activeLanguage),
            message: route?.displayMessage(language: languageStore.activeLanguage)
        )
    }
}

private struct DiscoverComingSoonItem: Identifiable {
    let id = UUID()
    let title: String
    let message: String?
}

@MainActor
private final class DiscoverConfigStore: ObservableObject {
    @Published private(set) var sections: [DiscoverSection] = DiscoverConfigData.defaultSections

    private static let cacheKey = "bbchat.discover.remoteConfig.v1"
    private let minimumRefreshInterval: TimeInterval = 5 * 60
    private var lastRefreshAttemptDate: Date?

    init() {
        if let cached = Self.cachedConfig() {
            let cachedSections = cached.effectiveSections
            if !cachedSections.isEmpty {
                sections = cachedSections
            }
        }
    }

    func load(force: Bool = false) async {
        if !force, let lastRefreshAttemptDate, Date().timeIntervalSince(lastRefreshAttemptDate) < minimumRefreshInterval {
            return
        }
        lastRefreshAttemptDate = Date()

        do {
            let config = try await APIService.shared.fetchDiscoverConfig()
            let nextSections = config.effectiveSections
            guard !nextSections.isEmpty else { return }
            sections = nextSections
            Self.save(config)
        } catch {
            // Keep bundled defaults or the last valid cached config.
        }
    }

    private static func cachedConfig() -> DiscoverConfigData? {
        guard let data = UserDefaults.standard.data(forKey: cacheKey) else { return nil }
        return try? JSONDecoder().decode(DiscoverConfigData.self, from: data)
    }

    private static func save(_ config: DiscoverConfigData) {
        guard let data = try? JSONEncoder().encode(config) else { return }
        UserDefaults.standard.set(data, forKey: cacheKey)
    }
}

// MARK: - In-App WebView

struct InAppWebView: View {
    let url: URL
    let title: String
    @State private var isLoading = true

    var body: some View {
        ZStack {
            WebViewRepresentable(url: url, isLoading: $isLoading)
                .ignoresSafeArea(edges: .bottom)

            if isLoading {
                ProgressView()
                    .tint(AppColors.accent)
                    .scaleEffect(1.2)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .withUIKitBackButton()
    }
}

struct WebViewRepresentable: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKNavigationDelegate {
        var parent: WebViewRepresentable

        init(_ parent: WebViewRepresentable) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
        }
    }
}

@MainActor
class MomentsNotificationManager: ObservableObject {
    static let shared = MomentsNotificationManager()
    @Published var unreadCount: Int = 0
    @Published var hasNewMoments: Bool = false

    func fetchFromServer() async {
        do {
            let info = try await APIService.shared.getMomentsUnreadInfo()
            if unreadCount != info.unreadCount { unreadCount = info.unreadCount }
            if hasNewMoments != info.hasNewMoments { hasNewMoments = info.hasNewMoments }
        } catch { }
    }

    func incrementBadge() {
        unreadCount += 1
    }

    func markFeedViewed() {
        hasNewMoments = false
        Task {
            try? await APIService.shared.markMomentsFeedViewed()
        }
    }

    func clearInteractionBadge() {
        unreadCount = 0
        Task {
            try? await APIService.shared.markMomentsNotificationsRead()
        }
    }
}
