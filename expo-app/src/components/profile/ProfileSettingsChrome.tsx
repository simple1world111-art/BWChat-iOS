import { LinearGradient } from "expo-linear-gradient";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme";

export function ProfileGroupedCard({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function ProfileRowDivider() {
  return <View style={styles.divider} />;
}

/** Form fields do not have a leading icon, so their separator must not inherit the row inset. */
export function ProfileFieldDivider() {
  return <View style={styles.fieldDivider} testID="profile-field-divider" />;
}

export function ProfileNoticeBanner({ message }: { message: string }) {
  return (
    <View style={styles.notice}>
      <SymbolView
        name="exclamationmark.circle.fill"
        size={15}
        weight="semibold"
        tintColor="#8A4B00"
      />
      <Text numberOfLines={2} style={styles.noticeText}>
        {message}
      </Text>
    </View>
  );
}

export function ProfileSettingsRow({
  title,
  subtitle,
  trailingText,
  systemImage,
  gradient,
  danger = false,
  showChevron = true,
  disabled = false,
  onPress,
}: {
  title: string;
  subtitle?: string | undefined;
  trailingText?: string | undefined;
  systemImage: SFSymbol;
  gradient: [string, string];
  danger?: boolean | undefined;
  showChevron?: boolean | undefined;
  disabled?: boolean | undefined;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={({ pressed }) => [styles.row, disabled && styles.disabled, pressed && styles.pressed]}
      onPress={onPress}
    >
      {danger ? (
        <View style={styles.dangerIcon}>
          <SymbolView name={systemImage} size={17} weight="semibold" tintColor={colors.danger} />
        </View>
      ) : (
        <LinearGradient colors={gradient} style={styles.icon}>
          <SymbolView name={systemImage} size={17} weight="semibold" tintColor="#FFFFFF" />
        </LinearGradient>
      )}
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, danger && styles.dangerTitle]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailingText || showChevron ? (
        <View style={styles.trailing}>
          {trailingText ? (
            <Text numberOfLines={1} style={styles.trailingText}>
              {trailingText}
            </Text>
          ) : null}
          {showChevron ? (
            <SymbolView
              name="chevron.right"
              size={13}
              weight="bold"
              tintColor={colors.tertiaryText}
            />
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(240,240,245,0.7)",
    backgroundColor: colors.card,
  },
  row: {
    minHeight: 50,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 13,
  },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
  icon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  dangerIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "rgba(255,59,48,0.12)",
  },
  copy: { flex: 1, alignItems: "flex-start", rowGap: 3 },
  title: { color: colors.text, fontSize: 16, fontWeight: "600" },
  dangerTitle: { color: colors.danger },
  subtitle: { color: colors.secondaryText, fontSize: 12, fontWeight: "500" },
  trailing: { maxWidth: "48%", flexDirection: "row", alignItems: "center", columnGap: 5 },
  trailingText: { flexShrink: 1, color: colors.secondaryText, fontSize: 13, fontWeight: "600" },
  divider: {
    height: 21,
    marginLeft: 55,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  fieldDivider: {
    alignSelf: "stretch",
    height: 21,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  notice: {
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
    borderRadius: 16,
    backgroundColor: "#FFF2CC",
  },
  noticeText: { flex: 1, color: "#8A4B00", fontSize: 13, lineHeight: 18, fontWeight: "500" },
});
