import { getNetworkStateAsync } from "expo-network";

import {
  cancelChatOutboxNetworkRetry,
  chatOutboxNetworkRetryDelayMilliseconds,
  isChatOutboxDefinitelyOffline,
  scheduleChatOutboxNetworkRetry,
} from "@/services/messages/ChatOutboxNetwork";

jest.mock("expo-network", () => ({ getNetworkStateAsync: jest.fn() }));

const getNetworkState = jest.mocked(getNetworkStateAsync);

describe("chat outbox network gate", () => {
  beforeEach(() => getNetworkState.mockReset());

  it.each([
    { isConnected: false, isInternetReachable: false },
    { isConnected: false },
    { isConnected: true, isInternetReachable: false },
  ])("blocks transport for a definitely offline state %#", async (state) => {
    getNetworkState.mockResolvedValueOnce(state);
    await expect(isChatOutboxDefinitelyOffline()).resolves.toBe(true);
  });

  it.each([{}, { isConnected: true }, { isConnected: true, isInternetReachable: true }])(
    "allows transport when reachability is online or unknown %#",
    async (state) => {
      getNetworkState.mockResolvedValueOnce(state);
      await expect(isChatOutboxDefinitelyOffline()).resolves.toBe(false);
    },
  );

  it("fails open when the native network probe is unavailable", async () => {
    getNetworkState.mockRejectedValueOnce(new Error("unavailable"));
    await expect(isChatOutboxDefinitelyOffline()).resolves.toBe(false);
  });

  it("coalesces deferred jobs behind one probe and resumes all when online", async () => {
    jest.useFakeTimers();
    const first = jest.fn();
    const second = jest.fn();
    getNetworkState.mockResolvedValueOnce({ isConnected: true, isInternetReachable: true });
    scheduleChatOutboxNetworkRetry("direct:one", first);
    scheduleChatOutboxNetworkRetry("group:two", second);

    await jest.advanceTimersByTimeAsync(chatOutboxNetworkRetryDelayMilliseconds);

    expect(getNetworkState).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    cancelChatOutboxNetworkRetry("direct:one");
    cancelChatOutboxNetworkRetry("group:two");
    jest.useRealTimers();
  });

  it("cancels the deferred callback and its last shared probe", async () => {
    jest.useFakeTimers();
    const resume = jest.fn();
    scheduleChatOutboxNetworkRetry("direct:cancelled", resume);
    cancelChatOutboxNetworkRetry("direct:cancelled");

    await jest.advanceTimersByTimeAsync(chatOutboxNetworkRetryDelayMilliseconds);

    expect(getNetworkState).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
