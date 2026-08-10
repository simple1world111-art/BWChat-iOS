import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createIdempotencyKey, getGroupDetail } from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import type {
  ChatMoneyConfiguration,
  ChatMoneyCreationResult,
  ChatMoneyKind,
  ChatMoneyRecipient,
  ChatMoneyRedPacketMode,
} from "@/models";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  loadCachedGroupDetail,
  saveCachedGroupDetail,
} from "@/services/groups/GroupDetailRepository";
import {
  readCachedGiftWalletBalance,
  refreshGiftWalletBalance,
} from "@/services/messages/ChatGiftRepository";
import {
  createChatMoneyRedPacket,
  createChatMoneyTransfer,
  loadChatMoneyConfiguration,
} from "@/services/messages/ChatMoneyRepository";
import {
  chatMoneyTheme,
  defaultChatMoneyLimits,
  normalizeChatMoneyErrorCode,
  sanitizeChatMoneyDigits,
  unavailableChatMoneyConfiguration,
  validateChatMoneyComposer,
} from "@/services/messages/chatMoneyPolicy";

export type ChatMoneyConversationSource =
  | {
    kind: "fixed";
    recipient: ChatMoneyRecipient;
  }
  | {
    kind: "group";
    groupId: number;
    groupName: string;
  };

interface LoadedGroupContext {
  avatarUrl: string;
  recipients: ChatMoneyRecipient[];
}

