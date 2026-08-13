import { Image } from "expo-image";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { StyleSheet, Text, useColorScheme, View } from "react-native";

import { nativeAssets } from "../../assets/nativeAssets";
import type { WalletTransaction } from "@/models";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  walletTransactionIcon,
  walletTransactionSignedAmount,
  walletTransactionSubtitleKey,
  walletTransactionTitleKey,
  formatWalletDetailedDateTime,
} from "@/services/wallet/walletPolicy";

export function WalletEmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string | undefined;
}) {
  return (
    <View
      accessible
      accessibilityLabel={[title, subtitle].filter(Boolean).join(", ")}
      style={styles.empty}
    >
      <Image
        accessible={false}
        contentFit="contain"
        source={nativeAssets.walletEmptyCat}
        style={styles.emptyCat}
        transition={0}
      />
      <View style={styles.emptyCopy}>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          numberOfLines={2}
          style={styles.emptyTitle}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            numberOfLines={2}
            style={styles.emptySubtitle}
          >
            {subtitle}
          </Text>
        ) : null}
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
  const title = titleKey
    ? t(titleKey)
    : transaction.title?.trim() || t("wallet.transaction.balanceChange");
  const subtitle =
    transaction.gift_name?.trim() ||
    transaction.note?.trim() ||
    (subtitleKey ? t(subtitleKey) : transaction.type);
  const date = transaction.created_at
    ? formatWalletDetailedDateTime(transaction.created_at)
    : undefined;
  const amount =
    signed === undefined
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
        <SymbolView
          name={walletTransactionIcon(transaction) as SFSymbol}
          size={15}
          tintColor={color}
          weight="semibold"
        />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.rowSubtitle}>
          {subtitle}
        </Text>
        {date ? <Text style={styles.rowDate}>{date}</Text> : null}
      </View>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.68}
        numberOfLines={1}
        style={[styles.amount, { color }]}
      >
        {amount}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    rowGap: 18,
    paddingHorizontal: 24,
    transform: [{ translateY: -19 }],
  },
  emptyCat: { width: 154, height: 142 },
  emptyCopy: { alignItems: "center", rowGap: 8, transform: [{ translateY: 5 / 3 }] },
  emptyTitle: { fontSize: 20, fontWeight: "600", color: "#000000", textAlign: "center" },
  emptySubtitle: { fontSize: 16, color: "rgba(0,0,0,0.42)", textAlign: "center" },
  row: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: { flex: 1, alignItems: "flex-start", rowGap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: "#1A1A2E" },
  rowSubtitle: { fontSize: 12, color: "#9E9EB8" },
  rowDate: { fontSize: 11, color: "#C4C4D4" },
  amount: { maxWidth: "38%", fontSize: 15, fontWeight: "700" },
});
