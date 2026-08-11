import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";

import { deleteMoment, getUserMoments } from "@/api/bwchat";
import { APIError } from "@/api/client";
import { env } from "@/config/env";
import type { Moment, MomentUploadAsset, User } from "@/models";
import { adoptLocalImageFile } from "@/services/cache/ImageCacheService";
import { adoptLocalMediaFile, chatVideoMediaCacheId } from "@/services/cache/MediaCacheService";
import {
  cancelMomentBackgroundUpload,
  clearMomentBackgroundUploadCancellation,
  MomentUploadConfirmationUnknownError,
  MomentUploadOwnerChangedError,
  uploadMomentInBackground,
} from "@/services/moments/MomentBackgroundUpload";
import { publishMomentMutation } from "@/services/moments/MomentMutationStore";
import { readCachedUser } from "@/storage/authStorage";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export type MomentUploadState =
  | "queued"
  | "preparing"
  | "uploading"
  | "committing"
  | "retry_waiting"
  | "confirmation_unknown"
  | "failed"
  | "cancelled";

export interface MomentUploadJob {
  id: string;
  owner_id: string;
  content: string;
  media: MomentUploadAsset[];
  unlock_price_gold_coins?: number | undefined;
  temp_moment: Moment;
  state: MomentUploadState;
  attempt_count: number;
  upload_timeout_ms: 180_000 | 600_000;
  server_moment_id?: number | undefined;
  uploaded_bytes?: number | undefined;
  expected_bytes?: number | undefined;
  next_attempt_at?: number | undefined;
  last_error?: string | undefined;
}

export interface MomentUploadStatus {
  clientRequestId: string;
  tempMomentId: number;
  state: MomentUploadState;
  attemptCount: number;
  uploadedBytes?: number | undefined;
  expectedBytes?: number | undefined;
  error?: string | undefined;
}

type Listener = (status: MomentUploadStatus) => void;

const storagePrefix = "bwchat.moment-outbox.v1";
const listenersByOwner = new Map<string, Set<Listener>>();
const statuses = new Map<string, MomentUploadStatus>();
const inFlight = new Set<string>();
const cancelled = new Set<string>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function enqueueMomentUpload(input: {
  owner: User;
  clientRequestId: string;
  content: string;
  media: MomentUploadAsset[];
  unlockPriceGoldCoins?: number | undefined;
}): Promise<Moment> {
  validateMomentMedia(input.media);
  const durableMedia = await stageMomentMedia(
    input.owner.user_id,
    input.clientRequestId,
    input.media,
  );
  const tempMoment = createOptimisticMoment({
    owner: input.owner,
    clientRequestId: input.clientRequestId,
    content: input.content,
    media: durableMedia,
    unlockPriceGoldCoins: input.unlockPriceGoldCoins,
  });
  const job: MomentUploadJob = {
    id: input.clientRequestId,
    owner_id: input.owner.user_id,
    content: input.content,
    media: durableMedia,
    ...(durableMedia.length > 0 && input.unlockPriceGoldCoins
      ? { unlock_price_gold_coins: input.unlockPriceGoldCoins }
      : {}),
    temp_moment: tempMoment,
    state: "queued",
    attempt_count: 0,
    upload_timeout_ms: durableMedia.some((item) => item.kind === "video") ? 600_000 : 180_000,
  };
  await saveJob(job);
  publishMomentMutation(job.owner_id, { kind: "created", moment: tempMoment });
  emit(job);
  void runJob(job);
  return tempMoment;
}

export async function resumeMomentUploads(
  ownerId: string,
  options: { awaitCompletion?: boolean } = {},
): Promise<void> {
  const jobs = await readJobs(ownerId);
  const tasks: Promise<void>[] = [];
  for (const persisted of jobs) {
    let job = persisted;
    publishMomentMutation(job.owner_id, { kind: "created", moment: job.temp_moment });
    if (job.state === "preparing") {
      job = { ...job, state: "queued" };
      await saveJob(job);
    } else if (job.state === "uploading" || job.state === "committing") {
      job = {
        ...job,
        state: "confirmation_unknown",
        last_error: "后台上传已提交，等待服务端确认",
      };
      await saveJob(job);
    }
    emit(job);
    if (job.state === "queued" || job.state === "retry_waiting") {
      const task = runJobAtScheduledTime(job);
      if (options.awaitCompletion) tasks.push(task);
      else void task;
    }
  }
  if (tasks.length > 0) await Promise.allSettled(tasks);
}

