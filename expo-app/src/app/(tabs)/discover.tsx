import { LinearGradient } from "expo-linear-gradient";
import { router, type Href, useFocusEffect } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";

import { getMomentsUnreadInfo } from "@/api/bwchat";
import { RootTabTitle } from "@/components/RootTabTitle";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import {
  defaultDiscoverSections,
  discoverItemTitle,
  effectiveDiscoverSections,
  normalizeDiscoverColor,
  normalizeToken,
  parseDiscoverConfig,
  type DiscoverItem,
  type DiscoverSection,
} from "@/services/discover/DiscoverConfig";
import {
  fetchDiscoverSections,
  readCachedDiscoverConfig,
} from "@/services/discover/DiscoverConfigRepository";
import {
  discoverRefreshDelayMs,
  discoverRefreshMayCommit,
  shouldFetchDiscoverConfig,
} from "@/services/discover/DiscoverRefreshPolicy";
import { publishMomentsUnread } from "@/services/moments/MomentsUnreadStore";
import { openDynamicRoute } from "@/services/web/DynamicRouteNavigator";
import { palette } from "@/theme";

const TEST_DISCOVER_ITEM: DiscoverItem = {
  id: "test_entry",
  titleI18n: {
    de: "Test",
    en: "Test",
    es: "Prueba",
    fr: "Test",
    ja: "テスト",
    ko: "테스트",
    "pt-BR": "Teste",
    ru: "Тест",
    "zh-Hans": "测试",
    "zh-Hant": "測試",
  },
  systemImage: "star.fill",
  colors: ["FF9500", "FFCC00"],
  route: { type: "coming_soon" },
};

