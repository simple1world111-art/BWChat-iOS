import { act, cleanup, renderHook } from "@testing-library/react-native";

import type { OneToOneLiveSlotPage } from "@/services/live/LiveLobbyModels";
import { useLiveLobby } from "@/services/live/useLiveLobby";
import { clearNavigationSnapshots } from "@/services/navigation/NavigationSnapshotCache";

const mockGetSlots = jest.fn();
const mockGetCurrent = jest.fn();
const mockUploadAvatar = jest.fn();
const mockCreateSlot = jest.fn();
const mockDeleteSlot = jest.fn();
const mockHeartbeatStart = jest.fn();
const mockHeartbeatStop = jest.fn();

jest.mock("expo-crypto", () => ({ randomUUID: () => "live-controller-key" }));

jest.mock("@/services/live/LiveLobbyRepository", () => ({
  createLiveSlot: (...args: unknown[]) => mockCreateSlot(...args),
  deleteLiveSlot: (...args: unknown[]) => mockDeleteSlot(...args),
  getCurrentLiveSlot: (...args: unknown[]) => mockGetCurrent(...args),
  getLiveLobbySlots: (...args: unknown[]) => mockGetSlots(...args),
  uploadLiveAvatar: (...args: unknown[]) => mockUploadAvatar(...args),
}));

jest.mock("@/services/live/LiveLobbyHeartbeatService", () => ({
  liveLobbyHeartbeatService: {
    start: (...args: unknown[]) => mockHeartbeatStart(...args),
    stop: (...args: unknown[]) => mockHeartbeatStop(...args),
  },
}));

jest.mock("@/services/realtime/ChatRealtimeService", () => ({
  chatRealtimeService: {
    subscribe: () => jest.fn(),
    subscribeStatus: () => jest.fn(),
  },
}));

describe("useLiveLobby account and tab lifecycle", () => {
  beforeEach(() => {
    clearNavigationSnapshots();
    jest.clearAllMocks();
    mockGetCurrent.mockResolvedValue(null);
    mockGetSlots.mockResolvedValue(page("recommended-slot", "recommended-user"));
    mockCreateSlot.mockResolvedValue(slot("created-slot", "owner-a"));
    mockDeleteSlot.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("does not relabel the previous recommended snapshot as chatted before that tab resolves", async () => {
    const hook = await renderHook(
      ({ tab }: { tab: "recommended" | "chatted" }) => useLiveLobby("owner-a", tab),
      { initialProps: { tab: "recommended" as const } },
    );
    await act(async () => hook.result.current.refresh("recommended"));
    expect(hook.result.current.participants).toEqual([
      expect.objectContaining({ id: "recommended-slot", hasChatted: false }),
    ]);

    const chattedPage = deferred<OneToOneLiveSlotPage>();
    mockGetSlots.mockReturnValueOnce(chattedPage.promise);
    await hook.rerender({ tab: "chatted" });
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = hook.result.current.refresh("chatted");
      await Promise.resolve();
    });
    expect(hook.result.current.participants).toEqual([
      expect.objectContaining({ id: "recommended-slot", hasChatted: false }),
    ]);

    await act(async () => {
      chattedPage.resolve(page("chatted-slot", "chatted-user"));
      await refresh;
    });
    expect(hook.result.current.participants).toEqual([
      expect.objectContaining({ id: "chatted-slot", hasChatted: true }),
    ]);
  });

  it("restores the last lobby grid synchronously after the account screen remounts", async () => {
    const first = await renderHook(() => useLiveLobby("owner-a", "recommended"));
    await act(async () => first.result.current.refresh("recommended"));
    await first.unmount();

    const restored = await renderHook(() => useLiveLobby("owner-a", "recommended"));

    expect(restored.result.current.hasLoaded).toBe(true);
    expect(restored.result.current.participants).toEqual([
      expect.objectContaining({ id: "recommended-slot", hasChatted: false }),
    ]);
    await restored.unmount();
  });

  it("invalidates a pending start mutation and heartbeat when its account screen unmounts", async () => {
    const creation = deferred<ReturnType<typeof slot>>();
    mockCreateSlot.mockReturnValueOnce(creation.promise);
    const hook = await renderHook(() => useLiveLobby("owner-a", "recommended"));
    let startResult: Promise<unknown> | undefined;
    await act(async () => {
      startResult = hook.result.current.startLive({
        roleSetting: "侦探",
        allowedCallTypes: ["video"],
        avatarUploadIdempotencyKey: "avatar-key",
        slotCreationIdempotencyKey: "slot-key",
      });
      await Promise.resolve();
    });
    await hook.unmount();

    await act(async () => {
      creation.resolve(slot("created-after-unmount", "owner-a"));
      await startResult;
    });

    expect(mockHeartbeatStop).toHaveBeenCalledWith("owner-a");
    expect(mockHeartbeatStart).not.toHaveBeenCalled();
  });
});

function page(id: string, userId: string): OneToOneLiveSlotPage {
  return {
    items: [slot(id, userId)],
    billingPolicy: {
      currency: "spendable_balance",
      freeSeconds: 10,
      unitSeconds: 60,
      amountPerUnit: 100,
      minimumStartingBalance: 100,
      rounding: "started_unit",
    },
    supportedCallTypes: ["video"],
    liveAvatarUploadSupported: true,
  };
}

function slot(id: string, userId: string) {
  return {
    id,
    status: "waiting",
    characterSetting: "侦探",
    liveAvatarUrl: "",
    allowedCallTypes: ["video" as const],
    user: {
      userId,
      username: userId,
      nickname: userId,
      avatarUrl: "",
      gender: "",
    },
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
