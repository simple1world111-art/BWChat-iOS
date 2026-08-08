import { localizedDynamicText, openDynamicRoute } from "@/services/web/DynamicRouteNavigator";
import { defaultWebViewPolicy } from "@/services/web/WebViewPolicy";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockDismissAll = jest.fn();
const mockOpenURL = jest.fn<Promise<void>, [string]>();

jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    dismissAll: () => mockDismissAll(),
  },
}));

jest.mock("expo-linking", () => ({
  openURL: (url: string) => mockOpenURL(url),
}));

describe("dynamic route localization", () => {
  const values = {
    en: "English",
    ja: "日本語",
    "pt-BR": "Português",
    "zh-Hans": "简体中文",
    "zh-Hant": "繁體中文",
  };

  const supportedLanguages = [
    "en",
    "ja",
    "ko",
    "es",
    "fr",
    "de",
    "pt-BR",
    "ru",
    "zh-Hans",
    "zh-Hant",
  ] as const;

  it("selects the exact entry for all ten native app languages", () => {
    const allValues = Object.fromEntries(
      supportedLanguages.map((language) => [language, `copy:${language}`]),
    );
    for (const language of supportedLanguages) {
      expect(localizedDynamicText(allValues, language)).toBe(`copy:${language}`);
    }
  });

  it("prefers the exact active locale and then its base language", () => {
    expect(localizedDynamicText(values, "pt-BR")).toBe("Português");
    expect(localizedDynamicText(values, "ja-JP")).toBe("日本語");
  });

  it("uses the exact supported Chinese script selection", () => {
    expect(localizedDynamicText(values, "zh-Hans")).toBe("简体中文");
    expect(localizedDynamicText(values, "zh-Hant")).toBe("繁體中文");
  });

  it("falls back to English when the active locale is absent", () => {
    expect(localizedDynamicText(values, "de-DE")).toBe("English");
  });

  it("uses raw locale, normalized locale, base, English and Simplified Chinese in Swift order", () => {
    expect(
      localizedDynamicText({ pt_BR: "raw", "pt-BR": "locale", pt: "base", en: "English" }, "pt_BR"),
    ).toBe("raw");
    expect(localizedDynamicText({ "pt-BR": "locale", pt: "base", en: "English" }, "pt_BR")).toBe(
      "locale",
    );
    expect(localizedDynamicText({ pt: "base", en: "English" }, "pt-PT")).toBe("base");
    expect(localizedDynamicText({ en: "English", "zh-Hans": "简体" }, "it-IT")).toBe("English");
    expect(localizedDynamicText({ "zh-Hans": "简体" }, "it-IT")).toBe("简体");
  });

  it("does not inject Chinese aliases that Swift never searches", () => {
    expect(localizedDynamicText({ "zh-Hant": "繁體", en: "English" }, "zh-HK")).toBe("English");
    expect(localizedDynamicText({ "zh-Hans": "简体" }, "zh-CN")).toBe("简体");
  });
});

describe("dynamic route native semantics", () => {
  const translate = (key: string) =>
    ({
      "common.operationFailed": "操作失败",
    })[key] ?? key;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenURL.mockResolvedValue();
  });

  it("treats a missing type as coming-soon instead of implicitly native", async () => {
    await expect(
      openDynamicRoute(
        { name: "wallet" },
        defaultWebViewPolicy,
        "Page",
        "Coming soon",
        "en",
        translate,
      ),
    ).resolves.toEqual({ handled: false, title: "Page", message: "Coming soon" });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("switches the map root tab instead of opening the feature placeholder", async () => {
    await expect(
      openDynamicRoute(
        { type: "native", name: "map" },
        defaultWebViewPolicy,
        "Page",
        "Coming soon",
        "en",
        translate,
      ),
    ).resolves.toEqual({ handled: true });
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/map");
  });

  it("pushes Contacts as a non-root screen because the native tab is intentionally hidden", async () => {
    await expect(
      openDynamicRoute(
        { type: "native", name: "contacts" },
        defaultWebViewPolicy,
        "Page",
        "Coming soon",
        "en",
        translate,
      ),
    ).resolves.toEqual({ handled: true });
    expect(mockPush).toHaveBeenCalledWith("/contacts");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("pushes Nearby without replacing the retained Map root tab", async () => {
    await expect(
      openDynamicRoute(
        { type: "native", name: "nearby" },
        defaultWebViewPolicy,
        "Page",
        "Coming soon",
        "en",
        translate,
      ),
    ).resolves.toEqual({ handled: true });
    expect(mockPush).toHaveBeenCalledWith("/nearby");
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("uses common.operationFailed for a rejected web URL", async () => {
    await expect(
      openDynamicRoute(
        { type: "web", url: "https://blocked.example/path" },
        defaultWebViewPolicy,
        "Page",
        "Coming soon",
        "en",
        translate,
      ),
    ).resolves.toEqual({ handled: false, title: "Page", message: "操作失败" });
  });

  it("considers an explicitly allowed external handoff handled without preflighting", async () => {
    await expect(
      openDynamicRoute(
        { type: "external", url: "custom-app://open", params: { allow_external: true } },
        defaultWebViewPolicy,
        "Page",
        "Coming soon",
        "en",
        translate,
      ),
    ).resolves.toEqual({ handled: true });
    expect(mockOpenURL).toHaveBeenCalledWith("custom-app://open");
  });

  it("accepts the same flexible JSON string booleans for external allowlisting", async () => {
    await expect(
      openDynamicRoute(
        { type: "external", url: "custom-app://open", params: { allow_external: "yes" } },
        defaultWebViewPolicy,
        "Page",
        "Coming soon",
        "en",
        translate,
      ),
    ).resolves.toEqual({ handled: true });
  });
});