export default function DiscoverScreen() {
  const scheme = useColorScheme();
  const theme = palette(scheme);
  const { user } = useAuth();
  const { activeLanguage, t } = useLocalization();
  const { config, source } = useRemoteConfig();
  const accountOwnerId = user?.user_id.trim() ?? "";
  const ownerId = accountOwnerId || "guest";
  const [endpointSections, setEndpointSections] =
    useState<DiscoverSection[]>(defaultDiscoverSections);
  const [momentsSnapshot, setMomentsSnapshot] = useState<{
    ownerId: string;
    unread: number;
    hasNew: boolean;
  } | null>(null);
  const lastRefreshRef = useRef(0);
  const initialAppearRef = useRef(false);
  const lastOwnerRef = useRef<string | null>(null);
  const activeOwnerRef = useRef(ownerId);
  const refreshGenerationRef = useRef(0);
  const deferredTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusedRef = useRef(false);
  const remoteSections = useMemo(() => {
    if (source === "bundled" || config.discover === undefined) return undefined;
    try {
      const sections = effectiveDiscoverSections(parseDiscoverConfig(config.discover));
      return sections.length > 0 ? sections : undefined;
    } catch {
      return undefined;
    }
  }, [config.discover, source]);
  const displayedSections = remoteSections ?? endpointSections;
  const momentsUnread = momentsSnapshot?.ownerId === ownerId ? momentsSnapshot.unread : 0;
  const hasNewMoments = momentsSnapshot?.ownerId === ownerId ? momentsSnapshot.hasNew : false;

  useEffect(() => {
    activeOwnerRef.current = ownerId;
  }, [ownerId]);

  const refresh = useCallback(
    async (force: boolean, targetOwnerId: string, generation: number) => {
      const now = Date.now();
      const fetchConfig = shouldFetchDiscoverConfig({
        force,
        nowMs: now,
        lastAttemptMs: lastRefreshRef.current,
      });
      if (fetchConfig) lastRefreshRef.current = now;
      const [discoverResult, momentsResult] = await Promise.allSettled([
        fetchConfig ? fetchDiscoverSections() : Promise.resolve<DiscoverSection[] | null>(null),
        getMomentsUnreadInfo(),
      ]);
      if (
        !discoverRefreshMayCommit({
          generation,
          currentGeneration: refreshGenerationRef.current,
          targetOwnerId,
          activeOwnerId: activeOwnerRef.current,
          focused: focusedRef.current,
        })
      ) {
        return;
      }
      if (
        discoverResult.status === "fulfilled" &&
        discoverResult.value !== null &&
        discoverResult.value.length > 0
      ) {
        setEndpointSections(discoverResult.value);
      }
      if (momentsResult.status === "fulfilled") {
        publishMomentsUnread(accountOwnerId, momentsResult.value.unread_count);
        setMomentsSnapshot({
          ownerId: targetOwnerId,
          unread: momentsResult.value.unread_count,
          hasNew: momentsResult.value.has_new_moments,
        });
      }
    },
    [accountOwnerId],
  );

  const cancelDeferredRefresh = useCallback(() => {
    if (deferredTimerRef.current) clearTimeout(deferredTimerRef.current);
    deferredTimerRef.current = undefined;
    refreshGenerationRef.current += 1;
  }, []);

  const scheduleDeferredRefresh = useCallback(
    (force: boolean, targetOwnerId: string) => {
      if (deferredTimerRef.current) clearTimeout(deferredTimerRef.current);
      const generation = refreshGenerationRef.current + 1;
      refreshGenerationRef.current = generation;
      deferredTimerRef.current = setTimeout(() => {
        deferredTimerRef.current = undefined;
        if (focusedRef.current) void refresh(force, targetOwnerId, generation);
      }, discoverRefreshDelayMs);
    },
    [refresh],
  );

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      activeOwnerRef.current = ownerId;
      let active = true;
      void readCachedDiscoverConfig().then((cached) => {
        if (!active || activeOwnerRef.current !== ownerId || !cached) return;
        const sections = effectiveDiscoverSections(cached);
        if (sections.length > 0) setEndpointSections(sections);
      });
      const ownerChanged = lastOwnerRef.current !== null && lastOwnerRef.current !== ownerId;
      scheduleDeferredRefresh(!initialAppearRef.current || ownerChanged, ownerId);
      initialAppearRef.current = true;
      lastOwnerRef.current = ownerId;
      return () => {
        active = false;
        focusedRef.current = false;
        cancelDeferredRefresh();
      };
    }, [cancelDeferredRefresh, ownerId, scheduleDeferredRefresh]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && focusedRef.current) {
        scheduleDeferredRefresh(false, activeOwnerRef.current);
      } else if (state !== "active") {
        cancelDeferredRefresh();
      }
    });
    return () => subscription.remove();
  }, [cancelDeferredRefresh, scheduleDeferredRefresh]);

  const open = useCallback(
    async (item: DiscoverItem) => {
      const id = normalizeToken(item.id);
      if (id === "live") {
        router.push("/live-lobby" as Href);
        return;
      }
      if (id === "benefits") {
        router.push("/activity-center" as Href);
        return;
      }
      const stableRoute =
        id === "games"
          ? { type: "native", name: "game_center" }
          : id === "stories"
            ? { type: "native", name: "script_center" }
            : id === "benefits"
              ? { type: "native", name: "activity_center" }
              : (item.route ?? { type: "native", name: item.id });
      const fallbackTitle = discoverItemTitle(item, activeLanguage, t);
      const outcome = await openDynamicRoute(
        stableRoute,
        config.webViewPolicy,
        fallbackTitle,
        t("discover.comingSoon"),
        activeLanguage,
        t,
      );
      if (!outcome.handled) Alert.alert(outcome.title, outcome.message, [{ text: t("common.ok") }]);
    },
    [activeLanguage, config.webViewPolicy, t],
  );

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: theme.background }}
    >
      <View style={styles.header}>
        <RootTabTitle localizedKey="tab.discover" style={styles.headerTitle} />
      </View>
      <View style={styles.sections}>
        {displayedSections.map((section) => (
          <View key={section.id} style={[styles.card, { backgroundColor: theme.card }]}>
            {section.items.map((item, index) => (
              <DiscoverRow
                badge={
                  isMoments(item) ||
                  ["moments_unread", "moments"].includes(normalizeToken(item.badgeKey ?? ""))
                    ? momentsUnread
                    : item.badgeCount
                }
                item={item}
                key={item.id}
                last={index === section.items.length - 1}
                onPress={() => void open(item)}
                showsDot={
                  isMoments(item) ||
                  ["moments_new", "moments"].includes(normalizeToken(item.dotKey ?? ""))
                    ? hasNewMoments
                    : item.showsDot === true
                }
                theme={theme}
                title={discoverItemTitle(item, activeLanguage, t)}
              />
            ))}
          </View>
        ))}
        <View style={[styles.card, { backgroundColor: theme.card }]} testID="discover-test-card">
          <DiscoverRow
            item={TEST_DISCOVER_ITEM}
            last
            onPress={() => void open(TEST_DISCOVER_ITEM)}
            showsDot={false}
            theme={theme}
            title={discoverItemTitle(TEST_DISCOVER_ITEM, activeLanguage, t)}
          />
        </View>
      </View>
    </ScrollView>
  );
}

