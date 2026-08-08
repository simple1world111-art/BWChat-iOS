#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const easCliVersion = "21.6.0";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectId = "f623eda4-1a5f-4227-9890-1a2eb5a6df2c";
const profiles = ["development", "preview", "production"];
const platforms = ["ios", "android"];
const verified = [];

for (const profile of profiles) {
  for (const platform of platforms) {
    const result = spawnSync(
      "pnpm",
      [
        "dlx",
        `eas-cli@${easCliVersion}`,
        "config",
        "--platform",
        platform,
        "--profile",
        profile,
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
      process.stderr.write(`EAS config verification failed for ${profile}/${platform}.\n`);
      process.stderr.write(result.stderr || result.stdout || `${profile}/${platform} failed\n`);
      process.exit(result.status ?? 1);
    }

    const resolved = JSON.parse(result.stdout);
    const { appConfig, buildProfile } = resolved;
    assert.equal(buildProfile.channel, profile);
    assert.equal(buildProfile.environment, profile);
    assert.equal(buildProfile.env.APP_ENV, profile);
    assert.equal(appConfig.owner, "wegpt");
    assert.equal(appConfig.slug, "bbchat");
    assert.deepEqual(appConfig.runtimeVersion, { policy: "fingerprint" });
    assert.equal(appConfig.updates.enabled, true);
    assert.equal(appConfig.updates.checkAutomatically, "NEVER");
    assert.equal(appConfig.updates.fallbackToCacheTimeout, 0);
    assert.equal(appConfig.updates.url, `https://u.expo.dev/${projectId}`);
    assert.equal(appConfig.extra.environment, profile);
    assert.equal(appConfig.extra.eas.projectId, projectId);
    for (const key of ["apiBaseUrl", "webBaseUrl", "webSocketUrl", "remoteConfigUrl"]) {
      assert.ok(new URL(appConfig.extra[key]).hostname, `${profile}/${platform} ${key}`);
    }
    assert.equal(appConfig.ios.bundleIdentifier, "com.bwchat.app");
    assert.equal(appConfig.android.package, "com.bwchat.app");
    assert.equal(
      appConfig.ios.entitlements["aps-environment"],
      profile === "production" ? "production" : "development",
    );
    if (profile === "development") {
      assert.equal(buildProfile.developmentClient, true);
      assert.equal(buildProfile.distribution, "internal");
    } else if (profile === "preview") {
      assert.equal(buildProfile.distribution, "internal");
    } else {
      assert.equal(buildProfile.distribution, "store");
      assert.equal(buildProfile.autoIncrement, true);
    }
    verified.push(`${profile}/${platform}`);
  }
}

process.stdout.write(`EAS config verified: ${verified.join(", ")}\n`);