export async function retryMomentUpload(clientRequestId: string): Promise<void> {
  const activeOwnerId = (await readCachedUser())?.user_id;
  if (!activeOwnerId) return;
  const job = await readJobById(clientRequestId, activeOwnerId);
  if (!job || inFlight.has(momentUploadRuntimeKey(activeOwnerId, clientRequestId))) return;
  if (job.state === "confirmation_unknown") {
    try {
      const page = await getUserMoments(activeOwnerId, { limit: 50 });
      await reconcileMomentUploads(activeOwnerId, page.moments);
    } catch (error) {
      await saveAndEmit({ ...job, last_error: errorMessage(error) });
    }
    return;
  }
  cancelled.delete(momentUploadRuntimeKey(activeOwnerId, clientRequestId));
  clearRetryTimer(activeOwnerId, clientRequestId);
  await runJob({
    ...job,
    state: "queued",
    next_attempt_at: undefined,
    last_error: undefined,
  });
}

export async function cancelMomentUpload(clientRequestId: string): Promise<void> {
  const activeOwnerId = (await readCachedUser())?.user_id;
  if (!activeOwnerId) return;
  const job = await readJobById(clientRequestId, activeOwnerId);
  if (!job) return;
  const runtimeKey = momentUploadRuntimeKey(job.owner_id, clientRequestId);
  const wasInFlight = inFlight.has(runtimeKey);
  cancelled.add(runtimeKey);
  clearRetryTimer(job.owner_id, clientRequestId);
  cancelMomentBackgroundUpload(job.owner_id, clientRequestId);
  statuses.delete(statusKey(job.owner_id, clientRequestId));
  await removeJob(job);
  publishMomentMutation(job.owner_id, { kind: "delete", momentId: job.temp_moment.id });
  if (!wasInFlight) {
    cancelled.delete(runtimeKey);
    clearMomentBackgroundUploadCancellation(job.owner_id, clientRequestId);
  }
}

export async function reconcileMomentUploads(
  ownerId: string,
  moments: Moment[],
): Promise<Set<number>> {
  const jobs = await readJobs(ownerId);
  const reconciledTempMomentIds = new Set<number>();
  const claimedServerMomentIds = new Set<number>();
  for (const job of jobs) {
    if (inFlight.has(momentUploadRuntimeKey(job.owner_id, job.id))) continue;
    const confirmed = momentUploadConfirmationCandidate(job, moments, claimedServerMomentIds);
    if (!confirmed) continue;
    claimedServerMomentIds.add(confirmed.id);
    reconciledTempMomentIds.add(job.temp_moment.id);
    await adoptConfirmedMedia(job, confirmed);
    publishMomentMutation(job.owner_id, { kind: "delete", momentId: job.temp_moment.id });
    publishMomentMutation(job.owner_id, { kind: "created", moment: confirmed });
    statuses.delete(statusKey(job.owner_id, job.id));
    clearRetryTimer(job.owner_id, job.id);
    await removeJob(job);
  }
  return reconciledTempMomentIds;
}

export const momentUploadReconciliationPolicy = {
  fallbackWindowMilliseconds: 24 * 60 * 60 * 1_000,
} as const;

/**
 * Creation responses and feed rows do not always project client_request_id.
 * Prefer exact identities, then use a deliberately narrow, unique fingerprint
 * only for jobs whose request body was already fully submitted.
 */
