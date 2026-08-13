import { SymbolView } from "expo-symbols";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
  isLegalDynamicScreenComplete,
  legalDocumentKind,
  type DynamicScreen,
} from "@/services/dynamic-screen/DynamicScreenModels";
import {
  dynamicScreenPalette,
  dynamicScreenVisualPolicy as metrics,
} from "@/services/dynamic-screen/DynamicScreenVisualPolicy";
import type { DynamicRoute } from "@/services/remote-config/types";
import { openDynamicRoute } from "@/services/web/DynamicRouteNavigator";
import {
  copySupportEmail,
  normalizedSupportEmail,
  openSupportEmail,
} from "@/services/account/SupportEmailService";
import { useConfiguredSupportEmail } from "@/services/account/useConfiguredSupportEmail";
import { resolveWalletRuntimeConfig } from "@/services/wallet/walletPolicy";

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
  const walletTermsScreenId = useMemo(
    () => resolveWalletRuntimeConfig(config.wallet).termsScreenId,
    [config.wallet],
  );
  const legalKind = useMemo(
    () =>
      legalDocumentKind(screenId, {
        walletTerms: walletTermsScreenId,
        privacyPolicy: config.account?.privacyScreenId,
        dataPrivacy: config.account?.dataPrivacyScreenId,
      }),
    [
      config.account?.dataPrivacyScreenId,
      config.account?.privacyScreenId,
      screenId,
      walletTermsScreenId,
    ],
  );
  const embedded = useMemo(
    () => embeddedDynamicScreen(screenId, config.screens, legalKind),
    [config.screens, legalKind, screenId],
  );
  const [screen, setScreen] = useState<DynamicScreen | null>(embedded);
  const [isLoading, setLoading] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const screenRef = useRef<DynamicScreen | null>(embedded);
  const pendingRef = useRef<Promise<void> | null>(null);
  const etagRef = useRef<string | null>(null);
  const identity = JSON.stringify([
    ownerId?.trim() ? `user.${ownerId.trim()}` : "guest",
    screenId,
    activeLanguage,
    legalKind,
  ]);
  const identityRef = useRef(identity);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  const title =
    legalKind === "wallet_terms"
      ? t("wallet.terms.title")
      : screen
        ? displayDynamicScreenTitle(screen, activeLanguage, t)
        : fallbackTitle || screenId;
  const isLegalScreen = legalKind !== null;

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

  // A screen cache is account- and locale-scoped. Reset synchronously at commit
  // time so a route, account, or language change cannot paint stale legal copy
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
      const cached = await readCachedDynamicScreen(ownerId, screenId, activeLanguage);
      if (!isCurrent()) return;
      etagRef.current = cached.etag;
      // A persisted remote document must outrank the bundled fallback. If its
      // ETag receives 304, keeping the fallback here would silently hide the
      // last verified legal document on every subsequent visit.
      if (
        cached.screen &&
        isLegalDynamicScreenComplete(screenId, cached.screen, activeLanguage, legalKind)
      ) {
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
          await persistDynamicScreenETag(ownerId, screenId, activeLanguage, result.etag);
        }
        if (!isCurrent()) return;
        setErrorMessage(null);
        return;
      }
      if (
        result.screen &&
        isDynamicScreenSupported(result.screen) &&
        isLegalDynamicScreenComplete(screenId, result.screen, activeLanguage, legalKind)
      ) {
        current = result.screen;
        screenRef.current = result.screen;
        if (result.etag !== null) etagRef.current = result.etag;
        setScreen(result.screen);
        await persistDynamicScreen(ownerId, screenId, activeLanguage, result.screen, result.etag);
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
  }, [activeLanguage, embedded, legalKind, ownerId, screenId, t]);

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
      {isLegalScreen && screen.documentVersion?.trim() && screen.effectiveAt?.trim() ? (
        <DynamicLegalMetadata
          documentVersion={screen.documentVersion.trim()}
          effectiveAt={screen.effectiveAt.trim()}
          theme={theme}
        />
      ) : null}
      {isLegalScreen ? (
        <DynamicLegalSupportFooter documentSupportEmail={screen.supportEmail} theme={theme} />
      ) : null}
    </ScrollView>
  );
}

function DynamicLegalMetadata({
  documentVersion,
  effectiveAt,
  theme,
}: {
  documentVersion: string;
  effectiveAt: string;
  theme: ReturnType<typeof dynamicScreenPalette>;
}) {
  const { t } = useLocalization();
  const versionLabel = t("legal.document.version");
  const effectiveAtLabel = t("legal.document.effectiveAt");

  return (
    <View
      accessibilityLabel={`${versionLabel}: ${documentVersion}; ${effectiveAtLabel}: ${effectiveAt}`}
      accessibilityRole="text"
      accessible
      style={[styles.metadataCard, { backgroundColor: theme.card }]}
    >
      <View style={styles.metadataRow}>
        <Text accessible={false} style={[styles.metadataLabel, { color: theme.secondaryText }]}>
          {versionLabel}
        </Text>
        <Text accessible={false} style={[styles.metadataValue, { color: theme.text }]}>
          {documentVersion}
        </Text>
      </View>
      <View style={styles.metadataRow}>
        <Text accessible={false} style={[styles.metadataLabel, { color: theme.secondaryText }]}>
          {effectiveAtLabel}
        </Text>
        <Text accessible={false} style={[styles.metadataValue, { color: theme.text }]}>
          {effectiveAt}
        </Text>
      </View>
    </View>
  );
}

function DynamicLegalSupportFooter({
  documentSupportEmail,
  theme,
}: {
  documentSupportEmail: string | undefined;
  theme: ReturnType<typeof dynamicScreenPalette>;
}) {
  const { t } = useLocalization();
  const { supportEmail: configuredSupportEmail, isLoading } = useConfiguredSupportEmail();
  const supportEmail = normalizedSupportEmail(documentSupportEmail) ?? configuredSupportEmail;

  const contactSupport = async () => {
    if (!supportEmail) {
      Alert.alert(t("common.notice"), t("account.support.unavailable"));
      return;
    }
    if (await openSupportEmail(supportEmail)) return;
    Alert.alert(t("account.support.openFailed.title"), t("account.support.openFailed.message"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("account.support.copy"), onPress: () => void copySupportEmail(supportEmail) },
    ]);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: isLoading, disabled: isLoading }}
      disabled={isLoading}
      onPress={() => void contactSupport()}
      style={({ pressed }) => [
        styles.supportCard,
        { backgroundColor: theme.card },
        pressed ? styles.supportCardPressed : null,
      ]}
    >
      <Text style={[styles.supportTitle, { color: theme.text }]}>
        {t("account.contactSupport")}
      </Text>
      <Text style={[styles.supportEmail, { color: theme.accent }]}>
        {supportEmail ?? (isLoading ? t("common.loading") : t("account.support.notConfigured"))}
      </Text>
    </Pressable>
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
  metadataCard: { borderRadius: 14, gap: 7, paddingHorizontal: 16, paddingVertical: 12 },
  metadataLabel: { flexShrink: 0, fontSize: 13, fontWeight: "600" },
  metadataRow: { alignItems: "baseline", flexDirection: "row", gap: 12 },
  metadataValue: { flex: 1, fontSize: 13, textAlign: "right" },
  rootTitle: {
    alignSelf: "stretch",
    fontSize: 30,
    fontWeight: "700",
    marginBottom: 4,
    textAlign: "left",
  },
  supportCard: {
    alignItems: "flex-start",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  supportCardPressed: { opacity: 0.72 },
  supportEmail: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  supportTitle: { fontSize: 15, fontWeight: "700" },
});
