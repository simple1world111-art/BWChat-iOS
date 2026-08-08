import { requireOptionalNativeModule } from "expo";

export type NativeShortDramaUploadState =
  | "preparing"
  | "uploading"
  | "succeeded"
  | "retry_waiting"
  | "confirmation_unknown"
  | "failed_permanent"
  | "cancelled";

export interface NativeShortDramaUploadRecord {
  id: string;
  owner_id: string;
  job_id: string;
  episode_id: string;
  generation: number;
  state: NativeShortDramaUploadState;
  task_identifier?: number | undefined;
  uploaded_bytes: number;
  expected_bytes: number;
  http_status?: number | undefined;
  response_body_base64?: string | undefined;
  last_error_code?: string | undefined;
  updated_at: number;
}

export interface NativeShortDramaEpisodeUploadInput {
  owner_id: string;
  job_id: string;
  episode_id: string;
  generation: number;
  request_url: string;
  authorization: string;
  title: string;
  intro: string;
  episode_number: number;
  unlock_price_gold_coins: number;
  video_uri: string;
  video_filename: string;
  video_mime_type: string;
  cover_uri: string;
  cover_filename: string;
}

interface BWChatBackgroundUploadNativeModule {
  enqueueEpisodeAsync(payloadJson: string): Promise<string>;
  getEpisodeTaskAsync(ownerId: string, jobId: string, episodeId: string): Promise<string | null>;
  markConfirmationUnknownAsync(
    ownerId: string,
    jobId: string,
    episodeId: string,
    errorCode: string,
  ): Promise<string | null>;
  cancelJobAsync(ownerId: string, jobId: string): Promise<void>;
  removeEpisodeTaskAsync(ownerId: string, jobId: string, episodeId: string): Promise<void>;
  removeJobAsync(ownerId: string, jobId: string): Promise<void>;
}

const nativeModule =
  requireOptionalNativeModule<BWChatBackgroundUploadNativeModule>("BWChatBackgroundUpload");

export function hasNativeShortDramaBackgroundUpload(): boolean {
  return nativeModule !== null;
}

export async function enqueueNativeShortDramaEpisodeUpload(
  input: NativeShortDramaEpisodeUploadInput,
): Promise<NativeShortDramaUploadRecord | null> {
  if (!nativeModule) return null;
  return decodeRecord(await nativeModule.enqueueEpisodeAsync(JSON.stringify(input)));
}

export async function getNativeShortDramaEpisodeUpload(
  ownerId: string,
  jobId: string,
  episodeId: string,
): Promise<NativeShortDramaUploadRecord | null> {
  if (!nativeModule) return null;
  return decodeRecord(await nativeModule.getEpisodeTaskAsync(ownerId, jobId, episodeId));
}

export async function markNativeShortDramaUploadConfirmationUnknown(
  ownerId: string,
  jobId: string,
  episodeId: string,
  errorCode: string,
): Promise<NativeShortDramaUploadRecord | null> {
  if (!nativeModule) return null;
  return decodeRecord(
    await nativeModule.markConfirmationUnknownAsync(ownerId, jobId, episodeId, errorCode),
  );
}

export async function cancelNativeShortDramaUploadJob(
  ownerId: string,
  jobId: string,
): Promise<void> {
  await nativeModule?.cancelJobAsync(ownerId, jobId);
}

export async function removeNativeShortDramaEpisodeUpload(
  ownerId: string,
  jobId: string,
  episodeId: string,
): Promise<void> {
  await nativeModule?.removeEpisodeTaskAsync(ownerId, jobId, episodeId);
}

export async function removeNativeShortDramaUploadJob(
  ownerId: string,
  jobId: string,
): Promise<void> {
  await nativeModule?.removeJobAsync(ownerId, jobId);
}

function decodeRecord(value: string | null): NativeShortDramaUploadRecord | null {
  if (!value) return null;
  try {
    const record = JSON.parse(value) as Partial<NativeShortDramaUploadRecord>;
    if (
      typeof record.id !== "string" ||
      typeof record.owner_id !== "string" ||
      typeof record.job_id !== "string" ||
      typeof record.episode_id !== "string" ||
      typeof record.generation !== "number" ||
      !isState(record.state)
    ) {
      return null;
    }
    return {
      id: record.id,
      owner_id: record.owner_id,
      job_id: record.job_id,
      episode_id: record.episode_id,
      generation: record.generation,
      state: record.state,
      uploaded_bytes: finiteNumber(record.uploaded_bytes),
      expected_bytes: finiteNumber(record.expected_bytes),
      updated_at: finiteNumber(record.updated_at),
      ...(typeof record.task_identifier === "number"
        ? { task_identifier: record.task_identifier }
        : {}),
      ...(typeof record.http_status === "number" ? { http_status: record.http_status } : {}),
      ...(typeof record.response_body_base64 === "string"
        ? { response_body_base64: record.response_body_base64 }
        : {}),
      ...(typeof record.last_error_code === "string"
        ? { last_error_code: record.last_error_code }
        : {}),
    };
  } catch {
    return null;
  }
}

function isState(value: unknown): value is NativeShortDramaUploadState {
  return [
    "preparing",
    "uploading",
    "succeeded",
    "retry_waiting",
    "confirmation_unknown",
    "failed_permanent",
    "cancelled",
  ].includes(String(value));
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
