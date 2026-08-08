import { AgentLiveMatchStateMachine } from "@/services/live/AgentLiveMatchStateMachine";

const credentials = {
  call_id: "call-1",
  room_name: "room",
  token: "token",
  livekit_url: "wss://live.example.test",
};

describe("agent one-to-one live match state machine", () => {
  it("single-flights matching and cancels stale or mismatched server responses", () => {
    const machine = new AgentLiveMatchStateMachine();
    expect(machine.begin({ operationId: "op-1", clientMatchId: "match-1", roleSetting: " Detective " })).toBe(true);
    expect(machine.begin({ operationId: "op-2", clientMatchId: "match-2", roleSetting: "Other" })).toBe(false);
    expect(machine.confirmStarted("stale", { matchId: "server-stale" })).toEqual([
      { kind: "cancel_match", matchId: "server-stale" },
    ]);
    expect(machine.confirmStarted("op-1", { matchId: "server-wrong" })).toEqual([
      { kind: "cancel_match", matchId: "server-wrong" },
    ]);
    expect(machine.status).toEqual({ kind: "unavailable", message: "匹配服务返回异常，请稍后重试" });
  });

  it("correlates accepted events, resolves aliases, joins, and emits the role context", () => {
    const machine = new AgentLiveMatchStateMachine();
    machine.begin({ operationId: "op-1", clientMatchId: "match-1", roleSetting: " Detective " });
    expect(machine.confirmStarted("op-1", { matchId: "match-1" })).toEqual([]);
    expect(machine.receiveAccepted({ match_id: "other", call_id: "ignored", host_id: "u0" })).toEqual([]);
    expect(machine.receiveAccepted({
      match_id: "match-1",
      call_id: "call-1",
      callee_id: "host-1",
      callee_username: "Alice",
      callee_avatar_url: "/a.jpg",
      role_setting: "Host role",
    })).toEqual([{
      kind: "join_call",
      callId: "call-1",
      operationId: "op-1",
      peer: {
        userId: "host-1",
        username: "Alice",
        avatarUrl: "/a.jpg",
        characterSetting: "Host role",
      },
    }]);
    expect(machine.status).toEqual({ kind: "connecting", callId: "call-1" });
    expect(machine.confirmJoined("op-1", credentials)).toEqual([{
      kind: "connected",
      callId: "call-1",
      credentials,
      operationId: "op-1",
      peer: {
        userId: "host-1",
        username: "Alice",
        avatarUrl: "/a.jpg",
        characterSetting: "Host role",
      },
      requestedRoleSetting: "Detective",
    }]);
    expect(machine.status).toEqual({ kind: "connecting", callId: "call-1" });
    expect(machine.completeConnection("op-1")).toBe(true);
    expect(machine.status).toEqual({ kind: "idle" });
  });

  it("buffers accepted and unavailable terminal events that arrive before POST completion", () => {
    const accepted = new AgentLiveMatchStateMachine();
    accepted.begin({ operationId: "op-a", clientMatchId: "match-a", roleSetting: "Role" });
    expect(accepted.receiveAccepted({
      match_id: "match-a",
      call_id: "call-a",
      host_id: "host-a",
    })).toEqual([]);
    expect(accepted.status).toEqual({ kind: "matching" });
    expect(accepted.confirmStarted("op-a", { matchId: "match-a" })).toEqual([{
      kind: "join_call",
      callId: "call-a",
      operationId: "op-a",
      peer: {
        userId: "host-a",
        username: "host-a",
        avatarUrl: "",
        characterSetting: "",
      },
    }]);

    const exhausted = new AgentLiveMatchStateMachine();
    exhausted.begin({ operationId: "op-e", clientMatchId: "match-e", roleSetting: "Role" });
    exhausted.receiveUnavailable("exhausted", { match_id: "match-e" });
    expect(exhausted.status).toEqual({ kind: "matching" });
    expect(exhausted.confirmStarted("op-e", { matchId: "match-e" })).toEqual([]);
    expect(exhausted.status).toEqual({ kind: "unavailable", message: "暂时没有主播接听" });
  });

  it("maps exhausted/cancelled events and chooses the exact cancel action per phase", () => {
    const matching = new AgentLiveMatchStateMachine();
    matching.begin({ operationId: "op-1", clientMatchId: "match-1", roleSetting: "Role" });
    matching.receiveUnavailable("exhausted", { match_id: "other" });
    expect(matching.status).toEqual({ kind: "matching" });
    matching.receiveUnavailable("exhausted", { match_id: "match-1" });
    expect(matching.status).toEqual({ kind: "matching" });
    matching.confirmStarted("op-1", { matchId: "match-1" });
    expect(matching.status).toEqual({ kind: "unavailable", message: "暂时没有主播接听" });

    const cancelled = new AgentLiveMatchStateMachine();
    cancelled.begin({ operationId: "op-2", clientMatchId: "match-2", roleSetting: "Role" });
    expect(cancelled.cancel()).toEqual([{ kind: "cancel_match", matchId: "match-2" }]);
    expect(cancelled.status).toEqual({ kind: "idle" });

    const connecting = new AgentLiveMatchStateMachine();
    connecting.begin({ operationId: "op-3", clientMatchId: "match-3", roleSetting: "Role" });
    connecting.confirmStarted("op-3", { matchId: "match-3" });
    connecting.receiveAccepted({ match_id: "match-3", call_id: "call-3", host_id: "host-3" });
    expect(connecting.cancel()).toEqual([{ kind: "end_call", callId: "call-3" }]);
  });

  it("ends an accepted call after join failure and ignores stale completion", () => {
    const machine = new AgentLiveMatchStateMachine();
    machine.begin({ operationId: "op-1", clientMatchId: "match-1", roleSetting: "Role" });
    machine.confirmStarted("op-1", { matchId: "match-1" });
    machine.receiveAccepted({ match_id: "match-1", call_id: "call-1", user_id: "host-1" });
    expect(machine.confirmJoined("stale", credentials)).toEqual([]);
    expect(machine.failJoin("op-1")).toEqual([{ kind: "end_call", callId: "call-1" }]);
    expect(machine.status).toEqual({ kind: "unavailable", message: "主播已接受，但视频连接失败，请重新匹配" });
  });

  it("rejects incomplete accepted payloads and preserves explicit start errors", () => {
    const accepted = new AgentLiveMatchStateMachine();
    accepted.begin({ operationId: "op-1", clientMatchId: "match-1", roleSetting: "Role" });
    expect(accepted.receiveAccepted({ match_id: "match-1", call_id: "call-1" })).toEqual([]);
    expect(accepted.confirmStarted("op-1", { matchId: "match-1" })).toEqual([]);
    expect(accepted.status).toEqual({ kind: "unavailable", message: "主播已接受，但视频信息不完整" });

    const failed = new AgentLiveMatchStateMachine();
    failed.begin({ operationId: "op-2", clientMatchId: "match-2", roleSetting: "Role" });
    failed.failStart("op-2", " backend unavailable ");
    expect(failed.status).toEqual({ kind: "unavailable", message: "backend unavailable" });
  });
});
