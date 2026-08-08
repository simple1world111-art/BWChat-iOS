import { BlurView } from "expo-blur";
import { randomUUID } from "expo-crypto";
import { SymbolView } from "expo-symbols";
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
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { TopToast } from "@/components/TopToast";
import { APIError } from "@/api/client";
import type { CallType } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useCall } from "@/providers/CallProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { usePropInventory } from "@/providers/PropInventoryProvider";
import {
  acceptLiveCall,
  cancelLiveCall,
  getLiveCallState,
  joinAcceptedLiveCall,
  rejectLiveCall,
  requestLiveCall,
} from "@/services/live/LiveLobbyRepository";
import {
  fallbackLiveBillingPolicy,
  normalizeLiveBillingPolicy,
  type LiveBillingPolicy,
  type LiveLobbyParticipant,
} from "@/services/live/LiveLobbyModels";
import { normalizeLiveInvitationPayload } from "@/services/live/LiveInvitationPayload";
import { normalizeCallLivePayload } from "@/services/live/LiveCallExperience";
import { selectMainTabThenPush } from "@/services/main-tab/MainTabNavigation";
import { correlateLiveCallEvent, liveCallErrorMessage } from "@/services/live/LiveCallPolicy";
import {
  liveExperienceCardKind,
  liveExperienceDefinition,
  liveExperienceDuration,
  liveExperienceKindFromDefinition,
  liveExperienceReservation,
} from "@/services/props/PropInventoryModels";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";
import { refreshWalletBalance } from "@/services/wallet/WalletRepository";
import { colors } from "@/theme";

type InvitationDirection = "incoming" | "outgoing";
type PaymentMethod = { type: "spendable_balance" } | { type: "prop_card"; definitionId: string };

interface LivePeer {
  userId: string;
  username: string;
  avatarUrl: string;
  roleSetting: string;
}

interface PendingInvitation {
  localId: string;
  ownerId: string;
  callId?: string | undefined;
  slotId: string;
  peer: LivePeer;
  requestedRoleSetting?: string | undefined;
  callType: CallType;
  billingPolicy: LiveBillingPolicy;
  paymentMethod: PaymentMethod;
  liveExperience?: Record<string, unknown> | undefined;
  direction: InvitationDirection;
}

interface LiveCallContextValue {
  hasInvitation: boolean;
  isIncoming: boolean;
  isWorking: boolean;
  remainingSeconds: number;
  errorMessage?: string | undefined;
  requestCall(input: {
    participant: LiveLobbyParticipant;
    callType: CallType;
    billingPolicy: LiveBillingPolicy;
    isCurrentUserLive: boolean;
    paymentMethod?: PaymentMethod | undefined;
  }): Promise<boolean>;
  acceptIncoming(): Promise<void>;
  rejectIncoming(): void;
  cancelOutgoing(): void;
  clearError(): void;
}

const LiveCallContext = createContext<LiveCallContextValue | null>(null);

