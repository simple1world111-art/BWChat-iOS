import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createIdempotencyKey, forwardMessages, getForwardBundle, getFriendList, getGroups } from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import { GroupAvatarIcon } from "@/components/GroupAvatarIcon";
import { GroupMemberAvatar } from "@/components/GroupMemberAvatar";
import type {
  ForwardBundle,
  ForwardBundleMessagePayload,
  ForwardMessageSource,
  ForwardMode,
  ForwardTarget,
} from "@/models";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  chatForwardGeometry,
  forwardTargetKey,
  sortForwardTargets,
  toggleForwardTarget,
} from "@/services/messages/chatForwardPolicy";
import { colors } from "@/theme";

export function ChatSelectionIndicator({ selected }: { selected: boolean }) {
  const { t } = useLocalization();
  return (
    <View accessibilityLabel={t(selected ? "selection.selected" : "selection.notSelected")} style={styles.selectionHitArea}>
      <SymbolView
        name={selected ? "checkmark.circle.fill" : "circle"}
        size={chatForwardGeometry.selection_indicator_size}
        weight="regular"
        tintColor={selected ? colors.accent : colors.tertiaryText}
      />
    </View>
  );
}

export function ChatSelectionToolbar({
  count,
  showsForward,
  onForward,
  onDelete,
}: {
  count: number;
  showsForward: boolean;
  onForward: () => void;
  onDelete: () => void;
}) {
  const { t } = useLocalization();
  return (
    <View style={styles.selectionToolbar}>
      {showsForward ? (
        <SelectionAction disabled={count === 0} icon="arrowshape.turn.up.right" onPress={onForward} title={t("chat.action.forward")} />
      ) : null}
      <SelectionAction destructive disabled={count === 0} icon="trash" onPress={onDelete} title={t("common.delete")} />
    </View>
  );
}

export function ForwardBundleMessageCard({
  payload,
  isFromMe,
  onPress,
}: {
  payload: ForwardBundleMessagePayload;
  isFromMe: boolean;
  onPress: () => void;
}) {
  const { t } = useLocalization();
  return (
    <Pressable accessibilityLabel={`${payload.title}，${payload.item_count}`} onPress={onPress} style={[styles.bundleCard, isFromMe && styles.mineBundleCard]}>
      <View style={styles.bundleTitleRow}>
        <SymbolView name="bubble.left.and.bubble.right.fill" size={18} tintColor={colors.accent} />
        <Text numberOfLines={1} style={styles.bundleTitle}>{payload.title}</Text>
      </View>
      <Text numberOfLines={3} style={styles.bundleSummary}>{payload.summary}</Text>
      <View style={styles.bundleDivider} />
      <Text style={styles.bundleCount}>{t("forward.chatRecordCount", payload.item_count)}</Text>
    </Pressable>
  );
}

