#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFingerprintAsync } from "@expo/fingerprint";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultEasProjectId = "f623eda4-1a5f-4227-9890-1a2eb5a6df2c";
const nodeDirectory = path.dirname(process.execPath);
process.env.PATH = [nodeDirectory, process.env.PATH].filter(Boolean).join(path.delimiter);

const requestedPlatform = process.argv[2] ?? "all";
const platforms =
  requestedPlatform === "all"
    ? ["ios", "android"]
    : requestedPlatform === "ios" || requestedPlatform === "android"
      ? [requestedPlatform]
      : null;

if (!platforms) {
  process.stderr.write("Usage: pnpm fingerprint:generate -- [ios|android|all]\n");
  process.exit(2);
}

const environment = process.env.APP_ENV ?? "development";
const projectId = process.env.EAS_PROJECT_ID?.trim() || defaultEasProjectId;

const fingerprints = {};
for (const platform of platforms) {
  const result = await createFingerprintAsync(projectRoot, {
    platforms: [platform],
    silent: true,
  });
  fingerprints[platform] = {
    hash: result.hash,
    sourceCount: result.sources.length,
  };
}

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      environment,
      projectIdConfigured: Boolean(projectId),
      fingerprints,
    },
    null,
    2,
  )}\n`,
);
