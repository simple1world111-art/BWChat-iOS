import { fireEvent, render } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { Text } from "react-native";

import { AppGate } from "@/components/AppGate";
import { defaultRemoteConfig } from "@/services/remote-config/defaultConfig";
import type { RemoteConfig } from "@/services/remote-config/types";

const mockUseRemoteConfig = jest.fn();

jest.mock("expo-application", () => ({
  nativeApplicationVersion: "2.0.0",
  nativeBuildVersion: "8",
}));

jest.mock("expo-linking", () => ({ openURL: jest.fn() }));

jest.mock("@/providers/RemoteConfigProvider", () => ({
  useRemoteConfig: () => mockUseRemoteConfig(),
}));

const mockOpenURL = jest.mocked(Linking.openURL);

describe("AppGate native update requirement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRemoteConfig.mockReturnValue(remoteContext(defaultRemoteConfig));
  });

  it("blocks an obsolete native build and opens the configured store URL", async () => {
    mockUseRemoteConfig.mockReturnValue(
      remoteContext({
        ...defaultRemoteConfig,
        minSupportedBuild: 9,
        update: {
          forceUpdate: false,
          storeUrl: "https://apps.apple.com/app/example/id1",
        },
      }),
    );

    const view = await render(
      <AppGate>
        <Text>app-content</Text>
      </AppGate>,
    );

    expect(view.getByText("需要安装新版本")).toBeTruthy();
    expect(view.queryByText("app-content")).toBeNull();
    fireEvent.press(view.getByText("前往更新"));
    expect(mockOpenURL).toHaveBeenCalledWith("https://apps.apple.com/app/example/id1");
  });

  it("keeps the app available when the current native build meets the minimum", async () => {
    mockUseRemoteConfig.mockReturnValue(
      remoteContext({
        ...defaultRemoteConfig,
        minSupportedBuild: 8,
        update: {
          forceUpdate: false,
          storeUrl: "https://apps.apple.com/app/example/id1",
        },
      }),
    );

    const view = await render(
      <AppGate>
        <Text>app-content</Text>
      </AppGate>,
    );

    expect(view.getByText("app-content")).toBeTruthy();
    expect(view.queryByText("需要安装新版本")).toBeNull();
  });
});

function remoteContext(config: RemoteConfig) {
  return {
    config,
    source: "bundled" as const,
    isRefreshing: false,
    error: null,
    isFeatureEnabled: () => true,
    refresh: jest.fn(),
  };
}
