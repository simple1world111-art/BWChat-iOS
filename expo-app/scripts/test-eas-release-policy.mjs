#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseAndValidatePreviewPlatformGroup,
  previewGroupGitCommitHash,
  previewPublishArgs,
  productionPublishArgs,
  productionRollbackArgs,
  productionRolloutArgs,
  productionRevertRolloutArgs,
  requireCleanMatchingCommit,
  requireCleanWorkingTree,
  requirePreviewGroupId,
  requirePreviewVerification,
  requirePlatform,
  requireProductionGroupId,
  requireRolloutApproval,
  requireRolloutPercentage,
  validatePreviewBatch,
} from "./eas-release-policy.mjs";
import { withResolvableExpoCli } from "./ensure-expo-cli-resolvable.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const groupId = "123e4567-e89b-42d3-a456-426614174000";
const androidGroupId = "223e4567-e89b-42d3-a456-426614174001";
const gitCommitHash = "0123456789abcdef0123456789abcdef01234567";
const createdAt = "2026-08-08T18:56:51.744Z";
const message = "preview release for both platforms";
const fixtureUpdates = [
  {
    group: groupId,
    branch: "preview",
    platform: "ios",
    runtimeVersion: "ios-runtime",
    gitCommitHash,
    createdAt,
    message,
  },
  {
    group: androidGroupId,
    branch: "preview",
    platform: "android",
    runtimeVersion: "android-runtime",
    gitCommitHash,
    createdAt,
    message,
  },
];
const iosFixture = JSON.stringify([fixtureUpdates[0]]);
const androidFixture = JSON.stringify([fixtureUpdates[1]]);
let caseCount = 0;

