import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  createShortDramaSeries,
  submitShortDramaSeries,
  updateShortDramaEpisode,
  updateShortDramaSeries,
} from "@/api/bwchat";
import { env } from "@/config/env";
import type { ShortDramaCreator, ShortDramaSeries } from "@/models";
import { adoptLocalImageFile } from "@/services/cache/ImageCacheService";
import { adoptLocalMediaFile } from "@/services/cache/MediaCacheService";
import {
  isTransientShortDramaUploadError,
  ShortDramaUploadConfirmationUnknownError,
  ShortDramaUploadOwnerChangedError,
  shortDramaUploadRetryDelayMilliseconds,
  uploadShortDramaEpisodeDurably,
} from "@/services/short-drama/ShortDramaBackgroundUpload";
import {
  removeShortDramaLocalFile,
  shortDramaDraftDirectory,
  shortDramaEpisodeCoverFilename,
  shortDramaEpisodeVideoFilename,
} from "@/services/short-drama/ShortDramaMediaService";
import { publishShortDramaLibraryEvent } from "@/services/short-drama/ShortDramaLibraryStore";
import { shortDramaStreamingUrl } from "@/services/short-drama/shortDramaFeedPolicy";
import {
  shortDramaEditorMetrics,
  shortDramaLocalSeriesProjection,
  type ShortDramaEditorDraft,
  type ShortDramaEpisodeDraft,
} from "@/services/short-drama/shortDramaEditorPolicy";
import { shortDramaMediaCacheId } from "@/services/short-drama/ShortDramaPlaybackSource";
import { readCachedUser } from "@/storage/authStorage";
import { resolveMediaUrl } from "@/utils/mediaUrl";
import {
  cancelNativeShortDramaUploadJob,
  removeNativeShortDramaUploadJob,
  type NativeShortDramaUploadRecord,
  type NativeShortDramaUploadState,
} from "../../../modules/bwchat-background-upload/src";

export type ShortDramaUploadJobState =
  | "queued"
  | "preparing"
  | "uploading"
  | "committing"
  | "retry_waiting"
  | "confirmation_unknown"
  | "failed_permanent"
  | "cancelled";

export interface ShortDramaNativeUploadSnapshot {
  id: string;
  episode_id: string;
  generation: number;
  state: NativeShortDramaUploadState;
  task_identifier?: number | undefined;
  uploaded_bytes: number;
  expected_bytes: number;
  http_status?: number | undefined;
  last_error_code?: string | undefined;
}

export interface ShortDramaUploadJob {
  id: string;
  owner_id: string;
  creator: ShortDramaCreator;
  draft: ShortDramaEditorDraft;
  state: ShortDramaUploadJobState;
  created_at: string;
  updated_at: string;
  attempt_count: number;
  generation: number;
  server_id?: string | undefined;
  next_attempt_at?: number | undefined;
  last_error?: string | undefined;
  native_tasks?: Record<string, ShortDramaNativeUploadSnapshot> | undefined;
}

export type ShortDramaUploadEvent =
  | { kind: "updated"; job: ShortDramaUploadJob }
  | { kind: "saved"; job: ShortDramaUploadJob; series: ShortDramaSeries }
  | { kind: "submitted"; job: ShortDramaUploadJob; series: ShortDramaSeries };

type Listener = (event: ShortDramaUploadEvent) => void;

