import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";

import { sendDirectImageMessage, sendGroupImageMessage } from "@/api/bwchat";
import { APIError } from "@/api/client";
import type { GroupMessage, Message, User } from "@/models";
import { env } from "@/config/env";
import { adoptLocalImageFile } from "@/services/cache/ImageCacheService";
import { galleryOwnerCacheKey } from "@/components/media/imageGalleryMath";
import { prepareChatImage, type PreparedChatImage } from "@/services/messages/ChatImageService";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export type ChatImageUploadState =
  "staging" | "queued" | "preparing" | "uploading" | "retry_waiting" | "failed";

interface ChatImageSource {
  uri: string;
  width: number;
  height: number;
  filename: string;
}

interface ChatImageJobBase {
  id: string;
  owner_id: string;
  target_id: string;
  sender_nickname: string;
  sender_avatar: string;
  source: ChatImageSource;
  presentation_uri?: string | undefined;
  durable_source_uri?: string | undefined;
  prepared?: PreparedChatImage | undefined;
  created_at: string;
  state: ChatImageUploadState;
  attempt_count: number;
  next_attempt_at?: string | undefined;
  last_error?: string | undefined;
}

export interface DirectChatImageJob extends ChatImageJobBase {
  scope: "direct";
}

export interface GroupChatImageJob extends ChatImageJobBase {
  scope: "group";
}

export type ChatImageJob = DirectChatImageJob | GroupChatImageJob;

export type ChatImageOutboxEvent =
  | { kind: "updated"; scope: "direct"; job: DirectChatImageJob }
  | { kind: "updated"; scope: "group"; job: GroupChatImageJob }
  | { kind: "confirmed"; scope: "direct"; job: DirectChatImageJob; message: Message }
  | { kind: "confirmed"; scope: "group"; job: GroupChatImageJob; message: GroupMessage };

type Listener = (event: ChatImageOutboxEvent) => void;

const storagePrefix = "bwchat.chat-image-outbox.v1";
const maximumAutomaticAttempts = 5;
const listeners = new Set<Listener>();
const inFlight = new Set<string>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cancelled = new Set<string>();

export async function enqueueDirectChatImage(input: {
  owner: Pick<User, "user_id" | "nickname" | "avatar_url">;
  targetId: string;
  clientMessageId: string;
  asset: ChatImageSource;
  createdAt?: string | undefined;
}): Promise<void> {
  const job: DirectChatImageJob = makeJob("direct", input);
  cancelled.delete(inFlightKey(job));
  await saveJob(job);
  emit(updatedEvent(job));
  void runJob(job);
}

export async function enqueueGroupChatImage(input: {
  owner: Pick<User, "user_id" | "nickname" | "avatar_url">;
  targetId: string;
  clientMessageId: string;
  asset: ChatImageSource;
  createdAt?: string | undefined;
}): Promise<void> {
  const job: GroupChatImageJob = makeJob("group", input);
  cancelled.delete(inFlightKey(job));
  await saveJob(job);
  emit(updatedEvent(job));
  void runJob(job);
}

export async function resumeChatImageUploads(
  ownerId: string,
  scope: ChatImageJob["scope"],
  targetId: string,
): Promise<void> {
  const jobs = (await readChatImageJobs(ownerId))
    .filter((job) => job.scope === scope && job.target_id === targetId)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  for (const job of jobs) {
    const resumed = {
      ...job,
      // Picker cache URLs are ideal while the current screen is alive. After
      // a restart, prefer the durable copy owned by the outbox instead.
      presentation_uri: job.durable_source_uri ?? job.presentation_uri ?? job.source.uri,
    };
    emit(updatedEvent(resumed));
    if (resumed.state !== "failed") {
      void runJob({
        ...resumed,
        state: resumed.state === "retry_waiting" ? "retry_waiting" : "queued",
      });
    }
  }
}

