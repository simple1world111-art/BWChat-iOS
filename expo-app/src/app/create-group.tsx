import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";

import { getFollowers, getFollowing } from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import type { FollowUser, FollowUsersPage } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  eligibleGroupMembers,
  mergeUniqueGroupMembers,
  nextFollowPage,
  type GroupMemberSourceKind,
} from "@/services/groups/GroupMemberSource";
import { createGroupWithNativeRefresh } from "@/services/groups/CreateGroupCoordinator";
import { colors } from "@/theme";

type MemberSource = GroupMemberSourceKind;

export default function CreateGroupScreen() {
  const params = useLocalSearchParams<{ isPublic?: string }>();
  const { user } = useAuth();
  const { t } = useLocalization();
  const initialIsPublic = params.isPublic === "true";
  const ownerId = user?.user_id.trim() ?? "";
  const systemBackground = useSystemBackground();
  const [groupName, setGroupName] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(() => new Set());
  const [isPublic, setPublic] = useState(initialIsPublic);
  const [isCreating, setCreating] = useState(false);
  const [showFollowers, setShowFollowers] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(false);
  const dismissedRef = useRef(false);
  const submissionRef = useRef<object | null>(null);
  const refreshingRef = useRef<object | null>(null);
  const displayedOwnerRef = useRef(ownerId);
  const ownerGenerationRef = useRef(0);
  const mutual = useMemberSource("mutual", ownerId || undefined);
  const followers = useMemberSource("followers", ownerId || undefined);
  const mutualScroll = useLoadMoreScroll(mutual.loadMore, mutual.users.length > 0);
  const trimmedName = groupName.trim();
  const canCreate = ownerId.length > 0 && trimmedName.length > 0 && selectedMemberIds.size > 0;

  useEffect(() => {
    mountedRef.current = true;
    dismissedRef.current = false;
    return () => {
      mountedRef.current = false;
      dismissedRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (displayedOwnerRef.current === ownerId) return;
    displayedOwnerRef.current = ownerId;
    ownerGenerationRef.current += 1;
    submissionRef.current = null;
    refreshingRef.current = null;
    setGroupName("");
    setSelectedMemberIds(new Set());
    setPublic(initialIsPublic);
    setCreating(false);
    setShowFollowers(false);
    setRefreshing(false);
  }, [initialIsPublic, ownerId]);

  const toggleSelection = useCallback((userId: string) => {
    setSelectedMemberIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    const operation = {};
    refreshingRef.current = operation;
    if (mountedRef.current) setRefreshing(true);
    try {
      await mutual.refresh();
      await followers.refresh();
    } finally {
      if (refreshingRef.current === operation) {
        refreshingRef.current = null;
        if (mountedRef.current) setRefreshing(false);
      }
    }
  }, [followers, mutual]);

  const refreshFollowers = useCallback(async () => {
    if (refreshingRef.current) return;
    const operation = {};
    refreshingRef.current = operation;
    if (mountedRef.current) setRefreshing(true);
    try {
      await followers.refresh();
    } finally {
      if (refreshingRef.current === operation) {
        refreshingRef.current = null;
        if (mountedRef.current) setRefreshing(false);
      }
    }
  }, [followers]);

  const submit = useCallback(async () => {
    if (!canCreate || submissionRef.current || displayedOwnerRef.current !== ownerId) return;
    const generation = ownerGenerationRef.current;
    const operation = {};
    submissionRef.current = operation;
    if (mountedRef.current) setCreating(true);
    const success = await createGroupWithNativeRefresh({
      name: trimmedName,
      memberIds: [...selectedMemberIds],
      isPublic,
      ownerId,
      isOwnerCurrent: () =>
        ownerGenerationRef.current === generation && displayedOwnerRef.current === ownerId,
    });
    const isCurrentOwner =
      ownerGenerationRef.current === generation && displayedOwnerRef.current === ownerId;
    if (submissionRef.current === operation) submissionRef.current = null;
    if (mountedRef.current && isCurrentOwner) setCreating(false);
    if (success && isCurrentOwner && !dismissedRef.current) {
      dismissedRef.current = true;
      router.back();
    }
  }, [canCreate, isPublic, ownerId, selectedMemberIds, trimmedName]);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    router.back();
  }, []);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.screen, { backgroundColor: systemBackground }]}
    >
      <Stack.Screen
        options={
          showFollowers
            ? {
                title: t("follow.followers"),
                headerLeft: () => (
                  <Pressable
                    accessibilityLabel={t("common.back")}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setShowFollowers(false)}
                    style={styles.headerButton}
                  >
                    <SymbolView
                      name="chevron.left"
                      size={17}
                      weight="semibold"
                      tintColor={colors.accent}
                    />
                  </Pressable>
                ),
                headerRight: () => (
                  <Text style={styles.selectedHeaderCount}>
                    {t("group.selectedMembers.count", selectedMemberIds.size)}
                  </Text>
                ),
              }
            : {
                title: t("group.create.title"),
                headerLeft: () => (
                  <Pressable
                    accessibilityLabel={t("common.cancel")}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={dismiss}
                    style={styles.headerButton}
                  >
                    <Text style={styles.cancelText}>{t("common.cancel")}</Text>
                  </Pressable>
                ),
                headerRight: () => (
                  <Pressable
                    accessibilityLabel={t("common.create")}
                    accessibilityRole="button"
                    accessibilityState={{ busy: isCreating, disabled: !canCreate || isCreating }}
                    disabled={!canCreate || isCreating}
                    hitSlop={8}
                    onPress={() => void submit()}
                    style={styles.headerButton}
                  >
                    {isCreating ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.accent}
                        style={styles.createSpinner}
                      />
                    ) : (
                      <Text style={[styles.createText, !canCreate && styles.createTextDisabled]}>
                        {t("common.create")}
                      </Text>
                    )}
                  </Pressable>
                ),
              }
        }
      />

      {showFollowers ? (
        <FollowerSelection
          isRefreshing={isRefreshing}
          onLoadMore={followers.loadMore}
          onRefresh={refreshFollowers}
          onToggle={toggleSelection}
          selectedMemberIds={selectedMemberIds}
          source={followers}
        />
      ) : (
        <View style={styles.mainContent}>
          <View style={styles.settings}>
            <View style={styles.nameFieldGroup}>
              <Text style={styles.sectionLabel}>{t("group.create.name").toLocaleUpperCase()}</Text>
              <TextInput
                accessibilityLabel={t("group.create.name")}
                onChangeText={setGroupName}
                placeholder={t("group.create.name.placeholder")}
                placeholderTextColor={colors.secondaryText}
                returnKeyType="done"
                style={styles.nameInput}
                value={groupName}
              />
            </View>

            <View style={styles.publicRow}>
              <View style={styles.publicIcon}>
                <SymbolView name="globe" size={17} weight="medium" tintColor={colors.accent} />
              </View>
              <Text style={styles.publicTitle}>{t("group.isPublic")}</Text>
              <View style={styles.flexSpacer} />
              <Switch
                accessibilityLabel={t("group.isPublic")}
                ios_backgroundColor="#E9E9EA"
                onValueChange={setPublic}
                trackColor={{ false: "#E9E9EA", true: colors.accent }}
                value={isPublic}
              />
            </View>
          </View>

          <View style={styles.memberPicker}>
            <Text style={styles.memberLabel}>
              {t("group.selectMembers.count", selectedMemberIds.size).toLocaleUpperCase()}
            </Text>
            <ScrollView
              contentContainerStyle={styles.memberScrollContent}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={mutualScroll.onContentSizeChange}
              onLayout={mutualScroll.onLayout}
              onScroll={mutualScroll.onScroll}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={() => void refresh()}
                  tintColor={colors.accent}
                />
              }
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              testID="create-group-mutual-scroll"
            >
              <Pressable
                accessibilityLabel={t("follow.followers")}
                accessibilityRole="button"
                onPress={() => setShowFollowers(true)}
                style={({ pressed }) => [styles.followersEntry, pressed && styles.pressed]}
              >
                <View style={styles.followersIconCircle}>
                  <SymbolView
                    name="person.2.fill"
                    size={17}
                    weight="semibold"
                    tintColor={colors.accent}
                  />
                </View>
                <Text style={styles.followersTitle}>{t("follow.followers")}</Text>
                <View style={styles.flexSpacer} />
                {selectedMemberIds.size > 0 ? (
                  <View style={styles.selectionCountBadge}>
                    <Text style={styles.selectionCountText}>{selectedMemberIds.size}</Text>
                  </View>
                ) : null}
                <SymbolView
                  name="chevron.right"
                  size={13}
                  weight="semibold"
                  tintColor={colors.tertiaryText}
                />
              </Pressable>

              <Text style={styles.mutualHeading}>{t("follow.relationship.mutual")}</Text>
              <MemberSourceContent
                emptyTitle={t("group.create.noMutualFollows")}
                onToggle={toggleSelection}
                selectedMemberIds={selectedMemberIds}
                source={mutual}
              />
            </ScrollView>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function FollowerSelection({
  isRefreshing,
  onLoadMore,
  onRefresh,
  onToggle,
  selectedMemberIds,
  source,
}: {
  isRefreshing: boolean;
  onLoadMore: () => void;
  onRefresh: () => Promise<void>;
  onToggle: (userId: string) => void;
  selectedMemberIds: ReadonlySet<string>;
  source: MemberSourceState;
}) {
  const { t } = useLocalization();
  const systemBackground = useSystemBackground();
  const paging = useLoadMoreScroll(onLoadMore, source.users.length > 0);
  return (
    <ScrollView
      contentContainerStyle={[styles.followersScrollContent, { backgroundColor: systemBackground }]}
      onContentSizeChange={paging.onContentSizeChange}
      onLayout={paging.onLayout}
      onScroll={paging.onScroll}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => void onRefresh()}
          tintColor={colors.accent}
        />
      }
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      testID="create-group-followers-scroll"
    >
      <MemberSourceContent
        emptyTitle={t("follow.followers.empty")}
        emptyTop={36}
        loadingTop={80}
        onToggle={onToggle}
        selectedMemberIds={selectedMemberIds}
        source={source}
      />
    </ScrollView>
  );
}

