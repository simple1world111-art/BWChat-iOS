import { catalogs, type CatalogLanguage } from "@/localization/catalogs";
import {
  formatUpdateCopy,
  updateCopy,
  type UpdateCopyKey,
} from "@/localization/updateCopy";

describe("update diagnostics localization", () => {
  const languages = Object.keys(catalogs) as CatalogLanguage[];

  test("provides every non-empty update string in all ten app languages", () => {
    expect(languages).toHaveLength(10);
    const expectedKeys = Object.keys(updateCopy("en")).sort() as UpdateCopyKey[];

    for (const language of languages) {
      const copy = updateCopy(language);
      expect(Object.keys(copy).sort()).toEqual(expectedKeys);
      for (const key of expectedKeys) expect(copy[key].trim()).not.toBe("");
    }
  });

  test("formats diagnostic placeholders without changing unrelated text", () => {
    expect(formatUpdateCopy("Selected {count}; {value}", { count: 3, value: "ok" })).toBe(
      "Selected 3; ok",
    );
  });
});
