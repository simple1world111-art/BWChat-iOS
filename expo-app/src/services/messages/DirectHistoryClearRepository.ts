import AsyncStorage from "@react-native-async-storage/async-storage";

import type { DirectHistoryClearReceipt, Message } from "@/models";

const keyPrefix = "bwchat.direct-history-clear.v1";

export interface DirectHistoryClearEvent extends DirectHistoryClearReceipt {
  owner_id: string;
}

type Listener = (event: DirectHistoryClearEvent) => void;

const listeners = new Set<Listener>();
const pendingWrites = new Map<string, Promise<number>>();

export async function readDirectHistoryClearWatermark(
  ownerId: string,
  contactId: string,
): Promise<number> {
  if (!ownerId.trim() || !contactId.trim()) return -1;
  const stored = await AsyncStorage.getItem(storageKey(ownerId, contactId));
  if (stored === null || stored.trim().length === 0) return -1;
  const parsed = Number(stored);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : -1;
}

export async function applyDirectHistoryClear(
  ownerId: string,
  receipt: DirectHistoryClearReceipt,
): Promise<DirectHistoryClearEvent> {
  const contactId = receipt.conversation_id.trim();
  if (!ownerId.trim() || !contactId || receipt.cleared_before_message_id < 0) {
    throw new Error("清空聊天记录回执无效");
  }

  const key = storageKey(ownerId, contactId);
  const previousWrite = pendingWrites.get(key) ?? Promise.resolve(-1);
  const write = previousWrite
    .catch(() => -1)
    .then(async () => {
      const stored = await readDirectHistoryClearWatermark(ownerId, contactId);
      const effective = Math.max(stored, receipt.cleared_before_message_id);
      await AsyncStorage.setItem(key, String(effective));
      return effective;
    });
  pendingWrites.set(key, write);

  let effective: number;
  try {
    effective = await write;
  } finally {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key);
  }

  const event: DirectHistoryClearEvent = {
    ...receipt,
    owner_id: ownerId,
    cleared_before_message_id: effective,
  };
  for (const listener of [...listeners]) listener(event);
  return event;
}

export function subscribeDirectHistoryClear(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function filterClearedDirectMessages(
  messages: readonly Message[],
  throughMessageId: number,
): Message[] {
  if (throughMessageId < 0) return [...messages];
  return messages.filter((message) => message.id <= 0 || message.id > throughMessageId);
}

function storageKey(ownerId: string, contactId: string): string {
  return `${keyPrefix}:${encodeURIComponent(ownerId)}:${encodeURIComponent(contactId)}`;
}
