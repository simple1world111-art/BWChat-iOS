import { randomUUID } from "expo-crypto";

import { apiRequest, APIError } from "@/api/client";
import {
  isRecord,
  normalizeAuthSession,
  trimFoundationWhitespacesAndNewlines,
} from "@/api/normalizers";
import type { AuthSession } from "@/models";
import { readCachedNativePushToken } from "@/services/push/PushTokenStore";

const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

export interface VerificationSession {
  sessionId: string;
  maskedEmail?: string | undefined;
  serverTime: string;
  expiresAt: string;
  resendAvailableAt: string;
  codeLength: 6;
}

export interface RegistrationVerification {
  emailVerificationToken: string;
  normalizedEmail: string;
  expiresAt: string;
}

export interface VerifiedRegistrationInput {
  username: string;
  password: string;
  nickname: string;
  email: string;
  emailVerificationToken: string;
  clientRequestId: string;
}

export interface AccountSecuritySummary {
  email: {
    verified: boolean;
    maskedEmail?: string | undefined;
    verifiedAt?: string | undefined;
  };
  deletionStatus: "active" | "delete_pending" | "deleted";
}

export interface DeletionRetentionCategory {
  category: string;
  retentionDays: number;
  reason: string;
}

export interface AccountDeletionPreview {
  previewToken: string;
  expiresAt: string;
  confirmationUsername: string;
  purgeWithinDays: number;
  impact: {
    goldCoinsToForfeit: number;
    propsToForfeit: number;
    ownedGroupsToDissolve: number;
  };
  deleteCategories: string[];
  retainedCategories: DeletionRetentionCategory[];
}

export interface DeletionAuthorization {
  deletionAuthorizationToken: string;
  expiresAt: string;
}

export interface AccountDeletionReceipt {
  requestId: string;
  status: "accepted";
  acceptedAt: string;
  purgeBy: string;
}

export function createClientRequestId(): string {
  return randomUUID();
}

export async function createRegistrationEmailVerificationSession(
  email: string,
): Promise<VerificationSession> {
  return normalizeVerificationSession(
    await complianceRequest("/auth/registration/email-verification-sessions", {
      method: "POST",
      auth: false,
      body: { email },
    }),
    true,
  );
}

export async function resendRegistrationEmailVerificationSession(
  sessionId: string,
): Promise<VerificationSession> {
  return normalizeVerificationSession(
    await complianceRequest(
      `/auth/registration/email-verification-sessions/${encodeURIComponent(sessionId)}/resend`,
      { method: "POST", auth: false, body: {} },
    ),
    true,
  );
}

export async function verifyRegistrationEmail(
  sessionId: string,
  code: string,
): Promise<RegistrationVerification> {
  const value = requireRecord(
    await complianceRequest(
      `/auth/registration/email-verification-sessions/${encodeURIComponent(sessionId)}/verify`,
      { method: "POST", auth: false, body: { code } },
    ),
  );
  return {
    emailVerificationToken: requireString(value, "email_verification_token"),
    normalizedEmail: requireString(value, "normalized_email"),
    expiresAt: requireISODateString(value, "expires_at"),
  };
}

export async function registerVerifiedAccount(
  input: VerifiedRegistrationInput,
): Promise<AuthSession> {
  const deviceToken = await readCachedNativePushToken().catch(() => null);
  const body = {
    username: input.username,
    password: input.password,
    ...(trimFoundationWhitespacesAndNewlines(input.nickname).length > 0
      ? { nickname: input.nickname }
      : {}),
    email: input.email,
    email_verification_token: input.emailVerificationToken,
    client_request_id: input.clientRequestId,
    ...(deviceToken ? { device_token: deviceToken } : {}),
  };
  const value = await complianceRequest("/auth/register-v2", {
    method: "POST",
    auth: false,
    headers: { "Idempotency-Key": input.clientRequestId },
    body,
  });
  try {
    return normalizeAuthSession(value);
  } catch {
    throw new APIError("api.decodingError", 200, undefined, "decoding_error");
  }
}

export async function createPasswordResetSession(identifier: string): Promise<VerificationSession> {
  return normalizeVerificationSession(
    await complianceRequest("/auth/password-reset/sessions", {
      method: "POST",
      auth: false,
      body: { identifier },
    }),
    false,
  );
}

