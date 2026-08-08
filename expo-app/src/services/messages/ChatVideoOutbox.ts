import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";

import { sendDirectVideoMessage, sendGroupVideoMessage } from "@/api/bwchat";
import { APIError } from "@/api/client";
import { env } from "@/config/env";
import type { GroupMessage, Message, User } from "@/models";
import { adoptLocalImageFile } from "@/services/cache/ImageCacheService";
import { temporaryChatImageId } from "@/services/messages/ChatImageOutbox";
import { prepareChatVideo, type PreparedChatVideo } from "@/services/messages/ChatVideoService";
import { adoptLocalMediaFile, chatVideoMediaCacheId } from "@/services/cache/MediaCacheService";
import { chatVideoThumbnailPath } from "@/services/messages/chatVideoPolicy";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export type ChatVideoUploadState =
  "staging" | "queued" | "preparing" | "uploading" | "retry_waiting" | "failed";

export interface ChatVideoSource {
  uri: string;
  width: number;
  height: number;
  filename: string;
  mime_type?: string | undefined;
}

interface ChatVideoJobBase {
  id: string;
  owner_id: string;
  target_id: string;
  sender_nickname: string;
  sender_avatar: string;
  source: ChatVideoSource;
  durable_video_uri?: string | undefined;
  prepared?: PreparedChatVideo | undefined;
  created_at: string;
  state: ChatVideoUploadState;
  attempt_count: number;
  next_attempt_at?: string | undefined;
  last_error?: string | undefined;
}

export interface DirectChatVideoJob extends ChatVideoJobBase {
  scope: "direct";
}

export interface GroupChatVideoJob extends ChatVideoJobBase {
  scope: "group";
}

export type ChatVideoJob = DirectChatVideoJob | GroupChatVideoJob;

export type ChatVideoOutboxEvent =
  | { kind: "updated"; scope: "direct"; job: DirectChatVideoJob }
  | { kind: "updated"; scope: "group"; job: GroupChatVideoJob }
  | { kind: "confirmed"; scope: "direct"; job: DirectChatVideoJob; message: Message }
  | { kind: "confirmed"; scope: "group"; job: GroupChatVideoJob; message: GroupMessage };

type Listener = (event: ChatVideoOutboxEvent) => void;

const storagePrefix = "bwchat.chat-video-outbox.v1";
const maximumAutomaticRetries = 5;
const listeners = new Set<Listener>();
const inFlight = new Set<string>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cancelled = new Set<string>();

export async function enqueueDirectChatVideo(input: EnqueueInput): Promise<void> {
  const job = makeJob("direct", input);
  cancelled.delete(jobIdentity(job));
  await saveJob(job);
  emit(updatedEvent(job));
  void runJob(job);
}

export async function enqueueGroupChatVideo(input: EnqueueInput): Promise<void> {
  const job = makeJob("group", input);
  cancelled.delete(jobIdentity(job));
  await saveJob(job);
  emit(updatedEvent(job));
  void runJob(job);
}

export async function resumeChatVideoUploads(
  ownerId: string,
  scope: ChatVideoJob["scope"],
  targetId: string,
): Promise<void> {
  const jobs = (await readChatVideoJobs(ownerId))
    .filter((job) => job.scope === scope && job.target_id === targetId)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  for (const job of jobs) {
    emit(updatedEvent(job));
    if (job.state !== "failed") {
      void runJob({ ...job, state: job.state === "retry_waiting" ? "retry_waiting" : "queued" });
    }
  }
}

export async function retryChatVideoUpload(
  ownerId: string,
  clientMessageId: string,
): Promise<boolean> {
  const job = await readJob(ownerId, clientMessageId);
  if (!job || inFlight.has(jobIdentity(job))) return false;
  clearRetryTimer(job);
  const queued = {
    ...job,
    state: "queued" as const,
    next_attempt_at: undefined,
    last_error: undefined,
  };
  await saveJob(queued);
  emit(updatedEvent(queued));
  void runJob(queued);
  return true;
}

