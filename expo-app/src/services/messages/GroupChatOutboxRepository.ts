import AsyncStorage from "@react-native-async-storage/async-storage";

import { APIError } from "@/api/client";
import type { GroupMessage, GroupReplyPreview } from "@/models";

export type GroupChatOutboxState = "queued" | "sending" | "retry_waiting" | "failed";

export interface GroupChatOutboxJob {
  id: string;
  owner_id: string;
  group_id: number;
  msg_type: "text" | "sticker";
  content: string;
  sticker_pack_id?: string | undefined;
  sticker_id?: string | undefined;
  reply_to_id?: number | undefined;
  reply_to?: GroupReplyPreview | undefined;
  mentions?: string[] | undefined;
  mention_all: boolean;
  sender_nickname: string;
  sender_avatar: string;
  created_at: string;
  state: GroupChatOutboxState;
  attempt_count: number;
  next_attempt_at?: string | undefined;
  last_error?: string | undefined;
}

export const groupChatOutboxPolicy = Object.freeze({
  maximumAutomaticAttempts: 5,
  maximumRetryDelaySeconds: 30,
});

const storagePrefix = "bwchat.group-message-outbox.v1";

export async function createGroupChatOutboxJob(
  input: Omit<GroupChatOutboxJob, "state" | "attempt_count">,
): Promise<GroupChatOutboxJob> {
  const job: GroupChatOutboxJob = { ...input, state: "queued", attempt_count: 0 };
  await saveGroupChatOutboxJob(job);
  return job;
}

export async function saveGroupChatOutboxJob(job: GroupChatOutboxJob): Promise<void> {
  if (!validJob(job, job.owner_id)) throw new Error("Invalid group chat outbox job");
  await AsyncStorage.setItem(jobKey(job.owner_id, job.id), JSON.stringify(job));
}

export async function readGroupChatOutboxJob(
  ownerId: string,
  clientMessageId: string,
): Promise<GroupChatOutboxJob | null> {
  const encoded = await AsyncStorage.getItem(jobKey(ownerId, clientMessageId));
  return decodeJob(encoded, ownerId);
}

