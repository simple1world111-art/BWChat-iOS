/* eslint-disable react-hooks/immutability -- Reanimated shared values are mutable UI-thread animation state. */
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";

import { Avatar } from "@/components/Avatar";
import { SystemSegmentedTabs } from "@/components/SystemSegmentedTabs";
import { nativeAssets } from "../assets/nativeAssets";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  activityDuration,
  activityTask,
  activityWheelLandingProgress,
  activityWheelLandingRotation,
  canClaimActivity,
  displayWheelSegments,
  hasValidWheelProbability,
  orderedActivityMeals,
  type ActivityCenterSnapshot,
  type ActivityCenterTask,
  type ActivityMatchedUser,
  type ActivityMealReward,
  type ActivityWheelSegment,
  type ActivityWheelSpinResult,
} from "@/services/activity/ActivityModels";
import { validActivityInviteToken } from "@/services/activity/ActivityCenterRepository";
import {
  activityCenterPreviewMatchedUsers,
  activityCenterPreviewShareSession,
  activityCenterPreviewSnapshot,
  activityCenterPreviewWheelResult,
} from "@/services/activity/ActivityCenterPreviewSupport";
import { type ActivityCenterState, useActivityCenter } from "@/services/activity/useActivityCenter";
import { colors, palette } from "@/theme";

type ActivityTab = "benefits" | "wheel";
type ActivityPreviewVariant =
  "benefits" | "wheel" | "phone" | "matches" | "redeem" | "wheel-result";

export default function ActivityCenterScreen() {
  const { user } = useAuth();
  const { t } = useLocalization();
  const params = useLocalSearchParams<{
    inviteToken?: string | string[];
    inviteDelivery?: string | string[];
    activityPreview?: string | string[];
  }>();
  const rawPreview = Array.isArray(params.activityPreview)
    ? params.activityPreview[0]
    : params.activityPreview;
  const previewVariant = __DEV__ && isActivityPreviewVariant(rawPreview) ? rawPreview : undefined;
  const scheme = useColorScheme();
  const reduceMotion = useReduceMotionPreference();
  const theme = palette(scheme);
  const { width } = useWindowDimensions();
  const liveState = useActivityCenter(user?.user_id);
  const state = useMemo<ActivityCenterState>(
    () => activityPreviewState(liveState, previewVariant),
    [liveState, previewVariant],
  );
  const loadActivity = state.load;
  const activityError = state.errorMessage;
  const clearActivityError = state.clearError;
  const redeemActivityInvite = state.redeemInvite;
  const [selectedTab, setSelectedTab] = useState<ActivityTab>(() =>
    previewVariant === "wheel" || previewVariant === "wheel-result" ? "wheel" : "benefits",
  );
  const [phoneVisible, setPhoneVisible] = useState(previewVariant === "phone");
  const [matchesVisible, setMatchesVisible] = useState(previewVariant === "matches");
  const [redeemVisible, setRedeemVisible] = useState(previewVariant === "redeem");
  const [wheelResult, setWheelResult] = useState<ActivityWheelSpinResult | undefined>(() =>
    previewVariant === "wheel-result" ? activityCenterPreviewWheelResult : undefined,
  );
  const pagesRef = useRef<ScrollView>(null);
  const redeemedDeliveryRef = useRef<string | undefined>(undefined);
  const presentedOwnerRef = useRef(user?.user_id?.trim() || "anonymous");

  const chooseTab = useCallback(
    (tab: ActivityTab) => {
      setSelectedTab(tab);
      pagesRef.current?.scrollTo({
        x: tab === "benefits" ? 0 : width,
        animated: !reduceMotion,
      });
    },
    [reduceMotion, width],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void loadActivity(true);
    });
    return () => subscription.remove();
  }, [loadActivity]);

  useEffect(() => {
    const nextOwner = user?.user_id?.trim() || "anonymous";
    if (presentedOwnerRef.current === nextOwner) return;
    presentedOwnerRef.current = nextOwner;
    if (previewVariant) return;
    // Owner changes must synchronously hide account-scoped modals before the next account is shown.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhoneVisible(false);
    setMatchesVisible(false);
    setRedeemVisible(false);
    setWheelResult(undefined);
  }, [previewVariant, user?.user_id]);

  useEffect(() => {
    if (!activityError) return;
    const message =
      activityError.startsWith("activityCenter.") || activityError.startsWith("api.")
        ? t(activityError)
        : activityError;
    clearActivityError();
    Alert.alert(t("common.operationFailed"), message, [{ text: t("common.ok"), style: "cancel" }]);
  }, [activityError, clearActivityError, t]);

  useEffect(() => {
    const raw = Array.isArray(params.inviteToken) ? params.inviteToken[0] : params.inviteToken;
    const rawDelivery = Array.isArray(params.inviteDelivery)
      ? params.inviteDelivery[0]
      : params.inviteDelivery;
    const token = validActivityInviteToken(raw);
    const delivery = rawDelivery?.trim();
    const deliveryKey = delivery ? `${delivery}:${token ?? ""}` : token;
    if (!token || !deliveryKey || redeemedDeliveryRef.current === deliveryKey || !user?.user_id)
      return;
    redeemedDeliveryRef.current = deliveryKey;
    void redeemActivityInvite(token);
  }, [params.inviteDelivery, params.inviteToken, redeemActivityInvite, user?.user_id]);

  const initialLoading = state.isLoading && !state.snapshot;
  return (
    <View style={[styles.screen, { backgroundColor: scheme === "dark" ? "#1C1C1E" : "#F2F2F7" }]}>
      <Stack.Screen
        options={{
          title: "",
          headerBackTitle: t("common.back"),
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: scheme === "dark" ? "#1C1C1E" : "#F2F2F7" },
          headerTitle: () => <ActivityTabs selection={selectedTab} onChange={chooseTab} />,
        }}
      />
      {initialLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[styles.loadingText, { color: theme.secondaryText }]}>
            {t("common.loading")}
          </Text>
        </View>
      ) : state.snapshot ? (
        <View style={styles.pageArea}>
          {state.isShowingCachedData ? (
            <View style={styles.cachedBanner} accessibilityRole="text">
              <SymbolView name="wifi.slash" size={13} tintColor={theme.secondaryText} />
              <Text style={[styles.cachedText, { color: theme.secondaryText }]}>
                {t("activityCenter.cached")}
              </Text>
            </View>
          ) : null}
          <ScrollView
            ref={pagesRef}
            horizontal
            pagingEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onMomentumScrollEnd={(event) =>
              setSelectedTab(event.nativeEvent.contentOffset.x >= width / 2 ? "wheel" : "benefits")
            }
          >
            <View style={{ width }}>
              <BenefitsPane
                state={state}
                snapshot={state.snapshot}
                onPhone={() => setPhoneVisible(true)}
                onMatches={() => setMatchesVisible(true)}
                onRedeem={() => setRedeemVisible(true)}
              />
            </View>
            <View style={{ width }}>
              <WheelPane
                key={`activity-wheel-${user?.user_id?.trim() || "anonymous"}`}
                state={state}
                snapshot={state.snapshot}
                onResult={setWheelResult}
              />
            </View>
          </ScrollView>
        </View>
      ) : (
        <UnavailableState
          icon="giftcard"
          title={t("activityCenter.loadFailed")}
          message={t("api.networkUnavailable")}
          actionTitle={t("common.retry")}
          onAction={() => void state.load(true)}
        />
      )}

      {phoneVisible ? (
        <PhoneBindingModal visible state={state} onClose={() => setPhoneVisible(false)} />
      ) : null}
      {matchesVisible ? (
        <MatchesModal visible state={state} onClose={() => setMatchesVisible(false)} />
      ) : null}
      {redeemVisible ? (
        <RedeemModal visible state={state} onClose={() => setRedeemVisible(false)} />
      ) : null}
      {wheelResult ? (
        <WheelResultModal result={wheelResult} onClose={() => setWheelResult(undefined)} />
      ) : null}
      {state.rewardCelebration ? (
        <RewardCelebration
          celebration={state.rewardCelebration}
          onFinished={() => state.dismissRewardCelebration(state.rewardCelebration?.id ?? "")}
        />
      ) : null}
    </View>
  );
}

