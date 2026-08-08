import * as Sentry from "@sentry/react-native";

import {
  initializeMonitoring,
  recordUpdateCheckState,
} from "@/services/monitoring/MonitoringService";

jest.mock("@sentry/react-native", () => ({
  init: jest.fn(),
  setTags: jest.fn(),
  withScope: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock("expo-application", () => ({
  nativeApplicationVersion: "1.2.3",
  nativeBuildVersion: "42",
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "fallback" } },
}));

jest.mock("expo-device", () => ({
  modelName: "iPhone Test",
  osVersion: "26.4",
}));

jest.mock("expo-updates", () => ({
  runtimeVersion: "runtime-test",
  updateId: "update-test",
  channel: "preview",
  isEmbeddedLaunch: false,
}));

jest.mock("@/config/env", () => ({
  env: { environment: "preview", sentryDsn: "https://public@example.invalid/1" },
}));

describe("MonitoringService update metadata", () => {
  test("initializes privacy-safe release, device, and EAS update tags", () => {
    initializeMonitoring();

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        sendDefaultPii: false,
        tracesSampleRate: 0,
      }),
    );
    expect(Sentry.setTags).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "preview",
        app_version: "1.2.3",
        build_number: "42",
        runtime_version: "runtime-test",
        update_id: "update-test",
        channel: "preview",
        platform: expect.any(String),
        device_os: "26.4",
        device: "iPhone Test",
        embedded_update: "false",
      }),
    );
  });

  test("records the most recent check time and result as monitoring tags", () => {
    recordUpdateCheckState("downloaded", Date.UTC(2026, 7, 7, 1, 2, 3));

    expect(Sentry.setTags).toHaveBeenLastCalledWith({
      last_update_check_at: "2026-08-07T01:02:03.000Z",
      last_update_check_result: "downloaded",
    });
  });
});
