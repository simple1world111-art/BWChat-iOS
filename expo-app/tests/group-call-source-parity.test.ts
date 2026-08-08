import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CALL_CONNECTION_TIMEOUT_MS,
  GROUP_REMOTE_DEPARTURE_GRACE_MS,
  shouldScheduleCallAutoExit,
} from "@/services/calls/callPolicy";

const root = process.cwd();
const copiedNativeRoot = resolve(root, "..");
const originalNativeRoot = resolve(root, "../../BWChat-iOS");
const overlay = readFileSync(resolve(root, "src/components/calls/CallOverlay.tsx"), "utf8");
const provider = readFileSync(resolve(root, "src/providers/CallProvider.tsx"), "utf8");
const api = readFileSync(resolve(root, "src/api/bwchat.ts"), "utf8");
const apiClient = readFileSync(resolve(root, "src/api/client.ts"), "utf8");
const normalizers = readFileSync(resolve(root, "src/api/normalizers.ts"), "utf8");
const policy = readFileSync(resolve(root, "src/services/calls/callPolicy.ts"), "utf8");
const pushService = readFileSync(resolve(root, "src/services/push/PushService.ts"), "utf8");
const realtime = readFileSync(
  resolve(root, "src/services/realtime/ChatRealtimeService.ts"),
  "utf8",
);
const appConfig = readFileSync(resolve(root, "app.config.ts"), "utf8");
const mediaRecovery = readFileSync(
  resolve(root, "src/services/calls/CallMediaRecovery.ts"),
  "utf8",
);
const groupStage = overlay.slice(
  overlay.indexOf("function GroupCallStage"),
  overlay.indexOf("function DirectControlBar"),
);
const groupParticipants = overlay.slice(
  overlay.indexOf("function GroupVideoParticipant"),
  overlay.indexOf("function ControlButton"),
);

