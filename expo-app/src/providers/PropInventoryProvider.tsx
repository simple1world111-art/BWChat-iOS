import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/providers/AuthProvider";
import { subscribeCallSettlementRefresh } from "@/services/calls/CallSettlementRefreshService";
import { getPropBag } from "@/services/props/PropInventoryRepository";
import {
  applyPropConsumption,
  canConsumeMediaUnlock,
  canConsumeLiveExperience,
  liveExperienceDefinition,
  liveExperienceKinds,
  mediaUnlockDefinition,
  propBagSummary,
  propLiveExperienceKind,
  propMediaUnlockKind,
  type LiveExperienceCardKind,
  type MediaUnlockKind,
  type PropBagItem,
  type PropBagSummary,
  type PropConsumption,
} from "@/services/props/PropInventoryModels";

interface PropInventoryContextValue {
  items: PropBagItem[];
  summary: PropBagSummary;
  isLoading: boolean;
  errorMessage?: string | undefined;
  availableLiveExperienceCards: LiveExperienceCardKind[];
  quantity(kind: LiveExperienceCardKind): number;
  mediaQuantity(kind: MediaUnlockKind): number;
  load(forceRefresh?: boolean): Promise<void>;
  applyMediaConsumption(consumption: PropConsumption | undefined, fallback: MediaUnlockKind): void;
  applyLiveExperienceReservation(
    reservation: PropConsumption | undefined,
    fallback: LiveExperienceCardKind,
  ): void;
}

const Context = createContext<PropInventoryContextValue | null>(null);

export function PropInventoryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const scope = user?.user_id ?? "anonymous";
  return (
    <PropInventoryScope key={scope} scope={scope}>
      {children}
    </PropInventoryScope>
  );
}

function PropInventoryScope({ children, scope }: { children: React.ReactNode; scope: string }) {
  const lastLoadedRef = useRef(0);
  const loadingRef = useRef(false);
  const forcedReloadPendingRef = useRef(false);
  const lifecycleGenerationRef = useRef(1);
  const mountedRef = useRef(true);
  const lastSettlementSequenceRef = useRef(0);
  const [items, setItems] = useState<PropBagItem[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const load = useCallback(
    async (forceRefresh = false) => {
      if (scope === "anonymous") return;
      if (loadingRef.current) {
        if (forceRefresh) forcedReloadPendingRef.current = true;
        return;
      }
      if (!forceRefresh && Date.now() - lastLoadedRef.current < 60_000) return;

      const generation = lifecycleGenerationRef.current;
      loadingRef.current = true;
      if (mountedRef.current) setLoading(true);
      let shouldReload = true;
      while (shouldReload && mountedRef.current && lifecycleGenerationRef.current === generation) {
        forcedReloadPendingRef.current = false;
        try {
          const page = await getPropBag();
          if (!mountedRef.current || lifecycleGenerationRef.current !== generation) break;
          setItems(page.items);
          setErrorMessage(undefined);
          lastLoadedRef.current = Date.now();
        } catch (error) {
          if (!mountedRef.current || lifecycleGenerationRef.current !== generation) break;
          setErrorMessage(error instanceof Error ? error.message : "道具加载失败");
        }
        shouldReload = forcedReloadPendingRef.current;
      }
      loadingRef.current = false;
      if (mountedRef.current && lifecycleGenerationRef.current === generation) setLoading(false);
    },
    [scope],
  );

  useEffect(
    () => () => {
      mountedRef.current = false;
      lifecycleGenerationRef.current += 1;
      forcedReloadPendingRef.current = false;
    },
    [],
  );

  useEffect(
    () =>
      subscribeCallSettlementRefresh((event) => {
        if (event.ownerId !== scope || event.sequence <= lastSettlementSequenceRef.current) return;
        lastSettlementSequenceRef.current = event.sequence;
        void load(true);
      }),
    [load, scope],
  );

  const quantity = useCallback(
    (kind: LiveExperienceCardKind) =>
      items
        .filter((item) => propLiveExperienceKind(item) === kind && canConsumeLiveExperience(item))
        .reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );
  const mediaQuantity = useCallback(
    (kind: MediaUnlockKind) =>
      items
        .filter((item) => propMediaUnlockKind(item) === kind && canConsumeMediaUnlock(item))
        .reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );
  const availableLiveExperienceCards = useMemo(
    () => liveExperienceKinds.filter((kind) => quantity(kind) > 0),
    [quantity],
  );
  const applyLiveExperienceReservation = useCallback(
    (reservation: PropConsumption | undefined, fallback: LiveExperienceCardKind) => {
      setItems((current) =>
        applyPropConsumption(
          current,
          reservation,
          liveExperienceDefinition(fallback),
          "consume_for_live_experience",
        ),
      );
      lastLoadedRef.current = Date.now();
    },
    [],
  );
  const applyMediaConsumption = useCallback(
    (consumption: PropConsumption | undefined, fallback: MediaUnlockKind) => {
      setItems((current) =>
        applyPropConsumption(
          current,
          consumption,
          mediaUnlockDefinition(fallback),
          "consume_for_media_unlock",
        ),
      );
      lastLoadedRef.current = Date.now();
    },
    [],
  );
  const value = useMemo<PropInventoryContextValue>(
    () => ({
      items,
      summary: propBagSummary(items),
      isLoading,
      errorMessage,
      availableLiveExperienceCards,
      quantity,
      mediaQuantity,
      load,
      applyMediaConsumption,
      applyLiveExperienceReservation,
    }),
    [
      applyLiveExperienceReservation,
      applyMediaConsumption,
      availableLiveExperienceCards,
      errorMessage,
      isLoading,
      items,
      load,
      mediaQuantity,
      quantity,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePropInventory(): PropInventoryContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("usePropInventory must be used inside PropInventoryProvider");
  return value;
}
