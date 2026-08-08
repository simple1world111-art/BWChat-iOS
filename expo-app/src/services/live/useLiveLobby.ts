import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { APIError } from "@/api/client";
import type { CallType } from "@/models";
import {
  createLiveSlot,
  deleteLiveSlot,
  getCurrentLiveSlot,
  getLiveLobbySlots,
  uploadLiveAvatar,
} from "@/services/live/LiveLobbyRepository";
import { liveLobbyHeartbeatService } from "@/services/live/LiveLobbyHeartbeatService";
import {
  acquireLiveLobbyUpdate,
  fallbackLiveBillingPolicy,
  isVisibleLiveSlot,
  LiveLobbyEventCursor,
  liveAvailability,
  liveParticipant,
  mergeLiveSlotSnapshot,
  normalizeLiveLobbySlotEvent,
  reconcileCurrentLiveSlot,
  releaseLiveLobbyUpdate,
  sortLiveSlots,
  type LiveBillingPolicy,
  type LiveLobbyParticipant,
  type OneToOneLiveSlot,
} from "@/services/live/LiveLobbyModels";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";

export type LiveLobbyTab = "recommended" | "chatted";

export interface LiveLobbyController {
  participants: LiveLobbyParticipant[];
  hasLoaded: boolean;
  isUpdating: boolean;
  billingPolicy: LiveBillingPolicy;
  supportedCallTypes: CallType[];
  liveAvatarUploadSupported: boolean;
  currentSlot: OneToOneLiveSlot | null;
  errorMessage?: string | undefined;
  clearError(): void;
  refresh(tab: LiveLobbyTab): Promise<void>;
  startLive(input: {
    roleSetting: string;
    avatarUri?: string | undefined;
    allowedCallTypes: CallType[];
    avatarUploadIdempotencyKey: string;
    slotCreationIdempotencyKey: string;
  }): Promise<LiveLobbyParticipant | undefined>;
  stopLive(): Promise<boolean>;
}

