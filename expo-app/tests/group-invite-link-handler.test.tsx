import { act, render, waitFor } from "@testing-library/react-native";

import { GroupInviteLinkHandler } from "@/components/GroupInviteLinkHandler";
import { defaultRemoteConfig } from "@/services/remote-config/RemoteConfigService";
import type { RemoteConfig } from "@/services/remote-config/types";

let mockUserId: string | undefined;
let mockConfig: RemoteConfig = defaultRemoteConfig;
let mockInitialURL: string | null = null;
let mockURLListener: ((event: { url: string }) => void) | undefined;
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
const mockRemove = jest.fn();

jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    dismissAll: () => mockDismissAll(),
  },
}));
jest.mock("expo-linking", () => ({
  getInitialURL: () => Promise.resolve(mockInitialURL),
  addEventListener: (_type: string, listener: (event: { url: string }) => void) => {
    mockURLListener = listener;
    return { remove: mockRemove };
  },
}));
jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockUserId ? { user_id: mockUserId } : null }),
}));
jest.mock("@/providers/RemoteConfigProvider", () => ({
  useRemoteConfig: () => ({ config: mockConfig }),
}));

describe("native group invite cold/hot link lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = undefined;
    mockConfig = enabledConfig();
    mockInitialURL = null;
    mockURLListener = undefined;
  });

  it("holds one cold-start token until authentication and then delivers it once", async () => {
    mockInitialURL = "bwchat://group-invite/abcDEF_123-xyz";
    const view = await render(<GroupInviteLinkHandler />);
    await act(async () => Promise.resolve());
    expect(mockPush).not.toHaveBeenCalled();

    mockUserId = "owner-a";
    await view.rerender(<GroupInviteLinkHandler />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/group-invite-preview",
      params: { token: "abcDEF_123-xyz", delivery: "1" },
    });
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/conversations");
    await view.rerender(<GroupInviteLinkHandler />);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("drops authenticated links unless both native feature flags are enabled", async () => {
    mockUserId = "owner-a";
    mockInitialURL = "https://example.com/group-invites/abcDEF_123-xyz";
    mockConfig = { ...enabledConfig(), featureFlags: [{ key: "group_info_v2", enabled: true }] };
    await render(<GroupInviteLinkHandler />);
    await act(async () => Promise.resolve());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("routes a valid hot link and ignores malformed tokens", async () => {
    mockUserId = "owner-a";
    await render(<GroupInviteLinkHandler />);
    expect(mockURLListener).toBeDefined();
    await act(async () => mockURLListener?.({ url: "bwchat://group-invite/short" }));
    expect(mockPush).not.toHaveBeenCalled();
    await act(async () =>
      mockURLListener?.({ url: "https://example.com/join/group/abcDEF_123-xyz" }),
    );
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

function enabledConfig(): RemoteConfig {
  return {
    ...defaultRemoteConfig,
    featureFlags: [
      { key: "group_info_v2", enabled: true },
      { key: "group_invite_qr_v1", enabled: true },
    ],
  };
}