export async function retryChatImageUpload(
  ownerId: string,
  clientMessageId: string,
): Promise<boolean> {
  const job = await readJob(ownerId, clientMessageId);
  if (!job || inFlight.has(inFlightKey(job))) return false;
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

export async function cancelChatImageUpload(
  ownerId: string,
  clientMessageId: string,
): Promise<boolean> {
  const job = await readJob(ownerId, clientMessageId);
  if (!job) return false;
  cancelled.add(inFlightKey(job));
  clearRetryTimer(job);
  await removeJob(job);
  return true;
}

export async function readChatImageJobs(ownerId: string): Promise<ChatImageJob[]> {
  const keys = await AsyncStorage.getAllKeys();
  const prefix = `${storagePrefix}:${encodeURIComponent(ownerId)}:`;
  const rows = await AsyncStorage.multiGet(keys.filter((key) => key.startsWith(prefix)));
  return rows.flatMap(([, encoded]) => decodeJob(encoded, ownerId));
}

export function subscribeChatImageOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function directOptimisticImageMessage(job: DirectChatImageJob): Message {
  const presentationUri = job.presentation_uri ?? job.durable_source_uri ?? job.source.uri;
  return {
    id: temporaryChatImageId(job.id),
    sender_id: job.owner_id,
    receiver_id: job.target_id,
    msg_type: "image",
    content: presentationUri,
    thumbnail_url: presentationUri,
    media_width: job.source.width,
    media_height: job.source.height,
    timestamp: job.created_at,
    client_message_id: job.id,
    version: 1,
    delivery_status: job.state === "failed" ? "failed" : "sending",
  };
}

export function groupOptimisticImageMessage(job: GroupChatImageJob): GroupMessage {
  const presentationUri = job.presentation_uri ?? job.durable_source_uri ?? job.source.uri;
  return {
    id: temporaryChatImageId(job.id),
    group_id: Number(job.target_id),
    sender_id: job.owner_id,
    msg_type: "image",
    content: presentationUri,
    thumbnail_url: presentationUri,
    media_width: job.source.width,
    media_height: job.source.height,
    timestamp: job.created_at,
    sender_nickname: job.sender_nickname,
    sender_avatar: job.sender_avatar,
    mention_all: false,
    client_message_id: job.id,
    version: 1,
    delivery_status: job.state === "failed" ? "failed" : "sending",
  };
}

export function temporaryChatImageId(clientMessageId: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < clientMessageId.length; index += 1) {
    hash ^= clientMessageId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return -Math.max(hash >>> 0, 1);
}

export function isTransientChatImageError(error: unknown): boolean {
  return (
    error instanceof APIError &&
    (error.status === 0 ||
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500)
  );
}

function makeJob<TScope extends ChatImageJob["scope"]>(
  scope: TScope,
  input: {
    owner: Pick<User, "user_id" | "nickname" | "avatar_url">;
    targetId: string;
    clientMessageId: string;
    asset: ChatImageSource;
    createdAt?: string | undefined;
  },
): Extract<ChatImageJob, { scope: TScope }> {
  return {
    id: input.clientMessageId,
    owner_id: input.owner.user_id,
    target_id: input.targetId,
    sender_nickname: input.owner.nickname,
    sender_avatar: input.owner.avatar_url ?? "",
    source: input.asset,
    presentation_uri: input.asset.uri,
    created_at: input.createdAt ?? new Date().toISOString(),
    scope,
    state: "staging",
    attempt_count: 0,
  } as Extract<ChatImageJob, { scope: TScope }>;
}

async function runJob(input: ChatImageJob): Promise<void> {
  const key = inFlightKey(input);
  if (cancelled.has(key) || inFlight.has(key) || input.state === "failed") return;
  if (input.state === "retry_waiting") {
    scheduleRetry(input);
    return;
  }
  inFlight.add(key);
  let job = input;
  let reachedUpload = false;
  try {
    if (!job.durable_source_uri) {
      job = await stageSource(job);
      if (cancelled.has(key)) return;
      await saveAndEmit(job);
    }
    if (!job.prepared) {
      job = { ...job, state: "preparing", last_error: undefined };
      await saveAndEmit(job);
      job = await prepareDurableFiles(job);
      if (cancelled.has(key)) return;
      await saveAndEmit(job);
    }
    if (cancelled.has(key)) return;
    reachedUpload = true;
    const uploading = {
      ...job,
      state: "uploading" as const,
      next_attempt_at: undefined,
      last_error: undefined,
    };
    job = uploading;
    await saveAndEmit(uploading);
    if (cancelled.has(key)) return;
    if (uploading.scope === "direct") {
      const confirmed = await sendDirectImageMessage(
        uploading.target_id,
        uploadInput(uploading.prepared),
        uploading.id,
      );
      if (cancelled.has(key)) return;
      assertDirectImageConfirmation(uploading, confirmed);
      await adoptConfirmedImage(uploading, confirmed);
      await removeJob(uploading);
      emit({
        kind: "confirmed",
        scope: "direct",
        job: uploading,
        message: {
          ...confirmed,
          client_message_id: confirmed.client_message_id ?? uploading.id,
          media_width: uploading.source.width,
          media_height: uploading.source.height,
          delivery_status: "sent",
        },
      });
    } else {
      const groupId = Number(uploading.target_id);
      if (!Number.isInteger(groupId) || groupId <= 0) throw new Error("无效的群聊 ID");
      const confirmed = await sendGroupImageMessage(
        groupId,
        uploadInput(uploading.prepared),
        uploading.id,
      );
      if (cancelled.has(key)) return;
      assertGroupImageConfirmation(uploading, confirmed, groupId);
      await adoptConfirmedImage(uploading, confirmed);
      await removeJob(uploading);
      emit({
        kind: "confirmed",
        scope: "group",
        job: uploading,
        message: {
          ...confirmed,
          group_id: confirmed.group_id || groupId,
          sender_id: confirmed.sender_id || uploading.owner_id,
          sender_nickname: confirmed.sender_nickname || uploading.sender_nickname,
          sender_avatar: confirmed.sender_avatar || uploading.sender_avatar,
          client_message_id: confirmed.client_message_id ?? uploading.id,
          media_width: uploading.source.width,
          media_height: uploading.source.height,
          delivery_status: "sent",
        },
      });
    }
  } catch (error) {
    if (cancelled.has(key)) return;
    const message = errorMessage(error);
    if (
      reachedUpload &&
      isTransientChatImageError(error) &&
      job.attempt_count < maximumAutomaticAttempts
    ) {
      const retryCount = job.attempt_count + 1;
      const baseSeconds = Math.min(2 ** Math.min(Math.max(job.attempt_count, 0), 8), 300);
      const jitterSeconds = Math.random() * baseSeconds * 0.2;
      const waiting = {
        ...job,
        state: "retry_waiting" as const,
        attempt_count: retryCount,
        next_attempt_at: new Date(Date.now() + (baseSeconds + jitterSeconds) * 1_000).toISOString(),
        last_error: message,
      };
      await saveAndEmit(waiting);
      scheduleRetry(waiting);
    } else {
      await saveAndEmit({ ...job, state: "failed", last_error: message });
    }
  } finally {
    inFlight.delete(key);
  }
}

async function adoptConfirmedImage(
  job: ChatImageJob,
  confirmed: Pick<Message, "content" | "thumbnail_url">,
): Promise<void> {
  const sourceUri = job.prepared?.uri ?? job.durable_source_uri;
  if (!sourceUri) return;
  const keys = [confirmed.content, confirmed.thumbnail_url ?? ""].flatMap((value) => [
    value,
    resolveMediaUrl(value, env.apiBaseUrl) ?? "",
    galleryOwnerCacheKey(job.owner_id, value),
    galleryOwnerCacheKey(job.owner_id, resolveMediaUrl(value, env.apiBaseUrl) ?? ""),
  ]);
  await adoptLocalImageFile(sourceUri, keys);
}

async function stageSource(job: ChatImageJob): Promise<ChatImageJob> {
  const directory = jobDirectory(job);
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, `source-${safeFilename(job.source.filename)}`);
  await new File(job.source.uri).copy(destination, { overwrite: true });
  return { ...job, durable_source_uri: destination.uri, state: "queued" };
}

