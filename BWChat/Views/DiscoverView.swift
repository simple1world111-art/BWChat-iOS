import SwiftUI
import UIKit

struct DiscoverView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var languageStore = AppLanguageStore.shared
    @ObservedObject private var authManager = AuthManager.shared
    @StateObject private var momentsNotif = MomentsNotificationManager.shared
    @StateObject private var discoverConfig = DiscoverConfigStore()
    @State private var routeAlert: DynamicRouteAlert?
    @State private var deferredRefreshTask: Task<Void, Never>?
    @State private var hasRunInitialAppearRefresh = false
    @State private var remoteSections: [DiscoverSection]?

    private var displayedSections: [DiscoverSection] {
        if let sections = remoteSections, !sections.isEmpty {
            return sections
        }
        return discoverConfig.sections
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                discoverHeader

                ForEach(displayedSections) { section in
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
        .onAppear {
            updateRemoteSectionsFromAppConfig()
            scheduleDeferredRefresh(forceDiscoverConfig: !hasRunInitialAppearRefresh)
            hasRunInitialAppearRefresh = true
        }
        .onDisappear {
            cancelDeferredWork()
        }
        .onChange(of: authManager.currentUser?.userID ?? "guest") { _ in
            scheduleDeferredRefresh(forceDiscoverConfig: true)
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                scheduleDeferredRefresh(forceDiscoverConfig: false)
            } else {
                cancelDeferredWork()
            }
        }
        .alert(item: $routeAlert) { item in
            Alert(
                title: Text(item.title),
                message: Text(item.message),
                dismissButton: .default(Text(L10n.tr("common.ok")))
            )
        }
    }

    private var discoverHeader: some View {
        HStack(alignment: .center, spacing: 12) {
            RootTabTitle(localizedKey: "tab.discover")
        }
        .frame(maxWidth: .infinity, minHeight: 36, alignment: .center)
        .padding(.bottom, 2)
    }

    @MainActor
    private func updateRemoteSectionsFromAppConfig() {
        let store = AppRemoteConfigStore.shared
        guard store.source != .bundled,
              let sections = store.config.discover?.effectiveSections,
              !sections.isEmpty else {
            remoteSections = nil
            return
        }
        remoteSections = sections
    }

    private func scheduleDeferredRefresh(forceDiscoverConfig: Bool) {
        deferredRefreshTask?.cancel()

        deferredRefreshTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 280_000_000)
            guard !Task.isCancelled else { return }

            await discoverConfig.load(force: forceDiscoverConfig)
            await momentsNotif.fetchFromServer()
            updateRemoteSectionsFromAppConfig()
        }
    }

    private func cancelDeferredWork() {
        deferredRefreshTask?.cancel()
        deferredRefreshTask = nil
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
        if isMomentsEntry(item) {
            return momentsNotif.unreadCount
        }
        switch item.badgeKey?.normalizedDiscoverToken {
        case "moments_unread", "moments":
            return momentsNotif.unreadCount
        default:
            return item.badgeCount
        }
    }

    private func showsDot(for item: DiscoverItem) -> Bool {
        if isMomentsEntry(item) {
            return momentsNotif.hasNewMoments
        }
        switch item.dotKey?.normalizedDiscoverToken {
        case "moments_new", "moments":
            return momentsNotif.hasNewMoments
        default:
            return item.showsDot ?? false
        }
    }

    private func isMomentsEntry(_ item: DiscoverItem) -> Bool {
        item.id.normalizedDiscoverToken == "moments"
            || item.route?.name?.normalizedDiscoverToken == "moments"
    }

    private func handleTap(_ item: DiscoverItem) {
        // Keep the stable Discover `games` item native even when an older
        // remote config still points it directly at playdot.games.
        let route: DiscoverRoute
        if item.id.normalizedDiscoverToken == "games" {
            route = DiscoverRoute(type: "native", name: "game_center")
        } else if item.id.normalizedDiscoverToken == "stories" {
            // `stories` is the existing Discover entry localized as “剧本”.
            // Keep its identity and placement while upgrading old remote configs
            // that may still mark it as coming soon.
            route = DiscoverRoute(type: "native", name: "script_center")
        } else {
            route = item.route ?? DiscoverRoute(type: "native", name: item.id)
        }
        let fallbackTitle = item.displayTitle(language: languageStore.activeLanguage)
        switch DynamicRouteHandler.open(
            DynamicRoute(discoverRoute: route),
            navigator: navigator,
            fallbackTitle: fallbackTitle
        ) {
        case .handled:
            break
        case .alert(let alert):
            routeAlert = alert
        }
    }

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
            UnreadBadgeStore.shared.setMomentsUnreadCount(info.unreadCount)
        } catch { }
    }

    func incrementBadge() {
        unreadCount += 1
        UnreadBadgeStore.shared.incrementMomentsUnread()
    }

    func markFeedViewed() {
        hasNewMoments = false
        Task {
            try? await APIService.shared.markMomentsFeedViewed()
        }
    }

    func clearInteractionBadge() {
        unreadCount = 0
        UnreadBadgeStore.shared.setMomentsUnreadCount(0)
        Task {
            try? await APIService.shared.markMomentsNotificationsRead()
        }
    }
}
