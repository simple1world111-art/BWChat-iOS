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

  it("treats an explicit zero unread count as non-presentable", () => {
    expect(
      conversationNotificationRouteIsRead("owner", {
        conversationType: "dm",
        conversationId: "friend",
        unreadCount: 0,
      }),
    ).toBe(true);
  });
});
