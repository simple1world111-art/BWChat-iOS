import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import { updateUsername } from "@/api/bwchat";
import { APIError } from "@/api/client";
import UsernameResetScreen from "@/app/username-reset";
import type { User } from "@/models";

const mockUpdateUser = jest.fn<Promise<void>, [User]>();

jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@/api/bwchat", () => ({ updateUsername: jest.fn() }));

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    TopToast: ({ message }: { message: string | null }) =>
      message ? <MockText accessibilityLabel="toast">{message}</MockText> : null,
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: {
      user_id: "me",
      username: "owner",
      nickname: "Owner",
      avatar_url: "/avatars/me.jpg",
      bio: "",
      gender: "",
      birthday: "",
      location: "",
      following_count: 0,
      follower_count: 0,
      followed_by_me: false,
      follows_me: false,
      is_friend: false,
    },
    updateUser: mockUpdateUser,
  }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    activeLanguage: "en",
    t: (key: string, ...args: (string | number)[]) =>
      args.length ? `${key}:${args.join("|")}` : key,
  }),
}));

const requestUsernameUpdate = jest.mocked(updateUsername);

describe("Username Reset screen interactions", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockUpdateUser.mockResolvedValue();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("keeps over-limit input visible and shows only the native validation banner", async () => {
    const view = await render(<UsernameResetScreen />);
    const input = view.getByLabelText("username.reset.field");
    expect(view.getByText("username.reset.same")).toBeTruthy();

    const overLimit = "a".repeat(21);
    await fireEvent.changeText(input, overLimit);
    expect(view.getByLabelText("username.reset.field").props.value).toBe(overLimit);
    expect(view.getByText("username.reset.tooLong")).toBeTruthy();
    expect(view.queryByLabelText("toast")).toBeNull();
  });

  it("locks a pending submit, persists the returned user and pops after 650ms", async () => {
    const pending = deferred<ReturnType<typeof userFixture>>();
    requestUsernameUpdate.mockReturnValueOnce(pending.promise);
    const view = await render(<UsernameResetScreen />);
    await fireEvent.changeText(view.getByLabelText("username.reset.field"), " next-owner ");
    const submit = view.getByLabelText("username.reset.action");

    await fireEvent.press(submit);
    await fireEvent.press(view.getByLabelText("common.saving"));
    expect(requestUsernameUpdate).toHaveBeenCalledTimes(1);
    expect(requestUsernameUpdate).toHaveBeenCalledWith("next-owner");

    const nextUser = userFixture({ username: "next-owner" });
    await act(async () => {
      pending.resolve(nextUser);
      await pending.promise;
    });
    expect(mockUpdateUser).toHaveBeenCalledWith(nextUser);
    expect(view.getByLabelText("toast").props.children).toBe("username.reset.updated");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(649);
    });
    expect(router.back).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1);
    });
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("shows server failures as a toast without replacing the validation-card state", async () => {
    requestUsernameUpdate.mockRejectedValueOnce(
      new APIError("rejected", 409, { code: "username_already_taken" }),
    );
    const view = await render(<UsernameResetScreen />);
    await fireEvent.changeText(view.getByLabelText("username.reset.field"), "next-owner");
    await fireEvent.press(view.getByLabelText("username.reset.action"));

    await waitFor(() =>
      expect(view.getByLabelText("toast").props.children).toBe("username.reset.taken"),
    );
    expect(view.queryByText("username.reset.tooLong")).toBeNull();
    expect(view.queryByText("username.reset.same")).toBeNull();
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function userFixture(change: Partial<User> = {}): User {
  return {
    user_id: "me",
    username: "owner",
    nickname: "Owner",
    avatar_url: "/avatars/me.jpg",
    bio: "",
    gender: "",
    birthday: "",
    location: "",
    following_count: 0,
    follower_count: 0,
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
    ...change,
  };
}
