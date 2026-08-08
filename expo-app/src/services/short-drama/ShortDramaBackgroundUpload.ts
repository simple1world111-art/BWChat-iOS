import { uploadShortDramaEpisode } from "@/api/bwchat";
import { APIError, decodeSuccessfulPayload, refreshAccessToken } from "@/api/client";
import { normalizeShortDramaEpisodeUploadResult } from "@/api/normalizers";
import { env } from "@/config/env";
import type { ShortDramaEpisodeUploadResult } from "@/models";
import { readCachedUser } from "@/storage/authStorage";
import { readAccessToken } from "@/storage/tokenStorage";
import {
  enqueueNativeShortDramaEpisodeUpload,
  getNativeShortDramaEpisodeUpload,
  hasNativeShortDramaBackgroundUpload,
  markNativeShortDramaUploadConfirmationUnknown,
  removeNativeShortDramaEpisodeUpload,
  type NativeShortDramaUploadRecord,
} from "../../../modules/bwchat-background-upload/src";

export interface ShortDramaBackgroundEpisodeUploadInput {
  ownerId: string;
  jobId: string;
  generation: number;
  seriesId: string;
  episodeId: string;
  title: string;
  intro: string;
  episodeNumber: number;
  unlockPriceGoldCoins: number;
  videoUri: string;
  videoFilename: string;
  videoMimeType: string;
  coverUri: string;
  coverFilename: string;
}

export interface ShortDramaBackgroundUploadHooks {
  onRecord?(record: NativeShortDramaUploadRecord): void | Promise<void>;
}

export class ShortDramaUploadConfirmationUnknownError extends Error {
  readonly confirmationUnknown = true;

  constructor(message = "分集上传结果待确认") {
    super(message);
    this.name = "ShortDramaUploadConfirmationUnknownError";
  }
}

export class ShortDramaUploadOwnerChangedError extends Error {
  constructor() {
    super("账号已切换，发布任务将在原账号恢复后继续");
    this.name = "ShortDramaUploadOwnerChangedError";
  }
}

export function shortDramaEpisodeUploadPath(seriesId: string): string {
  return `/short-drama/series/${encodeShortDramaPathComponent(seriesId)}/episodes`;
}

export function shortDramaEpisodeIdempotencyKey(jobId: string): string {
  return jobId.replaceAll(/[\r\n]/gu, "_");
}

export function shortDramaUploadRetryDelayMilliseconds(attemptCount: number): number {
  return Math.min(2 ** Math.max(attemptCount, 0), 300) * 1_000;
}

export async function uploadShortDramaEpisodeDurably(
  input: ShortDramaBackgroundEpisodeUploadInput,
  hooks: ShortDramaBackgroundUploadHooks = {},
): Promise<ShortDramaEpisodeUploadResult> {
  if (!hasNativeShortDramaBackgroundUpload()) {
    return uploadShortDramaEpisode({
      seriesId: input.seriesId,
      clientSeriesId: input.jobId,
      clientEpisodeId: input.episodeId,
      title: input.title,
      intro: input.intro,
      episodeNumber: input.episodeNumber,
      unlockPriceGoldCoins: input.unlockPriceGoldCoins,
      videoUri: input.videoUri,
      videoFilename: input.videoFilename,
      videoMimeType: input.videoMimeType,
      coverUri: input.coverUri,
      coverFilename: input.coverFilename,
    });
  }

  assertUploadOwner(input.ownerId, (await readCachedUser())?.user_id);
  {
    let record = await getNativeShortDramaEpisodeUpload(
      input.ownerId,
      input.jobId,
      input.episodeId,
    );
    if (record && ["preparing", "uploading", "succeeded"].includes(record.state)) {
      return await consumeNativeRecord(input, record, hooks, false);
    }
  }

  const token = await readAccessToken();
  if (!token) throw new APIError("api.unauthorized", 401);
  assertUploadOwner(input.ownerId, (await readCachedUser())?.user_id);
  const record = await enqueueNativeShortDramaEpisodeUpload({
    owner_id: input.ownerId,
    job_id: input.jobId,
    episode_id: input.episodeId,
    generation: input.generation,
    request_url: `${env.apiBaseUrl.replace(/\/$/u, "")}${shortDramaEpisodeUploadPath(input.seriesId)}`,
    authorization: `Bearer ${token}`,
    title: input.title,
    intro: input.intro,
    episode_number: input.episodeNumber,
    unlock_price_gold_coins: input.unlockPriceGoldCoins,
    video_uri: input.videoUri,
    video_filename: input.videoFilename,
    video_mime_type: input.videoMimeType,
    cover_uri: input.coverUri,
    cover_filename: input.coverFilename,
  });
  if (!record) throw new Error("原生后台上传不可用");
  return consumeNativeRecord(input, record, hooks, false);
}

