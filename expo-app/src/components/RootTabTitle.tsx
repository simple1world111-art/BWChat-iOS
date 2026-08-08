import type { StyleProp, TextStyle } from "react-native";
import { StyleSheet, Text, useColorScheme } from "react-native";

import { useLocalization } from "@/providers/LocalizationProvider";
import { palette } from "@/theme";

type RootTabTitleProps =
  | { localizedKey: string; title?: never; style?: StyleProp<TextStyle> }
  | { localizedKey?: never; title: string; style?: StyleProp<TextStyle> };

/** Mirrors BWChat/Components/RootTabTitle.swift. */
export function RootTabTitle({ localizedKey, title, style }: RootTabTitleProps) {
  const { t } = useLocalization();
  const theme = palette(useColorScheme());
  const resolvedTitle = localizedKey ? t(localizedKey) : title;

  return (
    <Text
      accessibilityRole="header"
      adjustsFontSizeToFit
      minimumFontScale={0.78}
      numberOfLines={1}
      style={[styles.title, { color: theme.text }, style]}
    >
      {resolvedTitle}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    minHeight: 28,
    paddingLeft: 8,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600",
    textAlignVertical: "center",
  },
});