export function momentUploadConfirmationCandidate(
  job: MomentUploadJob,
  moments: readonly Moment[],
  claimedServerMomentIds: ReadonlySet<number> = new Set<number>(),
): Moment | undefined {
  const candidates = moments.filter(
    (moment) =>
      moment.id > 0 &&
      moment.author.user_id.trim() === job.owner_id.trim() &&
      !claimedServerMomentIds.has(moment.id),
  );
  const byRequestId = candidates.find(
    (moment) => moment.client_request_id?.trim() === job.id.trim(),
  );
  if (byRequestId) return byRequestId;
  const byServerId = job.server_moment_id
    ? candidates.find((moment) => moment.id === job.server_moment_id)
    : undefined;
  if (byServerId) return byServerId;
  if (job.state !== "confirmation_unknown") return undefined;

  const fallbackCandidates = candidates.filter((moment) => {
    if (moment.client_request_id?.trim()) return false;
    if (moment.content.trim() !== job.content.trim()) return false;
    if ((moment.unlock_price_gold_coins ?? 0) !== (job.unlock_price_gold_coins ?? 0)) return false;
    if (moment.media.length !== job.media.length) return false;
    if (moment.media.some((item, index) => item.type !== job.media[index]?.kind)) return false;
    const localTime = Date.parse(job.temp_moment.created_at);
    const serverTime = Date.parse(moment.created_at);
    return (
      Number.isFinite(localTime) &&
      Number.isFinite(serverTime) &&
      Math.abs(serverTime - localTime) <=
        momentUploadReconciliationPolicy.fallbackWindowMilliseconds
    );
  });
  return fallbackCandidates.length === 1 ? fallbackCandidates[0] : undefined;
}

export function momentUploadStatus(
  ownerId: string,
  clientRequestId: string,
): MomentUploadStatus | undefined {
  return statuses.get(statusKey(ownerId, clientRequestId));
}

export function subscribeMomentUploads(ownerId: string, listener: Listener): () => void {
  const owner = ownerId.trim();
  if (!owner) return () => undefined;
  const listeners = listenersByOwner.get(owner) ?? new Set<Listener>();
  listeners.add(listener);
  listenersByOwner.set(owner, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByOwner.delete(owner);
  };
}

export function createOptimisticMoment(input: {
  owner: Pick<User, "user_id" | "nickname" | "avatar_url">;
  clientRequestId: string;
  content: string;
  media: MomentUploadAsset[];
  unlockPriceGoldCoins?: number | undefined;
  createdAt?: string | undefined;
}): Moment {
  const media = input.media.map((asset, index) => ({
    id: `${input.clientRequestId}-${index}-${asset.uri}`,
    type: asset.kind,
    url: asset.uri,
    thumbnail_url: asset.preview_uri ?? asset.uri,
    is_locked: false,
  }));
  return {
    id: temporaryMomentId(input.clientRequestId),
    author: {
      user_id: input.owner.user_id,
      nickname: input.owner.nickname,
      avatar_url: input.owner.avatar_url,
    },
    content: input.content,
    images: media.filter((item) => item.type === "image").map((item) => item.url),
    media,
    ...(media.length > 0 && input.unlockPriceGoldCoins
      ? { unlock_price_gold_coins: input.unlockPriceGoldCoins }
      : {}),
    is_unlocked: true,
    created_at: input.createdAt ?? new Date().toISOString(),
    likes: [],
    comments: [],
    liked_by_me: false,
    client_request_id: input.clientRequestId,
  };
}

export function temporaryMomentId(clientRequestId: string): number {
  const prefix = clientRequestId.replaceAll("-", "").slice(0, 12);
  const parsed = Number.parseInt(prefix, 16);
  return -Math.max(Number.isFinite(parsed) ? parsed : 1, 1);
}

export function restoredMomentUploadState(state: MomentUploadState): MomentUploadState {
  if (state === "preparing") return "queued";
  if (state === "uploading" || state === "committing") return "confirmation_unknown";
  return state;
}

export function momentUploadOwnerChangedPatch(
  previousAttemptCount: number,
): Pick<
  MomentUploadJob,
  "state" | "attempt_count" | "uploaded_bytes" | "expected_bytes" | "last_error"
> {
  return {
    state: "queued",
    attempt_count: previousAttemptCount,
    uploaded_bytes: undefined,
    expected_bytes: undefined,
    last_error: undefined,
  };
}

