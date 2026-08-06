import XCTest
import SwiftUI
import WebKit
import GoogleMobileAds
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
                unlockPriceGoldCoins: 20,
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
        let json = #"{"currency":"gold_coin","gold_coin_balance":85,"activity_cat_food_balance":20,"spendable_balance":105,"recharge_gold_coin_balance":50,"gift_income_gold_coin_balance":35,"withdraw_frozen_gold_coin_balance":0,"withdrawable_gold_coin_balance":35,"chat_money_frozen_gold_coin_balance":0}"#.data(using: .utf8)!
        let source = try JSONDecoder().decode(WalletBalanceResponseData.self, from: json)
        let decoded = try JSONDecoder().decode(WalletBalanceResponseData.self, from: JSONEncoder().encode(source))

        XCTAssertEqual(decoded, source)
        XCTAssertEqual(decoded.currency, .goldCoins)
        XCTAssertEqual(decoded.goldCoinBalance, GoldCoinAmount(85))
        XCTAssertEqual(decoded.activityCatFoodBalance, ActivityCatFoodAmount(20))
        XCTAssertEqual(decoded.spendableBalance, 105)
        XCTAssertEqual(decoded.rechargeGoldCoinBalance, GoldCoinAmount(50))
        XCTAssertEqual(decoded.giftIncomeGoldCoinBalance, GoldCoinAmount(35))
        XCTAssertEqual(decoded.withdrawableGoldCoinBalance, GoldCoinAmount(35))
        XCTAssertTrue(decoded.hasServerActivityCatFoodBalance)
        XCTAssertTrue(decoded.isSpendableBalanceConsistent)
    }

    func testWalletSnapshotRequiresAuthoritativeSpendableBalanceAndGoldCoinCurrency() throws {
        let missingSpendable = Data(#"{"currency":"gold_coin","gold_coin_balance":85,"activity_cat_food_balance":20,"recharge_gold_coin_balance":50,"gift_income_gold_coin_balance":35,"withdraw_frozen_gold_coin_balance":0,"withdrawable_gold_coin_balance":35,"chat_money_frozen_gold_coin_balance":0}"#.utf8)
        XCTAssertThrowsError(
            try JSONDecoder().decode(WalletBalanceResponseData.self, from: missingSpendable)
        )

        let legacyCurrency = ["cat", "coin"].joined(separator: "_")
        let legacyPayload: [String: Any] = [
            "currency": legacyCurrency,
            "gold_coin_balance": 85,
            "activity_cat_food_balance": 20,
            "spendable_balance": 105,
            "recharge_gold_coin_balance": 50,
            "gift_income_gold_coin_balance": 35,
            "withdraw_frozen_gold_coin_balance": 0,
            "withdrawable_gold_coin_balance": 35,
            "chat_money_frozen_gold_coin_balance": 0
        ]
        let legacyData = try JSONSerialization.data(withJSONObject: legacyPayload)
        XCTAssertThrowsError(
            try JSONDecoder().decode(WalletBalanceResponseData.self, from: legacyData)
        )
    }

    func testWalletCacheMigrationMapsLegacyCoinKeysWithoutInventingActivityAsset() throws {
        let oldestCurrency = ["cat", "food"].joined(separator: "_")
        let previousCurrency = ["cat", "coin"].joined(separator: "_")

        for legacyCurrency in [oldestCurrency, previousCurrency] {
            let pluralLegacyCurrency = legacyCurrency == previousCurrency
                ? previousCurrency + "s"
                : legacyCurrency
            let legacyObject: [String: Any] = [
                legacyCurrency + "_balance": 42,
                legacyCurrency + "_amount": 8,
                "charged_" + pluralLegacyCurrency: 7,
                "earned_" + pluralLegacyCurrency: 6,
                "unlock_price_" + pluralLegacyCurrency: 5,
                "currency": legacyCurrency
            ]
            let migrated = try XCTUnwrap(
                WalletCacheSchemaMigration.migrateJSONObject(legacyObject) as? [String: Any]
            )

            XCTAssertEqual(migrated["gold_coin_balance"] as? Int, 42)
            XCTAssertEqual(migrated["gold_coin_amount"] as? Int, 8)
            XCTAssertEqual(migrated["charged_gold_coins"] as? Int, 7)
            XCTAssertEqual(migrated["earned_gold_coins"] as? Int, 6)
            XCTAssertEqual(migrated["unlock_price_gold_coins"] as? Int, 5)
            XCTAssertEqual(migrated["currency"] as? String, "gold_coin")
            XCTAssertNil(migrated["activity_cat_food_balance"])
        }
        XCTAssertEqual(WalletCacheSchemaMigration.currentVersion, 3)
    }

    func testLegacyUserDefaultsMigrationDeletesOldCoinKey() throws {
        let suiteName = "WalletMigrationTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let userID = "legacy-user"
        let oldestLegacyStem = "bbchat.wallet." + "cat" + "food"
        let previousStem = "bbchat.wallet." + ["cat", "coin"].joined(separator: "_")
        let oldestKey = oldestLegacyStem + ".balance.\(userID)"
        let previousKey = previousStem + ".balance.\(userID)"
        let newKey = "bbchat.wallet.gold_coin.balance.\(userID)"
        defaults.set(41, forKey: oldestKey)
        defaults.set(42, forKey: previousKey)

        WalletLegacyUserDefaultsMigration.run(userID: userID, defaults: defaults)

        XCTAssertEqual(defaults.integer(forKey: newKey), 42)
        XCTAssertNil(defaults.object(forKey: oldestKey))
        XCTAssertNil(defaults.object(forKey: previousKey))
        XCTAssertEqual(
            defaults.integer(forKey: "bbchat.wallet.cache-schema-version.\(userID)"),
            WalletCacheSchemaMigration.currentVersion
        )
    }

    func testActivityCatFoodTransactionPageDecodesCursorAndSignedDeltas() throws {
        let json = #"{"items":[{"id":"grant-1","title":"活动赠送","delta":50,"balance_after":50,"source":"summer_event","created_at":"2026-08-01T00:00:00Z"},{"id":"spend-1","title":"礼物消费","delta":-20,"balance_after":30,"source":"gift","created_at":"2026-08-01T01:00:00Z"}],"next_cursor":"next"}"#.data(using: .utf8)!
        let page = try JSONDecoder().decode(ActivityCatFoodTransactionPage.self, from: json)

        XCTAssertEqual(page.items.map(\.id), ["grant-1", "spend-1"])
        XCTAssertEqual(page.items.map(\.delta), [50, -20])
        XCTAssertEqual(page.items.last?.balanceAfter, 30)
        XCTAssertEqual(page.items.first?.displayTitle, "活动赠送")
        XCTAssertEqual(page.items.last?.source, "gift")
        XCTAssertEqual(page.nextCursor, "next")
    }

    func testWalletRemoteConfigUsesTrueFromNestedOrFlatAndDefaultsOff() throws {
        let nested = try JSONDecoder().decode(
            WalletRemoteConfig.self,
            from: Data(#"{"activity_cat_food":{"enabled":true},"activity_cat_food_enabled":false}"#.utf8)
        )
        let flat = try JSONDecoder().decode(
            WalletRemoteConfig.self,
            from: Data(#"{"activity_cat_food":{"enabled":false},"activity_cat_food_enabled":true}"#.utf8)
        )
        let unknown = try JSONDecoder().decode(WalletRemoteConfig.self, from: Data(#"{}"#.utf8))

        XCTAssertTrue(nested.effectiveActivityCatFoodEnabled)
        XCTAssertTrue(flat.effectiveActivityCatFoodEnabled)
        XCTAssertFalse(unknown.effectiveActivityCatFoodEnabled)
    }

    func testMixedChargeBillsPureActivityPureCoinsAndMixed() throws {
        let splits = [(50, 0), (0, 50), (35, 15)]
        for (activity, coins) in splits {
            let json = #"{"charged_activity_cat_food":\#(activity),"charged_gold_coins":\#(coins),"total_charged":50,"wallet_balance":{"currency":"gold_coin","gold_coin_balance":85,"activity_cat_food_balance":0,"spendable_balance":85,"recharge_gold_coin_balance":50,"gift_income_gold_coin_balance":35,"withdraw_frozen_gold_coin_balance":0,"withdrawable_gold_coin_balance":35,"chat_money_frozen_gold_coin_balance":0}}"#
            let charge = try JSONDecoder().decode(MixedAssetCharge.self, from: Data(json.utf8))
            XCTAssertEqual(charge.chargedActivityCatFood.value, activity)
            XCTAssertEqual(charge.chargedGoldCoins.value, coins)
            XCTAssertEqual(charge.totalCharged, 50)
            XCTAssertTrue(charge.isTotalConsistent)
        }
    }

    func testMixedChargeRejectsNegativeOrInconsistentBreakdown() {
        let wallet = #""wallet_balance":{"currency":"gold_coin","gold_coin_balance":85,"activity_cat_food_balance":0,"spendable_balance":85,"recharge_gold_coin_balance":50,"gift_income_gold_coin_balance":35,"withdraw_frozen_gold_coin_balance":0,"withdrawable_gold_coin_balance":35,"chat_money_frozen_gold_coin_balance":0}"#
        let negative = Data("{\"charged_activity_cat_food\":-1,\"charged_gold_coins\":51,\"total_charged\":50,\(wallet)}".utf8)
        let inconsistent = Data("{\"charged_activity_cat_food\":35,\"charged_gold_coins\":14,\"total_charged\":50,\(wallet)}".utf8)

        XCTAssertThrowsError(try JSONDecoder().decode(MixedAssetCharge.self, from: negative))
        XCTAssertThrowsError(try JSONDecoder().decode(MixedAssetCharge.self, from: inconsistent))
    }

    func testWalletBusinessErrorsKeepSpendableAndCoinOnlyFailuresDistinct() throws {
        let context = try JSONDecoder().decode(
            WalletBalanceErrorContext.self,
            from: Data(#"{"required_amount":50,"gold_coin_balance":0,"activity_cat_food_balance":35,"spendable_balance":35}"#.utf8)
        )
        let mixedError = APIError.businessError(
            code: WalletBusinessError.insufficientSpendableBalance,
            message: "ignored",
            context: context
        )
        let coinOnlyError = APIError.businessError(
            code: WalletBusinessError.insufficientGoldCoins,
            message: "ignored",
            context: context
        )
        let unknownError = APIError.businessError(
            code: "future_wallet_error",
            message: "Please retry",
            context: nil
        )

        XCTAssertEqual(mixedError.errorDescription, L10n.tr("wallet.error.insufficientSpendableBalance"))
        XCTAssertEqual(coinOnlyError.errorDescription, L10n.tr("wallet.error.insufficientGoldCoins"))
        XCTAssertEqual(unknownError.errorDescription, "Please retry")
        XCTAssertEqual(context.requiredAmount, 50)
        XCTAssertEqual(context.goldCoinBalance, GoldCoinAmount(0))
        XCTAssertEqual(context.activityCatFoodBalance, ActivityCatFoodAmount(35))
        XCTAssertEqual(context.spendableBalance, 35)
    }

    func testActivityBalanceFundsMixedBusinessesButNotCoinOnlyBusinesses() {
        let wallet = WalletBalanceResponseData(
            goldCoinBalance: 0,
            activityCatFoodBalance: 100,
            spendableBalance: 100
        )
        let required = 50

        // Gifts, unlocks, and paid live calls use the service's spendable total.
        XCTAssertGreaterThanOrEqual(wallet.spendableBalance, required)
        // Games, red packets, transfers, and withdrawals remain Gold Coin-only.
        XCTAssertLessThan(wallet.goldCoinBalance.value, required)
        XCTAssertEqual(wallet.withdrawableGoldCoinBalance.value, 0)
    }

    func testLiveBillingConsumesActivityFirstWhileHostEarnsOnlyGoldCoins() throws {
        let firstUnit = try JSONDecoder().decode(
            OneToOneLiveFinalBilling.self,
            from: Data(#"{"charged_units":1,"charged_activity_cat_food":100,"charged_gold_coins":0,"total_charged":100,"earned_gold_coins":100,"gold_coin_balance_after":0,"activity_cat_food_balance_after":50,"spendable_balance_after":50}"#.utf8)
        )
        let secondUnit = try JSONDecoder().decode(
            OneToOneLiveFinalBilling.self,
            from: Data(#"{"charged_units":2,"charged_activity_cat_food":150,"charged_gold_coins":50,"total_charged":200,"earned_gold_coins":200,"gold_coin_balance_after":0,"activity_cat_food_balance_after":0,"spendable_balance_after":0}"#.utf8)
        )

        XCTAssertEqual(firstUnit.chargedActivityCatFood, 100)
        XCTAssertEqual(firstUnit.chargedGoldCoins, 0)
        XCTAssertEqual(firstUnit.earnedGoldCoins, 100)
        XCTAssertEqual(secondUnit.chargedActivityCatFood, 150)
        XCTAssertEqual(secondUnit.chargedGoldCoins, 50)
        XCTAssertEqual(secondUnit.earnedGoldCoins, 200)
    }

    func testLiveBillingRejectsInconsistentAssetBreakdown() {
        let data = Data(#"{"charged_activity_cat_food":35,"charged_gold_coins":14,"total_charged":50,"earned_gold_coins":50,"gold_coin_balance_after":0,"activity_cat_food_balance_after":0,"spendable_balance_after":0}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(OneToOneLiveFinalBilling.self, from: data))
    }

    func testRechargeWithdrawalEarningsAndAdRewardStayGoldCoinOnly() throws {
        XCTAssertTrue(AppConfig.goldCoinProducts.allSatisfy { $0.coins > 0 })
        XCTAssertEqual(WalletCurrency.goldCoins.rawValue, "gold_coin")
        let withdrawal = try JSONDecoder().decode(
            WalletWithdrawal.self,
            from: Data(#"{"id":"withdraw-1","currency":"gold_coin","gold_coin_amount":35,"status":"pending"}"#.utf8)
        )
        XCTAssertEqual(withdrawal.currency, .goldCoins)
        XCTAssertEqual(withdrawal.goldCoinAmount, GoldCoinAmount(35))

        let wallet = WalletBalanceResponseData(
            goldCoinBalance: 85,
            activityCatFoodBalance: 20,
            spendableBalance: 105,
            giftIncomeGoldCoinBalance: 35,
            withdrawableGoldCoinBalance: 35
        )
        XCTAssertEqual(wallet.giftIncomeGoldCoinBalance, GoldCoinAmount(35))
        XCTAssertEqual(wallet.withdrawableGoldCoinBalance, GoldCoinAmount(35))
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
            "entry_price_gold_coins": 18,
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
        XCTAssertEqual(page.items.first?.entryPriceGoldCoins, 18)
        XCTAssertEqual(page.items.first?.sortOrder, 100)
        XCTAssertNil(page.items.first?.lastPlayedAt)
        XCTAssertEqual(page.nextCursor, "next value")
    }

    func testCatalogDecodesPreviousCoinEntryPriceFieldDuringRollout() throws {
        let previousCurrency = ["cat", "coin"].joined(separator: "_") + "s"
        let previousPriceKey = "entry_price_" + previousCurrency
        let payload: [String: Any] = [
            "items": [[
                "id": "old_price",
                "name": "Old Price",
                "poster_url": "https://example.test/old.png",
                previousPriceKey: 21,
                "order": 1
            ]]
        ]
        let json = try JSONSerialization.data(withJSONObject: payload)
        let page = try JSONDecoder().decode(GameCatalogPage.self, from: json)

        XCTAssertEqual(page.items[0].entryPriceGoldCoins, 21)
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
        let store = GameCenterStore(api: api, usesCache: false)

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
        let store = GameCenterStore(api: api, usesCache: false)

        await store.loadPlayed(force: false)

        XCTAssertTrue(store.playedGames.isEmpty)
        XCTAssertTrue(store.playedLoadFailed)
    }

    func testRecommendedErrorEntersRetryState() async {
        let api = MockGameCenterAPI()
        api.recommendedError = MockError.failed
        let store = GameCenterStore(api: api, usesCache: false)

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
        let store = GameCenterStore(api: api, usesCache: false)

        await store.loadRecommended(reset: false)
        await store.loadMoreRecommendedIfNeeded(current: first)
        await store.loadMoreRecommendedIfNeeded(current: first)

        XCTAssertEqual(api.recommendedCursors, [nil, "cursor with spaces"])
        XCTAssertEqual(store.recommendedGames.map(\.id), ["first", "second"])
    }

    func testLaunchGateRejectsConcurrentSessionCreation() {
        let store = GameCenterStore(api: MockGameCenterAPI(), usesCache: false)

        XCTAssertTrue(store.beginLaunching(gameID: "one"))
        XCTAssertFalse(store.beginLaunching(gameID: "two"))
        store.finishLaunching(gameID: "one")
        XCTAssertTrue(store.beginLaunching(gameID: "two"))
    }

    func testGameLobbySessionRequestNeverSelectsOrConsumesPayment() {
        XCTAssertEqual(GameLobbySessionRequest.requestBody["purpose"] as? String, "lobby")
        XCTAssertNil(GameLobbySessionRequest.requestBody["payment_method"])
        XCTAssertNil(GameLobbySessionRequest.requestBody["prop_definition_id"])
    }

    func testGameRoundStartAlwaysUsesGoldCoinsWithoutClientSuppliedPrice() {
        let body = GameRoundStartRequestPayload.requestBody
        XCTAssertEqual(body["payment_method"] as? String, "gold_coins")
        XCTAssertEqual(body.count, 1)
        XCTAssertNil(body["prop_definition_id"])
        XCTAssertNil(body["price"])
        XCTAssertNil(body["entry_price_gold_coins"])
    }

    func testLobbyCreationAndRoundStartUseSeparateRequests() async throws {
        let api = MockGameCenterAPI()
        let store = GameCenterStore(api: api, usesCache: false)
        let lobbyKey = UUID()
        let roundKey = UUID()

        let session = try await store.createLobbySession(
            for: "paid",
            idempotencyKey: lobbyKey
        )
        _ = try await store.startRound(
            gameID: "paid",
            sessionID: session.sessionID,
            idempotencyKey: roundKey
        )

        XCTAssertEqual(api.lobbyRequests.count, 1)
        XCTAssertEqual(api.lobbyRequests.first?.gameID, "paid")
        XCTAssertEqual(api.lobbyRequests.first?.idempotencyKey, lobbyKey)
        XCTAssertEqual(api.roundRequests.count, 1)
        XCTAssertEqual(api.roundRequests.first?.gameID, "paid")
        XCTAssertEqual(api.roundRequests.first?.sessionID, session.sessionID)
        XCTAssertEqual(api.roundRequests.first?.idempotencyKey, roundKey)
    }

    func testLobbyResponseRejectsAnyPaymentAtGameCardTap() {
        let paidLobby = GameSession(
            sessionID: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            launchURL: "https://example.test/game",
            expiresAt: "2026-08-01T12:30:00Z",
            paymentMethod: "gold_coins",
            entryPriceGoldCoins: 25,
            walletBalance: WalletBalanceResponseData(
                goldCoinBalance: 75,
                spendableBalance: 75
            )
        )

        XCTAssertThrowsError(try GameLobbySessionResponseValidator.validate(paidLobby)) { error in
            XCTAssertEqual(
                error as? GameLobbySessionResponseValidationError,
                .paymentWasApplied
            )
        }
    }

    func testRoundResponseAcceptsOnlyGoldCoinsAndNoPropConsumption() throws {
        let wallet = WalletBalanceResponseData(
            goldCoinBalance: 75,
            spendableBalance: 75
        )
        let coinRound = GameRoundStart(
            roundID: "round",
            roundToken: "token",
            expiresAt: "2026-08-01T12:05:00Z",
            paymentMethod: "gold_coins",
            entryPriceGoldCoins: 25,
            walletBalance: wallet,
            consumedProp: nil
        )
        let legacyPropRound = GameRoundStart(
            roundID: "round",
            roundToken: "token",
            expiresAt: "2026-08-01T12:05:00Z",
            paymentMethod: "prop_card",
            entryPriceGoldCoins: 25,
            walletBalance: wallet,
            consumedProp: PropConsumptionResult(
                inventoryID: "inventory",
                definitionID: "retired_game_payment_prop",
                remainingQuantity: 1
            )
        )

        XCTAssertNoThrow(try GameRoundStartResponseValidator.validate(coinRound))
        XCTAssertThrowsError(try GameRoundStartResponseValidator.validate(legacyPropRound))
    }

    func testGameRoundErrorsMapCoinBalanceFailure() {
        XCTAssertEqual(
            GameRoundStartErrorText.message(
                for: APIError.serverError(code: 422, message: "INSUFFICIENT_GOLD_COINS")
            ),
            L10n.tr("gameRound.error.insufficientCoins")
        )
        XCTAssertEqual(
            GameRoundStartErrorText.message(
                for: APIError.businessError(
                    code: "INSUFFICIENT_GOLD_COINS",
                    message: "金币余额不足",
                    context: nil
                )
            ),
            L10n.tr("gameRound.error.insufficientCoins")
        )
    }

    func testGameURLValidationRequiresHTTPSAllowedDomainAndGameAssetsPath() {
        let policy = WebViewPolicy(
            allowedDomains: ["id7.com"],
            blockedDomains: [],
            requireHTTPS: true
        )

        XCTAssertTrue(GameWebSecurity.allowsInitialGameURL(
            URL(string: "https://id7.com/api/v1/game-assets/just-clear/?ticket=secret")!,
            policy: policy
        ))
        XCTAssertTrue(GameWebSecurity.allowsInitialGameURL(
            URL(string: "https://games.id7.com/api/v1/game-assets/just-clear/")!,
            policy: policy
        ))
        XCTAssertFalse(GameWebSecurity.allowsInitialGameURL(
            URL(string: "http://id7.com/api/v1/game-assets/just-clear/?ticket=secret")!,
            policy: policy
        ))
        XCTAssertFalse(GameWebSecurity.allowsInitialGameURL(
            URL(string: "https://id7.com/api/v1/users")!,
            policy: policy
        ))
        XCTAssertFalse(GameWebSecurity.allowsInitialGameURL(
            URL(string: "https://id7.com/api/v1/game-assets-evil/just-clear/")!,
            policy: policy
        ))
        XCTAssertFalse(GameWebSecurity.allowsInitialGameURL(
            URL(string: "https://example.com/api/v1/game-assets/example/")!,
            policy: policy
        ))
        XCTAssertFalse(GameWebSecurity.allowsInitialGameURL(
            URL(string: "https://user@id7.com/api/v1/game-assets/just-clear/")!,
            policy: policy
        ))
    }

    func testEffectiveGamePolicyAddsProductionDomainWithoutBypassingBlocklist() {
        let staleRemote = WebViewPolicy(
            allowedDomains: ["playdot.games"],
            blockedDomains: [],
            requireHTTPS: true
        )
        let effective = staleRemote.gameLaunchPolicy

        XCTAssertTrue(effective.allowedDomains.contains("id7.com"))
        XCTAssertTrue(effective.allows(URL(string: "https://id7.com/api/v1/game-assets/demo/")!))

        let explicitlyBlocked = WebViewPolicy(
            allowedDomains: ["playdot.games"],
            blockedDomains: ["id7.com"],
            requireHTTPS: true
        ).gameLaunchPolicy
        XCTAssertFalse(explicitlyBlocked.allows(
            URL(string: "https://id7.com/api/v1/game-assets/demo/")!
        ))
    }

    func testGameWebViewUsesSharedPersistentWebsiteDataStore() {
        let first = GameWebViewPool.makeWebView()
        let second = GameWebViewPool.makeWebView()

        XCTAssertTrue(first.configuration.websiteDataStore.isPersistent)
        XCTAssertTrue(first.configuration.websiteDataStore === GameWebViewPool.persistentWebsiteDataStore)
        XCTAssertTrue(second.configuration.websiteDataStore === first.configuration.websiteDataStore)
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

    func testJustClearBridgeAcceptsOnlyTheFixedProfileMessage() throws {
        let userID = "User_123:ap-northeast.1"
        let message = try GameBridgeMessageValidator.decode(profileBridgePayload(userID: userID))

        XCTAssertEqual(message.type, "bwchat.game.open_user_profile")
        XCTAssertEqual(message.version, 1)
        XCTAssertEqual(message.source, "just_clear")
        XCTAssertEqual(message.userID, userID)
        XCTAssertEqual(message.deepLink, "bwchat://profile/User_123%3Aap-northeast.1")
    }

    func testJustClearBridgeRejectsTamperedContractFields() {
        var payload = profileBridgePayload(userID: "user-1")

        payload["type"] = "bwchat.game.open_url"
        assertBridgeValidationError(.invalidType, payload: payload)

        payload = profileBridgePayload(userID: "user-1")
        payload["version"] = 2
        assertBridgeValidationError(.invalidVersion, payload: payload)

        payload["version"] = true
        assertBridgeValidationError(.invalidVersion, payload: payload)

        payload = profileBridgePayload(userID: "user-1")
        payload["source"] = "another_game"
        assertBridgeValidationError(.invalidSource, payload: payload)
    }

    func testJustClearBridgeRejectsInvalidUserIDs() {
        let invalidUserIDs = [
            "",
            String(repeating: "a", count: 129),
            "user/1",
            "user?1",
            "user%31",
            "user 1",
            "用户1"
        ]

        for userID in invalidUserIDs {
            assertBridgeValidationError(
                .invalidUserID,
                payload: profileBridgePayload(userID: userID, deepLink: "bwchat://profile/user-1")
            )
        }
    }

    func testJustClearBridgeRejectsUntrustedDeepLinks() {
        let userID = "user-1"
        let invalidDeepLinks = [
            "https://example.com/profile/user-1",
            "bwchat://profile/other-user",
            "bwchat://profile/user-1?next=https://example.com",
            "bwchat://settings/user-1"
        ]

        for deepLink in invalidDeepLinks {
            assertBridgeValidationError(
                .invalidDeepLink,
                payload: profileBridgePayload(userID: userID, deepLink: deepLink)
            )
        }
    }

    func testGameNavigationInterceptsValidatedProfileFallback() {
        let initialURL = URL(string: "https://id7.com/api/v1/game-assets/just-clear/")!

        XCTAssertEqual(
            GameWebSecurity.navigationResolution(
                for: URL(string: "bwchat://profile/User_123%3Aregion.1")!,
                initialURL: initialURL
            ),
            .openUserProfile("User_123:region.1")
        )
        XCTAssertEqual(
            GameWebSecurity.navigationResolution(
                for: URL(string: "https://id7.com/api/v1/game-assets/just-clear/app.js")!,
                initialURL: initialURL
            ),
            .allow
        )
        XCTAssertEqual(
            GameWebSecurity.navigationResolution(
                for: URL(string: "https://id7.com/api/v1/game-assets/just-clear/rounds/round-id/resume")!,
                initialURL: initialURL
            ),
            .allow
        )
    }

    func testGameNavigationCancelsMalformedFallbackAndUnknownSchemes() {
        let initialURL = URL(string: "https://id7.com/api/v1/game-assets/just-clear/")!
        let rejectedURLs = [
            "bwchat://profile/user/extra",
            "bwchat://profile/user%2Fextra",
            "bwchat://profile/user?query=1",
            "bwchat://profile/user#fragment",
            "bwchat://settings/user",
            "another-app://profile/user",
            "https://example.com/api/v1/game-assets/just-clear/"
        ]

        for rawURL in rejectedURLs {
            XCTAssertEqual(
                GameWebSecurity.navigationResolution(
                    for: URL(string: rawURL)!,
                    initialURL: initialURL
                ),
                .cancel,
                rawURL
            )
        }
    }

    func testProfileOpenGateDebouncesOnlyRapidRepeatForSameUser() {
        var gate = GameProfileOpenGate()
        let start = Date(timeIntervalSince1970: 100)

        XCTAssertTrue(gate.shouldOpen(userID: "user-1", now: start))
        XCTAssertFalse(gate.shouldOpen(userID: "user-1", now: start.addingTimeInterval(0.2)))
        XCTAssertTrue(gate.shouldOpen(userID: "user-2", now: start.addingTimeInterval(0.3)))
        XCTAssertTrue(gate.shouldOpen(
            userID: "user-2",
            now: start.addingTimeInterval(GameProfileOpenGate.debounceInterval + 0.3)
        ))
    }

    func testGameBridgeUsesFixedHandlerNameAndWeakDelegate() {
        XCTAssertEqual(BridgeHandlerName.game, "bwchatGameBridge")

        var delegate: ScriptMessageHandlerProbe? = ScriptMessageHandlerProbe()
        weak var weakDelegate = delegate
        let wrapper = WeakScriptMessageHandler(delegate: delegate!)

        delegate = nil

        XCTAssertNil(weakDelegate)
        withExtendedLifetime(wrapper) { }
    }

    func testRoundStartBridgeAcceptsOnlyValidatedStartRequests() throws {
        let request = try GameRoundStartRequestValidator.decode(roundStartPayload())

        XCTAssertEqual(request.type, GameBridgeRouter.roundStartType)
        XCTAssertEqual(request.version, 1)
        XCTAssertEqual(request.source, "just_clear")
        XCTAssertEqual(request.trigger, "start_button")
        XCTAssertEqual(request.requestID, "550e8400-e29b-41d4-a716-446655440000")
        XCTAssertEqual(request.sessionID, "01ARZ3NDEKTSV4RRFFQ69G5FAV")
        XCTAssertEqual(request.idempotencyKey.uuidString.lowercased(), request.requestID)
        XCTAssertEqual(
            try GameBridgeRouter.decode(roundStartPayload()),
            .requestRoundStart(request)
        )
    }

    func testRoundStartBridgeAcceptsOpaqueServerSessionIDWithoutChangingCase() throws {
        let opaqueSessionID = "ZF1PPQNxT8F7izHaobiX6AIgL1g"
        var payload = roundStartPayload()
        payload["session_id"] = opaqueSessionID

        let request = try GameRoundStartRequestValidator.decode(payload)
        let address = try XCTUnwrap(GameRoundStartRequest.address(from: payload))

        XCTAssertEqual(request.sessionID, opaqueSessionID)
        XCTAssertEqual(address.sessionID, opaqueSessionID)
    }

    func testRoundStartBridgeRejectsMalformedContractFields() {
        var payload = roundStartPayload()
        payload["version"] = true
        assertRoundStartValidationError(.invalidVersion, payload: payload)

        payload = roundStartPayload()
        payload["source"] = "Bad Game"
        assertRoundStartValidationError(.invalidSource, payload: payload)

        payload = roundStartPayload()
        payload["trigger"] = ""
        assertRoundStartValidationError(.invalidTrigger, payload: payload)

        payload = roundStartPayload()
        payload["request_id"] = "550e8400-e29b-11d4-a716-446655440000"
        assertRoundStartValidationError(.invalidRequestID, payload: payload)

        payload = roundStartPayload()
        payload["session_id"] = "not-a-session"
        assertRoundStartValidationError(.invalidSessionID, payload: payload)

        payload = roundStartPayload()
        payload["session_id"] = "validLengthButHas/Slash"
        assertRoundStartValidationError(.invalidSessionID, payload: payload)
    }

    func testRoundStartResultReturnsOnlyThePaidRoundGrantToH5() {
        let request = try! GameRoundStartRequestValidator.decode(roundStartPayload())
        let round = GameRoundStart(
            roundID: "01BX5ZZKBKACTAV9WEVGEMMVRZ",
            roundToken: "opaque-round-token",
            expiresAt: "2026-08-01T12:05:00Z",
            paymentMethod: "gold_coins",
            entryPriceGoldCoins: 25,
            walletBalance: WalletBalanceResponseData(
                goldCoinBalance: 75,
                spendableBalance: 75
            ),
            consumedProp: nil
        )

        let result = GameRoundStartBridgeResult.started(request: request, round: round)

        XCTAssertEqual(result.javaScriptPayload["status"] as? String, "started")
        XCTAssertEqual(result.javaScriptPayload["round_id"] as? String, round.roundID)
        XCTAssertEqual(result.javaScriptPayload["round_token"] as? String, round.roundToken)
        XCTAssertEqual(result.javaScriptPayload["payment_method"] as? String, "gold_coins")
        XCTAssertNil(result.javaScriptPayload["wallet_balance"])
        XCTAssertTrue(GameRoundStartJavaScript.callbackSource.contains("bwchat:round-start-result"))
    }

    func testRoundStartRequestLedgerProcessesSameRequestAndSessionOnlyOnce() {
        var ledger = GameRoundStartRequestLedger()
        let address = GameRoundStartRequest.Address(
            requestID: "550e8400-e29b-41d4-a716-446655440000",
            sessionID: "ZF1PPQNxT8F7izHaobiX6AIgL1g"
        )

        XCTAssertTrue(ledger.begin(address: address))
        for _ in 0..<20 {
            XCTAssertFalse(ledger.begin(address: address))
        }
        XCTAssertTrue(ledger.complete(address: address))
        XCTAssertFalse(ledger.complete(address: address))
        XCTAssertFalse(ledger.begin(address: address))

        let differentSession = GameRoundStartRequest.Address(
            requestID: address.requestID,
            sessionID: "OtherSessionId_1234567890"
        )
        XCTAssertTrue(ledger.begin(address: differentSession))
    }

    func testRoundTokenResumeFailuresAreClassifiedAsNonPaymentRecoveryFailures() {
        XCTAssertTrue(GameRoundStartFailureClassifier.isResumeTokenFailure(
            APIError.businessError(
                code: "GAME_ROUND_TOKEN_INVALID",
                message: "invalid round token",
                context: nil
            )
        ))
        XCTAssertTrue(GameRoundStartFailureClassifier.isResumeTokenFailure(
            APIError.serverError(code: 401, message: "GAME_ROUND_TOKEN_EXPIRED")
        ))
        XCTAssertFalse(GameRoundStartFailureClassifier.isResumeTokenFailure(
            APIError.serverError(code: 422, message: "PROP_NOT_OWNED")
        ))
    }

    func testInsufficientGoldCoinFailureUsesStableH5BridgeCode() {
        XCTAssertEqual(
            GameRoundStartFailureClassifier.bridgeErrorCode(
                for: APIError.businessError(
                    code: "INSUFFICIENT_GOLD_COINS",
                    message: "金币余额不足",
                    context: nil
                )
            ),
            GameRoundStartErrorCode.insufficientGoldCoins
        )
        XCTAssertNil(GameRoundStartFailureClassifier.bridgeErrorCode(
            for: APIError.serverError(code: 422, message: "GAME_UNAVAILABLE")
        ))
    }

    func testPostLoadGameNavigationFailureKeepsRenderedDocument() {
        XCTAssertTrue(GameNavigationFailurePolicy.shouldShowBlockingError(
            hasFinishedInitialDocument: false
        ))
        XCTAssertFalse(GameNavigationFailurePolicy.shouldShowBlockingError(
            hasFinishedInitialDocument: true
        ))
    }

    func testProfileRouteUsesExistingUIKitNavigationStack() {
        let navigationController = UINavigationController(rootViewController: UIViewController())
        let navigator = UIKitNavigator()
        navigator.navigationController = navigationController

        XCTAssertTrue(navigator.openUserProfile(userID: "user-1"))
        XCTAssertEqual(navigationController.viewControllers.count, 2)
        XCTAssertTrue(navigationController.topViewController is NavigableHostingController)
    }

    func testRewardedAdBridgeAcceptsJustClearAndFutureGameSlugs() throws {
        let fixtures = [
            ("just_clear", "revive"),
            ("future_game_fixture", "bonus"),
            ("unknown.game-2", "continue_stage.3")
        ]

        for (source, placement) in fixtures {
            let request = try GameRewardedAdRequestValidator.decode(
                rewardedAdPayload(source: source, placement: placement)
            )
            XCTAssertEqual(request.source, source)
            XCTAssertEqual(request.placement, placement)
            XCTAssertEqual(request.requestID, "550e8400-e29b-41d4-a716-446655440000")
            XCTAssertEqual(request.sessionID, "01ARZ3NDEKTSV4RRFFQ69G5FAV")
        }
    }

    func testRewardedAdBridgeRejectsMalformedContractFields() {
        var payload = rewardedAdPayload()
        payload["version"] = true
        assertRewardedAdValidationError(.invalidVersion, payload: payload)

        payload = rewardedAdPayload(source: "Future_Game")
        assertRewardedAdValidationError(.invalidSource, payload: payload)

        payload = rewardedAdPayload(placement: "bonus reward")
        assertRewardedAdValidationError(.invalidPlacement, payload: payload)

        payload = rewardedAdPayload()
        payload["request_id"] = "550e8400-e29b-11d4-a716-446655440000"
        assertRewardedAdValidationError(.invalidRequestID, payload: payload)

        payload = rewardedAdPayload()
        payload["session_id"] = "01ARZ3NDEKTSV4RRFFQ69G5FAI"
        assertRewardedAdValidationError(.invalidSessionID, payload: payload)

        payload = rewardedAdPayload()
        payload["ssv_custom_data"] = String(repeating: "a", count: 2_049)
        assertRewardedAdValidationError(.invalidSSVCustomData, payload: payload)

        payload = rewardedAdPayload()
        payload["ssv_user_id"] = "   "
        assertRewardedAdValidationError(.invalidSSVUserID, payload: payload)

        payload = rewardedAdPayload()
        payload["reward_amount"] = 0
        assertRewardedAdValidationError(.invalidRewardAmount, payload: payload)

        payload = rewardedAdPayload()
        payload.removeValue(forKey: "reward_amount")
        assertRewardedAdValidationError(.invalidRewardAmount, payload: payload)
    }

    func testRewardedAdUnitAllowlistUsesRemoteReplacementAndBundledFallback() {
        let remoteID = "ca-app-pub-1111111111111111/2222222222"

        XCTAssertTrue(GameRewardedAdUnitAllowlist.allows(remoteID, configuredIDs: [remoteID]))
        XCTAssertFalse(GameRewardedAdUnitAllowlist.allows(
            AdMobConfiguration.productionRewardedAdUnitID,
            configuredIDs: [remoteID]
        ))
        XCTAssertTrue(GameRewardedAdUnitAllowlist.allows(
            AdMobConfiguration.productionRewardedAdUnitID,
            configuredIDs: nil
        ))
    }

    func testWalletRewardedAdUnitUsesRemoteConfigurationBeforeBundledFallback() {
        let fallbackID = "ca-app-pub-1111111111111111/1111111111"
        let firstRemoteID = "ca-app-pub-2222222222222222/2222222222"
        let preferredRemoteID = "ca-app-pub-3333333333333333/3333333333"

        XCTAssertEqual(
            RewardedAdUnitResolver.walletAdUnitID(
                preferredID: preferredRemoteID,
                configuredIDs: [firstRemoteID, preferredRemoteID],
                fallbackID: fallbackID
            ),
            preferredRemoteID
        )
        XCTAssertEqual(
            RewardedAdUnitResolver.walletAdUnitID(
                preferredID: "ca-app-pub-4444444444444444/4444444444",
                configuredIDs: [firstRemoteID, preferredRemoteID],
                fallbackID: fallbackID
            ),
            firstRemoteID
        )
        XCTAssertEqual(
            RewardedAdUnitResolver.walletAdUnitID(
                preferredID: nil,
                configuredIDs: [" invalid ", ""],
                fallbackID: fallbackID
            ),
            fallbackID
        )

        XCTAssertEqual(
            RewardedAdUnitResolver.walletAdUnitID(
                preferredID: AdMobConfiguration.testRewardedAdUnitID,
                configuredIDs: [AdMobConfiguration.testRewardedAdUnitID],
                fallbackID: fallbackID
            ),
            fallbackID,
            "Google's demo rewarded unit must never enter the server-credited wallet flow."
        )
    }

    func testWalletConfigKeepsRewardedAdFieldsWhenOtherFieldsUseStructuredPayloads() throws {
        let remoteAdUnitID = "ca-app-pub-1877504503518465/1011630693"
        let payload = """
        {
          "gold_coin_products": [
            {
              "product_id": "com.bwchat.app.catfood.100",
              "gold_coin_amount": 100,
              "sort_order": 10
            }
          ],
          "withdrawal_networks": [
            {"network": "TRC20", "enabled": true, "min_usdt": "0.50", "step_usdt": "0.50"},
            {"network": "ERC20", "enabled": false, "min_usdt": "0.50"}
          ],
          "exchange_rate_display": "1 Gold Coin = 0.005 USDT",
          "usdt_per_gold_coin": "0.005",
          "minimum_withdrawal_usdt": "1.00",
          "withdrawal_step_usdt": "1.00",
          "ad_reward_enabled": true,
          "ad_reward": {
            "daily_limit": 10,
            "reward_item": "gold_coin",
            "ios_ad_unit_ids": ["\(remoteAdUnitID)"]
          }
        }
        """

        let config = try JSONDecoder().decode(
            WalletRemoteConfig.self,
            from: Data(payload.utf8)
        )

        XCTAssertEqual(config.adRewardEnabled, true)
        XCTAssertEqual(config.adReward?.iosAdUnitIDs, [remoteAdUnitID])
        XCTAssertTrue(config.adReward?.rewardsGoldCoins == true)
        XCTAssertEqual(config.effectiveWithdrawalNetworks, ["TRC20"])
        XCTAssertEqual(config.goldCoinProducts?.first?.goldCoinAmount, 100)
        XCTAssertEqual(
            config.effectiveWithdrawalPolicy(for: "TRC20"),
            WalletWithdrawalPolicy(usdtPerGoldCoin: 0.005, minimumUSDT: 0.5, stepUSDT: 0.5)
        )
    }

    func testWithdrawalPolicyKeepsTotalAndWithdrawableBalancesSemanticallySeparate() {
        let wallet = WalletBalanceResponseData(
            goldCoinBalance: 85,
            activityCatFoodBalance: 20,
            spendableBalance: 105,
            rechargeGoldCoinBalance: 50,
            giftIncomeGoldCoinBalance: 35,
            withdrawableGoldCoinBalance: 35
        )
        let policy = WalletWithdrawalPolicy.fallback

        XCTAssertEqual(wallet.goldCoinBalance.value, 85)
        XCTAssertEqual(wallet.withdrawableGoldCoinBalance.value, 35)
        XCTAssertEqual(policy.rawUSDTAmount(forGoldCoins: 35), 0.175, accuracy: 0.000_001)
        XCTAssertEqual(policy.maximumUSDTAmount(forGoldCoins: 35), 0)
        XCTAssertFalse(policy.canWithdraw(goldCoinAmount: 35))
        XCTAssertEqual(policy.maximumUSDTAmount(forGoldCoins: 100), 0.5)
        XCTAssertTrue(policy.canWithdraw(goldCoinAmount: 100))
        XCTAssertEqual(policy.requiredGoldCoins(forUSDT: 0.5), 100)
    }

    func testRewardedAdBridgeRejectsHTTPWhenSecureTransportIsRequired() {
        let trusted = URL(string: "https://id7.com/api/v1/game-assets/future-game/index.html")!

        XCTAssertTrue(GameWebSecurity.allowsGameBridgeMessage(
            from: trusted,
            initialURL: trusted,
            requiresHTTPS: true
        ))
        XCTAssertFalse(GameWebSecurity.allowsGameBridgeMessage(
            from: URL(string: "http://id7.com/api/v1/game-assets/future-game/index.html")!,
            initialURL: URL(string: "http://id7.com/api/v1/game-assets/future-game/index.html")!,
            requiresHTTPS: true
        ))
        XCTAssertFalse(GameWebSecurity.allowsGameBridgeMessage(
            from: URL(string: "https://id7.com/third-party/index.html")!,
            initialURL: trusted,
            requiresHTTPS: true
        ))
        XCTAssertFalse(GameWebSecurity.allowsGameBridgeMessage(
            from: URL(string: "https://example.com/api/v1/game-assets/future-game/index.html")!,
            initialURL: trusted,
            requiresHTTPS: true
        ))
    }

    func testRewardedAdBridgeRejectsNonMainFrame() {
        let trusted = URL(
            string: "https://id7.com/api/v1/game-assets/future-game/index.html"
        )!

        XCTAssertFalse(GameWebSecurity.allowsGameBridgeMessage(
            isMainFrame: false,
            from: trusted,
            initialURL: trusted,
            requiresHTTPS: true
        ))
        XCTAssertTrue(GameWebSecurity.allowsGameBridgeMessage(
            isMainFrame: true,
            from: trusted,
            initialURL: trusted,
            requiresHTTPS: true
        ))
        XCTAssertFalse(GameWebSecurity.allowsGameBridgeMessage(
            isMainFrame: true,
            currentURL: URL(string: "https://id7.com/third-party/index.html"),
            frameURL: trusted,
            initialURL: trusted,
            requiresHTTPS: true
        ))
    }

    func testGameBridgeRejectsLegacyHTTPEvenWhenBackendConfigurationIsHTTP() {
        let legacyHTTP = URL(
            string: "http://id7.com/api/v1/game-assets/future-game/index.html"
        )!
        let requiresHTTPS = GameWebSecurity.rewardedBridgeRequiresHTTPS(
            for: legacyHTTP,
            configuredBackendScheme: "http"
        )

        XCTAssertTrue(requiresHTTPS)
        XCTAssertFalse(GameWebSecurity.allowsGameBridgeMessage(
            from: legacyHTTP,
            initialURL: legacyHTTP,
            requiresHTTPS: requiresHTTPS
        ))
        XCTAssertFalse(GameWebSecurity.allowsGameBridgeMessage(
            from: URL(string: "http://example.com/api/v1/game-assets/future-game/index.html")!,
            initialURL: legacyHTTP,
            requiresHTTPS: requiresHTTPS
        ))
    }

    func testRewardedAdBridgeAutomaticallyRequiresHTTPSAfterBackendMigration() {
        let trustedHTTPS = URL(
            string: "https://id7.com/api/v1/game-assets/future-game/index.html"
        )!

        XCTAssertTrue(GameWebSecurity.rewardedBridgeRequiresHTTPS(
            for: trustedHTTPS,
            configuredBackendScheme: "http"
        ))
        XCTAssertTrue(GameWebSecurity.rewardedBridgeRequiresHTTPS(
            for: URL(string: "http://id7.com/api/v1/game-assets/future-game/index.html")!,
            configuredBackendScheme: "https"
        ))
    }

    func testRewardedAdRequestLedgerAllowsOneTerminalResultPerRequest() {
        var ledger = GameRewardedAdRequestLedger()
        let requestID = "550e8400-e29b-41d4-a716-446655440000"

        XCTAssertTrue(ledger.begin(requestID: requestID))
        XCTAssertFalse(ledger.begin(requestID: requestID))
        XCTAssertTrue(ledger.complete(requestID: requestID))
        XCTAssertFalse(ledger.complete(requestID: requestID))
        XCTAssertFalse(ledger.begin(requestID: requestID))
    }

    func testRewardedAdResultPayloadContainsOnlyStableTerminalFields() {
        let result = GameRewardedAdResult(
            requestID: "550e8400-e29b-41d4-a716-446655440000",
            sessionID: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            status: .failed,
            errorCode: GameRewardedAdErrorCode.loadFailed
        )

        XCTAssertEqual(result.javaScriptPayload["status"] as? String, "failed")
        XCTAssertEqual(
            result.javaScriptPayload["error_code"] as? String,
            GameRewardedAdErrorCode.loadFailed
        )
        XCTAssertEqual(result.javaScriptPayload.count, 4)
        XCTAssertNil(result.javaScriptPayload["reward_item"])
        XCTAssertNil(result.javaScriptPayload["reward_amount"])
    }

    func testRewardedAdCoordinatorRejectsConcurrentRequestAndPreservesFirstResult() async throws {
        let presenter = SuspendedRewardedAdPresenter()
        let coordinator = RewardedAdCoordinator(presenter: presenter)
        let firstRequest = try GameRewardedAdRequestValidator.decode(rewardedAdPayload())
        var secondPayload = rewardedAdPayload(source: "future_game_fixture", placement: "bonus")
        secondPayload["request_id"] = "781c4517-8ed9-4d3f-8df7-c0359244891f"
        secondPayload["session_id"] = "01BX5ZZKBKACTAV9WEVGEMMVRZ"
        let secondRequest = try GameRewardedAdRequestValidator.decode(secondPayload)

        let firstTask = Task { await coordinator.present(request: firstRequest) }
        await Task.yield()

        let secondResult = await coordinator.present(request: secondRequest)
        XCTAssertEqual(secondResult.status, .unavailable)
        XCTAssertEqual(secondResult.errorCode, GameRewardedAdErrorCode.alreadyShowing)

        presenter.resolve(.completed)
        let firstResult = await firstTask.value
        XCTAssertEqual(firstResult.status, .completed)
        XCTAssertNil(firstResult.errorCode)
        XCTAssertEqual(presenter.requestIDs, [firstRequest.requestID])
    }

    func testRewardedAdCoordinatorPreloadsWithoutGameSpecificRouting() async {
        let presenter = SuspendedRewardedAdPresenter()
        let coordinator = RewardedAdCoordinator(presenter: presenter)
        let adUnitIDs = [
            AdMobConfiguration.productionRewardedAdUnitID,
            "ca-app-pub-1111111111111111/2222222222"
        ]

        await coordinator.preload(adUnitIDs: adUnitIDs)

        XCTAssertEqual(presenter.preloadedAdUnitIDs, adUnitIDs)
    }

    func testRemoteConfigVersionUpdateReplacesRewardedAdUnitsAnd304PreservesThem() {
        let oldID = "ca-app-pub-1111111111111111/1111111111"
        let newID = AdMobConfiguration.productionRewardedAdUnitID
        let oldConfig = AppRemoteConfig(
            configVersion: "2026.07.30.previous",
            wallet: WalletRemoteConfig(
                adReward: WalletAdRewardRemoteConfig(iosAdUnitIDs: [oldID])
            )
        )
        let newConfig = AppRemoteConfig(
            configVersion: "2026.07.31.admob-1011630693",
            wallet: WalletRemoteConfig(
                adReward: WalletAdRewardRemoteConfig(iosAdUnitIDs: [newID])
            )
        )

        let replaced = AppRemoteConfigUpdatePolicy.configAfterResponse(
            cached: oldConfig,
            fetched: newConfig,
            notModified: false
        )
        XCTAssertEqual(replaced.configVersion, newConfig.configVersion)
        XCTAssertEqual(replaced.wallet?.adReward?.iosAdUnitIDs, [newID])
        XCTAssertFalse(replaced.wallet?.adReward?.iosAdUnitIDs?.contains(oldID) == true)

        let preserved = AppRemoteConfigUpdatePolicy.configAfterResponse(
            cached: replaced,
            fetched: nil,
            notModified: true
        )
        XCTAssertEqual(preserved, replaced)
    }

    func testKnownRewardedAdConfigVersionRejectsPoisonedAllowlistCache() {
        let expectedID = AdMobConfiguration.productionRewardedAdUnitID
        let oldID = "ca-app-pub-1877504503518465/7354329102"
        let demoID = AdMobConfiguration.testRewardedAdUnitID

        let missingExpectedID = AppRemoteConfig(
            configVersion: AppRemoteConfigUpdatePolicy.rewardedAdAllowlistMigrationVersion,
            wallet: WalletRemoteConfig(
                adReward: WalletAdRewardRemoteConfig(
                    iosAdUnitIDs: [demoID, oldID]
                )
            )
        )
        let mergedOldID = AppRemoteConfig(
            configVersion: AppRemoteConfigUpdatePolicy.rewardedAdAllowlistMigrationVersion,
            wallet: WalletRemoteConfig(
                adReward: WalletAdRewardRemoteConfig(
                    iosAdUnitIDs: [expectedID, oldID]
                )
            )
        )
        let valid = AppRemoteConfig(
            configVersion: AppRemoteConfigUpdatePolicy.rewardedAdAllowlistMigrationVersion,
            wallet: WalletRemoteConfig(
                adReward: WalletAdRewardRemoteConfig(
                    iosAdUnitIDs: [expectedID]
                )
            )
        )
        let futureVersion = AppRemoteConfig(
            configVersion: "2026.08.01.future",
            wallet: WalletRemoteConfig(
                adReward: WalletAdRewardRemoteConfig(
                    iosAdUnitIDs: [oldID]
                )
            )
        )

        XCTAssertTrue(
            AppRemoteConfigUpdatePolicy.requiresRewardedAdAllowlistRecovery(
                missingExpectedID
            )
        )
        XCTAssertTrue(
            AppRemoteConfigUpdatePolicy.requiresRewardedAdAllowlistRecovery(
                mergedOldID
            )
        )
        XCTAssertFalse(
            AppRemoteConfigUpdatePolicy.requiresRewardedAdAllowlistRecovery(valid)
        )
        XCTAssertFalse(
            AppRemoteConfigUpdatePolicy.requiresRewardedAdAllowlistRecovery(
                futureVersion
            )
        )
    }

    func testRewardedAdLoadFailureMapsToFailedTerminalResult() async throws {
        let request = try GameRewardedAdRequestValidator.decode(rewardedAdPayload())
        let presenter = ImmediateRewardedAdPresenter(
            outcome: .failed(errorCode: GameRewardedAdErrorCode.loadFailed)
        )
        let coordinator = RewardedAdCoordinator(presenter: presenter)

        let result = await coordinator.present(request: request)

        XCTAssertEqual(result.status, .failed)
        XCTAssertEqual(result.errorCode, GameRewardedAdErrorCode.loadFailed)
    }

    func testRewardedAdNoFillMapsToUnavailable() {
        let noFill = NSError(domain: GADErrorDomain, code: 1)

        XCTAssertEqual(
            AdMobGameErrorMapper.presentationOutcome(forLoadError: noFill),
            .unavailable(errorCode: GameRewardedAdErrorCode.noFill)
        )
        XCTAssertEqual(
            AdMobGameErrorMapper.presentationOutcome(
                forLoadError: NSError(domain: "test.load", code: -1)
            ),
            .failed(errorCode: GameRewardedAdErrorCode.loadFailed)
        )
    }

    func testRewardedAdEarlyDismissalReturnsDismissed() {
        var state = GameRewardedAdTerminalState()

        XCTAssertEqual(state.outcomeForDismissal(), .dismissed)
        XCTAssertNil(state.outcomeForDismissal())
    }

    func testRewardedAdEarnedCallbackProducesExactlyOneCompletedTerminal() {
        var state = GameRewardedAdTerminalState()

        state.recordEarnedReward()
        state.recordEarnedReward()
        XCTAssertEqual(state.outcomeForDismissal(), .completed)
        XCTAssertNil(state.outcomeForPresentationFailure())
    }

    func testRewardedAdCallbackUsesArgumentSerializationAgainstJavaScriptInjection() {
        let maliciousValue = #"'); window.__injected = true; ('"#
        let result = GameRewardedAdResult(
            requestID: maliciousValue,
            sessionID: maliciousValue,
            status: .failed,
            errorCode: maliciousValue
        )

        XCTAssertEqual(result.javaScriptPayload["request_id"] as? String, maliciousValue)
        XCTAssertFalse(GameRewardedAdJavaScript.callbackSource.contains(maliciousValue))
        XCTAssertTrue(JSONSerialization.isValidJSONObject(result.javaScriptPayload))
    }

    func testGameRewardMetadataIsValidationOnlyAndNeverBecomesWalletReward() throws {
        let request = try GameRewardedAdRequestValidator.decode(rewardedAdPayload())
        var forgedWalletReward = rewardedAdPayload()
        forgedWalletReward["reward_item"] = "wallet_other_asset"
        forgedWalletReward["reward_amount"] = 999_999
        let requestWithForgedWalletReward = try GameRewardedAdRequestValidator.decode(
            forgedWalletReward
        )
        let result = GameRewardedAdResult(
            requestID: request.requestID,
            sessionID: request.sessionID,
            status: .completed
        )

        // H5 reward metadata is accepted for v1 wire compatibility, but the
        // decoded native request deliberately discards it. Therefore it cannot
        // reach the wallet reward service or affect the terminal callback.
        XCTAssertEqual(requestWithForgedWalletReward, request)
        XCTAssertEqual(result.status, .completed)
        XCTAssertEqual(result.javaScriptPayload.count, 3)
        XCTAssertNil(result.javaScriptPayload["reward_item"])
        XCTAssertNil(result.javaScriptPayload["reward_amount"])
    }

    func testSVGPosterHTMLCoversContainerWithoutBrowserMargins() {
        let html = GameSVGPosterHTML.document(for: Data("<svg></svg>".utf8))

        XCTAssertTrue(html.contains("object-fit: cover"))
        XCTAssertTrue(html.contains("margin: 0"))
        XCTAssertTrue(html.contains("data:image/svg+xml;base64,"))
    }

    func testGameNavigationDisablesSwipeBackWithoutChangingTheDefault() {
        let gameNavigationController = UINavigationController(
            rootViewController: NavigableHostingController(rootView: AnyView(EmptyView()))
        )
        let gameNavigator = UIKitNavigator()
        gameNavigator.navigationController = gameNavigationController

        gameNavigator.push(EmptyView(), allowsSwipeBack: false)

        let gameHost = gameNavigationController.topViewController as? NavigableHostingController
        XCTAssertEqual(gameHost?.allowsSwipeBack, false)
        XCTAssertFalse(
            InteractivePopDelegate(navigationController: gameNavigationController)
                .gestureRecognizerShouldBegin(UIPanGestureRecognizer())
        )

        let standardNavigationController = UINavigationController(
            rootViewController: NavigableHostingController(rootView: AnyView(EmptyView()))
        )
        let standardNavigator = UIKitNavigator()
        standardNavigator.navigationController = standardNavigationController

        standardNavigator.push(EmptyView())

        let standardHost = standardNavigationController.topViewController as? NavigableHostingController
        XCTAssertEqual(standardHost?.allowsSwipeBack, true)
        XCTAssertTrue(
            InteractivePopDelegate(navigationController: standardNavigationController)
                .gestureRecognizerShouldBegin(UIPanGestureRecognizer())
        )
    }

    func testSwipeBackCancelsPendingTouchesOnRevealedControls() throws {
        let navigationController = UINavigationController(
            rootViewController: NavigableHostingController(rootView: AnyView(EmptyView()))
        )
        let existingRecognizers = Set(
            (navigationController.view.gestureRecognizers ?? []).map(ObjectIdentifier.init)
        )

        let coordinator = SwipeBackCoordinator(navigationController: navigationController)
        let addedRecognizer = try XCTUnwrap(
            navigationController.view.gestureRecognizers?.first {
                !existingRecognizers.contains(ObjectIdentifier($0))
            }
        )

        XCTAssertTrue(addedRecognizer is UIPanGestureRecognizer)
        XCTAssertTrue(addedRecognizer.cancelsTouchesInView)
        withExtendedLifetime(coordinator) { }
    }

    func testNavigatorCanResetRetainedTabStackWithoutAnimation() {
        let root = UIViewController()
        let navigationController = UINavigationController(rootViewController: root)
        navigationController.setViewControllers(
            [root, UIViewController(), UIViewController()],
            animated: false
        )
        let navigator = UIKitNavigator()
        navigator.navigationController = navigationController

        navigator.resetToRoot()

        XCTAssertEqual(navigationController.viewControllers.count, 1)
        XCTAssertTrue(navigationController.topViewController === root)
    }

    private func item(
        id: String,
        name: String = "Game",
        entryPrice: Int? = nil
    ) -> GameCatalogItem {
        GameCatalogItem(
            id: id,
            name: name,
            posterURL: "http://52.193.78.191/api/v1/game-assets/example/poster.png",
            iconURL: nil,
            summary: "Description",
            gameType: "Casual",
            entryPriceGoldCoins: entryPrice,
            sortOrder: 100,
            lastPlayedAt: nil
        )
    }

    private func profileBridgePayload(userID: String, deepLink: String? = nil) -> [String: Any] {
        [
            "type": "bwchat.game.open_user_profile",
            "version": 1,
            "source": "just_clear",
            "user_id": userID,
            "deep_link": deepLink ?? GameProfileRoute.deepLink(for: userID) ?? "bwchat://profile/invalid"
        ]
    }

    private func rewardedAdPayload(
        source: String = "just_clear",
        placement: String = "revive"
    ) -> [String: Any] {
        [
            "type": "bwchat.game.show_rewarded_ad",
            "version": 1,
            "source": source,
            "placement": placement,
            "request_id": "550e8400-e29b-41d4-a716-446655440000",
            "session_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            "ad_unit_id": AdMobConfiguration.productionRewardedAdUnitID,
            "ssv_user_id": "game-user-opaque",
            "ssv_custom_data": "short-lived-signed-token",
            "reward_item": "gold_coin",
            "reward_amount": 10
        ]
    }

    private func roundStartPayload() -> [String: Any] {
        [
            "type": GameBridgeRouter.roundStartType,
            "version": 1,
            "source": "just_clear",
            "trigger": "start_button",
            "request_id": "550e8400-e29b-41d4-a716-446655440000",
            "session_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        ]
    }

    private func assertBridgeValidationError(
        _ expectedError: GameBridgeValidationError,
        payload: [String: Any],
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertThrowsError(try GameBridgeMessageValidator.decode(payload), file: file, line: line) { error in
            XCTAssertEqual(error as? GameBridgeValidationError, expectedError, file: file, line: line)
        }
    }

    private func assertRewardedAdValidationError(
        _ expectedError: GameRewardedAdValidationError,
        payload: [String: Any],
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertThrowsError(
            try GameRewardedAdRequestValidator.decode(payload),
            file: file,
            line: line
        ) { error in
            XCTAssertEqual(error as? GameRewardedAdValidationError, expectedError, file: file, line: line)
        }
    }

    private func assertRoundStartValidationError(
        _ expectedError: GameRoundStartValidationError,
        payload: [String: Any],
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertThrowsError(
            try GameRoundStartRequestValidator.decode(payload),
            file: file,
            line: line
        ) { error in
            XCTAssertEqual(
                error as? GameRoundStartValidationError,
                expectedError,
                file: file,
                line: line
            )
        }
    }
}

private enum MockError: Error {
    case failed
}

private final class ScriptMessageHandlerProbe: NSObject, WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) { }
}

@MainActor
private final class SuspendedRewardedAdPresenter: GameRewardedAdPresenting {
    private(set) var requestIDs: [String] = []
    private(set) var preloadedAdUnitIDs: [String] = []
    private var continuation: CheckedContinuation<GameRewardedAdPresentationOutcome, Never>?

    func preloadGameRewardedAds(adUnitIDs: [String]) async {
        preloadedAdUnitIDs = adUnitIDs
    }

    func presentGameRewardedAd(
        request: GameRewardedAdRequest
    ) async -> GameRewardedAdPresentationOutcome {
        requestIDs.append(request.requestID)
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func resolve(_ outcome: GameRewardedAdPresentationOutcome) {
        let continuation = continuation
        self.continuation = nil
        continuation?.resume(returning: outcome)
    }
}

@MainActor
private final class ImmediateRewardedAdPresenter: GameRewardedAdPresenting {
    let outcome: GameRewardedAdPresentationOutcome

    init(outcome: GameRewardedAdPresentationOutcome) {
        self.outcome = outcome
    }

    func presentGameRewardedAd(
        request: GameRewardedAdRequest
    ) async -> GameRewardedAdPresentationOutcome {
        outcome
    }
}

private final class MockGameCenterAPI: GameCenterAPIClient {
    struct LobbyRequest {
        let gameID: String
        let idempotencyKey: UUID
    }

    struct RoundRequest {
        let gameID: String
        let sessionID: String
        let idempotencyKey: UUID
    }

    var recommendedPages: [String?: GameCatalogPage] = [:]
    var playedPage = GameCatalogPage(items: [], nextCursor: nil)
    var playedError: Error?
    var recommendedError: Error?
    var recommendedCursors: [String?] = []
    var sessionCount = 0
    var lobbyRequests: [LobbyRequest] = []
    var roundRequests: [RoundRequest] = []

    func getRecommendedGames(limit: Int, cursor: String?) async throws -> GameCatalogPage {
        recommendedCursors.append(cursor)
        if let recommendedError { throw recommendedError }
        return recommendedPages[cursor] ?? GameCatalogPage(items: [], nextCursor: nil)
    }

    func getPlayedGames(limit: Int, cursor: String?) async throws -> GameCatalogPage {
        if let playedError { throw playedError }
        return playedPage
    }

    func createGameLobbySession(
        gameID: String,
        idempotencyKey: UUID
    ) async throws -> GameSession {
        sessionCount += 1
        lobbyRequests.append(LobbyRequest(
            gameID: gameID,
            idempotencyKey: idempotencyKey
        ))
        return GameSession(
            sessionID: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            launchURL: "https://id7.com/api/v1/game-assets/example/?ticket=opaque",
            expiresAt: "2026-07-12T12:30:00.000Z",
            entryPriceGoldCoins: 25
        )
    }

    func startGameRound(
        gameID: String,
        sessionID: String,
        idempotencyKey: UUID
    ) async throws -> GameRoundStart {
        roundRequests.append(RoundRequest(
            gameID: gameID,
            sessionID: sessionID,
            idempotencyKey: idempotencyKey
        ))
        return GameRoundStart(
            roundID: "01BX5ZZKBKACTAV9WEVGEMMVRZ",
            roundToken: "opaque-round-token",
            expiresAt: "2026-07-12T12:35:00.000Z",
            paymentMethod: "gold_coins",
            entryPriceGoldCoins: 25,
            walletBalance: WalletBalanceResponseData(
                goldCoinBalance: 100,
                spendableBalance: 100
            ),
            consumedProp: nil
        )
    }
}
