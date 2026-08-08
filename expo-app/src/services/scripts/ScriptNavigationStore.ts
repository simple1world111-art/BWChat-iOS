import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import type { InteractiveScript } from "@/models";

interface PendingScriptNavigation {
  ownerId: string;
  script: InteractiveScript;
}

let pendingScript: PendingScriptNavigation | null = null;

export function rememberScriptForNavigation(script: InteractiveScript, ownerId: string): void {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!owner) return;
  pendingScript = { ownerId: owner, script };
}

export function pendingScriptForNavigation(
  scriptId: string,
  ownerId: string,
): InteractiveScript | null {
  const owner = trimFoundationWhitespacesAndNewlines(ownerId);
  if (!pendingScript || !owner) return null;
  if (pendingScript.ownerId !== owner) {
    // A navigation hand-off is intentionally single-use across account
    // boundaries: seeing a different owner invalidates the old private/mine
    // object so A -> B -> A cannot resurrect it later.
    pendingScript = null;
    return null;
  }
  return pendingScript.script.script_id === scriptId ? pendingScript.script : null;
}

export function clearPendingScriptForNavigation(scriptId: string, ownerId: string): void {
  if (
    pendingScript?.ownerId === trimFoundationWhitespacesAndNewlines(ownerId) &&
    pendingScript.script.script_id === scriptId
  ) {
    pendingScript = null;
  }
}
