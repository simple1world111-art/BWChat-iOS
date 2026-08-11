import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeConversationSnapshot } from "@/api/normalizers";
import type { Conversation, ConversationReadReceipt, ConversationSyncSnapshot } from "@/models";
import {
  conversationHiddenSnapshot,
  conversationListIdentity,
  type ConversationListLocalState,
} from "@/services/conversations/ConversationListPolicy";

const keyPrefix = "bwchat.conversations.snapshot.v1";
const metadataKeyPrefix = "bwchat.conversations.snapshot-metadata.v1";
const pinnedKeyPrefix = "bwchat.conversations.pinned.v1";
const hiddenKeyPrefix = "bwchat.conversations.hidden.v1";
const livePairKeyPrefix = "bwchat.conversations.live-pairs.v1";
const initiatedDmKeyPrefix = "bwchat.conversations.initiated-dms.v1";
interface AccountReadReceipt {
  ownerId: string;
  receipt: ConversationReadReceipt;
}

export interface DirectConversationPreviewUpdate {
  owner_id: string;
  contact_id: string;
  last_message?: string | undefined;
  last_message_time?: string | undefined;
  last_message_id?: number | undefined;
}

export interface DirectConversationCandidate {
  owner_id: string;
  contact_id: string;
  name: string;
  avatar_url: string;
}

export interface GroupConversationPreviewUpdate {
  owner_id: string;
  group_id: number;
  last_message?: string | undefined;
  last_message_time?: string | undefined;
  last_message_id?: number | undefined;
}

const readReceiptListeners = new Set<(event: AccountReadReceipt) => void>();
const directPreviewListeners = new Set<(event: DirectConversationPreviewUpdate) => void>();
const directCandidateListeners = new Set<(event: DirectConversationCandidate) => void>();
const groupPreviewListeners = new Set<(event: GroupConversationPreviewUpdate) => void>();
const conversationLoads = new Map<string, Promise<ConversationSyncSnapshot>>();
const repositoryGenerations = new Map<string, number>();
const localStateMutations = new Map<string, Promise<unknown>>();

export const conversationListCachePolicy = Object.freeze({
  ttlMilliseconds: 2 * 60 * 1_000,
  staleRetentionMilliseconds: 30 * 24 * 60 * 60 * 1_000,
});

export function resetConversationRepositoryMemoryForAccount(ownerId: string): void {
  const owner = ownerId.trim();
  if (!owner) return;
  repositoryGenerations.set(owner, repositoryGeneration(owner) + 1);
  conversationLoads.delete(cacheKey(owner));
}

export async function loadCachedConversationSnapshot(
  ownerId: string,
): Promise<ConversationSyncSnapshot | null> {
  const encoded = await AsyncStorage.getItem(cacheKey(ownerId));
  if (!encoded) return null;
  try {
    return normalizeConversationSnapshot(JSON.parse(encoded) as unknown);
  } catch {
    return null;
  }
}

export async function reconcileConversationSnapshot(
  ownerId: string,
  incoming: ConversationSyncSnapshot,
  now = Date.now(),
): Promise<ConversationSyncSnapshot> {
  const cached = await loadCachedConversationSnapshot(ownerId);
  if (!shouldAcceptConversationSnapshot(incoming, cached)) return cached ?? incoming;
  await Promise.all([
    AsyncStorage.setItem(cacheKey(ownerId), JSON.stringify(incoming)),
    AsyncStorage.setItem(metadataKey(ownerId), String(now)),
  ]);
  return incoming;
}

