import { render, waitFor } from "@testing-library/react-native";

import UpdateSettingsScreen from "@/app/update-settings";
import { env } from "@/config/env";
import { getUpdateMetadata } from "@/services/update/UpdateService";

const mockUpdate = {
  result: null,
  isChecking: false,
  check: jest.fn(),
  reload: jest.fn(),
};
const mockRemote = {
  config: {
    configVersion: 1,
    features: { maintenanceMode: false, paymentEnabled: true },
    killSwitch: { enabled: false },
  },
  source: "embedded",
  isRefreshing: false,
  error: null,
  refresh: jest.fn(),
};

jest.mock("expo-application", () => ({
  nativeApplicationVersion: "1.0.0",
  nativeBuildVersion: "8",
}));

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));

jest.mock("@/config/env", () => ({
  env: {
    environment: "preview",
    apiBaseUrl: "https://api.example.com/api/v1",
  },
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    activeLanguage: "zh-Hans",
    t: (key: string) => key,
  }),
}));

jest.mock("@/providers/RemoteConfigProvider", () => ({
  useRemoteConfig: () => mockRemote,
}));

jest.mock("@/providers/UpdateProvider", () => ({
  useAppUpdate: () => mockUpdate,
}));

jest.mock("@/services/monitoring/MonitoringService", () => ({
  captureException: jest.fn(),
}));

jest.mock("@/services/native/NativeCapabilities", () => ({
  getCurrentLocation: jest.fn(),
  pickChatMedia: jest.fn(),
  requestPushPermission: jest.fn(),
}));

jest.mock("@/services/update/UpdateService", () => ({
  getLastUpdateCheck: jest.fn(() => Promise.resolve(null)),
  getUpdateMetadata: jest.fn(),
}));

const mockedMetadata = jest.mocked(getUpdateMetadata);
const mutableEnv = env as { environment: "development" | "preview" | "production" };

describe("Update settings OTA acceptance marker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mutableEnv.environment = "preview";
    mockedMetadata.mockReturnValue({
      channel: "preview",
      runtimeVersion: "runtime-preview",
      updateId: "update-preview",
      isEmbeddedLaunch: false,
    });
  });

  test("shows the marker only after a Preview OTA launch", async () => {
    const view = await render(<UpdateSettingsScreen />);

    await waitFor(() =>
      expect(view.getByText("EAS OTA 更新 · OTA-PREVIEW-20260809-01")).toBeTruthy(),
    );
    expect(view.getByText("preview / preview")).toBeTruthy();
    expect(view.getByText("update-preview")).toBeTruthy();
  });

  test("keeps the embedded Preview source unchanged", async () => {
    mockedMetadata.mockReturnValue({
      channel: "preview",
      runtimeVersion: "runtime-preview",
      updateId: "embedded-preview",
      isEmbeddedLaunch: true,
    });

    const view = await render(<UpdateSettingsScreen />);

    await waitFor(() => expect(view.getByText("安装包内置版本")).toBeTruthy());
    expect(view.queryByText(/OTA-PREVIEW-20260809-01/)).toBeNull();
  });

  test("never shows the Preview marker in Production OTA", async () => {
    mutableEnv.environment = "production";
    mockedMetadata.mockReturnValue({
      channel: "production",
      runtimeVersion: "runtime-production",
      updateId: "update-production",
      isEmbeddedLaunch: false,
    });

    const view = await render(<UpdateSettingsScreen />);

    await waitFor(() => expect(view.getByText("EAS OTA 更新")).toBeTruthy());
    expect(view.queryByText(/OTA-PREVIEW-20260809-01/)).toBeNull();
  });
});
