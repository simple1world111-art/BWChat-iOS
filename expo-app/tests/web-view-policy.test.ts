import {
  defaultWebViewPolicy,
  gameLaunchPolicy,
  hostMatchesDomain,
  normalizeWebViewPolicy,
  policyAllowsURL,
  shouldOpenURLExternally,
} from "@/services/web/WebViewPolicy";

describe("WebViewPolicy", () => {
  it("normalizes the native snake_case contract and drops unsupported bridge methods", () => {
    expect(
      normalizeWebViewPolicy({
        allowed_domains: ["example.com", " games.example.com "],
        blocked_domains: ["blocked.example.com"],
        allowed_bridge_methods: ["close", "evil", "getAppInfo"],
        external_domains_open_in_safari: false,
        require_https: false,
        permission_policy: { camera: "deny", invalid: 4 },
      }),
    ).toEqual({
      allowedDomains: ["example.com", "games.example.com"],
      blockedDomains: ["blocked.example.com"],
      allowedBridgeMethods: ["close", "getAppInfo"],
      externalDomainsOpenInSafari: false,
      requireHTTPS: false,
      permissionPolicy: { camera: "deny", invalid: "4" },
    });
  });

  it("uses the exact native defaults when the remote value is malformed", () => {
    expect(normalizeWebViewPolicy(null)).toEqual(defaultWebViewPolicy);
    expect(
      normalizeWebViewPolicy({ allowed_domains: ["example.com"] }).allowedBridgeMethods,
    ).toEqual(["close", "openRoute", "getAppInfo", "setNavigationTitle"]);
  });

  it("preserves an explicit empty bridge allowlist and does not trim method names", () => {
    expect(normalizeWebViewPolicy({ allowed_bridge_methods: [] }).allowedBridgeMethods).toEqual([]);
    expect(
      normalizeWebViewPolicy({ allowed_bridge_methods: [" close ", "close"] }).allowedBridgeMethods,
    ).toEqual(["close"]);
  });

  it("matches exact domains and subdomains while blocked domains retain final precedence", () => {
    const policy = normalizeWebViewPolicy({
      allowed_domains: ["example.com"],
      blocked_domains: ["private.example.com"],
    });
    expect(hostMatchesDomain("a.example.com", " example.com ")).toBe(true);
    expect(hostMatchesDomain("fakeexample.com", "example.com")).toBe(false);
    expect(policyAllowsURL("https://example.com/a", policy)).toBe(true);
    expect(policyAllowsURL("https://a.example.com/a", policy)).toBe(true);
    expect(policyAllowsURL("https://private.example.com/a", policy)).toBe(false);
    expect(policyAllowsURL("https://a.private.example.com/a", policy)).toBe(false);
    expect(policyAllowsURL("https://example.net/a", policy)).toBe(false);
  });

  it("enforces HTTPS except for the explicit development localhost escape hatch", () => {
    const policy = normalizeWebViewPolicy({ allowed_domains: ["localhost", "example.com"] });
    expect(policyAllowsURL("http://example.com", policy)).toBe(false);
    expect(policyAllowsURL("http://localhost:8081", policy)).toBe(false);
    expect(
      policyAllowsURL("http://localhost:8081", policy, { allowDevelopmentLocalhost: true }),
    ).toBe(true);
    const nativeDebugPolicy = normalizeWebViewPolicy({
      allowed_domains: [],
      blocked_domains: ["localhost"],
    });
    expect(
      policyAllowsURL("http://localhost:8081", nativeDebugPolicy, {
        allowDevelopmentLocalhost: true,
      }),
    ).toBe(true);
  });

  it("merges id7.com for game launches without overriding a block", () => {
    const policy = gameLaunchPolicy(
      normalizeWebViewPolicy({
        allowed_domains: ["playdot.games"],
        blocked_domains: ["id7.com"],
      }),
    );
    expect(policy.allowedDomains).toEqual(["playdot.games", "id7.com"]);
    expect(policyAllowsURL("https://id7.com/api/v1/game-assets/a", policy)).toBe(false);
  });

  it("recognizes only the native external scheme and Apple host families", () => {
    expect(shouldOpenURLExternally("tel:+12025550123")).toBe(true);
    expect(shouldOpenURLExternally("https://apps.apple.com/app/id1")).toBe(true);
    expect(shouldOpenURLExternally("https://sub.itunes.apple.com/a")).toBe(true);
    expect(shouldOpenURLExternally("https://apps.apple.com.evil.test/a")).toBe(false);
    expect(shouldOpenURLExternally("https://example.com/a")).toBe(false);
  });
});
