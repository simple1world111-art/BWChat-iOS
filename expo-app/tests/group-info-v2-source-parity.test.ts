import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("GroupInfo v2 source topology", () => {
  it("matches native parent/child flag composition including independent notification settings", () => {
    const detail = source("src/app/group-detail.tsx");
    expect(detail).toContain('featureFlagEnabled(config, "group_info_v2", ownerId, true)');
    for (const flag of [
      "group_invite_qr_v1",
      "group_announcement_v1",
      "group_viewer_settings_v1",
      "group_reporting_v1",
      "group_message_search_v1",
    ]) {
      expect(detail).toContain(`featureFlagEnabled(config, "${flag}", ownerId, false)`);
    }
    expect(detail).toMatch(
      /const notificationSettingsEnabled = featureFlagEnabled\(\s*config,\s*"group_notification_settings_v1",\s*ownerId,\s*false,?\s*\)/u,
    );
    expect(detail).not.toMatch(/const notificationSettingsEnabled =\s*groupInfoV2Enabled/u);
  });

  it("registers and links every native GroupInfo v2 child flow", () => {
    const detail = source("src/app/group-detail.tsx");
    const layout = source("src/app/_layout.tsx");
    for (const route of [
      "group-members",
      "add-group-members",
      "group-text-setting",
      "group-announcement",
      "group-invite",
      "group-invite-preview",
      "group-message-search",
      "group-report",
      "group-notification-settings",
      "group-important-members",
    ]) {
      expect(layout).toContain(`name="${route}"`);
    }
    for (const route of [
      "group-members",
      "add-group-members",
      "group-text-setting",
      "group-announcement",
      "group-invite",
      "group-message-search",
      "group-report",
      "group-notification-settings",
    ]) {
      expect(detail).toContain(`/${route}`);
    }
    expect(source("src/app/group-notification-settings.tsx")).toContain(
      'pathname: "/group-important-members"',
    );
  });

  it("preserves native empty-value text settings and the four-important-member limit", () => {
    const textSetting = source("src/app/group-text-setting.tsx");
    expect(textSetting).toContain('const allowsEmpty = kind !== "name"');
    expect(textSetting).toContain('kind === "remark"');
    expect(textSetting).toContain('kind === "nickname"');
    expect(textSetting).toContain('t("group.textSetting.emptyHint")');
    expect(source("src/app/group-announcement.tsx")).toContain("<Text selectable");
    expect(source("src/services/groups/GroupInfoV2Repository.ts")).toContain(
      "export const groupImportantMemberLimit = 4",
    );
  });

  it("wires native realtime update events to the detail cache and active group screens", () => {
    const realtime = source("src/services/realtime/ChatRealtimeService.ts");
    const detail = source("src/app/group-detail.tsx");
    const chat = source("src/app/group-chat/[id].tsx");
    for (const event of [
      "group_notification_settings_updated",
      "group_viewer_settings_updated",
      "group_announcement_updated",
      "group_member_updated",
      "group_member_profile_updated",
    ]) {
      expect(realtime).toContain(`case "${event}"`);
    }
    expect(detail).toContain("subscribeGroupDetail");
    expect(detail).toContain('event.type === "group_member_updated"');
    expect(chat).toContain("memberRevisionRef");
    expect(chat).toContain("event.update.revision >= memberRevisionRef.current");
  });

  it("keeps the native account lock, profile TTL and strict response envelopes", () => {
    const detail = source("src/app/group-detail.tsx");
    const cache = source("src/services/groups/GroupDetailRepository.ts");
    const api = source("src/services/groups/GroupInfoV2Repository.ts");
    const bwchat = source("src/api/bwchat.ts");
    expect(detail).toContain("loadCachedGroupDetailSnapshot(ownerId, groupId)");
    expect(detail).toContain("cachedSnapshot?.isFresh && !forceRefresh");
    expect(cache).toContain("const profileCacheTtlMilliseconds = 10 * 60 * 1_000");
    expect(cache).toContain("subscription.ownerId === owner");
    expect(cache).toContain("Date.now() - savedAt < profileCacheTtlMilliseconds");
    expect(cache).toContain("repositoryGenerations");
    expect(cache).toContain("writeChains");
    expect(detail).toContain("groupDetailGeneration(ownerId, groupId)");
    expect(api.match(/requiredEnvelope: true/g)).toHaveLength(9);
    expect(bwchat).toMatch(
      /groups\/\$\{groupId\}\/messages\/search[\s\S]*?requiredData: true,[\s\S]*?requiredEnvelope: true,/u,
    );
  });

  it("exposes native controls to accessibility and leaves route titles to localization", () => {
    const detail = source("src/app/group-detail.tsx");
    expect(detail).toContain('accessibilityLabel={t("group.notifications.mute")}');
    expect(detail).toContain('accessibilityLabel={t("group.pin.title")}');
    expect(detail).toContain('accessibilityLabel={t("group.showMemberNicknames")}');
    expect(detail).toContain('accessibilityLabel={t("group.isPublic")}');
    expect(source("src/app/group-important-members.tsx")).toContain('accessibilityRole="checkbox"');
    expect(source("src/app/group-report.tsx")).toContain('accessibilityRole="radio"');
    const layout = source("src/app/_layout.tsx");
    for (const legacyTitle of ["群聊信息", "查找聊天内容", "群公告", "群二维码", "重要群成员"]) {
      expect(layout).not.toContain(`title: "${legacyTitle}"`);
    }
  });
});

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}
