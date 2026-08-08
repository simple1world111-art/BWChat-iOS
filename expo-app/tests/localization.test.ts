import {
  localizedString,
  matchLanguage,
} from "@/providers/LocalizationProvider";

describe("native localization parity", () => {
  it("matches the same system-language aliases as AppLanguageStore", () => {
    expect(matchLanguage("zh_TW")).toBe("zh-Hant");
    expect(matchLanguage("zh-CN")).toBe("zh-Hans");
    expect(matchLanguage("pt-BR")).toBe("pt-BR");
    expect(matchLanguage("en-US")).toBe("en");
    expect(matchLanguage("it-IT")).toBeNull();
  });

  it("uses the original catalog values and Apple-style placeholders", () => {
    expect(localizedString("en", "profile.wallet.balance", 85)).toBe("85 Gold Coins");
    expect(localizedString("zh-Hans", "username.reset.current", "alice")).toBe("用户名：alice");
    expect(localizedString("de", "common.save")).toBe("Sichern");
  });
});
