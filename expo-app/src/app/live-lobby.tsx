import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { router, Stack, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type ColorSchemeName,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { Avatar } from "@/components/Avatar";
import { SystemSegmentedTabs } from "@/components/SystemSegmentedTabs";
import type { CallType } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useCall } from "@/providers/CallProvider";
import { useLiveCall } from "@/providers/LiveCallProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { usePropInventory } from "@/providers/PropInventoryProvider";
import {
  effectiveLiveCallTypes,
  liveBillingFullRule,
  type LiveBillingPolicy,
  type LiveLobbyAvailability,
  type LiveLobbyGender,
  type LiveLobbyParticipant,
} from "@/services/live/LiveLobbyModels";
import {
  clampedLiveAvatarOffset,
  integralLiveAvatarCropRect,
  liveAvatarCropRect,
  maximumLiveAvatarZoom,
  minimumLiveAvatarScale,
} from "@/services/live/LiveAvatarCrop";
import { type LiveLobbyTab, useLiveLobby } from "@/services/live/useLiveLobby";
import {
  liveExperienceMinutes,
  type LiveExperienceCardKind,
} from "@/services/props/PropInventoryModels";
import { colors } from "@/theme";

type PresentedDialog =
  { type: "start" } | { type: "exit" } | { type: "participant"; participant: LiveLobbyParticipant };

export default function LiveLobbyScreen() {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  return <LiveLobbyAccountScreen key={ownerId || "signed-out"} />;
}

