import { getChatSync, getConversationSyncSnapshot } from "@/api/bwchat";
import type { ChatSyncEvent, ChatSyncPage, ConversationSyncSnapshot } from "@/models";
import {
  loadConversationSnapshotWithNativeCache,
  publishConversationSnapshotUpdate,
} from "@/services/conversations/ConversationRepository";
import {
  messagingSyncV2Enabled,
  readCachedRemoteConfig,
} from "@/services/remote-config/RemoteConfigService";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";

export const chatSyncPageLimit = 100;
export const chatSyncMaximumPages = 50;
export const chatSyncPageTimeoutMilliseconds = 10_000;

export interface ChatSyncCatchUpResult {
  mode: "delta" | "snapshot";
  cursor: number;
  page_count: number;
  event_count: number;
  full_sync_required: boolean;
}

export interface ChatSyncCatchUpDependencies {
  v2Enabled: boolean;
  readCursor(): Promise<number>;
  fetchDeltaPage(
    afterEventSequence: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<ChatSyncPage>;
  ingestDeltaPage(events: readonly ChatSyncEvent[]): Promise<number>;
  loadAuthoritativeSnapshot(signal?: AbortSignal): Promise<ConversationSyncSnapshot>;
  publishAuthoritativeSnapshot(snapshot: ConversationSyncSnapshot): void;
  acknowledgeSnapshot(eventSequence: number): Promise<void>;
}

/**
 * Runs one coordinator-owned catch-up flight. The old backend path never probes
 * `/chat/sync`; v2 paginates a maximum of 5,000 events and advances only via
 * the realtime service's durable canonical ingest.
 */
export async function runChatSyncCatchUp(
  dependencies: ChatSyncCatchUpDependencies,
  signal?: AbortSignal,
): Promise<ChatSyncCatchUpResult> {
  throwIfAborted(signal);
  if (!dependencies.v2Enabled) {
    return applyAuthoritativeSnapshot(dependencies, false, signal);
  }

  let cursor = await dependencies.readCursor();
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("chat_sync_cursor_invalid");
  let eventCount = 0;
  let previousSnapshotRevision: number | undefined;

  for (let pageIndex = 0; pageIndex < chatSyncMaximumPages; pageIndex += 1) {
    throwIfAborted(signal);
    const page = await withPageTimeout(
      (pageSignal) => dependencies.fetchDeltaPage(cursor, chatSyncPageLimit, pageSignal),
      signal,
    );
    if (page.full_sync_required) {
      return applyAuthoritativeSnapshot(dependencies, true, signal, pageIndex + 1, eventCount);
    }
    assertDeltaPage(page, cursor, previousSnapshotRevision);
    previousSnapshotRevision = page.snapshot_revision;
    if (page.events.length > 0) {
      const appliedCursor = await dependencies.ingestDeltaPage(page.events);
      if (appliedCursor !== page.next_event_seq) {
        throw new Error("chat_sync_cursor_not_durable");
      }
      cursor = appliedCursor;
      eventCount += page.events.length;
    }
    if (!page.has_more) {
      return {
        mode: "delta",
        cursor,
        page_count: pageIndex + 1,
        event_count: eventCount,
        full_sync_required: false,
      };
    }
    // `has_more` without cursor progress would otherwise spin until the page cap
    // and hammer a weak network with identical requests.
    if (page.events.length === 0) throw new Error("chat_sync_pagination_stalled");
  }
  throw new Error("chat_sync_page_limit_exceeded");
}

export async function catchUpConversationState(
  ownerId: string,
  signal?: AbortSignal,
  options: { forceAuthoritativeSnapshot?: boolean } = {},
): Promise<ChatSyncCatchUpResult> {
  const owner = ownerId.trim();
  if (!owner) throw new Error("chat_sync_owner_required");
  const config = await readCachedRemoteConfig(owner).catch(() => null);
  const v2Enabled = config ? messagingSyncV2Enabled(config) : false;
  return runChatSyncCatchUp(
    {
      v2Enabled: v2Enabled && options.forceAuthoritativeSnapshot !== true,
      readCursor: () => chatRealtimeService.persistedEventSequence(owner),
      fetchDeltaPage: (afterEventSequence, limit, pageSignal) =>
        getChatSync(afterEventSequence, limit, pageSignal),
      ingestDeltaPage: (events) => chatRealtimeService.ingestCatchUpPage(owner, events),
      loadAuthoritativeSnapshot: (snapshotSignal) =>
        loadConversationSnapshotWithNativeCache(
          owner,
          () => getConversationSyncSnapshot(snapshotSignal),
          { forceRefresh: true, allowStaleOnError: false },
        ),
      publishAuthoritativeSnapshot: (snapshot) =>
        publishConversationSnapshotUpdate(owner, snapshot),
      acknowledgeSnapshot: (eventSequence) =>
        chatRealtimeService.acknowledgeCatchUp(owner, eventSequence),
    },
    signal,
  );
}

function assertDeltaPage(
  page: ChatSyncPage,
  afterEventSequence: number,
  previousSnapshotRevision: number | undefined,
): void {
  if (page.events.length > chatSyncPageLimit) throw new Error("chat_sync_page_too_large");
  if (previousSnapshotRevision !== undefined && page.snapshot_revision < previousSnapshotRevision) {
    throw new Error("chat_sync_snapshot_revision_regressed");
  }
  if (page.events.length === 0) {
    if (page.next_event_seq !== afterEventSequence) {
      throw new Error("chat_sync_empty_page_advanced_cursor");
    }
    return;
  }
  const firstSequence = page.events[0]!.event_sequence;
  const lastSequence = page.events.at(-1)!.event_sequence;
  if (firstSequence !== afterEventSequence + 1) throw new Error("chat_sync_sequence_gap");
  if (lastSequence !== page.next_event_seq) throw new Error("chat_sync_cursor_mismatch");
}

async function applyAuthoritativeSnapshot(
  dependencies: ChatSyncCatchUpDependencies,
  fullSyncRequired: boolean,
  signal?: AbortSignal,
  pageCount = 0,
  eventCount = 0,
): Promise<ChatSyncCatchUpResult> {
  throwIfAborted(signal);
  const snapshot = await dependencies.loadAuthoritativeSnapshot(signal);
  throwIfAborted(signal);
  dependencies.publishAuthoritativeSnapshot(snapshot);
  const eventSequence = snapshot.event_sequence;
  if (fullSyncRequired && eventSequence === undefined) {
    throw new Error("chat_sync_snapshot_cursor_missing");
  }
  if (eventSequence !== undefined) await dependencies.acknowledgeSnapshot(eventSequence);
  return {
    mode: "snapshot",
    cursor: eventSequence ?? (await dependencies.readCursor()),
    page_count: pageCount,
    event_count: eventCount,
    full_sync_required: fullSyncRequired,
  };
}

async function withPageTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, chatSyncPageTimeoutMilliseconds);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abort);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("chat_sync_aborted");
}
