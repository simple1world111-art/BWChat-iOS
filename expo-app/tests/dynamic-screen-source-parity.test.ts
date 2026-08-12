import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("dynamic screen source parity", () => {
  it("implements every renderer token supported by DynamicScreenView.swift", () => {
    const renderer = fs.readFileSync(
      path.join(root, "src/components/dynamic-screen/DynamicComponentRenderer.tsx"),
      "utf8",
    );
    for (const token of [
      "screen",
      "section",
      "list",
      "card",
      "row",
      "actionrow",
      "action_row",
      "banner",
      "text",
      "image",
      "button",
      "divider",
      "spacer",
      "walletbalance",
      "wallet_balance",
      "giftpreview",
      "gift_preview",
      "agentlist",
      "agent_list",
    ]) {
      expect(renderer).toContain(`\"${token}\"`);
    }
  });

  it("keeps the audited Swift layout metrics and banner gradient", () => {
    const policy = fs.readFileSync(
      path.join(root, "src/services/dynamic-screen/DynamicScreenVisualPolicy.ts"),
      "utf8",
    );
    for (const source of [
      "contentHorizontalPadding: 16",
      "contentTopPadding: 16",
      "contentBottomPadding: 24",
      "componentSpacing: 12",
      "childSpacing: 10",
      "cardCornerRadius: 14",
      "rowIconSize: 40",
      "bannerIconSize: 48",
      "imageDefaultHeight: 160",
      "buttonHeight: 46",
      "giftIconSize: 42",
    ]) {
      expect(policy).toContain(source);
    }
    expect(policy).toContain('["#FFF4C9", "#E9F8FF"]');
    expect(policy).toContain('scheme === "dark" ? "#1C1C1E" : "#F2F2F7"');
    expect(policy).toContain('scheme === "dark" ? "#000000" : "#FFFFFF"');
  });

  it("uses a real dynamic route while preserving the existing feature placeholder route", () => {
    const navigator = fs.readFileSync(
      path.join(root, "src/services/web/DynamicRouteNavigator.ts"),
      "utf8",
    );
    const layout = fs.readFileSync(path.join(root, "src/app/_layout.tsx"), "utf8");
    expect(navigator).toContain('pathname: "/dynamic-screen/[id]"');
    expect(layout).toMatch(/<Stack\.Screen\s+name="dynamic-screen\/\[id\]"/u);
    expect(fs.existsSync(path.join(root, "src/app/feature/[slug].tsx"))).toBe(true);
  });

  it("keeps detail navigation transparent and removes the localized back label", () => {
    const layout = fs.readFileSync(path.join(root, "src/app/_layout.tsx"), "utf8");
    expect(layout).toContain('headerBackButtonDisplayMode: "minimal"');
    expect(layout).toContain('headerBackTitle: ""');
    expect(layout).toContain("headerShadowVisible: false");
    expect(layout).toContain('headerStyle: { backgroundColor: "transparent" }');
    expect(layout).not.toContain('headerBackTitle: "返回"');
  });

  it("statically maps every in-scope copied native imageset for dynamic fallback assets", () => {
    const source = fs.readFileSync(
      path.join(root, "src/components/dynamic-screen/DynamicRemoteAssetImage.tsx"),
      "utf8",
    );
    const assetRoot = path.join(root, "assets/native-original/Assets.xcassets");
    const assetEntries = fs.readdirSync(assetRoot);
    expect(assetEntries.some((name) => name.startsWith("flight_plane_"))).toBe(false);
    const imagesets = assetEntries.filter((name) => name.endsWith(".imageset"));
    for (const imageset of imagesets) expect(source).toContain(`${imageset}/`);
    expect(source).not.toContain("flight_plane_");
    expect(source).toContain("gift-whimsical-arrow.png");
    expect(source).toContain("fallbackTintColor = colors.tertiaryText");
    expect(source).toContain("event.nativeEvent.layout.width");
    expect(source).toContain("event.nativeEvent.layout.height");
  });

  it("keeps the Swift conditional request and route lifecycle", () => {
    const repository = fs.readFileSync(
      path.join(root, "src/services/dynamic-screen/DynamicScreenRepository.ts"),
      "utf8",
    );
    const route = fs.readFileSync(
      path.join(root, "src/services/web/DynamicRouteNavigator.ts"),
      "utf8",
    );
    for (const source of [
      '"Accept-Language"',
      '"X-App-Version"',
      '"X-App-Build"',
      '"X-Platform"',
      '"X-Timezone"',
      '"If-None-Match"',
      "refreshAccessToken",
      "transientDelays = [350, 900]",
    ])
      expect(repository).toContain(source);
    expect(route).toContain('route.type ?? "coming_soon"');
    expect(route).toContain('map: "/(tabs)/map"');
    expect(route).toContain('translatedRouteKey("common.operationFailed"');
  });

  it("clears an account-or-route identity before the replacement page can paint", () => {
    const page = fs.readFileSync(path.join(root, "src/app/dynamic-screen/[id].tsx"), "utf8");
    expect(page).toContain("useLayoutEffect(() => {");
    expect(page).toContain("generationRef.current += 1");
    expect(page).toContain("screenRef.current = embedded");
  });
});
