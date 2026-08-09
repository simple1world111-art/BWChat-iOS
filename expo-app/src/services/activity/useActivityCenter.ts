import { useCallback, useEffect, useRef, useState } from "react";

import {
  canClaimActivity,
  hasValidWheelProbability,
  nextClaimableActivityDay,
  optimisticallyClaimActivityCheckIn,
  optimisticallyClaimActivityMeal,
  type ActivityCenterSnapshot,
  type ActivityInviteShareSession,
  type ActivityMatchedUser,
  type ActivityMealReward,
  type ActivityPhoneVerificationSession,
  type ActivityWheelSpinEnvelope,
} from "@/services/activity/ActivityModels";
import {
  activityContactPhoneHashes,
  activityIdempotencyKey,
  claimActivityCheckIn,
  claimActivityMeal,
  clearActivityIdempotencyKey,
  completeActivityInviteShareSession,
  createActivityContactDiscoverySession,
  createActivityInviteShareSession,
  createActivityPhoneVerificationSession,
  getActivityCenter,
  isAmbiguousActivityError,
  loadCachedActivitySnapshot,
  matchActivityContacts,
  normalizeActivityPhone,
  redeemActivityInvite,
  saveCachedActivitySnapshot,
  sendActivityFriendRequest,
  spinActivityWheel,
  verifyActivityPhone,
} from "@/services/activity/ActivityCenterRepository";
import { runAfterNavigationInteractions } from "@/services/navigation/NavigationWorkScheduler";

export interface ActivityRewardCelebration {
  id: string;
  amount: number;
}

export interface ActivityCenterState {
  snapshot: ActivityCenterSnapshot | undefined;
  isLoading: boolean;
  isShowingCachedData: boolean;
  matchedUsers: ActivityMatchedUser[];
  phoneVerificationSession: ActivityPhoneVerificationSession | undefined;
  rewardCelebration: ActivityRewardCelebration | undefined;
  errorMessage: string | undefined;
  isRunning(operation: string): boolean;
  serverNow(): Date;
  load(force?: boolean): Promise<void>;
  claimCheckIn(): Promise<void>;
  claimMeal(meal: ActivityMealReward): Promise<void>;
  spinWheel(): Promise<ActivityWheelSpinEnvelope | undefined>;
  finishSpinAnimation(): void;
  discoverContacts(): Promise<boolean>;
  createShareSession(): Promise<ActivityInviteShareSession | undefined>;
  completeShare(sessionID: string): Promise<void>;
  redeemInvite(input: string): Promise<boolean>;
  requestPhoneCode(rawPhone: string, region?: string): Promise<boolean>;
  verifyPhone(code: string): Promise<boolean>;
  sendFriendRequest(user: ActivityMatchedUser): Promise<boolean>;
  dismissRewardCelebration(id: string): void;
  clearError(): void;
}

interface ActivityOperationAuthority {
  scope: string;
  generation: number;
  token: number;
}