describe("GroupCallView source and lifecycle parity", () => {
  it("locks every original and copied Swift source used by GroupCallView and its entry/API path", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/GroupCallView.swift":
        "3663743efb87eaa4a83776e0ebe39ae57ff1dff3ef0bae1ae5e25f679dec23b7",
      "BWChat/BWChatApp.swift": "45f12ddeed0504b5f71550681d2c9b0916804f3e812d56ba57705c5b735c26ad",
      "BWChat/Views/CallView.swift":
        "0dab85f31ead3978780a2fd1d0bddff67dc209d0e429cb3f0677b5cdccf394ac",
      "BWChat/Views/GroupChatView.swift":
        "c5ed94610c6b08cb3d9e0d0ac4e3121ea4634e0421bf873eeb68dd312d0ed6f4",
      "BWChat/Managers/CallManager.swift":
        "c9e0be06f05c473e3ed083bc21c09bbe63cb3184423b90634a9f1856e57da953",
      "BWChat/Models/Call.swift":
        "cb57f765bd72a70c2ddfe04d76732fd1bd096e847bb2fad6751dc63002a0e0ca",
      "BWChat/Services/APIService.swift":
        "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274",
      "BWChat/Services/WebSocketService.swift":
        "1d9db3787bbcf1c10de58e9861d2c925516c2d8d184c7905ef3320894ddcc262",
      "BWChat/Services/PushService.swift":
        "e84e820a5ec176a9ab1b4f08601037bd50d1a7a78ea37b3d5bfbfa6437b9d161",
      "BWChat/Utils/Constants.swift":
        "efb8861fbf1461deb01d917c44433516aa2ec7373c11b3dc90e1fede170b16cd",
    };
    for (const [relativePath, expectedHash] of Object.entries(hashes)) {
      const copied = readFileSync(resolve(copiedNativeRoot, relativePath));
      const original = readFileSync(resolve(originalNativeRoot, relativePath));
      expect(copied.equals(original)).toBe(true);
      expect(createHash("sha256").update(copied).digest("hex")).toBe(expectedHash);
    }
  });

  it("locks native group-call route, method, envelope and raw decode semantics", () => {
    const nativeAPI = nativeSource("BWChat/Services/APIService.swift");
    const nativeCall = nativeSource("BWChat/Models/Call.swift");
    expect(nativeAPI).toContain(
      String.raw`postJSON(path: "/call/group/\(groupID)/start", body: body)`,
    );
    expect(nativeAPI).toContain(
      String.raw`postJSON(path: "/call/group/\(groupID)/leave", body: body)`,
    );
    expect(nativeAPI).toContain(String.raw`get(path: "/call/group/\(groupID)/status")`);
    expect(nativeAPI).toContain('if let callID, !callID.isEmpty { body["call_id"] = callID }');
    expect(nativeAPI).toContain(
      'if let roomName, !roomName.isEmpty { body["room_name"] = roomName }',
    );
    expect(nativeCall).toContain("callType = try container.decode(String.self, forKey: .callType)");
    expect(nativeCall).toContain(
      "participantCount = try container.decodeIfPresent(Int.self, forKey: .participantCount)",
    );

    expect(api).toContain("`/call/group/${groupId}/start`");
    expect(api).toContain("body: { call_type: callType }");
    expect(api).toContain("`/call/group/${groupId}/leave`");
    expect(api).toContain("options.callId.length > 0");
    expect(api).toContain("{ call_id: options.callId }");
    expect(api).toContain("`/call/group/${groupId}/status`");
    expect(api).toContain("requiredData: true");
    expect(api).toContain("requiredEnvelope: true");
    expect(api).toContain("requireNativeCallJoinResponse(");
    expect(api).toContain('value.call_type !== "voice"');
    expect(api).toContain('value.call_type !== "video"');
    expect(apiClient).toContain("const auth = options.auth ?? true");
    expect(apiClient).toContain('headers.set("Authorization", `Bearer ${token}`)');
    const groupStatusNormalizer = normalizers.slice(
      normalizers.indexOf("export function normalizeGroupCallStatus"),
      normalizers.indexOf("export function normalizeUser"),
    );
    expect(groupStatusNormalizer).toContain("participant_count: value.participant_count");
    expect(groupStatusNormalizer).not.toContain("Math.max");
    expect(overlay).toContain("session.token !== undefined && session.livekit_url !== undefined");
  });

  it("shares the native push-container flattening rules for group invitations", () => {
    const nativePush = nativeSource("BWChat/Services/PushService.swift");
    expect(nativePush).toContain('["data", "payload", "notification_data"]');
    expect(pushService).toContain('["data", "payload", "notification_data"]');
    expect(pushService).toContain("Object.prototype.hasOwnProperty.call(result, nestedKey)");
    expect(provider).toContain(
      "flattenNotificationPayload(notification.request.content.data ?? {})",
    );
    expect(provider).not.toContain("function flattenNotificationData");
  });

  it("locks native group invite/end decoding and identity consumption", () => {
    const nativeManager = nativeSource("BWChat/Managers/CallManager.swift");
    const nativeSocket = nativeSource("BWChat/Services/WebSocketService.swift");
    expect(nativeSocket).toContain('case "group_call_invite":');
    expect(nativeSocket).toContain('case "group_call_ended":');
    expect(realtime).toContain('"group_call_invite"');
    expect(realtime).toContain('"group_call_ended"');
    expect(nativeManager).toContain('guard let groupID = Self.intValue(data["group_id"])');
    expect(nativeManager).toContain("!call.signalIdentity.hasComparableKey(with: signalIdentity)");
    expect(nativeManager).toContain("call.signalIdentity.matches(signalIdentity)");
    expect(policy).toContain("groupId === undefined || session.group_id !== groupId");
    expect(policy).toContain(
      "!hasComparableSignalKey(current, incoming) || signalIdentitiesMatch(current, incoming)",
    );
    expect(provider).toContain("groupCallEndSignalMatchesSession(current, data)");
  });

  it("keeps the native 20-second connect and 3-second post-participant departure gates", () => {
    expect(CALL_CONNECTION_TIMEOUT_MS).toBe(20_000);
    expect(GROUP_REMOTE_DEPARTURE_GRACE_MS).toBe(3_000);
    expect(shouldScheduleCallAutoExit(true, false, 0)).toBe(false);
    expect(shouldScheduleCallAutoExit(true, true, 0)).toBe(true);
    expect(shouldScheduleCallAutoExit(true, true, 1)).toBe(false);
    expect(shouldScheduleCallAutoExit(false, false, 0)).toBe(true);
    expect(overlay).toContain("departureGenerationRef.current += 1");
    expect(overlay).toContain("GROUP_REMOTE_DEPARTURE_GRACE_MS");
    expect(overlay).toContain("CALL_CONNECTION_TIMEOUT_MS");
  });

  it("recovers missing microphone/camera publications after reconnect or foreground", () => {
    expect(overlay).toContain("ConnectionState.Reconnecting");
    expect(overlay).toContain("connectionState === ConnectionState.Connected");
    expect(overlay).toContain('AppState.addEventListener("change"');
    expect(overlay).toContain("retryCallMediaPublication");
    expect(mediaRecovery).toContain("attempt <= 3");
    expect(overlay).toContain("localParticipant.setCameraEnabled(true,");
    expect(overlay).toContain("recoveryGenerationRef.current += 1");
    expect(appConfig).toContain('UIBackgroundModes: ["remote-notification", "audio"]');
  });

  it("matches the native participant identity, media, speaking, and accessibility matrix", () => {
    expect(groupStage).toContain("[roomState.localParticipant, ...roomState.remoteParticipants]");
    expect(groupStage).toContain("speakingParticipants");
    expect(groupStage).toContain("track.publication.isMuted");
    expect(groupStage).toContain("local && call.isFrontCamera");
    expect(overlay).toContain("participantSortKey(left).localeCompare(participantSortKey(right)");
    expect(overlay).toContain("participant.identity ?? participant.sid");
    expect(overlay).toContain("return !publication || publication.isMuted");
    expect(groupParticipants.match(/\baccessible\b/g)).toHaveLength(2);
    expect(overlay).toContain('accessibilityLabel={muted ? `${name}, ${t("call.muted")}` : name}');
  });

  it("tracks first join and last leave without exiting a newly-created empty room", () => {
    expect(overlay).toContain("hasObservedRemoteParticipantRef");
    expect(overlay).toContain("if (remoteParticipants.length > 0)");
    expect(overlay).toContain("remoteCountRef.current === 0");
    expect(overlay).toContain("departureGenerationRef.current === generation");
    expect(overlay).toContain("GROUP_REMOTE_DEPARTURE_GRACE_MS");
    expect(groupStage).toContain("allParticipants.length > 0");
    expect(groupStage).toContain(") : null}");
  });

  it("keeps group calls isolated from one-to-one live roles and billing", () => {
    expect(groupStage).not.toContain("LiveRoleIntroductionCard");
    expect(groupStage).not.toContain("LiveBillingBadge");
    const startGroup = provider.slice(
      provider.indexOf("const startGroupCall"),
      provider.indexOf("const joinGroupCall"),
    );
    expect(startGroup).not.toContain("is_live_pair");
    expect(startGroup).not.toContain("live_role_setting");
    expect(startGroup).not.toContain("live_billing_policy");
  });

  it("retains the native GroupCallView visual measurements and control topology", () => {
    expect(overlay).toContain('groupRoot: { flex: 1, backgroundColor: "#000000" }');
    expect(overlay).toContain("paddingHorizontal: 20");
    expect(overlay).toContain("paddingTop: 16");
    expect(overlay).toContain('groupTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "600" }');
    expect(overlay).toContain("fontSize: 13");
    expect(overlay).toContain("gap: 4");
    expect(overlay).toContain("aspectRatio: 3 / 4");
    expect(overlay).toContain("borderRadius: 8");
    expect(overlay).toContain("width: 64");
    expect(overlay).toContain("height: 64");
    expect(overlay).toContain("borderRadius: 32");
    expect(overlay).toContain("diameter={64}");
    expect(overlay).toContain("diameter={68}");
    expect(overlay).toContain('background="#FF3B30"');
  });

  it("provides native join/leave failure semantics and account-generation isolation", () => {
    expect(provider).toContain("joinGroupCall(target: GroupCallJoinTarget");
    expect(provider).toContain("await api.joinCall(target.roomName)");
    expect(provider).toContain("sessionOwnerIdRef.current !== ownerIdRef.current");
    expect(provider).toContain("previousOwnerId !== undefined && previousOwnerId !== ownerId");
    expect(provider).toContain("`${operation}_group_leave`");
    expect(provider).toContain("current.group_id !== undefined && hasCallSignalIdentity(current)");
    expect(provider).toContain("if (error === undefined)");
    expect(provider).toContain("endCurrentCall(current)");
  });

  it("keeps initial media-device failures in the room and synchronizes local controls", () => {
    expect(overlay).toContain("onMediaDeviceFailure");
    expect(overlay).toContain("MediaDeviceFailure.getFailure(error)");
    expect(overlay).toContain('kind === "audioinput"');
    expect(overlay).toContain("setMuted(true)");
    expect(overlay).toContain('t("call.error.microphoneUnavailable")');
    expect(overlay).toContain('kind === "videoinput"');
    expect(overlay).toContain("setCameraEnabled(false)");
    expect(overlay).toContain('t("call.error.cameraUnavailable")');
    const callback = overlay.slice(
      overlay.indexOf("onMediaDeviceFailure"),
      overlay.indexOf("connectOptions={{ maxRetries: 12 }}"),
    );
    expect(callback).not.toContain("failMedia(");
  });

  it("uses actual active video tracks and native safe-area offsets for the group stage", () => {
    expect(groupStage).toContain("useSafeAreaInsets()");
    expect(groupStage).toContain("paddingTop: insets.top + 16");
    expect(overlay).toContain("paddingBottom: bottomInset + 40");
    expect(groupStage).toContain("track?.publication.track && !track.publication.isMuted");
    expect(groupStage).toContain(
      "cameraEnabled={hasActiveVideoTrack && (!local || call.isCameraEnabled)}",
    );
    expect(groupStage).toContain("track={hasActiveVideoTrack ? track : undefined}");
  });

  it("keeps the original in-app boundary without inventing a CallKit dependency", () => {
    const packageManifest = readFileSync(resolve(root, "package.json"), "utf8").toLowerCase();
    expect(packageManifest).not.toContain("callkeep");
    expect(packageManifest).not.toContain("callkit");
    expect(provider.toLowerCase()).not.toContain("callkeep");
    expect(overlay.toLowerCase()).not.toContain("callkeep");
  });

  it("uses native system symbols and participant initials without a page bitmap asset", () => {
    expect(groupStage).toContain("<GroupVideoParticipant");
    expect(groupStage).toContain("<GroupVoiceParticipant");
    expect(groupParticipants).toContain("<Initial");
    expect(groupStage).toContain('symbol="arrow.down.right.and.arrow.up.left"');
    expect(groupParticipants).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/i);
  });
});

function nativeSource(relativePath: string): string {
  return readFileSync(resolve(copiedNativeRoot, relativePath), "utf8");
}
