import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Preview UI entrypoints", () => {
  it("removes Scan from the Messages add menu", () => {
    const conversations = source("src/app/(tabs)/conversations.tsx");
    expect(conversations).not.toContain('title={t("messages.scan")}');
    expect(conversations).not.toContain('perform("scan")');
  });

  it("adds a working filter control to the top-left of Map", () => {
    const map = source("src/app/(tabs)/map.tsx");
    expect(map).toContain('testID="map-filter-button"');
    expect(map).toContain("left: 16");
    expect(map).toContain("setMapFilter(selected.key)");
    expect(map).toContain('mapFilter === "online"');
    expect(map).toContain('mapFilter === "friends"');
  });

  it("keeps a standalone test card visible on Discover", () => {
    const discover = source("src/app/(tabs)/discover.tsx");
    expect(discover).toContain('testID="discover-test-card"');
    expect(discover).toContain('"zh-Hans": "测试"');
    expect(discover).toContain("onPress={() => void open(TEST_DISCOVER_ITEM)}");
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
