import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const copiedNativeRoot = resolve(expoRoot, "..");

describe("Discover source parity", () => {
  it("locks every copied native source used by the Discover root", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/DiscoverView.swift":
        "28c2efb0c7da3dfe711bdb05aabbe6d979a8a04d73d720871637954826787380",
      "BWChat/Models/DiscoverConfig.swift":
        "45357adc5150c76c99d590844319751e5877f3cbf52b536f8ea74cac506f7092",
      "BWChat/Services/APIService.swift":
        "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
      "BWChat/Services/DynamicRouteHandler.swift":
        "fba6f7c42e069901cd310940dad900f7c48a24b92b94fe6083efb7fa2abe24b2",
      "BWChat/Services/AppRemoteConfigStore.swift":
        "6bcf0f8367120bd0fddeb6b27ca1b768fb3d92bb0182c4cdda5d04cdbe3ce85f",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      expect(createHash("sha256").update(native(relativePath)).digest("hex")).toBe(expected);
    }
  });

  it("keeps the original root geometry, typography, badges and dividers", () => {
    const screen = expo("src/app/(tabs)/discover.tsx");
    for (const contract of [
      "paddingHorizontal: 16",
      "paddingBottom: 20",
      "minHeight: 38",
      "paddingBottom: 2",
      "translateY: 4",
      "marginTop: 12",
      "rowGap: 12",
      "borderRadius: 14",
      "paddingVertical: 14",
      "columnGap: 14",
      "width: 40",
      "height: 40",
      "borderRadius: 11",
      'resizeMode="center"',
      "size={17}",
      "size={14}",
      "translateX: 2",
      "minimumFontScale={0.82}",
      "fontSize: 16",
      "fontSize: 11",
      "divider: { height: 1",
      "marginLeft: 70",
    ]) {
      expect(screen).toContain(contract);
    }
    expect(screen).toContain("momentsUnread");
    expect(screen).toContain("hasNewMoments");
    expect(screen).not.toContain("height: StyleSheet.hairlineWidth");
    expect(screen).not.toContain("fontSize: 16, lineHeight:");
  });

  it("keeps the exact optional-auth config and strict moments-unread contracts", () => {
    const repository = expo("src/services/discover/DiscoverConfigRepository.ts");
    const api = expo("src/api/bwchat.ts");
    expect(repository).toContain('apiRequest<unknown>("/app/discover-config", {');
    expect(repository).toContain("auth: hasToken");
    expect(repository).toContain("refreshAuth: hasToken");
    expect(repository).toContain("invalidateSessionOnUnauthorized: hasToken");
    expect(repository).toContain('cache: "no-store"');
    expect(repository).toContain('"X-App-Version": Application.nativeApplicationVersion');
    expect(repository).toContain('"X-App-Build": Application.nativeBuildVersion');
    expect(repository).toContain("timeoutMs: 8_000");
    expect(api).toContain('apiRequest<unknown>("/moments/notifications/unread", {');
    expect(api).toContain("requiredData: true");
    expect(api).toContain("requiredEnvelope: true");
  });

  it("keeps deferred lifecycle refresh while rejecting blur/account-switch responses", () => {
    const screen = expo("src/app/(tabs)/discover.tsx");
    const policy = expo("src/services/discover/DiscoverRefreshPolicy.ts");
    expect(policy).toContain("discoverRefreshDelayMs = 280");
    expect(policy).toContain("discoverConfigMinimumRefreshIntervalMs = 5 * 60 * 1_000");
    expect(screen).toContain('AppState.addEventListener("change"');
    expect(screen).toContain("readDiscoverRefreshCheckpoint(ownerId)");
    expect(screen).toContain("scheduleDeferredRefresh(false, ownerId)");
    expect(screen).toContain("saveDiscoverRefreshCheckpoint(targetOwnerId, now)");
    expect(screen).toContain("discoverRefreshMayCommit({");
    expect(screen).toContain("activeOwnerId: activeOwnerRef.current");
    expect(screen).toContain("focused: focusedRef.current");
    expect(screen).toContain("useMomentsUnread(accountOwnerId)");
    expect(screen).toContain("useMomentsHasNew(accountOwnerId)");
    expect(screen).toContain(
      "publishMomentsUnreadInfo(accountOwnerId, momentsResult.value, momentsRefresh)",
    );
    expect(screen).toContain("fetchConfig ? fetchDiscoverSections() : Promise.resolve(null)");
    expect(screen).toContain("Promise.allSettled");
  });

  it("preserves stable native upgrades and all remaining dynamic route types", () => {
    const screen = expo("src/app/(tabs)/discover.tsx");
    const navigator = expo("src/services/web/DynamicRouteNavigator.ts");
    expect(screen).toContain('id === "live"');
    expect(screen).toContain('router.push("/live-lobby" as Href)');
    expect(screen).toContain('id === "benefits"');
    expect(screen).toContain('router.push("/activity-center" as Href)');
    expect(screen).toContain('{ type: "native", name: "game_center" }');
    expect(screen).toContain('{ type: "native", name: "script_center" }');
    expect(screen).toContain("openDynamicRoute(");
    expect(screen).toContain("config.webViewPolicy");
    expect(navigator).toContain('if (["web", "h5", "url"].includes(type))');
    expect(navigator).toContain('if (type === "external")');
    expect(navigator).toContain('if (type === "screen")');
  });

  it("keeps current-language copy, dynamic system surfaces and VoiceOver semantics", () => {
    const screen = expo("src/app/(tabs)/discover.tsx");
    const rootTitle = expo("src/components/RootTabTitle.tsx");
    expect(screen).toContain("discoverItemTitle(item, activeLanguage, t)");
    expect(screen).toContain('accessibilityRole="button"');
    expect(rootTitle).toContain('accessibilityRole="header"');
    expect(screen).toContain("backgroundColor: theme.background");
    expect(screen).toContain("backgroundColor: theme.card");
    expect(screen).toContain("color: theme.text");
    expect(screen).toContain("theme.tertiaryText");
  });
});

function expo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function native(relativePath: string): Buffer {
  return readFileSync(resolve(copiedNativeRoot, relativePath));
}
