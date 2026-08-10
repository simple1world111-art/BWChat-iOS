import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";

import { getGroupDetail } from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";
import type { CallType, GroupMember } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  groupMemberDisplayName,
  loadCachedGroupDetail,
  saveCachedGroupDetail,
} from "@/services/groups/GroupDetailRepository";
import { normalizeMentionMembers } from "@/services/messages/chatMentionPolicy";
import { colors } from "@/theme";

export function GroupCallMemberPicker({
  callType,
  groupId,
  initialMembers,
  onClose,
  onConfirm,
}: {
  callType: CallType;
  groupId: number;
  initialMembers: GroupMember[];
  onClose: () => void;
  onConfirm: (inviteeUserIds: string[]) => void;
}) {
  const { user } = useAuth();
  const { t } = useLocalization();
  const ownerId = user?.user_id;
  const initial = useMemo(
    () => normalizeMentionMembers(initialMembers, ownerId),
    [initialMembers, ownerId],
  );
  const [members, setMembers] = useState<GroupMember[]>(initial);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [isLoading, setLoading] = useState(Boolean(ownerId && groupId > 0 && initial.length === 0));
  const [error, setError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!ownerId || groupId <= 0) return;
    void (async () => {
      let hasFallback = initial.length > 0;
      setLoading(true);
      setError(null);
      if (loadRevision === 0) {
        const cached = await loadCachedGroupDetail(ownerId, groupId);
        if (!cancelled && cached) {
          const cachedMembers = normalizeMentionMembers(cached.members, ownerId);
          hasFallback = cachedMembers.length > 0;
          setMembers(cachedMembers);
        }
      }
      try {
        const detail = await getGroupDetail(groupId);
        await saveCachedGroupDetail(ownerId, detail);
        if (!cancelled) setMembers(normalizeMentionMembers(detail.members, ownerId));
      } catch {
        if (!cancelled && !hasFallback) setError(t("group.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, initial.length, loadRevision, ownerId, t]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return members;
    return members.filter((member) =>
      `${groupMemberDisplayName(member)} ${member.nickname} ${member.user_id}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [members, query]);
  const selectedCount = useMemo(
    () => members.filter((member) => selectedIds.has(member.user_id)).length,
    [members, selectedIds],
  );

  const toggle = (userId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const confirm = () => {
    const inviteeUserIds = members
      .map((member) => member.user_id)
      .filter((userId) => selectedIds.has(userId));
    if (inviteeUserIds.length > 0) onConfirm(inviteeUserIds);
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
          <View style={styles.header}>
            <Pressable hitSlop={8} onPress={onClose} style={styles.headerActionButton}>
              <Text style={styles.headerAction}>{t("common.cancel")}</Text>
            </Pressable>
            <View style={styles.headerTitle}>
              <Text numberOfLines={1} style={styles.title}>
                {t(callType === "video" ? "call.video" : "call.voice")}
              </Text>
              <Text style={styles.subtitle}>{t("group.selectMembers.count", members.length)}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={selectedCount === 0}
              hitSlop={8}
              onPress={confirm}
              style={styles.headerActionButton}
            >
              <Text
                style={[
                  styles.headerAction,
                  styles.headerTrailing,
                  selectedCount === 0 && styles.disabledAction,
                ]}
              >
                {t("common.confirm")}
              </Text>
            </Pressable>
          </View>

          <View style={styles.searchBar}>
            <SymbolView name="magnifyingglass" size={15} tintColor={colors.tertiaryText} />
            <TextInput
              onChangeText={setQuery}
              placeholder={t("group.members.search")}
              placeholderTextColor={colors.tertiaryText}
              style={styles.searchInput}
              value={query}
            />
          </View>

          {selectedCount > 0 ? (
            <Text style={styles.selectedCount}>
              {t("group.selectedMembers.count", selectedCount)}
            </Text>
          ) : null}

          {isLoading && members.length === 0 ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : null}
          {error && members.length === 0 ? (
            <View style={styles.center}>
              <SymbolView
                name="exclamationmark.arrow.triangle.2.circlepath"
                size={32}
                tintColor={colors.secondaryText}
              />
              <Text style={styles.emptyText}>{error}</Text>
              <Pressable
                onPress={() => setLoadRevision((value) => value + 1)}
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>{t("common.retry")}</Text>
              </Pressable>
            </View>
          ) : null}
          {!isLoading && !error && filtered.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyText}>{t("mention.noResults")}</Text>
            </View>
          ) : null}
          {members.length > 0 ? (
            <FlatList
              data={filtered}
              keyExtractor={(member) => member.user_id}
              keyboardShouldPersistTaps="handled"
              refreshControl={
                <RefreshControl
                  onRefresh={() => setLoadRevision((value) => value + 1)}
                  refreshing={isLoading}
                  tintColor={colors.accent}
                />
              }
              renderItem={({ item }) => {
                const selected = selectedIds.has(item.user_id);
                const displayName = groupMemberDisplayName(item);
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    onPress={() => toggle(item.user_id)}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  >
                    <Avatar name={displayName} size={42} uri={item.avatar_url} />
                    <View style={styles.rowText}>
                      <Text numberOfLines={1} style={styles.name}>
                        {displayName}
                      </Text>
                      {displayName !== item.user_id ? (
                        <Text numberOfLines={1} style={styles.userId}>
                          {item.user_id}
                        </Text>
                      ) : null}
                    </View>
                    <SymbolView
                      name={selected ? "checkmark.circle.fill" : "circle"}
                      size={23}
                      tintColor={selected ? colors.accent : colors.tertiaryText}
                    />
                  </Pressable>
                );
              }}
            />
          ) : null}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 54,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
  },
  headerTitle: { flex: 1, alignItems: "center", rowGap: 1 },
  title: { color: colors.text, fontSize: 17, fontWeight: "600" },
  subtitle: { color: colors.secondaryText, fontSize: 11 },
  headerActionButton: { minWidth: 58, minHeight: 44, justifyContent: "center" },
  headerAction: { minWidth: 58, color: colors.accent, fontSize: 15 },
  headerTrailing: { textAlign: "right", fontWeight: "600" },
  disabledAction: { opacity: 0.35 },
  searchBar: {
    height: 38,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 7,
    backgroundColor: "#E9E9EE",
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  selectedCount: {
    paddingHorizontal: 16,
    paddingBottom: 6,
    color: colors.accent,
    fontSize: 13,
    fontWeight: "500",
  },
  center: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center", rowGap: 14 },
  emptyText: { color: colors.secondaryText, fontSize: 14, textAlign: "center" },
  retryButton: {
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  retryText: { color: colors.white, fontSize: 14, fontWeight: "600" },
  row: {
    minHeight: 62,
    paddingHorizontal: 16,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    backgroundColor: colors.card,
  },
  pressed: { opacity: 0.68 },
  rowText: { flex: 1, rowGap: 2 },
  name: { color: colors.text, fontSize: 16, fontWeight: "500" },
  userId: { color: colors.tertiaryText, fontSize: 12 },
});
