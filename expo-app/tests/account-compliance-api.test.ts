import { APIError, apiRequest } from "@/api/client";
import {
  accountComplianceErrorCode,
  accountComplianceFallbackMessage,
  authorizeAccountDeletion,
  confirmPasswordReset,
  createPasswordResetSession,
  createRegistrationEmailVerificationSession,
  getAccountDeletionPreview,
  getAccountSecurity,
  registerVerifiedAccount,
  requestAccountDeletion,
  verifyRegistrationEmail,
} from "@/services/account/AccountComplianceService";
import { readCachedNativePushToken } from "@/services/push/PushTokenStore";

jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  apiRequest: jest.fn(),
}));

jest.mock("@/services/push/PushTokenStore", () => ({
  readCachedNativePushToken: jest.fn(),
}));

const request = jest.mocked(apiRequest);
const readPushToken = jest.mocked(readCachedNativePushToken);

describe("account compliance API contract", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readPushToken.mockResolvedValue(null);
  });

  it("creates and verifies a registration email session with strict snake_case", async () => {
    request.mockResolvedValueOnce(verificationSession()).mockResolvedValueOnce({
      email_verification_token: "opaque-registration-token",
      normalized_email: "member@example.com",
      expires_at: "2026-08-12T00:15:00Z",
    });

    await expect(createRegistrationEmailVerificationSession(" Raw@Example.com ")).resolves.toEqual({
      sessionId: "registration-session",
      maskedEmail: "m***@example.com",
      serverTime: "2026-08-12T00:00:00Z",
      expiresAt: "2026-08-12T00:10:00Z",
      resendAvailableAt: "2026-08-12T00:01:00Z",
      codeLength: 6,
    });
    await expect(verifyRegistrationEmail("registration-session", "123456")).resolves.toEqual({
      emailVerificationToken: "opaque-registration-token",
      normalizedEmail: "member@example.com",
      expiresAt: "2026-08-12T00:15:00Z",
    });

    expect(request).toHaveBeenNthCalledWith(1, "/auth/registration/email-verification-sessions", {
      method: "POST",
      auth: false,
      body: { email: " Raw@Example.com " },
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
      transientRetries: true,
    });
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/auth/registration/email-verification-sessions/registration-session/verify",
      {
        method: "POST",
        auth: false,
        body: { code: "123456" },
        requiredData: true,
        requiredEnvelope: true,
        requiredSuccessCode: true,
        transientRetries: true,
      },
    );
  });

  it("creates an account only through register-v2 and keeps one idempotency identity", async () => {
    readPushToken.mockResolvedValue("push-token");
    request.mockResolvedValue({
      token: "access",
      refresh_token: "refresh",
      user: { user_id: "7", username: " raw-user ", nickname: " Raw Nick " },
    });

    await registerVerifiedAccount({
      username: " raw-user ",
      password: " raw-password ",
      nickname: " Raw Nick ",
      email: "member@example.com",
      emailVerificationToken: "opaque-registration-token",
      clientRequestId: "client-request-id",
    });

    expect(request).toHaveBeenCalledWith("/auth/register-v2", {
      method: "POST",
      auth: false,
      headers: { "Idempotency-Key": "client-request-id" },
      body: {
        username: " raw-user ",
        password: " raw-password ",
        nickname: " Raw Nick ",
        email: "member@example.com",
        email_verification_token: "opaque-registration-token",
        client_request_id: "client-request-id",
        device_token: "push-token",
      },
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
      transientRetries: true,
    });
  });

  it("keeps password-reset session responses non-enumerating", async () => {
    request.mockResolvedValue({
      ...verificationSession(),
      masked_email: "m***@example.com",
    });
    await expect(createPasswordResetSession("member")).rejects.toMatchObject({
      code: "decoding_error",
    });

    request.mockResolvedValue(verificationSession(false));
    await createPasswordResetSession("member");
    expect(request).toHaveBeenLastCalledWith("/auth/password-reset/sessions", {
      method: "POST",
      auth: false,
      body: { identifier: "member" },
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
      transientRetries: true,
    });
  });

  it("uses one idempotency key when confirming a password reset", async () => {
    request.mockResolvedValue(undefined);
    await confirmPasswordReset({
      sessionId: "reset/session",
      code: "123456",
      newPassword: "new-password",
      clientRequestId: "reset-request-id",
    });
    expect(request).toHaveBeenCalledWith("/auth/password-reset/sessions/reset%2Fsession/confirm", {
      method: "POST",
      auth: false,
      headers: { "Idempotency-Key": "reset-request-id" },
      body: {
        code: "123456",
        new_password: "new-password",
        client_request_id: "reset-request-id",
      },
      requiredData: false,
      requiredEnvelope: true,
      requiredSuccessCode: true,
      transientRetries: true,
    });
  });

  it("does not spread a full email into the account security model", async () => {
    request.mockResolvedValue({
      email: {
        verified: true,
        masked_email: "m***@example.com",
        verified_at: "2026-08-12T00:00:00Z",
      },
      deletion_status: "active",
    });
    await expect(getAccountSecurity()).resolves.toEqual({
      email: {
        verified: true,
        maskedEmail: "m***@example.com",
        verifiedAt: "2026-08-12T00:00:00Z",
      },
      deletionStatus: "active",
    });
  });

  it("normalizes the live deletion preview and rejects negative asset counts", async () => {
    request.mockResolvedValue(deletionPreview());
    await expect(getAccountDeletionPreview()).resolves.toMatchObject({
      previewToken: "preview-token",
      confirmationUsername: " exact-user ",
      impact: { goldCoinsToForfeit: 12, ownedGroupsToDissolve: 2 },
      retainedCategories: [{ category: "financial_ledger", retentionDays: 2555 }],
    });

    request.mockResolvedValue({
      ...deletionPreview(),
      impact: { ...deletionPreview().impact, gold_coins_to_forfeit: -1 },
    });
    await expect(getAccountDeletionPreview()).rejects.toMatchObject({ code: "decoding_error" });
  });

  it("authorizes with the exact username and submits deletion without an access token", async () => {
    request
      .mockResolvedValueOnce({
        deletion_authorization_token: "single-purpose-token",
        expires_at: "2026-08-12T00:05:00Z",
      })
      .mockResolvedValueOnce({
        request_id: "deletion-request",
        status: "accepted",
        accepted_at: "2026-08-12T00:01:00Z",
        purge_by: "2026-08-19T00:01:00Z",
      });

    await authorizeAccountDeletion({
      currentPassword: " raw-password ",
      confirmationUsername: " exact-user ",
      previewToken: "preview-token",
    });
    await requestAccountDeletion({
      deletionAuthorizationToken: "single-purpose-token",
      clientRequestId: "deletion-client-request",
    });

    expect(request).toHaveBeenNthCalledWith(1, "/account/deletion/authorizations", {
      method: "POST",
      body: {
        current_password: " raw-password ",
        confirmation_username: " exact-user ",
        preview_token: "preview-token",
      },
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
      transientRetries: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/account/deletion/requests", {
      method: "POST",
      auth: false,
      headers: { "Idempotency-Key": "deletion-client-request" },
      body: {
        deletion_authorization_token: "single-purpose-token",
        client_request_id: "deletion-client-request",
      },
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
      transientRetries: true,
    });
  });

  it("exposes symbolic error codes without parsing display text", () => {
    expect(
      accountComplianceErrorCode(
        new APIError("safe message", 409, { code: "DELETION_PREVIEW_STALE" }),
      ),
    ).toBe("DELETION_PREVIEW_STALE");
    expect(accountComplianceFallbackMessage(new APIError("raw", 503), (key) => key)).toBe(
      "api.serverUnavailable",
    );
  });
});

function verificationSession(masked = true) {
  return {
    session_id: "registration-session",
    ...(masked ? { masked_email: "m***@example.com" } : {}),
    server_time: "2026-08-12T00:00:00Z",
    expires_at: "2026-08-12T00:10:00Z",
    resend_available_at: "2026-08-12T00:01:00Z",
    code_length: 6,
  };
}

function deletionPreview() {
  return {
    preview_token: "preview-token",
    expires_at: "2026-08-12T00:05:00Z",
    confirmation_username: " exact-user ",
    purge_within_days: 7,
    impact: {
      gold_coins_to_forfeit: 12,
      props_to_forfeit: 3,
      owned_groups_to_dissolve: 2,
    },
    delete_categories: ["profile", "private_media"],
    retained_categories: [
      {
        category: "financial_ledger",
        retention_days: 2555,
        reason: "financial_and_payment_compliance",
      },
    ],
  };
}
