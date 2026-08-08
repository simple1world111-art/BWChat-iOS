import type { CallConnectionCredentials } from "@/models";
import type { AgentLiveMatchResponse } from "@/services/live/LiveLobbyModels";

export type AgentLiveMatchStatus =
  | { kind: "idle" }
  | { kind: "matching" }
  | { kind: "connecting"; callId: string }
  | { kind: "unavailable"; message: string };

export interface AgentLiveMatchPeer {
  userId: string;
  username: string;
  avatarUrl: string;
  characterSetting: string;
}

export type AgentLiveMatchEffect =
  | { kind: "cancel_match"; matchId: string }
  | { kind: "end_call"; callId: string }
  | { kind: "join_call"; callId: string; operationId: string; peer: AgentLiveMatchPeer }
  | {
      kind: "connected";
      callId: string;
      credentials: CallConnectionCredentials;
      operationId: string;
      peer: AgentLiveMatchPeer;
      requestedRoleSetting: string;
    };

type PendingTerminalEvent =
  | { kind: "accepted"; data: Record<string, unknown> }
  | {
      kind: "unavailable";
      unavailableKind: "exhausted" | "cancelled";
      data: Record<string, unknown>;
    };

export class AgentLiveMatchStateMachine {
  status: AgentLiveMatchStatus = { kind: "idle" };

  private operationId?: string | undefined;
  private currentMatchId?: string | undefined;
  private acceptedCallId?: string | undefined;
  private requestedRoleSetting?: string | undefined;
  private pendingPeer?: AgentLiveMatchPeer | undefined;
  private pendingTerminalEvent?: PendingTerminalEvent | undefined;
  private serverConfirmed = false;

  get isActive(): boolean {
    return this.status.kind === "matching" || this.status.kind === "connecting";
  }

  begin(input: {
    operationId: string;
    clientMatchId: string;
    roleSetting: string;
  }): boolean {
    if (this.isActive) return false;
    this.clearOperation();
    this.operationId = input.operationId;
    this.currentMatchId = input.clientMatchId;
    this.requestedRoleSetting = input.roleSetting.trim();
    this.serverConfirmed = false;
    this.status = { kind: "matching" };
    return true;
  }

  confirmStarted(operationId: string, response: AgentLiveMatchResponse): AgentLiveMatchEffect[] {
    if (this.operationId !== operationId || this.status.kind !== "matching") {
      return [{ kind: "cancel_match", matchId: response.matchId }];
    }
    if (response.matchId !== this.currentMatchId) {
      this.clearOperation();
      this.status = { kind: "unavailable", message: "匹配服务返回异常，请稍后重试" };
      return [{ kind: "cancel_match", matchId: response.matchId }];
    }
    this.currentMatchId = response.matchId;
    this.serverConfirmed = true;
    return this.consumePendingTerminalEvent();
  }

  failStart(operationId: string, message?: string | undefined): void {
    if (this.operationId !== operationId || this.status.kind !== "matching") return;
    this.clearOperation();
    this.status = {
      kind: "unavailable",
      message: message?.trim() || "暂时无法开始匹配，请稍后重试",
    };
  }

  receiveAccepted(data: Record<string, unknown>): AgentLiveMatchEffect[] {
    if (this.status.kind !== "matching") return [];
    const matchId = field(data, "match_id");
    if (!matchId || matchId !== this.currentMatchId || !this.operationId) return [];
    if (!this.serverConfirmed) {
      this.pendingTerminalEvent = { kind: "accepted", data };
      return [];
    }
    return this.connectAccepted(data);
  }

