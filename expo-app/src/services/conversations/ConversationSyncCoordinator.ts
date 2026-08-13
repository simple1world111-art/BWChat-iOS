import AsyncStorage from "@react-native-async-storage/async-storage";

export type ConversationSyncTargetType = "dm" | "group" | "agent" | "script";

export interface ConversationSyncTarget {
  conversation_type: ConversationSyncTargetType;
  conversation_id: string;
  message_id?: number | undefined;
  message_version?: number | undefined;
}

export interface ConversationSyncRequest {
  owner_id: string;
  reasons: string[];
  full: boolean;
  targets: ConversationSyncTarget[];
  requested_at: number;
}

type SyncListener = (request: ConversationSyncRequest) => void | Promise<void>;

interface AccountSyncState {
  ownerId: string;
  started: boolean;
  applicationActive: boolean;
  networkAvailable: boolean;
  hydrated: boolean;
  hydratePromise: Promise<void> | null;
  pending: ConversationSyncRequest | null;
  listeners: Set<SyncListener>;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  mutation: Promise<unknown>;
  retryAttempt: number;
}

const pendingKeyPrefix = "bwchat.conversations.sync-pending.v1";
export const conversationSyncCoalesceMilliseconds = 300;

export function conversationSyncRetryDelay(attempt: number, random = Math.random): number {
  const cap = Math.min(1_000 * 2 ** Math.min(Math.max(0, Math.floor(attempt)), 5), 30_000);
  return Math.floor(Math.min(1, Math.max(0, random())) * cap);
}

/**
 * Account-scoped reconciliation gate shared by push, realtime and mounted chat surfaces.
 * It deliberately stores only a trigger, not message content: the authoritative catch-up remains
 * the existing conversation/timeline API and every request arriving during a flight produces at
 * most one follow-up flight.
 */
export class ConversationSyncCoordinator {
  private readonly accounts = new Map<string, AccountSyncState>();

  start(ownerId: string): void {
    const state = this.account(ownerId);
    if (!state) return;
    state.started = true;
    void this.hydrate(state).then(() => this.schedule(state, 0));
  }

  stop(ownerId: string): void {
    const state = this.account(ownerId, false);
    if (!state) return;
    state.started = false;
    if (state.timer) clearTimeout(state.timer);
    state.timer = null;
  }

  setApplicationActive(ownerId: string, active: boolean): void {
    const state = this.account(ownerId);
    if (!state) return;
    state.applicationActive = active;
    if (active) void this.hydrate(state).then(() => this.schedule(state, 0));
  }

  setNetworkAvailable(ownerId: string, available: boolean): void {
    const state = this.account(ownerId);
    if (!state) return;
    state.networkAvailable = available;
    if (available) void this.hydrate(state).then(() => this.schedule(state, 0));
  }

  subscribe(ownerId: string, listener: SyncListener): () => void {
    const state = this.account(ownerId);
    if (!state) return () => undefined;
    state.listeners.add(listener);
    void this.hydrate(state).then(() => this.schedule(state, 0));
    return () => state.listeners.delete(listener);
  }

  async request(ownerId: string, reason: string, target?: ConversationSyncTarget): Promise<void> {
    const state = this.account(ownerId);
    if (!state) return;
    await this.hydrate(state);
    state.pending = mergeRequests(state.pending, createRequest(state.ownerId, reason, target));
    await this.persist(state);
    this.schedule(state);
  }

  private account(ownerId: string, create = true): AccountSyncState | null {
    const owner = ownerId.trim();
    if (!owner) return null;
    const existing = this.accounts.get(owner);
    if (existing || !create) return existing ?? null;
    const state: AccountSyncState = {
      ownerId: owner,
      started: false,
      applicationActive: true,
      networkAvailable: true,
      hydrated: false,
      hydratePromise: null,
      pending: null,
      listeners: new Set(),
      timer: null,
      inFlight: false,
      mutation: Promise.resolve(),
      retryAttempt: 0,
    };
    this.accounts.set(owner, state);
    return state;
  }

  private hydrate(state: AccountSyncState): Promise<void> {
    if (state.hydrated) return Promise.resolve();
    if (state.hydratePromise) return state.hydratePromise;
    state.hydratePromise = AsyncStorage.getItem(pendingKey(state.ownerId))
      .then((encoded) => {
        const restored = parseStoredRequest(encoded, state.ownerId);
        if (restored) state.pending = mergeRequests(restored, state.pending);
      })
      .catch(() => undefined)
      .then(() => {
        state.hydrated = true;
        state.hydratePromise = null;
      });
    return state.hydratePromise;
  }

