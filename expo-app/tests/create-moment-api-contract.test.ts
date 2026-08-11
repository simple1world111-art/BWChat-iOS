import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");

describe("CreateMoment API and durable upload contract", () => {
  const transport = fs.readFileSync(
    path.join(root, "src/services/moments/MomentBackgroundUpload.ts"),
    "utf8",
  );
  const queue = fs.readFileSync(
    path.join(root, "src/services/moments/MomentUploadQueue.ts"),
    "utf8",
  );

  it("locks the native POST path, background mode, auth and multipart identity", () => {
    expect(transport).toContain("}/moments/create`");
    expect(transport).toContain('httpMethod: "POST"');
    expect(transport).toContain("uploadType: UploadType.BINARY_CONTENT");
    expect(transport).toContain('sessionType: "background"');
    expect(transport).toContain("Authorization: `Bearer ${token}`");
    expect(transport).toContain('"Idempotency-Key": safeHeaderValue(clientRequestId)');
    expect(transport).not.toMatch(/moments\/create[^"`\n]*\?/u);
  });

  it("locks every multipart field and repeated media framing", () => {
    expect(transport).toContain('{ name: "content", value: input.content }');
    expect(transport).toContain('{ name: "client_request_id", value: input.clientRequestId }');
    expect(transport).toContain('name: "unlock_price_gold_coins"');
    expect(transport).toContain('name="media"; filename="${safeHeaderValue(asset.filename)}"');
    expect(transport).toContain("Content-Type: ${safeHeaderValue(asset.mime_type)}");
    expect(transport).toContain("input.media.slice(0, 9)");
    expect(transport).toContain("input.media.length > 0");
  });

  it("locks native timeouts and confirmation-aware envelope/error handling", () => {
    expect(transport).toContain("return hasVideo ? 600_000 : 180_000");
    expect(transport).toContain("result.status === 401 && !didRefresh");
    expect(transport).toContain("refreshAccessToken()");
    expect(transport).toContain("decodeSuccessfulPayload<unknown>(payload, status, true, true)");
    expect(transport).toContain("decodeMomentBackgroundUploadResponse(payload, result.status, {");
    expect(transport).toContain("result.status < 200 || result.status >= 300");
    expect(transport).toContain("MomentUploadConfirmationUnknownError");
    expect(transport).toContain("latestProgress.bytesSent >= latestProgress.totalBytes");
    expect(transport).toContain('new APIError("请求超时，请稍后重试", 408, error)');
  });

  it("keeps persistent states, five attempts and owner-scoped runtime authority", () => {
    for (const state of [
      '"queued"',
      '"preparing"',
      '"uploading"',
      '"committing"',
      '"retry_waiting"',
      '"confirmation_unknown"',
      '"failed"',
      '"cancelled"',
    ]) {
      expect(queue).toContain(state);
    }
    expect(queue).toContain("preparing.attempt_count < 5");
    expect(queue).toContain("momentRetryDelayMilliseconds");
    expect(queue).toContain("momentUploadRuntimeKey(job.owner_id, job.id)");
    expect(queue).toContain("resumeParkedOwnerJob(preparing.owner_id, preparing.id)");
    expect(queue).toContain("if (!wasInFlight)");
    expect(queue).toContain(
      "clearMomentBackgroundUploadCancellation(job.owner_id, clientRequestId)",
    );
    expect(transport).toContain("momentBackgroundUploadRuntimeKey(ownerId, clientRequestId)");
  });
});
