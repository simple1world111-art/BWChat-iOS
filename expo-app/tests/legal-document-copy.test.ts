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

const noExpiryCopy: Record<keyof typeof catalogs, RegExp> = {
  de: /kein Ablaufdatum/u,
  en: /no expiration date/u,
  es: /no tienen fecha de vencimiento/u,
  fr: /n’ont pas de date d’expiration/u,
  ja: /有効期限はなく/u,
  ko: /만료일이 없으며/u,
  "pt-BR": /não têm data de expiração/u,
  ru: /не имеют срока истечения/u,
  "zh-Hans": /不设置到期日/u,
  "zh-Hant": /不設到期日/u,
};

describe("bundled legal document copy", () => {
  it.each(Object.entries(catalogs))(
    "keeps %s privacy and data guidance complete",
    (_locale, catalog) => {
      const privacy = catalog["account.privacyPolicy.fallback"];
      const dataPrivacy = catalog["account.dataPrivacy.fallback"];

      expect(privacy.length).toBeGreaterThan(1_900);
      expect(dataPrivacy.length).toBeGreaterThan(1_100);
      expect(privacy).toContain("2555");
      expect(privacy).toContain("1095");
      expect(dataPrivacy).toContain("2555");
      expect(dataPrivacy).toContain("1095");
      expect(privacy).not.toBe(dataPrivacy);
      expect(`${privacy}\n${dataPrivacy}`).not.toContain("USDT");
      expect(`${privacy}\n${dataPrivacy}`).not.toMatch(/@wegpt\.com|bananaworld/iu);
    },
  );

  it.each(Object.entries(catalogs))(
    "ships a complete branded %s recharge agreement with a no-expiry promise",
    (locale, catalog) => {
      const title = catalog["wallet.terms.title"];
      const required = catalog["wallet.terms.required"];
      const agreement = catalog["wallet.terms.fallback"];

      expect(title).toContain("BBchat");
      expect(required).toContain("BBchat");
      expect(agreement.length).toBeGreaterThan(1_200);
      expect(agreement).toContain("BBchat");
      expect(agreement).toContain("StoreKit");
      expect(agreement).toContain("Apple");
      expect(agreement).toMatch(noExpiryCopy[locale as keyof typeof catalogs]);
      expect(`${title}\n${required}\n${agreement}`).not.toMatch(/Cat(?: Box|-Box)|猫箱|貓箱/iu);
    },
  );

  it.each(Object.entries(catalogs))(
    "adds concrete phone, rewarded-ad, and AI disclosures in %s",
    (_locale, catalog) => {
      const privacy = catalog["account.privacyPolicy.supplement"];
      const controls = catalog["account.dataPrivacy.supplement"];

      expect(privacy.length).toBeGreaterThan(400);
      expect(controls.length).toBeGreaterThan(350);
      expect(`${privacy}\n${controls}`).toContain("BBchat");
      expect(privacy).toContain("Google Mobile Ads");
      expect(`${privacy}\n${controls}`).toMatch(/AI|IA|KI|ИИ/u);
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
    for (const term of ["删除账号", "金币", "消费记录", "群组", "user_id"]) {
      expect(dataPrivacy).toContain(term);
    }
    expect(`${privacy}\n${dataPrivacy}`).not.toMatch(/提现|提現|提領/iu);
  });
});
