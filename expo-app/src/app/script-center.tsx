import { LinearGradient } from "expo-linear-gradient";
import { router, Stack, useFocusEffect, type NativeStackNavigationOptions } from "expo-router";
import { SymbolView } from "expo-symbols";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";

import { getScriptCategories, getScripts } from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { SystemSegmentedTabs } from "@/components/SystemSegmentedTabs";
import { env } from "@/config/env";
import type { InteractiveScript, ScriptCategory, ScriptPage, ScriptScope } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  loadCachedScriptCategories,
  loadCachedScriptPage,
  saveCachedScriptCategories,
  saveCachedScriptPage,
  scriptCatalogGeneration,
  subscribeScriptLibraryChanges,
} from "@/services/scripts/ScriptCatalogRepository";
import {
  appendUniqueScripts,
  scriptBadgeText,
  scriptCenterMetrics,
  scriptText,
} from "@/services/scripts/scriptCenterPolicy";
import { palette } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";
import { rememberScriptForNavigation } from "@/services/scripts/ScriptNavigationStore";
import { runAfterNavigationInteractions } from "@/services/navigation/NavigationWorkScheduler";
import {
  readNavigationSnapshot,
  writeNavigationSnapshot,
} from "@/services/navigation/NavigationSnapshotCache";

interface ScriptSelectionSnapshot {
  scripts: InteractiveScript[];
  nextCursor?: string | undefined;
  hasMore: boolean;
  hasResolved: boolean;
}

interface ScriptCenterNavigationSnapshot {
  scope: ScriptScope;
  selectedCategoryId?: string | undefined;
  categories: ScriptCategory[];
  scripts: InteractiveScript[];
  nextCursor?: string | undefined;
  hasMore: boolean;
  hasResolvedSelection?: boolean | undefined;
  pages?: Record<string, ScriptSelectionSnapshot> | undefined;
}

export default function ScriptCenterScreen() {
  const { user } = useAuth();
  const ownerId = trimFoundationWhitespacesAndNewlines(user?.user_id ?? "");
  return <ScriptCenterOwner key={ownerId || "anonymous"} ownerId={ownerId} />;
}

