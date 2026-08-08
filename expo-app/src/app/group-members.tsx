import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  type NativeTouchEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { getGroupDetail } from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { UserAvatarButton } from "@/components/Avatar";
import type { GroupCapabilities, GroupMember } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  effectiveGroupCapabilities,
  groupDetailGeneration,
  groupMemberDisplayName,
  loadCachedGroupDetail,
  saveCachedGroupDetail,
} from "@/services/groups/GroupDetailRepository";
import {
  beginGroupMembersOperation,
  canRemoveGroupMember,
  filterGroupMembers,
  finishGroupMembersOperation,
  groupMembersErrorMessage,
  isValidGroupMembersRoute,
} from "@/services/groups/GroupMembersPolicy";
import { executeGroupMemberRemoval } from "@/services/groups/GroupMembersRemoval";
import { subscribeGroupMembersAdded } from "@/services/groups/GroupMembersUpdates";
import { colors } from "@/theme";

export default function GroupMembersScreenRoute() {
  return <GroupMembersScreen key="native-pull-search-v2" />;
}

function GroupMembersScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = Number(params.id ?? "0");
  const { user } = useAuth();
  const { t } = useLocalization();
  const [members, setMembersState] = useState<GroupMember[]>([]);
  const membersRef = useRef<GroupMember[]>([]);
  const [capabilities, setCapabilities] = useState<GroupCapabilities | null>(null);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [isNativeSearchPresented, setNativeSearchPresented] = useState(false);
  const nativeSearchTouchStartYRef = useRef<number | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isProcessing, setProcessing] = useState(false);
  const processingRef = useRef(false);
  const operationScopeRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const ownerId = user?.user_id ?? "";
  const scopeKey = `${encodeURIComponent(ownerId)}:${groupId}`;
  const scopeRef = useRef(scopeKey);

  const isCurrentScope = useCallback(
    (scope: string) => mountedRef.current && scopeRef.current === scope,
    [],
  );

  const setMembers = useCallback((next: GroupMember[]) => {
    membersRef.current = next;
    setMembersState(next);
  }, []);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    scopeRef.current = scopeKey;
    processingRef.current = false;
    operationScopeRef.current = null;
    nativeSearchTouchStartYRef.current = null;
    queueMicrotask(() => {
      if (active && isCurrentScope(scopeKey)) {
        setNativeSearchPresented(false);
        setQuery("");
        setProcessing(false);
      }
    });

    const restoreInitialSnapshot = async () => {
      if (!isValidGroupMembersRoute(groupId, ownerId)) {
        if (active) {
          setMembers([]);
          setCapabilities(null);
          setLoadedScope(scopeKey);
          setLoading(false);
          if (ownerId) Alert.alert(t("common.error"), t("group.loadFailed"));
        }
        return;
      }
      const cached = await loadCachedGroupDetail(ownerId, groupId);
      if (!active) return;
      if (cached) {
        setMembers(cached.members);
        setCapabilities(effectiveGroupCapabilities(cached, user?.user_id));
      } else {
        setMembers([]);
        setCapabilities(null);
        Alert.alert(t("common.error"), t("group.loadFailed"));
      }
      setLoadedScope(scopeKey);
      setLoading(false);
    };

    void restoreInitialSnapshot();
    return () => {
      active = false;
      if (scopeRef.current === scopeKey) mountedRef.current = false;
    };
  }, [groupId, isCurrentScope, ownerId, scopeKey, setMembers, t, user?.user_id]);

  const refreshParentSnapshot = useCallback(async () => {
    const operationScope = scopeKey;
    if (!isValidGroupMembersRoute(groupId, ownerId) || !isCurrentScope(operationScope)) return;
    const cacheGeneration = groupDetailGeneration(ownerId, groupId);
    try {
      const fetched = await getGroupDetail(groupId);
      if (
        !isCurrentScope(operationScope) ||
        cacheGeneration !== groupDetailGeneration(ownerId, groupId)
      ) {
        return;
      }
      await saveCachedGroupDetail(ownerId, fetched, cacheGeneration);
    } catch {
      // Native onChanged refresh is best-effort and owns no child-page error state.
    }
  }, [groupId, isCurrentScope, ownerId, scopeKey]);

  const reloadMembersAfterAdd = useCallback(async () => {
    const operationScope = scopeKey;
    if (!isValidGroupMembersRoute(groupId, ownerId) || !isCurrentScope(operationScope)) return;
    const cacheGeneration = groupDetailGeneration(ownerId, groupId);
    try {
      const fetched = await getGroupDetail(groupId);
      if (
        !isCurrentScope(operationScope) ||
        cacheGeneration !== groupDetailGeneration(ownerId, groupId)
      ) {
        return;
      }
      setMembers(fetched.members);
      void refreshParentSnapshot();
    } catch {
      // Native reloadMembers intentionally ignores failures.
    }
  }, [groupId, isCurrentScope, ownerId, refreshParentSnapshot, scopeKey, setMembers]);

  useEffect(
    () =>
      subscribeGroupMembersAdded((updatedGroupId) => {
        if (updatedGroupId === groupId) void reloadMembersAfterAdd();
      }),
    [groupId, reloadMembersAfterAdd],
  );

  const filteredMembers = useMemo(
    () => filterGroupMembers(loadedScope === scopeKey ? members : [], query),
    [loadedScope, members, query, scopeKey],
  );
  const scopedCapabilities = loadedScope === scopeKey ? capabilities : null;

  const finishNativeSearchPull = useCallback(
    (event: NativeSyntheticEvent<NativeTouchEvent>) => {
      const startY = nativeSearchTouchStartYRef.current;
      nativeSearchTouchStartYRef.current = null;
      if (!isNativeSearchPresented && startY !== null && event.nativeEvent.pageY - startY >= 32) {
        setNativeSearchPresented(true);
      }
    },
    [isNativeSearchPresented],
  );

  const confirmRemove = (member: GroupMember) => {
    Alert.alert(
      t("group.removeMember.title"),
      t("group.removeMember.message", groupMemberDisplayName(member)),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("group.removeMember.confirm"),
          style: "destructive",
          onPress: () => remove(member),
        },
      ],
    );
  };

  const remove = async (member: GroupMember) => {
    const operationScope = scopeKey;
    if (
      !isValidGroupMembersRoute(groupId, ownerId) ||
      !isCurrentScope(operationScope) ||
      !beginGroupMembersOperation(processingRef)
    ) {
      return;
    }
    operationScopeRef.current = operationScope;
    if (isCurrentScope(operationScope)) setProcessing(true);
    try {
      await executeGroupMemberRemoval(groupId, member.user_id, {
        onRemoved: () => {
          if (isCurrentScope(operationScope)) {
            setMembers(membersRef.current.filter((item) => item.user_id !== member.user_id));
          }
        },
        onChanged: () => {
          if (isCurrentScope(operationScope)) void refreshParentSnapshot();
        },
        onError: (error) => {
          if (isCurrentScope(operationScope)) {
            Alert.alert(t("common.error"), groupMembersErrorMessage(error, t));
          }
        },
      });
    } finally {
      if (operationScopeRef.current === operationScope) {
        finishGroupMembersOperation(processingRef);
        operationScopeRef.current = null;
        if (isCurrentScope(operationScope)) setProcessing(false);
      }
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: t("group.info.title.count", loadedScope === scopeKey ? members.length : 0),
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: colors.text,
          ...(scopedCapabilities?.can_manage_members === true
            ? {
                headerRight: () => (
                  <Pressable
                    accessibilityLabel={t("group.addMembers")}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() =>
                      router.push({
                        pathname: "/add-group-members",
                        params: { id: String(groupId), source: "group-members" },
                      })
                    }
                  >
                    <SymbolView name="person.badge.plus" size={17} tintColor={colors.text} />
                  </Pressable>
                ),
              }
            : {}),
        }}
      />
      {isLoading || loadedScope !== scopeKey ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          alwaysBounceVertical
          contentInsetAdjustmentBehavior="automatic"
          data={filteredMembers}
          keyExtractor={(member) => member.user_id}
          onTouchStart={(event) => {
            nativeSearchTouchStartYRef.current = event.nativeEvent.pageY;
          }}
          onTouchEnd={finishNativeSearchPull}
          onTouchCancel={() => {
            nativeSearchTouchStartYRef.current = null;
          }}
          renderItem={({ item }) => (
            <View>
              <View style={styles.row}>
                <UserAvatarButton
                  accessibilityName={groupMemberDisplayName(item)}
                  avatarUrl={item.avatar_url}
                  size={44}
                  userId={item.user_id}
                />
                <View style={styles.nameColumn}>
                  <View style={styles.nameLine}>
                    <Text numberOfLines={1} style={styles.name}>
                      {groupMemberDisplayName(item)}
                    </Text>
                    <RoleBadge role={item.role} />
                  </View>
                  {groupMemberDisplayName(item) !== item.nickname &&
                  trimFoundationWhitespacesAndNewlines(item.nickname) ? (
                    <Text style={styles.originalName}>{item.nickname}</Text>
                  ) : null}
                </View>
                {canRemoveGroupMember(scopedCapabilities, item, user?.user_id) ? (
                  <Pressable
                    accessibilityLabel={t("group.removeMember.title")}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => confirmRemove(item)}
                  >
                    <SymbolView name="minus.circle" size={17} tintColor={colors.danger} />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.divider} />
            </View>
          )}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
        />
      )}
      {isProcessing ? (
        <View pointerEvents="none" style={styles.overlay}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
      {isNativeSearchPresented ? (
        <View style={styles.searchDock}>
          <View style={styles.searchField}>
            <SymbolView name="magnifyingglass" size={17} tintColor={colors.secondaryText} />
            <TextInput
              accessibilityLabel={t("group.members.search")}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              placeholder={t("group.members.search")}
              placeholderTextColor={colors.secondaryText}
              style={styles.searchInput}
              testID="group-members-search"
              value={query}
            />
            <Pressable
              accessibilityLabel={t("common.cancel")}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                setQuery("");
                setNativeSearchPresented(false);
              }}
            >
              <Text style={styles.cancelSearch}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function RoleBadge({ role }: { role: string }) {
  const { t } = useLocalization();
  const normalized = role.toLocaleLowerCase();
  if (normalized !== "owner" && normalized !== "admin") return null;
  const owner = normalized === "owner";
  return (
    <View style={[styles.roleBadge, owner ? styles.ownerBadge : styles.adminBadge]}>
      <Text style={[styles.roleText, owner ? styles.ownerText : styles.adminText]}>
        {t(owner ? "group.role.owner" : "group.role.admin")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.card },
  loadingState: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: {
    minHeight: 74,
    paddingHorizontal: 20,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  nameColumn: { flex: 1, minWidth: 0, rowGap: 2 },
  nameLine: { flexDirection: "row", alignItems: "center", columnGap: 6 },
  name: { flexShrink: 1, color: colors.text, fontSize: 17 },
  originalName: { color: colors.secondaryText, fontSize: 12 },
  roleBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  ownerBadge: { backgroundColor: colors.accent },
  adminBadge: { backgroundColor: "rgba(102,126,234,0.12)" },
  roleText: { fontSize: 11, fontWeight: "600" },
  ownerText: { color: colors.white },
  adminText: { color: colors.accent },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 76, backgroundColor: colors.separator },
  searchDock: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 18,
    backgroundColor: "rgba(255,255,255,0.94)",
  },
  searchField: {
    minHeight: 50,
    paddingHorizontal: 16,
    borderRadius: 25,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
    backgroundColor: "rgba(247,247,249,0.98)",
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 17, paddingVertical: 0 },
  cancelSearch: { color: colors.accent, fontSize: 15 },
  overlay: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