const storagePrefix = "bwchat.short-drama-outbox.v1";
const maximumAutomaticAttempts = 5;
const listeners = new Set<Listener>();
const activeRunGenerations = new Map<string, number>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function enqueueShortDramaPublish(input: {
  ownerId: string;
  creator: ShortDramaCreator;
  draft: ShortDramaEditorDraft;
  createdAt?: string | undefined;
}): Promise<ShortDramaSeries> {
  const now = input.createdAt ?? new Date().toISOString();
  const job: ShortDramaUploadJob = {
    id: input.draft.draft_id,
    owner_id: input.ownerId,
    creator: input.creator,
    draft: cloneDraft(input.draft),
    state: "queued",
    created_at: now,
    updated_at: now,
    attempt_count: 0,
    generation: 0,
    ...(input.draft.source_series?.series_id
      ? { server_id: input.draft.source_series.series_id }
      : {}),
  };
  await saveJob(job);
  emit({ kind: "updated", job });
  const projection = shortDramaLocalSeriesProjection(job.draft, input.creator, now);
  publishShortDramaLibraryEvent({ kind: "upsert", owner_id: job.owner_id, series: projection });
  void runShortDramaUpload(job);
  return projection;
}

export async function readShortDramaUploadJobs(ownerId: string): Promise<ShortDramaUploadJob[]> {
  const prefix = `${storagePrefix}:${encodeURIComponent(ownerId)}:`;
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  const entries = await AsyncStorage.multiGet(keys);
  return entries
    .flatMap(([, value]) => decodeJob(value, ownerId))
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export async function readShortDramaUploadJob(
  ownerId: string,
  jobId: string,
): Promise<ShortDramaUploadJob | null> {
  const value = await AsyncStorage.getItem(jobKey(ownerId, jobId));
  return decodeJob(value, ownerId)[0] ?? null;
}

export async function retryShortDramaUpload(ownerId: string, jobId: string): Promise<boolean> {
  const job = await readShortDramaUploadJob(ownerId, jobId);
  const identity = job ? jobIdentity(job) : "";
  if (!job || activeRunGenerations.has(identity)) return false;
  clearRetryTimer(identity);
  const queued: ShortDramaUploadJob = {
    ...job,
    state: "queued",
    next_attempt_at: undefined,
    last_error: undefined,
    updated_at: new Date().toISOString(),
  };
  await saveAndEmit(queued);
  void runShortDramaUpload(queued);
  return true;
}

export async function cancelShortDramaUpload(ownerId: string, jobId: string): Promise<boolean> {
  const job = await readShortDramaUploadJob(ownerId, jobId);
  if (!job) return false;
  const identity = jobIdentity(job);
  clearRetryTimer(identity);
  activeRunGenerations.set(identity, (activeRunGenerations.get(identity) ?? 0) + 1);
  const cancelled: ShortDramaUploadJob = {
    ...job,
    state: "cancelled",
    last_error: undefined,
    updated_at: new Date().toISOString(),
  };
  await saveAndEmit(cancelled);
  await cancelNativeShortDramaUploadJob(ownerId, jobId);
  await removeJob(cancelled);
  activeRunGenerations.delete(identity);
  return true;
}

export async function resumeShortDramaUploads(
  ownerId: string,
  options: { awaitCompletion?: boolean } = {},
): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const persisted of await readShortDramaUploadJobs(ownerId)) {
    emit({ kind: "updated", job: persisted });
    if (persisted.state === "failed_permanent" || persisted.state === "cancelled") continue;
    if (persisted.attempt_count >= maximumAutomaticAttempts) {
      const failed = {
        ...persisted,
        state: "failed_permanent" as const,
        next_attempt_at: undefined,
        last_error: persisted.last_error || "已达到自动重试上限",
        updated_at: new Date().toISOString(),
      };
      await saveAndEmit(failed);
      continue;
    }
    const task = runShortDramaUploadAtScheduledTime(persisted);
    if (options.awaitCompletion) tasks.push(task);
    else void task;
  }
  if (tasks.length > 0) await Promise.allSettled(tasks);
}

