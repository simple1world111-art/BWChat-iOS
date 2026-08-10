import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { MenuView } from "@expo/ui/community/menu";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
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
  chatMoneyPacketCountAfterModeChange,
  chatMoneyComposerPolicy,
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
  const amountRef = useRef<TextInput>(null);
  const clientMessageIdRef = useRef(createIdempotencyKey());
  const [configuration, setConfiguration] = useState<ChatMoneyConfiguration>(unavailableChatMoneyConfiguration);
  const [balance, setBalance] = useState(0);
  const [recipients, setRecipients] = useState<ChatMoneyRecipient[]>([]);
  const [recipient, setRecipient] = useState<ChatMoneyRecipient | null>(null);
  const [showsRecipientPicker, setShowsRecipientPicker] = useState(false);
  const [mode, setMode] = useState<ChatMoneyRedPacketMode>(source.kind === "fixed" ? "direct" : "lucky");
  const [amountText, setAmountText] = useState("");
  const [packetCountText, setPacketCountText] = useState(source.kind === "fixed" ? "1" : "");
  const [messageText, setMessageText] = useState("");
  const [isLoading, setLoading] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const generationRef = useRef(0);

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
      setPacketCountText(source.kind === "fixed" ? "1" : "");
      setMessageText(kind === "red_packet" ? t("chatMoney.redPacket.defaultGreeting") : "");
      setRecipient(source.kind === "fixed" ? source.recipient : null);
      setShowsRecipientPicker(source.kind === "group" && kind === "transfer");
      setConfiguration(unavailableChatMoneyConfiguration);
      setErrorMessage(null);
      setLoading(true);
      setSubmitting(false);
      const cachedBalance = await readCachedGiftWalletBalance(ownerId);
      if (generation !== generationRef.current) return;
      if (cachedBalance) setBalance(cachedBalance.gold_coin_balance);
      const membersPromise = source.kind === "group"
        ? loadGroupRecipients(ownerId, source.groupId, generation, generationRef)
        : Promise.resolve([source.recipient]);
      const [nextConfiguration, nextRecipients] = await Promise.all([
        loadChatMoneyConfiguration(ownerId),
        membersPromise,
      ]);
      if (generation !== generationRef.current) return;
      setConfiguration(nextConfiguration);
      setRecipients(nextRecipients);
      try {
        const nextBalance = await refreshGiftWalletBalance(ownerId);
        if (generation === generationRef.current) setBalance(nextBalance.gold_coin_balance);
      } catch {
        // Native leaves the cached balance visible on refresh failure.
      } finally {
        if (generation === generationRef.current) setLoading(false);
      }
      setTimeout(() => {
        if (generation === generationRef.current && !(source.kind === "group" && kind === "transfer")) {
          amountRef.current?.focus();
        }
      }, chatMoneyComposerPolicy.focusDelayMs);
    })();
  }, [kind, ownerId, source, t, visible]);

  const scope = source.kind === "fixed" ? "dm" as const : "group" as const;
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
  }, t), [amountText, balance, configuration.limits, kind, mode, packetCountText, recipient, recipients.length, scope, source.kind, t]);
  const featureEnabled = kind === "red_packet"
    ? configuration.red_packet_enabled
    : configuration.transfer_enabled;
  const submitEnabled = featureEnabled && configuration.eligibility.eligible
    && validation.canSubmit && !isSubmitting && !isLoading;

  const selectMode = (nextMode: ChatMoneyRedPacketMode) => {
    Keyboard.dismiss();
    setMode(nextMode);
    setErrorMessage(null);
    setPacketCountText((current) => chatMoneyPacketCountAfterModeChange(current, nextMode));
    if (nextMode === "exclusive") {
      if (!recipient) setShowsRecipientPicker(true);
    } else if (source.kind === "group") {
      setRecipient(null);
    }
  };

  const submit = async () => {
    if (!submitEnabled) return;
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
          ...(source.kind === "fixed" ? { receiverId: source.recipient.id } : { groupId: source.groupId }),
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
          ...(source.kind === "fixed" ? { receiverId: source.recipient.id } : { groupId: source.groupId }),
        });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onCreated(result);
      onClose();
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const raw = error instanceof Error ? error.message : "";
      setErrorMessage((normalizeChatMoneyErrorCode(raw, t) ?? raw) || t("chatMoney.operationFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const selectRecipient = (next: ChatMoneyRecipient) => {
    setRecipient(next);
    setShowsRecipientPicker(false);
    setTimeout(() => amountRef.current?.focus(), chatMoneyComposerPolicy.focusDelayMs);
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible={visible}>
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        {showsRecipientPicker ? (
          <RecipientPicker
            onBack={kind === "transfer" ? onClose : () => setShowsRecipientPicker(false)}
            onSelect={selectRecipient}
            recipients={recipients}
            selectedId={recipient?.id}
          />
        ) : (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
            <ComposerHeader kind={kind} onBack={onClose} />
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={Keyboard.dismiss}
            >
              {kind === "red_packet" && source.kind === "group" ? (
                <ModeSelector mode={mode} onSelect={selectMode} />
              ) : null}
              {kind === "transfer" && recipient ? (
                <Pressable
                  disabled={source.kind === "fixed"}
                  onPress={() => setShowsRecipientPicker(true)}
                  style={styles.transferRecipientHeader}
                >
                  <Avatar name={recipient.name} size={chatMoneyComposerPolicy.transferHeaderAvatarSize} uri={recipient.avatar_url} />
                  <Text style={styles.transferRecipientText}>{t("chatMoney.transfer.to", recipient.name)}</Text>
                </Pressable>
              ) : null}
              {kind === "red_packet" && mode === "exclusive" ? (
                <RecipientRow onPress={() => setShowsRecipientPicker(true)} recipient={recipient} />
              ) : null}
              {kind === "red_packet" && source.kind === "group" && mode !== "exclusive" ? (
                <>
                  <InputRow
                    keyboardType="number-pad"
                    label={t("chatMoney.redPacket.count")}
                    onChangeText={(value) => setPacketCountText(sanitizeChatMoneyDigits(value))}
                    suffix={t("chatMoney.redPacket.unit")}
                    value={packetCountText}
                  />
                  {validation.packetCountError ? <ValidationText text={validation.packetCountError} /> : null}
                  <Text style={styles.memberHint}>
                    {t("chatMoney.redPacket.groupMemberHint", recipients.length + 1)}
                  </Text>
                </>
              ) : source.kind === "fixed" && kind === "red_packet" ? <View style={styles.directSpacer} /> : null}
              <InputRow
                inputRef={amountRef}
                keyboardType="number-pad"
                label={kind === "red_packet" && mode === "equal"
                  ? t("chatMoney.redPacket.amountEach")
                  : t("chatMoney.amount")}
                onChangeText={(value) => setAmountText(sanitizeChatMoneyDigits(value))}
                suffix={t("wallet.currency.goldCoins")}
                value={amountText}
                valueSize={kind === "transfer" ? chatMoneyComposerPolicy.transferAmountFontSize : chatMoneyComposerPolicy.amountFontSize}
              />
              {validation.amountError ? <ValidationText text={validation.amountError} /> : null}
              <MessageRow
                kind={kind}
                maxLength={kind === "red_packet"
                  ? configuration.limits.maximum_greeting_length
                  : configuration.limits.maximum_transfer_note_length}
                onChangeText={setMessageText}
                value={messageText}
              />
              <View style={styles.balanceRow}>
                <Text style={styles.balanceText}>{t("chatMoney.availableBalance")}</Text>
                <Text style={styles.balanceText}>{t("chatMoney.amountValue", balance)}</Text>
                <Pressable onPress={onOpenWallet}>
                  <Text style={styles.topUpText}>{t("chatMoney.topUp")}</Text>
                </Pressable>
              </View>
              <View style={styles.totalSection}>
                <View style={styles.totalAmountRow}>
                  <Text style={styles.totalAmount}>{validation.totalAmount}</Text>
                  <Text style={styles.totalUnit}>{t("wallet.currency.goldCoins")}</Text>
                </View>
                <Pressable
                  accessibilityState={{ disabled: !submitEnabled }}
                  disabled={!submitEnabled}
                  onPress={() => void submit()}
                  style={[styles.submitButton, !submitEnabled && styles.submitDisabled]}
                >
                  {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : null}
                  <Text style={styles.submitText}>
                    {t(kind === "red_packet" ? "chatMoney.redPacket.submit" : "chatMoney.transfer.submit")}
                  </Text>
                </Pressable>
                {!featureEnabled || !configuration.eligibility.eligible ? (
                  <Text style={styles.errorText}>
                    {configuration.eligibility.message || t(featureEnabled ? "chatMoney.notEligible" : "chatMoney.featureDisabled")}
                  </Text>
                ) : null}
                {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
                <Text style={styles.expiryText}>{t("chatMoney.expiryNotice")}</Text>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function ComposerHeader({ kind, onBack }: { kind: ChatMoneyKind; onBack: () => void }) {
  const { t } = useLocalization();
  return (
    <View style={styles.header}>
      <Pressable hitSlop={10} onPress={onBack} style={styles.headerButton}>
        <SymbolView name="chevron.left" size={19} weight="semibold" tintColor="#111111" />
      </Pressable>
      <Text style={styles.headerTitle}>
        {t(kind === "red_packet" ? "chatMoney.redPacket.sendTitle" : "chatMoney.transfer.sendTitle")}
      </Text>
      <View style={styles.headerButton} />
    </View>
  );
}

function ModeSelector({ mode, onSelect }: { mode: ChatMoneyRedPacketMode; onSelect: (mode: ChatMoneyRedPacketMode) => void }) {
  const { t } = useLocalization();
  const modes: ChatMoneyRedPacketMode[] = ["lucky", "equal", "exclusive"];
  return (
    <MenuView
      actions={modes.map((item) => ({
        id: item,
        state: item === mode ? "on" : "off",
        title: t(`chatMoney.redPacket.mode.${item}`),
      }))}
      onPressAction={({ nativeEvent }) => {
        const selected = modes.find((item) => item === nativeEvent.event);
        if (selected) onSelect(selected);
      }}
      style={styles.modeSelector}
    >
      <View accessibilityRole="button" style={styles.modeTrigger}>
        <Text style={styles.modeText}>{t(`chatMoney.redPacket.mode.${mode}`)}</Text>
        <SymbolView
          name="chevron.down"
          size={11}
          weight="semibold"
          tintColor={chatMoneyTheme.link}
        />
      </View>
    </MenuView>
  );
}

function InputRow({
  label,
  suffix,
  value,
  onChangeText,
  keyboardType,
  valueSize = chatMoneyComposerPolicy.packetCountFontSize,
  inputRef,
}: {
  label: string;
  suffix: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType: "number-pad";
  valueSize?: number | undefined;
  inputRef?: React.RefObject<TextInput | null> | undefined;
}) {
  return (
    <View style={styles.inputRow}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder="0"
        placeholderTextColor="#B2B2B2"
        ref={inputRef}
        selectionColor={chatMoneyTheme.actionRed}
        style={[styles.amountInput, { fontSize: valueSize }]}
        value={value}
      />
      <Text style={styles.inputSuffix}>{suffix}</Text>
    </View>
  );
}

function MessageRow({ kind, value, onChangeText, maxLength }: { kind: ChatMoneyKind; value: string; onChangeText: (value: string) => void; maxLength: number }) {
  const { t } = useLocalization();
  return (
    <View style={styles.messageRow}>
      <Text style={styles.messageLabel}>{t(kind === "red_packet" ? "chatMoney.greeting" : "chatMoney.note")}</Text>
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

function RecipientRow({ recipient, onPress }: { recipient: ChatMoneyRecipient | null; onPress: () => void }) {
  const { t } = useLocalization();
  return (
    <Pressable onPress={onPress} style={styles.recipientRow}>
      <Text style={styles.inputLabel}>{t("chatMoney.redPacket.exclusiveRecipient")}</Text>
      <View style={styles.recipientValue}>
        {recipient ? <Avatar name={recipient.name} size={chatMoneyComposerPolicy.recipientAvatarSize} uri={recipient.avatar_url} /> : null}
        <Text style={recipient ? styles.recipientName : styles.recipientPlaceholder}>{recipient?.name ?? t("chatMoney.chooseRecipient")}</Text>
        <SymbolView name="chevron.right" size={12} weight="semibold" tintColor="#B2B2B2" />
      </View>
    </Pressable>
  );
}

function RecipientPicker({ recipients, selectedId, onSelect, onBack }: { recipients: ChatMoneyRecipient[]; selectedId?: string | undefined; onSelect: (recipient: ChatMoneyRecipient) => void; onBack: () => void }) {
  const { t } = useLocalization();
  const [search, setSearch] = useState("");
  const filtered = recipients.filter((recipient) => `${recipient.name}\n${recipient.id}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable hitSlop={10} onPress={onBack} style={styles.headerButton}>
          <SymbolView name="chevron.left" size={19} weight="semibold" tintColor="#111111" />
        </Pressable>
        <Text style={styles.headerTitle}>{t("chatMoney.transfer.chooseRecipientTitle")}</Text>
        <View style={styles.headerButton} />
      </View>
      <TextInput onChangeText={setSearch} placeholder={t("chatMoney.recipient.search")} style={styles.searchInput} value={search} />
      <ScrollView contentContainerStyle={filtered.length === 0 ? styles.emptyRecipients : undefined} keyboardShouldPersistTaps="handled">
        {filtered.length === 0 ? (
          <>
            <SymbolView name="person.2.slash" size={32} weight="regular" tintColor="#B2B2B2" />
            <Text style={styles.emptyRecipientsText}>{t("chatMoney.noRecipients")}</Text>
          </>
        ) : filtered.map((item) => (
          <Pressable key={item.id} onPress={() => onSelect(item)} style={styles.recipientPickerRow}>
            <Avatar name={item.name} size={chatMoneyComposerPolicy.recipientPickerAvatarSize} uri={item.avatar_url} />
            <Text numberOfLines={1} style={styles.recipientPickerName}>{item.name}</Text>
            {item.id === selectedId ? <SymbolView name="checkmark" size={15} weight="semibold" tintColor={chatMoneyTheme.actionGreen} /> : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function ValidationText({ text }: { text: string }) {
  return <Text style={styles.validationText}>{text}</Text>;
}

async function loadGroupRecipients(
  ownerId: string,
  groupId: number,
  generation: number,
  generationRef: React.RefObject<number>,
): Promise<ChatMoneyRecipient[]> {
  const cached = await loadCachedGroupDetail(ownerId, groupId);
  let members = cached?.members ?? [];
  try {
    const detail = await getGroupDetail(groupId);
    if (generation === generationRef.current) await saveCachedGroupDetail(ownerId, detail);
    members = detail.members;
  } catch {
    // Cache-first parity: retain the last group snapshot when refresh fails.
  }
  return members.filter((member) => member.user_id !== ownerId).map((member) => ({
    id: member.user_id,
    name: member.nickname,
    avatar_url: member.avatar_url,
  })).sort((left, right) => left.name.localeCompare(right.name));
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { backgroundColor: chatMoneyTheme.pageBackground, flex: 1 },
  header: { alignItems: "center", backgroundColor: "#FFFFFF", borderBottomColor: chatMoneyTheme.separator, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", height: 44, justifyContent: "space-between" },
  headerButton: { alignItems: "center", height: 40, justifyContent: "center", width: 44 },
  headerTitle: { color: "#111111", fontSize: 17, fontWeight: "600" },
  scrollContent: { paddingBottom: 36, paddingHorizontal: chatMoneyComposerPolicy.pageHorizontalPadding, paddingTop: 6 },
  modeSelector: { alignSelf: "center", height: 32, marginBottom: 12 },
  modeTrigger: { alignItems: "center", flexDirection: "row", gap: 5, height: 32, paddingHorizontal: 12 },
  modeText: { color: chatMoneyTheme.link, fontSize: 14 },
  directSpacer: { height: 22 },
  inputRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 4, flexDirection: "row", gap: 10, height: chatMoneyComposerPolicy.inputRowHeight, paddingHorizontal: 16 },
  inputLabel: { color: "#111111", fontSize: 16 },
  amountInput: { color: "#111111", flex: 1, fontWeight: "500", maxWidth: 170, padding: 0, textAlign: "right" },
  inputSuffix: { color: "#111111", fontSize: 16 },
  validationText: { color: chatMoneyTheme.actionRed, fontSize: 12, marginHorizontal: 4, marginTop: 7 },
  memberHint: { color: "#B2B2B2", fontSize: 12, marginBottom: 12, marginHorizontal: 4, marginTop: 7 },
  messageRow: { alignItems: "flex-start", backgroundColor: "#FFFFFF", borderRadius: 4, flexDirection: "row", gap: 12, marginTop: 12, minHeight: 56, padding: 16 },
  messageLabel: { color: "#111111", fontSize: 16, paddingTop: 2 },
  messageInput: { color: "#111111", flex: 1, fontSize: 16, minHeight: 24, padding: 0, textAlign: "right", textAlignVertical: "top" },
  balanceRow: { alignItems: "center", flexDirection: "row", gap: 6, marginTop: 18 },
  balanceText: { color: chatMoneyTheme.secondary, fontSize: 13 },
  topUpText: { color: chatMoneyTheme.link, fontSize: 13 },
  totalSection: { alignItems: "center", marginTop: 34 },
  totalAmountRow: { alignItems: "baseline", flexDirection: "row", gap: 6 },
  totalAmount: { color: "#111111", fontSize: chatMoneyComposerPolicy.totalFontSize, fontWeight: "500", fontVariant: ["tabular-nums"] },
  totalUnit: { color: "#111111", fontSize: 15 },
  submitButton: { alignItems: "center", backgroundColor: chatMoneyTheme.actionRed, borderRadius: chatMoneyComposerPolicy.submitRadius, flexDirection: "row", gap: 8, height: chatMoneyComposerPolicy.submitHeight, justifyContent: "center", marginTop: 24, width: chatMoneyComposerPolicy.submitWidth },
  submitDisabled: { backgroundColor: chatMoneyTheme.disabledRed },
  submitText: { color: "#FFFFFF", fontSize: 17, fontWeight: "500" },
  expiryText: { color: "#B2B2B2", fontSize: 12, marginTop: 12, textAlign: "center" },
  errorText: { color: chatMoneyTheme.actionRed, fontSize: 12, marginTop: 10, textAlign: "center" },
  recipientRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderRadius: 4, flexDirection: "row", height: chatMoneyComposerPolicy.recipientRowHeight, justifyContent: "space-between", marginBottom: 12, paddingHorizontal: 16 },
  recipientValue: { alignItems: "center", flexDirection: "row", gap: 8 },
  recipientName: { color: "#111111", fontSize: 15 },
  recipientPlaceholder: { color: "#B2B2B2", fontSize: 15 },
  transferRecipientHeader: { alignItems: "center", gap: 10, paddingVertical: 24 },
  transferRecipientText: { color: chatMoneyTheme.secondary, fontSize: 15 },
  searchInput: { backgroundColor: "#EFEFF4", borderRadius: 10, fontSize: 15, height: 36, marginHorizontal: 16, marginVertical: 10, paddingHorizontal: 12 },
  emptyRecipients: { alignItems: "center", gap: 12, justifyContent: "center", minHeight: chatMoneyComposerPolicy.recipientPickerMinimumHeight },
  emptyRecipientsText: { color: chatMoneyTheme.secondary, fontSize: 15 },
  recipientPickerRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderBottomColor: chatMoneyTheme.separator, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 12, marginLeft: 16, minHeight: 64, paddingRight: 16, paddingVertical: 3 },
  recipientPickerName: { color: "#111111", flex: 1, fontSize: 16 },
});
