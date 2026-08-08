import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Stack } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useMemo, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import type { ActivityCatFoodTransaction } from "@/models";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useWallet } from "@/providers/WalletProvider";
import {
  activityCatFoodTransactionPresentation,
  shouldLoadNextActivityCatFoodPage,
} from "@/services/wallet/ActivityCatFoodRepository";
import { propBagPalette } from "@/services/props/PropBagVisualPolicy";

const activityCatFoodArtwork = require("../../assets/native-original/Assets.xcassets/activity_cat_food_icon.imageset/activity_cat_food_icon.png");

type Theme = ReturnType<typeof propBagPalette>;
type Translate = (key: string, ...args: (string | number)[]) => string;

const ruleDefinitions: readonly { symbol: SFSymbol; key: string }[] = [
  { symbol: "sparkles", key: "activityCatFood.rules.officialOnly" },
  { symbol: "equal.circle.fill", key: "activityCatFood.rules.equalValue" },
  { symbol: "arrow.down.circle.fill", key: "activityCatFood.rules.priority" },
  { symbol: "gamecontroller.fill", key: "activityCatFood.rules.gameExclusion" },
  { symbol: "nosign", key: "activityCatFood.rules.restrictions" },
];

export default function ActivityCatFoodScreen() {
  const { t } = useLocalization();
  const wallet = useWallet();
  const refreshBalance = wallet.refreshBalance;
  const refreshActivityCatFoodTransactions = wallet.refreshActivityCatFoodTransactions;
  const didLoadBalanceRef = useRef(false);
  const didLoadTransactionsRef = useRef(false);
  const scrollMetricsRef = useRef({ contentHeight: 0, contentOffsetY: 0, viewportHeight: 0 });
  const theme = propBagPalette(useColorScheme());
  const styles = useMemo(() => makeStyles(theme), [theme]);

  useEffect(() => {
    if (didLoadBalanceRef.current) return;
    didLoadBalanceRef.current = true;
    void refreshBalance();
  }, [refreshBalance]);

  useEffect(() => {
    if (didLoadTransactionsRef.current || !wallet.isActivityCatFoodEnabled) return;
    didLoadTransactionsRef.current = true;
    void refreshActivityCatFoodTransactions(true);
  }, [refreshActivityCatFoodTransactions, wallet.isActivityCatFoodEnabled]);

  const refresh = () => Promise.all([
    wallet.refreshBalance(true),
    wallet.refreshActivityCatFoodTransactions(true),
  ]).then(() => undefined);
  const requestNextPageIfNeeded = () => {
    if (shouldLoadNextActivityCatFoodPage({
      ...scrollMetricsRef.current,
      hasNextPage: Boolean(wallet.activityCatFoodNextCursor),
      isLoading: wallet.isLoadingActivityCatFoodTransactions,
    })) {
      void wallet.refreshActivityCatFoodTransactions(false);
    }
  };
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    scrollMetricsRef.current = {
      contentHeight: contentSize.height,
      contentOffsetY: contentOffset.y,
      viewportHeight: layoutMeasurement.height,
    };
    requestNextPageIfNeeded();
  };
  const handleLayout = (event: LayoutChangeEvent) => {
    scrollMetricsRef.current.viewportHeight = event.nativeEvent.layout.height;
    requestNextPageIfNeeded();
  };
  const handleContentSizeChange = (_width: number, height: number) => {
    scrollMetricsRef.current.contentHeight = height;
    requestNextPageIfNeeded();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: t("activityCatFood.details.title"),
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        onContentSizeChange={handleContentSizeChange}
        onLayout={handleLayout}
        onScroll={handleScroll}
        refreshControl={(
          <RefreshControl
            refreshing={wallet.isLoadingBalance || wallet.isLoadingActivityCatFoodTransactions}
            tintColor={theme.accent}
            onRefresh={() => void refresh()}
          />
        )}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={false}
        testID="activity-cat-food-scroll"
      >
        <BalanceHeader
          balance={wallet.balance?.activity_cat_food_balance}
          loadingTitle={t("common.loading")}
          styles={styles}
          title={t("activityCatFood.balance")}
          rate={t("activityCatFood.rate")}
        />
        <RulesCard styles={styles} t={t} />
        <TransactionContent styles={styles} theme={theme} t={t} wallet={wallet} />
      </ScrollView>
    </>
  );
}

