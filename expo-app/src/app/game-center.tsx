import { LinearGradient } from "expo-linear-gradient";
import {
  router,
  Stack,
  useFocusEffect,
  type Href,
  type NativeStackNavigationOptions,
} from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type LayoutChangeEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";

import { GamePoster } from "@/components/games/GamePoster";
import { GameWebViewPrewarmer } from "@/components/games/GameWebViewPrewarmer";
import { SystemSegmentedTabs } from "@/components/SystemSegmentedTabs";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { allowsInitialGameURL } from "@/services/games/GameBridge";
import { GameAccountScope } from "@/services/games/GameAccountScope";
import {
  appendRecommendedPage,
  createGameLobbySession,
  gameCenterErrorKey,
  loadPlayedGames,
  loadRecommendedGames,
  readCachedGamePage,
  readGamePlayedRevision,
  type GameRepositoryAccountGuard,
} from "@/services/games/GameRepository";
import {
  deduplicateGames,
  gameDisplayIconURL,
  type GameCatalogItem,
  type GameCatalogPage,
} from "@/services/games/GameModels";
import {
  gameRewardedAdUnitAllowlist,
  prepareGameRewardedAds,
} from "@/services/games/GameRewardedAdService";
import { gameCenterMetrics, gameCenterPolicy } from "@/services/games/GameCenterPolicy";
import { gameLaunchPolicy } from "@/services/web/WebViewPolicy";
import {
  runAfterNavigationInteractions,
  useNavigationInteractionsSettled,
} from "@/services/navigation/NavigationWorkScheduler";
import {
  readNavigationSnapshot,
  writeNavigationSnapshot,
} from "@/services/navigation/NavigationSnapshotCache";
import { createIdempotencyKey } from "@/api/bwchat";
import { colors } from "@/theme";

type GameCenterTab = "recommended" | "played";

interface GameCenterNavigationSnapshot {
  selectedTab: GameCenterTab;
  recommended: GameCatalogPage;
  played: GameCatalogItem[];
}

export default function GameCenterScreen() {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  return <GameCenterAccountScreen key={ownerId || "signed-out"} ownerId={ownerId} />;
}

