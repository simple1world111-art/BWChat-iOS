import * as Application from "expo-application";

import { reportCallQuality } from "@/api/bwchat";
import type { CallQualityReport, CallQualityStreamReport } from "@/models";

export interface CallQualityStreamSample {
  bytes?: number | undefined;
  timestamp?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  fps?: number | undefined;
  packetsLost?: number | undefined;
  nackCount?: number | undefined;
  pliCount?: number | undefined;
  firCount?: number | undefined;
  framesDropped?: number | undefined;
  freezeCount?: number | undefined;
  rttMs?: number | undefined;
  fractionLost?: number | undefined;
  qualityLimitationReason?: string | undefined;
}

export interface CallQualitySample {
  outbound?: CallQualityStreamSample | undefined;
  inbound?: CallQualityStreamSample | undefined;
  iceTransport?: string | undefined;
  relay?: boolean | undefined;
}

export interface CallQualityTrack {
  getRTCStatsReport(): Promise<CallQualityStatsReport | undefined>;
}

export interface CallQualityStatsReport {
  forEach(callback: (value: Record<string, unknown>) => void): void;
}

type QualityStat = Record<string, unknown> & { id: string; type: string };

type QualityCollector = () => Promise<CallQualitySample>;
type QualityUploader = (callId: string, report: CallQualityReport) => Promise<void>;

interface ActiveQualitySession {
  callId: string;
  collector: QualityCollector;
  accumulator: CallQualityAccumulator;
  timer: ReturnType<typeof setInterval>;
  collecting?: Promise<void> | undefined;
}

export class CallQualityAccumulator {
  private readonly outbound = new CallQualityStreamAccumulator();
  private readonly inbound = new CallQualityStreamAccumulator();
  private hasOutbound = false;
  private hasInbound = false;
  private iceTransport?: string | undefined;
  private relay?: boolean | undefined;
  private count = 0;

  record(sample: CallQualitySample): void {
    if (!sample.outbound && !sample.inbound) return;
    this.count += 1;
    if (sample.outbound) {
      this.hasOutbound = true;
      this.outbound.record(sample.outbound);
    }
    if (sample.inbound) {
      this.hasInbound = true;
      this.inbound.record(sample.inbound);
    }
    this.iceTransport = sample.iceTransport ?? this.iceTransport;
    this.relay = sample.relay ?? this.relay;
  }

  report(appBuild: string): CallQualityReport | undefined {
    if (this.count === 0) return undefined;
    return {
      appBuild,
      sampleCount: this.count,
      ...(this.hasOutbound ? { outbound: this.outbound.snapshot() } : {}),
      ...(this.hasInbound ? { inbound: this.inbound.snapshot() } : {}),
      ...(this.iceTransport ? { iceTransport: this.iceTransport } : {}),
      ...(this.relay !== undefined ? { relay: this.relay } : {}),
    };
  }
}

class CallQualityStreamAccumulator {
  private previousBytes?: number | undefined;
  private previousTimestamp?: number | undefined;
  private report: CallQualityStreamReport = {};

  record(sample: CallQualityStreamSample): void {
    this.report = {
      ...this.report,
      ...definedStreamFields(sample),
    };
    if (
      sample.bytes !== undefined
      && sample.timestamp !== undefined
      && this.previousBytes !== undefined
      && this.previousTimestamp !== undefined
      && sample.bytes >= this.previousBytes
    ) {
      const elapsedSeconds = (sample.timestamp - this.previousTimestamp) / 1_000;
      const bitrate = elapsedSeconds > 0
        ? Math.trunc(((sample.bytes - this.previousBytes) * 8) / elapsedSeconds)
        : 0;
      if (bitrate > 0) this.report.bitrateBps = bitrate;
    }
    this.previousBytes = sample.bytes;
    this.previousTimestamp = sample.timestamp;
  }

  snapshot(): CallQualityStreamReport {
    return { ...this.report };
  }
}

