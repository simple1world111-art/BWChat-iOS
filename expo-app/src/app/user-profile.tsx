import * as Clipboard from "expo-clipboard";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  followUser,
  getFollowers,
  getFollowing,
  getPublicProfile,
  getRecommendedUsers,
  unfollowUser,
} from "@/api/bwchat";
import { normalizePublicProfile } from "@/api/normalizers";
import { Avatar } from "@/components/Avatar";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import {
  PublicProfileContent,
  type PublicProfileContentHandle,
  type PublicProfileContentTab,
} from "@/components/profile/PublicProfileContent";
import { TopToast } from "@/components/TopToast";
import { env } from "@/config/env";
import type {
  AgentSummary,
  FollowUser,
  PublicProfile,
  ShortDramaSeries,
  ShortDramaVideo,
  User,
} from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  applyRelationshipToFollowUser,
  publishFollowRelationship,
  subscribeFollowRelationship,
} from "@/services/friends/FollowRelationshipStore";
import {
  readCachedPublicProfileSnapshot,
  saveCachedPublicProfile,
} from "@/services/profile/PublicProfileRepository";
import {
  readNavigationSnapshot,
  writeNavigationSnapshot,
} from "@/services/navigation/NavigationSnapshotCache";
import {
  optimisticPublicProfileFollow,
  reconcilePublicProfileRelationship,
} from "@/services/profile/PublicProfileRelationship";
import { resolveAgentConversation } from "@/services/agents/AgentConversationResolver";
import {
  filterUserProfileSuggestions,
  profileDeepLink,
  profileWebsiteDisplay,
  profileWebsiteURL,
  userProfileMetrics,
  UserProfileGenerationBusySet,
  UserProfileRequestScope,
  userProfileIdentity,
} from "@/services/profile/UserProfilePolicy";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

type ProfileTab = PublicProfileContentTab;
type MoreAction = "share" | "copyLink" | "about" | "qrCode" | "report" | "restrict" | "block";

interface UserProfileNavigationSnapshot {
  profile: PublicProfile;
  suggestions: FollowUser[];
  selectedTab: ProfileTab;
  loadedMomentCount: number;
}

export default function UserProfileScreen() {
  const params = useLocalSearchParams<{ id?: string; name?: string; avatar?: string }>();
  const targetId = params.id?.trim() ?? "";
  const { user: currentUser } = useAuth();
  const ownerId = currentUser?.user_id ?? "";
  return (
    <UserProfileAccountScreen
      currentUser={currentUser}
      initialAvatarUrl={params.avatar?.trim() ?? ""}
      initialName={params.name?.trim() ?? ""}
      key={userProfileIdentity(ownerId, targetId)}
      ownerId={ownerId}
      targetId={targetId}
    />
  );
}

