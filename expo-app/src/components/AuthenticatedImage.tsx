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
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode;
};

export function AuthenticatedImage({
  uri,
  sourceCacheKey,
  fallback,
  loadingFallback,
  errorFallback,
  style,
  onError,
  cachePolicy,
  ...props
}: Props) {
  const needsAuthorization = useMemo(() => isSameServer(uri, env.apiBaseUrl), [uri]);
  const cacheIdentity = sourceCacheKey ?? uri;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [localState, setLocalState] = useState<{ key: string; uri?: string } | null>(null);
  const localUri =
    peekAdoptedImageUri(cacheIdentity) ??
    peekAuthenticatedImageUri(cacheIdentity) ??
    (localState?.key === cacheIdentity ? localState.uri : undefined);
  const isReady = Boolean(localUri) || !needsAuthorization;
  const sourceIdentity = `${uri}\u0000${sourceCacheKey ?? ""}`;
  const didFail = failedSource === sourceIdentity;

  useEffect(() => {
    let active = true;
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
      if (needsAuthorization && !resolvedUri) setFailedSource(sourceIdentity);
    })();
    return () => {
      active = false;
    };
  }, [cacheIdentity, needsAuthorization, sourceIdentity, uri]);

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

  return (
    <Image
      {...props}
      cachePolicy={cachePolicy ?? imageCachePolicy.cachePolicy}
      onError={(event) => {
        setFailedSource(sourceIdentity);
        onError?.(event);
      }}
      source={localUri ?? (sourceCacheKey ? { uri, cacheKey: sourceCacheKey } : uri)}
      style={style}
    />
  );
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