function MemberSourceContent({
  emptyTitle,
  emptyTop = 0,
  loadingTop = 36,
  onToggle,
  selectedMemberIds,
  source,
}: {
  emptyTitle: string;
  emptyTop?: number | undefined;
  loadingTop?: number | undefined;
  onToggle: (userId: string) => void;
  selectedMemberIds: ReadonlySet<string>;
  source: MemberSourceState;
}) {
  if (source.isLoading && source.users.length === 0) {
    return <ActivityIndicator color={colors.accent} style={{ marginTop: loadingTop }} />;
  }
  if (source.users.length === 0) {
    return (
      <View style={emptyTop > 0 ? { paddingTop: emptyTop } : undefined}>
        <MemberEmptyState title={emptyTitle} />
      </View>
    );
  }
  return (
    <>
      {source.users.map((member) => (
        <MemberSelectionRow
          isSelected={selectedMemberIds.has(member.user_id)}
          key={member.user_id}
          member={member}
          onPress={() => onToggle(member.user_id)}
        />
      ))}
      {source.isLoadingMore ? (
        <ActivityIndicator color={colors.accent} style={styles.loadingMore} />
      ) : null}
    </>
  );
}

function MemberSelectionRow({
  isSelected,
  member,
  onPress,
}: {
  isSelected: boolean;
  member: FollowUser;
  onPress: () => void;
}) {
  return (
    <View>
      <Pressable
        accessibilityLabel={member.nickname}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        onPress={onPress}
        style={({ pressed }) => [styles.memberRow, pressed && styles.pressed]}
      >
        <View style={styles.checkHitArea}>
          <View style={[styles.checkCircle, isSelected && styles.checkCircleSelected]}>
            {isSelected ? (
              <SymbolView name="checkmark" size={11} weight="bold" tintColor={colors.white} />
            ) : null}
          </View>
        </View>
        <Avatar name={member.nickname} size={42} uri={member.avatar_url} />
        <Text numberOfLines={1} style={styles.memberName}>
          {member.nickname}
        </Text>
      </Pressable>
      <View style={styles.memberDivider} />
    </View>
  );
}

