import { act, render, waitFor } from "@testing-library/react-native";
import { Alert, AppState, InteractionManager, Text, type AppStateStatus } from "react-native";

import { UpdateProvider } from "@/providers/UpdateProvider";
import { checkAndDownloadUpdate, reloadToApplyUpdate } from "@/services/update/UpdateService";

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ activeLanguage: "zh-Hans" }),
}));

jest.mock("@/services/update/UpdateService", () => ({
  checkAndDownloadUpdate: jest.fn(),
  reloadToApplyUpdate: jest.fn(),
}));

const mockCheckAndDownloadUpdate = jest.mocked(checkAndDownloadUpdate);
const mockReloadToApplyUpdate = jest.mocked(reloadToApplyUpdate);

describe("UpdateProvider automatic update prompt", () => {
  let appStateListener: ((state: AppStateStatus) => void) | null;
  let interactionTask: (() => void) | null;
  let removeAppStateListener: jest.Mock;
  let alert: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListener = null;
    interactionTask = null;
    removeAppStateListener = jest.fn();
    mockCheckAndDownloadUpdate.mockResolvedValue({ status: "no-update", checkedAt: 1 });
    mockReloadToApplyUpdate.mockResolvedValue(undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(InteractionManager, "runAfterInteractions").mockImplementation((task) => {
      interactionTask =
        typeof task === "function" ? task : () => void (task ? task.gen() : undefined);
      const completion = Promise.resolve();
      return {
        then: completion.then.bind(completion),
        done: jest.fn(),
        cancel: jest.fn(),
      };
    });
    jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
      appStateListener = listener;
      return { remove: removeAppStateListener };
    });
    alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("checks immediately on launch and prompts to restart after downloading", async () => {
    mockCheckAndDownloadUpdate.mockResolvedValue({
      status: "downloaded",
      checkedAt: 2,
      updateId: "ota-2",
    });

    await render(
      <UpdateProvider>
        <Text>App</Text>
      </UpdateProvider>,
    );

    await runInitialCheck();
    await waitFor(() => expect(mockCheckAndDownloadUpdate).toHaveBeenCalledWith(true));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      "应用新版本",
      "最近累积的更新已合并下载。现在可立即重启，或在下次冷启动时自动生效。",
      expect.arrayContaining([
        expect.objectContaining({ text: "稍后", style: "cancel" }),
        expect.objectContaining({ text: "立即重启" }),
      ]),
      { cancelable: false },
    );

    const buttons = alert.mock.calls[0]?.[2] as
      { text?: string; onPress?: () => void }[] | undefined;
    const apply = buttons?.find((button) => button.text === "立即重启");
    await act(async () => {
      apply?.onPress?.();
      await Promise.resolve();
    });
    expect(mockReloadToApplyUpdate).toHaveBeenCalledTimes(1);
  });

  test("throttles foreground checks and never prompts twice for the same update ID", async () => {
    mockCheckAndDownloadUpdate.mockResolvedValue({
      status: "downloaded",
      checkedAt: 3,
      updateId: "ota-3",
    });

    await render(
      <UpdateProvider>
        <Text>App</Text>
      </UpdateProvider>,
    );

    await runInitialCheck();
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    await act(async () => {
      appStateListener?.("background");
      appStateListener?.("active");
      await Promise.resolve();
    });
    await waitFor(() => expect(mockCheckAndDownloadUpdate).toHaveBeenLastCalledWith(false));
    expect(alert).toHaveBeenCalledTimes(1);
  });

  test("does not prompt when the installed update is current", async () => {
    await render(
      <UpdateProvider>
        <Text>App</Text>
      </UpdateProvider>,
    );

    await runInitialCheck();
    await waitFor(() => expect(mockCheckAndDownloadUpdate).toHaveBeenCalledWith(true));
    expect(alert).not.toHaveBeenCalled();
  });

  async function runInitialCheck(): Promise<void> {
    await act(async () => {
      interactionTask?.();
      await Promise.resolve();
    });
  }
});
