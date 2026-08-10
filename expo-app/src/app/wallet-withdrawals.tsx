import { router, Stack, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WalletEmptyState, WalletWithdrawalRow } from "@/components/wallet/WalletRecords";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";
import type { WalletWithdrawal } from "@/models";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useWallet } from "@/providers/WalletProvider";
import { walletWithdrawalErrorKey } from "@/services/wallet/walletPolicy";

export default function WalletWithdrawalsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLocalization();
  const wallet = useWallet();
  const { refreshWithdrawals } = wallet;
  useFocusEffect(useCallback(() => { void refreshWithdrawals(); }, [refreshWithdrawals]));
  const cancel = async (withdrawal: WalletWithdrawal) => {
    try {
      await wallet.cancelWithdrawal(withdrawal.id);
    } catch (error) {
      const localizedKey = walletWithdrawalErrorKey(error);
      Alert.alert(
        t("common.notice"),
        localizedKey
          ? t(localizedKey)
          : t("wallet.withdrawal.cancel.failedWithError", error instanceof Error ? error.message : t("wallet.withdrawal.cancel.failed")),
      );
    }
  };
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}> 
        <Pressable accessibilityLabel={t("common.back")} accessibilityRole="button" hitSlop={12} onPress={() => router.back()} style={styles.headerSide}>
          <View style={styles.backGlyph}>
            <SymbolView name="chevron.left" size={17} tintColor="#000000" weight="semibold" />
          </View>
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>{t("wallet.withdrawals.title")}</Text>
        <View style={styles.headerSide} />
      </View>
      {wallet.isLoadingWithdrawals && wallet.withdrawals.length === 0 ? (
        <View style={styles.center}><ActivityIndicator accessibilityLabel={t("common.loading")} color="#667EEA" /></View>
      ) : wallet.withdrawalError && wallet.withdrawals.length === 0 ? (
        <WalletEmptyState title={wallet.withdrawalError} />
      ) : wallet.withdrawals.length === 0 ? (
        <WalletEmptyState title={t("wallet.withdrawals.empty")} />
      ) : (
        <FlatList<WalletWithdrawal>
          contentContainerStyle={styles.list}
          data={wallet.withdrawals}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl accessibilityLabel={t("common.loading")} refreshing={wallet.isLoadingWithdrawals && wallet.withdrawals.length > 0} onRefresh={() => void wallet.refreshWithdrawals(true)} tintColor="#667EEA" />}
          renderItem={({ item }) => <WalletWithdrawalRow isSubmitting={wallet.isSubmittingWithdrawal} onCancel={() => void cancel(item)} withdrawal={item} />}
          style={styles.listBackground}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FFFFFF" },
  header: { paddingHorizontal: 14, paddingBottom: 18, flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF" },
  headerSide: { width: 78, height: 36, alignItems: "flex-start", justifyContent: "center" },
  backGlyph: { width: 36, height: 36, alignItems: "center", justifyContent: "center", transform: [{ translateX: -2 / 3 }] },
  title: { flex: 1, fontSize: 20, fontWeight: "600", color: "#000000", textAlign: "center", transform: [{ translateY: -StyleSheet.hairlineWidth }] },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listBackground: { flex: 1, backgroundColor: "#F7F7F7" },
  list: { paddingHorizontal: 16, paddingVertical: 12, rowGap: 8 },
});
