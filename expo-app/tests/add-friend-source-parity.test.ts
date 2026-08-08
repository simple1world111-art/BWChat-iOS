import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");

describe("AddFriendView source parity", () => {
  it("locks the copied native source topology used by the acceptance matrix", () => {
    const native = sourceNative("BWChat/Views/AddFriendView.swift");
    expect(native).toContain("@StateObject private var viewModel = FriendsViewModel()");
    expect(native).toContain("NavigationStack");
    expect(native).toContain('L10n.tr("addFriend.title")');
    expect(native).toContain("viewModel.debouncedSearch()");
    expect(native).toContain("navigator.push(UserProfileView(userID: user.userID))");
    expect(native).toContain("viewModel.toggleFollow(userID: user.userID)");
    expect(native).toContain("try? await Task.sleep(nanoseconds: 250_000_000)");
  });

  it("keeps the complete native search and result-row geometry", () => {
    const native = sourceNative("BWChat/Views/AddFriendView.swift");
    const expo = sourceExpo("src/app/add-friend.tsx");
    for (const contract of [
      "HStack(spacing: 10)",
      ".padding(.horizontal, 14)",
      ".padding(.vertical, 10)",
      ".cornerRadius(12)",
      ".padding(.horizontal, 16)",
      ".padding(.top, 8)",
      "HStack(spacing: 12)",
      "size: 44",
      ".frame(minWidth: 56, minHeight: 32)",
      "HStack(spacing: 6)",
      "Divider().padding(.leading, 72)",
    ]) {
      expect(native).toContain(contract);
    }
    for (const contract of [
      "minHeight: 40",
      "marginHorizontal: 16",
      "marginTop: 8",
      "paddingHorizontal: 14",
      "paddingVertical: 10",
      "columnGap: 10",
      "borderRadius: 12",
      "size={44}",
      "minWidth: 56",
      "minHeight: 32",
      "columnGap: 6",
      "marginLeft: 72",
    ]) {
      expect(expo).toContain(contract);
    }
  });

  it("wires cancellation, stale-result suppression and per-user mutation locks", () => {
    const expo = sourceExpo("src/app/add-friend.tsx");
    expect(expo).toContain("searchGenerationRef.current += 1");
    expect(expo).toContain("searchGeneration === searchGenerationRef.current");
    expect(expo).toContain("accountGeneration === accountGenerationRef.current");
    expect(expo).toContain("subscribeFollowRelationship(ownerId");
    expect(expo).toContain("publishFollowRelationship(");
    expect(expo).toContain("        ownerId,\n      );");
    expect(expo).toContain("setSearching(false)");
    expect(expo).toContain("acquireAddFriendOperation(updatingIdsRef.current, user.user_id)");
    expect(expo).toContain("releaseAddFriendOperation(updatingIdsRef.current, user.user_id)");
    expect(expo).toContain("applyRelationshipToSearchUsers(current, relationship)");
  });

  it("preserves exact API routes and does not invent legacy friend-request mutation", () => {
    const api = sourceExpo("src/api/bwchat.ts");
    const page = sourceExpo("src/app/add-friend.tsx");
    expect(api).toContain("`/friends/search?${query.toString()}`");
    expect(api).toContain("`/follows/${encodeShortDramaPathComponent(userId)}`");
    expect(api).toContain("requiredData: true");
    expect(api).toContain("requiredEnvelope: true");
    expect(page).toContain("await followUser(user.user_id)");
    expect(page).toContain("await unfollowUser(user.user_id)");
    expect(page).not.toContain("sendFriendRequest");
    expect(page).not.toContain("/friends/request");
  });

  it("exposes native button semantics and modal/direct-chat navigation timing", () => {
    const page = sourceExpo("src/app/add-friend.tsx");
    const layout = sourceExpo("src/app/_layout.tsx");
    expect(layout).toContain('name="add-friend"');
    expect(layout).toContain('presentation: "modal"');
    expect(page.match(/accessibilityRole="button"/gu)?.length).toBeGreaterThanOrEqual(5);
    expect(page).toContain("accessibilityState={{ busy: isUpdating, disabled: isUpdating }}");
    expect(page).toContain("router.dismiss()");
    expect(page).toContain("addFriendPolicy.messageNavigationDelayMilliseconds");
    expect(page).toContain('pathname: "/chat/[id]"');
  });
});

function sourceExpo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function sourceNative(relativePath: string): string {
  return readFileSync(resolve(nativeRoot, relativePath), "utf8");
}
