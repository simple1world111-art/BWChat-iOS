import {
  CallQualityAccumulator,
  CallQualityService,
  collectCallQualitySample,
} from "@/services/calls/CallQualityService";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("call quality sampling and end lifecycle", () => {
  afterEach(() => jest.useRealTimers());

  it("keeps the latest native fields and derives sender/receiver bitrates", () => {
    const accumulator = new CallQualityAccumulator();
    accumulator.record({
      outbound: { bytes: 1_000, timestamp: 1_000, width: 640, fps: 24 },
      inbound: { bytes: 2_000, timestamp: 1_000, height: 720 },
      iceTransport: "udp",
      relay: false,
    });
    accumulator.record({
      outbound: { bytes: 4_000, timestamp: 4_000, width: 1280, packetsLost: 2 },
      inbound: { bytes: 5_000, timestamp: 4_000, freezeCount: 1 },
      iceTransport: "turn_tcp",
      relay: true,
    });
    expect(accumulator.report("17")).toEqual({
      appBuild: "17",
      sampleCount: 2,
      outbound: { width: 1280, fps: 24, packetsLost: 2, bitrateBps: 8_000 },
      inbound: { height: 720, freezeCount: 1, bitrateBps: 8_000 },
      iceTransport: "turn_tcp",
      relay: true,
    });
  });

  it("extracts every Swift payload field and the selected relay transport", async () => {
    const local = track([
      { id: "transport", type: "transport", selectedCandidatePairId: "pair" },
      { id: "pair", type: "candidate-pair", localCandidateId: "local" },
      { id: "local", type: "local-candidate", candidateType: "relay", protocol: "tcp", relayProtocol: "tls" },
      { id: "out", type: "outbound-rtp", kind: "video", active: true, bytesSent: 10_000, timestamp: 1_000, frameWidth: 1280, frameHeight: 720, framesPerSecond: 30, nackCount: 2, pliCount: 3, firCount: 4, qualityLimitationReason: "cpu" },
      { id: "feedback", type: "remote-inbound-rtp", kind: "video", packetsLost: 5, roundTripTime: 0.08, fractionLost: 0.04 },
    ]);
    const remote = track([
      { id: "in", type: "inbound-rtp", kind: "video", bytesReceived: 20_000, timestamp: 1_000, frameWidth: 960, frameHeight: 540, framesPerSecond: 25, packetsLost: 6, nackCount: 7, pliCount: 8, firCount: 9, framesDropped: 10, freezeCount: 2 },
      { id: "remote-feedback", type: "remote-outbound-rtp", kind: "video", roundTripTime: 0.12 },
    ]);
    await expect(collectCallQualitySample(local, remote)).resolves.toEqual({
      outbound: {
        bytes: 10_000,
        timestamp: 1_000,
        width: 1280,
        height: 720,
        fps: 30,
        packetsLost: 5,
        nackCount: 2,
        pliCount: 3,
        firCount: 4,
        rttMs: 80,
        fractionLost: 0.04,
        qualityLimitationReason: "cpu",
      },
      inbound: {
        bytes: 20_000,
        timestamp: 1_000,
        width: 960,
        height: 540,
        fps: 25,
        packetsLost: 6,
        nackCount: 7,
        pliCount: 8,
        firCount: 9,
        framesDropped: 10,
        freezeCount: 2,
        rttMs: 120,
      },
      iceTransport: "turn_tls",
      relay: true,
    });
  });

  it("samples immediately/every three seconds/finally, then uploads exactly once", async () => {
    jest.useFakeTimers();
    const upload = jest.fn().mockResolvedValue(undefined);
    let sample = 0;
    const collect = jest.fn(async () => ({
      outbound: { bytes: ++sample * 1_000, timestamp: sample * 1_000, fps: 30 },
      iceTransport: "udp",
      relay: false,
    }));
    const service = new CallQualityService(upload, () => "99", jest.fn());
    service.start("session-1", "call-1", collect);
    await flushPromises();
    expect(collect).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(3_000);
    await flushPromises();
    jest.advanceTimersByTime(3_000);
    await flushPromises();
    expect(collect).toHaveBeenCalledTimes(3);
    await expect(service.finish("session-1")).resolves.toBe(true);
    expect(collect).toHaveBeenCalledTimes(4);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith("call-1", expect.objectContaining({
      appBuild: "99",
      sampleCount: 4,
      outbound: expect.objectContaining({ bitrateBps: 8_000 }),
    }));
    await expect(service.finish("session-1")).resolves.toBe(false);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("does not upload audio/empty samples and contains collector/upload failures", async () => {
    jest.useFakeTimers();
    const upload = jest.fn().mockRejectedValue(new Error("offline"));
    const onError = jest.fn();
    const service = new CallQualityService(upload, () => "1", onError);
    service.start("empty", "call-empty", async () => ({}));
    await flushPromises();
    await expect(service.finish("empty")).resolves.toBe(false);
    expect(upload).not.toHaveBeenCalled();

    service.start("video", "call-video", async () => ({ outbound: { fps: 30 } }));
    await flushPromises();
    await expect(service.finish("video")).resolves.toBe(false);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }));
  });

  it("is wired to the video-room mount and unmount lifecycle", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/calls/CallOverlay.tsx"), "utf8");
    expect(source).toContain('session.call_type !== "video" || !session.call_id');
    expect(source).toContain("callQualityService.start(session.id, session.call_id");
    expect(source).toContain("collectCallQualitySample(qualityTracksRef.current.local, qualityTracksRef.current.remote)");
    expect(source).toContain("void callQualityService.finish(session.id)");
  });
});

function track(values: Record<string, unknown>[]) {
  return {
    getRTCStatsReport: async () => ({
      forEach: (callback: (value: Record<string, unknown>) => void) => values.forEach(callback),
    }),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
