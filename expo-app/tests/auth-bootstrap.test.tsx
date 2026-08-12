import { act, render, screen } from "@testing-library/react-native";
import { createRef, forwardRef, useImperativeHandle } from "react";
import { Text } from "react-native";

import * as api from "@/api/bwchat";
import { APIError } from "@/api/client";
import type { User } from "@/models";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import {
  registerVerifiedAccount,
  type VerifiedRegistrationInput,
} from "@/services/account/AccountComplianceService";
import { cacheUser } from "@/services/cache/UserInfoCache";
import { clearCurrentAccountData } from "@/services/cache/AppCacheService";
import { loginLocationRecorder } from "@/services/location/MapLocationService";
import { clearCachedUser, readCachedUser, saveCachedUser } from "@/storage/authStorage";
import { clearTokens, readAccessToken, saveTokens } from "@/storage/tokenStorage";

jest.mock("@/api/bwchat", () => ({
  verifySession: jest.fn(),
  refreshSession: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
}));

jest.mock("@/services/account/AccountComplianceService", () => ({
  registerVerifiedAccount: jest.fn(),
}));

jest.mock("@/services/cache/AppCacheService", () => ({
  clearCurrentAccountData: jest.fn(),
}));

jest.mock("@/storage/authStorage", () => ({
  clearCachedUser: jest.fn(),
  readCachedUser: jest.fn(),
  saveCachedUser: jest.fn(),
}));

jest.mock("@/storage/tokenStorage", () => ({
  clearTokens: jest.fn(),
  readAccessToken: jest.fn(),
  saveTokens: jest.fn(),
}));

jest.mock("@/services/monitoring/MonitoringService", () => ({
  captureException: jest.fn(),
}));

jest.mock("@/services/cache/UserInfoCache", () => ({
  cacheUser: jest.fn(),
}));

jest.mock("@/services/location/MapLocationService", () => ({
  loginLocationRecorder: { recordAfterLogin: jest.fn() },
}));

const verify = jest.mocked(api.verifySession);
const refresh = jest.mocked(api.refreshSession);
const readToken = jest.mocked(readAccessToken);
const readUser = jest.mocked(readCachedUser);
const clearStoredTokens = jest.mocked(clearTokens);
const clearUser = jest.mocked(clearCachedUser);
const persistTokens = jest.mocked(saveTokens);
const persistUser = jest.mocked(saveCachedUser);
const persistAccountUser = jest.mocked(cacheUser);
const recordLoginLocation = jest.mocked(loginLocationRecorder.recordAfterLogin);
const clearAccountData = jest.mocked(clearCurrentAccountData);
const signIn = jest.mocked(api.login);
const signUp = jest.mocked(registerVerifiedAccount);
const signOut = jest.mocked(api.logout);

