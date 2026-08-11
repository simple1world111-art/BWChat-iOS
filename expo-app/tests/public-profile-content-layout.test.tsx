import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";

import {
  PublicProfileContent,
  type PublicProfileContentTab,
} from "@/components/profile/PublicProfileContent";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("expo-symbols", () => ({ SymbolView: () => null }));
jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    LinearGradient: ({ children }: { children: ReactNode }) => <MockView>{children}</MockView>,
  };
});
jest.mock("@expo/ui/community/menu", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { MenuView: ({ children }: { children: ReactNode }) => <MockView>{children}</MockView> };
});
jest.mock("@/components/Avatar", () => ({ Avatar: () => null }));
jest.mock("@/components/AuthenticatedImage", () => ({ AuthenticatedImage: () => null }));
jest.mock("@/components/media/ImageGallery", () => ({
  ImageGallery: () => null,
  ImageGallerySource: () => null,
}));
jest.mock("@/components/media/VideoPlayerOverlay", () => ({ VideoPlayerOverlay: () => null }));
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));
jest.mock("@/services/moments/MomentMutationStore", () => ({
  subscribeMomentMutation: () => () => undefined,
}));
jest.mock("@/services/navigation/NavigationSnapshotCache", () => ({
  readNavigationSnapshot: jest.fn(() => undefined),
  writeNavigationSnapshot: jest.fn(),
}));
jest.mock("@/api/bwchat", () => ({
  getPublicAgentsPage: jest.fn(async () => ({ agents: [], has_more: false })),
  getUserMoments: jest.fn(async () => ({ moments: [], has_more: false })),
  getUserShortDramaSeries: jest.fn(async () => ({ series: [], has_more: false })),
  toggleMomentLike: jest.fn(async () => false),
}));
jest.mock("@/services/profile/PublicProfileContentRepository", () => {
  const actual = jest.requireActual("@/services/profile/PublicProfileContentRepository");
  return {
    ...actual,
    readCachedProfileAgentsSnapshot: jest.fn(async () => null),
    readCachedProfileMomentsSnapshot: jest.fn(async () => null),
    readCachedProfileShortDramasSnapshot: jest.fn(async () => null),
    saveCachedProfileAgents: jest.fn(async () => undefined),
    saveCachedProfileMoments: jest.fn(async () => undefined),
    saveCachedProfileShortDramas: jest.fn(async () => undefined),
  };
});

describe("public profile tab pane layout", () => {
  it("reuses premeasured pane heights without display-based relayout", async () => {
    const props = {
      isVisible: true,
      onMomentCountChange: jest.fn(),
      onOpenAgent: jest.fn(),
      onOpenShortDrama: jest.fn(),
      onToast: jest.fn(),
      ownerId: "owner",
      targetId: "target",
      viewer: { user_id: "owner", nickname: "Owner", avatar_url: "" },
    };
    const view = await render(<PublicProfileContent {...props} tab="moments" />);

    await fireEvent(view.getByTestId("public-profile-pane-moments"), "layout", {
      nativeEvent: { layout: { height: 640, width: 390, x: 0, y: 0 } },
    });
    await fireEvent(view.getByTestId("public-profile-pane-agents", hidden), "layout", {
      nativeEvent: { layout: { height: 320, width: 390, x: 0, y: 0 } },
    });
    await fireEvent(view.getByTestId("public-profile-pane-short-dramas", hidden), "layout", {
      nativeEvent: { layout: { height: 480, width: 390, x: 0, y: 0 } },
    });

    await waitFor(() => expect(hostHeight(view.getByTestId("public-profile-pane-host"))).toBe(640));
    await expectActivePane(view, "moments");
    expect(view.queryByTestId("moment-pane-cover")).toBeNull();

    await view.rerender(<PublicProfileContent {...props} tab="agents" />);
    await waitFor(() => expect(hostHeight(view.getByTestId("public-profile-pane-host"))).toBe(320));
    await expectActivePane(view, "agents");
    expect(view.getByTestId("moment-pane-cover")).toBeTruthy();

    await view.rerender(<PublicProfileContent {...props} tab="shortDramas" />);
    await waitFor(() => expect(hostHeight(view.getByTestId("public-profile-pane-host"))).toBe(480));
    await expectActivePane(view, "shortDramas");
    expect(view.getByTestId("moment-pane-cover")).toBeTruthy();
  });
});

function hostHeight(
  element: ReturnType<Awaited<ReturnType<typeof render>>["getByTestId"]>,
): number {
  return StyleSheet.flatten(element.props.style).height as number;
}

async function expectActivePane(
  view: Awaited<ReturnType<typeof render>>,
  active: PublicProfileContentTab,
) {
  const testIds: Record<PublicProfileContentTab, string> = {
    moments: "public-profile-pane-moments",
    agents: "public-profile-pane-agents",
    shortDramas: "public-profile-pane-short-dramas",
  };
  for (const candidate of Object.keys(testIds) as PublicProfileContentTab[]) {
    const pane = view.getByTestId(testIds[candidate], hidden);
    const style = StyleSheet.flatten(pane.props.style);
    expect(style.position).toBe("absolute");
    expect(style.opacity).toBe(candidate === "moments" || candidate === active ? 1 : 0);
    expect(pane.props.pointerEvents).toBe(candidate === active ? "auto" : "none");
  }
}

const hidden = { includeHiddenElements: true } as const;
