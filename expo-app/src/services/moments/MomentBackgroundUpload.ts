import { File, FileMode, type UploadProgress, type UploadTask, UploadType } from "expo-file-system";

import { APIError, decodeSuccessfulPayload, refreshAccessToken } from "@/api/client";
import { normalizeMoment } from "@/api/normalizers";
import { env } from "@/config/env";
import type { Moment, MomentUploadAsset } from "@/models";
import { getActiveLanguageCode } from "@/providers/LocalizationProvider";
import { momentDraftDirectory } from "@/services/moments/MomentOutboxStore";
import { readCachedUser } from "@/storage/authStorage";
import { readAccessToken } from "@/storage/tokenStorage";

export interface MomentBackgroundUploadInput {
  clientRequestId: string;
  ownerId: string;
  content: string;
  media: MomentUploadAsset[];
  unlockPriceGoldCoins?: number | undefined;
}

export interface MomentBackgroundUploadHooks {
  onPrepared?: (bodyBytes: number) => void | Promise<void>;
  onProgress?: (progress: UploadProgress) => void;
}

export interface MomentMultipartField {
  name: "content" | "client_request_id" | "unlock_price_gold_coins";
  value: string;
}

export function momentUploadRequestHeaders(
  clientRequestId: string,
  token: string,
  language: string,
): Record<string, string> {
  return {
    Accept: "application/json",
    "Accept-Language": language,
    Authorization: `Bearer ${token}`,
    "Content-Type": `multipart/form-data; boundary=${momentMultipartBoundary(clientRequestId)}`,
    // The native background adapter sends both this header and the multipart
    // client_request_id field so every retry has the same backend identity.
    "Idempotency-Key": safeHeaderValue(clientRequestId),
  };
}

export class MomentUploadConfirmationUnknownError extends Error {
  readonly confirmationUnknown = true;

  constructor(message = "发布结果待确认") {
    super(message);
    this.name = "MomentUploadConfirmationUnknownError";
  }
}

export class MomentUploadOwnerChangedError extends Error {
  constructor() {
    super("账号已切换，发布任务将在原账号恢复后继续");
    this.name = "MomentUploadOwnerChangedError";
  }
}

export function assertMomentUploadOwner(ownerId: string, activeOwnerId?: string | null): void {
  if (!ownerId.trim() || activeOwnerId?.trim() !== ownerId.trim()) {
    throw new MomentUploadOwnerChangedError();
  }
}

const activeTasks = new Map<string, UploadTask>();
const cancelled = new Set<string>();

export async function uploadMomentInBackground(
  input: MomentBackgroundUploadInput,
  hooks: MomentBackgroundUploadHooks = {},
): Promise<Moment> {
  const body = await createMomentMultipartBodyFile(input);
  assertMomentUploadOwner(input.ownerId, (await readCachedUser())?.user_id);
  await hooks.onPrepared?.(body.size ?? 0);
  return uploadPreparedBody(
    input.clientRequestId,
    input.ownerId,
    body,
    hooks.onProgress,
    momentUploadTimeoutMilliseconds(input.media.some((asset) => asset.kind === "video")),
    false,
  );
}

export function cancelMomentBackgroundUpload(ownerId: string, clientRequestId: string): void {
  const runtimeKey = momentBackgroundUploadRuntimeKey(ownerId, clientRequestId);
  cancelled.add(runtimeKey);
  activeTasks.get(runtimeKey)?.cancel();
}

export function clearMomentBackgroundUploadCancellation(
  ownerId: string,
  clientRequestId: string,
): void {
  cancelled.delete(momentBackgroundUploadRuntimeKey(ownerId, clientRequestId));
}

export function isMomentBackgroundUploadActive(ownerId: string, clientRequestId: string): boolean {
  return activeTasks.has(momentBackgroundUploadRuntimeKey(ownerId, clientRequestId));
}

export function momentBackgroundUploadRuntimeKey(ownerId: string, clientRequestId: string): string {
  return `${ownerId.trim()}\u0000${clientRequestId}`;
}

export function momentUploadTimeoutMilliseconds(hasVideo: boolean): 180_000 | 600_000 {
  return hasVideo ? 600_000 : 180_000;
}

export function decodeMomentBackgroundUploadResponse(payload: unknown, status: number): Moment {
  // Swift marks a body that cannot decode as an APIResponseWrapper as
  // confirmation-unknown because the server may already have committed it.
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new MomentUploadConfirmationUnknownError("发布成功但响应无法确认");
  }
  // A valid wrapper whose data is absent remains an ordinary server/contract
  // failure, matching APIResponseWrapper.requiredData() outside the transport
  // decoder. Only malformed Moment data is confirmation-unknown.
  const data = decodeSuccessfulPayload<unknown>(payload, status, true, true);
  try {
    return normalizeMoment(data);
  } catch (error) {
    throw new MomentUploadConfirmationUnknownError(
      error instanceof Error ? error.message : "发布成功但响应无法确认",
    );
  }
}

export async function createMomentMultipartBodyFile(
  input: MomentBackgroundUploadInput,
): Promise<File> {
  const directory = momentDraftDirectory(input.ownerId, input.clientRequestId);
  directory.create({ intermediates: true, idempotent: true });
  const body = new File(directory, "request.multipart");
  body.create({ intermediates: true, overwrite: true });
  const boundary = momentMultipartBoundary(input.clientRequestId);
  const output = body.open(FileMode.Truncate);
  try {
    for (const field of momentMultipartFields(input)) {
      writeUTF8(output, momentMultipartTextField(boundary, field.name, field.value));
    }
    for (const asset of input.media.slice(0, 9)) {
      writeUTF8(
        output,
        `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${safeHeaderValue(asset.filename)}"\r\nContent-Type: ${safeHeaderValue(asset.mime_type)}\r\n\r\n`,
      );
      await appendFile(output, new File(asset.uri));
      writeUTF8(output, "\r\n");
    }
    writeUTF8(output, `--${boundary}--\r\n`);
  } finally {
    output.close();
  }
  return body;
}

