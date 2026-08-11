import { LinearGradient } from "expo-linear-gradient";
import {
  router,
  Stack,
  useLocalSearchParams,
  type NativeStackNavigationOptions,
} from "expo-router";
import { SymbolView } from "expo-symbols";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";

import {
  addMomentComment,
  createIdempotencyKey,
  deleteMoment,
  getMomentDetail,
  getMomentsFollowing,
  getMomentsUnreadInfo,
  getMomentsWorld,
  getUserMoments,
  markMomentsFeedViewed,
  toggleMomentLike,
  unlockMoment,
} from "@/api/bwchat";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { Avatar } from "@/components/Avatar";
import { SystemSegmentedTabs } from "@/components/SystemSegmentedTabs";
import {
  MediaViewer,
  MomentRow,
  type MediaSelection,
  type MomentCommentTarget,
} from "@/components/profile/PublicProfileContent";
import {
  MomentCommentComposer,
  type PreparedMomentCommentImage,
} from "@/components/moments/MomentCommentComposer";
import { TopToast } from "@/components/TopToast";
import { env } from "@/config/env";
import type { Moment, MomentFeedPage, MomentFeedTab } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { usePropInventory } from "@/providers/PropInventoryProvider";
import { useWallet } from "@/providers/WalletProvider";
import { normalizePropConsumption } from "@/services/props/PropInventoryModels";
import {
  isMomentFeedCacheFresh,
  isPendingMomentUpload,
  mergeMomentFeed,
  momentMutationTabs,
  readCachedMomentFeed,
  saveCachedMomentFeed,
  shouldAcceptMomentFeedFirstPage,
  upsertMomentInFeed,
} from "@/services/moments/MomentFeedRepository";
import { runAfterNavigationInteractions } from "@/services/navigation/NavigationWorkScheduler";
import {
  readNavigationSnapshot,
  writeNavigationSnapshot,
} from "@/services/navigation/NavigationSnapshotCache";
import {
  publishMomentMutation,
  subscribeMomentMutation,
} from "@/services/moments/MomentMutationStore";
import { markMomentsNotificationsReadEverywhere } from "@/services/moments/MomentsReadService";
import {
  captureMomentsUnreadRefresh,
  clearMomentsNew,
  clearMomentsUnread,
  publishMomentsUnread,
  useMomentsUnread,
} from "@/services/moments/MomentsUnreadStore";
import {
  cancelMomentUpload,
  momentUploadStatus,
  reconcileMomentUploads,
  resumeMomentUploads,
  retryMomentUpload,
  subscribeMomentUploads,
  type MomentUploadStatus,
} from "@/services/moments/MomentUploadQueue";
import {
  readCachedProfileMomentsSnapshot,
  saveCachedProfileMoments,
} from "@/services/profile/PublicProfileContentRepository";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

interface FeedState {
  moments: Moment[];
  hasMore: boolean;
  hasResolved: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  error: string | null;
  isShowingCachedData: boolean;
}

interface ActiveComment {
  momentId: number;
  target: MomentCommentTarget;
}

interface MomentsNavigationSnapshot {
  selectedTab: MomentFeedTab;
  feeds: Record<MomentFeedTab, FeedState>;
}

const emptyFeed = (): FeedState => ({
  moments: [],
  hasMore: true,
  hasResolved: false,
  isLoading: false,
  isLoadingMore: false,
  isRefreshing: false,
  error: null,
  isShowingCachedData: false,
});

const settledFeedSnapshot = (state: FeedState): FeedState => ({
  ...state,
  hasResolved: state.hasResolved ?? true,
  isLoading: false,
  isLoadingMore: false,
  isRefreshing: false,
  error: null,
});

const restoredFeedSnapshot = (state: FeedState): FeedState => {
  const restored = settledFeedSnapshot(state);
  return { ...restored, isLoading: !restored.hasResolved };
};

export default function MomentsScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  return (
    <MomentsAccountScreen
      isMyMoments={params.mode === "mine"}
      key={`${ownerId || "signed-out"}|${params.mode ?? "feed"}`}
      ownerId={ownerId}
      viewerAvatarUrl={user?.avatar_url ?? ""}
      viewerNickname={user?.nickname ?? ""}
    />
  );
}

