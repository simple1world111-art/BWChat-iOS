import { Image } from "expo-image";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";

import { nativeAssets } from "../../assets/nativeAssets";
import type { WalletTransaction, WalletWithdrawal } from "@/models";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  walletTransactionIcon,
  walletTransactionSignedAmount,
  walletTransactionSubtitleKey,
  walletTransactionTitleKey,
  formatWalletDetailedDateTime,
  walletWithdrawalCanCancel,
  walletWithdrawalDestination,
  walletWithdrawalPayoutText,
} from "@/services/wallet/walletPolicy";

export function WalletEmptyState({ title, subtitle }: { title: string; subtitle?: string | undefined }) {
  return (
    <View accessible accessibilityLabel={[title, subtitle].filter(Boolean).join(", ")} style={styles.empty}>
      <Image accessible={false} contentFit="contain" source={nativeAssets.walletEmptyCat} style={styles.emptyCat} transition={0} />
      <View style={styles.emptyCopy}>
        <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={2} style={styles.emptyTitle}>{title}</Text>
        {subtitle ? <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={2} style={styles.emptySubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function WalletTransactionRow({ transaction }: { transaction: WalletTransaction }) {
  const { t } = useLocalization();
  const colorScheme = useColorScheme();
  const signed = walletTransactionSignedAmount(transaction);
  const color = signed === undefined ? "#C4C4D4" : signed < 0 ? "#FF3B30" : "#2FAE88";
  const titleKey = walletTransactionTitleKey(transaction);
  const subtitleKey = walletTransactionSubtitleKey(transaction);
  const title = titleKey ? t(titleKey) : transaction.title?.trim() || t("wallet.transaction.balanceChange");
  const subtitle = transaction.gift_name?.trim()
    || transaction.note?.trim()
    || (subtitleKey ? t(subtitleKey) : transaction.type);
  const date = transaction.created_at ? formatWalletDetailedDateTime(transaction.created_at) : undefined;
  const amount = signed === undefined
    ? "--"
    : `${signed >= 0 ? "+" : "-"}${Math.abs(signed)} ${t("wallet.currency.goldCoins")}`;
  return (
    <View
      accessible
      accessibilityLabel={[title, subtitle, date, amount].filter(Boolean).join(", ")}
      accessibilityRole="text"
      style={[styles.row, { backgroundColor: colorScheme === "dark" ? "#000000" : "#FFFFFF" }]}
    >
      <View style={[styles.iconCircle, { backgroundColor: `${color}1F` }]}> 
        <SymbolView name={walletTransactionIcon(transaction) as SFSymbol} size={15} tintColor={color} weight="semibold" />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.rowSubtitle}>{subtitle}</Text>
        {date ? <Text style={styles.rowDate}>{date}</Text> : null}
      </View>
      <Text adjustsFontSizeToFit minimumFontScale={0.68} numberOfLines={1} style={[styles.amount, { color }]}> 
        {amount}
      </Text>
    </View>
  );
}

export function WalletWithdrawalRow({
  withdrawal,
  isSubmitting,
  onCancel,
}: {
  withdrawal: WalletWithdrawal;
  isSubmitting: boolean;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const destination = walletWithdrawalDestination(withdrawal);
  return (
    <View style={[styles.row, styles.withdrawalRow]}>
      <View style={[styles.iconCircle, styles.withdrawalIconCircle]}>
        <Image accessible={false} contentFit="contain" source={nativeAssets.walletGoldCoinBadge} style={styles.withdrawalCoin} transition={0} />
      </View>
      <View style={styles.rowCopy}>
        <Text adjustsFontSizeToFit minimumFontScale={0.68} numberOfLines={1} style={styles.rowTitle}>{t("wallet.withdrawal.amountValue", withdrawal.gold_coin_amount)}</Text>
        <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.payout}>{t("wallet.withdrawal.payoutValue", walletWithdrawalPayoutText(withdrawal))}</Text>
        {destination ? <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.destination}>{destination}</Text> : null}
        <View style={styles.statusLine}>
          <Text style={styles.rowSubtitle}>{withdrawalStatus(withdrawal.status, t)}</Text>
          {withdrawal.created_at ? <Text style={styles.rowDate}>{formatWalletDetailedDateTime(withdrawal.created_at)}</Text> : null}
        </View>
        {withdrawal.note?.trim() ? <Text numberOfLines={1} style={styles.rowDate}>{withdrawal.note}</Text> : null}
      </View>
      {walletWithdrawalCanCancel(withdrawal) ? (
        <Pressable
          accessibilityLabel={`${t("wallet.withdrawal.cancel")}, ${t("wallet.withdrawal.amountValue", withdrawal.gold_coin_amount)}`}
          accessibilityRole="button"
          accessibilityState={{ busy: isSubmitting, disabled: isSubmitting }}
          disabled={isSubmitting}
          onPress={onCancel}
          style={styles.cancelButton}
          testID={`wallet-withdrawal-cancel-${withdrawal.id}`}
        >
          <Text style={styles.cancelText}>{t("wallet.withdrawal.cancel")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function withdrawalStatus(
  status: string,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const normalized = status.toLocaleLowerCase();
  if (["pending", "requested"].includes(normalized)) return t("wallet.withdrawal.status.pending");
  if (["reviewing", "processing"].includes(normalized)) return t("wallet.withdrawal.status.processing");
  if (["paid", "completed", "success", "succeeded"].includes(normalized)) return t("wallet.withdrawal.status.completed");
  if (["cancelled", "canceled"].includes(normalized)) return t("wallet.withdrawal.status.cancelled");
  if (["rejected", "failed"].includes(normalized)) return t("wallet.withdrawal.status.rejected");
  return status;
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: "center", justifyContent: "center", rowGap: 18, paddingHorizontal: 24, transform: [{ translateY: -19 }] },
  emptyCat: { width: 154, height: 142 },
  emptyCopy: { alignItems: "center", rowGap: 8, transform: [{ translateY: 5 / 3 }] },
  emptyTitle: { fontSize: 20, fontWeight: "600", color: "#000000", textAlign: "center" },
  emptySubtitle: { fontSize: 16, color: "rgba(0,0,0,0.42)", textAlign: "center" },
  row: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", columnGap: 10 },
  withdrawalRow: { backgroundColor: "#FFF8DE" },
  iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  withdrawalIconCircle: { backgroundColor: "rgba(255,213,74,0.18)" },
  withdrawalCoin: { width: 24, height: 24 },
  rowCopy: { flex: 1, alignItems: "flex-start", rowGap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: "#1A1A2E" },
  rowSubtitle: { fontSize: 12, color: "#9E9EB8" },
  rowDate: { fontSize: 11, color: "#C4C4D4" },
  amount: { maxWidth: "38%", fontSize: 15, fontWeight: "700" },
  payout: { fontSize: 12, fontWeight: "500", color: "#A76500" },
  destination: { fontSize: 11, fontWeight: "500", color: "#9E9EB8" },
  statusLine: { flexDirection: "row", alignItems: "center", columnGap: 6 },
  cancelButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: "#FFF4C9" },
  cancelText: { fontSize: 12, fontWeight: "600", color: "#C98300" },
});