export async function cancelChatVideoUpload(
  ownerId: string,
  clientMessageId: string,
): Promise<boolean> {
  const job = await readJob(ownerId, clientMessageId);
  if (!job) return false;
  cancelled.add(jobIdentity(job));
  clearRetryTimer(job);
  await removeJob(job);
  return true;
}

export async function readChatVideoJobs(ownerId: string): Promise<ChatVideoJob[]> {
  const keys = await AsyncStorage.getAllKeys();
  const prefix = `${storagePrefix}:${encodeURIComponent(ownerId)}:`;
  const rows = await AsyncStorage.multiGet(keys.filter((key) => key.startsWith(prefix)));
  return rows.flatMap(([, value]) => decodeJob(value, ownerId));
}

export function subscribeChatVideoOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function directOptimisticVideoMessage(job: DirectChatVideoJob): Message {
  return {
    id: temporaryChatImageId(job.id),
    sender_id: job.owner_id,
    receiver_id: job.target_id,
    msg_type: "video",
    content: job.durable_video_uri ?? job.source.uri,
    ...(job.prepared ? { thumbnail_url: job.prepared.thumbnail_uri } : {}),
    timestamp: job.created_at,
    client_message_id: job.id,
    version: 1,
    delivery_status: job.state === "failed" ? "failed" : "sending",
  };
}

export function groupOptimisticVideoMessage(job: GroupChatVideoJob): GroupMessage {
  return {
    id: temporaryChatImageId(job.id),
    group_id: Number(job.target_id),
    sender_id: job.owner_id,
    msg_type: "video",
    content: job.durable_video_uri ?? job.source.uri,
    ...(job.prepared ? { thumbnail_url: job.prepared.thumbnail_uri } : {}),
    timestamp: job.created_at,
    sender_nickname: job.sender_nickname,
    sender_avatar: job.sender_avatar,
    mention_all: false,
    client_message_id: job.id,
    version: 1,
    delivery_status: job.state === "failed" ? "failed" : "sending",
  };
}

export function isTransientChatVideoError(error: unknown): boolean {
  return (
    error instanceof APIError &&
    (error.status === 0 ||
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500)
  );
}

interface EnqueueInput {
  owner: Pick<User, "user_id" | "nickname" | "avatar_url">;
  targetId: string;
  clientMessageId: string;
  asset: ChatVideoSource;
  createdAt?: string | undefined;
}

function makeJob<TScope extends ChatVideoJob["scope"]>(
  scope: TScope,
  input: EnqueueInput,
): Extract<ChatVideoJob, { scope: TScope }> {
  return {
    id: input.clientMessageId,
    owner_id: input.owner.user_id,
    target_id: input.targetId,
    sender_nickname: input.owner.nickname,
    sender_avatar: input.owner.avatar_url ?? "",
    source: input.asset,
    created_at: input.createdAt ?? new Date().toISOString(),
    scope,
    state: "staging",
    attempt_count: 0,
  } as Extract<ChatVideoJob, { scope: TScope }>;
}