export async function loadConversationSnapshotWithNativeCache(
  ownerId: string,
  fetchSnapshot: () => Promise<ConversationSyncSnapshot>,
  options: { forceRefresh?: boolean; now?: number } = {},
): Promise<ConversationSyncSnapshot> {
  const owner = ownerId.trim();
  const generation = repositoryGeneration(owner);
  const now = options.now ?? Date.now();
  const cached = await loadCachedConversationSnapshot(owner);
  const savedAt = await readSnapshotSavedAt(owner);
  if (!options.forceRefresh && cached && savedAt === undefined) {
    await AsyncStorage.setItem(metadataKey(owner), String(now)).catch(() => undefined);
    return cached;
  }
  if (
    !options.forceRefresh &&
    cached &&
    savedAt !== undefined &&
    now - savedAt <= conversationListCachePolicy.ttlMilliseconds
  ) {
    return cached;
  }
  const key = cacheKey(owner);
  const inFlight = conversationLoads.get(key);
  if (inFlight) return inFlight;
  const load = (async () => {
    try {
      const incoming = await fetchSnapshot();
      if (generation !== repositoryGeneration(owner)) return incoming;
      return reconcileConversationSnapshot(owner, incoming, now);
    } catch (error) {
      if (
        cached &&
        savedAt !== undefined &&
        now - savedAt <=
          conversationListCachePolicy.ttlMilliseconds +
            conversationListCachePolicy.staleRetentionMilliseconds
      ) {
        return cached;
      }
      throw error;
    }
  })().finally(() => {
    if (conversationLoads.get(key) === load) conversationLoads.delete(key);
  });
  conversationLoads.set(key, load);
  return load;
}

export function shouldAcceptConversationSnapshot(
  incoming: ConversationSyncSnapshot,
  cached: ConversationSyncSnapshot | null,
): boolean {
  if (!cached) return true;
  if (
    incoming.revision !== undefined &&
    cached.revision !== undefined &&
    incoming.revision < cached.revision
  ) {
    return false;
  }
  if (incoming.conversations.length > 0 || cached.conversations.length === 0) return true;
  if (incoming.snapshot_complete !== true) return false;
  if (cached.revision !== undefined && incoming.revision === undefined) return false;
  return true;
}

export async function clearCachedDirectConversationPreview(
  ownerId: string,
  contactId: string,
): Promise<void> {
  const cached = await loadCachedConversationSnapshot(ownerId);
  if (!cached) return;
  const conversations = clearDirectConversationPreview(cached.conversations, contactId);
  await AsyncStorage.setItem(cacheKey(ownerId), JSON.stringify({ ...cached, conversations }));
}

export function clearDirectConversationPreview(
  conversations: readonly Conversation[],
  contactId: string,
): Conversation[] {
  return conversations.map((conversation) => {
    if (conversation.type !== "dm" || conversation.id !== contactId) return conversation;
    const replacement = { ...conversation, unread_count: 0 };
    delete replacement.last_message;
    delete replacement.last_message_time;
    return replacement;
  });
}

export async function publishDirectConversationPreviewUpdate(
  update: DirectConversationPreviewUpdate,
): Promise<void> {
  const ownerId = update.owner_id.trim();
  const contactId = update.contact_id.trim();
  if (!ownerId || !contactId) return;
  const normalized: DirectConversationPreviewUpdate = {
    owner_id: ownerId,
    contact_id: contactId,
    ...(update.last_message !== undefined ? { last_message: update.last_message } : {}),
    ...(update.last_message_time !== undefined
      ? { last_message_time: update.last_message_time }
      : {}),
    ...(update.last_message_id !== undefined ? { last_message_id: update.last_message_id } : {}),
  };
  // Update mounted conversation screens before touching AsyncStorage. A chat
  // send and the following back navigation can happen in consecutive frames;
  // making UI delivery wait for disk allowed the old preview to flash (or stay
  // visible until the next server sync).
  for (const listener of [...directPreviewListeners]) listener(normalized);
  await serializeLocalStateMutation(ownerId, async () => {
    const cached = await loadCachedConversationSnapshot(ownerId);
    if (cached) {
      await AsyncStorage.setItem(
        cacheKey(ownerId),
        JSON.stringify({
          ...cached,
          conversations: applyDirectConversationPreviewUpdate(cached.conversations, normalized),
        }),
      );
    }
  });
}

export function applyDirectConversationPreviewUpdate(
  conversations: readonly Conversation[],
  update: DirectConversationPreviewUpdate,
): Conversation[] {
  return conversations.map((conversation) => {
    if (conversation.type !== "dm" || conversation.id !== update.contact_id) return conversation;
    const replacement = { ...conversation };
    if (update.last_message === undefined) delete replacement.last_message;
    else replacement.last_message = update.last_message;
    if (update.last_message_time === undefined) delete replacement.last_message_time;
    else replacement.last_message_time = update.last_message_time;
    if (update.last_message_id === undefined) delete replacement.last_message_id;
    else replacement.last_message_id = update.last_message_id;
    return replacement;
  });
}

