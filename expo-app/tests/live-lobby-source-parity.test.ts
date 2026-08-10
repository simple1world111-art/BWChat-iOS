import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("live lobby source parity", () => {
  const root = process.cwd();
  const page = readFileSync(resolve(root, "src/app/live-lobby.tsx"), "utf8");
  const controller = readFileSync(resolve(root, "src/services/live/useLiveLobby.ts"), "utf8");
  const heartbeat = readFileSync(
    resolve(root, "src/services/live/LiveLobbyHeartbeatService.ts"),
    "utf8",
  );
  const provider = readFileSync(resolve(root, "src/providers/LiveCallProvider.tsx"), "utf8");

  it("keeps native transient UI and submission interaction contracts", () => {
    expect(page).toContain("setTimeout(lobby.clearError, 4_000)");
    expect(page).toContain("!lobby.hasLoaded ? null");
    expect(page).not.toContain("function SkeletonGrid");
    expect(page).toContain("disabled={isSubmitting}");
    expect(page).toContain("正在直播，无法与其他主播连线");
    expect(page).toContain("previous?.is_live_pair && !previous.is_outgoing");
  });

  it("wires native current-slot recovery, event cursor, and synchronous mutation locking", () => {
    expect(controller).toContain("reconcileCurrentLiveSlot(");
    expect(controller).toContain("normalizeLiveLobbySlotEvent(event.data)");
    expect(controller).toContain("eventCursorRef.current.shouldApply(payload)");
    expect(controller).toContain("acquireLiveLobbyUpdate(updatingRef)");
    expect(controller).toContain("releaseLiveLobbyUpdate(updatingRef)");
    expect(controller).toContain("useState<LiveLobbyTab>(activeTab)");
    expect(controller).toContain('participantTab === "chatted"');
    expect(controller).toContain("refreshGenerationRef.current += 1");
    expect(page).toContain('<LiveLobbyAccountScreen key={ownerId || "signed-out"} />');
  });

  it("keeps the owned slot heartbeat alive outside the lobby screen without overlapping", () => {
    expect(controller).toContain("liveLobbyHeartbeatService.start(scopeRef.current, value.id)");
    expect(controller).toContain("liveLobbyHeartbeatService.stop(scopeRef.current)");
    expect(page).not.toContain("heartbeatLiveSlot(");
    expect(heartbeat).toContain("setInterval(() => this.beat(owner, slot), 25_000)");
    expect(heartbeat).toContain("if (this.inFlightLeaseKey === leaseKey) return");
  });

  it("applies native live-call event correlation and business error policies", () => {
    expect(provider).toContain("correlateLiveCallEvent(data");
    expect(provider).toContain("liveCallErrorMessage(");
    expect(provider).toContain("正在直播，无法与其他主播连线");
    expect(provider).toContain("outgoingRequestTokenRef.current");
    expect(provider).toContain("activeOwnerRef.current === ownerId");
    expect(provider).toContain("useLayoutEffect(() => {");
    expect(provider).toContain("response.liveExperience ?? pending.liveExperience");
    expect(provider).toContain("reconciliationRef.current = setTimeout(poll, 1_000)");
    expect(provider).toContain("poll();");
  });
});