function MomentsAccountScreen({
  ownerId,
  isMyMoments,
  viewerNickname,
  viewerAvatarUrl,
}: {
  ownerId: string;
  isMyMoments: boolean;
  viewerNickname: string;
  viewerAvatarUrl: string;
}) {
  const { t } = useLocalization();
  const { applyMediaConsumption } = usePropInventory();
  const { applyBalance, refreshBalance } = useWallet();
  const activeRef = useRef(true);
  const snapshotVariant = isMyMoments ? "mine" : "feed";
  const [navigationSnapshot] = useState(() =>
    readNavigationSnapshot<MomentsNavigationSnapshot>("moments", ownerId, snapshotVariant),
  );
  const [selectedTab, setSelectedTab] = useState<MomentFeedTab>(
    navigationSnapshot?.selectedTab ?? "recommended",
  );
  const [feeds, setFeedsState] = useState<Record<MomentFeedTab, FeedState>>(() =>
    navigationSnapshot
      ? {
          recommended: restoredFeedSnapshot(navigationSnapshot.feeds.recommended),
          following: restoredFeedSnapshot(navigationSnapshot.feeds.following),
        }
      : {
          recommended: emptyFeed(),
          following: emptyFeed(),
        },
  );
  const feedsRef = useRef(feeds);
  const busyRef = useRef<Record<MomentFeedTab, boolean>>({
    recommended: false,
    following: false,
  });
  const loadedRef = useRef<Record<MomentFeedTab, boolean>>({
    recommended: false,
    following: false,
  });
  const unreadCount = useMomentsUnread(ownerId);
  const [activeComment, setActiveComment] = useState<ActiveComment | null>(null);
  const [mediaSelection, setMediaSelection] = useState<MediaSelection | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [uploadStatuses, setUploadStatuses] = useState<Record<string, MomentUploadStatus>>({});
  const unlockKeysRef = useRef(new Map<string, string>());
  const didBeginScrollingRef = useRef(false);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    writeNavigationSnapshot<MomentsNavigationSnapshot>(
      "moments",
      ownerId,
      {
        selectedTab,
        feeds: {
          recommended: settledFeedSnapshot(feeds.recommended),
          following: settledFeedSnapshot(feeds.following),
        },
      },
      snapshotVariant,
    );
  }, [feeds, ownerId, selectedTab, snapshotVariant]);

  const setFeeds = useCallback(
    (update: (current: Record<MomentFeedTab, FeedState>) => Record<MomentFeedTab, FeedState>) => {
      setFeedsState((current) => {
        const next = update(current);
        feedsRef.current = next;
        return next;
      });
    },
    [],
  );

  const updateTab = useCallback(
    (tab: MomentFeedTab, update: (current: FeedState) => FeedState) => {
      setFeeds((current) => ({ ...current, [tab]: update(current[tab]) }));
    },
    [setFeeds],
  );

  const persistTab = useCallback(
    async (tab: MomentFeedTab, state: FeedState) => {
      if (!ownerId) return;
      if (isMyMoments) {
        await saveCachedProfileMoments(ownerId, ownerId, {
          moments: state.moments,
          has_more: state.hasMore,
        });
        return;
      }
      await saveCachedMomentFeed(ownerId, tab, {
        moments: state.moments,
        has_more: state.hasMore,
      });
    },
    [isMyMoments, ownerId],
  );

  const loadFeed = useCallback(
    async (tab: MomentFeedTab, reset: boolean, forceRefresh = false) => {
      if (!ownerId || busyRef.current[tab]) return;
      const current = feedsRef.current[tab];
      if (!reset && !current.hasMore) return;
      if (reset && !forceRefresh && loadedRef.current[tab]) return;
      busyRef.current[tab] = true;
      updateTab(tab, (state) => ({
        ...state,
        error: null,
        isLoading: reset && !forceRefresh && !state.hasResolved,
        isRefreshing: reset && forceRefresh,
        isLoadingMore: !reset,
      }));
      try {
        if (reset && !forceRefresh && !loadedRef.current[tab]) {
          const profileSnapshot = isMyMoments
            ? await readCachedProfileMomentsSnapshot(ownerId, ownerId)
            : null;
          const feedSnapshot = isMyMoments ? null : await readCachedMomentFeed(ownerId, tab);
          const cached = profileSnapshot?.page ?? feedSnapshot;
          const cacheIsFresh = profileSnapshot
            ? !profileSnapshot.isStale
            : feedSnapshot
              ? isMomentFeedCacheFresh(feedSnapshot)
              : false;
          if (!activeRef.current) return;
          if (cached) {
            updateTab(tab, (state) => ({
              ...state,
              ...(state.moments.length === 0
                ? { moments: cached.moments, hasMore: cached.has_more }
                : {}),
              hasResolved: true,
              isLoading: false,
              isShowingCachedData: false,
            }));
          }
          loadedRef.current[tab] = true;
          if (cacheIsFresh) return;
        }
        const stateBeforeRequest = feedsRef.current[tab];
        const beforeId = reset ? undefined : stateBeforeRequest.moments.at(-1)?.id;
        const page = await fetchPage(tab, beforeId, isMyMoments ? ownerId : undefined);
        if (
          reset &&
          !shouldAcceptMomentFeedFirstPage(
            page,
            stateBeforeRequest.moments.filter((item) => !isPendingMomentUpload(item)).length,
          )
        ) {
          throw new Error("朋友圈列表响应不完整");
        }
        const reconciledTempMomentIds = await reconcileMomentUploads(ownerId, page.moments);
        const nextMoments = mergeMomentFeed(
          reset
            ? stateBeforeRequest.moments.filter(
                (item) => isPendingMomentUpload(item) && !reconciledTempMomentIds.has(item.id),
              )
            : stateBeforeRequest.moments,
          page.moments,
        );
        const nextState: FeedState = {
          ...feedsRef.current[tab],
          moments: nextMoments,
          hasMore: page.has_more,
          hasResolved: true,
          error: null,
          isShowingCachedData: false,
          isLoading: false,
          isRefreshing: false,
          isLoadingMore: false,
        };
        if (!activeRef.current) {
          await persistTab(tab, nextState);
          return;
        }
        loadedRef.current[tab] = true;
        updateTab(tab, () => nextState);
        await persistTab(tab, nextState);
      } catch (error) {
        if (!activeRef.current) return;
        const hasItems = feedsRef.current[tab].moments.length > 0;
        updateTab(tab, (state) => ({
          ...state,
          error: hasItems ? null : errorMessage(error),
          hasResolved: true,
          isShowingCachedData: hasItems,
        }));
      } finally {
        busyRef.current[tab] = false;
        if (!activeRef.current) return;
        updateTab(tab, (state) => ({
          ...state,
          isLoading: false,
          isRefreshing: false,
          isLoadingMore: false,
        }));
      }
    },
    [isMyMoments, ownerId, persistTab, updateTab],
  );

  useEffect(() => {
    didBeginScrollingRef.current = false;
    return runAfterNavigationInteractions(() => void loadFeed(selectedTab, true));
  }, [loadFeed, selectedTab]);

  useEffect(() => {
    if (!ownerId || isMyMoments) return;
    let active = true;
    clearMomentsNew(ownerId);
    const momentsRefresh = captureMomentsUnreadRefresh(ownerId);
    const cancel = runAfterNavigationInteractions(() => {
      void getMomentsUnreadInfo()
        .then((info) => {
          if (active) {
            publishMomentsUnread(ownerId, info.unread_count, momentsRefresh);
          }
        })
        .catch(() => undefined);
      void markMomentsFeedViewed().catch(() => undefined);
    });
    return () => {
      active = false;
      cancel();
    };
  }, [isMyMoments, ownerId]);

  useEffect(
    () =>
      subscribeMomentMutation(ownerId, (mutation) => {
        const affectedTabs = momentMutationTabs(isMyMoments, mutation);
        setFeeds((current) => {
          const next = { ...current };
          for (const tab of affectedTabs) {
            const state = current[tab];
            const moments =
              mutation.kind === "delete"
                ? state.moments.filter((item) => item.id !== mutation.momentId)
                : upsertMomentInFeed(state.moments, mutation.moment, mutation.kind === "created");
            next[tab] = moments === state.moments ? state : { ...state, moments };
          }
          void Promise.all(
            affectedTabs.map((tab) => persistTab(tab, next[tab]).catch(() => undefined)),
          );
          return next;
        });
      }),
    [isMyMoments, ownerId, persistTab, setFeeds],
  );

  useEffect(() => {
    if (!ownerId) return;
    const unsubscribe = subscribeMomentUploads(ownerId, (status) => {
      setUploadStatuses((current) => ({
        ...current,
        [status.clientRequestId]: status,
      }));
    });
    const cancelResume = runAfterNavigationInteractions(() => void resumeMomentUploads(ownerId));
    return () => {
      cancelResume();
      unsubscribe();
    };
  }, [ownerId]);

  const mutateMomentEverywhere = useCallback(
    async (moment: Moment) => {
      if (!activeRef.current) return;
      setFeeds((current) => {
        const next = { ...current };
        for (const tab of ["recommended", "following"] as const) {
          next[tab] = {
            ...current[tab],
            moments: upsertMomentInFeed(current[tab].moments, moment),
          };
        }
        return next;
      });
      publishMomentMutation(ownerId, { kind: "upsert", moment });
      await Promise.all(
        (["recommended", "following"] as const).map((tab) =>
          persistTab(tab, feedsRef.current[tab]),
        ),
      );
    },
    [ownerId, persistTab, setFeeds],
  );

  const handleLike = async (moment: Moment) => {
    if (isPendingMomentUpload(moment)) return;
    try {
      const liked = await toggleMomentLike(moment.id);
      if (!activeRef.current) return;
      const likes = moment.likes.filter((item) => item.user_id !== ownerId);
      if (liked) {
        likes.push({
          user_id: ownerId,
          nickname: viewerNickname,
          avatar_url: viewerAvatarUrl,
        });
      }
      await mutateMomentEverywhere({ ...moment, liked_by_me: liked, likes });
    } catch (error) {
      if (activeRef.current) setToastMessage(errorMessage(error));
    }
  };

  const handleComment = async (
    text: string,
    target: MomentCommentTarget,
    image: PreparedMomentCommentImage | null,
  ) => {
    const momentId = activeComment?.momentId;
    if (!momentId) return;
    try {
      const comment = await addMomentComment(momentId, text, {
        ...(target.replyToUserId ? { replyToUserId: target.replyToUserId } : {}),
        ...(image ? { image } : {}),
      });
      if (!activeRef.current) return;
      const current = findMoment(feedsRef.current, momentId);
      if (current) {
        await mutateMomentEverywhere({
          ...current,
          comments: [...current.comments, comment],
        });
      }
    } catch (error) {
      if (activeRef.current) setToastMessage(errorMessage(error));
    }
  };

  const handleDelete = async (momentId: number) => {
    const pending = findMoment(feedsRef.current, momentId);
    if (pending && isPendingMomentUpload(pending) && pending.client_request_id) {
      await cancelMomentUpload(pending.client_request_id);
      return;
    }
    try {
      await deleteMoment(momentId);
      if (!activeRef.current) return;
      setFeeds((current) => ({
        recommended: {
          ...current.recommended,
          moments: current.recommended.moments.filter((item) => item.id !== momentId),
        },
        following: {
          ...current.following,
          moments: current.following.moments.filter((item) => item.id !== momentId),
        },
      }));
      publishMomentMutation(ownerId, { kind: "delete", momentId });
    } catch (error) {
      if (activeRef.current) setToastMessage(errorMessage(error));
    }
  };

  const handleUnlock = async (moment: Moment) => {
    if (moment.is_unlocked) return;
    const mediaType = moment.media[0]?.type === "video" ? "video" : "image";
    const scope = `${moment.id}|auto:${
      mediaType === "video" ? "media_unlock_card_video" : "media_unlock_card_image"
    }`;
    const key = unlockKeysRef.current.get(scope) ?? createIdempotencyKey();
    unlockKeysRef.current.set(scope, key);
    try {
      const result = await unlockMoment(moment.id, mediaType, key);
      if (!activeRef.current) return;
      unlockKeysRef.current.delete(scope);
      const unlockedMoment = result.moment ?? (await getMomentDetail(moment.id));
      if (!activeRef.current) return;
      await mutateMomentEverywhere(unlockedMoment);
      if (!activeRef.current) return;
      if (result.charge) {
        await applyBalance(result.charge.wallet_balance);
      } else if (!result.already_unlocked && !result.consumed_prop) {
        await refreshBalance(true);
      }
      if (!result.already_unlocked && result.consumed_prop) {
        applyMediaConsumption(normalizePropConsumption(result.consumed_prop), mediaType);
      }
    } catch (error) {
      if (activeRef.current) setToastMessage(errorMessage(error));
    }
  };

  const openNotifications = useCallback(() => {
    clearMomentsUnread(ownerId);
    void markMomentsNotificationsReadEverywhere().catch(() => undefined);
    router.push("/moments-notifications");
  }, [ownerId]);

  const current = feeds[selectedTab];
  const header = useMemo(
    () => (
      <>
        <MomentsCoverHeader avatarUrl={viewerAvatarUrl} nickname={viewerNickname} />
        {!isMyMoments && unreadCount > 0 ? (
          <NotificationBanner count={unreadCount} onPress={openNotifications} />
        ) : null}
        {current.isShowingCachedData ? (
          <Text style={styles.cachedNotice}>{t("offline.cachedNotice")}</Text>
        ) : null}
      </>
    ),
    [
      current.isShowingCachedData,
      isMyMoments,
      openNotifications,
      t,
      unreadCount,
      viewerAvatarUrl,
      viewerNickname,
    ],
  );

  const headerOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      headerBackVisible: false,
      headerTransparent: true,
      headerShadowVisible: false,
      headerTintColor: colors.white,
      headerLeft: () => (
        <Pressable
          accessibilityLabel={t("common.back")}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.headerButton}
        >
          <SymbolView
            name="chevron.left"
            resizeMode="center"
            size={17}
            weight="semibold"
            tintColor={colors.white}
          />
        </Pressable>
      ),
      headerTitle: () =>
        isMyMoments ? (
          <Text style={styles.myMomentsTitle}>{t("profile.moments")}</Text>
        ) : (
          <FeedSegmentedControl
            onChange={(tab) => {
              setActiveComment(null);
              setSelectedTab(tab);
            }}
            selected={selectedTab}
          />
        ),
      headerRight: () => (
        <Pressable
          accessibilityLabel={t("moment.create.title")}
          onPress={() => router.push("/create-moment")}
          style={styles.headerButton}
        >
          <SymbolView name="camera.fill" resizeMode="center" size={16} tintColor={colors.white} />
        </Pressable>
      ),
    }),
    [isMyMoments, selectedTab, t],
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
      style={styles.screen}
    >
      <StatusBar style="light" />
      <Stack.Screen options={headerOptions} />
      <FlatList
        contentContainerStyle={[styles.listContent, activeComment && styles.listWithComposer]}
        contentInsetAdjustmentBehavior="never"
        data={current.moments}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        keyboardDismissMode="interactive"
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={
          <FeedEmptyState
            error={current.error}
            isLoading={current.isLoading}
            onRetry={() => void loadFeed(selectedTab, true, true)}
          />
        }
        ListFooterComponent={null}
        ListHeaderComponent={header}
        onEndReached={() => {
          if (didBeginScrollingRef.current) void loadFeed(selectedTab, false);
        }}
        onEndReachedThreshold={0.2}
        onScrollBeginDrag={() => {
          didBeginScrollingRef.current = true;
        }}
        refreshControl={
          <RefreshControl
            refreshing={current.isRefreshing}
            onRefresh={() => void loadFeed(selectedTab, true, true)}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => {
          const isPending = isPendingMomentUpload(item);
          const requestId = isPending ? item.client_request_id : undefined;
          const uploadStatus = requestId
            ? (uploadStatuses[requestId] ?? momentUploadStatus(ownerId, requestId))
            : undefined;
          const canRetry = uploadStatus?.state === "failed";
          return (
            <View>
              <MomentRow
                moment={item}
                onComment={(target) => {
                  if (!isPending) setActiveComment({ momentId: item.id, target });
                }}
                onDelete={() => void handleDelete(item.id)}
                onLike={() => void handleLike(item)}
                onMedia={setMediaSelection}
                onUnlock={() => {
                  if (!isPending) void handleUnlock(item);
                }}
                viewerId={ownerId}
              />
              {requestId ? (
                canRetry ? (
                  <Pressable
                    onPress={() => void retryMomentUpload(requestId)}
                    style={styles.uploadStatus}
                  >
                    <SymbolView
                      name="exclamationmark.circle.fill"
                      size={12}
                      tintColor={colors.danger}
                    />
                    <Text style={styles.uploadRetryText}>{t("common.retry")}</Text>
                  </Pressable>
                ) : (
                  <View style={styles.uploadStatus}>
                    <ActivityIndicator color={colors.secondaryText} size="small" />
                    <Text style={styles.uploadPendingText}>{t("common.uploading")}</Text>
                  </View>
                )
              ) : null}
            </View>
          );
        }}
        showsVerticalScrollIndicator={false}
      />

      {activeComment ? (
        <MomentCommentComposer
          key={`${activeComment.momentId}|${activeComment.target.replyToUserId ?? "root"}`}
          onClose={() => setActiveComment(null)}
          onError={setToastMessage}
          onSubmit={handleComment}
          target={activeComment.target}
        />
      ) : null}
      <MediaViewer onClose={() => setMediaSelection(null)} selection={mediaSelection} />
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </KeyboardAvoidingView>
  );
}

