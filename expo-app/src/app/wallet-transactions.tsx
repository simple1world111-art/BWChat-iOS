import { router, Stack, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WalletEmptyState, WalletTransactionRow } from "@/components/wallet/WalletRecords";
import type { WalletTransaction } from "@/models";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useWallet } from "@/providers/WalletProvider";
import { walletTransactionSignedAmount } from "@/services/wallet/walletPolicy";
import { walletVisualAcceptanceVariant } from "@/services/visualAcceptance";

type RecordTab = "income" | "expense";

export default function WalletTransactionsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLocalization();
  const wallet = useWallet();
  const { refreshTransactions } = wallet;
  const [tab, setTab] = useState<RecordTab>(
    walletVisualAcceptanceVariant === "wallet-transactions-expense-rows" ? "expense" : "income",
  );
  useFocusEffect(
    useCallback(() => {
      void refreshTransactions();
    }, [refreshTransactions]),
  );
  const transactions = useMemo(
    () =>
      wallet.transactions.filter((item) => {
        const amount = walletTransactionSignedAmount(item) ?? 0;
        return tab === "income" ? amount > 0 : amount < 0;
      }),
    [tab, wallet.transactions],
  );
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Pressable
          accessibilityLabel={t("common.back")}
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => router.back()}
          style={styles.headerSide}
        >
          <View style={styles.backGlyph}>
            <SymbolView name="chevron.left" size={17} tintColor="#000000" weight="semibold" />
          </View>
        </Pressable>
        <View style={styles.recordTabs}>
          <RecordTabButton
            active={tab === "income"}
            testID="wallet-record-tab-income"
            title={t("wallet.records.income")}
            onPress={() => setTab("income")}
          />
          <RecordTabButton
            active={tab === "expense"}
            testID="wallet-record-tab-expense"
            title={t("wallet.records.expense")}
            onPress={() => setTab("expense")}
          />
        </View>
        <View style={styles.headerSide} />
      </View>
      {wallet.isLoadingTransactions && wallet.transactions.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel={t("common.loading")} color="#667EEA" />
        </View>
      ) : wallet.transactionError &&
        wallet.transactions.length === 0 &&
        !wallet.transactionNextCursor ? (
        <WalletEmptyState title={wallet.transactionError} />
      ) : transactions.length === 0 && !wallet.transactionNextCursor ? (
        <WalletEmptyState title={t("wallet.records.empty")} />
      ) : (
        <FlatList<WalletTransaction>
          contentContainerStyle={styles.list}
          data={transactions}
          keyExtractor={(item) => item.id}
          ListFooterComponent={
            wallet.transactionNextCursor ? (
              <PaginationFooter
                cursor={wallet.transactionNextCursor}
                error={wallet.transactionError}
                loading={wallet.isLoadingTransactions}
                retry={wallet.loadMoreTransactions}
                t={t}
              />
            ) : null
          }
          onEndReached={() => {
            if (wallet.transactionNextCursor) void wallet.loadMoreTransactions();
          }}
          onEndReachedThreshold={0.6}
          refreshControl={
            <RefreshControl
              accessibilityLabel={t("common.loading")}
              refreshing={wallet.isLoadingTransactions && wallet.transactions.length > 0}
              onRefresh={() => void wallet.refreshTransactions(true)}
              tintColor="#667EEA"
            />
          }
          renderItem={({ item }) => <WalletTransactionRow transaction={item} />}
          style={styles.listBackground}
        />
      )}
    </View>
  );
}

function RecordTabButton({
  active,
  onPress,
  testID,
  title,
}: {
  active: boolean;
  onPress: () => void;
  testID: string;
  title: string;
}) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.recordTab}
      testID={testID}
    >
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.78}
        numberOfLines={1}
        style={[
          styles.recordTabText,
          { color: active ? "#000000" : "rgba(0,0,0,0.56)", fontWeight: active ? "600" : "400" },
        ]}
      >
        {title}
      </Text>
      <View
        style={[styles.recordUnderline, { backgroundColor: active ? "#000000" : "transparent" }]}
      />
    </Pressable>
  );
}

function PaginationFooter({
  cursor,
  error,
  loading,
  retry,
  t,
}: {
  cursor: string;
  error: string | null;
  loading: boolean;
  retry: () => Promise<void>;
  t: (key: string, ...args: (string | number)[]) => string;
}) {
  useEffect(() => {
    if (!error && !loading) void retry();
  }, [cursor, error, loading, retry]);
  if (error)
    return (
      <View style={styles.footer}>
        <Text style={styles.footerError}>{error}</Text>
        <Pressable
          accessibilityLabel={t("common.retry")}
          accessibilityRole="button"
          onPress={() => void retry()}
        >
          <Text style={styles.retry}>{t("common.retry")}</Text>
        </Pressable>
      </View>
    );
  return loading ? (
    <ActivityIndicator
      accessibilityLabel={t("common.loading")}
      color="#667EEA"
      style={styles.footer}
    />
  ) : null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  header: {
    paddingHorizontal: 14,
    paddingBottom: 18,
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FFFFFF",
  },
  headerSide: { width: 78, height: 36, alignItems: "flex-start", justifyContent: "center" },
  backGlyph: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateX: -2 / 3 }],
  },
  recordTabs: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    columnGap: 48,
    transform: [{ translateY: 5 / 3 }],
  },
  recordTab: { alignItems: "center", rowGap: 28 / 3 },
  recordTabText: { fontSize: 20 },
  recordUnderline: { width: 31, height: 3 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listBackground: { flex: 1, backgroundColor: "#F7F7F7" },
  list: { paddingHorizontal: 16, paddingVertical: 12, rowGap: 8 },
  footer: { paddingVertical: 12, alignItems: "center", rowGap: 8 },
  footerError: { fontSize: 13, color: "#9E9EB8", textAlign: "center" },
  retry: { fontSize: 14, fontWeight: "600", color: "#667EEA" },
});