describe("native cached-session splash bootstrap", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    clearStoredTokens.mockResolvedValue();
    clearUser.mockResolvedValue();
    persistTokens.mockResolvedValue();
    persistUser.mockResolvedValue();
    persistAccountUser.mockResolvedValue();
    recordLoginLocation.mockResolvedValue();
    signOut.mockResolvedValue(undefined);
    clearAccountData.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("keeps the splash visible for 500ms when no access token exists", async () => {
    readToken.mockResolvedValue(null);
    readUser.mockResolvedValue(user("cached"));
    await renderProvider();
    await flushTasks();
    expect(readState()).toBe("booting|none|verified");
    await act(async () => {
      jest.advanceTimersByTime(499);
    });
    expect(readState()).toBe("booting|none|verified");
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(readState()).toBe("ready|none|verified");
    expect(clearUser).not.toHaveBeenCalled();
  });

  it("opens a cached account immediately and marks transient validation failure unverified", async () => {
    readToken.mockResolvedValue("access");
    readUser.mockResolvedValue(user("cached"));
    verify.mockRejectedValue(new APIError("offline", 0));
    refresh.mockRejectedValue(new APIError("offline", 0));
    await renderProvider();
    await flushTasks(8);
    expect(readState()).toBe("ready|cached|unverified");
    expect(clearStoredTokens).not.toHaveBeenCalled();
    expect(clearUser).not.toHaveBeenCalled();
  });

  it("uses the 20-second watchdog without cancelling a late successful validation", async () => {
    const verification = deferred<{ user: User }>();
    readToken.mockResolvedValue("access");
    readUser.mockResolvedValue(null);
    verify.mockReturnValue(verification.promise);
    await renderProvider();
    await flushTasks();
    expect(readState()).toBe("booting|none|verified");
    await act(async () => {
      jest.advanceTimersByTime(19_999);
    });
    expect(readState()).toBe("booting|none|verified");
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(readState()).toBe("ready|none|verified");
    await act(async () => {
      verification.resolve({ user: user("verified") });
    });
    await flushTasks();
    expect(readState()).toBe("ready|verified|verified");
    expect(persistUser).toHaveBeenCalledWith(user("verified"));
  });

  it("clears credentials only after an explicit refresh rejection", async () => {
    readToken.mockResolvedValue("access");
    readUser.mockResolvedValue(user("cached"));
    verify.mockRejectedValue(new APIError("verify failed", 500));
    refresh.mockRejectedValue(new APIError("revoked", 403));
    await renderProvider();
    await flushTasks(8);
    expect(readState()).toBe("ready|none|verified");
    expect(clearStoredTokens).toHaveBeenCalledTimes(1);
    expect(clearUser).toHaveBeenCalledTimes(1);
  });

  it("persists refreshed credentials and user after verification fails", async () => {
    const refreshed = {
      token: "new-access",
      refresh_token: "new-refresh",
      user: user("refreshed"),
    };
    readToken.mockResolvedValue("old-access");
    readUser.mockResolvedValue(null);
    verify.mockRejectedValue(new APIError("expired", 401));
    refresh.mockResolvedValue(refreshed);
    await renderProvider();
    await flushTasks(8);
    expect(readState()).toBe("ready|refreshed|verified");
    expect(persistTokens).toHaveBeenCalledWith({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
    expect(persistUser).toHaveBeenCalledWith(refreshed.user);
  });

  it("commits a successful login before exposing the authenticated account", async () => {
    readToken.mockResolvedValue(null);
    readUser.mockResolvedValue(null);
    const authenticated = {
      token: "access",
      refresh_token: "refresh",
      user: user("login-user"),
    };
    signIn.mockResolvedValue(authenticated);
    const { actions } = await renderProvider();
    await flushTasks();
    await act(async () => {
      jest.advanceTimersByTime(500);
      await actions.current?.signIn(" raw-user ", " raw-password ");
    });

    expect(signIn).toHaveBeenCalledWith(" raw-user ", " raw-password ");
    expect(persistTokens).toHaveBeenCalledWith({
      accessToken: "access",
      refreshToken: "refresh",
    });
    expect(persistUser).toHaveBeenCalledWith(authenticated.user);
    expect(persistAccountUser).toHaveBeenCalledWith(authenticated.user);
    expect(readState()).toBe("ready|login-user|verified");
    expect(recordLoginLocation).toHaveBeenCalledWith("login-user", expect.any(Function));
    const stillCurrent = recordLoginLocation.mock.calls[0]?.[1];
    expect(stillCurrent?.("login-user")).toBe(true);
    expect(stillCurrent?.("another-user")).toBe(false);
  });

  it("uses the same persistence path after a successful registration", async () => {
    readToken.mockResolvedValue(null);
    readUser.mockResolvedValue(null);
    const registered = {
      token: "registered-access",
      refresh_token: "registered-refresh",
      user: user("registered-user"),
    };
    signUp.mockResolvedValue(registered);
    const { actions } = await renderProvider();
    await flushTasks();
    await act(async () => {
      jest.advanceTimersByTime(500);
      await actions.current?.signUp(registrationInput("new-user", "new-password", " Nick "));
    });

    expect(signUp).toHaveBeenCalledWith(registrationInput("new-user", "new-password", " Nick "));
    expect(persistTokens).toHaveBeenCalledWith({
      accessToken: "registered-access",
      refreshToken: "registered-refresh",
    });
    expect(persistUser).toHaveBeenCalledWith(registered.user);
    expect(persistAccountUser).toHaveBeenCalledWith(registered.user);
    expect(readState()).toBe("ready|registered-user|verified");
    expect(recordLoginLocation).toHaveBeenCalledWith("registered-user", expect.any(Function));
  });

  it("terminates a deleted account locally without calling logout", async () => {
    readToken.mockResolvedValue(null);
    readUser.mockResolvedValue(null);
    signIn.mockResolvedValue(authSession("deleted-owner"));
    const { actions } = await renderProvider();
    await flushTasks();
    await act(async () => {
      jest.advanceTimersByTime(500);
      await actions.current?.signIn("user", "password");
    });
    expect(readState()).toBe("ready|deleted-owner|verified");

    await act(async () => {
      actions.current?.finalizeAccountDeletion("deleted-owner");
      await flushTasks();
    });

    expect(readState()).toBe("ready|none|verified");
    expect(signOut).not.toHaveBeenCalled();
    expect(clearStoredTokens).toHaveBeenCalled();
    expect(clearUser).toHaveBeenCalled();
    expect(clearAccountData).toHaveBeenCalledWith("deleted-owner");
  });

  it("lets only the newest manual registration response commit its account", async () => {
    readToken.mockResolvedValue(null);
    readUser.mockResolvedValue(null);
    const first = deferred<ReturnType<typeof authSession>>();
    const second = deferred<ReturnType<typeof authSession>>();
    signUp.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { actions } = await renderProvider();
    await flushTasks();
    await act(async () => jest.advanceTimersByTime(500));

    let firstResult: boolean | undefined;
    let secondResult: boolean | undefined;
    const firstCall = actions.current
      ?.signUp(registrationInput("first-user", "first-password", "First"))
      .then((value) => (firstResult = value));
    const secondCall = actions.current
      ?.signUp(registrationInput("second-user", "second-password", "Second"))
      .then((value) => (secondResult = value));
    await act(async () => first.resolve(authSession("first-user")));
    await firstCall;
    expect(firstResult).toBe(false);
    expect(persistTokens).not.toHaveBeenCalled();
    expect(readState()).toBe("ready|none|verified");

    await act(async () => second.resolve(authSession("second-user")));
    await secondCall;
    expect(secondResult).toBe(true);
    expect(readState()).toBe("ready|second-user|verified");
    expect(persistTokens).toHaveBeenCalledTimes(1);
  });

  it("does not let a registration response re-authenticate after logout starts", async () => {
    readToken.mockResolvedValue(null);
    readUser.mockResolvedValue(null);
    const pending = deferred<ReturnType<typeof authSession>>();
    signUp.mockReturnValue(pending.promise);
    const { actions } = await renderProvider();
    await flushTasks();
    await act(async () => jest.advanceTimersByTime(500));

    const registration = actions.current?.signUp(
      registrationInput("late-user", "late-password", "Late"),
    );
    await act(async () => actions.current?.signOut());
    await act(async () => pending.resolve(authSession("late-user")));
    await expect(registration).resolves.toBe(false);
    expect(readState()).toBe("ready|none|verified");
    expect(persistTokens).not.toHaveBeenCalled();
  });

  it("keeps a successful login active when optional user caches fail", async () => {
    readToken.mockResolvedValue(null);
    readUser.mockResolvedValue(null);
    const authenticated = {
      token: "access",
      refresh_token: "refresh",
      user: user("storage-degraded-user"),
    };
    signIn.mockResolvedValue(authenticated);
    persistUser.mockRejectedValue(new Error("user cache unavailable"));
    persistAccountUser.mockRejectedValue(new Error("account cache unavailable"));
    const { actions } = await renderProvider();
    await flushTasks();
    await act(async () => {
      jest.advanceTimersByTime(500);
      await actions.current?.signIn("user", "password");
    });

    expect(persistTokens).toHaveBeenCalled();
    expect(readState()).toBe("ready|storage-degraded-user|verified");
  });

  it("lets only the newest manual login response commit its account", async () => {
    readToken.mockResolvedValue(null);
    readUser.mockResolvedValue(null);
    const first = deferred<ReturnType<typeof authSession>>();
    const second = deferred<ReturnType<typeof authSession>>();
    signIn.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { actions } = await renderProvider();
    await flushTasks();
    await act(async () => jest.advanceTimersByTime(500));

    let firstResult: boolean | undefined;
    let secondResult: boolean | undefined;
    const firstCall = actions.current
      ?.signIn("first-user", "first-password")
      .then((value) => (firstResult = value));
    const secondCall = actions.current
      ?.signIn("second-user", "second-password")
      .then((value) => (secondResult = value));
    await act(async () => first.resolve(authSession("first-user")));
    await firstCall;
    expect(firstResult).toBe(false);
    expect(persistTokens).not.toHaveBeenCalled();
    expect(readState()).toBe("ready|none|verified");

    await act(async () => second.resolve(authSession("second-user")));
    await secondCall;
    expect(secondResult).toBe(true);
    expect(readState()).toBe("ready|second-user|verified");
    expect(persistTokens).toHaveBeenCalledTimes(1);
  });

  it("does not let a login response re-authenticate after logout starts", async () => {
    readToken.mockResolvedValue(null);
    readUser.mockResolvedValue(null);
    const pending = deferred<ReturnType<typeof authSession>>();
    signIn.mockReturnValue(pending.promise);
    const { actions } = await renderProvider();
    await flushTasks();
    await act(async () => jest.advanceTimersByTime(500));

    const login = actions.current?.signIn("late-user", "late-password");
    await act(async () => actions.current?.signOut());
    await act(async () => pending.resolve(authSession("late-user")));
    await expect(login).resolves.toBe(false);
    expect(readState()).toBe("ready|none|verified");
    expect(persistTokens).not.toHaveBeenCalled();
  });

  it("ignores old bootstrap verification after a watchdog login commits", async () => {
    const verification = deferred<{ user: User }>();
    readToken.mockResolvedValue("old-access");
    readUser.mockResolvedValue(null);
    verify.mockReturnValue(verification.promise);
    signIn.mockResolvedValue(authSession("manual-user"));
    const { actions } = await renderProvider();
    await flushTasks();
    await act(async () => jest.advanceTimersByTime(20_000));
    expect(readState()).toBe("ready|none|verified");

    await act(async () => {
      await actions.current?.signIn("manual-user", "manual-password");
    });
    expect(readState()).toBe("ready|manual-user|verified");
    await act(async () => verification.resolve({ user: user("old-bootstrap-user") }));
    await flushTasks();
    expect(readState()).toBe("ready|manual-user|verified");
  });

  it("publishes logout even when persistent credential deletion fails", async () => {
    readToken.mockResolvedValue(null);
    readUser.mockResolvedValue(null);
    signIn.mockResolvedValue({
      token: "access",
      refresh_token: "refresh",
      user: user("logout-user"),
    });
    const { actions } = await renderProvider();
    await flushTasks();
    await act(async () => {
      jest.advanceTimersByTime(500);
      await actions.current?.signIn("user", "password");
    });
    clearStoredTokens.mockRejectedValue(new Error("token delete unavailable"));
    clearUser.mockRejectedValue(new Error("user delete unavailable"));

    await act(async () => {
      await actions.current?.signOut();
    });

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(readState()).toBe("ready|none|verified");
  });
});

interface AuthActions {
  signIn(username: string, password: string): Promise<boolean>;
  signUp(input: VerifiedRegistrationInput): Promise<boolean>;
  signOut(): Promise<void>;
  finalizeAccountDeletion(ownerId: string): void;
}

function registrationInput(
  username: string,
  password: string,
  nickname: string,
): VerifiedRegistrationInput {
  return {
    username,
    password,
    nickname,
    email: `${username}@example.com`,
    emailVerificationToken: `verified-${username}`,
    clientRequestId: `request-${username}`,
  };
}

const Probe = forwardRef<AuthActions>(function Probe(_props, ref) {
  const {
    isBootstrapping,
    isSessionUnverified,
    signIn: performSignIn,
    signUp: performSignUp,
    signOut: performSignOut,
    finalizeAccountDeletion,
    user: currentUser,
  } = useAuth();
  useImperativeHandle(
    ref,
    () => ({
      signIn: performSignIn,
      signUp: performSignUp,
      signOut: performSignOut,
      finalizeAccountDeletion,
    }),
    [finalizeAccountDeletion, performSignIn, performSignOut, performSignUp],
  );
  return (
    <Text testID="state">
      {isBootstrapping ? "booting" : "ready"}|{currentUser?.user_id ?? "none"}|
      {isSessionUnverified ? "unverified" : "verified"}
    </Text>
  );
});

async function renderProvider() {
  const actions = createRef<AuthActions>();
  const view = await render(
    <AuthProvider>
      <Probe ref={actions} />
    </AuthProvider>,
  );
  return { actions, view };
}

function readState(): string {
  return String(screen.getByTestId("state").props.children.join(""));
}

async function flushTasks(count = 3): Promise<void> {
  await act(async () => {
    for (let index = 0; index < count; index += 1) await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function user(id: string): User {
  return {
    user_id: id,
    username: id,
    nickname: id,
    avatar_url: "",
    bio: "",
    gender: "",
    birthday: "",
    location: "",
    following_count: 0,
    follower_count: 0,
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
  };
}

function authSession(id: string) {
  return {
    token: `${id}-access`,
    refresh_token: `${id}-refresh`,
    user: user(id),
  };
}