async function fetchPage(
  tab: MomentFeedTab,
  beforeId?: number,
  filterUserId?: string,
): Promise<MomentFeedPage> {
  const options = { limit: 20, ...(beforeId !== undefined ? { beforeId } : {}) };
  if (filterUserId) return getUserMoments(filterUserId, options);
  return tab === "recommended" ? getMomentsWorld(options) : getMomentsFollowing(options);
}

function findMoment(feeds: Record<MomentFeedTab, FeedState>, momentId: number): Moment | undefined {
  return (
    feeds.recommended.moments.find((item) => item.id === momentId) ??
    feeds.following.moments.find((item) => item.id === momentId)
  );
}

function FeedSegmentedControl({
  selected,
  onChange,
}: {
  selected: MomentFeedTab;
  onChange: (tab: MomentFeedTab) => void;
}) {
  const { t } = useLocalization();
  return (
    <SystemSegmentedTabs
      accessibilityIdentifier="moments.top.tabs"
      backgroundColor="rgba(0,0,0,0.16)"
      colorScheme="dark"
      fontWeight="bold"
      items={[
        { value: "recommended", title: t("moments.tab.recommended") },
        { value: "following", title: t("moments.tab.following") },
      ]}
      onSelectionChange={onChange}
      selection={selected}
    />
  );
}

