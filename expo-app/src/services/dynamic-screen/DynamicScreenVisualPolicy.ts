import type { ColorSchemeName } from "react-native";

import { colors } from "@/theme";

export const dynamicScreenVisualPolicy = {
  contentHorizontalPadding: 16,
  contentTopPadding: 16,
  contentBottomPadding: 24,
  componentSpacing: 12,
  childSpacing: 10,
  cardCornerRadius: 14,
  rowIconSize: 40,
  rowHorizontalPadding: 16,
  rowVerticalPadding: 13,
  bannerIconSize: 48,
  bannerPadding: 16,
  imageDefaultHeight: 160,
  buttonHeight: 46,
  walletIconSize: 42,
  giftIconSize: 42,
  agentAvatarSize: 42,
} as const;

export const dynamicScreenBannerGradient = ["#FFF4C9", "#E9F8FF"] as const;

export function dynamicScreenPalette(scheme: ColorSchemeName) {
  return {
    ...colors,
    background: scheme === "dark" ? "#1C1C1E" : "#F2F2F7",
    card: scheme === "dark" ? "#000000" : "#FFFFFF",
  } as const;
}
