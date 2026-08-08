import { Image } from "expo-image";
import { router, Stack, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ActivityIndicator,
  Animated,
  Alert,
  AppState,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { nativeAssets } from "../assets/nativeAssets";
import { CenterToast, TopToast } from "@/components/TopToast";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { useWallet } from "@/providers/WalletProvider";
import {
  deleteWalletPayoutAccount,
  saveWalletPayoutAccount,
} from "@/services/wallet/WalletRepository";
import {
  canWithdraw,
  isWalletPayoutAccountConfigured,
  maximumUsdtAmount,
  normalizeWithdrawalUsdtText,
  requiredGoldCoins,
  resolveWalletRuntimeConfig,
  withdrawalPolicyFor,
  walletMetrics,
  walletWithdrawalErrorKey,
} from "@/services/wallet/walletPolicy";
import { useWalletPurchases } from "@/services/wallet/useWalletPurchases";
import { useWalletRewardAd } from "@/services/wallet/useWalletRewardAd";
import { useAuth } from "@/providers/AuthProvider";
import { walletVisualAcceptanceVariant } from "@/services/visualAcceptance";

type WalletTab = "coins" | "earnings";
type FocusedWithdrawalField = "address" | "amount";

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const { t } = useLocalization();
  const { config } = useRemoteConfig();
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const wallet = useWallet();
  const { refreshBalance, refreshTransactions, refreshWithdrawals } = wallet;
  const runtime = useMemo(() => resolveWalletRuntimeConfig(config.wallet), [config.wallet]);
  const purchase = useWalletPurchases(runtime.products);
  const rewardAd = useWalletRewardAd();
  const [tab, setTab] = useState<WalletTab>(
    walletVisualAcceptanceVariant === "wallet-earnings" ||
      walletVisualAcceptanceVariant === "wallet-earnings-compact"
      ? "earnings"
      : "coins",
  );
  const [selectedProductIndex, setSelectedProductIndex] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [address, setAddress] = useState("");
  const [network, setNetwork] = useState("");
  const [amount, setAmount] = useState("");
  const [networkExpanded, setNetworkExpanded] = useState(false);
  const [networkMenuMounted, setNetworkMenuMounted] = useState(false);
  const [focusedWithdrawalField, setFocusedWithdrawalField] =
    useState<FocusedWithdrawalField | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [topToast, setTopToast] = useState<string | null>(null);
  const [focusTransition] = useState(() => new Animated.Value(0));
  const [networkMenuTransition] = useState(() => new Animated.Value(0));
  const networkLayerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressInputRef = useRef<TextInput>(null);
  const amountInputRef = useRef<TextInput>(null);
  const contentHeight = height - insets.top - insets.bottom - 46;
  const compact =
    walletVisualAcceptanceVariant === "wallet-coins-compact" ||
    walletVisualAcceptanceVariant === "wallet-earnings-compact" ||
    contentHeight < walletMetrics.compactHeightThreshold;
  const productCardWidth = (width - 36 - 24) / 3;
  const inputFocused = focusedWithdrawalField !== null;
  const normalTopGap = compact ? 30 : 48;
  const focusedTopGap = compact ? 10 : 14;
  const nativeContentOriginOffset = 10;
  const summaryHeight = compact ? 130 : 148;
  const normalPanelGap = compact ? 20 : 28;
  const earningsPanelHeightAdjustment = 8;
  const normalPanelMinHeight = Math.max(
    contentHeight - normalTopGap - summaryHeight - normalPanelGap - earningsPanelHeightAdjustment,
    0,
  );
  const focusedPanelMinHeight = Math.max(
    contentHeight - focusedTopGap - earningsPanelHeightAdjustment,
    0,
  );

  const openNetworkMenu = () => {
    if (networkLayerTimer.current) clearTimeout(networkLayerTimer.current);
    setNetworkMenuMounted(true);
    setNetworkExpanded(true);
    networkMenuTransition.stopAnimation();
    networkMenuTransition.setValue(0);
    Animated.timing(networkMenuTransition, {
      toValue: 1,
      duration: walletMetrics.networkMenuAnimationMs,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  };

  const closeNetworkMenu = () => {
    setNetworkExpanded(false);
    networkMenuTransition.stopAnimation();
    Animated.timing(networkMenuTransition, {
      toValue: 0,
      duration: walletMetrics.networkMenuAnimationMs,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
    if (networkLayerTimer.current) clearTimeout(networkLayerTimer.current);
    networkLayerTimer.current = setTimeout(() => {
      setNetworkMenuMounted(false);
      networkLayerTimer.current = null;
    }, walletMetrics.networkMenuLayerReleaseMs);
  };

  useFocusEffect(
    useCallback(() => {
      void Promise.all([refreshBalance(), refreshTransactions(), refreshWithdrawals()]);
      return () => {
        setNetworkExpanded(false);
        setNetworkMenuMounted(false);
        setFocusedWithdrawalField(null);
        setAddress("");
        setNetwork("");
        setAmount("");
        if (ownerId) void deleteWalletPayoutAccount(ownerId);
        Keyboard.dismiss();
        if (networkLayerTimer.current) clearTimeout(networkLayerTimer.current);
      };
    }, [ownerId, refreshBalance, refreshTransactions, refreshWithdrawals]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshBalance();
    });
    return () => subscription.remove();
  }, [refreshBalance]);

  useEffect(() => {
    Animated.spring(focusTransition, {
      toValue: inputFocused ? 1 : 0,
      mass: 1,
      stiffness: 342,
      damping: 33,
      useNativeDriver: false,
    }).start();
  }, [focusTransition, inputFocused]);

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
  const policy = withdrawalPolicyFor(runtime, network || undefined);
  const withdrawableCoins = wallet.balance?.withdrawable_gold_coin_balance ?? 0;
  const maximumUsdt = maximumUsdtAmount(policy, withdrawableCoins);
  const hasWithdrawable = canWithdraw(policy, withdrawableCoins);
  const selectedProductPrice = selectedProduct ? purchase.displayPrice(selectedProduct) : "";
  const purchaseTitle = purchase.isLoadingProducts
    ? t("wallet.products.loading")
    : purchase.isPurchasing
      ? t("wallet.purchase.processing")
      : t("wallet.rechargeNow", selectedProductPrice);
  const withdrawalTitle = hasWithdrawable
    ? t("wallet.withdraw")
    : t("wallet.usdt.noneWithdrawable");

  const changeTab = (next: WalletTab) => {
    const apply = () => {
      if (tab === "earnings" && next !== "earnings") resetWithdrawalForm();
      setTab(next);
    };
    setFocusedWithdrawalField(null);
    closeNetworkMenu();
    Keyboard.dismiss();
    if (inputFocused) setTimeout(apply, walletMetrics.navigationAfterKeyboardMs);
    else apply();
  };

  const resetWithdrawalForm = () => {
    setAddress("");
    setNetwork("");
    setAmount("");
    if (ownerId) void deleteWalletPayoutAccount(ownerId);
  };

  const dismissWalletInputState = () => {
    setFocusedWithdrawalField(null);
    closeNetworkMenu();
    Keyboard.dismiss();
  };

  const submitWithdrawal = async () => {
    Keyboard.dismiss();
    setFocusedWithdrawalField(null);
    closeNetworkMenu();
    const normalized = normalizeWithdrawalUsdtText(amount);
    if (!normalized) return Alert.alert(t("common.notice"), t("wallet.withdrawal.amount.invalid"));
    if (!isWalletPayoutAccountConfigured(network, address)) {
      return Alert.alert(t("common.notice"), t("wallet.usdt.invalid"));
    }
    const usdtAmount = Number(normalized);
    if (usdtAmount + 0.000_000_1 < policy.minimumUsdt) {
      return Alert.alert(
        t("common.notice"),
        t("wallet.withdrawal.minimumUSDT", policy.minimumUsdt.toFixed(2)),
      );
    }
    const units = usdtAmount / policy.stepUsdt;
    if (Math.abs(units - Math.round(units)) >= 0.000_001) {
      return Alert.alert(
        t("common.notice"),
        t("wallet.withdrawal.amount.multipleOfHalfUSDT", policy.stepUsdt.toFixed(2)),
      );
    }
    if (usdtAmount > maximumUsdt + 0.000_000_1) {
      return Alert.alert(t("common.notice"), t("wallet.withdrawal.amount.invalid"));
    }
    const goldCoinAmount = Math.min(withdrawableCoins, requiredGoldCoins(policy, usdtAmount));
    try {
      if (ownerId) await saveWalletPayoutAccount(ownerId, network, address);
      await wallet.requestWithdrawal({
        goldCoinAmount,
        usdtAmount: normalized,
        network,
        walletAddress: address.trim(),
      });
      resetWithdrawalForm();
      setToast(t("wallet.withdrawal.request.success"));
    } catch (error) {
      const localizedKey = walletWithdrawalErrorKey(error);
      Alert.alert(
        t("common.notice"),
        localizedKey
          ? t(localizedKey)
          : t("wallet.withdrawal.request.failedWithError", errorMessage(error)),
      );
    }
  };

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
            backgroundColor: inputFocused ? "rgba(255,255,255,0.96)" : "transparent",
          },
        ]}
      >
        <Pressable
          accessibilityLabel={t("common.back")}
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => {
            setFocusedWithdrawalField(null);
            closeNetworkMenu();
            Keyboard.dismiss();
            if (inputFocused)
              setTimeout(() => router.back(), walletMetrics.navigationAfterKeyboardMs);
            else router.back();
          }}
          style={styles.backButton}
        >
          <View pointerEvents="none" style={styles.backButtonFallback} />
          <SymbolView name="chevron.left" size={22} tintColor="#1A1A2E" weight="semibold" />
        </Pressable>
        <View style={styles.tabs}>
          <WalletTabButton
            active={tab === "coins"}
            title={t("wallet.myGoldCoins")}
            onPress={() => changeTab("coins")}
          />
          <WalletTabButton
            active={tab === "earnings"}
            title={t("wallet.creatorEarnings")}
            onPress={() => changeTab("earnings")}
          />
        </View>
      </View>

      {tab === "coins" ? (
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
              value={
                wallet.balance ? String(wallet.balance.gold_coin_balance) : t("common.loading")
              }
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
            <Pressable
              accessibilityLabel={`${t("wallet.terms.agreePrefix")} ${t("wallet.terms.title")}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              onPress={() => setAgreed((value) => !value)}
              style={[
                styles.termsRow,
                { marginTop: compact ? 6 : 8, paddingBottom: compact ? 2 : 4 },
              ]}
            >
              <SymbolView
                name={agreed ? "checkmark.circle.fill" : "circle"}
                size={compact ? 12 : 14}
                tintColor={agreed ? "#F0A020" : "rgba(128,128,128,0.45)"}
              />
              <Text numberOfLines={1} style={[styles.termsPrefix, { fontSize: compact ? 10 : 12 }]}>
                {t("wallet.terms.agreePrefix")}
              </Text>
              <Text numberOfLines={1} style={[styles.termsTitle, { fontSize: compact ? 10 : 12 }]}>
                {t("wallet.terms.title")}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <TouchableWithoutFeedback accessible={false} onPress={dismissWalletInputState}>
          <ScrollView
            contentContainerStyle={{ minHeight: contentHeight }}
            keyboardDismissMode="interactive"
            onScrollBeginDrag={closeNetworkMenu}
            showsVerticalScrollIndicator={false}
            style={{ width }}
          >
            <Animated.View
              style={{
                height: focusTransition.interpolate({
                  inputRange: [0, 1],
                  outputRange: [
                    normalTopGap + nativeContentOriginOffset,
                    focusedTopGap + nativeContentOriginOffset,
                  ],
                }),
              }}
            />
            <Animated.View
              pointerEvents={inputFocused ? "none" : "auto"}
              style={{
                height: focusTransition.interpolate({
                  inputRange: [0, 1],
                  outputRange: [summaryHeight + normalPanelGap, 0],
                }),
                opacity: focusTransition.interpolate({
                  inputRange: [0, 0.7, 1],
                  outputRange: [1, 0, 0],
                }),
                overflow: "hidden",
              }}
            >
              <EarningsSummary
                balance={wallet.balance}
                compact={compact}
                minimum={policy.minimumUsdt}
                usdtPerGoldCoin={policy.usdtPerGoldCoin}
                onRecords={() => router.push("/wallet-withdrawals")}
                t={t}
              />
              <View style={{ height: compact ? 20 : 28 }} />
            </Animated.View>
            <Animated.View
              style={[
                styles.topPanel,
                styles.withdrawalPanel,
                {
                  minHeight: focusTransition.interpolate({
                    inputRange: [0, 1],
                    outputRange: [normalPanelMinHeight, focusedPanelMinHeight],
                  }),
                  paddingTop: compact ? 22 : 26,
                  paddingBottom: Math.max(insets.bottom, compact ? 14 : 18),
                  rowGap: compact ? 14 : 16,
                },
              ]}
            >
              <WithdrawalField
                compact={compact}
                icon="wallet.pass"
                inputRef={addressInputRef}
                onBlur={() =>
                  setFocusedWithdrawalField((current) => (current === "address" ? null : current))
                }
                onFocus={() => {
                  setFocusedWithdrawalField("address");
                  closeNetworkMenu();
                }}
                onChangeText={setAddress}
                placeholder={t("wallet.usdt.address.placeholder")}
                title={t("wallet.usdt.address")}
                value={address}
              />
              <View style={{ zIndex: networkMenuMounted ? 5 : 0 }}>
                <Text
                  style={[
                    styles.fieldTitle,
                    styles.fieldTitlePixelAlignment,
                    {
                      fontSize: compact ? 13 : 14,
                      lineHeight: compact ? 16 : 17,
                      marginBottom: compact ? 10 : 12,
                    },
                  ]}
                >
                  {t("wallet.usdt.network")}
                </Text>
                <Pressable
                  accessibilityLabel={t("wallet.usdt.network")}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: networkExpanded }}
                  accessibilityValue={{ text: network || t("wallet.usdt.network.select") }}
                  onPress={() => {
                    Keyboard.dismiss();
                    setFocusedWithdrawalField(null);
                    if (networkExpanded) closeNetworkMenu();
                    else openNetworkMenu();
                  }}
                  style={[
                    styles.fieldBox,
                    {
                      height: compact ? 62 : 68,
                      paddingHorizontal: compact ? 15 : 16,
                      borderWidth: networkExpanded ? 1.2 : 0,
                    },
                  ]}
                >
                  <SymbolView
                    name="link"
                    size={compact ? 15 : 16}
                    tintColor="#D19A00"
                    weight="semibold"
                    style={styles.fieldIcon}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.fieldInputText,
                      {
                        color: network ? "rgba(0,0,0,0.86)" : "rgba(0,0,0,0.36)",
                        fontSize: compact ? 14 : 15,
                      },
                    ]}
                  >
                    {network || t("wallet.usdt.network.select")}
                  </Text>
                  <Animated.View
                    style={{
                      transform: [
                        {
                          rotate: networkMenuTransition.interpolate({
                            inputRange: [0, 1],
                            outputRange: ["0deg", "180deg"],
                          }),
                        },
                      ],
                    }}
                  >
                    <SymbolView
                      name="chevron.down"
                      size={13}
                      tintColor="rgba(0,0,0,0.36)"
                      weight="bold"
                    />
                  </Animated.View>
                </Pressable>
                {networkMenuMounted ? (
                  <Animated.View
                    accessibilityViewIsModal={networkExpanded}
                    style={[
                      styles.networkMenu,
                      {
                        width: compact ? 158 : 176,
                        top: compact ? 96 : 105,
                        paddingVertical: compact ? 4 : 5,
                        opacity: networkMenuTransition,
                        transformOrigin: "right top",
                        transform: [
                          {
                            scale: networkMenuTransition.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.96, 1],
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    {runtime.withdrawalNetworks.map((item, index) => (
                      <Fragment key={item.network}>
                        <Pressable
                          accessibilityLabel={item.network}
                          accessibilityRole="button"
                          accessibilityState={{ selected: network === item.network }}
                          onPress={() => {
                            setNetwork(item.network);
                            closeNetworkMenu();
                          }}
                          style={[
                            styles.networkOption,
                            {
                              height: compact ? 44 : 48,
                              backgroundColor:
                                network === item.network ? "rgba(0,0,0,0.035)" : "#FFFFFF",
                            },
                          ]}
                        >
                          <Text style={[styles.networkText, { fontSize: compact ? 14 : 15 }]}>
                            {item.network}
                          </Text>
                          {network === item.network ? (
                            <SymbolView
                              name="checkmark"
                              size={compact ? 12 : 13}
                              tintColor="rgba(0,0,0,0.78)"
                              weight="semibold"
                            />
                          ) : null}
                        </Pressable>
                        {index < runtime.withdrawalNetworks.length - 1 ? (
                          <View style={styles.networkDivider} />
                        ) : null}
                      </Fragment>
                    ))}
                  </Animated.View>
                ) : null}
              </View>
              <View>
                <Text
                  style={[
                    styles.fieldTitle,
                    styles.fieldTitlePixelAlignment,
                    {
                      fontSize: compact ? 13 : 14,
                      lineHeight: compact ? 16 : 17,
                      marginBottom: compact ? 10 : 12,
                    },
                  ]}
                >
                  {t("wallet.usdt.withdrawTitle")}
                </Text>
                <Pressable
                  accessible={false}
                  onPress={() => amountInputRef.current?.focus()}
                  style={[
                    styles.fieldBox,
                    {
                      height: compact ? 62 : 68,
                      paddingHorizontal: compact ? 15 : 16,
                      columnGap: 8,
                    },
                  ]}
                >
                  <SymbolView
                    name="dollarsign.circle.fill"
                    size={compact ? 15 : 16}
                    tintColor="#D19A00"
                    weight="semibold"
                    style={styles.fieldIcon}
                  />
                  <TextInput
                    accessibilityLabel={t("wallet.usdt.withdrawTitle")}
                    autoCapitalize="none"
                    autoCorrect={false}
                    ref={amountInputRef}
                    keyboardType="decimal-pad"
                    onBlur={() =>
                      setFocusedWithdrawalField((current) =>
                        current === "amount" ? null : current,
                      )
                    }
                    onChangeText={setAmount}
                    onFocus={() => {
                      setFocusedWithdrawalField("amount");
                      closeNetworkMenu();
                    }}
                    placeholder={
                      hasWithdrawable
                        ? t("wallet.usdt.maxWithdrawable", maximumUsdt.toFixed(2))
                        : t("wallet.withdrawal.minimumUSDT", policy.minimumUsdt.toFixed(2))
                    }
                    placeholderTextColor="rgba(0,0,0,0.36)"
                    style={[styles.fieldInput, { fontSize: compact ? 14 : 15 }]}
                    value={amount}
                  />
                  <Pressable
                    accessibilityLabel={t("wallet.usdt.withdrawAll")}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !hasWithdrawable }}
                    disabled={!hasWithdrawable}
                    onPress={() => {
                      Keyboard.dismiss();
                      setFocusedWithdrawalField(null);
                      closeNetworkMenu();
                      setAmount(maximumUsdt.toFixed(2));
                    }}
                  >
                    <Text
                      style={[
                        styles.withdrawAll,
                        {
                          width: compact ? 66 : 78,
                          fontSize: compact ? 12 : 13,
                          opacity: hasWithdrawable ? 1 : 0.45,
                        },
                      ]}
                    >
                      {t("wallet.usdt.withdrawAll")}
                    </Text>
                  </Pressable>
                </Pressable>
              </View>
              <View style={{ flexGrow: 1, minHeight: compact ? 12 : 16 }} />
              <Pressable
                accessibilityLabel={withdrawalTitle}
                accessibilityRole="button"
                accessibilityState={{
                  busy: wallet.isSubmittingWithdrawal,
                  disabled: !hasWithdrawable || wallet.isSubmittingWithdrawal,
                }}
                disabled={!hasWithdrawable || wallet.isSubmittingWithdrawal}
                onPress={() => void submitWithdrawal()}
                style={[
                  styles.primaryButton,
                  {
                    height: compact ? 42 : 52,
                    marginTop: 0,
                    backgroundColor:
                      !hasWithdrawable || wallet.isSubmittingWithdrawal ? "#FFF06B" : "#FFE500",
                  },
                ]}
              >
                {wallet.isSubmittingWithdrawal ? (
                  <ActivityIndicator color="#000000" size="small" />
                ) : null}
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.58}
                  numberOfLines={1}
                  style={[
                    styles.primaryButtonText,
                    {
                      color:
                        !hasWithdrawable || wallet.isSubmittingWithdrawal ? "#6B652D" : "#000000",
                      fontSize: compact ? 16 : 19,
                    },
                  ]}
                >
                  {withdrawalTitle}
                </Text>
              </Pressable>
            </Animated.View>
          </ScrollView>
        </TouchableWithoutFeedback>
      )}
      <TopToast message={topToast} onDismiss={() => setTopToast(null)} topInset={insets.top} />
      <CenterToast message={toast} onDismiss={() => setToast(null)} />
    </View>
  );
}

function WalletTabButton({
  active,
  onPress,
  title,
}: {
  active: boolean;
  onPress: () => void;
  title: string;
}) {
  const [intrinsicTitleWidth, setIntrinsicTitleWidth] = useState(0);
  const horizontalScale = intrinsicTitleWidth > 114 ? Math.max(0.86, 114 / intrinsicTitleWidth) : 1;
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.tabButton}
    >
      <Text
        accessible={false}
        onTextLayout={({ nativeEvent }) => {
          const measuredWidth = nativeEvent.lines[0]?.width ?? 0;
          setIntrinsicTitleWidth((currentWidth) =>
            Math.abs(currentWidth - measuredWidth) < 0.25 ? currentWidth : measuredWidth,
          );
        }}
        style={[styles.tabTitle, styles.tabTitleMeasure, { fontWeight: active ? "600" : "500" }]}
      >
        {title}
      </Text>
      <Text
        ellipsizeMode="tail"
        numberOfLines={1}
        style={[
          styles.tabTitle,
          {
            width: 114 / horizontalScale,
            transform: [{ scaleX: horizontalScale }],
            fontWeight: active ? "600" : "500",
            color: active ? "#000000" : "rgba(0,0,0,0.58)",
          },
        ]}
      >
        {title}
      </Text>
      <View
        style={[styles.tabUnderline, { backgroundColor: active ? "#000000" : "transparent" }]}
      />
    </Pressable>
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

function EarningsSummary({
  balance,
  compact,
  minimum,
  onRecords,
  t,
  usdtPerGoldCoin,
}: {
  balance: ReturnType<typeof useWallet>["balance"];
  compact: boolean;
  minimum: number;
  onRecords: () => void;
  t: ReturnType<typeof useLocalization>["t"];
  usdtPerGoldCoin: number;
}) {
  const loading = t("common.loading");
  const total = balance ? String(balance.gold_coin_balance) : loading;
  const withdrawable = balance ? String(balance.withdrawable_gold_coin_balance) : loading;
  const usdt = balance
    ? (balance.withdrawable_gold_coin_balance * usdtPerGoldCoin).toFixed(2)
    : loading;
  return (
    <View
      style={[
        styles.summary,
        {
          height: compact ? 130 : 148,
          marginHorizontal: 20,
          paddingHorizontal: compact ? 26 : 34,
          paddingTop: compact ? 17 : 21,
          paddingBottom: compact ? 9 : 11,
        },
      ]}
    >
      <View
        style={[
          styles.summaryMetrics,
          styles.summaryMetricPixelAlignment,
          { height: compact ? 60 : 68 },
        ]}
      >
        <SummaryMetric compact={compact} title={t("wallet.goldCoinBalance")} value={total} />
        <View
          style={[
            styles.summaryDivider,
            { height: compact ? 46 : 52, marginHorizontal: compact ? 6 : 8 },
          ]}
        />
        <SummaryMetric
          compact={compact}
          title={t("wallet.withdrawableBalance")}
          value={withdrawable}
        />
        <Text style={[styles.approx, { fontSize: compact ? 15 : 17, width: compact ? 22 : 26 }]}>
          ≈
        </Text>
        <SummaryMetric compact={compact} title={t("wallet.usdt.estimated")} value={usdt} />
      </View>
      <View style={{ flex: 1, minHeight: compact ? 8 : 10 }} />
      <View style={[styles.summaryRule, { marginHorizontal: compact ? 4 : 6 }]} />
      <View
        style={[
          styles.summaryFooter,
          {
            height: compact ? 28 : 31,
            paddingTop: compact ? 5 : 6,
            paddingHorizontal: compact ? 8 : 10,
          },
        ]}
      >
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          numberOfLines={1}
          style={[styles.summaryFooterText, { fontSize: compact ? 11 : 12 }]}
        >
          {t("wallet.withdrawal.minimumUSDT", minimum.toFixed(2))}
        </Text>
        <Pressable
          accessibilityLabel={t("wallet.withdrawals.title")}
          accessibilityRole="button"
          onPress={onRecords}
          style={styles.summaryDetailLink}
        >
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            numberOfLines={1}
            style={[styles.summaryFooterText, { fontSize: compact ? 11 : 12 }]}
          >
            {t("wallet.withdrawals.title")}
          </Text>
          <SymbolView
            name="chevron.right"
            size={compact ? 9 : 10}
            tintColor="rgba(0,0,0,0.42)"
            weight="semibold"
          />
        </Pressable>
      </View>
    </View>
  );
}

function SummaryMetric({
  compact,
  title,
  value,
}: {
  compact: boolean;
  title: string;
  value: string;
}) {
  return (
    <View style={[styles.summaryMetric, { rowGap: compact ? 5 : 7 }]}>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.58}
        numberOfLines={1}
        style={[styles.summaryMetricTitle, { fontSize: compact ? 11 : 12 }]}
      >
        {title}
      </Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        numberOfLines={1}
        style={[styles.summaryMetricValue, { fontSize: compact ? 23 : 27 }]}
      >
        {value}
      </Text>
    </View>
  );
}

function WithdrawalField({
  compact,
  icon,
  inputRef,
  onBlur,
  onChangeText,
  onFocus,
  placeholder,
  title,
  value,
}: {
  compact: boolean;
  icon: "wallet.pass";
  inputRef: RefObject<TextInput | null>;
  onBlur: () => void;
  onChangeText: (value: string) => void;
  onFocus: () => void;
  placeholder: string;
  title: string;
  value: string;
}) {
  return (
    <View>
      <Text
        style={[
          styles.fieldTitle,
          styles.fieldTitlePixelAlignment,
          {
            fontSize: compact ? 13 : 14,
            lineHeight: compact ? 16 : 17,
            marginBottom: compact ? 10 : 12,
          },
        ]}
      >
        {title}
      </Text>
      <Pressable
        accessible={false}
        onPress={() => inputRef.current?.focus()}
        style={[
          styles.fieldBox,
          { height: compact ? 62 : 68, paddingHorizontal: compact ? 15 : 16 },
        ]}
      >
        <SymbolView
          name={icon}
          size={compact ? 15 : 16}
          tintColor="#D19A00"
          weight="semibold"
          style={styles.fieldIcon}
        />
        <TextInput
          accessibilityLabel={title}
          autoCapitalize="none"
          autoCorrect={false}
          onBlur={onBlur}
          onChangeText={onChangeText}
          onFocus={onFocus}
          placeholder={placeholder}
          placeholderTextColor="rgba(0,0,0,0.36)"
          ref={inputRef}
          style={[styles.fieldInput, { fontSize: compact ? 14 : 15 }]}
          value={value}
        />
      </Pressable>
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "请求失败";
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
  tabs: {
    alignSelf: "center",
    width: 246,
    height: 44,
    flexDirection: "row",
    columnGap: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  tabButton: { width: 114, alignItems: "center", rowGap: 3 },
  tabTitle: { fontSize: 18, lineHeight: 22, textAlign: "center" },
  tabTitleMeasure: { position: "absolute", width: 1000, opacity: 0, textAlign: "left" },
  tabUnderline: { width: 32, height: 4 },
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
  termsPrefix: { color: "rgba(0,0,0,0.6)" },
  termsTitle: { color: "rgba(0,0,0,0.82)" },
  summary: {
    borderRadius: 30,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000000",
    shadowOpacity: 0.035,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  summaryMetrics: { flexDirection: "row", alignItems: "center" },
  summaryMetricPixelAlignment: { transform: [{ translateY: -StyleSheet.hairlineWidth }] },
  summaryMetric: { flex: 1, alignItems: "center" },
  summaryMetricTitle: { fontWeight: "600", color: "rgba(0,0,0,0.66)" },
  summaryMetricValue: { fontWeight: "700", color: "#000000", fontVariant: ["tabular-nums"] },
  summaryDivider: { width: 1, backgroundColor: "rgba(0,0,0,0.08)" },
  approx: { fontWeight: "700", color: "rgba(181,138,0,0.74)", textAlign: "center" },
  summaryRule: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(0,0,0,0.28)" },
  summaryFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  summaryDetailLink: { flexDirection: "row", alignItems: "center", columnGap: 3 },
  summaryFooterText: { fontWeight: "500", color: "rgba(0,0,0,0.42)" },
  withdrawalPanel: { alignItems: "stretch" },
  fieldTitle: { fontWeight: "600", color: "rgba(0,0,0,0.62)" },
  fieldTitlePixelAlignment: { transform: [{ translateY: -StyleSheet.hairlineWidth }] },
  fieldBox: {
    width: "100%",
    borderRadius: 18,
    borderColor: "rgba(0,0,0,0.08)",
    backgroundColor: "#F7F7F7",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
  },
  fieldIcon: { width: 22 },
  fieldInput: {
    flex: 1,
    height: "100%",
    fontWeight: "600",
    color: "rgba(0,0,0,0.86)",
    paddingVertical: 0,
  },
  fieldInputText: { flex: 1, fontWeight: "600" },
  withdrawAll: { fontWeight: "600", textAlign: "right", color: "#D19A00" },
  networkMenu: {
    position: "absolute",
    right: 0,
    zIndex: 10,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    shadowColor: "#000000",
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  networkOption: {
    paddingHorizontal: 14,
    borderColor: "rgba(0,0,0,0.18)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  networkDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  networkText: { fontWeight: "600", color: "rgba(0,0,0,0.86)" },
});
