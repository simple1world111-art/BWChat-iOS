import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  createScriptRoom,
  endScriptRoom,
  getGroupMessages,
  getScriptRoom,
  markGroupMessagesRead,
  retryScriptTurn,
  submitScriptTurn,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  normalizeGroupMessage,
  normalizeScriptRoom,
  normalizeScriptRoomEnvelope,
  normalizeScriptTurnResponse,
  normalizeScriptTurnState,
} from "@/api/normalizers";
import type { Conversation, GroupMessage, ScriptRoom } from "@/models";
import { parseChatRealtimeEnvelope } from "@/services/realtime/ChatRealtimeService";
import {
  loadCachedScriptMessages,
  loadCachedScriptRoom,
  saveCachedScriptMessages,
  saveCachedScriptRoom,
  scriptRoomCacheKey,
} from "@/services/scripts/ScriptRoomRepository";
import {
  clearPendingScriptRoomConversation,
  pendingScriptRoomConversation,
  rememberScriptRoomConversation,
} from "@/services/scripts/ScriptRoomNavigationStore";
import {
  canSendScriptTurn,
  cappedScriptInput,
  isCompleteScriptRoom,
  isCurrentScriptPlayer,
  mergeCachedScriptMessages,
  mergeScriptMessages,
  provisionalScriptRoom,
  scriptMessageAvatar,
  scriptRoomMetrics,
  scriptTurnContent,
} from "@/services/scripts/scriptRoomPolicy";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);

