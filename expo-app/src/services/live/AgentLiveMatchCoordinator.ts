import type { CallConnectionCredentials, WalletBalanceSnapshot } from "@/models";
import {
  AgentLiveMatchStateMachine,
  type AgentLiveMatchEffect,
  type AgentLiveMatchPeer,
  type AgentLiveMatchStatus,
} from "@/services/live/AgentLiveMatchStateMachine";
import type { AgentLiveMatchResponse } from "@/services/live/LiveLobbyModels";

export const agentLiveMinimumStartingBalance = 100;

export interface AgentLiveConnectedCall {
  callId: string;
  credentials: CallConnectionCredentials;
  peer: AgentLiveMatchPeer;
  requestedRoleSetting: string;
}

export interface AgentLiveMatchRuntime {
  makeOperationId(): string;
  currentUserId(): string;
  hasCurrentCall(): boolean;
  hasLiveInvitation(): boolean;
  synchronizeCurrentUserLiveStatus(): Promise<boolean>;
  refreshBalance(ownerId: string): Promise<WalletBalanceSnapshot>;
  applyBalance(balance: WalletBalanceSnapshot): Promise<void>;
  startMatch(input: {
    roleSetting: string;
    sourceAgentId: string;
    clientMatchId: string;
  }): Promise<AgentLiveMatchResponse>;
  cancelMatch(matchId: string): Promise<void>;
  joinAcceptedCall(callId: string): Promise<CallConnectionCredentials>;
  endAcceptedCall(callId: string): Promise<void>;
  connectAcceptedCall(call: AgentLiveConnectedCall): Promise<boolean>;
  endLocalCall(): void;
  onStatus(status: AgentLiveMatchStatus): void;
  onConnected(): void;
}

export class AgentLiveMatchCoordinator {
  readonly machine = new AgentLiveMatchStateMachine();

  private operationId?: string | undefined;
  private disposed = false;

  constructor(private runtime: AgentLiveMatchRuntime) {}

  updateRuntime(runtime: AgentLiveMatchRuntime): void {
    if (this.disposed) return;
    this.runtime = runtime;
  }

  async start(roleSetting: string, sourceAgentId: string): Promise<void> {
    const role = roleSetting.trim();
    const agentId = sourceAgentId.trim();
    if (!role || !agentId || this.machine.isActive || this.disposed) return;

    const operationId = this.runtime.makeOperationId();
    const clientMatchId = `match_${operationId.toLocaleLowerCase()}`;
    if (!this.machine.begin({ operationId, clientMatchId, roleSetting: role })) return;
    this.operationId = operationId;
    this.emit();

    try {
      if (!this.runtime.currentUserId().trim()) {
        this.failStart(operationId, "登录状态失效，请重新登录");
        return;
      }
      if (await this.runtime.synchronizeCurrentUserLiveStatus()) {
        this.failStart(operationId, "正在直播，无法与其他在直播的人视频");
        return;
      }
      if (!this.isCurrent(operationId)) return;
      if (this.runtime.hasCurrentCall() || this.runtime.hasLiveInvitation()) {
        this.failStart(operationId, "当前已有通话或视频邀请");
        return;
      }

      let balance: WalletBalanceSnapshot;
      try {
        balance = await this.runtime.refreshBalance(this.runtime.currentUserId());
        if (!this.isCurrent(operationId)) return;
        await this.runtime.applyBalance(balance);
      } catch {
        this.failStart(operationId, "暂时无法确认可消费余额，请稍后重试");
        return;
      }
      if (!this.isCurrent(operationId)) return;
      if (balance.spendable_balance < agentLiveMinimumStartingBalance) {
        this.failStart(operationId, "可消费余额不足，无法与对方视频");
        return;
      }

      const response = await this.runtime.startMatch({
        roleSetting: role,
        sourceAgentId: agentId,
        clientMatchId,
      });
      await this.runEffects(this.machine.confirmStarted(operationId, response));
      this.emit();
    } catch (error) {
      if (!this.isCurrent(operationId)) return;
      this.failStart(operationId, errorMessage(error, "暂时无法开始匹配，请稍后重试"));
    }
  }

  receiveAccepted(data: Record<string, unknown>): void {
    if (this.disposed) return;
    const effects = this.machine.receiveAccepted(data);
    this.emit();
    void this.runEffects(effects);
  }

  receiveUnavailable(
    kind: "exhausted" | "cancelled",
    data: Record<string, unknown>,
  ): void {
    if (this.disposed) return;
    this.machine.receiveUnavailable(kind, data);
    this.emit();
  }

  cancel(): void {
    if (this.disposed) return;
    const effects = this.machine.cancel();
    this.operationId = undefined;
    this.emit();
    void this.runEffects(effects);
  }

  reset(): void {
    if (this.disposed) return;
    const effects = this.machine.reset();
    this.operationId = undefined;
    this.emit();
    void this.runEffects(effects);
  }

  dispose(): void {
    if (this.disposed) return;
    const effects = this.machine.reset();
    this.operationId = undefined;
    this.disposed = true;
    void this.runEffects(effects);
  }

  private failStart(operationId: string, message: string): void {
    this.machine.failStart(operationId, message);
    if (!this.machine.isActive) this.operationId = undefined;
    this.emit();
  }

  private isCurrent(operationId: string): boolean {
    return !this.disposed && this.operationId === operationId && this.machine.isActive;
  }

  private emit(): void {
    if (this.disposed) return;
    if (!this.machine.isActive) this.operationId = undefined;
    this.runtime.onStatus(this.machine.status);
  }

  private async runEffects(initial: AgentLiveMatchEffect[]): Promise<void> {
    const queue = [...initial];
    while (queue.length > 0) {
      const effect = queue.shift();
      if (!effect) continue;
      if (effect.kind === "cancel_match") {
        await this.runtime.cancelMatch(effect.matchId).catch(() => undefined);
        continue;
      }
      if (effect.kind === "end_call") {
        await this.runtime.endAcceptedCall(effect.callId).catch(() => undefined);
        continue;
      }
      if (effect.kind === "join_call") {
        try {
          const credentials = await this.runtime.joinAcceptedCall(effect.callId);
          queue.push(...this.machine.confirmJoined(effect.operationId, credentials));
          this.emit();
        } catch {
          queue.push(...this.machine.failJoin(effect.operationId));
          this.emit();
        }
        continue;
      }

      let connected = false;
      try {
        connected = await this.runtime.connectAcceptedCall({
          callId: effect.callId,
          credentials: effect.credentials,
          peer: effect.peer,
          requestedRoleSetting: effect.requestedRoleSetting,
        });
      } catch {
        connected = false;
      }
      if (!connected) {
        queue.push(...this.machine.failJoin(effect.operationId));
        this.emit();
        continue;
      }
      if (!this.machine.completeConnection(effect.operationId)) {
        this.runtime.endLocalCall();
        await this.runtime.endAcceptedCall(effect.callId).catch(() => undefined);
        continue;
      }
      this.operationId = undefined;
      this.emit();
      this.runtime.onConnected();
    }
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return fallback;
}
