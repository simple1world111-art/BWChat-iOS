import type { WalletBalanceSnapshot } from "@/models";
import {
  AgentLiveMatchCoordinator,
  type AgentLiveMatchRuntime,
} from "@/services/live/AgentLiveMatchCoordinator";

const balance = (spendable: number): WalletBalanceSnapshot => ({
  currency: "gold_coin",
  gold_coin_balance: spendable,
  activity_cat_food_balance: 0,
  spendable_balance: spendable,
  chat_money_frozen_gold_coin_balance: 0,
});

const credentials = {
  call_id: "call-1",
  room_name: "room-1",
  token: "token-1",
  livekit_url: "wss://live.example.test",
};

function runtime(
  overrides: Partial<AgentLiveMatchRuntime> = {},
): AgentLiveMatchRuntime & Record<string, jest.Mock> {
  const value = {
    makeOperationId: jest.fn(() => "op-1"),
    currentUserId: jest.fn(() => "user-1"),
    hasCurrentCall: jest.fn(() => false),
    hasLiveInvitation: jest.fn(() => false),
    synchronizeCurrentUserLiveStatus: jest.fn(async () => false),
    refreshBalance: jest.fn(async () => balance(100)),
    applyBalance: jest.fn(async () => undefined),
    startMatch: jest.fn(async (input: { clientMatchId: string }) => ({
      matchId: input.clientMatchId,
    })),
    cancelMatch: jest.fn(async () => undefined),
    joinAcceptedCall: jest.fn(async () => credentials),
    endAcceptedCall: jest.fn(async () => undefined),
    connectAcceptedCall: jest.fn(async () => true),
    endLocalCall: jest.fn(),
    onStatus: jest.fn(),
    onConnected: jest.fn(),
    ...overrides,
  };
  return value as AgentLiveMatchRuntime & Record<string, jest.Mock>;
}

describe("agent live match coordinator", () => {
  it("refreshes live status and balance, correlates an early accepted event, joins, and opens CallProvider", async () => {
    const start = deferred<{ matchId: string }>();
    const deps = runtime({ startMatch: jest.fn(() => start.promise) });
    const coordinator = new AgentLiveMatchCoordinator(deps);
    const starting = coordinator.start(" Detective ", "agent-1");
    await until(() => jest.mocked(deps.startMatch).mock.calls.length === 1);

    coordinator.receiveAccepted({
      match_id: "match_op-1",
      call_id: "call-1",
      host_id: "host-1",
      host_username: "Alice",
      character_setting: "Host role",
    });
    expect(deps.joinAcceptedCall).not.toHaveBeenCalled();
    start.resolve({ matchId: "match_op-1" });
    await starting;

    expect(deps.synchronizeCurrentUserLiveStatus).toHaveBeenCalledTimes(1);
    expect(deps.refreshBalance).toHaveBeenCalledWith("user-1");
    expect(deps.applyBalance).toHaveBeenCalledWith(balance(100));
    expect(deps.startMatch).toHaveBeenCalledWith({
      roleSetting: "Detective",
      sourceAgentId: "agent-1",
      clientMatchId: "match_op-1",
    });
    expect(deps.joinAcceptedCall).toHaveBeenCalledWith("call-1");
    expect(deps.connectAcceptedCall).toHaveBeenCalledWith({
      callId: "call-1",
      credentials,
      peer: {
        userId: "host-1",
        username: "Alice",
        avatarUrl: "",
        characterSetting: "Host role",
      },
      requestedRoleSetting: "Detective",
    });
    expect(deps.onConnected).toHaveBeenCalledTimes(1);
    expect(coordinator.machine.status).toEqual({ kind: "idle" });
  });

  it("buffers an early exhausted event and never joins a call", async () => {
    const start = deferred<{ matchId: string }>();
    const deps = runtime({ startMatch: jest.fn(() => start.promise) });
    const coordinator = new AgentLiveMatchCoordinator(deps);
    const starting = coordinator.start("Role", "agent-1");
    await until(() => jest.mocked(deps.startMatch).mock.calls.length === 1);
    coordinator.receiveUnavailable("exhausted", { match_id: "match_op-1" });
    start.resolve({ matchId: "match_op-1" });
    await starting;
    expect(coordinator.machine.status).toEqual({
      kind: "unavailable",
      message: "暂时没有主播接听",
    });
    expect(deps.joinAcceptedCall).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "current user is live",
      override: { synchronizeCurrentUserLiveStatus: jest.fn(async () => true) },
      message: "正在直播，无法与其他在直播的人视频",
    },
    {
      name: "call is already active",
      override: { hasCurrentCall: jest.fn(() => true) },
      message: "当前已有通话或视频邀请",
    },
    {
      name: "balance is below 100",
      override: { refreshBalance: jest.fn(async () => balance(99)) },
      message: "可消费余额不足，无法与对方视频",
    },
  ])("blocks POST when $name", async ({ override, message }) => {
    const deps = runtime(override);
    const coordinator = new AgentLiveMatchCoordinator(deps);
    await coordinator.start("Role", "agent-1");
    expect(coordinator.machine.status).toEqual({ kind: "unavailable", message });
    expect(deps.startMatch).not.toHaveBeenCalled();
  });

  it("ends the accepted backend call when joining or CallProvider activation fails", async () => {
    const deps = runtime({ connectAcceptedCall: jest.fn(async () => false) });
    const coordinator = new AgentLiveMatchCoordinator(deps);
    const starting = coordinator.start("Role", "agent-1");
    await until(() => jest.mocked(deps.startMatch).mock.calls.length === 1);
    await starting;
    coordinator.receiveAccepted({
      match_id: "match_op-1",
      call_id: "call-1",
      host_id: "host-1",
    });
    await until(() => jest.mocked(deps.endAcceptedCall).mock.calls.length === 1);
    expect(deps.endAcceptedCall).toHaveBeenCalledWith("call-1");
    expect(coordinator.machine.status).toEqual({
      kind: "unavailable",
      message: "主播已接受，但视频连接失败，请重新匹配",
    });
  });

  it("cancels matching on lifecycle exit and cleans up a late POST response", async () => {
    const start = deferred<{ matchId: string }>();
    const deps = runtime({ startMatch: jest.fn(() => start.promise) });
    const coordinator = new AgentLiveMatchCoordinator(deps);
    const starting = coordinator.start("Role", "agent-1");
    await until(() => jest.mocked(deps.startMatch).mock.calls.length === 1);
    coordinator.cancel();
    start.resolve({ matchId: "match_op-1" });
    await starting;
    await until(() => jest.mocked(deps.cancelMatch).mock.calls.length >= 2);
    expect(deps.cancelMatch).toHaveBeenCalledWith("match_op-1");
    expect(coordinator.machine.status).toEqual({ kind: "idle" });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not reached");
}