export function subscribeShortDramaUploads(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function shortDramaUploadRuntimeKey(ownerId: string, jobId: string): string {
  return `${ownerId.trim()}\u0000${jobId}`;
}

async function runShortDramaUpload(input: ShortDramaUploadJob): Promise<void> {
  const identity = jobIdentity(input);
  if (
    activeRunGenerations.has(identity) ||
    input.state === "failed_permanent" ||
    input.state === "cancelled"
  ) {
    return;
  }
  clearRetryTimer(identity);
  const runGeneration = (activeRunGenerations.get(identity) ?? 0) + 1;
  activeRunGenerations.set(identity, runGeneration);
  let job: ShortDramaUploadJob = {
    ...input,
    state: "preparing",
    attempt_count: input.attempt_count + 1,
    generation: input.generation + 1,
    next_attempt_at: undefined,
    last_error: undefined,
    updated_at: new Date().toISOString(),
  };
  await saveAndEmit(job);
  try {
    assertCurrentRun(identity, runGeneration);
    assertActiveOwner(job.owner_id, (await readCachedUser())?.user_id);
    const series = await saveSeriesMetadata(job);
    assertCurrentRun(identity, runGeneration);
    job = {
      ...job,
      server_id: series.series_id,
      draft: { ...job.draft, source_series: series },
      updated_at: new Date().toISOString(),
    };
    await adoptSeriesCover(job, series);
    await saveJob(job);
    emit({ kind: "saved", job, series });
    publishShortDramaLibraryEvent({ kind: "upsert", owner_id: job.owner_id, series });

    const uploadErrors: unknown[] = [];
    for (let index = 0; index < job.draft.episodes.length; index += 1) {
      const episode = job.draft.episodes[index]!;
      if (!episode.server_video || !episode.is_dirty) continue;
      try {
        const updated = await updateShortDramaEpisode(episode.server_video.id, {
          title: episode.title,
          intro: episode.intro,
          episodeNumber: episode.episode_number,
          unlockPriceGoldCoins: episode.unlock_price_gold_coins,
        });
        assertCurrentRun(identity, runGeneration);
        job = replaceEpisode(job, index, {
          ...episode,
          server_video: updated,
          upload_state: "uploaded",
          is_dirty: false,
        });
      } catch (error) {
        uploadErrors.push(error);
        job = replaceEpisode(job, index, { ...episode, upload_state: "failed" });
      }
      await saveAndEmit(job);
    }

    const draftIndices = job.draft.episodes.flatMap((episode, index) =>
      episode.server_video ? [] : [index],
    );
    for (
      let start = 0;
      start < draftIndices.length;
      start += shortDramaEditorMetrics.maximumConcurrentEpisodeUploads
    ) {
      const chunk = draftIndices.slice(
        start,
        start + shortDramaEditorMetrics.maximumConcurrentEpisodeUploads,
      );
      job = {
        ...job,
        state: "uploading",
        draft: {
          ...job.draft,
          episodes: job.draft.episodes.map((episode, index) =>
            chunk.includes(index) ? { ...episode, upload_state: "uploading" } : episode,
          ),
        },
      };
      await saveAndEmit(job);
      const results = await Promise.all(
        chunk.map(async (index) => {
          const episode = job.draft.episodes[index]!;
          try {
            return {
              index,
              episode: await uploadNewEpisode(job, episode, async (record) => {
                assertCurrentRun(identity, runGeneration);
                job = withNativeTask(job, record);
                await saveAndEmit(job);
              }),
            };
          } catch (error) {
            return { index, episode: { ...episode, upload_state: "failed" as const }, error };
          }
        }),
      );
      assertCurrentRun(identity, runGeneration);
      for (const result of results) {
        if (result.error) uploadErrors.push(result.error);
        job = replaceEpisode(job, result.index, result.episode);
      }
      await saveAndEmit(job);
    }

    if (uploadErrors.length > 0) throw preferredUploadError(uploadErrors);
    job = { ...job, state: "committing", updated_at: new Date().toISOString() };
    await saveAndEmit(job);
    const submitted = await submitShortDramaSeries(series.series_id, job.id);
    assertCurrentRun(identity, runGeneration);
    await removeJob(job);
    emit({ kind: "submitted", job, series: submitted });
    publishShortDramaLibraryEvent({ kind: "upsert", owner_id: job.owner_id, series: submitted });
  } catch (error) {
    if (!isCurrentRun(identity, runGeneration)) return;
    const message = readableError(error);
    if (error instanceof ShortDramaUploadOwnerChangedError) {
      await saveAndEmit({
        ...job,
        state: "queued",
        attempt_count: input.attempt_count,
        next_attempt_at: undefined,
        last_error: undefined,
        updated_at: new Date().toISOString(),
      });
    } else if (error instanceof ShortDramaUploadConfirmationUnknownError) {
      const confirmationUnknown = {
        ...job,
        state: "confirmation_unknown" as const,
        last_error: message,
        updated_at: new Date().toISOString(),
      };
      await saveAndEmit(confirmationUnknown);
      if (confirmationUnknown.attempt_count < maximumAutomaticAttempts) {
        scheduleRetry(confirmationUnknown);
      }
    } else if (
      isTransientShortDramaUploadError(error) &&
      job.attempt_count < maximumAutomaticAttempts
    ) {
      const delay = shortDramaUploadRetryDelayMilliseconds(job.attempt_count);
      const waiting = {
        ...job,
        state: "retry_waiting" as const,
        next_attempt_at: Date.now() + delay,
        last_error: message,
        updated_at: new Date().toISOString(),
      };
      await saveAndEmit(waiting);
      scheduleRetry(waiting);
    } else {
      await saveAndEmit({
        ...job,
        state: "failed_permanent",
        next_attempt_at: undefined,
        last_error: message,
        updated_at: new Date().toISOString(),
      });
    }
  } finally {
    if (isCurrentRun(identity, runGeneration)) activeRunGenerations.delete(identity);
  }
}

async function saveSeriesMetadata(job: ShortDramaUploadJob): Promise<ShortDramaSeries> {
  const title = job.draft.title.trim();
  const intro = job.draft.intro.trim();
  const seriesId = job.server_id ?? job.draft.source_series?.series_id;
  if (seriesId) {
    return updateShortDramaSeries(seriesId, {
      title,
      intro,
      ...(job.draft.cover_uri
        ? {
            coverUri: job.draft.cover_uri,
            coverFilename: shortDramaCoverFilenameFromUri(job.draft.cover_uri),
          }
        : {}),
    });
  }
  if (!job.draft.cover_uri) throw new Error("请选择封面");
  return createShortDramaSeries({
    title,
    intro,
    coverUri: job.draft.cover_uri,
    coverFilename: shortDramaCoverFilenameFromUri(job.draft.cover_uri),
  });
}

async function uploadNewEpisode(
  job: ShortDramaUploadJob,
  episode: ShortDramaEpisodeDraft,
  onRecord: (record: NativeShortDramaUploadRecord) => void | Promise<void>,
): Promise<ShortDramaEpisodeDraft> {
  if (!job.server_id || !episode.local_video_uri || !episode.preview_uri) {
    throw new Error("无法生成视频封面");
  }
  const result = await uploadShortDramaEpisodeDurably(
    {
      ownerId: job.owner_id,
      jobId: job.id,
      generation: job.generation,
      seriesId: job.server_id,
      episodeId: episode.id,
      title: episode.title,
      intro: episode.intro,
      episodeNumber: episode.episode_number,
      unlockPriceGoldCoins: episode.unlock_price_gold_coins,
      videoUri: episode.local_video_uri,
      videoFilename:
        episode.local_video_filename ?? shortDramaEpisodeVideoFilename(episode.local_video_uri),
      videoMimeType: episode.local_video_mime_type ?? "video/mp4",
      coverUri: episode.preview_uri,
      coverFilename: shortDramaEpisodeCoverFilename(),
    },
    { onRecord },
  );
  if (result.video) {
    await adoptConfirmedEpisodeMedia(job.owner_id, episode, result.video);
  }
  removeShortDramaLocalFile(episode.local_video_uri);
  return {
    ...episode,
    local_video_uri: undefined,
    ...(result.video ? { server_video: result.video } : {}),
    upload_state: "uploaded",
    is_dirty: false,
  };
}

async function adoptSeriesCover(job: ShortDramaUploadJob, series: ShortDramaSeries): Promise<void> {
  if (!job.draft.cover_uri || !series.cover_url.trim()) return;
  const keys = [series.cover_url, resolveMediaUrl(series.cover_url, env.apiBaseUrl) ?? ""].filter(
    Boolean,
  );
  await adoptLocalImageFile(job.draft.cover_uri, keys);
}

async function adoptConfirmedEpisodeMedia(
  ownerId: string,
  episode: ShortDramaEpisodeDraft,
  video: NonNullable<ShortDramaEpisodeDraft["server_video"]>,
): Promise<void> {
  if (episode.preview_uri && video.cover_url.trim()) {
    await adoptLocalImageFile(episode.preview_uri, [
      video.cover_url,
      resolveMediaUrl(video.cover_url, env.apiBaseUrl) ?? "",
    ]);
  }
  if (episode.local_video_uri) {
    const remoteUrl = shortDramaStreamingUrl(video);
    await adoptLocalMediaFile({
      ownerId,
      mediaId: shortDramaMediaCacheId(video.id),
      remoteUrl,
      sourceUri: episode.local_video_uri,
    });
  }
}

function withNativeTask(
  job: ShortDramaUploadJob,
  record: NativeShortDramaUploadRecord,
): ShortDramaUploadJob {
  return {
    ...job,
    state:
      record.state === "preparing"
        ? "preparing"
        : record.state === "uploading"
          ? "uploading"
          : job.state,
    native_tasks: {
      ...job.native_tasks,
      [record.episode_id]: {
        id: record.id,
        episode_id: record.episode_id,
        generation: record.generation,
        state: record.state,
        uploaded_bytes: record.uploaded_bytes,
        expected_bytes: record.expected_bytes,
        ...(record.task_identifier !== undefined
          ? { task_identifier: record.task_identifier }
          : {}),
        ...(record.http_status !== undefined ? { http_status: record.http_status } : {}),
        ...(record.last_error_code ? { last_error_code: record.last_error_code } : {}),
      },
    },
    updated_at: new Date().toISOString(),
  };
}

function replaceEpisode(
  job: ShortDramaUploadJob,
  index: number,
  episode: ShortDramaEpisodeDraft,
): ShortDramaUploadJob {
  const episodes = [...job.draft.episodes];
  episodes[index] = episode;
  return {
    ...job,
    draft: { ...job.draft, episodes },
    updated_at: new Date().toISOString(),
  };
}

async function saveAndEmit(job: ShortDramaUploadJob): Promise<void> {
  await saveJob(job);
  emit({ kind: "updated", job });
}

async function saveJob(job: ShortDramaUploadJob): Promise<void> {
  await AsyncStorage.setItem(jobKey(job.owner_id, job.id), JSON.stringify(job));
}

async function removeJob(job: ShortDramaUploadJob): Promise<void> {
  clearRetryTimer(jobIdentity(job));
  await removeNativeShortDramaUploadJob(job.owner_id, job.id).catch(() => undefined);
  await AsyncStorage.removeItem(jobKey(job.owner_id, job.id));
  const directory = shortDramaDraftDirectory(job.owner_id, job.id);
  if (directory.exists) {
    try {
      directory.delete();
    } catch {
      // Account-level cache cleanup can remove an orphaned directory later.
    }
  }
}

function decodeJob(value: string | null, ownerId: string): ShortDramaUploadJob[] {
  if (!value) return [];
  try {
    const raw = JSON.parse(value) as Partial<Omit<ShortDramaUploadJob, "state">> & {
      state?: string;
    };
    if (!raw.id || raw.owner_id !== ownerId || raw.draft?.draft_id !== raw.id) return [];
    const state = raw.state === "failed" ? "failed_permanent" : raw.state;
    if (!state || !isUploadJobState(state)) return [];
    return [
      {
        ...(raw as ShortDramaUploadJob),
        state,
        generation: finiteInteger(raw.generation),
        attempt_count: finiteInteger(raw.attempt_count),
      },
    ];
  } catch {
    return [];
  }
}

function cloneDraft(draft: ShortDramaEditorDraft): ShortDramaEditorDraft {
  return JSON.parse(JSON.stringify(draft)) as ShortDramaEditorDraft;
}

function emit(event: ShortDramaUploadEvent): void {
  for (const listener of listeners) listener(event);
}

function jobKey(ownerId: string, jobId: string): string {
  return `${storagePrefix}:${encodeURIComponent(ownerId)}:${jobId}`;
}

function jobIdentity(job: Pick<ShortDramaUploadJob, "owner_id" | "id">): string {
  return shortDramaUploadRuntimeKey(job.owner_id, job.id);
}

function shortDramaCoverFilenameFromUri(uri: string): string {
  return uri.split("/").at(-1)?.split("?")[0] || "short_drama_cover.jpg";
}

function readableError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "发布失败，请重试";
}

