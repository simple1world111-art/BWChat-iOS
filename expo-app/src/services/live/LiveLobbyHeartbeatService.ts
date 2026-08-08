import { heartbeatLiveSlot } from "@/services/live/LiveLobbyRepository";
import {
  liveAvailability,
  normalizeLiveLobbySlotEvent,
} from "@/services/live/LiveLobbyModels";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";

type HeartbeatSender = (slotId: string) => Promise<void>;
type SignalSubscriber = (
  listener: (signalType: string, data: Record<string, unknown>) => void,
) => void;

export interface LiveLobbyHeartbeatLeaseSnapshot {
  ownerId: string;
  slotId: string;
}

export class LiveLobbyHeartbeatService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lease: LiveLobbyHeartbeatLeaseSnapshot | undefined;
  private inFlightLeaseKey: string | undefined;
  private isObservingSignals = false;

  constructor(
    private readonly sendHeartbeat: HeartbeatSender,
    private readonly subscribeToSignals?: SignalSubscriber,
  ) {}

  start(ownerId: string, slotId: string): void {
    const owner = ownerId.trim();
    const slot = slotId.trim();
    if (!owner || owner === "anonymous" || !slot) return;
    this.observeSignalsIfNeeded();
    if (this.lease?.ownerId === owner && this.lease.slotId === slot && this.timer) return;
    this.clearTimer();
    this.lease = { ownerId: owner, slotId: slot };
    this.timer = setInterval(() => this.beat(owner, slot), 25_000);
  }

  stop(ownerId?: string, slotId?: string): void {
    if (ownerId && this.lease?.ownerId !== ownerId.trim()) return;
    if (slotId && this.lease?.slotId !== slotId.trim()) return;
    this.clearTimer();
    this.lease = undefined;
  }

  snapshot(): LiveLobbyHeartbeatLeaseSnapshot | undefined {
    return this.lease ? { ...this.lease } : undefined;
  }

  handleSignal(signalType: string, data: Record<string, unknown>): void {
    if (!this.lease || ![
      "one_to_one_live.slot.created",
      "one_to_one_live.slot.updated",
      "one_to_one_live.slot.ended",
    ].includes(signalType)) return;
    const payload = normalizeLiveLobbySlotEvent(data);
    const ended = signalType === "one_to_one_live.slot.ended"
      || liveAvailability(payload.status ?? payload.slot?.status ?? "") === "ended";
    if (!ended) return;
    if (payload.slotId === this.lease.slotId || payload.userId === this.lease.ownerId) {
      this.stop();
    }
  }

  private beat(ownerId: string, slotId: string): void {
    if (this.lease?.ownerId !== ownerId || this.lease.slotId !== slotId) return;
    const leaseKey = `${ownerId}\u0000${slotId}`;
    if (this.inFlightLeaseKey === leaseKey) return;
    this.inFlightLeaseKey = leaseKey;
    void this.sendHeartbeat(slotId)
      .catch((error: unknown) => {
        if (
          this.lease?.ownerId === ownerId
          && this.lease.slotId === slotId
          && isTerminalHeartbeatError(error)
        ) this.stop();
      })
      .finally(() => {
        if (this.inFlightLeaseKey === leaseKey) this.inFlightLeaseKey = undefined;
      });
  }

  private observeSignalsIfNeeded(): void {
    if (this.isObservingSignals || !this.subscribeToSignals) return;
    this.isObservingSignals = true;
    this.subscribeToSignals((signalType, data) => this.handleSignal(signalType, data));
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

function isTerminalHeartbeatError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  return [404, 409, 410].includes(Number(error.status));
}

export const liveLobbyHeartbeatService = new LiveLobbyHeartbeatService(
  heartbeatLiveSlot,
  (listener) => {
    chatRealtimeService.subscribe((event) => {
      if (event.type === "live_signal") listener(event.signal_type, event.data);
    });
  },
);
