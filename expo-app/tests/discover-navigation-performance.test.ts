import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Discover destination navigation performance", () => {
  const destinations = [
    "src/app/moments.tsx",
    "src/app/game-center.tsx",
    "src/app/script-center.tsx",
    "src/app/short-drama-series.tsx",
    "src/app/live-lobby.tsx",
    "src/app/group-list.tsx",
    "src/app/activity-center.tsx",
  ];

  it.each(destinations)("keeps the native header options stable in %s", (relativePath) => {
    const screen = source(relativePath);
    expect(screen).toContain("useMemo<NativeStackNavigationOptions>");
    expect(screen).toContain("<Stack.Screen options={headerOptions} />");
  });

  it("keeps first-load state work out of the native-stack transition", () => {
    for (const relativePath of destinations.filter(
      (value) => value !== "src/app/activity-center.tsx",
    )) {
      expect(source(relativePath)).toContain("runAfterNavigationInteractions");
    }
    expect(source("src/services/activity/useActivityCenter.ts")).toContain(
      "runAfterNavigationInteractions",
    );
    expect(source("src/services/live/useLiveLobby.ts")).toContain("runAfterNavigationInteractions");
    const scheduler = source("src/services/navigation/NavigationWorkScheduler.ts");
    expect(scheduler).toContain("NAVIGATION_TRANSITION_GUARD_MS");
    expect(scheduler).toContain("!interactionsSettled || !transitionGuardSettled");
  });

  it("does not mount the hidden game WebView until navigation work settles", () => {
    const gameCenter = source("src/app/game-center.tsx");
    expect(gameCenter).toContain("useNavigationInteractionsSettled");
    expect(gameCenter).toContain("navigationInteractionsSettled ? <GameWebViewPrewarmer /> : null");
  });

  it("restores account-scoped display snapshots before background revalidation", () => {
    for (const relativePath of destinations) {
      expect(source(relativePath)).toContain("NavigationSnapshotCache");
    }
    expect(source("src/services/activity/useActivityCenter.ts")).toContain(
      "NavigationSnapshotCache",
    );
    expect(source("src/services/live/useLiveLobby.ts")).toContain("NavigationSnapshotCache");
  });

  it("keeps automatic short-drama revalidation out of the pull-to-refresh indicator", () => {
    const shortDrama = source("src/app/short-drama-series.tsx");
    expect(shortDrama).toContain("isLoading: state.series.length === 0");
    expect(shortDrama).toContain("refreshing={current.isRefreshing}");
    expect(shortDrama).toContain("load(filter, true, true, true)");
  });
});