export async function resendPasswordResetSession(sessionId: string): Promise<VerificationSession> {
  return normalizeVerificationSession(
    await complianceRequest(
      `/auth/password-reset/sessions/${encodeURIComponent(sessionId)}/resend`,
      { method: "POST", auth: false, body: {} },
    ),
    false,
  );
}

export async function confirmPasswordReset(input: {
  sessionId: string;
  code: string;
  newPassword: string;
  clientRequestId: string;
}): Promise<void> {
  await complianceRequest(
    `/auth/password-reset/sessions/${encodeURIComponent(input.sessionId)}/confirm`,
    {
      method: "POST",
      auth: false,
      headers: { "Idempotency-Key": input.clientRequestId },
      body: {
        code: input.code,
        new_password: input.newPassword,
        client_request_id: input.clientRequestId,
      },
      requiredData: false,
    },
  );
}

export async function getAccountSecurity(): Promise<AccountSecuritySummary> {
  const value = requireRecord(await complianceRequest("/account/security"));
  const email = requireRecord(value.email);
  const verified = requireBoolean(email, "verified");
  const deletionStatus = requireString(value, "deletion_status");
  if (!isDeletionStatus(deletionStatus)) throw invalidResponse();
  return {
    email: verified
      ? {
          verified,
          maskedEmail: requireString(email, "masked_email"),
          verifiedAt: requireISODateString(email, "verified_at"),
        }
      : { verified },
    deletionStatus,
  };
}

export async function createAccountEmailVerificationSession(input: {
  currentPassword: string;
  email: string;
}): Promise<VerificationSession> {
  return normalizeVerificationSession(
    await complianceRequest("/account/email-verification-sessions", {
      method: "POST",
      body: { current_password: input.currentPassword, email: input.email },
    }),
    true,
  );
}

export async function resendAccountEmailVerificationSession(
  sessionId: string,
): Promise<VerificationSession> {
  return normalizeVerificationSession(
    await complianceRequest(
      `/account/email-verification-sessions/${encodeURIComponent(sessionId)}/resend`,
      { method: "POST", body: {} },
    ),
    true,
  );
}

export async function verifyAccountEmail(sessionId: string, code: string): Promise<void> {
  await complianceRequest(
    `/account/email-verification-sessions/${encodeURIComponent(sessionId)}/verify`,
    { method: "POST", body: { code }, requiredData: false },
  );
}

export async function getAccountDeletionPreview(): Promise<AccountDeletionPreview> {
  const value = requireRecord(await complianceRequest("/account/deletion/preview"));
  const impact = requireRecord(value.impact);
  if (!Array.isArray(value.delete_categories) || !Array.isArray(value.retained_categories)) {
    throw invalidResponse();
  }
  return {
    previewToken: requireString(value, "preview_token"),
    expiresAt: requireISODateString(value, "expires_at"),
    confirmationUsername: requireString(value, "confirmation_username", true),
    purgeWithinDays: requireNonnegativeInteger(value, "purge_within_days"),
    impact: {
      goldCoinsToForfeit: requireNonnegativeInteger(impact, "gold_coins_to_forfeit"),
      propsToForfeit: requireNonnegativeInteger(impact, "props_to_forfeit"),
      ownedGroupsToDissolve: requireNonnegativeInteger(impact, "owned_groups_to_dissolve"),
    },
    deleteCategories: value.delete_categories.map((item) => requireRawString(item)),
    retainedCategories: value.retained_categories.map(normalizeRetentionCategory),
  };
}

export async function authorizeAccountDeletion(input: {
  currentPassword: string;
  confirmationUsername: string;
  previewToken: string;
}): Promise<DeletionAuthorization> {
  const value = requireRecord(
    await complianceRequest("/account/deletion/authorizations", {
      method: "POST",
      body: {
        current_password: input.currentPassword,
        confirmation_username: input.confirmationUsername,
        preview_token: input.previewToken,
      },
    }),
  );
  return {
    deletionAuthorizationToken: requireString(value, "deletion_authorization_token"),
    expiresAt: requireISODateString(value, "expires_at"),
  };
}