function BalanceHeader({
  balance,
  loadingTitle,
  title,
  rate,
  styles,
}: {
  balance?: number | undefined;
  loadingTitle: string;
  title: string;
  rate: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <LinearGradient colors={["#667EEA", "#8C7CF3"]} end={{ x: 1, y: 1 }} start={{ x: 0, y: 0 }} style={styles.balanceHeader}>
      <Image accessibilityIgnoresInvertColors contentFit="contain" source={activityCatFoodArtwork} style={styles.balanceArtwork} />
      <View style={styles.balanceCopy}>
        <Text allowFontScaling={false} style={styles.balanceLabel}>{title}</Text>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.balanceValue}>{balance === undefined ? loadingTitle : balance}</Text>
        <Text allowFontScaling={false} style={styles.balanceRate}>{rate}</Text>
      </View>
      <View style={styles.balanceSpacer} />
    </LinearGradient>
  );
}

function RulesCard({
  styles,
  t,
}: {
  styles: ReturnType<typeof makeStyles>;
  t: Translate;
}) {
  return (
    <View style={styles.rulesCard}>
      <Text allowFontScaling={false} style={styles.rulesTitle}>{t("activityCatFood.rules.title")}</Text>
      {ruleDefinitions.map((rule) => (
        <View key={rule.key} style={styles.ruleRow}>
          <View style={styles.ruleIcon}>
            <SymbolView name={rule.symbol} size={17} tintColor="#7667E8" />
          </View>
          <Text allowFontScaling={false} style={styles.ruleText}>{t(rule.key)}</Text>
        </View>
      ))}
    </View>
  );
}

function TransactionContent({
  styles,
  theme,
  t,
  wallet,
}: {
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
  t: Translate;
  wallet: ReturnType<typeof useWallet>;
}) {
  if (wallet.isLoadingActivityCatFoodTransactions && wallet.activityCatFoodTransactions.length === 0) {
    return <View style={styles.transactionState}><ActivityIndicator color={theme.accent} /></View>;
  }
  if (wallet.activityCatFoodTransactionError && wallet.activityCatFoodTransactions.length === 0) {
    return (
      <View style={styles.errorCard}>
        <SymbolView name="exclamationmark.triangle" size={34} tintColor={theme.warning} />
        <Text allowFontScaling={false} style={styles.errorText}>{wallet.activityCatFoodTransactionError}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void wallet.refreshActivityCatFoodTransactions(true)}
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
        >
          <Text allowFontScaling={false} style={styles.retryText}>{t("common.retry")}</Text>
        </Pressable>
      </View>
    );
  }
  if (wallet.activityCatFoodTransactions.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <Image accessibilityIgnoresInvertColors contentFit="contain" source={activityCatFoodArtwork} style={styles.emptyArtwork} />
        <Text allowFontScaling={false} style={styles.emptyText}>{t("activityCatFood.transactions.empty")}</Text>
      </View>
    );
  }
  return (
    <View style={styles.transactionSection}>
      <Text allowFontScaling={false} style={styles.transactionTitle}>{t("activityCatFood.transactions.title")}</Text>
      {wallet.activityCatFoodTransactions.map((transaction) => (
        <TransactionRow key={transaction.id} styles={styles} t={t} transaction={transaction} />
      ))}
      {wallet.isLoadingActivityCatFoodTransactions ? (
        <View style={styles.loadingFooter}><ActivityIndicator color={theme.accent} /></View>
      ) : null}
    </View>
  );
}