export function subscribeDirectConversationPreviewUpdates(
  ownerId: string,
  listener: (update: DirectConversationPreviewUpdate) => void,
): () => void {
  const owner = ownerId.trim();
  const accountListener = (update: DirectConversationPreviewUpdate) => {
    if (update.owner_id === owner) listener(update);
  };
  directPreviewListeners.add(accountListener);
  return () => directPreviewListeners.delete(accountListener);
}

export async function publishDirectConversationCandidate(
  candidate: DirectConversationCandidate,
): Promise<void> {
  const ownerId = candidate.owner_id.trim();
  const contactId = candidate.contact_id.trim();
  if (!ownerId || !contactId || ownerId === contactId) return;
  const normalized: DirectConversationCandidate = {
    owner_id: ownerId,
    contact_id: contactId,
    name: candidate.name.trim(),
    avatar_url: candidate.avatar_url.trim(),
  };

  // Notify the mounted list before disk I/O so navigating back from Add Friend
  // reveals the empty DM card in the same frame.
  for (const listener of [...directCandidateListeners]) listener(normalized);

  await serializeLocalStateMutation(ownerId, async () => {
    const [cached, initiatedDmIds, localState] = await Promise.all([
      loadCachedConversationSnapshot(ownerId),
      loadConversationInitiatedDmIds(ownerId),
      loadConversationListLocalState(ownerId),
    ]);
    initiatedDmIds.add(contactId);
    const identity = `dm:${contactId}`;
    const hiddenSnapshots = { ...localState.hiddenSnapshots };
    delete hiddenSnapshots[identity];
    await Promise.all([
      AsyncStorage.setItem(
        cacheKey(ownerId),
        JSON.stringify({
          ...(cached ?? { snapshot_complete: false }),
          conversations: applyDirectConversationCandidate(cached?.conversations ?? [], normalized),
        }),
      ),
      saveConversationInitiatedDmIds(ownerId, initiatedDmIds),
      saveConversationHiddenSnapshots(ownerId, hiddenSnapshots),
    ]);
  });
}

export function applyDirectConversationCandidate(
  conversations: readonly Conversation[],
  candidate: DirectConversationCandidate,
): Conversation[] {
  const identity = `dm:${candidate.contact_id}`;
  const index = conversations.findIndex(
    (conversation) => conversationListIdentity(conversation) === identity,
  );
  if (index < 0) {
    return [
      ...conversations,
      {
        type: "dm",
        id: candidate.contact_id,
        name: candidate.name || candidate.contact_id,
        avatar_url: candidate.avatar_url,
        unread_count: 0,
        is_muted: false,
      },
    ];
  }
  return conversations.map((conversation, itemIndex) =>
    itemIndex === index
      ? {
          ...conversation,
          name: candidate.name || conversation.name,
          avatar_url: candidate.avatar_url || conversation.avatar_url,
        }
      : conversation,
  );
}

export function subscribeDirectConversationCandidates(
  ownerId: string,
  listener: (candidate: DirectConversationCandidate) => void,
): () => void {
  const owner = ownerId.trim();
  const accountListener = (candidate: DirectConversationCandidate) => {
    if (candidate.owner_id === owner) listener(candidate);
  };
  directCandidateListeners.add(accountListener);
  return () => directCandidateListeners.delete(accountListener);
}

