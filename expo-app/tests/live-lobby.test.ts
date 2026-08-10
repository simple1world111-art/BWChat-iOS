import {
  acquireLiveLobbyUpdate,
  effectiveLiveCallTypes,
  isVisibleLiveSlot,
  LiveLobbyEventCursor,
  liveAvailability,
  liveBillingFullRule,
  liveParticipant,
  mergeLiveSlotSnapshot,
  normalizeLiveBillingPolicy,
  normalizeCallJoin,
  normalizeCurrentLiveSlot,
  normalizeLiveCallInvitation,
  normalizeLiveCallState,
  normalizeLiveLobbySlotEvent,
  normalizeLiveSlotPage,
  reconcileCurrentLiveSlot,
  releaseLiveLobbyUpdate,
  sortLiveSlots,
} from "@/services/live/LiveLobbyModels";

describe("one-to-one live lobby models", () => {
  it("renders the native billing wording for minute and non-minute policies", () => {
    expect(
      liveBillingFullRule({
        currency: "spendable_balance",
        freeSeconds: 10,
        unitSeconds: 60,
        amountPerUnit: 100,
        minimumStartingBalance: 100,
        rounding: "started_unit",
      }),
    ).toBe("前 10 秒免费，之后每开始 1 分钟收取 100 可消费余额");
    expect(
      liveBillingFullRule({
        currency: "spendable_balance",
        freeSeconds: 8,
        unitSeconds: 30,
        amountPerUnit: 50,
        minimumStartingBalance: 50,
        rounding: "started_unit",
      }),
    ).toBe("前 8 秒免费，之后每开始 30 秒收取 50 可消费余额");
  });

  it("decodes real/legacy page aliases, host user, billing, gender and call capabilities", () => {
    const page = normalizeLiveSlotPage({
      slots: [
        {
          id: 81,
          status: "waiting",
          character_setting: "Detective",
          live_avatar_url: "/live.jpg",
          allowed_call_types: ["video", "audio", "video"],
          host: {
            user_id: 9,
            username: "alice",
            nickname: "Alice",
            avatar_url: "/a.jpg",
            gender: "female",
          },
        },
      ],
      next_cursor: "next",
      billing_policy: {
        free_seconds: "12",
        unit_seconds: 60,
        amount_per_unit: "120",
        minimum_starting_balance: 240,
      },
      supported_call_types: ["video", "voice"],
      live_avatar_upload_supported: "YES",
    });
    expect(page).toMatchObject({
      nextCursor: "next",
      supportedCallTypes: ["voice", "video"],
      liveAvatarUploadSupported: true,
      billingPolicy: {
        freeSeconds: 12,
        unitSeconds: 60,
        amountPerUnit: 120,
        minimumStartingBalance: 240,
      },
      items: [
        {
          id: "81",
          allowedCallTypes: ["voice", "video"],
          user: { userId: "9", nickname: "Alice" },
        },
      ],
    });
    expect(liveParticipant(page.items[0]!, "9", true)).toMatchObject({
      displayName: "Alice",
      avatarUrl: "/live.jpg",
      gender: "female",
      availability: "available",
      hasChatted: true,
      isCurrentUser: true,
    });
  });

  it("maps every native availability alias and hides ended slots", () => {
    expect(["waiting", "available", "idle"].map(liveAvailability)).toEqual([
      "available",
      "available",
      "available",
    ]);
    expect(["pending", "mystery", "connecting", "closed"].map(liveAvailability)).toEqual([
      "inviting",
      "unknown",
      "busy",
      "ended",
    ]);
    expect(isVisibleLiveSlot(slot("ended", "ended"))).toBe(false);
  });

  it("sorts available first while retaining server order inside each rank", () => {
    const sorted = sortLiveSlots([
      slot("busy-1", "in_call"),
      slot("free-1", "waiting"),
      slot("unknown", "new"),
      slot("free-2", "idle"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["free-1", "free-2", "unknown", "busy-1"]);
  });

  it("keeps WebSocket mutations that arrived after a snapshot request started", () => {
    const snapshot = [slot("stable", "waiting"), slot("changed", "waiting", "old-user")];
    const current = [slot("changed", "busy", "new-user")];
    const merged = mergeLiveSlotSnapshot(snapshot, current, new Map([["changed", 4]]), 3);
    expect(merged.map((item) => [item.id, item.status, item.user.userId])).toEqual([
      ["stable", "waiting", "user-stable"],
      ["changed", "busy", "new-user"],
    ]);
  });

  it("normalizes call-state phases and stable call type order", () => {
    expect(
      normalizeLiveCallState({ call_id: "c", slot_id: "s", status: "in-call", call_type: "audio" }),
    ).toMatchObject({
      callId: "c",
      slotId: "s",
      status: "in_call",
      phase: "accepted",
      callType: "voice",
    });
    expect(normalizeLiveCallState({ call_id: "c", status: "expired" }).phase).toBe("terminal");
    expect(
      normalizeLiveCallState({
        call_id: "c",
        status: "ended",
        end_reason: "billing_insufficient",
        termination_grace_ms: "3200",
        final_billing: {
          charged_activity_cat_food: "20",
          charged_gold_coins: 80,
          total_charged: 100,
          spendable_balance_after: 4,
          billing_status: "billing_insufficient",
        },
      }),
    ).toMatchObject({
      endReason: "billing_insufficient",
      terminationGraceMilliseconds: 3200,
      finalBilling: {
        chargedActivityCatFood: 20,
        chargedGoldCoins: 80,
        totalCharged: 100,
        spendableBalanceAfter: 4,
        billingStatus: "billing_insufficient",
      },
    });
    expect(effectiveLiveCallTypes(["video", "voice"], ["video"])).toEqual(["video"]);
  });

  it("normalizes the server-confirmed reserved experience on an invitation", () => {
    expect(
      normalizeLiveCallInvitation({
        call_id: "call-experience",
        call_type: "video",
        live_experience: {
          prop_definition_id: "live_experience_card_5m",
          duration_seconds: 300,
          status: "reserved",
          auto_continue_payment_method: "spendable_balance",
          host_earning_enabled: false,
          reserved_prop: {
            inventory_id: "inventory-live-5m",
            definition_id: "live_experience_card_5m",
            remaining_quantity: 1,
          },
        },
      }),
    ).toMatchObject({
      callId: "call-experience",
      liveExperience: {
        definitionId: "live_experience_card_5m",
        durationSeconds: 300,
        status: "reserved",
        autoContinuePaymentMethod: "spendable_balance",
        reservedProp: {
          inventory_id: "inventory-live-5m",
          definition_id: "live_experience_card_5m",
          remaining_quantity: 1,
        },
      },
    });
  });

  it("matches native pending phases instead of joining while the call is only connecting", () => {
    expect(normalizeLiveCallState({ call_id: "c", status: "connecting" }).phase).toBe("pending");
    expect(normalizeLiveCallState({ call_id: "c", status: "connected" }).phase).toBe("pending");
    expect(normalizeLiveCallState({ call_id: "c", status: "closed" }).phase).toBe("pending");
    expect(normalizeLiveCallState({ call_id: "c", status: "failed" }).phase).toBe("pending");
  });

  it("preserves the native billing minimum fallback when a custom rate omits it", () => {
    expect(normalizeLiveBillingPolicy({ amount_per_unit: "1,250" })).toMatchObject({
      amountPerUnit: 1_250,
      minimumStartingBalance: 100,
    });
  });

  it("sanitizes every unsafe billing-policy field like the native initializer", () => {
    expect(
      normalizeLiveBillingPolicy({
        currency: "",
        free_seconds: -1,
        unit_seconds: 0,
        amount_per_unit: -8,
        minimum_starting_balance: 0,
        rounding: "",
      }),
    ).toEqual({
      currency: "spendable_balance",
      freeSeconds: 0,
      unitSeconds: 60,
      amountPerUnit: 100,
      minimumStartingBalance: 100,
      rounding: "started_unit",
    });
  });

  it("uses the native LiveKit fallback when the join payload omits a server URL", () => {
    expect(normalizeCallJoin({ room_name: "room", token: "token" }).livekit_url).toBe(
      "http://52.193.78.191/livekit",
    );
  });

  it("decodes the complete native call lifecycle and final-billing payload", () => {
    expect(
      normalizeLiveCallState({
        call_id: "c",
        status: "ended",
        accepted_at: "2026-08-08T01:00:00Z",
        ended_at: "2026-08-08T01:05:00Z",
        server_time: "2026-08-08T01:05:01Z",
        live_experience: { definition_id: "live_experience_card_5m" },
        final_billing: {
          charged_units: "2",
          charged_activity_cat_food: 20,
          charged_gold_coins: "80",
          total_charged: 100,
          earned_activity_cat_food: 20,
          earned_gold_coins: 80,
          experience_seconds_used: "300",
          overage_units: 2,
          consumed_prop: {
            inventory_id: "inventory-1",
            definition_id: "live_experience_card_5m",
            remaining_quantity: "3",
          },
        },
      }),
    ).toMatchObject({
      acceptedAt: "2026-08-08T01:00:00Z",
      endedAt: "2026-08-08T01:05:00Z",
      serverTime: "2026-08-08T01:05:01Z",
      liveExperience: { server_time: "2026-08-08T01:05:01Z" },
      finalBilling: {
        chargedUnits: 2,
        chargedActivityCatFood: 20,
        chargedGoldCoins: 80,
        totalCharged: 100,
        earnedActivityCatFood: 20,
        earnedGoldCoins: 80,
        experienceSecondsUsed: 300,
        overageUnits: 2,
        consumedProp: {
          inventory_id: "inventory-1",
          definition_id: "live_experience_card_5m",
          remaining_quantity: 3,
        },
      },
    });
    expect(() =>
      normalizeLiveCallState({
        call_id: "c",
        final_billing: { charged_activity_cat_food: 20, charged_gold_coins: 80, total_charged: 99 },
      }),
    ).toThrow("Live total_charged");
    expect(() =>
      normalizeLiveCallState({
        call_id: "c",
        final_billing: { spendable_balance_after: -1 },
      }),
    ).toThrow("non-negative");
  });

  it("normalizes root-level live slot event aliases used by the native cursor", () => {
    expect(
      normalizeLiveLobbySlotEvent({
        event_id: 8,
        slot_id: "slot-8",
        status: "CLOSED",
        host_id: "host-8",
        occurred_at: "2026-08-08T01:02:03.456Z",
        slot: {
          character_setting: "Detective",
          host: { nickname: "Alice" },
        },
      }),
    ).toMatchObject({
      eventId: "8",
      slotId: "slot-8",
      userId: "host-8",
      status: "closed",
      slot: { id: "slot-8", characterSetting: "Detective" },
    });
  });

  it("decodes nested realtime upserts and identifier-only ended tombstones", () => {
    expect(
      normalizeLiveLobbySlotEvent({
        event_id: "evt-slot-1",
        slot: {
          id: "slot-1",
          status: "waiting",
          character_setting: "雨夜电台主播",
          user: { user_id: "host-1", nickname: "喵喵" },
        },
      }),
    ).toMatchObject({
      eventId: "evt-slot-1",
      slotId: "slot-1",
      userId: "host-1",
      status: "waiting",
      slot: { characterSetting: "雨夜电台主播" },
    });
    expect(
      normalizeLiveLobbySlotEvent({
        slot_id: "slot-ended",
        host_user_id: "host-ended",
        status: "ended",
      }),
    ).toEqual({
      slotId: "slot-ended",
      userId: "host-ended",
      status: "ended",
      slot: null,
    });
  });

  it("remembers stale event IDs so a replay cannot mutate state later", () => {
    const cursor = new LiveLobbyEventCursor();
    expect(
      cursor.shouldApply({ slot: null, eventId: "new", slotId: "slot", occurredAt: 200 }),
    ).toBe(true);
    expect(
      cursor.shouldApply({ slot: null, eventId: "new", slotId: "slot", occurredAt: 200 }),
    ).toBe(false);
    expect(
      cursor.shouldApply({ slot: null, eventId: "stale", slotId: "slot", occurredAt: 100 }),
    ).toBe(false);
    expect(cursor.shouldApply({ slot: null, eventId: "stale", slotId: "another" })).toBe(false);
    expect(
      cursor.shouldApply({ slot: null, eventId: "newer", slotId: "slot", occurredAt: 300 }),
    ).toBe(true);
  });

  it("prevents stale REST snapshots from restoring ended slots and keeps newer own slots", () => {
    const ended = slot("ended", "waiting", "ended-user");
    expect(mergeLiveSlotSnapshot([ended], [], new Map([["ended", 2]]), 1)).toEqual([]);

    const staleOwn = { ...slot("own", "waiting", "me"), characterSetting: "old" };
    const currentOwn = { ...slot("own", "waiting", "me"), characterSetting: "new" };
    const other = slot("other", "waiting", "other");
    expect(
      mergeLiveSlotSnapshot([staleOwn, other], [currentOwn], new Map([["own", 3]]), 2),
    ).toEqual([other, currentOwn]);
  });

  it("decodes direct, nested, and empty current-slot envelopes", () => {
    const own = slot("own", "waiting", "me");
    expect(normalizeCurrentLiveSlot(own)).toEqual(own);
    expect(normalizeCurrentLiveSlot({ slot: { ...own, status: "in_call" } })).toMatchObject({
      id: "own",
      status: "in_call",
    });
    expect(normalizeCurrentLiveSlot({ slot: null })).toBeNull();
  });

  it("matches native current-slot fallback for unsupported and transient endpoints", () => {
    const own = slot("own", "waiting", "me");
    const previous = slot("previous", "busy", "me");
    expect(reconcileCurrentLiveSlot({ kind: "failure" }, null, [own], "me")).toBe(own);
    expect(reconcileCurrentLiveSlot({ kind: "failure" }, previous, [own], "me")).toBe(previous);
    expect(reconcileCurrentLiveSlot({ kind: "unsupported" }, null, [own], "me")).toBe(own);
    expect(
      reconcileCurrentLiveSlot(
        { kind: "value", slot: slot("ended", "ended", "me") },
        previous,
        [own],
        "me",
      ),
    ).toBeNull();
  });

  it("single-flights start/stop mutations before React can rerender", () => {
    const lock = { current: false };
    expect(acquireLiveLobbyUpdate(lock)).toBe(true);
    expect(acquireLiveLobbyUpdate(lock)).toBe(false);
    releaseLiveLobbyUpdate(lock);
    expect(acquireLiveLobbyUpdate(lock)).toBe(true);
  });
});

function slot(id: string, status: string, userId = `user-${id}`) {
  return {
    id,
    status,
    characterSetting: "Role",
    liveAvatarUrl: "",
    user: { userId, username: userId, nickname: userId, avatarUrl: "", gender: "" },
  };
}
