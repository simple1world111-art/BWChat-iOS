import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import { changePassword } from "@/api/bwchat";
import ChangePasswordScreen from "@/app/change-password";

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@/api/bwchat", () => ({ changePassword: jest.fn() }));

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    TopToast: ({ message }: { message: string | null }) =>
      message ? <MockText accessibilityLabel="toast">{message}</MockText> : null,
  };
});

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

const requestPasswordChange = jest.mocked(changePassword);

describe("Change Password screen interactions", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("shows only validation errors in the notice card and exposes all password controls", async () => {
    const view = await render(<ChangePasswordScreen />);
    expect(view.queryByText("password.validation.currentRequired")).toBeNull();
    expect(view.getAllByLabelText("password.show")).toHaveLength(3);
    expect(view.getAllByTestId("profile-field-divider")).toHaveLength(2);
    for (const divider of view.getAllByTestId("profile-field-divider")) {
      expect(divider.props.style).toMatchObject({ alignSelf: "stretch" });
      expect(divider.props.style).not.toHaveProperty("marginLeft");
    }

    const current = view.getByLabelText("password.current");
    expect(current.props.secureTextEntry).toBe(true);
    await fireEvent.press(view.getAllByLabelText("password.show")[0]!);
    expect(view.getByLabelText("password.current").props.secureTextEntry).toBe(false);
    expect(view.getByLabelText("password.hide").props.accessibilityRole).toBe("button");

    await fireEvent.changeText(view.getByLabelText("password.current"), "old123");
    expect(view.getByText("password.validation.tooShort")).toBeTruthy();
    expect(view.queryByLabelText("toast")).toBeNull();
  });

  it("locks a pending request, clears fields, shows success Toast and pops after 650ms", async () => {
    const pending = deferred<void>();
    requestPasswordChange.mockReturnValueOnce(pending.promise);
    const view = await render(<ChangePasswordScreen />);
    await fillValidForm(view);

    await fireEvent.press(view.getByLabelText("password.save"));
    expect(requestPasswordChange).toHaveBeenCalledTimes(1);
    expect(requestPasswordChange).toHaveBeenCalledWith("old123", "new123");
    expect(view.getByLabelText("common.saving").props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    await fireEvent.press(view.getByLabelText("common.saving"));
    expect(requestPasswordChange).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(view.getByLabelText("password.current").props.value).toBe("");
    expect(view.getByLabelText("password.new").props.value).toBe("");
    expect(view.getByLabelText("password.confirm").props.value).toBe("");
    expect(view.getByLabelText("toast").props.children).toBe("password.updated");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(649);
    });
    expect(router.back).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("shows API failures as Toast without replacing the validation card", async () => {
    requestPasswordChange.mockRejectedValueOnce(new Error("current password is invalid"));
    const view = await render(<ChangePasswordScreen />);
    await fillValidForm(view);
    await fireEvent.press(view.getByLabelText("password.save"));

    await waitFor(() =>
      expect(view.getByLabelText("toast").props.children).toBe("current password is invalid"),
    );
    expect(view.queryByText("password.validation.tooShort")).toBeNull();
    expect(view.queryByText("password.validation.confirmMismatch")).toBeNull();
  });
});

async function fillValidForm(view: Awaited<ReturnType<typeof render>>): Promise<void> {
  await fireEvent.changeText(view.getByLabelText("password.current"), "old123");
  await fireEvent.changeText(view.getByLabelText("password.new"), "new123");
  await fireEvent.changeText(view.getByLabelText("password.confirm"), "new123");
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
