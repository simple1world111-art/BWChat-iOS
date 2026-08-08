import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import LanguageSettingsScreen from "@/app/language-settings";
import { languageOptions, LocalizationProvider } from "@/providers/LocalizationProvider";
import { languageSettingsPolicy } from "@/services/localization/languageSettingsPolicy";
import {
  readNativeLanguageSelection,
  writeNativeLanguageSelection,
} from "../modules/bwchat-auth-compat/src";

jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("../modules/bwchat-auth-compat/src", () => ({
  readNativeLanguageSelection: jest.fn(),
  writeNativeLanguageSelection: jest.fn(),
}));

const getStoredLanguage = jest.mocked(AsyncStorage.getItem);
const setStoredLanguage = jest.mocked(AsyncStorage.setItem);
const readNativeLanguage = jest.mocked(readNativeLanguageSelection);
const writeNativeLanguage = jest.mocked(writeNativeLanguageSelection);

describe("native LanguageSettingsView parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getStoredLanguage.mockResolvedValue(null);
    setStoredLanguage.mockResolvedValue();
    readNativeLanguage.mockReturnValue(null);
    writeNativeLanguage.mockReturnValue(false);
  });

  it("locks the exact original option order and source geometry", () => {
    expect(languageOptions).toEqual([
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
    ]);
    expect(languageSettingsPolicy).toEqual({
      horizontalPadding: 16,
      topPadding: 20,
      bottomPadding: 30,
      rowMinimumHeight: 50,
      rowVerticalPadding: 5,
      rowSpacing: 13,
      iconSize: 40,
      iconRadius: 10,
      symbolSize: 17,
      titleSize: 16,
      titleMinimumScale: 0.82,
      trailingMinimumSpacing: 10,
      checkmarkSize: 20,
      selectedIconOpacity: 0.16,
      idleIconOpacity: 0.08,
    });
  });

  it("renders all options as buttons, switches immediately and ignores a same-value write", async () => {
    const view = await render(
      <LocalizationProvider>
        <LanguageSettingsScreen />
      </LocalizationProvider>,
    );
    await waitFor(() =>
      expect(view.getByLabelText("简体中文").props.accessibilityState).toEqual({ selected: true }),
    );
    expect(view.getAllByRole("button").map((row) => row.props.accessibilityLabel)).toEqual([
      "跟随系统",
      "English",
      "日本語",
      "한국어",
      "Español",
      "Français",
      "Deutsch",
      "Português (Brasil)",
      "Русский",
      "简体中文",
      "繁體中文",
    ]);

    setStoredLanguage.mockClear();
    await fireEvent.press(view.getByLabelText("English"));
    expect(view.getByLabelText("English").props.accessibilityState).toEqual({ selected: true });
    expect(setStoredLanguage).toHaveBeenCalledTimes(1);
    expect(setStoredLanguage).toHaveBeenCalledWith("app.language.selection", "en");

    await fireEvent.press(view.getByLabelText("English"));
    expect(setStoredLanguage).toHaveBeenCalledTimes(1);
  });

  it("keeps a manual selection when a stale storage hydration finishes later", async () => {
    const pending = deferred<string | null>();
    getStoredLanguage.mockReturnValueOnce(pending.promise);
    const view = await render(
      <LocalizationProvider>
        <LanguageSettingsScreen />
      </LocalizationProvider>,
    );

    await fireEvent.press(view.getByLabelText("日本語"));
    expect(view.getByLabelText("日本語").props.accessibilityState).toEqual({ selected: true });
    pending.resolve("zh-Hant");
    await pending.promise;
    await waitFor(() =>
      expect(view.getByLabelText("日本語").props.accessibilityState).toEqual({ selected: true }),
    );
  });

  it("keeps the immediate selection if persistence fails without leaking a rejection", async () => {
    setStoredLanguage.mockRejectedValueOnce(new Error("storage unavailable"));
    const view = await render(
      <LocalizationProvider>
        <LanguageSettingsScreen />
      </LocalizationProvider>,
    );
    await fireEvent.press(view.getByLabelText("Deutsch"));
    expect(view.getByLabelText("Deutsch").props.accessibilityState).toEqual({ selected: true });
  });

  it("synchronously reuses the original iOS UserDefaults selection and write path", async () => {
    readNativeLanguage.mockReturnValue("en");
    writeNativeLanguage.mockReturnValue(true);
    const view = await render(
      <LocalizationProvider>
        <LanguageSettingsScreen />
      </LocalizationProvider>,
    );
    expect(view.getByLabelText("English").props.accessibilityState).toEqual({ selected: true });
    expect(getStoredLanguage).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText("日本語"));
    expect(writeNativeLanguage).toHaveBeenCalledWith("ja");
    expect(setStoredLanguage).not.toHaveBeenCalled();
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
