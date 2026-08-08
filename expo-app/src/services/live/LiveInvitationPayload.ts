export function normalizeLiveInvitationPayload(root: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ["data", "payload", "invitation", "call"]) {
    const nested = recordValue(root[key]);
    if (nested) Object.assign(result, nested);
  }
  Object.assign(result, root);

  const invitation = recordValue(root.invitation, result.invitation);
  const call = recordValue(root.call, result.call);
  const caller = recordValue(root.caller, root.inviter, root.from_user, result.caller, invitation?.caller);
  if (caller) for (const [key, value] of Object.entries(caller)) if (result[key] === undefined) result[key] = value;

  copyString(result, "call_id", [result, call, invitation], ["call_id", "callId", "live_call_id", "id"]);
  copyString(result, "caller_id", [result, caller], ["caller_id", "caller_user_id", "from_user_id", "user_id", "callerId", "userId", "id"]);
  copyString(result, "slot_id", [result, invitation, call], ["slot_id", "live_slot_id", "slotId"]);
  copyString(result, "caller_username", [result, caller], ["caller_username", "caller_name", "username", "nickname", "display_name"]);
  copyString(result, "caller_avatar_url", [result, caller], ["caller_avatar_url", "caller_avatar", "avatar_url", "avatar"]);
  copyString(result, "character_setting", [result, caller], ["caller_character_setting", "character_setting", "role_setting"]);
  copyString(result, "call_type", [result, invitation, call], ["call_type", "media_type", "callType"]);

  if (result.billing_policy === undefined) result.billing_policy = call?.billing_policy ?? call?.billingPolicy;
  if (result.live_experience === undefined) {
    result.live_experience = call?.live_experience ?? call?.liveExperience ?? invitation?.live_experience ?? invitation?.liveExperience;
  }
  const billingPolicy = recordValue(result.billing_policy);
  if (billingPolicy) result.billing_policy = billingPolicy;
  const liveExperience = recordValue(result.live_experience);
  if (liveExperience) result.live_experience = liveExperience;
  return result;
}

function copyString(target: Record<string, unknown>, canonical: string, sources: (Record<string, unknown> | undefined)[], keys: string[]): void {
  if (field(target, canonical)) return;
  for (const source of sources) {
    if (!source) continue;
    const value = field(source, ...keys);
    if (value) {
      target[canonical] = value;
      return;
    }
  }
}

function recordValue(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    if (isObject(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed: unknown = JSON.parse(value);
        if (isObject(parsed)) return parsed;
      } catch {
        // A non-JSON string is not a nested payload.
      }
    }
  }
  return undefined;
}

function field(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) return String(value).trim();
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
