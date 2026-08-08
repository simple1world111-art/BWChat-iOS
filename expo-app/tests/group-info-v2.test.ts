import { APIError, apiRequest } from "@/api/client";
import {
  acceptGroupInvite,
  createGroupInvite,
  getGroupInvitePreview,
  getGroupNotificationSettings,
  normalizeGroupAnnouncement,
  normalizeGroupMemberUpdateEvent,
  normalizeGroupNotificationSettings,
  reportGroup,
  revokeGroupInvite,
  shouldAlertGroupNotification,
  updateGroupAnnouncement,
  updateGroupNotificationSettings,
  updateGroupViewerSettings,
  updateMyGroupNickname,
} from "@/services/groups/GroupInfoV2Repository";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, apiRequest: jest.fn() };
});
jest.mock("@/api/bwchat", () => ({ createIdempotencyKey: () => "fixed-idempotency-key" }));

const request = jest.mocked(apiRequest);

describe("GroupInfo v2 native API parity", () => {
  beforeEach(() => request.mockReset());

  it("normalizes notification aliases, deduplicates IDs and enforces the native four-member limit", () => {
    expect(
      normalizeGroupNotificationSettings({
        groupID: "21",
        isMuted: 1,
        notifyMentionsMe: 0,
        notifyMentionsAll: true,
        importantMemberIDs: [" 7 ", "7", "8", "9", "10", "11"],
        revision: "4",
        updatedAt: "now",
      }),
    ).toEqual({
      group_id: 21,
      muted: true,
      notify_mentions_me: false,
      notify_mentions_all: true,
      important_member_ids: ["7", "8", "9", "10"],
      revision: 4,
      updated_at: "now",
    });
  });

  it("uses no-store GET and exact partial PATCH notification contracts", async () => {
    request
      .mockResolvedValueOnce({ group_id: 21, muted: false })
      .mockResolvedValueOnce({ group_id: 21, muted: true, important_member_ids: ["7"] });

    await getGroupNotificationSettings(21);
    await updateGroupNotificationSettings(21, { muted: true, importantMemberIds: ["7"] });

    expect(request).toHaveBeenNthCalledWith(1, "/groups/21/notification-settings", {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/groups/21/notification-settings", {
      method: "PATCH",
      body: { muted: true, important_member_ids: ["7"] },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
  });

  it("maps malformed direct group-info payloads to the native decoding error", async () => {
    request.mockResolvedValueOnce([]).mockResolvedValueOnce({ group_id: "21", already_member: 1 });
    await expect(getGroupNotificationSettings(21)).rejects.toEqual(
      expect.objectContaining<Partial<APIError>>({ code: "decoding_error" }),
    );
    await expect(acceptGroupInvite("token")).rejects.toEqual(
      expect.objectContaining<Partial<APIError>>({ code: "decoding_error" }),
    );
  });

  it("falls back to the same native GET behavior for empty settings updates", async () => {
    request
      .mockResolvedValueOnce({ group_id: 21, muted: false })
      .mockResolvedValueOnce({ group_id: 21, remark: "原备注" });
    await updateGroupNotificationSettings(21, {});
    await updateGroupViewerSettings(21, {}, async () => ({
      group_id: 21,
      remark: "原备注",
      show_member_nicknames: true,
      revision: 0,
    }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/groups/21/notification-settings", {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("uses exact viewer, nickname and announcement mutation contracts without POST retries", async () => {
    request
      .mockResolvedValueOnce({ group_id: 21, remark: "周末", revision: 3 })
      .mockResolvedValueOnce({ user_id: "7", nickname: "小七", group_nickname: "七七" })
      .mockResolvedValueOnce({ group_id: 21, title: "规则", content: "友好聊天" });

    await updateGroupViewerSettings(
      21,
      { remark: "周末", showMemberNicknames: false },
      async () => {
        throw new Error("不应回退");
      },
    );
    await updateMyGroupNickname(21, "七七");
    await updateGroupAnnouncement(21, "规则", "友好聊天");

    expect(request).toHaveBeenNthCalledWith(1, "/groups/21/viewer-settings", {
      method: "PATCH",
      body: { remark: "周末", show_member_nicknames: false },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/groups/21/members/me", {
      method: "PATCH",
      body: { nickname: "七七" },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(3, "/groups/21/announcement", {
      method: "PUT",
      body: { title: "规则", content: "友好聊天" },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
  });

  it("matches create, revoke, preview and accept invite paths including escaping and idempotency", async () => {
    request
      .mockResolvedValueOnce({ invite_id: "i/1", group_id: 21, invite_url: "bwchat://invite" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ group_id: 21, name: "周末群", can_join: true })
      .mockResolvedValueOnce({ group_id: 21, already_member: false });

    await createGroupInvite(21);
    await revokeGroupInvite(21, "i/1");
    await getGroupInvitePreview("t/1");
    await acceptGroupInvite("t/1");

    expect(request).toHaveBeenNthCalledWith(1, "/groups/21/invites", {
      method: "POST",
      body: { expires_in_days: 7 },
      headers: { "Idempotency-Key": "fixed-idempotency-key" },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/groups/21/invites/i%2F1", {
      method: "DELETE",
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(3, "/group-invites/t%2F1", {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(4, "/group-invites/t%2F1/accept", {
      method: "POST",
      body: {},
      headers: { "Idempotency-Key": "fixed-idempotency-key" },
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
  });

  it("submits the exact report body and omits blank optional detail", async () => {
    request.mockResolvedValue(undefined);
    await reportGroup(21, "spam", "  证据  ");
    await reportGroup(21, "fraud", "   ");
    expect(request).toHaveBeenNthCalledWith(1, "/groups/21/reports", {
      method: "POST",
      body: { reason: "spam", detail: "  证据  " },
      headers: { "Idempotency-Key": "fixed-idempotency-key" },
      requiredEnvelope: true,
      transientRetries: false,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/groups/21/reports", {
      method: "POST",
      body: { reason: "fraud" },
      headers: { "Idempotency-Key": "fixed-idempotency-key" },
      requiredEnvelope: true,
      transientRetries: false,
    });
  });

  it("matches the native muted notification exception state machine", () => {
    const settings = normalizeGroupNotificationSettings({
      group_id: 21,
      muted: true,
      notify_mentions_me: true,
      notify_mentions_all: false,
      important_member_ids: ["7"],
    });
    expect(
      shouldAlertGroupNotification(settings, {
        senderId: "8",
        isDirectMention: false,
        isMentionAll: false,
      }),
    ).toBe(false);
    expect(
      shouldAlertGroupNotification(settings, {
        senderId: "8",
        isDirectMention: true,
        isMentionAll: false,
      }),
    ).toBe(true);
    expect(
      shouldAlertGroupNotification(settings, {
        senderId: "7",
        isDirectMention: false,
        isMentionAll: false,
      }),
    ).toBe(true);
  });

  it("normalizes the exact native announcement keys", () => {
    expect(
      normalizeGroupAnnouncement({
        id: "a-1",
        group_id: "21",
        title: "规则",
        content: "友好聊天",
        updated_by_id: 7,
        updated_by_nickname: "群主",
        revision: "-3",
        updated_at: "now",
      }),
    ).toEqual({
      announcement_id: "a-1",
      group_id: 21,
      title: "规则",
      content: "友好聊天",
      updated_by_id: "7",
      updated_by_nickname: "群主",
      revision: -3,
      updated_at: "now",
    });
  });

  it("normalizes the exact native member update envelope", () => {
    expect(
      normalizeGroupMemberUpdateEvent({
        group_id: 21,
        member: { user_id: 7, nickname: "小七", groupNickname: "七七", role: "member" },
        revision: 9,
      }),
    ).toEqual({
      group_id: 21,
      member: {
        user_id: "7",
        nickname: "小七",
        avatar_url: "",
        role: "member",
        group_nickname: "七七",
      },
      revision: 9,
    });
  });
});
