import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// The six flight-plane imagesets are intentionally out of scope: the user
// explicitly removed the complete airplane feature from the Expo product.
const excludedAssetPrefixes = ["flight_plane_"];
const expectedFileCount = 45;
const expectedAggregate = "7d5a25be20c04d12ad6a9faae260fb1c6696fd9faefde071b33d9aebe60d6c6b";
const mediaPattern = /\.(?:png|jpe?g|gif|webp|pdf|mp3|m4a|wav|caf)$/i;
const projectRoot = process.cwd();
const sourceRoot = path.resolve(projectRoot, "../BWChat/Assets.xcassets");
const copiedRoot = path.resolve(projectRoot, "assets/native-original/Assets.xcassets");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(target) : [target];
    }),
  );
  return files.flat();
}

async function fingerprint(root) {
  const files = (await walk(root))
    .filter((file) => mediaPattern.test(file))
    .filter(
      (file) =>
        !excludedAssetPrefixes.some((prefix) => path.relative(root, file).startsWith(prefix)),
    )
    .sort();
  const records = await Promise.all(
    files.map(async (file) => ({
      relativePath: path.relative(root, file),
      hash: createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
    })),
  );
  const aggregate = createHash("sha256")
    .update(records.map(({ relativePath, hash }) => `${relativePath}\0${hash}`).join("\n"))
    .digest("hex");
  return { files: records, aggregate };
}

const [source, copied] = await Promise.all([fingerprint(sourceRoot), fingerprint(copiedRoot)]);
const sourceMap = new Map(source.files.map((entry) => [entry.relativePath, entry.hash]));
const copiedMap = new Map(copied.files.map((entry) => [entry.relativePath, entry.hash]));
const missing = source.files.filter(({ relativePath }) => !copiedMap.has(relativePath));
const unexpected = copied.files.filter(({ relativePath }) => !sourceMap.has(relativePath));
const changed = source.files.filter(
  ({ relativePath, hash }) => copiedMap.has(relativePath) && copiedMap.get(relativePath) !== hash,
);
const excludedAssetsStillCopied = (await readdir(copiedRoot, { withFileTypes: true }))
  .filter((entry) => excludedAssetPrefixes.some((prefix) => entry.name.startsWith(prefix)))
  .map((entry) => entry.name)
  .sort();

if (
  source.files.length !== expectedFileCount ||
  copied.files.length !== expectedFileCount ||
  source.aggregate !== expectedAggregate ||
  copied.aggregate !== expectedAggregate ||
  missing.length > 0 ||
  unexpected.length > 0 ||
  changed.length > 0 ||
  excludedAssetsStillCopied.length > 0
) {
  console.error(
    JSON.stringify(
      {
        expectedFileCount,
        sourceFileCount: source.files.length,
        copiedFileCount: copied.files.length,
        expectedAggregate,
        sourceAggregate: source.aggregate,
        copiedAggregate: copied.aggregate,
        missing: missing.map(({ relativePath }) => relativePath),
        unexpected: unexpected.map(({ relativePath }) => relativePath),
        changed: changed.map(({ relativePath }) => relativePath),
        excludedAssetsStillCopied,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else {
  console.log(
    `Native assets verified: ${copied.files.length} files, aggregate ${copied.aggregate}`,
  );
}
