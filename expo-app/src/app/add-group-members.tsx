import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";

import { addGroupMembers, getFriendList, getGroupDetail } from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import type { FriendInfo } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { loadCachedFriends, loadFriendsWithNativeCache } from "@/services/friends/FriendRepository";
import {
  addGroupMembersErrorMessage,
  isValidAddGroupMembersRoute,
} from "@/services/groups/AddGroupMembersPolicy";
import { saveCachedGroupDetail } from "@/services/groups/GroupDetailRepository";
import { notifyGroupMembersAdded } from "@/services/groups/GroupMembersUpdates";
import { colors } from "@/theme";

export default function AddGroupMembersScreen() {
  const params = useLocalSearchParams<{ id?: string; source?: string }>();
  const groupId = Number(params.id ?? "0");
  const { user } = useAuth();
  const { t } = useLocalization();
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [existingMemberIds, setExistingMemberIds] = useState<Set<string>>(() => new Set());
  const [selectedFriendIds, setSelectedFriendIds] = useState<Set<string>>(() => new Set());
  const [isLoading, setLoading] = useState(true);
  const [isAdding, setAdding] = useState(false);
  const submissionInFlightRef = useRef(false);
  const dismissedRef = useRef(false);
  const isDark = useColorScheme() === "dark";
  const ownerId = user?.user_id ?? "";
  const availableFriends = useMemo(
    () => friends.filter((friend) => !existingMemberIds.has(friend.user_id)),
    [existingMemberIds, friends],
  );

  useEffect(() => {
    let active = true;
    dismissedRef.current = false;
    const canUpdate = () => active && !dismissedRef.current;
    const load = async () => {
      setFriends([]);
      setExistingMemberIds(new Set());
      setSelectedFriendIds(new Set());
      if (!isValidAddGroupMembersRoute(groupId, ownerId)) {
        setLoading(false);
        if (ownerId) {
          Alert.alert(t("common.error"), t("group.loadFailed"), [
            { text: t("common.confirm"), style: "cancel" },
          ]);
        }
        return;
      }
      setLoading(true);
      const detailTask = getGroupDetail(groupId)
        .then((detail) => {
          if (canUpdate()) {
            setExistingMemberIds(new Set(detail.members.map((member) => member.user_id)));
          }
        })
        .catch(() => {
          if (canUpdate()) {
            Alert.alert(t("common.error"), t("group.loadFailed"), [
              { text: t("common.confirm"), style: "cancel" },
            ]);
          }
        });
      const friendsTask = (async () => {
        const cachedFriends = await loadCachedFriends(ownerId);
        if (canUpdate()) setFriends(cachedFriends);
        try {
          const resolved = await loadFriendsWithNativeCache(ownerId, getFriendList);
          if (canUpdate()) setFriends(resolved);
        } catch {
          // Native FriendsViewModel keeps any seeded cache and does not surface its error here.
        }
      })();
      await Promise.all([detailTask, friendsTask]);
      if (canUpdate()) setLoading(false);
    };
    void load();
    return () => {
      active = false;
      dismissedRef.current = true;
    };
  }, [groupId, ownerId, t]);

  const toggle = (friendId: string) => {
    setSelectedFriendIds((current) => {
      const next = new Set(current);
      if (next.has(friendId)) next.delete(friendId);
      else next.add(friendId);
      return next;
    });
  };

  const refreshDirectParent = async () => {
    try {
      const detail = await getGroupDetail(groupId);
      await saveCachedGroupDetail(ownerId, detail);
    } catch {
      // Native GroupDetailView's success callback refresh is best-effort and owns no child error.
    }
  };

  const submit = async () => {
    if (dismissedRef.current || selectedFriendIds.size === 0 || submissionInFlightRef.current) {
      return;
    }
    submissionInFlightRef.current = true;
    setAdding(true);
    try {
      await addGroupMembers(groupId, [...selectedFriendIds]);
      if (!dismissedRef.current) {
        if (params.source === "group-members") notifyGroupMembersAdded(groupId);
        else void refreshDirectParent();
        dismissedRef.current = true;
        router.back();
      }
    } catch (error) {
      if (!dismissedRef.current) {
        Alert.alert(t("common.error"), addGroupMembersErrorMessage(error, t), [
          { text: t("common.confirm"), style: "cancel" },
        ]);
      }
    } finally {
      submissionInFlightRef.current = false;
      if (!dismissedRef.current) setAdding(false);
    }
  };

  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    router.back();
  };

  return (
    <View style={[styles.screen, isDark && styles.screenDark]}>
      <Stack.Screen
        options={{
          title: t("group.addMembers.title"),
          headerLeft: () => (
            <Pressable
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
              accessibilityRole="button"
              disabled={selectedFriendIds.size === 0 || isAdding}
              hitSlop={8}
              onPress={() => void submit()}
              style={styles.headerButton}
            >
              {isAdding ? (
                <ActivityIndicator color={colors.accent} style={styles.addSpinner} />
              ) : (
                <Text style={[styles.addText, selectedFriendIds.size === 0 && styles.disabledText]}>
                  {t("common.add")}
                </Text>
              )}
            </Pressable>
          ),
        }}
      />

      {isLoading ? (
        <View style={styles.blockingState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : availableFriends.length === 0 ? (
        <View style={styles.emptyState}>
          <SymbolView name="person.badge.plus" size={36} tintColor={colors.tertiaryText} />
          <Text style={styles.emptyText}>{t("group.addMembers.allAdded")}</Text>
        </View>
      ) : (
        <>
          <View style={styles.selectionHeader}>
            <Text style={styles.selectionLabel}>
              {t("group.addMembers.selectCount", selectedFriendIds.size).toLocaleUpperCase()}
            </Text>
          </View>
          <FlatList
            data={availableFriends}
            keyExtractor={(friend) => friend.user_id}
            renderItem={({ item: friend }) => {
              const selected = selectedFriendIds.has(friend.user_id);
              return (
                <View key={friend.user_id}>
                  <Pressable
                    accessibilityLabel={friend.nickname}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => toggle(friend.user_id)}
                    style={styles.row}
                  >
                    <View style={styles.checkHitArea}>
                      <View style={[styles.checkCircle, selected && styles.checkCircleSelected]}>
                        {selected ? (
                          <SymbolView
                            name="checkmark"
                            size={11}
                            weight="bold"
                            tintColor={colors.white}
                          />
                        ) : null}
                      </View>
                    </View>
                    <Avatar name={friend.nickname} size={42} uri={friend.avatar_url} />
                    <Text numberOfLines={1} style={styles.name}>
                      {friend.nickname}
                    </Text>
                  </Pressable>
                  <View style={styles.divider} />
                </View>
              );
            }}
            showsVerticalScrollIndicator
            style={styles.list}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.card },
  screenDark: { backgroundColor: colors.black },
  blockingState: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", rowGap: 12 },
  emptyText: { color: colors.secondaryText, fontSize: 14 },
  selectionHeader: { paddingTop: 16, paddingBottom: 8 },
  selectionLabel: {
    paddingHorizontal: 16,
    color: colors.secondaryText,
    fontSize: 13,
    fontWeight: "500",
  },
  list: { flex: 1 },
  row: {
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
  name: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "500" },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 76, backgroundColor: colors.separator },
  headerButton: { minWidth: 44, height: 44, alignItems: "center", justifyContent: "center" },
  cancelText: { color: colors.accent, fontSize: 16 },
  addText: { color: colors.accent, fontSize: 16, fontWeight: "600" },
  disabledText: { color: colors.tertiaryText },
  addSpinner: { transform: [{ scale: 0.8 }] },
});
