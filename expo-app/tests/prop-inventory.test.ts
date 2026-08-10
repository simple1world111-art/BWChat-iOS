import AsyncStorage from "@react-native-async-storage/async-storage";

import { apiRequest } from "@/api/client";
import { getPropBag } from "@/services/props/PropInventoryRepository";
import {
  applyPropConsumption,
  canConsumeMediaUnlock,
  canConsumeLiveExperience,
  liveExperienceCardKind,
  liveExperienceDefinition,
  liveExperienceDuration,
  liveExperienceKinds,
  liveExperienceMinutes,
  liveExperienceReservation,
  mediaUnlockDefinition,
  normalizePropConsumption,
  normalizePropBagPage,
  propBagSummary,
  propLiveExperienceKind,
  propMediaUnlockKind,
} from "@/services/props/PropInventoryModels";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
const request = jest.mocked(apiRequest);

describe("prop inventory parity", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("uses the native prop-bag endpoint without an HTTP cache", async () => {
    request.mockResolvedValue({ data: { items: [] } });
    await expect(getPropBag()).resolves.toMatchObject({ items: [], summary: { totalQuantity: 0 } });
    expect(request).toHaveBeenCalledWith("/me/prop-bag", { cache: "no-store" });
  });

  it("restores an account-scoped persisted page when revalidation fails", async () => {
    request
      .mockResolvedValueOnce({ data: { items: [item("cached", "live_experience_card_5m", 2)] } })
      .mockRejectedValueOnce(new Error("offline"));

    await expect(getPropBag("owner", true)).resolves.toMatchObject({ items: [{ inventoryId: "cached" }] });
    await expect(getPropBag("owner", true)).resolves.toMatchObject({ items: [{ inventoryId: "cached" }] });
  });

  it("filters retired and empty props while accepting snake/camel aliases", () => {
    const page = normalizePropBagPage({ data: { items: [
      item("i5", "live_experience_card_5m", 2, { duration_seconds: 300 }),
      { inventoryId: "i10", definitionId: "legacy-live", type: "live_experience_card", quantity: "3", availableActions: ["consume_for_live_experience"], metadata: { durationSeconds: 600 } },
      item("retired", "game_entry_card", 8),
      item("empty", "media_unlock_card_image", 0),
    ] } });
    expect(page.items.map((value) => [value.inventoryId, value.quantity, propLiveExperienceKind(value)])).toEqual([
      ["i5", 2, "5m"],
      ["i10", 3, "10m"],
    ]);
    expect(page.items.every(canConsumeLiveExperience)).toBe(true);
    expect(page.summary).toEqual({ totalQuantity: 5, equippedCount: 0, expiringCount: 0 });
  });

  it("keeps all three native live-card definitions, minutes, and durations stable", () => {
    expect(liveExperienceKinds.map((kind) => ({
      kind,
      definition: liveExperienceDefinition(kind),
      minutes: liveExperienceMinutes(kind),
      duration: liveExperienceDuration(kind),
    }))).toEqual([
      { kind: "5m", definition: "live_experience_card_5m", minutes: 5, duration: 300 },
      { kind: "10m", definition: "live_experience_card_10m", minutes: 10, duration: 600 },
      { kind: "15m", definition: "live_experience_card_15m", minutes: 15, duration: 900 },
    ]);
  });

  it("applies the server reservation by inventory id and falls back to one eligible card", () => {
    const items = normalizePropBagPage({ items: [item("a", "live_experience_card_10m", 2), item("b", "live_experience_card_10m", 1)] }).items;
    expect(applyPropConsumption(items, { inventoryId: "b", definitionId: "live_experience_card_10m", remainingQuantity: 0 }, "live_experience_card_10m", "consume_for_live_experience").map((value) => [value.inventoryId, value.quantity])).toEqual([["a", 2]]);
    expect(applyPropConsumption(items, { inventoryId: "stale", definitionId: "live_experience_card_10m", remainingQuantity: 1 }, "live_experience_card_10m", "consume_for_live_experience").map((value) => [value.inventoryId, value.quantity])).toEqual([["a", 1], ["b", 1]]);
    expect(applyPropConsumption(items, undefined, "live_experience_card_10m", "consume_for_live_experience").map((value) => [value.inventoryId, value.quantity])).toEqual([["a", 1], ["b", 1]]);
  });

  it("normalizes a complete consumption receipt and rejects a receipt without a definition", () => {
    expect(normalizePropConsumption({
      inventory_id: "one",
      definition_id: "media_unlock_card_image",
      remaining_quantity: "2",
    })).toEqual({
      inventoryId: "one",
      definitionId: "media_unlock_card_image",
      remainingQuantity: 2,
    });
    expect(normalizePropConsumption({ remaining_quantity: 2 })).toBeUndefined();
  });

  it("decodes experience kind and reserved prop from a call snapshot", () => {
    const snapshot = { definition_id: "live_experience_card_15m", duration_seconds: 900, reserved_prop: { inventory_id: "p", definition_id: "live_experience_card_15m", remaining_quantity: 4 } };
    expect(liveExperienceCardKind(snapshot)).toBe("15m");
    expect(liveExperienceReservation(snapshot)).toEqual({ inventoryId: "p", definitionId: "live_experience_card_15m", remainingQuantity: 4 });
  });

  it("counts only props expiring in the next seven days", () => {
    const now = Date.parse("2026-08-07T00:00:00Z");
    const items = normalizePropBagPage({ items: [
      { ...item("soon", "live_experience_card_5m", 1), expires_at: "2026-08-10T00:00:00Z", is_equipped: true },
      { ...item("later", "live_experience_card_10m", 1), expires_at: "2026-08-20T00:00:00Z" },
      { ...item("past", "live_experience_card_15m", 1), expires_at: "2026-08-01T00:00:00Z" },
    ] }).items;
    expect(propBagSummary(items, now)).toEqual({ totalQuantity: 3, equippedCount: 1, expiringCount: 1 });
  });

  it("matches native media-card definitions, eligibility, and consumption receipts", () => {
    const media = normalizePropBagPage({ items: [{
      inventory_id: "image",
      definition_id: "media_unlock_card_image",
      type: "media_unlock_card",
      quantity: 2,
      available_actions: ["consume_for_media_unlock"],
      metadata: { media_type: "image" },
    }] }).items;
    expect(mediaUnlockDefinition("video")).toBe("media_unlock_card_video");
    expect(propMediaUnlockKind(media[0]!)).toBe("image");
    expect(canConsumeMediaUnlock(media[0]!)).toBe(true);
    expect(applyPropConsumption(media, {
      inventoryId: "image",
      definitionId: "media_unlock_card_image",
      remainingQuantity: 1,
    }, mediaUnlockDefinition("image"), "consume_for_media_unlock")[0]?.quantity).toBe(1);
  });
});

function item(inventoryId: string, definitionId: string, quantity: number, metadata: Record<string, unknown> = {}) {
  return {
    inventory_id: inventoryId,
    definition_id: definitionId,
    type: "live_experience_card",
    quantity,
    available_actions: ["consume_for_live_experience"],
    metadata,
  };
}
