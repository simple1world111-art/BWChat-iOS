import { Image, type ImageProps } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { env } from "@/config/env";
import {
  getAdoptedImageUri,
  getAuthenticatedImageUri,
  imageCachePolicy,
  peekAdoptedImageUri,
  peekAuthenticatedImageUri,
} from "@/services/cache/ImageCacheService";
import { colors } from "@/theme";

type Props = Omit<ImageProps, "source"> & {
  uri: string;
  sourceCacheKey?: string | undefined;
  authenticatedRetryIntervalMilliseconds?: number | undefined;
  maximumAuthenticatedRetries?: number | undefined;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode;
  retainLoadingFallbackUntilImageLoad?: boolean;
};

export function AuthenticatedImage({
  uri,
  sourceCacheKey,
  authenticatedRetryIntervalMilliseconds = 0,
  maximumAuthenticatedRetries = 0,
  fallback,
  loadingFallback,
  errorFallback,
  retainLoadingFallbackUntilImageLoad = false,
  style,
  onLoad,
  onError,
  cachePolicy,
  ...props
}: Props) {
  const needsAuthorization = useMemo(() => isSameServer(uri, env.apiBaseUrl), [uri]);
  const cacheIdentity = sourceCacheKey ?? uri;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [localState, setLocalState] = useState<{ key: string; uri?: string } | null>(null);
  const [retryState, setRetryState] = useState<{ source: string; attempt: number } | null>(null);
  const localUri =
    peekAdoptedImageUri(cacheIdentity) ??
    peekAuthenticatedImageUri(cacheIdentity) ??
    (localState?.key === cacheIdentity ? localState.uri : undefined);
  const isReady = Boolean(localUri) || !needsAuthorization;
  const sourceIdentity = `${uri}\u0000${sourceCacheKey ?? ""}`;
  const didFail = failedSource === sourceIdentity;
  const retryAttempt = retryState?.source === sourceIdentity ? retryState.attempt : 0;

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const adoptedUri = await getAdoptedImageUri(cacheIdentity);
      const resolvedUri =
        adoptedUri ??
        (needsAuthorization ? await getAuthenticatedImageUri(uri, cacheIdentity) : undefined);
      if (!active) return;
      setLocalState({
        key: cacheIdentity,
        ...(resolvedUri ? { uri: resolvedUri } : {}),
      });
      if (resolvedUri) {
        setFailedSource((current) => (current === sourceIdentity ? null : current));
        return;
      }
      if (!needsAuthorization) return;
      const retryInterval = Math.max(0, authenticatedRetryIntervalMilliseconds);
      const retryLimit = Math.max(0, Math.floor(maximumAuthenticatedRetries));
      if (retryInterval > 0 && retryAttempt < retryLimit) {
        setFailedSource((current) => (current === sourceIdentity ? null : current));
        retryTimer = setTimeout(() => {
          if (active) setRetryState({ source: sourceIdentity, attempt: retryAttempt + 1 });
        }, retryInterval);
        return;
      }
      setFailedSource(sourceIdentity);
    })();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    authenticatedRetryIntervalMilliseconds,
    cacheIdentity,
    maximumAuthenticatedRetries,
    needsAuthorization,
    retryAttempt,
    sourceIdentity,
    uri,
  ]);

  if (!isReady || didFail) {
    const stateFallback = didFail ? errorFallback : loadingFallback;
    if (stateFallback ?? fallback) return stateFallback ?? fallback;
    return (
      <View style={[style as StyleProp<ViewStyle>, styles.placeholder]}>
        {didFail ? (
          <SymbolView
            name="photo.badge.exclamationmark"
            size={18}
            tintColor={colors.secondaryText}
          />
        ) : (
          <ActivityIndicator color={colors.secondaryText} size="small" />
        )}
      </View>
    );
  }

  const renderImage = (imageStyle: ImageProps["style"]) => (
    <Image
      {...props}
      cachePolicy={cachePolicy ?? imageCachePolicy.cachePolicy}
      onLoad={(event) => {
        setLoadedSource(sourceIdentity);
        onLoad?.(event);
      }}
      onError={(event) => {
        setFailedSource(sourceIdentity);
        onError?.(event);
      }}
      source={localUri ?? (sourceCacheKey ? { uri, cacheKey: sourceCacheKey } : uri)}
      style={imageStyle}
    />
  );

  if (retainLoadingFallbackUntilImageLoad && loadingFallback) {
    return (
      <View style={style as StyleProp<ViewStyle>}>
        {renderImage(StyleSheet.absoluteFill)}
        {loadedSource !== sourceIdentity ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {loadingFallback}
          </View>
        ) : null}
      </View>
    );
  }

  return renderImage(style);
}

function isSameServer(uri: string, apiBaseUrl: string): boolean {
  try {
    return new URL(uri).origin === new URL(apiBaseUrl).origin;
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  placeholder: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.separator,
  },
});
