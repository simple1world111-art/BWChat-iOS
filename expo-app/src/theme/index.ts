import type { ColorSchemeName } from "react-native";

export const colors = {
  accent: "#667EEA",
  accentDark: "#764BA2",
  accentSoft: "#EEF0FF",
  background: "#F2F2F7",
  card: "#FFFFFF",
  text: "#1A1A2E",
  secondaryText: "#9E9EB8",
  tertiaryText: "#C4C4D4",
  separator: "#F0F0F5",
  danger: "#FF3B30",
  success: "#34C759",
  warning: "#FF9500",
  white: "#FFFFFF",
  black: "#111111",
} as const;

export const darkColors = {
  ...colors,
  background: "#101014",
  card: "#1B1B22",
  text: "#F7F7FA",
  secondaryText: "#A7A7B5",
  separator: "#30303A",
  accentSoft: "#272640",
} as const;

export function palette(scheme: ColorSchemeName) {
  return scheme === "dark" ? darkColors : colors;
}

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 24, round: 999 } as const;
