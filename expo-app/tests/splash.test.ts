import fs from "node:fs";
import path from "node:path";

import { refreshSession, verifySession } from "@/api/bwchat";
import { APIError, apiRequest } from "@/api/client";
import {
  shouldInvalidateCachedSession,
  sessionRedirectPath,
  splashMetrics,
  splashSpringPhysics,
} from "@/services/auth/splashPolicy";
import { readRefreshToken } from "@/storage/tokenStorage";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, apiRequest: jest.fn() };
});

jest.mock("@/storage/tokenStorage", () => ({
  readRefreshToken: jest.fn(),
}));

const request = jest.mocked(apiRequest);
const readRefresh = jest.mocked(readRefreshToken);

describe("native SplashScreen contracts", () => {
  beforeEach(() => {
    request.mockReset();
    readRefresh.mockReset();
  });

  it("keeps the source typography, spacing, delays and spring parameters", () => {
    expect(splashMetrics).toEqual({
      contentGap: 14,
      logoInitialScale: 0.6,
      logoFinalScale: 1,
      logoSize: 32,
      logoVerticalOpticalOffset: -2.5,
      enteringSize: 15,
      taglineSize: 13,
      progressTopInset: 6,
      bottomInset: 86,
      springResponseMilliseconds: 800,
      springDampingFraction: 0.6,
      missingTokenDelayMilliseconds: 500,
      validationWatchdogMilliseconds: 20_000,
    });
    expect(splashSpringPhysics.mass).toBe(1);
    expect(splashSpringPhysics.stiffness).toBeCloseTo(61.685, 3);
    expect(splashSpringPhysics.damping).toBeCloseTo(9.425, 3);
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/auth/SplashView.tsx"),
      "utf8",
    );
    expect(source).toContain(".AppleSystemUIFontRounded-Heavy");
    expect(source.match(/allowFontScaling=\{false\}/gu)).toHaveLength(3);
    expect(source).toContain(
      "splashMetrics.bottomInset + splashMetrics.contentGap + insets.bottom",
    );
  });

  it("renders the splash at the auth root before heavy app providers can consume the 500ms window", () => {
    const layout = fs.readFileSync(path.join(process.cwd(), "src/app/_layout.tsx"), "utf8");
    const gateStart = layout.indexOf("<BootstrapGate>");
    const realtimeStart = layout.indexOf("<RealtimeProvider>");
    const stackStart = layout.search(/<Stack\s+screenOptions=/u);

    expect(layout).toContain("return isBootstrapping ? <SplashView /> : children;");
    expect(gateStart).toBeGreaterThan(-1);
    expect(realtimeStart).toBeGreaterThan(gateStart);
    expect(stackStart).toBeGreaterThan(realtimeStart);
  });

  it("does not animate startup redirects into the auth or tab roots", () => {
    const layout = fs.readFileSync(path.join(process.cwd(), "src/app/_layout.tsx"), "utf8");

    for (const route of ["index", "(auth)", "(tabs)"]) {
      expect(layout).toMatch(
        new RegExp(
          `name=["']${route.replace(/[()]/gu, "\\$&")}["'][\\s\\S]*?options=\\{\\{ animation: ["']none["'], headerShown: false \\}\\}`,
          "u",
        ),
      );
    }
  });

  it("invalidates only explicit credential rejection, including nested business codes", () => {
    expect(shouldInvalidateCachedSession(new APIError("unauthorized", 401))).toBe(true);
    expect(shouldInvalidateCachedSession(new APIError("forbidden", 403))).toBe(true);
    expect(
      shouldInvalidateCachedSession(
        new APIError("expired", 400, {
          error: { error_code: " refresh_token_expired " },
        }),
      ),
    ).toBe(true);
    expect(
      shouldInvalidateCachedSession(
        new APIError("revoked", 422, {
          data: { payload: { code: "SESSION_REVOKED" } },
        }),
      ),
    ).toBe(true);
    expect(shouldInvalidateCachedSession(new APIError("offline", 0))).toBe(false);
    expect(shouldInvalidateCachedSession(new APIError("unavailable", 503))).toBe(false);
    expect(shouldInvalidateCachedSession(new Error("decode"))).toBe(false);
  });

  it("lets the generic client perform the native 401 refresh-and-retry sequence", async () => {
    request.mockResolvedValueOnce({ user: { user_id: "owner", nickname: "作者" } });
    await expect(verifySession()).resolves.toMatchObject({ user: { user_id: "owner" } });
    expect(request).toHaveBeenCalledWith("/auth/verify", {
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("refreshes once with the stored token and exact unauthenticated request", async () => {
    readRefresh.mockResolvedValueOnce("refresh-token");
    request.mockResolvedValueOnce({
      token: "access-token",
      refresh_token: "next-refresh-token",
      user: { user_id: "owner", nickname: "作者" },
    });
    await expect(refreshSession()).resolves.toMatchObject({
      token: "access-token",
      refresh_token: "next-refresh-token",
      user: { user_id: "owner" },
    });
    expect(request).toHaveBeenCalledWith("/auth/refresh", {
      method: "POST",
      auth: false,
      requiredData: true,
      requiredEnvelope: true,
      body: { refresh_token: "refresh-token" },
    });
  });

  it("treats a missing refresh credential as definitive rejection", async () => {
    readRefresh.mockResolvedValueOnce(null);
    await expect(refreshSession()).rejects.toMatchObject({ status: 401 });
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps authenticated and unauthenticated routes synchronized after late validation or logout", () => {
    expect(sessionRedirectPath(true, false, "index")).toBeUndefined();
    expect(sessionRedirectPath(false, true, "(auth)")).toBe("/(tabs)/conversations");
    expect(sessionRedirectPath(false, false, "(tabs)")).toBe("/(auth)/login");
    expect(sessionRedirectPath(false, false, "(auth)")).toBeUndefined();
    expect(sessionRedirectPath(false, false, "index")).toBeUndefined();
  });
});
