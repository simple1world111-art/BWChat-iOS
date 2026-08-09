import { act, render, waitFor } from "@testing-library/react-native";
import { AppState, InteractionManager, Text, type AppStateStatus } from "react-native";

import { UpdateProvider } from "@/providers/UpdateProvider";
import { checkAndDownloadUpdate } from "@/services/update/UpdateService";

jest.mock("@/services/update/UpdateService", () => ({
  checkAndDownloadUpdate: jest.fn(),
  reloadToApplyUpdate: jest.fn(),
}));

const mockCheckAndDownloadUpdate = jest.mocked(checkAndDownloadUpdate);

describe("UpdateProvider silent automatic checks", () => {
  let appStateListener: ((state: AppStateStatus) => void) | null;
  let interactionTask: (() => void) | null;
  let removeAppStateListener: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    appStateListener = null;
    interactionTask = null;
    removeAppStateListener = jest.fn();
    mockCheckAndDownloadUpdate.mockResolvedValue({ status: "no-update", checkedAt: 1 });
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("checks immediately on launch and downloads without prompting or reloading", async () => {
    mockCheckAndDownloadUpdate.mockResolvedValue({ status: "downloaded", checkedAt: 2 });

    await render(
      <UpdateProvider>
        <Text>App</Text>
      </UpdateProvider>,
    );

    await runInitialCheck();
    await waitFor(() => expect(mockCheckAndDownloadUpdate).toHaveBeenCalledWith(true));
  });

  test("uses the persisted throttle when the app returns to the foreground", async () => {
    await render(
      <UpdateProvider>
        <Text>App</Text>
      </UpdateProvider>,
    );

    await runInitialCheck();
    await act(async () => {
      appStateListener?.("background");
      appStateListener?.("active");
      await Promise.resolve();
    });
    await waitFor(() => expect(mockCheckAndDownloadUpdate).toHaveBeenLastCalledWith(false));
  });

  test("removes the foreground listener on unmount", async () => {
    const view = await render(
      <UpdateProvider>
        <Text>App</Text>
      </UpdateProvider>,
    );

    await act(async () => view.unmount());
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  });

  async function runInitialCheck(): Promise<void> {
    await act(async () => {
      interactionTask?.();
      await Promise.resolve();
    });
  }
});
