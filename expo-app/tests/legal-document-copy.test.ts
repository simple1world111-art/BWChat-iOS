import de from "@/localization/generated/de.json";
import en from "@/localization/generated/en.json";
import es from "@/localization/generated/es.json";
import fr from "@/localization/generated/fr.json";
import ja from "@/localization/generated/ja.json";
import ko from "@/localization/generated/ko.json";
import ptBR from "@/localization/generated/pt-BR.json";
import ru from "@/localization/generated/ru.json";
import zhHans from "@/localization/generated/zh-Hans.json";
import zhHant from "@/localization/generated/zh-Hant.json";

const catalogs = {
  de,
  en,
  es,
  fr,
  ja,
  ko,
  "pt-BR": ptBR,
  ru,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
};

describe("bundled legal document copy", () => {
  it.each(Object.entries(catalogs))(
    "keeps %s privacy and data guidance complete",
    (_locale, catalog) => {
      const privacy = catalog["account.privacyPolicy.fallback"];
      const dataPrivacy = catalog["account.dataPrivacy.fallback"];

      expect(privacy.length).toBeGreaterThan(2_000);
      expect(dataPrivacy.length).toBeGreaterThan(1_100);
      expect(privacy).toContain("2555");
      expect(privacy).toContain("1095");
      expect(dataPrivacy).toContain("2555");
      expect(dataPrivacy).toContain("1095");
      expect(privacy).not.toBe(dataPrivacy);
      expect(`${privacy}\n${dataPrivacy}`).not.toMatch(/@wegpt\.com|bananaworld/iu);
    },
  );

  it("covers the deployed BBchat data domains without copying the short placeholder", () => {
    const privacy = zhHans["account.privacyPolicy.fallback"];
    const dataPrivacy = zhHans["account.dataPrivacy.fallback"];

    for (const term of [
      "通讯录",
      "位置",
      "AI",
      "StoreKit",
      "Google Mobile Ads",
      "Sentry",
      "Expo",
    ]) {
      expect(privacy).toContain(term);
    }
    for (const term of ["清晰告知", "目的明确", "最小必要", "用户可控", "信息的来源与类别"]) {
      expect(privacy).toContain(term);
    }
    for (const term of ["删除账号", "金币", "提现", "群组", "user_id"]) {
      expect(dataPrivacy).toContain(term);
    }
  });
});
