import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Conversation } from "@/models";
import {
  conversationUnreadBadgeText,
  conversationUnreadCountSnapshot,
  conversationUnreadSnapshot,
  publishConversationUnread,
  resetConversationUnreadStoreForTests,
  subscribeConversationUnread,
} from "@/services/conversations/ConversationUnreadStore";

describe("ContactList owner-scoped unread publication", () => {
  beforeEach(() => resetConversationUnreadStoreForTests());

  it("publishes the visible projection total while excluding muted conversations", () => {
    expect(
      publishConversationUnread("owner-a", [
        row({ id: "visible", unread_count: 4 }),
        row({ id: "muted", unread_count: 9, is_muted: true }),
      ]),
    ).toBe(4);
    expect(conversationUnreadSnapshot("owner-a")).toBe(4);
    expect(conversationUnreadBadgeText(4)).toBe("4");
  });

  it("isolates owners so a late old-owner publication cannot overwrite the current badge", () => {
    publishConversationUnread("owner-a", [row({ unread_count: 3 })]);
    publishConversationUnread("owner-b", [row({ unread_count: 7 })]);
    publishConversationUnread("owner-a", [row({ unread_count: 11 })]);
    expect(conversationUnreadSnapshot("owner-b")).toBe(7);
  });

  it("publishes each conversation count for group rows even when the aggregate excludes muted rows", () => {
    publishConversationUnread("owner-a", [
      row({ id: "friend-a", unread_count: 2 }),
      row({ type: "group", id: "group-17", group_id: 17, unread_count: 7, is_muted: true }),
    ]);

    expect(conversationUnreadCountSnapshot("owner-a", "dm:friend-a")).toBe(2);
    expect(conversationUnreadCountSnapshot("owner-a", "group:17")).toBe(7);
    expect(conversationUnreadCountSnapshot("owner-a", "group:missing")).toBeUndefined();
    expect(conversationUnreadSnapshot("owner-a")).toBe(2);
  });

  it("clears the visible badge on logout and caps large counts at 99+", () => {
    publishConversationUnread("owner-a", [row({ unread_count: 120 })]);
    expect(conversationUnreadBadgeText(conversationUnreadSnapshot("owner-a"))).toBe("99+");
    expect(conversationUnreadSnapshot("")).toBe(0);
    expect(conversationUnreadBadgeText(conversationUnreadSnapshot(""))).toBeNull();
  });

  it("notifies subscribers only when an owner's aggregate changes", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeConversationUnread(listener);
    publishConversationUnread("owner-a", [row({ unread_count: 2 })]);
    publishConversationUnread("owner-a", [row({ unread_count: 2 })]);
    publishConversationUnread("owner-a", [row({ unread_count: 3 })]);
    unsubscribe();
    publishConversationUnread("owner-a", [row({ unread_count: 4 })]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("connects the page projection to the owner-scoped Messages native-tab badge", () => {
    const root = resolve(__dirname, "..");
    const page = readFileSync(resolve(root, "src/app/(tabs)/conversations.tsx"), "utf8");
    const layout = readFileSync(resolve(root, "src/app/(tabs)/_layout.tsx"), "utf8");
    expect(page).toContain("publishConversationUnread(ownerId, localProjection)");
    expect(layout).toContain('useConversationUnread(user?.user_id ?? "")');
    expect(layout).toContain("nativeTabBadgeText(descriptor, messagesUnread, momentsUnread)");
    expect(layout).toContain('name === "messages"');
    expect(layout).toContain("return conversationUnreadBadgeText(messagesUnread)");
    expect(layout).toContain("<NativeTabs.Trigger.Badge>{badge}</NativeTabs.Trigger.Badge>");
  });
});

function row(overrides: Partial<Conversation> = {}): Conversation {
  return {
    type: "dm",
    id: "friend",
    name: "Friend",
    avatar_url: "",
    unread_count: 0,
    is_muted: false,
    ...overrides,
  };
}