export async function publishGroupConversationPreviewUpdate(
  update: GroupConversationPreviewUpdate,
): Promise<void> {
  const ownerId = update.owner_id.trim();
  if (!ownerId || !Number.isSafeInteger(update.group_id) || update.group_id <= 0) return;
  const normalized: GroupConversationPreviewUpdate = {
    owner_id: ownerId,
    group_id: update.group_id,
    ...(update.last_message !== undefined ? { last_message: update.last_message } : {}),
    ...(update.last_message_time !== undefined
      ? { last_message_time: update.last_message_time }
      : {}),
    ...(update.last_message_id !== undefined ? { last_message_id: update.last_message_id } : {}),
  };
  for (const listener of [...groupPreviewListeners]) listener(normalized);
  await serializeLocalStateMutation(ownerId, async () => {
    const cached = await loadCachedConversationSnapshot(ownerId);
    if (cached) {
      await AsyncStorage.setItem(
        cacheKey(ownerId),
        JSON.stringify({
          ...cached,
          conversations: applyGroupConversationPreviewUpdate(cached.conversations, normalized),
        }),
      );
    }
  });
}

export function applyGroupConversationPreviewUpdate(
  conversations: readonly Conversation[],
  update: GroupConversationPreviewUpdate,
): Conversation[] {
  return conversations.map((conversation) => {
    const resolvedGroupId =
      conversation.group_id !== undefined ? conversation.group_id : Number(conversation.id);
    if (conversation.type !== "group" || resolvedGroupId !== update.group_id) return conversation;
    const replacement = { ...conversation };
    if (update.last_message === undefined) delete replacement.last_message;
    else replacement.last_message = update.last_message;
    if (update.last_message_time === undefined) delete replacement.last_message_time;
    else replacement.last_message_time = update.last_message_time;
    if (update.last_message_id === undefined) delete replacement.last_message_id;
    else replacement.last_message_id = update.last_message_id;
    return replacement;
  });
}

export function subscribeGroupConversationPreviewUpdates(
  ownerId: string,
  listener: (update: GroupConversationPreviewUpdate) => void,
): () => void {
  const owner = ownerId.trim();
  const accountListener = (update: GroupConversationPreviewUpdate) => {
    if (update.owner_id === owner) listener(update);
  };
  groupPreviewListeners.add(accountListener);
  return () => groupPreviewListeners.delete(accountListener);
}

export async function setCachedConversationPinned(
  ownerId: string,
  conversationType: string,
  targetId: string,
  isPinned: boolean,
): Promise<void> {
  const cached = await loadCachedConversationSnapshot(ownerId);
  if (!cached) return;
  const conversations = cached.conversations.map((conversation) => {
    const resolvedId =
      conversation.type === "group" && conversation.group_id !== undefined
        ? String(conversation.group_id)
        : conversation.id;
    return conversation.type === conversationType && resolvedId === targetId
      ? { ...conversation, is_pinned: isPinned }
      : conversation;
  });
  await AsyncStorage.setItem(cacheKey(ownerId), JSON.stringify({ ...cached, conversations }));
}

export async function saveCachedConversationItemsProjection(
  ownerId: string,
  conversations: readonly Conversation[],
): Promise<void> {
  await serializeLocalStateMutation(ownerId, async () => {
    const cached = await loadCachedConversationSnapshot(ownerId);
    await AsyncStorage.setItem(
      cacheKey(ownerId),
      JSON.stringify({
        ...(cached ?? { snapshot_complete: false }),
        conversations: [...conversations],
      }),
    );
  });
}

export async function loadConversationListLocalState(
  ownerId: string,
): Promise<ConversationListLocalState> {
  const [pinned, hidden] = await Promise.all([
    readStringArray(pinnedKey(ownerId)),
    readStringRecord(hiddenKey(ownerId)),
  ]);
  return { pinnedKeys: new Set(pinned), hiddenSnapshots: hidden };
}

export async function saveConversationPinnedKeys(
  ownerId: string,
  pinnedKeys: ReadonlySet<string>,
): Promise<void> {
  await AsyncStorage.setItem(pinnedKey(ownerId), JSON.stringify([...pinnedKeys]));
}

export async function saveConversationHiddenSnapshots(
  ownerId: string,
  hiddenSnapshots: Readonly<Record<string, string>>,
): Promise<void> {
  await AsyncStorage.setItem(hiddenKey(ownerId), JSON.stringify(hiddenSnapshots));
}

export async function loadConversationLivePairIds(ownerId: string): Promise<Set<string>> {
  return new Set(await readStringArray(livePairKey(ownerId)));
}