export class CallQualityService {
  private readonly sessions = new Map<string, ActiveQualitySession>();

  constructor(
    private readonly upload: QualityUploader = reportCallQuality,
    private readonly appBuild = () => Application.nativeBuildVersion ?? "unknown",
    private readonly onError = reportCallQualityError,
  ) {}

  start(sessionId: string, callId: string, collector: QualityCollector): void {
    if (!sessionId.trim() || !callId.trim() || this.sessions.has(sessionId)) return;
    const entry: ActiveQualitySession = {
      callId,
      collector,
      accumulator: new CallQualityAccumulator(),
      timer: setInterval(() => void this.collect(entry), 3_000),
    };
    this.sessions.set(sessionId, entry);
    void this.collect(entry);
  }

  async finish(sessionId: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    this.sessions.delete(sessionId);
    clearInterval(entry.timer);
    if (entry.collecting) await entry.collecting;
    await this.collect(entry);
    const report = entry.accumulator.report(this.appBuild());
    if (!report) return false;
    try {
      await this.upload(entry.callId, report);
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    }
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  private collect(entry: ActiveQualitySession): Promise<void> {
    if (entry.collecting) return entry.collecting;
    entry.collecting = entry.collector()
      .then((sample) => entry.accumulator.record(sample))
      .catch(this.onError)
      .finally(() => {
        entry.collecting = undefined;
      });
    return entry.collecting;
  }
}

export async function collectCallQualitySample(
  localVideoTrack?: CallQualityTrack | undefined,
  remoteVideoTrack?: CallQualityTrack | undefined,
): Promise<CallQualitySample> {
  const [local, remote] = await Promise.all([
    localVideoTrack?.getRTCStatsReport().catch(() => undefined),
    remoteVideoTrack?.getRTCStatsReport().catch(() => undefined),
  ]);
  const localEntries = statsEntries(local);
  const remoteEntries = statsEntries(remote);
  const outbound = outboundSample(localEntries);
  const inbound = inboundSample(remoteEntries);
  const transport = qualityTransport(localEntries.length > 0 ? localEntries : remoteEntries);
  return {
    ...(outbound ? { outbound } : {}),
    ...(inbound ? { inbound } : {}),
    ...(transport.iceTransport ? { iceTransport: transport.iceTransport } : {}),
    ...(transport.relay !== undefined ? { relay: transport.relay } : {}),
  };
}

function outboundSample(entries: QualityStat[]): CallQualityStreamSample | undefined {
  const outbound = entries.find((item) => isVideoStat(item, "outbound-rtp") && item.active !== false)
    ?? entries.find((item) => isVideoStat(item, "outbound-rtp"));
  const source = entries.find((item) => ["media-source", "track"].includes(item.type) && statKind(item) === "video");
  if (!outbound && !source) return undefined;
  const feedback = entries.find((item) => isVideoStat(item, "remote-inbound-rtp"));
  return compactSample({
    bytes: numberField(outbound, "bytesSent"),
    timestamp: numberField(outbound, "timestamp"),
    width: numberField(outbound, "frameWidth") ?? numberField(source, "width"),
    height: numberField(outbound, "frameHeight") ?? numberField(source, "height"),
    fps: numberField(outbound, "framesPerSecond") ?? numberField(source, "framesPerSecond"),
    packetsLost: intField(feedback, "packetsLost"),
    nackCount: intField(outbound, "nackCount"),
    pliCount: intField(outbound, "pliCount"),
    firCount: intField(outbound, "firCount"),
    rttMs: millisecondsField(feedback, "roundTripTime"),
    fractionLost: numberField(feedback, "fractionLost"),
    qualityLimitationReason: stringField(outbound, "qualityLimitationReason"),
  });
}

function inboundSample(entries: QualityStat[]): CallQualityStreamSample | undefined {
  const inbound = entries.find((item) => isVideoStat(item, "inbound-rtp"));
  if (!inbound) return undefined;
  const feedback = entries.find((item) => isVideoStat(item, "remote-outbound-rtp"));
  return compactSample({
    bytes: numberField(inbound, "bytesReceived"),
    timestamp: numberField(inbound, "timestamp"),
    width: intField(inbound, "frameWidth"),
    height: intField(inbound, "frameHeight"),
    fps: numberField(inbound, "framesPerSecond"),
    packetsLost: intField(inbound, "packetsLost"),
    nackCount: intField(inbound, "nackCount"),
    pliCount: intField(inbound, "pliCount"),
    firCount: intField(inbound, "firCount"),
    framesDropped: intField(inbound, "framesDropped"),
    freezeCount: intField(inbound, "freezeCount"),
    rttMs: millisecondsField(feedback, "roundTripTime"),
  });
}

function qualityTransport(entries: QualityStat[]): {
  iceTransport?: string | undefined;
  relay?: boolean | undefined;
} {
  const transport = entries.find((item) => item.type === "transport");
  const selectedPairId = stringField(transport, "selectedCandidatePairId");
  const pair = entries.find((item) => item.id === selectedPairId)
    ?? entries.find((item) => item.type === "candidate-pair" && (item.selected === true || item.nominated === true));
  const localCandidateId = stringField(pair, "localCandidateId");
  const candidate = entries.find((item) => item.id === localCandidateId)
    ?? entries.find((item) => item.type === "local-candidate");
  if (!candidate) return {};
  const relay = stringField(candidate, "candidateType")?.toLocaleLowerCase() === "relay";
  const protocol = stringField(candidate, "protocol")?.toLocaleLowerCase();
  if (!relay) {
    return {
      iceTransport: protocol === "udp" || protocol === "tcp" ? protocol : "unknown",
      relay: false,
    };
  }
  const relayProtocol = stringField(candidate, "relayProtocol")?.toLocaleLowerCase() ?? protocol;
  return {
    iceTransport: ["udp", "tcp", "tls"].includes(relayProtocol ?? "")
      ? `turn_${relayProtocol}`
      : "unknown",
    relay: true,
  };
}

function statsEntries(report?: CallQualityStatsReport | undefined): QualityStat[] {
  const result: QualityStat[] = [];
  report?.forEach((value) => {
    if (typeof value.id === "string" && typeof value.type === "string") {
      result.push(value as QualityStat);
    }
  });
  return result;
}

function isVideoStat(stat: QualityStat, type: string): boolean {
  return stat.type === type && statKind(stat) === "video";
}

function statKind(stat: QualityStat): string | undefined {
  return stringField(stat, "kind") ?? stringField(stat, "mediaType");
}

function numberField(source: QualityStat | undefined, key: string): number | undefined {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function intField(source: QualityStat | undefined, key: string): number | undefined {
  const value = numberField(source, key);
  return value === undefined ? undefined : Math.trunc(value);
}

function millisecondsField(source: QualityStat | undefined, key: string): number | undefined {
  const seconds = numberField(source, key);
  return seconds === undefined ? undefined : seconds * 1_000;
}

function stringField(source: QualityStat | undefined, key: string): string | undefined {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compactSample(sample: CallQualityStreamSample): CallQualityStreamSample {
  return Object.fromEntries(
    Object.entries(sample).filter(([, value]) => value !== undefined),
  ) as CallQualityStreamSample;
}

function definedStreamFields(sample: CallQualityStreamSample): CallQualityStreamReport {
  return Object.fromEntries(
    Object.entries(sample).filter(([key, value]) =>
      key !== "bytes" && key !== "timestamp" && value !== undefined),
  ) as CallQualityStreamReport;
}

export const callQualityService = new CallQualityService();

function reportCallQualityError(error: unknown): void {
  void import("@/services/monitoring/MonitoringService")
    .then(({ captureException }) => captureException(error, { operation: "call_quality_report" }))
    .catch(() => undefined);
}