function GameCenterAccountScreen({ ownerId }: { ownerId: string }) {
  const { t } = useLocalization();
  const { config } = useRemoteConfig();
  const scheme = useColorScheme();
  const policy = useMemo(() => gameLaunchPolicy(config.webViewPolicy), [config.webViewPolicy]);
  const gameRewardedAdUnitIDs = useMemo(
    () => gameRewardedAdUnitAllowlist(config.wallet, __DEV__),
    [config.wallet],
  );
  const [navigationSnapshot] = useState(() =>
    readNavigationSnapshot<GameCenterNavigationSnapshot>("game-center", ownerId),
  );
  const [selectedTab, setSelectedTab] = useState<GameCenterTab>(
    navigationSnapshot?.selectedTab ?? "recommended",
  );
  const [recommended, setRecommended] = useState<GameCatalogPage>(
    navigationSnapshot?.recommended ?? { items: [] },
  );
  const [played, setPlayed] = useState<GameCatalogItem[]>(navigationSnapshot?.played ?? []);
  const [recommendedLoading, setRecommendedLoading] = useState(
    Boolean(ownerId && !navigationSnapshot),
  );
  const [recommendedLoadingMore, setRecommendedLoadingMore] = useState(false);
  const [playedLoading, setPlayedLoading] = useState(Boolean(ownerId && !navigationSnapshot));
  const [recommendedFailed, setRecommendedFailed] = useState(false);
  const [playedFailed, setPlayedFailed] = useState(false);
  const [launchingGameID, setLaunchingGameID] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [listViewportHeight, setListViewportHeight] = useState(0);
  const navigationInteractionsSettled = useNavigationInteractionsSettled();
  const didInitialLoadRef = useRef(false);
  const playedRevisionRef = useRef(readGamePlayedRevision(ownerId));
  const requestedCursorsRef = useRef(new Set<string>());
  const launchGateRef = useRef(false);
  const recommendedLoadRef = useRef(false);
  const recommendedMoreRef = useRef(false);
  const playedLoadRef = useRef(false);
  const accountScopeRef = useRef(new GameAccountScope(ownerId));

  useEffect(
    () => () => {
      accountScopeRef.current.updateOwner("");
    },
    [],
  );

  useEffect(() => {
    writeNavigationSnapshot<GameCenterNavigationSnapshot>("game-center", ownerId, {
      selectedTab,
      recommended,
      played,
    });
  }, [ownerId, played, recommended, selectedTab]);

  const loadRecommended = useCallback(
    async (force = false) => {
      if (!ownerId || recommendedLoadRef.current || recommendedMoreRef.current) return;
      const ticket = accountScopeRef.current.capture();
      const accountGuard = repositoryGuard(accountScopeRef.current, ticket);
      recommendedLoadRef.current = true;
      setRecommendedLoading(true);
      setRecommendedFailed(false);
      try {
        if (!force) {
          const cached = await readCachedGamePage(ownerId, "recommended");
          if (!accountScopeRef.current.isCurrent(ticket)) return;
          if (cached) {
            setRecommended({ ...cached, items: deduplicateGames(cached.items) });
          }
        }
        const result = await loadRecommendedGames(ownerId, force, accountGuard);
        if (!accountScopeRef.current.isCurrent(ticket)) return;
        setRecommended({ ...result.page, items: deduplicateGames(result.page.items) });
        requestedCursorsRef.current.clear();
      } catch {
        if (accountScopeRef.current.isCurrent(ticket)) setRecommendedFailed(true);
      } finally {
        if (accountScopeRef.current.isCurrent(ticket)) {
          recommendedLoadRef.current = false;
          setRecommendedLoading(false);
        }
      }
    },
    [ownerId],
  );

  const loadPlayed = useCallback(
    async (force = false) => {
      if (!ownerId || playedLoadRef.current) return;
      const ticket = accountScopeRef.current.capture();
      const accountGuard = repositoryGuard(accountScopeRef.current, ticket);
      playedLoadRef.current = true;
      setPlayedLoading(true);
      setPlayedFailed(false);
      try {
        if (!force) {
          const cached = await readCachedGamePage(ownerId, "played");
          if (!accountScopeRef.current.isCurrent(ticket)) return;
          if (cached) setPlayed(deduplicateGames(cached.items));
        }
        const result = await loadPlayedGames(ownerId, force, accountGuard);
        if (!accountScopeRef.current.isCurrent(ticket)) return;
        setPlayed(deduplicateGames(result.page.items));
      } catch {
        if (accountScopeRef.current.isCurrent(ticket)) setPlayedFailed(true);
      } finally {
        if (accountScopeRef.current.isCurrent(ticket)) {
          playedLoadRef.current = false;
          setPlayedLoading(false);
        }
      }
    },
    [ownerId],
  );

  useFocusEffect(
    useCallback(() => {
      return runAfterNavigationInteractions(() => {
        if (!didInitialLoadRef.current) {
          didInitialLoadRef.current = true;
          void Promise.all([loadRecommended(), loadPlayed()]);
        } else if (playedRevisionRef.current !== readGamePlayedRevision(ownerId)) {
          playedRevisionRef.current = readGamePlayedRevision(ownerId);
          void loadPlayed(true);
        }
      });
    }, [loadPlayed, loadRecommended, ownerId]),
  );

  useEffect(() => {
    return runAfterNavigationInteractions(() => void prepareGameRewardedAds(gameRewardedAdUnitIDs));
  }, [gameRewardedAdUnitIDs]);

  const refreshSelected = useCallback(async () => {
    setRefreshing(true);
    try {
      if (selectedTab === "recommended") await loadRecommended(true);
      else await loadPlayed(true);
    } finally {
      setRefreshing(false);
    }
  }, [loadPlayed, loadRecommended, selectedTab]);

  const loadMore = useCallback(async () => {
    const cursor = recommended.nextCursor?.trim();
    if (
      !ownerId ||
      !cursor ||
      recommendedLoadRef.current ||
      recommendedMoreRef.current ||
      requestedCursorsRef.current.has(cursor)
    )
      return;
    requestedCursorsRef.current.add(cursor);
    const ticket = accountScopeRef.current.capture();
    const accountGuard = repositoryGuard(accountScopeRef.current, ticket);
    recommendedMoreRef.current = true;
    setRecommendedLoadingMore(true);
    try {
      const page = await appendRecommendedPage(ownerId, recommended, cursor, accountGuard);
      if (!accountScopeRef.current.isCurrent(ticket)) return;
      setRecommended(page);
    } catch {
      if (accountScopeRef.current.isCurrent(ticket)) requestedCursorsRef.current.delete(cursor);
    } finally {
      if (accountScopeRef.current.isCurrent(ticket)) {
        recommendedMoreRef.current = false;
        setRecommendedLoadingMore(false);
      }
    }
  }, [ownerId, recommended]);

  const onCatalogScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (selectedTab !== "recommended" || recommended.items.length === 0) return;
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const prefetchDistance =
        (gameCenterMetrics.cardMinimumHeight + gameCenterMetrics.cardGap) *
        gameCenterPolicy.paginationTriggerRemainingItems;
      if (contentOffset.y + layoutMeasurement.height >= contentSize.height - prefetchDistance) {
        void loadMore();
      }
    },
    [loadMore, recommended.items.length, selectedTab],
  );

  const onListLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    setListViewportHeight((currentHeight) =>
      currentHeight === nextHeight ? currentHeight : nextHeight,
    );
  }, []);

  const openGame = useCallback(
    async (game: GameCatalogItem) => {
      if (launchGateRef.current) return;
      const ticket = accountScopeRef.current.capture();
      launchGateRef.current = true;
      setLaunchingGameID(game.id);
      try {
        const session = await createGameLobbySession(game.id, createIdempotencyKey());
        if (!accountScopeRef.current.isCurrent(ticket)) return;
        if (!allowsInitialGameURL(session.launchURL, policy)) {
          Alert.alert(t("common.operationFailed"), t("gameCenter.invalidURL"));
          return;
        }
        router.push({
          pathname: "/in-app-web",
          params: {
            url: session.launchURL,
            title: game.name,
            restrictToInitialOrigin: "true",
            gameID: game.id,
            sessionID: session.sessionID,
            ownerID: ticket.ownerId,
            gameName: game.name,
            posterURL: game.posterURL,
            ...(game.iconURL ? { iconURL: game.iconURL } : {}),
            ...(game.summary ? { summary: game.summary } : {}),
            ...(game.gameType ? { gameType: game.gameType } : {}),
            ...(game.entryPriceGoldCoins !== undefined
              ? { entryPriceGoldCoins: String(game.entryPriceGoldCoins) }
              : {}),
            sortOrder: String(game.sortOrder),
          },
        } as unknown as Href);
      } catch (error) {
        if (accountScopeRef.current.isCurrent(ticket)) {
          Alert.alert(t("common.operationFailed"), t(gameCenterErrorKey(error)));
        }
      } finally {
        if (accountScopeRef.current.isCurrent(ticket)) {
          launchGateRef.current = false;
          setLaunchingGameID(undefined);
        }
      }
    },
    [policy, t],
  );

  const data = selectedTab === "recommended" ? recommended.items : played;
  const loading = selectedTab === "recommended" ? recommendedLoading : playedLoading;
  const failed = selectedTab === "recommended" ? recommendedFailed : playedFailed;
  const emptyMessage =
    selectedTab === "recommended"
      ? t("gameCenter.recommended.empty")
      : t("gameCenter.played.empty");
  const headerOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      title: "",
      headerBackButtonDisplayMode: "minimal",
      headerShadowVisible: false,
      headerStyle: { backgroundColor: "transparent" },
      headerTintColor: colors.text,
      headerTitle: () => <GameCenterTabs selection={selectedTab} onChange={setSelectedTab} />,
    }),
    [selectedTab],
  );

  return (
    <View style={[styles.screen, { backgroundColor: scheme === "dark" ? "#1C1C1E" : "#F2F2F7" }]}>
      <Stack.Screen options={headerOptions} />
      {navigationInteractionsSettled ? <GameWebViewPrewarmer /> : null}
      {data.length === 0 ? (
        <ScrollView
          alwaysBounceVertical
          centerContent={false}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={[
            styles.list,
            styles.emptyList,
            listViewportHeight > 0 && { minHeight: listViewportHeight },
          ]}
          onLayout={onListLayout}
          onScroll={onCatalogScroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.accent}
              onRefresh={() => void refreshSelected()}
            />
          }
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          style={styles.listContainer}
          testID="game-center-empty-scroll"
        >
          {loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator accessibilityLabel={t("common.loading")} color={colors.accent} />
            </View>
          ) : failed ? (
            <MessageState
              icon="wifi.exclamationmark"
              message={t("gameCenter.loadFailed")}
              actionTitle={t("common.retry")}
              onAction={() =>
                void (selectedTab === "recommended" ? loadRecommended(true) : loadPlayed(true))
              }
            />
          ) : (
            <MessageState
              icon={selectedTab === "recommended" ? "gamecontroller" : "clock.arrow.circlepath"}
              message={emptyMessage}
            />
          )}
        </ScrollView>
      ) : (
        <ScrollView
          alwaysBounceVertical
          centerContent={false}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={[
            styles.list,
            listViewportHeight > 0 && { minHeight: listViewportHeight },
          ]}
          key={`content:${selectedTab}`}
          onLayout={onListLayout}
          onScroll={onCatalogScroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.accent}
              onRefresh={() => void refreshSelected()}
            />
          }
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          style={styles.listContainer}
          testID="game-center-list"
        >
          <View style={styles.dataStack}>
            {data.map((game) => (
              <GameCard
                game={game}
                isLaunching={launchingGameID === game.id}
                key={game.id}
                policy={policy}
                onPress={() => void openGame(game)}
              />
            ))}
          </View>
          {recommendedLoadingMore && selectedTab === "recommended" ? (
            <ActivityIndicator color={colors.accent} style={styles.moreSpinner} />
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function GameCenterTabs({
  selection,
  onChange,
}: {
  selection: GameCenterTab;
  onChange(value: GameCenterTab): void;
}) {
  const { t } = useLocalization();
  return (
    <SystemSegmentedTabs
      accessibilityIdentifier="gameCenter.top.tabs"
      items={[
        { value: "recommended", title: t("gameCenter.tab.recommended") },
        { value: "played", title: t("gameCenter.tab.played") },
      ]}
      onSelectionChange={onChange}
      selection={selection}
      width={gameCenterMetrics.tabWidth}
    />
  );
}

function GameCard({
  game,
  isLaunching,
  policy,
  onPress,
}: {
  game: GameCatalogItem;
  isLaunching: boolean;
  policy: ReturnType<typeof gameLaunchPolicy>;
  onPress(): void;
}) {
  const { t } = useLocalization();
  const scheme = useColorScheme();
  return (
    <Pressable
      accessibilityHint={t("gameCenter.open.hint")}
      accessibilityLabel={game.name}
      accessibilityRole="button"
      disabled={isLaunching}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: scheme === "dark" ? "#000000" : "#FFFFFF" },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.posterFrame}>
        <GamePoster policy={policy} url={gameDisplayIconURL(game)} />
        {isLaunching ? (
          <View accessibilityLabel={t("common.loading")} style={styles.launchOverlay}>
            <ActivityIndicator color="#FFFFFF" size="small" />
          </View>
        ) : null}
      </View>
      <View style={styles.cardCopy}>
        <Text numberOfLines={1} style={styles.gameName}>
          {game.name}
        </Text>
        <Text numberOfLines={2} style={styles.gameSummary}>
          {game.summary?.trim() || t("gameCenter.description.empty")}
        </Text>
        <View style={styles.badge}>
          <Text numberOfLines={1} style={styles.badgeText}>
            {game.gameType?.trim() || t("gameCenter.type.other")}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function MessageState({
  icon,
  message,
  actionTitle,
  onAction,
}: {
  icon: SFSymbol;
  message: string;
  actionTitle?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.messageState}>
      <SymbolView
        name={icon}
        size={gameCenterMetrics.messageIconSize}
        weight="semibold"
        tintColor={colors.tertiaryText}
      />
      <Text style={styles.message}>{message}</Text>
      {actionTitle && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction}>
          <LinearGradient colors={[colors.accent, colors.accentDark]} style={styles.retryButton}>
            <Text style={styles.retryText}>{actionTitle}</Text>
          </LinearGradient>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  listContainer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  list: {
    flexGrow: 1,
    alignItems: "stretch",
    justifyContent: "flex-start",
    paddingHorizontal: gameCenterMetrics.contentHorizontalInset,
    paddingVertical: gameCenterMetrics.contentVerticalInset,
  },
  emptyList: {
    flexGrow: 1,
    minHeight:
      gameCenterMetrics.initialStateMinimumHeight + gameCenterMetrics.contentVerticalInset * 2,
    justifyContent: "flex-start",
  },
  dataStack: { rowGap: gameCenterMetrics.cardGap },
  card: {
    minHeight: gameCenterMetrics.cardMinimumHeight,
    padding: gameCenterMetrics.cardPadding,
    borderRadius: gameCenterMetrics.cardRadius,
    flexDirection: "row",
    alignItems: "center",
    columnGap: gameCenterMetrics.cardHorizontalGap,
  },
  pressed: { opacity: 0.72 },
  posterFrame: {
    width: gameCenterMetrics.posterSize,
    height: gameCenterMetrics.posterSize,
    borderRadius: gameCenterMetrics.posterRadius,
    overflow: "hidden",
  },
  launchOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: `rgba(0,0,0,${gameCenterMetrics.launchOverlayOpacity})`,
  },
  cardCopy: {
    flex: 1,
    minWidth: 0,
    minHeight: gameCenterMetrics.copyMinimumHeight,
    alignItems: "flex-start",
    rowGap: gameCenterMetrics.copyGap,
  },
  gameName: { color: colors.text, fontSize: gameCenterMetrics.nameSize, fontWeight: "600" },
  gameSummary: {
    color: colors.secondaryText,
    fontSize: gameCenterMetrics.summarySize,
    fontWeight: "400",
    lineHeight: gameCenterMetrics.summaryLineHeight,
  },
  badge: {
    borderRadius: gameCenterMetrics.badgeRadius,
    paddingHorizontal: gameCenterMetrics.badgeHorizontalInset,
    paddingVertical: gameCenterMetrics.badgeVerticalInset,
    backgroundColor: "rgba(102,126,234,0.12)",
  },
  badgeText: {
    color: colors.accent,
    fontSize: gameCenterMetrics.badgeTextSize,
    fontWeight: "600",
  },
  messageState: {
    minHeight: gameCenterMetrics.initialStateMinimumHeight,
    padding: gameCenterMetrics.messageStatePadding,
    alignItems: "center",
    justifyContent: "center",
    rowGap: gameCenterMetrics.messageStateGap,
  },
  loadingState: {
    minHeight: gameCenterMetrics.initialStateMinimumHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    color: colors.secondaryText,
    fontSize: gameCenterMetrics.messageTextSize,
    fontWeight: "500",
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: gameCenterMetrics.retryHorizontalInset,
    paddingVertical: gameCenterMetrics.retryVerticalInset,
    borderRadius: gameCenterMetrics.retryRadius,
  },
  retryText: {
    color: "#FFFFFF",
    fontSize: gameCenterMetrics.retryTextSize,
    fontWeight: "600",
  },
  moreSpinner: { paddingVertical: gameCenterMetrics.nextPageSpinnerVerticalInset },
});

function repositoryGuard(
  scope: GameAccountScope,
  ticket: ReturnType<GameAccountScope["capture"]>,
): GameRepositoryAccountGuard {
  return {
    operationKey: String(ticket.generation),
    isCurrent: () => scope.isCurrent(ticket),
  };
}
