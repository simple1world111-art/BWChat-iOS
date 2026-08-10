import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";

import {
  followUser,
  getFollowers,
  getFollowing,
  getRecommendedUsers,
  unfollowUser,
} from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import { TopToast } from "@/components/TopToast";
import type { FollowRelationship, FollowUser, FollowUsersPage } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  type FollowListKind,
  isFollowListRepositoryResetError,
  loadCachedFollowListPage,
  readCachedFollowListSnapshot,
  saveCachedFollowList,
} from "@/services/friends/FollowListRepository";
import {
  acquireFollowListOperation,
  decodeInitialRecommendedUsers,
  filterRecommendedFollowUsers,
  followListMetrics,
  followListPolicy,
  mergeFollowPageUsers,
  nextFollowListPage,
  optimisticFollowUser,
  releaseFollowListOperation,
} from "@/services/friends/FollowListPolicy";
import {
  publishFollowRelationship,
  reconcileFollowListRelationship,
  subscribeFollowRelationship,
  type FollowRelationshipEvent,
} from "@/services/friends/FollowRelationshipStore";
import { colors, palette } from "@/theme";

type ScreenKind = FollowListKind | "recommended";

export default function FollowListScreen() {
  const params = useLocalSearchParams<{
    kind?: string;
    userId?: string;
    excludeUserId?: string;
    initialUsers?: string;
  }>();
  const kind: ScreenKind =
    params.kind === "followers" || params.kind === "recommended" ? params.kind : "following";
  const { user: currentUser } = useAuth();
  const { t } = useLocalization();
  const theme = palette(useColorScheme());
  const ownerId = currentUser?.user_id ?? "";
  const subjectId = params.userId?.trim() || ownerId;
  const excludeUserId = params.excludeUserId?.trim() || undefined;
  const initialRecommendedUsers = useMemo(
    () =>
      kind === "recommended"
        ? filterRecommendedFollowUsers(
            decodeInitialRecommendedUsers(params.initialUsers),
            excludeUserId,
            ownerId,
          )
        : [],
    [excludeUserId, kind, ownerId, params.initialUsers],
  );
  const [users, setUsers] = useState<FollowUser[]>(() => initialRecommendedUsers);
  const usersRef = useRef<FollowUser[]>(initialRecommendedUsers);
  const nextPageRef = useRef<number | null>(kind === "recommended" ? null : 1);
  const loadTokenRef = useRef<symbol | null>(null);
  const didLoadRef = useRef(false);
  const generationRef = useRef(0);
  const updatingIdsRef = useRef<Set<string>>(new Set());
  const [isLoading, setLoading] = useState(initialRecommendedUsers.length === 0);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const identityKey = `${ownerId}\u0000${subjectId}\u0000${kind}\u0000${excludeUserId ?? ""}`;

  const replaceUsers = useCallback((next: FollowUser[]) => {
    usersRef.current = next;
    setUsers(next);
  }, []);

  const persist = useCallback(
    (next: readonly FollowUser[], nextPage: number | null) => {
      if (!ownerId || kind === "recommended") return;
      void saveCachedFollowList(ownerId, subjectId || "me", kind, {
        users: [...next],
        has_more: nextPage !== null,
        ...(nextPage !== null ? { next_page: nextPage } : {}),
      }).catch(() => undefined);
    },
    [kind, ownerId, subjectId],
  );

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    loadTokenRef.current = null;
    didLoadRef.current = false;
    updatingIdsRef.current.clear();
    nextPageRef.current = kind === "recommended" ? null : 1;
    void Promise.resolve().then(() => {
      if (generation !== generationRef.current) return;
      setUpdatingIds(new Set());
      const initial = kind === "recommended" ? initialRecommendedUsers : [];
      replaceUsers(initial);
      setLoading(initial.length === 0);
      setLoadingMore(false);
      setRefreshing(false);
      setToastMessage(null);
    });
    return () => {
      generationRef.current += 1;
    };
  }, [identityKey, initialRecommendedUsers, kind, replaceUsers]);

  const applyEvent = useCallback(
    (event: FollowRelationshipEvent) => {
      const next = reconcileFollowListRelationship(usersRef.current, event, {
        kind,
        ownerId,
        subjectId,
      });
      if (next !== usersRef.current) {
        replaceUsers(next);
        persist(next, nextPageRef.current);
      }
    },
    [kind, ownerId, persist, replaceUsers, subjectId],
  );

  useEffect(() => subscribeFollowRelationship(ownerId, applyEvent), [applyEvent, ownerId]);

  const load = useCallback(
    async (reset: boolean, refresh = false, generation = generationRef.current) => {
      if (!ownerId || generation !== generationRef.current || loadTokenRef.current) return;
      const loadToken = Symbol("follow-list-load");
      loadTokenRef.current = loadToken;
      const page = reset ? 1 : nextPageRef.current;
      if (kind !== "recommended" && page === null) {
        if (loadTokenRef.current === loadToken) loadTokenRef.current = null;
        return;
      }
      if (refresh) setRefreshing(true);
      else if (reset && usersRef.current.length === 0) setLoading(true);
      else if (!reset) setLoadingMore(true);
      setToastMessage(null);
      try {
        if (kind === "recommended") {
          const recommended = await getRecommendedUsers(
            followListPolicy.recommendedLimit,
            excludeUserId,
          );
          if (generation !== generationRef.current) return;
          const filtered = filterRecommendedFollowUsers(recommended, excludeUserId, ownerId);
          if (filtered.length > 0 || usersRef.current.length === 0) replaceUsers(filtered);
          nextPageRef.current = null;
        } else {
          if (reset && !refresh) {
            const cached = await readCachedFollowListSnapshot(ownerId, subjectId || "me", kind);
            if (generation !== generationRef.current) return;
            if (cached && usersRef.current.length === 0) {
              replaceUsers(cached.page.users);
              nextPageRef.current = cached.page.next_page ?? (cached.page.has_more ? 2 : null);
            }
          }
          const resolvedPage = page ?? 1;
          const fetchPage = () =>
            kind === "following"
              ? getFollowing({
                  ...(params.userId ? { userId: params.userId } : {}),
                  page: resolvedPage,
                  limit: followListPolicy.pageSize,
                })
              : getFollowers({
                  ...(params.userId ? { userId: params.userId } : {}),
                  page: resolvedPage,
                  limit: followListPolicy.pageSize,
                });
          const result: FollowUsersPage =
            resolvedPage === 1
              ? await loadCachedFollowListPage(ownerId, subjectId || "me", kind, refresh, fetchPage)
              : await fetchPage();
          if (generation !== generationRef.current) return;
          const next =
            resolvedPage === 1
              ? result.users
              : mergeFollowPageUsers(usersRef.current, result.users);
          const nextPage = nextFollowListPage(result, resolvedPage);
          nextPageRef.current = nextPage;
          replaceUsers(next);
          persist(next, nextPage);
        }
      } catch (error) {
        if (isFollowListRepositoryResetError(error)) return;
        if (generation === generationRef.current && usersRef.current.length === 0) {
          setToastMessage(
            error instanceof Error && error.message ? error.message : t("common.operationFailed"),
          );
        }
      } finally {
        if (generation === generationRef.current && loadTokenRef.current === loadToken) {
          loadTokenRef.current = null;
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [excludeUserId, kind, ownerId, params.userId, persist, replaceUsers, subjectId, t],
  );

  useFocusEffect(
    useCallback(() => {
      if (didLoadRef.current || !ownerId) return;
      didLoadRef.current = true;
      void load(true);
    }, [load, ownerId]),
  );

  const toggleFollow = async (target: FollowUser) => {
    if (!acquireFollowListOperation(updatingIdsRef.current, target.user_id)) return;
    const generation = generationRef.current;
    const previous = usersRef.current.find((item) => item.user_id === target.user_id) ?? target;
    const optimistic = optimisticFollowUser(previous);
    const targetState = optimistic.followed_by_me;
    replaceUsers(
      usersRef.current.map((item) => (item.user_id === target.user_id ? optimistic : item)),
    );
    setUpdatingIds((current) => new Set(current).add(target.user_id));
    try {
      const relationship: FollowRelationship = targetState
        ? await followUser(target.user_id)
        : await unfollowUser(target.user_id);
      if (generation !== generationRef.current) return;
      publishFollowRelationship({ relationship, user: optimistic }, ownerId);
    } catch (error) {
      if (generation === generationRef.current) {
        replaceUsers(
          usersRef.current.map((item) => (item.user_id === target.user_id ? previous : item)),
        );
        setToastMessage(
          error instanceof Error && error.message ? error.message : t("common.operationFailed"),
        );
      }
    } finally {
      releaseFollowListOperation(updatingIdsRef.current, target.user_id);
      if (generation === generationRef.current) {
        setUpdatingIds((current) => {
          const next = new Set(current);
          next.delete(target.user_id);
          return next;
        });
      }
    }
  };

  const title =
    kind === "recommended"
      ? t("profile.suggestions.title")
      : t(kind === "following" ? "follow.following" : "follow.followers");
  const emptyTitle =
    kind === "recommended"
      ? t("profile.suggestions.unavailable")
      : t(kind === "following" ? "follow.following.empty" : "follow.followers.empty");

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title,
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerTitleAlign: "center",
        }}
      />
      <FlatList
        contentContainerStyle={[styles.content, users.length === 0 && styles.emptyContent]}
        data={users}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyExtractor={(item) => item.user_id}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.accent} style={styles.loadingTop} />
          ) : (
            <View style={styles.emptyState}>
              <SymbolView
                name="person.2"
                size={followListMetrics.emptyIconSize}
                weight="semibold"
                tintColor={theme.tertiaryText}
              />
              <Text style={[styles.emptyText, { color: theme.secondaryText }]}>{emptyTitle}</Text>
            </View>
          )
        }
        ListFooterComponent={
          isLoadingMore ? (
            <ActivityIndicator color={colors.accent} style={styles.loadingMore} />
          ) : null
        }
        onEndReached={() => {
          if (kind !== "recommended" && nextPageRef.current !== null) void load(false);
        }}
        onEndReachedThreshold={0.25}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void load(true, true)}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <FollowRow
            isUpdating={updatingIds.has(item.user_id)}
            onOpen={() => router.push({ pathname: "/user-profile", params: { id: item.user_id } })}
            onToggle={() => void toggleFollow(item)}
            showsFollowButton={item.user_id !== ownerId}
            user={item}
          />
        )}
        showsVerticalScrollIndicator={false}
        testID="follow-list"
      />
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </View>
  );
}