export function LiveCallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const ownerId = user?.user_id.trim() ?? "";
  const { session, connectAcceptedLiveCall } = useCall();
  const { t } = useLocalization();
  const { applyLiveExperienceReservation, load: loadPropInventory } = usePropInventory();
  const [invitation, setInvitationState] = useState<PendingInvitation | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(15);
  const [isWorking, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [stateOwnerId, setStateOwnerId] = useState(ownerId);
  const invitationRef = useRef<PendingInvitation | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconciliationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconciliationCountRef = useRef(0);
  const supportsReconciliationRef = useRef(true);
  const deferredAcceptedRef = useRef(new Set<string>());
  const deferredClosedRef = useRef(new Set<string>());
  const joiningCallIdRef = useRef<string | undefined>(undefined);
  const idempotencyKeysRef = useRef(new Map<string, string>());
  const activeOwnerRef = useRef(ownerId);
  const outgoingRequestTokenRef = useRef<string | undefined>(undefined);

  const publishInvitation = useCallback((value: PendingInvitation | null) => {
    invitationRef.current = value;
    setInvitationState(value);
  }, []);
  const clearTimers = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (reconciliationRef.current) clearTimeout(reconciliationRef.current);
    countdownRef.current = null;
    reconciliationRef.current = null;
    reconciliationCountRef.current = 0;
  }, []);
  const clearInvitation = useCallback(
    (refreshProps = true) => {
      const pending = invitationRef.current;
      clearTimers();
      deferredAcceptedRef.current.clear();
      deferredClosedRef.current.clear();
      joiningCallIdRef.current = undefined;
      publishInvitation(null);
      setRemainingSeconds(15);
      setWorking(false);
      if (refreshProps && pending?.paymentMethod.type === "prop_card") void loadPropInventory(true);
    },
    [clearTimers, loadPropInventory, publishInvitation],
  );

  const cancelOrRejectExpired = useCallback(
    (pending: PendingInvitation) => {
      if (!pending.callId || pending.ownerId !== activeOwnerRef.current) return;
      if (pending.direction === "incoming")
        void rejectLiveCall(pending.callId, "timeout").catch(() => undefined);
      else
        void cancelLiveCall(pending.callId)
          .catch(() => undefined)
          .finally(() => {
            if (pending.paymentMethod.type === "prop_card") void loadPropInventory(true);
          });
    },
    [loadPropInventory],
  );

  const startCountdown = useCallback(
    (localId: string) => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      setRemainingSeconds(15);
      countdownRef.current = setInterval(() => {
        const current = invitationRef.current;
        if (!current || current.localId !== localId) {
          clearTimers();
          return;
        }
        if (current.ownerId !== activeOwnerRef.current) {
          clearInvitation(false);
          return;
        }
        setRemainingSeconds((value) => {
          if (value > 1) return value - 1;
          cancelOrRejectExpired(current);
          clearInvitation(false);
          return 15;
        });
      }, 1_000);
    },
    [cancelOrRejectExpired, clearInvitation, clearTimers],
  );

  const activateCall = useCallback(
    async (
      pending: PendingInvitation,
      credentials: Awaited<ReturnType<typeof acceptLiveCall>>,
      isOutgoing: boolean,
    ) => {
      if (activeOwnerRef.current !== pending.ownerId) return;
      const livePayload = normalizeCallLivePayload({
        billing_policy: pending.billingPolicy,
        live_experience: pending.liveExperience,
      });
      clearInvitation();
      selectMainTabThenPush("messages", {
        pathname: "/chat/[id]",
        params: { id: pending.peer.userId, name: pending.peer.username },
      });
      await delay(120);
      const connected = await connectAcceptedLiveCall(
        {
          userId: pending.peer.userId,
          nickname: pending.peer.username,
          avatarUrl: pending.peer.avatarUrl,
          roleSetting: pending.peer.roleSetting,
          ...livePayload,
        },
        credentials,
        credentials.call_type ?? pending.callType,
        isOutgoing,
      );
      if (!connected) setErrorMessage("当前已有通话或缺少媒体权限");
    },
    [clearInvitation, connectAcceptedLiveCall],
  );

  const joinAccepted = useCallback(
    (pending: PendingInvitation, callId: string) => {
      if (
        invitationRef.current?.localId !== pending.localId ||
        pending.ownerId !== activeOwnerRef.current ||
        joiningCallIdRef.current
      )
        return;
      joiningCallIdRef.current = callId;
      setWorking(true);
      void joinAcceptedLiveCall(callId)
        .then((credentials) => {
          if (invitationRef.current?.localId !== pending.localId) return;
          return activateCall(pending, credentials, true);
        })
        .catch((error) => {
          if (invitationRef.current?.localId !== pending.localId) return;
          clearInvitation();
          setErrorMessage(
            liveCallErrorMessage(
              error,
              t,
              `${pending.callType === "voice" ? "语音" : "视频"}连接失败`,
            ),
          );
        });
    },
    [activateCall, clearInvitation, t],
  );

  const startReconciliation = useCallback(
    (pending: PendingInvitation, callId: string) => {
      if (!supportsReconciliationRef.current) return;
      if (reconciliationRef.current) clearTimeout(reconciliationRef.current);
      reconciliationCountRef.current = 0;
      const poll = () => {
        const current = invitationRef.current;
        if (
          !current ||
          current.localId !== pending.localId ||
          current.ownerId !== activeOwnerRef.current ||
          joiningCallIdRef.current ||
          reconciliationCountRef.current >= 15
        ) {
          reconciliationRef.current = null;
          return;
        }
        reconciliationCountRef.current += 1;
        let continuePolling = true;
        void getLiveCallState(callId)
          .then((state) => {
            const latest = invitationRef.current;
            if (
              !latest ||
              latest.localId !== pending.localId ||
              latest.ownerId !== activeOwnerRef.current ||
              state.callId !== callId
            ) {
              continuePolling = false;
              return;
            }
            const next = {
              ...latest,
              callType: state.callType,
              billingPolicy: state.billingPolicy ?? latest.billingPolicy,
              liveExperience: state.liveExperience ?? latest.liveExperience,
            };
            publishInvitation(next);
            if (state.phase === "accepted") {
              continuePolling = false;
              joinAccepted(next, callId);
            } else if (state.phase === "terminal") {
              continuePolling = false;
              clearInvitation();
            }
          })
          .catch((error: unknown) => {
            if (
              error instanceof APIError &&
              ([404, 405].includes(error.status) ||
                error.code === "decoding_error" ||
                error.message === "api.decodingError")
            ) {
              supportsReconciliationRef.current = false;
              continuePolling = false;
            } else if (error instanceof APIError && error.status === 401) {
              continuePolling = false;
            }
          })
          .finally(() => {
            const latest = invitationRef.current;
            if (
              !continuePolling ||
              !latest ||
              latest.localId !== pending.localId ||
              latest.ownerId !== activeOwnerRef.current ||
              joiningCallIdRef.current ||
              reconciliationCountRef.current >= 15
            ) {
              reconciliationRef.current = null;
              return;
            }
            reconciliationRef.current = setTimeout(poll, 1_000);
          });
      };
      poll();
    },
    [clearInvitation, joinAccepted, publishInvitation],
  );

  const reconcileDeferred = useCallback(
    (pending: PendingInvitation, callId: string) => {
      if (deferredClosedRef.current.has(callId)) {
        clearInvitation();
        return;
      }
      const accepted = deferredAcceptedRef.current.has(callId);
      deferredAcceptedRef.current.clear();
      deferredClosedRef.current.clear();
      if (accepted) joinAccepted(pending, callId);
      else startReconciliation(pending, callId);
    },
    [clearInvitation, joinAccepted, startReconciliation],
  );

  const requestCall = useCallback(
    async (input: {
      participant: LiveLobbyParticipant;
      callType: CallType;
      billingPolicy: LiveBillingPolicy;
      isCurrentUserLive: boolean;
      paymentMethod?: PaymentMethod | undefined;
    }): Promise<boolean> => {
      if (!ownerId || input.isCurrentUserLive) {
        setErrorMessage(input.isCurrentUserLive ? "正在直播，无法与其他主播连线" : "请先登录");
        return false;
      }
      if (session || invitationRef.current || outgoingRequestTokenRef.current || isWorking) {
        setErrorMessage("当前已有通话或连线邀请");
        return false;
      }
      const requestToken = randomUUID();
      outgoingRequestTokenRef.current = requestToken;
      const requestIsActive = () =>
        activeOwnerRef.current === ownerId && outgoingRequestTokenRef.current === requestToken;
      setWorking(true);
      const paymentMethod = input.paymentMethod ?? { type: "spendable_balance" as const };
      try {
        if (paymentMethod.type === "spendable_balance") {
          const balance = await refreshWalletBalance(ownerId);
          if (!requestIsActive()) return false;
          if (balance.spendable_balance < input.billingPolicy.minimumStartingBalance) {
            setErrorMessage(
              input.callType === "voice"
                ? "猫粮不足，暂时无法语音连线"
                : "猫粮不足，暂时无法视频连线",
            );
            return false;
          }
        }
        if (!requestIsActive()) return false;
        const participant = input.participant;
        const selectedExperienceKind =
          paymentMethod.type === "prop_card"
            ? liveExperienceKindFromDefinition(paymentMethod.definitionId)
            : undefined;
        const scope = `${ownerId}|${participant.id}|${input.callType}|${paymentMethod.type === "prop_card" ? paymentMethod.definitionId : "spendable_balance"}`;
        const idempotencyKey = idempotencyKeysRef.current.get(scope) ?? randomUUID();
        idempotencyKeysRef.current.set(scope, idempotencyKey);
        const pending: PendingInvitation = {
          localId: randomUUID(),
          ownerId,
          slotId: participant.id,
          peer: {
            userId: participant.userId,
            username: participant.displayName,
            avatarUrl: participant.avatarUrl,
            roleSetting: participant.roleSetting,
          },
          callType: input.callType,
          billingPolicy: input.billingPolicy,
          paymentMethod,
          ...(paymentMethod.type === "prop_card" && selectedExperienceKind
            ? {
                liveExperience: {
                  definition_id: paymentMethod.definitionId,
                  duration_seconds: liveExperienceDuration(selectedExperienceKind),
                  status: "reserved",
                },
              }
            : {}),
          direction: "outgoing",
        };
        publishInvitation(pending);
        const response = await requestLiveCall({
          slotId: participant.id,
          callType: input.callType,
          paymentMethod,
          idempotencyKey,
        });
        if (!requestIsActive()) return false;
        idempotencyKeysRef.current.delete(scope);
        if ((invitationRef.current as PendingInvitation | null)?.localId !== pending.localId) {
          if (response.callId) await cancelLiveCall(response.callId).catch(() => undefined);
          if (paymentMethod.type === "prop_card") await loadPropInventory(true);
          return false;
        }
        const next: PendingInvitation = {
          ...pending,
          callId: response.callId,
          callType: response.callType,
          billingPolicy: response.billingPolicy ?? input.billingPolicy,
          liveExperience: response.liveExperience ?? pending.liveExperience,
        };
        publishInvitation(next);
        if (paymentMethod.type === "prop_card") {
          const kind = liveExperienceKindFromDefinition(paymentMethod.definitionId);
          if (kind) {
            const reservation = liveExperienceReservation(response.liveExperience);
            if (reservation) applyLiveExperienceReservation(reservation, kind);
            else void loadPropInventory(true);
          }
        }
        setWorking(false);
        startCountdown(next.localId);
        reconcileDeferred(next, response.callId);
        return true;
      } catch (error) {
        if (!requestIsActive()) return false;
        const pending = invitationRef.current as PendingInvitation | null;
        if (pending?.ownerId === ownerId && pending.direction === "outgoing") {
          clearInvitation();
          setErrorMessage(
            liveCallErrorMessage(
              error,
              t,
              `暂时无法发起${input.callType === "voice" ? "语音" : "视频"}邀请`,
            ),
          );
        } else if (!pending) {
          setErrorMessage(errorText(error, "暂时无法获取猫粮余额"));
        }
        return false;
      } finally {
        if (outgoingRequestTokenRef.current === requestToken) {
          outgoingRequestTokenRef.current = undefined;
          if (!invitationRef.current) setWorking(false);
        }
      }
    },
    [
      applyLiveExperienceReservation,
      clearInvitation,
      isWorking,
      loadPropInventory,
      publishInvitation,
      reconcileDeferred,
      session,
      startCountdown,
      t,
      ownerId,
    ],
  );

  const acceptIncoming = useCallback(async () => {
    const pending = invitationRef.current;
    if (
      !pending ||
      pending.ownerId !== activeOwnerRef.current ||
      pending.direction !== "incoming" ||
      !pending.callId ||
      isWorking
    )
      return;
    setWorking(true);
    try {
      const credentials = await acceptLiveCall(pending.callId);
      if (invitationRef.current?.localId === pending.localId)
        await activateCall(pending, credentials, false);
    } catch (error) {
      if (invitationRef.current?.localId === pending.localId) {
        setWorking(false);
        setErrorMessage(
          liveCallErrorMessage(
            error,
            t,
            `暂时无法接受${pending.callType === "voice" ? "语音" : "视频"}邀请`,
          ),
        );
      }
    }
  }, [activateCall, isWorking, t]);
  const rejectIncoming = useCallback(() => {
    const pending = invitationRef.current;
    if (!pending || pending.ownerId !== activeOwnerRef.current || pending.direction !== "incoming")
      return;
    clearInvitation(false);
    if (pending.callId) void rejectLiveCall(pending.callId, "rejected").catch(() => undefined);
  }, [clearInvitation]);
  const cancelOutgoing = useCallback(() => {
    const pending = invitationRef.current;
    if (!pending || pending.ownerId !== activeOwnerRef.current || pending.direction !== "outgoing")
      return;
    clearInvitation(false);
    if (pending.callId)
      void cancelLiveCall(pending.callId)
        .catch(() => undefined)
        .finally(() => {
          if (pending.paymentMethod.type === "prop_card") void loadPropInventory(true);
        });
  }, [clearInvitation, loadPropInventory]);

  useEffect(
    () =>
      chatRealtimeService.subscribe((event) => {
        if (event.type !== "live_signal") return;
        const eventOwnerId = activeOwnerRef.current;
        if (!eventOwnerId) return;
        const type = event.signal_type;
        const data = normalizeLiveInvitationPayload(event.data);
        if (
          [
            "one_to_one_live.call_invite",
            "one_to_one_live.call.invite",
            "one_to_one_live_call_invite",
            "live_call_invite",
            "call_invite",
          ].includes(type)
        ) {
          const callId = field(data, "call_id", "callId", "live_call_id");
          const callerId = field(
            data,
            "caller_id",
            "caller_user_id",
            "from_user_id",
            "user_id",
            "callerId",
          );
          if (!callId || !callerId) return;
          const recipientId = field(
            data,
            "host_id",
            "host_user_id",
            "callee_id",
            "callee_user_id",
            "recipient_id",
            "target_user_id",
          );
          if (recipientId && recipientId !== eventOwnerId) return;
          if (invitationRef.current || session) {
            void rejectLiveCall(callId, "busy").catch(() => undefined);
            return;
          }
          const experience = isObject(data.live_experience) ? data.live_experience : undefined;
          const cardKind = liveExperienceCardKind(experience);
          const pending: PendingInvitation = {
            localId: randomUUID(),
            ownerId: eventOwnerId,
            callId,
            slotId: field(data, "slot_id", "live_slot_id", "slotId") ?? "",
            peer: {
              userId: callerId,
              username:
                field(
                  data,
                  "caller_username",
                  "caller_name",
                  "username",
                  "nickname",
                  "display_name",
                ) ?? callerId,
              avatarUrl:
                field(data, "caller_avatar_url", "caller_avatar", "avatar_url", "avatar") ?? "",
              roleSetting:
                field(data, "character_setting", "role_setting", "host_character_setting") ?? "",
            },
            requestedRoleSetting: requestedRole(data),
            callType: callTypeField(data) ?? "video",
            billingPolicy: isObject(data.billing_policy)
              ? normalizeLiveBillingPolicy(data.billing_policy)
              : fallbackLiveBillingPolicy,
            paymentMethod: cardKind
              ? { type: "prop_card", definitionId: liveExperienceDefinition(cardKind) }
              : { type: "spendable_balance" },
            liveExperience: experience,
            direction: "incoming",
          };
          publishInvitation(pending);
          startCountdown(pending.localId);
          return;
        }
        const pending = invitationRef.current;
        if (!pending || pending.ownerId !== eventOwnerId) return;
        if (type === "one_to_one_live.call_accepted") {
          const correlation = correlateLiveCallEvent(data, {
            isOutgoing: pending.direction === "outgoing",
            callId: pending.callId,
            slotId: pending.slotId,
            peerUserId: pending.peer.userId,
          });
          if (correlation.kind === "defer") deferredAcceptedRef.current.add(correlation.callId);
          else if (correlation.kind === "handle") joinAccepted(pending, correlation.callId);
        } else if (
          [
            "one_to_one_live.call_rejected",
            "one_to_one_live.call_cancelled",
            "one_to_one_live.call_expired",
          ].includes(type)
        ) {
          const callId = field(data, "call_id", "callId");
          if (pending.direction === "incoming") {
            if (pending.callId && pending.callId === callId) clearInvitation();
            return;
          }
          const correlation = correlateLiveCallEvent(data, {
            isOutgoing: true,
            callId: pending.callId,
            slotId: pending.slotId,
            peerUserId: pending.peer.userId,
          });
          if (correlation.kind === "defer") deferredClosedRef.current.add(correlation.callId);
          else if (correlation.kind === "handle") clearInvitation();
        }
      }),
    [clearInvitation, joinAccepted, publishInvitation, session, startCountdown],
  );

  useLayoutEffect(() => {
    if (activeOwnerRef.current === ownerId) return;
    activeOwnerRef.current = ownerId;
    outgoingRequestTokenRef.current = undefined;
    idempotencyKeysRef.current.clear();
    supportsReconciliationRef.current = true;
    clearInvitation(false);
    setErrorMessage(undefined);
    setStateOwnerId(ownerId);
  }, [clearInvitation, ownerId]);
  useEffect(() => () => clearTimers(), [clearTimers]);

  const hasInvitation =
    invitation !== null &&
    invitation.ownerId === ownerId &&
    (invitation.direction === "incoming" || Boolean(invitation.callId));
  const ownerStateIsVisible = stateOwnerId === ownerId;
  const visibleErrorMessage = ownerStateIsVisible ? errorMessage : undefined;
  const visibleWorking = ownerStateIsVisible ? isWorking : false;
  const value = useMemo<LiveCallContextValue>(
    () => ({
      hasInvitation,
      isIncoming: hasInvitation && invitation?.direction === "incoming",
      isWorking: visibleWorking,
      remainingSeconds,
      errorMessage: visibleErrorMessage,
      requestCall,
      acceptIncoming,
      rejectIncoming,
      cancelOutgoing,
      clearError: () => setErrorMessage(undefined),
    }),
    [
      acceptIncoming,
      cancelOutgoing,
      hasInvitation,
      invitation,
      rejectIncoming,
      remainingSeconds,
      requestCall,
      visibleErrorMessage,
      visibleWorking,
    ],
  );

  return (
    <LiveCallContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {invitation && hasInvitation ? (
          <LiveInvitationBanner
            invitation={invitation}
            isWorking={isWorking}
            remainingSeconds={remainingSeconds}
            onAccept={() => void acceptIncoming()}
            onCancel={cancelOutgoing}
            onReject={rejectIncoming}
          />
        ) : null}
        {visibleErrorMessage ? (
          <ErrorToast message={visibleErrorMessage} onDismiss={() => setErrorMessage(undefined)} />
        ) : null}
      </View>
    </LiveCallContext.Provider>
  );
}