export async function readGroupChatOutboxJobs(
  ownerId: string,
  groupId?: number,
): Promise<GroupChatOutboxJob[]> {
  if (!ownerId.trim()) return [];
  const prefix = `${storagePrefix}:account:${encodeURIComponent(ownerId)}:`;
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  const rows = await AsyncStorage.multiGet(keys);
  return rows
    .flatMap(([, encoded]) => {
      const job = decodeJob(encoded, ownerId);
      return job && (groupId === undefined || job.group_id === groupId) ? [job] : [];
    })
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export async function removeGroupChatOutboxJob(
  ownerId: string,
  clientMessageId: string,
): Promise<void> {
  await AsyncStorage.removeItem(jobKey(ownerId, clientMessageId));
}

export function groupChatOutboxFailure(
  job: GroupChatOutboxJob,
  error: unknown,
  now = Date.now(),
): GroupChatOutboxJob {
  const message = error instanceof Error ? error.message : String(error);
  if (
    !isTransientGroupChatOutboxError(error) ||
    job.attempt_count >= groupChatOutboxPolicy.maximumAutomaticAttempts
  ) {
    return { ...job, state: "failed", last_error: message, next_attempt_at: undefined };
  }
  const attemptCount = job.attempt_count + 1;
  const seconds = Math.min(
    2 ** Math.max(0, job.attempt_count),
    groupChatOutboxPolicy.maximumRetryDelaySeconds,
  );
  return {
    ...job,
    state: "retry_waiting",
    attempt_count: attemptCount,
    next_attempt_at: new Date(now + seconds * 1_000).toISOString(),
    last_error: message,
  };
}

export function queuedGroupChatOutboxJob(job: GroupChatOutboxJob): GroupChatOutboxJob {
  return { ...job, state: "queued", next_attempt_at: undefined, last_error: undefined };
}

export function sendingGroupChatOutboxJob(job: GroupChatOutboxJob): GroupChatOutboxJob {
  return { ...job, state: "sending", next_attempt_at: undefined, last_error: undefined };
}

export function isTransientGroupChatOutboxError(error: unknown): boolean {
  return (
    error instanceof APIError &&
    (error.status === 0 ||
      error.status === 408 ||
      error.status === 425 ||
      error.status === 429 ||
      error.status >= 500)
  );
}

export function groupOptimisticOutboxMessage(job: GroupChatOutboxJob): GroupMessage {
  return {
    id: temporaryGroupChatOutboxId(job.id),
    group_id: job.group_id,
    sender_id: job.owner_id,
    msg_type: job.msg_type,
    content: job.content,
    ...(job.reply_to_id !== undefined ? { reply_to_id: job.reply_to_id } : {}),
    ...(job.reply_to ? { reply_to: job.reply_to } : {}),
    ...(job.mentions && job.mentions.length > 0 ? { mentions: job.mentions } : {}),
    mention_all: job.mention_all,
    timestamp: job.created_at,
    sender_nickname: job.sender_nickname,
    sender_avatar: job.sender_avatar,
    client_message_id: job.id,
    version: 1,
    delivery_status: job.state === "failed" ? "failed" : "sending",
  };
}

export function temporaryGroupChatOutboxId(clientMessageId: string): number {
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

function decodeJob(encoded: string | null, ownerId: string): GroupChatOutboxJob | null {
  if (!encoded) return null;
  try {
    const value = JSON.parse(encoded) as GroupChatOutboxJob;
    return validJob(value, ownerId) ? value : null;
  } catch {
    return null;
  }
}

function validJob(job: GroupChatOutboxJob, ownerId: string): boolean {
  return (
    typeof job === "object" &&
    job !== null &&
    typeof job.id === "string" &&
    job.id.trim().length > 0 &&
    ownerId.trim().length > 0 &&
    job.owner_id === ownerId &&
    Number.isSafeInteger(job.group_id) &&
    job.group_id > 0 &&
    (job.msg_type === "text" || job.msg_type === "sticker") &&
    typeof job.content === "string" &&
    job.content.trim().length > 0 &&
    (job.reply_to_id === undefined ||
      (Number.isSafeInteger(job.reply_to_id) && job.reply_to_id > 0)) &&
    (job.reply_to === undefined || validReplyPreview(job.reply_to)) &&
    (job.mentions === undefined ||
      (Array.isArray(job.mentions) &&
        job.mentions.every((userId) => typeof userId === "string" && userId.trim().length > 0))) &&
    typeof job.mention_all === "boolean" &&
    typeof job.sender_nickname === "string" &&
    typeof job.sender_avatar === "string" &&
    typeof job.created_at === "string" &&
    Number.isFinite(Date.parse(job.created_at)) &&
    ["queued", "sending", "retry_waiting", "failed"].includes(job.state) &&
    Number.isSafeInteger(job.attempt_count) &&
    job.attempt_count >= 0 &&
    job.attempt_count <= groupChatOutboxPolicy.maximumAutomaticAttempts &&
    (job.next_attempt_at === undefined ||
      (typeof job.next_attempt_at === "string" &&
        Number.isFinite(Date.parse(job.next_attempt_at)))) &&
    (job.last_error === undefined || typeof job.last_error === "string") &&
    (job.msg_type !== "sticker" ||
      (typeof job.sticker_pack_id === "string" &&
        job.sticker_pack_id.trim().length > 0 &&
        typeof job.sticker_id === "string" &&
        job.sticker_id.trim().length > 0))
  );
}

function validReplyPreview(reply: GroupReplyPreview): boolean {
  return (
    typeof reply === "object" &&
    reply !== null &&
    Number.isSafeInteger(reply.id) &&
    reply.id > 0 &&
    typeof reply.sender_id === "string" &&
    reply.sender_id.trim().length > 0 &&
    typeof reply.msg_type === "string" &&
    reply.msg_type.trim().length > 0 &&
    typeof reply.content === "string"
  );
}
