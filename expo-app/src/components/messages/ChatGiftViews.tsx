import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";

import { getGroupDetail } from "@/api/bwchat";
import { nativeAssets } from "../../assets/nativeAssets";
import { Avatar, UserAvatarButton } from "@/components/Avatar";
import { useChatMessageActivationGuard } from "@/components/messages/ChatReplyViews";
import type {
  GiftCatalogItem,
  GiftMessagePayload,
  GiftRecipient,
  WalletBalanceSnapshot,
} from "@/models";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import {
  loadCachedGroupDetail,
  saveCachedGroupDetail,
} from "@/services/groups/GroupDetailRepository";
import {
  loadGiftCatalog,
  readCachedGiftWalletBalance,
  refreshGiftWalletBalance,
} from "@/services/messages/ChatGiftRepository";
import { verifiedChatRemoteAssetUri } from "@/services/messages/ChatRemoteAssetService";
import {
  chatGiftAnimationPolicy,
  chatGiftBubblePolicy,
  chatGiftPickerPolicy,
  fixedGiftCatalog,
  giftAnimationRotation,
  giftAssetColors,
  giftDisplayAssetKey,
  giftParticleSymbol,
  localizedGiftCatalogName,
  localizedGiftPayloadName,
} from "@/services/messages/chatGiftPolicy";
import { trustedChatStickerRemoteAsset } from "@/services/messages/chatStickerPolicy";
import { colors, palette } from "@/theme";

export type GiftRecipientSource =
  | { kind: "fixed"; recipient: GiftRecipient }
  | { kind: "group"; groupId: number; groupName: string };