export async function saveConversationLivePairIds(
  ownerId: string,
  peerIds: ReadonlySet<string>,
): Promise<void> {
  await AsyncStorage.setItem(livePairKey(ownerId), JSON.stringify([...peerIds]));
}

export async function loadConversationInitiatedDmIds(ownerId: string): Promise<Set<string>> {
  return new Set(await readStringArray(initiatedDmKey(ownerId)));
}

export async function saveConversationInitiatedDmIds(
  ownerId: string,
  peerIds: ReadonlySet<string>,
): Promise<void> {
  await AsyncStorage.setItem(initiatedDmKey(ownerId), JSON.stringify([...peerIds]));
}

export async function hideCachedConversation(
  ownerId: string,
  conversation: Conversation,
): Promise<Record<string, string>> {
  return serializeLocalStateMutation(ownerId, async () => {
    const state = await loadConversationListLocalState(ownerId);
    const identity = conversationListIdentity(conversation);
    const hiddenSnapshots = {
      ...state.hiddenSnapshots,
      [identity]: conversationHiddenSnapshot(conversation),
    };
    const pinnedKeys = new Set(state.pinnedKeys);
    pinnedKeys.delete(identity);
    const cached = await loadCachedConversationSnapshot(ownerId);
    await Promise.all([
      saveConversationHiddenSnapshots(ownerId, hiddenSnapshots),
      saveConversationPinnedKeys(ownerId, pinnedKeys),
      cached
        ? AsyncStorage.setItem(
            cacheKey(ownerId),
            JSON.stringify({
              ...cached,
              conversations: cached.conversations.filter(
                (candidate) => conversationListIdentity(candidate) !== identity,
              ),
            }),
          )
        : Promise.resolve(),
    ]);
    return hiddenSnapshots;
  });
}

export async function unhideCachedConversation(
  ownerId: string,
  conversation: Conversation,
): Promise<Record<string, string>> {
  return serializeLocalStateMutation(ownerId, async () => {
    const state = await loadConversationListLocalState(ownerId);
    const identity = conversationListIdentity(conversation);
    if (state.hiddenSnapshots[identity] === undefined) return state.hiddenSnapshots;
    const hiddenSnapshots = { ...state.hiddenSnapshots };
    delete hiddenSnapshots[identity];
    await saveConversationHiddenSnapshots(ownerId, hiddenSnapshots);
    return hiddenSnapshots;
  });
}

export async function applyConversationReadReceipt(
  ownerId: string,
  receipt: ConversationReadReceipt,
): Promise<ConversationSyncSnapshot | null> {
  if (!receipt.conversation_id.trim()) return loadCachedConversationSnapshot(ownerId);
  const cached = await loadCachedConversationSnapshot(ownerId);
  const next = cached ? applyConversationReadReceiptToSnapshot(cached, receipt) : null;
  if (next) await AsyncStorage.setItem(cacheKey(ownerId), JSON.stringify(next));
  for (const listener of readReceiptListeners) listener({ ownerId, receipt });
  return next;
}

export async function clearConversationUnreadLocally(
  ownerId: string,
  type: "dm" | "group",
  targetId: string,
): Promise<void> {
  const owner = ownerId.trim();
  if (!owner || !targetId.trim()) return;
  await serializeLocalStateMutation(owner, async () => {
    const cached = await loadCachedConversationSnapshot(owner);
    if (!cached) return;
    const identity = conversationReadIdentity(type, targetId);
    const conversation = cached.conversations.find(
      (candidate) => conversationIdentity(candidate) === identity,
    );
    if (!conversation) return;
    const receipt: ConversationReadReceipt = {
      conversation_type: type,
      conversation_id: targetId,
      read_through_message_id: conversation.read_through_message_id ?? 0,
      unread_count: 0,
      ...(cached.total_unread_count !== undefined
        ? {
            total_unread_count: Math.max(
              0,
              cached.total_unread_count - Math.max(0, conversation.unread_count),
            ),
          }
        : {}),
    };
    const next = applyConversationReadReceiptToSnapshot(cached, receipt);
    await AsyncStorage.setItem(cacheKey(owner), JSON.stringify(next));
    for (const listener of readReceiptListeners) listener({ ownerId: owner, receipt });
  });
}

