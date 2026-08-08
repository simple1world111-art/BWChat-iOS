import { Image } from "expo-image";
import { router, Stack, type Href } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";

import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { useLocalization } from "@/providers/LocalizationProvider";
import { usePropInventory } from "@/providers/PropInventoryProvider";
import { useWallet } from "@/providers/WalletProvider";
import {
  liveExperienceMinutes,
  propLiveExperienceKind,
  propMediaUnlockKind,
  type PropBagItem,
} from "@/services/props/PropInventoryModels";
import { propBagPalette } from "@/services/props/PropBagVisualPolicy";

const activityCatFoodArtwork = require("../../assets/native-original/Assets.xcassets/activity_cat_food_icon.imageset/activity_cat_food_icon.png");
const imageUnlockArtwork = require("../../assets/native-original/Assets.xcassets/prop_image_unlock_card.imageset/prop_image_unlock_card_gift_v2.png");
const videoUnlockArtwork = require("../../assets/native-original/Assets.xcassets/prop_video_unlock_card.imageset/prop_video_unlock_card_gift_v2.png");
const liveFiveMinuteArtwork = require("../../assets/native-original/Assets.xcassets/prop_live_experience_card_5m.imageset/prop_live_experience_card_5m_gift_v2.png");
const liveTenMinuteArtwork = require("../../assets/native-original/Assets.xcassets/prop_live_experience_card_10m.imageset/prop_live_experience_card_10m_gift_v2.png");
const liveFifteenMinuteArtwork = require("../../assets/native-original/Assets.xcassets/prop_live_experience_card_15m.imageset/prop_live_experience_card_15m_gift_v2.png");

type Theme = ReturnType<typeof propBagPalette>;

export default function PropBagScreen() {
  const { t } = useLocalization();
  const theme = propBagPalette(useColorScheme());
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const inventory = usePropInventory();
  const wallet = useWallet();
  const loadInventory = inventory.load;
  const refreshBalance = wallet.refreshBalance;
  const didLoadRef = useRef(false);
  const [selectedItem, setSelectedItem] = useState<PropBagItem | null>(null);
  const itemWidth = Math.floor((width - 32 - 20) / 3);
  const showsActivityCatFood = wallet.isActivityCatFoodEnabled || wallet.balance !== null;

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void Promise.all([loadInventory(), refreshBalance()]);
  }, [loadInventory, refreshBalance]);

  const refresh = () => Promise.all([
    inventory.load(true),
    wallet.refreshBalance(true),
  ]).then(() => undefined);
  const isInitialLoading = inventory.isLoading
    && inventory.items.length === 0
    && !showsActivityCatFood;
  const emptyError = inventory.errorMessage
    && inventory.items.length === 0
    && !showsActivityCatFood
    ? inventory.errorMessage
    : undefined;

  return (
    <>
      <Stack.Screen
        options={{
          title: t("propBag.title"),
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            refreshing={inventory.isLoading || wallet.isLoadingBalance}
            tintColor={theme.accent}
            onRefresh={() => void refresh()}
          />
        )}
        showsVerticalScrollIndicator={false}
        testID="prop-bag-scroll"
      >
        {isInitialLoading ? (
          <View style={styles.primaryState}><ActivityIndicator color={theme.accent} /></View>
        ) : emptyError ? (
          <PropBagLoadError
            message={emptyError}
            onRetry={() => void inventory.load(true)}
            styles={styles}
            theme={theme}
            retryTitle={t("common.retry")}
          />
        ) : inventory.items.length === 0 && !showsActivityCatFood ? (
          <PropBagEmptyState styles={styles} theme={theme} title={t("propBag.empty.title")} message={t("propBag.empty.message")} />
        ) : (
          <View style={styles.gridSection}>
            <View style={styles.grid}>
              {showsActivityCatFood ? (
                <PropBagGridCard
                  width={itemWidth}
                  title={t("activityCatFood.title")}
                  quantity={wallet.balance ? String(wallet.balance.activity_cat_food_balance) : "…"}
                  hint={wallet.isActivityCatFoodEnabled
                    ? wallet.balanceError ?? t("activityCatFood.card.subtitle")
                    : t("activityCatFood.readOnly")}
                  disabled={!wallet.isActivityCatFoodEnabled}
                  onPress={() => {
                    if (!wallet.balance && wallet.balanceError) void wallet.refreshBalance(true);
                    else router.push("/activity-cat-food" as Href);
                  }}
                  styles={styles}
                >
                  <Image
                    accessibilityIgnoresInvertColors
                    contentFit="contain"
                    source={activityCatFoodArtwork}
                    style={styles.activityArtwork}
                  />
                </PropBagGridCard>
              ) : null}
              {inventory.items.map((item) => (
                <PropBagGridCard
                  key={item.inventoryId}
                  width={itemWidth}
                  title={resolvedName(item, t)}
                  quantity={String(item.quantity)}
                  hint={resolvedDescription(item, t) || resolvedName(item, t)}
                  onPress={() => setSelectedItem(item)}
                  styles={styles}
                >
                  <PropArtwork item={item} styles={styles} theme={theme} label={resolvedName(item, t)} />
                </PropBagGridCard>
              ))}
            </View>
            {inventory.items.length === 0 && inventory.isLoading ? (
              <View style={styles.secondaryLoading}><ActivityIndicator color={theme.accent} /></View>
            ) : inventory.items.length === 0 && inventory.errorMessage ? (
              <PropBagLoadError
                message={inventory.errorMessage}
                onRetry={() => void inventory.load(true)}
                styles={styles}
                theme={theme}
                retryTitle={t("common.retry")}
                compact
              />
            ) : null}
          </View>
        )}
      </ScrollView>

      <UsageRulesPopover
        closeTitle={t("common.close")}
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        styles={styles}
        theme={theme}
        title={selectedItem ? resolvedName(selectedItem, t) : ""}
        rule={selectedItem
          ? resolvedDescription(selectedItem, t) || resolvedName(selectedItem, t)
          : ""}
      />
    </>
  );
}