async function consumeNativeRecord(
  input: ShortDramaBackgroundEpisodeUploadInput,
  initial: NativeShortDramaUploadRecord,
  hooks: ShortDramaBackgroundUploadHooks,
  didRefresh: boolean,
): Promise<ShortDramaEpisodeUploadResult> {
  let record = initial;
  for (;;) {
    await hooks.onRecord?.(record);
    if (record.state === "succeeded") {
      return decodeConfirmedNativeResponse(input, record);
    }
    if (record.state === "confirmation_unknown") {
      throw new ShortDramaUploadConfirmationUnknownError(
        record.last_error_code || "分集上传结果待确认",
      );
    }
    if (record.state === "retry_waiting") {
      throw new APIError(
        responseMessage(record),
        record.http_status ?? 0,
        record,
        record.last_error_code,
      );
    }
    if (record.state === "failed_permanent") {
      if (record.http_status === 401 && !didRefresh) {
        await refreshAccessToken();
        const token = await readAccessToken();
        if (!token) throw new APIError("api.unauthorized", 401);
        assertUploadOwner(input.ownerId, (await readCachedUser())?.user_id);
        const retried = await enqueueNativeShortDramaEpisodeUpload({
          owner_id: input.ownerId,
          job_id: input.jobId,
          episode_id: input.episodeId,
          generation: input.generation,
          request_url: `${env.apiBaseUrl.replace(/\/$/u, "")}${shortDramaEpisodeUploadPath(input.seriesId)}`,
          authorization: `Bearer ${token}`,
          title: input.title,
          intro: input.intro,
          episode_number: input.episodeNumber,
          unlock_price_gold_coins: input.unlockPriceGoldCoins,
          video_uri: input.videoUri,
          video_filename: input.videoFilename,
          video_mime_type: input.videoMimeType,
          cover_uri: input.coverUri,
          cover_filename: input.coverFilename,
        });
        if (!retried) throw new Error("原生后台上传不可用");
        return consumeNativeRecord(input, retried, hooks, true);
      }
      throw new APIError(
        responseMessage(record),
        record.http_status ?? 0,
        record,
        record.last_error_code,
      );
    }
    if (record.state === "cancelled") throw new Error("上传已取消");

    await delay(350);
    assertUploadOwner(input.ownerId, (await readCachedUser())?.user_id);
    const latest = await getNativeShortDramaEpisodeUpload(
      input.ownerId,
      input.jobId,
      input.episodeId,
    );
    if (!latest) {
      throw new ShortDramaUploadConfirmationUnknownError("后台上传任务记录丢失");
    }
    record = latest;
  }
}

async function decodeConfirmedNativeResponse(
  input: ShortDramaBackgroundEpisodeUploadInput,
  record: NativeShortDramaUploadRecord,
): Promise<ShortDramaEpisodeUploadResult> {
  try {
    if (!record.response_body_base64) throw new Error("missing-response-body");
    const payload = JSON.parse(decodeBase64UTF8(record.response_body_base64)) as unknown;
    const data = decodeSuccessfulPayload<unknown>(payload, record.http_status ?? 200, false, true);
    const result = data == null ? {} : normalizeShortDramaEpisodeUploadResult(data);
    await removeNativeShortDramaEpisodeUpload(input.ownerId, input.jobId, input.episodeId);
    return result;
  } catch (error) {
    await markNativeShortDramaUploadConfirmationUnknown(
      input.ownerId,
      input.jobId,
      input.episodeId,
      "response-decode-failed",
    );
    throw new ShortDramaUploadConfirmationUnknownError(
      error instanceof Error ? error.message : "分集上传成功但响应无法确认",
    );
  }
}

export function isTransientShortDramaUploadError(error: unknown): boolean {
  if (!(error instanceof APIError)) return false;
  return (
    error.status === 0 ||
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    (error.status >= 500 && error.status <= 599)
  );
}

function assertUploadOwner(ownerId: string, activeOwnerId: string | null | undefined): void {
  if (!ownerId.trim() || activeOwnerId?.trim() !== ownerId.trim()) {
    throw new ShortDramaUploadOwnerChangedError();
  }
}

function encodeShortDramaPathComponent(value: string): string {
  return encodeURIComponent(value).replace(/%(24|26|2B|2C|3A|3B|3D|40)/gu, (escape) =>
    decodeURIComponent(escape),
  );
}

function decodeBase64UTF8(value: string): string {
  const binary = globalThis.atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function responseMessage(record: NativeShortDramaUploadRecord): string {
  if ((record.http_status ?? 0) >= 500) return "服务暂时不可用，请稍后重试";
  if (record.response_body_base64) {
    try {
      const payload = JSON.parse(decodeBase64UTF8(record.response_body_base64)) as unknown;
      if (payload && typeof payload === "object" && "message" in payload) {
        const message = String(payload.message).trim();
        if (message) return message;
      }
    } catch {
      // Fall through to the stable HTTP/native transport error below.
    }
  }
  return record.http_status ? `请求失败（${record.http_status}）` : "网络请求失败";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
