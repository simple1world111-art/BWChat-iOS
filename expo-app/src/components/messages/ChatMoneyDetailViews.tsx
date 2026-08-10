import * as Haptics from "expo-haptics";
import { StatusBar } from "expo-status-bar";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import { Avatar } from "@/components/Avatar";
import type { ChatMoneyActionResult, ChatMoneyDetail, ChatMoneyPayload } from "@/models";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  acceptChatMoneyTransfer,
  cachedChatMoneyDetail,
  claimChatMoneyRedPacket,
  hasViewerClaimedChatMoney,
  loadChatMoneyDetail,
  returnChatMoneyTransfer,
} from "@/services/messages/ChatMoneyRepository";
import {
  canShowRedPacketOpenAction,
  chatMoneyDetailPolicy,
  chatMoneyTheme,
  normalizeChatMoneyErrorCode,
  senderCanClaimOwnRedPacket,
  shouldShowRedPacketEnvelopeFromDetail,
  shouldShowRedPacketEnvelopeFromPayload,
} from "@/services/messages/chatMoneyPolicy";

function triggerMoneyActionPressFeedback() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function ChatMoneyDetailModal({
  visible,
  ownerId,
  ownerName,
  ownerAvatar,
  initialPayload,
  initialSenderAvatar,
  initialSenderName,
  isSender,
  onClose,
  onOpenWallet,
  onOpenBillDetails,
  onResult,
}: {
  visible: boolean;
  ownerId: string;
  ownerName: string;
  ownerAvatar?: string | undefined;
  initialPayload: ChatMoneyPayload | null;
  initialSenderAvatar?: string | undefined;
  initialSenderName?: string | undefined;
  isSender: boolean;
  onClose: () => void;
  onOpenWallet: () => void;
  onOpenBillDetails: () => void;
  onResult: (result: ChatMoneyActionResult) => void;
}) {
  const { t } = useLocalization();
  const [detail, setDetail] = useState<ChatMoneyDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showsEnvelope, setShowsEnvelope] = useState(false);
  const [envelopeDetailOverrideAssetId, setEnvelopeDetailOverrideAssetId] = useState<string | null>(null);
  const [isOpening, setOpening] = useState(false);
  const [isProcessing, setProcessing] = useState(false);
  const generationRef = useRef(0);
  const claimInFlightRef = useRef(false);
  const transferInFlightRef = useRef(false);

  const load = async (force: boolean) => {
    if (!initialPayload) return;
    const generation = generationRef.current;
    setLoadError(null);
    try {
      const loaded = await loadChatMoneyDetail({ ownerId, assetId: initialPayload.asset_id, force });
      if (generation !== generationRef.current) return;
      setDetail(loaded);
      const hasLocalClaim = await hasViewerClaimedChatMoney(ownerId, loaded.asset_id);
      if (generation !== generationRef.current) return;
      if (hasLocalClaim) setEnvelopeDetailOverrideAssetId(loaded.asset_id);
      setShowsEnvelope(shouldShowRedPacketEnvelopeFromDetail(loaded, ownerId, isSender, hasLocalClaim));
    } catch (error) {
      if (generation === generationRef.current) {
        setLoadError(chatMoneyErrorText(error, t));
      }
    }
  };

  useEffect(() => {
    if (!visible || !initialPayload) return;
    generationRef.current += 1;
    const generation = generationRef.current;
    void Promise.resolve().then(() => {
      if (generation !== generationRef.current) return;
      setDetail(cachedChatMoneyDetail(ownerId, initialPayload.asset_id));
      setLoadError(null);
      setOpening(false);
      setProcessing(false);
      return hasViewerClaimedChatMoney(ownerId, initialPayload.asset_id);
    }).then((hasLocalClaim) => {
      if (hasLocalClaim === undefined) return;
      if (!visible) return;
      if (hasLocalClaim) setEnvelopeDetailOverrideAssetId(initialPayload.asset_id);
      setShowsEnvelope(shouldShowRedPacketEnvelopeFromPayload(initialPayload, isSender, hasLocalClaim));
    });
    void Promise.resolve().then(() => load(initialPayload.kind === "red_packet"));
    // load is intentionally scoped to the current modal generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPayload, isSender, ownerId, visible]);

  const resetEnvelopePresentation = () => {
    setEnvelopeDetailOverrideAssetId(null);
    setShowsEnvelope(false);
  };
  const close = () => {
    resetEnvelopePresentation();
    onClose();
  };
  const openWallet = () => {
    resetEnvelopePresentation();
    onOpenWallet();
  };
  const openBillDetails = () => {
    resetEnvelopePresentation();
    onOpenBillDetails();
  };

  if (!initialPayload) return null;

  const isRedPacket = initialPayload.kind === "red_packet";
  const loadedDetail = detail?.asset_id === initialPayload.asset_id ? detail : null;
  const activeDetail = loadedDetail ?? (isRedPacket
    ? provisionalRedPacketDetail(
        initialPayload,
        initialSenderName,
        initialSenderAvatar,
        isSender,
      )
    : null);
  const envelopeIsOverridden = envelopeDetailOverrideAssetId === initialPayload.asset_id;
  const automaticallyShowsEnvelope = isRedPacket && !envelopeIsOverridden
    && (activeDetail
      ? shouldShowRedPacketEnvelopeFromDetail(activeDetail, ownerId, isSender, false)
      : shouldShowRedPacketEnvelopeFromPayload(initialPayload, isSender, false));
  const presentsEnvelope = isRedPacket && !envelopeIsOverridden
    && (showsEnvelope || automaticallyShowsEnvelope);

  const claim = async () => {
    if (!activeDetail || isOpening || claimInFlightRef.current) return;
    claimInFlightRef.current = true;
    setOpening(true);
    setLoadError(null);
    const startedAt = Date.now();
    try {
      const result = await claimChatMoneyRedPacket({
        ownerId,
        ownerName,
        ...(ownerAvatar ? { ownerAvatar } : {}),
        assetId: activeDetail.asset_id,
      });
      const wait = chatMoneyDetailPolicy.claimMinimumAnimationMs - (Date.now() - startedAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      setDetail(result.detail);
      setEnvelopeDetailOverrideAssetId(result.detail.asset_id);
      setShowsEnvelope(false);
      onResult(result);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setLoadError(chatMoneyErrorText(error, t));
      setOpening(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      claimInFlightRef.current = false;
    }
  };

  const performTransfer = async (operation: "accept" | "return") => {
    if (!detail || isProcessing || transferInFlightRef.current) return;
    transferInFlightRef.current = true;
    setProcessing(true);
    setLoadError(null);
    try {
      const result = operation === "accept"
        ? await acceptChatMoneyTransfer({ ownerId, assetId: detail.asset_id })
        : await returnChatMoneyTransfer({ ownerId, assetId: detail.asset_id });
      setDetail(result.detail);
      onResult(result);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setLoadError(chatMoneyErrorText(error, t));
    } finally {
      transferInFlightRef.current = false;
      setProcessing(false);
    }
  };

  return (
    <Modal
      animationType={isRedPacket ? "none" : "slide"}
      onRequestClose={close}
      presentationStyle={isRedPacket ? "overFullScreen" : "fullScreen"}
      transparent={isRedPacket}
      visible={visible}
    >
      {!presentsEnvelope && isRedPacket ? <StatusBar style="light" /> : null}
      {presentsEnvelope ? (
        activeDetail ? (
          <RedPacketOpenEnvelope
            canOpen={canShowRedPacketOpenAction(activeDetail, isSender)}
            detail={activeDetail}
            errorMessage={loadError}
            isOpening={isOpening}
            isSender={isSender}
            onClose={close}
            onOpen={() => void claim()}
            onViewDetails={() => {
              setEnvelopeDetailOverrideAssetId(activeDetail.asset_id);
              setShowsEnvelope(false);
            }}
          />
        ) : (
          <View style={styles.overlayLoading}>
            {loadError ? <LoadError message={loadError} onRetry={() => void load(true)} /> : <ActivityIndicator color="#FFFFFF" size="large" />}
          </View>
        )
      ) : (
        <SafeAreaView
          edges={isRedPacket ? ["bottom"] : ["top", "bottom"]}
          style={styles.detailSafeArea}
        >
          {activeDetail ? (
            activeDetail.kind === "red_packet" ? (
              <RedPacketDetailContent detail={activeDetail} onBack={close} onOpenBillDetails={openBillDetails} onOpenWallet={openWallet} ownerId={ownerId} />
            ) : (
              <TransferDetailContent
                detail={activeDetail}
                errorMessage={loadError}
                isProcessing={isProcessing}
                ownerId={ownerId}
                onAccept={() => void performTransfer("accept")}
                onBack={close}
                onOpenBillDetails={openBillDetails}
                onOpenWallet={openWallet}
                onReturn={() => Alert.alert(
                  t("chatMoney.transfer.returnConfirmTitle"),
                  t("chatMoney.transfer.returnConfirmMessage"),
                  [
                    { text: t("common.cancel"), style: "cancel" },
                    { text: t("chatMoney.transfer.return"), style: "destructive", onPress: () => void performTransfer("return") },
                  ],
                )}
              />
            )
          ) : loadError ? (
            <LoadError message={loadError} onRetry={() => void load(true)} />
          ) : (
            <View style={styles.center}><ActivityIndicator color="#667EEA" /></View>
          )}
        </SafeAreaView>
      )}
    </Modal>
  );
}

function RedPacketOpenEnvelope({
  detail,
  isSender,
  canOpen,
  isOpening,
  errorMessage,
  onClose,
  onOpen,
  onViewDetails,
}: {
  detail: ChatMoneyDetail;
  isSender: boolean;
  canOpen: boolean;
  isOpening: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onOpen: () => void;
  onViewDetails: () => void;
}) {
  const { t } = useLocalization();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rotation] = useState(() => new Animated.Value(0));
  const [entrance] = useState(() => new Animated.Value(0));
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const isDismissingRef = useRef(false);
  const envelopeWidth = Math.min(width - chatMoneyDetailPolicy.envelopeHorizontalMargin * 2, chatMoneyDetailPolicy.envelopeMaximumWidth);
  const usableHeight = height - insets.top - insets.bottom;
  const envelopeHeight = Math.min(Math.max(usableHeight * chatMoneyDetailPolicy.envelopeHeightRatio, chatMoneyDetailPolicy.envelopeMinimumHeight), chatMoneyDetailPolicy.envelopeMaximumHeight);

  useEffect(() => {
    entrance.setValue(0);
    const animation = Animated.spring(entrance, {
      damping: 20,
      mass: 0.8,
      stiffness: 260,
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [detail.asset_id, entrance]);

  useEffect(() => {
    if (!isOpening) {
      animationRef.current?.stop();
      rotation.setValue(0);
      return;
    }
    animationRef.current = Animated.loop(Animated.timing(rotation, {
      duration: chatMoneyDetailPolicy.claimMinimumAnimationMs,
      toValue: 1,
      useNativeDriver: true,
    }), { iterations: 20 });
    animationRef.current.start();
    return () => animationRef.current?.stop();
  }, [isOpening, rotation]);

  const waiting = isSender && detail.mode === "exclusive"
    ? t("chatMoney.redPacket.waitingForExclusiveRecipient")
    : t("chatMoney.redPacket.waitingForRecipient");
  const dismiss = (completion: () => void) => {
    if (isDismissingRef.current) return;
    isDismissingRef.current = true;
    Animated.timing(entrance, {
      duration: 140,
      toValue: 0,
      useNativeDriver: true,
    }).start(() => completion());
  };
  return (
    <View style={styles.envelopeBackdrop}>
      <Animated.View
        style={[
          styles.envelopeStack,
          { marginTop: insets.top },
          {
            opacity: entrance,
            transform: [
              { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
              { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [18, -6] }) },
            ],
          },
        ]}
      >
        <View style={[styles.envelope, { height: envelopeHeight, width: envelopeWidth }] }>
          <Svg height={envelopeHeight * chatMoneyDetailPolicy.envelopeFoldRatio} style={styles.envelopeFold} width={envelopeWidth}>
            <Path
              d={`M0 0 Q${envelopeWidth / 2} ${envelopeHeight * 0.17} ${envelopeWidth} 0 L${envelopeWidth} ${envelopeHeight * chatMoneyDetailPolicy.envelopeFoldRatio} L0 ${envelopeHeight * chatMoneyDetailPolicy.envelopeFoldRatio} Z`}
              fill="rgba(201,75,56,0.62)"
            />
          </Svg>
          <View style={[styles.envelopeContent, { paddingTop: envelopeHeight * chatMoneyDetailPolicy.envelopeContentTopRatio }] }>
            <View style={styles.senderHeadline}>
              <Avatar name={detail.sender_name || t("chatMoney.sender")} size={30} uri={detail.sender_avatar_url} />
              <Text numberOfLines={1} style={styles.senderHeadlineText}>{t("chatMoney.redPacket.sentBy", detail.sender_name || t("chatMoney.sender"))}</Text>
            </View>
            <Text numberOfLines={2} style={styles.envelopeGreeting}>{detail.greeting || t("chatMoney.redPacket.defaultGreeting")}</Text>
            <View style={styles.envelopeFlexibleSpace} />
            {canOpen ? (
              <Pressable
                accessibilityLabel={t("chatMoney.redPacket.claimPrompt")}
                disabled={isOpening}
                onPress={onOpen}
                onPressIn={triggerMoneyActionPressFeedback}
                style={({ pressed }) => [
                  isOpening && styles.moneyActionPending,
                  pressed && styles.moneyActionPressed,
                ]}
              >
                <Animated.View style={[styles.openButton, {
                  transform: [{ perspective: 700 }, { rotateY: rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "720deg"] }) }],
                }] }>
                  <Text style={styles.openText}>{t("chatMoney.redPacket.open")}</Text>
                </Animated.View>
              </Pressable>
            ) : (
              <View style={styles.waitingBlock}>
                <View style={styles.waitingButton}><SymbolView name="clock" size={30} weight="medium" tintColor={chatMoneyTheme.envelopeDarkRed} /></View>
                <Text style={styles.waitingText}>{waiting}</Text>
              </View>
            )}
            {errorMessage ? <Text style={styles.envelopeError}>{errorMessage}</Text> : null}
            <View style={styles.envelopeFlexibleSpace} />
            <Pressable disabled={isOpening} onPress={() => dismiss(onViewDetails)}>
              <Text style={styles.viewDetailsText}>{t("chatMoney.redPacket.viewDetails")}</Text>
            </Pressable>
          </View>
        </View>
        <Pressable accessibilityLabel={t("common.close")} onPress={() => dismiss(onClose)} style={styles.closeCircle}>
          <SymbolView name="xmark" size={19} weight="medium" tintColor="rgba(244,212,155,0.92)" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

function provisionalRedPacketDetail(
  payload: ChatMoneyPayload,
  senderName: string | undefined,
  senderAvatar: string | undefined,
  isSender: boolean,
): ChatMoneyDetail {
  const canClaim = shouldShowRedPacketEnvelopeFromPayload(payload, isSender, false);
  const claimedCount = payload.claimed_count ?? 0;
  return {
    ...payload,
    ...(senderName ? { sender_name: senderName } : {}),
    ...(senderAvatar ? { sender_avatar_url: senderAvatar } : {}),
    can_claim: canClaim,
    can_accept: false,
    can_return: false,
    claims: [],
    claimed_count: claimedCount,
    remaining_count: payload.packet_count !== undefined
      ? Math.max(payload.packet_count - claimedCount, 0)
      : 1,
    ...(canClaim ? { viewer_state: "claimable" as const } : {}),
  };
}

function RedPacketDetailContent({ detail, ownerId, onBack, onOpenWallet, onOpenBillDetails }: { detail: ChatMoneyDetail; ownerId: string; onBack: () => void; onOpenWallet: () => void; onOpenBillDetails: () => void }) {
  const { t } = useLocalization();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const headerHeight = chatMoneyDetailPolicy.headerHeight + insets.top;
  const headerCurveStart = 115 + insets.top;
  const claimed = detail.viewer_claim_amount;
  const summary = detail.claimed_count !== undefined && detail.packet_count !== undefined
    ? t("chatMoney.redPacket.summary", detail.claimed_count, detail.packet_count)
    : t("chatMoney.redPacket.claims");
  return (
    <View style={styles.redDetailRoot}>
      <View style={[styles.redHeader, { height: headerHeight }] }>
        <Svg height={headerHeight} width="100%">
          <Path d={`M0 0 H${width} V${headerCurveStart} Q${width / 2} ${headerHeight} 0 ${headerCurveStart} Z`} fill={chatMoneyTheme.envelopeRed} />
          <Path d={`M0 ${headerCurveStart} Q${width / 2} ${headerHeight} ${width} ${headerCurveStart}`} fill="none" stroke={chatMoneyTheme.gold} strokeWidth="2" />
        </Svg>
      </View>
      <View style={[styles.redHeaderNavigation, { top: insets.top + 4 }] }>
        <Pressable hitSlop={10} onPress={onBack} style={styles.detailNavigationButton}>
          <SymbolView name="chevron.left" size={19} weight="semibold" tintColor="#FFFFFF" />
        </Pressable>
        <Pressable hitSlop={10} onPress={onOpenBillDetails} style={styles.detailNavigationButton}>
          <SymbolView name="ellipsis" size={19} weight="semibold" tintColor="#FFFFFF" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.redDetailContent} showsVerticalScrollIndicator={false}>
        <View style={{ height: 164 + insets.top }} />
        <View style={styles.redSenderRow}>
          <Avatar name={detail.sender_name || t("chatMoney.sender")} size={30} uri={detail.sender_avatar_url} />
          <Text numberOfLines={1} style={styles.redSenderName}>{t("chatMoney.redPacket.sentBy", detail.sender_name || t("chatMoney.sender"))}</Text>
        </View>
        <Text style={styles.redGreeting}>{detail.greeting || t("chatMoney.redPacket.defaultGreeting")}</Text>
        {claimed !== undefined ? (
          <View style={styles.claimedSummary}>
            <View style={styles.claimedAmountRow}>
              <Text style={styles.claimedAmount}>{claimed}</Text>
              <Text style={styles.claimedUnit}>{t("wallet.currency.goldCoins")}</Text>
            </View>
            <Pressable onPress={onOpenWallet} style={styles.depositedRow}>
              <Text style={styles.depositedText}>{t("chatMoney.redPacket.depositedToBalance")}</Text>
              <SymbolView name="chevron.right" size={12} weight="semibold" tintColor={chatMoneyTheme.gold} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.redStatusSummary}>
            <Text style={styles.redStatusTitle}>{redPacketStatusText(detail, ownerId, t)}</Text>
            {detail.scope === "dm" ? <Text style={styles.redStatusSubtext}>{summary}</Text> : null}
          </View>
        )}
        {detail.scope === "group" ? (
          <View style={styles.claimList}>
            <View style={styles.claimListHeader}><Text style={styles.claimListHeaderText}>{summary}</Text></View>
            {detail.claims.length === 0 ? (
              <Text style={styles.noClaims}>{t("chatMoney.redPacket.noClaims")}</Text>
            ) : detail.claims.map((claim) => (
              <View key={claim.user_id} style={styles.claimRow}>
                <Avatar name={claim.nickname} size={40} uri={claim.avatar_url} />
                <View style={styles.claimIdentity}>
                  <View style={styles.claimNameRow}>
                    <Text style={styles.claimName}>{claim.nickname}</Text>
                    {claim.is_luckiest && (detail.status === "completed" || detail.claimed_count === detail.packet_count) ? <Text style={styles.luckiest}>{t("chatMoney.redPacket.luckiest")}</Text> : null}
                  </View>
                  <Text style={styles.claimTime}>{formatTime(claim.claimed_at)}</Text>
                </View>
                <Text style={styles.claimValue}>{t("chatMoney.amountValue", claim.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function TransferDetailContent({ detail, ownerId, isProcessing, errorMessage, onBack, onAccept, onReturn, onOpenWallet, onOpenBillDetails }: { detail: ChatMoneyDetail; ownerId: string; isProcessing: boolean; errorMessage: string | null; onBack: () => void; onAccept: () => void; onReturn: () => void; onOpenWallet: () => void; onOpenBillDetails: () => void }) {
  const { t } = useLocalization();
  const pending = detail.status === "pending" || detail.status === "partial";
  const accepted = detail.status === "accepted" || detail.viewer_state === "accepted";
  const viewerIsRecipient = detail.viewer_state === "transfer_receivable" || detail.recipient_id === ownerId;
  const showsBalance = accepted && viewerIsRecipient;
  const statusSymbol: SFSymbol = pending ? "clock" : accepted ? "checkmark" : "arrow.uturn.backward";
  const statusColor = pending ? "#10AEFF" : accepted ? chatMoneyTheme.actionGreen : "#B2B2B2";
  const statusTitle = transferStatusTitle(detail, ownerId, t);
  return (
    <View style={styles.transferRoot}>
      <View style={styles.transferHeader}>
        <Pressable hitSlop={10} onPress={onBack} style={styles.detailNavigationButton}>
          <SymbolView name="chevron.left" size={19} weight="semibold" tintColor="#111111" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.transferContent} showsVerticalScrollIndicator={false}>
        {pending ? (
          <SymbolView name="clock" size={64} weight="regular" tintColor={statusColor} />
        ) : (
          <View style={[styles.transferStatusCircle, { backgroundColor: statusColor }] }>
            <SymbolView name={statusSymbol} size={29} weight="bold" tintColor="#FFFFFF" />
          </View>
        )}
        <Text style={styles.transferStatusTitle}>{statusTitle}</Text>
        <View style={styles.transferDetailAmountRow}>
          <Text style={styles.transferDetailAmount}>{detail.total_amount ?? detail.amount ?? 0}</Text>
          <Text style={styles.transferDetailUnit}>{t("wallet.currency.goldCoins")}</Text>
        </View>
        {detail.note?.trim() ? <Text style={styles.transferNote}>{detail.note}</Text> : null}
        {showsBalance ? <Pressable onPress={onOpenWallet}><Text style={styles.transferBalanceLink}>{t("wallet.balance")}</Text></Pressable> : null}
        <View style={[styles.transferTimes, { marginTop: showsBalance ? 40 : 52 }] }>
          {detail.created_at ? <TimeRow title={t("chatMoney.transfer.transferTime")} timestamp={detail.created_at} /> : null}
          {!pending && detail.finalized_at ? <TimeRow title={accepted ? t("chatMoney.transfer.receivedTime") : t("chatMoney.transfer.returnedTime")} timestamp={detail.finalized_at} /> : null}
        </View>
        {showsBalance ? (
          <View style={styles.walletCenter}>
            <View style={styles.walletPaw}><SymbolView name="pawprint.fill" size={26} weight="semibold" tintColor="#F4B400" /></View>
            <View style={styles.walletCopy}><Text style={styles.walletEyebrow}>{t("chatMoney.transfer.walletCenter")}</Text><Text style={styles.walletTitle}>{t("chatMoney.transfer.walletCenterSubtitle")}</Text></View>
            <Pressable onPress={onOpenWallet} style={styles.walletButton}><Text style={styles.walletButtonText}>{t("chatMoney.transfer.enterWallet")}</Text></Pressable>
          </View>
        ) : null}
        {errorMessage ? <Text style={styles.transferError}>{errorMessage}</Text> : null}
        <View style={styles.transferFlexibleSpace} />
        {pending ? (
          <View style={styles.transferActions}>
            {detail.can_accept ? (
              <Pressable
                disabled={isProcessing}
                onPress={onAccept}
                onPressIn={triggerMoneyActionPressFeedback}
                style={({ pressed }) => [
                  styles.acceptButton,
                  isProcessing && styles.moneyActionPending,
                  pressed && styles.moneyActionPressed,
                ]}
              >
                <Text style={styles.acceptButtonText}>{t("chatMoney.transfer.acceptShort")}</Text>
              </Pressable>
            ) : null}
            <View style={styles.expiryActionRow}>
              <Text style={styles.expiryActionText}>{t("chatMoney.transfer.expiryActionNotice")}</Text>
              {detail.can_return ? <Pressable disabled={isProcessing} onPress={onReturn}><Text style={styles.returnLink}>{t("chatMoney.transfer.return")}</Text></Pressable> : null}
            </View>
          </View>
        ) : (
          <Pressable onPress={onOpenBillDetails}><Text style={styles.billDetailsLink}>{t("chatMoney.transfer.billDetails")}</Text></Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function TimeRow({ title, timestamp }: { title: string; timestamp: string }) {
  return <View style={styles.timeRow}><Text style={styles.timeLabel}>{title}</Text><Text style={styles.timeValue}>{formatDetailedTime(timestamp)}</Text></View>;
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useLocalization();
  return (
    <View style={styles.loadError}>
      <SymbolView name="exclamationmark.triangle.fill" size={36} weight="regular" tintColor={chatMoneyTheme.actionRed} />
      <Text style={styles.loadErrorText}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.retryButton}><Text style={styles.retryText}>{t("common.retry")}</Text></Pressable>
    </View>
  );
}

function redPacketStatusText(detail: ChatMoneyDetail, ownerId: string, t: (key: string, ...args: (string | number)[]) => string): string {
  if (detail.sender_id === ownerId && !senderCanClaimOwnRedPacket(detail.scope, detail.mode)
    && !detail.unavailable_reason && (detail.status === "pending" || detail.status === "partial")) {
    return t("chatMoney.redPacket.waitingForRecipient");
  }
  switch (detail.unavailable_reason) {
    case "red_packet_already_claimed": return t("chatMoney.redPacket.alreadyClaimed");
    case "red_packet_empty": return t("chatMoney.redPacket.empty");
    case "red_packet_expired": return t("chatMoney.redPacket.expired");
    case "red_packet_recipient_only": return t("chatMoney.redPacket.exclusiveOnly");
    case "not_conversation_member": return t("chatMoney.redPacket.notConversationMember");
    default: return t(`chatMoney.status.${statusKey(detail.status)}`);
  }
}

function transferStatusTitle(detail: ChatMoneyDetail, ownerId: string, t: (key: string, ...args: (string | number)[]) => string): string {
  if (detail.status === "accepted" || detail.viewer_state === "accepted") {
    if (detail.recipient_id === ownerId) return t("chatMoney.transfer.receivedIntoBalance");
    if (detail.sender_id === ownerId && detail.recipient_name) return t("chatMoney.receipt.transferAcceptedMine", detail.recipient_name);
    return t("chatMoney.receipt.transferAccepted");
  }
  switch (detail.viewer_state) {
    case "transfer_receivable": return t("chatMoney.transfer.waitingForYou");
    case "transfer_sender_waiting": return t("chatMoney.transfer.waitingForRecipient");
    case "transfer_observer": return t("chatMoney.transfer.pendingReceipt");
    case "returned": return t("chatMoney.status.returned");
    case "expired_refunded": return t("chatMoney.status.expiredRefunded");
    default: return t(`chatMoney.status.${statusKey(detail.status)}`);
  }
}

function statusKey(status: ChatMoneyDetail["status"]): string {
  return status === "expired_refunded" ? "expiredRefunded" : status;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDetailedTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function chatMoneyErrorText(
  error: unknown,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const raw = error instanceof Error ? error.message : "";
  return (normalizeChatMoneyErrorCode(raw, t) ?? raw) || t("chatMoney.operationFailed");
}

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, justifyContent: "center" },
  detailSafeArea: { backgroundColor: "#FFFFFF", flex: 1 },
  overlayLoading: { alignItems: "center", backgroundColor: "transparent", flex: 1, justifyContent: "center" },
  envelopeBackdrop: { alignItems: "center", backgroundColor: "transparent", flex: 1, justifyContent: "center" },
  envelopeStack: { alignItems: "center", gap: 22 },
  envelope: { backgroundColor: chatMoneyTheme.envelopeRed, borderRadius: chatMoneyDetailPolicy.envelopeRadius, overflow: "hidden", shadowColor: "#000000", shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.26, shadowRadius: 24 },
  envelopeFold: { bottom: 0, left: 0, position: "absolute" },
  envelopeContent: { alignItems: "center", bottom: 0, left: 0, paddingBottom: 22, position: "absolute", right: 0, top: 0 },
  senderHeadline: { alignItems: "center", flexDirection: "row", gap: 8 },
  senderHeadlineText: { color: chatMoneyTheme.gold, fontSize: 17, fontWeight: "600", maxWidth: 240 },
  envelopeGreeting: { color: chatMoneyTheme.gold, fontSize: 21, fontWeight: "500", marginTop: 21, paddingHorizontal: 26, textAlign: "center" },
  envelopeFlexibleSpace: { flex: 1 },
  openButton: { alignItems: "center", backgroundColor: chatMoneyTheme.gold, borderRadius: chatMoneyDetailPolicy.openButtonSize / 2, height: chatMoneyDetailPolicy.openButtonSize, justifyContent: "center", shadowColor: "#000000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.16, shadowRadius: 4, width: chatMoneyDetailPolicy.openButtonSize },
  openText: { color: chatMoneyTheme.envelopeDarkRed, fontSize: 34, fontWeight: "500" },
  waitingBlock: { alignItems: "center", gap: 10 },
  waitingButton: { alignItems: "center", backgroundColor: "rgba(244,212,155,0.94)", borderRadius: chatMoneyDetailPolicy.waitingButtonSize / 2, height: chatMoneyDetailPolicy.waitingButtonSize, justifyContent: "center", width: chatMoneyDetailPolicy.waitingButtonSize },
  waitingText: { color: "rgba(244,212,155,0.94)", fontSize: 14 },
  envelopeError: { color: "rgba(255,255,255,0.92)", fontSize: 12, marginTop: 12, paddingHorizontal: 24, textAlign: "center" },
  viewDetailsText: { color: "rgba(244,212,155,0.94)", fontSize: 14, fontWeight: "500" },
  closeCircle: { alignItems: "center", borderColor: "rgba(244,212,155,0.82)", borderRadius: 24, borderWidth: 1.5, height: 48, justifyContent: "center", width: 48 },
  redDetailRoot: { backgroundColor: "#FFFFFF", flex: 1 },
  redHeader: { left: 0, overflow: "hidden", position: "absolute", right: 0, top: 0 },
  redHeaderNavigation: { flexDirection: "row", justifyContent: "space-between", left: 8, position: "absolute", right: 8, top: 4, zIndex: 2 },
  detailNavigationButton: { alignItems: "center", height: 36, justifyContent: "center", width: 42 },
  redDetailContent: { paddingBottom: 90 },
  redSenderRow: { alignItems: "center", flexDirection: "row", gap: 9, justifyContent: "center" },
  redSenderName: { color: "#111111", fontSize: 19, fontWeight: "600", maxWidth: "75%" },
  redGreeting: { color: "#B2B2B2", fontSize: 15, marginTop: 12, paddingHorizontal: 24, textAlign: "center" },
  claimedSummary: { alignItems: "center" },
  claimedAmountRow: { alignItems: "baseline", flexDirection: "row", gap: 7, marginTop: 27 },
  claimedAmount: { color: chatMoneyTheme.gold, fontSize: chatMoneyDetailPolicy.claimedAmountFontSize, fontWeight: "500", fontVariant: ["tabular-nums"] },
  claimedUnit: { color: chatMoneyTheme.gold, fontSize: 17 },
  depositedRow: { alignItems: "center", flexDirection: "row", gap: 7, marginTop: 14 },
  depositedText: { color: chatMoneyTheme.gold, fontSize: 15 },
  redStatusSummary: { alignItems: "center", gap: 12, marginTop: 34, paddingHorizontal: 24 },
  redStatusTitle: { color: "#111111", fontSize: 23, fontWeight: "500", textAlign: "center" },
  redStatusSubtext: { color: chatMoneyTheme.secondary, fontSize: 14 },
  claimList: { backgroundColor: chatMoneyTheme.pageBackground, marginTop: 42 },
  claimListHeader: { borderBottomColor: chatMoneyTheme.separator, borderBottomWidth: StyleSheet.hairlineWidth, height: 44, justifyContent: "center", paddingHorizontal: 16 },
  claimListHeaderText: { color: chatMoneyTheme.secondary, fontSize: 13 },
  noClaims: { color: "#B2B2B2", fontSize: 14, paddingVertical: 36, textAlign: "center" },
  claimRow: { alignItems: "center", borderBottomColor: chatMoneyTheme.separator, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 12, height: chatMoneyDetailPolicy.claimRowHeight, marginLeft: 16, paddingRight: 16 },
  claimIdentity: { flex: 1, gap: 4 },
  claimNameRow: { alignItems: "center", flexDirection: "row", gap: 6 },
  claimName: { color: "#111111", fontSize: 15 },
  luckiest: { color: chatMoneyTheme.cardOrange, fontSize: 10 },
  claimTime: { color: "#B2B2B2", fontSize: 11 },
  claimValue: { color: "#111111", fontSize: 15 },
  transferRoot: { backgroundColor: "#FFFFFF", flex: 1 },
  transferHeader: { height: 44, justifyContent: "center", paddingLeft: 8 },
  transferContent: { alignItems: "center", flexGrow: 1, paddingTop: 66 },
  transferStatusCircle: { alignItems: "center", borderRadius: chatMoneyDetailPolicy.transferStatusIconSize / 2, height: chatMoneyDetailPolicy.transferStatusIconSize, justifyContent: "center", width: chatMoneyDetailPolicy.transferStatusIconSize },
  transferStatusTitle: { color: "#111111", fontSize: 18, marginTop: 42, paddingHorizontal: 30, textAlign: "center" },
  transferDetailAmountRow: { alignItems: "baseline", flexDirection: "row", gap: 6, marginTop: 22 },
  transferDetailAmount: { color: "#111111", fontSize: chatMoneyDetailPolicy.transferAmountFontSize, fontWeight: "500", fontVariant: ["tabular-nums"] },
  transferDetailUnit: { color: "#111111", fontSize: 15 },
  transferNote: { color: chatMoneyTheme.secondary, fontSize: 14, marginTop: 12, paddingHorizontal: 30, textAlign: "center" },
  transferBalanceLink: { color: chatMoneyTheme.link, fontSize: 15, fontWeight: "500", marginTop: 22 },
  transferTimes: { borderBottomColor: chatMoneyTheme.separator, borderBottomWidth: StyleSheet.hairlineWidth, borderTopColor: chatMoneyTheme.separator, borderTopWidth: StyleSheet.hairlineWidth, gap: 12, paddingHorizontal: 30, paddingVertical: 18, width: "100%" },
  timeRow: { alignItems: "baseline", flexDirection: "row", gap: 16 },
  timeLabel: { color: chatMoneyTheme.secondary, fontSize: 15 },
  timeValue: { color: "#111111", flex: 1, fontSize: 15, fontVariant: ["tabular-nums"], textAlign: "right" },
  walletCenter: { alignItems: "center", flexDirection: "row", gap: 12, paddingHorizontal: 30, paddingVertical: 20, width: "100%" },
  walletPaw: { alignItems: "center", backgroundColor: "#F7F7F7", borderRadius: 27, height: 54, justifyContent: "center", width: 54 },
  walletCopy: { flex: 1, gap: 5 },
  walletEyebrow: { color: chatMoneyTheme.secondary, fontSize: 14 },
  walletTitle: { color: "#111111", fontSize: 16 },
  walletButton: { alignItems: "center", backgroundColor: chatMoneyTheme.actionGreen, borderRadius: 7, height: 39, justifyContent: "center", paddingHorizontal: 15 },
  walletButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "500" },
  transferFlexibleSpace: { flex: 1, minHeight: 32 },
  transferActions: { gap: 24, paddingBottom: 36, paddingHorizontal: 42, width: "100%" },
  acceptButton: { alignItems: "center", backgroundColor: chatMoneyTheme.actionGreen, borderRadius: 8, flexDirection: "row", gap: 8, height: chatMoneyDetailPolicy.transferActionHeight, justifyContent: "center" },
  acceptButtonText: { color: "#FFFFFF", fontSize: 18, fontWeight: "500" },
  moneyActionPending: { opacity: 0.9 },
  moneyActionPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  expiryActionRow: { alignItems: "center", flexDirection: "row", gap: 3, justifyContent: "center" },
  expiryActionText: { color: chatMoneyTheme.secondary, fontSize: 14, textAlign: "center" },
  returnLink: { color: chatMoneyTheme.link, fontSize: 14 },
  billDetailsLink: { color: chatMoneyTheme.link, fontSize: 16, fontWeight: "500", paddingBottom: 42 },
  transferError: { color: chatMoneyTheme.actionRed, fontSize: 12, marginTop: 12, paddingHorizontal: 30, textAlign: "center" },
  loadError: { alignItems: "center", gap: 16, padding: 28 },
  loadErrorText: { color: chatMoneyTheme.secondary, fontSize: 14, textAlign: "center" },
  retryButton: { backgroundColor: "#667EEA", borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "500" },
});