check("accepts a UUID Preview group", () => assert.equal(requirePreviewGroupId(groupId), groupId));
check("rejects a non-UUID Preview group", () =>
  assert.throws(() => requirePreviewGroupId("not-a-uuid"), /UUID/),
);
check("normalizes a Production group UUID", () =>
  assert.equal(requireProductionGroupId(groupId.toUpperCase()), groupId),
);
check("accepts only platform-specific group platforms", () =>
  assert.deepEqual([requirePlatform("iOS"), requirePlatform("android")], ["ios", "android"]),
);
check("rejects all-platform rollback targeting", () =>
  assert.throws(() => requirePlatform("all"), /ios or android/),
);
check("accepts explicit device verification evidence", () =>
  assert.equal(
    requirePreviewVerification("VERIFIED: iOS and Android cold starts passed"),
    "VERIFIED: iOS and Android cold starts passed",
  ),
);
check("rejects missing Preview evidence", () =>
  assert.throws(() => requirePreviewVerification("not verified"), /VERIFIED:/),
);
check("accepts the two platform-specific fingerprint Preview groups", () => {
  const updates = validatePreviewBatch(
    parseAndValidatePreviewPlatformGroup(iosFixture, groupId, "ios"),
    parseAndValidatePreviewPlatformGroup(androidFixture, androidGroupId, "android"),
  );
  assert.equal(updates.length, 2);
});
check("exposes transitive Expo CLI only for the EAS callback", () => {
  const rootCliPath = path.join(projectRoot, "node_modules", "@expo", "cli");
  const existedBefore = existsSync(rootCliPath);
  withResolvableExpoCli(projectRoot, () => {
    const projectRequire = createRequire(path.join(projectRoot, "package.json"));
    assert.match(projectRequire.resolve("@expo/cli/package.json"), /@expo\/cli\/package\.json$/);
  });
  assert.equal(existsSync(rootCliPath), existedBefore);
});
check("locks the Preview batch to one Git commit", () =>
  assert.equal(previewGroupGitCommitHash(fixtureUpdates), gitCommitHash),
);
check("rejects a non-Preview source branch", () =>
  assert.throws(
    () =>
      parseAndValidatePreviewPlatformGroup(
        iosFixture.replaceAll('"preview"', '"production"'),
        groupId,
        "ios",
      ),
    /preview branch/,
  ),
);
check("rejects a mismatched platform group", () =>
  assert.throws(
    () => parseAndValidatePreviewPlatformGroup(iosFixture, groupId, "android"),
    /expected android/,
  ),
);
check("rejects duplicate platform rows", () =>
  assert.throws(
    () =>
      parseAndValidatePreviewPlatformGroup(
        JSON.stringify([fixtureUpdates[0], { ...fixtureUpdates[0] }]),
        groupId,
        "ios",
      ),
    /exactly one platform update/,
  ),
);
check("rejects a blank runtime version", () =>
  assert.throws(
    () =>
      parseAndValidatePreviewPlatformGroup(
        JSON.stringify([{ ...fixtureUpdates[0], runtimeVersion: "  " }]),
        groupId,
        "ios",
      ),
    /runtime version/,
  ),
);
check("rejects mixed Preview commits", () =>
  assert.throws(
    () =>
      validatePreviewBatch(fixtureUpdates[0], {
        ...fixtureUpdates[1],
        gitCommitHash: "fedcba9876543210fedcba9876543210fedcba98",
      }),
    /shared Git commit/,
  ),
);
check("rejects Preview groups from separate publish timestamps", () =>
  assert.throws(
    () =>
      validatePreviewBatch(fixtureUpdates[0], {
        ...fixtureUpdates[1],
        createdAt: "2026-08-08T18:57:51.744Z",
      }),
    /same EAS publish timestamp/,
  ),
);
check("rejects Preview groups with different messages", () =>
  assert.throws(
    () =>
      validatePreviewBatch(fixtureUpdates[0], {
        ...fixtureUpdates[1],
        message: "different Preview publish",
      }),
    /share one descriptive publish message/,
  ),
);
check("rejects one group ID reused for both Preview platforms", () =>
  assert.throws(
    () =>
      validatePreviewBatch(fixtureUpdates[0], {
        ...fixtureUpdates[1],
        group: groupId,
      }),
    /distinct iOS and Android Preview group IDs/,
  ),
);
check("rejects invalid JSON from a Preview platform lookup", () =>
  assert.throws(
    () => parseAndValidatePreviewPlatformGroup("not json", groupId, "ios"),
    /invalid JSON/,
  ),
);
check("rejects a Preview lookup returning another group", () =>
  assert.throws(
    () =>
      parseAndValidatePreviewPlatformGroup(
        JSON.stringify([{ ...fixtureUpdates[0], group: androidGroupId }]),
        groupId,
        "ios",
      ),
    /requested Preview update group/,
  ),
);
check("locks Preview channel/environment/all-platform args", () =>
  assert.deepEqual(previewPublishArgs("preview release 001"), [
    "update",
    "--channel",
    "preview",
    "--environment",
    "preview",
    "--message",
    "preview release 001",
    "--platform",
    "all",
    "--json",
    "--non-interactive",
  ]),
);
check("allows an explicitly platform-scoped Preview publish", () =>
  assert.deepEqual(previewPublishArgs("iOS preview release 001", "ios"), [
    "update",
    "--channel",
    "preview",
    "--environment",
    "preview",
    "--message",
    "iOS preview release 001",
    "--platform",
    "ios",
    "--json",
    "--non-interactive",
  ]),
);
check("rejects an invalid Preview platform", () =>
  assert.throws(() => previewPublishArgs("preview release 001", "web"), /ios or android/),
);
check("locks Production environment rebuild and 10% args", () =>
  assert.deepEqual(productionPublishArgs("VERIFIED: both cold starts passed"), [
    "update",
    "--channel",
    "production",
    "--environment",
    "production",
    "--message",
    "VERIFIED: both cold starts passed",
    "--platform",
    "all",
    "--rollout-percentage",
    "10",
    "--json",
    "--non-interactive",
  ]),
);
check("accepts a clean worktree at the verified Preview commit", () =>
  assert.equal(
    requireCleanMatchingCommit(gitCommitHash, gitCommitHash.toUpperCase(), ""),
    gitCommitHash,
  ),
);
check("rejects a different Production source commit", () =>
  assert.throws(
    () => requireCleanMatchingCommit(gitCommitHash, "fedcba9876543210fedcba9876543210fedcba98", ""),
    /does not match verified Preview commit/,
  ),
);
check("rejects a dirty Production worktree", () =>
  assert.throws(
    () => requireCleanMatchingCommit(gitCommitHash, gitCommitHash, " M app.config.ts"),
    /clean Git worktree/,
  ),
);
check("rejects a dirty Preview worktree", () =>
  assert.throws(
    () => requireCleanWorkingTree(gitCommitHash, " M src/app/wallet.tsx", "Preview"),
    /Preview updates require a clean Git worktree/,
  ),
);
check("accepts only the documented 30/50/100 progression", () =>
  assert.deepEqual([30, 50, 100].map(requireRolloutPercentage), [30, 50, 100]),
);
check("rejects arbitrary rollout percentages", () =>
  assert.throws(() => requireRolloutPercentage("20"), /30, 50, 100/),
);
check("requires monitoring evidence before widening", () =>
  assert.throws(() => requireRolloutApproval("VERIFIED: preview only"), /APPROVED:/),
);
check("locks non-interactive rollout editing", () =>
  assert.deepEqual(productionRolloutArgs(groupId, 30, "APPROVED: metrics stable for one cycle"), [
    "update:edit",
    groupId,
    "--rollout-percentage",
    "30",
    "--json",
    "--non-interactive",
  ]),
);
check("locks group-scoped rollout reversion", () =>
  assert.deepEqual(
    productionRevertRolloutArgs(groupId, "INCIDENT: startup errors exceeded baseline"),
    [
      "update:revert-update-rollout",
      "--group",
      groupId,
      "--message",
      "INCIDENT: startup errors exceeded baseline",
      "--json",
      "--non-interactive",
    ],
  ),
);
check("locks platform-specific Production rollback", () =>
  assert.deepEqual(productionRollbackArgs(groupId, "ios", "INCIDENT: login regression confirmed"), [
    "update:rollback",
    groupId,
    "--message",
    "INCIDENT: login regression confirmed",
    "--platform",
    "ios",
    "--json",
    "--non-interactive",
  ]),
);
check("Preview entrypoint dry-run cannot invoke EAS", () => {
  const result = runScript("publish-update.mjs", [
    "preview",
    "--dry-run",
    "preview release dry run",
  ]);
  assert.equal(result.status, 0);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.steps[0].command[3], "update");
});
check("Production dry-run validates Preview then rebuilds for Production", () => {
  const result = runScript("publish-update.mjs", [
    "production",
    "--dry-run",
    groupId,
    androidGroupId,
    "VERIFIED: both device cold starts passed",
  ]);
  assert.equal(result.status, 0);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.steps[0].command[3], "update:view");
  assert.equal(plan.steps[1].command[3], "update:view");
  assert.equal(plan.steps[2].blockedUntilPreviousStepPasses, true);
  assert.equal(plan.steps[2].command[3], "update");
  assert.ok(plan.steps[2].command.includes("10"));
  assert.equal(plan.steps[2].environmentSource, "EAS --environment production");
  assert.ok(!result.stdout.includes("update:republish"));
  assert.ok(!result.stdout.includes("--destination-channel"));
});
check("dry-run plans ignore contaminating shell APP_ENV values", () => {
  const result = runScript(
    "publish-update.mjs",
    ["preview", "--dry-run", "preview shell isolation"],
    { APP_ENV: "production", BWCHAT_EXPECTED_APP_ENV: "production" },
  );
  assert.equal(result.status, 0);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.steps[0].environmentSource, "EAS --environment preview");
  assert.equal(plan.steps[0].initialConfigEnvironment, "development");
});
check("rollout management dry-run is exact and side-effect free", () => {
  const result = runScript("manage-update.mjs", [
    "rollout",
    "--dry-run",
    groupId,
    "50",
    "APPROVED: crash and API metrics remained stable",
  ]);
  assert.equal(result.status, 0);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.dryRun, true);
  assert.deepEqual(plan.command.slice(3, 7), [
    "update:edit",
    groupId,
    "--rollout-percentage",
    "50",
  ]);
});
check("rollback management rejects unlabelled reasons before EAS", () => {
  const result = runScript("manage-update.mjs", ["rollback", groupId, "ios", "bad release"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /INCIDENT:/);
});
check("pnpm-style standalone separators are ignored", () => {
  const result = runScript("manage-update.mjs", [
    "rollout",
    "--",
    "--dry-run",
    groupId,
    "30",
    "APPROVED: platform metrics stayed stable",
  ]);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).command[4], groupId);
});
check("GitHub Production workflow forwards both Preview platform groups", () => {
  const workflow = readFileSync(
    path.resolve(projectRoot, "..", ".github", "workflows", "eas-update.yml"),
    "utf8",
  );
  assert.match(workflow, /preview_ios_group_id:/);
  assert.match(workflow, /preview_android_group_id:/);
  assert.match(
    workflow,
    /update:production -- \"\$PREVIEW_IOS_GROUP_ID\" \"\$PREVIEW_ANDROID_GROUP_ID\"/,
  );
  assert.doesNotMatch(workflow, /preview_group_id:/);
});

process.stdout.write(`EAS release policy tests passed: ${caseCount} cases.\n`);

function check(_name, assertion) {
  assertion();
  caseCount += 1;
}

function runScript(name, args, environment = {}) {
  return spawnSync(process.execPath, [path.resolve(projectRoot, "scripts", name), ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment, PATH: path.dirname(process.execPath) },
  });
}
