import {
  isLiveBillingInsufficient,
  liveBillingAccruedAmount,
  liveBillingFreeSecondsRemaining,
  liveExperienceAccruedOverageAmount,
  liveExperienceRemainingSeconds,
  liveTerminationGraceMilliseconds,
  normalizeCallLivePayload,
  normalizeLiveExperienceSnapshot,
  liveBillingPolicyOrFallback,
  shouldConsumeLiveExperienceCard,
} from "@/services/live/LiveCallExperience";

const policy = { currency: "spendable_balance", freeSeconds: 10, unitSeconds: 60, amountPerUnit: 100, minimumStartingBalance: 100, rounding: "started_unit" };

describe("live call experience and billing parity", () => {
  it("normalizes aliases and anchors server remaining time to receipt time", () => {
    const receivedAt = Date.now();
    const experience = normalizeLiveExperienceSnapshot({
      prop_definition_id: "live_experience_card_10m",
      status: "active",
      experience_ends_at: "2026-08-07T00:10:00Z",
      host_earning_enabled: "NO",
      reserved_prop: {
        inventory_id: "inventory-1",
        definition_id: "live_experience_card_10m",
        remaining_quantity: 2,
      },
    }, "2026-08-07T00:00:00Z")!;
    expect(experience).toMatchObject({
      definitionId: "live_experience_card_10m",
      durationSeconds: 600,
      status: "active",
      hostEarningEnabled: false,
      reservedProp: {
        inventory_id: "inventory-1",
        definition_id: "live_experience_card_10m",
        remaining_quantity: 2,
      },
    });
    expect(liveExperienceRemainingSeconds(experience, 20, receivedAt + 2_400)).toBe(598);
  });

  it("uses explicit remaining time, duration fallback, and terminal status", () => {
    const explicit = normalizeLiveExperienceSnapshot({ definition_id: "live_experience_card_5m", status: " consumed ", remaining_seconds: 45 })!;
    expect(liveExperienceRemainingSeconds(explicit, 200, explicit.receivedAt + 1_200)).toBe(44);
    const fallback = normalizeLiveExperienceSnapshot({ definition_id: "live_experience_card_5m", status: "reserved" })!;
    expect(liveExperienceRemainingSeconds(fallback, 12, fallback.receivedAt)).toBe(288);
    expect(liveExperienceRemainingSeconds({ ...fallback, status: "completed" }, 0)).toBe(0);
  });

  it("matches native free, started-unit, and experience-overage billing math", () => {
    expect(liveBillingFreeSecondsRemaining(policy, 2.2)).toBe(8);
    expect(liveBillingAccruedAmount(policy, 10)).toBe(0);
    expect(liveBillingAccruedAmount(policy, 10.001)).toBe(100);
    expect(liveBillingAccruedAmount(policy, 60)).toBe(100);
    expect(liveBillingAccruedAmount(policy, 60.001)).toBe(200);
    expect(liveBillingAccruedAmount(policy, 120)).toBe(200);
    expect(liveBillingAccruedAmount(policy, 120.001)).toBe(300);
    expect(liveBillingAccruedAmount(policy, 61)).toBe(200);
    const experience = normalizeLiveExperienceSnapshot({ definition_id: "live_experience_card_5m", status: "active" })!;
    expect(shouldConsumeLiveExperienceCard(10, policy.freeSeconds)).toBe(false);
    expect(shouldConsumeLiveExperienceCard(10.001, policy.freeSeconds)).toBe(true);
    expect(liveExperienceRemainingSeconds(experience, 0, experience.receivedAt)).toBe(300);
    expect(liveExperienceRemainingSeconds(experience, 300, experience.receivedAt)).toBe(0);
    expect(liveExperienceAccruedOverageAmount(experience, policy, 300)).toBe(0);
    expect(liveExperienceAccruedOverageAmount(experience, policy, 300.001)).toBe(100);
    expect(liveExperienceAccruedOverageAmount(experience, policy, 360)).toBe(100);
    expect(liveExperienceAccruedOverageAmount(experience, policy, 360.1)).toBe(200);
  });

  it("normalizes call-level billing and experience payloads", () => {
    expect(normalizeCallLivePayload({
      billing_policy: { free_seconds: "12", unit_seconds: 30, amount_per_unit: 50, minimum_starting_balance: 90 },
      live_experience: { definition_id: "live_experience_card_15m", status: "reserved" },
    })).toMatchObject({ billingPolicy: { freeSeconds: 12, unitSeconds: 30, amountPerUnit: 50, minimumStartingBalance: 90 }, liveExperience: { durationSeconds: 900 } });
  });

  it("keeps the native 100-cat-food minimum when a custom rate omits the minimum", () => {
    const normalized = normalizeCallLivePayload({ billing_policy: { amount_per_unit: 250 } });
    expect(liveBillingPolicyOrFallback(normalized.billingPolicy)).toMatchObject({
      amountPerUnit: 250,
      minimumStartingBalance: 100,
    });
  });

  it("recognizes all insufficient-balance aliases and clamps the visible grace period", () => {
    expect(isLiveBillingInsufficient({ reason: "INSUFFICIENT-BALANCE" })).toBe(true);
    expect(isLiveBillingInsufficient({ message_code: "payment_failed" })).toBe(false);
    expect(liveTerminationGraceMilliseconds({ termination_grace_ms: 4_200 })).toBe(4_200);
    expect(liveTerminationGraceMilliseconds({ grace_ms: 200 })).toBe(2_600);
  });
});
