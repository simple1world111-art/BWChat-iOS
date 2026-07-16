import XCTest
@testable import BBchat

@MainActor
final class GameCenterTests: XCTestCase {
    func testCacheKeysAlwaysIncludeAccountScope() {
        let key = CacheKey(accountScope: "account:user-a", namespace: "wallet", key: "balance")
        XCTAssertEqual(key.identifier, "account:user-a|wallet|balance")
        XCTAssertNotEqual(
            key.identifier,
            CacheKey(accountScope: "account:user-b", namespace: "wallet", key: "balance").identifier
        )
    }

    func testCachePolicyTTLsMatchProductRules() {
        XCTAssertEqual(CachePolicy.walletBalance.ttl, 30)
        XCTAssertEqual(CachePolicy.shortLived.ttl, 60)
        XCTAssertEqual(CachePolicy.list.ttl, 120)
        XCTAssertEqual(CachePolicy.mediaFeed.ttl, 300)
        XCTAssertEqual(CachePolicy.profile.ttl, 600)
        XCTAssertEqual(CachePolicy.catalog.ttl, 3600)
    }

    func testShortDramaSnapshotRoundTripKeepsPlaybackAndUnlockState() throws {
        let creator = ShortDramaCreator(userID: "creator", username: "cat", nickname: "Cat", avatarURL: "avatar")
        let source = ShortDramaFeedPage(
            videos: [ShortDramaVideo(
                id: "episode-1",
                dramaID: "series-1",
                creator: creator,
                dramaTitle: "Series",
                title: "Episode",
                playURL: "https://cdn.example/episode.mp4",
                playbackPositionSeconds: 12,
                unlockPriceCatFood: 20,
                isUnlocked: true
            )],
            hasMore: true,
            nextCursor: "next"
        )

        let decoded = try JSONDecoder().decode(ShortDramaFeedPage.self, from: JSONEncoder().encode(source))

        XCTAssertEqual(decoded, source)
        XCTAssertEqual(decoded.videos.first?.playbackPositionSeconds, 12)
        XCTAssertTrue(decoded.videos.first?.isUnlocked == true)
    }

    func testWalletSnapshotRoundTripKeepsAccountSeparatedFields() throws {
        let json = #"{"balance":100,"total_balance":130,"recharge_claim_balance":80,"cat_hair_balance":50,"cat_hair_frozen_balance":10,"withdrawable_cat_hair_balance":40,"locked_cat_hair_balance":10}"#.data(using: .utf8)!
        let source = try JSONDecoder().decode(WalletBalanceResponseData.self, from: json)
        let decoded = try JSONDecoder().decode(WalletBalanceResponseData.self, from: JSONEncoder().encode(source))

        XCTAssertEqual(decoded, source)
        XCTAssertEqual(decoded.withdrawableCatHairBalance, 40)
        XCTAssertTrue(decoded.hasExplicitWithdrawableCatHairBalance)
    }

