import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";

import { getGroupDetail } from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import type { GroupMember } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { loadCachedGroupDetail, saveCachedGroupDetail } from "@/services/groups/GroupDetailRepository";
import {
  mentionSelectionId,
  normalizeMentionMembers,
  type ChatMentionSelection,
} from "@/services/messages/chatMentionPolicy";
import { colors } from "@/theme";

export function ChatMentionPicker({
  groupId,
  allowsMentionAll,
  initialMembers,
  onClose,
  onSelect,
}: {
  groupId: number;
  allowsMentionAll: boolean;
  initialMembers: GroupMember[];
  onClose: () => void;
  onSelect: (selections: ChatMentionSelection[]) => void;
}) {
  const { user } = useAuth();
  const { t } = useLocalization();
  const initial = useMemo(() => normalizeMentionMembers(initialMembers, user?.user_id), [initialMembers, user?.user_id]);
  const [members, setMembers] = useState<GroupMember[]>(initial);
  const [query, setQuery] = useState("");
  const [isMultiSelecting, setMultiSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setLoading] = useState(initial.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const ownerId = user?.user_id;
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
  }, [groupId, initial.length, loadRevision, t, user?.user_id]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? members.filter((member) => member.nickname.toLocaleLowerCase().includes(normalized) || member.user_id.toLocaleLowerCase().includes(normalized))
      : members;
  }, [members, query]);

  const choose = (selection: ChatMentionSelection) => {
    if (!isMultiSelecting) {
      onSelect([selection]);
      return;
    }
    const id = mentionSelectionId(selection);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const finishMultiSelection = () => {
    const selections: ChatMentionSelection[] = [];
    if (selectedIds.has("mention:all")) selections.push({ kind: "all", nickname: t("mention.all") });
    for (const member of members) {
      const selection: ChatMentionSelection = { kind: "direct", user_id: member.user_id, nickname: member.nickname };
      if (selectedIds.has(mentionSelectionId(selection))) selections.push(selection);
    }
    if (selections.length > 0) onSelect(selections);
  };

  const rows: ({ kind: "all" } | { kind: "member"; member: GroupMember })[] = [
    ...(allowsMentionAll && !query.trim() ? [{ kind: "all" as const }] : []),
    ...filtered.map((member) => ({ kind: "member" as const, member })),
  ];

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible>
      <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={onClose}><Text style={styles.headerAction}>{t("common.cancel")}</Text></Pressable>
          <Text style={styles.title}>{t("mention.title")}</Text>
          <Pressable
            disabled={isMultiSelecting && selectedIds.size === 0}
            onPress={() => isMultiSelecting ? finishMultiSelection() : setMultiSelecting(true)}
          >
            <Text style={[styles.headerAction, styles.headerTrailing, isMultiSelecting && selectedIds.size === 0 && styles.disabled]}>{t(isMultiSelecting ? "common.done" : "mention.multiSelect")}</Text>
          </Pressable>
        </View>
        <View style={styles.searchBar}>
          <SymbolView name="magnifyingglass" size={15} tintColor={colors.tertiaryText} />
          <TextInput onChangeText={setQuery} placeholder={t("mention.search")} placeholderTextColor={colors.tertiaryText} style={styles.searchInput} value={query} />
        </View>
        {isLoading && members.length === 0 ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : null}
        {error && members.length === 0 ? (
          <View style={styles.center}>
            <SymbolView name="exclamationmark.arrow.triangle.2.circlepath" size={32} tintColor={colors.secondaryText} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => setLoadRevision((value) => value + 1)} style={styles.retryButton}><Text style={styles.retryText}>{t("common.retry")}</Text></Pressable>
          </View>
        ) : null}
        {!isLoading && !error && rows.length === 0 && query.trim() ? <View style={styles.center}><Text style={styles.errorText}>{t("mention.noResults")}</Text></View> : null}
        {members.length > 0 || rows.length > 0 ? (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.kind === "all" ? "mention:all" : `mention:${item.member.user_id}`}
            refreshControl={<RefreshControl onRefresh={() => setLoadRevision((value) => value + 1)} refreshing={isLoading} tintColor={colors.accent} />}
            renderItem={({ item }) => item.kind === "all" ? (
              <MentionRow
                checked={selectedIds.has("mention:all")}
                isMultiSelecting={isMultiSelecting}
                name={t("mention.all")}
                onPress={() => choose({ kind: "all", nickname: t("mention.all") })}
              />
            ) : (
              <MentionRow
                avatarUrl={item.member.avatar_url}
                checked={selectedIds.has(`mention:${item.member.user_id}`)}
                isMultiSelecting={isMultiSelecting}
                name={item.member.nickname}
                onPress={() => choose({ kind: "direct", user_id: item.member.user_id, nickname: item.member.nickname })}
                userId={item.member.user_id}
              />
            )}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function MentionRow({ avatarUrl, name, userId, isMultiSelecting, checked, onPress }: { avatarUrl?: string | undefined; name: string; userId?: string | undefined; isMultiSelecting: boolean; checked: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      {userId
        ? <Avatar name={name} size={38} uri={avatarUrl} />
        : <View style={styles.allAvatar}><SymbolView name="person.3.fill" size={16} tintColor={colors.accent} weight="semibold" /></View>}
      <View style={styles.rowText}>
        <Text style={styles.name}>{name}</Text>
        {userId && name !== userId ? <Text style={styles.userId}>{userId}</Text> : null}
      </View>
      {isMultiSelecting ? <SymbolView name={checked ? "checkmark.circle.fill" : "circle"} size={21} tintColor={checked ? colors.accent : colors.tertiaryText} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { height: 48, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.card },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  headerAction: { minWidth: 58, color: colors.accent, fontSize: 15 },
  headerTrailing: { textAlign: "right" },
  disabled: { opacity: 0.35 },
  searchBar: { height: 38, marginHorizontal: 12, marginVertical: 8, paddingHorizontal: 10, borderRadius: 10, flexDirection: "row", alignItems: "center", columnGap: 7, backgroundColor: "#E9E9EE" },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  center: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center", rowGap: 14 },
  errorText: { color: colors.secondaryText, fontSize: 14, textAlign: "center" },
  retryButton: { minHeight: 36, paddingHorizontal: 16, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  retryText: { color: colors.white, fontSize: 14, fontWeight: "600" },
  row: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 2, flexDirection: "row", alignItems: "center", columnGap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, backgroundColor: colors.card },
  allAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(102,126,234,0.14)" },
  rowText: { flex: 1, rowGap: 2 },
  name: { color: colors.text, fontSize: 16, fontWeight: "500" },
  userId: { color: colors.tertiaryText, fontSize: 12 },
});
