import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("native SystemSegmentedTabs parity", () => {
  const root = resolve(__dirname, "..");
  const native = readFileSync(resolve(root, "../BWChat/Components/RootTabTitle.swift"), "utf8");
  const expo = readFileSync(resolve(root, "src/components/SystemSegmentedTabs.tsx"), "utf8");

  it("preserves the native 17pt font, segmented style and selected binding", () => {
    expect(native).toContain(".systemFont(ofSize: 17, weight: fontWeight)");
    expect(native).toContain("UISegmentedControl(items: titles)");
    expect(native).toContain("control.selectedSegmentIndex = selectedIndex");
    expect(expo).toContain('pickerStyle("segmented")');
    expect(expo).toContain("font({ size: 17, weight: fontWeight })");
    expect(expo).toContain("selection={selection}");
  });

  it("keeps dynamic titles and rejects unknown selection values", () => {
    expect(native).toContain("control.setTitle(title, forSegmentAt: index)");
    expect(expo).toContain("items.map((item)");
    expect(expo).toContain("values.has(value as Value)");
  });

  it("allows a source toolbar to force the native light color scheme", () => {
    const scriptCenter = readFileSync(resolve(root, "src/app/script-center.tsx"), "utf8");
    expect(expo).toContain("const resolvedColorScheme = colorScheme ??");
    expect(expo).toContain("colorScheme={resolvedColorScheme}");
    expect(scriptCenter).toContain('colorScheme="light"');
  });

  it("routes all seven native call sites through the shared control", () => {
    const expectations = [
      ["src/app/game-center.tsx", "gameCenter.top.tabs"],
      ["src/app/activity-center.tsx", "activityCenter.top.tabs"],
      ["src/app/script-center.tsx", "script.center.top.tabs"],
      ["src/app/group-list.tsx", "group.top.tabs"],
      ["src/app/moments.tsx", "moments.top.tabs"],
      ["src/app/short-drama-series.tsx", "shortDrama.top.tabs"],
      ["src/app/live-lobby.tsx", "live.lobby.tabs"],
    ] as const;
    for (const [relativePath, identifier] of expectations) {
      const source = readFileSync(resolve(root, relativePath), "utf8");
      expect(source).toContain("<SystemSegmentedTabs");
      expect(source).toContain(`accessibilityIdentifier="${identifier}"`);
    }
  });

  it("preserves the three non-default weight overrides and activity width", () => {
    const activity = readFileSync(resolve(root, "src/app/activity-center.tsx"), "utf8");
    const moments = readFileSync(resolve(root, "src/app/moments.tsx"), "utf8");
    const live = readFileSync(resolve(root, "src/app/live-lobby.tsx"), "utf8");
    expect(activity).toContain('fontWeight="semibold"');
    expect(activity).toContain("width={228}");
    expect(moments).toContain('fontWeight="bold"');
    expect(moments).toContain('backgroundColor="rgba(0,0,0,0.16)"');
    expect(moments).toContain('colorScheme="dark"');
    expect(moments).not.toContain("coverChrome");
    expect(live).toContain('fontWeight="medium"');
  });
});