export function useLiveCall(): LiveCallContextValue {
  const value = useContext(LiveCallContext);
  if (!value) throw new Error("useLiveCall must be used inside LiveCallProvider");
  return value;
}

function LiveInvitationBanner({
  invitation,
  remainingSeconds,
  isWorking,
  onAccept,
  onReject,
  onCancel,
}: {
  invitation: PendingInvitation;
  remainingSeconds: number;
  isWorking: boolean;
  onAccept(): void;
  onReject(): void;
  onCancel(): void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useLocalization();
  const incoming = invitation.direction === "incoming";
  const experienceKind = liveExperienceCardKind(invitation.liveExperience);
  return (
    <BlurView
      intensity={78}
      style={[styles.banner, { top: insets.top + 4 }]}
      tint="systemMaterialLight"
    >
      <Avatar name={invitation.peer.username} size={42} uri={invitation.peer.avatarUrl} />
      <View style={styles.bannerCopy}>
        <Text numberOfLines={1} style={styles.bannerTitle}>
          {incoming ? invitation.peer.username : `等待 ${invitation.peer.username} 接受`}
        </Text>
        <Text numberOfLines={1} style={styles.bannerSubtitle}>
          {incoming
            ? `邀请你进行一对一${invitation.callType === "voice" ? "语音" : "视频"}`
            : `${invitation.callType === "voice" ? "语音" : "视频"}邀请已发送`}
        </Text>
        {experienceKind ? (
          <Text
            numberOfLines={2}
            style={[styles.bannerExperience, incoming && styles.bannerExperienceIncoming]}
          >
            {t(
              incoming ? "live.experience.invitation.host" : "live.experience.invitation.viewer",
              liveExperienceDuration(experienceKind) / 60,
            )}
          </Text>
        ) : null}
        {incoming && invitation.requestedRoleSetting ? (
          <Text numberOfLines={3} style={styles.bannerRole}>
            希望你扮演：{invitation.requestedRoleSetting}
          </Text>
        ) : null}
      </View>
      <Text style={styles.countdown}>{remainingSeconds}s</Text>
      {incoming ? (
        <>
          <Pressable disabled={isWorking} onPress={onReject} style={styles.reject}>
            <SymbolView name="xmark" size={13} weight="bold" tintColor={colors.secondaryText} />
          </Pressable>
          <Pressable disabled={isWorking} onPress={onAccept} style={styles.accept}>
            {isWorking ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <SymbolView
                name={invitation.callType === "voice" ? "phone.fill" : "video.fill"}
                size={13}
                tintColor="#FFFFFF"
              />
            )}
          </Pressable>
        </>
      ) : (
        <Pressable onPress={onCancel} style={styles.cancel}>
          <Text style={styles.cancelText}>取消</Text>
        </Pressable>
      )}
    </BlurView>
  );
}

