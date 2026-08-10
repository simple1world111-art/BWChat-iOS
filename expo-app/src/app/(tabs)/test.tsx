import { router, type Href } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";

import { RootTabTitle } from "@/components/RootTabTitle";
import { useLocalization } from "@/providers/LocalizationProvider";
import { palette } from "@/theme";

export default function TestScreen() {
  const { t } = useLocalization();
  const theme = palette(useColorScheme());

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: theme.background }}
    >
      <View style={styles.header}>
        <RootTabTitle localizedKey="tab.test" />
      </View>

      <Pressable
        accessibilityLabel={t("test.card.title")}
        accessibilityRole="button"
        onPress={() => router.push("/test-card" as Href)}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: theme.card },
          pressed && styles.pressed,
        ]}
        testID="test-card-entry"
      >
        <View style={[styles.iconBox, { backgroundColor: theme.accentSoft }]}>
          <SymbolView
            accessibilityElementsHidden
            accessible={false}
            name={{
              ios: "checkmark.rectangle.stack.fill",
              android: "fact_check",
              web: "fact_check",
            }}
            size={24}
            tintColor={theme.accent}
          />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: theme.text }]}>{t("test.card.title")}</Text>
          <Text numberOfLines={2} style={[styles.subtitle, { color: theme.secondaryText }]}>
            {t("test.card.subtitle")}
          </Text>
        </View>
        <SymbolView
          accessibilityElementsHidden
          accessible={false}
          name="chevron.right"
          size={14}
          weight="semibold"
          tintColor={theme.tertiaryText}
        />
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 24 },
  header: { minHeight: 38, paddingBottom: 2, justifyContent: "center" },
  card: {
    minHeight: 82,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 14,
  },
  pressed: { opacity: 0.65 },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, rowGap: 4 },
  title: { fontSize: 17, fontWeight: "600" },
  subtitle: { fontSize: 13, lineHeight: 18 },
});