function MomentsCoverHeader({ avatarUrl, nickname }: { avatarUrl: string; nickname: string }) {
  const resolved = resolveMediaUrl(avatarUrl, env.apiBaseUrl);
  return (
    <View style={styles.coverBlock}>
      <View style={styles.coverBackdrop}>
        <LinearGradient
          colors={["#5667EA", "#7A58D6", "#25294D"]}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {resolved ? (
          <AuthenticatedImage
            blurRadius={22}
            contentFit="cover"
            loadingFallback={<View />}
            style={styles.coverImage}
            transition={0}
            uri={resolved}
          />
        ) : null}
        <LinearGradient
          colors={["rgba(86,103,234,0.42)", "rgba(122,88,214,0.24)", "rgba(0,0,0,0.50)"]}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.38)"]}
          style={styles.coverBottomShade}
        />
        <View pointerEvents="none" style={styles.coverTopHighlight} />
      </View>
      <View style={styles.coverIdentity}>
        <Text numberOfLines={1} style={styles.coverName}>
          {nickname}
        </Text>
        <View style={styles.coverAvatarFrame}>
          {resolved ? (
            <AuthenticatedImage
              contentFit="cover"
              errorFallback={<Avatar cornerRadius={16} name={nickname} size={76} />}
              loadingFallback={<Avatar cornerRadius={16} name={nickname} size={76} />}
              style={styles.coverAvatar}
              transition={0}
              uri={resolved}
            />
          ) : (
            <Avatar cornerRadius={16} name={nickname} size={76} />
          )}
          <View pointerEvents="none" style={styles.coverAvatarStroke} />
        </View>
      </View>
    </View>
  );
}

