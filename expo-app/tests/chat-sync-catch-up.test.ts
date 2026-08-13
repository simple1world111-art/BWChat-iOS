import type { ChatSyncEvent, ChatSyncPage, ConversationSyncSnapshot } from "@/models";
import {
  chatSyncPageLimit,
  chatSyncPageTimeoutMilliseconds,
  runChatSyncCatchUp,
  type ChatSyncCatchUpDependencies,
} from "@/services/conversations/ChatSyncCatchUp";

describe("messaging sync-v2 catch-up", () => {
  it("defaults an old backend to one snapshot and never probes /chat/sync", async () => {
    const dependencies = dependencyHarness({
      v2Enabled: false,
      snapshot: { conversations: [], event_sequence: 40, snapshot_complete: true },
    });

    await expect(runChatSyncCatchUp(dependencies)).resolves.toMatchObject({
      mode: "snapshot",
      cursor: 40,
      page_count: 0,
      full_sync_required: false,
    });
    expect(dependencies.fetchDeltaPage).not.toHaveBeenCalled();
    expect(dependencies.loadAuthoritativeSnapshot).toHaveBeenCalledTimes(1);
    expect(dependencies.publishAuthoritativeSnapshot).toHaveBeenCalledTimes(1);
    expect(dependencies.acknowledgeSnapshot).toHaveBeenCalledWith(40);
  });

  it("paginates a full 100-event page and durably ingests every page in order", async () => {
    const firstEvents = Array.from({ length: chatSyncPageLimit }, (_, index) => event(index + 1));
    const dependencies = dependencyHarness({
      pages: [page(firstEvents, 100, true), page([event(101)], 101, false)],
    });

    await expect(runChatSyncCatchUp(dependencies)).resolves.toEqual({
      mode: "delta",
      cursor: 101,
      page_count: 2,
      event_count: 101,
      full_sync_required: false,
    });
    expect(dependencies.fetchDeltaPage).toHaveBeenNthCalledWith(
      1,
      0,
      chatSyncPageLimit,
      expect.any(AbortSignal),
    );
    expect(dependencies.fetchDeltaPage).toHaveBeenNthCalledWith(
      2,
      100,
      chatSyncPageLimit,
      expect.any(AbortSignal),
    );
    expect(dependencies.ingestDeltaPage).toHaveBeenCalledTimes(2);
    expect(dependencies.loadAuthoritativeSnapshot).not.toHaveBeenCalled();
  });

  it("uses one authoritative snapshot when the server expires the delta cursor", async () => {
    const dependencies = dependencyHarness({
      cursor: 12,
      pages: [
        {
          ...page([], 12, false),
          full_sync_required: true,
        },
      ],
      snapshot: { conversations: [], event_sequence: 500, snapshot_complete: true },
    });

    await expect(runChatSyncCatchUp(dependencies)).resolves.toEqual({
      mode: "snapshot",
      cursor: 500,
      page_count: 1,
      event_count: 0,
      full_sync_required: true,
    });
    expect(dependencies.fetchDeltaPage).toHaveBeenCalledTimes(1);
    expect(dependencies.loadAuthoritativeSnapshot).toHaveBeenCalledTimes(1);
    expect(dependencies.publishAuthoritativeSnapshot).toHaveBeenCalledTimes(1);
    expect(dependencies.acknowledgeSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge or fall back when canonical delta persistence fails", async () => {
    const dependencies = dependencyHarness({ pages: [page([event(1)], 1, false)] });
    jest.mocked(dependencies.ingestDeltaPage).mockRejectedValueOnce(new Error("disk failed"));

    await expect(runChatSyncCatchUp(dependencies)).rejects.toThrow("disk failed");
    expect(dependencies.loadAuthoritativeSnapshot).not.toHaveBeenCalled();
    expect(dependencies.acknowledgeSnapshot).not.toHaveBeenCalled();
    expect(dependencies.fetchDeltaPage).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-progressing has_more page instead of creating a request storm", async () => {
    const dependencies = dependencyHarness({ pages: [page([], 0, true)] });
    await expect(runChatSyncCatchUp(dependencies)).rejects.toThrow("chat_sync_pagination_stalled");
    expect(dependencies.fetchDeltaPage).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled delta page after the bounded per-page timeout", async () => {
    jest.useFakeTimers();
    const dependencies = dependencyHarness();
    jest.mocked(dependencies.fetchDeltaPage).mockImplementation(
      (_cursor, _limit, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("page aborted")), { once: true });
        }),
    );

    const catchUp = expect(runChatSyncCatchUp(dependencies)).rejects.toThrow("page aborted");
    await jest.advanceTimersByTimeAsync(chatSyncPageTimeoutMilliseconds);
    await catchUp;
    jest.useRealTimers();
  });
});

function dependencyHarness(
  options: {
    v2Enabled?: boolean;
    cursor?: number;
    pages?: ChatSyncPage[];
    snapshot?: ConversationSyncSnapshot;
  } = {},
): ChatSyncCatchUpDependencies {
  const pages = [...(options.pages ?? [page([], options.cursor ?? 0, false)])];
  return {
    v2Enabled: options.v2Enabled ?? true,
    readCursor: jest.fn().mockResolvedValue(options.cursor ?? 0),
    fetchDeltaPage: jest.fn().mockImplementation(async () => {
      const next = pages.shift();
      if (!next) throw new Error("unexpected extra page");
      return next;
    }),
    ingestDeltaPage: jest.fn().mockImplementation(async (events: readonly ChatSyncEvent[]) => {
      const last = events.at(-1);
      if (!last) throw new Error("empty ingest");
      return last.event_sequence;
    }),
    loadAuthoritativeSnapshot: jest
      .fn()
      .mockResolvedValue(options.snapshot ?? { conversations: [], event_sequence: 0 }),
    publishAuthoritativeSnapshot: jest.fn(),
    acknowledgeSnapshot: jest.fn().mockResolvedValue(undefined),
  };
}

function event(eventSequence: number): ChatSyncEvent {
  return {
    type: "contact_update",
    event_sequence: eventSequence,
    data: {
      sender_id: "friend",
      receiver_id: "owner",
      message_id: eventSequence,
    },
  };
}

function page(events: ChatSyncEvent[], nextEventSequence: number, hasMore: boolean): ChatSyncPage {
  return {
    events,
    next_event_seq: nextEventSequence,
    has_more: hasMore,
    snapshot_revision: 1,
    server_time: "2026-08-13T10:00:00Z",
    full_sync_required: false,
  };
}
