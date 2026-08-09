import { Alert, AppState, InteractionManager } from "react-native";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { updateCopy } from "@/localization/updateCopy";
import { useLocalization } from "@/providers/LocalizationProvider";
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
  const { activeLanguage } = useLocalization();
  const copy = updateCopy(activeLanguage);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const appStateRef = useRef(AppState.currentState);
  const promptedUpdateIdsRef = useRef(new Set<string>());

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

  const promptForDownloadedUpdate = useCallback(
    (downloaded: Extract<UpdateCheckResult, { status: "downloaded" }>) => {
      const promptKey = downloaded.updateId ?? `downloaded:${downloaded.checkedAt}`;
      if (promptedUpdateIdsRef.current.has(promptKey)) return;
      promptedUpdateIdsRef.current.add(promptKey);
      Alert.alert(
        copy.applyTitle,
        copy.statusDownloaded,
        [
          { text: copy.later, style: "cancel" },
          {
            text: copy.applyNow,
            onPress: () =>
              void reloadToApplyUpdate().catch(() => {
                Alert.alert(copy.applyTitle, copy.operationFailed);
              }),
          },
        ],
        { cancelable: false },
      );
    },
    [copy.applyNow, copy.applyTitle, copy.later, copy.operationFailed, copy.statusDownloaded],
  );

  const runAutomaticCheck = useCallback(
    async (force: boolean) => {
      const next = await check(force);
      if (next.status === "downloaded") promptForDownloadedUpdate(next);
    },
    [check, promptForDownloadedUpdate],
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
        void runAutomaticCheck(false);
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
