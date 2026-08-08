import { requestRecordingPermissionsAsync } from "expo-audio";
import { Camera } from "expo-camera";
import { randomUUID } from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as api from "@/api/bwchat";
import { CallOverlay } from "@/components/calls/CallOverlay";
import { TopToast } from "@/components/TopToast";
import { env } from "@/config/env";
import type {
  CallConnectionCredentials,
  CallSession,
  CallType,
  LiveBillingPolicy,
  LiveExperienceSnapshot,
} from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  callSignalMatchesSession,
  callSignalPayload,
  groupCallEndSignalMatchesSession,
  hasCallSignalIdentity,
  isDuplicateCallInvite,
  LIVE_TERMINATION_RECONCILIATION_MS,
  normalizeLiveKitServerURL,
  parseIncomingCallSignal,
  type IncomingCallSignal,
} from "@/services/calls/callPolicy";
import { publishCallSettlementRefresh } from "@/services/calls/CallSettlementRefreshService";
import { playCallRingPulseAsync } from "@/services/calls/CallSounds";
import { captureException } from "@/services/monitoring/MonitoringService";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";
import { normalizeLiveInvitationPayload } from "@/services/live/LiveInvitationPayload";
import { flattenNotificationPayload } from "@/services/push/PushService";
import {
  isLiveBillingInsufficient,
  liveTerminationGraceMilliseconds,
  normalizeCallLivePayload,
} from "@/services/live/LiveCallExperience";
import { refreshWalletBalance } from "@/services/wallet/WalletRepository";
import { getLiveCallState } from "@/services/live/LiveLobbyRepository";
import type { OneToOneLiveCallState } from "@/services/live/LiveLobbyModels";

interface DirectCallTarget {
  userId: string;
  nickname: string;
  avatarUrl?: string | undefined;
}

interface GroupCallTarget {
  groupId: number;
  groupName: string;
}

interface GroupCallJoinTarget extends GroupCallTarget {
  roomName: string;
}

interface AcceptedLiveCallTarget extends DirectCallTarget {
  roleSetting?: string | undefined;
  billingPolicy?: LiveBillingPolicy | undefined;
  liveExperience?: LiveExperienceSnapshot | undefined;
}

interface CallContextValue {
  session: CallSession | null;
  isMinimized: boolean;
  isMuted: boolean;
  isSpeakerOn: boolean;
  isCameraEnabled: boolean;
  isFrontCamera: boolean;
  isRemotePrimary: boolean;
  startDirectCall(target: DirectCallTarget, callType: CallType): Promise<void>;
  startGroupCall(target: GroupCallTarget, callType: CallType): Promise<void>;
  joinGroupCall(target: GroupCallJoinTarget, callType: CallType): Promise<void>;
  connectAcceptedLiveCall(
    target: AcceptedLiveCallTarget,
    credentials: CallConnectionCredentials,
    callType: CallType,
    isOutgoing: boolean,
  ): Promise<boolean>;
  acceptCall(): Promise<void>;
  rejectCall(): void;
  endCall(): void;
  minimizeCall(): void;
  restoreCall(): void;
  setMuted(value: boolean): void;
  setSpeakerOn(value: boolean): void;
  setCameraEnabled(value: boolean): void;
  setFrontCamera(value: boolean): void;
  setRemotePrimary(value: boolean): void;
  showError(message: string): void;
  markMediaConnected(remoteParticipantCount: number, hasRemoteAudio: boolean): void;
  failMedia(error?: unknown): void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const ownerId = user?.user_id;
  const { t } = useLocalization();
  const [session, setSessionState] = useState<CallSession | null>(null);
  const [isMinimized, setMinimized] = useState(false);
  const [isMuted, setMuted] = useState(false);
  const [isSpeakerOn, setSpeakerOn] = useState(true);
  const [isCameraEnabled, setCameraEnabled] = useState(true);
  const [isFrontCamera, setFrontCamera] = useState(true);
  const [isRemotePrimary, setRemotePrimary] = useState(true);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const sessionRef = useRef<CallSession | null>(null);
  const sessionOwnerIdRef = useRef<string | undefined>(undefined);
  const ownerIdRef = useRef(ownerId);
  const previousOwnerIdRef = useRef(ownerId);
  const ringTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endingSessionIds = useRef(new Set<string>());
  const liveEndingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveReconciliationRef = useRef<{ sessionId: string; sequence: number } | null>(null);
  const liveReconciliationSequenceRef = useRef(0);
  const liveRecoveryRequestRef = useRef<{ sessionId: string; request: Promise<void> } | null>(null);

