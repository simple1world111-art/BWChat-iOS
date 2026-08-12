import {
  chatMediaUploadSchedulePolicy,
  startChatMediaUploadsAfterOptimisticRender,
} from "@/services/messages/ChatMediaSendScheduler";

describe("chat media send scheduler", () => {
  let scheduledFrames: FrameRequestCallback[];
  let requestFrame: jest.SpyInstance;
  let cancelFrame: jest.SpyInstance;

  beforeEach(() => {
    scheduledFrames = [];
    requestFrame = jest
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((callback) => {
        scheduledFrames.push(callback);
        return 16 + scheduledFrames.length;
      });
    cancelFrame = jest
      .spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
    jest.useRealTimers();
  });

  it("waits through a complete optimistic frame and starts every upload independently", async () => {
    const failure = new Error("first failed");
    const first = jest.fn(async () => {
      throw failure;
    });
    const second = jest.fn(async () => undefined);
    const firstError = jest.fn();
    const secondError = jest.fn();

    startChatMediaUploadsAfterOptimisticRender([
      { start: first, onError: firstError },
      { start: second, onError: secondError },
    ]);

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    scheduledFrames.shift()?.(0);
    await flushMicrotasks();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    scheduledFrames.shift()?.(16);
    await flushMicrotasks();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(firstError).toHaveBeenCalledWith(failure);
    expect(secondError).not.toHaveBeenCalled();
  });

  it("uses the bounded timeout fallback and never starts a batch twice", async () => {
    jest.useFakeTimers();
    const start = jest.fn(async () => undefined);

    startChatMediaUploadsAfterOptimisticRender([{ start, onError: jest.fn() }]);
    await jest.advanceTimersByTimeAsync(chatMediaUploadSchedulePolicy.fallbackDelayMilliseconds);
    await flushMicrotasks();
    expect(start).toHaveBeenCalledTimes(1);

    scheduledFrames.shift()?.(0);
    scheduledFrames.shift()?.(16);
    await flushMicrotasks();
    expect(start).toHaveBeenCalledTimes(1);
  });
});

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
