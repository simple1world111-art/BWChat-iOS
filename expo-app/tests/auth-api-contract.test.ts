import { login, logout, refreshSession, verifySession } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
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

  it("does not block login when the optional push-token cache fails", async () => {
    readPushToken.mockRejectedValue(new Error("optional cache unavailable"));

    await login("user", "password");

    expect(request).toHaveBeenCalledWith("/auth/login", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: { username: "user", password: "password" },
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
});
