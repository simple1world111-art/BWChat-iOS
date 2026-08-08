import type { ColorSchemeName } from "react-native";

export const propBagMetrics = {
  horizontalInset: 16,
  topInset: 18,
  bottomInset: 32,
  contentGap: 16,
  gridColumns: 3,
  gridGap: 10,
  artworkSize: 92,
  innerMinimumHeight: 170,
  cardHorizontalInset: 8,
  cardTopInset: 10,
  cardBottomInset: 8,
  cardRadius: 16,
  quantityHeight: 24,
  quantityHorizontalInset: 7,
  primaryStateHeight: 280,
  detailContentGap: 14,
  detailHeaderRadius: 22,
  transactionStateHeight: 220,
  transactionPageSize: 20,
} as const;

export function propBagPalette(scheme: ColorSchemeName) {
  const dark = scheme === "dark";
  return {
    background: dark ? "#1C1C1E" : "#F2F2F7",
    card: dark ? "#000000" : "#FFFFFF",
    text: "#1A1A2E",
    secondaryText: "#9E9EB8",
    tertiaryText: "#C4C4D4",
    separator: "#F0F0F5",
    accent: "#667EEA",
    accentSoft: "rgba(102,126,234,0.12)",
    warning: "#FF9500",
  } as const;
}
