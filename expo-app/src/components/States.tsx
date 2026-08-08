import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

import { useLocalization } from "@/providers/LocalizationProvider";
import { palette, radius, spacing } from "@/theme";

export function LoadingState({ label }: { label?: string }) {
  const { t } = useLocalization();
  const theme = palette(useColorScheme());
  return (
    <View style={[styles.loading, { backgroundColor: withAlpha(theme.background, 0.8) }]}>
      <ActivityIndicator color={theme.accent} />
      <Text style={[styles.loadingMessage, { color: theme.secondaryText }]}>
        {label ?? t("common.loading")}
      </Text>
    </View>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  const theme = palette(useColorScheme());
  return (
    <View style={styles.center}>
      <Text style={styles.emoji}>🐾</Text>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      {detail ? (
        <Text style={[styles.message, { color: theme.secondaryText }]}>{detail}</Text>
      ) : null}
    </View>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  const theme = palette(useColorScheme());
  return (
    <View style={styles.center}>
      <Text style={styles.emoji}>😿</Text>
      <Text style={[styles.title, { color: theme.text }]}>加载失败</Text>
      <Text style={[styles.message, { color: theme.secondaryText }]}>{message}</Text>
      {retry ? (
        <Pressable style={[styles.button, { backgroundColor: theme.accent }]} onPress={retry}>
          <Text style={styles.buttonText}>重试</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center", rowGap: 12 },
  loadingMessage: { fontSize: 12, lineHeight: 15 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  emoji: { fontSize: 44 },
  title: { fontSize: 19, fontWeight: "700" },
  message: { textAlign: "center", lineHeight: 21 },
  button: {
    marginTop: spacing.sm,
    borderRadius: radius.round,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  buttonText: { color: "white", fontWeight: "700" },
});

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/iu.test(normalized)) return hex;
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red},${green},${blue},${alpha})`;
}