function UserProfileAccountScreen({
  currentUser,
  initialAvatarUrl,
  initialName,
  ownerId,
  targetId,
}: {
  currentUser: User | null;
  initialAvatarUrl: string;
  initialName: string;
  ownerId: string;
  targetId: string;
}) {
  const { t } = useLocalization();
  const [navigationSnapshot] = useState(() =>
    readNavigationSnapshot<UserProfileNavigationSnapshot>("user-profile", ownerId, targetId),
  );
  const [initialProfile] = useState(
    () =>
      navigationSnapshot?.profile ??
      routeProfilePreview(
        targetId,
        targetId === ownerId ? currentUser?.nickname || initialName : initialName,
        targetId === ownerId ? currentUser?.avatar_url || initialAvatarUrl : initialAvatarUrl,
      ),
  );
  const [scrollViewportHeight, setScrollViewportHeight] = useState(0);
  const [profile, setProfileState] = useState<PublicProfile | null>(initialProfile);
  const profileRef = useRef<PublicProfile | null>(initialProfile);
  const [suggestions, setSuggestions] = useState<FollowUser[]>(
    navigationSnapshot?.suggestions ?? [],
  );
  const [isLoadingSuggestions, setLoadingSuggestions] = useState(false);
  const [isLoading, setLoading] = useState(Boolean(ownerId && targetId && !initialProfile));
  const [isRefreshing, setRefreshing] = useState(false);
  const [isUpdatingFollow, setUpdatingFollow] = useState(false);
  const [updatingSuggestionIds, setUpdatingSuggestionIds] = useState<Set<string>>(() => new Set());
  const updatingSuggestionIdsRef = useRef<Set<string>>(new Set());
  const profileFollowBusyRef = useRef(new UserProfileGenerationBusySet());
  const [selectedTab, setSelectedTab] = useState<ProfileTab>(
    navigationSnapshot?.selectedTab ?? "moments",
  );
  const [showsMore, setShowsMore] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loadedMomentCount, setLoadedMomentCount] = useState(
    navigationSnapshot?.loadedMomentCount ?? 0,
  );
  const didLoadRef = useRef(false);
  const contentRef = useRef<PublicProfileContentHandle>(null);
  const [requestScope] = useState(() => {
    const scope = new UserProfileRequestScope();
    scope.reset(ownerId, targetId);
    return scope;
  });

  const setProfile = useCallback(
    (next: PublicProfile | null) => {
      profileRef.current = next;
      setProfileState(next);
    },
    [setProfileState],
  );

  const load = useCallback(
    async (refresh = false) => {
      if (!ownerId || !targetId) {
        setLoading(false);
        return;
      }
      const scope = requestScope;
      const ticket = scope.current();
      if (!refresh && !profileRef.current) setLoading(true);
      const cachedSnapshot = refresh
        ? null
        : await readCachedPublicProfileSnapshot(ownerId, targetId).catch(() => null);
      if (!scope.isCurrent(ticket)) return;
      const cached = cachedSnapshot?.isRetained ? cachedSnapshot.profile : null;
      if (cached) setProfile(cached);
      const shouldFetchProfile = refresh || !cachedSnapshot || cachedSnapshot.isStale;
      if (targetId !== ownerId) setLoadingSuggestions(true);
      // Start these together, then publish each branch independently just like
      // the native async-let tasks. Slow recommendations must not hold the
      // profile loader or error state open.
      const profilePromise = shouldFetchProfile
        ? getPublicProfile(targetId)
        : Promise.resolve(cachedSnapshot.profile);
      const suggestionsPromise =
        targetId === ownerId
          ? Promise.resolve([])
          : (async () => {
              const databaseUsers = await getRecommendedUsers(18, targetId).catch(() => []);
              if (!scope.isCurrent(ticket) || databaseUsers.length > 0) return databaseUsers;
              const pages = await Promise.all([
                getFollowing({ userId: targetId, page: 1, limit: 18 }).catch(() => null),
                getFollowers({ userId: targetId, page: 1, limit: 18 }).catch(() => null),
                getFollowing({ page: 1, limit: 18 }).catch(() => null),
                getFollowers({ page: 1, limit: 18 }).catch(() => null),
              ]);
              if (!scope.isCurrent(ticket)) return [];
              const mutualFollowers =
                profileRef.current?.mutual_followers ?? cached?.mutual_followers ?? [];
              return [...mutualFollowers, ...pages.flatMap((page) => page?.users ?? [])];
            })();
      const profileResultPromise = Promise.allSettled([profilePromise]);
      const suggestionsResultPromise = Promise.allSettled([suggestionsPromise]);
      const [profileResult] = await profileResultPromise;
      if (!scope.isCurrent(ticket)) return;
      if (profileResult.status === "fulfilled") {
        setProfile(profileResult.value);
        if (shouldFetchProfile) {
          await saveCachedPublicProfile(ownerId, profileResult.value, targetId).catch(
            () => undefined,
          );
          if (!scope.isCurrent(ticket)) return;
        }
      } else if (!profileRef.current && !cached) {
        setToastMessage(
          profileResult.reason instanceof Error
            ? profileResult.reason.message
            : t("profile.public.missing"),
        );
      }
      setLoading(false);
      const [suggestionsResult] = await suggestionsResultPromise;
      if (!scope.isCurrent(ticket)) return;
      if (targetId !== ownerId) {
        const candidates = suggestionsResult.status === "fulfilled" ? suggestionsResult.value : [];
        setSuggestions(filterUserProfileSuggestions(candidates, ownerId, targetId));
      }
      setLoadingSuggestions(false);
    },
    [
      ownerId,
      requestScope,
      setLoading,
      setLoadingSuggestions,
      setProfile,
      setSuggestions,
      setToastMessage,
      t,
      targetId,
    ],
  );

  useEffect(() => () => requestScope.invalidate(), [requestScope]);

  useEffect(() => {
    if (!ownerId || !targetId || !profile) return;
    writeNavigationSnapshot<UserProfileNavigationSnapshot>(
      "user-profile",
      ownerId,
      { profile, suggestions, selectedTab, loadedMomentCount },
      targetId,
    );
  }, [loadedMomentCount, ownerId, profile, selectedTab, suggestions, targetId]);

  useFocusEffect(
    useCallback(() => {
      if (didLoadRef.current || !ownerId || !targetId) return;
      didLoadRef.current = true;
      void load();
    }, [load, ownerId, targetId]),
  );

  const refresh = useCallback(async () => {
    if (!ownerId || !targetId) return;
    const scope = requestScope;
    const ticket = scope.current();
    setRefreshing(true);
    await Promise.all([load(true), contentRef.current?.refresh() ?? Promise.resolve()]);
    if (scope.isCurrent(ticket)) setRefreshing(false);
  }, [load, ownerId, requestScope, setRefreshing, targetId]);

  useEffect(
    () =>
      subscribeFollowRelationship(ownerId, ({ relationship }) => {
        if (relationship.user_id === targetId && profileRef.current) {
          const next = reconcilePublicProfileRelationship(profileRef.current, relationship);
          setProfile(next);
          if (ownerId) {
            void saveCachedPublicProfile(ownerId, next, targetId).catch(() => undefined);
          }
        }
        setSuggestions((current) =>
          current.map((item) => applyRelationshipToFollowUser(item, relationship)),
        );
      }),
    [ownerId, setProfile, targetId],
  );

  const toggleProfileFollow = async () => {
    const current = profileRef.current;
    if (!current || isUpdatingFollow || targetId === ownerId || !targetId) return;
    const scope = requestScope;
    const ticket = scope.current();
    if (!profileFollowBusyRef.current.tryEnter(ticket.generation)) return;
    const { profile: optimistic, shouldSendFollow } = optimisticPublicProfileFollow(current);
    setProfile(optimistic);
    setUpdatingFollow(true);
    try {
      const relationship = shouldSendFollow
        ? await followUser(targetId)
        : await unfollowUser(targetId);
      if (!scope.isCurrent(ticket)) return;
      const reconciled = reconcilePublicProfileRelationship(optimistic, relationship);
      setProfile(reconciled);
      void saveCachedPublicProfile(ownerId, reconciled, targetId).catch(() => undefined);
      publishFollowRelationship({ relationship, user: profileAsFollowUser(reconciled) }, ownerId);
    } catch (error) {
      if (!scope.isCurrent(ticket)) return;
      setProfile(current);
      setToastMessage(
        error instanceof Error && error.message ? error.message : t("common.operationFailed"),
      );
    } finally {
      profileFollowBusyRef.current.leave(ticket.generation);
      if (scope.isCurrent(ticket)) setUpdatingFollow(false);
    }
  };

  const toggleSuggestion = useCallback(
    async (target: FollowUser) => {
      if (updatingSuggestionIdsRef.current.has(target.user_id)) return;
      const scope = requestScope;
      const ticket = scope.current();
      const previous = target;
      const targetState = !target.followed_by_me;
      const optimistic = {
        ...target,
        followed_by_me: targetState,
        follower_count: Math.max(0, target.follower_count + (targetState ? 1 : -1)),
      };
      setSuggestions((current) =>
        current.map((item) => (item.user_id === target.user_id ? optimistic : item)),
      );
      const updating = new Set(updatingSuggestionIdsRef.current).add(target.user_id);
      updatingSuggestionIdsRef.current = updating;
      setUpdatingSuggestionIds(updating);
      try {
        const relationship = targetState
          ? await followUser(target.user_id)
          : await unfollowUser(target.user_id);
        if (!scope.isCurrent(ticket)) return;
        publishFollowRelationship({ relationship, user: optimistic }, ownerId);
      } catch (error) {
        if (!scope.isCurrent(ticket)) return;
        setSuggestions((current) =>
          current.map((item) => (item.user_id === target.user_id ? previous : item)),
        );
        setToastMessage(
          error instanceof Error && error.message ? error.message : t("common.operationFailed"),
        );
      } finally {
        if (!scope.isCurrent(ticket)) return;
        setUpdatingSuggestionIds((current) => {
          const next = new Set(current);
          next.delete(target.user_id);
          updatingSuggestionIdsRef.current = next;
          return next;
        });
      }
    },
    [ownerId, requestScope, t],
  );

  const handleMoreAction = async (action: MoreAction) => {
    if (!profile) return;
    setShowsMore(false);
    const scope = requestScope;
    const ticket = scope.current();
    const link = profileDeepLink(profile);
    try {
      if (action === "share") {
        await Share.share({ url: link, message: link });
      } else if (action === "copyLink") {
        await Clipboard.setStringAsync(link);
        if (scope.isCurrent(ticket)) setToastMessage(t("profile.more.linkCopied"));
      } else if (action === "about") {
        setToastMessage(
          profile.account_created_at
            ? t("profile.more.about.created", profile.account_created_at)
            : t("profile.more.about.unavailable"),
        );
      } else {
        setToastMessage(t("profile.more.unavailable"));
      }
    } catch {
      if (scope.isCurrent(ticket)) setToastMessage(t("common.operationFailed"));
    }
  };

  const openDirectMessage = () => {
    if (!profile) return;
    const directUserId = profile.user_id.trim();
    if (!directUserId) {
      setToastMessage(t("profile.message.unavailable"));
      return;
    }
    router.push({
      pathname: "/chat/[id]",
      params: {
        id: directUserId,
        name: profile.nickname,
        avatar: profile.avatar_url,
      },
    });
  };

  const isMe = targetId === ownerId;
  const viewer = useMemo(
    () => ({
      user_id: ownerId,
      nickname: currentUser?.nickname ?? "",
      avatar_url: currentUser?.avatar_url ?? "",
    }),
    [currentUser?.avatar_url, currentUser?.nickname, ownerId],
  );
  const openAgent = useCallback(
    async (agent: AgentSummary) => {
      const conversation = await resolveAgentConversation(agent, ownerId);
      const avatarId =
        conversation.agent_profile.avatar_asset_id ||
        agent.avatar_asset_id ||
        agent.profile?.avatar_asset_id ||
        "";
      router.push({
        pathname: "/agent-chat",
        params: {
          conversationId: conversation.id,
          agentId: conversation.agent_id || agent.id,
          name: conversation.agent_profile.name || agent.profile?.name || "智能体",
          avatarId,
        },
      });
    },
    [ownerId],
  );
  const openShortDrama = useCallback(
    (series: ShortDramaSeries, episode?: ShortDramaVideo) =>
      router.push({
        pathname: "/short-drama-player",
        params: {
          seriesId: series.series_id,
          ...(episode?.id || series.resume_episode_id
            ? { episodeId: episode?.id || series.resume_episode_id }
            : {}),
          initialPosition: String(episode ? 0 : series.resume_position_seconds),
        },
      }),
    [],
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: "",
          headerBackVisible: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          headerLeft: () => (
            <Pressable
              accessibilityLabel={t("common.back")}
              accessibilityRole="button"
              hitSlop={4}
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <SymbolView
                name="chevron.left"
                size={userProfileMetrics.navigation.symbol}
                weight="semibold"
                tintColor={colors.text}
              />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              accessibilityLabel={t("profile.more")}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setShowsMore(true)}
            >
              <SymbolView
                name="ellipsis"
                size={userProfileMetrics.navigation.symbol}
                weight="semibold"
                tintColor={colors.text}
              />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        onLayout={({ nativeEvent }) => setScrollViewportHeight(nativeEvent.layout.height)}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
          />
        }
        onScroll={({ nativeEvent }) => {
          if (
            !profile ||
            (selectedTab === "moments" && profile.is_private && !profile.can_view_moments)
          ) {
            return;
          }
          const distanceFromBottom =
            nativeEvent.contentSize.height -
            nativeEvent.layoutMeasurement.height -
            nativeEvent.contentOffset.y;
          if (distanceFromBottom < 240) contentRef.current?.loadMore();
        }}
        scrollEventThrottle={120}
        showsVerticalScrollIndicator={false}
      >
        {isLoading && !profile ? (
          <View accessibilityLabel={t("common.loading")} style={styles.profileLoading} />
        ) : profile ? (
          <>
            <ProfileHeader fallbackPostsCount={loadedMomentCount} profile={profile} />
            {!isMe ? (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isUpdatingFollow }}
                  disabled={isUpdatingFollow}
                  onPress={() => void toggleProfileFollow()}
                  style={[
                    styles.profileAction,
                    profile.followed_by_me || profile.follow_requested
                      ? styles.secondaryAction
                      : styles.primaryAction,
                    isUpdatingFollow && styles.updating,
                  ]}
                >
                  <Text
                    style={[
                      styles.profileActionText,
                      profile.followed_by_me || profile.follow_requested
                        ? styles.secondaryActionText
                        : styles.primaryActionText,
                    ]}
                  >
                    {t(
                      profile.followed_by_me
                        ? "follow.followingButton"
                        : profile.follow_requested
                          ? "follow.requestedButton"
                          : "follow.followButton",
                    )}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={openDirectMessage}
                  style={[styles.profileAction, styles.secondaryAction]}
                >
                  <Text style={[styles.profileActionText, styles.secondaryActionText]}>
                    {t("profile.message")}
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {!isMe && (!isLoadingSuggestions || suggestions.length > 0) ? (
              <Suggestions
                excludeUserId={profile.user_id}
                onToggle={toggleSuggestion}
                suggestions={suggestions}
                updatingIds={updatingSuggestionIds}
              />
            ) : null}
            {profile.highlights.length > 0 ? (
              <ScrollView
                horizontal
                contentContainerStyle={styles.highlights}
                showsHorizontalScrollIndicator={false}
              >
                {profile.highlights
                  .slice(0, userProfileMetrics.highlights.maximumCount)
                  .map((highlight, index) => (
                    <Pressable
                      accessibilityRole="button"
                      key={`${highlight.id}:${index}`}
                      onPress={() => setToastMessage(t("profile.highlights.unavailable"))}
                      style={styles.highlight}
                    >
                      <View style={styles.highlightCover}>
                        {resolveMediaUrl(highlight.cover_url, env.apiBaseUrl) ? (
                          <AuthenticatedImage
                            uri={resolveMediaUrl(highlight.cover_url, env.apiBaseUrl)!}
                            sourceCacheKey={`${resolveMediaUrl(highlight.cover_url, env.apiBaseUrl)}?profile-highlight=1`}
                            contentFit="cover"
                            loadingFallback={<View style={styles.highlightImageFallback} />}
                            errorFallback={
                              <View style={styles.highlightImageFallback}>
                                <SymbolView
                                  name="star.fill"
                                  size={20}
                                  tintColor={colors.secondaryText}
                                />
                              </View>
                            }
                            transition={0}
                            style={styles.highlightImage}
                          />
                        ) : (
                          <SymbolView name="star.fill" size={20} tintColor={colors.secondaryText} />
                        )}
                      </View>
                      <Text numberOfLines={1} style={styles.highlightTitle}>
                        {highlight.title || t("profile.highlights.default")}
                      </Text>
                    </Pressable>
                  ))}
              </ScrollView>
            ) : null}
            <ProfileTabs selected={selectedTab} onSelect={setSelectedTab} />
            {selectedTab === "moments" && profile.is_private && !profile.can_view_moments ? (
              <View
                style={[
                  styles.privateState,
                  scrollViewportHeight > 0 ? { minHeight: scrollViewportHeight } : undefined,
                ]}
              >
                <SymbolView
                  name="lock.fill"
                  size={userProfileMetrics.states.privateIcon}
                  weight="semibold"
                  tintColor={colors.text}
                />
                <Text style={styles.privateTitle}>{t("profile.private.title")}</Text>
                <Text style={styles.privateSubtitle}>{t("profile.private.subtitle")}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.missingState}>
            <SymbolView
              name="person.crop.circle.badge.exclamationmark"
              size={userProfileMetrics.states.missingIcon}
              weight="semibold"
              tintColor={colors.tertiaryText}
            />
            <Text style={styles.emptyText}>{t("profile.public.missing")}</Text>
          </View>
        )}
        <View
          style={
            profile &&
            !(selectedTab === "moments" && profile.is_private && !profile.can_view_moments)
              ? scrollViewportHeight > 0
                ? { minHeight: scrollViewportHeight }
                : undefined
              : undefined
          }
        >
          <PublicProfileContent
            isVisible={
              Boolean(profile) &&
              !(selectedTab === "moments" && profile?.is_private && !profile.can_view_moments)
            }
            key={`${ownerId}:${targetId}`}
            onOpenAgent={openAgent}
            onOpenShortDrama={openShortDrama}
            onMomentCountChange={setLoadedMomentCount}
            onToast={setToastMessage}
            ownerId={ownerId}
            ref={contentRef}
            tab={selectedTab}
            targetId={targetId}
            viewer={viewer}
          />
        </View>
      </ScrollView>
      <MoreActions
        visible={showsMore && Boolean(profile)}
        onClose={() => setShowsMore(false)}
        onSelect={(action) => void handleMoreAction(action)}
      />
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </View>
  );
}

