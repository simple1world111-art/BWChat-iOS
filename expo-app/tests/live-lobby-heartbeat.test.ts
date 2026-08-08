import { LiveLobbyHeartbeatService } from "@/services/live/LiveLobbyHeartbeatService";

describe("live lobby persistent heartbeat lease", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("keeps one 25-second heartbeat alive independently of a screen effect", async () => {
    const heartbeat = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const service = new LiveLobbyHeartbeatService(heartbeat);
    service.start("owner-1", "slot-1");
    service.start("owner-1", "slot-1");

    expect(service.snapshot()).toEqual({ ownerId: "owner-1", slotId: "slot-1" });
    expect(heartbeat).not.toHaveBeenCalled();
    jest.advanceTimersByTime(25_000);
    await Promise.resolve();
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledWith("slot-1");
  });

  it("replaces the lease on an account/slot switch and stops only matching leases", async () => {
    const heartbeat = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const service = new LiveLobbyHeartbeatService(heartbeat);
    service.start("owner-1", "slot-1");
    service.start("owner-2", "slot-2");
    service.stop("owner-1");

    jest.advanceTimersByTime(25_000);
    await Promise.resolve();
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledWith("slot-2");
    service.stop("owner-2", "slot-2");
    expect(service.snapshot()).toBeUndefined();
  });

  it("stops on a matching ended signal but ignores another host's tombstone", () => {
    const service = new LiveLobbyHeartbeatService(jest.fn().mockResolvedValue(undefined));
    service.start("owner-1", "slot-1");
    service.handleSignal("one_to_one_live.slot.ended", {
      slot_id: "slot-other",
      host_user_id: "owner-other",
    });
    expect(service.snapshot()).toEqual({ ownerId: "owner-1", slotId: "slot-1" });
    service.handleSignal("one_to_one_live.slot.updated", {
      slot_id: "slot-1",
      host_user_id: "owner-1",
      status: "closed",
    });
    expect(service.snapshot()).toBeUndefined();
  });

  it("stops retrying after a terminal heartbeat response", async () => {
    const heartbeat = jest.fn<Promise<void>, [string]>().mockRejectedValue({ status: 410 });
    const service = new LiveLobbyHeartbeatService(heartbeat);
    service.start("owner-1", "slot-1");
    jest.advanceTimersByTime(25_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(service.snapshot()).toBeUndefined();
  });

  it("waits for an in-flight heartbeat before sending the next interval", async () => {
    let resolveHeartbeat: (() => void) | undefined;
    const heartbeat = jest.fn<Promise<void>, [string]>().mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveHeartbeat = resolve;
      }),
    );
    const service = new LiveLobbyHeartbeatService(heartbeat);
    service.start("owner-1", "slot-1");

    jest.advanceTimersByTime(25_000);
    await Promise.resolve();
    expect(heartbeat).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(25_000);
    await Promise.resolve();
    expect(heartbeat).toHaveBeenCalledTimes(1);

    resolveHeartbeat?.();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(25_000);
    await Promise.resolve();
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });
});
