import {
  clearNavigationSnapshots,
  clearNavigationSnapshotsForOwner,
  readNavigationSnapshot,
  writeNavigationSnapshot,
} from "@/services/navigation/NavigationSnapshotCache";

describe("NavigationSnapshotCache", () => {
  beforeEach(() => clearNavigationSnapshots());

  it("restores visible state by destination, account and variant", () => {
    writeNavigationSnapshot("moments", "owner-a", { ids: [1] }, "feed");
    writeNavigationSnapshot("moments", "owner-a", { ids: [2] }, "mine");
    writeNavigationSnapshot("moments", "owner-b", { ids: [3] }, "feed");

    expect(readNavigationSnapshot("moments", "owner-a", "feed")).toEqual({ ids: [1] });
    expect(readNavigationSnapshot("moments", "owner-a", "mine")).toEqual({ ids: [2] });
    expect(readNavigationSnapshot("moments", "owner-b", "feed")).toEqual({ ids: [3] });
  });

  it("never exposes snapshots to anonymous or another account", () => {
    writeNavigationSnapshot("activity-center", "owner-a", { balance: 12 });
    writeNavigationSnapshot("activity-center", "anonymous", { balance: 99 });

    expect(readNavigationSnapshot("activity-center", "owner-b")).toBeUndefined();
    expect(readNavigationSnapshot("activity-center", "anonymous")).toBeUndefined();
  });

  it("clears only the requested account", () => {
    writeNavigationSnapshot("game-center", "owner-a", [1]);
    writeNavigationSnapshot("group-list", "owner-a", [2]);
    writeNavigationSnapshot("game-center", "owner-b", [3]);

    clearNavigationSnapshotsForOwner("owner-a");

    expect(readNavigationSnapshot("game-center", "owner-a")).toBeUndefined();
    expect(readNavigationSnapshot("group-list", "owner-a")).toBeUndefined();
    expect(readNavigationSnapshot("game-center", "owner-b")).toEqual([3]);
  });

  it("bounds retained destinations and keeps recently read entries", () => {
    writeNavigationSnapshot("page", "owner", 0, "0");
    for (let index = 1; index < 48; index += 1) {
      writeNavigationSnapshot("page", "owner", index, String(index));
    }
    expect(readNavigationSnapshot("page", "owner", "0")).toBe(0);

    writeNavigationSnapshot("page", "owner", 48, "48");

    expect(readNavigationSnapshot("page", "owner", "1")).toBeUndefined();
    expect(readNavigationSnapshot("page", "owner", "0")).toBe(0);
    expect(readNavigationSnapshot("page", "owner", "48")).toBe(48);
  });
});
