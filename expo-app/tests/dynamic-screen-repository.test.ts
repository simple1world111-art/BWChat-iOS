import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  dynamicScreenErrorMessage,
  embeddedDynamicScreen,
  fetchDynamicScreen,
  persistDynamicScreen,
  persistDynamicScreenETag,
  readCachedDynamicScreen,
} from "@/services/dynamic-screen/DynamicScreenRepository";

const mockReadAccessToken = jest.fn<Promise<string | null>, []>();
const mockRefreshAccessToken = jest.fn<
  Promise<string>,
  [{ invalidateSessionOnUnauthorized?: boolean }]
>();

jest.mock("@/storage/tokenStorage", () => ({
  readAccessToken: () => mockReadAccessToken(),
}));

jest.mock("@/api/client", () => ({
  refreshAccessToken: (options: { invalidateSessionOnUnauthorized?: boolean }) =>
    mockRefreshAccessToken(options),
}));

describe("dynamic screen repository", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    mockReadAccessToken.mockResolvedValue(null);
  });

  it("prefers a remote-config embedded screen over the same bundled fixture", () => {
    const screen = embeddedDynamicScreen("DAILY-REWARDS", [
      {
        screen_id: "daily_rewards",
        schema_version: 1,
        title: "Configured",
        components: [],
      },
    ]);
    expect(screen?.title).toBe("Configured");
  });

  it("rejects an entire configured screen array when any sibling is malformed", () => {
    const screen = embeddedDynamicScreen("daily_rewards", [
      { screenId: "daily_rewards", schemaVersion: 1, title: "Configured", components: [] },
      { screenId: "broken", components: [{ id: "missing-type", props: {} }] },
    ]);
    expect(screen?.configVersion).toBe("bundled-fixture");
    expect(screen?.title).toBeUndefined();
  });

  it("ships the activity and legal-document bundled fixtures", () => {
    for (const id of [
      "daily_rewards",
      "festival_home",
      "agent_hub",
      "help_center",
      "wallet_terms",
      "privacy_policy",
      "data_privacy",
    ]) {
      expect(embeddedDynamicScreen(id, undefined)?.screenId).toBe(id);
    }
  });

  it("isolates cached pages and etags by account", async () => {
    const screen = embeddedDynamicScreen("wallet_terms", undefined)!;
    await persistDynamicScreen("user-a", "wallet_terms", screen, '"etag-a"');
    expect(await readCachedDynamicScreen("user-a", "wallet_terms")).toEqual({
      screen,
      etag: '"etag-a"',
    });
    expect(await readCachedDynamicScreen("user-b", "wallet_terms")).toEqual({
      screen: null,
      etag: null,
    });
  });

  it("persists an explicitly empty response ETag exactly like UserDefaults", async () => {
    const write = jest.spyOn(AsyncStorage, "setItem");
    await persistDynamicScreenETag(undefined, "wallet_terms", "");
    expect(write).toHaveBeenCalledWith("bbchat.app.dynamicScreen.etag.v1.guest.wallet_terms", "");
  });

  it("restores a decodable cached page before gating later remote schemas like Swift", async () => {
    const screen = { ...embeddedDynamicScreen("wallet_terms", undefined)!, schemaVersion: 2 };
    await persistDynamicScreen(undefined, "wallet_terms", screen, null);
    expect((await readCachedDynamicScreen(undefined, "wallet_terms")).screen).toEqual(screen);
  });

  it("sends the native conditional headers and decodes an enveloped page", async () => {
    mockReadAccessToken.mockResolvedValue("access-token");
    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      response(
        {
          code: 0,
          message: "ok",
          data: { screen_id: "daily_rewards", schema_version: 1, components: [] },
        },
        200,
        { ETag: '"remote-1"' },
      ),
    );

    const result = await fetchDynamicScreen("daily/rewards", '"cached"');
    expect(result).toMatchObject({
      notModified: false,
      etag: '"remote-1"',
      screen: { screenId: "daily_rewards" },
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toMatch(/\/app\/screens\/daily%2Frewards$/u);
    expect(headers.get("Authorization")).toBe("Bearer access-token");
    expect(headers.get("If-None-Match")).toBe('"cached"');
    expect(headers.get("Accept-Language")).toBeTruthy();
    expect(headers.get("X-App-Version")).toBeTruthy();
    expect(headers.get("X-App-Build")).toBeTruthy();
    expect(headers.get("X-Platform")).toBe("iOS");
    expect(headers.get("X-Timezone")).toBeTruthy();
  });

  it("falls back to the direct screen when an unrelated data field is null", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        response({ screen_id: "daily_rewards", components: [], data: null }, 200),
      );
    await expect(fetchDynamicScreen("daily_rewards")).resolves.toMatchObject({
      screen: { screenId: "daily_rewards" },
      notModified: false,
    });
  });

  it("renders the deployed legal-document envelope without requiring SDUI components", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      response(
        {
          code: 0,
          message: "ok",
          data: {
            screen_id: "data_privacy",
            document_version: "2026-08-12.1",
            effective_at: "2026-08-12T00:00:00Z",
            locale: "zh-Hans",
            title: "数据权利与账号删除",
            body: "您可申请访问、更正和删除数据。",
          },
        },
        200,
      ),
    );
    await expect(fetchDynamicScreen("data_privacy")).resolves.toMatchObject({
      notModified: false,
      screen: {
        screenId: "data_privacy",
        title: "数据权利与账号删除",
        components: [
          {
            type: "text",
            props: { text: "您可申请访问、更正和删除数据。", style: "legal_body" },
          },
        ],
      },
    });
  });

  it("returns no replacement ETag on a 304 without a header like URLSession", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(response(null, 304));
    await expect(fetchDynamicScreen("daily_rewards", '"cached"')).resolves.toEqual({
      screen: null,
      etag: null,
      notModified: true,
    });
  });

  it("rejects a camelCase backend response even though internal cache projections remain readable", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      response(
        {
          screenId: "daily_rewards",
          schemaVersion: 1,
          components: [],
        },
        200,
      ),
    );
    const request = fetchDynamicScreen("daily_rewards");
    await expect(request).rejects.toMatchObject({
      kind: "decoding",
      message: "api.decodingError",
    });
    await expect(
      request.catch((error: unknown) => dynamicScreenErrorMessage(error, (key) => `t:${key}`)),
    ).resolves.toBe("t:api.decodingError");
  });

  it("maps the native 401, 5xx and non-5xx error presentation rules", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(response({ message: "expired" }, 401));
    const unauthorized = await fetchDynamicScreen("daily_rewards").catch((error: unknown) => error);
    expect(dynamicScreenErrorMessage(unauthorized, (key) => `t:${key}`)).toBe("t:api.unauthorized");

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response({ message: "gateway detail" }, 503, { "Retry-After": "0" }))
      .mockResolvedValueOnce(response({ message: "gateway detail" }, 503, { "Retry-After": "0" }))
      .mockResolvedValueOnce(response({ message: "gateway detail" }, 503));
    const unavailable = await fetchDynamicScreen("daily_rewards").catch((error: unknown) => error);
    expect(dynamicScreenErrorMessage(unavailable, (key) => `t:${key}`)).toBe(
      "t:api.serverUnavailable",
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      response(
        {
          detail: { code: 422, message: "Field rejected" },
        },
        422,
      ),
    );
    const rejected = await fetchDynamicScreen("daily_rewards").catch((error: unknown) => error);
    expect(dynamicScreenErrorMessage(rejected, (key) => `t:${key}`)).toBe("Field rejected");

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      response({ code: "insufficient_gold_coins", message: "server copy" }, 422),
    );
    const business = await fetchDynamicScreen("daily_rewards").catch((error: unknown) => error);
    expect(dynamicScreenErrorMessage(business, (key) => `t:${key}`)).toBe(
      "t:wallet.error.insufficientGoldCoins",
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      response({ code: "custom_business_error", message: "" }, 422),
    );
    const emptyBusiness = await fetchDynamicScreen("daily_rewards").catch(
      (error: unknown) => error,
    );
    expect(dynamicScreenErrorMessage(emptyBusiness, (key) => `t:${key}`)).toBe(
      "t:api.invalidResponse",
    );
  });

  it("refreshes an expired authenticated request once without invalidating the session", async () => {
    mockReadAccessToken.mockResolvedValue("expired");
    mockRefreshAccessToken.mockResolvedValue("fresh");
    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(response({ message: "expired" }, 401))
      .mockResolvedValueOnce(response({ screen_id: "daily_rewards", components: [] }, 200));

    await expect(fetchDynamicScreen("daily_rewards")).resolves.toMatchObject({
      notModified: false,
      screen: { screenId: "daily_rewards" },
    });
    expect(mockRefreshAccessToken).toHaveBeenCalledWith({ invalidateSessionOnUnauthorized: false });
    const secondHeaders = new Headers(
      (global.fetch as jest.Mock).mock.calls[1][1].headers as HeadersInit,
    );
    expect(secondHeaders.get("Authorization")).toBe("Bearer fresh");
  });

  it("retries the same idempotent GET twice for native transient statuses", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(response({ message: "busy" }, 503, { "Retry-After": "0" }))
      .mockResolvedValueOnce(response({ message: "busy" }, 503, { "Retry-After": "0" }))
      .mockResolvedValueOnce(response({ screen_id: "daily_rewards", components: [] }, 200));
    await expect(fetchDynamicScreen("daily_rewards")).resolves.toMatchObject({
      screen: { screenId: "daily_rewards" },
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

function response(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    text: async () => (body === null ? "" : JSON.stringify(body)),
  } as Response;
}