function ErrorToast({ message, onDismiss }: { message: string; onDismiss(): void }) {
  const insets = useSafeAreaInsets();
  return (
    <TopToast duration={4_000} message={message} onDismiss={onDismiss} topInset={insets.top} />
  );
}

function requestedRole(data: Record<string, unknown>): string | undefined {
  const explicit = field(data, "requested_role_setting", "requested_character_setting");
  if (explicit) return explicit;
  const source = (field(data, "invitation_source", "source") ?? "")
    .toLocaleLowerCase()
    .replaceAll("-", "_");
  return ["agent_match", "agent"].includes(source) || field(data, "match_id")
    ? field(data, "role_setting", "character_setting")
    : undefined;
}
function callTypeField(data: Record<string, unknown>): CallType | undefined {
  const value = (field(data, "call_type", "media_type") ?? "")
    .toLocaleLowerCase()
    .replaceAll("-", "_");
  if (["voice", "audio"].includes(value)) return "voice";
  if (["video", "audio_video", "audiovideo"].includes(value)) return "video";
  return undefined;
}
function field(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim())
      return String(value).trim();
  }
  return undefined;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  banner: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 200,
    minHeight: 58,
    overflow: "hidden",
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.70)",
    flexDirection: "row",
    alignItems: "center",
    columnGap: 11,
    shadowColor: "#000000",
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
  },
  bannerCopy: { flex: 1, minWidth: 0, rowGap: 3 },
  bannerTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  bannerSubtitle: { color: colors.secondaryText, fontSize: 12 },
  bannerExperience: { color: colors.accent, fontSize: 11, fontWeight: "600" },
  bannerExperienceIncoming: { color: "#F4A621" },
  bannerRole: { color: colors.accent, fontSize: 12, fontWeight: "500" },
  countdown: {
    minWidth: 26,
    color: colors.secondaryText,
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  reject: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  accept: {
    width: 38,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#34C759",
  },
  cancel: { minWidth: 38, minHeight: 34, alignItems: "center", justifyContent: "center" },
  cancelText: { color: colors.secondaryText, fontSize: 13, fontWeight: "500" },
});
