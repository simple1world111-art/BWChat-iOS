#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bwchat-android-prebuild-"));
const excludedRootEntries = new Set([
  ".expo",
  ".git",
  "android",
  "artifacts",
  "ios",
  "node_modules",
]);

try {
  for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
    if (excludedRootEntries.has(entry.name) || entry.name.startsWith(".env")) continue;
    fs.cpSync(path.join(projectRoot, entry.name), path.join(temporaryRoot, entry.name), {
      recursive: entry.isDirectory(),
    });
  }
  fs.symlinkSync(
    path.join(projectRoot, "node_modules"),
    path.join(temporaryRoot, "node_modules"),
    "dir",
  );

  const expoCli = path.join(projectRoot, "node_modules", ".bin", "expo");
  const result = spawnSync(expoCli, ["prebuild", "--platform", "android", "--no-install"], {
    cwd: temporaryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "Android prebuild failed\n");
    process.exitCode = result.status ?? 1;
  } else {
    const resourcesRoot = path.join(temporaryRoot, "android", "app", "src", "main", "res");
    const styles = fs.readFileSync(path.join(resourcesRoot, "values", "styles.xml"), "utf8");
    const drawable = fs.readFileSync(
      path.join(resourcesRoot, "drawable", "splashscreen_logo.xml"),
      "utf8",
    );

    assert.match(styles, /windowSplashScreenAnimatedIcon[^\n]*@drawable\/splashscreen_logo/u);
    assert.match(drawable, /@android:color\/transparent/u);
    assert.doesNotMatch(drawable, /<bitmap|android:src=/u);
    process.stdout.write("Android prebuild verified: transparent splash drawable resolves.\n");
  }
} finally {
  const normalizedTemporaryRoot = path.resolve(temporaryRoot);
  const expectedPrefix = `${path.resolve(os.tmpdir())}${path.sep}bwchat-android-prebuild-`;
  assert.ok(normalizedTemporaryRoot.startsWith(expectedPrefix));
  fs.rmSync(normalizedTemporaryRoot, { recursive: true, force: true });
}
