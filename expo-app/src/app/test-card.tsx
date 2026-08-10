import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, useColorScheme, View } from "react-native";

import { useLocalization } from "@/providers/LocalizationProvider";
import { palette } from "@/theme";

export default function TestCardScreen() {
  const { t } = useLocalization();
  const theme = palette(useColorScheme());

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: t("test.card.title") }} />
      <View style={[styles.card, { backgroundColor: theme.card }]}>
        <View style={[styles.iconBox, { backgroundColor: theme.accentSoft }]}>
          <SymbolView
            accessibilityElementsHidden
            accessible={false}
            name={{ ios: "checkmark.seal.fill", android: "verified", web: "verified" }}
            size={42}
            tintColor={theme.accent}
          />
        </View>
        <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
          <Text style={[styles.badgeText, { color: theme.accent }]}>iOS Preview</Text>
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{t("test.card.title")}</Text>
        <Text style={[styles.subtitle, { color: theme.secondaryText }]}>
          {t("test.card.subtitle")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, justifyContent: "center" },
  card: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 36,
    borderRadius: 24,
    rowGap: 12,
  },
  iconBox: {
    width: 76,
    height: 76,
    marginBottom: 4,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: "700" },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: 15, lineHeight: 22, textAlign: "center" },
});
