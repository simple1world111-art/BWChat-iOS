import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  ConversationSyncCoordinator,
  conversationSyncCoalesceMilliseconds,
  conversationSyncRetryDelay,
} from "@/services/conversations/ConversationSyncCoordinator";

describe("account conversation sync coordinator", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    await AsyncStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("coalesces triggers and permits only one catch-up flight with one queued rerun", async () => {
    const coordinator = new ConversationSyncCoordinator();
    const firstFlight = deferred<void>();
    const listener = jest
      .fn<Promise<void>, [unknown]>()
      .mockImplementationOnce(() => firstFlight.promise)
      .mockResolvedValue(undefined);
    coordinator.start("owner-a");
    coordinator.subscribe("owner-a", listener);

    await Promise.all([
      coordinator.request("owner-a", "push", {
        conversation_type: "dm",
        conversation_id: "friend-a",
        message_id: 7,
        message_version: 1,
      }),
      coordinator.request("owner-a", "ws_hint", {
        conversation_type: "dm",
        conversation_id: "friend-a",
        message_id: 9,
        message_version: 3,
      }),
    ]);
    await advance(conversationSyncCoalesceMilliseconds);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      owner_id: "owner-a",
      reasons: expect.arrayContaining(["push", "ws_hint"]),
      targets: [
        {
          conversation_type: "dm",
          conversation_id: "friend-a",
          message_id: 9,
          message_version: 3,
        },
      ],
    });

    await coordinator.request("owner-a", "foreground");
    await advance(5_000);
    expect(listener).toHaveBeenCalledTimes(1);
    firstFlight.resolve();
    await advance(conversationSyncCoalesceMilliseconds);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]?.[0]).toMatchObject({ full: true, reasons: ["foreground"] });
  });

  it("persists an offline trigger and consumes it after a fresh coordinator starts online", async () => {
    const offline = new ConversationSyncCoordinator();
    offline.start("owner-b");
    offline.setNetworkAvailable("owner-b", false);
    offline.subscribe("owner-b", jest.fn());
    await offline.request("owner-b", "cold_push", {
      conversation_type: "group",
      conversation_id: "31",
      message_id: 88,
    });
    await advance(2_000);
    offline.stop("owner-b");

    const restored = new ConversationSyncCoordinator();
    const listener = jest.fn().mockResolvedValue(undefined);
    restored.start("owner-b");
    restored.subscribe("owner-b", listener);
    await advance(conversationSyncCoalesceMilliseconds);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      reasons: ["cold_push"],
      targets: [{ conversation_type: "group", conversation_id: "31", message_id: 88 }],
    });
  });

  it("uses bounded full-jitter for retry scheduling", () => {
    expect(conversationSyncRetryDelay(0, () => 0)).toBe(0);
    expect(conversationSyncRetryDelay(1, () => 0.5)).toBe(1_000);
    expect(conversationSyncRetryDelay(99, () => 1)).toBe(30_000);
  });

  it("does not retry before a server-provided Retry-After window", async () => {
    const coordinator = new ConversationSyncCoordinator();
    const listener = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("rate limited"), { retryAfterMilliseconds: 5_000 }),
      )
      .mockResolvedValue(undefined);
    coordinator.start("owner-rate-limited");
    coordinator.subscribe("owner-rate-limited", listener);
    await coordinator.request("owner-rate-limited", "push");
    await advance(conversationSyncCoalesceMilliseconds);
    expect(listener).toHaveBeenCalledTimes(1);

    await advance(4_999);
    expect(listener).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps a mixed direct/group message burst targeted instead of escalating it to full", async () => {
    const coordinator = new ConversationSyncCoordinator();
    const listener = jest.fn().mockResolvedValue(undefined);
    coordinator.start("owner-c");
    coordinator.subscribe("owner-c", listener);

    await Promise.all([
      coordinator.request("owner-c", "direct_message_hint", {
        conversation_type: "dm",
        conversation_id: "friend-a",
        message_id: 12,
        message_version: 2,
      }),
      coordinator.request("owner-c", "group_message_hint", {
        conversation_type: "group",
        conversation_id: "31",
        message_id: 90,
        message_version: 4,
      }),
    ]);
    await advance(conversationSyncCoalesceMilliseconds);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      full: false,
      targets: expect.arrayContaining([
        {
          conversation_type: "dm",
          conversation_id: "friend-a",
          message_id: 12,
          message_version: 2,
        },
        {
          conversation_type: "group",
          conversation_id: "31",
          message_id: 90,
          message_version: 4,
        },
      ]),
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function advance(milliseconds: number): Promise<void> {
  await jest.advanceTimersByTimeAsync(milliseconds);
  await Promise.resolve();
}