function isActivityPreviewVariant(value: string | undefined): value is ActivityPreviewVariant {
  return (
    value === "benefits" ||
    value === "wheel" ||
    value === "phone" ||
    value === "matches" ||
    value === "redeem" ||
    value === "wheel-result"
  );
}

function activityPreviewState(
  liveState: ActivityCenterState,
  variant: ActivityPreviewVariant | undefined,
): ActivityCenterState {
  if (!variant) return liveState;
  return {
    snapshot: activityCenterPreviewSnapshot,
    isLoading: false,
    isShowingCachedData: false,
    matchedUsers: activityCenterPreviewMatchedUsers,
    phoneVerificationSession: undefined,
    rewardCelebration: undefined,
    errorMessage: undefined,
    isRunning: () => false,
    serverNow: () => new Date(),
    load: async () => undefined,
    claimCheckIn: async () => undefined,
    claimMeal: async () => undefined,
    spinWheel: async () => ({
      result: activityCenterPreviewWheelResult,
      snapshot: activityCenterPreviewSnapshot,
    }),
    finishSpinAnimation: () => undefined,
    discoverContacts: async () => true,
    createShareSession: async () => activityCenterPreviewShareSession,
    completeShare: async () => undefined,
    redeemInvite: async () => true,
    requestPhoneCode: async () => false,
    verifyPhone: async () => false,
    sendFriendRequest: async () => true,
    dismissRewardCelebration: () => undefined,
    clearError: () => undefined,
  };
}

function ActivityTabs({
  selection,
  onChange,
}: {
  selection: ActivityTab;
  onChange(tab: ActivityTab): void;
}) {
  const { t } = useLocalization();
  return (
    <SystemSegmentedTabs
      accessibilityIdentifier="activityCenter.top.tabs"
      fontWeight="semibold"
      items={[
        { value: "benefits", title: t("activityCenter.tab.benefits") },
        { value: "wheel", title: t("activityCenter.tab.wheel") },
      ]}
      onSelectionChange={onChange}
      selection={selection}
      width={228}
    />
  );
}