export function applyConversationReadReceiptToSnapshot(
  snapshot: ConversationSyncSnapshot,
  receipt: ConversationReadReceipt,
): ConversationSyncSnapshot {
  const identity = conversationReadIdentity(receipt.conversation_type, receipt.conversation_id);
  const conversations = snapshot.conversations.map((conversation) => {
    if (conversationIdentity(conversation) !== identity) return conversation;
    if (
      receipt.revision !== undefined &&
      conversation.revision !== undefined &&
      receipt.revision < conversation.revision
    ) {
      return conversation;
    }
    return {
      ...conversation,
      unread_count: receipt.unread_count,
      read_through_message_id: receipt.read_through_message_id,
      ...(receipt.revision !== undefined ? { revision: receipt.revision } : {}),
    };
  });
  return {
    ...snapshot,
    conversations,
    ...(receipt.total_unread_count !== undefined
      ? { total_unread_count: receipt.total_unread_count }
      : {}),
    ...(receipt.server_time !== undefined ? { server_time: receipt.server_time } : {}),
  };
}

export function applyConversationReadReceiptToItems(
  conversations: readonly Conversation[],
  receipt: ConversationReadReceipt,
): Conversation[] {
  return applyConversationReadReceiptToSnapshot({ conversations: [...conversations] }, receipt)
    .conversations;
}

export function subscribeConversationReadReceipts(
  ownerId: string,
  listener: (receipt: ConversationReadReceipt) => void,
): () => void {
  const owner = ownerId.trim();
  const accountListener = (event: AccountReadReceipt) => {
    if (event.ownerId === owner) listener(event.receipt);
  };
  readReceiptListeners.add(accountListener);
  return () => readReceiptListeners.delete(accountListener);
}

export function conversationReadIdentity(type: string, id: string): string {
  const normalized = type.trim().toLocaleLowerCase().replaceAll("-", "_");
  return normalized === "group" || normalized === "group_chat"
    ? `group:${Number(id) || 0}`
    : `dm:${id.trim()}`;
}

function conversationIdentity(conversation: Conversation): string {
  return conversationListIdentity(conversation);
}

function cacheKey(ownerId: string): string {
  return `${keyPrefix}:${encodeURIComponent(ownerId)}`;
}

function metadataKey(ownerId: string): string {
  return `${metadataKeyPrefix}:${encodeURIComponent(ownerId)}`;
}

function pinnedKey(ownerId: string): string {
  return `${pinnedKeyPrefix}:${encodeURIComponent(ownerId)}`;
}

function hiddenKey(ownerId: string): string {
  return `${hiddenKeyPrefix}:${encodeURIComponent(ownerId)}`;
}

function livePairKey(ownerId: string): string {
  return `${livePairKeyPrefix}:${encodeURIComponent(ownerId)}`;
}

function initiatedDmKey(ownerId: string): string {
  return `${initiatedDmKeyPrefix}:${encodeURIComponent(ownerId)}`;
}

async function readSnapshotSavedAt(ownerId: string): Promise<number | undefined> {
  const encoded = await AsyncStorage.getItem(metadataKey(ownerId));
  if (!encoded) return undefined;
  const value = Number(encoded);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function readStringArray(key: string): Promise<string[]> {
  try {
    const value: unknown = JSON.parse((await AsyncStorage.getItem(key)) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  } catch {
    return [];
  }
}

async function readStringRecord(key: string): Promise<Record<string, string>> {
  try {
    const value: unknown = JSON.parse((await AsyncStorage.getItem(key)) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => entry[0].length > 0 && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function repositoryGeneration(ownerId: string): number {
  return repositoryGenerations.get(ownerId) ?? 0;
}

function serializeLocalStateMutation<T>(ownerId: string, mutation: () => Promise<T>): Promise<T> {
  const key = encodeURIComponent(ownerId.trim());
  const previous = localStateMutations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(mutation);
  localStateMutations.set(key, current);
  const cleanup = () => {
    if (localStateMutations.get(key) === current) localStateMutations.delete(key);
  };
  void current.then(cleanup, cleanup);
  return current;
}
