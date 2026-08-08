import AsyncStorage from "@react-native-async-storage/async-storage";

import type { GroupHistoryClearReceipt, GroupMessage } from "@/models";

const keyPrefix = "bwchat.group-history-clear.v1";

export interface GroupHistoryClearEvent extends GroupHistoryClearReceipt {
  owner_id: string;
}

type Listener = (event: GroupHistoryClearEvent) => void;

const listeners = new Set<Listener>();
const pendingWrites = new Map<string, Promise<number>>();

export async function readGroupHistoryClearWatermark(
  ownerId: string,
  groupId: number,
): Promise<number> {
  if (!ownerId.trim() || groupId <= 0) return -1;
  const stored = await AsyncStorage.getItem(storageKey(ownerId, groupId));
  if (stored === null || stored.trim().length === 0) return -1;
  const parsed = Number(stored);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : -1;
}

export async function applyGroupHistoryClear(
  ownerId: string,
  receipt: GroupHistoryClearReceipt,
): Promise<GroupHistoryClearEvent> {
  if (!ownerId.trim() || receipt.group_id <= 0 || receipt.cleared_before_sequence < 0) {
    throw new Error("群聊清空回执无效");
  }
  const key = storageKey(ownerId, receipt.group_id);
  const previousWrite = pendingWrites.get(key) ?? Promise.resolve(-1);
  const write = previousWrite
    .catch(() => -1)
    .then(async () => {
      const stored = await readGroupHistoryClearWatermark(ownerId, receipt.group_id);
      const effective = Math.max(stored, receipt.cleared_before_sequence);
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
  const event: GroupHistoryClearEvent = {
    ...receipt,
    owner_id: ownerId,
    cleared_before_sequence: effective,
  };
  for (const listener of [...listeners]) listener(event);
  return event;
}

export function subscribeGroupHistoryClear(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function filterClearedGroupMessages(
  messages: readonly GroupMessage[],
  throughSequence: number,
): GroupMessage[] {
  if (throughSequence < 0) return [...messages];
  return messages.filter(
    (message) =>
      message.history_sequence === undefined || message.history_sequence > throughSequence,
  );
}

function storageKey(ownerId: string, groupId: number): string {
  return `${keyPrefix}:${encodeURIComponent(ownerId)}:${groupId}`;
}