function BenefitsPane({
  state,
  snapshot,
  onPhone,
  onMatches,
  onRedeem,
}: {
  state: ActivityCenterState;
  snapshot: ActivityCenterSnapshot;
  onPhone(): void;
  onMatches(): void;
  onRedeem(): void;
}) {
  const { t } = useLocalization();
  const [, setNowRevision] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNowRevision((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);
  const contactTask = activityTask(snapshot, "contact_sync");
  const shareTask = activityTask(snapshot, "invite_share");
  const validInviteTask = activityTask(snapshot, "valid_invite");
  const serverNow = state.serverNow();
  const meals = useMemo(
    () => orderedActivityMeals(snapshot.mealRewards, serverNow, snapshot.businessTimezone),
    [serverNow, snapshot.businessTimezone, snapshot.mealRewards],
  );

  const shareInvite = useCallback(async () => {
    const session = await state.createShareSession();
    if (!session) return;
    try {
      const result = await Share.share({
        message: `${session.message}\n${session.shareURL}\n${session.inviteCode}`,
      });
      if (result.action === Share.sharedAction) await state.completeShare(session.id);
    } catch {
      // The native share controller treats dismissal as an incomplete session.
    }
  }, [state]);

  return (
    <ScrollView
      contentContainerStyle={styles.benefitsContent}
      refreshControl={
        <RefreshControl
          refreshing={state.isLoading}
          tintColor={colors.accent}
          onRefresh={() => void state.load(true)}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {!snapshot.configVersion ? (
        <ActivityCard>
          <UnavailableState
            embedded
            icon="calendar.badge.exclamationmark"
            title={t("activityCenter.tab.benefits")}
            message={t("activityCenter.error.inactiveConfig")}
          />
        </ActivityCard>
      ) : (
        <>
          {snapshot.checkIn.days.length > 0 ? (
            <CheckInCard state={state} snapshot={snapshot} />
          ) : null}
          {meals.length > 0 ? (
            <MealsCard state={state} meals={meals} serverNow={serverNow} />
          ) : null}
          {contactTask || shareTask ? (
            <TasksCard
              state={state}
              snapshot={snapshot}
              contactTask={contactTask}
              shareTask={shareTask}
              onContact={() => {
                if (!snapshot.phoneBinding.isVerified) {
                  onPhone();
                  return;
                }
                void state.discoverContacts().then((matched) => {
                  if (matched) onMatches();
                });
              }}
              onShare={() => void shareInvite()}
            />
          ) : null}
          {snapshot.invitation.inviteCode || validInviteTask ? (
            <InviteCard snapshot={snapshot} task={validInviteTask} onRedeem={onRedeem} />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function CheckInCard({
  state,
  snapshot,
}: {
  state: ActivityCenterState;
  snapshot: ActivityCenterSnapshot;
}) {
  const { t } = useLocalization();
  const { fontScale } = useWindowDimensions();
  const days = useMemo(
    () => [...snapshot.checkIn.days].sort((left, right) => left.day - right.day),
    [snapshot.checkIn.days],
  );
  return (
    <ActivityCard>
      <View style={styles.checkInHeader}>
        <View style={styles.sectionCopy}>
          <Text style={styles.checkInTitle}>{t("activityCenter.checkIn.title")}</Text>
          <Text style={styles.checkInSubtitle}>{t("activityCenter.checkIn.subtitle")}</Text>
        </View>
        <View
          style={styles.progressBadge}
          accessibilityLabel={`${snapshot.checkIn.claimedDays}/${Math.max(days.length, 7)}`}
        >
          <SymbolView
            name="calendar.badge.checkmark"
            size={13}
            weight="bold"
            tintColor={colors.accent}
          />
          <Text style={styles.progressText}>
            {snapshot.checkIn.claimedDays}/{Math.max(days.length, 7)}
          </Text>
        </View>
      </View>
      <View style={fontScale >= 1.35 ? styles.accessibilityDayGrid : styles.dayGrid}>
        {days.map((day, index) => (
          <CheckInDayCell
            key={day.day}
            day={day}
            isFinal={index === 6}
            accessibilityLayout={fontScale >= 1.35}
          />
        ))}
      </View>
      <PrimaryButton
        title={
          snapshot.checkIn.completed
            ? t("activityCenter.completed")
            : t("activityCenter.checkIn.claim")
        }
        loading={state.isRunning("check-in")}
        disabled={!snapshot.checkIn.canClaim || snapshot.checkIn.completed}
        onPress={() => void state.claimCheckIn()}
      />
    </ActivityCard>
  );
}

function CheckInDayCell({
  day,
  isFinal,
  accessibilityLayout,
}: {
  day: ActivityCenterSnapshot["checkIn"]["days"][number];
  isFinal: boolean;
  accessibilityLayout: boolean;
}) {
  const { t } = useLocalization();
  const claimed = day.status === "claimed" || day.status === "completed";
  const claimable = canClaimActivity(day.status);
  return (
    <View
      accessible
      accessibilityLabel={t("activityCenter.day.reward", day.day, day.rewardActivityCatFood)}
      style={[
        styles.dayCell,
        isFinal && !accessibilityLayout ? styles.finalDayCell : undefined,
        accessibilityLayout ? styles.accessibilityDayCell : undefined,
        claimable ? styles.claimableDay : claimed ? styles.claimedDay : styles.lockedDay,
        isFinal && !claimable ? styles.finalDayBackground : undefined,
      ]}
    >
      {isFinal ? (
        <View style={styles.finalDayContent}>
          <Image
            source={nativeAssets.activityRewardPaw}
            contentFit="contain"
            style={[styles.finalPaw, day.status === "locked" && styles.lockedPaw]}
          />
          <View style={styles.finalDayCopy}>
            <Text style={[styles.dayLabel, claimable && styles.whiteText]}>
              {t("activityCenter.day", day.day)}
            </Text>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              style={[styles.finalReward, claimable && styles.whiteText]}
            >
              +{day.rewardActivityCatFood}
            </Text>
          </View>
          <SymbolView
            name={claimed ? "checkmark.circle.fill" : "sparkles"}
            size={15}
            weight="bold"
            tintColor={claimable ? "rgba(255,255,255,0.9)" : "#F4B400"}
          />
        </View>
      ) : (
        <>
          <Text style={[styles.dayLabel, claimable && styles.whiteText]}>
            {t("activityCenter.day", day.day)}
          </Text>
          <Image
            source={nativeAssets.activityRewardPaw}
            contentFit="contain"
            style={[styles.dayPaw, day.status === "locked" && styles.lockedPaw]}
          />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            style={[styles.dayReward, claimable && styles.whiteText]}
          >
            +{day.rewardActivityCatFood}
          </Text>
          {claimed ? (
            <View style={styles.dayCheck}>
              <SymbolView
                name="checkmark.circle.fill"
                size={13}
                weight="bold"
                tintColor={colors.accent}
              />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function MealsCard({
  state,
  meals,
  serverNow,
}: {
  state: ActivityCenterState;
  meals: ActivityMealReward[];
  serverNow: Date;
}) {
  const { t } = useLocalization();
  return (
    <ActivityCard>
      <SectionTitle
        title={t("activityCenter.meals.title")}
        subtitle={t("activityCenter.meals.subtitle")}
      />
      <View style={styles.mealList}>
        {meals.map((meal, index) => (
          <View key={meal.id}>
            <MealRow state={state} meal={meal} serverNow={serverNow} />
            {index < meals.length - 1 ? <View style={styles.divider} /> : null}
          </View>
        ))}
      </View>
    </ActivityCard>
  );
}

function MealRow({
  state,
  meal,
  serverNow,
}: {
  state: ActivityCenterState;
  meal: ActivityMealReward;
  serverNow: Date;
}) {
  const { t } = useLocalization();
  const completed = meal.status === "claimed" || meal.status === "completed";
  const transition = meal.nextTransitionAt ? new Date(meal.nextTransitionAt) : undefined;
  const seconds =
    transition && !Number.isNaN(transition.getTime())
      ? Math.max(0, Math.trunc((transition.getTime() - serverNow.getTime()) / 1_000))
      : 0;
  const title = meal.titleKey ? t(meal.titleKey) : meal.id;
  return (
    <View style={styles.mealRow}>
      <IconTile name="clock.fill" />
      <View style={styles.mealCopy}>
        <Text style={styles.rowTitle}>{title === meal.titleKey ? meal.id : title}</Text>
        <Text style={styles.rowSubtitle}>
          {meal.startLocal}–{meal.endLocal}
        </Text>
        {seconds > 0 ? <Text style={styles.countdown}>{activityDuration(seconds)}</Text> : null}
      </View>
      <View style={styles.mealAction}>
        <RewardBadge amount={meal.rewardActivityCatFood} />
        <Pressable
          accessibilityRole="button"
          disabled={!canClaimActivity(meal.status) || state.isRunning(`meal:${meal.id}`)}
          onPress={() => {
            void Haptics.selectionAsync();
            void state.claimMeal(meal);
          }}
          style={({ pressed }) => [
            styles.claimButton,
            canClaimActivity(meal.status) ? styles.claimButtonActive : styles.claimButtonDisabled,
            pressed && styles.pressedSmall,
          ]}
        >
          <Text
            style={[
              styles.claimButtonText,
              canClaimActivity(meal.status) ? styles.whiteText : styles.secondaryText,
            ]}
          >
            {completed ? t("activityCenter.claimed") : t("activityCenter.claim")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function TasksCard({
  state,
  snapshot,
  contactTask,
  shareTask,
  onContact,
  onShare,
}: {
  state: ActivityCenterState;
  snapshot: ActivityCenterSnapshot;
  contactTask: ActivityCenterTask | undefined;
  shareTask: ActivityCenterTask | undefined;
  onContact(): void;
  onShare(): void;
}) {
  const { t } = useLocalization();
  return (
    <ActivityCard>
      <SectionTitle title={t("activityCenter.tasks.title")} />
      {contactTask ? (
        <TaskRow
          icon="person.crop.circle.badge.checkmark"
          title={t("activityCenter.contacts.title")}
          subtitle={
            snapshot.phoneBinding.isVerified
              ? t("activityCenter.contacts.subtitle")
              : t("activityCenter.phone.required")
          }
          task={contactTask}
          running={state.isRunning("contacts")}
          onPress={onContact}
        />
      ) : null}
      {contactTask && shareTask ? <View style={[styles.divider, styles.indentedDivider]} /> : null}
      {shareTask ? (
        <TaskRow
          icon="square.and.arrow.up.fill"
          title={t("activityCenter.share.title")}
          subtitle={
            shareTask.dailyLimit !== undefined
              ? t("activityCenter.share.progress", shareTask.creditedCount, shareTask.dailyLimit)
              : t("activityCenter.share.subtitle")
          }
          task={shareTask}
          running={state.isRunning("share")}
          onPress={onShare}
        />
      ) : null}
    </ActivityCard>
  );
}

function TaskRow({
  icon,
  title,
  subtitle,
  task,
  running,
  onPress,
}: {
  icon: SFSymbol;
  title: string;
  subtitle: string;
  task: ActivityCenterTask;
  running: boolean;
  onPress(): void;
}) {
  const { t } = useLocalization();
  const completed = task.status === "completed" || task.status === "claimed";
  return (
    <Pressable
      accessibilityLabel={t("activityCenter.task.claim", title, task.rewardActivityCatFood)}
      accessibilityRole="button"
      disabled={running || completed}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.taskRow, pressed && styles.pressed]}
    >
      <IconTile name={icon} />
      <View style={styles.taskCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text numberOfLines={2} style={styles.rowSubtitle}>
          {subtitle}
        </Text>
      </View>
      {completed ? (
        <View style={styles.completedCircle}>
          <SymbolView name="checkmark" size={12} weight="bold" tintColor={colors.accent} />
        </View>
      ) : (
        <>
          <RewardBadge amount={task.rewardActivityCatFood} />
          <SymbolView
            name="chevron.right"
            size={11}
            weight="bold"
            tintColor={colors.tertiaryText}
          />
        </>
      )}
    </Pressable>
  );
}

function InviteCard({
  snapshot,
  task,
  onRedeem,
}: {
  snapshot: ActivityCenterSnapshot;
  task: ActivityCenterTask | undefined;
  onRedeem(): void;
}) {
  const { t } = useLocalization();
  return (
    <ActivityCard>
      <SectionTitle
        title={t("activityCenter.invite.title")}
        subtitle={t("activityCenter.invite.subtitle")}
      />
      <View style={styles.inviteCodeBox}>
        <View style={styles.inviteCodeCopy}>
          <Text style={styles.inviteLabel}>{t("activityCenter.invite.code")}</Text>
          <Text selectable style={styles.inviteCode}>
            {snapshot.invitation.inviteCode}
          </Text>
        </View>
        {task ? <RewardBadge amount={task.rewardActivityCatFood} /> : null}
      </View>
      <View style={styles.inviteFooter}>
        <Pressable
          accessibilityRole="button"
          disabled={!snapshot.invitation.canRedeem}
          onPress={() => {
            void Haptics.selectionAsync();
            onRedeem();
          }}
          style={({ pressed }) => [
            styles.outlineButton,
            !snapshot.invitation.canRedeem && styles.disabledOpacity,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.outlineButtonText}>{t("activityCenter.invite.redeem")}</Text>
        </Pressable>
        <Text style={styles.inviteStats}>
          {t(
            "activityCenter.invite.stats",
            snapshot.invitation.pendingInvites,
            snapshot.invitation.creditedInvites,
          )}
        </Text>
      </View>
    </ActivityCard>
  );
}

function WheelPane({
  state,
  snapshot,
  onResult,
}: {
  state: ActivityCenterState;
  snapshot: ActivityCenterSnapshot;
  onResult(result: ActivityWheelSpinResult): void;
}) {
  const { t } = useLocalization();
  const rotation = useSharedValue(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const mountedRef = useRef(true);
  const spinSequenceRef = useRef(0);
  const tier = snapshot.wheel.currentTier;
  const segments = displayWheelSegments(tier);
  const discStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  useEffect(() => {
    mountedRef.current = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mountedRef.current = false;
      spinSequenceRef.current += 1;
      cancelAnimation(rotation);
      subscription.remove();
    };
  }, [rotation]);

  const spin = useCallback(async () => {
    if (state.isRunning("wheel")) return;
    const sequence = ++spinSequenceRef.current;
    if (!reduceMotion) {
      rotation.value = withRepeat(
        withTiming(rotation.value + 360, {
          duration: Math.round((360 / 420) * 1_000),
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    }
    const envelope = await state.spinWheel();
    if (!mountedRef.current || spinSequenceRef.current !== sequence) return;
    if (!envelope) {
      cancelAnimation(rotation);
      rotation.value = ((rotation.value % 360) + 360) % 360;
      return;
    }
    cancelAnimation(rotation);
    const exactIndex = segments.findIndex((segment) => segment.id === envelope.result.prizeID);
    const payoutIndex = segments.findIndex(
      (segment) => segment.payoutGoldCoins === envelope.result.payoutGoldCoins,
    );
    const index = exactIndex >= 0 ? exactIndex : payoutIndex >= 0 ? payoutIndex : 0;
    const target = activityWheelLandingRotation(rotation.value, index, 6);
    if (reduceMotion) {
      rotation.value = target;
      await delay(30);
    } else {
      rotation.value = withTiming(target, {
        duration: 4_000,
        easing: (progress) => activityWheelLandingProgress(progress),
      });
      await delay(4_000);
    }
    if (!mountedRef.current || spinSequenceRef.current !== sequence) return;
    rotation.value = ((target % 360) + 360) % 360;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onResult(envelope.result);
    await delay(260);
    if (!mountedRef.current || spinSequenceRef.current !== sequence) return;
    state.finishSpinAnimation();
  }, [onResult, reduceMotion, rotation, segments, state]);

  if (!snapshot.configVersion || !tier.id || !hasValidWheelProbability(tier)) {
    return (
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={state.isLoading}
            tintColor={colors.accent}
            onRefresh={() => void state.load(true)}
          />
        }
      >
        <UnavailableState
          icon="giftcard"
          title={t("activityCenter.tab.wheel")}
          message={t("activityCenter.error.wheelConfig")}
        />
      </ScrollView>
    );
  }
  return (
    <ScrollView
      contentContainerStyle={styles.wheelContent}
      refreshControl={
        <RefreshControl
          refreshing={state.isLoading}
          tintColor={colors.accent}
          onRefresh={() => void state.load(true)}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.balanceCard} accessible>
        <Image
          source={nativeAssets.walletGoldCoinBadge}
          contentFit="contain"
          style={styles.balanceCoin}
        />
        <View style={styles.balanceCopy}>
          <Text style={styles.balanceLabel}>{t("activityCenter.wheel.balance")}</Text>
          <Text style={styles.balanceValue}>{snapshot.goldCoinBalance.toLocaleString()}</Text>
        </View>
        <View style={styles.tierBadge}>
          <Text style={styles.tierText}>{t("activityCenter.wheel.tier", tier.sequence)}</Text>
        </View>
      </View>
      {snapshot.wheel.recentWinners[0] ? (
        <View style={styles.winnerBadge} accessible>
          <SymbolView name="megaphone.fill" size={12} tintColor={colors.accent} />
          <Text style={styles.winnerText}>
            {t(
              "activityCenter.wheel.winner",
              snapshot.wheel.recentWinners[0].displayName,
              snapshot.wheel.recentWinners[0].payoutGoldCoins,
            )}
          </Text>
        </View>
      ) : null}
      <View style={styles.wheelStage}>
        <Animated.View style={[styles.wheelDiscWrap, discStyle]}>
          <WheelDisc
            segments={segments}
            accessibilityLabel={t(
              "activityCenter.wheel.accessibility",
              segments.map((segment) => segment.payoutGoldCoins.toLocaleString()).join(", "),
            )}
            spinLabel={t("activityCenter.wheel.spinShort")}
          />
        </Animated.View>
        <View style={styles.pointer} />
      </View>
      <PrimaryButton
        title={t("activityCenter.wheel.spin", tier.costGoldCoins)}
        loading={state.isRunning("wheel")}
        disabled={!snapshot.wheel.enabled || snapshot.goldCoinBalance < tier.costGoldCoins}
        runningColors={["#FF9500", "#764BA2"]}
        onPress={() => void spin()}
      />
    </ScrollView>
  );
}

function WheelDisc({
  segments,
  accessibilityLabel,
  spinLabel,
}: {
  segments: ActivityWheelSegment[];
  accessibilityLabel: string;
  spinLabel: string;
}) {
  const scheme = useColorScheme();
  const wedgeColors = [
    "rgba(102,126,234,0.16)",
    scheme === "dark" ? "#000000" : "#FFFFFF",
    "rgba(118,75,162,0.18)",
    "rgba(102,126,234,0.08)",
  ];
  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={styles.wheelDisc}>
      <Svg width={320} height={320} viewBox="0 0 320 320">
        {segments.slice(0, 4).map((segment, index) => (
          <Path key={segment.id} d={wheelWedgePath(index)} fill={wedgeColors[index] ?? "#FFFFFF"} />
        ))}
        <Circle cx={160} cy={160} r={155} fill="none" stroke={colors.accent} strokeWidth={10} />
        <Circle
          cx={160}
          cy={160}
          r={146}
          fill="none"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth={2}
          strokeDasharray="3 12"
        />
        {segments.slice(0, 4).map((segment, index) => {
          const point = wheelLabelPoint(index, 94);
          return (
            <SvgText
              key={`label-${segment.id}`}
              x={point.x}
              y={point.y - 11}
              fill={scheme === "dark" ? "#FFFFFF" : "#1A1A2E"}
              fontSize={22}
              fontWeight="700"
              textAnchor="middle"
              alignmentBaseline="middle"
            >
              {segment.payoutGoldCoins.toLocaleString()}
            </SvgText>
          );
        })}
      </Svg>
      {segments.slice(0, 4).map((segment, index) => {
        const point = wheelLabelPoint(index, 94);
        return (
          <Image
            key={`coin-${segment.id}`}
            source={nativeAssets.walletGoldCoinBadge}
            contentFit="contain"
            style={[styles.wheelPrizeCoin, { left: point.x - 12, top: point.y + 3 }]}
          />
        );
      })}
      <LinearGradient colors={["#667EEA", "#764BA2"]} style={styles.wheelCenter}>
        <Text numberOfLines={1} adjustsFontSizeToFit style={styles.wheelCenterText}>
          {spinLabel}
        </Text>
      </LinearGradient>
    </View>
  );
}

function ActivityCard({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  return (
    <View style={[styles.card, { backgroundColor: scheme === "dark" ? "#000000" : "#FFFFFF" }]}>
      {children}
    </View>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionTitleText}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function IconTile({ name }: { name: SFSymbol }) {
  return (
    <View style={styles.iconTile}>
      <SymbolView name={name} size={17} weight="semibold" tintColor={colors.accent} />
    </View>
  );
}

function RewardBadge({ amount }: { amount: number }) {
  const { t } = useLocalization();
  return (
    <View
      style={styles.rewardBadge}
      accessible
      accessibilityLabel={t("activityCenter.reward.catFood", amount)}
    >
      <Image
        source={nativeAssets.activityRewardPaw}
        contentFit="contain"
        style={styles.rewardBadgePaw}
      />
      <Text style={styles.rewardBadgeText}>+{amount}</Text>
    </View>
  );
}

function PrimaryButton({
  title,
  loading,
  disabled,
  runningColors,
  onPress,
}: {
  title: string;
  loading: boolean;
  disabled: boolean;
  runningColors?: readonly [string, string];
  onPress(): void;
}) {
  const unavailable = loading || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: unavailable }}
      disabled={unavailable}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.primaryButtonWrap, pressed && styles.pressed]}
    >
      {disabled && !loading ? (
        <View style={styles.primaryButtonDisabled}>
          <Text style={styles.primaryButtonDisabledText}>{title}</Text>
        </View>
      ) : (
        <LinearGradient
          colors={loading && runningColors ? [...runningColors] : ["#667EEA", "#764BA2"]}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>{title}</Text>
        </LinearGradient>
      )}
    </Pressable>
  );
}

function PhoneBindingModal({
  visible,
  state,
  onClose,
}: {
  visible: boolean;
  state: ActivityCenterState;
  onClose(): void;
}) {
  const { t } = useLocalization();
  const reduceMotion = useReduceMotionPreference();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [focused, setFocused] = useState<"phone" | "code">("phone");
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
      onDismiss={() => {
        setPhone("");
        setCode("");
      }}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose} accessibilityRole="none">
        <Pressable
          accessibilityViewIsModal
          style={styles.modalCard}
          onPress={(event) => event.stopPropagation()}
        >
          <ModalHeader
            icon="phone.fill"
            title={t("activityCenter.phone.title")}
            subtitle={t("activityCenter.phone.e164Hint")}
            onClose={onClose}
          />
          <View style={styles.modalDivider} />
          <FieldLabel>{t("activityCenter.phone.number")}</FieldLabel>
          <View style={[styles.inputBox, focused === "phone" && styles.inputFocused]}>
            <SymbolView
              name="phone"
              size={15}
              weight="semibold"
              tintColor={focused === "phone" ? colors.accent : colors.secondaryText}
            />
            <TextInput
              autoFocus
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              value={phone}
              onChangeText={setPhone}
              onFocus={() => setFocused("phone")}
              placeholder={t("activityCenter.phone.placeholder")}
              style={styles.input}
            />
          </View>
          <Text style={styles.fieldHint}>{t("activityCenter.phone.e164Hint")}</Text>
          <View style={styles.modalButtonGap}>
            <PrimaryButton
              title={t("activityCenter.phone.sendCode")}
              loading={state.isRunning("send-code")}
              disabled={!phone.trim()}
              onPress={() => {
                void state
                  .requestPhoneCode(phone, state.snapshot?.phoneBinding.defaultRegion)
                  .then((sent) => {
                    if (sent) setFocused("code");
                  });
              }}
            />
          </View>
          {state.phoneVerificationSession ? (
            <>
              <View style={styles.modalDivider} />
              <FieldLabel>{t("activityCenter.phone.code")}</FieldLabel>
              <View style={[styles.inputBox, focused === "code" && styles.inputFocused]}>
                <SymbolView
                  name="number"
                  size={15}
                  weight="semibold"
                  tintColor={focused === "code" ? colors.accent : colors.secondaryText}
                />
                <TextInput
                  autoFocus
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  value={code}
                  onChangeText={setCode}
                  onFocus={() => setFocused("code")}
                  placeholder={t("activityCenter.phone.codePlaceholder")}
                  style={styles.input}
                />
              </View>
              <View style={styles.modalButtonGap}>
                <PrimaryButton
                  title={t("activityCenter.phone.verify")}
                  loading={state.isRunning("verify-phone")}
                  disabled={!code.trim()}
                  onPress={() =>
                    void state.verifyPhone(code).then((verified) => verified && onClose())
                  }
                />
              </View>
            </>
          ) : null}
          <View style={styles.privacyBox}>
            <SymbolView
              name="lock.shield.fill"
              size={14}
              weight="semibold"
              tintColor={colors.accent}
            />
            <Text style={styles.privacyText}>{t("activityCenter.phone.privacy")}</Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MatchesModal({
  visible,
  state,
  onClose,
}: {
  visible: boolean;
  state: ActivityCenterState;
  onClose(): void;
}) {
  const { t } = useLocalization();
  const reduceMotion = useReduceMotionPreference();
  const [requested, setRequested] = useState(new Set<string>());
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          accessibilityViewIsModal
          style={styles.modalCard}
          onPress={(event) => event.stopPropagation()}
        >
          <ModalHeader
            icon="person.2.fill"
            title={t("activityCenter.contacts.matches")}
            subtitle={t("activityCenter.contacts.subtitle")}
            onClose={onClose}
          />
          <View style={styles.modalDivider} />
          {state.matchedUsers.length === 0 ? (
            <View style={styles.noMatches}>
              <SymbolView
                name="person.2.slash"
                size={34}
                weight="medium"
                tintColor={colors.tertiaryText}
              />
              <Text style={styles.noMatchesTitle}>{t("activityCenter.contacts.noMatches")}</Text>
              <Text style={styles.noMatchesHint}>{t("activityCenter.contacts.noMatchesHint")}</Text>
            </View>
          ) : (
            <ScrollView style={state.matchedUsers.length > 4 ? styles.matchesScroll : undefined}>
              {state.matchedUsers.map((user, index) => (
                <View key={user.userID}>
                  <MatchedUserRow
                    state={state}
                    user={user}
                    requested={requested.has(user.userID)}
                    onRequested={() => setRequested((current) => new Set(current).add(user.userID))}
                  />
                  {index < state.matchedUsers.length - 1 ? (
                    <View style={[styles.divider, styles.matchesDivider]} />
                  ) : null}
                </View>
              ))}
            </ScrollView>
          )}
          <View style={styles.modalDoneGap}>
            <PrimaryButton
              title={t("common.done")}
              loading={false}
              disabled={false}
              onPress={onClose}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MatchedUserRow({
  state,
  user,
  requested,
  onRequested,
}: {
  state: ActivityCenterState;
  user: ActivityMatchedUser;
  requested: boolean;
  onRequested(): void;
}) {
  const { t } = useLocalization();
  const [optimistic, setOptimistic] = useState(false);
  const appearsRequested = requested || optimistic;
  const running = state.isRunning(`friend:${user.userID}`);
  const requestFriend = useCallback(
    (withHaptic: boolean) => {
      if (appearsRequested || running) return;
      if (withHaptic) void Haptics.selectionAsync();
      setOptimistic(true);
      void state.sendFriendRequest(user).then((sent) => {
        if (sent) onRequested();
        else setOptimistic(false);
      });
    },
    [appearsRequested, onRequested, running, state, user],
  );
  return (
    <View
      style={styles.matchRow}
      accessible
      accessibilityLabel={`${user.nickname}, ${
        appearsRequested ? t("activityCenter.contacts.sent") : t("activityCenter.contacts.add")
      }`}
      accessibilityState={{ busy: running, disabled: appearsRequested || running }}
      accessibilityActions={[{ name: "addFriend", label: t("activityCenter.contacts.add") }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "addFriend") requestFriend(false);
      }}
    >
      <Avatar uri={user.avatarURL} name={user.nickname} size={46} />
      <Text numberOfLines={1} style={styles.matchName}>
        {user.nickname}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={appearsRequested || running}
        onPress={() => requestFriend(true)}
        style={[
          styles.addFriendButton,
          appearsRequested ? styles.addFriendSent : styles.addFriendReady,
        ]}
      >
        <Text
          style={[
            styles.addFriendText,
            appearsRequested ? styles.secondaryText : styles.accentText,
          ]}
        >
          {appearsRequested ? t("activityCenter.contacts.sent") : t("activityCenter.contacts.add")}
        </Text>
      </Pressable>
    </View>
  );
}

function RedeemModal({
  visible,
  state,
  onClose,
}: {
  visible: boolean;
  state: ActivityCenterState;
  onClose(): void;
}) {
  const { t } = useLocalization();
  const [input, setInput] = useState("");
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View accessibilityViewIsModal style={styles.sheetScreen}>
        <View style={styles.sheetHeader}>
          <Pressable onPress={onClose}>
            <Text style={styles.sheetCancel}>{t("common.cancel")}</Text>
          </Pressable>
          <Text style={styles.sheetTitle}>{t("activityCenter.invite.redeem")}</Text>
          <View style={styles.sheetHeaderSpacer} />
        </View>
        <View style={styles.formSection}>
          <TextInput
            autoCapitalize="characters"
            autoCorrect={false}
            value={input}
            onChangeText={setInput}
            placeholder={t("activityCenter.invite.inputPlaceholder")}
            style={styles.formInput}
          />
          <View style={styles.divider} />
          <Pressable
            disabled={!input.trim() || state.isRunning("redeem")}
            onPress={() => void state.redeemInvite(input).then((redeemed) => redeemed && onClose())}
            style={styles.formAction}
          >
            <Text
              style={[
                styles.formActionText,
                (!input.trim() || state.isRunning("redeem")) && styles.disabledOpacity,
              ]}
            >
              {t("activityCenter.invite.redeem")}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.formFooter}>{t("activityCenter.invite.redeemHint")}</Text>
      </View>
    </Modal>
  );
}

function WheelResultModal({
  result,
  onClose,
}: {
  result: ActivityWheelSpinResult | undefined;
  onClose(): void;
}) {
  const { t } = useLocalization();
  const reduceMotion = useReduceMotionPreference();
  const scale = useSharedValue(0.78);
  const opacity = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  useEffect(() => {
    if (!result) return;
    cancelAnimation(scale);
    cancelAnimation(opacity);
    if (reduceMotion) {
      scale.value = 1;
      opacity.value = 1;
      return;
    }
    scale.value = 0.78;
    opacity.value = 0;
    scale.value = withSpring(1, { damping: 14, stiffness: 130 });
    opacity.value = withTiming(1, { duration: 240 });
  }, [opacity, reduceMotion, result, scale]);
  return (
    <Modal
      visible={Boolean(result)}
      transparent
      animationType={reduceMotion ? "none" : "fade"}
      onRequestClose={onClose}
    >
      <Pressable style={styles.resultBackdrop} onPress={onClose}>
        <Animated.View accessibilityViewIsModal style={[styles.resultCard, animated]}>
          <Pressable
            onPress={onClose}
            style={styles.resultClose}
            accessibilityLabel={t("common.close")}
          >
            <SymbolView name="xmark" size={13} weight="bold" tintColor={colors.secondaryText} />
          </Pressable>
          <View style={styles.resultCoinHalo}>
            <Image
              source={nativeAssets.walletGoldCoinBadge}
              contentFit="contain"
              style={styles.resultCoin}
            />
          </View>
          <Text style={styles.resultTitle}>{t("activityCenter.wheel.resultTitle")}</Text>
          <Text style={styles.resultAmount}>+{result?.payoutGoldCoins ?? 0}</Text>
          <View style={styles.resultButtonGap}>
            <PrimaryButton
              title={t("common.confirm")}
              loading={false}
              disabled={false}
              onPress={onClose}
            />
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function RewardCelebration({
  celebration,
  onFinished,
}: {
  celebration: { id: string; amount: number };
  onFinished(): void;
}) {
  const { t } = useLocalization();
  const reduceMotion = useReduceMotionPreference();
  const burstScale = useSharedValue(0.62);
  const burstRotation = useSharedValue(-10);
  const burstOpacity = useSharedValue(0);
  const rewardScale = useSharedValue(0.76);
  const rewardOffset = useSharedValue(14);
  const rewardOpacity = useSharedValue(0);
  const onFinishedRef = useRef(onFinished);
  const burstStyle = useAnimatedStyle(() => ({
    transform: [{ scale: burstScale.value }, { rotate: `${burstRotation.value}deg` }],
    opacity: burstOpacity.value,
  }));
  const rewardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rewardScale.value }, { translateY: rewardOffset.value }],
    opacity: rewardOpacity.value,
  }));
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);
  useEffect(() => {
    const announcement = t("activityCenter.reward.catFood", celebration.amount);
    AccessibilityInfo.announceForAccessibility(announcement);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    cancelAnimation(burstScale);
    cancelAnimation(burstRotation);
    cancelAnimation(burstOpacity);
    cancelAnimation(rewardScale);
    cancelAnimation(rewardOffset);
    cancelAnimation(rewardOpacity);
    burstScale.value = 0.62;
    burstRotation.value = -10;
    burstOpacity.value = 0;
    rewardScale.value = 0.76;
    rewardOffset.value = 14;
    rewardOpacity.value = 0;
    if (reduceMotion) {
      burstOpacity.value = withTiming(0.86, { duration: 180 });
      rewardOpacity.value = withTiming(1, { duration: 180 });
      const fade = setTimeout(() => {
        burstOpacity.value = withTiming(0, { duration: 180 });
        rewardOpacity.value = withTiming(0, { duration: 180 });
      }, 700);
      const finish = setTimeout(() => onFinishedRef.current(), 900);
      return () => {
        clearTimeout(fade);
        clearTimeout(finish);
      };
    }
    burstScale.value = withSpring(1, { damping: 11, stiffness: 150 });
    burstRotation.value = withSpring(0, { damping: 11, stiffness: 150 });
    rewardScale.value = withSpring(1, { damping: 10, stiffness: 160 });
    rewardOffset.value = withSpring(0, { damping: 10, stiffness: 160 });
    burstOpacity.value = withTiming(1, { duration: 180 });
    rewardOpacity.value = withTiming(1, { duration: 180 });
    const expand = setTimeout(() => {
      burstScale.value = withTiming(1.3, { duration: 580 });
      burstRotation.value = withTiming(24, { duration: 580 });
      burstOpacity.value = withTiming(0, { duration: 580 });
      rewardOffset.value = withTiming(-24, { duration: 580 });
    }, 420);
    const fade = setTimeout(() => {
      rewardScale.value = withTiming(1.04, { duration: 200 });
      rewardOffset.value = withTiming(-31, { duration: 200 });
      rewardOpacity.value = withTiming(0, { duration: 200 });
    }, 850);
    const finish = setTimeout(() => onFinishedRef.current(), 1_070);
    return () => {
      clearTimeout(expand);
      clearTimeout(fade);
      clearTimeout(finish);
    };
  }, [
    burstOpacity,
    burstRotation,
    burstScale,
    celebration.amount,
    celebration.id,
    reduceMotion,
    rewardOffset,
    rewardOpacity,
    rewardScale,
    t,
  ]);
  return (
    <View
      pointerEvents="none"
      style={styles.celebrationLayer}
      accessible
      accessibilityLabel={t("activityCenter.reward.catFood", celebration.amount)}
    >
      <Animated.Image
        source={nativeAssets.activityClaimBurst}
        resizeMode="contain"
        style={[styles.burstImage, burstStyle]}
      />
      <Animated.View style={[styles.celebrationReward, rewardStyle]}>
        <View style={styles.celebrationPawCircle}>
          <Image
            source={nativeAssets.activityRewardPaw}
            contentFit="contain"
            style={styles.celebrationPaw}
          />
        </View>
        <Text style={styles.celebrationText}>
          +{t("activityCenter.reward.catFood", celebration.amount)}
        </Text>
      </Animated.View>
    </View>
  );
}

function useReduceMotionPreference(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduceMotion;
}

function ModalHeader({
  icon,
  title,
  subtitle,
  onClose,
}: {
  icon: SFSymbol;
  title: string;
  subtitle: string;
  onClose(): void;
}) {
  const { t } = useLocalization();
  return (
    <View style={styles.modalHeader}>
      <IconTile name={icon} />
      <View style={styles.modalHeaderCopy}>
        <Text style={styles.modalTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.modalSubtitle}>
          {subtitle}
        </Text>
      </View>
      <Pressable accessibilityLabel={t("common.close")} onPress={onClose} style={styles.modalClose}>
        <SymbolView name="xmark" size={13} weight="bold" tintColor={colors.secondaryText} />
      </Pressable>
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

function UnavailableState({
  icon,
  title,
  message,
  actionTitle,
  onAction,
  embedded = false,
}: {
  icon: SFSymbol;
  title: string;
  message: string;
  actionTitle?: string;
  onAction?: () => void;
  embedded?: boolean;
}) {
  return (
    <View style={[styles.unavailable, embedded && styles.unavailableEmbedded]}>
      <SymbolView name={icon} size={40} tintColor={colors.tertiaryText} />
      <Text style={styles.unavailableTitle}>{title}</Text>
      <Text style={styles.unavailableMessage}>{message}</Text>
      {actionTitle && onAction ? (
        <Pressable style={styles.retryButton} onPress={onAction} accessibilityRole="button">
          <Text style={styles.retryText}>{actionTitle}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function wheelWedgePath(index: number): string {
  const center = 160;
  const radius = 150;
  const start = -90 + index * 90;
  const end = start + 90;
  const first = polarPoint(center, center, radius, start);
  const second = polarPoint(center, center, radius, end);
  return `M ${center} ${center} L ${first.x} ${first.y} A ${radius} ${radius} 0 0 1 ${second.x} ${second.y} Z`;
}

function wheelLabelPoint(index: number, radius: number): { x: number; y: number } {
  return polarPoint(160, 160, radius, -90 + (index + 0.5) * 90);
}

function polarPoint(
  cx: number,
  cy: number,
  radius: number,
  degrees: number,
): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180;
  return { x: cx + Math.cos(radians) * radius, y: cy + Math.sin(radians) * radius };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pageArea: { flex: 1 },
  loadingState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  loadingText: { fontSize: 15 },
  cachedBanner: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  cachedText: { fontSize: 12 },
  benefitsContent: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 32, gap: 12 },
  card: {
    padding: 18,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#F0F0F5",
    shadowColor: "#000",
    shadowOpacity: 0.025,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    gap: 16,
  },
  checkInHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  sectionCopy: { flex: 1, gap: 5 },
  checkInTitle: { color: "#1A1A2E", fontSize: 18, fontWeight: "700" },
  checkInSubtitle: { color: "#9E9EB8", fontSize: 12, fontWeight: "500" },
  progressBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: "rgba(102,126,234,0.12)",
  },
  progressText: {
    color: "#667EEA",
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  dayGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  accessibilityDayGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayCell: {
    width: "22.9%",
    minHeight: 88,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#F0F0F5",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    overflow: "hidden",
  },
  finalDayCell: { width: "48.2%", alignItems: "stretch" },
  accessibilityDayCell: { width: "47.8%" },
  claimableDay: {
    backgroundColor: "#667EEA",
    borderWidth: 0,
    shadowColor: "#667EEA",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  claimedDay: { backgroundColor: "rgba(102,126,234,0.12)", borderColor: "rgba(102,126,234,0.16)" },
  lockedDay: { backgroundColor: "#F2F2F7" },
  finalDayBackground: { backgroundColor: "#F8F6E9", borderColor: "rgba(244,180,0,0.28)" },
  dayLabel: { color: "#1A1A2E", fontSize: 10, fontWeight: "600" },
  dayPaw: { width: 30, height: 30 },
  lockedPaw: { opacity: 0.48 },
  dayReward: { color: "#1A1A2E", fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  dayCheck: { position: "absolute", top: 7, right: 7 },
  finalDayContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingLeft: 12,
    paddingRight: 12,
  },
  finalPaw: { width: 38, height: 38 },
  finalDayCopy: { flex: 1, gap: 2 },
  finalReward: { color: "#1A1A2E", fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  whiteText: { color: "#FFFFFF" },
  sectionTitle: { alignItems: "flex-start", gap: 4 },
  sectionTitleText: { color: "#1A1A2E", fontSize: 17, fontWeight: "700" },
  sectionSubtitle: { color: "#9E9EB8", fontSize: 12, fontWeight: "500", lineHeight: 17 },
  mealList: { marginTop: -4 },
  mealRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(102,126,234,0.12)",
  },
  mealCopy: { flex: 1, gap: 3 },
  rowTitle: { color: "#1A1A2E", fontSize: 15, fontWeight: "600" },
  rowSubtitle: { color: "#9E9EB8", fontSize: 11, fontWeight: "500", lineHeight: 15 },
  countdown: { color: "#667EEA", fontSize: 11, fontWeight: "600", fontVariant: ["tabular-nums"] },
  mealAction: { alignItems: "flex-end", gap: 5 },
  rewardBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,212,59,0.16)",
  },
  rewardBadgePaw: { width: 18, height: 18 },
  rewardBadgeText: {
    color: "#1A1A2E",
    fontSize: 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  claimButton: {
    minWidth: 64,
    minHeight: 40,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  claimButtonActive: { backgroundColor: "#667EEA" },
  claimButtonDisabled: { backgroundColor: "#F2F2F7" },
  claimButtonText: { minWidth: 56, textAlign: "center", fontSize: 11, fontWeight: "700" },
  secondaryText: { color: "#9E9EB8" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "#F0F0F5" },
  indentedDivider: { marginLeft: 50 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13 },
  taskCopy: { flex: 1, gap: 4 },
  completedCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(102,126,234,0.12)",
  },
  pressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
  pressedSmall: { opacity: 0.86, transform: [{ scale: 0.94 }] },
  inviteCodeBox: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    borderRadius: 14,
    backgroundColor: "#F2F2F7",
  },
  inviteCodeCopy: { flex: 1, gap: 3 },
  inviteLabel: { color: "#9E9EB8", fontSize: 11, fontWeight: "500" },
  inviteCode: { color: "#1A1A2E", fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  inviteFooter: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 10 },
  outlineButton: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#667EEA",
  },
  outlineButtonText: { color: "#667EEA", fontSize: 15, fontWeight: "500" },
  inviteStats: { flex: 1, textAlign: "right", color: "#9E9EB8", fontSize: 12 },
  disabledOpacity: { opacity: 0.45 },
  wheelContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 18 },
  balanceCard: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
  },
  balanceCoin: { width: 36, height: 36 },
  balanceCopy: { flex: 1, gap: 1 },
  balanceLabel: { color: "#9E9EB8", fontSize: 12 },
  balanceValue: {
    color: "#1A1A2E",
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  tierBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "#667EEA",
  },
  tierText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  winnerBadge: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(102,126,234,0.12)",
  },
  winnerText: { color: "#667EEA", fontSize: 12 },
  wheelStage: {
    maxWidth: 344,
    height: 344,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
  },
  wheelDiscWrap: {
    width: 320,
    height: 320,
    shadowColor: "#667EEA",
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  wheelDisc: { width: 320, height: 320, alignItems: "center", justifyContent: "center" },
  wheelPrizeCoin: { position: "absolute", width: 24, height: 24 },
  wheelCenter: {
    position: "absolute",
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelCenterText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  pointer: {
    position: "absolute",
    top: 3,
    width: 0,
    height: 0,
    borderLeftWidth: 19,
    borderRightWidth: 19,
    borderTopWidth: 38,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: "#FFD43B",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  primaryButtonWrap: { width: "100%" },
  primaryButton: {
    minHeight: 50,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    shadowColor: "#667EEA",
    shadowOpacity: 0.22,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  primaryButtonDisabled: {
    minHeight: 50,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(102,126,234,0.2)",
  },
  primaryButtonDisabledText: { color: "rgba(26,26,46,0.58)", fontSize: 16, fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    backgroundColor: "rgba(0,0,0,0.34)",
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 22,
    borderRadius: 26,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
  },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  modalHeaderCopy: { flex: 1, gap: 2 },
  modalTitle: { color: "#1A1A2E", fontSize: 20, fontWeight: "700" },
  modalSubtitle: { color: "#9E9EB8", fontSize: 11, fontWeight: "500" },
  modalClose: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F2F2F7",
  },
  modalDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#F0F0F5",
    marginVertical: 16,
  },
  fieldLabel: { color: "#9E9EB8", fontSize: 12, fontWeight: "600", marginBottom: 8 },
  inputBox: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#F0F0F5",
    backgroundColor: "#F2F2F7",
  },
  inputFocused: { borderWidth: 1.5, borderColor: "rgba(102,126,234,0.7)" },
  input: { flex: 1, color: "#1A1A2E", fontSize: 16, fontWeight: "500", paddingVertical: 0 },
  fieldHint: { color: "#9E9EB8", fontSize: 11, fontWeight: "500", marginTop: 8 },
  modalButtonGap: { marginTop: 14 },
  privacyBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    padding: 12,
    marginTop: 16,
    borderRadius: 13,
    backgroundColor: "rgba(238,240,255,0.72)",
  },
  privacyText: { flex: 1, color: "#9E9EB8", fontSize: 11, fontWeight: "500", lineHeight: 16 },
  noMatches: { alignItems: "center", gap: 10, paddingVertical: 28 },
  noMatchesTitle: { color: "#1A1A2E", fontSize: 16, fontWeight: "700" },
  noMatchesHint: { color: "#9E9EB8", fontSize: 12, fontWeight: "500", textAlign: "center" },
  matchesScroll: { maxHeight: 336 },
  matchRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  matchName: { flex: 1, color: "#1A1A2E", fontSize: 15, fontWeight: "600" },
  matchesDivider: { marginLeft: 58 },
  addFriendButton: {
    minWidth: 64,
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  addFriendSent: { backgroundColor: "#F2F2F7" },
  addFriendReady: { backgroundColor: "rgba(102,126,234,0.12)" },
  addFriendText: { minWidth: 44, textAlign: "center", fontSize: 12, fontWeight: "700" },
  accentText: { color: "#667EEA" },
  modalDoneGap: { marginTop: 18 },
  sheetScreen: { flex: 1, backgroundColor: "#F2F2F7" },
  sheetHeader: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E5EA",
  },
  sheetCancel: { color: "#667EEA", fontSize: 17 },
  sheetTitle: { color: "#1A1A2E", fontSize: 17, fontWeight: "600" },
  sheetHeaderSpacer: { width: 44 },
  formSection: { marginTop: 32, backgroundColor: "#FFFFFF", paddingLeft: 16 },
  formInput: { minHeight: 44, color: "#1A1A2E", fontSize: 17, paddingRight: 16 },
  formAction: { minHeight: 44, justifyContent: "center" },
  formActionText: { color: "#667EEA", fontSize: 17 },
  formFooter: { color: "#9E9EB8", fontSize: 13, paddingHorizontal: 32, paddingTop: 8 },
  resultBackdrop: { flex: 1, alignItems: "center", justifyContent: "center" },
  resultCard: {
    width: "100%",
    maxWidth: 336,
    alignItems: "center",
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 24,
    borderRadius: 26,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
  },
  resultClose: {
    alignSelf: "flex-end",
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F2F2F7",
  },
  resultCoinHalo: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,212,59,0.14)",
    borderWidth: 1,
    borderColor: "rgba(244,180,0,0.22)",
    marginTop: 2,
  },
  resultCoin: { width: 78, height: 78 },
  resultTitle: { color: "#1A1A2E", fontSize: 22, fontWeight: "700", marginTop: 14 },
  resultAmount: {
    color: "#667EEA",
    fontSize: 48,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    marginTop: 6,
  },
  resultButtonGap: { width: "100%", marginTop: 22 },
  celebrationLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  burstImage: { position: "absolute", width: 224, height: 224 },
  celebrationReward: { alignItems: "center", gap: 9 },
  celebrationPawCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8F9FF",
    borderWidth: 1,
    borderColor: "rgba(255,212,59,0.28)",
    shadowColor: "#F4B400",
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
  },
  celebrationPaw: { width: 68, height: 68 },
  celebrationText: {
    minHeight: 40,
    color: "#1A1A2E",
    fontSize: 20,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.96)",
    overflow: "hidden",
  },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  unavailableEmbedded: { minHeight: 180 },
  unavailableTitle: { color: "#1A1A2E", fontSize: 17, fontWeight: "600" },
  unavailableMessage: { color: "#9E9EB8", fontSize: 15, textAlign: "center" },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#667EEA",
  },
  retryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
});
