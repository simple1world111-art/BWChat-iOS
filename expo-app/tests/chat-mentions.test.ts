import AsyncStorage from "@react-native-async-storage/async-storage";

import { sendGroupTextMessage } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import type { GroupMember, GroupMessage } from "@/models";
import {
  readChatDraftSnapshot,
  saveChatDraftSnapshot,
} from "@/services/messages/ChatDraftRepository";
import {
  applyChatMentionEdit,
  deriveChatTextEdit,
  insertChatMentions,
  isStandaloneAtInsertion,
  mentionedUserIds,
  mentionsAll,
  normalizeMentionMembers,
} from "@/services/messages/chatMentionPolicy";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
const request = jest.mocked(apiRequest);

describe("native group @ mention contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("inserts direct/all tokens in order and tracks UTF-16 ranges without the separator", () => {
    const result = insertChatMentions(
      [
        { kind: "all", nickname: "所有人" },
        { kind: "direct", user_id: "u1", nickname: "猫🐱" },
      ],
      { location: 0, length: 1 },
      { text: "@hello", mentions: [] },
      { location: 1, length: 0 },
    );
    expect(result.document.text).toBe("@所有人 @猫🐱 hello");
    expect(result.document.mentions).toEqual([
      { kind: "all", location_utf16: 0, length_utf16: 4 },
      { kind: "direct", user_id: "u1", location_utf16: 5, length_utf16: 4 },
    ]);
    expect(result.selectedRange).toEqual({ location: 10, length: 0 });
    expect(mentionedUserIds(result.document)).toEqual(["u1"]);
    expect(mentionsAll(result.document)).toBe(true);
  });

  it("deletes a whole mention atom when editing its text or trailing separator", () => {
    const document = {
      text: "hi @Alice there",
      mentions: [{ kind: "direct" as const, user_id: "u1", location_utf16: 3, length_utf16: 6 }],
    };
    expect(applyChatMentionEdit({ location: 5, length: 1 }, "", document)).toEqual({
      document: { text: "hi  there", mentions: [] },
      selectedRange: { location: 3, length: 0 },
      handledAtomically: true,
    });
    expect(applyChatMentionEdit({ location: 9, length: 1 }, "", document)).toEqual({
      document: { text: "hi there", mentions: [] },
      selectedRange: { location: 3, length: 0 },
      handledAtomically: true,
    });
  });

  it("shifts untouched spans for edits before them and keeps edits after them", () => {
    const document = {
      text: "x @Bob z",
      mentions: [{ kind: "direct" as const, user_id: "b", location_utf16: 2, length_utf16: 4 }],
    };
    expect(
      applyChatMentionEdit({ location: 0, length: 0 }, "12", document).document.mentions[0]
        ?.location_utf16,
    ).toBe(4);
    expect(
      applyChatMentionEdit({ location: 8, length: 0 }, "!", document).document.mentions[0]
        ?.location_utf16,
    ).toBe(2);
  });

  it("opens the picker only for standalone @ and derives RN text edits in UTF-16", () => {
    expect(isStandaloneAtInsertion("", { location: 0, length: 0 }, "@")).toBe(true);
    expect(isStandaloneAtInsertion("hello ", { location: 6, length: 0 }, "@")).toBe(true);
    expect(isStandaloneAtInsertion("mail", { location: 4, length: 0 }, "@")).toBe(false);
    expect(deriveChatTextEdit("A🐱C", "A🐱@C")).toEqual({
      range: { location: 3, length: 0 },
      replacementText: "@",
    });
  });

  it("deduplicates, excludes self and prefers useful member fields", () => {
    const members: GroupMember[] = [
      member({ user_id: "self", nickname: "Me" }),
      member({ user_id: "u1", nickname: "", avatar_url: "" }),
      member({ user_id: "u1", nickname: "Alice", avatar_url: "/a.jpg", role: "admin" }),
      member({ user_id: "u2", nickname: "bob" }),
    ];
    expect(normalizeMentionMembers(members, "self")).toEqual([
      member({ user_id: "u1", nickname: "Alice", avatar_url: "/a.jpg", role: "admin" }),
      member({ user_id: "u2", nickname: "bob" }),
    ]);
  });

  it("persists mention spans with group drafts and rejects invalid ranges", async () => {
    await saveChatDraftSnapshot(
      "owner",
      "7",
      {
        text: "@Alice hi",
        mentions: [{ kind: "direct", user_id: "u1", location_utf16: 0, length_utf16: 6 }],
      },
      "group",
    );
    expect(await readChatDraftSnapshot("owner", "7", "group")).toEqual({
      text: "@Alice hi",
      mentions: [{ kind: "direct", user_id: "u1", location_utf16: 0, length_utf16: 6 }],
    });
    await AsyncStorage.setItem(
      "bwchat.chat-draft.v1:owner:group:8",
      JSON.stringify({
        version: 1,
        text: "hi",
        mentions: [{ kind: "direct", user_id: "u1", location_utf16: 0, length_utf16: 9 }],
      }),
    );
    expect(await readChatDraftSnapshot("owner", "8", "group")).toEqual({ text: "hi" });
  });

  it("sends the exact group mentions and mention_all wire fields", async () => {
    request.mockResolvedValueOnce(groupMessage({ mentions: ["u1", "u2"], mention_all: true }));
    await sendGroupTextMessage(7, "@所有人 @Alice hi", {
      clientMessageId: "client-1",
      replyToId: 3,
      mentions: ["u2", "u1"],
      mentionAll: true,
    });
    expect(request).toHaveBeenCalledWith("/groups/7/messages/text", {
      method: "POST",
      requiredData: true,
      requiredEnvelope: true,
      body: {
        content: "@所有人 @Alice hi",
        reply_to_id: 3,
        mentions: ["u2", "u1"],
        mention_all: true,
        client_message_id: "client-1",
      },
    });
  });
});

function member(overrides: Partial<GroupMember>): GroupMember {
  return { user_id: "u", nickname: "User", avatar_url: "", role: "member", ...overrides };
}

function groupMessage(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    id: 1,
    group_id: 7,
    sender_id: "me",
    msg_type: "text",
    content: "hello",
    timestamp: "2026-08-06T10:00:00Z",
    sender_nickname: "Me",
    sender_avatar: "",
    mention_all: false,
    version: 1,
    ...overrides,
  };
}