function PropBagGridCard({
  width,
  title,
  quantity,
  hint,
  disabled = false,
  onPress,
  children,
  styles,
}: {
  width: number;
  title: string;
  quantity: string;
  hint: string;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={`${title}, ×${quantity}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.gridCard,
        { width },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.cardInner}>
        <View style={styles.artworkFrame}>{children}</View>
        <View style={styles.cardCopy}>
          <Text allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.76} numberOfLines={1} style={styles.cardTitle}>{title}</Text>
          <View style={styles.quantityCapsule}>
            <Text allowFontScaling={false} style={styles.quantityText}>×{quantity}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function PropArtwork({
  item,
  label,
  styles,
  theme,
}: {
  item: PropBagItem;
  label: string;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
}) {
  const asset = propArtworkAsset(item);
  if (asset) {
    return <Image accessibilityLabel={label} contentFit="contain" source={asset} style={styles.propArtwork} />;
  }
  const fallbackSymbol: SFSymbol = propLiveExperienceKind(item)
    ? "clock.badge.checkmark.fill"
    : propMediaUnlockKind(item) === "video"
      ? "play.rectangle.fill"
      : "photo.fill";
  const fallback = (
    <View style={styles.fallbackArtwork}>
      <SymbolView name={fallbackSymbol} size={40} weight="semibold" tintColor={theme.accent} />
    </View>
  );
  return item.iconUrl ? (
    <AuthenticatedImage
      accessibilityLabel={label}
      contentFit="contain"
      errorFallback={fallback}
      fallback={fallback}
      loadingFallback={fallback}
      style={styles.remoteArtwork}
      uri={item.iconUrl}
    />
  ) : fallback;
}

function UsageRulesPopover({
  closeTitle,
  item,
  onClose,
  styles,
  theme,
  title,
  rule,
}: {
  closeTitle: string;
  item: PropBagItem | null;
  onClose: () => void;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
  title: string;
  rule: string;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={item !== null}>
      <Pressable accessibilityLabel={closeTitle} accessibilityRole="button" onPress={onClose} style={styles.popoverBackdrop}>
        <Pressable accessibilityRole="none" onPress={() => undefined} style={styles.popoverCard}>
          <SymbolView name="info.circle.fill" size={18} weight="semibold" tintColor={theme.accent} />
          <View style={styles.popoverCopy}>
            <Text allowFontScaling={false} style={styles.popoverTitle}>{title}</Text>
            <Text allowFontScaling={false} style={styles.popoverRule}>{rule}</Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PropBagLoadError({
  message,
  onRetry,
  styles,
  theme,
  retryTitle,
  compact = false,
}: {
  message: string;
  onRetry: () => void;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
  retryTitle: string;
  compact?: boolean;
}) {
  return (
    <View style={[styles.errorCard, compact && styles.compactErrorCard]}>
      <SymbolView name="exclamationmark.triangle" size={34} tintColor={theme.warning} />
      <Text allowFontScaling={false} style={styles.errorText}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
        <Text allowFontScaling={false} style={styles.retryText}>{retryTitle}</Text>
      </Pressable>
    </View>
  );
}

function PropBagEmptyState({
  styles,
  theme,
  title,
  message,
}: {
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
  title: string;
  message: string;
}) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIconCircle}>
        <SymbolView name="shippingbox" size={38} weight="medium" tintColor={theme.accent} />
      </View>
      <View style={styles.emptyCopy}>
        <Text allowFontScaling={false} style={styles.emptyTitle}>{title}</Text>
        <Text allowFontScaling={false} style={styles.emptyMessage}>{message}</Text>
      </View>
    </View>
  );
}

function resolvedName(
  item: PropBagItem,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  if (item.name.trim()) return item.name.trim();
  const live = propLiveExperienceKind(item);
  if (live) return t("prop.liveExperienceCard.name", liveExperienceMinutes(live));
  const media = propMediaUnlockKind(item);
  if (media) return t(`prop.mediaUnlockCard.${media}.name`);
  return t("propBag.item.unknown");
}

function resolvedDescription(
  item: PropBagItem,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  if (item.description.trim()) return item.description.trim();
  const live = propLiveExperienceKind(item);
  if (live) return t("prop.liveExperienceCard.description", liveExperienceMinutes(live));
  const media = propMediaUnlockKind(item);
  return media ? t(`prop.mediaUnlockCard.${media}.description`) : "";
}

function propArtworkAsset(item: PropBagItem): number | undefined {
  const live = propLiveExperienceKind(item);
  if (live === "5m") return liveFiveMinuteArtwork;
  if (live === "10m") return liveTenMinuteArtwork;
  if (live === "15m") return liveFifteenMinuteArtwork;
  const media = propMediaUnlockKind(item);
  if (media === "image") return imageUnlockArtwork;
  if (media === "video") return videoUnlockArtwork;
  return undefined;
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    content: {
      flexGrow: 1,
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 32,
      backgroundColor: theme.background,
    },
    primaryState: { minHeight: 280, alignItems: "center", justifyContent: "center" },
    gridSection: { rowGap: 16 },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    gridCard: {
      minHeight: 188,
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingTop: 10,
      paddingBottom: 8,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: withAlpha(theme.separator, 0.62),
      backgroundColor: theme.card,
      shadowColor: "#000000",
      shadowOpacity: 0.035,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 2 },
    },
    cardInner: { minHeight: 170, alignItems: "center", justifyContent: "center", rowGap: 4 },
    artworkFrame: { width: 92, height: 92, alignItems: "center", justifyContent: "center" },
    activityArtwork: { width: 88, height: 88 },
    propArtwork: { width: 88, height: 88 },
    remoteArtwork: { width: 80, height: 80 },
    fallbackArtwork: { width: 92, height: 92, alignItems: "center", justifyContent: "center" },
    cardCopy: { width: "100%", alignItems: "center", rowGap: 4 },
    cardTitle: { width: "100%", color: theme.text, fontSize: 13, fontWeight: "600", textAlign: "center" },
    quantityCapsule: {
      height: 24,
      minWidth: 32,
      paddingHorizontal: 7,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: withAlpha(theme.separator, 0.7),
      backgroundColor: withAlpha(theme.card, 0.92),
    },
    quantityText: { color: theme.text, fontSize: 16, fontWeight: "900", fontVariant: ["tabular-nums"] },
    secondaryLoading: { minHeight: 120, alignItems: "center", justifyContent: "center" },
    pressed: { opacity: 0.72 },
    errorCard: {
      minHeight: 280,
      paddingHorizontal: 28,
      alignItems: "center",
      justifyContent: "center",
      rowGap: 12,
      borderRadius: 20,
      backgroundColor: theme.card,
    },
    compactErrorCard: { minHeight: 120 },
    errorText: { color: theme.secondaryText, fontSize: 14, textAlign: "center" },
    retryButton: { minHeight: 34, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: theme.accent },
    retryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
    emptyCard: {
      minHeight: 280,
      paddingHorizontal: 28,
      alignItems: "center",
      justifyContent: "center",
      rowGap: 14,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.separator,
      backgroundColor: theme.card,
    },
    emptyIconCircle: { width: 88, height: 88, borderRadius: 44, alignItems: "center", justifyContent: "center", backgroundColor: theme.accentSoft },
    emptyCopy: { alignItems: "center", rowGap: 6 },
    emptyTitle: { color: theme.text, fontSize: 18, fontWeight: "700" },
    emptyMessage: { color: theme.secondaryText, fontSize: 14, lineHeight: 20, fontWeight: "500", textAlign: "center" },
    popoverBackdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.16)" },
    popoverCard: {
      width: 262,
      padding: 16,
      flexDirection: "row",
      alignItems: "flex-start",
      columnGap: 10,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.separator,
      backgroundColor: theme.card,
      shadowColor: "#000000",
      shadowOpacity: 0.14,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    popoverCopy: { width: 198, alignItems: "flex-start", rowGap: 6 },
    popoverTitle: { color: theme.text, fontSize: 15, fontWeight: "700" },
    popoverRule: { color: theme.secondaryText, fontSize: 13, lineHeight: 18, fontWeight: "500" },
  });
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/iu.test(normalized)) return hex;
  const value = Number.parseInt(normalized, 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}