export function ForwardFlowModal({
  mode,
  sources,
  preview,
  visible,
  onClose,
  onCompleted,
}: {
  mode: ForwardMode;
  sources: ForwardMessageSource[];
  preview: string;
  visible: boolean;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const { t } = useLocalization();
  const [targets, setTargets] = useState<ForwardTarget[]>([]);
  const [query, setQuery] = useState("");
  const [isMultiTarget, setMultiTarget] = useState(false);
  const [selected, setSelected] = useState<ForwardTarget[]>([]);
  const [confirmationTargets, setConfirmationTargets] = useState<ForwardTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? targets.filter((target) => target.display_name.toLocaleLowerCase().includes(normalized)) : targets;
  }, [query, targets]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      setQuery("");
      setMultiTarget(false);
      setSelected([]);
      setConfirmationTargets([]);
      setError(null);
      setLoading(true);
      void Promise.allSettled([getFriendList(), getGroups()]).then(([friendsResult, groupsResult]) => {
        if (cancelled) return;
        const nextTargets = [
          ...(friendsResult.status === "fulfilled" ? friendsResult.value : []).map((friend): ForwardTarget => ({ conversation_type: "dm", conversation_id: friend.user_id, display_name: friend.nickname, avatar_url: friend.avatar_url })),
          ...(groupsResult.status === "fulfilled" ? groupsResult.value : []).map((group): ForwardTarget => ({ conversation_type: "group", conversation_id: String(group.group_id), display_name: group.name, avatar_url: group.avatar_url })),
        ];
        const failure = friendsResult.status === "rejected" ? friendsResult.reason : groupsResult.status === "rejected" ? groupsResult.reason : null;
        const message = failure instanceof Error ? failure.message : failure ? t("common.loadFailed") : null;
        setTargets(nextTargets);
        setError(message);
        if (message && nextTargets.length > 0) Alert.alert(t("common.error"), message);
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [loadRevision, t, visible]);

  const selectTarget = (target: ForwardTarget) => {
    if (!isMultiTarget) {
      setConfirmationTargets([target]);
      return;
    }
    const result = toggleForwardTarget(selected, target);
    if (!result.accepted) {
      Alert.alert(t("common.error"), t("forward.maximum9"));
      return;
    }
    setSelected(result.targets);
  };

  const submit = async () => {
    if (sending || confirmationTargets.length === 0) return;
    setSending(true);
    try {
      const clientOperationId = createIdempotencyKey();
      await forwardMessages({
        client_operation_id: clientOperationId,
        mode,
        sources,
        targets: confirmationTargets.map((target) => ({
          conversation_type: target.conversation_type,
          conversation_id: target.conversation_id,
        })),
      });
      setConfirmationTargets([]);
      onCompleted();
      onClose();
    } catch (nextError) {
      setConfirmationTargets([]);
      Alert.alert(t("common.error"), nextError instanceof Error ? nextError.message : t("messages.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={visible}>
      <SafeAreaView edges={["top", "bottom"]} style={styles.forwardScreen}>
        <View style={styles.forwardHeader}>
          <Pressable onPress={onClose}><Text style={styles.headerAction}>{t("common.cancel")}</Text></Pressable>
          <Text style={styles.headerTitle}>{t("forward.chooseChat")}</Text>
          {isMultiTarget ? (
            <Pressable disabled={selected.length === 0} onPress={() => setConfirmationTargets(sortForwardTargets(selected))}>
              <Text style={[styles.headerAction, selected.length === 0 && styles.disabledText]}>{t("common.done")}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setMultiTarget(true)}><Text style={styles.headerAction}>{t("chat.action.multiSelect")}</Text></Pressable>
          )}
        </View>
        <View style={styles.searchBar}>
          <SymbolView name="magnifyingglass" size={15} tintColor={colors.tertiaryText} />
          <TextInput onChangeText={setQuery} placeholder={t("forward.searchChats")} placeholderTextColor={colors.tertiaryText} style={styles.searchInput} value={query} />
        </View>
        {loading ? <View style={styles.centerState}><ActivityIndicator color={colors.accent} /></View> : null}
        {!loading && error && targets.length === 0 ? (
          <View style={styles.centerState}>
            <SymbolView name="wifi.exclamationmark" size={34} tintColor={colors.tertiaryText} />
            <Text style={styles.stateTitle}>{t("common.loadFailed")}</Text>
            <Text style={styles.stateMessage}>{error}</Text>
            <Pressable onPress={() => setLoadRevision((value) => value + 1)} style={styles.retryButton}><Text style={styles.retryButtonText}>{t("common.retry")}</Text></Pressable>
          </View>
        ) : null}
        {!loading && !error && filtered.length === 0 ? (
          <View style={styles.centerState}>
            <SymbolView name="magnifyingglass" size={34} tintColor={colors.tertiaryText} />
            <Text style={styles.stateTitle}>{t("forward.chooseChat")}</Text>
            {query ? <Text style={styles.stateMessage}>{query}</Text> : null}
          </View>
        ) : null}
        <FlatList
          data={filtered}
          keyExtractor={forwardTargetKey}
          renderItem={({ item }) => {
            const checked = selected.some((target) => forwardTargetKey(target) === forwardTargetKey(item));
            const numericGroupId = item.conversation_type === "group" ? Number(item.conversation_id) : Number.NaN;
            return (
              <Pressable onPress={() => selectTarget(item)} style={styles.targetRow}>
                {item.conversation_type === "group"
                  ? Number.isInteger(numericGroupId) && numericGroupId > 0
                    ? <GroupMemberAvatar groupId={numericGroupId} size={42} />
                    : <GroupAvatarIcon size={42} />
                  : <Avatar name={item.display_name} size={42} uri={item.avatar_url} />}
                <Text numberOfLines={1} style={styles.targetName}>{item.display_name}</Text>
                {isMultiTarget ? <SymbolView name={checked ? "checkmark.circle.fill" : "circle"} size={22} tintColor={checked ? colors.accent : colors.tertiaryText} /> : null}
              </Pressable>
            );
          }}
        />
        {confirmationTargets.length > 0 ? (
          <View style={styles.confirmationBackdrop}>
            <Pressable disabled={sending} onPress={() => setConfirmationTargets([])} style={StyleSheet.absoluteFill} />
            <View style={styles.confirmationCard}>
              <View style={styles.confirmationHandle} />
              <Text numberOfLines={2} style={styles.confirmationTitle}>{confirmationTargets.map((target) => target.display_name).join("、")}</Text>
              <Text numberOfLines={3} style={styles.confirmationPreview}>{preview}</Text>
              <View style={styles.confirmationActions}>
                <Pressable disabled={sending} onPress={() => setConfirmationTargets([])} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t("common.cancel")}</Text></Pressable>
                <Pressable disabled={sending} onPress={() => void submit()} style={styles.primaryButton}>{sending ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>{t("common.send")}</Text>}</Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

export function ForwardBundleDetailModal({ bundleId, onClose }: { bundleId: string | null; onClose: () => void }) {
  const { t } = useLocalization();
  const [bundle, setBundle] = useState<ForwardBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  useEffect(() => {
    if (!bundleId) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      setBundle(null);
      setError(null);
      void getForwardBundle(bundleId).then((nextBundle) => {
        if (!cancelled) setBundle(nextBundle);
      }).catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : t("common.loadFailed"));
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [bundleId, loadRevision, t]);
  return (
    <Modal animationType="slide" onRequestClose={onClose} visible={bundleId !== null}>
      <SafeAreaView edges={["top", "bottom"]} style={styles.forwardScreen}>
        <View style={styles.forwardHeader}>
          <Pressable onPress={onClose}><Text style={styles.headerAction}>{t("common.close")}</Text></Pressable>
          <Text numberOfLines={1} style={styles.headerTitle}>{bundle?.title ?? t("forward.chooseChat")}</Text>
          <View style={styles.headerPlaceholder} />
        </View>
        {!bundle && !error ? <View style={styles.centerState}><ActivityIndicator color={colors.accent} /></View> : null}
        {error ? <View style={styles.centerState}><SymbolView name="exclamationmark.triangle" size={34} tintColor={colors.tertiaryText} /><Text style={styles.stateTitle}>{t("common.loadFailed")}</Text><Text style={styles.stateMessage}>{error}</Text><Pressable onPress={() => setLoadRevision((value) => value + 1)} style={styles.retryButton}><Text style={styles.retryButtonText}>{t("common.retry")}</Text></Pressable></View> : null}
        {bundle ? (
          <ScrollView>
            {bundle.items.map((item) => (
              <View key={item.ordinal} style={styles.bundleDetailRow}>
                <View style={styles.bundleDetailHeader}><Text style={styles.bundleDetailSender}>{item.sender_name}</Text><Text style={styles.bundleDetailTime}>{formatForwardTime(item.sent_at)}</Text></View>
                <Text style={styles.bundleDetailSummary}>{item.message_type === "voice" ? t("message.voice") : item.summary}</Text>
              </View>
            ))}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function SelectionAction({ title, icon, disabled, destructive = false, onPress }: { title: string; icon: "arrowshape.turn.up.right" | "trash"; disabled: boolean; destructive?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.selectionAction, disabled && styles.disabledAction]}>
      <SymbolView name={icon} size={20} tintColor={destructive ? colors.danger : colors.accent} />
      <Text style={[styles.selectionActionText, destructive && styles.destructiveText]}>{title}</Text>
    </Pressable>
  );
}

function formatForwardTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

const styles = StyleSheet.create({
  selectionHitArea: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  selectionToolbar: { height: 58, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator, flexDirection: "row", backgroundColor: "rgba(255,255,255,0.94)" },
  selectionAction: { flex: 1, alignItems: "center", justifyContent: "center", rowGap: 4 },
  disabledAction: { opacity: 0.35 },
  selectionActionText: { color: colors.accent, fontSize: 12 },
  destructiveText: { color: colors.danger },
  bundleCard: { width: 230, padding: 12, borderRadius: 12, rowGap: 10, backgroundColor: colors.card },
  mineBundleCard: { backgroundColor: "rgba(255,255,255,0.96)" },
  bundleTitleRow: { flexDirection: "row", alignItems: "center", columnGap: 8 },
  bundleTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "600" },
  bundleSummary: { color: colors.secondaryText, fontSize: 13, lineHeight: 18 },
  bundleDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  bundleCount: { color: colors.tertiaryText, fontSize: 12 },
  forwardScreen: { flex: 1, backgroundColor: colors.background },
  forwardHeader: { height: 48, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.card },
  headerAction: { minWidth: 54, color: colors.accent, fontSize: 15 },
  headerTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  headerPlaceholder: { width: 54 },
  disabledText: { opacity: 0.35 },
  searchBar: { height: 38, marginHorizontal: 12, marginVertical: 8, paddingHorizontal: 10, borderRadius: 10, flexDirection: "row", alignItems: "center", columnGap: 7, backgroundColor: "#E9E9EE" },
  searchInput: { flex: 1, color: colors.text, fontSize: 15 },
  centerState: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center", rowGap: 12 },
  stateTitle: { color: colors.text, fontSize: 17, fontWeight: "600" },
  stateMessage: { color: colors.secondaryText, fontSize: 14, textAlign: "center" },
  retryButton: { minHeight: 36, paddingHorizontal: 16, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  retryButtonText: { color: colors.white, fontSize: 14, fontWeight: "600" },
  targetRow: { minHeight: 52, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", columnGap: 12, backgroundColor: colors.card },
  targetName: { flex: 1, color: colors.text, fontSize: 16 },
  confirmationBackdrop: { position: "absolute", inset: 0, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.22)" },
  confirmationCard: { height: 310, paddingHorizontal: 20, paddingBottom: 20, alignItems: "center", rowGap: 16, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: colors.card },
  confirmationHandle: { width: 36, height: 5, marginTop: 8, borderRadius: 3, backgroundColor: colors.separator },
  confirmationTitle: { color: colors.text, fontSize: 16, fontWeight: "600", textAlign: "center" },
  confirmationPreview: { width: "100%", padding: 12, borderRadius: 10, color: colors.secondaryText, fontSize: 14, backgroundColor: colors.background },
  confirmationActions: { flexDirection: "row", columnGap: 12 },
  secondaryButton: { minWidth: 104, height: 44, borderWidth: 1, borderColor: colors.separator, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  primaryButton: { minWidth: 104, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  primaryButtonText: { color: colors.white, fontSize: 15, fontWeight: "600" },
  bundleDetailRow: { paddingHorizontal: 16, paddingVertical: 12, rowGap: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, backgroundColor: colors.card },
  bundleDetailHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  bundleDetailSender: { color: colors.text, fontSize: 14, fontWeight: "600" },
  bundleDetailTime: { color: colors.tertiaryText, fontSize: 12 },
  bundleDetailSummary: { color: colors.text, fontSize: 15 },
});
