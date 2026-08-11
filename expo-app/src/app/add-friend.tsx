import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { followUser, searchUsers, unfollowUser } from "@/api/bwchat";
import { UserAvatarButton } from "@/components/Avatar";
import { TopToast } from "@/components/TopToast";
import type { FollowRelationship, FollowUser, SearchUser } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  acquireAddFriendOperation,
  addFriendPolicy,
  applyRelationshipToSearchUsers,
  normalizedAddFriendQuery,
  optimisticSearchUserFollow,
  reconcileSearchUsersWithKnownFollowing,
  releaseAddFriendOperation,
  shouldFollowSearchUser,
} from "@/services/friends/AddFriendPolicy";
import { loadCurrentFollowingForSearch } from "@/services/friends/AddFriendFollowingResolver";
import { readCachedFollowListSnapshot } from "@/services/friends/FollowListRepository";
import {
  followUserFromSearch,
  publishFollowRelationship,
  subscribeFollowRelationship,
} from "@/services/friends/FollowRelationshipStore";
import { colors } from "@/theme";

export default function AddFriendScreen() {
  const { t } = useLocalization();
  const { user: currentUser } = useAuth();
  const ownerId = currentUser?.user_id ?? "";
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [isSearching, setSearching] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const searchGenerationRef = useRef(0);
  const accountGenerationRef = useRef(0);
  const updatingIdsRef = useRef<Set<string>>(new Set());
  const currentFollowingLoadRef = useRef<Promise<FollowUser[]> | null>(null);
  const dismissToast = useCallback(() => setToastMessage(null), []);
  const applyRelationship = useCallback((relationship: FollowRelationship) => {
    setResults((current) => applyRelationshipToSearchUsers(current, relationship));
  }, []);

  useEffect(() => {
    accountGenerationRef.current += 1;
    const accountGeneration = accountGenerationRef.current;
    searchGenerationRef.current += 1;
    updatingIdsRef.current.clear();
    currentFollowingLoadRef.current = null;
    void Promise.resolve().then(() => {
      if (accountGeneration !== accountGenerationRef.current) return;
      setSearchText("");
      setResults([]);
      setSearching(false);
      setUpdatingIds(new Set());
      setToastMessage(null);
    });
    return () => {
      if (accountGeneration === accountGenerationRef.current) {
        accountGenerationRef.current += 1;
      }
    };
  }, [ownerId]);

  useEffect(() => {
    const keyword = normalizedAddFriendQuery(searchText);
    if (!ownerId || !keyword) return;
    const accountGeneration = accountGenerationRef.current;
    const searchGeneration = searchGenerationRef.current;
    let active = true;
    const timer = setTimeout(() => {
      if (
        !active ||
        accountGeneration !== accountGenerationRef.current ||
        searchGeneration !== searchGenerationRef.current
      )
        return;
      setSearching(true);
      void Promise.all([
        searchUsers(keyword),
        loadVerifiedCurrentFollowing(currentFollowingLoadRef).catch(() => []),
      ])
        .then(([users, currentFollowing]) =>
          reconcileSearchResultsWithKnownFollowing(ownerId, users, currentFollowing),
        )
        .then((users) => {
          if (
            active &&
            accountGeneration === accountGenerationRef.current &&
            searchGeneration === searchGenerationRef.current
          )
            setResults(users);
        })
        .catch(() => {
          if (
            active &&
            accountGeneration === accountGenerationRef.current &&
            searchGeneration === searchGenerationRef.current
          )
            setResults([]);
        })
        .finally(() => {
          if (
            active &&
            accountGeneration === accountGenerationRef.current &&
            searchGeneration === searchGenerationRef.current
          )
            setSearching(false);
        });
    }, addFriendPolicy.searchDebounceMilliseconds);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ownerId, searchText]);

  useEffect(
    () =>
      subscribeFollowRelationship(ownerId, ({ relationship }) => {
        currentFollowingLoadRef.current = null;
        applyRelationship(relationship);
      }),
    [applyRelationship, ownerId],
  );

  const changeSearchText = (text: string) => {
    searchGenerationRef.current += 1;
    setSearchText(text);
    setSearching(false);
    if (!normalizedAddFriendQuery(text)) {
      setResults([]);
    }
  };

  const openProfile = (user: SearchUser) => {
    router.push({
      pathname: "/user-profile",
      params: { id: user.user_id },
    });
  };

  const openMessage = (user: SearchUser) => {
    router.dismiss();
    setTimeout(() => {
      router.push({
        pathname: "/chat/[id]",
        params: { id: user.user_id, name: user.nickname, avatar: user.avatar_url },
      });
    }, addFriendPolicy.messageNavigationDelayMilliseconds);
  };

  const toggleFollow = async (user: SearchUser) => {
    if (!ownerId) return;
    if (!acquireAddFriendOperation(updatingIdsRef.current, user.user_id)) return;
    const accountGeneration = accountGenerationRef.current;
    const shouldFollow = shouldFollowSearchUser(user);
    const optimistic = optimisticSearchUserFollow(user);
    setUpdatingIds((current) => new Set(current).add(user.user_id));
    updateResult(user.user_id, {
      followed_by_me: optimistic.followed_by_me,
      follow_requested: optimistic.follow_requested,
    });
    try {
      const relationship = shouldFollow
        ? await followUser(user.user_id)
        : await unfollowUser(user.user_id);
      if (accountGeneration !== accountGenerationRef.current) return;
      applyRelationship(relationship);
      publishFollowRelationship(
        {
          relationship,
          user: followUserFromSearch({
            ...optimistic,
            followed_by_me: relationship.followed_by_me,
            follow_requested: relationship.follow_requested ?? false,
          }),
        },
        ownerId,
      );
    } catch (error) {
      if (accountGeneration !== accountGenerationRef.current) return;
      updateResult(user.user_id, {
        followed_by_me: user.followed_by_me,
        follow_requested: user.follow_requested,
      });
      setToastMessage(
        error instanceof Error && error.message ? error.message : t("common.operationFailed"),
      );
    } finally {
      releaseAddFriendOperation(updatingIdsRef.current, user.user_id);
      if (accountGeneration !== accountGenerationRef.current) return;
      setUpdatingIds((current) => {
        const next = new Set(current);
        next.delete(user.user_id);
        return next;
      });
    }
  };

  const updateResult = (
    userId: string,
    change: Pick<SearchUser, "followed_by_me" | "follow_requested">,
  ) => {
    setResults((current) =>
      current.map((item) => (item.user_id === userId ? { ...item, ...change } : item)),
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: t("addFriend.title"),
          headerLeft: () => (
            <Pressable
              accessibilityLabel={t("common.cancel")}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => router.back()}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelText}>{t("common.cancel")}</Text>
            </Pressable>
          ),
        }}
      />

      <View style={styles.searchBar}>
        <SymbolView name="magnifyingglass" size={16} tintColor={colors.secondaryText} />
        <TextInput
          accessibilityLabel={t("addFriend.search.placeholder")}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={changeSearchText}
          placeholder={t("addFriend.search.placeholder")}
          placeholderTextColor={colors.secondaryText}
          returnKeyType="search"
          style={styles.searchInput}
          value={searchText}
        />
        {searchText.length > 0 ? (
          <Pressable
            accessibilityLabel={t("common.clear")}
            accessibilityRole="button"
            hitSlop={2}
            onPress={() => changeSearchText("")}
            style={styles.clearButton}
          >
            <SymbolView name="xmark.circle.fill" size={18} tintColor={colors.tertiaryText} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.resultsArea}>
        {isSearching ? (
          <ActivityIndicator color={colors.accent} testID="add-friend-search-loading" />
        ) : results.length === 0 ? (
          <SearchState
            icon={searchText.length > 0 ? "person.slash" : "magnifyingglass"}
            title={searchText.length > 0 ? t("addFriend.noResults") : t("addFriend.searchHint")}
          />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.rows}>
              {results.map((user) => (
                <View key={user.user_id}>
                  <SearchUserRow
                    isUpdating={updatingIds.has(user.user_id)}
                    user={user}
                    onMessage={() => openMessage(user)}
                    onOpenProfile={() => openProfile(user)}
                    onToggleFollow={() => void toggleFollow(user)}
                  />
                  <View style={styles.divider} />
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </View>

      <TopToast message={toastMessage} onDismiss={dismissToast} />
    </View>
  );
}

async function reconcileSearchResultsWithKnownFollowing(
  ownerId: string,
  users: readonly SearchUser[],
  currentFollowing: readonly FollowUser[],
): Promise<SearchUser[]> {
  const snapshots = await Promise.all([
    readCachedFollowListSnapshot(ownerId, ownerId, "following"),
    readCachedFollowListSnapshot(ownerId, ownerId, "followers"),
  ]);
  const knownUsers = snapshots.flatMap((snapshot) =>
    snapshot && !snapshot.isStale ? snapshot.page.users : [],
  );
  return reconcileSearchUsersWithKnownFollowing(users, [...currentFollowing, ...knownUsers]);
}

function loadVerifiedCurrentFollowing(loadRef: {
  current: Promise<FollowUser[]> | null;
}): Promise<FollowUser[]> {
  if (loadRef.current) return loadRef.current;
  const load = loadCurrentFollowingForSearch().catch((error: unknown) => {
    if (loadRef.current === load) loadRef.current = null;
    throw error;
  });
  loadRef.current = load;
  return load;
}

function SearchState({ icon, title }: { icon: "magnifyingglass" | "person.slash"; title: string }) {
  return (
    <View style={styles.state}>
      <SymbolView name={icon} size={36} tintColor={colors.tertiaryText} />
      <Text style={styles.stateText}>{title}</Text>
    </View>
  );
}

function SearchUserRow({
  user,
  isUpdating,
  onOpenProfile,
  onToggleFollow,
  onMessage,
}: {
  user: SearchUser;
  isUpdating: boolean;
  onOpenProfile: () => void;
  onToggleFollow: () => void;
  onMessage: () => void;
}) {
  const { t } = useLocalization();
  const isFollowing = user.followed_by_me || user.follow_requested;
  const followTitle = user.followed_by_me
    ? t("follow.followingButton")
    : user.follow_requested
      ? t("follow.requestedButton")
      : t("follow.followButton");
  return (
    <View style={styles.userRow}>
      <UserAvatarButton
        accessibilityName={user.nickname}
        avatarUrl={user.avatar_url}
        size={44}
        userId={user.user_id}
      />
      <Pressable
        accessibilityLabel={user.nickname}
        accessibilityRole="button"
        onPress={onOpenProfile}
        style={styles.nameButton}
      >
        <Text numberOfLines={1} style={styles.userName}>
          {user.nickname}
        </Text>
      </Pressable>
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={followTitle}
          accessibilityRole="button"
          accessibilityState={{ busy: isUpdating, disabled: isUpdating }}
          disabled={isUpdating}
          onPress={onToggleFollow}
          style={[
            styles.capsuleButton,
            { backgroundColor: isFollowing ? colors.separator : colors.accent },
          ]}
        >
          {isUpdating ? (
            <ActivityIndicator color={isFollowing ? colors.text : colors.white} size="small" />
          ) : (
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              numberOfLines={1}
              style={[styles.capsuleText, { color: isFollowing ? colors.text : colors.white }]}
            >
              {followTitle}
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityLabel={t("profile.message")}
          accessibilityRole="button"
          onPress={onMessage}
          style={[styles.capsuleButton, styles.messageButton]}
        >
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            numberOfLines={1}
            style={[styles.capsuleText, styles.messageText]}
          >
            {t("profile.message")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.card },
  cancelButton: { height: 44, justifyContent: "center" },
  cancelText: { color: colors.accent, fontSize: 16 },
  searchBar: {
    minHeight: 40,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
    borderRadius: 12,
    backgroundColor: "rgba(240,240,245,0.8)",
  },
  searchInput: { flex: 1, padding: 0, color: colors.text, fontSize: 16 },
  clearButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  resultsArea: { flex: 1, alignItems: "stretch", justifyContent: "center" },
  state: { alignItems: "center", rowGap: 12 },
  stateText: { color: colors.secondaryText, fontSize: 15 },
  rows: { paddingTop: 8 },
  userRow: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  nameButton: { flex: 1, minWidth: 0 },
  userName: { color: colors.text, fontSize: 16, fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", columnGap: 6 },
  capsuleButton: {
    minWidth: 56,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  messageButton: { backgroundColor: colors.separator },
  capsuleText: { fontSize: 13, fontWeight: "600" },
  messageText: { color: colors.text },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 72, backgroundColor: colors.separator },
});
