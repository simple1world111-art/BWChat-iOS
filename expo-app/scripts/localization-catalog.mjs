import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const locales = ["de", "en", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-Hans", "zh-Hant"];
const expectedEntriesPerLocale = 1_159;
const expectedUniqueKeysPerLocale = 1_158;
const expectedAggregate = "70d61392e36b5b6e5ec818185a0b86bf793fd1a99ec2691471ecedb816ae821b";
const projectRoot = process.cwd();
const nativeRoot = path.resolve(projectRoot, "../BWChat");
const generatedRoot = path.resolve(projectRoot, "src/localization/generated");
const mode = process.argv[2] ?? "verify";

function decodeString(value) {
  return JSON.parse(`"${value.replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")}"`);
}

function parseStrings(source, locale) {
  const entries = {};
  const occurrences = new Map();
  const pattern = /^\s*"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;\s*$/gm;
  for (const match of source.matchAll(pattern)) {
    const key = decodeString(match[1]);
    const value = decodeString(match[2]);
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    entries[key] = value;
  }
  const duplicateKeys = [...occurrences].filter(([, count]) => count > 1).map(([key]) => key);
  if (
    duplicateKeys.length !== 1 ||
    duplicateKeys[0] !== "common.save" ||
    occurrences.get("common.save") !== 2
  ) {
    throw new Error(
      `${locale}: unexpected duplicate localization keys: ${duplicateKeys.join(",")}`,
    );
  }
  const entryCount = [...occurrences.values()].reduce((total, count) => total + count, 0);
  if (entryCount !== expectedEntriesPerLocale) {
    throw new Error(
      `${locale}: expected ${expectedEntriesPerLocale} entries, received ${entryCount}`,
    );
  }
  return Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function readNativeCatalog(locale) {
  const source = await readFile(
    path.join(nativeRoot, `${locale}.lproj/Localizable.strings`),
    "utf8",
  );
  return parseStrings(source, locale);
}

function catalogFingerprint(catalogs) {
  const records = locales.flatMap((locale) =>
    Object.entries(catalogs[locale]).map(([key, value]) => `${locale}\0${key}\0${value}`),
  );
  return createHash("sha256").update(records.join("\n")).digest("hex");
}

const nativeCatalogs = Object.fromEntries(
  await Promise.all(locales.map(async (locale) => [locale, await readNativeCatalog(locale)])),
);
const referenceKeys = Object.keys(nativeCatalogs["zh-Hans"]);
for (const locale of locales) {
  const keys = Object.keys(nativeCatalogs[locale]);
  if (keys.length !== expectedUniqueKeysPerLocale) {
    throw new Error(
      `${locale}: expected ${expectedUniqueKeysPerLocale} unique keys, received ${keys.length}`,
    );
  }
  const missing = referenceKeys.filter((key) => !Object.hasOwn(nativeCatalogs[locale], key));
  const extra = keys.filter((key) => !Object.hasOwn(nativeCatalogs["zh-Hans"], key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${locale}: key parity failed; missing=${missing.join(",")}; extra=${extra.join(",")}`,
    );
  }
}

const aggregate = catalogFingerprint(nativeCatalogs);
if (expectedAggregate !== "TO_BE_REPLACED" && aggregate !== expectedAggregate) {
  throw new Error(
    `Native localization aggregate changed: expected ${expectedAggregate}, received ${aggregate}`,
  );
}

if (mode === "generate") {
  await mkdir(generatedRoot, { recursive: true });
  await Promise.all(
    locales.map((locale) =>
      writeFile(
        path.join(generatedRoot, `${locale}.json`),
        `${JSON.stringify(nativeCatalogs[locale], null, 2)}\n`,
        "utf8",
      ),
    ),
  );
} else if (mode === "verify") {
  for (const locale of locales) {
    const generated = JSON.parse(
      await readFile(path.join(generatedRoot, `${locale}.json`), "utf8"),
    );
    if (JSON.stringify(generated) !== JSON.stringify(nativeCatalogs[locale])) {
      throw new Error(
        `${locale}: generated JSON differs from the Swift Localizable.strings source`,
      );
    }
  }
} else {
  throw new Error(`Unknown localization mode: ${mode}`);
}

console.log(
  `Localization ${mode} passed: ${locales.length} locales × ${expectedEntriesPerLocale} entries (${expectedUniqueKeysPerLocale} unique keys), aggregate ${aggregate}`,
);
