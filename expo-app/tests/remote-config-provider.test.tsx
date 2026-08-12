import { render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { RemoteConfigProvider, useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { defaultRemoteConfig } from "@/services/remote-config/defaultConfig";
import {
  fetchRemoteConfig,
  readCachedRemoteConfig,
  shouldRefreshRemoteConfig,
} from "@/services/remote-config/RemoteConfigService";

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: null }),
}));

jest.mock("@/services/monitoring/MonitoringService", () => ({
  captureException: jest.fn(),
}));

jest.mock("@/services/remote-config/RemoteConfigService", () => {
  const actual = jest.requireActual("@/services/remote-config/RemoteConfigService");
  return {
    ...actual,
    fetchRemoteConfig: jest.fn(),
    readCachedRemoteConfig: jest.fn(),
    shouldRefreshRemoteConfig: jest.fn(),
  };
});

const mockFetchRemoteConfig = jest.mocked(fetchRemoteConfig);
const mockReadCachedRemoteConfig = jest.mocked(readCachedRemoteConfig);
const mockShouldRefreshRemoteConfig = jest.mocked(shouldRefreshRemoteConfig);

describe("RemoteConfigProvider cache migration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("bypasses interval and ETag once when an old cache lacks account", async () => {
    const oldCache = { ...defaultRemoteConfig, account: undefined };
    const refreshed = {
      ...defaultRemoteConfig,
      configVersion: "same-version",
      account: {
        privacyScreenId: "privacy_policy",
        dataPrivacyScreenId: "data_privacy",
        accountDeletionUrl: "https://id7.com/account-deletion",
        supportEmail: "refreshed@example.com",
      },
    };
    mockReadCachedRemoteConfig.mockResolvedValue(oldCache);
    mockShouldRefreshRemoteConfig.mockResolvedValue(false);
    mockFetchRemoteConfig.mockResolvedValue({ config: refreshed, source: "remote" });

    const view = await render(
      <RemoteConfigProvider>
        <RemoteConfigProbe />
      </RemoteConfigProvider>,
    );

    await waitFor(() => expect(mockFetchRemoteConfig).toHaveBeenCalledTimes(1));
    expect(mockFetchRemoteConfig).toHaveBeenCalledWith(undefined, 8_000, {
      ignoreETag: true,
    });
    expect(view.getByText("refreshed@example.com")).toBeTruthy();
  });
});

function RemoteConfigProbe() {
  const { config } = useRemoteConfig();
  return <Text>{config.account?.supportEmail ?? "missing"}</Text>;
}