function preferredUploadError(errors: unknown[]): unknown {
  return (
    errors.find((error) => error instanceof ShortDramaUploadConfirmationUnknownError) ??
    errors.find(isTransientShortDramaUploadError) ??
    new Error("one-or-more-episodes-failed")
  );
}

function assertActiveOwner(ownerId: string, activeOwnerId: string | null | undefined): void {
  if (!ownerId.trim() || ownerId.trim() !== activeOwnerId?.trim()) {
    throw new ShortDramaUploadOwnerChangedError();
  }
}

function scheduleRetry(job: ShortDramaUploadJob): void {
  const identity = jobIdentity(job);
  clearRetryTimer(identity);
  const delay = Math.max(
    (job.next_attempt_at ??
      Date.now() + shortDramaUploadRetryDelayMilliseconds(job.attempt_count)) - Date.now(),
    0,
  );
  const timer = setTimeout(() => {
    retryTimers.delete(identity);
    void runShortDramaUpload({ ...job, state: "queued" });
  }, delay);
  retryTimers.set(identity, timer);
}

async function runShortDramaUploadAtScheduledTime(job: ShortDramaUploadJob): Promise<void> {
  const delay = Math.max((job.next_attempt_at ?? 0) - Date.now(), 0);
  if (delay <= 0) return runShortDramaUpload({ ...job, state: "queued" });
  return new Promise((resolve) => {
    const identity = jobIdentity(job);
    clearRetryTimer(identity);
    const timer = setTimeout(() => {
      retryTimers.delete(identity);
      void runShortDramaUpload({ ...job, state: "queued" }).finally(resolve);
    }, delay);
    retryTimers.set(identity, timer);
  });
}

function clearRetryTimer(identity: string): void {
  const timer = retryTimers.get(identity);
  if (timer) clearTimeout(timer);
  retryTimers.delete(identity);
}

function assertCurrentRun(identity: string, generation: number): void {
  if (!isCurrentRun(identity, generation)) throw new Error("stale-short-drama-upload-generation");
}

function isCurrentRun(identity: string, generation: number): boolean {
  return activeRunGenerations.get(identity) === generation;
}

function isUploadJobState(value: string): value is ShortDramaUploadJobState {
  return [
    "queued",
    "preparing",
    "uploading",
    "committing",
    "retry_waiting",
    "confirmation_unknown",
    "failed_permanent",
    "cancelled",
  ].includes(value);
}

function finiteInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(Math.trunc(value), 0) : 0;
}