  private connectAccepted(data: Record<string, unknown>): AgentLiveMatchEffect[] {
    if (this.status.kind !== "matching" || !this.operationId) return [];
    const callId = field(data, "call_id");
    const hostUserId = field(data, "host_id", "callee_id", "user_id");
    if (!callId || !hostUserId) {
      this.clearOperation();
      this.status = { kind: "unavailable", message: "主播已接受，但视频信息不完整" };
      return [];
    }
    const peer: AgentLiveMatchPeer = {
      userId: hostUserId,
      username: field(data, "host_username", "callee_username", "username") ?? hostUserId,
      avatarUrl: field(data, "host_avatar_url", "callee_avatar_url", "avatar_url") ?? "",
      characterSetting: field(data, "character_setting", "role_setting") ?? "",
    };
    this.acceptedCallId = callId;
    this.pendingPeer = peer;
    this.status = { kind: "connecting", callId };
    return [{ kind: "join_call", callId, operationId: this.operationId, peer }];
  }

  receiveUnavailable(
    kind: "exhausted" | "cancelled",
    data: Record<string, unknown>,
  ): void {
    if (this.status.kind !== "matching" || field(data, "match_id") !== this.currentMatchId) return;
    if (!this.serverConfirmed) {
      this.pendingTerminalEvent = { kind: "unavailable", unavailableKind: kind, data };
      return;
    }
    this.applyUnavailable(kind);
  }

  private applyUnavailable(kind: "exhausted" | "cancelled"): void {
    this.clearOperation();
    this.status = {
      kind: "unavailable",
      message: kind === "exhausted" ? "暂时没有主播接听" : "匹配已结束",
    };
  }

  confirmJoined(
    operationId: string,
    credentials: CallConnectionCredentials,
  ): AgentLiveMatchEffect[] {
    if (
      this.operationId !== operationId
      || this.status.kind !== "connecting"
      || !this.pendingPeer
    ) return [];
    const peer = this.pendingPeer;
    const requestedRoleSetting = this.requestedRoleSetting ?? "";
    const callId = this.acceptedCallId;
    if (!callId) return this.failJoin(operationId);
    return [{
      kind: "connected",
      callId,
      credentials,
      operationId,
      peer,
      requestedRoleSetting,
    }];
  }

  completeConnection(operationId: string): boolean {
    if (this.operationId !== operationId || this.status.kind !== "connecting") return false;
    this.clearOperation();
    this.status = { kind: "idle" };
    return true;
  }

  failJoin(operationId: string): AgentLiveMatchEffect[] {
    if (this.operationId !== operationId || this.status.kind !== "connecting") return [];
    const callId = this.acceptedCallId;
    this.clearOperation();
    this.status = { kind: "unavailable", message: "主播已接受，但视频连接失败，请重新匹配" };
    return callId ? [{ kind: "end_call", callId }] : [];
  }

  cancel(): AgentLiveMatchEffect[] {
    if (!this.isActive) return [];
    const effect = this.status.kind === "connecting" && this.acceptedCallId
      ? { kind: "end_call" as const, callId: this.acceptedCallId }
      : this.currentMatchId
        ? { kind: "cancel_match" as const, matchId: this.currentMatchId }
        : undefined;
    this.clearOperation();
    this.status = { kind: "idle" };
    return effect ? [effect] : [];
  }

  reset(): AgentLiveMatchEffect[] {
    if (this.isActive) return this.cancel();
    this.clearOperation();
    this.status = { kind: "idle" };
    return [];
  }

  private consumePendingTerminalEvent(): AgentLiveMatchEffect[] {
    const pending = this.pendingTerminalEvent;
    this.pendingTerminalEvent = undefined;
    if (!pending || this.status.kind !== "matching") return [];
    if (pending.kind === "accepted") return this.connectAccepted(pending.data);
    this.applyUnavailable(pending.unavailableKind);
    return [];
  }

  private clearOperation(): void {
    this.operationId = undefined;
    this.currentMatchId = undefined;
    this.acceptedCallId = undefined;
    this.requestedRoleSetting = undefined;
    this.pendingPeer = undefined;
    this.pendingTerminalEvent = undefined;
    this.serverConfirmed = false;
  }
}

function field(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) {
      return String(value).trim();
    }
  }
  return undefined;
}
