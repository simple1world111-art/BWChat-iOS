import {
  apiRequest,
  authenticatedResourceRequest,
  refreshAccessToken,
  subscribeAuthSessionEvents,
} from "@/api/client";
import { cacheUser } from "@/services/cache/UserInfoCache";
import { saveCachedUser } from "@/storage/authStorage";
import { clearTokens, readAccessToken, readRefreshToken, saveTokens } from "@/storage/tokenStorage";

jest.mock("@/providers/LocalizationProvider", () => ({
  getActiveLanguageCode: () => "en",
}));
jest.mock("@/services/cache/UserInfoCache", () => ({ cacheUser: jest.fn() }));
jest.mock("@/storage/authStorage", () => ({ saveCachedUser: jest.fn() }));
jest.mock("@/storage/tokenStorage", () => ({
  clearTokens: jest.fn(),
  readAccessToken: jest.fn(),
  readRefreshToken: jest.fn(),
  saveTokens: jest.fn(),
}));

const readAccess = jest.mocked(readAccessToken);
const readRefresh = jest.mocked(readRefreshToken);
const persistTokens = jest.mocked(saveTokens);
const clearStoredTokens = jest.mocked(clearTokens);
const persistCurrentUser = jest.mocked(saveCachedUser);
const persistAccountUser = jest.mocked(cacheUser);

