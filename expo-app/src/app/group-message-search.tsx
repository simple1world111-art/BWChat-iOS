import {
  Button as SwiftUIButton,
  DatePicker,
  Form,
  Host,
  Picker,
  Section,
  Text as SwiftUIText,
  Toggle,
} from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getGroupDetail, searchGroupMessages } from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { Avatar } from "@/components/Avatar";
import type { GroupMember, GroupMessageSearchResult } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  groupMemberDisplayName,
  loadCachedGroupDetail,
  saveCachedGroupDetail,
} from "@/services/groups/GroupDetailRepository";
import { groupDetailErrorMessage } from "@/services/groups/GroupDetailPolicy";
import { requestGroupMessageLocation } from "@/services/messages/GroupMessageLocatorBus";
import {
  appendUniqueGroupMessageSearchResults,
  groupMessageSearchDateRange,
  groupMessageSearchPreview,
  groupMessageSearchTypeTitleKey,
  groupSearchMessageTypes,
  hasActiveGroupMessageSearchFilters,
  hasGroupMessageSearchInput,
  initialGroupMessageSearchFilters,
  type GroupMessageSearchFilters,
  type GroupSearchMessageType,
} from "@/services/messages/groupMessageSearchPolicy";
import { colors } from "@/theme";

export default function GroupMessageSearchScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = Number(params.id ?? "0");
  const { user } = useAuth();
  const { t } = useLocalization();
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [filters, setFilters] = useState<GroupMessageSearchFilters>(() =>
    initialGroupMessageSearchFilters(),
  );
  const [results, setResults] = useState<GroupMessageSearchResult[]>([]);
  const [resultsScope, setResultsScope] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const requestRevision = useRef(0);
  const loadingMoreRef = useRef(false);
  const ownerId = user?.user_id ?? "";
  const scopeKey = `${encodeURIComponent(ownerId)}:${groupId}`;
  const scopeRef = useRef(scopeKey);
  const visibleResults = resultsScope === scopeKey ? results : [];
  const hasInput = hasGroupMessageSearchInput(query, filters);
  const hasFilters = hasActiveGroupMessageSearchFilters(filters);

  useEffect(() => {
    scopeRef.current = scopeKey;
  }, [scopeKey]);

  useEffect(() => {
    let active = true;
    if (!ownerId || !Number.isInteger(groupId) || groupId <= 0)
      return () => {
        active = false;
      };
    void (async () => {
      const cached = await loadCachedGroupDetail(ownerId, groupId);
      if (active && cached) setMembers(cached.members);
      try {
        const detail = await getGroupDetail(groupId);
        if (!active) return;
        setMembers(detail.members);
        await saveCachedGroupDetail(ownerId, detail);
      } catch {
        // Cached members keep the filter useful while offline.
      }
    })();
    return () => {
      active = false;
    };
  }, [groupId, ownerId]);

  useEffect(() => {
    const revision = ++requestRevision.current;
    const requestScope = scopeKey;
    if (!ownerId || !hasInput || !Number.isInteger(groupId) || groupId <= 0) {
      queueMicrotask(() => {
        if (revision !== requestRevision.current || scopeRef.current !== requestScope) return;
        setResults([]);
        setResultsScope(requestScope);
        setNextCursor(null);
        setLoading(false);
      });
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      const range = groupMessageSearchDateRange(filters);
      void searchGroupMessages(groupId, {
        query: trimFoundationWhitespacesAndNewlines(query),
        ...(filters.senderId ? { senderId: filters.senderId } : {}),
        ...(filters.messageType ? { messageType: filters.messageType } : {}),
        ...range,
      })
        .then((page) => {
          if (revision !== requestRevision.current || scopeRef.current !== requestScope) return;
          setResults(page.results);
          setResultsScope(requestScope);
          setNextCursor(page.has_more ? (page.next_cursor ?? null) : null);
        })
        .catch((error: unknown) => {
          if (revision !== requestRevision.current || scopeRef.current !== requestScope) return;
          Alert.alert(
            t("common.error"),
            groupDetailErrorMessage(error, t, t("common.operationFailed")),
          );
        })
        .finally(() => {
          if (revision === requestRevision.current && scopeRef.current === requestScope) {
            setLoading(false);
          }
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [filters, groupId, hasInput, ownerId, query, scopeKey, t]);

  const loadMore = useCallback(async () => {
    const operationScope = scopeKey;
    if (!nextCursor || resultsScope !== operationScope || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const cursor = nextCursor;
    try {
      const page = await searchGroupMessages(groupId, {
        query: trimFoundationWhitespacesAndNewlines(query),
        ...(filters.senderId ? { senderId: filters.senderId } : {}),
        ...(filters.messageType ? { messageType: filters.messageType } : {}),
        ...groupMessageSearchDateRange(filters),
        cursor,
      });
      if (cursor !== nextCursor || scopeRef.current !== operationScope) return;
      setResults((current) => appendUniqueGroupMessageSearchResults(current, page.results));
      setNextCursor(page.has_more ? (page.next_cursor ?? null) : null);
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      Alert.alert(
        t("common.error"),
        groupDetailErrorMessage(error, t, t("common.operationFailed")),
      );
    } finally {
      loadingMoreRef.current = false;
      if (scopeRef.current === operationScope) setLoadingMore(false);
    }
  }, [filters, groupId, nextCursor, query, resultsScope, scopeKey, t]);

  const selectResult = useCallback(
    (messageId: number) => {
      requestGroupMessageLocation(groupId, messageId);
      router.dismiss(2);
    },
    [groupId],
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: t("group.search.title"),
          headerSearchBarOptions: {
            hideWhenScrolling: false,
            placeholder: t("group.search.prompt"),
            onChangeText: (event) => setQuery(event.nativeEvent.text),
          },
          headerRight: () => (
            <Pressable
              accessibilityLabel={t("group.search.filters")}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => setShowFilters(true)}
            >
              <SymbolView
                name={
                  hasFilters
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease.circle"
                }
                size={21}
                tintColor={colors.accent}
              />
            </Pressable>
          ),
        }}
      />

      {isLoading ? (
        <CenteredProgress />
      ) : !hasInput ? (
        <SearchPlaceholder symbol="magnifyingglass" text={t("group.search.startHint")} />
      ) : visibleResults.length === 0 ? (
        <SearchPlaceholder symbol="text.magnifyingglass" text={t("group.search.noResults")} />
      ) : (
        <FlatList
          data={visibleResults}
          keyExtractor={(item) => String(item.locator.message_id)}
          renderItem={({ item }) => (
            <SearchResultRow result={item} onPress={() => selectResult(item.locator.message_id)} />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListFooterComponent={isLoadingMore ? <CenteredProgress compact /> : null}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.12}
          keyboardDismissMode="on-drag"
        />
      )}

      <SearchFiltersSheet
        filters={filters}
        members={members}
        onChange={setFilters}
        onClose={() => setShowFilters(false)}
        visible={showFilters}
      />
    </View>
  );
}

function SearchResultRow({
  onPress,
  result,
}: {
  onPress: () => void;
  result: GroupMessageSearchResult;
}) {
  const { t } = useLocalization();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.resultRow, pressed && styles.pressed]}
    >
      <Avatar name={result.message.sender_nickname} size={42} uri={result.message.sender_avatar} />
      <View style={styles.resultBody}>
        <View style={styles.resultHeader}>
          <Text numberOfLines={1} style={styles.senderName}>
            {result.message.sender_nickname}
          </Text>
          <Text style={styles.timestamp}>{formatDetailedDateTime(result.message.timestamp)}</Text>
        </View>
        <Text numberOfLines={3} style={styles.preview}>
          {groupMessageSearchPreview(result, t)}
        </Text>
      </View>
      <SymbolView
        name="chevron.right"
        size={12}
        weight="semibold"
        tintColor={colors.tertiaryText}
        style={styles.chevron}
      />
    </Pressable>
  );
}

