import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { catalogs, type CatalogLanguage, type LocalizationKey } from "@/localization/catalogs";
import { visualAcceptanceLanguage } from "@/services/visualAcceptance";
import {
  readNativeLanguageSelection,
  writeNativeLanguageSelection,
} from "../../modules/bwchat-auth-compat/src";

export type AppLanguage = "system" | CatalogLanguage;

export interface LanguageOption {
  id: AppLanguage;
  nativeName: string;
}

export const languageOptions: readonly LanguageOption[] = [
  { id: "system", nativeName: "跟随系统" },
  { id: "en", nativeName: "English" },
  { id: "ja", nativeName: "日本語" },
  { id: "ko", nativeName: "한국어" },
  { id: "es", nativeName: "Español" },
  { id: "fr", nativeName: "Français" },
  { id: "de", nativeName: "Deutsch" },
  { id: "pt-BR", nativeName: "Português (Brasil)" },
  { id: "ru", nativeName: "Русский" },
  { id: "zh-Hans", nativeName: "简体中文" },
  { id: "zh-Hant", nativeName: "繁體中文" },
];

const storageKey = "app.language.selection";
const fallbackLanguage: CatalogLanguage = "zh-Hans";
let activeLanguageSnapshot: CatalogLanguage = fallbackLanguage;

interface LocalizationContextValue {
  selectedLanguage: AppLanguage;
  activeLanguage: CatalogLanguage;
  selectedLanguageName: string;
  setLanguage(language: AppLanguage): Promise<void>;
  t(key: LocalizationKey | string, ...args: (string | number)[]): string;
}

const LocalizationContext = createContext<LocalizationContextValue | null>(null);

export function LocalizationProvider({ children }: { children: React.ReactNode }) {
  const nativeSelection = useMemo(() => readNativeLanguageSelection(), []);
  const initialLanguage =
    visualAcceptanceLanguage ??
    (isAppLanguage(nativeSelection) ? nativeSelection : fallbackLanguage);
  const [selectedLanguage, setSelectedLanguage] = useState<AppLanguage>(initialLanguage);
  const selectedLanguageRef = useRef<AppLanguage>(initialLanguage);
  const selectionGenerationRef = useRef(0);
  const activeLanguage =
    selectedLanguage === "system" ? preferredSystemLanguage() : selectedLanguage;

  useEffect(() => {
    activeLanguageSnapshot = activeLanguage;
  }, [activeLanguage]);

  useEffect(() => {
    if (visualAcceptanceLanguage || isAppLanguage(nativeSelection)) return;
    let active = true;
    const generation = selectionGenerationRef.current;
    void AsyncStorage.getItem(storageKey)
      .then((stored) => {
        if (active && generation === selectionGenerationRef.current && isAppLanguage(stored)) {
          selectedLanguageRef.current = stored;
          activeLanguageSnapshot = stored === "system" ? preferredSystemLanguage() : stored;
          setSelectedLanguage(stored);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [nativeSelection]);

  const setLanguage = useCallback(async (language: AppLanguage) => {
    if (selectedLanguageRef.current === language) return;
    selectionGenerationRef.current += 1;
    selectedLanguageRef.current = language;
    setSelectedLanguage(language);
    activeLanguageSnapshot = language === "system" ? preferredSystemLanguage() : language;
    if (writeNativeLanguageSelection(language)) return;
    try {
      await AsyncStorage.setItem(storageKey, language);
    } catch {
      // UserDefaults writes in the native app are non-throwing from this UI.
      // Keep the immediate in-memory selection and avoid an unhandled rejection.
    }
  }, []);

  const t = useCallback(
    (key: LocalizationKey | string, ...args: (string | number)[]) =>
      localizedString(activeLanguage, key, ...args),
    [activeLanguage],
  );
  const selectedLanguageName =
    selectedLanguage === "system"
      ? t("language.option.system")
      : (languageOptions.find((option) => option.id === selectedLanguage)?.nativeName ??
        selectedLanguage);

  const value = useMemo<LocalizationContextValue>(
    () => ({ selectedLanguage, activeLanguage, selectedLanguageName, setLanguage, t }),
    [activeLanguage, selectedLanguage, selectedLanguageName, setLanguage, t],
  );
  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
}

export function useLocalization(): LocalizationContextValue {
  const value = useContext(LocalizationContext);
  if (!value) throw new Error("useLocalization must be used inside LocalizationProvider");
  return value;
}

export function getActiveLanguageCode(): CatalogLanguage {
  return activeLanguageSnapshot;
}

export function localizedString(
  language: CatalogLanguage,
  key: LocalizationKey | string,
  ...args: (string | number)[]
): string {
  const catalog = catalogs[language] as Record<string, string>;
  const fallback = catalogs[fallbackLanguage] as Record<string, string>;
  const format = catalog[key] ?? fallback[key] ?? key;
  return args.length > 0 ? formatAppleString(format, args) : format;
}

export function preferredSystemLanguage(): CatalogLanguage {
  for (const locale of getLocales()) {
    const matched = matchLanguage(locale.languageTag);
    if (matched) return matched;
  }
  return fallbackLanguage;
}

export function matchLanguage(identifier: string): CatalogLanguage | null {
  const normalized = identifier.replaceAll("_", "-").toLocaleLowerCase();
  if (
    normalized.startsWith("zh-hant") ||
    normalized.startsWith("zh-tw") ||
    normalized.startsWith("zh-hk")
  )
    return "zh-Hant";
  if (normalized.startsWith("zh")) return "zh-Hans";
  if (normalized.startsWith("pt-br")) return "pt-BR";
  return (
    (Object.keys(catalogs) as CatalogLanguage[]).find((locale) =>
      normalized.startsWith(locale.toLocaleLowerCase()),
    ) ?? null
  );
}

function isAppLanguage(value: string | null): value is AppLanguage {
  return value === "system" || Object.hasOwn(catalogs, value ?? "");
}

function formatAppleString(format: string, args: (string | number)[]): string {
  let nextIndex = 0;
  return format
    .replace(
      /%(?:(\d+)\$)?(?:[-+0 #]*)(?:\d+|\*)?(?:\.\d+)?(?:ll|l|h)?([@diuf])/g,
      (token, position: string | undefined, kind: string) => {
        const index = position ? Number(position) - 1 : nextIndex++;
        const value = args[index];
        if (value === undefined) return token;
        if (kind === "d" || kind === "i" || kind === "u") return String(Math.trunc(Number(value)));
        if (kind === "f") {
          const precision = /\.(\d+)/.exec(token)?.[1];
          return precision ? Number(value).toFixed(Number(precision)) : String(Number(value));
        }
        return String(value);
      },
    )
    .replaceAll("%%", "%");
}
