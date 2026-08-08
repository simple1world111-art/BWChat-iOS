#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EAS_CLI_VERSION,
  parseAndValidatePreviewGroup,
  previewGroupGitCommitHash,
  previewPublishArgs,
  productionPublishArgs,
  requireCleanMatchingCommit,
  requirePreviewGroupId,
  requirePreviewVerification,
} from "./eas-release-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [target, ...rawValues] = process.argv.slice(2);
const dryRun = rawValues.includes("--dry-run");
const values = rawValues.filter((value) => value !== "--dry-run");

if (target !== "preview" && target !== "production") {
  process.stderr.write(
    'Usage: pnpm update:preview -- [--dry-run] "message" | pnpm update:production -- [--dry-run] <preview-group-id> "VERIFIED: evidence"\n',
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
    const message = values.join(" ").trim();
    const args = previewPublishArgs(message);
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
    const result = runEas(args, { stdio: "inherit" });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }

  const [rawGroupId = "", ...verificationParts] = values;
  const groupId = requirePreviewGroupId(rawGroupId);
  const verificationMessage = requirePreviewVerification(verificationParts.join(" "));
  const viewArgs = ["update:view", groupId, "--json"];
  const publishArgs = productionPublishArgs(verificationMessage);
  if (dryRun) {
    printDryRun([
      {
        command: ["pnpm", "dlx", `eas-cli@${EAS_CLI_VERSION}`, ...viewArgs],
        purpose: "online Preview branch/platform/runtime/Git commit validation",
        initialConfigEnvironment: "development",
      },
      {
        checks: [
          "Preview iOS and Android updates share one gitCommitHash",
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
  const viewResult = runEas(viewArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (viewResult.error) throw viewResult.error;
  if (viewResult.status !== 0) {
    process.stderr.write(viewResult.stderr ?? "Unable to inspect the Preview update group.\n");
    process.exit(viewResult.status ?? 1);
  }
  const previewUpdates = parseAndValidatePreviewGroup(viewResult.stdout ?? "", groupId);
  const previewCommit = previewGroupGitCommitHash(previewUpdates);
  const currentCommit = runGit(["rev-parse", "HEAD"]);
  const worktreeStatus = runGit(["status", "--porcelain", "--untracked-files=normal"]);
  requireCleanMatchingCommit(previewCommit, currentCommit, worktreeStatus);

  const result = runEas(publishArgs, { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

function printDryRun(steps) {
  process.stdout.write(`${JSON.stringify({ dryRun: true, target, steps }, null, 2)}\n`);
}
