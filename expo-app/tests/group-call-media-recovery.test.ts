import { retryCallMediaPublication } from "@/services/calls/CallMediaRecovery";

describe("group call media recovery", () => {
  it("retries a missing microphone publication three times with native 500ms spacing", async () => {
    const publish = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error("one"))
      .mockRejectedValueOnce(new Error("two"))
      .mockResolvedValue(undefined);
    const wait = jest.fn(async () => undefined);

    await expect(retryCallMediaPublication(publish, () => true, wait)).resolves.toBe(true);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 500);
    expect(wait).toHaveBeenNthCalledWith(2, 500);
  });

  it("stops immediately when a newer session generation invalidates recovery", async () => {
    let current = true;
    const publish = jest.fn(async () => {
      current = false;
      throw new Error("stale");
    });
    const wait = jest.fn(async () => undefined);

    await expect(retryCallMediaPublication(publish, () => current, wait)).resolves.toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("contains the terminal failure without replacing the original call error", async () => {
    const publish = jest.fn(async () => {
      throw new Error("unavailable");
    });
    await expect(
      retryCallMediaPublication(
        publish,
        () => true,
        async () => undefined,
      ),
    ).resolves.toBe(false);
    expect(publish).toHaveBeenCalledTimes(3);
  });
});
