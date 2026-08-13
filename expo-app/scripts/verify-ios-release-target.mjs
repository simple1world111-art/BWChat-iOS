#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(projectRoot, "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const rootReadme = readFileSync(path.join(repositoryRoot, "README.md"), "utf8");
const workflows = ["expo-ci.yml", "eas-update.yml"].map((name) =>
  readFileSync(path.join(repositoryRoot, ".github", "workflows", name), "utf8"),
);

assert.match(
  packageJson.scripts["build:prod:ios"] ?? "",
  /eas-cli@[^\s]+ build --profile production --platform ios$/,
  "Production iOS must be built through the pinned EAS command.",
);
assert.match(
  rootReadme,
  /BWChat\.xcodeproj.*不得用于 TestFlight 或 App Store 归档/,
  "The legacy root Xcode project must remain explicitly marked non-releasable.",
);
for (const workflow of workflows) {
  assert.doesNotMatch(workflow, /\bxcodebuild\b|BWChat\.xcodeproj/);
  assert.match(workflow, /working-directory:\s*expo-app/);
}

process.stdout.write(
  "iOS release target verified: Expo CNG/EAS only; legacy root scheme blocked.\n",
);
