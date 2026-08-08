import de from "./generated/de.json";
import en from "./generated/en.json";
import es from "./generated/es.json";
import fr from "./generated/fr.json";
import ja from "./generated/ja.json";
import ko from "./generated/ko.json";
import ptBR from "./generated/pt-BR.json";
import ru from "./generated/ru.json";
import zhHans from "./generated/zh-Hans.json";
import zhHant from "./generated/zh-Hant.json";

export const catalogs = {
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
} as const;

export type CatalogLanguage = keyof typeof catalogs;
export type LocalizationKey = keyof typeof zhHans;