async function prepareDurableFiles(job: ChatImageJob): Promise<ChatImageJob> {
  const prepared = await prepareChatImage(
    {
      uri: job.durable_source_uri ?? job.source.uri,
      width: job.source.width,
      height: job.source.height,
    },
    0,
  );
  const directory = jobDirectory(job);
  directory.create({ intermediates: true, idempotent: true });
  const image = new File(directory, "upload.jpg");
  const thumbnail = new File(directory, "thumbnail.jpg");
  await new File(prepared.uri).copy(image, { overwrite: true });
  await new File(prepared.thumbnail_uri).copy(thumbnail, { overwrite: true });
  return {
    ...job,
    state: "queued",
    prepared: {
      ...prepared,
      uri: image.uri,
      thumbnail_uri: thumbnail.uri,
    },
  };
}

function uploadInput(prepared: PreparedChatImage | undefined) {
  if (!prepared) throw new Error("图片文件尚未准备完成");
  return {
    uri: prepared.uri,
    filename: prepared.filename,
    thumbnailUri: prepared.thumbnail_uri,
    thumbnailFilename: prepared.thumbnail_filename,
  };
}

function assertDirectImageConfirmation(job: DirectChatImageJob, message: Message): void {
  if (
    (message.sender_id.trim() && message.sender_id.trim() !== job.owner_id.trim()) ||
    (message.receiver_id.trim() && message.receiver_id.trim() !== job.target_id.trim())
  ) {
    throw new APIError("图片消息的服务端账号确认不一致，请重新登录后重试", 409, message);
  }
}