export async function requestAccountDeletion(input: {
  deletionAuthorizationToken: string;
  clientRequestId: string;
}): Promise<AccountDeletionReceipt> {
  const value = requireRecord(
    await complianceRequest("/account/deletion/requests", {
      method: "POST",
      auth: false,
      headers: { "Idempotency-Key": input.clientRequestId },
      body: {
        deletion_authorization_token: input.deletionAuthorizationToken,
        client_request_id: input.clientRequestId,
      },
    }),
  );
  const status = requireString(value, "status");
  if (status !== "accepted") throw invalidResponse();
  return {
    requestId: requireString(value, "request_id"),
    status,
    acceptedAt: requireISODateString(value, "accepted_at"),
    purgeBy: requireISODateString(value, "purge_by"),
  };
}

export function accountComplianceErrorCode(error: unknown): string | undefined {
  if (!(error instanceof APIError)) return undefined;
  if (typeof error.code === "string") return error.code;
  if (!isRecord(error.payload) || typeof error.payload.code !== "string") return undefined;
  return error.payload.code;
}

export function accountComplianceFallbackMessage(
  error: unknown,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  if (!(error instanceof APIError)) return t("api.networkUnavailable");
  if (error.status === 0 || (error.status === 408 && error.payload === undefined)) {
    return t("api.networkUnavailable");
  }
  if (error.status === 401) return t("api.unauthorized");
  if (error.status >= 500 && error.status <= 599) return t("api.serverUnavailable");
  if (error.code === "decoding_error" || error.message === "api.decodingError") {
    return t("api.decodingError");
  }
  return error.message.startsWith("api.") ? t(error.message) : error.message;
}

type ComplianceRequestOptions = Parameters<typeof apiRequest<unknown>>[1];

async function complianceRequest(
  path: string,
  options: ComplianceRequestOptions = {},
): Promise<unknown> {
  return apiRequest<unknown>(path, {
    requiredData: options.requiredData ?? true,
    requiredEnvelope: true,
    requiredSuccessCode: true,
    transientRetries: true,
    ...options,
  });
}

function normalizeVerificationSession(
  value: unknown,
  permitsMaskedEmail: boolean,
): VerificationSession {
  const record = requireRecord(value);
  const codeLength = requireNonnegativeInteger(record, "code_length");
  if (codeLength !== 6) throw invalidResponse();
  if (!permitsMaskedEmail && record.masked_email !== undefined) throw invalidResponse();
  return {
    sessionId: requireString(record, "session_id"),
    ...(permitsMaskedEmail ? optionalString("maskedEmail", record.masked_email) : {}),
    serverTime: requireISODateString(record, "server_time"),
    expiresAt: requireISODateString(record, "expires_at"),
    resendAvailableAt: requireISODateString(record, "resend_available_at"),
    codeLength,
  };
}

function normalizeRetentionCategory(value: unknown): DeletionRetentionCategory {
  const record = requireRecord(value);
  return {
    category: requireString(record, "category"),
    retentionDays: requireNonnegativeInteger(record, "retention_days"),
    reason: requireString(record, "reason"),
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalidResponse();
  return value;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  preserveWhitespace = false,
): string {
  const value = record[key];
  if (typeof value !== "string" || trimFoundationWhitespacesAndNewlines(value).length === 0) {
    throw invalidResponse();
  }
  return preserveWhitespace ? value : trimFoundationWhitespacesAndNewlines(value);
}

function requireRawString(value: unknown): string {
  if (typeof value !== "string" || trimFoundationWhitespacesAndNewlines(value).length === 0) {
    throw invalidResponse();
  }
  return trimFoundationWhitespacesAndNewlines(value);
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw invalidResponse();
  return value;
}

function requireNonnegativeInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidResponse();
  }
  return value;
}

function optionalString<Key extends string>(
  key: Key,
  value: unknown,
): { [Property in Key]?: string } {
  return typeof value === "string" && trimFoundationWhitespacesAndNewlines(value).length > 0
    ? ({ [key]: trimFoundationWhitespacesAndNewlines(value) } as { [Property in Key]?: string })
    : {};
}

function requireISODateString(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key);
  if (!iso8601Pattern.test(value) || !Number.isFinite(Date.parse(value))) throw invalidResponse();
  return value;
}

function isDeletionStatus(value: string): value is AccountSecuritySummary["deletionStatus"] {
  return value === "active" || value === "delete_pending" || value === "deleted";
}

function invalidResponse(): APIError {
  return new APIError("api.decodingError", 200, undefined, "decoding_error");
}
