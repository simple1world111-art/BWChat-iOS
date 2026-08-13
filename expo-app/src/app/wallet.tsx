import { Image } from "expo-image";
import { router, Stack, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { nativeAssets } from "../assets/nativeAssets";
import { CenterToast, TopToast } from "@/components/TopToast";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { useWallet } from "@/providers/WalletProvider";
import { resolveWalletRuntimeConfig, walletMetrics } from "@/services/wallet/walletPolicy";
import { useWalletPurchases } from "@/services/wallet/useWalletPurchases";
import { useWalletRewardAd } from "@/services/wallet/useWalletRewardAd";
import { walletVisualAcceptanceVariant } from "@/services/visualAcceptance";

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const { t } = useLocalization();
  const { config } = useRemoteConfig();
  const wallet = useWallet();
  const { refreshBalance, refreshTransactions } = wallet;
  const runtime = useMemo(() => resolveWalletRuntimeConfig(config.wallet), [config.wallet]);
  const purchase = useWalletPurchases(runtime.products);
  const rewardAd = useWalletRewardAd();
  const [selectedProductIndex, setSelectedProductIndex] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [topToast, setTopToast] = useState<string | null>(null);
  const contentHeight = height - insets.top - insets.bottom - 46;
  const compact =
    walletVisualAcceptanceVariant === "wallet-coins-compact" ||
    contentHeight < walletMetrics.compactHeightThreshold;
  const productCardWidth = (width - 36 - 24) / 3;
  const nativeContentOriginOffset = 10;

  useFocusEffect(
    useCallback(() => {
      void Promise.all([refreshBalance(), refreshTransactions()]);
    }, [refreshBalance, refreshTransactions]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshBalance();
    });
    return () => subscription.remove();
  }, [refreshBalance]);

  useEffect(() => {
    if (!purchase.notice) return;
    const message = purchase.notice;
    const clearNotice = purchase.clearNotice;
    const task = setTimeout(() => {
      if (purchase.noticePresentation === "center") {
        setToast(message);
        clearNotice();
        return;
      }
      if (purchase.noticePresentation === "top") {
        setTopToast(message);
        clearNotice();
        return;
      }
      Alert.alert(t("common.notice"), message, [{ text: t("common.ok"), onPress: clearNotice }]);
    }, 0);
    return () => clearTimeout(task);
  }, [purchase.clearNotice, purchase.notice, purchase.noticePresentation, t]);

  const effectiveSelectedProductIndex = Math.min(
    selectedProductIndex,
    Math.max(runtime.products.length - 1, 0),
  );
  const selectedProduct = runtime.products[effectiveSelectedProductIndex];
  const selectedProductPrice = selectedProduct ? purchase.displayPrice(selectedProduct) : "";
  const purchaseTitle = purchase.isLoadingProducts
    ? t("wallet.products.loading")
    : purchase.isPurchasing
      ? t("wallet.purchase.processing")
      : t("wallet.rechargeNow", selectedProductPrice);
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <Image
        accessible={false}
        contentFit="cover"
        source={nativeAssets.walletGoldCoinBackground}
        style={StyleSheet.absoluteFill}
        transition={0}
      />
      <View pointerEvents="none" style={styles.bottomWhiteFill} />
      <View
        style={[
          styles.navigation,
          {
            paddingTop: insets.top,
            height: insets.top + 44,
            backgroundColor: "transparent",
          },
        ]}
      >
        <Pressable
          accessibilityLabel={t("common.back")}
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <View pointerEvents="none" style={styles.backButtonFallback} />
          <SymbolView name="chevron.left" size={22} tintColor="#1A1A2E" weight="semibold" />
        </Pressable>
        <Text accessibilityRole="header" style={styles.navigationTitle}>
          {t("wallet.myGoldCoins")}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ minHeight: contentHeight }}
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        style={{ width }}
      >
        <View style={{ height: (compact ? 30 : 48) + nativeContentOriginOffset }} />
        <View
          style={{ height: compact ? 122 : 153, alignItems: "center", justifyContent: "center" }}
        >
          <Image
            accessible={false}
            contentFit="contain"
            source={nativeAssets.walletGoldCoinBadge}
            style={{ width: compact ? 119 : 147, height: compact ? 119 : 147 }}
            transition={0}
          />
        </View>
        <View
          style={[
            styles.balanceHeader,
            {
              rowGap: compact ? 7 : 10,
              marginTop: compact ? 0 : 2,
              paddingHorizontal: compact ? 16 : 24,
            },
          ]}
        >
          <Metric
            compact={compact}
            loading={wallet.balance === null}
            title={t("wallet.goldCoinBalance")}
            value={wallet.balance ? String(wallet.balance.gold_coin_balance) : t("common.loading")}
          />
          <Pressable
            accessibilityLabel={t("wallet.goldCoinDetails")}
            accessibilityRole="button"
            onPress={() => router.push("/wallet-transactions")}
            style={styles.detailLink}
          >
            <Text style={[styles.detailText, { fontSize: compact ? 12 : 13 }]}>
              {t("wallet.goldCoinDetails")}
            </Text>
            <SymbolView
              name="chevron.right"
              size={compact ? 10 : 11}
              tintColor="rgba(0,0,0,0.48)"
              weight="bold"
            />
          </Pressable>
        </View>
        <View style={{ flexGrow: 1, minHeight: compact ? 18 : 26 }} />
        <View style={styles.goldLowerPixelAlignment}>
          <RewardBanner compact={compact} reward={rewardAd} onToast={setToast} />
        </View>
        <View style={{ height: compact ? 10 : 14 }} />
        <View
          style={[
            styles.topPanel,
            styles.goldLowerPixelAlignment,
            {
              flexGrow: 0,
              paddingTop: compact ? 10 : 12,
              paddingBottom: Math.max(insets.bottom, compact ? 10 : 14),
            },
          ]}
        >
          {purchase.productError ? (
            <View style={styles.productError}>
              <SymbolView name="exclamationmark.circle" size={14} tintColor="#9A6A00" />
              <Text style={styles.productErrorText}>{purchase.productError}</Text>
            </View>
          ) : null}
          <View style={[styles.productGrid, { rowGap: compact ? 12 : 16 }]}>
            {runtime.products.map((product, index) => {
              const isSelected = index === effectiveSelectedProductIndex;
              const price = purchase.isAvailable(product)
                ? purchase.displayPrice(product)
                : t("wallet.product.unavailable");
              return (
                <Pressable
                  accessibilityLabel={`${product.coins} ${t("wallet.currency.goldCoins")}, ${price}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  key={product.productId}
                  onPress={() => setSelectedProductIndex(index)}
                  style={[
                    styles.productCard,
                    {
                      width: productCardWidth,
                      height: compact ? 66 : 78,
                      rowGap: compact ? 9 : 12,
                      borderRadius: compact ? 14 : 18,
                      borderWidth: isSelected ? (compact ? 2.5 : 3) : 0,
                      borderColor: isSelected ? "#FFE200" : "transparent",
                      backgroundColor: isSelected ? "#FFFFFF" : "#F2F2F2",
                    },
                  ]}
                >
                  <View style={[styles.productAmount, { columnGap: compact ? 2 : 3 }]}>
                    <Image
                      accessible={false}
                      contentFit="contain"
                      source={nativeAssets.walletGoldCoinBadge}
                      style={{ width: compact ? 21 : 28, height: compact ? 21 : 28 }}
                      transition={0}
                    />
                    <Text
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                      numberOfLines={1}
                      style={[styles.productCoins, { fontSize: compact ? 14 : 17 }]}
                    >
                      {product.coins}
                    </Text>
                  </View>
                  <Text
                    adjustsFontSizeToFit
                    minimumFontScale={0.52}
                    numberOfLines={1}
                    style={[styles.productPrice, { fontSize: compact ? 12 : 14 }]}
                  >
                    {price}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityLabel={purchaseTitle}
            accessibilityRole="button"
            accessibilityState={{
              busy: purchase.isPurchasing || purchase.isLoadingProducts,
              disabled: purchase.isPurchasing || purchase.isLoadingProducts,
            }}
            disabled={purchase.isPurchasing || purchase.isLoadingProducts}
            onPress={() => {
              if (!agreed) return Alert.alert(t("common.notice"), t("wallet.terms.required"));
              if (selectedProduct) void purchase.purchase(selectedProduct);
            }}
            style={[
              styles.primaryButton,
              {
                height: compact ? 42 : 52,
                marginTop: compact ? 12 : 16,
                opacity: purchase.isPurchasing || purchase.isLoadingProducts ? 0.72 : 1,
              },
            ]}
          >
            {purchase.isPurchasing || purchase.isLoadingProducts ? (
              <ActivityIndicator color="#000000" size="small" />
            ) : null}
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.58}
              numberOfLines={1}
              style={[styles.primaryButtonText, { fontSize: compact ? 16 : 19 }]}
            >
              {purchaseTitle}
            </Text>
          </Pressable>
          <View
            style={[
              styles.termsRow,
              { marginTop: compact ? 6 : 8, paddingBottom: compact ? 2 : 4 },
            ]}
          >
            <Pressable
              accessibilityLabel={t("wallet.terms.agreePrefix")}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              hitSlop={{ top: 16, bottom: 16, left: 12, right: 3 }}
              onPress={() => setAgreed((value) => !value)}
              style={styles.termsAgreementControl}
            >
              <SymbolView
                name={agreed ? "checkmark.circle.fill" : "circle"}
                size={compact ? 12 : 14}
                tintColor={agreed ? "#F0A020" : "rgba(128,128,128,0.45)"}
              />
              <Text numberOfLines={1} style={[styles.termsPrefix, { fontSize: compact ? 10 : 12 }]}>
                {t("wallet.terms.agreePrefix")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={t("wallet.terms.title")}
              accessibilityRole="link"
              hitSlop={{ top: 16, bottom: 16, left: 3, right: 12 }}
              onPress={() =>
                router.push({
                  pathname: "/dynamic-screen/[id]",
                  params: { id: runtime.termsScreenId },
                })
              }
            >
              <Text numberOfLines={1} style={[styles.termsTitle, { fontSize: compact ? 10 : 12 }]}>
                {t("wallet.terms.title")}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
      <TopToast message={topToast} onDismiss={() => setTopToast(null)} topInset={insets.top} />
      <CenterToast message={toast} onDismiss={() => setToast(null)} />
    </View>
  );
}

function Metric({
  compact,
  loading,
  title,
  value,
}: {
  compact: boolean;
  loading: boolean;
  title: string;
  value: string;
}) {
  return (
    <View style={[styles.metric, { rowGap: compact ? 3 : 5 }]}>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.62}
        numberOfLines={1}
        style={[styles.metricTitle, { fontSize: compact ? 11 : 13 }]}
      >
        {title}
      </Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.62}
        numberOfLines={1}
        style={[
          styles.metricValue,
          { fontSize: loading ? (compact ? 13 : 15) : compact ? 23 : 28 },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function RewardBanner({
  compact,
  reward,
  onToast,
}: {
  compact: boolean;
  reward: ReturnType<typeof useWalletRewardAd>;
  onToast: (value: string) => void;
}) {
  const { t } = useLocalization();
  const busy = reward.isBusy || reward.isAwaitingServerCredit;
  const title = reward.isAwaitingServerCredit
    ? t("wallet.adRewardCompletedPending")
    : reward.isBusy
      ? t("wallet.adRewardPreparing")
      : t("wallet.adReward", reward.remainingCount);
  const press = async () => {
    if (!reward.isAvailable)
      return Alert.alert(t("common.notice"), t("wallet.adRewardUnavailable"));
    if (reward.remainingCount <= 0)
      return Alert.alert(t("common.notice"), t("wallet.adRewardDailyLimitReached"));
    const outcome = await reward.present();
    if (outcome === "earned") onToast(t("wallet.adRewardCompletedPending"));
    else if (outcome === "failed") Alert.alert(t("common.notice"), t("wallet.adRewardLoadFailed"));
  };
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy || reward.remainingCount <= 0 }}
      disabled={busy || reward.remainingCount <= 0}
      onPress={() => void press()}
      style={[
        styles.adBanner,
        {
          height: compact ? 46 : 54,
          borderRadius: compact ? 15 : 18,
          paddingHorizontal: compact ? 13 : 18,
          columnGap: compact ? 8 : 12,
          opacity: busy || reward.remainingCount <= 0 ? 0.62 : 1,
        },
      ]}
    >
      <View style={[styles.playBox, { width: compact ? 20 : 24, height: compact ? 20 : 24 }]}>
        {busy ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <SymbolView
            name="play.fill"
            size={9}
            tintColor="#FFFFFF"
            weight="bold"
            style={{ transform: [{ translateX: 1 }] }}
          />
        )}
      </View>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.64}
        numberOfLines={2}
        style={[styles.adText, { fontSize: compact ? 13 : 14 }]}
      >
        {title}
      </Text>
      <SymbolView
        name="chevron.right"
        size={compact ? 15 : 18}
        tintColor="rgba(0,0,0,0.5)"
        weight="semibold"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  bottomWhiteFill: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 60,
    backgroundColor: "#FFFFFF",
  },
  goldLowerPixelAlignment: { transform: [{ translateY: StyleSheet.hairlineWidth }] },
  navigation: { position: "relative", justifyContent: "flex-end" },
  backButton: {
    position: "absolute",
    left: 20,
    bottom: 0,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
  },
  backButtonFallback: {
    position: "absolute",
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#FFFEE7",
  },
  navigationTitle: {
    alignSelf: "center",
    height: 44,
    fontSize: 18,
    lineHeight: 44,
    fontWeight: "600",
    color: "#000000",
  },
  balanceHeader: { alignItems: "center" },
  metric: { width: 240, alignItems: "center" },
  metricTitle: { fontWeight: "600", color: "rgba(0,0,0,0.66)" },
  metricValue: { fontWeight: "700", color: "#000000", fontVariant: ["tabular-nums"] },
  detailLink: { flexDirection: "row", alignItems: "center", columnGap: 4 },
  detailText: { fontWeight: "500", color: "rgba(0,0,0,0.48)" },
  adBanner: {
    marginHorizontal: 20,
    backgroundColor: "rgba(255,243,181,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.74)",
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#C99A10",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  playBox: {
    borderRadius: 9,
    backgroundColor: "#FFD400",
    alignItems: "center",
    justifyContent: "center",
  },
  adText: { flex: 1, fontWeight: "500", color: "rgba(0,0,0,0.68)" },
  topPanel: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 18,
    flexGrow: 1,
  },
  productError: { flexDirection: "row", alignItems: "center", columnGap: 8, marginBottom: 8 },
  productErrorText: { flex: 1, fontSize: 12, color: "#9A6A00" },
  productGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: 12 },
  productCard: { alignItems: "center", justifyContent: "center" },
  productAmount: { flexDirection: "row", alignItems: "center" },
  productCoins: { fontWeight: "700", color: "#000000" },
  productPrice: { fontWeight: "500", color: "rgba(0,0,0,0.48)" },
  primaryButton: {
    width: "100%",
    borderRadius: 16,
    backgroundColor: "#FFE500",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 8,
  },
  primaryButtonText: { fontWeight: "700", color: "#000000" },
  termsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", columnGap: 6 },
  termsAgreementControl: { flexDirection: "row", alignItems: "center", columnGap: 6 },
  termsPrefix: { color: "rgba(0,0,0,0.6)" },
  termsTitle: { color: "rgba(0,0,0,0.82)" },
});