export function ScriptCenterOwner({ ownerId }: { ownerId: string }) {
  const { selectedLanguage, t } = useLocalization();
  const scheme = useColorScheme();
  const theme = palette(scheme);
  const styles = useMemo(() => makeStyles(scheme), [scheme]);
  const { width: viewportWidth } = useWindowDimensions();
  const cardWidth = Math.max(
    1,
    (viewportWidth - scriptCenterMetrics.gridHorizontalInset * 2 - scriptCenterMetrics.gridGap) /
      scriptCenterMetrics.gridColumns,
  );
  const [navigationSnapshot] = useState(() =>
    readNavigationSnapshot<ScriptCenterNavigationSnapshot>("script-center", ownerId),
  );
  const initialScope = navigationSnapshot?.scope ?? "public";
  const initialCategoryId = navigationSnapshot?.selectedCategoryId;
  const initialPages = restoreSelectionSnapshots(navigationSnapshot);
  const initialPage = initialPages[scriptSelectionKey(initialScope, initialCategoryId)];
  const [scope, setScope] = useState<ScriptScope>(initialScope);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(
    initialCategoryId,
  );
  const [categories, setCategories] = useState<ScriptCategory[]>(
    navigationSnapshot?.categories ?? [],
  );
  const [scripts, setScripts] = useState<InteractiveScript[]>(initialPage?.scripts ?? []);
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialPage?.nextCursor);
  const [hasMore, setHasMore] = useState(initialPage?.hasMore ?? false);
  const [hasResolvedSelection, setHasResolvedSelection] = useState(
    initialPage?.hasResolved ?? false,
  );
  const [isLoading, setLoading] = useState(Boolean(ownerId && !hasResolvedSelection));
  const [isManualRefreshing, setManualRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectionRef = useRef({ ownerId, scope, categoryId: selectedCategoryId });
  const categoriesRef = useRef(categories);
  const scriptsRef = useRef(scripts);
  const selectionSnapshotsRef = useRef(initialPages);
  const loadTokenRef = useRef(0);
  const paginationGenerationRef = useRef(0);
  const paginationInFlightRef = useRef(false);
  const manualRefreshInFlightRef = useRef(false);
  const activeRef = useRef(true);
  const hasResolvedSelectionRef = useRef(hasResolvedSelection);
  const hasFocusedRef = useRef(false);
  const skipNextSelectionEffectRef = useRef(false);
  const hasScheduledInitialSelectionLoadRef = useRef(false);

  const resolveSelection = useCallback(() => {
    if (hasResolvedSelectionRef.current) return;
    hasResolvedSelectionRef.current = true;
    setHasResolvedSelection(true);
  }, []);

  const restoreSelection = useCallback((nextScope: ScriptScope, nextCategoryId?: string) => {
    const restored = selectionSnapshotsRef.current[scriptSelectionKey(nextScope, nextCategoryId)];
    const nextScripts = restored?.scripts ?? [];
    const resolved = restored?.hasResolved ?? false;
    scriptsRef.current = nextScripts;
    hasResolvedSelectionRef.current = resolved;
    setScripts(nextScripts);
    setHasMore(restored?.hasMore ?? false);
    setNextCursor(restored?.nextCursor);
    setHasResolvedSelection(resolved);
    setLoading(!resolved);
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      loadTokenRef.current += 1;
      paginationGenerationRef.current += 1;
      paginationInFlightRef.current = false;
      manualRefreshInFlightRef.current = false;
    };
  }, []);
  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);
  useEffect(() => {
    scriptsRef.current = scripts;
  }, [scripts]);
  useEffect(() => {
    selectionRef.current = { ownerId, scope, categoryId: selectedCategoryId };
  }, [ownerId, scope, selectedCategoryId]);
  useEffect(() => {
    const page: ScriptSelectionSnapshot = {
      scripts,
      nextCursor,
      hasMore,
      hasResolved: hasResolvedSelection,
    };
    selectionSnapshotsRef.current = {
      ...selectionSnapshotsRef.current,
      [scriptSelectionKey(scope, selectedCategoryId)]: page,
    };
    writeNavigationSnapshot<ScriptCenterNavigationSnapshot>("script-center", ownerId, {
      scope,
      selectedCategoryId,
      categories,
      scripts,
      nextCursor,
      hasMore,
      hasResolvedSelection,
      pages: selectionSnapshotsRef.current,
    });
  }, [
    categories,
    hasMore,
    hasResolvedSelection,
    nextCursor,
    ownerId,
    scope,
    scripts,
    selectedCategoryId,
  ]);

  const text = useCallback(
    (chinese: string, english: string) => scriptText(selectedLanguage, chinese, english),
    [selectedLanguage],
  );

  const selectScope = useCallback(
    (value: ScriptScope) => {
      if (value === scope) return;
      loadTokenRef.current += 1;
      paginationGenerationRef.current += 1;
      paginationInFlightRef.current = false;
      selectionRef.current = { ownerId, scope: value, categoryId: selectedCategoryId };
      restoreSelection(value, selectedCategoryId);
      setScope(value);
    },
    [ownerId, restoreSelection, scope, selectedCategoryId],
  );

  const selectCategory = useCallback(
    (categoryId: string | undefined) => {
      if (categoryId === selectedCategoryId) return;
      loadTokenRef.current += 1;
      paginationGenerationRef.current += 1;
      paginationInFlightRef.current = false;
      selectionRef.current = { ownerId, scope, categoryId };
      restoreSelection(scope, categoryId);
      setSelectedCategoryId(categoryId);
    },
    [ownerId, restoreSelection, scope, selectedCategoryId],
  );

  const loadCategories = useCallback(
    async (force: boolean, token: number, cacheGeneration: number): Promise<ScriptCategory[]> => {
      const cached = await loadCachedScriptCategories(ownerId).catch(() => null);
      if (!activeRef.current || token !== loadTokenRef.current) return [];
      if (cached) {
        categoriesRef.current = cached.value;
        setCategories(cached.value);
      }
      if (cached && !cached.isStale && !force) return cached.value;
      try {
        const remote = await getScriptCategories();
        if (!activeRef.current || token !== loadTokenRef.current) return cached?.value ?? [];
        categoriesRef.current = remote;
        setCategories(remote);
        await saveCachedScriptCategories(ownerId, remote, Date.now(), cacheGeneration).catch(
          () => undefined,
        );
        return remote;
      } catch (error) {
        if (
          activeRef.current &&
          token === loadTokenRef.current &&
          !cached &&
          categoriesRef.current.length === 0
        ) {
          setErrorMessage(readableError(error, text("请求失败，请稍后重试", "Request failed")));
        }
        return cached?.value ?? categoriesRef.current;
      }
    },
    [ownerId, text],
  );

  const runSelectionLoad = useCallback(
    async (
      options: {
        force?: boolean;
        reloadCategories?: boolean;
      } = {},
    ) => {
      if (!ownerId || !activeRef.current) return;
      const token = ++loadTokenRef.current;
      const cacheGeneration = scriptCatalogGeneration(ownerId);
      paginationGenerationRef.current += 1;
      paginationInFlightRef.current = false;
      const requestedScope = scope;
      let requestedCategoryId = selectedCategoryId;
      let hasPresentationSnapshot = hasResolvedSelectionRef.current;
      setLoading(!hasPresentationSnapshot);
      setErrorMessage(null);
      try {
        if (options.reloadCategories) {
          const loadedCategories = await loadCategories(
            Boolean(options.force),
            token,
            cacheGeneration,
          );
          if (!activeRef.current || token !== loadTokenRef.current) return;
          if (
            requestedCategoryId !== undefined &&
            !loadedCategories.some((category) => category.id === requestedCategoryId)
          ) {
            requestedCategoryId = undefined;
            selectionRef.current = {
              ownerId,
              scope: requestedScope,
              categoryId: undefined,
            };
            skipNextSelectionEffectRef.current = true;
            restoreSelection(requestedScope, undefined);
            hasPresentationSnapshot = hasResolvedSelectionRef.current;
            setSelectedCategoryId(undefined);
          }
        }
        const cached = await loadCachedScriptPage(
          ownerId,
          requestedScope,
          requestedCategoryId,
        ).catch(() => null);
        if (
          !activeRef.current ||
          token !== loadTokenRef.current ||
          !sameSelection(selectionRef.current, ownerId, requestedScope, requestedCategoryId)
        )
          return;
        if (cached && !hasPresentationSnapshot) {
          const page = cached.value;
          scriptsRef.current = page.scripts;
          setScripts(page.scripts);
          setHasMore(page.has_more);
          setNextCursor(page.next_cursor);
          resolveSelection();
        } else if (!cached && !options.force && !hasPresentationSnapshot) {
          scriptsRef.current = [];
          setScripts([]);
          setHasMore(false);
          setNextCursor(undefined);
        }
        if (cached && !cached.isStale && !options.force) return;
        try {
          const remote = await getScripts(requestedScope, {
            ...(requestedCategoryId ? { categoryId: requestedCategoryId } : {}),
            limit: scriptCenterMetrics.pageLimit,
          });
          if (
            !activeRef.current ||
            token !== loadTokenRef.current ||
            !sameSelection(selectionRef.current, ownerId, requestedScope, requestedCategoryId)
          )
            return;
          scriptsRef.current = remote.scripts;
          setScripts(remote.scripts);
          setHasMore(remote.has_more);
          setNextCursor(remote.next_cursor);
          resolveSelection();
          await saveCachedScriptPage(
            ownerId,
            requestedScope,
            requestedCategoryId,
            remote,
            Date.now(),
            cacheGeneration,
          ).catch(() => undefined);
        } catch (error) {
          if (
            activeRef.current &&
            token === loadTokenRef.current &&
            sameSelection(selectionRef.current, ownerId, requestedScope, requestedCategoryId) &&
            !cached &&
            !hasPresentationSnapshot
          ) {
            setErrorMessage(readableError(error, text("请求失败，请稍后重试", "Request failed")));
          }
        }
      } finally {
        if (activeRef.current && token === loadTokenRef.current) {
          resolveSelection();
          setLoading(false);
        }
      }
    },
    [loadCategories, ownerId, resolveSelection, restoreSelection, scope, selectedCategoryId, text],
  );

  const loadSelection = useCallback(
    (
      options: {
        force?: boolean;
        reloadCategories?: boolean;
      } = {},
    ) => runSelectionLoad(options),
    [runSelectionLoad],
  );

  const loadMore = useCallback(async () => {
    if (!ownerId || !activeRef.current || !hasMore || isLoading || paginationInFlightRef.current)
      return;
    const requestedScope = scope;
    const requestedCategoryId = selectedCategoryId;
    const cursor = nextCursor;
    const generation = ++paginationGenerationRef.current;
    const cacheGeneration = scriptCatalogGeneration(ownerId);
    paginationInFlightRef.current = true;
    setErrorMessage(null);
    try {
      const page = await getScripts(requestedScope, {
        ...(requestedCategoryId ? { categoryId: requestedCategoryId } : {}),
        ...(cursor ? { cursor } : {}),
        limit: scriptCenterMetrics.pageLimit,
      });
      if (
        !activeRef.current ||
        generation !== paginationGenerationRef.current ||
        !sameSelection(selectionRef.current, ownerId, requestedScope, requestedCategoryId)
      )
        return;
      const merged = appendUniqueScripts(scriptsRef.current, page.scripts);
      scriptsRef.current = merged;
      setScripts(merged);
      setHasMore(page.has_more);
      setNextCursor(page.next_cursor);
      const combined: ScriptPage = { ...page, scripts: merged };
      await saveCachedScriptPage(
        ownerId,
        requestedScope,
        requestedCategoryId,
        combined,
        Date.now(),
        cacheGeneration,
      ).catch(() => undefined);
    } catch {
      // Native pagination keeps the already visible page and does not surface
      // an inline error. A later appearance or pull-to-refresh can retry.
    } finally {
      if (generation === paginationGenerationRef.current) {
        paginationInFlightRef.current = false;
      }
    }
  }, [hasMore, isLoading, nextCursor, ownerId, scope, selectedCategoryId]);

  const manualRefresh = useCallback(async () => {
    if (manualRefreshInFlightRef.current) return;
    manualRefreshInFlightRef.current = true;
    setManualRefreshing(true);
    try {
      await loadSelection({ force: true, reloadCategories: true });
    } finally {
      manualRefreshInFlightRef.current = false;
      if (activeRef.current) setManualRefreshing(false);
    }
  }, [loadSelection]);

  useEffect(() => {
    if (skipNextSelectionEffectRef.current) {
      skipNextSelectionEffectRef.current = false;
      return;
    }
    const work = () => void loadSelection({ reloadCategories: categories.length === 0 });
    if (!hasScheduledInitialSelectionLoadRef.current) {
      hasScheduledInitialSelectionLoadRef.current = true;
      return runAfterNavigationInteractions(work);
    }
    const frame = requestAnimationFrame(work);
    // Categories are intentionally not a dependency: a cache/remote category write
    // must not restart the selected-page request.
    return () => {
      cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, scope, selectedCategoryId]);

  useEffect(
    () =>
      subscribeScriptLibraryChanges(ownerId, () => {
        void loadSelection({ force: true, reloadCategories: true });
      }),
    [loadSelection, ownerId],
  );

  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return;
      }
      // The source listens for explicit library changes, so ordinary focus does not
      // force a request when a fresh cache already owns the current selection.
    }, []),
  );

  const awaitingFirstSnapshot = isLoading && !hasResolvedSelection;
  const renderScript = useCallback(
    ({ item }: ListRenderItemInfo<InteractiveScript>) => (
      <ScriptCardCell
        cardWidth={cardWidth}
        item={item}
        ownerId={ownerId}
        selectedLanguage={selectedLanguage}
        styles={styles}
      />
    ),
    [cardWidth, ownerId, selectedLanguage, styles],
  );
  const headerOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      title: "",
      headerShadowVisible: false,
      headerStyle: { backgroundColor: theme.background },
      headerBackTitle: t("common.back"),
      headerBackButtonDisplayMode: "minimal",
      headerTintColor: "#1A1A2E",
      headerTitle: () => (
        <SystemSegmentedTabs<ScriptScope>
          accessibilityIdentifier="script.center.top.tabs"
          colorScheme="light"
          items={[
            { value: "public", title: text("公开剧本", "Public") },
            { value: "mine", title: text("我的剧本", "Mine") },
          ]}
          onSelectionChange={selectScope}
          selection={scope}
        />
      ),
      headerRight: () => (
        <Pressable
          accessibilityLabel={text("创建剧本", "Create script")}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.push("/script-editor")}
          style={styles.createButton}
        >
          <SymbolView name="plus" size={18} weight="semibold" tintColor={theme.text} />
        </Pressable>
      ),
    }),
    [scope, selectScope, styles.createButton, t, text, theme.background, theme.text],
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={headerOptions} />

      <ScrollView
        contentContainerStyle={styles.categories}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoryScroller}
      >
        <CategoryPill
          categoryId={undefined}
          onSelect={selectCategory}
          selected={selectedCategoryId === undefined}
          styles={styles}
          title={text("全部", "All")}
        />
        {categories.map((category) => (
          <CategoryPill
            key={category.id}
            categoryId={category.id}
            onSelect={selectCategory}
            selected={selectedCategoryId === category.id}
            styles={styles}
            title={category.name}
          />
        ))}
      </ScrollView>

      <FlatList
        testID="script-center-list"
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[styles.grid, scripts.length === 0 && styles.emptyGrid]}
        data={scripts}
        initialNumToRender={6}
        keyExtractor={(script) => script.script_id}
        maxToRenderPerBatch={6}
        numColumns={scriptCenterMetrics.gridColumns}
        ListEmptyComponent={
          awaitingFirstSnapshot ? (
            <View />
          ) : (
            <ScriptCenterEmpty
              error={errorMessage}
              onRetry={() => void manualRefresh()}
              scope={scope}
              styles={styles}
              text={text}
            />
          )
        }
        ListFooterComponent={null}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.3}
        refreshControl={
          scripts.length === 0 ? undefined : (
            <RefreshControl
              refreshing={isManualRefreshing}
              tintColor={theme.accent}
              onRefresh={() => void manualRefresh()}
            />
          )
        }
        renderItem={renderScript}
        showsVerticalScrollIndicator={false}
        updateCellsBatchingPeriod={16}
        windowSize={5}
      />
    </View>
  );
}

