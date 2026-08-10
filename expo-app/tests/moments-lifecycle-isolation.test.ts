import fs from "node:fs";
import path from "node:path";

import {
  publishMomentMutation,
  subscribeMomentMutation,
} from "@/services/moments/MomentMutationStore";

describe("Moments account lifecycle isolation", () => {
  it("delivers mutations only to subscribers for the publishing owner", () => {
    const ownerA = jest.fn();
    const ownerB = jest.fn();
    const unsubscribeA = subscribeMomentMutation("owner-a", ownerA);
    const unsubscribeB = subscribeMomentMutation("owner-b", ownerB);

    publishMomentMutation("owner-a", { kind: "delete", momentId: 10 });
    expect(ownerA).toHaveBeenCalledWith({ kind: "delete", momentId: 10 });
    expect(ownerB).not.toHaveBeenCalled();

    unsubscribeA();
    unsubscribeB();
  });

  it("remounts feed and detail state per account and gates late async commits", () => {
    const feed = read("src/app/moments.tsx");
    const detail = read("src/app/moment-detail.tsx");
    for (const source of [feed, detail]) {
      expect(source).toContain("activeRef.current = false");
      expect(source).toContain("if (!activeRef.current) return");
    }
    expect(feed).toContain('key={`${ownerId || "signed-out"}|${params.mode ?? "feed"}`}');
    expect(detail).toContain('key={`${ownerId || "signed-out"}|${Number.isFinite(momentId)');
    expect(feed).toContain("subscribeMomentMutation(ownerId");
    expect(detail).toContain('publishMomentMutation(ownerId, { kind: "upsert"');
  });

  it("keeps upload status and optimistic mutation channels owner-scoped", () => {
    const queue = read("src/services/moments/MomentUploadQueue.ts");
    expect(queue).toContain("const listenersByOwner = new Map<string, Set<Listener>>()");
    expect(queue).toContain("statusKey(job.owner_id, job.id)");
    expect(queue).toContain("publishMomentMutation(job.owner_id");
    expect(queue).toContain("subscribeMomentUploads(ownerId: string, listener: Listener)");
  });

  it("treats persisted empty feeds as resolved before silent revalidation", () => {
    const feed = read("src/app/moments.tsx");
    const cacheRead = feed.indexOf("await readCachedMomentFeed(ownerId, tab)");
    const resolvedCache = feed.indexOf("hasResolved: true", cacheRead);

    expect(cacheRead).toBeGreaterThan(-1);
    expect(resolvedCache).toBeGreaterThan(cacheRead);
    expect(feed).toContain("isLoading: reset && !forceRefresh && !state.hasResolved");
    expect(feed).toContain("isShowingCachedData: false");
    expect(feed).toContain("if (cacheIsFresh) return");
    expect(feed).toContain("if (reset && !forceRefresh && loadedRef.current[tab]) return");
  });

  it("keeps automatic entry, cover media and initial pagination spinner-free", () => {
    const feed = read("src/app/moments.tsx");
    const content = read("src/components/profile/PublicProfileContent.tsx");

    expect(feed).toContain("if (isLoading) {\n    return <View style={styles.emptyState} />;");
    expect(feed).toContain("loadingFallback={<View />}");
    expect(feed).toContain("ListFooterComponent={null}");
    expect(feed).toContain("if (didBeginScrollingRef.current) void loadFeed(selectedTab, false)");
    expect(content).toContain("fallback={<View style={imageStyle} />}");
    expect(content).toContain("loadingFallback={<View style={imageStyle} />}");
  });

  it("persists a completed background refresh after the screen is left", () => {
    const feed = read("src/app/moments.tsx");
    const inactivePersistence = feed.indexOf(
      "if (!activeRef.current) {\n          await persistTab(tab, nextState);",
    );
    const reconciliation = feed.indexOf("await reconcileMomentUploads(ownerId, page.moments)");

    expect(inactivePersistence).toBeGreaterThan(reconciliation);
  });

  it("matches the original account ownership guards", () => {
    const native = read("../BWChat/ViewModels/MomentsViewModel.swift");
    expect(native).toContain("ownerID == AuthManager.shared.currentUser?.userID");
    expect(native).toContain("guard let ownerID = AuthManager.shared.currentUser?.userID");
  });
});

function read(relative: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");
}
