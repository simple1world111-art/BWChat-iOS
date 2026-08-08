import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

describe("AddGroupMembers native source topology", () => {
  it("keeps the two native loads independent and the cached list behind the blocker", () => {
    const page = source("src/app/add-group-members.tsx");
    expect(page).toContain("const detailTask = getGroupDetail(groupId)");
    expect(page).toContain("const friendsTask = (async () =>");
    expect(page).toContain("await Promise.all([detailTask, friendsTask])");
    expect(page).toContain("{isLoading ? (");
    expect(page).not.toContain("isLoading && friends.length === 0");
  });

  it("uses the exact native lazy row geometry and selection controls", () => {
    const page = source("src/app/add-group-members.tsx");
    expect(page).toContain("<FlatList");
    expect(page).toMatch(
      /checkCircle:\s*\{[\s\S]*?width: 24,[\s\S]*?height: 24,[\s\S]*?borderRadius: 12,[\s\S]*?borderWidth: 2,/u,
    );
    expect(page).toContain("<Avatar name={friend.nickname} size={42}");
    expect(page).toContain('fontSize: 16, fontWeight: "500"');
    expect(page).toContain("marginLeft: 76");
    expect(page).toContain("screenDark: { backgroundColor: colors.black }");
    expect(page).toContain('accessibilityRole="button"');
  });

  it("returns through native-equivalent parent refresh callbacks", () => {
    const page = source("src/app/add-group-members.tsx");
    expect(page).toContain("router.back()");
    expect(page).toContain("else void refreshDirectParent()");
    expect(page).toContain("await saveCachedGroupDetail(ownerId, detail)");
    expect(source("src/app/group-detail.tsx")).toContain("useFocusEffect");
    const members = source("src/app/group-members.tsx");
    expect(members).toContain("subscribeGroupMembersAdded");
    expect(members).toContain("getGroupDetail(groupId)");
    expect(members).toContain("saveCachedGroupDetail(ownerId");
    expect(source("src/services/groups/GroupDetailRepository.ts")).toContain(
      "if (subscription.ownerId === owner) subscription.listener(resolved)",
    );
  });

  it("locks the three native API envelopes, payload and decoding authority", () => {
    const api = source("src/api/bwchat.ts");
    expect(api).toMatch(
      /getFriendList[\s\S]*?"\/friends\/list"[\s\S]*?requiredData: true,[\s\S]*?requiredEnvelope: true,[\s\S]*?normalizeRequiredFriendInfo/u,
    );
    expect(api).toMatch(
      /getGroupDetail[\s\S]*?normalizeNativeGroupDetail[\s\S]*?`\/groups\/\$\{groupId\}`[\s\S]*?requiredData: true,[\s\S]*?requiredEnvelope: true,/u,
    );
    expect(api).toMatch(
      /addGroupMembers[\s\S]*?`\/groups\/\$\{groupId\}\/members\/add`[\s\S]*?method: "POST",[\s\S]*?body: \{ user_ids: \[\.\.\.memberIds\] \},[\s\S]*?requiredEnvelope: true,/u,
    );
    expect(source("src/api/client.ts")).toContain(
      'headers.set("Authorization", `Bearer ${token}`)',
    );
  });

  it("keeps the native confirmation button and lifecycle gates explicit", () => {
    const page = source("src/app/add-group-members.tsx");
    expect(page).toContain('{ text: t("common.confirm"), style: "cancel" }');
    expect(page).toContain("dismissedRef.current ||");
    expect(page).toContain("submissionInFlightRef.current");
    expect(page).toContain("if (dismissedRef.current) return");
  });
});

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}
