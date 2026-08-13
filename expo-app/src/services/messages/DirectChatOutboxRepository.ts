import AsyncStorage from "@react-native-async-storage/async-storage";

import { APIError } from "@/api/client";
import type { Message, ReplyPreview } from "@/models";
import {
  chatVoiceOutboxContent,
  isValidChatVoiceOutboxPayload,
  type ChatVoiceOutboxPayload,
} from "@/services/messages/ChatVoiceOutboxPayload";
import {
  chatOutboxNetworkRetryDelayMilliseconds,
  type ChatOutboxRetryReason,
} from "@/services/messages/ChatOutboxNetwork";

export type DirectChatOutboxState = "queued" | "sending" | "retry_waiting" | "failed";

export interface DirectChatOutboxJob {
  id: string;
  client_message_id: string;
  owner_id: string;
  target_id: string;
  msg_type: "text" | "sticker" | "voice";
  content: string;
  voice?: ChatVoiceOutboxPayload | undefined;
  sticker_pack_id?: string | undefined;
  sticker_id?: string | undefined;
  reply_to_id?: number | undefined;
  reply_to?: ReplyPreview | undefined;
  created_at: string;
  state: DirectChatOutboxState;
  attempt_count: number;
  next_attempt_at?: string | undefined;
  retry_reason?: ChatOutboxRetryReason | undefined;
  last_error?: string | undefined;
}

type DirectChatOutboxJobInput = Omit<
  DirectChatOutboxJob,
  "state" | "attempt_count" | "client_message_id"
> & {
  client_message_id?: string | undefined;
};

export const directChatOutboxPolicy = Object.freeze({
  maximumAutomaticAttempts: 5,
  maximumRetryDelaySeconds: 30,
});

const storagePrefix = "bwchat.direct-message-outbox.v1";

export async function createDirectChatOutboxJob(
  input: DirectChatOutboxJobInput,
): Promise<DirectChatOutboxJob> {
  const clientMessageId = input.client_message_id ?? input.id;
  const job: DirectChatOutboxJob = {
    ...input,
    client_message_id: clientMessageId,
    ...(input.msg_type === "voice" && input.voice
      ? { content: chatVoiceOutboxContent(input.voice) }
      : {}),
    state: "queued",
    attempt_count: 0,
  };
  await saveDirectChatOutboxJob(job);
  return job;
}

export async function saveDirectChatOutboxJob(job: DirectChatOutboxJob): Promise<void> {
  if (!validJob(job, job.owner_id)) throw new Error("Invalid direct chat outbox job");
  await AsyncStorage.setItem(jobKey(job.owner_id, job.id), JSON.stringify(job));
}

export async function readDirectChatOutboxJob(
  ownerId: string,
  clientMessageId: string,
): Promise<DirectChatOutboxJob | null> {
  const encoded = await AsyncStorage.getItem(jobKey(ownerId, clientMessageId));
  return decodeJob(encoded, ownerId);
}