    func testCatalogDecodesSnakeCaseAndNullLastPlayedAt() throws {
        let json = #"""
        {
          "items": [{
            "id": "dynamic_game",
            "name": "Dynamic Game",
            "poster_url": "http://52.193.78.191/api/v1/game-assets/example/poster.png",
            "icon_url": "http://52.193.78.191/api/v1/game-assets/example/icon.png",
            "description": "A dynamic game description",
            "game_type": "Puzzle",
            "order": 100,
            "last_played_at": null
          }],
          "next_cursor": "next value"
        }
        """#.data(using: .utf8)!

        let page = try JSONDecoder().decode(GameCatalogPage.self, from: json)

        XCTAssertEqual(page.items.first?.posterURL, "http://52.193.78.191/api/v1/game-assets/example/poster.png")
        XCTAssertEqual(page.items.first?.displayIconURL, "http://52.193.78.191/api/v1/game-assets/example/icon.png")
        XCTAssertEqual(page.items.first?.summary, "A dynamic game description")
        XCTAssertEqual(page.items.first?.gameType, "Puzzle")
        XCTAssertEqual(page.items.first?.sortOrder, 100)
        XCTAssertNil(page.items.first?.lastPlayedAt)
        XCTAssertEqual(page.nextCursor, "next value")
    }

    func testDeduplicationKeepsFirstServerOrderedItem() {
        let first = item(id: "same", name: "First")
        let duplicate = item(id: "same", name: "Second")
        let other = item(id: "other", name: "Other")

        let result = GameCenterStore.deduplicated([first, duplicate, other])

        XCTAssertEqual(result.map(\.id), ["same", "other"])
        XCTAssertEqual(result.first?.name, "First")
    }

    func testInitialLoadBuildsRecentAndRecommendedSections() async {
        let api = MockGameCenterAPI()
        api.recommendedPages[nil] = GameCatalogPage(items: [item(id: "recommended")], nextCursor: nil)
        api.playedPage = GameCatalogPage(items: [item(id: "played")], nextCursor: nil)
        let store = GameCenterStore(api: api)

        await store.loadInitial()

        XCTAssertEqual(store.recommendedGames.map(\.id), ["recommended"])
        XCTAssertEqual(store.playedGames.map(\.id), ["played"])
        XCTAssertFalse(store.recommendedLoadFailed)
    }

    func testGameCenterHasOnlyRecommendedAndPlayedTabs() {
        XCTAssertEqual(GameCenterTab.allCases, [.recommended, .played])
        XCTAssertFalse(GameCenterTab.allCases.map(\.rawValue).contains("leaderboard"))
    }

    func testPlayedErrorEntersRetryState() async {
        let api = MockGameCenterAPI()
        api.playedError = MockError.failed
        let store = GameCenterStore(api: api)

        await store.loadPlayed(force: false)

        XCTAssertTrue(store.playedGames.isEmpty)
        XCTAssertTrue(store.playedLoadFailed)
    }

    func testRecommendedErrorEntersRetryState() async {
        let api = MockGameCenterAPI()
        api.recommendedError = MockError.failed
        let store = GameCenterStore(api: api)

        await store.loadRecommended(reset: false)

        XCTAssertTrue(store.recommendedGames.isEmpty)
        XCTAssertTrue(store.recommendedLoadFailed)
    }

    func testPaginationForwardsCursorAndDeduplicatesItems() async {
        let api = MockGameCenterAPI()
        let first = item(id: "first")
        api.recommendedPages[nil] = GameCatalogPage(items: [first], nextCursor: "cursor with spaces")
        api.recommendedPages["cursor with spaces"] = GameCatalogPage(
            items: [first, item(id: "second")],
            nextCursor: nil
        )
        let store = GameCenterStore(api: api)

        await store.loadRecommended(reset: false)
        await store.loadMoreRecommendedIfNeeded(current: first)
        await store.loadMoreRecommendedIfNeeded(current: first)

        XCTAssertEqual(api.recommendedCursors, [nil, "cursor with spaces"])
        XCTAssertEqual(store.recommendedGames.map(\.id), ["first", "second"])
    }

    func testLaunchGateRejectsConcurrentSessionCreation() {
        let store = GameCenterStore(api: MockGameCenterAPI())

        XCTAssertTrue(store.beginLaunching(gameID: "one"))
        XCTAssertFalse(store.beginLaunching(gameID: "two"))
        store.finishLaunching(gameID: "one")
        XCTAssertTrue(store.beginLaunching(gameID: "two"))
    }

    func testGameURLValidationAllowsOnlyBackendGameAssets() {
        XCTAssertTrue(GameWebSecurity.allowsInitialGameURL(
            URL(string: "http://52.193.78.191/api/v1/game-assets/example/?ticket=secret")!
        ))
        XCTAssertFalse(GameWebSecurity.allowsInitialGameURL(
            URL(string: "http://52.193.78.191/api/v1/users")!
        ))
        XCTAssertFalse(GameWebSecurity.allowsInitialGameURL(
            URL(string: "https://example.com/api/v1/game-assets/example/")!
        ))
    }

    func testSameOriginRejectsSchemeHostAndPortChanges() {
        let initial = URL(string: "http://52.193.78.191/api/v1/game-assets/example/")!
        XCTAssertTrue(GameWebSecurity.isSameOrigin(
            URL(string: "http://52.193.78.191/api/v1/game-assets/example/app.js")!,
            as: initial
        ))
        XCTAssertFalse(GameWebSecurity.isSameOrigin(
            URL(string: "https://52.193.78.191/api/v1/game-assets/example/")!,
            as: initial
        ))
        XCTAssertFalse(GameWebSecurity.isSameOrigin(
            URL(string: "http://52.193.78.191:8080/api/v1/game-assets/example/")!,
            as: initial
        ))
    }

    func testSVGPosterHTMLCoversContainerWithoutBrowserMargins() {
        let html = GameSVGPosterHTML.document(for: Data("<svg></svg>".utf8))

        XCTAssertTrue(html.contains("object-fit: cover"))
        XCTAssertTrue(html.contains("margin: 0"))
        XCTAssertTrue(html.contains("data:image/svg+xml;base64,"))
    }

    private func item(id: String, name: String = "Game") -> GameCatalogItem {
        GameCatalogItem(
            id: id,
            name: name,
            posterURL: "http://52.193.78.191/api/v1/game-assets/example/poster.png",
            iconURL: nil,
            summary: "Description",
            gameType: "Casual",
            sortOrder: 100,
            lastPlayedAt: nil
        )
    }
}

private enum MockError: Error {
    case failed
}

private final class MockGameCenterAPI: GameCenterAPIClient {
    var recommendedPages: [String?: GameCatalogPage] = [:]
    var playedPage = GameCatalogPage(items: [], nextCursor: nil)
    var playedError: Error?
    var recommendedError: Error?
    var recommendedCursors: [String?] = []
    var sessionCount = 0

    func getRecommendedGames(limit: Int, cursor: String?) async throws -> GameCatalogPage {
        recommendedCursors.append(cursor)
        if let recommendedError { throw recommendedError }
        return recommendedPages[cursor] ?? GameCatalogPage(items: [], nextCursor: nil)
    }

    func getPlayedGames(limit: Int, cursor: String?) async throws -> GameCatalogPage {
        if let playedError { throw playedError }
        return playedPage
    }

    func createGameSession(gameID: String) async throws -> GameSession {
        sessionCount += 1
        return GameSession(
            sessionID: "session",
            launchURL: "http://52.193.78.191/api/v1/game-assets/example/?ticket=opaque",
            expiresAt: "2026-07-12T12:30:00.000Z"
        )
    }
}
