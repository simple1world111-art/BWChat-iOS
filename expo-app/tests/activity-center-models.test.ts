import {
  activityDuration,
  activityWheelLandingProgress,
  activityWheelLandingRotation,
  displayWheelSegments,
  hasValidWheelProbability,
  nextClaimableActivityDay,
  normalizeActivityCenterGrantResult,
  normalizeActivityCenterSnapshot,
  normalizeActivityContactDiscoverySession,
  normalizeActivityContactMatchResult,
  normalizeActivityInviteShareSession,
  normalizeActivityPhoneVerificationSession,
  normalizeActivityWheelSpinEnvelope,
  optimisticallyClaimActivityCheckIn,
  optimisticallyClaimActivityMeal,
  orderedActivityMeals,
} from "@/services/activity/ActivityModels";
import { activitySnapshotWire } from "./fixtures/activityCenterFixture";

describe("ActivityCenter models and source contracts", () => {
  it("decodes the canonical snapshot, preserves server values, and sorts display segments only", () => {
    const snapshot = normalizeActivityCenterSnapshot({ code: 0, data: activitySnapshotWire });
    expect(snapshot.configVersion).toBe("activity-2026-08-v3");
    expect(nextClaimableActivityDay(snapshot.checkIn)?.day).toBe(2);
    expect(snapshot.wheel.currentTier.segments.map((segment) => segment.id)).toEqual([
      "p50",
      "p10",
      "p100",
      "p20",
    ]);
    expect(displayWheelSegments(snapshot.wheel.currentTier).map((segment) => segment.id)).toEqual([
      "p10",
      "p20",
      "p50",
      "p100",
    ]);
    expect(hasValidWheelProbability(snapshot.wheel.currentTier)).toBe(true);
  });

  it("accepts only the native safe aliases and null unavailable structures", () => {
    const snapshot = normalizeActivityCenterSnapshot({
      ...activitySnapshotWire,
      config_version: null,
      activity_cat_food_balance: "60",
      gold_coin_balance: "1280",
      phone_binding: null,
      check_in: null,
      meal_rewards: null,
      tasks: null,
      invitation: null,
      wheel: {
        enabled: 1,
        currency: "gold_coin",
        current_tier: {
          tier_id: "tier_10",
          sequence: "2",
          cost_gold_coins: "10",
          next_tier_id: null,
          segments: [
            {
              prize_id: "p10",
              payout_gold_coins: "10",
              probability_ppm: "500000",
              display_order: "0",
            },
            {
              prize_id: "p20",
              payout_gold_coins: "20",
              probability_ppm: "300000",
              display_order: "1",
            },
            {
              prize_id: "p50",
              payout_gold_coins: "50",
              probability_ppm: "150000",
              display_order: "2",
            },
            {
              prize_id: "p100",
              payout_gold_coins: "100",
              probability_ppm: "50000",
              display_order: "3",
            },
          ],
        },
        recent_winners: [{ display_name: "M***w", avatar_url: null, payout_gold_coins: "100" }],
      },
    });
    expect(snapshot.configVersion).toBe("");
    expect(snapshot.phoneBinding).toEqual({ isVerified: false });
    expect(snapshot.checkIn.days).toEqual([]);
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.wheel.recentWinners[0]).toMatchObject({ avatarURL: "", payoutGoldCoins: 100 });
  });

  it("matches native trimming, case-folding, integer and local-time decode boundaries", () => {
    const snapshot = normalizeActivityCenterSnapshot({
      ...activitySnapshotWire,
      phone_binding: { ...activitySnapshotWire.phone_binding, is_verified: " TRUE " },
      meal_rewards: activitySnapshotWire.meal_rewards.map((meal) =>
        meal.window_id === "breakfast" ? { ...meal, start_local: "7:00", end_local: "9:00" } : meal,
      ),
    });
    expect(snapshot.phoneBinding.isVerified).toBe(true);
    expect(
      orderedActivityMeals(
        snapshot.mealRewards,
        new Date("2026-08-02T21:00:00Z"),
        "Asia/Tokyo",
      ).map((meal) => meal.id),
    ).toEqual(["breakfast", "lunch", "dinner"]);
    expect(() =>
      normalizeActivityCenterSnapshot({
        ...activitySnapshotWire,
        activity_cat_food_balance: "   ",
      }),
    ).toThrow("activity_cat_food_balance");
    expect(() =>
      normalizeActivityCenterSnapshot({
        ...activitySnapshotWire,
        business_timezone: 1.5,
      }),
    ).toThrow("business_timezone");
    for (const nonNativeInteger of ["1e3", "1.0", "0x10"]) {
      expect(() =>
        normalizeActivityCenterSnapshot({
          ...activitySnapshotWire,
          activity_cat_food_balance: nonNativeInteger,
        }),
      ).toThrow("activity_cat_food_balance");
    }
    expect(() =>
      normalizeActivityCenterSnapshot({
        ...activitySnapshotWire,
        tasks: activitySnapshotWire.tasks.map((task) =>
          task.kind === "invite_share" ? { ...task, daily_limit: "not-an-integer" } : task,
        ),
      }),
    ).toThrow("daily_limit");
    expect(
      normalizeActivityCenterSnapshot({
        ...activitySnapshotWire,
        tasks: activitySnapshotWire.tasks.map((task) =>
          task.kind === "invite_share" ? { ...task, completed_count: "not-an-integer" } : task,
        ),
      }).tasks.find((task) => task.kind === "invite_share")?.completedCount,
    ).toBe(0);
  });

  it("rejects unknown claim status and missing critical prize/probability fields", () => {
    expect(() =>
      normalizeActivityCenterSnapshot({
        ...activitySnapshotWire,
        check_in: {
          ...activitySnapshotWire.check_in,
          days: [{ day: 1, reward_activity_cat_food: 10, status: "not_started" }],
        },
      }),
    ).toThrow("Invalid activity claim status");
    expect(() =>
      normalizeActivityCenterSnapshot({
        ...activitySnapshotWire,
        wheel: {
          ...activitySnapshotWire.wheel,
          current_tier: {
            ...activitySnapshotWire.wheel.current_tier,
            segments: [{ id: "p10", probability_ppm: 1_000_000, display_order: 0 }],
          },
        },
      }),
    ).toThrow("payout_gold_coins");
  });

  it("keeps synthesized Swift response models strict while allowing their empty strings", () => {
    expect(() =>
      normalizeActivityCenterGrantResult({
        granted_activity_cat_food: "20",
        snapshot: activitySnapshotWire,
      }),
    ).toThrow("granted_activity_cat_food");
    expect(() =>
      normalizeActivityContactDiscoverySession({
        session_id: 1,
        salt: "salt",
        salt_version: "v1",
        default_region: "JP",
        max_contacts: 100,
        expires_at: "later",
      }),
    ).toThrow("session_id");
    expect(() =>
      normalizeActivityContactMatchResult({
        granted_activity_cat_food: 0,
        snapshot: activitySnapshotWire,
      }),
    ).toThrow("matches");
    expect(() =>
      normalizeActivityContactMatchResult({
        matches: [{ user_id: "user", nickname: "M", avatar_url: null, relation: "none" }],
        granted_activity_cat_food: 0,
        snapshot: activitySnapshotWire,
      }),
    ).toThrow("avatar_url");
    expect(() =>
      normalizeActivityPhoneVerificationSession({
        session_id: "phone",
        expires_at: "later",
        retry_after_seconds: "30",
      }),
    ).toThrow("retry_after_seconds");
    expect(
      normalizeActivityInviteShareSession({
        session_id: "",
        share_url: "",
        invite_code: "",
        message: "",
        expires_at: "",
      }),
    ).toEqual({ id: "", shareURL: "", inviteCode: "", message: "", expiresAt: "" });
  });

  it("optimistically claims the cumulative next day and one meal without inventing rewards", () => {
    const snapshot = normalizeActivityCenterSnapshot(activitySnapshotWire);
    const checkIn = optimisticallyClaimActivityCheckIn(snapshot);
    expect(checkIn).toMatchObject({
      activityCatFoodBalance: 80,
      checkIn: { claimedDays: 2, canClaim: false },
    });
    expect(checkIn?.checkIn.days.find((day) => day.day === 2)?.status).toBe("claimed");
    const meal = optimisticallyClaimActivityMeal(snapshot, "lunch");
    expect(meal?.activityCatFoodBalance).toBe(80);
    expect(meal?.mealRewards.find((item) => item.id === "lunch")?.status).toBe("claimed");
  });

  it("orders current and upcoming meal windows in the server business timezone", () => {
    const meals = normalizeActivityCenterSnapshot(activitySnapshotWire).mealRewards;
    expect(
      orderedActivityMeals(meals, new Date("2026-08-03T06:00:00Z"), "Asia/Tokyo").map(
        (meal) => meal.id,
      ),
    ).toEqual(["dinner", "breakfast", "lunch"]);
    expect(
      orderedActivityMeals(meals, new Date("2026-08-03T13:00:00Z"), "Asia/Tokyo").map(
        (meal) => meal.id,
      ),
    ).toEqual(["breakfast", "lunch", "dinner"]);
  });

  it("adds six full turns, lands on four distinct centers, and never finishes early", () => {
    const normalized = [0, 1, 2, 3].map(
      (index) => ((activityWheelLandingRotation(0, index) % 360) + 360) % 360,
    );
    expect(normalized).toEqual([315, 225, 135, 45]);
    for (const start of [0, 315, 2_407.5, 9_999]) {
      for (let index = 0; index < 4; index += 1) {
        const delta = activityWheelLandingRotation(start, index, 6) - start;
        expect(delta).toBeGreaterThanOrEqual(6 * 360);
        expect(delta).toBeLessThan(7 * 360);
      }
    }
    expect(activityWheelLandingProgress(0)).toBe(0);
    expect(activityWheelLandingProgress(0.5)).toBeGreaterThan(0.6);
    expect(activityWheelLandingProgress(0.975)).toBeLessThan(1);
    expect(activityWheelLandingProgress(1)).toBe(1);
  });

  it("accepts terminal null next tier and formats the second-by-second countdown", () => {
    const envelope = normalizeActivityWheelSpinEnvelope({
      result: {
        spin_id: "spin-terminal",
        tier_id: "tier_10",
        cost_gold_coins: 10,
        prize_id: "p20",
        payout_gold_coins: 20,
        net_delta_gold_coins: 10,
        next_tier_id: null,
      },
      snapshot: activitySnapshotWire,
    });
    expect(envelope.result.nextTierID).toBe("");
    expect(activityDuration(3_661)).toBe("01:01:01");
  });
});