  private schedule(state: AccountSyncState, delay = conversationSyncCoalesceMilliseconds): void {
    if (
      !state.started ||
      !state.applicationActive ||
      !state.networkAvailable ||
      !state.pending ||
      state.inFlight ||
      state.listeners.size === 0 ||
      state.timer
    ) {
      return;
    }
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.flush(state);
    }, delay);
  }

  private async flush(state: AccountSyncState): Promise<void> {
    if (
      state.inFlight ||
      !state.started ||
      !state.applicationActive ||
      !state.networkAvailable ||
      !state.pending ||
      state.listeners.size === 0
    ) {
      return;
    }
    const request = state.pending;
    state.pending = null;
    state.inFlight = true;
    let succeeded = false;
    let retryAfterMilliseconds = 0;
    try {
      const results = await Promise.allSettled(
        [...state.listeners].map((listener) => Promise.resolve(listener(request))),
      );
      succeeded = results.every((result) => result.status === "fulfilled");
      retryAfterMilliseconds = Math.max(
        0,
        ...results.flatMap((result) =>
          result.status === "rejected" ? [retryAfterFromError(result.reason)] : [],
        ),
      );
    } finally {
      state.inFlight = false;
      if (succeeded) {
        state.retryAttempt = 0;
      } else {
        state.pending = mergeRequests(request, state.pending);
        state.retryAttempt += 1;
      }
      await this.persist(state);
      const retryDelay = succeeded
        ? conversationSyncCoalesceMilliseconds
        : Math.max(conversationSyncRetryDelay(state.retryAttempt), retryAfterMilliseconds);
      this.schedule(state, retryDelay);
    }
  }

  private persist(state: AccountSyncState): Promise<void> {
    const snapshot = state.pending;
    const mutation = state.mutation
      .catch(() => undefined)
      .then(() =>
        snapshot
          ? AsyncStorage.setItem(pendingKey(state.ownerId), JSON.stringify(snapshot))
          : AsyncStorage.removeItem(pendingKey(state.ownerId)),
      );
    state.mutation = mutation;
    return mutation.then(() => undefined);
  }
}

export const conversationSyncCoordinator = new ConversationSyncCoordinator();

export function conversationSyncRequestTargets(
  request: ConversationSyncRequest,
  conversationType: ConversationSyncTargetType,
  conversationId: string,
): boolean {
  if (request.full) return true;
  const id = conversationId.trim();
  return request.targets.some(
    (target) => target.conversation_type === conversationType && target.conversation_id === id,
  );
}

function createRequest(
  ownerId: string,
  reason: string,
  target?: ConversationSyncTarget,
): ConversationSyncRequest {
  const normalizedTarget = normalizeTarget(target);
  return {
    owner_id: ownerId,
    reasons: [reason.trim() || "external"],
    full: !normalizedTarget,
    targets: normalizedTarget ? [normalizedTarget] : [],
    requested_at: Date.now(),
  };
}

function mergeRequests(
  first: ConversationSyncRequest | null,
  second: ConversationSyncRequest | null,
): ConversationSyncRequest | null {
  if (!first) return second;
  if (!second) return first;
  const targets = new Map<string, ConversationSyncTarget>();
  for (const target of [...first.targets, ...second.targets]) {
    const key = `${target.conversation_type}:${target.conversation_id}`;
    const previous = targets.get(key);
    targets.set(key, {
      ...target,
      ...(Math.max(previous?.message_id ?? 0, target.message_id ?? 0) > 0
        ? { message_id: Math.max(previous?.message_id ?? 0, target.message_id ?? 0) }
        : {}),
      ...(Math.max(previous?.message_version ?? 0, target.message_version ?? 0) > 0
        ? {
            message_version: Math.max(previous?.message_version ?? 0, target.message_version ?? 0),
          }
        : {}),
    });
  }
  return {
    owner_id: first.owner_id,
    reasons: [...new Set([...first.reasons, ...second.reasons])],
    full: first.full || second.full,
    targets: [...targets.values()],
    requested_at: Math.max(first.requested_at, second.requested_at),
  };
}

function normalizeTarget(
  target: ConversationSyncTarget | undefined,
): ConversationSyncTarget | null {
  if (!target) return null;
  const id = target.conversation_id.trim();
  if (!id) return null;
  const messageId = target.message_id;
  const messageVersion = target.message_version;
  return {
    conversation_type: target.conversation_type,
    conversation_id: id,
    ...(messageId !== undefined && Number.isSafeInteger(messageId) && messageId > 0
      ? { message_id: messageId }
      : {}),
    ...(messageVersion !== undefined && Number.isSafeInteger(messageVersion) && messageVersion > 0
      ? { message_version: messageVersion }
      : {}),
  };
}

function parseStoredRequest(
  encoded: string | null,
  ownerId: string,
): ConversationSyncRequest | null {
  if (!encoded) return null;
  try {
    const value: unknown = JSON.parse(encoded);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = value as Partial<ConversationSyncRequest>;
    if (raw.owner_id !== ownerId) return null;
    const targets = Array.isArray(raw.targets)
      ? raw.targets.flatMap((target) => {
          if (!target || typeof target !== "object" || Array.isArray(target)) return [];
          const normalized = normalizeTarget(target as ConversationSyncTarget);
          return normalized ? [normalized] : [];
        })
      : [];
    return {
      owner_id: ownerId,
      reasons: Array.isArray(raw.reasons)
        ? raw.reasons.filter((reason): reason is string => typeof reason === "string" && !!reason)
        : ["persisted_trigger"],
      full: raw.full === true,
      targets,
      requested_at:
        typeof raw.requested_at === "number" && Number.isFinite(raw.requested_at)
          ? raw.requested_at
          : Date.now(),
    };
  } catch {
    return null;
  }
}

function pendingKey(ownerId: string): string {
  return `${pendingKeyPrefix}:${encodeURIComponent(ownerId)}`;
}

function retryAfterFromError(error: unknown): number {
  if (!error || typeof error !== "object" || !("retryAfterMilliseconds" in error)) return 0;
  const value = (error as { retryAfterMilliseconds?: unknown }).retryAfterMilliseconds;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(value, 5 * 60_000)
    : 0;
}
