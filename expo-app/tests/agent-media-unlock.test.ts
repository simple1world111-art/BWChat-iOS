import { apiRequest } from "@/api/client";
import { unlockAgentMedia } from "@/api/bwchat";
import { normalizeAgentMediaUnlock } from "@/api/normalizers";
import type { AgentMediaUnlock, AgentMessage, WalletBalanceSnapshot } from "@/models";
import {
  agentPaidMediaDisplayStatus,
  agentMediaUnlockDefinition,
  applyAgentMediaUnlockToMessages,
  isAgentMediaUnlocked,
  settleAgentMediaUnlock,
} from "@/services/props/AgentMediaUnlockState";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
const request = jest.mocked(apiRequest);

describe("agent paid-media prop parity", () => {
  beforeEach(() => request.mockReset());

  it("uses the exact native endpoint, payment bodies, idempotency, and no POST retry", async () => {
    request.mockResolvedValue({ already_unlocked: true, content_url: "/content", download_url: "/download" });
    await unlockAgentMedia("media/a", { type: "automatic", mediaType: "video" }, "key-auto");
    await unlockAgentMedia("media/b", { type: "prop_card", mediaType: "image" }, "key-card");
    await unlockAgentMedia("media/c", { type: "spendable_balance" }, "key-balance");
    expect(request.mock.calls).toEqual([
      ["/agent-media/media%2Fa/unlock", {
        method: "POST",
        headers: { "Idempotency-Key": "key-auto" },
        body: { payment_method: "auto", prop_definition_id: "media_unlock_card_video" },
        requiredData: true,
        transientRetries: false,
      }],
      ["/agent-media/media%2Fb/unlock", {
        method: "POST",
        headers: { "Idempotency-Key": "key-card" },
        body: { payment_method: "prop_card", prop_definition_id: "media_unlock_card_image" },
        requiredData: true,
        transientRetries: false,
      }],
      ["/agent-media/media%2Fc/unlock", {
        method: "POST",
        headers: { "Idempotency-Key": "key-balance" },
        body: {},
        requiredData: true,
        transientRetries: false,
      }],
    ]);
    expect(agentMediaUnlockDefinition("image")).toBe("media_unlock_card_image");
  });

  it("writes mixed charge and consumed-prop receipts without unnecessary refreshes", () => {
    const result = unlockResult();
    expect(settleAgentMediaUnlock(result)).toEqual({
      balance: result.charge?.wallet_balance,
      consumption: {
        inventoryId: "inventory-1",
        definitionId: "media_unlock_card_image",
        remainingQuantity: 1,
      },
      refreshBalance: false,
      refreshInventory: false,
    });
  });

  it("normalizes the complete mixed-charge and prop receipt response envelope", () => {
    expect(normalizeAgentMediaUnlock({
      charged_activity_cat_food: 2,
      charged_gold_coins: 3,
      total_charged: 5,
      wallet_balance: {
        currency: "gold_coin",
        gold_coin_balance: 3,
        activity_cat_food_balance: 2,
        spendable_balance: 5,
        recharge_gold_coin_balance: 3,
        gift_income_gold_coin_balance: 0,
        withdraw_frozen_gold_coin_balance: 0,
        withdrawable_gold_coin_balance: 0,
        chat_money_frozen_gold_coin_balance: 0,
      },
      already_unlocked: false,
      content_url: "/content",
      download_url: "/download",
      consumed_prop: {
        inventory_id: "inventory-1",
        definition_id: "media_unlock_card_image",
        remaining_quantity: 1,
      },
    })).toEqual(unlockResult());
  });

  it("force-refreshes both stores when a changed unlock omits receipts", () => {
    expect(settleAgentMediaUnlock({
      already_unlocked: false,
      content_url: "/content",
      download_url: "/download",
    })).toEqual({ refreshBalance: true, refreshInventory: true });
    expect(settleAgentMediaUnlock({
      already_unlocked: true,
      content_url: "/content",
      download_url: "/download",
    })).toEqual({ refreshBalance: false, refreshInventory: false });
  });

  it("updates only matching message parts and recognizes the authoritative unlocked state", () => {
    const messages = [message("media-1"), message("media-2")];
    const updated = applyAgentMediaUnlockToMessages(messages, "media-1", unlockResult());
    expect(updated[0]?.parts[0]?.metadata).toMatchObject({
      access: "unlocked",
      content_url: "/content",
      download_url: "/download",
    });
    expect(updated[1]?.parts[0]?.metadata.access).toBe("locked");
    expect(isAgentMediaUnlocked(updated, "media-1")).toBe(true);
    expect(isAgentMediaUnlocked(updated, "missing")).toBe(false);
    expect(isAgentMediaUnlocked([{
      ...updated[0]!,
      parts: [{ ...updated[0]!.parts[0]!, type: "input_image" }],
    }], "media-1")).toBe(false);
    expect(agentPaidMediaDisplayStatus("completed", "locked")).toBe("ready_locked");
    expect(agentPaidMediaDisplayStatus("processing", "locked")).toBe("generating");
    expect(agentPaidMediaDisplayStatus(undefined, undefined)).toBe("queued");
  });
});

function unlockResult(): AgentMediaUnlock {
  return {
    charge: {
      charged_activity_cat_food: 2,
      charged_gold_coins: 3,
      total_charged: 5,
      wallet_balance: balance(),
    },
    already_unlocked: false,
    content_url: "/content",
    download_url: "/download",
    consumed_prop: {
      inventory_id: "inventory-1",
      definition_id: "media_unlock_card_image",
      remaining_quantity: 1,
    },
  };
}

function balance(): WalletBalanceSnapshot {
  return {
    currency: "gold_coin",
    gold_coin_balance: 3,
    activity_cat_food_balance: 2,
    spendable_balance: 5,
    recharge_gold_coin_balance: 3,
    gift_income_gold_coin_balance: 0,
    withdraw_frozen_gold_coin_balance: 0,
    withdrawable_gold_coin_balance: 0,
    chat_money_frozen_gold_coin_balance: 0,
  };
}

function message(mediaId: string): AgentMessage {
  return {
    id: `message-${mediaId}`,
    conversation_id: "conversation",
    sequence_no: 1,
    sender: { type: "agent", id: "agent" },
    source: "agent",
    status: "completed",
    created_at: "",
    updated_at: "",
    parts: [{
      id: `part-${mediaId}`,
      ordinal: 0,
      type: "paid_media",
      text: "",
      reference_id: mediaId,
      metadata: { media_type: "image", access: "locked", generation_status: "ready" },
    }],
  };
}