function FollowRow({
  isUpdating,
  onOpen,
  onToggle,
  showsFollowButton,
  user,
}: {
  isUpdating: boolean;
  onOpen: () => void;
  onToggle: () => void;
  showsFollowButton: boolean;
  user: FollowUser;
}) {
  const { t } = useLocalization();
  const theme = palette(useColorScheme());
  return (
    <View style={[styles.row, { backgroundColor: theme.card }, isUpdating && styles.updating]}>
      <Pressable
        accessibilityRole="button"
        disabled={isUpdating}
        onPress={onOpen}
        style={styles.identityButton}
      >
        <Avatar name={user.nickname} size={followListMetrics.avatarSize} uri={user.avatar_url} />
        <View style={styles.identityCopy}>
          <Text numberOfLines={1} style={[styles.name, { color: theme.text }]}>
            {user.nickname}
          </Text>
          <Text numberOfLines={1} style={[styles.bio, { color: theme.secondaryText }]}>
            {user.bio.trim() || `#${user.user_id}`}
          </Text>
        </View>
      </Pressable>
      {showsFollowButton ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isUpdating, selected: user.followed_by_me }}
          disabled={isUpdating}
          onPress={onToggle}
          style={[
            styles.followButton,
            user.followed_by_me ? styles.followingButton : styles.followButtonActive,
          ]}
          testID={`follow-list-toggle-${user.user_id}`}
        >
          <Text
            style={[
              styles.followText,
              user.followed_by_me ? styles.followingText : styles.followTextActive,
            ]}
          >
            {t(user.followed_by_me ? "follow.followingButton" : "follow.followButton")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: followListMetrics.contentHorizontalInset,
    paddingTop: followListMetrics.contentTopInset,
    paddingBottom: followListMetrics.contentBottomInset,
  },
  emptyContent: { flexGrow: 1 },
  separator: { height: followListMetrics.rowGap },
  row: {
    minHeight: followListMetrics.rowMinimumHeight,
    padding: followListMetrics.rowPadding,
    borderRadius: followListMetrics.rowRadius,
    flexDirection: "row",
    alignItems: "center",
    columnGap: followListMetrics.rowHorizontalGap,
  },
  identityButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    columnGap: followListMetrics.identityGap,
  },
  identityCopy: { flex: 1, minWidth: 0, rowGap: followListMetrics.copyGap },
  name: { fontSize: followListMetrics.nameSize, fontWeight: "600" },
  bio: { fontSize: followListMetrics.bioSize },
  followButton: {
    height: followListMetrics.followButtonHeight,
    paddingHorizontal: followListMetrics.followButtonHorizontalInset,
    borderRadius: followListMetrics.followButtonRadius,
    alignItems: "center",
    justifyContent: "center",
  },
  followButtonActive: { backgroundColor: colors.accent },
  followingButton: { backgroundColor: "rgba(102,126,234,0.12)" },
  followText: { fontSize: followListMetrics.followButtonTitleSize, fontWeight: "700" },
  followTextActive: { color: colors.white },
  followingText: { color: colors.accent },
  updating: { opacity: 0.62 },
  loadingTop: { marginTop: followListMetrics.initialStateTopInset },
  loadingMore: { marginVertical: followListMetrics.loadingMoreVerticalInset },
  emptyState: {
    marginTop: followListMetrics.initialStateTopInset,
    alignItems: "center",
    rowGap: followListMetrics.emptyGap,
  },
  emptyText: { fontSize: followListMetrics.emptyTitleSize, fontWeight: "600" },
});
