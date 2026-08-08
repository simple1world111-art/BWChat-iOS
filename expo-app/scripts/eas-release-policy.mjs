export const EAS_CLI_VERSION = "21.6.0";
export const PRODUCTION_ROLLOUT_PERCENTAGE = 10;
export const PRODUCTION_ROLLOUT_STEPS = Object.freeze([30, 50, 100]);
export const PREVIEW_VERIFICATION_PREFIX = "VERIFIED:";
export const ROLLOUT_APPROVAL_PREFIX = "APPROVED:";
export const INCIDENT_PREFIX = "INCIDENT:";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40,64}$/i;

export function requireDescriptiveMessage(message) {
  const normalized = message.trim();
  if (normalized.length < 8) {
    throw new Error("A descriptive update message of at least 8 characters is required.");
  }
  return normalized;
}

export function requirePreviewGroupId(groupId) {
  return requireGroupId(groupId, "Preview");
}

export function requireProductionGroupId(groupId) {
  return requireGroupId(groupId, "Production");
}

function requireGroupId(groupId, environment) {
  const normalized = groupId.trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`A valid ${environment} update group UUID is required.`);
  }
  return normalized.toLowerCase();
}

export function requirePreviewVerification(message) {
  const normalized = requireDescriptiveMessage(message);
  if (!normalized.startsWith(PREVIEW_VERIFICATION_PREFIX)) {
    throw new Error(
      `Production requires an explicit ${PREVIEW_VERIFICATION_PREFIX} message after real-device Preview cold-start verification.`,
    );
  }
  if (normalized.slice(PREVIEW_VERIFICATION_PREFIX.length).trim().length < 8) {
    throw new Error("The Preview verification evidence after VERIFIED: is too short.");
  }
  return normalized;
}

export function requireRolloutApproval(message) {
  return requirePrefixedEvidence(
    message,
    ROLLOUT_APPROVAL_PREFIX,
    "Rollout progression requires APPROVED: monitoring evidence.",
  );
}

export function requireIncidentMessage(message) {
  return requirePrefixedEvidence(
    message,
    INCIDENT_PREFIX,
    "Production reverts and rollbacks require an INCIDENT: reason.",
  );
}

export function requireRolloutPercentage(value) {
  const percentage = Number(value);
  if (!Number.isInteger(percentage) || !PRODUCTION_ROLLOUT_STEPS.includes(percentage)) {
    throw new Error(
      `Production rollout percentage must be one of ${PRODUCTION_ROLLOUT_STEPS.join(", ")}.`,
    );
  }
  return percentage;
}

export function parseAndValidatePreviewGroup(json, expectedGroupId) {
  let updates;
  try {
    updates = JSON.parse(json);
  } catch {
    throw new Error("EAS returned invalid JSON while checking the Preview update group.");
  }
  if (!Array.isArray(updates) || updates.length !== 2) {
    throw new Error(
      "The Preview update group must contain exactly one iOS and one Android update.",
    );
  }
  if (updates.some((update) => !update || typeof update !== "object" || Array.isArray(update))) {
    throw new Error("The Preview update group contains no platform updates.");
  }

  const normalizedGroupId = requirePreviewGroupId(expectedGroupId);
  const groups = new Set(
    updates.map((update) =>
      typeof update?.group === "string" ? update.group.toLowerCase() : update?.group,
    ),
  );
  if (groups.size !== 1 || !groups.has(normalizedGroupId)) {
    throw new Error("EAS update:view did not return the requested Preview update group.");
  }

  const branches = new Set(updates.map((update) => update?.branch));
  if (branches.size !== 1 || !branches.has("preview")) {
    throw new Error("Production verification requires an update group from the preview branch.");
  }

  const platformCounts = updates.reduce((counts, update) => {
    counts.set(update.platform, (counts.get(update.platform) ?? 0) + 1);
    return counts;
  }, new Map());
  if (platformCounts.get("ios") !== 1 || platformCounts.get("android") !== 1) {
    throw new Error(
      "The Preview update group must contain exactly one iOS and one Android update.",
    );
  }

  if (
    updates.some(
      (update) =>
        typeof update.runtimeVersion !== "string" || update.runtimeVersion.trim().length === 0,
    )
  ) {
    throw new Error("The Preview update group is missing a runtime version.");
  }

  previewGroupGitCommitHash(updates);

  return updates;
}

export function previewGroupGitCommitHash(updates) {
  const commits = new Set(updates.map((update) => update?.gitCommitHash));
  if (commits.size !== 1) {
    throw new Error("The Preview update group must contain one shared Git commit.");
  }
  const [commit] = commits;
  if (typeof commit !== "string" || !GIT_COMMIT_PATTERN.test(commit)) {
    throw new Error("The Preview update group is missing a valid Git commit hash.");
  }
  return commit.toLowerCase();
}

export function requireCleanMatchingCommit(previewCommit, currentCommit, status) {
  const normalizedPreview = previewCommit.trim().toLowerCase();
  const normalizedCurrent = currentCommit.trim().toLowerCase();
  if (!GIT_COMMIT_PATTERN.test(normalizedCurrent)) {
    throw new Error("Unable to resolve the current Git commit.");
  }
  if (normalizedPreview !== normalizedCurrent) {
    throw new Error(
      `Production source commit ${normalizedCurrent} does not match verified Preview commit ${normalizedPreview}.`,
    );
  }
  if (status.trim()) {
    throw new Error("Production updates require a clean Git worktree after Preview verification.");
  }
  return normalizedCurrent;
}

export function previewPublishArgs(message) {
  return [
    "update",
    "--channel",
    "preview",
    "--environment",
    "preview",
    "--message",
    requireDescriptiveMessage(message),
    "--platform",
    "all",
    "--json",
    "--non-interactive",
  ];
}

export function productionPublishArgs(verificationMessage) {
  return [
    "update",
    "--channel",
    "production",
    "--environment",
    "production",
    "--message",
    requirePreviewVerification(verificationMessage),
    "--platform",
    "all",
    "--rollout-percentage",
    String(PRODUCTION_ROLLOUT_PERCENTAGE),
    "--json",
    "--non-interactive",
  ];
}

export function productionRolloutArgs(groupId, percentage, approvalMessage) {
  requireRolloutApproval(approvalMessage);
  return [
    "update:edit",
    requireProductionGroupId(groupId),
    "--rollout-percentage",
    String(requireRolloutPercentage(percentage)),
    "--json",
    "--non-interactive",
  ];
}

export function productionRevertRolloutArgs(groupId, incidentMessage) {
  return [
    "update:revert-update-rollout",
    "--group",
    requireProductionGroupId(groupId),
    "--message",
    requireIncidentMessage(incidentMessage),
    "--json",
    "--non-interactive",
  ];
}

export function productionRollbackArgs(groupId, incidentMessage) {
  return [
    "update:rollback",
    requireProductionGroupId(groupId),
    "--message",
    requireIncidentMessage(incidentMessage),
    "--platform",
    "all",
    "--json",
    "--non-interactive",
  ];
}

function requirePrefixedEvidence(message, prefix, missingPrefixMessage) {
  const normalized = requireDescriptiveMessage(message);
  if (!normalized.startsWith(prefix)) throw new Error(missingPrefixMessage);
  if (normalized.slice(prefix.length).trim().length < 8) {
    throw new Error(`The evidence after ${prefix} is too short.`);
  }
  return normalized;
}
