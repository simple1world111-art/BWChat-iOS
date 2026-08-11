import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Preview UI entrypoints", () => {
  it("removes Scan from the Messages add menu", () => {
    const conversations = source("src/app/(tabs)/conversations.tsx");
    expect(conversations).not.toContain('title={t("messages.scan")}');
    expect(conversations).not.toContain('perform("scan")');
  });

  it("keeps the working Map filter control at the top-right", () => {
    const map = source("src/app/(tabs)/map.tsx");
    expect(map).toContain('testID="map-filter-button"');
    expect(map).toContain("right: 16");
    expect(map).not.toContain('filterButton: {\n    position: "absolute",\n    left: 16');
    expect(map).toContain("setMapFilter(selected.key)");
    expect(map).toContain('mapFilter === "online"');
    expect(map).toContain('mapFilter === "friends"');
  });

  it("removes the standalone test entry from Discover", () => {
    const discover = source("src/app/(tabs)/discover.tsx");
    expect(discover).not.toContain('testID="discover-test-card"');
    expect(discover).not.toContain("TEST_DISCOVER_ITEM");
    expect(discover).not.toContain('id: "test_entry"');
  });

  it("removes the retired test tab, card route and every native route registration", () => {
    expect(existsSync(resolve(process.cwd(), "src/app/(tabs)/test.tsx"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/app/test-card.tsx"))).toBe(false);
    for (const relativePath of [
      "src/app/(tabs)/_layout.tsx",
      "src/components/main-tab/DynamicMainTabRoot.tsx",
      "src/services/main-tab/MainTabRegistry.ts",
      "src/services/remote-config/defaultConfig.ts",
      "src/services/web/DynamicRouteNavigator.ts",
    ]) {
      const file = source(relativePath);
      expect(file).not.toContain('route: "test"');
      expect(file).not.toContain('name: "test"');
      expect(file).not.toContain('"/(tabs)/test"');
      expect(file).not.toContain('"/test-card"');
    }
  });

  it("removes the ID capsule beside the profile nickname", () => {
    const profile = source("src/app/(tabs)/profile.tsx");
    const hero = profile.slice(
      profile.indexOf("function ProfileHero"),
      profile.indexOf("function ProfileStat"),
    );
    expect(hero).not.toContain("styles.idCapsule");
    expect(hero).not.toContain("styles.idText");
    expect(hero).not.toContain("`ID: ${userId}`");
  });
});
