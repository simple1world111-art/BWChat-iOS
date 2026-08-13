import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  conversationNotificationRouteIsRead,
  hydrateAndCheckConversationNotificationRead,
  recordConversationNotificationRead,
  resetConversationNotificationReadStateForTests,
} from "@/services/conversations/ConversationNotificationReadState";
import { reconcileConversationSnapshot } from "@/services/conversations/ConversationRepository";

describe("conversation notification read state", () => {
  beforeEach(async () => {
    resetConversationNotificationReadStateForTests();
    await AsyncStorage.clear();
  });

  it("matches a delayed DM push by sender alias and suppresses only covered message ids", () => {
    recordConversationNotificationRead("owner", "dm", "friend", 42);
    const route = {
      conversationType: "dm" as const,
      conversationId: "server-thread-id",
      senderId: "friend",
      messageId: 42,
    };

    expect(conversationNotificationRouteIsRead("owner", route)).toBe(true);
    expect(conversationNotificationRouteIsRead("owner", { ...route, messageId: 43 })).toBe(false);
    expect(conversationNotificationRouteIsRead("other-owner", route)).toBe(false);
  });

  it("hydrates persisted read watermarks after a restart", async () => {
    await reconcileConversationSnapshot("owner", {
      conversations: [
        {
          type: "group",
          id: "group-7",
          group_id: 7,
          name: "Study",
          avatar_url: "",
          unread_count: 0,
          is_muted: false,
          last_message_id: 51,
          read_through_message_id: 51,
        },
      ],
      snapshot_complete: true,
    });

    await expect(
      hydrateAndCheckConversationNotificationRead("owner", {
        conversationType: "group",
        conversationId: "7",
        groupId: 7,
        messageId: 51,
      }),
    ).resolves.toBe(true);
    await expect(
      hydrateAndCheckConversationNotificationRead("owner", {
        conversationType: "group",
        conversationId: "7",
        groupId: 7,
        messageId: 52,
      }),
    ).resolves.toBe(false);
  });

  it("refreshes a newer persisted watermark after the first hydration", async () => {
    await reconcileConversationSnapshot("owner", {
      conversations: [
        {
          type: "dm",
          id: "friend",
          name: "Friend",
          avatar_url: "",
          unread_count: 1,
          is_muted: false,
          last_message_id: 51,
          read_through_message_id: 40,
        },
      ],
      snapshot_complete: true,
      revision: 1,
    });
    await expect(
      hydrateAndCheckConversationNotificationRead("owner", {
        conversationType: "dm",
        conversationId: "friend",
        messageId: 51,
      }),
    ).resolves.toBe(false);

    await reconcileConversationSnapshot("owner", {
      conversations: [
        {
          type: "dm",
          id: "friend",
          name: "Friend",
          avatar_url: "",
          unread_count: 0,
          is_muted: false,
          last_message_id: 51,
          read_through_message_id: 51,
        },
      ],
      snapshot_complete: true,
      revision: 2,
    });
    await expect(
      hydrateAndCheckConversationNotificationRead("owner", {
        conversationType: "dm",
        conversationId: "friend",
        messageId: 51,
      }),
    ).resolves.toBe(true);
  });

  it("treats an explicit zero unread count as non-presentable", () => {
    expect(
      conversationNotificationRouteIsRead("owner", {
        conversationType: "dm",
        conversationId: "friend",
        unreadCount: 0,
      }),
    ).toBe(true);
  });

  it("uses agent sequence watermarks without leaking them across conversations", () => {
    recordConversationNotificationRead("owner", "agent", "thread-1", 9);
    expect(
      conversationNotificationRouteIsRead("owner", {
        conversationType: "agent",
        conversationId: "legacy-thread",
        agentConversationId: "thread-1",
        messageSequence: 9,
      }),
    ).toBe(true);
    expect(
      conversationNotificationRouteIsRead("owner", {
        conversationType: "agent",
        conversationId: "thread-2",
        messageSequence: 9,
      }),
    ).toBe(false);
  });

  it("prefers stable message ids for dm, group and script read watermarks", () => {
    recordConversationNotificationRead("owner", "dm", "friend", 12);
    recordConversationNotificationRead("owner", "group", "7", 12);
    recordConversationNotificationRead("owner", "script", "room-1", 12);

    for (const route of [
      { conversationType: "dm" as const, conversationId: "friend" },
      { conversationType: "group" as const, conversationId: "7", groupId: 7 },
      {
        conversationType: "script",
        conversationId: "room-1",
        scriptRoomId: "room-1",
      } as const,
    ]) {
      expect(
        conversationNotificationRouteIsRead("owner", {
          ...route,
          messageId: 13,
          messageSequence: 12,
        }),
      ).toBe(false);
      expect(
        conversationNotificationRouteIsRead("owner", {
          ...route,
          messageId: 12,
          messageSequence: 99,
        }),
      ).toBe(true);
    }
  });

  it("matches a script push against its underlying group read watermark", () => {
    recordConversationNotificationRead("owner", "group", "7", 42);
    expect(
      conversationNotificationRouteIsRead("owner", {
        conversationType: "script",
        conversationId: "room-1",
        scriptRoomId: "room-1",
        groupId: 7,
        messageId: 42,
      }),
    ).toBe(true);
  });
});
