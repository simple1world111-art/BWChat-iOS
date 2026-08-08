#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseAndValidatePreviewGroup,
  previewGroupGitCommitHash,
  previewPublishArgs,
  productionPublishArgs,
  productionRollbackArgs,
  productionRolloutArgs,
  productionRevertRolloutArgs,
  requireCleanMatchingCommit,
  requirePreviewGroupId,
  requirePreviewVerification,
  requireProductionGroupId,
  requireRolloutApproval,
  requireRolloutPercentage,
} from "./eas-release-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const groupId = "123e4567-e89b-42d3-a456-426614174000";
const gitCommitHash = "0123456789abcdef0123456789abcdef01234567";
const fixtureUpdates = [
  {
    group: groupId,
    branch: "preview",
    platform: "ios",
    runtimeVersion: "ios-runtime",
    gitCommitHash,
  },
  {
    group: groupId,
    branch: "preview",
    platform: "android",
    runtimeVersion: "android-runtime",
    gitCommitHash,
  },
];
const fixture = JSON.stringify(fixtureUpdates);
let caseCount = 0;

check("accepts a UUID Preview group", () => assert.equal(requirePreviewGroupId(groupId), groupId));
check("rejects a non-UUID Preview group", () =>
  assert.throws(() => requirePreviewGroupId("not-a-uuid"), /UUID/),
);
check("normalizes a Production group UUID", () =>
  assert.equal(requireProductionGroupId(groupId.toUpperCase()), groupId),
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
check("accepts the exact two-platform Preview group", () =>
  assert.equal(parseAndValidatePreviewGroup(fixture, groupId).length, 2),
);
check("locks the Preview group to one Git commit", () =>
  assert.equal(previewGroupGitCommitHash(fixtureUpdates), gitCommitHash),
);
check("rejects a non-Preview source branch", () =>
  assert.throws(
    () => parseAndValidatePreviewGroup(fixture.replaceAll('"preview"', '"production"'), groupId),
    /preview branch/,
  ),
);
check("rejects a missing platform", () =>
  assert.throws(
    () => parseAndValidatePreviewGroup(JSON.stringify(fixtureUpdates.slice(0, 1)), groupId),
    /exactly one iOS and one Android/,
  ),
);
check("rejects duplicate platform rows", () =>
  assert.throws(
    () =>
      parseAndValidatePreviewGroup(
        JSON.stringify([fixtureUpdates[0], { ...fixtureUpdates[0] }]),
        groupId,
      ),
    /exactly one iOS and one Android/,
  ),
);
check("rejects a blank runtime version", () =>
  assert.throws(
    () =>
      parseAndValidatePreviewGroup(
        JSON.stringify([fixtureUpdates[0], { ...fixtureUpdates[1], runtimeVersion: "  " }]),
        groupId,
      ),
    /runtime version/,
  ),
);
check("rejects mixed Preview commits", () =>
  assert.throws(
    () =>
      parseAndValidatePreviewGroup(
        JSON.stringify([
          fixtureUpdates[0],
          {
            ...fixtureUpdates[1],
            gitCommitHash: "fedcba9876543210fedcba9876543210fedcba98",
          },
        ]),
        groupId,
      ),
    /shared Git commit/,
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
check("locks group-scoped Production rollback", () =>
  assert.deepEqual(productionRollbackArgs(groupId, "INCIDENT: login regression confirmed"), [
    "update:rollback",
    groupId,
    "--message",
    "INCIDENT: login regression confirmed",
    "--platform",
    "all",
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
    "VERIFIED: both device cold starts passed",
  ]);
  assert.equal(result.status, 0);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.steps[0].command[3], "update:view");
  assert.equal(plan.steps[1].blockedUntilPreviousStepPasses, true);
  assert.equal(plan.steps[1].command[3], "update");
  assert.ok(plan.steps[1].command.includes("10"));
  assert.equal(plan.steps[1].environmentSource, "EAS --environment production");
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
  const result = runScript("manage-update.mjs", ["rollback", groupId, "bad release"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /INCIDENT:/);
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