export function ChatMoneyComposerModal({
  visible,
  ownerId,
  kind,
  source,
  onClose,
  onOpenWallet,
  onCreated,
}: {
  visible: boolean;
  ownerId: string;
  kind: ChatMoneyKind;
  source: ChatMoneyConversationSource;
  onClose: () => void;
  onOpenWallet: () => void;
  onCreated: (result: ChatMoneyCreationResult) => void;
}) {
  const { t } = useLocalization();
  const clientMessageIdRef = useRef(createIdempotencyKey());
  const generationRef = useRef(0);
  const [configuration, setConfiguration] = useState<ChatMoneyConfiguration>(
    unavailableChatMoneyConfiguration,
  );
  const [balance, setBalance] = useState(0);
  const [conversationAvatarUrl, setConversationAvatarUrl] = useState(
    source.kind === "fixed" ? source.recipient.avatar_url : "",
  );
  const [recipients, setRecipients] = useState<ChatMoneyRecipient[]>([]);
  const [recipient, setRecipient] = useState<ChatMoneyRecipient | null>(null);
  const [isRecipientPickerExpanded, setRecipientPickerExpanded] = useState(false);
  const [mode, setMode] = useState<ChatMoneyRedPacketMode>(
    source.kind === "fixed" ? "direct" : "lucky",
  );
  const [amountText, setAmountText] = useState("");
  const [packetCountText, setPacketCountText] = useState("1");
  const [messageText, setMessageText] = useState("");
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const generation = ++generationRef.current;
    clientMessageIdRef.current = createIdempotencyKey();
    const initialMode: ChatMoneyRedPacketMode = source.kind === "fixed" ? "direct" : "lucky";

    void (async () => {
      await Promise.resolve();
      if (generation !== generationRef.current) return;
      setMode(initialMode);
      setAmountText("");
      setPacketCountText("1");
      setMessageText(kind === "red_packet" ? t("chatMoney.redPacket.defaultGreeting") : "");
      setRecipient(source.kind === "fixed" ? source.recipient : null);
      setRecipientPickerExpanded(false);
      setConversationAvatarUrl(source.kind === "fixed" ? source.recipient.avatar_url : "");
      setConfiguration(unavailableChatMoneyConfiguration);
      setErrorMessage(null);
      setLoading(true);
      setSubmitting(false);

      const cachedBalance = await readCachedGiftWalletBalance(ownerId);
      if (generation !== generationRef.current) return;
      if (cachedBalance) setBalance(cachedBalance.gold_coin_balance);

      const groupContextPromise = source.kind === "group"
        ? loadGroupContext(ownerId, source.groupId, generation, generationRef)
        : Promise.resolve<LoadedGroupContext>({
          avatarUrl: source.recipient.avatar_url,
          recipients: [source.recipient],
        });
      const [nextConfiguration, groupContext] = await Promise.all([
        loadChatMoneyConfiguration(ownerId),
        groupContextPromise,
      ]);
      if (generation !== generationRef.current) return;
      setConfiguration(nextConfiguration);
      setConversationAvatarUrl(groupContext.avatarUrl);
      setRecipients(groupContext.recipients);

      try {
        const nextBalance = await refreshGiftWalletBalance(ownerId);
        if (generation === generationRef.current) setBalance(nextBalance.gold_coin_balance);
      } catch {
        // Keep the cached balance visible when a refresh fails.
      } finally {
        if (generation === generationRef.current) setLoading(false);
      }
    })();
  }, [kind, ownerId, source, t, visible]);

  const scope = source.kind === "fixed" ? "dm" as const : "group" as const;
  const requiresRecipient = source.kind === "group"
    && (kind === "transfer" || mode === "exclusive");
  const validation = useMemo(() => validateChatMoneyComposer({
    kind,
    scope,
    mode,
    amountText,
    packetCountText,
    ...(recipient ? { recipientId: recipient.id } : {}),
    spendableBalance: balance,
    memberCount: source.kind === "group" ? recipients.length + 1 : 1,
    limits: configuration.limits ?? defaultChatMoneyLimits,
  }, t), [
    amountText,
    balance,
    configuration.limits,
    kind,
    mode,
    packetCountText,
    recipient,
    recipients.length,
    scope,
    source.kind,
    t,
  ]);
  const featureEnabled = kind === "red_packet"
    ? configuration.red_packet_enabled
    : configuration.transfer_enabled;
  const creationAllowed = featureEnabled
    && configuration.eligibility.eligible
    && validation.canSubmit;
  const headerRecipient = recipient ?? (source.kind === "fixed" ? source.recipient : null);
  const conversationName = source.kind === "fixed" ? source.recipient.name : source.groupName;
  const headerName = headerRecipient?.name ?? conversationName;
  const headerAvatarUrl = headerRecipient?.avatar_url ?? conversationAvatarUrl;

  const selectMode = (nextMode: ChatMoneyRedPacketMode) => {
    Keyboard.dismiss();
    setMode(nextMode);
    setErrorMessage(null);
    if (nextMode === "exclusive") {
      setPacketCountText("1");
    } else {
      setRecipient(null);
      setRecipientPickerExpanded(false);
    }
  };

  const submit = async () => {
    if (!creationAllowed || isLoading || isSubmitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = kind === "red_packet"
        ? await createChatMoneyRedPacket({
          ownerId,
          clientMessageId: clientMessageIdRef.current,
          scope,
          mode,
          totalAmount: validation.totalAmount,
          packetCount: validation.packetCount,
          greeting: messageText.trim() || t("chatMoney.redPacket.defaultGreeting"),
          ...(source.kind === "fixed"
            ? { receiverId: source.recipient.id }
            : { groupId: source.groupId }),
          ...(recipient && mode === "exclusive" ? { recipient } : {}),
          ...(mode === "equal" ? { amountPerPacket: validation.amount } : {}),
        })
        : await createChatMoneyTransfer({
          ownerId,
          clientMessageId: clientMessageIdRef.current,
          scope,
          recipient: recipient!,
          amount: validation.totalAmount,
          note: messageText.trim(),
          ...(source.kind === "fixed"
            ? { receiverId: source.recipient.id }
            : { groupId: source.groupId }),
        });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onCreated(result);
      onClose();
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const raw = error instanceof Error ? error.message : "";
      setErrorMessage(
        (normalizeChatMoneyErrorCode(raw, t) ?? raw) || t("chatMoney.operationFailed"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const requestSubmit = () => {
    Keyboard.dismiss();
    if (isLoading || isSubmitting) return;
    if (!featureEnabled || !configuration.eligibility.eligible) {
      Alert.alert(
        t("common.notice"),
        configuration.eligibility.message
          || t(featureEnabled ? "chatMoney.notEligible" : "chatMoney.featureDisabled"),
        [{ text: t("common.ok") }],
      );
      return;
    }
    const validationMessage = requiresRecipient && recipients.length === 0
      ? t("chatMoney.noRecipients")
      : validation.recipientError ?? validation.packetCountError ?? validation.amountError;
    if (validationMessage) {
      Alert.alert(t("common.notice"), validationMessage, [{ text: t("common.ok") }]);
      return;
    }
    const confirmationRecipient = recipient?.name
      ?? (source.kind === "fixed" ? source.recipient.name : source.groupName);
    Alert.alert(
      t("chatMoney.confirm.title"),
      t(
        kind === "red_packet"
          ? "chatMoney.confirm.redPacket"
          : "chatMoney.confirm.transfer",
        validation.totalAmount,
        confirmationRecipient,
      ),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("chatMoney.confirm.pay", validation.totalAmount),
          onPress: () => void submit(),
        },
      ],
    );
  };

  const toggleRecipientPicker = () => {
    Keyboard.dismiss();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setRecipientPickerExpanded((current) => !current);
  };

  const selectRecipient = (nextRecipient: ChatMoneyRecipient) => {
    Keyboard.dismiss();
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setRecipient(nextRecipient);
    setRecipientPickerExpanded(false);
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <ComposerHeader kind={kind} onClose={onClose} />
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={Keyboard.dismiss}
          >
            <RecipientHeader
              avatarUrl={headerAvatarUrl}
              kind={kind}
              name={headerName}
            />
            {kind === "red_packet" && source.kind === "group" ? (
              <ModeSelector mode={mode} onSelect={selectMode} />
            ) : null}
            {requiresRecipient ? (
              <InlineRecipientPicker
                expanded={isRecipientPickerExpanded}
                onSelect={selectRecipient}
                onToggle={toggleRecipientPicker}
                recipients={recipients}
                selected={recipient}
              />
            ) : null}
            <AmountCard
              amountText={amountText}
              kind={kind}
              mode={mode}
              onAmountChange={(value) => setAmountText(sanitizeChatMoneyDigits(value))}
              onPacketCountChange={(value) => setPacketCountText(sanitizeChatMoneyDigits(value))}
              packetCountText={packetCountText}
              scope={scope}
              totalAmount={validation.totalAmount}
            />
            <MessageCard
              kind={kind}
              maxLength={kind === "red_packet"
                ? configuration.limits.maximum_greeting_length
                : configuration.limits.maximum_transfer_note_length}
              onChangeText={setMessageText}
              value={messageText}
            />
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>{t("chatMoney.availableBalance")}</Text>
              <View style={styles.balanceValueRow}>
                <Text style={styles.balanceValue}>{t("chatMoney.amountValue", balance)}</Text>
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    Keyboard.dismiss();
                    onOpenWallet();
                  }}
                >
                  <Text style={styles.topUpText}>{t("chatMoney.topUp")}</Text>
                </Pressable>
              </View>
            </View>
            <Pressable
              accessibilityLabel={t(
                kind === "red_packet"
                  ? "chatMoney.redPacket.submit"
                  : "chatMoney.transfer.submit",
              )}
              accessibilityState={{ disabled: isLoading || isSubmitting }}
              disabled={isLoading || isSubmitting}
              onPress={requestSubmit}
              style={[
                styles.submitButton,
                kind === "transfer" && styles.transferSubmitButton,
                (isLoading || isSubmitting) && styles.submitBusy,
              ]}
            >
              {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : null}
              <Text style={styles.submitText}>
                {t(
                  kind === "red_packet"
                    ? "chatMoney.redPacket.submit"
                    : "chatMoney.transfer.submit",
                )}
              </Text>
            </Pressable>
            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
            <Text style={styles.expiryText}>{t("chatMoney.expiryNotice")}</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function ComposerHeader({ kind, onClose }: { kind: ChatMoneyKind; onClose: () => void }) {
  const { t } = useLocalization();
  return (
    <View style={styles.header}>
      <Pressable hitSlop={10} onPress={onClose} style={styles.headerButton}>
        <Text style={styles.cancelText}>{t("common.cancel")}</Text>
      </Pressable>
      <Text style={styles.headerTitle}>
        {t(kind === "red_packet" ? "chatMoney.redPacket.sendTitle" : "chatMoney.transfer.sendTitle")}
      </Text>
      <View style={styles.headerButton} />
    </View>
  );
}

function RecipientHeader({
  avatarUrl,
  kind,
  name,
}: {
  avatarUrl: string;
  kind: ChatMoneyKind;
  name: string;
}) {
  const { t } = useLocalization();
  return (
    <View style={styles.recipientHeader}>
      <Avatar name={name} size={58} uri={avatarUrl} />
      <Text numberOfLines={1} style={styles.recipientHeaderName}>{name}</Text>
      <Text style={styles.recipientHeaderHint}>
        {t(
          kind === "red_packet"
            ? "chatMoney.redPacket.headerHint"
            : "chatMoney.transfer.headerHint",
        )}
      </Text>
    </View>
  );
}

function ModeSelector({
  mode,
  onSelect,
}: {
  mode: ChatMoneyRedPacketMode;
  onSelect: (mode: ChatMoneyRedPacketMode) => void;
}) {
  const { t } = useLocalization();
  const modes: ChatMoneyRedPacketMode[] = ["lucky", "equal", "exclusive"];
  return (
    <View accessibilityRole="tablist" style={styles.modeSelector}>
      {modes.map((item) => {
        const selected = item === mode;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={item}
            onPress={() => onSelect(item)}
            style={[styles.modeOption, selected && styles.modeOptionSelected]}
          >
            <Text style={[styles.modeOptionText, selected && styles.modeOptionTextSelected]}>
              {t(`chatMoney.redPacket.mode.${item}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function InlineRecipientPicker({
  expanded,
  recipients,
  selected,
  onToggle,
  onSelect,
}: {
  expanded: boolean;
  recipients: ChatMoneyRecipient[];
  selected: ChatMoneyRecipient | null;
  onToggle: () => void;
  onSelect: (recipient: ChatMoneyRecipient) => void;
}) {
  const { t } = useLocalization();
  return (
    <View style={styles.recipientPickerCard}>
      <Pressable disabled={recipients.length === 0} onPress={onToggle} style={styles.recipientPickerTrigger}>
        <SymbolView
          name="person.crop.circle.badge.checkmark"
          size={21}
          weight="regular"
          tintColor={chatMoneyTheme.link}
        />
        <Text
          numberOfLines={1}
          style={selected ? styles.recipientPickerValue : styles.recipientPickerPlaceholder}
        >
          {selected?.name ?? t("chatMoney.chooseRecipient")}
        </Text>
        <View style={expanded ? styles.chevronExpanded : undefined}>
          <SymbolView name="chevron.down" size={12} weight="semibold" tintColor="#B2B2B2" />
        </View>
      </Pressable>
      {expanded ? (
        <View>
          <View style={styles.indentedDivider} />
          {recipients.map((item, index) => (
            <View key={item.id}>
              <Pressable onPress={() => onSelect(item)} style={styles.recipientOption}>
                <Avatar name={item.name} size={36} uri={item.avatar_url} />
                <Text numberOfLines={1} style={styles.recipientOptionName}>{item.name}</Text>
                {item.id === selected?.id ? (
                  <SymbolView
                    name="checkmark.circle.fill"
                    size={18}
                    weight="semibold"
                    tintColor={chatMoneyTheme.link}
                  />
                ) : null}
              </Pressable>
              {index < recipients.length - 1 ? <View style={styles.memberDivider} /> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function AmountCard({
  amountText,
  packetCountText,
  kind,
  mode,
  scope,
  totalAmount,
  onAmountChange,
  onPacketCountChange,
}: {
  amountText: string;
  packetCountText: string;
  kind: ChatMoneyKind;
  mode: ChatMoneyRedPacketMode;
  scope: "dm" | "group";
  totalAmount: number;
  onAmountChange: (value: string) => void;
  onPacketCountChange: (value: string) => void;
}) {
  const { t } = useLocalization();
  const showsPacketCount = kind === "red_packet" && scope === "group" && mode !== "exclusive";
  return (
    <View style={styles.amountCard}>
      <View style={styles.amountRow}>
        <Text style={styles.cardLabel}>
          {t(kind === "red_packet" && mode === "equal"
            ? "chatMoney.redPacket.amountEach"
            : "chatMoney.amount")}
        </Text>
        <TextInput
          keyboardType="number-pad"
          maxLength={9}
          onChangeText={onAmountChange}
          placeholder="0"
          placeholderTextColor="#B2B2B2"
          selectionColor={chatMoneyTheme.actionRed}
          style={styles.amountInput}
          value={amountText}
        />
        <Text style={styles.amountUnit}>{t("wallet.currency.goldCoins")}</Text>
      </View>
      {showsPacketCount ? (
        <>
          <View style={styles.indentedDivider} />
          <View style={styles.packetCountRow}>
            <Text style={styles.cardLabel}>{t("chatMoney.redPacket.count")}</Text>
            <TextInput
              keyboardType="number-pad"
              maxLength={3}
              onChangeText={onPacketCountChange}
              placeholder="1"
              placeholderTextColor="#B2B2B2"
              selectionColor={chatMoneyTheme.actionRed}
              style={styles.packetCountInput}
              value={packetCountText}
            />
            <Text style={styles.cardSecondary}>{t("chatMoney.redPacket.unit")}</Text>
          </View>
        </>
      ) : null}
      {mode === "equal" && totalAmount > 0 ? (
        <>
          <View style={styles.indentedDivider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t("chatMoney.total")}</Text>
            <Text style={styles.totalValue}>{t("chatMoney.amountValue", totalAmount)}</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

function MessageCard({
  kind,
  value,
  onChangeText,
  maxLength,
}: {
  kind: ChatMoneyKind;
  value: string;
  onChangeText: (value: string) => void;
  maxLength: number;
}) {
  const { t } = useLocalization();
  return (
    <View style={styles.messageCard}>
      <Text style={styles.messageLabel}>
        {t(kind === "red_packet" ? "chatMoney.greeting" : "chatMoney.note")}
      </Text>
      <TextInput
        maxLength={maxLength}
        multiline
        onChangeText={onChangeText}
        placeholder={kind === "transfer"
          ? t("chatMoney.transfer.notePlaceholder")
          : t("chatMoney.redPacket.defaultGreeting")}
        placeholderTextColor="#B2B2B2"
        style={styles.messageInput}
        value={value}
      />
    </View>
  );
}

async function loadGroupContext(
  ownerId: string,
  groupId: number,
  generation: number,
  generationRef: RefObject<number>,
): Promise<LoadedGroupContext> {
  const cached = await loadCachedGroupDetail(ownerId, groupId);
  let avatarUrl = cached?.avatar_url ?? "";
  let members = cached?.members ?? [];
  try {
    const detail = await getGroupDetail(groupId);
    if (generation === generationRef.current) await saveCachedGroupDetail(ownerId, detail);
    avatarUrl = detail.avatar_url;
    members = detail.members;
  } catch {
    // Cache-first parity: retain the last group snapshot when refresh fails.
  }
  return {
    avatarUrl,
    recipients: members
      .filter((member) => member.user_id !== ownerId)
      .map((member) => ({
        id: member.user_id,
        name: member.nickname,
        avatar_url: member.avatar_url,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { backgroundColor: "#F7F7F8", flex: 1 },
  header: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderBottomColor: chatMoneyTheme.separator,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 44,
    justifyContent: "space-between",
  },
  headerButton: { height: 44, justifyContent: "center", paddingHorizontal: 16, width: 74 },
  cancelText: { color: chatMoneyTheme.link, fontSize: 16 },
  headerTitle: { color: "#111111", fontSize: 17, fontWeight: "600" },
  scrollContent: { gap: 18, padding: 20, paddingBottom: 36 },
  recipientHeader: { alignItems: "center", gap: 10, paddingVertical: 8 },
  recipientHeaderName: { color: "#111111", fontSize: 18, fontWeight: "600", maxWidth: "88%" },
  recipientHeaderHint: { color: chatMoneyTheme.secondary, fontSize: 13 },
  modeSelector: {
    backgroundColor: "#E7E7EA",
    borderRadius: 9,
    flexDirection: "row",
    padding: 2,
  },
  modeOption: { alignItems: "center", borderRadius: 7, flex: 1, height: 32, justifyContent: "center" },
  modeOptionSelected: {
    backgroundColor: "#FFFFFF",
    elevation: 1,
    shadowColor: "#000000",
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 2,
  },
  modeOptionText: { color: "#555555", fontSize: 13, fontWeight: "500" },
  modeOptionTextSelected: { color: "#111111", fontWeight: "600" },
  recipientPickerCard: { backgroundColor: "#FFFFFF", borderRadius: 15, overflow: "hidden" },
  recipientPickerTrigger: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  recipientPickerValue: { color: "#111111", flex: 1, fontSize: 15 },
  recipientPickerPlaceholder: { color: chatMoneyTheme.secondary, flex: 1, fontSize: 15 },
  chevronExpanded: { transform: [{ rotate: "180deg" }] },
  recipientOption: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  recipientOptionName: { color: "#111111", flex: 1, fontSize: 16, fontWeight: "500" },
  memberDivider: { backgroundColor: chatMoneyTheme.separator, height: StyleSheet.hairlineWidth, marginLeft: 64 },
  indentedDivider: { backgroundColor: chatMoneyTheme.separator, height: StyleSheet.hairlineWidth, marginLeft: 16 },
  amountCard: { backgroundColor: "#FFFFFF", borderRadius: 15, overflow: "hidden" },
  amountRow: { alignItems: "baseline", flexDirection: "row", gap: 10, minHeight: 72, padding: 16 },
  cardLabel: { color: "#111111", fontSize: 15, fontWeight: "500" },
  amountInput: {
    color: "#111111",
    flex: 1,
    fontSize: 32,
    fontWeight: "700",
    maxWidth: 150,
    padding: 0,
    textAlign: "right",
  },
  amountUnit: { color: chatMoneyTheme.secondary, fontSize: 14, fontWeight: "600" },
  packetCountRow: { alignItems: "center", flexDirection: "row", minHeight: 56, padding: 16 },
  packetCountInput: { color: "#111111", flex: 1, fontSize: 16, padding: 0, textAlign: "right" },
  cardSecondary: { color: chatMoneyTheme.secondary, fontSize: 15, marginLeft: 10 },
  totalRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 50, padding: 16 },
  totalLabel: { color: chatMoneyTheme.secondary, fontSize: 14 },
  totalValue: { color: chatMoneyTheme.secondary, fontSize: 14, fontWeight: "600" },
  messageCard: {
    alignItems: "flex-start",
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    flexDirection: "row",
    gap: 12,
    minHeight: 56,
    padding: 16,
  },
  messageLabel: { color: "#111111", fontSize: 15, fontWeight: "500", paddingTop: 2 },
  messageInput: {
    color: "#111111",
    flex: 1,
    fontSize: 15,
    maxHeight: 72,
    minHeight: 22,
    padding: 0,
    textAlign: "right",
    textAlignVertical: "top",
  },
  balanceRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  balanceLabel: { color: chatMoneyTheme.secondary, fontSize: 13 },
  balanceValueRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  balanceValue: { color: chatMoneyTheme.secondary, fontSize: 13, fontWeight: "600" },
  topUpText: { color: chatMoneyTheme.link, fontSize: 13, fontWeight: "600" },
  submitButton: {
    alignItems: "center",
    backgroundColor: "#F06455",
    borderRadius: 15,
    flexDirection: "row",
    gap: 8,
    height: 52,
    justifyContent: "center",
    width: "100%",
  },
  transferSubmitButton: { backgroundColor: "#D8A20A" },
  submitBusy: { opacity: 0.7 },
  submitText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  expiryText: { color: "#B2B2B2", fontSize: 12, paddingHorizontal: 12, textAlign: "center" },
  errorText: { color: chatMoneyTheme.actionRed, fontSize: 12, textAlign: "center" },
});