function LiveLobbyAccountScreen() {
  const { user } = useAuth();
  const { session: activeCall } = useCall();
  const scheme = useColorScheme();
  const theme = liveLobbyPalette(scheme);
  const [tab, setTab] = useState<LiveLobbyTab>("recommended");
  const [dialog, setDialog] = useState<PresentedDialog>();
  const [newParticipantId, setNewParticipantId] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const previousCallRef = useRef(activeCall);
  const lobby = useLiveLobby(user?.user_id, tab);
  const refreshLobby = lobby.refresh;
  const isCurrentUserLive = lobby.currentSlot !== null;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshLobby(tab);
    } finally {
      setRefreshing(false);
    }
  }, [refreshLobby, tab]);

  useFocusEffect(
    useCallback(() => {
      void refreshLobby(tab);
      const poll = setInterval(() => void refreshLobby(tab), 10_000);
      return () => clearInterval(poll);
    }, [refreshLobby, tab]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshLobby(tab);
    });
    return () => subscription.remove();
  }, [refreshLobby, tab]);

  useEffect(() => {
    if (!lobby.errorMessage) return;
    const timeout = setTimeout(lobby.clearError, 4_000);
    return () => clearTimeout(timeout);
  }, [lobby.clearError, lobby.errorMessage]);

  useEffect(() => {
    const previous = previousCallRef.current;
    previousCallRef.current = activeCall;
    if (previous?.is_live_pair && !previous.is_outgoing && activeCall?.id !== previous.id) {
      void refreshLobby(tab);
    }
  }, [activeCall, refreshLobby, tab]);

  const participants =
    tab === "chatted"
      ? lobby.participants.filter((participant) => participant.hasChatted)
      : lobby.participants;
  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: "",
          headerBackVisible: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerLeft: () => (
            <Pressable
              accessibilityLabel="返回"
              onPress={() => router.back()}
              style={styles.headerButton}
            >
              <SymbolView name="chevron.left" size={17} weight="semibold" tintColor={colors.text} />
            </Pressable>
          ),
          headerTitle: () => <LiveTabs selected={tab} onSelect={setTab} />,
          headerRight: () =>
            isCurrentUserLive ? (
              <Pressable
                accessibilityLabel="退出直播"
                onPress={() => setDialog({ type: "exit" })}
                style={styles.exitHeader}
              >
                <Text style={styles.exitHeaderText}>退出</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityLabel="挂上直播"
                onPress={() => setDialog({ type: "start" })}
                style={styles.headerButton}
              >
                <SymbolView name="plus" size={18} weight="semibold" tintColor={colors.text} />
              </Pressable>
            ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.accent}
            onRefresh={() => void refresh()}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <PricingBanner policy={lobby.billingPolicy} supportedCallTypes={lobby.supportedCallTypes} />
        {!lobby.hasLoaded ? (
          <SkeletonGrid />
        ) : participants.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <LiveGrid>
            {participants.map((participant) => (
              <ParticipantCard
                key={participant.id}
                isNew={newParticipantId === participant.id}
                participant={participant}
                onPress={() => setDialog({ type: "participant", participant })}
              />
            ))}
          </LiveGrid>
        )}
      </ScrollView>
      {dialog?.type === "start" ? (
        <StartLiveDialog
          fallbackAvatar={user?.avatar_url ?? ""}
          isSubmitting={lobby.isUpdating}
          onDismiss={() => setDialog(undefined)}
          onStart={async (input) => {
            const participant = await lobby.startLive(input);
            if (!participant) return false;
            setTab("recommended");
            setNewParticipantId(participant.id);
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
            setDialog(undefined);
            setTimeout(
              () =>
                setNewParticipantId((current) =>
                  current === participant.id ? undefined : current,
                ),
              1_200,
            );
            return true;
          }}
        />
      ) : null}
      {dialog?.type === "exit" ? (
        <ExitLiveDialog
          isWorking={lobby.isUpdating}
          onDismiss={() => setDialog(undefined)}
          onConfirm={async () => {
            if (!(await lobby.stopLive())) return;
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
              () => undefined,
            );
            setDialog(undefined);
            setNewParticipantId(undefined);
          }}
        />
      ) : null}
      {dialog?.type === "participant" ? (
        <ParticipantDialog
          billingPolicy={lobby.billingPolicy}
          isCurrentUserLive={isCurrentUserLive}
          onDismiss={() => setDialog(undefined)}
          participant={dialog.participant}
          supportedCallTypes={lobby.supportedCallTypes}
        />
      ) : null}
      {lobby.errorMessage ? (
        <Pressable
          accessibilityLiveRegion="assertive"
          onPress={lobby.clearError}
          style={styles.toast}
        >
          <Text style={styles.toastText}>{lobby.errorMessage}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function LiveTabs({
  selected,
  onSelect,
}: {
  selected: LiveLobbyTab;
  onSelect(value: LiveLobbyTab): void;
}) {
  return (
    <SystemSegmentedTabs
      accessibilityIdentifier="live.lobby.tabs"
      fontWeight="medium"
      items={[
        { value: "recommended", title: "推荐" },
        { value: "chatted", title: "聊过" },
      ]}
      onSelectionChange={onSelect}
      selection={selected}
    />
  );
}

function PricingBanner({
  policy,
  supportedCallTypes,
}: {
  policy: LiveBillingPolicy;
  supportedCallTypes: CallType[];
}) {
  const theme = liveLobbyPalette(useColorScheme());
  const title = supportedCallTypes.includes("voice") ? "语音 / 视频统一计费" : "视频连线计费";
  return (
    <View
      accessibilityLabel={`${title}，${liveBillingFullRule(policy)}`}
      style={[styles.pricing, { backgroundColor: theme.card }]}
    >
      <View style={[styles.pricingIcon, { backgroundColor: theme.accentSoft }]}>
        <SymbolView name="pawprint.fill" size={15} weight="semibold" tintColor={theme.accent} />
      </View>
      <View style={styles.pricingCopy}>
        <Text style={[styles.pricingTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.pricingDetail, { color: theme.secondaryText }]}>
          {liveBillingFullRule(policy)}
        </Text>
      </View>
    </View>
  );
}

function LiveGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

function SkeletonGrid() {
  const theme = liveLobbyPalette(useColorScheme());
  const skeleton = { backgroundColor: theme.systemGray5 };
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LiveGrid>
        {Array.from({ length: 4 }, (_, index) => (
          <View key={index} style={[styles.skeletonCard, { backgroundColor: theme.card }]}>
            <View style={[styles.skeletonCover, skeleton]} />
            <View style={styles.skeletonBody}>
              <View style={[styles.skeletonLine, skeleton, { width: 72, height: 10 }]} />
              <View style={[styles.skeletonLine, skeleton, { height: 12 }]} />
              <View style={[styles.skeletonLine, skeleton, { width: 96, height: 12 }]} />
            </View>
            <View style={styles.skeletonFooterRow}>
              <View style={[styles.skeletonFooterItem, skeleton]} />
              <View style={[styles.skeletonFooterItem, skeleton]} />
            </View>
          </View>
        ))}
      </LiveGrid>
    </View>
  );
}

function EmptyState({ tab }: { tab: LiveLobbyTab }) {
  const theme = liveLobbyPalette(useColorScheme());
  return (
    <View style={styles.empty}>
      <SymbolView
        name={tab === "recommended" ? "person.2.slash" : "bubble.left.and.bubble.right"}
        size={34}
        weight="medium"
        tintColor={theme.tertiaryText}
      />
      <Text style={[styles.emptyTitle, { color: theme.text }]}>
        {tab === "recommended" ? "暂时没有在线直播" : "还没有聊过的直播对象"}
      </Text>
      <Text style={[styles.emptyDetail, { color: theme.secondaryText }]}>
        {tab === "recommended" ? "稍后刷新看看，或点击右上角挂上直播" : "成功连线后会出现在这里"}
      </Text>
    </View>
  );
}

function ParticipantCard({
  participant,
  isNew,
  onPress,
}: {
  participant: LiveLobbyParticipant;
  isNew: boolean;
  onPress(): void;
}) {
  const theme = liveLobbyPalette(useColorScheme());
  const { width } = useWindowDimensions();
  const cellWidth = (width - 16 * 2 - 12) / 2;
  const coverHeight = cellWidth * 1.25;
  const paletteColors = placeholderPalette(participant.paletteIndex);
  const gender = genderPresentation(participant.gender);
  const availability = availabilityPresentation(participant.availability);
  const coverFallback = (
    <LinearGradient colors={paletteColors} style={StyleSheet.absoluteFill}>
      <View style={styles.initialWrap}>
        <Text style={styles.initial}>{participant.displayName.slice(0, 1)}</Text>
      </View>
    </LinearGradient>
  );
  return (
    <View
      style={[
        styles.participantCard,
        { width: cellWidth, backgroundColor: theme.card },
        isNew && styles.participantNew,
      ]}
    >
      <Pressable
        accessibilityLabel={`${participant.displayName}，性别${gender.text}，${availability.text}，${participant.roleSetting}`}
        onPress={onPress}
        style={{ height: coverHeight }}
      >
        <View style={StyleSheet.absoluteFill}>
          {participant.avatarUrl ? (
            <AuthenticatedImage
              contentFit="cover"
              fallback={coverFallback}
              transition={0}
              uri={participant.avatarUrl}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            coverFallback
          )}
        </View>
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.78)"]} style={styles.coverShade} />
        <View style={styles.availabilityPill}>
          <View style={[styles.statusDot, { backgroundColor: availability.color }]} />
          <Text style={styles.availabilityText}>{availability.text}</Text>
        </View>
        <View style={styles.livePill}>
          <Text style={styles.liveText}>{participant.isCurrentUser ? "我的直播" : "LIVE"}</Text>
        </View>
        <View style={styles.coverNameRow}>
          <Text numberOfLines={1} style={styles.coverName}>
            {participant.displayName}
          </Text>
          <View style={[styles.genderPill, { backgroundColor: `${gender.color}E0` }]}>
            <Text style={styles.genderText}>
              {gender.symbol} {gender.text}
            </Text>
          </View>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={`${participant.isCurrentUser ? "我所扮演" : "TA 所扮演"}，${participant.roleSetting}`}
        onPress={onPress}
        style={[styles.roleFooter, { backgroundColor: theme.card }]}
      >
        <Text style={[styles.roleLabel, { color: theme.secondaryText }]}>
          {participant.isCurrentUser ? "我所扮演：" : "TA 所扮演："}
        </Text>
        <Text numberOfLines={2} style={[styles.roleText, { color: theme.text }]}>
          {participant.roleSetting || "未填写人物设定"}
        </Text>
      </Pressable>
    </View>
  );
}