export function ChatGiftPickerSheet({
  visible,
  ownerId,
  source,
  onClose,
  onOpenWallet,
  onSend,
  onSendFailure,
}: {
  visible: boolean;
  ownerId: string;
  source: GiftRecipientSource;
  onClose: () => void;
  onOpenWallet: () => void;
  onSend: (gift: GiftCatalogItem, recipient: GiftRecipient) => Promise<void>;
  onSendFailure: (message: string) => void;
}) {
  const { activeLanguage, t } = useLocalization();
  const theme = palette(useColorScheme());
  const { width, height } = useWindowDimensions();
  const [gifts, setGifts] = useState<GiftCatalogItem[]>([...fixedGiftCatalog]);
  const [recipients, setRecipients] = useState<GiftRecipient[]>([]);
  const [selectedRecipient, setSelectedRecipient] = useState<GiftRecipient | null>(null);
  const [selectedGiftId, setSelectedGiftId] = useState(fixedGiftCatalog[0]?.gift_id ?? "");
  const [balance, setBalance] = useState<WalletBalanceSnapshot | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [isSending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [animatingGift, setAnimatingGift] = useState<GiftCatalogItem | null>(null);
  const generationRef = useRef(0);
  const selectedGift =
    gifts.find((gift) => gift.gift_id === selectedGiftId) ?? gifts[0] ?? fixedGiftCatalog[0]!;
  const shouldPickRecipient = source.kind === "group" && selectedRecipient === null;
  const sheetHeight = Math.min(height * 0.5, height - 64);
  const cardWidth = Math.max(90, (width - 52) / chatGiftPickerPolicy.gridColumns);

  useEffect(() => {
    if (!visible) return;
    const generation = ++generationRef.current;
    void (async () => {
      await Promise.resolve();
      if (generation !== generationRef.current) return;
      setLoading(true);
      setSending(false);
      setAnimatingGift(null);
      setErrorMessage(null);
      setGifts([...fixedGiftCatalog]);
      setSelectedGiftId(fixedGiftCatalog[0]?.gift_id ?? "");
      setBalance(null);
      await loadRecipients();
      if (generation !== generationRef.current) return;
      const catalog = await loadGiftCatalog(ownerId);
      if (generation !== generationRef.current) return;
      setGifts(catalog.gifts);
      setSelectedGiftId((current) =>
        catalog.gifts.some((gift) => gift.gift_id === current)
          ? current
          : (catalog.gifts[0]?.gift_id ?? fixedGiftCatalog[0]!.gift_id),
      );
      if (catalog.usedFallback) setErrorMessage(t("gift.catalogFallback"));
      const cachedBalance = await readCachedGiftWalletBalance(ownerId);
      if (generation !== generationRef.current) return;
      if (cachedBalance) setBalance(cachedBalance);
      try {
        const nextBalance = await refreshGiftWalletBalance(ownerId);
        if (generation === generationRef.current) setBalance(nextBalance);
      } catch {
        // Native keeps the cached in-memory balance when refresh fails.
      } finally {
        if (generation === generationRef.current) setLoading(false);
      }
    })();

    async function loadRecipients() {
      if (source.kind === "fixed") {
        setRecipients([source.recipient]);
        setSelectedRecipient(source.recipient);
        return;
      }
      setSelectedRecipient(null);
      const setMembers = (members: Awaited<ReturnType<typeof getGroupDetail>>["members"]) => {
        const next = members
          .filter((member) => member.user_id !== ownerId)
          .map((member) => ({
            id: member.user_id,
            name: member.nickname,
            avatar_url: member.avatar_url,
          }));
        setRecipients(next);
        setSelectedRecipient((current) =>
          current && next.some((recipient) => recipient.id === current.id) ? current : null,
        );
      };
      const cached = await loadCachedGroupDetail(ownerId, source.groupId);
      if (generation !== generationRef.current) return;
      if (cached) setMembers(cached.members);
      try {
        const detail = await getGroupDetail(source.groupId);
        if (generation !== generationRef.current) return;
        await saveCachedGroupDetail(ownerId, detail);
        setMembers(detail.members);
      } catch {
        if (!cached) setErrorMessage(t("gift.groupMembersLoadFailed"));
      }
    }
  }, [ownerId, source, t, visible]);

  const refreshBalance = async () => {
    try {
      setBalance(await refreshGiftWalletBalance(ownerId));
    } catch {
      // The native refresh button leaves the previous value on screen.
    }
  };

  const sendSelectedGift = () => {
    if (!selectedRecipient || isSending) return;
    if (!balance) {
      void refreshBalance();
      return;
    }
    if (selectedGift.price > balance.spendable_balance) {
      onClose();
      setTimeout(onOpenWallet, chatGiftPickerPolicy.walletOpenDelayMs);
      return;
    }
    setSending(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAnimatingGift(selectedGift);
    requestAnimationFrame(() => {
      void onSend(selectedGift, selectedRecipient)
        .then(() => refreshGiftWalletBalance(ownerId))
        .then(setBalance)
        .catch((error: unknown) => {
          onSendFailure(error instanceof Error ? error.message : t("gift.sendFailed"));
        });
    });
    setTimeout(onClose, chatGiftPickerPolicy.localAnimationLifetimeMs);
  };

  const affordable = balance ? selectedGift.price <= balance.spendable_balance : false;
  const buttonTitle = !balance
    ? t("wallet.balance.loading")
    : affordable
      ? t("gift.sendGift", localizedGiftCatalogName(selectedGift, activeLanguage, t))
      : t("gift.insufficientBalance");
  const buttonSymbol: SFSymbol = !balance
    ? "arrow.clockwise"
    : affordable
      ? "paperplane.fill"
      : "cart.fill";

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel={t("common.cancel")}
          onPress={onClose}
          style={styles.systemBackdrop}
        />
        <View style={[styles.sheet, { height: sheetHeight, backgroundColor: theme.background }]}>
          <View style={styles.dragIndicator} />
          {isLoading && recipients.length === 0 ? (
            <ActivityIndicator color={theme.accent} style={styles.loadingIndicator} />
          ) : shouldPickRecipient ? (
            <View style={styles.fill}>
              <Text style={[styles.recipientTitle, { color: theme.text }]}>
                {t("gift.chooseRecipient")}
              </Text>
              {recipients.length === 0 ? (
                <View style={styles.emptyRecipients}>
                  <SymbolView
                    name="person.2.slash"
                    size={chatGiftPickerPolicy.emptyIconSize}
                    tintColor={theme.tertiaryText}
                  />
                  <Text style={[styles.emptyRecipientText, { color: theme.secondaryText }]}>
                    {errorMessage ?? t("gift.noRecipients")}
                  </Text>
                </View>
              ) : (
                <ScrollView contentContainerStyle={styles.recipientList}>
                  {recipients.map((recipient) => (
                    <Pressable
                      key={recipient.id}
                      onPress={() => setSelectedRecipient(recipient)}
                      style={[styles.recipientRow, { backgroundColor: theme.card }]}
                    >
                      <Avatar
                        uri={recipient.avatar_url}
                        name={recipient.name}
                        size={chatGiftPickerPolicy.recipientAvatarSize}
                      />
                      <Text numberOfLines={1} style={[styles.recipientName, { color: theme.text }]}>
                        {recipient.name}
                      </Text>
                      <View style={styles.fill} />
                      <SymbolView
                        name="chevron.right"
                        size={chatGiftPickerPolicy.recipientChevronSize}
                        weight="bold"
                        tintColor={theme.tertiaryText}
                      />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          ) : (
            <View style={styles.fill}>
              <View style={styles.balanceHeader}>
                <View style={styles.balanceIconCircle}>
                  <Image
                    contentFit="contain"
                    source={nativeAssets.activityCatFood}
                    style={styles.balanceIcon}
                    transition={0}
                  />
                </View>
                <View style={styles.balanceCopy}>
                  <Text style={[styles.balanceLabel, { color: theme.secondaryText }]}>
                    {t("activityCatFood.spendableBalance")}
                  </Text>
                  <Text
                    style={[
                      balance ? styles.balanceValue : styles.balanceLoading,
                      { color: theme.text },
                    ]}
                  >
                    {balance?.spendable_balance ?? t("common.loading")}
                  </Text>
                  {balance ? (
                    <Text
                      numberOfLines={1}
                      style={[styles.balanceBreakdown, { color: theme.secondaryText }]}
                    >
                      {t(
                        "activityCatFood.payment.balanceBreakdown",
                        balance.activity_cat_food_balance,
                        balance.gold_coin_balance,
                      )}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.fill} />
                <Pressable
                  onPress={() => void refreshBalance()}
                  style={[styles.refreshButton, { backgroundColor: theme.accentSoft }]}
                >
                  <SymbolView
                    name="arrow.clockwise"
                    size={chatGiftPickerPolicy.refreshIconSize}
                    weight="bold"
                    tintColor={theme.accent}
                  />
                </Pressable>
              </View>

              {selectedRecipient ? (
                <View style={styles.recipientSummary}>
                  <Text style={[styles.toLabel, { color: theme.secondaryText }]}>
                    {t("gift.to")}
                  </Text>
                  <Avatar
                    uri={selectedRecipient.avatar_url}
                    name={selectedRecipient.name}
                    size={chatGiftPickerPolicy.recipientSummaryAvatarSize}
                  />
                  <Text
                    adjustsFontSizeToFit
                    minimumFontScale={0.84}
                    numberOfLines={1}
                    style={[styles.summaryName, { color: theme.text }]}
                  >
                    {selectedRecipient.name}
                  </Text>
                  <View style={styles.fill} />
                  {source.kind === "group" ? (
                    <Pressable onPress={() => setSelectedRecipient(null)}>
                      <Text style={[styles.changeText, { color: theme.accent }]}>
                        {t("common.change")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <ScrollView contentContainerStyle={styles.giftGrid}>
                {gifts.map((gift) => (
                  <GiftPickerCard
                    activeLanguage={activeLanguage}
                    affordable={balance ? gift.price <= balance.spendable_balance : true}
                    gift={gift}
                    key={gift.gift_id}
                    onPress={() => setSelectedGiftId(gift.gift_id)}
                    selected={gift.gift_id === selectedGift.gift_id}
                    theme={theme}
                    translate={t}
                    width={cardWidth}
                  />
                ))}
              </ScrollView>

              <View style={[styles.sendBar, { backgroundColor: theme.card }]}>
                <Pressable
                  disabled={isSending || !balance}
                  onPress={sendSelectedGift}
                  style={isSending || !balance ? styles.disabledButton : undefined}
                >
                  <LinearGradient
                    colors={affordable ? [theme.accent, theme.accentDark] : ["#FFB703", "#FB8500"]}
                    end={{ x: 1, y: 1 }}
                    start={{ x: 0, y: 0 }}
                    style={styles.sendButton}
                  >
                    <SymbolView
                      name={buttonSymbol}
                      size={chatGiftPickerPolicy.sendButtonIconSize}
                      weight="bold"
                      tintColor="#FFFFFF"
                    />
                    <Text numberOfLines={1} style={styles.sendButtonText}>
                      {buttonTitle}
                    </Text>
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          )}
          {animatingGift ? <GiftSendAnimationOverlay gift={animatingGift} /> : null}
        </View>
      </View>
    </Modal>
  );
}

function GiftPickerCard({
  gift,
  selected,
  affordable,
  activeLanguage,
  theme,
  translate,
  width,
  onPress,
}: {
  gift: GiftCatalogItem;
  selected: boolean;
  affordable: boolean;
  activeLanguage: string;
  theme: ReturnType<typeof palette>;
  translate: (key: string, ...args: (string | number)[]) => string;
  width: number;
  onPress: () => void;
}) {
  const [selectionProgress] = useState(() => new Animated.Value(selected ? 1 : 0));
  useEffect(() => {
    Animated.spring(selectionProgress, {
      toValue: selected ? 1 : 0,
      damping: 18,
      stiffness: 180,
      mass: 1,
      useNativeDriver: true,
    }).start();
  }, [selected, selectionProgress]);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ width }}>
      <Animated.View
        style={{
          transform: [
            {
              scale: selectionProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [1, chatGiftPickerPolicy.selectedScale],
              }),
            },
          ],
        }}
      >
        <LinearGradient
          colors={selected ? ["#FFFFFF", "#FFF8DF"] : [theme.card, theme.card]}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={[
            styles.giftCard,
            selected ? styles.selectedGiftCard : { borderColor: `${theme.separator}9E` },
          ]}
        >
          <GiftAssetIcon
            assetKey={giftDisplayAssetKey(gift)}
            fallbackAssetKey={gift.asset_key}
            size={chatGiftPickerPolicy.cardIconSize}
            style={!affordable ? styles.unaffordableGift : undefined}
          />
          <Text
            adjustsFontSizeToFit
            minimumFontScale={chatGiftPickerPolicy.cardNameMinimumScale}
            numberOfLines={1}
            style={[styles.giftName, { color: theme.text }]}
          >
            {localizedGiftCatalogName(gift, activeLanguage, translate)}
          </Text>
          <View style={styles.priceRow}>
            <SymbolView
              name="pawprint.fill"
              size={chatGiftPickerPolicy.priceIconSize}
              tintColor="#F0A020"
            />
            <Text
              style={[styles.priceText, { color: affordable ? theme.secondaryText : theme.danger }]}
            >
              {gift.price}
            </Text>
          </View>
          {selected ? <View pointerEvents="none" style={styles.selectedGiftInnerBorder} /> : null}
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

export function ChatGiftBubble({
  payload,
  isFromMe,
  recipientFallback,
  recipientIdFallback,
  recipientAvatarFallback,
}: {
  payload: GiftMessagePayload;
  isFromMe: boolean;
  recipientFallback?: string | undefined;
  recipientIdFallback?: string | undefined;
  recipientAvatarFallback?: string | undefined;
}) {
  const canActivate = useChatMessageActivationGuard();
  const { t } = useLocalization();
  const theme = palette(useColorScheme());
  const recipientName =
    payload.recipient_name?.trim() || recipientFallback || t("gift.recipientFallback");
  const recipientId = payload.recipient_id?.trim() || recipientIdFallback || "";
  const avatar = payload.recipient_avatar_url?.trim() || recipientAvatarFallback?.trim() || "";
  const recipientAvatar = (
    <View style={styles.giftRecipientAvatarFrame}>
      {recipientId ? (
        <UserAvatarButton
          accessibilityName={recipientName}
          avatarUrl={avatar}
          canActivate={canActivate}
          size={chatGiftBubblePolicy.recipientAvatarSize}
          userId={recipientId}
        />
      ) : (
        <Avatar name={recipientName} size={chatGiftBubblePolicy.recipientAvatarSize} uri={avatar} />
      )}
    </View>
  );
  return (
    <LinearGradient
      colors={isFromMe ? ["#FFF4C9", "#FFE8A3"] : ["#FFFFFF", "#FFF8DF"]}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={[styles.giftBubble, isFromMe ? styles.mineGiftBubble : styles.otherGiftBubble]}
    >
      <View style={styles.giftBubbleTop}>
        <View style={styles.giftBubbleGiftColumn}>
          <GiftAssetIcon
            assetKey={payload.asset_key}
            fallbackAssetKey={payload.asset_key}
            size={chatGiftBubblePolicy.giftIconSize}
          />
          <Text
            adjustsFontSizeToFit
            minimumFontScale={chatGiftBubblePolicy.giftNameMinimumScale}
            numberOfLines={1}
            style={[styles.giftBubbleName, { color: theme.text }]}
          >
            {localizedGiftPayloadName(payload, t)}
          </Text>
        </View>
        <View style={styles.giftBubbleMiddleColumn}>
          <Image
            contentFit="contain"
            source={nativeAssets.giftWhimsicalArrow3x}
            style={styles.giftArrow}
            transition={0}
          />
          <Text numberOfLines={1} style={[styles.giftToText, { color: theme.secondaryText }]}>
            {t("gift.to")}
          </Text>
        </View>
        <View style={styles.giftBubbleRecipientColumn}>
          {recipientAvatar}
          <Text
            adjustsFontSizeToFit
            minimumFontScale={chatGiftBubblePolicy.recipientNameMinimumScale}
            numberOfLines={1}
            style={[styles.giftRecipientName, { color: theme.text }]}
          >
            {recipientName || recipientId}
          </Text>
        </View>
      </View>
      <View style={styles.giftReceiverValue}>
        <Image
          contentFit="contain"
          source={nativeAssets.walletGoldCoinBadge}
          style={styles.giftCoinBadge}
          transition={0}
        />
        <Text numberOfLines={1} style={styles.giftReceiverValueText}>
          {t("gift.receiverValue.goldCoins", payload.gold_coin_amount)}
        </Text>
      </View>
    </LinearGradient>
  );
}

export function GiftAssetIcon({
  assetKey,
  fallbackAssetKey,
  size = 48,
  style,
}: {
  assetKey: string;
  fallbackAssetKey?: string | undefined;
  size?: number | undefined;
  style?: object | undefined;
}) {
  const { config } = useRemoteConfig();
  const { activeLanguage, t } = useLocalization();
  const remoteAsset = useMemo(
    () => trustedChatStickerRemoteAsset(assetKey, config.assetManifest),
    [assetKey, config.assetManifest],
  );
  const [remoteState, setRemoteState] = useState<{ key: string; uri: string } | null>(null);
  const bundledSource = bundledGiftAsset(assetKey) ?? bundledGiftAsset(fallbackAssetKey);
  const colorKey = bundledGiftAsset(assetKey) ? assetKey : (fallbackAssetKey ?? assetKey);
  const pair = giftAssetColors[colorKey] ?? { halo: colors.accent, outline: colors.accent };
  const fixedGift = fixedGiftCatalog.find((gift) => gift.asset_key === colorKey);
  const accessibilityLabel = fixedGift
    ? localizedGiftCatalogName(fixedGift, activeLanguage, t)
    : t("gift.title");

  useEffect(() => {
    let active = true;
    if (!remoteAsset || bundledSource) return;
    void verifiedChatRemoteAssetUri(remoteAsset)
      .then((uri) => {
        if (active) setRemoteState({ key: remoteAsset.key, uri });
      })
      .catch(() => {
        if (active) setRemoteState(null);
      });
    return () => {
      active = false;
    };
  }, [bundledSource, remoteAsset]);

  const artwork =
    bundledSource ??
    (remoteState !== null && remoteState.key === remoteAsset?.key ? remoteState.uri : null);
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      style={[
        styles.giftAssetRoot,
        { width: size, height: size, shadowColor: pair.outline },
        style,
      ]}
    >
      <View
        style={[
          styles.giftHalo,
          {
            width: size * 0.86,
            height: size * 0.86,
            borderRadius: size * 0.43,
            backgroundColor: `${pair.halo}29`,
            transform: [{ translateY: size * 0.08 }],
          },
        ]}
      />
      <View
        style={[
          styles.giftWhiteDisc,
          {
            width: size * 0.72,
            height: size * 0.72,
            borderRadius: size * 0.36,
            shadowRadius: size * 0.08,
            shadowOffset: { width: 0, height: size * 0.04 },
          },
        ]}
      />
      {artwork ? (
        <Image
          contentFit="contain"
          source={artwork}
          style={{ width: size * 1.04, height: size * 1.04 }}
          transition={0}
        />
      ) : (
        <SymbolView name="gift.fill" size={size * 0.62} tintColor={colors.accent} />
      )}
    </View>
  );
}

function GiftSendAnimationOverlay({ gift }: { gift: GiftCatalogItem }) {
  const [iconProgress] = useState(() => new Animated.Value(0));
  const [backdropProgress] = useState(() => new Animated.Value(0));
  const [particleProgress] = useState(() =>
    Array.from({ length: chatGiftAnimationPolicy.particleCount }, () => new Animated.Value(0)),
  );
  const assetKey = gift.asset_key;
  const rotations = giftAnimationRotation(assetKey);
  const symbol = giftParticleSymbol(assetKey);
  useEffect(() => {
    iconProgress.setValue(0);
    backdropProgress.setValue(0);
    for (const progress of particleProgress) progress.setValue(0);
    Animated.parallel([
      Animated.timing(backdropProgress, {
        toValue: 1,
        duration: 160,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(iconProgress, {
        toValue: 1,
        damping: 7,
        stiffness: 150,
        mass: 1,
        useNativeDriver: true,
      }),
      ...particleProgress.map((progress, index) =>
        Animated.timing(progress, {
          toValue: 1,
          duration: chatGiftAnimationPolicy.particleDurationMs,
          delay: index * chatGiftAnimationPolicy.particleDelayStepMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ),
    ]).start();
  }, [backdropProgress, iconProgress, particleProgress]);
  return (
    <View pointerEvents="none" style={styles.giftAnimationOverlay}>
      <Animated.View
        style={[
          styles.giftAnimationBackdrop,
          {
            opacity: backdropProgress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, chatGiftAnimationPolicy.backdropOpacity],
            }),
          },
        ]}
      />
      <View style={styles.giftAnimationCenter}>
        {Array.from({ length: chatGiftAnimationPolicy.particleCount }, (_, index) => {
          const progress = particleProgress[index]!;
          const angle = (index / chatGiftAnimationPolicy.particleCount) * Math.PI * 2;
          const initialX = Math.cos(angle) * chatGiftAnimationPolicy.initialParticleDistance;
          const finalX = Math.cos(angle) * chatGiftAnimationPolicy.finalParticleDistance;
          const initialY = Math.sin(angle) * chatGiftAnimationPolicy.initialParticleDistance;
          const finalY = Math.sin(angle) * chatGiftAnimationPolicy.finalParticleDistance;
          return (
            <Animated.View
              key={index}
              style={[
                styles.giftParticle,
                {
                  opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                  transform: [
                    {
                      translateX: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [initialX, finalX],
                      }),
                    },
                    {
                      translateY: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [initialY, finalY],
                      }),
                    },
                    {
                      scale: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [
                          chatGiftAnimationPolicy.initialParticleScale,
                          chatGiftAnimationPolicy.finalParticleScale,
                        ],
                      }),
                    },
                  ],
                },
              ]}
            >
              <SymbolView
                name={symbol}
                size={
                  index % 2 === 0
                    ? chatGiftAnimationPolicy.evenParticleSize
                    : chatGiftAnimationPolicy.oddParticleSize
                }
                weight="bold"
                tintColor={
                  chatGiftAnimationPolicy.particleColors[
                    index % chatGiftAnimationPolicy.particleColors.length
                  ]!
                }
              />
            </Animated.View>
          );
        })}
        <Animated.View
          style={{
            transform: [
              {
                scale: iconProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [
                    chatGiftAnimationPolicy.initialScale,
                    chatGiftAnimationPolicy.finalScale,
                  ],
                }),
              },
              {
                rotate: iconProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [`${rotations.initial}deg`, `${rotations.final}deg`],
                }),
              },
              {
                translateY: iconProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [
                    0,
                    assetKey === "gift_tree" ? chatGiftAnimationPolicy.treeFinalOffsetY : 0,
                  ],
                }),
              },
            ],
          }}
        >
          <GiftAssetIcon
            assetKey={giftDisplayAssetKey(gift)}
            fallbackAssetKey={gift.asset_key}
            size={chatGiftAnimationPolicy.iconSize}
          />
        </Animated.View>
      </View>
    </View>
  );
}

