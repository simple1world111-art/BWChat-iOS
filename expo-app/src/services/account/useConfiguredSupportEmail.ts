import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import {
  normalizedSupportEmail,
  persistLastKnownGoodSupportEmail,
  readLastKnownGoodSupportEmail,
} from "@/services/account/SupportEmailService";

export interface ConfiguredSupportEmailState {
  supportEmail: string | undefined;
  isLoading: boolean;
  isUnavailable: boolean;
  isNotConfigured: boolean;
  refreshSupportEmail(): Promise<void>;
}

export function useConfiguredSupportEmail(): ConfiguredSupportEmailState {
  const { config, error, isRefreshing, refresh } = useRemoteConfig();
  const configuredEmail = normalizedSupportEmail(config.account?.supportEmail);
  const mounted = useRef(true);
  const forcedRefreshStarted = useRef(false);
  const [cachedEmail, setCachedEmail] = useState<string | undefined>();
  const [cacheResolved, setCacheResolved] = useState(false);
  const [forcedRefreshFinished, setForcedRefreshFinished] = useState(false);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    void readLastKnownGoodSupportEmail().then((email) => {
      if (!mounted.current) return;
      setCachedEmail(email);
      setCacheResolved(true);
    });
  }, []);

  useEffect(() => {
    if (!configuredEmail) return;
    void persistLastKnownGoodSupportEmail(configuredEmail).then((email) => {
      if (mounted.current && email) setCachedEmail(email);
    });
  }, [configuredEmail]);

  useEffect(() => {
    if (
      configuredEmail ||
      cachedEmail ||
      !cacheResolved ||
      isRefreshing ||
      forcedRefreshStarted.current
    ) {
      return;
    }
    forcedRefreshStarted.current = true;
    void refresh({ ignoreETag: true }).finally(() => {
      if (mounted.current) setForcedRefreshFinished(true);
    });
  }, [cacheResolved, cachedEmail, configuredEmail, isRefreshing, refresh]);

  const refreshSupportEmail = useCallback(async () => {
    forcedRefreshStarted.current = true;
    setForcedRefreshFinished(false);
    try {
      await refresh({ ignoreETag: true });
    } finally {
      if (mounted.current) setForcedRefreshFinished(true);
    }
  }, [refresh]);

  return useMemo(() => {
    const supportEmail = configuredEmail ?? cachedEmail;
    const isLoading = !supportEmail && (!cacheResolved || isRefreshing || !forcedRefreshFinished);
    return {
      supportEmail,
      isLoading,
      isUnavailable: !supportEmail && !isLoading && Boolean(error),
      isNotConfigured: !supportEmail && !isLoading && !error,
      refreshSupportEmail,
    };
  }, [
    cacheResolved,
    cachedEmail,
    configuredEmail,
    error,
    forcedRefreshFinished,
    isRefreshing,
    refreshSupportEmail,
  ]);
}