const ProfileHeader = memo(function ProfileHeader({
  profile,
  fallbackPostsCount,
}: {
  profile: PublicProfile;
  fallbackPostsCount: number;
}) {
  const { t } = useLocalization();
  const relation = relationshipText(profile, t);
  const metadata = [profile.location, genderText(profile.gender, t)]
    .filter((value) => value.trim().length > 0)
    .join(" / ");
  const website = profile.website_url?.trim() ? profileWebsiteDisplay(profile.website_url) : "";
  return (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <View style={styles.avatarFrame}>
          <Avatar
            cornerRadius={userProfileMetrics.header.avatarRadius}
            name={profile.nickname}
            size={userProfileMetrics.header.avatar}
            uri={profile.avatar_url}
          />
          <View
            pointerEvents="none"
            style={[
              styles.avatarBorder,
              profile.highlights.length > 0 && styles.avatarBorderHighlighted,
            ]}
          />
        </View>
        <View style={styles.headerIdentity}>
          <View style={styles.nameLine}>
            <Text
              adjustsFontSizeToFit
              minimumFontScale={userProfileMetrics.header.nameMinimumScale}
              numberOfLines={1}
              style={styles.profileName}
            >
              {profile.nickname}
            </Text>
            {profile.is_verified ? (
              <SymbolView
                accessibilityLabel={t("profile.verified")}
                name="checkmark.seal.fill"
                size={userProfileMetrics.header.verified}
                weight="semibold"
                tintColor="#1DA1F2"
              />
            ) : null}
            {relation ? (
              <View style={styles.relationshipBadge}>
                <Text style={styles.relationshipText}>{relation}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.stats}>
            <Stat
              value={profile.posts_count ?? profile.moments_count ?? fallbackPostsCount}
              title={t("profile.posts")}
            />
            <Stat
              value={profile.follower_count}
              title={t("follow.followers")}
              onPress={() =>
                router.push({
                  pathname: "/follow-list",
                  params: { kind: "followers", userId: profile.user_id },
                })
              }
            />
            <Stat
              value={profile.following_count}
              title={t("follow.following")}
              onPress={() =>
                router.push({
                  pathname: "/follow-list",
                  params: { kind: "following", userId: profile.user_id },
                })
              }
            />
          </View>
        </View>
      </View>
      <View style={styles.details}>
        {profile.pronouns.trim() ? (
          <Text numberOfLines={1} style={styles.pronouns}>
            {profile.pronouns}
          </Text>
        ) : null}
        {profile.category.trim() ? (
          <Text numberOfLines={1} style={styles.category}>
            {profile.category}
          </Text>
        ) : null}
        {profile.bio.trim() ? <Text style={styles.profileBio}>{profile.bio}</Text> : null}
        {metadata ? (
          <Text numberOfLines={2} style={styles.metadata}>
            {metadata}
          </Text>
        ) : null}
        <MutualFollowers profile={profile} />
        {website ? (
          <Pressable
            accessibilityLabel={t("profile.website")}
            accessibilityRole="link"
            onPress={() => {
              const url = profileWebsiteURL(profile.website_url);
              if (url) void Linking.openURL(url).catch(() => undefined);
            }}
            style={styles.websiteRow}
          >
            <SymbolView name="link" size={userProfileMetrics.header.website} tintColor="#385898" />
            <Text numberOfLines={1} style={styles.website}>
              {website}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

function Stat({
  value,
  title,
  onPress,
}: {
  value: number;
  title: string;
  onPress?: (() => void) | undefined;
}) {
  const content = (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{formatCount(value)}</Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={userProfileMetrics.header.statTitleMinimumScale}
        numberOfLines={1}
        style={styles.statTitle}
      >
        {title}
      </Text>
    </View>
  );
  return onPress ? (
    <Pressable
      accessibilityLabel={`${title} ${formatCount(value)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.statButton}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.statButton}>{content}</View>
  );
}

function MutualFollowers({ profile }: { profile: PublicProfile }) {
  const { t } = useLocalization();
  if (profile.mutual_followers.length > 0) {
    return (
      <Text numberOfLines={1} style={styles.mutual}>
        {t(
          "profile.mutualFollowers.preview",
          profile.mutual_followers
            .slice(0, 2)
            .map((item) => item.nickname)
            .join(", "),
        )}
      </Text>
    );
  }
  return profile.mutual_followers_count && profile.mutual_followers_count > 0 ? (
    <Text numberOfLines={1} style={styles.mutual}>
      {t("profile.mutualFollowers.count", formatCount(profile.mutual_followers_count))}
    </Text>
  ) : null;
}

const Suggestions = memo(function Suggestions({
  excludeUserId,
  suggestions,
  updatingIds,
  onToggle,
}: {
  excludeUserId: string;
  suggestions: FollowUser[];
  updatingIds: ReadonlySet<string>;
  onToggle: (user: FollowUser) => void;
}) {
  const { t } = useLocalization();
  return (
    <View style={styles.suggestionsSection}>
      <View style={styles.suggestionsHeader}>
        <Text style={styles.suggestionsTitle}>{t("profile.suggestions.title")}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/follow-list",
              params: {
                kind: "recommended",
                excludeUserId,
                initialUsers: JSON.stringify(suggestions),
              },
            })
          }
        >
          <Text style={styles.showAll}>{t("profile.suggestions.showAll")}</Text>
        </Pressable>
      </View>
      {suggestions.length === 0 ? (
        <Text style={styles.suggestionsEmpty}>{t("profile.suggestions.unavailable")}</Text>
      ) : (
        <ScrollView
          horizontal
          contentContainerStyle={styles.suggestions}
          showsHorizontalScrollIndicator={false}
        >
          {suggestions.map((item) => (
            <View
              key={item.user_id}
              style={[styles.suggestionCard, updatingIds.has(item.user_id) && styles.updating]}
            >
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push({ pathname: "/user-profile", params: { id: item.user_id } })
                }
                style={styles.suggestionIdentity}
              >
                <Avatar
                  name={item.nickname}
                  size={userProfileMetrics.suggestions.avatar}
                  uri={item.avatar_url}
                />
                <View style={styles.suggestionCopy}>
                  <Text numberOfLines={1} style={styles.suggestionName}>
                    {item.nickname}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: updatingIds.has(item.user_id) }}
                disabled={updatingIds.has(item.user_id)}
                onPress={() => onToggle(item)}
                style={[
                  styles.suggestionFollow,
                  item.followed_by_me ? styles.secondaryAction : styles.primaryAction,
                ]}
              >
                <Text
                  style={[
                    styles.suggestionFollowText,
                    item.followed_by_me ? styles.secondaryActionText : styles.primaryActionText,
                  ]}
                >
                  {t(item.followed_by_me ? "follow.followingButton" : "follow.followButton")}
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
});

function ProfileTabs({
  selected,
  onSelect,
}: {
  selected: ProfileTab;
  onSelect: (tab: ProfileTab) => void;
}) {
  const { t } = useLocalization();
  const tabs: { id: ProfileTab; title: string }[] = [
    { id: "moments", title: t("moments.title") },
    { id: "agents", title: t("contacts.aiCompanions") },
    { id: "shortDramas", title: t("shortDrama.title") },
  ];
  return (
    <View>
      <View style={styles.tabs}>
        {tabs.map((tab) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: selected === tab.id }}
            key={tab.id}
            onPress={() => onSelect(tab.id)}
            style={styles.tab}
          >
            <Text
              adjustsFontSizeToFit
              minimumFontScale={userProfileMetrics.tabs.titleMinimumScale}
              numberOfLines={1}
              style={[styles.tabText, selected === tab.id && styles.tabTextSelected]}
            >
              {tab.title}
            </Text>
            <View
              style={[styles.tabUnderline, selected === tab.id && styles.tabUnderlineSelected]}
            />
          </Pressable>
        ))}
      </View>
      <View style={styles.tabsDivider} />
    </View>
  );
}

function MoreActions({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (action: MoreAction) => void;
}) {
  const insets = useSafeAreaInsets();
  const primary: MoreAction[] = ["share", "copyLink", "about", "qrCode"];
  const safety: MoreAction[] = ["report", "restrict", "block"];
  return (
    <Modal
      accessibilityViewIsModal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable onPress={onClose} style={styles.scrim}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={[styles.moreSheet, { paddingBottom: insets.bottom }]}
        >
          <View style={styles.handle} />
          <MoreSection actions={primary} onSelect={onSelect} />
          <View style={styles.moreSectionGap} />
          <MoreSection actions={safety} onSelect={onSelect} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MoreSection({
  actions,
  onSelect,
}: {
  actions: MoreAction[];
  onSelect: (action: MoreAction) => void;
}) {
  const { t } = useLocalization();
  const symbols: Record<MoreAction, SFSymbol> = {
    share: "square.and.arrow.up",
    copyLink: "link",
    about: "info.circle",
    qrCode: "qrcode",
    report: "exclamationmark.triangle",
    restrict: "hand.raised",
    block: "nosign",
  };
  return (
    <View>
      {actions.map((action, index) => (
        <View key={action}>
          <Pressable
            accessibilityRole="button"
            onPress={() => onSelect(action)}
            style={styles.moreRow}
          >
            <View style={styles.moreIcon}>
              <SymbolView
                name={symbols[action]}
                size={userProfileMetrics.more.symbol}
                weight="semibold"
                tintColor={isSafety(action) ? colors.danger : colors.text}
              />
            </View>
            <Text
              adjustsFontSizeToFit
              minimumFontScale={userProfileMetrics.more.titleMinimumScale}
              numberOfLines={1}
              style={[styles.moreTitle, isSafety(action) && styles.moreTitleDanger]}
            >
              {t(`profile.more.${action}`)}
            </Text>
          </Pressable>
          {index < actions.length - 1 ? <View style={styles.moreDivider} /> : null}
        </View>
      ))}
    </View>
  );
}

function isSafety(action: MoreAction) {
  return action === "report" || action === "restrict" || action === "block";
}

function routeProfilePreview(
  userId: string,
  nickname: string | undefined,
  avatarUrl: string | undefined,
): PublicProfile | null {
  const normalizedUserId = userId.trim();
  const normalizedNickname = nickname?.trim() ?? "";
  const normalizedAvatarUrl = avatarUrl?.trim() ?? "";
  if (!normalizedUserId || (!normalizedNickname && !normalizedAvatarUrl)) return null;
  return normalizePublicProfile({
    user_id: normalizedUserId,
    nickname: normalizedNickname || undefined,
    avatar_url: normalizedAvatarUrl,
  });
}

function profileAsFollowUser(profile: PublicProfile): FollowUser {
  return {
    user_id: profile.user_id,
    username: profile.username,
    nickname: profile.nickname,
    avatar_url: profile.avatar_url,
    bio: profile.bio,
    following_count: profile.following_count,
    follower_count: profile.follower_count,
    followed_by_me: profile.followed_by_me,
    follows_me: profile.follows_me,
    is_friend: profile.is_friend,
  };
}
function relationshipText(
  profile: PublicProfile,
  t: (key: string, ...args: (string | number)[]) => string,
) {
  if (profile.is_friend) return t("follow.relationship.friend");
  if (profile.followed_by_me && profile.follows_me) return t("follow.relationship.mutual");
  if (profile.follows_me) return t("follow.relationship.followsMe");
  return "";
}
function genderText(gender: string, t: (key: string) => string) {
  return gender === "male"
    ? t("profile.gender.male")
    : gender === "female"
      ? t("profile.gender.female")
      : gender === "other"
        ? t("profile.gender.other")
        : "";
}
function formatCount(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/u, "")}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/u, "")}K`;
  return String(value);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.card },
  content: { flexGrow: 1, paddingBottom: userProfileMetrics.content.bottomInset },
  backButton: {
    width: userProfileMetrics.navigation.button,
    height: userProfileMetrics.navigation.button,
    alignItems: "center",
    justifyContent: "center",
  },
  profileLoading: { height: userProfileMetrics.content.topStateInset },
  header: {
    paddingHorizontal: userProfileMetrics.header.horizontalInset,
    paddingTop: userProfileMetrics.header.topInset,
    paddingBottom: userProfileMetrics.header.bottomInset,
    rowGap: userProfileMetrics.header.gap,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: userProfileMetrics.header.topGap,
  },
  avatarFrame: {
    width: userProfileMetrics.header.avatar,
    height: userProfileMetrics.header.avatar,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarBorder: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: userProfileMetrics.header.avatarRadius,
    borderWidth: userProfileMetrics.header.avatarBorder,
    borderColor: colors.separator,
  },
  avatarBorderHighlighted: {
    borderWidth: userProfileMetrics.header.highlightedAvatarBorder,
    borderColor: colors.accent,
  },
  headerIdentity: {
    flex: 1,
    minWidth: 0,
    rowGap: userProfileMetrics.header.identityGap,
  },
  nameLine: {
    flexDirection: "row",
    alignItems: "baseline",
    columnGap: userProfileMetrics.header.nameGap,
  },
  profileName: {
    flexShrink: 1,
    color: colors.text,
    fontSize: userProfileMetrics.header.name,
    fontWeight: "700",
  },
  relationshipBadge: {
    paddingHorizontal: userProfileMetrics.header.relationshipHorizontalInset,
    paddingVertical: userProfileMetrics.header.relationshipVerticalInset,
    borderRadius: 10,
    backgroundColor: colors.separator,
  },
  relationshipText: {
    color: colors.text,
    fontSize: userProfileMetrics.header.relationship,
    fontWeight: "600",
  },
  stats: { flexDirection: "row" },
  statButton: { flex: 1 },
  stat: { alignItems: "flex-start", rowGap: 1 },
  statValue: {
    color: "#000000",
    fontSize: userProfileMetrics.header.statValue,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  statTitle: { color: "#000000", fontSize: userProfileMetrics.header.statTitle },
  details: { alignItems: "flex-start", rowGap: userProfileMetrics.header.detailGap },
  pronouns: {
    color: colors.secondaryText,
    fontSize: userProfileMetrics.header.pronouns,
    fontWeight: "500",
  },
  category: {
    color: colors.secondaryText,
    fontSize: userProfileMetrics.header.category,
    fontWeight: "600",
  },
  profileBio: { color: colors.text, fontSize: userProfileMetrics.header.bio },
  metadata: {
    color: colors.secondaryText,
    fontSize: userProfileMetrics.header.metadata,
    fontWeight: "500",
  },
  mutual: {
    color: colors.secondaryText,
    fontSize: userProfileMetrics.header.mutual,
    fontWeight: "500",
  },
  websiteRow: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: userProfileMetrics.header.websiteGap,
  },
  website: { color: "#385898", fontSize: userProfileMetrics.header.website, fontWeight: "600" },
  actions: {
    paddingHorizontal: userProfileMetrics.actions.horizontalInset,
    paddingBottom: userProfileMetrics.actions.bottomInset,
    flexDirection: "row",
    columnGap: userProfileMetrics.actions.gap,
  },
  profileAction: {
    flex: 1,
    height: userProfileMetrics.actions.height,
    borderRadius: userProfileMetrics.actions.radius,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryAction: { backgroundColor: colors.accent },
  secondaryAction: { backgroundColor: colors.separator },
  profileActionText: { fontSize: userProfileMetrics.actions.title, fontWeight: "700" },
  primaryActionText: { color: colors.white },
  secondaryActionText: { color: colors.text },
  updating: { opacity: 0.62 },
  suggestionsSection: {
    paddingTop: userProfileMetrics.suggestions.topInset,
    paddingBottom: userProfileMetrics.suggestions.bottomInset,
    rowGap: userProfileMetrics.suggestions.gap,
  },
  suggestionsHeader: {
    paddingHorizontal: userProfileMetrics.suggestions.horizontalInset,
    flexDirection: "row",
    alignItems: "center",
  },
  suggestionsTitle: {
    flex: 1,
    color: colors.text,
    fontSize: userProfileMetrics.suggestions.title,
    fontWeight: "700",
  },
  showAll: {
    color: colors.accent,
    fontSize: userProfileMetrics.suggestions.showAll,
    fontWeight: "600",
  },
  suggestions: {
    paddingHorizontal: userProfileMetrics.suggestions.horizontalInset,
    columnGap: userProfileMetrics.suggestions.cardsGap,
  },
  suggestionsEmpty: {
    paddingVertical: userProfileMetrics.suggestions.emptyVerticalInset,
    color: colors.secondaryText,
    fontSize: 14,
    textAlign: "center",
  },
  suggestionCard: {
    width: userProfileMetrics.suggestions.cardWidth,
    height: userProfileMetrics.suggestions.cardHeight,
    paddingHorizontal: userProfileMetrics.suggestions.cardHorizontalInset,
    paddingTop: userProfileMetrics.suggestions.cardTopInset,
    paddingBottom: userProfileMetrics.suggestions.cardBottomInset,
    borderRadius: userProfileMetrics.suggestions.cardRadius,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.card,
    rowGap: userProfileMetrics.suggestions.cardGap,
  },
  suggestionIdentity: {
    flex: 1,
    alignItems: "center",
    rowGap: userProfileMetrics.suggestions.identityGap,
  },
  suggestionCopy: {
    width: "100%",
    alignItems: "center",
    rowGap: userProfileMetrics.suggestions.copyGap,
  },
  suggestionName: {
    width: "100%",
    color: colors.text,
    fontSize: userProfileMetrics.suggestions.name,
    fontWeight: "600",
    textAlign: "center",
  },
  suggestionFollow: {
    height: userProfileMetrics.suggestions.followHeight,
    borderRadius: userProfileMetrics.suggestions.followRadius,
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionFollowText: {
    fontSize: userProfileMetrics.suggestions.followTitle,
    fontWeight: "700",
  },
  highlights: {
    paddingHorizontal: userProfileMetrics.highlights.horizontalInset,
    paddingVertical: userProfileMetrics.highlights.verticalInset,
    columnGap: userProfileMetrics.highlights.gap,
  },
  highlight: {
    width: userProfileMetrics.highlights.width,
    alignItems: "center",
    rowGap: userProfileMetrics.highlights.itemGap,
  },
  highlightCover: {
    width: userProfileMetrics.highlights.cover,
    height: userProfileMetrics.highlights.cover,
    borderRadius: userProfileMetrics.highlights.coverRadius,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.separator,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  highlightImage: {
    width: userProfileMetrics.highlights.cover,
    height: userProfileMetrics.highlights.cover,
  },
  highlightImageFallback: {
    width: userProfileMetrics.highlights.cover,
    height: userProfileMetrics.highlights.cover,
    alignItems: "center",
    justifyContent: "center",
  },
  highlightTitle: {
    width: userProfileMetrics.highlights.width,
    color: colors.text,
    fontSize: userProfileMetrics.highlights.title,
    fontWeight: "500",
    textAlign: "center",
  },
  tabs: {
    height: userProfileMetrics.tabs.rowHeight,
    flexDirection: "row",
  },
  tab: { flex: 1 },
  tabText: {
    height: userProfileMetrics.tabs.labelHeight,
    color: colors.tertiaryText,
    fontSize: userProfileMetrics.tabs.title,
    fontWeight: "600",
    textAlign: "center",
    textAlignVertical: "center",
  },
  tabTextSelected: { color: colors.text, fontWeight: "700" },
  tabUnderline: {
    height: userProfileMetrics.tabs.underlineHeight,
    backgroundColor: "transparent",
  },
  tabUnderlineSelected: { backgroundColor: colors.text },
  tabsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  tabEmpty: {
    paddingTop: userProfileMetrics.states.contentTopInset,
    alignItems: "center",
    rowGap: userProfileMetrics.states.gap,
  },
  emptyText: {
    color: colors.secondaryText,
    fontSize: userProfileMetrics.states.missingTitle,
    fontWeight: "600",
  },
  privateState: {
    paddingTop: userProfileMetrics.states.contentTopInset,
    paddingHorizontal: userProfileMetrics.states.privateHorizontalInset,
    alignItems: "center",
    rowGap: userProfileMetrics.states.gap,
  },
  privateTitle: {
    color: colors.text,
    fontSize: userProfileMetrics.states.privateTitle,
    fontWeight: "700",
  },
  privateSubtitle: {
    color: colors.secondaryText,
    fontSize: userProfileMetrics.states.privateSubtitle,
    textAlign: "center",
  },
  missingState: {
    marginTop: userProfileMetrics.states.missingTopInset,
    alignItems: "center",
    rowGap: userProfileMetrics.states.gap,
  },
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.06)" },
  moreSheet: {
    overflow: "hidden",
    borderTopLeftRadius: userProfileMetrics.more.cornerRadius,
    borderTopRightRadius: userProfileMetrics.more.cornerRadius,
    backgroundColor: colors.card,
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
  },
  handle: {
    width: userProfileMetrics.more.handleWidth,
    height: userProfileMetrics.more.handleHeight,
    marginTop: userProfileMetrics.more.handleTopInset,
    marginBottom: userProfileMetrics.more.handleBottomInset,
    borderRadius: 2,
    alignSelf: "center",
    backgroundColor: "rgba(196,196,212,0.42)",
  },
  moreRow: {
    height: userProfileMetrics.more.rowHeight,
    paddingHorizontal: userProfileMetrics.more.rowHorizontalInset,
    flexDirection: "row",
    alignItems: "center",
    columnGap: userProfileMetrics.more.rowGap,
  },
  moreIcon: { width: userProfileMetrics.more.iconWidth, alignItems: "center" },
  moreTitle: {
    flex: 1,
    color: colors.text,
    fontSize: userProfileMetrics.more.title,
    fontWeight: "600",
  },
  moreTitleDanger: { color: colors.danger },
  moreDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: userProfileMetrics.more.dividerLeadingInset,
    backgroundColor: colors.separator,
  },
  moreSectionGap: {
    height: userProfileMetrics.more.sectionGap,
    backgroundColor: colors.separator,
  },
});
