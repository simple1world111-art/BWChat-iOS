import type { LiveBillingPolicy, LiveExperienceSnapshot, PropConsumptionResult } from "@/models";
import { liveExperienceDuration, liveExperienceKindFromDefinition } from "@/services/props/PropInventoryModels";

const defaultBillingPolicy: LiveBillingPolicy = { currency: "spendable_balance", freeSeconds: 10, unitSeconds: 60, amountPerUnit: 100, minimumStartingBalance: 100, rounding: "started_unit" };

export interface NormalizedLiveExperienceSnapshot extends LiveExperienceSnapshot {
  reservedProp?: PropConsumptionResult | undefined;
  consumedProp?: PropConsumptionResult | undefined;
}

export function normalizeLiveExperienceSnapshot(value: unknown, outerServerTime?: string): NormalizedLiveExperienceSnapshot | undefined {
  const source = recordValue(value);
  if (!source) return undefined;
  const definitionId = stringValue(source.definition_id, source.definitionId, source.prop_definition_id, source.propDefinitionId) ?? "";
  const kind = liveExperienceKindFromDefinition(definitionId);
  const durationSeconds = Math.max(0, intValue(source.duration_seconds, source.durationSeconds) ?? (kind ? liveExperienceDuration(kind) : 0));
  const status = normalizeStatus(stringValue(source.status));
  const reservedProp = normalizePropConsumption(source.reserved_prop ?? source.reservedProp);
  const consumedProp = normalizePropConsumption(source.consumed_prop ?? source.consumedProp);
  return {
    definitionId,
    durationSeconds,
    status,
    ...optionalString("startedAt", source.started_at, source.startedAt, source.connected_at, source.connectedAt),
    ...optionalString("endsAt", source.ends_at, source.endsAt, source.experience_ends_at, source.experienceEndsAt),
    ...optionalInt("remainingSeconds", source.remaining_seconds, source.remainingSeconds),
    ...optionalString("autoContinuePaymentMethod", source.auto_continue_payment_method, source.autoContinuePaymentMethod),
    hostEarningEnabled: boolValue(source.host_earning_enabled, source.hostEarningEnabled) ?? false,
    ...(reservedProp ? { reservedProp } : {}),
    ...(consumedProp ? { consumedProp } : {}),
    ...optionalString("serverTime", source.server_time, source.serverTime, outerServerTime),
    receivedAt: Date.now(),
  };
}

export function normalizeCallLivePayload(value: unknown): { billingPolicy?: LiveBillingPolicy; liveExperience?: LiveExperienceSnapshot } {
  const source = recordValue(value);
  if (!source) return {};
  const serverTime = stringValue(source.server_time, source.serverTime);
  const billing = recordValue(source.billing_policy, source.billingPolicy);
  const experience = recordValue(source.live_experience, source.liveExperience, source.experience)
    ?? ((source.definition_id !== undefined || source.prop_definition_id !== undefined) ? source : undefined);
  const normalizedExperience = experience ? normalizeLiveExperienceSnapshot(experience, serverTime) : undefined;
  return {
    ...(billing ? { billingPolicy: normalizePolicy(billing) } : {}),
    ...(normalizedExperience ? { liveExperience: normalizedExperience } : {}),
  };
}

export function liveExperienceRemainingSeconds(experience: LiveExperienceSnapshot, connectedDuration: number, now = Date.now()): number {
  if (["released", "completed"].includes(experience.status)) return 0;
  const elapsedSinceSnapshot = Math.max((now - experience.receivedAt) / 1_000, 0);
  const endsAt = parseDate(experience.endsAt);
  const serverTime = parseDate(experience.serverTime);
  if (endsAt !== undefined && serverTime !== undefined) return Math.max(Math.ceil((endsAt - serverTime) / 1_000 - elapsedSinceSnapshot), 0);
  if (experience.remainingSeconds !== undefined) return Math.max(Math.ceil(experience.remainingSeconds - elapsedSinceSnapshot), 0);
  if (endsAt !== undefined) return Math.max(Math.ceil((endsAt - now) / 1_000), 0);
  return Math.max(Math.ceil(experience.durationSeconds - Math.max(connectedDuration, 0)), 0);
}

export function liveBillingFreeSecondsRemaining(policy: LiveBillingPolicy, connectedDuration: number): number {
  return Math.max(Math.ceil(policy.freeSeconds - Math.max(connectedDuration, 0)), 0);
}

export function liveBillingAccruedAmount(policy: LiveBillingPolicy, connectedDuration: number): number {
  const duration = Math.max(connectedDuration, 0);
  if (duration <= policy.freeSeconds) return 0;
  return Math.ceil(duration / policy.unitSeconds) * policy.amountPerUnit;
}

