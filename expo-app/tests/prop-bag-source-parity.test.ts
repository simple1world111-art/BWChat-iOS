import fs from "node:fs";
import path from "node:path";

import { propBagPalette, propBagPopoverPlacement } from "@/services/props/PropBagVisualPolicy";

const root = process.cwd();

describe("prop-bag source parity", () => {
  it("routes every native prop-bag entry to the real screen instead of the generic placeholder", () => {
    const profile = fs.readFileSync(path.join(root, "src/app/(tabs)/profile.tsx"), "utf8");
    const routes = fs.readFileSync(
      path.join(root, "src/services/web/DynamicRouteNavigator.ts"),
      "utf8",
    );
    const layout = fs.readFileSync(path.join(root, "src/app/_layout.tsx"), "utf8");
    expect(profile).toContain("openDynamicRoute(");
    expect(profile).toContain('item.route ?? { type: "native", name: item.id }');
    expect(routes).toContain('prop_bag: "/prop-bag" as Href');
    expect(profile).not.toContain('prop_bag: { slug: "wallet"');
    expect(layout).toMatch(/<Stack\.Screen\s+name="prop-bag"/u);
    expect(layout).toMatch(/<Stack\.Screen\s+name="activity-cat-food"/u);
  });

  it("references the five original prop artworks and cat-food artwork without generated replacements", () => {
    const propBag = fs.readFileSync(path.join(root, "src/app/prop-bag.tsx"), "utf8");
    const detail = fs.readFileSync(path.join(root, "src/app/activity-cat-food.tsx"), "utf8");
    for (const asset of [
      "activity_cat_food_icon.png",
      "prop_image_unlock_card_gift_v2.png",
      "prop_video_unlock_card_gift_v2.png",
      "prop_live_experience_card_5m_gift_v2.png",
      "prop_live_experience_card_10m_gift_v2.png",
      "prop_live_experience_card_15m_gift_v2.png",
    ])
      expect(`${propBag}\n${detail}`).toContain(asset);
  });

  it("keeps the audited native grid, state, header, rule, row, and pagination metrics", () => {
    const propBag = fs.readFileSync(path.join(root, "src/app/prop-bag.tsx"), "utf8");
    const detail = fs.readFileSync(path.join(root, "src/app/activity-cat-food.tsx"), "utf8");
    expect(propBag).toContain("(width - 32 - 20) / 3");
    expect(propBag).toContain("minHeight: 188");
    expect(propBag).toContain("width: 92, height: 92");
    expect(propBag).toContain("minimumFontScale={0.76}");
    expect(propBag).toContain("onPopoverPress={(anchor) => setSelectedPopover({ anchor, item })}");
    expect(propBag).toContain("<UsageRulesPopover");
    expect(propBag).toContain("propBagPopoverPlacement");
    expect(propBag).toContain("popoverArrowUp");
    expect(propBag).toContain('backgroundColor: "transparent"');
    expect(propBag).not.toContain('backgroundColor: "rgba(0,0,0,0.16)"');
    expect(propBag).toContain("allowFontScaling={false}");
    expect(detail).toContain('colors={["#667EEA", "#8C7CF3"]}');
    expect(detail).toContain("minHeight: 220");
    expect(detail).toContain("activityCatFood.balanceAfter");
    expect(detail).toContain("onContentSizeChange={handleContentSizeChange}");
    expect(detail).toContain("onLayout={handleLayout}");
    expect(detail).toContain("shouldLoadNextActivityCatFoodPage");
    expect(detail).toContain("allowFontScaling={false}");
    expect(
      fs.readFileSync(path.join(root, "src/services/props/PropBagVisualPolicy.ts"), "utf8"),
    ).toContain("transactionPageSize: 20");
  });

  it("anchors the usage bubble below its card and flips above near the bottom edge", () => {
    expect(
      propBagPopoverPlacement(
        { x: 100, y: 200, width: 80, height: 188 },
        { width: 390, height: 844 },
        110,
      ),
    ).toMatchObject({ arrowDirection: "up", left: 12, top: 398, width: 262 });
    expect(
      propBagPopoverPlacement(
        { x: 100, y: 650, width: 80, height: 188 },
        { width: 390, height: 844 },
        110,
      ),
    ).toMatchObject({ arrowDirection: "down", top: 530, width: 262 });
  });

  it("keeps native light/dark semantic backgrounds, fixed point sizes, and accessible interactions", () => {
    expect(propBagPalette("light")).toMatchObject({
      background: "#F2F2F7",
      card: "#FFFFFF",
      text: "#1A1A2E",
    });
    expect(propBagPalette("dark")).toMatchObject({
      background: "#1C1C1E",
      card: "#000000",
      text: "#1A1A2E",
    });

    const propBag = fs.readFileSync(path.join(root, "src/app/prop-bag.tsx"), "utf8");
    const detail = fs.readFileSync(path.join(root, "src/app/activity-cat-food.tsx"), "utf8");
    expect(propBag).toContain("accessibilityLabel={closeTitle}");
    expect(propBag).toContain('accessibilityRole="button"');
    expect(propBag).toContain("accessibilityState={{ disabled }}");
    expect(detail).toContain(
      "accessibilityLabel={`${presentation.title}, ${presentation.signedAmount}",
    );
    expect(detail).toContain("accessible");
  });

  it("applies media unlock wallet and consumed-prop receipts on both native moment surfaces", () => {
    for (const file of ["src/app/moments.tsx", "src/app/moment-detail.tsx"]) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source).toContain("await applyBalance(result.charge.wallet_balance)");
      expect(source).toContain(
        "applyMediaConsumption(normalizePropConsumption(result.consumed_prop), mediaType)",
      );
      expect(source).toContain("await refreshBalance(true)");
    }
  });

  it("keeps agent-media unlock idempotent and reconciles missing server receipts", () => {
    const source = fs.readFileSync(path.join(root, "src/app/agent-chat.tsx"), "utf8");
    expect(source).toContain("unlockingMediaIdsRef.current.has(mediaId)");
    expect(source).toContain(
      "unlockIdempotencyKeysRef.current.get(scope) ?? createIdempotencyKey()",
    );
    expect(source).toContain("settleAgentMediaUnlock(result)");
    expect(source).toContain("refreshBalance(true)");
    expect(source).toContain("loadPropInventory(true)");
    expect(source).toContain("await delay(750)");
    expect(source).toContain("Date.now() - startedAt < 30_000");
  });

  it("fail-closes cat-food from both balance and transaction disabled responses", () => {
    const walletProvider = fs.readFileSync(
      path.join(root, "src/providers/WalletProvider.tsx"),
      "utf8",
    );
    expect(walletProvider).toContain("isActivityCatFoodDisabledError(result.refreshError)");
    expect(walletProvider).toContain("isActivityCatFoodDisabledError(error)");
    expect(walletProvider).toContain("setActivityCatFoodDisabledByServer(true)");
    expect(walletProvider).toContain("setActivityCatFoodPage({ items: [] })");
  });
});