async function runJob(input: ChatVideoJob): Promise<void> {
  const identity = jobIdentity(input);
  if (cancelled.has(identity) || inFlight.has(identity) || input.state === "failed") return;
  if (input.state === "retry_waiting") {
    scheduleRetry(input);
    return;
  }
  inFlight.add(identity);
  let job = input;
  let reachedUpload = false;
  try {
    if (!job.durable_video_uri) {
      job = await stageVideo(job);
      if (cancelled.has(identity)) return;
      await saveAndEmit(job);
    }
    if (!job.prepared) {
      job = { ...job, state: "preparing", last_error: undefined };
      await saveAndEmit(job);
      job = await prepareDurableVideo(job);
      if (cancelled.has(identity)) return;
      await saveAndEmit(job);
    }
    if (cancelled.has(identity)) return;
    reachedUpload = true;
    const uploading = {
      ...job,
      state: "uploading" as const,
      next_attempt_at: undefined,
      last_error: undefined,
    };
    job = uploading;
    await saveAndEmit(uploading);
    if (cancelled.has(identity)) return;
    const upload = uploadInput(uploading.prepared);
    if (uploading.scope === "direct") {
      const response = await sendDirectVideoMessage(uploading.target_id, upload, uploading.id);
      if (cancelled.has(identity)) return;
      await adoptConfirmedVideo(uploading, response);
      await removeJob(uploading);
      emit({
        kind: "confirmed",
        scope: "direct",
        job: uploading,
        message: {
          ...response,
          client_message_id: response.client_message_id ?? uploading.id,
          delivery_status: "sent",
        },
      });
    } else {
      const groupId = Number(uploading.target_id);
      if (!Number.isInteger(groupId) || groupId <= 0) throw new Error("无效的群聊 ID");
      const response = await sendGroupVideoMessage(groupId, upload, uploading.id);
      if (cancelled.has(identity)) return;
      await adoptConfirmedVideo(uploading, response);
      await removeJob(uploading);
      emit({
        kind: "confirmed",
        scope: "group",
        job: uploading,
        message: {
          ...response,
          group_id: response.group_id || groupId,
          sender_id: response.sender_id || uploading.owner_id,
          sender_nickname: response.sender_nickname || uploading.sender_nickname,
          sender_avatar: response.sender_avatar || uploading.sender_avatar,
          client_message_id: response.client_message_id ?? uploading.id,
          delivery_status: "sent",
        },
      });
    }
  } catch (error) {
    if (cancelled.has(identity)) return;
    const message = errorMessage(error);
    if (
      reachedUpload &&
      isTransientChatVideoError(error) &&
      job.attempt_count < maximumAutomaticRetries
    ) {
      const baseSeconds = Math.min(2 ** Math.min(Math.max(job.attempt_count, 0), 8), 300);
      const jitterSeconds = Math.random() * baseSeconds * 0.2;
      const waiting = {
        ...job,
        state: "retry_waiting" as const,
        attempt_count: job.attempt_count + 1,
        next_attempt_at: new Date(Date.now() + (baseSeconds + jitterSeconds) * 1_000).toISOString(),
        last_error: message,
      };
      await saveAndEmit(waiting);
      scheduleRetry(waiting);
    } else {
      await saveAndEmit({ ...job, state: "failed", last_error: message });
    }
  } finally {
    inFlight.delete(identity);
  }
}

async function adoptConfirmedVideo(
  job: ChatVideoJob,
  confirmed: Pick<Message, "content" | "thumbnail_url">,
): Promise<void> {
  const sourceUri = job.prepared?.uri ?? job.durable_video_uri;
  const remoteUrl = confirmed.content.trim();
  if (sourceUri && remoteUrl) {
    await adoptLocalMediaFile({
      ownerId: job.owner_id,
      mediaId: chatVideoMediaCacheId(remoteUrl),
      remoteUrl,
      sourceUri,
    });
  }

  const thumbnailSource = job.prepared?.thumbnail_uri;
  if (!thumbnailSource || !remoteUrl) return;
  const thumbnailPath = confirmed.thumbnail_url?.trim() || chatVideoThumbnailPath(remoteUrl);
  const keys = [thumbnailPath, resolveMediaUrl(thumbnailPath, env.apiBaseUrl) ?? ""];
  await adoptLocalImageFile(thumbnailSource, keys);
}

async function stageVideo(job: ChatVideoJob): Promise<ChatVideoJob> {
  const directory = jobDirectory(job);
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, `video-${safeFilename(job.source.filename)}`);
  await new File(job.source.uri).copy(destination, { overwrite: true });
  return { ...job, durable_video_uri: destination.uri, state: "queued" };
}

