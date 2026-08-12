import { SymbolView } from "expo-symbols";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";

import { DynamicComponentRenderer } from "@/components/dynamic-screen/DynamicComponentRenderer";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import {
  dynamicScreenErrorMessage,
  embeddedDynamicScreen,
  fetchDynamicScreen,
  persistDynamicScreen,
  persistDynamicScreenETag,
  readCachedDynamicScreen,
} from "@/services/dynamic-screen/DynamicScreenRepository";
import {
  displayDynamicScreenTitle,
  isDynamicScreenSupported,
  type DynamicScreen,
} from "@/services/dynamic-screen/DynamicScreenModels";
import {
  dynamicScreenPalette,
  dynamicScreenVisualPolicy as metrics,
} from "@/services/dynamic-screen/DynamicScreenVisualPolicy";
import type { DynamicRoute } from "@/services/remote-config/types";
import { openDynamicRoute } from "@/services/web/DynamicRouteNavigator";

export default function DynamicScreenPage() {
  const params = useLocalSearchParams<{ id: string }>();
  const screenId = Array.isArray(params.id) ? (params.id[0] ?? "") : params.id;
  return <DynamicScreenContent screenId={screenId} />;
}

export function DynamicScreenContent({
  fallbackTitle,
  isTabRoot = false,
  screenId,
}: {
  fallbackTitle?: string | undefined;
  isTabRoot?: boolean | undefined;
  screenId: string;
}) {
  const navigation = useNavigation();
  const { user } = useAuth();
  const ownerId = user?.user_id;
  const { activeLanguage, t } = useLocalization();
  const { config } = useRemoteConfig();
  const theme = dynamicScreenPalette(useColorScheme());
  const embedded = useMemo(
    () => embeddedDynamicScreen(screenId, config.screens),
    [config.screens, screenId],
  );
  const [screen, setScreen] = useState<DynamicScreen | null>(embedded);
  const [isLoading, setLoading] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const screenRef = useRef<DynamicScreen | null>(embedded);
  const pendingRef = useRef<Promise<void> | null>(null);
  const etagRef = useRef<string | null>(null);
  const identity = JSON.stringify([ownerId?.trim() ? `user.${ownerId.trim()}` : "guest", screenId]);
  const identityRef = useRef(identity);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  const title = screen
    ? displayDynamicScreenTitle(screen, activeLanguage, t)
    : fallbackTitle || screenId;

  useLayoutEffect(() => {
    if (!isTabRoot) navigation.setOptions({ title });
  }, [isTabRoot, navigation, title]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      pendingRef.current = null;
    };
  }, []);

  // A screen cache is account-scoped. Reset synchronously at commit time so a
  // route or account change cannot paint the previous identity's cached page
  // for one frame before the new request/cache lifecycle starts.
  useLayoutEffect(() => {
    if (identityRef.current === identity) return;
    identityRef.current = identity;
    generationRef.current += 1;
    pendingRef.current = null;
    etagRef.current = null;
    screenRef.current = embedded;
    setScreen(embedded);
    setErrorMessage(null);
    setLoading(false);
    setRefreshing(false);
  }, [embedded, identity]);

  const performLoad = useCallback(async () => {
    const generation = generationRef.current;
    const isCurrent = () => mountedRef.current && generation === generationRef.current;
    if (!isCurrent()) return;
    setLoading(true);
    let current = screenRef.current ?? embedded;
    try {
      const cached = await readCachedDynamicScreen(ownerId, screenId);
      if (!isCurrent()) return;
      etagRef.current = cached.etag;
      // A persisted remote document must outrank the bundled fallback. If its
      // ETag receives 304, keeping the fallback here would silently hide the
      // last verified legal document on every subsequent visit.
      if (cached.screen) {
        current = cached.screen;
        screenRef.current = cached.screen;
        setScreen(cached.screen);
      } else if (!screenRef.current && current) {
        screenRef.current = current;
        setScreen(current);
      }
      const result = await fetchDynamicScreen(screenId, etagRef.current);
      if (!isCurrent()) return;
      if (result.notModified) {
        if (result.etag !== null) {
          etagRef.current = result.etag;
          await persistDynamicScreenETag(ownerId, screenId, result.etag);
        }
        if (!isCurrent()) return;
        setErrorMessage(null);
        return;
      }
      if (result.screen && isDynamicScreenSupported(result.screen)) {
        current = result.screen;
        screenRef.current = result.screen;
        if (result.etag !== null) etagRef.current = result.etag;
        setScreen(result.screen);
        await persistDynamicScreen(ownerId, screenId, result.screen, result.etag);
        if (!isCurrent()) return;
        setErrorMessage(null);
      }
    } catch (error) {
      if (isCurrent() && !current) {
        setErrorMessage(dynamicScreenErrorMessage(error, t));
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [embedded, ownerId, screenId, t]);

  const load = useCallback(async () => {
    if (pendingRef.current) return pendingRef.current;
    const operation = performLoad().finally(() => {
      if (pendingRef.current === operation) pendingRef.current = null;
    });
    pendingRef.current = operation;
    return operation;
  }, [performLoad]);

  const refresh = useCallback(async () => {
    const generation = generationRef.current;
    if (!mountedRef.current) return;
    setRefreshing(true);
    try {
      await load();
    } finally {
      if (mountedRef.current && generation === generationRef.current) setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const openRoute = useCallback(
    (route?: DynamicRoute) => {
      const generation = generationRef.current;
      void openDynamicRoute(
        route,
        config.webViewPolicy,
        title,
        t("discover.comingSoon"),
        activeLanguage,
        t,
      ).then((outcome) => {
        if (mountedRef.current && generation === generationRef.current && !outcome.handled) {
          Alert.alert(outcome.title, outcome.message, [{ text: t("common.ok") }]);
        }
      });
    },
    [activeLanguage, config.webViewPolicy, t, title],
  );

  if (!screen && isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        {isTabRoot ? <Text style={[styles.rootTitle, { color: theme.text }]}>{title}</Text> : null}
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (!screen) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.background }]}>
        {isTabRoot ? <Text style={[styles.rootTitle, { color: theme.text }]}>{title}</Text> : null}
        <SymbolView
          name="sparkles.rectangle.stack"
          size={38}
          weight="semibold"
          tintColor={theme.tertiaryText}
        />
        <Text style={[styles.emptyText, { color: theme.secondaryText }]}>
          {errorMessage ?? t("discover.comingSoon")}
        </Text>
      </View>
    );
  }
  return (
    <ScrollView
      contentContainerStyle={[styles.content, { backgroundColor: theme.background }]}
      refreshControl={
        <RefreshControl
          onRefresh={() => void refresh()}
          refreshing={isRefreshing}
          tintColor={theme.accent}
        />
      }
    >
      {isTabRoot ? <Text style={[styles.rootTitle, { color: theme.text }]}>{title}</Text> : null}
      {screen.components
        .filter((component) => component.visible ?? true)
        .map((component) => (
          <DynamicComponentRenderer component={component} key={component.id} onRoute={openRoute} />
        ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, gap: 18, justifyContent: "center" },
  content: {
    flexGrow: 1,
    gap: metrics.componentSpacing,
    paddingBottom: metrics.contentBottomPadding,
    paddingHorizontal: metrics.contentHorizontalPadding,
    paddingTop: metrics.contentTopPadding,
  },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  emptyText: { fontSize: 15, fontWeight: "500", textAlign: "center" },
  rootTitle: {
    alignSelf: "stretch",
    fontSize: 30,
    fontWeight: "700",
    marginBottom: 4,
    textAlign: "left",
  },
});