function DiscoverRow({
  item,
  title,
  badge,
  showsDot,
  last,
  onPress,
  theme,
}: {
  item: DiscoverItem;
  title: string;
  badge?: number | undefined;
  showsDot: boolean;
  last: boolean;
  onPress(): void;
  theme: ReturnType<typeof palette>;
}) {
  const displayColors = (item.colors ?? [])
    .map(normalizeDiscoverColor)
    .filter(notUndefined)
    .slice(0, 2);
  const iconFill =
    displayColors.length > 1 ? (
      <LinearGradient
        colors={[displayColors[0]!, displayColors[1]!]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    ) : (
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: displayColors[0] ?? theme.accent }]}
      />
    );
  return (
    <View>
      <Pressable
        accessibilityLabel={badge && badge > 0 ? `${title}, ${badge}` : title}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.iconAnchor}>
          <View style={styles.iconBox}>
            {iconFill}
            <SymbolView
              name={(item.systemImage?.trim() || "sparkles") as SFSymbol}
              resizeMode="center"
              size={17}
              tintColor="#FFFFFF"
            />
          </View>
          {showsDot ? <View style={styles.dot} /> : null}
        </View>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          numberOfLines={1}
          style={[styles.title, { color: theme.text }]}
        >
          {title}
        </Text>
        <View style={styles.trailing}>
          {badge !== undefined && badge > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
          <SymbolView
            name="chevron.right"
            size={14}
            style={styles.chevron}
            weight="semibold"
            tintColor={theme.tertiaryText}
          />
        </View>
      </Pressable>
      {!last ? <View style={[styles.divider, { backgroundColor: theme.separator }]} /> : null}
    </View>
  );
}

function isMoments(item: DiscoverItem): boolean {
  return (
    normalizeToken(item.id) === "moments" || normalizeToken(item.route?.name ?? "") === "moments"
  );
}
function notUndefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 20 },
  // SwiftUI applies the 2pt padding outside the 36pt frame. RN includes it in
  // minHeight, so 38pt is the equivalent outer height here.
  header: { minHeight: 38, paddingBottom: 2, justifyContent: "center" },
  // The glyph raster is identical on iOS, but RN places its baseline 4pt high.
  headerTitle: { flex: 1, transform: [{ translateY: 4 }] },
  sections: { marginTop: 12, rowGap: 12 },
  card: { overflow: "hidden", borderRadius: 14 },
  row: {
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 14,
  },
  pressed: { opacity: 0.62 },
  iconAnchor: { width: 40, height: 40 },
  iconBox: {
    width: 40,
    height: 40,
    overflow: "hidden",
    // RN's clipped corner raster is slightly tighter than SwiftUI's 10pt
    // RoundedRectangle at @3x; 11pt preserves the same visible silhouette.
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#FF0000",
  },
  title: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: "500" },
  trailing: { flexDirection: "row", alignItems: "center", columnGap: 8 },
  chevron: { transform: [{ translateX: 2 }] },
  badge: {
    minWidth: 20,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: "#FF0000",
    alignItems: "center",
  },
  badgeText: { color: "#FFFFFF", fontSize: 11, lineHeight: 14, fontWeight: "700" },
  divider: { height: 1, marginLeft: 70 },
});
