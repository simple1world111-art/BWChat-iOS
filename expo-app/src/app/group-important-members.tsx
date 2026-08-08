import { SymbolView } from "expo-symbols";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { getGroupDetail } from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { UserAvatarButton } from "@/components/Avatar";
import type { GroupMember, GroupNotificationSettings } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  applyGroupNotificationSettingsUpdate,
  groupMemberDisplayName,
  subscribeGroupDetail,
} from "@/services/groups/GroupDetailRepository";
import { groupDetailErrorMessage } from "@/services/groups/GroupDetailPolicy";
import {
  getGroupNotificationSettings,
  groupImportantMemberLimit,
  updateGroupNotificationSettings,
} from "@/services/groups/GroupInfoV2Repository";
import { colors } from "@/theme";

export default function GroupImportantMembersScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = Number(params.id ?? "0");
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const scopeKey = `${encodeURIComponent(ownerId)}:${groupId}`;
  const scopeRef = useRef(scopeKey);
  const { t } = useLocalization();
  const [memberState, setMembers] = useState<GroupMember[]>([]);
  const [settingsState, setSettings] = useState<GroupNotificationSettings | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const settings = loadedScope === scopeKey ? settingsState : null;
  const [query, setQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [isLoading, setLoading] = useState(true);
  const [isUpdating, setUpdating] = useState(false);

  useEffect(() => {
    scopeRef.current = scopeKey;
  }, [scopeKey]);

  useEffect(() => {
    let active = true;
    const requestScope = scopeKey;
    queueMicrotask(() => {
      if (active && scopeRef.current === requestScope) {
        setLoading(true);
        setUpdating(false);
      }
    });
    if (!ownerId || groupId <= 0) {
      queueMicrotask(() => {
        if (active && scopeRef.current === requestScope) setLoading(false);
      });
      return () => {
        active = false;
      };
    }
    void Promise.all([getGroupDetail(groupId), getGroupNotificationSettings(groupId)])
      .then(([detail, nextSettings]) => {
        if (!active || scopeRef.current !== requestScope) return;
        const seen = new Set<string>();
        setMembers(
          detail.members.filter(
            (member) =>
              member.user_id !== ownerId && !seen.has(member.user_id) && seen.add(member.user_id),
          ),
        );
        setSettings(nextSettings);
        setLoadedScope(requestScope);
      })
      .catch((error: unknown) => {
        if (!active || scopeRef.current !== requestScope) return;
        Alert.alert(
          t("common.error"),
          groupDetailErrorMessage(error, t, t("group.notifications.loadFailed")),
        );
      })
      .finally(() => {
        if (active && scopeRef.current === requestScope) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [groupId, ownerId, scopeKey, t]);

  useEffect(() => {
    const subscriptionScope = scopeKey;
    return subscribeGroupDetail(ownerId, (updated) => {
      if (scopeRef.current === subscriptionScope && updated.group_id === groupId) {
        setSettings(updated.notification_settings);
        setLoadedScope(subscriptionScope);
      }
    });
  }, [groupId, ownerId, scopeKey]);

  const filtered = useMemo(() => {
    const members = loadedScope === scopeKey ? memberState : [];
    const needle = trimFoundationWhitespacesAndNewlines(query).toLocaleLowerCase();
    if (!needle) return members;
    return members.filter((member) =>
      `${member.nickname} ${member.user_id}`.toLocaleLowerCase().includes(needle),
    );
  }, [loadedScope, memberState, query, scopeKey]);

  const toggle = async (member: GroupMember) => {
    if (!settings || isUpdating) return;
    const operationScope = scopeKey;
    const selected = settings.important_member_ids.includes(member.user_id);
    if (!selected && settings.important_member_ids.length >= groupImportantMemberLimit) return;
    const previous = settings;
    const ids = selected
      ? settings.important_member_ids.filter((id) => id !== member.user_id)
      : [...settings.important_member_ids, member.user_id];
    setSettings({ ...settings, important_member_ids: ids });
    setUpdating(true);
    try {
      const saved = await updateGroupNotificationSettings(groupId, { importantMemberIds: ids });
      if (scopeRef.current !== operationScope) return;
      setSettings(saved);
      await applyGroupNotificationSettingsUpdate(ownerId, saved);
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      setSettings(previous);
      Alert.alert(
        t("common.error"),
        groupDetailErrorMessage(error, t, t("group.notifications.updateFailed")),
      );
    } finally {
      if (scopeRef.current === operationScope) setUpdating(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: t("group.notifications.importantMembers"),
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: colors.text,
          headerRight: () => (
            <Pressable
              accessibilityLabel={t("group.notifications.search")}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                setSearchVisible((visible) => !visible);
                if (searchVisible) setQuery("");
              }}
            >
              <SymbolView name="magnifyingglass" size={17} tintColor={colors.text} />
            </Pressable>
          ),
        }}
      />
      {searchVisible ? (
        <View style={styles.searchRow}>
          <SymbolView name="magnifyingglass" size={16} tintColor={colors.secondaryText} />
          <TextInput
            autoFocus
            onChangeText={setQuery}
            placeholder={t("group.notifications.search")}
            placeholderTextColor={colors.secondaryText}
            style={styles.searchInput}
            value={query}
          />
        </View>
      ) : null}
      {settings && settings.important_member_ids.length >= groupImportantMemberLimit ? (
        <Text style={styles.limit}>{t("group.notifications.limit")}</Text>
      ) : null}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={filtered}
          keyExtractor={(member) => member.user_id}
          renderItem={({ index, item }) => {
            const selected = settings?.important_member_ids.includes(item.user_id) ?? false;
            const disabled =
              isUpdating ||
              (!selected &&
                (settings?.important_member_ids.length ?? 0) >= groupImportantMemberLimit);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                onPress={() => void toggle(item)}
                style={({ pressed }) => [
                  styles.memberRow,
                  index === 0 && styles.firstMemberRow,
                  index === filtered.length - 1 && styles.lastMemberRow,
                  disabled && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <UserAvatarButton
                  accessibilityName={groupMemberDisplayName(item)}
                  avatarUrl={item.avatar_url}
                  size={40}
                  userId={item.user_id}
                />
                <View style={styles.memberText}>
                  <Text numberOfLines={1} style={styles.memberName}>
                    {item.nickname}
                  </Text>
                  <Text numberOfLines={1} style={styles.memberID}>
                    {item.user_id}
                  </Text>
                </View>
                {selected ? (
                  <SymbolView name="checkmark.circle.fill" size={20} tintColor={colors.accent} />
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  limit: { paddingHorizontal: 16, paddingVertical: 8, color: colors.secondaryText, fontSize: 13 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  searchRow: {
    minHeight: 40,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
    backgroundColor: colors.card,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 8 },
  listContent: { paddingHorizontal: 16 },
  memberRow: {
    minHeight: 70,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  firstMemberRow: { borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  lastMemberRow: {
    borderBottomWidth: 0,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  memberText: { flex: 1, rowGap: 2 },
  memberName: { color: colors.text, fontSize: 17 },
  memberID: { color: colors.tertiaryText, fontSize: 12 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.68 },
});
