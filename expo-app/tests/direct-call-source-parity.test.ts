import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CALL_CONNECTION_TIMEOUT_MS,
  DIRECT_REMOTE_DEPARTURE_GRACE_MS,
  formatCallDuration,
  LIVE_TERMINATION_RECONCILIATION_MS,
  shouldScheduleCallAutoExit,
} from "@/services/calls/callPolicy";

const root = process.cwd();
const overlay = readFileSync(resolve(root, "src/components/calls/CallOverlay.tsx"), "utf8");
const provider = readFileSync(resolve(root, "src/providers/CallProvider.tsx"), "utf8");
const directStage = overlay.slice(
  overlay.indexOf("function DirectCallStage"),
  overlay.indexOf("function LiveBillingBadge"),
);
const directControls = overlay.slice(
  overlay.indexOf("function DirectControlBar"),
  overlay.indexOf("function GroupControlBar"),
);
const pipStage = overlay.slice(
  overlay.indexOf("function CallPipBubble"),
  overlay.indexOf("function GroupVideoParticipant"),
);

describe("CallView ordinary friend-call source parity", () => {
  it("keeps the native direct-call signaling, timeout and failure-end lifecycle", () => {
    expect(provider).toContain("setTimeout(() => {");
    expect(provider).toContain("}, 45_000)");
    expect(provider).toContain('chatRealtimeService.send("call_busy"');
    expect(provider).toContain('chatRealtimeService.send("call_reject"');
    expect(provider).toContain('chatRealtimeService.send("call_end"');
    expect(provider).toContain(".markCallBusy(incoming.call_id)");
    expect(provider).toContain(".rejectCall(current.call_id)");
    expect(provider).toContain(".endCall(current.call_id)");
    expect(provider).toContain("isDuplicateCallInvite(current, incoming)");
  });

  it("retains the native connection and post-departure gates", () => {
    expect(CALL_CONNECTION_TIMEOUT_MS).toBe(20_000);
    expect(DIRECT_REMOTE_DEPARTURE_GRACE_MS).toBe(20_000);
    expect(shouldScheduleCallAutoExit(false, false, 0)).toBe(true);
    expect(shouldScheduleCallAutoExit(false, true, 1)).toBe(false);
    expect(overlay).toContain('session.group_id === undefined && session.state !== "connected"');
    expect(overlay).toContain("DIRECT_REMOTE_DEPARTURE_GRACE_MS");
    expect(formatCallDuration(125.9)).toBe("02:05");
  });

  it("uses the native LiveKit capture, encoding and reconnect envelope", () => {
    expect(overlay).toContain("const CALL_VIDEO_CAPTURE_OPTIONS");
    expect(overlay).toContain("width: 1280");
    expect(overlay).toContain("height: 720");
    expect(overlay).toContain("frameRate: 30");
    expect(overlay).toContain("singlePeerConnection: false");
    expect(overlay).toContain("new DefaultReconnectPolicy");
    expect(overlay).toContain("maxRetries: 12");
    expect(overlay).toContain("maxBitrate: 48_000");
    expect(overlay).toContain("maxBitrate: 3_000_000");
    expect(overlay).toContain("simulcast: false");
  });

  it("matches the native incoming and active control topology", () => {
    expect(directStage).toContain('accessibilityLabel="call.reject"');
    expect(directStage).toContain('accessibilityLabel="call.accept"');
    for (const identifier of ["mute", "speaker", "camera", "end", "flip"]) {
      expect(overlay).toContain(`accessibilityLabel="call.${identifier}"`);
    }
    expect(directStage).toContain("diameter={76}");
    expect(directControls).toContain("diameter={50}");
    expect(directControls).toContain("diameter={54}");
    expect(directControls).toContain("diameter={68}");
    expect(overlay).toContain(
      'incomingRow: { flexDirection: "row", justifyContent: "center", gap: 88 }',
    );
  });

  it("matches full-screen video swapping, camera-off placeholders and local avatar identity", () => {
    expect(directStage).toContain("primaryTrack = remotePrimary ? remoteTrack : localTrack");
    expect(directStage).toContain("secondaryTrack = remotePrimary ? localTrack : remoteTrack");
    expect(directStage).toContain("primaryIsLocal && call.isFrontCamera");
    expect(directStage).toContain("primaryIsLocal ? localAvatarUrl : session.remote_avatar_url");
    expect(directStage).toContain("VideoAvatarPlaceholder");
    expect(overlay).toContain('backgroundColor: "#2A2A3E"');
    expect(overlay).toContain("width: 110");
    expect(overlay).toContain("height: 150");
    expect(overlay).toContain("borderRadius: 12");
    expect(overlay).toContain("const CALL_AVATAR_CORNER_RATIO = 0.22");
    expect(directStage).toContain("cornerRadius={identityAvatarSize * CALL_AVATAR_CORNER_RATIO}");
    expect(directStage).not.toContain("cornerRadius={999}");
  });

  it("renders live charges and earnings as separate conserved asset rows", () => {
    const billingBadge = overlay.slice(
      overlay.indexOf("function LiveBillingBadge"),
      overlay.indexOf("function LiveRoleIntroductionCard"),
    );
    expect(billingBadge).toContain('symbol: "pawprint.fill"');
    expect(billingBadge).toContain('symbol: "dollarsign.circle.fill"');
    expect(billingBadge).toContain('"live.billing.earnedActivityCatFood"');
    expect(billingBadge).toContain('"live.billing.earnedGoldCoins"');
    expect(billingBadge).not.toContain('t("live.billing.totalCharged"');
    expect(overlay).toContain('const LIVE_CAT_FOOD_COLOR = "#D7B8FF"');
    expect(overlay).toContain('const LIVE_GOLD_COIN_COLOR = "#FFD60A"');
    expect(billingBadge).toContain("tintColor={line.color}");
  });

  it("persists native primary-video state through minimize and restores the secondary PiP", () => {
    expect(provider).toContain("const [isRemotePrimary, setRemotePrimary] = useState(true)");
    expect(provider).toContain("setRemotePrimary(true)");
    expect(pipStage).toContain("call.isRemotePrimary ? localTrack : remoteTrack");
    expect(pipStage).toContain('accessibilityLabel="call.restore"');
    expect(pipStage).toContain('accessibilityLabel="call.pip.hide"');
    expect(pipStage).toContain('accessibilityLabel="call.pip.show"');
    expect(pipStage).toContain('session.call_type === "voice" ? 130 : 75');
    expect(pipStage).toContain('<SymbolView name="video.fill" size={22}');
    expect(overlay).toContain("width: 22");
    expect(overlay).toContain("height: 56");
  });

  it("keeps foreground/reconnect recovery and account ownership generation-safe", () => {
    expect(overlay).toContain('AppState.addEventListener("change"');
    expect(overlay).toContain("ConnectionState.Reconnecting");
    expect(overlay).toContain("retryCallMediaPublication");
    expect(provider).toContain("sessionOwnerIdRef.current !== ownerIdRef.current");
    expect(provider).toContain("setErrorToast(null)");
    expect(provider).toContain("!isCurrentOwner(operationOwnerId)");
    expect(provider).toContain("chatRealtimeService.subscribeStatus");
    expect(provider).toContain('nextState === "active"');
    expect(LIVE_TERMINATION_RECONCILIATION_MS).toBe(800);
    expect(provider).toContain("reconcileLiveTermination");
    expect(provider).toContain("getLiveCallState(current.call_id)");
  });

  it("refreshes owner-scoped wallet and prop settlement after authoritative live teardown", () => {
    expect(provider).toContain("publishCallSettlementRefresh(endedOwnerId, current.id)");
    expect(provider).toContain("refreshWalletBalance(endedOwnerId)");
    expect(provider).toContain("endedOwnerId === ownerIdRef.current");
    expect(provider).toContain("liveReconciliationSequenceRef.current += 1");
  });

  it("does not attach live role or billing state to an ordinary friend call", () => {
    const ordinaryStart = provider.slice(
      provider.indexOf("const startDirectCall"),
      provider.indexOf("const startGroupCall"),
    );
    expect(ordinaryStart).not.toContain("is_live_pair");
    expect(ordinaryStart).not.toContain("live_role_setting");
    expect(ordinaryStart).not.toContain("live_billing_policy");
    expect(directStage).toContain("session.is_live_pair && session.live_role_setting");
    expect(directStage).toContain('session.is_live_pair && session.state === "connected"');
  });

  it("uses system symbols and authenticated avatars exactly like native, with no page bitmap asset", () => {
    expect(directStage).toContain("<Avatar");
    expect(overlay).toContain("<SymbolView");
    expect(directStage).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/i);
  });
});
