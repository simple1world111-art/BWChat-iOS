import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const copiedNativeRoot = resolve(expoRoot, "..");
const originalNativeRoot = resolve(expoRoot, "..");

describe("GroupDetailView source parity", () => {
  it("locks every copied Swift source used by the group-detail contract", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/GroupDetailView.swift":
        "3a4a012ba50f60e099e1f3c36d98f9950104dfb8c3fdb954e08f0fd0ef38dfb4",
      "BWChat/Models/Group.swift":
        "9cc71d2d874002629302dd14f06183bd80cb396f7bfcdd3fbf5838b549bee792",
      "BWChat/Services/APIService.swift":
        "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
      "BWChat/Services/CacheRepository.swift":
        "570ed9486b10b8b55ddd6136c04c11a1390a287a14563492c640a6a2f144e117",
      "BWChat/Components/AvatarView.swift":
        "a3c6f6de8c1ffc38cc07dfd0d9495a60830e18cf69864392f7cf7529f46bff92",
    };
    for (const [relativePath, expectedHash] of Object.entries(hashes)) {
      const copied = resolve(copiedNativeRoot, relativePath);
      expect(sha256(copied)).toBe(expectedHash);
      const original = resolve(originalNativeRoot, relativePath);
      if (existsSync(original)) expect(sha256(original)).toBe(expectedHash);
    }
  });

  it("preserves the native member preview and information-row geometry", () => {
    const native = copiedNative("BWChat/Views/GroupDetailView.swift");
    const page = expo("src/app/group-detail.tsx");
    for (const contract of [
      "UIScreen.main.bounds.width <= 375 ? 5 : 6",
      "columnCount * 3 - (canManageMembers ? 1 : 0)",
      "GridItem(.flexible(), spacing: 8)",
      "spacing: 14",
      ".padding(.horizontal, 16)",
      ".padding(.top, 18)",
      "VStack(spacing: 10)",
      "size: 48",
      ".padding(.vertical, 12)",
      ".frame(maxWidth: 190, alignment: .trailing)",
      ".environment(\\.defaultMinListRowHeight, 54)",
    ]) {
      expect(native).toContain(contract);
    }
    expect(page).toContain("const columns = width <= 375 ? 5 : 6");
    expect(page).toContain("const capacity = columns * 3 - (canManage ? 1 : 0)");
    expect(page).toContain("size={48}");
    expect(page).toContain("marginBottom: 10");
    expect(page).toContain("paddingHorizontal: 16");
    expect(page).toContain("paddingTop: 18");
    expect(page).toContain("rowGap: 14");
    expect(page).toContain("minHeight: 54");
    expect(page).toContain("maxWidth: 190");
    expect(page).toContain("rowSubtitle: { color: colors.secondaryText, fontSize: 15 }");
    expect(page).toContain('headerBackButtonDisplayMode: "minimal"');
  });

  it("locks every native group-detail route, method, envelope and raw query/body rule", () => {
    const native = copiedNative("BWChat/Services/APIService.swift");
    const bwchat = expo("src/api/bwchat.ts");
    const groupInfo = expo("src/services/groups/GroupInfoV2Repository.ts");
    for (const path of [
      "/groups/\\(groupID)",
      "/groups/\\(groupID)/rename",
      "/groups/\\(groupID)/visibility",
      "/groups/\\(groupID)/members/add",
      "/groups/\\(groupID)/members/remove",
      "/groups/\\(groupID)/leave",
      "/groups/\\(groupID)/dismiss",
      "/groups/\\(groupID)/notification-settings",
      "/groups/\\(groupID)/viewer-settings",
      "/groups/\\(groupID)/members/me",
      "/groups/\\(groupID)/announcement",
      "/groups/\\(groupID)/invites",
      "/groups/\\(groupID)/messages/search",
      "/groups/\\(groupID)/messages/history",
      "/groups/\\(groupID)/reports",
    ]) {
      expect(native).toContain(path);
    }
    for (const functionName of [
      "getGroupDetail",
      "renameGroup",
      "updateGroupVisibility",
      "addGroupMembers",
      "removeGroupMember",
      "leaveGroup",
      "dismissGroup",
      "clearGroupMessageHistory",
      "searchGroupMessages",
    ]) {
      expect(bwchat).toMatch(
        new RegExp(`export async function ${functionName}[\\s\\S]*?requiredEnvelope: true`, "u"),
      );
    }
    expect(bwchat).toContain('query.set("sender_id", options.senderId)');
    expect(bwchat).toContain('query.set("message_type", options.messageType)');
    expect(bwchat).toContain('query.set("cursor", options.cursor)');
    expect(groupInfo).toContain("trimFoundationWhitespacesAndNewlines(detail).length > 0");
    expect(groupInfo).toContain("...(hasDetail ? { detail } : {})");
    expect(groupInfo).toContain('headers: { "Idempotency-Key": createIdempotencyKey() }');
  });

  it("locks owner-scoped cache, removal generations, monotonic revisions and realtime writes", () => {
    const cache = expo("src/services/groups/GroupDetailRepository.ts");
    const detail = expo("src/app/group-detail.tsx");
    const realtime = expo("src/services/realtime/ChatRealtimeService.ts");
    expect(cache).toContain("const repositoryGenerations = new Map<string, number>()");
    expect(cache).toContain("const writeChains = new Map<string, Promise<void>>()");
    expect(cache).toContain("expectedGeneration !== groupDetailGeneration(owner, detail.group_id)");
    expect(cache).toContain(
      "repositoryGenerations.set(key, groupDetailGeneration(owner, groupId) + 1)",
    );
    expect(cache).toContain("subscription.ownerId === owner");
    expect(cache).toContain("mergeGroupInfoRevisions(current, detail)");
    expect(detail).toContain("const cacheGeneration = groupDetailGeneration(ownerId, groupId)");
    expect(detail).toContain("saveCachedGroupDetail(ownerId, fetched, cacheGeneration)");
    expect(detail).toContain("router.dismissAll()");
    for (const event of [
      "group_notification_settings_updated",
      "group_viewer_settings_updated",
      "group_announcement_updated",
      "group_member_updated",
      "group_member_profile_updated",
    ]) {
      expect(realtime).toContain(`case "${event}"`);
    }
  });

  it("preserves the native generated nine-avatar collage and invents no bitmap asset", () => {
    const native = copiedNative("BWChat/Components/AvatarView.swift");
    const avatar = expo("src/components/GroupMemberAvatar.tsx");
    for (const contract of [
      "prefix(9)",
      "private let spacing: CGFloat = 1.5",
      "private let inset: CGFloat = 3",
      "return floor(available / CGFloat(columnCount))",
      "size * 0.18",
    ]) {
      expect(native).toContain(contract);
    }
    expect(avatar).toContain("slice(0, 9)");
    expect(avatar).toContain("const spacing = 1.5");
    expect(avatar).toContain("const inset = 3");
    expect(avatar).toContain("Math.floor");
    expect(avatar).toContain("borderRadius: size * 0.18");
    expect(avatar).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
    expect(expo("src/app/group-detail.tsx")).not.toMatch(/airplane|飞机/iu);
  });
});

function expo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function copiedNative(relativePath: string): string {
  return readFileSync(resolve(copiedNativeRoot, relativePath), "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