const CategoryPill = memo(function CategoryPill({
  categoryId,
  onSelect,
  selected,
  styles,
  title,
}: {
  categoryId: string | undefined;
  onSelect(categoryId: string | undefined): void;
  selected: boolean;
  styles: ReturnType<typeof makeStyles>;
  title: string;
}) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onSelect(categoryId)}
      style={({ pressed }) => [
        styles.categoryPill,
        selected && styles.categoryPillSelected,
        pressed && styles.categoryPillPressed,
      ]}
    >
      <Text
        ellipsizeMode="tail"
        numberOfLines={1}
        style={[styles.categoryText, selected && styles.categoryTextSelected]}
      >
        {title}
      </Text>
    </Pressable>
  );
});

const ScriptCardCell = memo(function ScriptCardCell({
  cardWidth,
  item,
  ownerId,
  selectedLanguage,
  styles,
}: {
  cardWidth: number;
  item: InteractiveScript;
  ownerId: string;
  selectedLanguage: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      accessibilityLabel={scriptCardAccessibilityLabel(item, selectedLanguage)}
      accessibilityRole="button"
      onPress={() => {
        rememberScriptForNavigation(item, ownerId);
        router.push({ pathname: "/script-detail", params: { scriptId: item.script_id } });
      }}
      style={[styles.cardCell, { width: cardWidth }]}
    >
      <ScriptCard script={item} selectedLanguage={selectedLanguage} styles={styles} />
    </Pressable>
  );
});