  const setSession = useCallback((next: CallSession | null) => {
    if (!next) sessionOwnerIdRef.current = undefined;
    else if (sessionRef.current?.id !== next.id) sessionOwnerIdRef.current = ownerIdRef.current;
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  const isCurrentOwner = useCallback(
    (expectedOwnerId: string | undefined) => ownerIdRef.current === expectedOwnerId,
    [],
  );

  const stopRinging = useCallback(() => {
    if (ringTimerRef.current) clearInterval(ringTimerRef.current);
    ringTimerRef.current = null;
  }, []);

  const startRinging = useCallback(
    (outgoing: boolean) => {
      stopRinging();
      const notify = () => {
        void playCallRingPulseAsync(outgoing)
          .then((playedNatively) => {
            if (playedNatively) return;
            if (!outgoing)
              return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          })
          .catch(() => undefined);
      };
      notify();
      ringTimerRef.current = setInterval(notify, outgoing ? 3_000 : 2_000);
    },
    [stopRinging],
  );

  const clearRingTimeout = useCallback(() => {
    if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    ringTimeoutRef.current = null;
  }, []);

  const endLocally = useCallback(
    (expectedSessionId?: string) => {
      const current = sessionRef.current;
      if (!current || (expectedSessionId && current.id !== expectedSessionId)) return;
      stopRinging();
      clearRingTimeout();
      const endedOwnerId = sessionOwnerIdRef.current;
      const shouldRefreshSettlement = Boolean(
        current.is_live_pair && endedOwnerId && endedOwnerId === ownerIdRef.current,
      );
      if (liveEndingTimerRef.current) clearTimeout(liveEndingTimerRef.current);
      liveEndingTimerRef.current = null;
      liveReconciliationSequenceRef.current += 1;
      liveReconciliationRef.current = null;
      liveRecoveryRequestRef.current = null;
      setSession(null);
      setMinimized(false);
      setMuted(false);
      setSpeakerOn(true);
      setCameraEnabled(true);
      setFrontCamera(true);
      setRemotePrimary(true);
      if (shouldRefreshSettlement && endedOwnerId) {
        publishCallSettlementRefresh(endedOwnerId, current.id);
        void refreshWalletBalance(endedOwnerId).catch(() => undefined);
      }
    },
    [clearRingTimeout, setSession, stopRinging],
  );

  const applyCredentials = useCallback(
    (
      sessionId: string,
      credentials: Pick<
        CallConnectionCredentials,
        "call_id" | "room_name" | "token" | "livekit_url"
      >,
    ) => {
      const livekitUrl = normalizeLiveKitServerURL(credentials.livekit_url, env.apiBaseUrl);
      const current = sessionRef.current;
      if (!current || current.id !== sessionId) return false;
      setSession({
        ...current,
        ...(credentials.call_id !== undefined ? { call_id: credentials.call_id } : {}),
        room_name: credentials.room_name,
        token: credentials.token,
        livekit_url: livekitUrl,
      });
      return true;
    },
    [setSession],
  );

  const ensurePermissions = useCallback(
    async (
      callType: CallType,
      expectedOwnerId: string | undefined = ownerIdRef.current,
    ): Promise<boolean> => {
      const microphone = await requestRecordingPermissionsAsync();
      if (!isCurrentOwner(expectedOwnerId)) return false;
      if (!microphone.granted) {
        setErrorToast(t("call.error.permission.microphone"));
        return false;
      }
      if (callType === "video") {
        const camera = await Camera.requestCameraPermissionsAsync();
        if (!isCurrentOwner(expectedOwnerId)) return false;
        if (!camera.granted) {
          setErrorToast(t("call.error.permission.camera"));
          return false;
        }
      }
      return true;
    },
    [isCurrentOwner, t],
  );

  const reportAndClose = useCallback(
    (
      error: unknown,
      operation: string,
      message: string,
      sessionId: string,
      expectedOwnerId: string | undefined = ownerIdRef.current,
    ) => {
      captureException(error, { operation });
      if (!isCurrentOwner(expectedOwnerId)) return;
      const current = sessionRef.current;
      if (!current || current.id !== sessionId) return;
      if (sessionOwnerIdRef.current !== expectedOwnerId) return;
      if (current.group_id !== undefined && hasCallSignalIdentity(current)) {
        void api
          .leaveGroupCall(current.group_id, {
            ...(current.call_id ? { callId: current.call_id } : {}),
            ...(current.room_name ? { roomName: current.room_name } : {}),
          })
          .catch((leaveError) =>
            captureException(leaveError, { operation: `${operation}_group_leave` }),
          );
      } else if (
        current.remote_user_id &&
        (Boolean(current.call_id?.trim()) || Boolean(current.room_name?.trim()))
      ) {
        chatRealtimeService.send("call_end", callSignalPayload(current));
        if (current.call_id) {
          void api
            .endCall(current.call_id)
            .catch((endError) =>
              captureException(endError, { operation: `${operation}_call_end` }),
            );
        }
      }
      setErrorToast(message);
      endLocally(sessionId);
    },
    [endLocally, isCurrentOwner],
  );

  const startDirectCall = useCallback(
    async (target: DirectCallTarget, callType: CallType) => {
      if (sessionRef.current) return;
      const operationOwnerId = ownerIdRef.current;
      const next: CallSession = {
        id: randomUUID(),
        remote_user_id: target.userId,
        remote_nickname: target.nickname,
        remote_avatar_url: target.avatarUrl ?? "",
        call_type: callType,
        is_outgoing: true,
        state: "outgoing",
        started_at: Date.now(),
      };
      setSession(next);
      if (!(await ensurePermissions(callType, operationOwnerId))) {
        endLocally(next.id);
        return;
      }
      if (!isCurrentOwner(operationOwnerId)) return;
      const currentAfterPermissions = sessionRef.current as CallSession | null;
      if (currentAfterPermissions?.id !== next.id) return;
      startRinging(true);
      try {
        const credentials = await api.startDirectCall(target.userId, callType);
        if (!isCurrentOwner(operationOwnerId)) return;
        if (!applyCredentials(next.id, credentials)) return;
        clearRingTimeout();
        ringTimeoutRef.current = setTimeout(() => {
          const timedOut = sessionRef.current;
          if (!timedOut || timedOut.id !== next.id || timedOut.state !== "outgoing") return;
          chatRealtimeService.send("call_end", callSignalPayload(timedOut));
          if (timedOut.call_id) {
            void api
              .endCall(timedOut.call_id)
              .catch((error) =>
                captureException(error, { operation: "call_ring_timeout_fallback" }),
              );
          }
          endLocally(timedOut.id);
        }, 45_000);
      } catch (error) {
        reportAndClose(
          error,
          "call_start",
          t("call.error.start", errorMessage(error)),
          next.id,
          operationOwnerId,
        );
      }
    },
    [
      applyCredentials,
      clearRingTimeout,
      endLocally,
      ensurePermissions,
      isCurrentOwner,
      reportAndClose,
      setSession,
      startRinging,
      t,
    ],
  );

  const startGroupCall = useCallback(
    async (target: GroupCallTarget, callType: CallType) => {
      if (sessionRef.current) return;
      const operationOwnerId = ownerIdRef.current;
      const next: CallSession = {
        id: randomUUID(),
        remote_user_id: "",
        remote_nickname: target.groupName,
        remote_avatar_url: "",
        call_type: callType,
        is_outgoing: true,
        state: "connecting",
        started_at: Date.now(),
        group_id: target.groupId,
        group_name: target.groupName,
      };
      setSession(next);
      if (!(await ensurePermissions(callType, operationOwnerId))) {
        endLocally(next.id);
        return;
      }
      if (!isCurrentOwner(operationOwnerId)) return;
      const currentAfterPermissions = sessionRef.current as CallSession | null;
      if (currentAfterPermissions?.id !== next.id) return;
      try {
        const credentials = await api.startGroupCall(target.groupId, callType);
        if (!isCurrentOwner(operationOwnerId)) return;
        applyCredentials(next.id, credentials);
      } catch (error) {
        reportAndClose(
          error,
          "group_call_start",
          t("call.error.start", errorMessage(error)),
          next.id,
          operationOwnerId,
        );
      }
    },
    [
      applyCredentials,
      endLocally,
      ensurePermissions,
      isCurrentOwner,
      reportAndClose,
      setSession,
      t,
    ],
  );

  const joinGroupCall = useCallback(
    async (target: GroupCallJoinTarget, callType: CallType) => {
      if (sessionRef.current) return;
      const operationOwnerId = ownerIdRef.current;
      const next: CallSession = {
        id: randomUUID(),
        remote_user_id: "",
        remote_nickname: target.groupName,
        remote_avatar_url: "",
        call_type: callType,
        is_outgoing: false,
        state: "connecting",
        started_at: Date.now(),
        room_name: target.roomName,
        group_id: target.groupId,
        group_name: target.groupName,
      };
      setSession(next);
      if (!(await ensurePermissions(callType, operationOwnerId))) {
        endLocally(next.id);
        return;
      }
      const currentAfterPermissions = sessionRef.current as CallSession | null;
      if (!isCurrentOwner(operationOwnerId) || currentAfterPermissions?.id !== next.id) return;
      try {
        const credentials = await api.joinCall(target.roomName);
        if (!isCurrentOwner(operationOwnerId)) return;
        applyCredentials(next.id, credentials);
      } catch (error) {
        reportAndClose(
          error,
          "group_call_join",
          t("call.error.join", errorMessage(error)),
          next.id,
          operationOwnerId,
        );
      }
    },
    [
      applyCredentials,
      endLocally,
      ensurePermissions,
      isCurrentOwner,
      reportAndClose,
      setSession,
      t,
    ],
  );

  const connectAcceptedLiveCall = useCallback(
    async (
      target: AcceptedLiveCallTarget,
      credentials: CallConnectionCredentials,
      callType: CallType,
      isOutgoing: boolean,
    ): Promise<boolean> => {
      const operationOwnerId = ownerIdRef.current;
      if (
        sessionRef.current ||
        !(await ensurePermissions(callType, operationOwnerId)) ||
        !isCurrentOwner(operationOwnerId) ||
        sessionRef.current
      )
        return false;
      const next: CallSession = {
        id: randomUUID(),
        remote_user_id: target.userId,
        remote_nickname: target.nickname,
        remote_avatar_url: target.avatarUrl ?? "",
        call_type: credentials.call_type ?? callType,
        is_outgoing: isOutgoing,
        state: "connecting",
        started_at: Date.now(),
        ...(credentials.call_id ? { call_id: credentials.call_id } : {}),
        room_name: credentials.room_name,
        token: credentials.token,
        livekit_url: normalizeLiveKitServerURL(credentials.livekit_url, env.apiBaseUrl),
        is_live_pair: true,
        ...(target.roleSetting ? { live_role_setting: target.roleSetting } : {}),
        ...((credentials.billing_policy ?? target.billingPolicy)
          ? { live_billing_policy: credentials.billing_policy ?? target.billingPolicy }
          : {}),
        ...((credentials.live_experience ?? target.liveExperience)
          ? { live_experience: credentials.live_experience ?? target.liveExperience }
          : {}),
      };
      setSession(next);
      return true;
    },
    [ensurePermissions, isCurrentOwner, setSession],
  );

  const acceptCall = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.state !== "incoming" || current.room_name === undefined) return;
    const operationOwnerId = ownerIdRef.current;
    const roomName = current.room_name;
    const claimed = { ...current, state: "connecting" as const };
    setSession(claimed);
    stopRinging();
    if (!(await ensurePermissions(claimed.call_type, operationOwnerId))) {
      if (!isCurrentOwner(operationOwnerId)) return;
      if (claimed.group_id === undefined && claimed.remote_user_id) {
        chatRealtimeService.send("call_reject", callSignalPayload(claimed, "permission_denied"));
      }
      endLocally(claimed.id);
      return;
    }
    if (!isCurrentOwner(operationOwnerId) || sessionRef.current?.id !== claimed.id) return;
    try {
      const credentials = await api.joinCall(roomName);
      if (!isCurrentOwner(operationOwnerId)) return;
      applyCredentials(claimed.id, credentials);
    } catch (error) {
      reportAndClose(
        error,
        "call_join",
        t("call.error.join", errorMessage(error)),
        claimed.id,
        operationOwnerId,
      );
    }
  }, [
    applyCredentials,
    endLocally,
    ensurePermissions,
    isCurrentOwner,
    reportAndClose,
    setSession,
    stopRinging,
    t,
  ]);

  const endCurrentCall = useCallback(
    (current: CallSession) => {
      if (endingSessionIds.current.has(current.id)) return;
      endingSessionIds.current.add(current.id);
      if (sessionOwnerIdRef.current !== ownerIdRef.current) {
        endLocally(current.id);
        endingSessionIds.current.delete(current.id);
        return;
      }
      if (current.group_id !== undefined) {
        void api
          .leaveGroupCall(current.group_id, {
            ...(current.call_id ? { callId: current.call_id } : {}),
            ...(current.room_name ? { roomName: current.room_name } : {}),
          })
          .catch((error) => captureException(error, { operation: "group_call_leave" }));
      } else if (current.remote_user_id) {
        chatRealtimeService.send("call_end", callSignalPayload(current));
        if (current.call_id) {
          void api
            .endCall(current.call_id)
            .catch((error) => captureException(error, { operation: "call_end_fallback" }));
        }
      }
      endLocally(current.id);
      endingSessionIds.current.delete(current.id);
    },
    [endLocally],
  );

  const endCall = useCallback(() => {
    const current = sessionRef.current;
    if (current) endCurrentCall(current);
  }, [endCurrentCall]);

  const rejectCall = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    if (current.group_id === undefined && current.remote_user_id) {
      chatRealtimeService.send("call_reject", callSignalPayload(current, "declined"));
      if (current.call_id) {
        void api
          .rejectCall(current.call_id)
          .catch((error) => captureException(error, { operation: "call_reject_fallback" }));
      }
    }
    endLocally(current.id);
  }, [endLocally]);

  const receiveInvite = useCallback(
    (incoming: IncomingCallSignal) => {
      if (!ownerIdRef.current) return;
      const current = sessionRef.current;
      if (current) {
        if (isDuplicateCallInvite(current, incoming)) return;
        if (incoming.group_id === undefined && incoming.caller_id) {
          const payload = {
            remote_user_id: incoming.caller_id,
            ...(incoming.call_id ? { call_id: incoming.call_id } : {}),
            room_name: incoming.room_name,
          };
          chatRealtimeService.send("call_busy", callSignalPayload(payload));
        }
        if (incoming.group_id === undefined && incoming.call_id) {
          void api
            .markCallBusy(incoming.call_id)
            .catch((error) => captureException(error, { operation: "call_busy_fallback" }));
        }
        return;
      }
      setSession({
        id: randomUUID(),
        remote_user_id: incoming.caller_id,
        remote_nickname: incoming.group_name ?? incoming.caller_name,
        remote_avatar_url: incoming.caller_avatar,
        call_type: incoming.call_type,
        is_outgoing: false,
        state: "incoming",
        started_at: Date.now(),
        ...(incoming.call_id !== undefined ? { call_id: incoming.call_id } : {}),
        room_name: incoming.room_name,
        ...(incoming.group_id !== undefined ? { group_id: incoming.group_id } : {}),
        ...(incoming.group_name !== undefined ? { group_name: incoming.group_name } : {}),
      });
      startRinging(false);
    },
    [setSession, startRinging],
  );

  const handleSignal = useCallback(
    (signalType: string, data: Record<string, unknown>) => {
      const incoming = parseIncomingCallSignal(signalType, data);
      if (incoming) {
        receiveInvite(incoming);
        return;
      }
      const current = sessionRef.current;
      if (!current) return;
      if (signalType === "group_call_ended") {
        if (groupCallEndSignalMatchesSession(current, data)) {
          endLocally(current.id);
        }
        return;
      }
      if (
        ["call_end", "call_reject", "call_busy"].includes(signalType) &&
        callSignalMatchesSession(current, data)
      ) {
        endLocally(current.id);
      }
    },
    [endLocally, receiveInvite],
  );

  const handleLiveSignal = useCallback(
    (signalType: string, rawData: Record<string, unknown>) => {
      const current = sessionRef.current;
      if (!current?.is_live_pair || !current.call_id) return;
      const data = normalizeLiveInvitationPayload(rawData);
      if (stringValue(data.call_id ?? data.callId) !== current.call_id) return;
      const livePayload = normalizeCallLivePayload(data);
      let next: CallSession = {
        ...current,
        ...(livePayload.billingPolicy ? { live_billing_policy: livePayload.billingPolicy } : {}),
        ...(livePayload.liveExperience ? { live_experience: livePayload.liveExperience } : {}),
      };

      if (isValidLiveBillingUpdate(data)) {
        if (current.is_outgoing) {
          next = {
            ...next,
            ...optionalNonNegative(
              "confirmed_live_activity_cat_food_charge",
              data.charged_activity_cat_food,
            ),
            ...optionalNonNegative("confirmed_live_gold_coin_charge", data.charged_gold_coins),
            ...optionalNonNegative("confirmed_live_total_charge", data.total_charged),
          };
          const liveOwnerId = sessionOwnerIdRef.current;
          if (
            liveOwnerId &&
            liveOwnerId === ownerIdRef.current &&
            [
              data.gold_coin_balance_after,
              data.activity_cat_food_balance_after,
              data.spendable_balance_after,
            ].every((value) => intValue(value) !== undefined)
          ) {
            void refreshWalletBalance(liveOwnerId).catch(() => undefined);
          }
        } else {
          next = {
            ...next,
            ...optionalNonNegative("confirmed_live_earning_gold_coins", data.earned_gold_coins),
          };
        }
      }

      if (
        signalType === "one_to_one_live.billing_insufficient" ||
        isLiveBillingInsufficient(data)
      ) {
        const media = current.call_type === "voice" ? "语音" : "视频";
        next = {
          ...next,
          live_ending_message: current.is_outgoing
            ? `金币余额不足，本次${media}即将结束`
            : `对方余额不足，本次${media}即将结束`,
          ...optionalEndingDetail(current.is_outgoing, next, data, t),
        };
        setMinimized(false);
        if (!liveEndingTimerRef.current) {
          const sessionId = current.id;
          liveEndingTimerRef.current = setTimeout(
            () => endLocally(sessionId),
            liveTerminationGraceMilliseconds(data),
          );
        }
      }
      setSession(next);
    },
    [endLocally, setSession, t],
  );

  const isCurrentLiveOperation = useCallback(
    (sessionId: string, expectedOwnerId: string | undefined, sequence: number) =>
      isCurrentOwner(expectedOwnerId) &&
      sessionOwnerIdRef.current === expectedOwnerId &&
      sessionRef.current?.id === sessionId &&
      liveReconciliationRef.current?.sequence === sequence,
    [isCurrentOwner],
  );

  const applyRecoveredLiveState = useCallback(
    (state: OneToOneLiveCallState): boolean => {
      const current = sessionRef.current;
      if (!current?.is_live_pair || !current.call_id || current.call_id !== state.callId) {
        return false;
      }
      const recovered = recoveredLiveTerminationData(state);
      if (isLiveBillingInsufficient(recovered)) {
        handleLiveSignal("one_to_one_live.billing_insufficient", recovered);
        return true;
      }
      const livePayload = normalizeCallLivePayload(recovered);
      if (livePayload.billingPolicy || livePayload.liveExperience) {
        setSession({
          ...current,
          ...(livePayload.billingPolicy ? { live_billing_policy: livePayload.billingPolicy } : {}),
          ...(livePayload.liveExperience ? { live_experience: livePayload.liveExperience } : {}),
        });
      }
      return false;
    },
    [handleLiveSignal, setSession],
  );

  const reconcileLiveTermination = useCallback(
    (
      current: CallSession,
      options: {
        notifyRemote: boolean;
        failure?: { error: unknown; operation: string; message: string } | undefined;
      },
    ) => {
      if (!current.is_live_pair || !current.call_id) return;
      if (liveReconciliationRef.current?.sessionId === current.id) return;
      const operationOwnerId = sessionOwnerIdRef.current;
      const sequence = ++liveReconciliationSequenceRef.current;
      liveReconciliationRef.current = { sessionId: current.id, sequence };
      const startedAt = Date.now();

      void Promise.race([
        getLiveCallState(current.call_id).catch(() => undefined),
        delay(LIVE_TERMINATION_RECONCILIATION_MS).then(() => undefined),
      ])
        .then(async (state) => {
          if (!isCurrentLiveOperation(current.id, operationOwnerId, sequence)) return;
          if (state) {
            const wasInsufficient = applyRecoveredLiveState(state);
            if (!isCurrentLiveOperation(current.id, operationOwnerId, sequence)) return;
            if (wasInsufficient) return;
          }

          const remaining =
            LIVE_TERMINATION_RECONCILIATION_MS - Math.max(Date.now() - startedAt, 0);
          if (remaining > 0) await delay(remaining);
          if (!isCurrentLiveOperation(current.id, operationOwnerId, sequence)) return;

          if (options.failure) {
            captureException(options.failure.error, { operation: options.failure.operation });
            setErrorToast(options.failure.message);
          }
          const latest = sessionRef.current;
          if (!latest || latest.id !== current.id) return;
          if (options.notifyRemote) endCurrentCall(latest);
          else endLocally(latest.id);
        })
        .finally(() => {
          if (liveReconciliationRef.current?.sequence === sequence) {
            liveReconciliationRef.current = null;
          }
        });
    },
    [applyRecoveredLiveState, endCurrentCall, endLocally, isCurrentLiveOperation],
  );

  const handleLiveCallEnd = useCallback(
    (data: Record<string, unknown>): boolean => {
      const current = sessionRef.current;
      if (!current?.is_live_pair || !callSignalMatchesSession(current, data)) return false;
      const normalized = normalizeLiveInvitationPayload(data);
      if (isLiveBillingInsufficient(normalized)) {
        handleLiveSignal("one_to_one_live.billing_insufficient", normalized);
      } else {
        reconcileLiveTermination(current, { notifyRemote: false });
      }
      return true;
    },
    [handleLiveSignal, reconcileLiveTermination],
  );

  const recoverLiveState = useCallback(() => {
    const current = sessionRef.current;
    if (!current?.is_live_pair || !current.call_id || liveEndingTimerRef.current) return;
    if (liveRecoveryRequestRef.current?.sessionId === current.id) return;
    const operationOwnerId = sessionOwnerIdRef.current;
    const sessionId = current.id;
    let request: Promise<void>;
    request = getLiveCallState(current.call_id)
      .then((state) => {
        if (
          !isCurrentOwner(operationOwnerId) ||
          sessionOwnerIdRef.current !== operationOwnerId ||
          sessionRef.current?.id !== sessionId
        )
          return;
        applyRecoveredLiveState(state);
      })
      .catch(() => undefined)
      .finally(() => {
        if (liveRecoveryRequestRef.current?.request === request) {
          liveRecoveryRequestRef.current = null;
        }
      });
    liveRecoveryRequestRef.current = { sessionId, request };
  }, [applyRecoveredLiveState, isCurrentOwner]);

  useEffect(
    () =>
      chatRealtimeService.subscribe((event) => {
        if (event.type === "call_signal") {
          if (event.signal_type === "call_end" && handleLiveCallEnd(event.data)) return;
          handleSignal(event.signal_type, event.data);
        } else if (event.type === "live_signal") handleLiveSignal(event.signal_type, event.data);
      }),
    [handleLiveCallEnd, handleLiveSignal, handleSignal],
  );

  useEffect(() => {
    let isInitialStatus = true;
    return chatRealtimeService.subscribeStatus((status) => {
      if (isInitialStatus) {
        isInitialStatus = false;
        return;
      }
      if (status === "connected") recoverLiveState();
    });
  }, [recoverLiveState]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && previousState !== "active") recoverLiveState();
      previousState = nextState;
    });
    return () => subscription.remove();
  }, [recoverLiveState]);

  useEffect(() => {
    const handleNotification = (notification: Notifications.Notification) => {
      const data = flattenNotificationPayload(notification.request.content.data ?? {});
      const rawType = stringValue(data.push_type ?? data.event_type)?.toLocaleLowerCase();
      const signalType =
        rawType === "call"
          ? "call_invite"
          : rawType === "group_call"
            ? "group_call_invite"
            : rawType;
      if (signalType) handleSignal(signalType, data);
    };
    const received = Notifications.addNotificationReceivedListener(handleNotification);
    const response = Notifications.addNotificationResponseReceivedListener((value) =>
      handleNotification(value.notification),
    );
    void Notifications.getLastNotificationResponseAsync()
      .then((value) => {
        if (value) handleNotification(value.notification);
      })
      .catch(() => undefined);
    return () => {
      received.remove();
      response.remove();
    };
  }, [handleSignal]);

  useLayoutEffect(() => {
    ownerIdRef.current = ownerId;
    const previousOwnerId = previousOwnerIdRef.current;
    previousOwnerIdRef.current = ownerId;
    if (!ownerId || (previousOwnerId !== undefined && previousOwnerId !== ownerId)) {
      setErrorToast(null);
      endLocally();
    }
  }, [endLocally, ownerId]);

  useEffect(
    () => () => {
      stopRinging();
      clearRingTimeout();
      if (liveEndingTimerRef.current) clearTimeout(liveEndingTimerRef.current);
      liveEndingTimerRef.current = null;
      liveReconciliationSequenceRef.current += 1;
      liveReconciliationRef.current = null;
      liveRecoveryRequestRef.current = null;
    },
    [clearRingTimeout, stopRinging],
  );

  const markMediaConnected = useCallback(
    (remoteParticipantCount: number, hasRemoteAudio: boolean) => {
      const current = sessionRef.current;
      if (!current || current.state === "connected") return;
      const shouldConnect =
        current.group_id !== undefined ||
        !current.is_outgoing ||
        (remoteParticipantCount > 0 && hasRemoteAudio);
      if (!shouldConnect) return;
      stopRinging();
      clearRingTimeout();
      setSession({ ...current, state: "connected", connected_at: Date.now() });
    },
    [clearRingTimeout, setSession, stopRinging],
  );

  const failMedia = useCallback(
    (error?: unknown) => {
      const current = sessionRef.current;
      if (!current) return;
      const operationOwnerId = ownerIdRef.current;
      if (current.is_live_pair && current.call_id) {
        reconcileLiveTermination(current, {
          notifyRemote: true,
          ...(error !== undefined
            ? {
                failure: {
                  error,
                  operation: "live_call_media_connection",
                  message: t("call.error.connection"),
                },
              }
            : {}),
        });
        return;
      }
      if (error === undefined) {
        endCurrentCall(current);
        return;
      }
      reportAndClose(
        error,
        "call_media_connection",
        t("call.error.connection"),
        current.id,
        operationOwnerId,
      );
    },
    [endCurrentCall, reconcileLiveTermination, reportAndClose, t],
  );

  const value = useMemo<CallContextValue>(
    () => ({
      session,
      isMinimized,
      isMuted,
      isSpeakerOn,
      isCameraEnabled,
      isFrontCamera,
      isRemotePrimary,
      startDirectCall,
      startGroupCall,
      joinGroupCall,
      connectAcceptedLiveCall,
      acceptCall,
      rejectCall,
      endCall,
      minimizeCall: () => setMinimized(true),
      restoreCall: () => setMinimized(false),
      setMuted,
      setSpeakerOn,
      setCameraEnabled,
      setFrontCamera,
      setRemotePrimary,
      showError: setErrorToast,
      markMediaConnected,
      failMedia,
    }),
    [
      acceptCall,
      connectAcceptedLiveCall,
      endCall,
      failMedia,
      isCameraEnabled,
      isFrontCamera,
      isMinimized,
      isMuted,
      isRemotePrimary,
      isSpeakerOn,
      markMediaConnected,
      rejectCall,
      session,
      joinGroupCall,
      startDirectCall,
      startGroupCall,
    ],
  );

  return (
    <CallContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        <CallOverlay />
        <TopToast
          duration={4_000}
          message={errorToast}
          onDismiss={() => setErrorToast(null)}
          topInset={insets.top}
        />
      </View>
    </CallContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const value = useContext(CallContext);
  if (!value) throw new Error("useCall must be used inside CallProvider");
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function intValue(value: unknown): number | undefined {
  const parsed = Number(stringValue(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function optionalNonNegative<Key extends keyof CallSession>(
  key: Key,
  value: unknown,
): Partial<CallSession> {
  const parsed = intValue(value);
  return parsed !== undefined ? ({ [key]: Math.max(parsed, 0) } as Partial<CallSession>) : {};
}

function isValidLiveBillingUpdate(data: Record<string, unknown>): boolean {
  const activity = intValue(data.charged_activity_cat_food);
  const gold = intValue(data.charged_gold_coins);
  const total = intValue(data.total_charged);
  const values = [
    activity,
    gold,
    total,
    intValue(data.earned_gold_coins),
    intValue(data.gold_coin_balance_after),
    intValue(data.activity_cat_food_balance_after),
    intValue(data.spendable_balance_after),
  ].filter((value): value is number => value !== undefined);
  if (values.some((value) => value < 0)) return false;
  return (
    activity === undefined || gold === undefined || total === undefined || total === activity + gold
  );
}

function optionalEndingDetail(
  isPayer: boolean,
  session: CallSession,
  data: Record<string, unknown>,
  t: (key: string, ...args: (string | number)[]) => string,
): Partial<CallSession> {
  const lines: string[] = [];
  if (isPayer) {
    const activity =
      intValue(data.charged_activity_cat_food) ?? session.confirmed_live_activity_cat_food_charge;
    const gold = intValue(data.charged_gold_coins) ?? session.confirmed_live_gold_coin_charge;
    const total = intValue(data.total_charged) ?? session.confirmed_live_total_charge;
    if (activity !== undefined && activity > 0)
      lines.push(t("live.billing.chargedActivityCatFood", activity));
    if (gold !== undefined && gold > 0) lines.push(t("live.billing.chargedGoldCoins", gold));
    if (total !== undefined) lines.push(t("live.billing.totalCharged", Math.max(total, 0)));
    const goldAfter = intValue(data.gold_coin_balance_after);
    const activityAfter = intValue(data.activity_cat_food_balance_after);
    const spendableAfter = intValue(data.spendable_balance_after);
    if (goldAfter !== undefined && activityAfter !== undefined && spendableAfter !== undefined)
      lines.push(
        t(
          "live.billing.balanceAfter",
          Math.max(goldAfter, 0),
          Math.max(activityAfter, 0),
          Math.max(spendableAfter, 0),
        ),
      );
  } else {
    const earned = intValue(data.earned_gold_coins) ?? session.confirmed_live_earning_gold_coins;
    if (earned !== undefined) lines.push(t("live.billing.earnedGoldCoins", Math.max(earned, 0)));
  }
  return lines.length > 0 ? { live_ending_detail: lines.join("\n") } : {};
}

function recoveredLiveTerminationData(state: OneToOneLiveCallState): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      call_id: state.callId,
      status: state.status,
      reason: state.endReason ?? state.finalBilling?.billingStatus,
      end_reason: state.endReason,
      termination_grace_ms: state.terminationGraceMilliseconds,
      charged_activity_cat_food: state.finalBilling?.chargedActivityCatFood,
      charged_gold_coins: state.finalBilling?.chargedGoldCoins,
      total_charged: state.finalBilling?.totalCharged,
      earned_gold_coins: state.finalBilling?.earnedGoldCoins,
      gold_coin_balance_after: state.finalBilling?.goldCoinBalanceAfter,
      activity_cat_food_balance_after: state.finalBilling?.activityCatFoodBalanceAfter,
      spendable_balance_after: state.finalBilling?.spendableBalanceAfter,
      billing_policy: state.billingPolicy,
      live_experience: state.liveExperience,
    }).filter((entry) => entry[1] !== undefined),
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