export function momentUploadRuntimeKey(ownerId: string, clientRequestId: string): string {
  return `${ownerId.trim()}\u0000${clientRequestId}`;
}

export function momentRetryDelayMilliseconds(attemptCount: number): number {
  return Math.min(2 ** Math.max(attemptCount, 0), 30) * 1_000;
}

async function runJob(job: MomentUploadJob): Promise<void> {
  const runtimeKey = momentUploadRuntimeKey(job.owner_id, job.id);
  if (
    inFlight.has(runtimeKey) ||
    job.state === "failed" ||
    job.state === "confirmation_unknown" ||
    job.state === "cancelled"
  ) {
    return;
  }
  inFlight.add(runtimeKey);
  const preparing: MomentUploadJob = {
    ...job,
    state: "preparing",
    attempt_count: job.attempt_count + 1,
    uploaded_bytes: 0,
    expected_bytes: undefined,
    next_attempt_at: undefined,
    last_error: undefined,
  };
  await saveAndEmit(preparing);
  let activeJob = preparing;
  let shouldResumeAfterOwnerChange = false;
  try {
    const confirmed = await uploadMomentInBackground(
      {
        clientRequestId: preparing.id,
        ownerId: preparing.owner_id,
        content: preparing.content,
        media: preparing.media,
        ...(preparing.unlock_price_gold_coins
          ? { unlockPriceGoldCoins: preparing.unlock_price_gold_coins }
          : {}),
      },
      {
        onPrepared: async (bodyBytes) => {
          activeJob = {
            ...activeJob,
            state: "uploading",
            expected_bytes: bodyBytes,
          };
          await saveAndEmit(activeJob);
        },
        onProgress: (progress) => {
          activeJob = {
            ...activeJob,
            state: "uploading",
            uploaded_bytes: progress.bytesSent,
            expected_bytes: progress.totalBytes,
          };
          emit(activeJob);
        },
      },
    );
    if (cancelled.has(runtimeKey)) {
      await deleteMoment(confirmed.id).catch(() => undefined);
      cancelled.delete(runtimeKey);
      await removeJob(preparing);
      return;
    }
    activeJob = { ...activeJob, state: "committing" };
    await saveAndEmit(activeJob);
    await adoptConfirmedMedia(preparing, confirmed);
    if (await isActiveOwner(preparing.owner_id)) {
      publishMomentMutation(preparing.owner_id, {
        kind: "delete",
        momentId: preparing.temp_moment.id,
      });
      publishMomentMutation(preparing.owner_id, { kind: "created", moment: confirmed });
    }
    statuses.delete(statusKey(preparing.owner_id, preparing.id));
    await removeJob(preparing);
  } catch (error) {
    if (cancelled.has(runtimeKey)) {
      cancelled.delete(runtimeKey);
      await removeJob(preparing);
      return;
    }
    const message = errorMessage(error);
    if (error instanceof MomentUploadOwnerChangedError) {
      await saveAndEmit({
        ...activeJob,
        ...momentUploadOwnerChangedPatch(job.attempt_count),
      });
      shouldResumeAfterOwnerChange = true;
    } else if (error instanceof MomentUploadConfirmationUnknownError) {
      await saveAndEmit({
        ...activeJob,
        state: "confirmation_unknown",
        ...(error.serverMomentId ? { server_moment_id: error.serverMomentId } : {}),
        last_error: message,
      });
    } else if (isTransient(error) && preparing.attempt_count < 5) {
      const delay = momentRetryDelayMilliseconds(preparing.attempt_count);
      const waiting: MomentUploadJob = {
        ...activeJob,
        state: "retry_waiting",
        next_attempt_at: Date.now() + delay,
        last_error: message,
      };
      await saveAndEmit(waiting);
      scheduleRetry(waiting, delay);
    } else {
      await saveAndEmit({ ...activeJob, state: "failed", last_error: message });
    }
  } finally {
    inFlight.delete(runtimeKey);
    clearMomentBackgroundUploadCancellation(preparing.owner_id, preparing.id);
    if (shouldResumeAfterOwnerChange) {
      void resumeParkedOwnerJob(preparing.owner_id, preparing.id);
    }
  }
}