export function useActivityCenter(ownerID: string | undefined): ActivityCenterState {
  const scopeID = ownerID?.trim() || "anonymous";
  const scopeRef = useRef(scopeID);
  const generationRef = useRef(0);
  const tokenSequenceRef = useRef(0);
  const snapshotRef = useRef<ActivityCenterSnapshot | undefined>(undefined);
  const cachedRef = useRef(false);
  const loadingAuthorityRef = useRef<ActivityOperationAuthority | undefined>(undefined);
  const operationsRef = useRef(new Map<string, ActivityOperationAuthority>());
  const deferredSpinSnapshotRef = useRef<ActivityCenterSnapshot | undefined>(undefined);
  const deferredSpinAuthorityRef = useRef<ActivityOperationAuthority | undefined>(undefined);
  const shareSessionAuthoritiesRef = useRef(new Map<string, ActivityOperationAuthority>());
  const phoneSessionAuthorityRef = useRef<ActivityOperationAuthority | undefined>(undefined);
  const serverTimeAnchorRef = useRef<Date | undefined>(undefined);
  const deviceTimeAnchorRef = useRef<Date | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<ActivityCenterSnapshot | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [isShowingCachedData, setIsShowingCachedData] = useState(false);
  const [matchedUsers, setMatchedUsers] = useState<ActivityMatchedUser[]>([]);
  const [phoneVerificationSession, setPhoneVerificationSession] = useState<
    ActivityPhoneVerificationSession | undefined
  >(undefined);
  const [rewardCelebration, setRewardCelebration] = useState<ActivityRewardCelebration | undefined>(
    undefined,
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [, setOperationRevision] = useState(0);

  const isCurrent = useCallback(
    (authority: Pick<ActivityOperationAuthority, "scope" | "generation">) =>
      authority.scope === scopeRef.current && authority.generation === generationRef.current,
    [],
  );

  const isCurrentOperation = useCallback(
    (operation: string, authority: ActivityOperationAuthority) =>
      isCurrent(authority) && operationsRef.current.get(operation)?.token === authority.token,
    [isCurrent],
  );

  const publishSnapshot = useCallback((next: ActivityCenterSnapshot | undefined) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const publishCached = useCallback((next: boolean) => {
    cachedRef.current = next;
    setIsShowingCachedData(next);
  }, []);

  const apply = useCallback(
    (latest: ActivityCenterSnapshot, cache: boolean, authority: ActivityOperationAuthority) => {
      if (!isCurrent(authority)) return;
      const current = snapshotRef.current;
      const reconciled =
        operationsRef.current.has("wheel") && current
          ? { ...latest, wheel: current.wheel }
          : latest;
      publishSnapshot(reconciled);
      const serverAnchor = new Date(reconciled.serverTime);
      serverTimeAnchorRef.current = Number.isNaN(serverAnchor.getTime()) ? undefined : serverAnchor;
      deviceTimeAnchorRef.current = new Date();
      if (cachedRef.current) publishCached(false);
      setErrorMessage(undefined);
      if (cache)
        void saveCachedActivitySnapshot(authority.scope, reconciled).catch(() => undefined);
    },
    [isCurrent, publishCached, publishSnapshot],
  );

  const resetForScope = useCallback(
    (nextScope: string) => {
      scopeRef.current = nextScope;
      loadingAuthorityRef.current = undefined;
      operationsRef.current.clear();
      deferredSpinSnapshotRef.current = undefined;
      deferredSpinAuthorityRef.current = undefined;
      shareSessionAuthoritiesRef.current.clear();
      phoneSessionAuthorityRef.current = undefined;
      serverTimeAnchorRef.current = undefined;
      deviceTimeAnchorRef.current = undefined;
      publishSnapshot(undefined);
      publishCached(false);
      setIsLoading(nextScope !== "anonymous");
      setMatchedUsers([]);
      setPhoneVerificationSession(undefined);
      setRewardCelebration(undefined);
      setErrorMessage(undefined);
      setOperationRevision((value) => value + 1);
    },
    [publishCached, publishSnapshot],
  );

  const loadForScope = useCallback(
    async (expectedScope: string, expectedGeneration: number, force = false) => {
      const authority: ActivityOperationAuthority = {
        scope: expectedScope,
        generation: expectedGeneration,
        token: ++tokenSequenceRef.current,
      };
      if (!isCurrent(authority)) return;
      if (expectedScope === "anonymous") {
        setErrorMessage("activityCenter.error.signIn");
        return;
      }
      if (loadingAuthorityRef.current || (!force && snapshotRef.current && !cachedRef.current))
        return;
      loadingAuthorityRef.current = authority;
      setIsLoading(true);
      try {
        if (!snapshotRef.current) {
          try {
            const cached = await loadCachedActivitySnapshot(expectedScope);
            if (!isCurrent(authority) || loadingAuthorityRef.current?.token !== authority.token)
              return;
            if (cached) {
              publishSnapshot(cached);
              publishCached(true);
              const serverAnchor = new Date(cached.serverTime);
              serverTimeAnchorRef.current = Number.isNaN(serverAnchor.getTime())
                ? undefined
                : serverAnchor;
              deviceTimeAnchorRef.current = new Date();
            }
          } catch {
            if (!isCurrent(authority) || loadingAuthorityRef.current?.token !== authority.token)
              return;
          }
        }
        const latest = await getActivityCenter();
        if (!isCurrent(authority) || loadingAuthorityRef.current?.token !== authority.token) return;
        apply(latest, true, authority);
      } catch (error) {
        if (isCurrent(authority) && loadingAuthorityRef.current?.token === authority.token)
          setErrorMessage(activityErrorMessage(error));
      } finally {
        if (isCurrent(authority) && loadingAuthorityRef.current?.token === authority.token) {
          loadingAuthorityRef.current = undefined;
          setIsLoading(false);
        }
      }
    },
    [apply, isCurrent, publishCached, publishSnapshot],
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const operations = operationsRef.current;
    const shareSessionAuthorities = shareSessionAuthoritiesRef.current;
    // This reset is the account-isolation boundary: stale private state must not survive one render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetForScope(scopeID);
    const cancelInitialLoad = runAfterNavigationInteractions(
      () => void loadForScope(scopeID, generation, true),
    );
    return () => {
      cancelInitialLoad();
      if (generationRef.current !== generation) return;
      generationRef.current += 1;
      loadingAuthorityRef.current = undefined;
      operations.clear();
      deferredSpinSnapshotRef.current = undefined;
      deferredSpinAuthorityRef.current = undefined;
      shareSessionAuthorities.clear();
      phoneSessionAuthorityRef.current = undefined;
    };
  }, [loadForScope, resetForScope, scopeID]);

  const begin = useCallback((operation: string): ActivityOperationAuthority | undefined => {
    if (operationsRef.current.has(operation)) return undefined;
    const authority: ActivityOperationAuthority = {
      scope: scopeRef.current,
      generation: generationRef.current,
      token: ++tokenSequenceRef.current,
    };
    operationsRef.current.set(operation, authority);
    setErrorMessage(undefined);
    setOperationRevision((value) => value + 1);
    return authority;
  }, []);

  const end = useCallback(
    (operation: string, authority: ActivityOperationAuthority) => {
      if (!isCurrentOperation(operation, authority)) return;
      operationsRef.current.delete(operation);
      setOperationRevision((value) => value + 1);
    },
    [isCurrentOperation],
  );

  const handleMutationError = useCallback(
    async (error: unknown, keyName: string, authority: ActivityOperationAuthority) => {
      if (!isCurrent(authority)) return;
      if (!isAmbiguousActivityError(error)) {
        await clearActivityIdempotencyKey(authority.scope, keyName);
        if (!isCurrent(authority)) return;
      }
      setErrorMessage(activityErrorMessage(error));
    },
    [isCurrent],
  );

  const presentReward = useCallback(
    (amount: number, authority: ActivityOperationAuthority) => {
      if (amount <= 0 || !isCurrent(authority)) return;
      setRewardCelebration({ id: `${Date.now()}-${Math.random()}`, amount });
    },
    [isCurrent],
  );

  const claimCheckIn = useCallback(async () => {
    const original = snapshotRef.current;
    if (!original) return;
    const optimistic = optimisticallyClaimActivityCheckIn(original);
    const amount = nextClaimableActivityDay(original.checkIn)?.rewardActivityCatFood;
    if (!optimistic || amount === undefined) return;
    const authority = begin("check-in");
    if (!authority) return;
    publishSnapshot(optimistic);
    presentReward(amount, authority);
    try {
      const key = await activityIdempotencyKey(authority.scope, "check-in");
      if (!isCurrentOperation("check-in", authority)) return;
      const result = await claimActivityCheckIn(key);
      if (!isCurrentOperation("check-in", authority)) return;
      await clearActivityIdempotencyKey(authority.scope, "check-in");
      if (!isCurrentOperation("check-in", authority)) return;
      apply(result.snapshot, true, authority);
    } catch (error) {
      if (!isCurrentOperation("check-in", authority)) return;
      if (!isAmbiguousActivityError(error)) publishSnapshot(original);
      await handleMutationError(error, "check-in", authority);
    } finally {
      end("check-in", authority);
    }
  }, [apply, begin, end, handleMutationError, isCurrentOperation, presentReward, publishSnapshot]);

  const claimMeal = useCallback(
    async (meal: ActivityMealReward) => {
      const operation = `meal:${meal.id}`;
      const keyName = `meal.${meal.id}`;
      const original = snapshotRef.current;
      if (!original || !canClaimActivity(meal.status)) return;
      const optimistic = optimisticallyClaimActivityMeal(original, meal.id);
      if (!optimistic) return;
      const authority = begin(operation);
      if (!authority) return;
      publishSnapshot(optimistic);
      presentReward(meal.rewardActivityCatFood, authority);
      try {
        const key = await activityIdempotencyKey(authority.scope, keyName);
        if (!isCurrentOperation(operation, authority)) return;
        const result = await claimActivityMeal(meal.id, key);
        if (!isCurrentOperation(operation, authority)) return;
        await clearActivityIdempotencyKey(authority.scope, keyName);
        if (!isCurrentOperation(operation, authority)) return;
        apply(result.snapshot, true, authority);
      } catch (error) {
        if (!isCurrentOperation(operation, authority)) return;
        if (!isAmbiguousActivityError(error)) publishSnapshot(original);
        await handleMutationError(error, keyName, authority);
      } finally {
        end(operation, authority);
      }
    },
    [apply, begin, end, handleMutationError, isCurrentOperation, presentReward, publishSnapshot],
  );

  const spinWheel = useCallback(async (): Promise<ActivityWheelSpinEnvelope | undefined> => {
    const current = snapshotRef.current;
    if (
      !current ||
      !current.wheel.enabled ||
      !hasValidWheelProbability(current.wheel.currentTier)
    ) {
      setErrorMessage("activityCenter.error.wheelConfig");
      return undefined;
    }
    const authority = begin("wheel");
    if (!authority) return undefined;
    try {
      const key = await activityIdempotencyKey(authority.scope, "wheel");
      if (!isCurrentOperation("wheel", authority)) return undefined;
      const envelope = await spinActivityWheel(
        current.configVersion,
        current.wheel.currentTier.id,
        key,
      );
      if (!isCurrentOperation("wheel", authority)) return undefined;
      await clearActivityIdempotencyKey(authority.scope, "wheel");
      if (!isCurrentOperation("wheel", authority)) return undefined;
      deferredSpinSnapshotRef.current = envelope.snapshot;
      deferredSpinAuthorityRef.current = authority;
      return envelope;
    } catch (error) {
      if (!isCurrentOperation("wheel", authority)) return undefined;
      await handleMutationError(error, "wheel", authority);
      end("wheel", authority);
      return undefined;
    }
  }, [begin, end, handleMutationError, isCurrentOperation]);

  const finishSpinAnimation = useCallback(() => {
    const authority = deferredSpinAuthorityRef.current;
    const deferred = deferredSpinSnapshotRef.current;
    deferredSpinSnapshotRef.current = undefined;
    deferredSpinAuthorityRef.current = undefined;
    if (!authority || !isCurrentOperation("wheel", authority)) return;
    end("wheel", authority);
    if (deferred) apply(deferred, true, authority);
  }, [apply, end, isCurrentOperation]);

  const discoverContacts = useCallback(async (): Promise<boolean> => {
    if (!snapshotRef.current?.phoneBinding.isVerified) {
      setErrorMessage("activityCenter.error.phoneRequired");
      return false;
    }
    const authority = begin("contacts");
    if (!authority) return false;
    let matchStarted = false;
    try {
      const session = await createActivityContactDiscoverySession();
      if (!isCurrentOperation("contacts", authority)) return false;
      const hashes = await activityContactPhoneHashes(session);
      if (!isCurrentOperation("contacts", authority)) return false;
      const key = await activityIdempotencyKey(authority.scope, "contacts");
      if (!isCurrentOperation("contacts", authority)) return false;
      matchStarted = true;
      const result = await matchActivityContacts(session.id, session.saltVersion, hashes, key);
      if (!isCurrentOperation("contacts", authority)) return false;
      await clearActivityIdempotencyKey(authority.scope, "contacts");
      if (!isCurrentOperation("contacts", authority)) return false;
      setMatchedUsers(result.matches);
      apply(result.snapshot, true, authority);
      presentReward(result.grantedActivityCatFood, authority);
      return true;
    } catch (error) {
      if (!isCurrentOperation("contacts", authority)) return false;
      if (error instanceof Error && error.message.startsWith("activityCenter.")) {
        setErrorMessage(error.message);
      } else if (matchStarted) {
        await handleMutationError(error, "contacts", authority);
      } else {
        setErrorMessage(activityErrorMessage(error));
      }
      return false;
    } finally {
      end("contacts", authority);
    }
  }, [apply, begin, end, handleMutationError, isCurrentOperation, presentReward]);

  const createShareSession = useCallback(async (): Promise<
    ActivityInviteShareSession | undefined
  > => {
    const authority = begin("share");
    if (!authority) return undefined;
    try {
      const session = await createActivityInviteShareSession();
      if (!isCurrentOperation("share", authority)) return undefined;
      shareSessionAuthoritiesRef.current.set(session.id, authority);
      return session;
    } catch (error) {
      if (isCurrentOperation("share", authority)) setErrorMessage(activityErrorMessage(error));
      return undefined;
    } finally {
      end("share", authority);
    }
  }, [begin, end, isCurrentOperation]);

  const completeShare = useCallback(
    async (sessionID: string) => {
      const keyName = `share.${sessionID}`;
      const sessionAuthority = shareSessionAuthoritiesRef.current.get(sessionID);
      if (!sessionAuthority || !isCurrent(sessionAuthority)) return;
      const authority = begin("share");
      if (!authority || authority.generation !== sessionAuthority.generation) return;
      try {
        const key = await activityIdempotencyKey(authority.scope, keyName);
        if (!isCurrentOperation("share", authority)) return;
        const result = await completeActivityInviteShareSession(sessionID, key);
        if (!isCurrentOperation("share", authority)) return;
        await clearActivityIdempotencyKey(authority.scope, keyName);
        if (!isCurrentOperation("share", authority)) return;
        shareSessionAuthoritiesRef.current.delete(sessionID);
        apply(result.snapshot, true, authority);
        presentReward(result.grantedActivityCatFood, authority);
      } catch (error) {
        if (!isCurrentOperation("share", authority)) return;
        await handleMutationError(error, keyName, authority);
      } finally {
        end("share", authority);
      }
    },
    [apply, begin, end, handleMutationError, isCurrent, isCurrentOperation, presentReward],
  );

  const redeemInvite = useCallback(
    async (input: string): Promise<boolean> => {
      const clean = input.trim();
      if (!clean) {
        setErrorMessage("activityCenter.error.invalidInvite");
        return false;
      }
      const authority = begin("redeem");
      if (!authority) return false;
      try {
        const key = await activityIdempotencyKey(authority.scope, "redeem");
        if (!isCurrentOperation("redeem", authority)) return false;
        const latest = await redeemActivityInvite(clean, key);
        if (!isCurrentOperation("redeem", authority)) return false;
        await clearActivityIdempotencyKey(authority.scope, "redeem");
        if (!isCurrentOperation("redeem", authority)) return false;
        apply(latest, true, authority);
        return true;
      } catch (error) {
        if (!isCurrentOperation("redeem", authority)) return false;
        await handleMutationError(error, "redeem", authority);
        return false;
      } finally {
        end("redeem", authority);
      }
    },
    [apply, begin, end, handleMutationError, isCurrentOperation],
  );

  const requestPhoneCode = useCallback(
    async (rawPhone: string, region?: string): Promise<boolean> => {
      const authority = begin("send-code");
      if (!authority) return false;
      try {
        const e164 = normalizeActivityPhone(rawPhone, region);
        const session = await createActivityPhoneVerificationSession(e164);
        if (!isCurrentOperation("send-code", authority)) return false;
        phoneSessionAuthorityRef.current = authority;
        setPhoneVerificationSession(session);
        return true;
      } catch (error) {
        if (isCurrentOperation("send-code", authority))
          setErrorMessage(activityErrorMessage(error));
        return false;
      } finally {
        end("send-code", authority);
      }
    },
    [begin, end, isCurrentOperation],
  );

  const verifyPhone = useCallback(
    async (code: string): Promise<boolean> => {
      const clean = code.trim();
      const session = phoneVerificationSession;
      if (!clean || !session) {
        setErrorMessage("activityCenter.error.invalidCode");
        return false;
      }
      const operation = "verify-phone";
      const keyName = `verify-phone.${session.id}`;
      const sessionAuthority = phoneSessionAuthorityRef.current;
      if (!sessionAuthority || !isCurrent(sessionAuthority)) return false;
      const authority = begin(operation);
      if (!authority || authority.generation !== sessionAuthority.generation) return false;
      try {
        const key = await activityIdempotencyKey(authority.scope, keyName);
        if (!isCurrentOperation(operation, authority)) return false;
        const latest = await verifyActivityPhone(session.id, clean, key);
        if (!isCurrentOperation(operation, authority)) return false;
        await clearActivityIdempotencyKey(authority.scope, keyName);
        if (!isCurrentOperation(operation, authority)) return false;
        phoneSessionAuthorityRef.current = undefined;
        setPhoneVerificationSession(undefined);
        apply(latest, true, authority);
        return true;
      } catch (error) {
        if (!isCurrentOperation(operation, authority)) return false;
        await handleMutationError(error, keyName, authority);
        return false;
      } finally {
        end(operation, authority);
      }
    },
    [
      apply,
      begin,
      end,
      handleMutationError,
      isCurrent,
      isCurrentOperation,
      phoneVerificationSession,
    ],
  );

  const sendFriendRequest = useCallback(
    async (user: ActivityMatchedUser): Promise<boolean> => {
      const operation = `friend:${user.userID}`;
      const authority = begin(operation);
      if (!authority) return false;
      try {
        await sendActivityFriendRequest(user.userID);
        return isCurrentOperation(operation, authority);
      } catch (error) {
        if (isCurrentOperation(operation, authority)) setErrorMessage(activityErrorMessage(error));
        return false;
      } finally {
        end(operation, authority);
      }
    },
    [begin, end, isCurrentOperation],
  );

  const load = useCallback(
    (force = false) => loadForScope(scopeRef.current, generationRef.current, force),
    [loadForScope],
  );
  const serverNow = useCallback(() => {
    const serverAnchor = serverTimeAnchorRef.current;
    const deviceAnchor = deviceTimeAnchorRef.current;
    return serverAnchor && deviceAnchor
      ? new Date(serverAnchor.getTime() + Date.now() - deviceAnchor.getTime())
      : new Date();
  }, []);
  const dismissRewardCelebration = useCallback((id: string) => {
    setRewardCelebration((current) => (current?.id === id ? undefined : current));
  }, []);
  const clearError = useCallback(() => setErrorMessage(undefined), []);

  return {
    snapshot,
    isLoading,
    isShowingCachedData,
    matchedUsers,
    phoneVerificationSession,
    rewardCelebration,
    errorMessage,
    isRunning: (operation) => operationsRef.current.has(operation),
    serverNow,
    load,
    claimCheckIn,
    claimMeal,
    spinWheel,
    finishSpinAnimation,
    discoverContacts,
    createShareSession,
    completeShare,
    redeemInvite,
    requestPhoneCode,
    verifyPhone,
    sendFriendRequest,
    dismissRewardCelebration,
    clearError,
  };
}

function activityErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "api.networkUnavailable";
}
