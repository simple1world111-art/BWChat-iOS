import * as Application from "expo-application";
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
import { captureException } from "@/services/monitoring/MonitoringService";
import {
  defaultRemoteConfig,
  fetchRemoteConfig,
  readCachedRemoteConfig,
  shouldRefreshRemoteConfig,
} from "@/services/remote-config/RemoteConfigService";
import type { FeatureKey, RemoteConfig, RemoteConfigSource } from "@/services/remote-config/types";
import {
  visualAcceptanceEnabled,
  walletVisualAcceptanceEnabled,
  walletVisualAcceptanceRemoteConfig,
} from "@/services/visualAcceptance";

interface RemoteConfigContextValue {
  config: RemoteConfig;
  source: RemoteConfigSource;
  isRefreshing: boolean;
  error: string | null;
  isFeatureEnabled(key: FeatureKey): boolean;
  refresh(options?: { ignoreETag?: boolean }): Promise<void>;
}

const RemoteConfigContext = createContext<RemoteConfigContextValue | null>(null);

export function RemoteConfigProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const ownerId = user?.user_id;
  const [remoteState, setRemoteState] = useState<RemoteConfigState>(() => ({
    ownerId,
    config: bundledConfig(),
    source: "bundled",
    // The bundled account-compliance config intentionally has no support email.
    // Keep the first frame in a loading state so screens do not present that
    // temporary absence as a real server configuration result.
    isRefreshing: !visualAcceptanceEnabled,
    error: null,
  }));
  const refreshOperationRef = useRef(0);
  const ownerStateIsCurrent = remoteState.ownerId === ownerId;
  const config = ownerStateIsCurrent ? remoteState.config : bundledConfig();
  const source = ownerStateIsCurrent ? remoteState.source : "bundled";
  const isRefreshing = ownerStateIsCurrent && remoteState.isRefreshing;
  const error = ownerStateIsCurrent ? remoteState.error : null;

  const refresh = useCallback(
    async (options?: { ignoreETag?: boolean }) => {
      if (visualAcceptanceEnabled) return;
      const requestOwnerId = ownerId;
      const operation = ++refreshOperationRef.current;
      const isCurrent = () => refreshOperationRef.current === operation;
      setRemoteState((current) => ({
        ownerId: requestOwnerId,
        config: current.ownerId === requestOwnerId ? current.config : bundledConfig(),
        source: current.ownerId === requestOwnerId ? current.source : "bundled",
        isRefreshing: true,
        error: current.ownerId === requestOwnerId ? current.error : null,
      }));
      try {
        const result = await fetchRemoteConfig(requestOwnerId, 8_000, options);
        if (!isCurrent()) return;
        setRemoteState({
          ownerId: requestOwnerId,
          config: result.config,
          source: result.source,
          isRefreshing: false,
          error: null,
        });
      } catch (nextError) {
        if (!isCurrent()) return;
        const message = nextError instanceof Error ? nextError.message : "远程配置加载失败";
        setRemoteState((current) =>
          current.ownerId === requestOwnerId
            ? { ...current, isRefreshing: false, error: message }
            : current,
        );
        captureException(nextError, { operation: "remote_config" });
      }
    },
    [ownerId],
  );

  useEffect(() => {
    if (visualAcceptanceEnabled) return;
    let active = true;
    const requestOwnerId = ownerId;
    const operation = ++refreshOperationRef.current;
    const isCurrent = () => active && refreshOperationRef.current === operation;
    void (async () => {
      let cached: RemoteConfig | null = null;
      try {
        cached = await readCachedRemoteConfig(requestOwnerId);
        if (!isCurrent()) return;
        const interval =
          cached?.refreshIntervalSeconds ?? defaultRemoteConfig.refreshIntervalSeconds;
        const needsRefresh = await shouldRefreshRemoteConfig(requestOwnerId, interval);
        if (!isCurrent()) return;
        setRemoteState({
          ownerId: requestOwnerId,
          config: cached ?? bundledConfig(),
          source: cached ? "cache" : "bundled",
          isRefreshing: needsRefresh,
          error: null,
        });
        if (needsRefresh && isCurrent()) await refresh();
      } catch (nextError) {
        if (!isCurrent()) return;
        const message = nextError instanceof Error ? nextError.message : "远程配置缓存加载失败";
        setRemoteState({
          ownerId: requestOwnerId,
          config: cached ?? bundledConfig(),
          source: cached ? "cache" : "bundled",
          isRefreshing: false,
          error: message,
        });
        captureException(nextError, { operation: "remote_config_cache" });
      }
    })();
    return () => {
      active = false;
      refreshOperationRef.current += 1;
    };
  }, [ownerId, refresh]);

  const isFeatureEnabled = useCallback(
    (key: FeatureKey) => {
      const buildNumber = Number(Application.nativeBuildVersion ?? "0");
      if (
        config.minSupportedBuild !== undefined &&
        buildNumber > 0 &&
        buildNumber < config.minSupportedBuild
      ) {
        return false;
      }
      return config.features[key];
    },
    [config],
  );

  const value = useMemo<RemoteConfigContextValue>(
    () => ({ config, source, isRefreshing, error, isFeatureEnabled, refresh }),
    [config, error, isFeatureEnabled, isRefreshing, refresh, source],
  );
  return <RemoteConfigContext.Provider value={value}>{children}</RemoteConfigContext.Provider>;
}

interface RemoteConfigState {
  ownerId: string | undefined;
  config: RemoteConfig;
  source: RemoteConfigSource;
  isRefreshing: boolean;
  error: string | null;
}

function bundledConfig(): RemoteConfig {
  return walletVisualAcceptanceEnabled
    ? { ...defaultRemoteConfig, wallet: walletVisualAcceptanceRemoteConfig }
    : defaultRemoteConfig;
}

export function useRemoteConfig(): RemoteConfigContextValue {
  const value = useContext(RemoteConfigContext);
  if (!value) throw new Error("useRemoteConfig must be used inside RemoteConfigProvider");
  return value;
}