export function useLiveLobby(
  ownerId: string | undefined,
  activeTab: LiveLobbyTab,
): LiveLobbyController {
  const scope = ownerId?.trim() || "anonymous";
  const scopeRef = useRef(scope);
  const activeTabRef = useRef(activeTab);
  const slotsRef = useRef<OneToOneLiveSlot[]>([]);
  const currentSlotRef = useRef<OneToOneLiveSlot | null>(null);
  const mutationSequenceRef = useRef(0);
  const ownMutationSequenceRef = useRef(0);
  const slotMutationsRef = useRef(new Map<string, number>());
  const refreshGenerationRef = useRef(0);
  const currentEndpointSupportedRef = useRef(true);
  const eventCursorRef = useRef(new LiveLobbyEventCursor());
  const updatingRef = useRef(false);
  const [slots, setSlots] = useState<OneToOneLiveSlot[]>([]);
  const [participantTab, setParticipantTab] = useState<LiveLobbyTab>(activeTab);
  const [currentSlot, setCurrentSlotState] = useState<OneToOneLiveSlot | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isUpdating, setUpdating] = useState(false);
  const [billingPolicy, setBillingPolicy] = useState(fallbackLiveBillingPolicy);
  const [supportedCallTypes, setSupportedCallTypes] = useState<CallType[]>(["video"]);
  const [liveAvatarUploadSupported, setLiveAvatarUploadSupported] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const clearError = useCallback(() => setErrorMessage(undefined), []);

  const publishSlots = useCallback((value: OneToOneLiveSlot[]) => {
    const next = sortLiveSlots(value.filter(isVisibleLiveSlot));
    slotsRef.current = next;
    setSlots(next);
  }, []);
  const publishCurrent = useCallback((value: OneToOneLiveSlot | null, recordsMutation: boolean) => {
    currentSlotRef.current = value;
    setCurrentSlotState(value);
    if (value && isVisibleLiveSlot(value)) {
      liveLobbyHeartbeatService.start(scopeRef.current, value.id);
    } else {
      liveLobbyHeartbeatService.stop(scopeRef.current);
    }
    if (recordsMutation) {
      mutationSequenceRef.current += 1;
      ownMutationSequenceRef.current = mutationSequenceRef.current;
      if (value?.id) slotMutationsRef.current.set(value.id, mutationSequenceRef.current);
    }
  }, []);
  const recordMutation = useCallback((slotId?: string) => {
    mutationSequenceRef.current += 1;
    if (slotId) slotMutationsRef.current.set(slotId, mutationSequenceRef.current);
  }, []);
  const upsert = useCallback(
    (slot: OneToOneLiveSlot, recordsMutation = true) => {
      if (!isVisibleLiveSlot(slot)) return;
      const existing = slotsRef.current.findIndex(
        (item) => item.id === slot.id || item.user.userId === slot.user.userId,
      );
      const next = slotsRef.current.filter(
        (item) => item.id !== slot.id && item.user.userId !== slot.user.userId,
      );
      next.splice(existing >= 0 ? Math.min(existing, next.length) : 0, 0, slot);
      publishSlots(next);
      if (recordsMutation) recordMutation(slot.id);
    },
    [publishSlots, recordMutation],
  );
  const remove = useCallback(
    (slotId?: string, userId?: string, recordsMutation = true) => {
      publishSlots(
        slotsRef.current.filter(
          (slot) => !(slotId && slot.id === slotId) && !(userId && slot.user.userId === userId),
        ),
      );
      if (recordsMutation) recordMutation(slotId);
    },
    [publishSlots, recordMutation],
  );

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const refresh = useCallback(
    async (tab: LiveLobbyTab) => {
      const owner = scopeRef.current;
      if (owner === "anonymous") return;
      const generation = ++refreshGenerationRef.current;
      const mutationAtStart = mutationSequenceRef.current;
      const ownMutationAtStart = ownMutationSequenceRef.current;
      const [pageResult, currentResult] = await Promise.allSettled([
        getLiveLobbySlots(tab),
        currentEndpointSupportedRef.current ? getCurrentLiveSlot() : Promise.resolve(undefined),
      ]);
      if (scopeRef.current !== owner || generation !== refreshGenerationRef.current) return;
      if (pageResult.status === "fulfilled") {
        setBillingPolicy(pageResult.value.billingPolicy);
        setSupportedCallTypes(pageResult.value.supportedCallTypes);
        setLiveAvatarUploadSupported(pageResult.value.liveAvatarUploadSupported);
        publishSlots(
          mergeLiveSlotSnapshot(
            pageResult.value.items,
            slotsRef.current,
            slotMutationsRef.current,
            mutationAtStart,
          ),
        );
        setErrorMessage(undefined);
      } else {
        setErrorMessage(errorMessageFor(pageResult.reason, "直播列表加载失败，请稍后重试"));
      }
      setHasLoaded(true);
      if (ownMutationSequenceRef.current === ownMutationAtStart) {
        const currentResolution =
          currentResult.status === "fulfilled"
            ? currentResult.value === undefined
              ? { kind: "unsupported" as const }
              : { kind: "value" as const, slot: currentResult.value }
            : currentResult.reason instanceof APIError &&
                [404, 405].includes(currentResult.reason.status)
              ? { kind: "unsupported" as const }
              : { kind: "failure" as const };
        if (currentResolution.kind === "unsupported") {
          currentEndpointSupportedRef.current = false;
        }
        publishCurrent(
          reconcileCurrentLiveSlot(
            currentResolution,
            currentSlotRef.current,
            slotsRef.current,
            owner,
          ),
          false,
        );
      }
      if (currentSlotRef.current && isVisibleLiveSlot(currentSlotRef.current))
        upsert(currentSlotRef.current, false);
      setParticipantTab(tab);
    },
    [publishCurrent, publishSlots, upsert],
  );

  useEffect(
    () => () => {
      const owner = scopeRef.current;
      refreshGenerationRef.current += 1;
      liveLobbyHeartbeatService.stop(owner);
      scopeRef.current = "anonymous";
      updatingRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (scopeRef.current === scope) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      liveLobbyHeartbeatService.stop(scopeRef.current);
      scopeRef.current = scope;
      refreshGenerationRef.current += 1;
      slotsRef.current = [];
      currentSlotRef.current = null;
      mutationSequenceRef.current = 0;
      ownMutationSequenceRef.current = 0;
      slotMutationsRef.current.clear();
      currentEndpointSupportedRef.current = true;
      eventCursorRef.current.reset();
      updatingRef.current = false;
      setSlots([]);
      setParticipantTab(activeTabRef.current);
      setCurrentSlotState(null);
      setHasLoaded(false);
      setUpdating(false);
      setBillingPolicy(fallbackLiveBillingPolicy);
      setSupportedCallTypes(["video"]);
      setLiveAvatarUploadSupported(false);
      setErrorMessage(undefined);
      if (scope !== "anonymous") void refresh(activeTabRef.current);
    });
    return () => {
      active = false;
    };
  }, [refresh, scope]);

  const recoverCurrent = useCallback(
    async (owner: string): Promise<OneToOneLiveSlot | null> => {
      if (currentSlotRef.current?.user.userId === owner) return currentSlotRef.current;
      const [currentResult, pageResult] = await Promise.allSettled([
        getCurrentLiveSlot(),
        getLiveLobbySlots("recommended"),
      ]);
      if (scopeRef.current !== owner) return null;
      const slot =
        currentResult.status === "fulfilled" &&
        currentResult.value &&
        isVisibleLiveSlot(currentResult.value)
          ? currentResult.value
          : pageResult.status === "fulfilled"
            ? (pageResult.value.items.find(
                (item) => item.user.userId === owner && isVisibleLiveSlot(item),
              ) ?? null)
            : null;
      if (slot) {
        publishCurrent(slot, false);
        upsert(slot, false);
        setParticipantTab(activeTabRef.current);
      }
      return slot;
    },
    [publishCurrent, upsert],
  );

  const startLive = useCallback(
    async (input: {
      roleSetting: string;
      avatarUri?: string | undefined;
      allowedCallTypes: CallType[];
      avatarUploadIdempotencyKey: string;
      slotCreationIdempotencyKey: string;
    }): Promise<LiveLobbyParticipant | undefined> => {
      const owner = scopeRef.current;
      const role = input.roleSetting.trim();
      if (
        owner === "anonymous" ||
        !role ||
        input.allowedCallTypes.length === 0 ||
        !acquireLiveLobbyUpdate(updatingRef)
      )
        return undefined;
      setUpdating(true);
      try {
        const upload = input.avatarUri
          ? await uploadLiveAvatar(input.avatarUri, input.avatarUploadIdempotencyKey)
          : undefined;
        const slot = await createLiveSlot({
          characterSetting: role,
          liveAvatarAssetId: upload?.assetId,
          allowedCallTypes: input.allowedCallTypes,
          idempotencyKey: input.slotCreationIdempotencyKey,
        });
        if (scopeRef.current !== owner) return undefined;
        publishCurrent(slot, true);
        upsert(slot, true);
        setParticipantTab(activeTabRef.current);
        setErrorMessage(undefined);
        return liveParticipant(slot, owner, false);
      } catch (error) {
        if (scopeRef.current !== owner) return undefined;
        const recovered = await recoverCurrent(owner);
        if (recovered) {
          setErrorMessage(undefined);
          return liveParticipant(recovered, owner, false);
        }
        setErrorMessage(errorMessageFor(error, "挂上直播失败，请稍后重试"));
        return undefined;
      } finally {
        releaseLiveLobbyUpdate(updatingRef);
        if (scopeRef.current === owner) setUpdating(false);
      }
    },
    [publishCurrent, recoverCurrent, upsert],
  );

  const stopLive = useCallback(async (): Promise<boolean> => {
    const owner = scopeRef.current;
    const slot = currentSlotRef.current;
    if (owner === "anonymous" || !slot?.id || !acquireLiveLobbyUpdate(updatingRef)) return false;
    setUpdating(true);
    try {
      await deleteLiveSlot(slot.id, randomUUID());
      if (scopeRef.current !== owner) return false;
      publishCurrent(null, true);
      remove(slot.id, owner, true);
      setParticipantTab(activeTabRef.current);
      setErrorMessage(undefined);
      return true;
    } catch (error) {
      if (scopeRef.current === owner)
        setErrorMessage(errorMessageFor(error, "退出直播失败，请稍后重试"));
      return false;
    } finally {
      releaseLiveLobbyUpdate(updatingRef);
      if (scopeRef.current === owner) setUpdating(false);
    }
  }, [publishCurrent, remove]);

  useEffect(
    () =>
      chatRealtimeService.subscribeStatus((status) => {
        if (status === "connected" && scopeRef.current !== "anonymous")
          void refresh(activeTabRef.current);
      }),
    [refresh],
  );

  useEffect(
    () =>
      chatRealtimeService.subscribe((event) => {
        if (event.type !== "live_signal" || scopeRef.current === "anonymous") return;
        const kind = event.signal_type;
        if (
          ![
            "one_to_one_live.slot.created",
            "one_to_one_live.slot.updated",
            "one_to_one_live.slot.ended",
          ].includes(kind)
        )
          return;
        const payload = normalizeLiveLobbySlotEvent(event.data);
        if (!eventCursorRef.current.shouldApply(payload)) return;
        const ended =
          kind === "one_to_one_live.slot.ended" ||
          liveAvailability(payload.status ?? payload.slot?.status ?? "") === "ended";
        if (ended) {
          if (!payload.slotId && !payload.userId) {
            void refresh(activeTabRef.current);
            return;
          }
          remove(payload.slotId, payload.userId, true);
          if (
            payload.slotId === currentSlotRef.current?.id ||
            payload.userId === scopeRef.current
          ) {
            publishCurrent(null, true);
          }
          setParticipantTab(activeTabRef.current);
        } else if (payload.slot && isVisibleLiveSlot(payload.slot)) {
          upsert(payload.slot, true);
          if (payload.slot.user.userId === scopeRef.current) publishCurrent(payload.slot, true);
          setParticipantTab(activeTabRef.current);
        } else {
          void refresh(activeTabRef.current);
        }
      }),
    [publishCurrent, refresh, remove, upsert],
  );

  const participants = useMemo(
    () =>
      sortLiveSlots(slots).map((slot) =>
        liveParticipant(slot, scope, participantTab === "chatted"),
      ),
    [participantTab, scope, slots],
  );
  return {
    participants,
    hasLoaded,
    isUpdating,
    billingPolicy,
    supportedCallTypes,
    liveAvatarUploadSupported,
    currentSlot,
    errorMessage,
    clearError,
    refresh,
    startLive,
    stopLive,
  };
}

function errorMessageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