async function resumeParkedOwnerJob(ownerId: string, clientRequestId: string): Promise<void> {
  if (!(await isActiveOwner(ownerId))) return;
  const latest = await readJobById(clientRequestId, ownerId);
  if (latest?.state === "queued") await runJob(latest);
}

async function runJobAtScheduledTime(job: MomentUploadJob): Promise<void> {
  const delay = Math.max((job.next_attempt_at ?? 0) - Date.now(), 0);
  if (delay <= 0) return runJob({ ...job, state: "queued" });
  return new Promise((resolve) => {
    const runtimeKey = momentUploadRuntimeKey(job.owner_id, job.id);
    clearRetryTimer(job.owner_id, job.id);
    const timer = setTimeout(() => {
      retryTimers.delete(runtimeKey);
      void runJob({ ...job, state: "queued" }).finally(resolve);
    }, delay);
    retryTimers.set(runtimeKey, timer);
  });
}

function scheduleRetry(job: MomentUploadJob, delay: number): void {
  const runtimeKey = momentUploadRuntimeKey(job.owner_id, job.id);
  clearRetryTimer(job.owner_id, job.id);
  const timer = setTimeout(() => {
    retryTimers.delete(runtimeKey);
    void runJob({ ...job, state: "queued" });
  }, delay);
  retryTimers.set(runtimeKey, timer);
}

async function stageMomentMedia(
  ownerId: string,
  clientRequestId: string,
  media: MomentUploadAsset[],
): Promise<MomentUploadAsset[]> {
  if (media.length === 0) return [];
  const directory = jobDirectory(ownerId, clientRequestId);
  directory.create({ intermediates: true, idempotent: true });
  const durable: MomentUploadAsset[] = [];
  for (const [index, asset] of media.entries()) {
    const source = new File(asset.uri);
    if (!source.exists) throw new Error("待上传媒体文件不存在");
    const destination = asset.uri.startsWith(`${directory.uri}/`)
      ? source
      : new File(directory, `${index}-${safeFilename(asset.filename)}`);
    if (destination.uri !== source.uri) await source.copy(destination, { overwrite: true });
    let previewUri = asset.preview_uri;
    if (previewUri) {
      const previewSource = new File(previewUri);
      if (previewSource.exists && !previewUri.startsWith(`${directory.uri}/`)) {
        const preview = new File(directory, `preview-${index}.jpg`);
        await previewSource.copy(preview, { overwrite: true });
        previewUri = preview.uri;
      }
    }
    durable.push({
      ...asset,
      uri: destination.uri,
      ...(previewUri ? { preview_uri: previewUri } : {}),
    });
  }
  return durable;
}

async function adoptConfirmedMedia(job: MomentUploadJob, confirmed: Moment): Promise<void> {
  for (const [index, local] of job.media.entries()) {
    const remote = confirmed.media[index];
    if (!remote) continue;
    if (local.kind === "image") {
      const keys = [remote.url, remote.thumbnail_url ?? ""]
        .flatMap((value) => [value, resolveMediaUrl(value, env.apiBaseUrl) ?? ""])
        .filter(Boolean);
      await adoptLocalImageFile(local.uri, keys);
      continue;
    }
    if (remote.url.trim()) {
      await adoptLocalMediaFile({
        ownerId: job.owner_id,
        mediaId: chatVideoMediaCacheId(remote.url),
        remoteUrl: remote.url,
        sourceUri: local.uri,
      });
    }
    const thumbnail = remote.thumbnail_url?.trim();
    if (local.preview_uri && thumbnail) {
      await adoptLocalImageFile(local.preview_uri, [
        thumbnail,
        resolveMediaUrl(thumbnail, env.apiBaseUrl) ?? "",
      ]);
    }
  }
}

