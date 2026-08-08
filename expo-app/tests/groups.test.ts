import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  normalizeChatGroup,
  normalizeFollowUser,
  normalizeFollowUsersPage,
  normalizeGroupDetail,
  normalizeGroupMessage,
  normalizeGroupMessagesPage,
} from "@/api/normalizers";
import { reconcileConversationSnapshot } from "@/services/conversations/ConversationRepository";
import {
  applyGroupAnnouncementUpdate,
  applyGroupNotificationSettingsUpdate,
  applyGroupViewerSettingsUpdate,
  effectiveGroupCapabilities,
  groupDetailGeneration,
  loadCachedGroupDetail,
  loadCachedGroupDetailSnapshot,
  removeCachedGroupDetail,
  saveCachedGroupDetail,
  subscribeGroupDetail,
} from "@/services/groups/GroupDetailRepository";
import { readGroupPinned, saveGroupPinned } from "@/services/groups/GroupPreferenceRepository";
import { loadCachedGroups, saveCachedGroups } from "@/services/groups/GroupRepository";
import {
  eligibleGroupMembers,
  mergeUniqueGroupMembers,
  nextFollowPage,
} from "@/services/groups/GroupMemberSource";
import { readChatDraft, saveChatDraft } from "@/services/messages/ChatDraftRepository";
import {
  applyGroupHistoryClear,
  filterClearedGroupMessages,
  readGroupHistoryClearWatermark,
} from "@/services/messages/GroupHistoryClearRepository";