function ScriptCard({
  script,
  selectedLanguage,
  styles,
}: {
  script: InteractiveScript;
  selectedLanguage: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  const badge = scriptBadgeText(script, selectedLanguage);
  return (
    <View style={styles.card}>
      <ScriptCover key={script.cover_url} badge={badge} styles={styles} url={script.cover_url} />
      <Text numberOfLines={1} style={styles.cardTitle}>
        {script.title}
      </Text>
      <Text numberOfLines={2} style={styles.cardSynopsis}>
        {script.synopsis}
      </Text>
      <View style={styles.cardFooter}>
        <View style={styles.roleAvatars}>
          {script.roles.slice(0, 4).map((role, index) => (
            <View
              key={role.role_id || role.client_role_id || role.name}
              style={[styles.roleAvatarFrame, index > 0 && styles.overlapAvatar]}
            >
              <ScriptCatalogImage
                fallback="person.fill"
                radius={11}
                size={22}
                styles={styles}
                url={role.avatar_url}
              />
            </View>
          ))}
        </View>
        <Text numberOfLines={1} style={styles.creator}>
          {script.creator.nickname}
        </Text>
      </View>
    </View>
  );
}

function ScriptCover({
  badge,
  styles,
  url,
}: {
  badge: string | null;
  styles: ReturnType<typeof makeStyles>;
  url: string;
}) {
  return (
    <View style={styles.coverWrap}>
      <ScriptCatalogImage
        fallback="book.closed.fill"
        radius={scriptCenterMetrics.coverRadius}
        styles={styles}
        url={url}
      />
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
    </View>
  );
}

function ScriptCenterEmpty({
  error,
  onRetry,
  scope,
  styles,
  text,
}: {
  error: string | null;
  onRetry(): void;
  scope: ScriptScope;
  styles: ReturnType<typeof makeStyles>;
  text: (chinese: string, english: string) => string;
}) {
  const icon = error
    ? "exclamationmark.triangle"
    : scope === "mine"
      ? "square.and.pencil"
      : "book.closed";
  const title = error
    ? text("无法加载公开剧本", "Unable to load scripts")
    : scope === "mine"
      ? text("还没有创建剧本", "No scripts yet")
      : text("暂无公开剧本", "No public scripts");
  const subtitle =
    error ??
    (scope === "mine"
      ? text("创建角色和世界设定，开始你的故事", "Create roles and a world to begin")
      : text("稍后再来看看新的故事", "Check back for new stories"));
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      <View style={styles.emptyIconGradient}>
        <SymbolView
          name={icon as never}
          size={36}
          weight="semibold"
          tintColor={styles.accent.color}
        />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
      {error ? (
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={styles.retryText}>{text("重试", "Retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ScriptCatalogImage({
  fallback,
  radius,
  size,
  styles,
  url,
}: {
  fallback: string;
  radius: number;
  size?: number;
  styles: ReturnType<typeof makeStyles>;
  url: string;
}) {
  const resolved = resolveMediaUrl(url, env.apiBaseUrl);
  const imageStyle = size
    ? { width: size, height: size, borderRadius: radius }
    : { width: "100%" as const, height: "100%" as const, borderRadius: radius };
  const fallbackView = (
    <LinearGradient
      colors={["rgba(102,126,234,0.12)", "#F2E8FF"]}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={[imageStyle, styles.imageFallback]}
    >
      <SymbolView
        name={fallback as never}
        size={size ? Math.min(16, size) : 24}
        weight="semibold"
        tintColor="rgba(102,126,234,0.70)"
      />
    </LinearGradient>
  );
  return resolved ? (
    <AuthenticatedImage
      contentFit="cover"
      errorFallback={fallbackView}
      fallback={fallbackView}
      loadingFallback={fallbackView}
      style={imageStyle}
      transition={0}
      uri={resolved}
    />
  ) : (
    fallbackView
  );
}

function restoreSelectionSnapshots(
  snapshot: ScriptCenterNavigationSnapshot | undefined,
): Record<string, ScriptSelectionSnapshot> {
  if (!snapshot) return {};
  const restored = Object.fromEntries(
    Object.entries(snapshot.pages ?? {}).map(([key, page]) => [
      key,
      { ...page, hasResolved: page.hasResolved ?? true },
    ]),
  );
  const currentKey = scriptSelectionKey(snapshot.scope, snapshot.selectedCategoryId);
  restored[currentKey] ??= {
    scripts: snapshot.scripts,
    nextCursor: snapshot.nextCursor,
    hasMore: snapshot.hasMore,
    hasResolved: snapshot.hasResolvedSelection ?? true,
  };
  return restored;
}

function scriptSelectionKey(scope: ScriptScope, categoryId?: string): string {
  return `${scope}\u0000${categoryId?.trim() || "all"}`;
}

function sameSelection(
  current: { ownerId: string; scope: ScriptScope; categoryId: string | undefined },
  ownerId: string,
  scope: ScriptScope,
  categoryId: string | undefined,
): boolean {
  return (
    current.ownerId === ownerId && current.scope === scope && current.categoryId === categoryId
  );
}

function makeStyles(scheme: ReturnType<typeof useColorScheme>) {
  const theme = palette(scheme);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    accent: { color: theme.accent },
    accentDark: { color: theme.accentDark },
    createButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
    categoryScroller: { flexGrow: 0, flexShrink: 0, minHeight: 57 },
    categories: {
      minHeight: 57,
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 12,
    },
    categoryPill: {
      flexShrink: 0,
      minHeight: 35,
      justifyContent: "center",
      paddingHorizontal: 13,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: theme.card,
    },
    categoryPillSelected: { backgroundColor: theme.accentSoft },
    categoryPillPressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
    categoryText: {
      color: theme.secondaryText,
      fontSize: 13,
      fontWeight: "400",
      lineHeight: 17,
    },
    categoryTextSelected: { color: theme.accent, fontWeight: "600" },
    grid: { paddingHorizontal: 16, paddingBottom: 24 },
    emptyGrid: { flexGrow: 1 },
    gridRow: { alignItems: "stretch", gap: 12, marginBottom: 12 },
    cardCell: { flexGrow: 0, alignSelf: "stretch" },
    card: { flex: 1, gap: 9, padding: 10, borderRadius: 15, backgroundColor: theme.card },
    coverWrap: { width: "100%", aspectRatio: scriptCenterMetrics.coverAspectRatio },
    badge: {
      position: "absolute",
      top: 7,
      right: 7,
      overflow: "hidden",
      color: "#FFFFFF",
      fontSize: 10,
      fontWeight: "700",
      paddingHorizontal: 7,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: "rgba(0,0,0,0.62)",
    },
    cardTitle: {
      minHeight: 18,
      color: theme.text,
      fontSize: 15,
      fontWeight: "600",
      lineHeight: 18,
    },
    cardSynopsis: { height: 32, color: theme.secondaryText, fontSize: 12, lineHeight: 16 },
    cardFooter: { minHeight: 22, flexDirection: "row", alignItems: "center" },
    roleAvatars: { flexDirection: "row", alignItems: "center" },
    roleAvatarFrame: {
      width: 22,
      height: 22,
      overflow: "hidden",
      borderRadius: 11,
      borderColor: theme.card,
      borderWidth: 1.5,
    },
    overlapAvatar: { marginLeft: -5 },
    creator: {
      flex: 1,
      marginLeft: 4,
      color: theme.tertiaryText,
      fontSize: 10,
      textAlign: "right",
    },
    imageFallback: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
    emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 30 },
    emptyIconGradient: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
    emptyTitle: { color: theme.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
    emptySubtitle: {
      color: theme.secondaryText,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
    },
    retryText: { color: theme.accent, fontSize: 15, fontWeight: "600", paddingBottom: 28 },
  });
}

function scriptCardAccessibilityLabel(script: InteractiveScript, selectedLanguage: string): string {
  return [
    script.title,
    scriptBadgeText(script, selectedLanguage),
    script.synopsis,
    script.creator.nickname,
  ]
    .filter((value): value is string => Boolean(value))
    .join(", ");
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
