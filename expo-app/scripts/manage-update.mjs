#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EAS_CLI_VERSION,
  productionRollbackArgs,
  productionRolloutArgs,
  productionRevertRolloutArgs,
} from "./eas-release-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [action, ...rawValues] = process.argv.slice(2);
const dryRun = rawValues.includes("--dry-run");
const values = rawValues.filter((value) => value !== "--dry-run");

process.env.PATH = [path.dirname(process.execPath), process.env.PATH]
  .filter(Boolean)
  .join(path.delimiter);

try {
  const args = commandArgs(action, values);
  const command = ["pnpm", "dlx", `eas-cli@${EAS_CLI_VERSION}`, ...args];
  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ dryRun: true, action, command }, null, 2)}\n`);
    process.exit(0);
  }

  const childEnvironment = { ...process.env };
  delete childEnvironment.APP_ENV;
  delete childEnvironment.BWCHAT_EXPECTED_APP_ENV;
  const result = spawnSync(command[0], command.slice(1), {
    cwd: projectRoot,
    env: childEnvironment,
    shell: false,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(
    'Usage: pnpm update:rollout -- <group-id> <30|50|100> "APPROVED: evidence" | pnpm update:revert-rollout -- <group-id> "INCIDENT: reason" | pnpm update:rollback -- <group-id> "INCIDENT: reason"\n',
  );
  process.exit(2);
}

function commandArgs(targetAction, input) {
  if (targetAction === "rollout") {
    const [groupId = "", percentage = "", ...evidence] = input;
    return productionRolloutArgs(groupId, percentage, evidence.join(" "));
  }
  if (targetAction === "revert-rollout") {
    const [groupId = "", ...reason] = input;
    return productionRevertRolloutArgs(groupId, reason.join(" "));
  }
  if (targetAction === "rollback") {
    const [groupId = "", ...reason] = input;
    return productionRollbackArgs(groupId, reason.join(" "));
  }
  throw new Error("Action must be rollout, revert-rollout, or rollback.");
}
