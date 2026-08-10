import {
  router,
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  type NativeStackNavigationOptions,
} from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getGroups } from "@/api/bwchat";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { GroupAvatarIcon } from "@/components/GroupAvatarIcon";
import { GroupMemberAvatar } from "@/components/GroupMemberAvatar";
import { SystemSegmentedTabs } from "@/components/SystemSegmentedTabs";
import type { ChatGroup, GroupDetail } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  conversationContentPreviewText,
  conversationSenderPrefixText,
} from "@/services/conversations/ConversationListPolicy";
import { useConversationUnreadCount } from "@/services/conversations/ConversationUnreadStore";
import { loadGroupsWithNativeCache } from "@/services/groups/GroupRepository";
import { peekCachedGroupDetail } from "@/services/groups/GroupDetailRepository";
import { runAfterNavigationInteractions } from "@/services/navigation/NavigationWorkScheduler";
import {
  readNavigationSnapshot,
  writeNavigationSnapshot,
} from "@/services/navigation/NavigationSnapshotCache";
import { colors } from "@/theme";

type GroupListMode = "public" | "mine";

export default function GroupListScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const { user } = useAuth();
  const { activeLanguage, t } = useLocalization();
  const ownerId = user?.user_id ?? "";
  const [mode, setMode] = useState<GroupListMode>(params.mode === "mine" ? "mine" : "public");
  const [listState, setListState] = useState<GroupListState>(() => restoredGroupListState(ownerId));
  const activeOwnerRef = useRef(ownerId);
  const loadGenerationRef = useRef(0);
  useEffect(() => {
    if (activeOwnerRef.current === ownerId) return;
    activeOwnerRef.current = ownerId;
    loadGenerationRef.current += 1;
    setListState(restoredGroupListState(ownerId));
  }, [ownerId]);
  const ownerStateIsCurrent = listState.ownerId === ownerId;
  const isLoading = ownerStateIsCurrent ? listState.isLoading : Boolean(ownerId);
  const isRefreshing = ownerStateIsCurrent && listState.isRefreshing;
  const displayedGroups = useMemo(() => {
    const groups = listState.ownerId === ownerId ? listState.groups : [];
    return mode === "public" ? groups.filter((group) => group.is_public) : groups;
  }, [listState.groups, listState.ownerId, mode, ownerId]);

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!ownerId) return;
      const generation = ++loadGenerationRef.current;
      const isCurrent = () =>
        activeOwnerRef.current === ownerId && loadGenerationRef.current === generation;
      setListState((current) => ({
        ownerId,
        groups: current.ownerId === ownerId ? current.groups : [],
        hasResolved: current.ownerId === ownerId && current.hasResolved,
        isLoading: !forceRefresh && !(current.ownerId === ownerId && current.hasResolved),
        isRefreshing: forceRefresh,
      }));
      try {
        const fetched = await loadGroupsWithNativeCache(ownerId, getGroups, { forceRefresh });
        if (isCurrent()) {
          writeNavigationSnapshot("group-list", ownerId, fetched);
          setListState({
            ownerId,
            groups: fetched,
            hasResolved: true,
            isLoading: false,
            isRefreshing: false,
          });
        }
      } catch {
        // Keep the account-scoped cache visible, matching GroupsViewModel.
      } finally {
        if (isCurrent()) {
          setListState((current) =>
            current.ownerId === ownerId
              ? { ...current, hasResolved: true, isLoading: false, isRefreshing: false }
              : current,
          );
        }
      }
    },
    [ownerId],
  );

  useFocusEffect(
    useCallback(() => {
      const cancel = runAfterNavigationInteractions(() => void load());
      return () => {
        cancel();
        loadGenerationRef.current += 1;
      };
    }, [load]),
  );

  const emptyTitle =
    mode === "public" ? t("groups.empty.title") : t("contacts.myGroups.emptyTitle");
  const emptySubtitle =
    mode === "public" ? t("groups.empty.subtitle") : t("contacts.myGroups.emptySubtitle");
  const headerOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      title: "",
      headerShadowVisible: false,
      headerBackButtonDisplayMode: "minimal",
      headerStyle: { backgroundColor: colors.background },
      headerTintColor: colors.text,
      headerTitle: () => <GroupModePicker mode={mode} onChange={setMode} />,
      headerRight: () => (
        <Pressable
          accessibilityLabel={t("group.create.title")}
          hitSlop={5}
          onPress={() =>
            router.push({
              pathname: "/create-group",
              params: {
                isPublic: mode === "public" ? "true" : "false",
              },
            })
          }
          style={styles.addButton}
        >
          <SymbolView name="plus" size={18} weight="semibold" tintColor={colors.text} />
        </Pressable>
      ),
    }),
    [mode, t],
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={headerOptions} />

      {displayedGroups.length === 0 && !isLoading ? (
        <View style={styles.emptyState}>
          <GroupAvatarIcon size={70} />
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void load(true)}
              tintColor={colors.accent}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          {displayedGroups.map((group) => (
            <GroupListRow
              key={group.group_id}
              activeLanguage={activeLanguage}
              group={group}
              ownerId={ownerId}
              t={t}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

interface GroupListState {
  ownerId: string;
  groups: ChatGroup[];
  hasResolved: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
}

const emptyGroupListState: GroupListState = {
  ownerId: "",
  groups: [],
  hasResolved: false,
  isLoading: true,
  isRefreshing: false,
};

function restoredGroupListState(ownerId: string): GroupListState {
  const groups = readNavigationSnapshot<ChatGroup[]>("group-list", ownerId);
  return groups
    ? { ownerId, groups, hasResolved: true, isLoading: false, isRefreshing: false }
    : { ...emptyGroupListState, ownerId, isLoading: Boolean(ownerId) };
}

function GroupListRow({
  activeLanguage,
  group,
  ownerId,
  t,
}: {
  activeLanguage: string;
  group: ChatGroup;
  ownerId: string;
  t: (key: string, ...args: (string | number)[]) => string;
}) {
  const memoryDetail = peekCachedGroupDetail(ownerId, group.group_id)?.detail ?? null;
  const [detailState, setDetailState] = useState<GroupRowDetailState>({
    ownerId: "",
    groupId: 0,
    detail: null,
  });
  const detailIsCurrent = detailState.ownerId === ownerId && detailState.groupId === group.group_id;
  const detail = detailIsCurrent ? detailState.detail : memoryDetail;
  const unread =
    useConversationUnreadCount(ownerId, `group:${group.group_id}`) ?? group.unread_count;
  const displayName =
    trimFoundationWhitespacesAndNewlines(detail?.viewer_settings.remark ?? "") || group.name;
  const isMuted = Boolean(detail?.notification_settings.muted || group.is_muted);
  const applyDetail = useCallback(
    (next: GroupDetail) => {
      if (next.group_id !== group.group_id) return;
      setDetailState({ ownerId, groupId: group.group_id, detail: next });
    },
    [group.group_id, ownerId],
  );

  const content = group.last_message
    ? conversationContentPreviewText(group.last_message, {
        activeLanguage,
        viewerId: ownerId,
        translate: t,
      })
    : undefined;
  const sender = group.last_message
    ? conversationSenderPrefixText(group.last_message_sender, group.last_message, t)
    : undefined;

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/group-chat/[id]",
          params: {
            id: group.group_id,
            name: displayName,
            avatar: group.avatar_url,
            memberCount: group.member_count,
          },
        })
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <GroupMemberAvatar groupId={group.group_id} onDetail={applyDetail} size={48} />
      <View style={styles.rowBody}>
        <View style={styles.nameLine}>
          <Text numberOfLines={1} style={styles.groupName}>
            {displayName}
          </Text>
          <Text style={styles.memberCount}>({group.member_count})</Text>
          {isMuted ? (
            <SymbolView
              accessibilityLabel={t("group.notifications.mute")}
              name="bell.slash.fill"
              size={11}
              weight="medium"
              tintColor={colors.tertiaryText}
            />
          ) : null}
        </View>
        {content !== undefined ? (
          <Text numberOfLines={1} style={styles.preview}>
            {sender ? `${sender}: ` : ""}
            {content}
          </Text>
        ) : null}
      </View>
      <View style={styles.trailing}>
        <Text style={styles.time}>{formatListTime(group.last_message_time)}</Text>
        {unread > 0 ? (
          <View style={[styles.unreadBadge, isMuted && styles.mutedBadge]}>
            <Text style={styles.unreadText}>
              {Math.min(unread, 99)}
              {unread > 99 ? "+" : ""}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

interface GroupRowDetailState {
  ownerId: string;
  groupId: number;
  detail: GroupDetail | null;
}

function GroupModePicker({
  mode,
  onChange,
}: {
  mode: GroupListMode;
  onChange: (mode: GroupListMode) => void;
}) {
  const { t } = useLocalization();
  return (
    <SystemSegmentedTabs
      accessibilityIdentifier="group.top.tabs"
      items={[
        { value: "public", title: t("groups.tab.recommended") },
        { value: "mine", title: t("groups.tab.myGroups") },
      ]}
      onSelectionChange={onChange}
      selection={mode}
    />
  );
}

function formatListTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "numeric", day: "numeric" });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  addButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", rowGap: 14 },
  emptyTitle: { color: colors.secondaryText, fontSize: 16, fontWeight: "500" },
  emptySubtitle: { color: colors.tertiaryText, fontSize: 14 },
  list: { paddingVertical: 4 },
  row: {
    minHeight: 72,
    marginHorizontal: 16,
    marginVertical: 4,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  rowBody: { flex: 1, minWidth: 0, rowGap: 4 },
  nameLine: { flexDirection: "row", alignItems: "center", columnGap: 4 },
  groupName: { flexShrink: 1, color: colors.text, fontSize: 16, fontWeight: "600" },
  memberCount: { color: colors.tertiaryText, fontSize: 13 },
  preview: { color: colors.secondaryText, fontSize: 14 },
  trailing: { alignItems: "flex-end", rowGap: 6 },
  time: { color: colors.tertiaryText, fontSize: 12 },
  unreadBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.danger,
  },
  mutedBadge: { backgroundColor: "#B2B2B2" },
  unreadText: { color: colors.white, fontSize: 11, fontWeight: "700" },
  pressed: { opacity: 0.68 },
});