export function momentMultipartFields(input: MomentBackgroundUploadInput): MomentMultipartField[] {
  const fields: MomentMultipartField[] = [
    { name: "content", value: input.content },
    { name: "client_request_id", value: input.clientRequestId },
  ];
  if ((input.unlockPriceGoldCoins ?? 0) > 0 && input.media.length > 0) {
    fields.push({
      name: "unlock_price_gold_coins",
      value: String(input.unlockPriceGoldCoins),
    });
  }
  return fields;
}

export function momentMultipartBoundary(clientRequestId: string): string {
  return `BWChatMoment-${clientRequestId.replaceAll(/[^a-zA-Z0-9]/g, "")}`;
}

export function momentMultipartTextField(boundary: string, name: string, value: string): string {
  return `--${boundary}\r\nContent-Disposition: form-data; name="${safeHeaderValue(name)}"\r\n\r\n${value}\r\n`;
}

async function uploadPreparedBody(
  clientRequestId: string,
  ownerId: string,
  body: File,
  onProgress: ((progress: UploadProgress) => void) | undefined,
  timeoutMilliseconds: 180_000 | 600_000,
  didRefresh: boolean,
): Promise<Moment> {
  const runtimeKey = momentBackgroundUploadRuntimeKey(ownerId, clientRequestId);
  if (cancelled.has(runtimeKey)) {
    cancelled.delete(runtimeKey);
    throw new Error("上传已取消");
  }
  assertMomentUploadOwner(ownerId, (await readCachedUser())?.user_id);
  const token = await readAccessToken();
  if (!token) throw new APIError("api.unauthorized", 401);
  // Token and cached user are separate durable records. Re-check after both
  // reads so a sign-out/sign-in interleaving cannot send an old job as the new
  // account. No other JS callback can run between this check and task creation.
  assertMomentUploadOwner(ownerId, (await readCachedUser())?.user_id);
  let latestProgress: UploadProgress = { bytesSent: 0, totalBytes: body.size ?? 0 };
  const task = body.createUploadTask(`${env.apiBaseUrl.replace(/\/$/, "")}/moments/create`, {
    httpMethod: "POST",
    uploadType: UploadType.BINARY_CONTENT,
    sessionType: "background",
    headers: momentUploadRequestHeaders(clientRequestId, token, getActiveLanguageCode()),
    onProgress: (progress) => {
      latestProgress = progress;
      onProgress?.(progress);
    },
  });
  activeTasks.set(runtimeKey, task);
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    task.cancel();
  }, timeoutMilliseconds);
  try {
    const result = await task.uploadAsync();
    const payload = parsePayload(result.body);
    if (result.status === 401 && !didRefresh) {
      await refreshAccessToken();
      return uploadPreparedBody(
        clientRequestId,
        ownerId,
        body,
        onProgress,
        timeoutMilliseconds,
        true,
      );
    }
    if (result.status < 200 || result.status >= 300) {
      throw new APIError(responseMessage(payload, result.status), result.status, payload);
    }
    return decodeMomentBackgroundUploadResponse(payload, result.status);
  } catch (error) {
    if (
      error instanceof APIError ||
      error instanceof MomentUploadConfirmationUnknownError ||
      cancelled.has(runtimeKey)
    ) {
      throw error;
    }
    if (latestProgress.totalBytes > 0 && latestProgress.bytesSent >= latestProgress.totalBytes) {
      throw new MomentUploadConfirmationUnknownError(
        error instanceof Error ? error.message : "发布结果待确认",
      );
    }
    if (didTimeout) throw new APIError("请求超时，请稍后重试", 408, error);
    throw error;
  } finally {
    clearTimeout(timeout);
    if (activeTasks.get(runtimeKey) === task) activeTasks.delete(runtimeKey);
    if (cancelled.has(runtimeKey)) cancelled.delete(runtimeKey);
  }
}

async function appendFile(output: ReturnType<File["open"]>, source: File): Promise<void> {
  if (!source.exists) throw new Error("待上传媒体文件不存在");
  const input = source.open(FileMode.ReadOnly);
  try {
    let yieldedBytes = 0;
    while ((input.offset ?? 0) < (input.size ?? 0)) {
      const remaining = (input.size ?? 0) - (input.offset ?? 0);
      const chunk = input.readBytes(Math.min(64 * 1_024, remaining));
      if (chunk.length === 0) break;
      output.writeBytes(chunk);
      yieldedBytes += chunk.length;
      if (yieldedBytes >= 8 * 1_024 * 1_024) {
        yieldedBytes = 0;
        await Promise.resolve();
      }
    }
  } finally {
    input.close();
  }
}

function writeUTF8(output: ReturnType<File["open"]>, value: string): void {
  output.writeBytes(new TextEncoder().encode(value));
}

function safeHeaderValue(value: string): string {
  return value.replaceAll(/[\r\n"]/g, "_");
}

function parsePayload(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function responseMessage(payload: unknown, status: number): string {
  if (status >= 500) return "服务暂时不可用，请稍后重试";
  if (typeof payload === "object" && payload !== null && "message" in payload) {
    const message = String(payload.message).trim();
    if (message) return message;
  }
  return `请求失败（${status}）`;
}
