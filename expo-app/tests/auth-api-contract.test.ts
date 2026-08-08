import { login, logout, refreshSession, register, verifySession } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { isBlank } from "@/services/auth/authFormPolicy";
import { readCachedNativePushToken } from "@/services/push/PushTokenStore";
import { readRefreshToken } from "@/storage/tokenStorage";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {
    readonly status: number;
    readonly payload?: unknown;
    readonly code?: string | number;

    constructor(message: string, status: number, payload?: unknown, code?: string | number) {
      super(message);
      this.status = status;
      this.payload = payload;
      if (code !== undefined) this.code = code;
    }
  },
  apiRequest: jest.fn(),
}));
jest.mock("@/services/push/PushTokenStore", () => ({
  readCachedNativePushToken: jest.fn(),
}));
jest.mock("@/storage/tokenStorage", () => ({ readRefreshToken: jest.fn() }));

const request = jest.mocked(apiRequest);
const readPushToken = jest.mocked(readCachedNativePushToken);
const readStoredRefreshToken = jest.mocked(readRefreshToken);
const session = {
  token: "access",
  refresh_token: "refresh",
  user: { user_id: "7", username: " user ", nickname: " Nick " },
};

describe("native authentication API contract", () => {
  beforeEach(() => {
    request.mockReset();
    readPushToken.mockReset();
    request.mockResolvedValue(session);
    readStoredRefreshToken.mockResolvedValue("stored-refresh");
  });

  it("posts the exact raw login values and cached device token", async () => {
    readPushToken.mockResolvedValue("push-token");
    await login(" user ", " pass ");
    expect(request).toHaveBeenCalledWith("/auth/login", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: { username: " user ", password: " pass ", device_token: "push-token" },
    });
  });

  it("preserves a nonblank nickname and omits one already normalized by AuthViewModel", async () => {
    readPushToken.mockResolvedValue(null);
    await register(" ab", "secret", " Nick ");
    expect(request).toHaveBeenNthCalledWith(1, "/auth/register", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: { username: " ab", password: "secret", nickname: " Nick " },
    });

    await register("abc", "secret", "");
    expect(request).toHaveBeenNthCalledWith(2, "/auth/register", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: { username: "abc", password: "secret" },
    });
  });

  it("includes the cached device token in the exact registration body", async () => {
    readPushToken.mockResolvedValue("push-token");
    await register("new-user", "new-password", "Nickname");
    expect(request).toHaveBeenCalledWith("/auth/register", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: {
        username: "new-user",
        password: "new-password",
        nickname: "Nickname",
        device_token: "push-token",
      },
    });
  });

  it("keeps Foundation nickname blank semantics before building the request body", async () => {
    readPushToken.mockResolvedValue(null);
    const nativeBlank = "\u200B";
    const nativeNonblank = "\uFEFF";
    expect(isBlank(nativeBlank)).toBe(true);
    expect(isBlank(nativeNonblank)).toBe(false);

    await register("first", "secret", isBlank(nativeBlank) ? "" : nativeBlank);
    expect(request).toHaveBeenNthCalledWith(1, "/auth/register", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: { username: "first", password: "secret" },
    });

    await register("second", "secret", isBlank(nativeNonblank) ? "" : nativeNonblank);
    expect(request).toHaveBeenNthCalledWith(2, "/auth/register", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: { username: "second", password: "secret", nickname: nativeNonblank },
    });
  });

  it("requires native envelope data for verification and refresh", async () => {
    request.mockResolvedValueOnce({ user: session.user }).mockResolvedValueOnce(session);
    await verifySession();
    await refreshSession();
    expect(request).toHaveBeenNthCalledWith(1, "/auth/verify", {
      requiredData: true,
      requiredEnvelope: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/auth/refresh", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: { refresh_token: "stored-refresh" },
    });
  });

  it("posts an authenticated empty logout body and requires the native wrapper", async () => {
    await logout();
    expect(request).toHaveBeenCalledWith("/auth/logout", {
      method: "POST",
      body: {},
      requiredEnvelope: true,
    });
  });

  it("does not block login or registration when the optional push-token cache fails", async () => {
    readPushToken.mockRejectedValue(new Error("optional cache unavailable"));

    await login("user", "password");
    await register("user-2", "password", "Nickname");

    expect(request).toHaveBeenNthCalledWith(1, "/auth/login", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: { username: "user", password: "password" },
    });
    expect(request).toHaveBeenNthCalledWith(2, "/auth/register", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: { username: "user-2", password: "password", nickname: "Nickname" },
    });
  });

  it("maps a malformed native auth session to the decoding error category", async () => {
    readPushToken.mockResolvedValue(null);
    request.mockResolvedValue({ token: "access", user: session.user });

    await expect(login("user", "password")).rejects.toMatchObject({
      status: 200,
      code: "decoding_error",
      message: "api.decodingError",
    });
  });

  it("maps a malformed native registration session to the decoding error category", async () => {
    readPushToken.mockResolvedValue(null);
    request.mockResolvedValue({ token: "access", refresh_token: "refresh", user: { bio: 7 } });

    await expect(register("user", "password", "Nickname")).rejects.toMatchObject({
      status: 200,
      code: "decoding_error",
      message: "api.decodingError",
    });
  });
});
