#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EAS_CLI_VERSION,
  parseAndValidatePreviewPlatformGroup,
  previewGroupGitCommitHash,
  previewPublishArgs,
  productionPublishArgs,
  requireCleanMatchingCommit,
  requireCleanWorkingTree,
  requirePreviewGroupId,
  requirePreviewVerification,
  validatePreviewBatch,
} from "./eas-release-policy.mjs";
import { withResolvableExpoCli } from "./ensure-expo-cli-resolvable.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [target, ...rawValues] = process.argv.slice(2).filter((value) => value !== "--");
const dryRun = rawValues.includes("--dry-run");
const values = rawValues.filter((value) => value !== "--dry-run");

if (target !== "preview" && target !== "production") {
  process.stderr.write(
    'Usage: pnpm update:preview -- [--dry-run] [--platform ios|android|all] "message" | pnpm update:production -- [--dry-run] <preview-ios-group-id> <preview-android-group-id> "VERIFIED: evidence"\n',
  );
  process.exit(2);
}

process.env.PATH = [path.dirname(process.execPath), process.env.PATH]
  .filter(Boolean)
  .join(path.delimiter);

function runEas(args, options = {}) {
  // EAS CLI first evaluates the dynamic config before it downloads the selected
  // EAS Environment. A shell-level APP_ENV would make that first evaluation
  // require packaged-app variables that are only available after the download.
  const childEnvironment = { ...process.env };
  delete childEnvironment.APP_ENV;
  delete childEnvironment.BWCHAT_EXPECTED_APP_ENV;
  return spawnSync("pnpm", ["dlx", `eas-cli@${EAS_CLI_VERSION}`, ...args], {
    cwd: projectRoot,
    encoding: options.encoding,
    env: childEnvironment,
    stdio: options.stdio,
    shell: false,
  });
}

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `git ${args.join(" ")} failed.`);
  }
  return result.stdout ?? "";
}

try {
  if (target === "preview") {
    const { platform, remainingValues } = extractPreviewPlatform(values);
    const message = remainingValues.join(" ").trim();
    const args = previewPublishArgs(message, platform);
    if (dryRun) {
      printDryRun([
        {
          command: ["pnpm", "dlx", `eas-cli@${EAS_CLI_VERSION}`, ...args],
          environmentSource: "EAS --environment preview",
          initialConfigEnvironment: "development",
        },
      ]);
      process.exit(0);
    }
    const currentCommit = runGit(["rev-parse", "HEAD"]);
    const worktreeStatus = runGit(["status", "--porcelain", "--untracked-files=normal"]);
    requireCleanWorkingTree(currentCommit, worktreeStatus, "Preview");
    const result = withResolvableExpoCli(projectRoot, () => runEas(args, { stdio: "inherit" }));
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }

  const [rawIosGroupId = "", rawAndroidGroupId = "", ...verificationParts] = values;
  const iosGroupId = requirePreviewGroupId(rawIosGroupId);
  const androidGroupId = requirePreviewGroupId(rawAndroidGroupId);
  if (iosGroupId === androidGroupId) {
    throw new Error("Production requires distinct iOS and Android Preview group IDs.");
  }
  const verificationMessage = requirePreviewVerification(verificationParts.join(" "));
  const iosViewArgs = ["update:view", iosGroupId, "--json"];
  const androidViewArgs = ["update:view", androidGroupId, "--json"];
  const publishArgs = productionPublishArgs(verificationMessage);
  if (dryRun) {
    printDryRun([
      {
        command: ["pnpm", "dlx", `eas-cli@${EAS_CLI_VERSION}`, ...iosViewArgs],
        purpose: "online Preview iOS branch/runtime/Git commit validation",
        initialConfigEnvironment: "development",
      },
      {
        command: ["pnpm", "dlx", `eas-cli@${EAS_CLI_VERSION}`, ...androidViewArgs],
        purpose: "online Preview Android branch/runtime/Git commit validation",
        initialConfigEnvironment: "development",
      },
      {
        checks: [
          "Preview iOS and Android platform groups share timestamp, message, and gitCommitHash",
          "local HEAD equals the verified Preview gitCommitHash",
          "Git worktree is clean",
        ],
        purpose: "build a new Production-environment update from the same verified commit",
        command: ["pnpm", "dlx", `eas-cli@${EAS_CLI_VERSION}`, ...publishArgs],
        blockedUntilPreviousStepPasses: true,
        environmentSource: "EAS --environment production",
        initialConfigEnvironment: "development",
      },
    ]);
    process.exit(0);
  }
  const iosViewResult = runEas(iosViewArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (iosViewResult.error) throw iosViewResult.error;
  if (iosViewResult.status !== 0) {
    process.stderr.write(iosViewResult.stderr ?? "Unable to inspect the Preview iOS group.\n");
    process.exit(iosViewResult.status ?? 1);
  }
  const androidViewResult = runEas(androidViewArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (androidViewResult.error) throw androidViewResult.error;
  if (androidViewResult.status !== 0) {
    process.stderr.write(
      androidViewResult.stderr ?? "Unable to inspect the Preview Android group.\n",
    );
    process.exit(androidViewResult.status ?? 1);
  }
  const previewUpdates = validatePreviewBatch(
    parseAndValidatePreviewPlatformGroup(iosViewResult.stdout ?? "", iosGroupId, "ios"),
    parseAndValidatePreviewPlatformGroup(androidViewResult.stdout ?? "", androidGroupId, "android"),
  );
  const previewCommit = previewGroupGitCommitHash(previewUpdates);
  const currentCommit = runGit(["rev-parse", "HEAD"]);
  const worktreeStatus = runGit(["status", "--porcelain", "--untracked-files=normal"]);
  requireCleanMatchingCommit(previewCommit, currentCommit, worktreeStatus);

  const result = withResolvableExpoCli(projectRoot, () =>
    runEas(publishArgs, { stdio: "inherit" }),
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

function printDryRun(steps) {
  process.stdout.write(`${JSON.stringify({ dryRun: true, target, steps }, null, 2)}\n`);
}

function extractPreviewPlatform(input) {
  let platform = "all";
  const remainingValues = [];
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (value === "--platform") {
      const selected = input[index + 1];
      if (!selected) throw new Error("--platform requires ios, android, or all.");
      platform = selected;
      index += 1;
      continue;
    }
    if (value.startsWith("--platform=")) {
      platform = value.slice("--platform=".length);
      continue;
    }
    remainingValues.push(value);
  }
  return { platform, remainingValues };
}