function NotificationBanner({ count, onPress }: { count: number; onPress: () => void }) {
  const { t } = useLocalization();
  return (
    <Pressable onPress={onPress} style={styles.notificationBanner}>
      <View>
        <SymbolView name="heart.circle.fill" size={32} tintColor="#576B95" />
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      </View>
      <Text style={styles.notificationText}>{t("moments.newMessages.count", count)}</Text>
      <View style={styles.bannerSpacer} />
      <SymbolView
        name="chevron.right"
        size={12}
        weight="semibold"
        tintColor={colors.tertiaryText}
      />
    </Pressable>
  );
}

function FeedEmptyState({
  isLoading,
  error,
  onRetry,
}: {
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { t } = useLocalization();
  if (isLoading) {
    return <View style={styles.emptyState} />;
  }
  return (
    <View style={styles.emptyState}>
      <SymbolView
        name={error ? "exclamationmark.triangle" : "photo.on.rectangle.angled"}
        size={error ? 34 : 36}
        tintColor={error ? colors.warning : colors.tertiaryText}
      />
      <Text style={styles.emptyText}>{error ?? t("moments.empty")}</Text>
      {error ? (
        <Pressable onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>{t("common.retry")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "操作失败，请稍后重试";
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.card },
  listContent: { paddingBottom: 18, backgroundColor: colors.card },
  listWithComposer: { paddingBottom: 146 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  uploadStatus: {
    marginLeft: 68,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 4,
  },
  uploadPendingText: { color: colors.secondaryText, fontSize: 12, fontWeight: "500" },
  uploadRetryText: { color: colors.danger, fontSize: 12, fontWeight: "500" },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  myMomentsTitle: { color: colors.white, fontSize: 17, fontWeight: "600" },
  coverBlock: {
    height: 270,
    overflow: "visible",
    backgroundColor: colors.card,
  },
  coverBackdrop: { height: 270, overflow: "hidden", backgroundColor: "#5667EA" },
  coverImage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.58,
    transform: [{ scale: 1.08 }],
  },
  coverBottomShade: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    height: 118,
  },
  coverTopHighlight: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  coverIdentity: {
    position: "absolute",
    right: 18,
    bottom: 14,
    left: 18,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    columnGap: 12,
  },
  coverName: {
    maxWidth: "60%",
    marginBottom: 43,
    color: colors.white,
    fontSize: 18,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowRadius: 6,
    textShadowOffset: { width: 0, height: 2 },
  },
  coverAvatarFrame: {
    width: 76,
    height: 76,
  },
  coverAvatar: { width: 76, height: 76, borderRadius: 16 },
  coverAvatarStroke: {
    position: "absolute",
    top: -1.5,
    right: -1.5,
    bottom: -1.5,
    left: -1.5,
    borderWidth: 3,
    borderRadius: 17.5,
    borderColor: colors.white,
  },
  notificationBanner: {
    minHeight: 52,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
    backgroundColor: "rgba(87,107,149,0.08)",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -6,
    minWidth: 16,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: colors.danger,
  },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: "700" },
  notificationText: { color: "#576B95", fontSize: 14, fontWeight: "500" },
  bannerSpacer: { flex: 1 },
  cachedNotice: {
    marginHorizontal: 16,
    marginBottom: 8,
    color: colors.secondaryText,
    fontSize: 12,
    textAlign: "center",
  },
  emptyState: {
    minHeight: 180,
    paddingHorizontal: 28,
    paddingTop: 60,
    alignItems: "center",
    rowGap: 14,
  },
  emptyText: {
    color: colors.secondaryText,
    fontSize: 15,
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  retryText: { color: colors.white, fontSize: 14, fontWeight: "600" },
});