async function readJobs(ownerId: string): Promise<MomentUploadJob[]> {
  const keys = await AsyncStorage.getAllKeys();
  const prefix = `${storagePrefix}:${encodeURIComponent(ownerId)}:`;
  const entries = await AsyncStorage.multiGet(keys.filter((key) => key.startsWith(prefix)));
  return entries.flatMap(([, encoded]) => decodeJob(encoded, ownerId));
}

async function readJobById(
  clientRequestId: string,
  ownerId: string,
): Promise<MomentUploadJob | null> {
  const encoded = await AsyncStorage.getItem(jobKey(ownerId, clientRequestId));
  return decodeJob(encoded, ownerId)[0] ?? null;
}

function decodeJob(encoded: string | null, ownerId: string): MomentUploadJob[] {
  if (!encoded) return [];
  try {
    const decoded = JSON.parse(encoded) as MomentUploadJob;
    if (!decoded.id || decoded.owner_id !== ownerId) return [];
    return [
      {
        ...decoded,
        state: decoded.state,
        upload_timeout_ms:
          decoded.upload_timeout_ms ??
          (decoded.media.some((item) => item.kind === "video") ? 600_000 : 180_000),
      },
    ];
  } catch {
    return [];
  }
}

async function saveJob(job: MomentUploadJob): Promise<void> {
  await AsyncStorage.setItem(jobKey(job.owner_id, job.id), JSON.stringify(job));
}

async function saveAndEmit(job: MomentUploadJob): Promise<void> {
  await saveJob(job);
  emit(job);
}

async function removeJob(job: MomentUploadJob): Promise<void> {
  await AsyncStorage.removeItem(jobKey(job.owner_id, job.id));
  const directory = jobDirectory(job.owner_id, job.id);
  try {
    if (directory.exists) directory.delete();
  } catch {
    // A just-cancelled native background task can briefly retain the body file.
  }
}

function emit(job: MomentUploadJob): void {
  const status: MomentUploadStatus = {
    clientRequestId: job.id,
    tempMomentId: job.temp_moment.id,
    state: job.state,
    attemptCount: job.attempt_count,
    ...(job.uploaded_bytes !== undefined ? { uploadedBytes: job.uploaded_bytes } : {}),
    ...(job.expected_bytes !== undefined ? { expectedBytes: job.expected_bytes } : {}),
    ...(job.last_error ? { error: job.last_error } : {}),
  };
  statuses.set(statusKey(job.owner_id, job.id), status);
  for (const listener of listenersByOwner.get(job.owner_id.trim()) ?? []) listener(status);
}

function statusKey(ownerId: string, clientRequestId: string): string {
  return `${ownerId.trim()}\u0000${clientRequestId}`;
}

function jobKey(ownerId: string, clientRequestId: string): string {
  return `${storagePrefix}:${encodeURIComponent(ownerId)}:${clientRequestId}`;
}

function jobDirectory(ownerId: string, clientRequestId: string): Directory {
  return new Directory(
    Paths.document,
    "bwchat-outbox",
    "moments",
    encodeURIComponent(ownerId),
    clientRequestId,
  );
}

function safeFilename(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "media.bin";
}

function validateMomentMedia(media: MomentUploadAsset[]): void {
  const imageCount = media.filter((item) => item.kind === "image").length;
  const videoCount = media.filter((item) => item.kind === "video").length;
  if (imageCount > 0 && videoCount > 0) throw new Error("不能同时包含图片和视频");
  if (imageCount > 9) throw new Error("最多只能选择 9 张图片");
  if (videoCount > 1) throw new Error("最多只能选择 1 个视频");
}

function isTransient(error: unknown): boolean {
  return (
    !(error instanceof APIError) ||
    error.status === 0 ||
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500
  );
}

async function isActiveOwner(ownerId: string): Promise<boolean> {
  return (await readCachedUser())?.user_id === ownerId;
}

function clearRetryTimer(ownerId: string, clientRequestId: string): void {
  const runtimeKey = momentUploadRuntimeKey(ownerId, clientRequestId);
  const timer = retryTimers.get(runtimeKey);
  if (timer) clearTimeout(timer);
  retryTimers.delete(runtimeKey);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "发布失败，请重试";
}
