import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActionSheetIOS,
  Keyboard,
  KeyboardAvoidingView,
  type ImageStyle,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { createIdempotencyKey, getGroupDetail } from "@/api/bwchat";
import { nativeAssets } from "../../assets/nativeAssets";
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
  recipients: ChatMoneyRecipient[];
}

function triggerMoneyActionPressFeedback() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function ChatMoneyComposerModal({
  visible,
  ownerId,
  kind,
  source,
  onClose,
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
  const insets = useSafeAreaInsets();
  const clientMessageIdRef = useRef(createIdempotencyKey());
  const generationRef = useRef(0);
  const submissionInFlightRef = useRef(false);
  const [configuration, setConfiguration] = useState<ChatMoneyConfiguration>(
    unavailableChatMoneyConfiguration,
  );
  const [balance, setBalance] = useState(0);
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
      setPacketCountText(source.kind === "group" && kind === "red_packet" ? "" : "1");
      setMessageText("");
      setRecipient(source.kind === "fixed" ? source.recipient : null);
      setRecipientPickerExpanded(false);
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
          recipients: [source.recipient],
        });
      const [nextConfiguration, groupContext] = await Promise.all([
        loadChatMoneyConfiguration(ownerId),
        groupContextPromise,
      ]);
      if (generation !== generationRef.current) return;
      setConfiguration(nextConfiguration);
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
  const selectMode = (nextMode: ChatMoneyRedPacketMode) => {
    Keyboard.dismiss();
    setMode(nextMode);
    setErrorMessage(null);
    if (nextMode !== "exclusive") {
      setRecipient(null);
      setRecipientPickerExpanded(false);
    }
  };

  const showModePicker = () => {
    Keyboard.dismiss();
    const modes: ChatMoneyRedPacketMode[] = ["lucky", "equal", "exclusive"];
    const labels = modes.map((item) => groupRedPacketModeTitle(item, t));
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          cancelButtonIndex: labels.length,
          options: [...labels, t("common.cancel")],
          userInterfaceStyle: "light",
        },
        (index) => {
          const selected = modes[index];
          if (selected) selectMode(selected);
        },
      );
      return;
    }
    Alert.alert(
      t("chatMoney.redPacket.mode"),
      undefined,
      [
        ...modes.map((item, index) => ({
          text: labels[index],
          onPress: () => selectMode(item),
        })),
        { text: t("common.cancel"), style: "cancel" as const },
      ],
    );
  };

  const submit = async () => {
    if (!creationAllowed || isLoading || isSubmitting || submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
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
      onClose();
      requestAnimationFrame(() => onCreated(result));
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const raw = error instanceof Error ? error.message : "";
      setErrorMessage(
        (normalizeChatMoneyErrorCode(raw, t) ?? raw) || t("chatMoney.operationFailed"),
      );
    } finally {
      submissionInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const requestSubmit = () => {
    Keyboard.dismiss();
    if (isLoading || isSubmitting || submissionInFlightRef.current) return;
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
    void submit();
  };

  const selectRecipient = (nextRecipient: ChatMoneyRecipient) => {
    Keyboard.dismiss();
    setRecipient(nextRecipient);
    setRecipientPickerExpanded(false);
  };

  const appendTransferDigit = (digit: string) => {
    setAmountText((current) => sanitizeChatMoneyDigits(`${current}${digit}`.slice(0, 9)));
  };

  const removeTransferDigit = () => {
    setAmountText((current) => current.slice(0, -1));
  };

  if (kind === "red_packet") {
    const isGroup = source.kind === "group";
    return (
      <Modal
        animationType="slide"
        onRequestClose={onClose}
        presentationStyle="fullScreen"
        visible={visible}
      >
        <View
          style={[
            styles.referenceSafeArea,
            { paddingBottom: insets.bottom, paddingTop: insets.top },
          ]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.flex}
          >
            <ReferenceRedPacketComposer
              amountText={amountText}
              errorMessage={errorMessage}
              isBusy={isLoading || isSubmitting}
              isSubmitting={isSubmitting}
              isGroup={isGroup}
              maxGreetingLength={configuration.limits.maximum_greeting_length}
              memberCount={isGroup ? recipients.length + 1 : 1}
              messageText={messageText}
              mode={mode}
              onAmountChange={(value) => setAmountText(sanitizeChatMoneyDigits(value))}
              onClose={onClose}
              onGreetingChange={setMessageText}
              onModePress={showModePicker}
              onPacketCountChange={(value) => setPacketCountText(sanitizeChatMoneyDigits(value))}
              onRecipientPress={() => setRecipientPickerExpanded(true)}
              onSubmit={requestSubmit}
              packetCountText={packetCountText}
              recipient={recipient}
              totalAmount={validation.totalAmount}
            />
          </KeyboardAvoidingView>
          {isGroup ? (
            <RecipientSelectionModal
              onClose={() => setRecipientPickerExpanded(false)}
              onSelect={selectRecipient}
              recipients={recipients}
              selectedId={recipient?.id}
              visible={isRecipientPickerExpanded}
            />
          ) : null}
        </View>
      </Modal>
    );
  }

  const transferRecipient = source.kind === "fixed" ? source.recipient : recipient;
  const showGroupRecipientSelection = source.kind === "group" && !transferRecipient;
  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible={visible}>
      <View
        style={[
          styles.transferSafeArea,
          { paddingBottom: insets.bottom, paddingTop: insets.top },
        ]}
      >
        {showGroupRecipientSelection ? (
          <TransferRecipientSelectionScreen
            onClose={onClose}
            onSelect={selectRecipient}
            recipients={recipients}
          />
        ) : transferRecipient ? (
          <ReferenceTransferComposer
            accountId={source.kind === "fixed" ? source.recipient.id : undefined}
            amountText={amountText}
            errorMessage={errorMessage}
            isBusy={isLoading || isSubmitting}
            isSubmitting={isSubmitting}
            maxNoteLength={configuration.limits.maximum_transfer_note_length}
            noteText={messageText}
            onAppendDigit={appendTransferDigit}
            onBack={source.kind === "group" ? () => setRecipient(null) : onClose}
            onDeleteDigit={removeTransferDigit}
            onNoteChange={setMessageText}
            onSubmit={requestSubmit}
            recipient={transferRecipient}
          />
        ) : null}
      </View>
    </Modal>
  );
}

