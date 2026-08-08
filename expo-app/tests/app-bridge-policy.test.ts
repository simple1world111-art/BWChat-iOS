import fs from "node:fs";
import path from "node:path";

import { catalogs } from "@/localization/catalogs";
import {
  appBridgeInfo,
  bridgeNavigationTitle,
  decodeAppBridgeRoute,
} from "@/services/web/AppBridge";

describe("InAppWeb app bridge parity", () => {
  it("decodes the native snake_case DynamicRoute shape from objects and JSON strings", () => {
    const route = {
      type: "native",
      name: "wallet",
      screen_id: "daily_rewards",
      title_key: "wallet.title",
      title: "  Wallet  ",
      title_i18n: { en: "Wallet", "zh-Hans": "钱包" },
      message_key: "common.operationFailed",
      message: "  Message  ",
      message_i18n: { en: "Message" },
      params: { allow_external: true, count: 2, nested: [null, "x"] },
    };
    const expected = {
      type: "native",
      name: "wallet",
      screenId: "daily_rewards",
      titleKey: "wallet.title",
      title: "  Wallet  ",
      titleI18n: { en: "Wallet", "zh-Hans": "钱包" },
      messageKey: "common.operationFailed",
      message: "  Message  ",
      messageI18n: { en: "Message" },
      params: { allow_external: true, count: 2, nested: [null, "x"] },
    };
    expect(decodeAppBridgeRoute(route)).toEqual(expected);
    expect(decodeAppBridgeRoute(JSON.stringify(route))).toEqual(expected);
  });

  it("ignores unknown/camel keys but rejects a present field with the wrong JSON type", () => {
    expect(decodeAppBridgeRoute({ screenId: "camel-is-unknown", unknown: 1 })).toEqual({});
    expect(decodeAppBridgeRoute({ type: 1 })).toBeUndefined();
    expect(decodeAppBridgeRoute({ title_i18n: { en: 1 } })).toBeUndefined();
    expect(decodeAppBridgeRoute({ params: [] })).toBeUndefined();
    expect(decodeAppBridgeRoute("not-json")).toBeUndefined();
  });

  it("preserves title whitespace and truncates by 40 Swift-style graphemes", () => {
    const family = "👨‍👩‍👧‍👦";
    expect(bridgeNavigationTitle("  Title  ")).toBe("  Title  ");
    expect(bridgeNavigationTitle("   \n")).toBeUndefined();
    expect(bridgeNavigationTitle(family.repeat(41))).toBe(family.repeat(40));
  });

  it("uses AppBuildInfo-compatible fallbacks and integer build rendering", () => {
    expect(appBridgeInfo(undefined, undefined)).toEqual({
      appVersion: "0",
      build: "0",
      platform: "iOS",
    });
    expect(appBridgeInfo("1.2.3", "0008")).toEqual({
      appVersion: "1.2.3",
      build: "8",
      platform: "iOS",
    });
    expect(appBridgeInfo("1", "1.2").build).toBe("0");
  });

  it("has every visible InAppWeb key in all ten bundled languages", () => {
    const keys = [
      "common.back",
      "common.loading",
      "common.ok",
      "common.operationFailed",
      "common.retry",
      "discover.comingSoon",
      "gameCenter.sessionFailed",
    ] as const;
    expect(Object.keys(catalogs)).toHaveLength(10);
    for (const catalog of Object.values(catalogs)) {
      for (const key of keys) expect(catalog[key].trim()).not.toBe("");
    }
  });

  it("keeps close independent of the payment overlay and exposes loading/toast semantics", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../src/app/in-app-web.tsx"), "utf8");
    expect(source).toContain('case "close":\n          if (!isTabRoot) router.back();');
    expect(source).toContain("export function InAppWebContent(");
    expect(source).toContain('Object.prototype.hasOwnProperty.call(body, "route")');
    expect(source.match(/allowDevelopmentLocalhost: __DEV__/g)).toHaveLength(2);
    expect(source).toContain('accessibilityRole="progressbar"');
    expect(source).toContain('accessibilityRole="alert"');
    expect(source).toContain(
      'Alert.alert(outcome.title, outcome.message, [{ text: t("common.ok") }]',
    );
  });
});