async function prepareDurableVideo(job: ChatVideoJob): Promise<ChatVideoJob> {
  const prepared = await prepareChatVideo({
    uri: job.durable_video_uri ?? job.source.uri,
    width: job.source.width,
    height: job.source.height,
    filename: job.source.filename,
    mimeType: job.source.mime_type,
  });
  const thumbnail = new File(jobDirectory(job), "thumbnail.jpg");
  await new File(prepared.thumbnail_uri).copy(thumbnail, { overwrite: true });
  return {
    ...job,
    state: "queued",
    prepared: {
      ...prepared,
      uri: job.durable_video_uri ?? job.source.uri,
      thumbnail_uri: thumbnail.uri,
    },
  };
}

function uploadInput(prepared: PreparedChatVideo | undefined) {
  if (!prepared) throw new Error("视频文件尚未准备完成");
  return {
    uri: prepared.uri,
    filename: prepared.filename,
    mimeType: prepared.mime_type,
    thumbnailUri: prepared.thumbnail_uri,
    thumbnailFilename: prepared.thumbnail_filename,
  };
}

function scheduleRetry(job: ChatVideoJob): void {
  const identity = jobIdentity(job);
  if (retryTimers.has(identity) || job.attempt_count >= maximumAutomaticRetries) return;
  const scheduled = job.next_attempt_at ? Date.parse(job.next_attempt_at) : Date.now();
  const delay = Math.max(0, Number.isFinite(scheduled) ? scheduled - Date.now() : 0);
  retryTimers.set(
    identity,
    setTimeout(() => {
      retryTimers.delete(identity);
      void runJob({ ...job, state: "queued" });
    }, delay),
  );
}

function clearRetryTimer(job: ChatVideoJob): void {
  const identity = jobIdentity(job);
  const timer = retryTimers.get(identity);
  if (timer) clearTimeout(timer);
  retryTimers.delete(identity);
}

async function saveAndEmit(job: ChatVideoJob): Promise<void> {
  await saveJob(job);
  emit(updatedEvent(job));
}

async function readJob(ownerId: string, clientMessageId: string): Promise<ChatVideoJob | null> {
  const value = await AsyncStorage.getItem(jobKey(ownerId, clientMessageId));
  return decodeJob(value, ownerId)[0] ?? null;
}

function decodeJob(value: string | null, ownerId: string): ChatVideoJob[] {
  if (!value) return [];
  try {
    const job = JSON.parse(value) as ChatVideoJob;
    return job.id && job.owner_id === ownerId && (job.scope === "direct" || job.scope === "group")
      ? [job]
      : [];
  } catch {
    return [];
  }
}

async function saveJob(job: ChatVideoJob): Promise<void> {
  await AsyncStorage.setItem(jobKey(job.owner_id, job.id), JSON.stringify(job));
}

async function removeJob(job: ChatVideoJob): Promise<void> {
  clearRetryTimer(job);
  await AsyncStorage.removeItem(jobKey(job.owner_id, job.id));
  const directory = jobDirectory(job);
  if (directory.exists) {
    try {
      directory.delete();
    } catch {
      // The durable row is gone; account cleanup can remove stale files later.
    }
  }
}

function emit(event: ChatVideoOutboxEvent): void {
  for (const listener of listeners) listener(event);
}

function updatedEvent(job: ChatVideoJob): ChatVideoOutboxEvent {
  return job.scope === "direct"
    ? { kind: "updated", scope: "direct", job }
    : { kind: "updated", scope: "group", job };
}

function jobKey(ownerId: string, clientMessageId: string): string {
  return `${storagePrefix}:${encodeURIComponent(ownerId)}:${clientMessageId}`;
}

function jobDirectory(job: Pick<ChatVideoJob, "owner_id" | "id">): Directory {
  return new Directory(
    Paths.document,
    "bwchat-outbox",
    "chat-videos",
    encodeURIComponent(job.owner_id),
    job.id,
  );
}

function jobIdentity(job: Pick<ChatVideoJob, "owner_id" | "id">): string {
  return `${job.owner_id}:${job.id}`;
}

function safeFilename(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "video.mp4";
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "视频发送失败，请重试";
}
