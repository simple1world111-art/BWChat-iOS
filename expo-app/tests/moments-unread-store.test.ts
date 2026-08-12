import fs from "node:fs";
import path from "node:path";

import {
  activateMomentsUnreadOwner,
  captureMomentsUnreadRefresh,
  clearMomentsNew,
  clearMomentsUnread,
  consumeMomentsNew,
  incrementMomentsUnread,
  momentsHasNewSnapshot,
  momentsUnreadBadgeText,
  momentsUnreadSnapshot,
  publishMomentsUnread,
  publishMomentsUnreadInfo,
  resetMomentsUnreadStoreForTests,
  subscribeMomentsUnread,
} from "@/services/moments/MomentsUnreadStore";

describe("owner-scoped moments native-tab unread store", () => {
  beforeEach(() => resetMomentsUnreadStoreForTests());

  it("publishes the authoritative count and formats the native badge", () => {
    activateMomentsUnreadOwner("owner-a");
    expect(publishMomentsUnread("owner-a", 8)).toBe(8);
    expect(momentsUnreadSnapshot("owner-a")).toBe(8);
    expect(momentsUnreadBadgeText(8)).toBe("8");
    expect(momentsUnreadBadgeText(100)).toBe("99+");
    expect(momentsUnreadBadgeText(0)).toBeNull();
  });

  it("clears on account changes and ignores a late prior-owner response", () => {
    activateMomentsUnreadOwner("owner-a");
    publishMomentsUnread("owner-a", 5);
    activateMomentsUnreadOwner("owner-b");
    expect(momentsUnreadSnapshot("owner-b")).toBe(0);
    expect(publishMomentsUnread("owner-a", 9)).toBe(0);
    expect(momentsUnreadSnapshot("owner-b")).toBe(0);
    publishMomentsUnread("owner-b", 3);
    activateMomentsUnreadOwner("owner-a");
    expect(momentsUnreadSnapshot("owner-a")).toBe(0);
  });

  it("increments a foreground push and clears optimistically on opening notifications", () => {
    activateMomentsUnreadOwner("owner-a");
    const listener = jest.fn();
    const unsubscribe = subscribeMomentsUnread(listener);
    expect(incrementMomentsUnread("owner-a")).toBe(1);
    expect(incrementMomentsUnread("owner-b")).toBe(0);
    clearMomentsUnread("owner-a");
    expect(momentsUnreadSnapshot("owner-a")).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("clears the new-feed dot immediately and rejects a response captured before the clear", () => {
    activateMomentsUnreadOwner("owner-a");
    publishMomentsUnreadInfo("owner-a", { unread_count: 4, has_new_moments: true });
    const staleRefresh = captureMomentsUnreadRefresh("owner-a");

    clearMomentsNew("owner-a");
    expect(momentsHasNewSnapshot("owner-a")).toBe(false);
    expect(momentsUnreadSnapshot("owner-a")).toBe(4);

    publishMomentsUnreadInfo("owner-a", { unread_count: 7, has_new_moments: true }, staleRefresh);
    expect(momentsHasNewSnapshot("owner-a")).toBe(false);
    expect(momentsUnreadSnapshot("owner-a")).toBe(4);
  });

  it("atomically consumes the new-feed signal without clearing notification count", () => {
    activateMomentsUnreadOwner("owner-a");
    publishMomentsUnreadInfo("owner-a", { unread_count: 4, has_new_moments: true });

    expect(consumeMomentsNew("owner-a")).toBe(true);
    expect(consumeMomentsNew("owner-a")).toBe(false);
    expect(momentsHasNewSnapshot("owner-a")).toBe(false);
    expect(momentsUnreadSnapshot("owner-a")).toBe(4);
  });

  it("does not let an in-flight unread response restore an optimistically cleared badge", () => {
    activateMomentsUnreadOwner("owner-a");
    publishMomentsUnread("owner-a", 5);
    const staleRefresh = captureMomentsUnreadRefresh("owner-a");

    clearMomentsUnread("owner-a");
    publishMomentsUnread("owner-a", 5, staleRefresh);

    expect(momentsUnreadSnapshot("owner-a")).toBe(0);
  });

  it("wires server fetch, push increment and optimistic clear into product consumers", () => {
    const root = process.cwd();
    const discover = read(root, "src/app/(tabs)/discover.tsx");
    const moments = read(root, "src/app/moments.tsx");
    const notifications = read(root, "src/app/moments-notifications.tsx");
    const push = read(root, "src/services/push/PushService.ts");
    const tabs = read(root, "src/app/(tabs)/_layout.tsx");
    expect(discover).toContain(
      "publishMomentsUnreadInfo(accountOwnerId, momentsResult.value, momentsRefresh)",
    );
    expect(discover).toContain("useMomentsHasNew(accountOwnerId)");
    expect(discover).not.toContain("clearMomentsNew(accountOwnerId)");
    expect(moments).toContain("publishMomentsUnread(ownerId, info.unread_count, momentsRefresh)");
    expect(moments).toContain("consumeMomentsNew(ownerId)");
    expect(moments).toContain("loadFeed(selectedTab, true, forceRefresh)");
    expect(moments).toContain("clearMomentsUnread(ownerId)");
    expect(notifications).toContain("clearMomentsUnread(ownerId)");
    expect(push).toContain('pushOpenTarget(input, "received")?.kind === "moments"');
    expect(push).toContain("incrementMomentsUnread(ownerId)");
    expect(tabs).toContain('const momentsUnread = useMomentsUnread(user?.user_id ?? "")');
    expect(tabs).toContain('["moments_unread", "moments"].includes(badgeKey)');
    expect(tabs).toContain("return momentsUnreadBadgeText(momentsUnread)");
  });

  it("matches the original moments unread store and tab badge contract", () => {
    const root = process.cwd();
    const nativeTabs = read(root, "../BWChat/Views/MainTabView.swift");
    const nativeUnread = read(root, "../BWChat/Services/PushService.swift");
    expect(nativeTabs).toContain('"discover": unreadBadgeStore.momentsUnreadCount');
    expect(nativeUnread).toContain("func setMomentsUnreadCount(_ count: Int)");
    expect(nativeUnread).toContain("func incrementMomentsUnread()");
    expect(nativeUnread).toContain("momentsUnreadCount = 0");
  });
});

function read(root: string, relative: string): string {
  return fs.readFileSync(path.resolve(root, relative), "utf8");
}
