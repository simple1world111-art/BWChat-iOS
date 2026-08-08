import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";

import {
  checkAndDownloadUpdate,
  getLastUpdateCheck,
  getUpdateMetadata,
  reloadToApplyUpdate,
} from "@/services/update/UpdateService";
import {
  captureException,
  captureMessage,
  recordUpdateCheckState,
} from "@/services/monitoring/MonitoringService";

jest.mock("expo-updates", () => ({
  isEnabled: true,
  channel: "preview",
  runtimeVersion: "runtime-test",
  updateId: "update-test",
  isEmbeddedLaunch: false,
  UpdateCheckResultNotAvailableReason: {
    NO_UPDATE_AVAILABLE_ON_SERVER: "noUpdateAvailableOnServer",
  },
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

jest.mock("@/config/env", () => ({
  env: { environment: "preview" },
}));

jest.mock("@/services/monitoring/MonitoringService", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  recordUpdateCheckState: jest.fn(),
}));

const mockedCaptureException = jest.mocked(captureException);
const mockedCaptureMessage = jest.mocked(captureMessage);
const mockedRecordUpdateCheckState = jest.mocked(recordUpdateCheckState);
const mockCheckForUpdateAsync = jest.mocked(Updates.checkForUpdateAsync);
const mockFetchUpdateAsync = jest.mocked(Updates.fetchUpdateAsync);
const mockReloadAsync = jest.mocked(Updates.reloadAsync);
const originalDev = __DEV__;
type NativeCheckResult = Awaited<ReturnType<typeof Updates.checkForUpdateAsync>>;
const nativeNoUpdate: NativeCheckResult = {
  isAvailable: false,
  manifest: undefined,
  isRollBackToEmbedded: false,
  reason: Updates.UpdateCheckResultNotAvailableReason.NO_UPDATE_AVAILABLE_ON_SERVER,
};
const nativeUpdateAvailable = {
  isAvailable: true,
  manifest: {},
  isRollBackToEmbedded: false,
  reason: undefined,
} as NativeCheckResult;

describe("UpdateService", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: false });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: originalDev });
  });

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    mockCheckForUpdateAsync.mockResolvedValue(nativeNoUpdate);
    mockFetchUpdateAsync.mockResolvedValue({
      isNew: false,
      manifest: undefined,
      isRollBackToEmbedded: false,
    });
    mockReloadAsync.mockResolvedValue(undefined);
  });

  test("development mode disables OTA calls", async () => {
    Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: true });

    await expect(checkAndDownloadUpdate()).resolves.toEqual({ status: "disabled" });
    expect(mockCheckForUpdateAsync).not.toHaveBeenCalled();

    Object.defineProperty(globalThis, "__DEV__", { configurable: true, value: false });
  });

  test("persists a successful no-update check and throttles the next automatic check", async () => {
    const first = await checkAndDownloadUpdate();
    const second = await checkAndDownloadUpdate();

    expect(first.status).toBe("no-update");
    if (first.status !== "no-update") throw new Error("Expected a no-update result");
    expect(second).toEqual({ status: "throttled", checkedAt: first.checkedAt });
    expect(mockCheckForUpdateAsync).toHaveBeenCalledTimes(1);
    await expect(getLastUpdateCheck()).resolves.toEqual({
      checkedAt: first.checkedAt,
      result: "no-update",
    });
    expect(mockedRecordUpdateCheckState).toHaveBeenLastCalledWith("no-update", first.checkedAt);
  });

  test("downloads an available update without reloading the running app", async () => {
    mockCheckForUpdateAsync.mockResolvedValueOnce(nativeUpdateAvailable);

    const result = await checkAndDownloadUpdate();

    expect(result.status).toBe("downloaded");
    expect(mockFetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(mockReloadAsync).not.toHaveBeenCalled();
    expect(mockedCaptureMessage).toHaveBeenCalledWith("OTA update downloaded", {
      channel: "preview",
    });
  });

  test("force bypasses the persisted throttle but concurrent requests share one native check", async () => {
    await checkAndDownloadUpdate();
    const deferred = deferredResult<NativeCheckResult>();
    mockCheckForUpdateAsync.mockReturnValueOnce(deferred.promise);

    const first = checkAndDownloadUpdate(true);
    const second = checkAndDownloadUpdate(true);
    deferred.resolve(nativeNoUpdate);

    await expect(first).resolves.toMatchObject({ status: "no-update" });
    await expect(second).resolves.toMatchObject({ status: "no-update" });
    expect(mockCheckForUpdateAsync).toHaveBeenCalledTimes(2);
  });

  test("update errors are reported as data and do not reject startup", async () => {
    mockCheckForUpdateAsync.mockRejectedValueOnce(new Error("offline"));

    await expect(checkAndDownloadUpdate()).resolves.toMatchObject({
      status: "error",
      message: "offline",
    });
    expect(mockedCaptureException).toHaveBeenCalledWith(expect.any(Error), {
      operation: "ota_check_download",
    });
  });

  test("storage read and write failures do not block the native update check", async () => {
    const readFailure = jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("read"));
    const writeFailure = jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("write"));

    await expect(checkAndDownloadUpdate()).resolves.toMatchObject({ status: "no-update" });
    expect(mockCheckForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(mockedCaptureException).toHaveBeenCalledWith(expect.any(Error), {
      operation: "ota_state_read",
    });
    expect(mockedCaptureException).toHaveBeenCalledWith(expect.any(Error), {
      operation: "ota_state_write",
    });

    readFailure.mockRestore();
    writeFailure.mockRestore();
  });

  test("reload applies a downloaded update and surfaces reload failures", async () => {
    await reloadToApplyUpdate();
    expect(mockReloadAsync).toHaveBeenCalledTimes(1);

    mockReloadAsync.mockRejectedValueOnce(new Error("reload"));
    await expect(reloadToApplyUpdate()).rejects.toThrow("reload");
    expect(mockedCaptureException).toHaveBeenCalledWith(expect.any(Error), {
      operation: "ota_reload",
    });
  });

  test("exposes channel and runtime diagnostics without account data", () => {
    expect(getUpdateMetadata()).toEqual({
      channel: Updates.channel,
      runtimeVersion: Updates.runtimeVersion,
      updateId: Updates.updateId,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    });
  });
});

function deferredResult<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