const refreshedUser = {
  user_id: "owner",
  username: "owner",
  nickname: "Owner",
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

describe("native auth client refresh lifecycle", () => {
  let accessToken: string | null;

  beforeEach(() => {
    jest.clearAllMocks();
    accessToken = "old-access";
    readAccess.mockImplementation(async () => accessToken);
    readRefresh.mockResolvedValue("stored-refresh");
    persistTokens.mockImplementation(async (tokens) => {
      accessToken = tokens.accessToken;
    });
    clearStoredTokens.mockImplementation(async () => {
      accessToken = null;
    });
    persistCurrentUser.mockResolvedValue();
    persistAccountUser.mockResolvedValue();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("single-flights a 401 refresh, writes tokens then user, and retries both verifies once", async () => {
    const refreshResponse = deferred<Response>();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/auth/refresh")) return refreshResponse.promise;
      const authorization = new Headers(init?.headers).get("Authorization");
      return authorization === "Bearer new-access"
        ? response(200, { code: 0, message: "ok", data: { user: refreshedUser } })
        : response(401, { code: 401, message: "expired", data: null });
    });
    const listener = jest.fn();
    const unsubscribe = subscribeAuthSessionEvents(listener);

    const first = verifyRequest();
    const second = verifyRequest();
    await flushMicrotasks();
    expect(fetchMock.mock.calls.filter(([input]) => isPath(input, "/auth/refresh"))).toHaveLength(
      1,
    );

    refreshResponse.resolve(
      response(200, {
        code: 0,
        message: "ok",
        data: { token: "new-access", refresh_token: "new-refresh", user: refreshedUser },
      }),
    );
    await expect(Promise.all([first, second])).resolves.toEqual([
      { user: refreshedUser },
      { user: refreshedUser },
    ]);

    expect(fetchMock.mock.calls.filter(([input]) => isPath(input, "/auth/refresh"))).toHaveLength(
      1,
    );
    expect(fetchMock.mock.calls.filter(([input]) => isPath(input, "/auth/verify"))).toHaveLength(4);
    expect(persistTokens).toHaveBeenCalledWith({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
    expect(listener).toHaveBeenCalledWith({ type: "refreshed", user: refreshedUser });
    expect(persistTokens.mock.invocationCallOrder[0]).toBeLessThan(
      listener.mock.invocationCallOrder[0]!,
    );
    expect(listener.mock.invocationCallOrder[0]).toBeLessThan(
      persistCurrentUser.mock.invocationCallOrder[0]!,
    );
    expect(persistCurrentUser).toHaveBeenCalledWith(refreshedUser);
    expect(persistAccountUser).toHaveBeenCalledWith(refreshedUser);
    unsubscribe();
  });

  it("refreshes and retries authenticated binary media without JSON-decoding its body", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (isPath(input, "/auth/refresh")) {
        return response(200, {
          code: 0,
          message: "ok",
          data: { token: "new-access", refresh_token: "new-refresh", user: refreshedUser },
        });
      }
      const authorization = new Headers(init?.headers).get("Authorization");
      if (authorization !== "Bearer new-access") {
        return response(401, { code: 401, message: "expired", data: null });
      }
      return {
        status: 200,
        ok: true,
        headers: new Headers({ "Content-Type": "image/jpeg" }),
        arrayBuffer: async () => bytes.buffer,
      } as Response;
    });

    const media = await authenticatedResourceRequest(
      "http://localhost:8000/api/v1/agent-assets/asset/content",
    );
    await expect(media.arrayBuffer()).resolves.toEqual(bytes.buffer);
    expect(fetchMock.mock.calls.filter(([input]) => isPath(input, "/auth/refresh"))).toHaveLength(
      1,
    );
    expect(
      fetchMock.mock.calls.filter(([input]) => isPath(input, "/agent-assets/asset/content")),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.find(([input]) => isPath(input, "/agent-assets/asset/content"))?.[1]
        ?.cache,
    ).toBe("no-store");
    expect(persistTokens).toHaveBeenCalledWith({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
  });

  it("aborts an authenticated binary request when its owning presentation ends", async () => {
    const fetchStarted = deferred<void>();
    jest.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          fetchStarted.resolve();
          init?.signal?.addEventListener(
            "abort",
            () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const pending = authenticatedResourceRequest(
      "http://localhost:8000/api/v1/videos/private.mp4",
      { signal: controller.signal, transientRetries: false },
    );

    await fetchStarted.promise;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ status: 408 });
  });

  it("invalidates only a definitively rejected 401 refresh", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) =>
        isPath(input, "/auth/refresh")
          ? response(401, { code: 401, message: "revoked", data: null })
          : response(401, { code: 401, message: "expired", data: null }),
      );
    const listener = jest.fn();
    const unsubscribe = subscribeAuthSessionEvents(listener);

    await expect(verifyRequest()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(clearStoredTokens).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: "invalidated" });
    unsubscribe();
  });

  it("preserves the session when the refresh endpoint returns a non-401 error", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response(403, { code: 403, message: "temporarily forbidden" }));
    const listener = jest.fn();
    const unsubscribe = subscribeAuthSessionEvents(listener);

    await expect(refreshAccessToken()).rejects.toMatchObject({ status: 403 });
    expect(clearStoredTokens).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("can preserve the session when a caller opts out of 401 invalidation", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) =>
        isPath(input, "/auth/refresh")
          ? response(401, { code: 401, message: "revoked", data: null })
          : response(401, { code: 401, message: "expired", data: null }),
      );
    const listener = jest.fn();
    const unsubscribe = subscribeAuthSessionEvents(listener);

    await expect(
      apiRequest("/app/config", { invalidateSessionOnUnauthorized: false }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(clearStoredTokens).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("logs out when the retried authenticated request is still unauthorized", async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeAuthSessionEvents(listener);
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      isPath(input, "/auth/refresh")
        ? response(200, {
            code: 0,
            message: "ok",
            data: { token: "new-access", refresh_token: "new-refresh", user: refreshedUser },
          })
        : response(401, { code: 401, message: "still unauthorized", data: null }),
    );

    await expect(verifyRequest()).rejects.toMatchObject({ status: 401 });
    expect(clearStoredTokens).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls).toEqual([
      [{ type: "refreshed", user: refreshedUser }],
      [{ type: "invalidated" }],
    ]);
    unsubscribe();
  });

  it("clears and invalidates a token-only session that has no refresh token", async () => {
    readRefresh.mockResolvedValue(null);
    const fetchMock = jest.spyOn(globalThis, "fetch");
    const listener = jest.fn();
    const unsubscribe = subscribeAuthSessionEvents(listener);

    await expect(refreshAccessToken()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(clearStoredTokens).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: "invalidated" });
    unsubscribe();
  });

  it("retries transient GET verification failures twice like native", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response(503, { message: "retry" }))
      .mockResolvedValueOnce(response(503, { message: "retry" }))
      .mockResolvedValueOnce(
        response(200, { code: 0, message: "ok", data: { user: refreshedUser } }),
      );

    await expect(verifyRequest()).resolves.toEqual({ user: refreshedUser });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a transient login POST without an idempotency key", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(response(503, { message: "do not retry" }));

    await expect(
      apiRequest("/auth/login", {
        method: "POST",
        auth: false,
        requiredData: true,
        requiredEnvelope: true,
        body: { username: "user", password: "password" },
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function verifyRequest(): Promise<{ user: typeof refreshedUser }> {
  return apiRequest("/auth/verify", { requiredData: true, requiredEnvelope: true });
}

function pathOf(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}

function isPath(input: RequestInfo | URL, suffix: string): boolean {
  return pathOf(input).endsWith(suffix);
}

function response(status: number, payload: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    json: async () => payload,
  } as Response;
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

async function flushMicrotasks(count = 8): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}