function ReferenceTransferComposer({
  accountId,
  amountText,
  errorMessage,
  isBusy,
  isSubmitting,
  maxNoteLength,
  noteText,
  recipient,
  onAppendDigit,
  onBack,
  onDeleteDigit,
  onNoteChange,
  onSubmit,
}: {
  accountId?: string | undefined;
  amountText: string;
  errorMessage: string | null;
  isBusy: boolean;
  isSubmitting: boolean;
  maxNoteLength: number;
  noteText: string;
  recipient: ChatMoneyRecipient;
  onAppendDigit: (digit: string) => void;
  onBack: () => void;
  onDeleteDigit: () => void;
  onNoteChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useLocalization();
  const [isEditingNote, setEditingNote] = useState(false);
  const noteInputRef = useRef<TextInput>(null);
  const dismissTransferNoteInput = () => {
    noteInputRef.current?.blur();
    Keyboard.dismiss();
    setEditingNote(false);
  };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
      <Pressable accessible={false} onPress={dismissTransferNoteInput} style={styles.flex}>
        <View style={styles.transferRecipientArea}>
          <Pressable accessibilityLabel={t("common.back")} hitSlop={12} onPress={onBack} style={styles.transferBackButton}>
            <SymbolView name="chevron.left" size={25} weight="regular" tintColor="#111111" />
          </Pressable>
          <View style={styles.transferRecipientSummary}>
            <View style={styles.transferRecipientCopy}>
              <Text numberOfLines={1} style={styles.transferRecipientTitle}>
                {t("chatMoney.transfer.to", recipient.name)}
              </Text>
              {accountId ? (
                <Text numberOfLines={1} style={styles.transferRecipientAccount}>
                  {t("chatMoney.transfer.account", accountId)}
                </Text>
              ) : null}
            </View>
            <Avatar name={recipient.name} size={54} uri={recipient.avatar_url} />
          </View>
        </View>

        <View style={styles.transferFormPanel}>
          <View style={styles.transferFormContent}>
            <Text style={styles.transferAmountTitle}>{t("chatMoney.transfer.amountTitle")}</Text>
            <Pressable
              accessibilityLabel={t("chatMoney.transfer.amountTitle")}
              accessibilityRole="button"
              onPress={dismissTransferNoteInput}
              style={styles.transferAmountEntry}
            >
              <GoldCoinIcon
                accessibilityLabel={t("wallet.currency.goldCoins")}
                size={44}
                style={styles.transferCoinIcon}
              />
              {amountText ? <Text style={styles.transferAmountText}>{amountText}</Text> : null}
              {!isEditingNote ? <View style={styles.transferAmountCursor} /> : null}
            </Pressable>
            <View style={styles.transferAmountDivider} />
            <TextInput
              maxLength={maxNoteLength}
              onBlur={() => setEditingNote(false)}
              onChangeText={onNoteChange}
              onFocus={() => setEditingNote(true)}
              placeholder={t("chatMoney.transfer.noteAction")}
              placeholderTextColor="#5C719B"
              ref={noteInputRef}
              style={styles.transferNoteInput}
              value={noteText}
            />
            {errorMessage ? <Text style={styles.transferErrorText}>{errorMessage}</Text> : null}
          </View>
          {!isEditingNote ? (
            <TransferCoinKeypad
              isBusy={isBusy}
              isSubmitting={isSubmitting}
              onAppendDigit={onAppendDigit}
              onDeleteDigit={onDeleteDigit}
              onSubmit={onSubmit}
            />
          ) : null}
        </View>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

function TransferCoinKeypad({
  isBusy,
  isSubmitting,
  onAppendDigit,
  onDeleteDigit,
  onSubmit,
}: {
  isBusy: boolean;
  isSubmitting: boolean;
  onAppendDigit: (digit: string) => void;
  onDeleteDigit: () => void;
  onSubmit: () => void;
}) {
  const { t } = useLocalization();
  const rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]];
  return (
    <View style={styles.transferKeypad}>
      <View style={styles.transferKeypadNumberArea}>
        {rows.map((row) => (
          <View key={row.join("")} style={styles.transferKeypadRow}>
            {row.map((digit) => (
              <Pressable key={digit} onPress={() => onAppendDigit(digit)} style={styles.transferKey}>
                <Text style={styles.transferKeyText}>{digit}</Text>
              </Pressable>
            ))}
          </View>
        ))}
        <Pressable onPress={() => onAppendDigit("0")} style={styles.transferZeroKey}>
          <Text style={styles.transferKeyText}>0</Text>
        </Pressable>
      </View>
      <View style={styles.transferKeypadActionArea}>
        <Pressable onPress={onDeleteDigit} style={styles.transferDeleteKey}>
          <SymbolView name="delete.left.fill" size={23} weight="regular" tintColor="#111111" />
        </Pressable>
        <Pressable
          accessibilityLabel={t("chatMoney.transfer.submit")}
          accessibilityState={{ disabled: isBusy }}
          disabled={isBusy}
          onPress={onSubmit}
          onPressIn={triggerMoneyActionPressFeedback}
          style={({ pressed }) => [
            styles.transferConfirmKey,
            isSubmitting && styles.moneyActionPending,
            pressed && styles.moneyActionPressed,
          ]}
        >
          <Text style={styles.transferConfirmText}>{t("chatMoney.transfer.submit")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function TransferRecipientSelectionScreen({
  onClose,
  onSelect,
  recipients,
}: {
  onClose: () => void;
  onSelect: (recipient: ChatMoneyRecipient) => void;
  recipients: ChatMoneyRecipient[];
}) {
  const { t } = useLocalization();
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const filtered = query
    ? recipients.filter((item) => `${item.name}\n${item.id}`.toLocaleLowerCase().includes(query))
    : recipients;
  const sections = useMemo(() => groupTransferRecipients(filtered), [filtered]);
  return (
    <Pressable accessible={false} onPress={Keyboard.dismiss} style={styles.transferSelectionPage}>
      <View style={styles.transferSelectionTop}>
        <View style={styles.transferSelectionHeader}>
          <Pressable accessibilityLabel={t("common.close")} hitSlop={12} onPress={onClose} style={styles.transferSelectionClose}>
            <SymbolView name="xmark" size={23} weight="regular" tintColor="#111111" />
          </Pressable>
          <Text style={styles.transferSelectionTitle}>{t("chatMoney.transfer.chooseRecipientTitle")}</Text>
          <View style={styles.transferSelectionClose} />
        </View>
        <View style={styles.transferSelectionSearchBox}>
          <SymbolView name="magnifyingglass" size={21} weight="regular" tintColor="#B7B7BA" />
          <TextInput
            onChangeText={setSearch}
            placeholder={t("chatMoney.transfer.recipientSearch")}
            placeholderTextColor="#B7B7BA"
            style={styles.transferSelectionSearchInput}
            value={search}
          />
        </View>
      </View>
      <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
        {sections.length === 0 ? (
          <View style={styles.transferSelectionEmpty}>
            <Text style={styles.transferSelectionEmptyText}>{t("chatMoney.noRecipients")}</Text>
          </View>
        ) : sections.map((section) => (
          <View key={section.initial}>
            <Text style={styles.transferSelectionSectionTitle}>{section.initial}</Text>
            {section.members.map((item) => (
              <Pressable key={item.id} onPress={() => onSelect(item)} style={styles.transferSelectionRow}>
                <Avatar name={item.name} size={49} uri={item.avatar_url} />
                <Text numberOfLines={1} style={styles.transferSelectionName}>{item.name}</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
      <View pointerEvents="none" style={styles.transferAlphabetIndex}>
        <SymbolView name="magnifyingglass" size={11} weight="semibold" tintColor="#555555" />
        {"ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("").map((letter) => (
          <Text key={letter} style={styles.transferAlphabetLetter}>{letter}</Text>
        ))}
      </View>
    </Pressable>
  );
}

function groupTransferRecipients(recipients: ChatMoneyRecipient[]): {
  initial: string;
  members: ChatMoneyRecipient[];
}[] {
  const groups = new Map<string, ChatMoneyRecipient[]>();
  recipients.forEach((recipient) => {
    const initial = transferRecipientInitial(recipient.name);
    groups.set(initial, [...(groups.get(initial) ?? []), recipient]);
  });
  return [...groups]
    .sort(([left], [right]) => {
      if (left === "#") return 1;
      if (right === "#") return -1;
      return left.localeCompare(right);
    })
    .map(([initial, members]) => ({ initial, members }));
}

function transferRecipientInitial(name: string): string {
  const first = name.trim().charAt(0).toUpperCase();
  if (/^[A-Z]$/u.test(first)) return first;
  if (!/\p{Script=Han}/u.test(first)) return "#";
  const pinyinCollator = new Intl.Collator("zh-Hans-u-co-pinyin");
  let initial = "#";
  for (const [letter, boundary] of chinesePinyinBoundaries) {
    if (pinyinCollator.compare(first, boundary) < 0) break;
    initial = letter;
  }
  return initial;
}

const chinesePinyinBoundaries = [
  ["A", "阿"], ["B", "芭"], ["C", "嚓"], ["D", "搭"], ["E", "蛾"],
  ["F", "发"], ["G", "噶"], ["H", "哈"], ["J", "击"], ["K", "喀"],
  ["L", "垃"], ["M", "妈"], ["N", "拿"], ["O", "哦"], ["P", "啪"],
  ["Q", "期"], ["R", "然"], ["S", "撒"], ["T", "塌"], ["W", "挖"],
  ["X", "昔"], ["Y", "压"], ["Z", "匝"],
] as const;

function ReferenceRedPacketComposer({
  amountText,
  errorMessage,
  isBusy,
  isSubmitting,
  isGroup,
  maxGreetingLength,
  memberCount,
  messageText,
  mode,
  packetCountText,
  recipient,
  totalAmount,
  onAmountChange,
  onClose,
  onGreetingChange,
  onModePress,
  onPacketCountChange,
  onRecipientPress,
  onSubmit,
}: {
  amountText: string;
  errorMessage: string | null;
  isBusy: boolean;
  isSubmitting: boolean;
  isGroup: boolean;
  maxGreetingLength: number;
  memberCount: number;
  messageText: string;
  mode: ChatMoneyRedPacketMode;
  packetCountText: string;
  recipient: ChatMoneyRecipient | null;
  totalAmount: number;
  onAmountChange: (value: string) => void;
  onClose: () => void;
  onGreetingChange: (value: string) => void;
  onModePress: () => void;
  onPacketCountChange: (value: string) => void;
  onRecipientPress: () => void;
  onSubmit: () => void;
}) {
  const { t } = useLocalization();
  const isExclusive = isGroup && mode === "exclusive";
  const showsPacketCount = isGroup && !isExclusive;
  const amountLabel = mode === "lucky"
    ? t("chatMoney.redPacket.totalAmount")
    : mode === "equal"
      ? t("chatMoney.redPacket.amountEach")
      : t("chatMoney.amount");

  return (
    <Pressable accessible={false} onPress={Keyboard.dismiss} style={styles.referencePage}>
      <View style={styles.referenceHeader}>
        <Pressable accessibilityLabel={t("common.back")} hitSlop={12} onPress={onClose} style={styles.referenceHeaderButton}>
          <SymbolView name="chevron.left" size={25} weight="regular" tintColor="#111111" />
        </Pressable>
        <Text style={styles.referenceHeaderTitle}>{t("chatMoney.redPacket.sendTitle")}</Text>
        <View style={styles.referenceHeaderButton}>
          <SymbolView name="ellipsis" size={24} weight="bold" tintColor="#111111" />
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.referenceScrollContent}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
        showsVerticalScrollIndicator={false}
        style={styles.flex}
      >
        <View style={styles.referenceBody}>
          <View style={styles.referenceForm}>
            {isGroup ? (
              <Pressable onPress={onModePress} style={styles.referenceModeButton}>
                <Text style={styles.referenceModeText}>{groupRedPacketModeTitle(mode, t)}</Text>
                <SymbolView name="chevron.down" size={14} weight="semibold" tintColor="#CE9A3C" />
              </Pressable>
            ) : <View style={styles.privateModeSpacer} />}

            {isExclusive ? (
              <Pressable onPress={onRecipientPress} style={styles.referenceCardRow}>
                <Text style={styles.referenceCardLabel}>{t("chatMoney.redPacket.exclusiveRecipient")}</Text>
                <View style={styles.referenceCardValue}>
                  <Text
                    numberOfLines={1}
                    style={recipient ? styles.referenceRecipientName : styles.referencePlaceholder}
                  >
                    {recipient?.name ?? ""}
                  </Text>
                  <SymbolView name="chevron.right" size={17} weight="semibold" tintColor="#888888" />
                </View>
              </Pressable>
            ) : null}

            {showsPacketCount ? (
              <>
                <View style={styles.referenceCardRow}>
                  <View style={styles.referenceLabelWithIcon}>
                    <RedPacketGlyph />
                    <Text style={styles.referenceCardLabel}>{t("chatMoney.redPacket.count")}</Text>
                  </View>
                  <View style={styles.referenceCountValue}>
                    <TextInput
                      keyboardType="number-pad"
                      maxLength={3}
                      onChangeText={onPacketCountChange}
                      placeholder={t("chatMoney.redPacket.countPlaceholder")}
                      placeholderTextColor="#C5C5C8"
                      selectionColor="#FF5B47"
                      style={styles.referenceCountInput}
                      value={packetCountText}
                    />
                    <Text style={styles.referenceUnit}>{t("chatMoney.redPacket.unit")}</Text>
                  </View>
                </View>
                <Text style={styles.referenceMemberHint}>
                  {t("chatMoney.redPacket.groupMemberHint", memberCount)}
                </Text>
              </>
            ) : null}

            <View style={[styles.referenceCardRow, styles.referenceAmountCard]}>
              <View style={styles.referenceLabelWithIcon}>
                {mode === "lucky" ? <LuckyBadge /> : null}
                <Text style={styles.referenceCardLabel}>{amountLabel}</Text>
              </View>
              <View style={styles.referenceAmountValue}>
                <TextInput
                  keyboardType="number-pad"
                  maxLength={9}
                  onChangeText={onAmountChange}
                  placeholder="0"
                  placeholderTextColor="#C5C5C8"
                  selectionColor="#FF5B47"
                  style={styles.referenceAmountInput}
                  value={amountText}
                />
                <GoldCoinIcon
                  accessibilityLabel={t("wallet.currency.goldCoins")}
                  size={24}
                  style={styles.referenceCurrencyIcon}
                />
              </View>
            </View>

            <View style={styles.referenceGreetingCard}>
              <TextInput
                maxLength={maxGreetingLength}
                multiline
                onChangeText={onGreetingChange}
                placeholder={t("chatMoney.redPacket.defaultGreeting")}
                placeholderTextColor="#B8B8BB"
                style={styles.referenceGreetingInput}
                value={messageText}
              />
              <View style={styles.referenceEmojiIcon}>
                <SymbolView name="face.smiling" size={24} weight="regular" tintColor="#777777" />
                <Text style={styles.referenceEmojiPlus}>＋</Text>
              </View>
            </View>

          </View>

          <View style={styles.referencePaymentArea}>
            <View style={styles.referencePaymentBlock}>
              <View style={styles.referenceTotalRow}>
                <Text style={styles.referenceTotalNumber}>{Math.max(totalAmount, 0)}</Text>
                <GoldCoinIcon
                  accessibilityLabel={t("wallet.currency.goldCoins")}
                  size={30}
                  style={styles.referenceTotalCurrencyIcon}
                />
              </View>
              <Pressable
                accessibilityLabel={t("chatMoney.redPacket.submit")}
                accessibilityState={{ disabled: isBusy }}
                disabled={isBusy}
                onPress={onSubmit}
                onPressIn={triggerMoneyActionPressFeedback}
                style={({ pressed }) => [
                  styles.referenceSubmitButton,
                  isSubmitting && styles.moneyActionPending,
                  pressed && styles.moneyActionPressed,
                ]}
              >
                <Text style={styles.referenceSubmitText}>{t("chatMoney.redPacket.submit")}</Text>
              </Pressable>
              {errorMessage ? <Text style={styles.referenceErrorText}>{errorMessage}</Text> : null}
            </View>
            <Text style={styles.referenceFootnote}>
              {t(isExclusive
                ? "chatMoney.redPacket.exclusiveVisibility"
                : "chatMoney.redPacket.refundNotice")}
            </Text>
          </View>
        </View>
      </ScrollView>
    </Pressable>
  );
}

function GoldCoinIcon({
  accessibilityLabel,
  size,
  style,
}: {
  accessibilityLabel: string;
  size: number;
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      contentFit="contain"
      source={nativeAssets.walletGoldCoinBadge}
      style={[{ height: size, width: size }, style]}
      transition={0}
    />
  );
}

function RedPacketGlyph() {
  return (
    <View style={styles.redPacketGlyph}>
      <View style={styles.redPacketGlyphFlap} />
      <View style={styles.redPacketGlyphCoin} />
    </View>
  );
}

function LuckyBadge() {
  return (
    <View style={styles.luckyBadge}>
      <Text style={styles.luckyBadgeText}>拼</Text>
    </View>
  );
}

function RecipientSelectionModal({
  onClose,
  onSelect,
  recipients,
  selectedId,
  visible,
}: {
  onClose: () => void;
  onSelect: (recipient: ChatMoneyRecipient) => void;
  recipients: ChatMoneyRecipient[];
  selectedId?: string | undefined;
  visible: boolean;
}) {
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const close = () => {
    setSearch("");
    onClose();
  };
  const select = (nextRecipient: ChatMoneyRecipient) => {
    setSearch("");
    onSelect(nextRecipient);
  };
  const query = search.trim().toLocaleLowerCase();
  const filtered = query
    ? recipients.filter((item) => `${item.name}\n${item.id}`.toLocaleLowerCase().includes(query))
    : recipients;
  return (
    <Modal animationType="slide" onRequestClose={close} presentationStyle="fullScreen" visible={visible}>
      <Pressable
        accessible={false}
        onPress={Keyboard.dismiss}
        style={[
          styles.recipientSelectionSafeArea,
          { paddingBottom: insets.bottom, paddingTop: insets.top },
        ]}
      >
        <View style={styles.recipientSelectionHeader}>
          <Pressable hitSlop={10} onPress={close} style={styles.recipientSelectionHeaderButton}>
            <Text style={styles.recipientSelectionCancel}>{t("common.cancel")}</Text>
          </Pressable>
          <Text style={styles.recipientSelectionTitle}>{t("chatMoney.transfer.chooseRecipientTitle")}</Text>
          <View style={styles.recipientSelectionHeaderButton} />
        </View>
        <TextInput
          onChangeText={setSearch}
          placeholder={t("chatMoney.recipient.search")}
          placeholderTextColor="#999999"
          style={styles.recipientSelectionSearch}
          value={search}
        />
        <ScrollView keyboardShouldPersistTaps="handled">
          {filtered.length === 0 ? (
            <View style={styles.recipientSelectionEmpty}>
              <SymbolView name="person.2.slash" size={32} weight="regular" tintColor="#B2B2B2" />
              <Text style={styles.recipientSelectionEmptyText}>{t("chatMoney.noRecipients")}</Text>
            </View>
          ) : filtered.map((item) => (
            <Pressable key={item.id} onPress={() => select(item)} style={styles.recipientSelectionRow}>
              <Avatar name={item.name} size={42} uri={item.avatar_url} />
              <Text numberOfLines={1} style={styles.recipientSelectionName}>{item.name}</Text>
              {item.id === selectedId ? (
                <SymbolView name="checkmark.circle.fill" size={20} weight="semibold" tintColor="#CE9A3C" />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </Pressable>
    </Modal>
  );
}

function groupRedPacketModeTitle(
  mode: ChatMoneyRedPacketMode,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  return t(`chatMoney.redPacket.mode.${mode}Full`);
}

async function loadGroupContext(
  ownerId: string,
  groupId: number,
  generation: number,
  generationRef: RefObject<number>,
): Promise<LoadedGroupContext> {
  const cached = await loadCachedGroupDetail(ownerId, groupId);
  let members = cached?.members ?? [];
  try {
    const detail = await getGroupDetail(groupId);
    if (generation === generationRef.current) await saveCachedGroupDetail(ownerId, detail);
    members = detail.members;
  } catch {
    // Cache-first parity: retain the last group snapshot when refresh fails.
  }
  return {
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
  transferSafeArea: { backgroundColor: "#EFEFEF", flex: 1 },
  transferRecipientArea: { backgroundColor: "#EFEFEF", height: 126 },
  transferBackButton: {
    alignItems: "center",
    height: 50,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    top: 0,
    width: 54,
  },
  transferRecipientSummary: {
    alignItems: "center",
    flexDirection: "row",
    left: 32,
    position: "absolute",
    right: 32,
    top: 52,
  },
  transferRecipientCopy: { flex: 1, gap: 4, marginRight: 18 },
  transferRecipientTitle: { color: "#111111", fontSize: 20, fontWeight: "600" },
  transferRecipientAccount: { color: "#7E7E80", fontSize: 16 },
  transferFormPanel: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    flex: 1,
    overflow: "hidden",
  },
  transferFormContent: { flex: 1, paddingHorizontal: 32, paddingTop: 22 },
  transferAmountTitle: { color: "#111111", fontSize: 17, fontWeight: "500" },
  transferAmountEntry: { alignItems: "center", flexDirection: "row", height: 82 },
  transferCoinIcon: { flexShrink: 0 },
  transferAmountText: {
    color: "#111111",
    fontSize: 44,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
    marginLeft: 14,
  },
  transferAmountCursor: { backgroundColor: "#77E4B8", height: 58, marginLeft: 10, width: 2 },
  transferAmountDivider: { backgroundColor: "#E8E8E8", height: StyleSheet.hairlineWidth },
  transferNoteInput: { color: "#111111", fontSize: 17, height: 50, padding: 0 },
  transferErrorText: { color: chatMoneyTheme.actionRed, fontSize: 13, marginTop: 4 },
  transferKeypad: {
    backgroundColor: "#F1F1F1",
    flexDirection: "row",
    gap: 6,
    height: 270,
    padding: 6,
  },
  transferKeypadNumberArea: { flex: 3, gap: 6 },
  transferKeypadRow: { flex: 1, flexDirection: "row", gap: 6 },
  transferKey: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 5,
    flex: 1,
    justifyContent: "center",
  },
  transferZeroKey: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 5,
    flex: 1,
    justifyContent: "center",
  },
  transferKeyText: { color: "#111111", fontSize: 27, fontWeight: "500" },
  transferKeypadActionArea: { flex: 1, gap: 6 },
  transferDeleteKey: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 5,
    flex: 1,
    justifyContent: "center",
  },
  transferConfirmKey: {
    alignItems: "center",
    backgroundColor: "#08C767",
    borderRadius: 5,
    flex: 3,
    gap: 6,
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  transferConfirmText: { color: "#FFFFFF", fontSize: 18, fontWeight: "600", textAlign: "center" },
  transferSelectionPage: { backgroundColor: "#FFFFFF", flex: 1 },
  transferSelectionTop: { backgroundColor: "#EFEFEF", paddingBottom: 12 },
  transferSelectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    height: 58,
    justifyContent: "space-between",
  },
  transferSelectionClose: { alignItems: "center", height: 58, justifyContent: "center", width: 66 },
  transferSelectionTitle: { color: "#111111", fontSize: 21, fontWeight: "600" },
  transferSelectionSearchBox: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 6,
    flexDirection: "row",
    height: 44,
    justifyContent: "center",
    marginHorizontal: 10,
  },
  transferSelectionSearchInput: { color: "#111111", fontSize: 17, maxWidth: 130, padding: 0 },
  transferSelectionSectionTitle: {
    color: "#777779",
    fontSize: 17,
    height: 55,
    paddingLeft: 20,
    paddingTop: 19,
  },
  transferSelectionRow: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    height: 78,
    paddingLeft: 20,
    paddingRight: 26,
  },
  transferSelectionName: {
    borderBottomColor: "#ECECEC",
    borderBottomWidth: StyleSheet.hairlineWidth,
    color: "#111111",
    flex: 1,
    fontSize: 20,
    height: 78,
    marginLeft: 15,
    paddingTop: 25,
  },
  transferSelectionEmpty: { alignItems: "center", justifyContent: "center", minHeight: 260 },
  transferSelectionEmptyText: { color: "#888888", fontSize: 16 },
  transferAlphabetIndex: {
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
    right: 5,
    top: 270,
  },
  transferAlphabetLetter: { color: "#555555", fontSize: 10, fontWeight: "600", lineHeight: 14 },
  referenceSafeArea: { backgroundColor: "#F3F3F3", flex: 1 },
  referencePage: { flex: 1 },
  referenceHeader: {
    alignItems: "center",
    flexDirection: "row",
    height: 52,
    justifyContent: "space-between",
  },
  referenceHeaderButton: {
    alignItems: "center",
    height: 52,
    justifyContent: "center",
    width: 54,
  },
  referenceHeaderTitle: { color: "#111111", fontSize: 21, fontWeight: "600" },
  referenceScrollContent: { flexGrow: 1 },
  referenceBody: { flex: 1 },
  referenceForm: { paddingTop: 4 },
  referenceModeButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 7,
    height: 36,
    marginBottom: 6,
    marginLeft: 32,
  },
  referenceModeText: { color: "#CE9A3C", fontSize: 17, fontWeight: "600" },
  privateModeSpacer: { height: 2 },
  referenceCardRow: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 7,
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: 16,
    minHeight: 56,
    paddingHorizontal: 16,
  },
  referenceLabelWithIcon: { alignItems: "center", flexDirection: "row", gap: 11 },
  referenceCardLabel: { color: "#111111", fontSize: 18, fontWeight: "400" },
  referenceCardValue: { alignItems: "center", flexDirection: "row", flex: 1, gap: 12, justifyContent: "flex-end", marginLeft: 16 },
  referenceRecipientName: { color: "#555555", flexShrink: 1, fontSize: 18 },
  referencePlaceholder: { color: "#C5C5C8", flexShrink: 1, fontSize: 18 },
  redPacketGlyph: {
    backgroundColor: "#F45B4E",
    borderRadius: 3,
    height: 24,
    overflow: "hidden",
    width: 22,
  },
  redPacketGlyphFlap: {
    backgroundColor: "#FF6B5D",
    borderBottomLeftRadius: 13,
    borderBottomRightRadius: 13,
    height: 12,
    left: 0,
    position: "absolute",
    top: 0,
    width: 22,
  },
  redPacketGlyphCoin: {
    backgroundColor: "#EBC16B",
    borderRadius: 5,
    height: 10,
    left: 6,
    position: "absolute",
    top: 7,
    width: 10,
  },
  referenceCountValue: { alignItems: "center", flexDirection: "row", flex: 1, justifyContent: "flex-end", marginLeft: 12 },
  referenceCountInput: {
    color: "#111111",
    flex: 1,
    fontSize: 18,
    maxWidth: 160,
    padding: 0,
    textAlign: "right",
  },
  referenceUnit: { color: "#222222", fontSize: 19, marginLeft: 10 },
  referenceMemberHint: {
    color: "#8B8B8E",
    fontSize: 14,
    lineHeight: 18,
    marginHorizontal: 32,
    marginTop: 6,
  },
  referenceAmountCard: { marginTop: 10 },
  luckyBadge: {
    alignItems: "center",
    backgroundColor: "#C99A43",
    borderRadius: 3,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  luckyBadgeText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  referenceAmountValue: { alignItems: "center", flexDirection: "row", flex: 1, justifyContent: "flex-end", marginLeft: 12 },
  referenceAmountInput: {
    color: "#111111",
    flex: 1,
    fontSize: 19,
    maxWidth: 130,
    padding: 0,
    textAlign: "right",
  },
  referenceCurrencyIcon: { flexShrink: 0, marginLeft: 7 },
  referenceGreetingCard: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 7,
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 10,
    minHeight: 64,
    paddingHorizontal: 16,
  },
  referenceGreetingInput: {
    color: "#111111",
    flex: 1,
    fontSize: 19,
    maxHeight: 60,
    padding: 0,
    textAlignVertical: "center",
  },
  referenceEmojiIcon: { height: 32, justifyContent: "center", marginLeft: 12, width: 32 },
  referenceEmojiPlus: {
    color: "#777777",
    fontSize: 17,
    fontWeight: "500",
    position: "absolute",
    right: -2,
    top: 13,
  },
  referencePaymentArea: {
    flex: 1,
    justifyContent: "space-between",
    minHeight: 236,
    paddingBottom: 8,
    paddingTop: 22,
  },
  referencePaymentBlock: { alignItems: "center" },
  referenceTotalRow: { alignItems: "center", flexDirection: "row" },
  referenceTotalNumber: {
    color: "#050505",
    fontSize: 46,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    letterSpacing: -1.5,
  },
  referenceTotalCurrencyIcon: { flexShrink: 0, marginLeft: 8 },
  referenceSubmitButton: {
    alignItems: "center",
    backgroundColor: "#FF5B47",
    borderRadius: 7,
    flexDirection: "row",
    gap: 8,
    height: 50,
    justifyContent: "center",
    marginTop: 18,
    width: 224,
  },
  referenceSubmitText: { color: "#FFFFFF", fontSize: 19, fontWeight: "600" },
  moneyActionPending: { opacity: 0.9 },
  moneyActionPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  referenceErrorText: { color: chatMoneyTheme.actionRed, fontSize: 13, marginTop: 12, textAlign: "center" },
  referenceFootnote: {
    color: "#77777A",
    fontSize: 13,
    paddingHorizontal: 24,
    textAlign: "center",
  },
  recipientSelectionSafeArea: { backgroundColor: "#F7F7F8", flex: 1 },
  recipientSelectionHeader: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderBottomColor: chatMoneyTheme.separator,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 48,
    justifyContent: "space-between",
  },
  recipientSelectionHeaderButton: { height: 48, justifyContent: "center", paddingHorizontal: 16, width: 80 },
  recipientSelectionCancel: { color: "#CE9A3C", fontSize: 16 },
  recipientSelectionTitle: { color: "#111111", fontSize: 17, fontWeight: "600" },
  recipientSelectionSearch: {
    backgroundColor: "#E9E9EC",
    borderRadius: 10,
    fontSize: 15,
    height: 38,
    margin: 12,
    paddingHorizontal: 12,
  },
  recipientSelectionEmpty: { alignItems: "center", gap: 12, justifyContent: "center", minHeight: 240 },
  recipientSelectionEmptyText: { color: chatMoneyTheme.secondary, fontSize: 15 },
  recipientSelectionRow: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderBottomColor: chatMoneyTheme.separator,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
  },
  recipientSelectionName: { color: "#111111", flex: 1, fontSize: 16 },
});
