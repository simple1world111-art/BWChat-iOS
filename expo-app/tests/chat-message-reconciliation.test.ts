import {
  chatMessageReconciliationPolicy,
  reconcileChatMessageContext,
} from "@/services/messages/ChatMessageReconciliation";

describe("chat message reconciliation", () => {
  it("retries an exact canonical ID across a temporarily lagging history projection", async () => {
    const fetchContext = jest
      .fn<Promise<{ id: number }[]>, []>()
      .mockRejectedValueOnce(new Error("not visible"))
      .mockResolvedValueOnce([{ id: 40 }])
      .mockResolvedValueOnce([{ id: 40 }, { id: 41 }]);
    const wait = jest.fn(async () => undefined);

    await expect(
      reconcileChatMessageContext(41, fetchContext, {
        retryDelaysMilliseconds: [0, 300, 700],
        wait,
      }),
    ).resolves.toEqual({ status: "found", messages: [{ id: 40 }, { id: 41 }] });
    expect(fetchContext).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[300], [700]]);
  });

  it("stops without another fetch when the route/account session changes", async () => {
    let current = true;
    const fetchContext = jest.fn(async () => {
      current = false;
      return [{ id: 50 }];
    });

    await expect(
      reconcileChatMessageContext(50, fetchContext, { isCurrent: () => current }),
    ).resolves.toEqual({ status: "cancelled" });
    expect(fetchContext).toHaveBeenCalledTimes(1);
  });

  it("keeps the retry window bounded", () => {
    expect(chatMessageReconciliationPolicy.retryDelaysMilliseconds).toEqual([
      0, 300, 700, 1_500, 3_000, 5_000, 8_000,
    ]);
  });
});