function ParticipantDialog({
  participant,
  isCurrentUserLive,
  billingPolicy,
  supportedCallTypes,
  onDismiss,
}: {
  participant: LiveLobbyParticipant;
  isCurrentUserLive: boolean;
  billingPolicy: LiveBillingPolicy;
  supportedCallTypes: CallType[];
  onDismiss(): void;
}) {
  const liveCall = useLiveCall();
  const theme = liveLobbyPalette(useColorScheme());
  const {
    availableLiveExperienceCards,
    load: loadPropInventory,
    quantity: propQuantity,
  } = usePropInventory();
  const [paymentCallType, setPaymentCallType] = useState<CallType>();
  const [isLoadingPaymentOptions, setLoadingPaymentOptions] = useState(true);
  const availability = availabilityPresentation(participant.availability);
  const gender = genderPresentation(participant.gender);
  const types = effectiveLiveCallTypes(supportedCallTypes, participant.allowedCallTypes);
  const blocked =
    participant.isCurrentUser || isCurrentUserLive || participant.availability !== "available";
  const blockedText = participant.isCurrentUser
    ? "这是你的直播，其他用户可以从这里与你连线"
    : isCurrentUserLive
      ? "正在直播，无法与其他主播连线"
      : availability.detail;
  useEffect(() => {
    let active = true;
    void loadPropInventory().finally(() => {
      if (active) setLoadingPaymentOptions(false);
    });
    return () => {
      active = false;
    };
  }, [loadPropInventory]);

  const beginCall = (
    callType: CallType,
    paymentMethod: { type: "spendable_balance" } | { type: "prop_card"; definitionId: string },
  ) => {
    onDismiss();
    void liveCall.requestCall({
      participant,
      callType,
      billingPolicy,
      isCurrentUserLive,
      paymentMethod,
    });
  };
  const choosePayment = (callType: CallType) => {
    if (availableLiveExperienceCards.length === 0)
      beginCall(callType, { type: "spendable_balance" });
    else setPaymentCallType(callType);
  };
  return (
    <Modal animationType="fade" transparent visible onRequestClose={onDismiss}>
      <View style={styles.modalRoot}>
        <Pressable onPress={onDismiss} style={StyleSheet.absoluteFill} />
        <View style={[styles.participantDialog, { backgroundColor: theme.card }]}>
          <View style={styles.identityRow}>
            <View style={styles.dialogAvatarShadow}>
              <View style={[styles.dialogAvatar, { borderColor: theme.card }]}>
                <Avatar
                  cornerRadius={38}
                  name={participant.displayName}
                  size={76}
                  uri={participant.avatarUrl}
                />
              </View>
            </View>
            <View style={styles.identityCopy}>
              <Text numberOfLines={2} style={[styles.dialogName, { color: colors.text }]}>
                {participant.displayName}
              </Text>
              <View style={[styles.dialogGender, { backgroundColor: `${gender.color}1F` }]}>
                <Text style={[styles.dialogGenderText, { color: gender.color }]}>
                  {gender.symbol} {gender.text}
                </Text>
              </View>
              <View style={styles.dialogStatus}>
                <View style={[styles.dialogStatusDot, { backgroundColor: availability.color }]} />
                <Text style={[styles.dialogStatusText, { color: availability.color }]}>
                  {availability.text}
                </Text>
              </View>
            </View>
          </View>
          <View style={[styles.dialogRole, { backgroundColor: theme.background }]}>
            <Text style={[styles.dialogRoleLabel, { color: theme.secondaryText }]}>
              {participant.isCurrentUser ? "我扮演的角色" : "TA 扮演的角色"}
            </Text>
            <Text style={[styles.dialogRoleText, { color: theme.text }]}>
              {participant.roleSetting || "未填写人物设定"}
            </Text>
          </View>
          <View style={[styles.dialogBilling, { backgroundColor: theme.accentSoft }]}>
            <SymbolView name="pawprint.fill" size={12} tintColor={theme.accent} />
            <Text style={[styles.dialogBillingText, { color: theme.secondaryText }]}>
              {liveBillingFullRule(billingPolicy)}
            </Text>
          </View>
          {blocked ? (
            <Text style={[styles.blockedText, { color: theme.secondaryText }]}>{blockedText}</Text>
          ) : null}
          {paymentCallType ? (
            <LiveCallPaymentChoice
              availableCards={availableLiveExperienceCards}
              callType={paymentCallType}
              onBack={() => setPaymentCallType(undefined)}
              onSelect={(paymentMethod) => beginCall(paymentCallType, paymentMethod)}
              policy={billingPolicy}
              quantity={propQuantity}
            />
          ) : types.length === 0 ? (
            <Text style={[styles.blockedText, { color: colors.secondaryText }]}>
              该主播暂未开放连线
            </Text>
          ) : (
            <View style={styles.callButtons}>
              {types.map((type) => {
                const disabled = blocked || liveCall.isWorking || isLoadingPaymentOptions;
                return (
                  <Pressable
                    disabled={disabled}
                    key={type}
                    onPress={() => choosePayment(type)}
                    style={styles.callButton}
                  >
                    <LinearGradient
                      colors={
                        disabled
                          ? [theme.background, theme.background]
                          : [colors.accent, colors.accentDark]
                      }
                      end={{ x: 1, y: 1 }}
                      start={{ x: 0, y: 0 }}
                      style={styles.callButtonFill}
                    >
                      <SymbolView
                        name={type === "voice" ? "phone.fill" : "video.fill"}
                        size={15}
                        tintColor={disabled ? colors.secondaryText : "#FFFFFF"}
                      />
                      <Text
                        style={[
                          styles.callButtonTitle,
                          disabled && { color: colors.secondaryText },
                        ]}
                      >
                        确认{type === "voice" ? "语音" : "视频"}
                      </Text>
                      <Text
                        style={[styles.callButtonRate, disabled && { color: colors.secondaryText }]}
                      >
                        {billingPolicy.unitSeconds === 60
                          ? `${billingPolicy.amountPerUnit} 猫粮/分钟`
                          : `${billingPolicy.amountPerUnit} 猫粮/${billingPolicy.unitSeconds}秒`}
                      </Text>
                    </LinearGradient>
                  </Pressable>
                );
              })}
            </View>
          )}
          <Pressable onPress={onDismiss} style={styles.cancelDialog}>
            <Text style={[styles.cancelDialogText, { color: theme.secondaryText }]}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function LiveCallPaymentChoice({
  callType,
  policy,
  availableCards,
  quantity,
  onSelect,
  onBack,
}: {
  callType: CallType;
  policy: LiveBillingPolicy;
  availableCards: LiveExperienceCardKind[];
  quantity(kind: LiveExperienceCardKind): number;
  onSelect(
    method: { type: "spendable_balance" } | { type: "prop_card"; definitionId: string },
  ): void;
  onBack(): void;
}) {
  const { t } = useLocalization();
  const theme = liveLobbyPalette(useColorScheme());
  return (
    <View style={styles.paymentChoice}>
      <View style={styles.paymentHeader}>
        <Pressable onPress={onBack} style={styles.paymentBack}>
          <SymbolView name="chevron.left" size={11} weight="bold" tintColor={theme.secondaryText} />
          <Text style={[styles.paymentBackText, { color: theme.secondaryText }]}>
            {t("common.back")}
          </Text>
        </Pressable>
        <Text style={[styles.paymentTitle, { color: theme.text }]}>
          {t(
            "live.experience.payment.title",
            t(
              callType === "voice"
                ? "live.experience.callType.voice"
                : "live.experience.callType.video",
            ),
          )}
        </Text>
      </View>
      {availableCards.map((kind) => (
        <PaymentRow
          artwork={
            <Image
              contentFit="contain"
              source={liveExperienceCardAsset(kind)}
              style={styles.paymentCardArtwork}
            />
          }
          isPrimary
          key={kind}
          onPress={() =>
            onSelect({ type: "prop_card", definitionId: `live_experience_card_${kind}` })
          }
          subtitle={t("live.experience.payment.available", quantity(kind))}
          title={t("prop.liveExperienceCard.name", liveExperienceMinutes(kind))}
        />
      ))}
      <PaymentRow
        artwork={
          <Image
            contentFit="contain"
            source={require("../../assets/native-original/Assets.xcassets/activity_cat_food_icon.imageset/activity_cat_food_icon.png")}
            style={styles.paymentBalanceArtwork}
          />
        }
        backgroundColor={theme.background}
        onPress={() => onSelect({ type: "spendable_balance" })}
        subtitle={liveBillingFullRule(policy)}
        textColor={theme.text}
        title={t("live.experience.payment.balance")}
      />
      <View style={styles.paymentRule}>
        <SymbolView name="exclamationmark.circle.fill" size={11} tintColor={theme.secondaryText} />
        <Text style={[styles.paymentRuleText, { color: theme.secondaryText }]}>
          {t("live.experience.payment.rule")}
        </Text>
      </View>
    </View>
  );
}

function PaymentRow({
  artwork,
  title,
  subtitle,
  isPrimary = false,
  backgroundColor,
  textColor = "#1A1A2E",
  onPress,
}: {
  artwork: React.ReactNode;
  title: string;
  subtitle: string;
  isPrimary?: boolean;
  backgroundColor?: string | undefined;
  textColor?: string | undefined;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${title}, ${subtitle}`}
      onPress={onPress}
      style={[
        styles.paymentRow,
        isPrimary ? styles.paymentRowPrimary : styles.paymentRowBalance,
        backgroundColor ? { backgroundColor } : null,
      ]}
    >
      <View style={styles.paymentArtwork}>{artwork}</View>
      <View style={styles.paymentCopy}>
        <Text
          style={[
            styles.paymentRowTitle,
            { color: textColor },
            isPrimary && styles.paymentPrimaryText,
          ]}
        >
          {title}
        </Text>
        <Text
          numberOfLines={2}
          style={[
            styles.paymentRowSubtitle,
            { color: textColor },
            isPrimary && styles.paymentPrimaryText,
          ]}
        >
          {subtitle}
        </Text>
      </View>
      <SymbolView
        name="chevron.right"
        size={11}
        weight="bold"
        tintColor={isPrimary ? "#FFFFFF" : textColor}
      />
    </Pressable>
  );
}

function liveExperienceCardAsset(kind: LiveExperienceCardKind): number {
  switch (kind) {
    case "5m":
      return require("../../assets/native-original/Assets.xcassets/prop_live_experience_card_5m.imageset/prop_live_experience_card_5m_gift_v2.png");
    case "10m":
      return require("../../assets/native-original/Assets.xcassets/prop_live_experience_card_10m.imageset/prop_live_experience_card_10m_gift_v2.png");
    case "15m":
      return require("../../assets/native-original/Assets.xcassets/prop_live_experience_card_15m.imageset/prop_live_experience_card_15m_gift_v2.png");
  }
}

export function StartLiveDialog({
  fallbackAvatar,
  isSubmitting,
  onDismiss,
  onStart,
}: {
  fallbackAvatar: string;
  isSubmitting: boolean;
  onDismiss(): void;
  onStart(input: {
    roleSetting: string;
    avatarUri?: string | undefined;
    allowedCallTypes: CallType[];
    avatarUploadIdempotencyKey: string;
    slotCreationIdempotencyKey: string;
  }): Promise<boolean>;
}) {
  const theme = liveLobbyPalette(useColorScheme());
  const [role, setRole] = useState("");
  const [types, setTypes] = useState<CallType[]>([]);
  const [avatarUri, setAvatarUri] = useState<string>();
  const [cropAsset, setCropAsset] = useState<ImagePicker.ImagePickerAsset>();
  const [isRoleFocused, setRoleFocused] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<string>();
  const uploadKeyRef = useRef(randomKey());
  const creationKeyRef = useRef(randomKey());
  const canSubmit = role.trim().length > 0 && types.length > 0 && !reading && !isSubmitting;

  const invalidateCreation = () => {
    creationKeyRef.current = randomKey();
  };
  const selectAvatar = async () => {
    setReading(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 1,
      });
      const asset = result.assets?.[0];
      if (!asset) return;
      setCropAsset(asset);
    } catch {
      setMessage("无法读取所选图片，请重新选择");
    } finally {
      setReading(false);
    }
  };
  return (
    <>
      <Modal animationType="fade" transparent visible onRequestClose={onDismiss}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="关闭挂播弹窗"
            disabled={isSubmitting}
            onPress={() => {
              if (isRoleFocused) {
                Keyboard.dismiss();
                setRoleFocused(false);
              } else {
                onDismiss();
              }
            }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.narrowDialogContainer}>
            <View
              style={[styles.startDialog, { backgroundColor: theme.card, marginHorizontal: 0 }]}
            >
              <Text style={[styles.startTitle, { color: theme.text }]}>我扮演的</Text>
              <View style={[styles.avatarSection, { backgroundColor: theme.background }]}>
                <View style={styles.startAvatarFrame}>
                  {avatarUri ? (
                    <Image contentFit="cover" source={avatarUri} style={styles.startAvatar} />
                  ) : (
                    <Avatar cornerRadius={14} name="直播头像" size={72} uri={fallbackAvatar} />
                  )}
                </View>
                <View style={styles.avatarActions}>
                  <Text style={[styles.avatarTitle, { color: theme.text }]}>直播头像（可选）</Text>
                  <View style={styles.avatarActionRow}>
                    <Pressable
                      disabled={reading || isSubmitting}
                      onPress={() => void selectAvatar()}
                    >
                      <Text style={styles.chooseAvatar}>{avatarUri ? "重新选择" : "选择图片"}</Text>
                    </Pressable>
                    {avatarUri ? (
                      <Pressable
                        disabled={isSubmitting}
                        onPress={() => {
                          setAvatarUri(undefined);
                          uploadKeyRef.current = randomKey();
                          invalidateCreation();
                        }}
                      >
                        <Text style={styles.removeAvatar}>移除</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
              <View
                style={[
                  styles.roleInputFrame,
                  {
                    backgroundColor: theme.background,
                    borderColor: isRoleFocused ? "rgba(102,126,234,0.72)" : theme.separator,
                    borderWidth: isRoleFocused ? 1.5 : 1,
                  },
                ]}
              >
                <TextInput
                  accessibilityLabel="输入我扮演的人物设定"
                  multiline
                  numberOfLines={6}
                  onBlur={() => setRoleFocused(false)}
                  onChangeText={(value) => {
                    setRole(value);
                    invalidateCreation();
                  }}
                  onFocus={() => setRoleFocused(true)}
                  style={[styles.roleInput, { color: theme.text }]}
                  textAlignVertical="top"
                  value={role}
                />
                {role.length === 0 ? (
                  <Text
                    pointerEvents="none"
                    style={[styles.rolePlaceholder, { color: theme.tertiaryText }]}
                  >
                    输入我扮演的人物设定
                  </Text>
                ) : null}
              </View>
              <View style={styles.typeSection}>
                <Text style={[styles.typeTitle, { color: theme.text }]}>允许的连线方式</Text>
                <View style={styles.typeRow}>
                  {(["voice", "video"] as CallType[]).map((type) => {
                    const selected = types.includes(type);
                    return (
                      <Pressable
                        accessibilityLabel={type === "voice" ? "允许语音连线" : "允许视频连线"}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        disabled={isSubmitting}
                        key={type}
                        onPress={() => {
                          setTypes((current) =>
                            selected
                              ? current.filter((item) => item !== type)
                              : (["voice", "video"] as CallType[]).filter((item) =>
                                  [...current, type].includes(item),
                                ),
                          );
                          invalidateCreation();
                        }}
                        style={[
                          styles.typeOption,
                          {
                            backgroundColor: selected ? theme.accentSoft : theme.background,
                            borderColor: selected ? "rgba(102,126,234,0.42)" : theme.separator,
                          },
                          selected && styles.typeOptionSelected,
                        ]}
                      >
                        <SymbolView
                          name={selected ? "checkmark.square.fill" : "square"}
                          size={19}
                          weight="semibold"
                          tintColor={selected ? theme.accent : theme.tertiaryText}
                        />
                        <SymbolView
                          name={type === "voice" ? "phone.fill" : "video.fill"}
                          size={14}
                          tintColor={theme.text}
                        />
                        <Text style={[styles.typeOptionText, { color: theme.text }]}>
                          {type === "voice" ? "语音" : "视频"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text
                  style={[
                    styles.typeHint,
                    { color: theme.secondaryText },
                    types.length === 0 && styles.typeHintError,
                  ]}
                >
                  {types.length === 0
                    ? "请至少勾选一种连线方式"
                    : "观众只能使用你勾选的方式发起连线"}
                </Text>
              </View>
              {message ? <Text style={styles.validation}>{message}</Text> : null}
              <Pressable
                accessibilityLabel="挂上直播"
                disabled={!canSubmit}
                onPress={() => {
                  setRoleFocused(false);
                  Keyboard.dismiss();
                  void onStart({
                    roleSetting: role.trim(),
                    avatarUri,
                    allowedCallTypes: types,
                    avatarUploadIdempotencyKey: uploadKeyRef.current,
                    slotCreationIdempotencyKey: creationKeyRef.current,
                  });
                }}
                style={[styles.startButton, !canSubmit && styles.startButtonDisabled]}
              >
                <LinearGradient
                  colors={[colors.accent, colors.accentDark]}
                  end={{ x: 1, y: 1 }}
                  start={{ x: 0, y: 0 }}
                  style={styles.startButtonFill}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <SymbolView
                      name="dot.radiowaves.left.and.right"
                      size={14}
                      weight="semibold"
                      tintColor="#FFFFFF"
                    />
                  )}
                  <Text style={styles.startButtonText}>
                    {isSubmitting ? "正在挂上直播…" : "挂上直播"}
                  </Text>
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {cropAsset ? (
        <LiveAvatarCropModal
          asset={cropAsset}
          onCancel={() => setCropAsset(undefined)}
          onConfirm={(uri) => {
            setAvatarUri(uri);
            setCropAsset(undefined);
            uploadKeyRef.current = randomKey();
            creationKeyRef.current = randomKey();
          }}
        />
      ) : null}
    </>
  );
}

function ExitLiveDialog({
  isWorking,
  onConfirm,
  onDismiss,
}: {
  isWorking: boolean;
  onConfirm(): Promise<void>;
  onDismiss(): void;
}) {
  const theme = liveLobbyPalette(useColorScheme());
  return (
    <Modal animationType="fade" transparent visible onRequestClose={onDismiss}>
      <View style={styles.modalRoot}>
        <Pressable disabled={isWorking} onPress={onDismiss} style={StyleSheet.absoluteFill} />
        <View style={styles.narrowDialogContainer}>
          <View style={[styles.exitDialog, { backgroundColor: theme.card, marginHorizontal: 0 }]}>
            <View style={styles.exitIcon}>
              <SymbolView name="video.slash.fill" size={23} weight="semibold" tintColor="#FF3B30" />
            </View>
            <Text style={[styles.exitTitle, { color: theme.text }]}>退出直播？</Text>
            <Text style={[styles.exitDetail, { color: theme.secondaryText }]}>
              退出后，你的头像将从直播列表中移除；如果正在一对一通话，通话也会同时结束。
            </Text>
            <Pressable
              disabled={isWorking}
              onPress={() => void onConfirm()}
              style={styles.exitButton}
            >
              {isWorking ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.exitButtonText}>退出直播</Text>
              )}
            </Pressable>
            <Pressable disabled={isWorking} onPress={onDismiss} style={styles.continueButton}>
              <Text style={[styles.continueText, { color: theme.secondaryText }]}>继续直播</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function LiveAvatarCropModal({
  asset,
  onCancel,
  onConfirm,
}: {
  asset: ImagePicker.ImagePickerAsset;
  onCancel(): void;
  onConfirm(uri: string): void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const cropSide = Math.max(
    1,
    Math.min(width - 32, (height - insets.top - insets.bottom - 44) * 0.58),
  );
  const imageSize = { width: asset.width, height: asset.height };
  const baseScale = minimumLiveAvatarScale(imageSize, cropSide);
  const displayedWidth = imageSize.width * baseScale;
  const displayedHeight = imageSize.height * baseScale;
  const zoom = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const startingZoom = useSharedValue(1);
  const startingX = useSharedValue(0);
  const startingY = useSharedValue(0);
  const [isProcessing, setProcessing] = useState(false);
  const [message, setMessage] = useState<string>();

  const clampX = (value: number, safeZoom: number) => {
    "worklet";
    const maximum = Math.max((displayedWidth * safeZoom - cropSide) / 2, 0);
    return Math.min(Math.max(value, -maximum), maximum);
  };
  const clampY = (value: number, safeZoom: number) => {
    "worklet";
    const maximum = Math.max((displayedHeight * safeZoom - cropSide) / 2, 0);
    return Math.min(Math.max(value, -maximum), maximum);
  };
  const pan = Gesture.Pan()
    .onBegin(() => {
      startingX.value = offsetX.value;
      startingY.value = offsetY.value;
    })
    .onUpdate((event) => {
      offsetX.value = clampX(startingX.value + event.translationX, zoom.value);
      offsetY.value = clampY(startingY.value + event.translationY, zoom.value);
    });
  const pinch = Gesture.Pinch()
    .onBegin(() => {
      startingZoom.value = zoom.value;
    })
    .onUpdate((event) => {
      const nextZoom = Math.min(
        Math.max(startingZoom.value * event.scale, 1),
        maximumLiveAvatarZoom,
      );
      zoom.value = nextZoom;
      offsetX.value = clampX(offsetX.value, nextZoom);
      offsetY.value = clampY(offsetY.value, nextZoom);
    });
  const offsetStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }],
  }));
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }] }));
  const resetGesture = Gesture.Tap()
    .enabled(!isProcessing)
    .onEnd(() => {
      animateLiveAvatarCropReset(zoom, offsetX, offsetY);
    });
  const confirm = async () => {
    if (isProcessing) return;
    setProcessing(true);
    setMessage(undefined);
    try {
      const uri = await prepareLiveAvatar(asset, cropSide, zoom.value, {
        x: offsetX.value,
        y: offsetY.value,
      });
      onConfirm(uri);
    } catch {
      setMessage("图片裁剪失败，请重新选择");
      setProcessing(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onCancel} presentationStyle="fullScreen" visible>
      <View style={styles.cropScreen}>
        <View style={[styles.cropToolbar, { paddingTop: insets.top, height: insets.top + 44 }]}>
          <Pressable disabled={isProcessing} onPress={onCancel} style={styles.cropToolbarButton}>
            <Text style={styles.cropCancel}>取消</Text>
          </Pressable>
          <Text style={styles.cropTitle}>裁剪直播头像</Text>
          <Pressable
            disabled={isProcessing}
            onPress={() => void confirm()}
            style={styles.cropToolbarButton}
          >
            {isProcessing ? (
              <ActivityIndicator color="#667EEA" size="small" />
            ) : (
              <Text style={styles.cropUse}>使用</Text>
            )}
          </Pressable>
        </View>
        <View style={[styles.cropBody, { paddingBottom: insets.bottom }]}>
          <View style={styles.cropSpacer} />
          <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
            <View
              accessibilityHint="拖动图片调整位置，双指缩放"
              style={[styles.cropViewport, { width: cropSide, height: cropSide }]}
            >
              <Animated.View
                style={[{ width: displayedWidth, height: displayedHeight }, offsetStyle]}
              >
                <Animated.Image
                  resizeMode="stretch"
                  source={{ uri: asset.uri }}
                  style={[{ width: displayedWidth, height: displayedHeight }, zoomStyle]}
                />
              </Animated.View>
              <View pointerEvents="none" style={styles.cropBorder} />
              <View
                pointerEvents="none"
                style={[styles.cropGridVertical, { left: cropSide / 3 }]}
              />
              <View
                pointerEvents="none"
                style={[styles.cropGridVertical, { left: (cropSide * 2) / 3 }]}
              />
              <View
                pointerEvents="none"
                style={[styles.cropGridHorizontal, { top: cropSide / 3 }]}
              />
              <View
                pointerEvents="none"
                style={[styles.cropGridHorizontal, { top: (cropSide * 2) / 3 }]}
              />
            </View>
          </GestureDetector>
          <View style={styles.cropHelp}>
            <Text style={styles.cropHelpText}>拖动图片调整位置，双指缩放</Text>
            <GestureDetector gesture={resetGesture}>
              <View style={styles.cropResetButton}>
                <Text style={styles.cropReset}>重置</Text>
              </View>
            </GestureDetector>
            {message ? (
              <Text accessibilityLiveRegion="assertive" style={styles.cropError}>
                {message}
              </Text>
            ) : null}
          </View>
          <View style={styles.cropSpacer} />
        </View>
      </View>
    </Modal>
  );
}

async function prepareLiveAvatar(
  asset: ImagePicker.ImagePickerAsset,
  viewportSide: number,
  zoom: number,
  offset: { x: number; y: number },
): Promise<string> {
  const imageSize = { width: asset.width, height: asset.height };
  const safeOffset = clampedLiveAvatarOffset(offset, imageSize, viewportSide, zoom);
  const crop = integralLiveAvatarCropRect(
    liveAvatarCropRect(imageSize, viewportSide, zoom, safeOffset),
    imageSize,
  );
  if (crop.width <= 0 || crop.height <= 0) throw new Error("Invalid crop");
  const targetSide = Math.min(1024, Math.max(1, crop.width));
  const actions: ImageManipulator.Action[] = [
    { crop },
    { resize: { width: targetSide, height: targetSide } },
  ];
  let smallest = asset.uri;
  for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54]) {
    const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    smallest = result.uri;
    if ((new File(result.uri).size ?? Number.MAX_SAFE_INTEGER) <= 1_000_000) return result.uri;
  }
  return smallest;
}

function animateLiveAvatarCropReset(
  zoom: SharedValue<number>,
  offsetX: SharedValue<number>,
  offsetY: SharedValue<number>,
): void {
  "worklet";
  zoom.value = withTiming(1, { duration: 200 });
  offsetX.value = withTiming(0, { duration: 200 });
  offsetY.value = withTiming(0, { duration: 200 });
}

function randomKey(): string {
  return randomUUID();
}
function liveLobbyPalette(scheme: ColorSchemeName) {
  const isDark = scheme === "dark";
  return {
    ...colors,
    background: isDark ? "#1C1C1E" : "#F2F2F7",
    card: isDark ? "#000000" : "#FFFFFF",
    systemGray5: isDark ? "#2C2C2E" : "#E5E5EA",
    accentSoft: "rgba(102,126,234,0.12)",
  } as const;
}
function placeholderPalette(index: number): [string, string] {
  const values: [string, string][] = [
    ["#FF7A9E", "#FFB36B"],
    ["#7C8CFF", "#A86BF2"],
    ["#35C8C2", "#62A8FF"],
    ["#FF8A65", "#E85D9E"],
    ["#5D8BFF", "#7BD5FF"],
    ["#71C777", "#D1B74A"],
    ["#9B6DFF", "#FF70A6"],
  ];
  return values[Math.abs(index) % values.length]!;
}
function genderPresentation(gender: LiveLobbyGender): {
  text: string;
  symbol: string;
  color: string;
} {
  switch (gender) {
    case "male":
      return { text: "男", symbol: "♂", color: "#4A90E2" };
    case "female":
      return { text: "女", symbol: "♀", color: "#FF5D8F" };
    case "other":
      return { text: "其他", symbol: "•", color: "#667EEA" };
    default:
      return { text: "保密", symbol: "—", color: "#8E8E93" };
  }
}
function availabilityPresentation(value: LiveLobbyAvailability): {
  text: string;
  detail: string;
  color: string;
} {
  switch (value) {
    case "available":
      return { text: "空闲", detail: "当前空闲，可以发起连线", color: "#2DBE70" };
    case "inviting":
      return { text: "邀请中", detail: "主播正在处理邀请", color: "#F4A621" };
    case "busy":
      return { text: "通话中", detail: "主播正在连线中", color: "#FF3B30" };
    case "ended":
      return { text: "已结束", detail: "本次直播已结束", color: "#FF3B30" };
    default:
      return { text: "确认中", detail: "正在确认主播状态", color: "#F4A621" };
  }
}

const styles = StyleSheet.create({
  narrowDialogContainer: { alignSelf: "stretch", marginHorizontal: 6, alignItems: "center" },
  dialogAvatarShadow: {
    width: 76,
    height: 76,
    borderRadius: 38,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32, rowGap: 16 },
  headerButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  exitHeader: { minWidth: 42, minHeight: 34, alignItems: "center", justifyContent: "center" },
  exitHeaderText: { color: "#FF3B30", fontSize: 15, fontWeight: "600" },
  pricing: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
  },
  pricingIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#EEF0FF",
    alignItems: "center",
    justifyContent: "center",
  },
  pricingCopy: { flex: 1, rowGap: 2 },
  pricingTitle: { color: "#1A1A2E", fontSize: 15, fontWeight: "600" },
  pricingDetail: { color: "#9E9EB8", fontSize: 12, lineHeight: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 14 },
  skeletonCard: { width: "48%", overflow: "hidden", borderRadius: 16, backgroundColor: "#FFFFFF" },
  skeletonCover: { aspectRatio: 0.8, backgroundColor: "#E5E5EA" },
  skeletonBody: { padding: 10, rowGap: 6 },
  skeletonLine: { borderRadius: 4, backgroundColor: "#E5E5EA" },
  skeletonFooterRow: { height: 70, padding: 8, flexDirection: "row", columnGap: 8 },
  skeletonFooterItem: { flex: 1, height: 54, borderRadius: 10, backgroundColor: "#E5E5EA" },
  empty: {
    minHeight: 260,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    rowGap: 10,
  },
  emptyTitle: { color: "#1A1A2E", fontSize: 17, fontWeight: "600" },
  emptyDetail: { color: "#9E9EB8", fontSize: 15, textAlign: "center" },
  participantCard: {
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  participantNew: {
    transform: [{ scale: 1.025 }],
    shadowColor: "#667EEA",
    shadowOpacity: 0.3,
    shadowRadius: 14,
  },
  initialWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  initial: { color: "rgba(255,255,255,0.94)", fontSize: 34, fontWeight: "600" },
  coverShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "56%" },
  availabilityPill: {
    position: "absolute",
    top: 9,
    left: 9,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.48)",
    flexDirection: "row",
    alignItems: "center",
    columnGap: 5,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  availabilityText: { color: "#FFFFFF", fontSize: 10, fontWeight: "600" },
  livePill: {
    position: "absolute",
    top: 9,
    right: 9,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 11,
    backgroundColor: "rgba(102,126,234,0.92)",
    justifyContent: "center",
  },
  liveText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  coverNameRow: {
    position: "absolute",
    left: 11,
    right: 11,
    bottom: 11,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
  },
  coverName: { flexShrink: 1, color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
  genderPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10 },
  genderText: { color: "#FFFFFF", fontSize: 11, fontWeight: "600" },
  roleFooter: {
    minHeight: 72,
    paddingHorizontal: 10,
    paddingVertical: 9,
    rowGap: 4,
    backgroundColor: "#FFFFFF",
  },
  roleLabel: { color: "#9E9EB8", fontSize: 11, fontWeight: "600" },
  roleText: { color: "#1A1A2E", fontSize: 12, lineHeight: 16 },
  modalRoot: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.34)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  participantDialog: {
    width: "100%",
    maxWidth: 360,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  identityRow: { flexDirection: "row", columnGap: 14 },
  dialogAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  identityCopy: { flex: 1, alignItems: "flex-start", rowGap: 7 },
  dialogName: { color: "#1A1A2E", fontSize: 20, fontWeight: "600" },
  dialogGender: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  dialogGenderText: { fontSize: 12, fontWeight: "600" },
  dialogStatus: { flexDirection: "row", alignItems: "center", columnGap: 5 },
  dialogStatusDot: { width: 8, height: 8, borderRadius: 4 },
  dialogStatusText: { fontSize: 12, fontWeight: "600" },
  dialogRole: {
    marginTop: 18,
    padding: 14,
    borderRadius: 13,
    rowGap: 7,
    backgroundColor: "#F2F2F7",
  },
  dialogRoleLabel: { color: "#9E9EB8", fontSize: 12, fontWeight: "500" },
  dialogRoleText: { color: "#1A1A2E", fontSize: 15 },
  dialogBilling: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#EEF0FF",
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 9,
  },
  dialogBillingText: { flex: 1, color: "#9E9EB8", fontSize: 12, lineHeight: 16 },
  blockedText: {
    marginTop: 12,
    color: "#9E9EB8",
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
  },
  callButtons: { marginTop: 16, flexDirection: "row", columnGap: 10 },
  callButton: { flex: 1, height: 66, borderRadius: 13, overflow: "hidden" },
  callButtonFill: { flex: 1, alignItems: "center", justifyContent: "center", rowGap: 5 },
  callButtonTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  callButtonRate: { color: "#FFFFFF", fontSize: 11 },
  cancelDialog: { height: 44, alignItems: "center", justifyContent: "center" },
  cancelDialogText: { color: "#9E9EB8", fontSize: 15, fontWeight: "500" },
  paymentChoice: { marginTop: 16, rowGap: 9 },
  paymentHeader: { minHeight: 20, flexDirection: "row", alignItems: "center" },
  paymentBack: { flexDirection: "row", alignItems: "center", columnGap: 3 },
  paymentBackText: { color: "#9E9EB8", fontSize: 12, fontWeight: "600" },
  paymentTitle: { flex: 1, color: "#1A1A2E", fontSize: 15, fontWeight: "600", textAlign: "right" },
  paymentRow: {
    minHeight: 54,
    paddingHorizontal: 11,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 11,
  },
  paymentRowPrimary: { backgroundColor: "#667EEA" },
  paymentRowBalance: { borderWidth: 1, borderColor: "#F0F0F5", backgroundColor: "#F2F2F7" },
  paymentArtwork: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  paymentCardArtwork: { width: 42, height: 42 },
  paymentBalanceArtwork: { width: 36, height: 36 },
  paymentCopy: { flex: 1, rowGap: 2 },
  paymentRowTitle: { color: "#1A1A2E", fontSize: 14, fontWeight: "700" },
  paymentRowSubtitle: { color: "#1A1A2E", fontSize: 10, fontWeight: "500", opacity: 0.78 },
  paymentPrimaryText: { color: "#FFFFFF" },
  paymentRule: { flexDirection: "row", alignItems: "flex-start", columnGap: 5, paddingTop: 2 },
  paymentRuleText: { flex: 1, color: "#9E9EB8", fontSize: 11, fontWeight: "500" },
  startDialog: {
    width: "100%",
    maxWidth: 344,
    marginHorizontal: 6,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    rowGap: 16,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  startTitle: { color: "#1A1A2E", fontSize: 20, fontWeight: "600" },
  avatarSection: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#F2F2F7",
    flexDirection: "row",
    alignItems: "center",
    columnGap: 14,
  },
  startAvatarFrame: {
    width: 72,
    height: 72,
    borderWidth: 1,
    borderColor: "rgba(102,126,234,0.28)",
    borderRadius: 14,
    overflow: "hidden",
  },
  startAvatar: { width: 72, height: 72 },
  avatarActions: { flex: 1, rowGap: 7 },
  avatarTitle: { color: "#1A1A2E", fontSize: 15, fontWeight: "600" },
  avatarActionRow: { flexDirection: "row", columnGap: 12 },
  chooseAvatar: { color: "#667EEA", fontSize: 12, fontWeight: "600" },
  removeAvatar: { color: "#FF3B30", fontSize: 12, fontWeight: "500" },
  roleInputFrame: { height: 184, borderRadius: 12, overflow: "hidden" },
  roleInput: {
    height: 184,
    paddingHorizontal: 13,
    paddingTop: 10,
    paddingBottom: 10,
    color: "#1A1A2E",
    fontSize: 16,
  },
  rolePlaceholder: { position: "absolute", left: 13, top: 14, color: "#C4C4D4", fontSize: 15 },
  typeSection: { rowGap: 10 },
  typeTitle: { color: "#1A1A2E", fontSize: 15, fontWeight: "600" },
  typeRow: { flexDirection: "row", columnGap: 10 },
  typeOption: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#F0F0F5",
    backgroundColor: "#F2F2F7",
    flexDirection: "row",
    alignItems: "center",
    columnGap: 9,
  },
  typeOptionSelected: { borderColor: "rgba(102,126,234,0.42)", backgroundColor: "#EEF0FF" },
  typeOptionText: { color: "#1A1A2E", fontSize: 15, fontWeight: "600" },
  typeHint: { color: "#9E9EB8", fontSize: 12 },
  typeHintError: { color: "#FF3B30" },
  validation: { color: "#FF3B30", fontSize: 12 },
  startButton: { height: 48, borderRadius: 13, overflow: "hidden" },
  startButtonFill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 8,
  },
  startButtonDisabled: { opacity: 0.5 },
  startButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  cropScreen: { flex: 1, backgroundColor: "#000000" },
  cropToolbar: {
    backgroundColor: "#000000",
    flexDirection: "row",
    alignItems: "flex-end",
    paddingBottom: 10,
    paddingHorizontal: 8,
  },
  cropToolbarButton: { width: 68, height: 34, alignItems: "center", justifyContent: "center" },
  cropCancel: { color: "#FFFFFF", fontSize: 16 },
  cropTitle: {
    flex: 1,
    height: 34,
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
    textAlignVertical: "center",
  },
  cropUse: { color: "#667EEA", fontSize: 16, fontWeight: "600" },
  cropBody: { flex: 1, alignItems: "center" },
  cropSpacer: { flex: 1, minHeight: 16 },
  cropViewport: {
    overflow: "hidden",
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  cropBorder: { position: "absolute", inset: 0, borderWidth: 2, borderColor: "#FFFFFF" },
  cropGridVertical: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.38)",
  },
  cropGridHorizontal: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.38)",
  },
  cropHelp: { minHeight: 72, marginTop: 22, alignItems: "center", rowGap: 8 },
  cropHelpText: { color: "rgba(255,255,255,0.86)", fontSize: 15 },
  cropResetButton: { minWidth: 54, minHeight: 28, alignItems: "center", justifyContent: "center" },
  cropReset: { color: "#667EEA", fontSize: 15, fontWeight: "600" },
  cropError: { color: "#FF6961", fontSize: 13 },
  exitDialog: {
    width: "100%",
    maxWidth: 330,
    marginHorizontal: 6,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  exitIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "rgba(255,59,48,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  exitTitle: { marginTop: 14, color: "#1A1A2E", fontSize: 20, fontWeight: "600" },
  exitDetail: { marginTop: 8, color: "#9E9EB8", fontSize: 14, lineHeight: 20, textAlign: "center" },
  exitButton: {
    alignSelf: "stretch",
    height: 46,
    marginTop: 20,
    borderRadius: 12,
    backgroundColor: "#FF3B30",
    alignItems: "center",
    justifyContent: "center",
  },
  exitButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  continueButton: { height: 40, marginTop: 4, alignItems: "center", justifyContent: "center" },
  continueText: { color: "#9E9EB8", fontSize: 15, fontWeight: "500" },
  toast: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 28,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(20,20,24,0.92)",
  },
  toastText: { color: "#FFFFFF", fontSize: 13, textAlign: "center" },
});
