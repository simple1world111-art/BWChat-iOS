#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const easCliVersion = "21.6.0";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectId = "f623eda4-1a5f-4227-9890-1a2eb5a6df2c";
const profiles = [
  { name: "development", environment: "development", platforms: ["ios", "android"] },
  { name: "development-simulator", environment: "development", platforms: ["ios"] },
  { name: "preview", environment: "preview", platforms: ["ios", "android"] },
  { name: "preview-simulator", environment: "preview", platforms: ["ios"] },
  { name: "production", environment: "production", platforms: ["ios", "android"] },
];
const verified = [];

for (const profile of profiles) {
  for (const platform of profile.platforms) {
    const result = spawnSync(
      "pnpm",
      [
        "dlx",
        `eas-cli@${easCliVersion}`,
        "config",
        "--platform",
        platform,
        "--profile",
        profile.name,
        "--json",
        "--non-interactive",
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: [path.dirname(process.execPath), process.env.PATH]
            .filter(Boolean)
            .join(path.delimiter),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.stderr.write(`EAS config verification failed for ${profile.name}/${platform}.\n`);
      process.stderr.write(
        result.stderr || result.stdout || `${profile.name}/${platform} failed\n`,
      );
      process.exit(result.status ?? 1);
    }

    const resolved = JSON.parse(result.stdout);
    const { appConfig, buildProfile } = resolved;
    assert.equal(buildProfile.channel, profile.environment);
    assert.equal(buildProfile.environment, profile.environment);
    assert.equal(buildProfile.env.APP_ENV, profile.environment);
    assert.equal(appConfig.owner, "wegpt");
    assert.equal(appConfig.slug, "bbchat");
    assert.deepEqual(appConfig.runtimeVersion, { policy: "fingerprint" });
    assert.equal(appConfig.updates.enabled, true);
    assert.equal(appConfig.updates.checkAutomatically, "NEVER");
    assert.equal(appConfig.updates.fallbackToCacheTimeout, 0);
    assert.equal(appConfig.updates.url, `https://u.expo.dev/${projectId}`);
    assert.equal(appConfig.extra.environment, profile.environment);
    assert.equal(appConfig.extra.eas.projectId, projectId);
    for (const key of ["apiBaseUrl", "webBaseUrl", "webSocketUrl", "remoteConfigUrl"]) {
      assert.ok(new URL(appConfig.extra[key]).hostname, `${profile.name}/${platform} ${key}`);
    }
    assert.equal(appConfig.ios.bundleIdentifier, "com.bwchat.app");
    assert.equal(appConfig.android.package, "com.bwchat.app");
    assert.equal(
      appConfig.ios.entitlements["aps-environment"],
      profile.environment === "production" ? "production" : "development",
    );
    if (profile.name === "development") {
      assert.equal(buildProfile.developmentClient, true);
      assert.equal(buildProfile.distribution, "internal");
    } else if (profile.name === "development-simulator") {
      assert.equal(buildProfile.developmentClient, true);
      assert.equal(buildProfile.distribution, "internal");
      assert.equal(buildProfile.simulator, true);
    } else if (profile.name === "preview") {
      assert.equal(buildProfile.distribution, "internal");
    } else if (profile.name === "preview-simulator") {
      assert.equal(buildProfile.distribution, "internal");
      assert.equal(buildProfile.simulator, true);
    } else {
      assert.equal(buildProfile.distribution, "store");
      assert.equal(buildProfile.autoIncrement, true);
    }
    verified.push(`${profile.name}/${platform}`);
  }
}

process.stdout.write(`EAS config verified: ${verified.join(", ")}\n`);
