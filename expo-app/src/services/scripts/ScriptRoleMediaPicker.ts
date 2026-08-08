export type ScriptPhotoAccess = "all" | "limited" | "none" | "unknown";

export interface ScriptRolePickerAsset {
  height: number;
  uri: string;
  width: number;
}

export type ScriptRolePickerOutcome =
  | { kind: "selected"; access: ScriptPhotoAccess; uri: string }
  | { kind: "cancelled"; access: ScriptPhotoAccess }
  | { kind: "permission_denied"; access: ScriptPhotoAccess }
  | { kind: "error"; access: ScriptPhotoAccess };

export interface ScriptRolePickerDependencies {
  inspectAccess(): Promise<unknown>;
  launchPicker(): Promise<{
    canceled: boolean;
    assets?: readonly ScriptRolePickerAsset[] | null | undefined;
  }>;
  prepare(asset: ScriptRolePickerAsset): Promise<string>;
}

/**
 * SwiftUI PhotosPicker is system-managed and remains usable with limited access.
 * Permission inspection is therefore diagnostic only: it never pre-emptively blocks
 * the picker. An actual native permission failure is classified from the picker error.
 */
export async function pickScriptRoleAvatar(
  dependencies: ScriptRolePickerDependencies,
): Promise<ScriptRolePickerOutcome> {
  let access: ScriptPhotoAccess = "unknown";
  try {
    access = scriptPhotoAccess(
      dependencies.inspectAccess ? await dependencies.inspectAccess() : null,
    );
  } catch {
    // PHPicker does not require broad photo-library permission, so inspection failure is non-blocking.
  }

  try {
    const result = await dependencies.launchPicker();
    if (result.canceled) return { kind: "cancelled", access };
    const asset = result.assets?.[0];
    if (!isUsableScriptRoleAsset(asset)) return { kind: "error", access };
    const uri = (await dependencies.prepare(asset)).trim();
    return uri ? { kind: "selected", access, uri } : { kind: "error", access };
  } catch (error) {
    return isPhotoPermissionError(error)
      ? { kind: "permission_denied", access }
      : { kind: "error", access };
  }
}

export function scriptPhotoAccess(value: unknown): ScriptPhotoAccess {
  if (!isRecord(value)) return "unknown";
  const access = value.accessPrivileges;
  if (access === "all" || access === "limited" || access === "none") return access;
  if (value.granted === true) return "all";
  if (value.granted === false || value.status === "denied") return "none";
  return "unknown";
}

function isUsableScriptRoleAsset(
  asset: ScriptRolePickerAsset | undefined,
): asset is ScriptRolePickerAsset {
  return Boolean(
    asset?.uri.trim() &&
    Number.isFinite(asset.width) &&
    asset.width > 0 &&
    Number.isFinite(asset.height) &&
    asset.height > 0,
  );
}

function isPhotoPermissionError(error: unknown): boolean {
  if (!isRecord(error) && !(error instanceof Error)) return false;
  const record = isRecord(error) ? error : {};
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof record.message === "string"
        ? record.message.toLowerCase()
        : "";
  return (
    code.includes("permission") ||
    message.includes("permission") ||
    message.includes("not authorized") ||
    message.includes("not authorised")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