function SearchPlaceholder({
  symbol,
  text,
}: {
  symbol: "magnifyingglass" | "text.magnifyingglass";
  text: string;
}) {
  return (
    <View style={styles.placeholder}>
      <SymbolView name={symbol} size={28} tintColor={colors.tertiaryText} />
      <Text style={styles.placeholderText}>{text}</Text>
    </View>
  );
}

function CenteredProgress({ compact = false }: { compact?: boolean }) {
  return (
    <View style={compact ? styles.compactProgress : styles.progress}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

function SearchFiltersSheet({
  filters,
  members,
  onChange,
  onClose,
  visible,
}: {
  filters: GroupMessageSearchFilters;
  members: readonly GroupMember[];
  onChange: (filters: GroupMessageSearchFilters) => void;
  onClose: () => void;
  visible: boolean;
}) {
  const { t } = useLocalization();
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <View style={styles.headerPlaceholder} />
          <Text style={styles.sheetTitle}>{t("group.search.filters")}</Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={styles.doneButton}
          >
            <Text style={styles.doneText}>{t("common.done")}</Text>
          </Pressable>
        </View>
        <Host style={styles.formHost} useViewportSizeMeasurement seedColor={colors.accent}>
          <Form>
            <Section title={t("group.search.sender")}>
              <Picker
                label={t("group.search.sender")}
                modifiers={[pickerStyle("menu")]}
                onSelectionChange={(selection) =>
                  onChange({ ...filters, senderId: typeof selection === "string" ? selection : "" })
                }
                selection={filters.senderId}
              >
                <SwiftUIText modifiers={[tag("")]}>{t("group.search.sender.all")}</SwiftUIText>
                {members.map((member) => (
                  <SwiftUIText key={member.user_id} modifiers={[tag(member.user_id)]}>
                    {groupMemberDisplayName(member)}
                  </SwiftUIText>
                ))}
              </Picker>
            </Section>
            <Section title={t("group.search.type")}>
              <Picker
                label={t("group.search.type")}
                modifiers={[pickerStyle("menu")]}
                onSelectionChange={(selection) =>
                  onChange({
                    ...filters,
                    messageType: isGroupSearchType(selection) ? selection : "",
                  })
                }
                selection={filters.messageType}
              >
                {groupSearchMessageTypes.map((type) => (
                  <SwiftUIText key={type || "all"} modifiers={[tag(type)]}>
                    {t(groupMessageSearchTypeTitleKey(type))}
                  </SwiftUIText>
                ))}
              </Picker>
            </Section>
            <Section>
              <Toggle
                isOn={filters.usesDateRange}
                label={t("group.search.dateRange")}
                onIsOnChange={(usesDateRange) => onChange({ ...filters, usesDateRange })}
              />
              {filters.usesDateRange ? (
                <>
                  <DatePicker
                    displayedComponents={["date"]}
                    onDateChange={(from) => onChange({ ...filters, from })}
                    selection={filters.from}
                    title={t("group.search.from")}
                  />
                  <DatePicker
                    displayedComponents={["date"]}
                    onDateChange={(to) => onChange({ ...filters, to })}
                    selection={filters.to}
                    title={t("group.search.to")}
                  />
                </>
              ) : null}
            </Section>
            <Section>
              <SwiftUIButton
                label={t("group.search.reset")}
                onPress={() =>
                  onChange({ ...filters, senderId: "", messageType: "", usesDateRange: false })
                }
                role="destructive"
              />
            </Section>
          </Form>
        </Host>
      </View>
    </Modal>
  );
}

function isGroupSearchType(value: unknown): value is GroupSearchMessageType {
  return (
    typeof value === "string" && groupSearchMessageTypes.includes(value as GroupSearchMessageType)
  );
}

function formatDetailedDateTime(value: string): string {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.card },
  progress: { paddingVertical: 70, alignItems: "center" },
  compactProgress: { height: 50, alignItems: "center", justifyContent: "center" },
  placeholder: { paddingHorizontal: 30, paddingVertical: 70, alignItems: "center", rowGap: 12 },
  placeholderText: {
    color: colors.secondaryText,
    fontSize: 17,
    lineHeight: 23,
    textAlign: "center",
  },
  resultRow: {
    minHeight: 70,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 12,
    backgroundColor: colors.card,
  },
  resultBody: { flex: 1, rowGap: 5 },
  resultHeader: { flexDirection: "row", alignItems: "center", columnGap: 8 },
  senderName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "500" },
  timestamp: { color: colors.tertiaryText, fontSize: 12 },
  preview: { color: colors.secondaryText, fontSize: 17, lineHeight: 22 },
  chevron: { marginTop: 4 },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 70,
    backgroundColor: colors.separator,
  },
  pressed: { backgroundColor: colors.background },
  sheet: { flex: 1, backgroundColor: colors.background },
  sheetHeader: {
    height: 54,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  headerPlaceholder: { width: 76 },
  sheetTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  doneButton: {
    width: 76,
    height: 54,
    paddingRight: 16,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  doneText: { color: colors.accent, fontSize: 17, fontWeight: "600" },
  formHost: { flex: 1 },
});