describe("native ScriptRoomChatView contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("keeps the source roster, story, timeline, bubble and composer geometry", () => {
    expect(scriptRoomMetrics).toMatchObject({
      rosterGap: 10,
      rosterHorizontalInset: 14,
      rosterVerticalInset: 8,
      rosterRoleWidth: 52,
      rosterAvatarSize: 40,
      rosterBadgeSize: 12,
      rosterBadgeStroke: 1.5,
      timelineGap: 13,
      timelineHorizontalInset: 14,
      timelineVerticalInset: 14,
      storyCoverWidth: 96,
      storyCoverHeight: 72,
      storyCoverRadius: 12,
      storyInset: 12,
      storyRadius: 14,
      inputRadius: 18,
      inputMaximumCharacters: 1_000,
      sendSize: 38,
      messageSideSpacer: 52,
      messageAvatarSize: 32,
      messageRadius: 16,
      toastMilliseconds: 3_000,
      scrollDelayMilliseconds: 50,
      scrollAnimationMilliseconds: 200,
    });
  });

  it("normalizes room aliases and preserves the script context on group messages", () => {
    const room = normalizeScriptRoom({
      id: "room-1",
      script_id: "script-1",
      group_id: "42",
      player_role_id: "hero",
      assignments: [{ role_id: "hero", actor_type: "user", user_id: "me" }],
      snapshot: {
        title: "夜航",
        intro: "雾中的航班",
        cover: "/cover.jpg",
        characters: [{ id: "hero", name: "机长", avatar: "/hero.jpg", public_description: "冷静" }],
      },
    });
    expect(room).toMatchObject({
      room_id: "room-1",
      group_id: 42,
      status: "active",
      script_snapshot: { title: "夜航", synopsis: "雾中的航班" },
    });
    expect(room.script_snapshot.roles[0]).toMatchObject({
      role_id: "hero",
      name: "机长",
      description: "冷静",
    });
    expect(
      normalizeGroupMessage({
        id: 7,
        group_id: 42,
        sender_id: "script-role:hero",
        content: "继续下降。",
        script_context: { room_id: "room-1", role_id: "hero", actor_type: "ai", turn_id: "turn-1" },
      }).script_context,
    ).toEqual({
      room_id: "room-1",
      role_id: "hero",
      actor_type: "ai",
      turn_id: "turn-1",
    });
  });

  it("matches the native room, assignment, snapshot and envelope decoder exactly", () => {
    const nested = completeRoom();
    expect(normalizeScriptRoomEnvelope({ room: nested })).toEqual(nested);
    expect(
      normalizeScriptRoomEnvelope({
        ...completeRoom(),
        room_id: "direct-room",
        room: { ...nested, room_id: "nested-room" },
      }).room_id,
    ).toBe("direct-room");
    expect(
      normalizeScriptRoomEnvelope({
        room_id: "broken-direct",
        room: { ...nested, room_id: "nested-room" },
      }).room_id,
    ).toBe("nested-room");

    const decoded = normalizeScriptRoom({
      id: 17,
      script_id: 23,
      group_id: " 42",
      status: "ENDED",
      player_role_id: 5,
      assignments: ["invalid", { role_id: "hero", actor_type: "user" }],
      snapshot: {
        title: 8,
        coverURL: "/ignored-camel.jpg",
        roles: ["invalid"],
        characters: [{ role_id: "hero", name: "主角" }],
      },
    });
    expect(decoded).toMatchObject({
      room_id: "17",
      script_id: "23",
      group_id: 0,
      status: "active",
      player_role_id: "5",
      assignments: [],
      script_snapshot: { title: "8", cover_url: "", roles: [{ role_id: "hero" }] },
    });
    expect(() => normalizeScriptRoom({ room_id: "room-without-snapshot" })).toThrow("快照格式无效");
    expect(() => normalizeScriptRoomEnvelope({ room_id: "", snapshot: {} })).toThrow("缺少 room");

    const assignment = normalizeScriptRoom({
      room_id: "room-1",
      snapshot: {},
      assignments: [{ role_id: 7, actor_type: "USER", user_id: "" }],
    }).assignments[0];
    expect(assignment).toEqual({ role_id: "7", actor_type: "ai", user_id: "" });
  });

  it("matches native turn fallbacks and rejects partial script message contexts", () => {
    expect(
      normalizeScriptTurnResponse({
        turnID: "ignored",
        status: "COMPLETED",
        userMessage: message(1, 42),
      }),
    ).toEqual({ turn_id: "", status: "queued" });
    expect(
      normalizeScriptTurnState({
        room_id: 9,
        turn_id: 10,
        status: "generating",
        error_code: "",
        message: "",
      }),
    ).toEqual({
      room_id: "9",
      turn_id: "10",
      status: "generating",
      error_code: "",
      message: "",
    });
    expect(
      normalizeGroupMessage({
        id: 8,
        group_id: 42,
        script_context: { room_id: "room-1", role_id: "hero", actor_type: "ai" },
      }).script_context,
    ).toBeUndefined();
    expect(
      normalizeGroupMessage({
        id: 9,
        group_id: 42,
        scriptContext: {
          roomID: "room-1",
          roleID: "hero",
          actorType: "ai",
          turnID: "turn-1",
        },
      }).script_context,
    ).toBeUndefined();
    expect(
      normalizeGroupMessage({
        id: 10,
        group_id: 42,
        content: "",
        payload: "must-not-replace-empty-content",
        sender_nickname: "  原样昵称  ",
        script_context: { room_id: "bad" },
        scriptContext: {
          room_id: "room-1",
          role_id: "hero",
          actor_type: "ai",
          turn_id: "turn-1",
        },
      }),
    ).toMatchObject({
      content: "",
      sender_nickname: "  原样昵称  ",
      script_context: {
        room_id: "room-1",
        role_id: "hero",
        actor_type: "ai",
        turn_id: "turn-1",
      },
    });
  });

  it("builds a non-authoritative provisional room and follows the original send gate", () => {
    const row: Conversation = {
      type: "group",
      id: "42",
      group_id: 42,
      name: "夜航",
      avatar_url: "/cover.jpg",
      unread_count: 0,
      is_muted: false,
      conversation_kind: "script_room",
      script_room_id: "room-1",
      script_id: "script-1",
    };
    const provisional = provisionalScriptRoom(row);
    expect(provisional).toMatchObject({ room_id: "room-1", group_id: 42 });
    expect(isCompleteScriptRoom(provisional)).toBe(false);
    expect(
      provisionalScriptRoom({
        ...row,
        id: "group:-5",
        group_id: -5,
        script_room_id: " room-raw ",
        script_id: " script-raw ",
      }),
    ).toMatchObject({ room_id: " room-raw ", script_id: " script-raw ", group_id: -5 });
    expect(provisionalScriptRoom({ ...row, type: "dm" })).toBeNull();
    expect(
      canSendScriptTurn({
        room: provisional,
        hasAuthoritativeRoom: false,
        isGenerating: false,
        text: "推进剧情",
      }),
    ).toBe(false);
    expect(
      canSendScriptTurn({
        room: { ...provisional!, player_role_id: "hero" },
        hasAuthoritativeRoom: true,
        isGenerating: false,
        text: " 推进剧情 ",
      }),
    ).toBe(true);
    expect(cappedScriptInput("😀".repeat(1_001))).toHaveLength(2_000);
    expect(Array.from(cappedScriptInput("😀".repeat(1_001)))).toHaveLength(1_000);
    expect(cappedScriptInput("👨‍👩‍👧‍👦".repeat(1_001))).toBe("👨‍👩‍👧‍👦".repeat(1_000));
    expect(scriptTurnContent("\u0085 推进剧情 \u2029")).toBe("推进剧情");
    expect(
      canSendScriptTurn({
        room: { ...provisional!, player_role_id: "hero" },
        hasAuthoritativeRoom: true,
        isGenerating: false,
        text: "\u0085\u2029",
      }),
    ).toBe(false);
  });

  it("isolates the provisional navigation handoff by account", () => {
    const row: Conversation = {
      type: "group",
      id: "42",
      group_id: 42,
      name: "夜航",
      avatar_url: "/cover.jpg",
      unread_count: 0,
      is_muted: false,
      conversation_kind: "script_room",
      script_room_id: "room-1",
    };
    rememberScriptRoomConversation(row, "owner-a");
    expect(pendingScriptRoomConversation("room-1", "owner-b")).toBeNull();
    expect(pendingScriptRoomConversation("room-1", "owner-a")).toBe(row);
    clearPendingScriptRoomConversation("room-1", "owner-b");
    expect(pendingScriptRoomConversation("room-1", "owner-a")).toBe(row);
    clearPendingScriptRoomConversation("room-1", "owner-a");
    expect(pendingScriptRoomConversation("room-1", "owner-a")).toBeNull();
  });

  it("keeps the full runtime timeline while capping only the persistent cache", () => {
    const original = Array.from({ length: 102 }, (_, index) => message(index + 1, 42));
    const merged = mergeScriptMessages(
      original,
      [{ ...message(101, 42), content: "updated" }, message(999, 7), message(0, 42)],
      42,
    );
    expect(merged).toHaveLength(104);
    expect(merged[0]?.id).toBe(0);
    expect(merged.find(({ id }) => id === 101)).toMatchObject({ content: "updated" });
    expect(merged.at(-1)?.id).toBe(999);
    const cached = mergeCachedScriptMessages(original, [], 42);
    expect(cached).toHaveLength(100);
    expect(cached[0]?.id).toBe(3);
    expect(mergeCachedScriptMessages([], [message(999, 7)], 42)).toEqual([]);
  });

  it("resolves player identity and script avatar precedence exactly", () => {
    const role = {
      role_id: "hero",
      name: "机长",
      gender: "unspecified",
      avatar_url: "/role.jpg",
      description: "",
      sort_order: 0,
    };
    const ai = {
      ...message(1, 42),
      sender_id: "script-role:hero",
      sender_avatar: "/sender.jpg",
      script_context: {
        room_id: "room-1",
        role_id: "hero",
        actor_type: "ai" as const,
        turn_id: "turn-1",
      },
    };
    const player = { ...ai, script_context: { ...ai.script_context, actor_type: "user" as const } };
    expect(isCurrentScriptPlayer(ai, "me")).toBe(false);
    expect(isCurrentScriptPlayer(player, "someone-else")).toBe(true);
    expect(scriptMessageAvatar(ai, role, false)).toBe("/sender.jpg");
    expect(scriptMessageAvatar(player, role, true)).toBe("/role.jpg");
    expect(scriptMessageAvatar(message(2, 42), role, false)).toBeNull();
  });

  it("uses the account-scoped 5-minute room cache and 365-day retention", async () => {
    const now = Date.UTC(2026, 7, 7);
    const room = completeRoom();
    await saveCachedScriptRoom("owner-a", room, now);
    expect(scriptRoomCacheKey("owner-a", "room-1")).toBe(
      "bwchat.script-room-v1:account:owner-a:room:room-1",
    );
    expect((await loadCachedScriptRoom("owner-a", "room-1", now + 299_999))?.isStale).toBe(false);
    expect((await loadCachedScriptRoom("owner-a", "room-1", now + 300_000))?.isStale).toBe(true);
    expect(await loadCachedScriptRoom("owner-b", "room-1", now)).toBeNull();
    expect(
      await loadCachedScriptRoom(
        "owner-a",
        "room-1",
        now +
          scriptRoomMetrics.roomTtlMilliseconds +
          scriptRoomMetrics.roomStaleRetentionMilliseconds +
          1,
      ),
    ).toBeNull();

    await saveCachedScriptMessages("owner-a", 42, [message(1, 42)]);
    await saveCachedScriptMessages("owner-b", 42, [message(2, 42)]);
    expect((await loadCachedScriptMessages("owner-a", 42)).map(({ id }) => id)).toEqual([1]);
    expect((await loadCachedScriptMessages("owner-b", 42)).map(({ id }) => id)).toEqual([2]);

    await Promise.all([
      saveCachedScriptMessages("owner-c", 42, [], [message(3, 42)]),
      saveCachedScriptMessages("owner-c", 42, [], [message(4, 42)]),
    ]);
    expect((await loadCachedScriptMessages("owner-c", 42)).map(({ id }) => id)).toEqual([3, 4]);
    await saveCachedScriptMessages("owner-a", -5, [message(5, -5)]);
    expect((await loadCachedScriptMessages("owner-a", -5)).map(({ id }) => id)).toEqual([5]);
  });

  it("parses script turn websocket state and uses all four native room routes", async () => {
    expect(
      parseChatRealtimeEnvelope(
        JSON.stringify({
          type: "script_turn_state",
          data: {
            room_id: "room-1",
            turn_id: "turn-1",
            status: "failed",
            error_code: "MODEL",
            message: "稍后重试",
          },
        }),
      ),
    ).toEqual([
      {
        type: "script_turn_state",
        state: {
          room_id: "room-1",
          turn_id: "turn-1",
          status: "failed",
          error_code: "MODEL",
          message: "稍后重试",
        },
      },
    ]);
    expect(
      parseChatRealtimeEnvelope({
        type: "script_turn_state",
        room_id: "room-1",
        turn_id: "turn-1",
        status: "completed",
      }),
    ).toEqual([]);
    expect(
      parseChatRealtimeEnvelope({
        type: "SCRIPT-TURN-STATE",
        data: { room_id: "room-1", turn_id: "turn-1", status: "completed" },
      }),
    ).toEqual([]);

    request
      .mockResolvedValueOnce({ room: completeRoom() })
      .mockResolvedValueOnce({ turn_id: "turn-1", status: "queued" })
      .mockResolvedValueOnce({ turn_id: "turn-1", status: "generating" })
      .mockResolvedValueOnce(null);
    await getScriptRoom("room/1");
    await submitScriptTurn("room/1", "继续", "client-1");
    await retryScriptTurn("room/1", "turn/1");
    await endScriptRoom("room/1");
    expect(request.mock.calls).toEqual([
      ["/script-rooms/room%2F1", { requiredData: true, requiredEnvelope: true }],
      [
        "/script-rooms/room%2F1/turns",
        {
          method: "POST",
          body: { content: "继续", client_message_id: "client-1" },
          requiredData: true,
          requiredEnvelope: true,
        },
      ],
      [
        "/script-rooms/room%2F1/turns/turn%2F1/retry",
        {
          method: "POST",
          body: {},
          requiredData: true,
          requiredEnvelope: true,
        },
      ],
      [
        "/script-rooms/room%2F1/end",
        {
          method: "POST",
          body: {},
          requiredEnvelope: true,
        },
      ],
    ]);
  });

  it("requires the native room member for creation and preserves its idempotency contract", async () => {
    request.mockResolvedValueOnce(completeRoom()).mockResolvedValueOnce({ room: completeRoom() });
    await expect(createScriptRoom("script/1", "role/1", "idem-1")).rejects.toThrow("缺少 room");
    await expect(createScriptRoom("script/1", "role/1", "idem-2")).resolves.toMatchObject({
      room: { room_id: "room-1" },
    });
    expect(request.mock.calls).toEqual([
      [
        "/scripts/script%2F1/rooms",
        {
          method: "POST",
          headers: { "Idempotency-Key": "idem-1" },
          body: { player_role_id: "role/1" },
          requiredData: true,
          requiredEnvelope: true,
        },
      ],
      [
        "/scripts/script%2F1/rooms",
        {
          method: "POST",
          headers: { "Idempotency-Key": "idem-2" },
          body: { player_role_id: "role/1" },
          requiredData: true,
          requiredEnvelope: true,
        },
      ],
    ]);
  });

  it("uses strict native envelopes for room history and read acknowledgements", async () => {
    request
      .mockResolvedValueOnce({ messages: [message(8, 42)], has_more: false })
      .mockResolvedValueOnce(null);
    await expect(getGroupMessages(42, { afterId: 7, limit: 100 })).resolves.toMatchObject({
      messages: [{ id: 8 }],
      hasMore: false,
    });
    await expect(
      markGroupMessagesRead(42, {
        throughMessageId: 8,
        idempotencyKey: "read-1",
      }),
    ).resolves.toBeNull();
    expect(request.mock.calls).toEqual([
      [
        "/groups/42/messages?after_id=7&limit=100",
        {
          requiredData: true,
          requiredEnvelope: true,
        },
      ],
      [
        "/groups/42/messages/read",
        {
          method: "POST",
          requiredEnvelope: true,
          body: { idempotency_key: "read-1", through_message_id: 8 },
        },
      ],
    ]);
  });

  it("requires the native messages and has_more fields for room history", async () => {
    request
      .mockResolvedValueOnce({ messages: [] })
      .mockResolvedValueOnce({ messages: [], has_more: 0 });
    await expect(getGroupMessages(42)).rejects.toThrow("群消息列表响应格式无效");
    await expect(getGroupMessages(42)).rejects.toThrow("群消息列表响应格式无效");
  });
});

function message(id: number, groupId: number): GroupMessage {
  return {
    id,
    group_id: groupId,
    sender_id: "user-1",
    msg_type: "text",
    content: `message-${id}`,
    timestamp: `2026-08-07T00:00:${String(id % 60).padStart(2, "0")}Z`,
    sender_nickname: "朋友",
    sender_avatar: "",
    mention_all: false,
    version: 1,
  };
}

function completeRoom(): ScriptRoom {
  return {
    room_id: "room-1",
    script_id: "script-1",
    group_id: 42,
    status: "active",
    player_role_id: "hero",
    assignments: [{ role_id: "hero", actor_type: "user", user_id: "owner-a" }],
    script_snapshot: {
      title: "夜航",
      synopsis: "雾中的航班",
      cover_url: "/cover.jpg",
      roles: [
        {
          role_id: "hero",
          name: "机长",
          gender: "unspecified",
          avatar_url: "/hero.jpg",
          description: "",
          sort_order: 0,
        },
      ],
    },
  };
}
