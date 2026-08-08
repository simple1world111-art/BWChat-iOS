import { InteractionManager } from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

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

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => void check(false));
    return () => task.cancel();
  }, [check]);

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