export async function readDirectChatOutboxJobs(
  ownerId: string,
  targetId?: string,
): Promise<DirectChatOutboxJob[]> {
  if (!ownerId.trim()) return [];
  const prefix = `${storagePrefix}:account:${encodeURIComponent(ownerId)}:`;
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  const rows = await AsyncStorage.multiGet(keys);
  return rows
    .flatMap(([, encoded]) => {
      const job = decodeJob(encoded, ownerId);
      return job && (targetId === undefined || job.target_id === targetId) ? [job] : [];
    })
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export async function removeDirectChatOutboxJob(
  ownerId: string,
  clientMessageId: string,
): Promise<void> {
  await AsyncStorage.removeItem(jobKey(ownerId, clientMessageId));
}

export function directChatOutboxFailure(
  job: DirectChatOutboxJob,
  error: unknown,
  now = Date.now(),
): DirectChatOutboxJob {
  const message = error instanceof Error ? error.message : String(error);
  const keepsWaitingForNetwork =
    job.msg_type === "voice" && error instanceof APIError && error.status === 0;
  if (
    !isTransientDirectChatOutboxError(error) ||
    (!keepsWaitingForNetwork &&
      job.attempt_count >= directChatOutboxPolicy.maximumAutomaticAttempts)
  ) {
    return {
      ...job,
      state: "failed",
      last_error: message,
      next_attempt_at: undefined,
      retry_reason: undefined,
    };
  }
  const attemptCount = Math.min(
    job.attempt_count + 1,
    directChatOutboxPolicy.maximumAutomaticAttempts,
  );
  const seconds = Math.min(
    2 ** Math.max(0, job.attempt_count),
    directChatOutboxPolicy.maximumRetryDelaySeconds,
  );
  return {
    ...job,
    state: "retry_waiting",
    attempt_count: attemptCount,
    next_attempt_at: new Date(now + seconds * 1_000).toISOString(),
    retry_reason: "transient_error",
    last_error: message,
  };
}

export function directChatOutboxOfflineWait(
  job: DirectChatOutboxJob,
  now = Date.now(),
): DirectChatOutboxJob {
  return {
    ...job,
    state: "retry_waiting",
    next_attempt_at: new Date(now + chatOutboxNetworkRetryDelayMilliseconds).toISOString(),
    retry_reason: "network_offline",
    last_error: undefined,
  };
}

export function queuedDirectChatOutboxJob(job: DirectChatOutboxJob): DirectChatOutboxJob {
  return {
    ...job,
    state: "queued",
    next_attempt_at: undefined,
    retry_reason: undefined,
    last_error: undefined,
  };
}

export function sendingDirectChatOutboxJob(job: DirectChatOutboxJob): DirectChatOutboxJob {
  return {
    ...job,
    state: "sending",
    next_attempt_at: undefined,
    retry_reason: undefined,
    last_error: undefined,
  };
}

export function isTransientDirectChatOutboxError(error: unknown): boolean {
  return (
    error instanceof APIError &&
    (error.status === 0 ||
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500)
  );
}

export function directOptimisticOutboxMessage(job: DirectChatOutboxJob): Message {
  return {
    id: temporaryDirectChatOutboxId(job.id),
    sender_id: job.owner_id,
    receiver_id: job.target_id,
    msg_type: job.msg_type,
    content: job.content,
    ...(job.reply_to_id !== undefined ? { reply_to_id: job.reply_to_id } : {}),
    ...(job.reply_to ? { reply_to: job.reply_to } : {}),
    timestamp: job.created_at,
    client_message_id: job.client_message_id,
    version: 1,
    delivery_status: job.state === "failed" ? "failed" : "sending",
  };
}

export function temporaryDirectChatOutboxId(clientMessageId: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < clientMessageId.length; index += 1) {
    hash ^= clientMessageId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return -Math.max(hash >>> 0, 1);
}

function jobKey(ownerId: string, clientMessageId: string): string {
  return `${storagePrefix}:account:${encodeURIComponent(ownerId)}:job:${encodeURIComponent(clientMessageId)}`;
}

function decodeJob(encoded: string | null, ownerId: string): DirectChatOutboxJob | null {
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(encoded) as DirectChatOutboxJob;
    const value = {
      ...parsed,
      client_message_id: parsed.client_message_id ?? parsed.id,
    };
    return validJob(value, ownerId) ? value : null;
  } catch {
    return null;
  }
}

function validJob(job: DirectChatOutboxJob, ownerId: string): boolean {
  return (
    typeof job === "object" &&
    job !== null &&
    typeof job.id === "string" &&
    job.id.length > 0 &&
    job.client_message_id === job.id &&
    job.owner_id === ownerId &&
    typeof job.target_id === "string" &&
    job.target_id.length > 0 &&
    (job.msg_type === "text" || job.msg_type === "sticker" || job.msg_type === "voice") &&
    typeof job.content === "string" &&
    typeof job.created_at === "string" &&
    ["queued", "sending", "retry_waiting", "failed"].includes(job.state) &&
    Number.isSafeInteger(job.attempt_count) &&
    job.attempt_count >= 0 &&
    (job.retry_reason === undefined ||
      job.retry_reason === "network_offline" ||
      job.retry_reason === "transient_error") &&
    (job.msg_type !== "sticker" ||
      (typeof job.sticker_pack_id === "string" && typeof job.sticker_id === "string")) &&
    (job.msg_type !== "voice" || isValidChatVoiceOutboxPayload(job.voice))
  );
}
