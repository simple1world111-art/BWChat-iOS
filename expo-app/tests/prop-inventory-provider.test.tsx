import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";

import { PropInventoryProvider, usePropInventory } from "@/providers/PropInventoryProvider";
import {
  publishCallSettlementRefresh,
  subscribeCallSettlementRefresh,
} from "@/services/calls/CallSettlementRefreshService";
import { getPropBag } from "@/services/props/PropInventoryRepository";
import type { PropBagPage } from "@/services/props/PropInventoryModels";

let mockUser: { user_id: string } | null = null;

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/services/props/PropInventoryRepository", () => ({
  getPropBag: jest.fn(),
}));

const mockGetPropBag = jest.mocked(getPropBag);

describe("PropInventoryProvider account scope", () => {
  beforeEach(() => {
    mockUser = null;
    mockGetPropBag.mockReset();
  });

  it("does not load anonymously and remounts clean inventory state for a new account", async () => {
    const first = deferred<PropBagPage>();
    mockGetPropBag.mockReturnValueOnce(first.promise);

    const view = await render(
      <PropInventoryProvider>
        <InventoryProbe />
      </PropInventoryProvider>,
    );
    await fireEvent.press(screen.getByTestId("load-props"));
    expect(mockGetPropBag).not.toHaveBeenCalled();

    mockUser = { user_id: "first-user" };
    await view.rerender(
      <PropInventoryProvider>
        <InventoryProbe />
      </PropInventoryProvider>,
    );
    await fireEvent.press(screen.getByTestId("load-props"));
    expect(mockGetPropBag).toHaveBeenCalledTimes(1);

    mockUser = { user_id: "second-user" };
    mockGetPropBag.mockResolvedValueOnce(page("second-prop"));
    await view.rerender(
      <PropInventoryProvider>
        <InventoryProbe />
      </PropInventoryProvider>,
    );
    expect(screen.getByTestId("prop-ids").props.children).toBe("");
    await fireEvent.press(screen.getByTestId("load-props"));
    await screen.findByText("second-prop");

    await act(async () => {
      first.resolve(page("stale-first-prop"));
      await first.promise;
    });
    expect(screen.getByText("second-prop")).toBeTruthy();
    expect(screen.queryByText("stale-first-prop")).toBeNull();
  });

  it("matches the native 60-second cache, force refresh, and single-flight load policy", async () => {
    mockUser = { user_id: "owner" };
    const initial = deferred<PropBagPage>();
    mockGetPropBag.mockReturnValueOnce(initial.promise).mockResolvedValueOnce(page("forced-prop"));
    await render(
      <PropInventoryProvider>
        <InventoryProbe />
      </PropInventoryProvider>,
    );

    await fireEvent.press(screen.getByTestId("load-props"));
    await fireEvent.press(screen.getByTestId("load-props"));
    expect(mockGetPropBag).toHaveBeenCalledTimes(1);

    await act(async () => {
      initial.resolve(page("cached-prop"));
      await initial.promise;
    });
    await screen.findByText("cached-prop");
    await fireEvent.press(screen.getByTestId("load-props"));
    expect(mockGetPropBag).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId("force-load-props"));
    await screen.findByText("forced-prop");
    expect(mockGetPropBag).toHaveBeenCalledTimes(2);
  });

  it("queues one authoritative settlement reload in event order for only the current owner", async () => {
    mockUser = { user_id: "owner-a" };
    const stale = deferred<PropBagPage>();
    mockGetPropBag.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(page("settled-prop"));
    const view = await render(
      <PropInventoryProvider>
        <InventoryProbe />
      </PropInventoryProvider>,
    );

    await fireEvent.press(screen.getByTestId("load-props"));
    await act(async () => {
      publishCallSettlementRefresh("owner-b", "other-session");
      publishCallSettlementRefresh("owner-a", "settled-session-1");
      publishCallSettlementRefresh("owner-a", "settled-session-2");
    });
    expect(mockGetPropBag).toHaveBeenCalledTimes(1);

    await act(async () => {
      stale.resolve(page("stale-prop"));
      await stale.promise;
      await flushTasks();
    });
    await screen.findByText("settled-prop");
    expect(mockGetPropBag).toHaveBeenCalledTimes(2);

    await act(async () => view.unmount());
    await act(async () => {
      publishCallSettlementRefresh("owner-a", "after-unmount");
    });
    expect(mockGetPropBag).toHaveBeenCalledTimes(2);
  });

  it("recovers a failed settlement refresh without leaking data across A to B to A remounts", async () => {
    mockUser = { user_id: "owner-a" };
    mockGetPropBag.mockRejectedValueOnce(new Error("temporary failure"));
    const view = await render(
      <PropInventoryProvider>
        <InventoryProbe />
      </PropInventoryProvider>,
    );

    await act(async () => {
      publishCallSettlementRefresh("owner-a", "failed-a");
      await flushTasks();
    });
    expect(mockGetPropBag).toHaveBeenCalledTimes(1);

    mockUser = { user_id: "owner-b" };
    mockGetPropBag.mockResolvedValueOnce(page("owner-b-prop"));
    await view.rerender(
      <PropInventoryProvider>
        <InventoryProbe />
      </PropInventoryProvider>,
    );
    await act(async () => {
      publishCallSettlementRefresh("owner-b", "owner-b-session");
    });
    await screen.findByText("owner-b-prop");

    mockUser = { user_id: "owner-a" };
    mockGetPropBag.mockResolvedValueOnce(page("owner-a-current"));
    await view.rerender(
      <PropInventoryProvider>
        <InventoryProbe />
      </PropInventoryProvider>,
    );
    expect(screen.getByTestId("prop-ids").props.children).toBe("");
    await act(async () => {
      publishCallSettlementRefresh("owner-a", "owner-a-current-session");
    });
    await screen.findByText("owner-a-current");
    expect(screen.queryByText("owner-b-prop")).toBeNull();
  });

  it("isolates a throwing settlement listener and preserves monotonic event ordering", () => {
    const received: number[] = [];
    const unsubscribeThrowing = subscribeCallSettlementRefresh(() => {
      throw new Error("listener failed");
    });
    const unsubscribeReceiving = subscribeCallSettlementRefresh((event) => {
      if (event.ownerId === "ordered-owner") received.push(event.sequence);
    });

    publishCallSettlementRefresh("ordered-owner", "one");
    publishCallSettlementRefresh("ordered-owner", "two");
    unsubscribeThrowing();
    unsubscribeReceiving();

    expect(received).toHaveLength(2);
    expect(received[1]).toBeGreaterThan(received[0] ?? 0);
  });
});

function InventoryProbe() {
  const inventory = usePropInventory();
  return (
    <>
      <Text testID="prop-ids">{inventory.items.map((item) => item.inventoryId).join(",")}</Text>
      <Pressable onPress={() => void inventory.load()} testID="load-props">
        <Text>load</Text>
      </Pressable>
      <Pressable onPress={() => void inventory.load(true)} testID="force-load-props">
        <Text>force load</Text>
      </Pressable>
    </>
  );
}

function page(inventoryId: string): PropBagPage {
  return {
    items: [
      {
        inventoryId,
        definitionId: "media_unlock_card_image",
        type: "media_unlock_card",
        name: inventoryId,
        description: "",
        quantity: 1,
        isEquipped: false,
        availableActions: ["consume_for_media_unlock"],
      },
    ],
    summary: { totalQuantity: 1, equippedCount: 0, expiringCount: 0 },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
