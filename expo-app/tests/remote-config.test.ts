import AsyncStorage from "@react-native-async-storage/async-storage";

import { refreshAccessToken } from "@/api/client";
import {
  effectiveContactItems,
  effectiveProfileItems,
  effectiveTabs,
  fetchRemoteConfig,
  parseRemoteConfig,
  requiresStoreUpdate,
} from "@/services/remote-config/RemoteConfigService";
import { readAccessToken } from "@/storage/tokenStorage";

jest.mock("@/api/client", () => ({ refreshAccessToken: jest.fn() }));
jest.mock("@/storage/tokenStorage", () => ({ readAccessToken: jest.fn() }));

const mockReadAccessToken = jest.mocked(readAccessToken);
const mockRefreshAccessToken = jest.mocked(refreshAccessToken);

describe("parseRemoteConfig", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    mockReadAccessToken.mockReset();
    mockRefreshAccessToken.mockReset();
    await AsyncStorage.clear();
  });

  it("accepts a supported config and fills feature defaults", () => {
    const config = parseRemoteConfig({ schemaVersion: 1, configVersion: 7, features: {} });
    expect(config.configVersion).toBe("7");
    expect(config.features.paymentEnabled).toBe(true);
    expect(config.features.maintenanceMode).toBe(false);
    expect(effectiveContactItems(config).map((item) => item.id)).toEqual([
      "friend_requests",
      "my_groups",
    ]);
  });

  it("decodes only the snake_case account support and legal-screen contract", () => {
    const config = parseRemoteConfig({
      schema_version: 1,
      config_version: "account-compliance",
      account: {
        support_email: "support@example.com",
        privacy_screen_id: "privacy_policy_v2",
        data_privacy_screen_id: "data_privacy_v2",
        account_deletion_url: "https://id7.com/account-deletion",
      },
      wallet: { terms_screen_id: "wallet_terms_v2" },
    });
    expect(config.account).toEqual({
      supportEmail: "support@example.com",
      privacyScreenId: "privacy_policy_v2",
      dataPrivacyScreenId: "data_privacy_v2",
      accountDeletionUrl: "https://id7.com/account-deletion",
    });
    expect(config.wallet).toEqual({ terms_screen_id: "wallet_terms_v2" });

    expect(() =>
      parseRemoteConfig({
        schema_version: 1,
        config_version: "unsafe-legal-route",
        account: { privacy_screen_id: "../privacy" },
      }),
    ).toThrow();

    const camelCase = parseRemoteConfig({
      schema_version: 1,
      config_version: "no-account-camel-aliases",
      account: { supportEmail: "unsafe@example.com" },
    });
    expect(camelCase.account?.supportEmail).toBeUndefined();
    expect(camelCase.account).toMatchObject({
      privacyScreenId: "privacy_policy",
      dataPrivacyScreenId: "data_privacy",
      accountDeletionUrl: "https://id7.com/account-deletion",
    });
  });

  it("removes the retired test tab even when an older remote config still sends it", () => {
    const config = parseRemoteConfig({
      schema_version: 1,
      config_version: "remote-tabs-with-retired-test",
      tabs: [
        { id: "messages", order: 10, route: { type: "native", name: "messages" } },
        { id: "discover", order: 40, route: { type: "native", name: "discover" } },
        { id: "test", order: 45, route: { type: "native", name: "test" } },
        { id: "legacy-test", order: 46, route: { type: "native", name: "test" } },
        { id: "profile", order: 50, route: { type: "native", name: "profile" } },
      ],
    });

    expect(effectiveTabs(config).map((tab) => tab.id)).toEqual(["messages", "discover", "profile"]);
  });

  it("uses remote contact modules but removes the native-disallowed agent duplicate", () => {
    const config = parseRemoteConfig({
      schema_version: 1,
      config_version: "contacts",
      contact_modules: [
        {
          id: "contacts",
          items: [
            { id: "agent_hub", order: 1 },
            { id: "friend_requests", order: 2 },
          ],
        },
      ],
    });
    expect(effectiveContactItems(config).map((item) => item.id)).toEqual(["friend_requests"]);
  });

  it("decodes the original Swift snake_case protocol and dynamic tabs", () => {
    const config = parseRemoteConfig({
      code: 0,
      data: {
        schema_version: 1,
        config_version: "2026.08.06.1",
        refresh_interval_seconds: 120,
        min_supported_build: 8,
        kill_switch: { enabled: false, message: { "zh-Hans": "稍后回来" } },
        feature_flags: {
          chat_local_delete_v1: { enabled: true, rollout_percentage: 25, salt: "chat" },
        },
        tabs: [
          {
            id: "messages",
            title_key: "tab.messages",
            system_image: "bubble.left.and.bubble.right",
            selected_system_image: "bubble.left.and.bubble.right.fill",
            route: { type: "native", name: "messages" },
          },
        ],
        profile_sections: [
          {
            id: "profile_core",
            order: 10,
            items: [
              {
                id: "wallet",
                title_i18n: { "zh-Hans": "金币钱包" },
                system_image: "pawprint.fill",
                colors: ["FFB703", "FB8500"],
                order: 10,
                route: { type: "native", name: "wallet" },
              },
            ],
          },
        ],
      },
    });
    expect(config.configVersion).toBe("2026.08.06.1");
    expect(config.refreshIntervalSeconds).toBe(120);
    expect(config.minSupportedBuild).toBe(8);
    expect(config.featureFlags[0]).toMatchObject({
      key: "chat_local_delete_v1",
      enabled: true,
      rolloutPercentage: 25,
    });
    expect(config.tabs[0]?.selectedSystemImage).toBe("bubble.left.and.bubble.right.fill");
    expect(effectiveProfileItems(config)[0]).toMatchObject({
      id: "wallet",
      systemImage: "pawprint.fill",
      titleI18n: { "zh-Hans": "金币钱包" },
      colors: ["FFB703", "FB8500"],
      route: { type: "native", name: "wallet" },
    });
  });

  it("requires a Store build when the native version is below the remote minimum", () => {
    const minimum = parseRemoteConfig({
      schema_version: 1,
      config_version: "minimum-native-build",
      min_supported_build: 9,
      min_supported_app_version: "2.4.0",
      update: { force_update: false, store_url: "https://apps.apple.com/app/example/id1" },
    });
    expect(requiresStoreUpdate(minimum, 8, "2.4.0")).toBe(true);
    expect(requiresStoreUpdate(minimum, 9, "2.3.9")).toBe(true);
    expect(requiresStoreUpdate(minimum, 9, "2.4.0")).toBe(false);

    const explicit = parseRemoteConfig({
      schema_version: 1,
      config_version: "explicit-native-build",
      update: { force_update: true, store_url: "https://apps.apple.com/app/example/id1" },
    });
    expect(requiresStoreUpdate(explicit, 99, "99.0.0")).toBe(true);
  });

  it("rejects executable-looking or unsupported config shapes", () => {
    expect(() =>
      parseRemoteConfig({ schemaVersion: 99, configVersion: 1, features: {}, code: "alert(1)" }),
    ).toThrow();
  });

  it("normalizes the native web_view_policy contract instead of retaining opaque data", () => {
    const config = parseRemoteConfig({
      schema_version: 1,
      config_version: "web-policy",
      web_view_policy: {
        allowed_domains: ["games.example.com"],
        blocked_domains: ["blocked.games.example.com"],
        allowed_bridge_methods: ["close", "openRoute"],
        require_https: true,
      },
    });
    expect(config.webViewPolicy).toMatchObject({
      allowedDomains: ["games.example.com"],
      blockedDomains: ["blocked.games.example.com"],
      allowedBridgeMethods: ["close", "openRoute"],
      requireHTTPS: true,
    });
  });

  it("normalizes embedded dynamic screens instead of retaining opaque screen JSON", () => {
    const config = parseRemoteConfig({
      schema_version: 1,
      config_version: "screens",
      screens: [
        {
          screen_id: "help_center",
          schema_version: 1,
          title_i18n: { "zh-Hans": "帮助中心" },
          components: [
            {
              id: "settings",
              type: "row",
              props: {},
              action: { type: "native", name: "settings" },
            },
          ],
        },
      ],
    });
    expect(config.screens?.[0]).toMatchObject({
      screenId: "help_center",
      schemaVersion: 1,
      components: [{ id: "settings", action: { type: "native", name: "settings" } }],
    });
  });

  it("rejects the complete screens projection when one sibling is malformed", () => {
    const config = parseRemoteConfig({
      schema_version: 1,
      config_version: "screens-malformed-sibling",
      screens: [
        { screen_id: "valid", components: [] },
        { screen_id: "invalid", components: [{ id: "missing-type", props: {} }] },
      ],
    });
    expect(config.screens).toBeUndefined();
  });

  it("rejects camelCase screen wire fields without weakening other config aliases", () => {
    const config = parseRemoteConfig({
      schemaVersion: 1,
      configVersion: "camel-config-still-supported",
      screens: [{ screenId: "camel-screen", components: [] }],
    });
    expect(config.configVersion).toBe("camel-config-still-supported");
    expect(config.screens).toBeUndefined();
  });

  it("refreshes an optional signed-in token once on 401 and retries without logging out", async () => {
    mockReadAccessToken.mockResolvedValue("old-access");
    mockRefreshAccessToken.mockResolvedValue("new-access");
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(remoteResponse(401, { message: "expired" }))
      .mockResolvedValueOnce(remoteResponse(200, remoteConfig("after-refresh")));

    await expect(fetchRemoteConfig("owner")).resolves.toMatchObject({
      source: "remote",
      config: { configVersion: "after-refresh" },
    });
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
    expect(mockRefreshAccessToken).toHaveBeenCalledWith({
      invalidateSessionOnUnauthorized: false,
    });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer old-access",
    );
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer new-access",
    );
  });

  it("does not refresh a guest 401 or retry a final signed-in 401", async () => {
    mockReadAccessToken.mockResolvedValueOnce(null);
    const guestFetch = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(remoteResponse(401, { message: "guest denied" }));
    await expect(fetchRemoteConfig()).rejects.toThrow("401");
    expect(guestFetch).toHaveBeenCalledTimes(1);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    guestFetch.mockRestore();

    mockReadAccessToken.mockResolvedValueOnce("old-access");
    mockRefreshAccessToken.mockResolvedValueOnce("new-access");
    const signedInFetch = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(remoteResponse(401, { message: "still denied" }));
    await expect(fetchRemoteConfig("owner-final-401")).rejects.toThrow("401");
    expect(signedInFetch).toHaveBeenCalledTimes(2);
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent loads for the same account into one request", async () => {
    mockReadAccessToken.mockResolvedValue("access");
    const pending = deferred<Response>();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockReturnValue(pending.promise);
    const first = fetchRemoteConfig("single-flight");
    const second = fetchRemoteConfig("single-flight", 8_000, { ignoreETag: true });
    pending.resolve(remoteResponse(200, remoteConfig("single-flight")));
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ source: "remote" }),
      expect.objectContaining({ source: "remote" }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function remoteConfig(configVersion: string) {
  return {
    code: 0,
    data: {
      schema_version: 1,
      config_version: configVersion,
      refresh_interval_seconds: 300,
    },
  };
}

function remoteResponse(status: number, payload: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    json: async () => payload,
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
