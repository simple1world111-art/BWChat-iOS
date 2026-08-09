import { AppState, InteractionManager } from "react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  checkAndDownloadUpdate,
  reloadToApplyUpdate,
  type UpdateCheckResult,
} from "@/services/update/UpdateService";

interface UpdateContextValue {
  result: UpdateCheckResult | null;
  isChecking: boolean;
  check(force?: boolean): Promise<UpdateCheckResult>;
  reload(): Promise<void>;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const appStateRef = useRef(AppState.currentState);

  const check = useCallback(async (force = false) => {
    setIsChecking(true);
    try {
      const next = await checkAndDownloadUpdate(force);
      setResult(next);
      return next;
    } finally {
      setIsChecking(false);
    }
  }, []);

  const runAutomaticCheck = useCallback(
    async (force: boolean) => {
      await check(force);
    },
    [check],
  );

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => void runAutomaticCheck(true));
    return () => task.cancel();
  }, [runAutomaticCheck]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === "active" && previousState !== "active") {
        // A newly published Preview update should be discovered on the next
        // foreground entry, even if an earlier no-update check happened less
        // than the persisted throttle window ago.
        void runAutomaticCheck(true);
      }
    });
    return () => subscription.remove();
  }, [runAutomaticCheck]);

  const value = useMemo<UpdateContextValue>(
    () => ({ result, isChecking, check, reload: reloadToApplyUpdate }),
    [check, isChecking, result],
  );
  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useAppUpdate(): UpdateContextValue {
  const value = useContext(UpdateContext);
  if (!value) throw new Error("useAppUpdate must be used inside UpdateProvider");
  return value;
}
