import { selectMainTab, selectMainTabThenPush } from "@/services/main-tab/MainTabNavigation";
import {
  publishActiveMainTabEntries,
  resetActiveMainTabEntriesForTests,
  resolveMainTabEntries,
} from "@/services/main-tab/MainTabRegistry";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissAll = jest.fn();

jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    dismissAll: () => mockDismissAll(),
  },
}));

describe("MainTab deep-link selection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetActiveMainTabEntriesForTests();
  });

  it("selects each required native root directly", () => {
    selectMainTab("messages");
    selectMainTab("map");
    selectMainTab("discover");
    selectMainTab("profile");
    expect(mockReplace).toHaveBeenNthCalledWith(1, "/(tabs)/conversations");
    expect(mockReplace).toHaveBeenNthCalledWith(2, "/(tabs)/map");
    expect(mockReplace).toHaveBeenNthCalledWith(3, "/(tabs)/discover");
    expect(mockReplace).toHaveBeenNthCalledWith(4, "/(tabs)/profile");
    expect(mockDismissAll).toHaveBeenCalledTimes(4);
  });

  it("installs the required tab underneath before pushing the destination", async () => {
    const destination = { pathname: "/chat/[id]", params: { id: "friend" } } as const;
    selectMainTabThenPush("messages", destination);
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/conversations");
    expect(mockPush).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(mockPush).toHaveBeenCalledWith(destination);
    expect(mockDismissAll.mock.invocationCallOrder[0]!).toBeLessThan(
      mockReplace.mock.invocationCallOrder[0]!,
    );
    expect(mockReplace.mock.invocationCallOrder[0]!).toBeLessThan(
      mockPush.mock.invocationCallOrder[0]!,
    );
  });

  it("selects the active slot by descriptor id when a required id is remotely repurposed", () => {
    publishActiveMainTabEntries(
      resolveMainTabEntries([
        { id: "messages", route: { type: "screen", name: "support", screenId: "support" } },
        { id: "discover", route: { type: "native", name: "discover" } },
        { id: "profile", route: { type: "native", name: "profile" } },
      ]),
    );
    expect(selectMainTab("messages")).toBe(true);
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/dynamic-tab-00");
    expect(selectMainTab("map")).toBe(false);
  });
});