function TransactionRow({
  transaction,
  styles,
  t,
}: {
  transaction: ActivityCatFoodTransaction;
  styles: ReturnType<typeof makeStyles>;
  t: Translate;
}) {
  const presentation = activityCatFoodTransactionPresentation(transaction, t);
  return (
    <View
      accessible
      accessibilityLabel={`${presentation.title}, ${presentation.signedAmount}, ${t("activityCatFood.balanceAfter", transaction.balance_after)}`}
      style={styles.transactionRow}
    >
      <View style={styles.transactionArtworkFrame}>
        <Image accessibilityIgnoresInvertColors contentFit="contain" source={activityCatFoodArtwork} style={styles.transactionArtwork} />
      </View>
      <View style={styles.transactionCopy}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.rowTitle}>{presentation.title}</Text>
        {transaction.created_at?.trim() ? <Text allowFontScaling={false} numberOfLines={1} style={styles.createdAt}>{transaction.created_at}</Text> : null}
        {presentation.source ? <Text allowFontScaling={false} numberOfLines={1} style={styles.source}>{presentation.source}</Text> : null}
      </View>
      <View style={styles.amountCopy}>
        <Text allowFontScaling={false} style={[styles.amount, transaction.delta >= 0 && styles.positiveAmount]}>{presentation.signedAmount}</Text>
        <Text allowFontScaling={false} style={styles.balanceAfter}>{t("activityCatFood.balanceAfter", transaction.balance_after)}</Text>
      </View>
    </View>
  );
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    content: {
      flexGrow: 1,
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 32,
      rowGap: 14,
      backgroundColor: theme.background,
    },
    balanceHeader: {
      minHeight: 128,
      padding: 18,
      flexDirection: "row",
      alignItems: "center",
      columnGap: 16,
      borderRadius: 22,
      overflow: "hidden",
    },
    balanceArtwork: { width: 92, height: 92 },
    balanceCopy: { alignItems: "flex-start", rowGap: 5, flexShrink: 1 },
    balanceSpacer: { flex: 1 },
    balanceLabel: { color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: "600" },
    balanceValue: { color: "#FFFFFF", fontSize: 34, fontWeight: "700", fontVariant: ["tabular-nums"] },
    balanceRate: { color: "rgba(255,255,255,0.78)", fontSize: 12, fontWeight: "500" },
    rulesCard: {
      padding: 16,
      alignItems: "flex-start",
      rowGap: 12,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: theme.separator,
      backgroundColor: theme.card,
    },
    rulesTitle: { color: theme.text, fontSize: 16, fontWeight: "700" },
    ruleRow: { width: "100%", flexDirection: "row", alignItems: "center", columnGap: 8 },
    ruleIcon: { width: 19, alignItems: "center", justifyContent: "center" },
    ruleText: { flex: 1, color: theme.secondaryText, fontSize: 13, lineHeight: 18, fontWeight: "500" },
    transactionState: { minHeight: 220, alignItems: "center", justifyContent: "center" },
    errorCard: {
      minHeight: 280,
      paddingHorizontal: 28,
      alignItems: "center",
      justifyContent: "center",
      rowGap: 12,
      borderRadius: 20,
      backgroundColor: theme.card,
    },
    errorText: { color: theme.secondaryText, fontSize: 14, textAlign: "center" },
    retryButton: { minHeight: 34, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: theme.accent },
    retryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
    pressed: { opacity: 0.72 },
    emptyCard: {
      minHeight: 220,
      alignItems: "center",
      justifyContent: "center",
      rowGap: 12,
      borderRadius: 18,
      backgroundColor: theme.card,
    },
    emptyArtwork: { width: 72, height: 72 },
    emptyText: { color: theme.secondaryText, fontSize: 15, fontWeight: "600" },
    transactionSection: { alignItems: "stretch", rowGap: 10 },
    transactionTitle: { color: theme.text, fontSize: 17, fontWeight: "700" },
    transactionRow: {
      padding: 13,
      flexDirection: "row",
      alignItems: "center",
      columnGap: 12,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.separator,
      backgroundColor: theme.card,
    },
    transactionArtworkFrame: { width: 48, height: 48, padding: 5, borderRadius: 12, backgroundColor: "#EEEAFE" },
    transactionArtwork: { width: 38, height: 38 },
    transactionCopy: { flex: 1, minWidth: 0, alignItems: "flex-start", rowGap: 4 },
    rowTitle: { width: "100%", color: theme.text, fontSize: 14, fontWeight: "600" },
    createdAt: { width: "100%", color: theme.tertiaryText, fontSize: 11, fontWeight: "500" },
    source: { width: "100%", color: theme.tertiaryText, fontSize: 10, fontWeight: "500" },
    amountCopy: { minWidth: 56, alignItems: "flex-end", rowGap: 3 },
    amount: { color: theme.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"] },
    positiveAmount: { color: "#34C759" },
    balanceAfter: { color: theme.tertiaryText, fontSize: 10, fontWeight: "500" },
    loadingFooter: { paddingVertical: 8, alignItems: "center", justifyContent: "center" },
  });
}