function MemberEmptyState({ title }: { title: string }) {
  return (
    <View style={styles.emptyState}>
      <SymbolView name="person.2" size={36} tintColor={colors.tertiaryText} />
      <Text style={styles.emptyTitle}>{title}</Text>
    </View>
  );
}

interface MemberSourceState {
  users: FollowUser[];
  isLoading: boolean;
  isLoadingMore: boolean;
  refresh(): Promise<void>;
  loadMore(): void;
}

function useMemberSource(
  source: MemberSource,
  currentUserId: string | undefined,
): MemberSourceState {
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const usersRef = useRef<FollowUser[]>([]);
  const nextPageRef = useRef<number | null>(1);
  const generationRef = useRef(0);
  const loadingGenerationRef = useRef<number | null>(null);

  const load = useCallback(
    async (reset: boolean, showBlockingLoader: boolean) => {
      if (!currentUserId) return;
      const generation = generationRef.current;
      if (loadingGenerationRef.current === generation) return;
      let nextPage = reset ? 1 : nextPageRef.current;
      if (nextPage === null) return;
      loadingGenerationRef.current = generation;
      await Promise.resolve();
      if (generationRef.current !== generation) return;
      if (reset) {
        usersRef.current = [];
        setUsers([]);
        nextPageRef.current = 1;
      }
      if (showBlockingLoader) setLoading(true);
      else setLoadingMore(true);
      try {
        do {
          const page: number = nextPage;
          const result: FollowUsersPage =
            source === "mutual" ? await getFollowing({ page }) : await getFollowers({ page });
          if (generationRef.current !== generation) return;
          const eligible = eligibleGroupMembers(source, currentUserId, result.users);
          const merged = mergeUniqueGroupMembers(usersRef.current, eligible);
          usersRef.current = merged;
          setUsers(merged);
          nextPage = nextFollowPage(result, page);
          nextPageRef.current = nextPage;
          if (source === "followers" || eligible.length > 0) break;
        } while (nextPage !== null);
      } catch {
        // Preserve loaded members; pull-to-refresh is the native retry path.
      } finally {
        if (generationRef.current === generation) {
          loadingGenerationRef.current = null;
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [currentUserId, source],
  );

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    usersRef.current = [];
    nextPageRef.current = 1;
    loadingGenerationRef.current = null;
    void Promise.resolve().then(() => {
      if (generationRef.current !== generation) return;
      setUsers([]);
      setLoading(Boolean(currentUserId));
      setLoadingMore(false);
      if (currentUserId) void load(true, true);
    });
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [currentUserId, load]);

  const refresh = useCallback(() => load(true, true), [load]);
  const loadMore = useCallback(() => {
    void load(false, false);
  }, [load]);

  return { users, isLoading, isLoadingMore, refresh, loadMore };
}

function useSystemBackground(): string {
  return useColorScheme() === "dark" ? "#000000" : colors.card;
}

function useLoadMoreScroll(loadMore: () => void, enabled: boolean) {
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const maybeLoadVisibleTail = useCallback(() => {
    if (
      enabled &&
      viewportHeightRef.current > 0 &&
      contentHeightRef.current > 0 &&
      contentHeightRef.current <= viewportHeightRef.current + 1
    ) {
      loadMore();
    }
  }, [enabled, loadMore]);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      viewportHeightRef.current = event.nativeEvent.layout.height;
      maybeLoadVisibleTail();
    },
    [maybeLoadVisibleTail],
  );
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      contentHeightRef.current = height;
      maybeLoadVisibleTail();
    },
    [maybeLoadVisibleTail],
  );
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!enabled) return;
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 96) loadMore();
    },
    [enabled, loadMore],
  );
  return { onLayout, onContentSizeChange, onScroll };
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  mainContent: { flex: 1 },
  settings: { flexShrink: 0 },
  nameFieldGroup: { rowGap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  sectionLabel: { color: colors.secondaryText, fontSize: 13, fontWeight: "500" },
  nameInput: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(240,240,245,0.6)",
    color: colors.text,
    fontSize: 16,
  },
  publicRow: {
    minHeight: 55,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
    backgroundColor: "rgba(240,240,245,0.6)",
  },
  publicTitle: { color: colors.text, fontSize: 16, fontWeight: "500" },
  publicIcon: { width: 24, alignItems: "center" },
  flexSpacer: { flex: 1 },
  memberPicker: { flex: 1, rowGap: 8 },
  memberLabel: {
    paddingHorizontal: 16,
    color: colors.secondaryText,
    fontSize: 13,
    fontWeight: "500",
  },
  memberScrollContent: { flexGrow: 1 },
  followersEntry: {
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  followersIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(102,126,234,0.12)",
  },
  followersTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  selectionCountBadge: {
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(102,126,234,0.12)",
  },
  selectionCountText: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  mutualHeading: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    color: colors.secondaryText,
    fontSize: 13,
    fontWeight: "600",
  },
  memberRow: {
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  checkHitArea: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.tertiaryText,
    alignItems: "center",
    justifyContent: "center",
  },
  checkCircleSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  memberName: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "500" },
  memberDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 76,
    backgroundColor: colors.separator,
  },
  loadingMore: { marginVertical: 16 },
  emptyState: { paddingVertical: 42, alignItems: "center", rowGap: 12 },
  emptyTitle: { color: colors.secondaryText, fontSize: 14 },
  followersScrollContent: { flexGrow: 1 },
  headerButton: { minWidth: 44, height: 44, alignItems: "center", justifyContent: "center" },
  cancelText: { color: colors.accent, fontSize: 16 },
  createText: { color: colors.accent, fontSize: 16, fontWeight: "600" },
  createTextDisabled: { color: colors.tertiaryText },
  createSpinner: { transform: [{ scale: 0.8 }] },
  selectedHeaderCount: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.68 },
});
