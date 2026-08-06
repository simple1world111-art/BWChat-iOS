import XCTest
@testable import BBchat

@MainActor
final class ActivityCenterTests: XCTestCase {
    func testSnapshotRoundTripsDynamicRewardsAndServerTime() throws {
        let source = ActivityCenterSnapshot.preview
        let data = try JSONEncoder().encode(source)
        let decoded = try JSONDecoder().decode(ActivityCenterSnapshot.self, from: data)

        XCTAssertEqual(decoded, source)
        XCTAssertEqual(decoded.checkIn.days.map(\.rewardActivityCatFood), [10, 20, 30, 40, 50, 60, 100])
        XCTAssertEqual(decoded.mealRewards.first(where: { $0.id == "lunch" })?.rewardActivityCatFood, 20)
        XCTAssertEqual(decoded.wheel.currentTier.segments.count, 4)
        XCTAssertNotNil(ActivityCenterDateParser.date(from: decoded.serverTime))
    }

    func testDecodesCanonicalBackendActivityCenterEnvelope() throws {
        let json = Data(#"""
        {
          "code": 0,
          "message": "ok",
          "data": {
            "config_version": "activity-2026-08-v3",
            "server_time": "2026-08-03T12:28:00+09:00",
            "business_timezone": "Asia/Tokyo",
            "activity_cat_food_balance": 60,
            "gold_coin_balance": 1280,
            "phone_binding": {
              "is_verified": true,
              "masked_phone": "+81******5678",
              "default_region": "JP"
            },
            "check_in": {
              "activity_id": "new_user_7d_v1",
              "claimed_days": 1,
              "completed": false,
              "can_claim": true,
              "days": [
                {"day": 1, "reward_activity_cat_food": 10, "status": "claimed"},
                {"day": 2, "reward_activity_cat_food": 20, "status": "claimable"}
              ]
            },
            "meal_rewards": [{
              "window_id": "lunch",
              "title_key": "activityCenter.meal.lunch",
              "start_local": "12:00",
              "end_local": "14:00",
              "reward_activity_cat_food": 20,
              "status": "claimable",
              "next_transition_at": "2026-08-03T14:00:00+09:00",
              "claimed_at": null
            }],
            "tasks": [{
              "id": "contact_sync",
              "kind": "contact_sync",
              "status": "available",
              "reward_activity_cat_food": 100,
              "daily_limit": null,
              "completed_count": 0,
              "credited_count": 0
            }],
            "invitation": {
              "invite_code": "MEOW88",
              "share_url": "https://example.com/i/token",
              "pending_invites": 1,
              "credited_invites": 0,
              "can_redeem": true
            },
            "wheel": {
              "enabled": true,
              "currency": "gold_coin",
              "current_tier": {
                "id": "tier_10",
                "sequence": 2,
                "cost_gold_coins": 10,
                "next_tier_id": "tier_100",
                "segments": [
                  {"id": "p10", "payout_gold_coins": 10, "probability_ppm": 500000, "display_order": 0},
                  {"id": "p20", "payout_gold_coins": 20, "probability_ppm": 300000, "display_order": 1},
                  {"id": "p50", "payout_gold_coins": 50, "probability_ppm": 150000, "display_order": 2},
                  {"id": "p100", "payout_gold_coins": 100, "probability_ppm": 50000, "display_order": 3}
                ]
              },
              "recent_winners": []
            }
          }
        }
        """#.utf8)

        let envelope = try JSONDecoder().decode(
            APIResponseWrapper<ActivityCenterSnapshot>.self,
            from: json
        )
        let snapshot = try envelope.requiredData()

        XCTAssertEqual(snapshot.configVersion, "activity-2026-08-v3")
        XCTAssertEqual(snapshot.checkIn.nextClaimableDay?.day, 2)
        XCTAssertEqual(snapshot.wheel.currentTier.displaySegments.map(\.id), ["p10", "p20", "p50", "p100"])
    }

    func testDecodesSafeBackendBoundaryAliasesWithoutInventingRewards() throws {
        let json = Data(#"""
        {
          "code": "0",
          "message": "ok",
          "data": {
            "config_version": "activity-boundary-v1",
            "server_time": "2026-08-03T12:28:00+09:00",
            "business_timezone": "Asia/Tokyo",
            "activity_cat_food_balance": "60",
            "gold_coin_balance": "1280",
            "phone_binding": null,
            "check_in": null,
            "meal_rewards": null,
            "tasks": null,
            "invitation": null,
            "wheel": {
              "enabled": 1,
              "currency": "gold_coin",
              "current_tier": {
                "tier_id": "tier_10",
                "sequence": "2",
                "cost_gold_coins": "10",
                "next_tier_id": null,
                "segments": [
                  {"prize_id": "p10", "payout_gold_coins": "10", "probability_ppm": "500000", "display_order": "0"},
                  {"prize_id": "p20", "payout_gold_coins": "20", "probability_ppm": "300000", "display_order": "1"},
                  {"prize_id": "p50", "payout_gold_coins": "50", "probability_ppm": "150000", "display_order": "2"},
                  {"prize_id": "p100", "payout_gold_coins": "100", "probability_ppm": "50000", "display_order": "3"}
                ]
              },
              "recent_winners": [{
                "display_name": "M***w",
                "avatar_url": null,
                "payout_gold_coins": "100"
              }]
            }
          }
        }
        """#.utf8)

        let envelope = try JSONDecoder().decode(
            APIResponseWrapper<ActivityCenterSnapshot>.self,
            from: json
        )
        let snapshot = try envelope.requiredData()

        XCTAssertEqual(snapshot.activityCatFoodBalance, 60)
        XCTAssertEqual(snapshot.goldCoinBalance, 1_280)
        XCTAssertTrue(snapshot.checkIn.days.isEmpty)
        XCTAssertTrue(snapshot.mealRewards.isEmpty)
        XCTAssertTrue(snapshot.tasks.isEmpty)
        XCTAssertEqual(snapshot.wheel.currentTier.id, "tier_10")
        XCTAssertEqual(snapshot.wheel.currentTier.displaySegments.first?.id, "p10")
        XCTAssertEqual(snapshot.wheel.recentWinners.first?.avatarURL, "")
        XCTAssertTrue(snapshot.wheel.currentTier.hasValidProbabilityTotal)
    }

    func testDecodesInactiveBackendSnapshotWithNullConfigVersion() throws {
        let json = Data(#"""
        {
          "code": 0,
          "message": "ok",
          "data": {
            "config_version": null,
            "server_time": "2026-08-03T18:28:00+09:00",
            "business_timezone": "Asia/Tokyo",
            "activity_cat_food_balance": 0,
            "gold_coin_balance": 1280,
            "phone_binding": {
              "is_verified": false,
              "masked_phone": null,
              "default_region": "JP"
            },
            "check_in": {
              "activity_id": null,
              "claimed_days": 0,
              "completed": false,
              "can_claim": false,
              "days": [],
              "status": "unavailable"
            },
            "meal_rewards": [],
            "tasks": [],
            "invitation": {
              "invite_code": null,
              "share_url": null,
              "pending_invites": 0,
              "credited_invites": 0,
              "can_redeem": false,
              "status": "unavailable"
            },
            "wheel": {
              "enabled": false,
              "currency": "gold_coin",
              "current_tier": null,
              "recent_winners": []
            }
          }
        }
        """#.utf8)

        let envelope = try JSONDecoder().decode(
            APIResponseWrapper<ActivityCenterSnapshot>.self,
            from: json
        )
        let snapshot = try envelope.requiredData()

        XCTAssertEqual(snapshot.configVersion, "")
        XCTAssertTrue(snapshot.checkIn.days.isEmpty)
        XCTAssertTrue(snapshot.mealRewards.isEmpty)
        XCTAssertTrue(snapshot.tasks.isEmpty)
        XCTAssertFalse(snapshot.wheel.enabled)
        XCTAssertTrue(snapshot.wheel.currentTier.id.isEmpty)
    }

    func testRejectsMissingCriticalRewardOrProbabilityFields() {
        let missingPayout = Data(#"""
        {"prize_id":"p10","probability_ppm":1000000,"display_order":0}
        """#.utf8)
        let unknownStatus = Data(#"""
        {"day":1,"reward_activity_cat_food":10,"status":"not_started"}
        """#.utf8)

        XCTAssertThrowsError(try JSONDecoder().decode(ActivityWheelSegment.self, from: missingPayout))
        XCTAssertThrowsError(try JSONDecoder().decode(ActivityCheckInDay.self, from: unknownStatus))
    }

    func testWheelRequiresFourSegmentsAndOneMillionPPM() {
        let tier = ActivityCenterSnapshot.preview.wheel.currentTier
        XCTAssertTrue(tier.hasValidProbabilityTotal)

        let invalidCount = ActivityWheelTier(
            id: tier.id,
            sequence: tier.sequence,
            costGoldCoins: tier.costGoldCoins,
            nextTierID: tier.nextTierID,
            segments: Array(tier.segments.prefix(3))
        )
        XCTAssertFalse(invalidCount.hasValidProbabilityTotal)

        let invalidTotal = ActivityWheelTier(
            id: tier.id,
            sequence: tier.sequence,
            costGoldCoins: tier.costGoldCoins,
            nextTierID: tier.nextTierID,
            segments: tier.segments.enumerated().map { index, segment in
                ActivityWheelSegment(
                    id: segment.id,
                    payoutGoldCoins: segment.payoutGoldCoins,
                    probabilityPPM: segment.probabilityPPM + (index == 0 ? 1 : 0),
                    displayOrder: segment.displayOrder
                )
            }
        )
        XCTAssertFalse(invalidTotal.hasValidProbabilityTotal)
    }

    func testOperationStatusesUpdateIndependentlyAndRejectDuplicateStarts() {
        let operations = ActivityCenterOperations()
        let checkIn = operations.status(for: .checkIn)
        let wheel = operations.status(for: .wheel)

        XCTAssertTrue(operations.begin(.checkIn))
        XCTAssertTrue(checkIn.isRunning)
        XCTAssertFalse(wheel.isRunning)
        XCTAssertFalse(operations.begin(.checkIn))

        operations.end(.checkIn)
        XCTAssertFalse(checkIn.isRunning)
        XCTAssertFalse(operations.isBusy)
    }

    func testMealsOrderCurrentThenNextUsingBusinessTimezone() throws {
        let meals = ActivityCenterSnapshot.preview.mealRewards
        let afternoon = try XCTUnwrap(ActivityCenterDateParser.date(from: "2026-08-03T15:00:00+09:00"))
        let afterDinner = try XCTUnwrap(ActivityCenterDateParser.date(from: "2026-08-03T22:00:00+09:00"))

        XCTAssertEqual(
            ActivityMealSchedule.ordered(meals, at: afternoon, timezoneID: "Asia/Tokyo").map(\.id),
            ["dinner", "breakfast", "lunch"]
        )
        XCTAssertEqual(
            ActivityMealSchedule.ordered(meals, at: afterDinner, timezoneID: "Asia/Tokyo").map(\.id),
            ["breakfast", "lunch", "dinner"]
        )
    }

    func testWheelGeometryProducesDistinctServerPrizeLandings() {
        let normalized = (0..<4).map {
            positiveModulo(ActivityWheelGeometry.landingRotation(segmentIndex: $0), 360)
        }
        XCTAssertEqual(Set(normalized).count, 4)
        XCTAssertEqual(normalized, [315, 225, 135, 45])
    }

    func testEveryWheelSpinAddsAtLeastTheConfiguredFullTurns() {
        let rotations = [0.0, 315.0, 2_407.5, 9_999.0]

        for current in rotations {
            for segmentIndex in 0..<ActivityWheelGeometry.prizeSegmentCount {
                let target = ActivityWheelGeometry.landingRotation(
                    from: current,
                    segmentIndex: segmentIndex,
                    turns: 6
                )
                XCTAssertGreaterThanOrEqual(target - current, 6 * 360)
                XCTAssertLessThan(target - current, 7 * 360)
            }
        }
    }

    func testWheelLandingMotionRunsForItsFullDurationWithoutAnEarlyStop() {
        let startedAt = Date(timeIntervalSince1970: 1_000)
        let startRotation = 225.0
        let targetRotation = startRotation + 6 * 360 + 90
        let motion = ActivityWheelMotion.landing(
            startedAt: startedAt,
            startRotation: startRotation,
            targetRotation: targetRotation,
            duration: 4
        )
        let samples = stride(from: 0.0, through: 4.0, by: 0.1).map {
            motion.rotation(at: startedAt.addingTimeInterval($0))
        }

        XCTAssertEqual(samples[0], startRotation)
        XCTAssertEqual(samples[samples.count - 1], targetRotation, accuracy: 0.0001)
        XCTAssertTrue(zip(samples, samples.dropFirst()).allSatisfy { $0.0 < $0.1 })
        XCTAssertGreaterThan(
            motion.rotation(at: startedAt.addingTimeInterval(2)) - startRotation,
            3 * 360
        )
        XCTAssertLessThan(
            motion.rotation(at: startedAt.addingTimeInterval(3.9)),
            targetRotation
        )
    }

    func testOptimisticClaimsUpdateTheVisibleStateBeforeTheNetworkReturns() throws {
        let snapshot = ActivityCenterSnapshot.preview
        let checkIn = try XCTUnwrap(snapshot.optimisticallyClaimingCheckIn())
        XCTAssertEqual(checkIn.checkIn.claimedDays, snapshot.checkIn.claimedDays + 1)
        XCTAssertEqual(checkIn.checkIn.days.first(where: { $0.day == 2 })?.status, .claimed)
        XCTAssertFalse(checkIn.checkIn.canClaim)
        XCTAssertEqual(checkIn.activityCatFoodBalance, snapshot.activityCatFoodBalance + 20)

        let meal = try XCTUnwrap(snapshot.optimisticallyClaimingMeal(id: "lunch"))
        XCTAssertEqual(meal.mealRewards.first(where: { $0.id == "lunch" })?.status, .claimed)
        XCTAssertEqual(meal.activityCatFoodBalance, snapshot.activityCatFoodBalance + 20)
    }

    func testWheelSnapshotUsesHigherTierReturnedByServer() {
        let previous = ActivityCenterSnapshot.preview
        let nextTier = ActivityWheelTier(
            id: "tier_100",
            sequence: previous.wheel.currentTier.sequence + 1,
            costGoldCoins: 100,
            nextTierID: "tier_1000",
            segments: previous.wheel.currentTier.segments
        )
        let server = previous.replacing(
            wheel: ActivityWheelState(
                enabled: true,
                currency: "gold_coin",
                currentTier: nextTier,
                recentWinners: []
            )
        )
        let reconciled = ActivityCenterSnapshotAuthority.resolve(
            local: previous,
            server: server
        )

        XCTAssertTrue(reconciled.wheel.enabled)
        XCTAssertEqual(reconciled.wheel.currentTier.id, nextTier.id)
        XCTAssertEqual(reconciled.wheel.currentTier.sequence, nextTier.sequence)
    }

    func testWheelSnapshotAcceptsBackendResetToFirstTierInTheSameConfigVersion() {
        let previous = ActivityCenterSnapshot.preview
        let firstTier = ActivityWheelTier(
            id: "tier_1",
            sequence: 1,
            costGoldCoins: 1,
            nextTierID: previous.wheel.currentTier.id,
            segments: previous.wheel.currentTier.segments
        )
        let server = previous.replacing(
            wheel: ActivityWheelState(
                enabled: true,
                currency: "gold_coin",
                currentTier: firstTier,
                recentWinners: []
            )
        )
        let reconciled = ActivityCenterSnapshotAuthority.resolve(
            local: previous,
            server: server
        )

        XCTAssertTrue(reconciled.wheel.enabled)
        XCTAssertEqual(reconciled.configVersion, previous.configVersion)
        XCTAssertEqual(reconciled.wheel.currentTier.id, firstTier.id)
        XCTAssertEqual(reconciled.wheel.currentTier.sequence, firstTier.sequence)
    }

    func testWheelSnapshotSupportsServerGeneratedTiersWithoutAFourTierFrontendCap() {
        let previous = ActivityCenterSnapshot.preview
        let generatedTier = ActivityWheelTier(
            id: "tier_10000000000",
            sequence: 11,
            costGoldCoins: 10_000_000_000,
            nextTierID: "tier_100000000000",
            segments: previous.wheel.currentTier.segments
        )
        let server = previous.replacing(
            wheel: ActivityWheelState(
                enabled: true,
                currency: "gold_coin",
                currentTier: generatedTier,
                recentWinners: []
            )
        )

        let resolved = ActivityCenterSnapshotAuthority.resolve(
            local: previous,
            server: server
        )

        XCTAssertEqual(resolved.wheel.currentTier.sequence, 11)
        XCTAssertEqual(resolved.wheel.currentTier.costGoldCoins, 10_000_000_000)
        XCTAssertEqual(resolved.wheel.currentTier.nextTierID, "tier_100000000000")
        XCTAssertTrue(resolved.wheel.currentTier.hasValidProbabilityTotal)
    }

    func testTerminalWheelSpinAcceptsNullNextTierID() throws {
        let data = Data(#"""
        {
          "spin_id": "spin-terminal",
          "tier_id": "tier_1000",
          "cost_gold_coins": 1000,
          "prize_id": "tier_1000_p2000",
          "payout_gold_coins": 2000,
          "net_delta_gold_coins": 1000,
          "next_tier_id": null
        }
        """#.utf8)

        let result = try JSONDecoder().decode(ActivityWheelSpinResult.self, from: data)

        XCTAssertEqual(result.spinID, "spin-terminal")
        XCTAssertTrue(result.nextTierID.isEmpty)
    }

    func testContactHashMatchesContractAndContainsNoRawPhone() {
        let digest = ActivityContactDiscoveryService.hash(
            salt: "rotation-v1",
            e164: "+819012345678"
        )
        XCTAssertEqual(digest, "6f1af43767e0a0903637546111604caf0a8ab5b2792c319475258f74991087b5")
        XCTAssertEqual(digest.count, 64)
        XCTAssertFalse(digest.contains("819012345678"))
    }

    func testInviteDeepLinkAndLandingURLDecodeSameToken() throws {
        let token = "abcDEF_123-xyz"
        XCTAssertEqual(
            ActivityInviteRouteStore.token(from: try XCTUnwrap(URL(string: "bwchat://invite/\(token)"))),
            token
        )
        XCTAssertEqual(
            ActivityInviteRouteStore.token(from: try XCTUnwrap(URL(string: "https://invite.example.com/i/\(token)"))),
            token
        )
        XCTAssertNil(ActivityInviteRouteStore.token(from: try XCTUnwrap(URL(string: "bwchat://group-invite/\(token)"))))
        XCTAssertNil(ActivityInviteRouteStore.token(from: try XCTUnwrap(URL(string: "bwchat://invite/a%2Fb"))))
    }

    func testCheckInProgressIsCumulativeAndDoesNotInferCalendarStreak() {
        let state = ActivityCenterSnapshot.preview.checkIn
        XCTAssertEqual(state.claimedDays, 1)
        XCTAssertEqual(state.nextClaimableDay?.day, 2)
        XCTAssertFalse(state.completed)
    }

    func testKnownActivityAndGameWalletRecordsFollowCurrentAppLanguage() throws {
        let previousLanguage = AppLanguageStore.shared.selectedLanguage
        defer { AppLanguageStore.shared.setLanguage(previousLanguage) }

        let data = Data(#"""
        [
          {
            "id":"wheel-prize",
            "type":"balance_change",
            "currency":"gold_coin",
            "gold_coin_amount":10,
            "title":"Activity Center wheel prize",
            "note":"Activity Center wheel prize"
          },
          {
            "id":"wheel-cost",
            "type":"activity_center_wheel_cost",
            "currency":"gold_coin",
            "gold_coin_amount":-10,
            "title":"Activity Center wheel cost",
            "note":"Activity Center wheel cost"
          },
          {
            "id":"game-entry",
            "type":"game_round_start",
            "currency":"gold_coin",
            "gold_coin_amount":-10,
            "title":"game_round_start",
            "note":"Just Clear game entry"
          },
          {
            "id":"ranking",
            "type":"game_ranking_reward",
            "currency":"gold_coin",
            "gold_coin_amount":32,
            "title":"Ranking reward",
            "note":"Just Clear ranking reward"
          }
        ]
        """#.utf8)
        let records = try JSONDecoder().decode([WalletTransaction].self, from: data)

        AppLanguageStore.shared.setLanguage(.simplifiedChinese)
        XCTAssertEqual(records[0].displayTitle, "幸运转盘奖励")
        XCTAssertEqual(records[0].displaySubtitle, "幸运转盘")
        XCTAssertEqual(records[1].displayTitle, "幸运转盘花费")
        XCTAssertEqual(records[2].displayTitle, "游戏入场")
        XCTAssertEqual(records[2].displaySubtitle, "游戏")
        XCTAssertEqual(records[3].displayTitle, "排行榜奖励")

        AppLanguageStore.shared.setLanguage(.english)
        XCTAssertEqual(records[0].displayTitle, "Lucky Wheel Reward")
        XCTAssertEqual(records[0].displaySubtitle, "Lucky Wheel")
        XCTAssertEqual(records[1].displayTitle, "Lucky Wheel Cost")
        XCTAssertEqual(records[2].displayTitle, "Game Entry")
        XCTAssertEqual(records[2].displaySubtitle, "Games")
        XCTAssertEqual(records[3].displayTitle, "Leaderboard Reward")
    }

    func testActivityCatFoodRecordsLocalizeKnownSourcesAndHideRawIdentifiers() throws {
        let previousLanguage = AppLanguageStore.shared.selectedLanguage
        defer { AppLanguageStore.shared.setLanguage(previousLanguage) }
        AppLanguageStore.shared.setLanguage(.simplifiedChinese)

        let data = Data(#"""
        {
          "id":"check-in-grant",
          "delta":10,
          "balance_after":30,
          "source":"activity_check_in",
          "title":"New user check-in reward"
        }
        """#.utf8)
        let record = try JSONDecoder().decode(ActivityCatFoodTransaction.self, from: data)

        XCTAssertEqual(record.displayTitle, L10n.tr("activityCenter.checkIn.title"))
        XCTAssertEqual(record.displaySource, L10n.tr("activityCatFood.transaction.grant"))
        XCTAssertFalse(record.displayTitle.contains("New user"))
        XCTAssertFalse(record.displaySource?.contains("activity_check_in") == true)
    }

    private func positiveModulo(_ value: Double, _ divisor: Double) -> Int {
        Int(((value.truncatingRemainder(dividingBy: divisor)) + divisor)
            .truncatingRemainder(dividingBy: divisor))
    }
}
