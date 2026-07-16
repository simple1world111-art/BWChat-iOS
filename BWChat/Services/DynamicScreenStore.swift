import Foundation

@MainActor
final class DynamicScreenStore: ObservableObject {
    @Published private(set) var screen: DynamicScreen?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var lastETag: String?

    let screenID: String
    private let defaults: UserDefaults
    private var loadTask: Task<Void, Never>?

    init(screenID: String, defaults: UserDefaults = .standard) {
        self.screenID = screenID
        self.defaults = defaults
        self.screen = Self.embeddedScreen(screenID: screenID)
            ?? Self.cachedScreen(defaults: defaults, screenID: screenID, scopeID: Self.currentScopeID)
        self.lastETag = defaults.string(forKey: Self.etagKey(screenID: screenID, scopeID: Self.currentScopeID))
    }

    func load(force: Bool = false) async {
        if screen == nil {
            screen = Self.embeddedScreen(screenID: screenID)
                ?? Self.cachedScreen(defaults: defaults, screenID: screenID, scopeID: Self.currentScopeID)
        }

        if let loadTask {
            await loadTask.value
            return
        }
        let task = Task { [weak self] in
            guard let self else { return }
            await self.performLoad()
        }
        loadTask = task
        await task.value
        loadTask = nil
    }

    private func performLoad() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let result = try await APIService.shared.fetchDynamicScreen(screenID: screenID, ifNoneMatch: lastETag)
            if result.notModified {
                errorMessage = nil
                if let etag = result.etag {
                    lastETag = etag
                    defaults.set(etag, forKey: Self.etagKey(screenID: screenID, scopeID: Self.currentScopeID))
                }
                return
            }

            guard let remoteScreen = result.screen, Self.isSupported(remoteScreen) else { return }
            screen = remoteScreen
            persist(remoteScreen)
            if let etag = result.etag {
                lastETag = etag
                defaults.set(etag, forKey: Self.etagKey(screenID: screenID, scopeID: Self.currentScopeID))
            }
            errorMessage = nil
        } catch {
            if screen == nil {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func persist(_ screen: DynamicScreen) {
        guard let data = try? JSONEncoder().encode(screen) else { return }
        defaults.set(data, forKey: Self.cacheKey(screenID: screenID, scopeID: Self.currentScopeID))
    }

    private static func embeddedScreen(screenID: String) -> DynamicScreen? {
        let normalized = screenID.normalizedDynamicToken
        if let configured = AppRemoteConfigStore.shared.config.screens?.first(where: {
            $0.screenID.normalizedDynamicToken == normalized
        }) {
            return configured
        }
        return DynamicScreen.bundledFixtures.first {
            $0.screenID.normalizedDynamicToken == normalized
        }
    }

    private static func cachedScreen(defaults: UserDefaults, screenID: String, scopeID: String) -> DynamicScreen? {
        guard let data = defaults.data(forKey: cacheKey(screenID: screenID, scopeID: scopeID)) else { return nil }
        return try? JSONDecoder().decode(DynamicScreen.self, from: data)
    }

    private static func isSupported(_ screen: DynamicScreen) -> Bool {
        (screen.schemaVersion ?? 1) <= 1
    }

    private static var currentScopeID: String {
        let userID = AuthManager.shared.currentUser?.userID
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return userID?.isEmpty == false ? "user.\(userID!)" : "guest"
    }

    private static func cacheKey(screenID: String, scopeID: String) -> String {
        "bbchat.app.dynamicScreen.v1.\(scopeID).\(screenID.normalizedDynamicToken)"
    }

    private static func etagKey(screenID: String, scopeID: String) -> String {
        "bbchat.app.dynamicScreen.etag.v1.\(scopeID).\(screenID.normalizedDynamicToken)"
    }
}