export function shouldConsumeLiveExperienceCard(
  connectedDuration: number,
  freeSeconds: number,
): boolean {
  return connectedDuration > Math.max(freeSeconds, 0);
}

export function liveExperienceAccruedOverageAmount(experience: LiveExperienceSnapshot, policy: LiveBillingPolicy, connectedDuration: number): number {
  const overage = Math.max(connectedDuration - experience.durationSeconds, 0);
  return overage > 0 ? Math.ceil(overage / policy.unitSeconds) * policy.amountPerUnit : 0;
}

export function isLiveBillingInsufficient(value: Record<string, unknown>): boolean {
  for (const key of ["reason", "status", "end_reason", "reason_code", "message_code", "code"]) {
    const normalized = (stringValue(value[key]) ?? "").toLocaleLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
    if (["billing_insufficient", "insufficient_balance", "insufficient_funds", "balance_insufficient"].includes(normalized)
      || (normalized.includes("insufficient") && normalized.includes("balance"))) return true;
  }
  return false;
}

export function liveTerminationGraceMilliseconds(value: Record<string, unknown>): number {
  const requested = intValue(value.termination_grace_ms, value.grace_ms);
  return requested !== undefined && requested >= 1_500 && requested <= 5_000 ? requested : 2_600;
}

export function liveBillingPolicyOrFallback(value: LiveBillingPolicy | undefined): LiveBillingPolicy {
  return value ?? defaultBillingPolicy;
}

function normalizeStatus(value: string | undefined): LiveExperienceSnapshot["status"] {
  const normalized = (value ?? "").trim().toLocaleLowerCase().replaceAll("-", "_");
  return ["reserved", "active", "consumed", "released", "completed"].includes(normalized)
    ? normalized as LiveExperienceSnapshot["status"]
    : "unknown";
}
function normalizePropConsumption(value: unknown): PropConsumptionResult | undefined {
  const source = recordValue(value);
  if (!source) return undefined;
  const definitionId = stringValue(source.definition_id, source.definitionId);
  const remainingQuantity = intValue(source.remaining_quantity, source.remainingQuantity);
  if (!definitionId || remainingQuantity === undefined) return undefined;
  const inventoryId = stringValue(source.inventory_id, source.inventoryId);
  return {
    ...(inventoryId ? { inventory_id: inventoryId } : {}),
    definition_id: definitionId,
    remaining_quantity: remainingQuantity,
  };
}
function recordValue(...values: unknown[]): Record<string, unknown> | undefined { return values.find(isRecord); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function stringValue(...values: unknown[]): string | undefined { for (const value of values) if ((typeof value === "string" || typeof value === "number") && String(value).trim()) return String(value).trim(); return undefined; }
function intValue(...values: unknown[]): number | undefined { const value = stringValue(...values); const number = Number(value?.replaceAll(",", "")); return value !== undefined && Number.isFinite(number) ? Math.trunc(number) : undefined; }
function boolValue(...values: unknown[]): boolean | undefined { for (const value of values) { if (typeof value === "boolean") return value; if (typeof value === "number" && Number.isInteger(value)) return value !== 0; if (typeof value === "string") { const normalized = value.toLocaleLowerCase(); if (["true", "1", "yes"].includes(normalized)) return true; if (["false", "0", "no"].includes(normalized)) return false; } } return undefined; }
function parseDate(value: string | undefined): number | undefined { if (!value) return undefined; const date = Date.parse(value); return Number.isFinite(date) ? date : undefined; }
function normalizePolicy(value: Record<string, unknown>): LiveBillingPolicy {
  const amount = Math.max(1, intValue(value.amount_per_unit, value.amountPerUnit) ?? defaultBillingPolicy.amountPerUnit);
  return {
    currency: stringValue(value.currency) ?? defaultBillingPolicy.currency,
    freeSeconds: Math.max(0, intValue(value.free_seconds, value.freeSeconds) ?? defaultBillingPolicy.freeSeconds),
    unitSeconds: Math.max(1, intValue(value.unit_seconds, value.unitSeconds) ?? defaultBillingPolicy.unitSeconds),
    amountPerUnit: amount,
    minimumStartingBalance: Math.max(
      1,
      intValue(value.minimum_starting_balance, value.minimumStartingBalance)
        ?? defaultBillingPolicy.minimumStartingBalance,
    ),
    rounding: stringValue(value.rounding) ?? defaultBillingPolicy.rounding,
  };
}
function optionalString<Key extends string>(key: Key, ...values: unknown[]): Partial<Record<Key, string>> { const value = stringValue(...values); return value ? { [key]: value } as Partial<Record<Key, string>> : {}; }
function optionalInt<Key extends string>(key: Key, ...values: unknown[]): Partial<Record<Key, number>> { const value = intValue(...values); return value !== undefined ? { [key]: Math.max(value, 0) } as Partial<Record<Key, number>> : {}; }