function assertGroupImageConfirmation(
  job: GroupChatImageJob,
  message: GroupMessage,
  groupId: number,
): void {
  if (
    (message.sender_id.trim() && message.sender_id.trim() !== job.owner_id.trim()) ||
    (message.group_id > 0 && message.group_id !== groupId)
  ) {
    throw new APIError("群图片消息的服务端账号确认不一致，请重新登录后重试", 409, message);
  }
}

function scheduleRetry(job: ChatImageJob): void {
  const key = inFlightKey(job);
  if (retryTimers.has(key) || job.attempt_count >= maximumAutomaticAttempts) return;
  const scheduledTime = job.next_attempt_at ? Date.parse(job.next_attempt_at) : Date.now();
  const delay = Math.max(0, Number.isFinite(scheduledTime) ? scheduledTime - Date.now() : 0);
  retryTimers.set(
    key,
    setTimeout(() => {
      retryTimers.delete(key);
      void runJob({ ...job, state: "queued" });
    }, delay),
  );
}

function clearRetryTimer(job: ChatImageJob): void {
  const key = inFlightKey(job);
  const timer = retryTimers.get(key);
  if (timer) clearTimeout(timer);
  retryTimers.delete(key);
}

async function saveAndEmit(job: ChatImageJob): Promise<void> {
  await saveJob(job);
  emit(updatedEvent(job));
}

async function readJob(ownerId: string, clientMessageId: string): Promise<ChatImageJob | null> {
  const encoded = await AsyncStorage.getItem(jobKey(ownerId, clientMessageId));
  return decodeJob(encoded, ownerId)[0] ?? null;
}

function decodeJob(encoded: string | null, ownerId: string): ChatImageJob[] {
  if (!encoded) return [];
  try {
    const value = JSON.parse(encoded) as ChatImageJob;
    return value.id &&
      value.owner_id === ownerId &&
      (value.scope === "direct" || value.scope === "group")
      ? [value]
      : [];
  } catch {
    return [];
  }
}

async function saveJob(job: ChatImageJob): Promise<void> {
  await AsyncStorage.setItem(jobKey(job.owner_id, job.id), JSON.stringify(job));
}

async function removeJob(job: ChatImageJob): Promise<void> {
  clearRetryTimer(job);
  await AsyncStorage.removeItem(jobKey(job.owner_id, job.id));
  const directory = jobDirectory(job);
  if (directory.exists) {
    try {
      directory.delete();
    } catch {
      // The durable row is already gone; stale files can be removed by account cleanup.
    }
  }
}

function emit(event: ChatImageOutboxEvent): void {
  for (const listener of listeners) listener(event);
}

function updatedEvent(job: ChatImageJob): ChatImageOutboxEvent {
  return job.scope === "direct"
    ? { kind: "updated", scope: "direct", job }
    : { kind: "updated", scope: "group", job };
}

function jobKey(ownerId: string, clientMessageId: string): string {
  return `${storagePrefix}:${encodeURIComponent(ownerId)}:${clientMessageId}`;
}

function jobDirectory(job: Pick<ChatImageJob, "owner_id" | "id">): Directory {
  return new Directory(
    Paths.document,
    "bwchat-outbox",
    "chat-images",
    encodeURIComponent(job.owner_id),
    job.id,
  );
}

function inFlightKey(job: Pick<ChatImageJob, "owner_id" | "id">): string {
  return `${job.owner_id}:${job.id}`;
}

function safeFilename(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "image.jpg";
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "图片发送失败，请重试";
}