describe("native group-list contract", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("decodes the original flexible group aliases and nested preview content", () => {
    expect(
      normalizeChatGroup({
        groupID: "21",
        name: "周末群",
        avatarURL: "/group.png",
        creatorID: 3,
        memberCount: "5",
        lastMessage: { text: "集合" },
        lastMessageTime: "2026-08-06T10:00:00Z",
        lastMessageSender: "小七",
        unread: "4",
        isPublic: 1,
        isMuted: "false",
      }),
    ).toEqual({
      group_id: 21,
      name: "周末群",
      avatar_url: "/group.png",
      creator_id: "3",
      member_count: 5,
      last_message: "集合",
      last_message_time: "2026-08-06T10:00:00Z",
      last_message_sender: "小七",
      unread_count: 4,
      is_public: true,
      is_muted: false,
    });
  });

  it("keeps the group list isolated by signed-in account", async () => {
    await saveCachedGroups("owner-a", [
      {
        group_id: 21,
        name: "周末群",
        avatar_url: "",
        creator_id: "owner-a",
        member_count: 5,
        unread_count: 0,
        is_public: false,
        is_muted: false,
      },
    ]);
    expect(await loadCachedGroups("owner-a")).toHaveLength(1);
    expect(await loadCachedGroups("owner-b")).toEqual([]);
  });

  it("decodes, recalls and sorts native-flexible group message snapshots", () => {
    const recalled = normalizeGroupMessage({
      messageId: "9",
      groupId: "21",
      fromUserId: 7,
      message_type: "text",
      payload: { text: "已撤回" },
      createdAt: "2026-08-06T10:01:00Z",
      senderNickname: "小七",
      senderAvatar: "/7.png",
      replyTo: { id: 2, sender_id: "8", msg_type: "image", content: "/a.jpg" },
      mentions: [8, 9],
      mentionAll: "true",
      clientId: "client-9",
      historySequence: "19",
      isRecalled: true,
    });
    expect(recalled).toMatchObject({
      id: 9,
      group_id: 21,
      sender_id: "7",
      msg_type: "recalled",
      sender_nickname: "小七",
      reply_to: { id: 2, sender_id: "8", msg_type: "image", content: "/a.jpg" },
      mentions: ["8", "9"],
      mention_all: true,
      client_message_id: "client-9",
      history_sequence: 19,
    });
    expect(
      normalizeGroupMessagesPage({
        hasMore: 1,
        messages: [
          recalled,
          {
            id: 2,
            group_id: 21,
            sender_id: "8",
            content: "先发",
            timestamp: "2026-08-06 10:00:00",
          },
        ],
      }).messages.map((message) => message.id),
    ).toEqual([2, 9]);
  });

  it("separates direct and group drafts even when their numeric IDs match", async () => {
    await saveChatDraft("owner-a", "21", "私聊草稿", "dm");
    await saveChatDraft("owner-a", "21", "群聊草稿", "group");
    expect(await readChatDraft("owner-a", "21", "dm")).toBe("私聊草稿");
    expect(await readChatDraft("owner-a", "21", "group")).toBe("群聊草稿");
  });

  it("decodes native follow-member wrappers and pagination aliases", () => {
    const nested = normalizeFollowUser({
      profile: {
        userID: 7,
        username: "seven",
        name: "小七",
        avatarURL: "/7.png",
        followedByMe: 1,
        followsMe: "true",
        isFriend: true,
      },
    });
    expect(nested).toMatchObject({
      user_id: "7",
      username: "seven",
      nickname: "小七",
      avatar_url: "/7.png",
      followed_by_me: true,
      follows_me: true,
      is_friend: true,
    });
    expect(
      normalizeFollowUsersPage({
        following: [nested],
        page: "2",
        hasMore: 1,
        nextPage: "4",
      }),
    ).toEqual({ users: [nested], has_more: true, next_page: 4 });
  });

  it("keeps only eligible members, excludes self and deduplicates pages", () => {
    const members = [
      normalizeFollowUser({
        user_id: "self",
        nickname: "自己",
        followed_by_me: true,
        follows_me: true,
      }),
      normalizeFollowUser({
        user_id: "mutual",
        nickname: "互关",
        followed_by_me: true,
        follows_me: true,
      }),
      normalizeFollowUser({
        user_id: "one-way",
        nickname: "单向",
        followed_by_me: true,
        follows_me: false,
      }),
    ];
    expect(eligibleGroupMembers("mutual", "self", members).map((member) => member.user_id)).toEqual(
      ["mutual"],
    );
    expect(
      eligibleGroupMembers("followers", "self", members).map((member) => member.user_id),
    ).toEqual(["mutual", "one-way"]);
    expect(mergeUniqueGroupMembers([members[1]!], [members[1]!, members[2]!])).toEqual([
      members[1],
      members[2],
    ]);
    expect(nextFollowPage({ users: [], has_more: true, next_page: 2 }, 2)).toBe(3);
    expect(nextFollowPage({ users: [], has_more: false }, 2)).toBeNull();
  });

  it("decodes the native group-detail core and flexible nested fields", async () => {
    const detail = normalizeGroupDetail({
      group_id: 21,
      name: "周末群",
      avatar_url: "/group.png",
      creator_id: "owner",
      members: [
        { user_id: "owner", nickname: "群主", role: "owner" },
        { user_id: "admin", nickname: "管理员", groupNickname: "小管", role: "admin" },
      ],
      isPublic: 1,
      notificationSettings: {
        groupID: "21",
        isMuted: 1,
        notifyMentionsMe: false,
        notifyMentionsAll: true,
        importantMemberIDs: ["owner", "owner", "admin"],
        revision: "2",
      },
      viewerSettings: { remark: "周末", showMemberNicknames: false, revision: "4" },
      announcement: {
        id: "notice-1",
        groupID: "21",
        title: "规则",
        content: "友好聊天",
        revision: "3",
      },
      currentMember: { user_id: "admin", nickname: "管理员", role: "admin" },
      permissions: {},
      displayName: "服务端群名",
    });
    expect(detail).toMatchObject({
      group_id: 21,
      creator_id: "owner",
      is_public: true,
      notification_settings: {
        group_id: 21,
        muted: true,
        notify_mentions_me: false,
        notify_mentions_all: true,
        important_member_ids: ["owner", "admin"],
        revision: 2,
      },
      viewer_settings: {
        group_id: 21,
        remark: "周末",
        show_member_nicknames: false,
        revision: 4,
      },
      current_member: { user_id: "admin", role: "admin" },
      announcement: {
        announcement_id: "notice-1",
        group_id: 21,
        title: "规则",
        content: "友好聊天",
        revision: 3,
      },
      display_name: "服务端群名",
    });
    expect(effectiveGroupCapabilities(detail, "admin")).toMatchObject({
      can_manage_members: true,
      can_edit_group: true,
      can_change_visibility: false,
      can_dismiss_group: false,
    });
    await saveCachedGroupDetail("owner-a", detail);
    expect(await loadCachedGroupDetail("owner-a", 21)).toEqual(detail);
    expect(await loadCachedGroupDetail("owner-b", 21)).toBeNull();
  });

  it("rejects camel-only or malformed required GroupDetail fields like Swift Decodable", () => {
    expect(() =>
      normalizeGroupDetail({
        groupID: 21,
        name: "周末群",
        avatarURL: "",
        creatorID: "owner",
        members: [],
      }),
    ).toThrow("group_id");
    expect(() =>
      normalizeGroupDetail({
        group_id: 21,
        name: "周末群",
        avatar_url: "",
        creator_id: "owner",
        members: ["invalid-member"],
      }),
    ).toThrow("群成员数据格式无效");
  });

  it("keeps group history clear monotonic and preserves sequence-less optimistic messages", async () => {
    await applyGroupHistoryClear("owner-a", {
      group_id: 21,
      cleared_before_sequence: 10,
      revision: 2,
    });
    const event = await applyGroupHistoryClear("owner-a", {
      group_id: 21,
      cleared_before_sequence: 8,
      revision: 1,
    });
    expect(event.cleared_before_sequence).toBe(10);
    expect(await readGroupHistoryClearWatermark("owner-a", 21)).toBe(10);
    expect(await readGroupHistoryClearWatermark("owner-b", 21)).toBe(-1);
    expect(
      filterClearedGroupMessages(
        [
          normalizeGroupMessage({
            id: 1,
            group_id: 21,
            sender_id: "7",
            content: "旧",
            history_sequence: 9,
          }),
          normalizeGroupMessage({
            id: 2,
            group_id: 21,
            sender_id: "7",
            content: "新",
            history_sequence: 11,
          }),
          normalizeGroupMessage({ id: -1, group_id: 21, sender_id: "7", content: "发送中" }),
        ],
        10,
      ).map((message) => message.id),
    ).toEqual([2, -1]);
  });

  it("keeps GroupInfo revisions monotonic across stale detail loads and realtime writes", async () => {
    const newest = groupDetailWithRevisions("缓存新名称", 8, 9, 10);
    await saveCachedGroupDetail("owner-a", newest);
    const merged = await saveCachedGroupDetail(
      "owner-a",
      groupDetailWithRevisions("服务端新名称", 2, 3, 4),
    );
    expect(merged.name).toBe("服务端新名称");
    expect(merged.notification_settings.revision).toBe(8);
    expect(merged.viewer_settings.revision).toBe(9);
    expect(merged.announcement?.revision).toBe(10);

    await applyGroupNotificationSettingsUpdate("owner-a", {
      ...merged.notification_settings,
      muted: false,
      revision: 7,
    });
    await applyGroupViewerSettingsUpdate("owner-a", {
      ...merged.viewer_settings,
      remark: "旧备注",
      revision: 8,
    });
    await applyGroupAnnouncementUpdate("owner-a", {
      ...merged.announcement!,
      content: "旧公告",
      revision: 9,
    });
    expect(await loadCachedGroupDetail("owner-a", 21)).toMatchObject({
      notification_settings: { muted: true, revision: 8 },
      viewer_settings: { remark: "新备注", revision: 9 },
      announcement: { content: "新公告", revision: 10 },
    });

    await applyGroupNotificationSettingsUpdate("owner-a", {
      ...merged.notification_settings,
      muted: false,
      revision: 11,
    });
    expect(await loadCachedGroupDetail("owner-a", 21)).toMatchObject({
      notification_settings: { muted: false, revision: 11 },
    });
  });

  it("delivers detail cache changes only to subscribers in the same signed-in account", async () => {
    const ownerA = jest.fn();
    const ownerB = jest.fn();
    const unsubscribeA = subscribeGroupDetail("owner-a", ownerA);
    const unsubscribeB = subscribeGroupDetail("owner-b", ownerB);

    await saveCachedGroupDetail("owner-a", groupDetailWithRevisions("甲的群", 1, 1, 1));
    expect(ownerA).toHaveBeenCalledWith(expect.objectContaining({ name: "甲的群" }));
    expect(ownerB).not.toHaveBeenCalled();

    await saveCachedGroupDetail("owner-b", groupDetailWithRevisions("乙的群", 1, 1, 1));
    expect(ownerB).toHaveBeenCalledWith(expect.objectContaining({ name: "乙的群" }));
    expect(ownerA).toHaveBeenCalledTimes(1);

    unsubscribeA();
    unsubscribeB();
  });

  it("persists the native ten-minute profile snapshot and still reads legacy detail JSON", async () => {
    const detail = groupDetailWithRevisions("缓存群", 1, 1, 1);
    await saveCachedGroupDetail("owner-a", detail);
    await expect(loadCachedGroupDetailSnapshot("owner-a", 21)).resolves.toMatchObject({
      detail: { name: "缓存群" },
      isFresh: true,
    });

    await AsyncStorage.setItem("bwchat.group-detail.v1:owner-a:21", JSON.stringify(detail));
    await expect(loadCachedGroupDetailSnapshot("owner-a", 21)).resolves.toMatchObject({
      detail: { name: "缓存群" },
      savedAt: 0,
      isFresh: false,
    });
  });

  it("prevents a request captured before removal from resurrecting the group cache", async () => {
    const staleGeneration = groupDetailGeneration(" owner-a\u200B", 21);
    await removeCachedGroupDetail("owner-a", 21);
    expect(groupDetailGeneration("owner-a", 21)).toBe(staleGeneration + 1);

    await saveCachedGroupDetail(
      "owner-a",
      groupDetailWithRevisions("迟到旧响应", 1, 1, 1),
      staleGeneration,
    );
    expect(await loadCachedGroupDetail("owner-a", 21)).toBeNull();

    await saveCachedGroupDetail("owner-a", groupDetailWithRevisions("重新加入", 2, 2, 2));
    await expect(loadCachedGroupDetail(" owner-a\u200B", 21)).resolves.toMatchObject({
      name: "重新加入",
    });
  });

  it("seeds and updates group pin state through the account conversation snapshot", async () => {
    await reconcileConversationSnapshot("owner-a", {
      conversations: [
        {
          type: "group",
          id: "21",
          name: "周末群",
          avatar_url: "",
          unread_count: 0,
          group_id: 21,
          is_muted: false,
          is_pinned: true,
        },
      ],
      revision: 1,
      snapshot_complete: true,
    });
    expect(await readGroupPinned("owner-a", 21)).toBe(true);
    await saveGroupPinned("owner-a", 21, false);
    expect(await readGroupPinned("owner-a", 21)).toBe(false);
    expect(await readGroupPinned("owner-b", 21)).toBe(false);
  });
});

function groupDetailWithRevisions(
  name: string,
  notificationRevision: number,
  viewerRevision: number,
  announcementRevision: number,
) {
  return normalizeGroupDetail({
    group_id: 21,
    name,
    avatar_url: "",
    creator_id: "owner-a",
    members: [{ user_id: "owner-a", nickname: "群主", role: "owner" }],
    notification_settings: {
      group_id: 21,
      muted: true,
      revision: notificationRevision,
    },
    viewer_settings: {
      group_id: 21,
      remark: "新备注",
      show_member_nicknames: true,
      revision: viewerRevision,
    },
    announcement: {
      announcement_id: "a1",
      group_id: 21,
      title: "规则",
      content: "新公告",
      revision: announcementRevision,
    },
  });
}
