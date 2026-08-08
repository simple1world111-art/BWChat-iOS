import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ProfileGroupedCard, ProfileRowDivider } from "@/components/profile/ProfileSettingsChrome";
import { languageOptions, useLocalization } from "@/providers/LocalizationProvider";
import { languageSettingsPolicy } from "@/services/localization/languageSettingsPolicy";
import { colors } from "@/theme";

export default function LanguageSettingsScreen() {
  const { selectedLanguage, setLanguage, t } = useLocalization();
  return (
    <>
      <Stack.Screen options={{ title: t("language.title") }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ProfileGroupedCard>
          {languageOptions.map((language, index) => (
            <View key={language.id}>
              <LanguageRow
                nativeName={
                  language.id === "system" ? t("language.option.system") : language.nativeName
                }
                isSelected={selectedLanguage === language.id}
                onPress={() => void setLanguage(language.id)}
              />
              {index < languageOptions.length - 1 ? <ProfileRowDivider /> : null}
            </View>
          ))}
        </ProfileGroupedCard>
      </ScrollView>
    </>
  );
}

function LanguageRow({
  nativeName,
  isSelected,
  onPress,
}: {
  nativeName: string;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={nativeName}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
    >
      <View style={[styles.icon, isSelected ? styles.iconSelected : styles.iconIdle]}>
        <SymbolView
          name="character.bubble.fill"
          size={languageSettingsPolicy.symbolSize}
          weight="semibold"
          tintColor={isSelected ? colors.accent : colors.tertiaryText}
        />
      </View>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={languageSettingsPolicy.titleMinimumScale}
        numberOfLines={1}
        style={styles.title}
      >
        {nativeName}
      </Text>
      {isSelected ? (
        <SymbolView
          name="checkmark.circle.fill"
          size={languageSettingsPolicy.checkmarkSize}
          weight="semibold"
          tintColor={colors.accent}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: languageSettingsPolicy.horizontalPadding,
    paddingTop: languageSettingsPolicy.topPadding,
    paddingBottom: languageSettingsPolicy.bottomPadding,
    backgroundColor: colors.background,
  },
  row: {
    minHeight: languageSettingsPolicy.rowMinimumHeight,
    paddingVertical: languageSettingsPolicy.rowVerticalPadding,
    flexDirection: "row",
    alignItems: "center",
    columnGap: languageSettingsPolicy.rowSpacing,
  },
  pressed: { opacity: 0.72 },
  icon: {
    width: languageSettingsPolicy.iconSize,
    height: languageSettingsPolicy.iconSize,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: languageSettingsPolicy.iconRadius,
  },
  iconSelected: {
    backgroundColor: `rgba(102,126,234,${languageSettingsPolicy.selectedIconOpacity})`,
  },
  iconIdle: { backgroundColor: `rgba(102,126,234,${languageSettingsPolicy.idleIconOpacity})` },
  title: {
    flex: 1,
    minWidth: languageSettingsPolicy.trailingMinimumSpacing,
    color: colors.text,
    fontSize: languageSettingsPolicy.titleSize,
    fontWeight: "600",
  },
});