function bundledGiftAsset(assetKey: string | undefined) {
  switch (assetKey) {
    case "gift_fish":
      return nativeAssets.giftFish;
    case "gift_wand":
      return nativeAssets.giftWand;
    case "gift_yarn":
      return nativeAssets.giftYarn;
    case "gift_can":
      return nativeAssets.giftCan;
    case "gift_tree":
      return nativeAssets.giftTree;
    case "gift_bell":
      return nativeAssets.giftBell;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  systemBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: "hidden" },
  dragIndicator: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    marginTop: 7,
    backgroundColor: "rgba(120,120,128,0.34)",
  },
  fill: { flex: 1 },
  loadingIndicator: { flex: 1 },
  recipientTitle: {
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
  },
  emptyRecipients: { flex: 1, gap: 12, alignItems: "center", justifyContent: "center" },
  emptyRecipientText: { fontSize: 15, fontWeight: "500" },
  recipientList: { gap: 10, padding: 16 },
  recipientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
  },
  recipientName: { flexShrink: 1, fontSize: 16, fontWeight: "600" },
  balanceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  balanceIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEEAFE",
  },
  balanceIcon: { width: 31, height: 31 },
  balanceCopy: { gap: 2 },
  balanceLabel: { fontSize: 12 },
  balanceValue: { fontSize: 22, fontWeight: "700" },
  balanceLoading: { fontSize: 16, fontWeight: "700" },
  balanceBreakdown: { fontSize: 11, fontWeight: "500" },
  refreshButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  recipientSummary: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  toLabel: { fontSize: 13, fontWeight: "500" },
  summaryName: { flexShrink: 1, fontSize: 15, fontWeight: "600" },
  changeText: { fontSize: 13, fontWeight: "600" },
  giftGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 10,
    rowGap: 10,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  giftCard: {
    minHeight: 140,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(240,240,245,0.62)",
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.035,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  selectedGiftCard: {
    borderColor: "#F0A020",
    borderWidth: 1.6,
    shadowColor: "#F0A020",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  selectedGiftInnerBorder: {
    position: "absolute",
    top: 2,
    right: 2,
    bottom: 2,
    left: 2,
    borderRadius: 14,
    borderWidth: 0.8,
    borderColor: "rgba(255,255,255,0.82)",
  },
  unaffordableGift: { opacity: 0.46 },
  giftName: { width: "92%", fontSize: 13, fontWeight: "600", textAlign: "center" },
  priceRow: { flexDirection: "row", gap: 4, alignItems: "center" },
  priceText: { fontSize: 12, fontWeight: "700" },
  sendBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 },
  sendButton: {
    height: 48,
    borderRadius: 24,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  sendButtonText: { flexShrink: 1, color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  disabledButton: { opacity: 0.76 },
  giftBubble: {
    width: 232,
    paddingHorizontal: 8,
    paddingVertical: 9,
    gap: 6,
    borderColor: "rgba(255,213,74,0.70)",
    borderWidth: 1,
    borderRadius: 18,
  },
  mineGiftBubble: { borderBottomRightRadius: 0 },
  otherGiftBubble: { borderBottomLeftRadius: 0 },
  giftBubbleTop: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  giftBubbleGiftColumn: { width: 80, gap: 5, alignItems: "center" },
  giftBubbleName: { width: 80, fontSize: 13, fontWeight: "700", textAlign: "center" },
  giftBubbleMiddleColumn: { gap: 7, alignItems: "center", paddingTop: 20 },
  giftArrow: { width: 44, height: 30 },
  giftToText: { fontSize: 11, fontWeight: "600" },
  giftBubbleRecipientColumn: { width: 74, gap: 6, alignItems: "center", paddingTop: 11 },
  giftRecipientAvatarFrame: {
    width: 54,
    height: 54,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.95)",
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  giftRecipientName: { width: 74, fontSize: 13, fontWeight: "700", textAlign: "center" },
  giftReceiverValue: {
    width: 80,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  giftCoinBadge: { width: 13, height: 13 },
  giftReceiverValueText: { color: "#A76500", fontSize: 11, fontWeight: "600" },
  giftAssetRoot: {
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.18,
    shadowRadius: 3.4,
    shadowOffset: { width: 0, height: 1.7 },
  },
  giftHalo: { position: "absolute" },
  giftWhiteDisc: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.92)",
    shadowColor: "#000000",
    shadowOpacity: 0.045,
  },
  giftAnimationOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  giftAnimationBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#000000",
  },
  giftAnimationCenter: { width: 220, height: 220, alignItems: "center", justifyContent: "center" },
  giftParticle: { position: "absolute" },
});
