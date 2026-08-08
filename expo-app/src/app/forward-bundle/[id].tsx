import { SymbolView } from "expo-symbols";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { getForwardBundle } from "@/api/bwchat";
import type { ForwardBundle } from "@/models";
import { useLocalization } from "@/providers/LocalizationProvider";
import { colors } from "@/theme";

export default function ForwardBundleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { t } = useLocalization();
  const [bundle, setBundle] = useState<ForwardBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);

  useLayoutEffect(() => {
    if (bundle?.title) navigation.setOptions({ title: bundle.title });
  }, [bundle?.title, navigation]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      setBundle(null);
      setError(null);
      void getForwardBundle(id).then((nextBundle) => {
        if (!cancelled) setBundle(nextBundle);
      }).catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : t("common.loadFailed"));
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [id, loadRevision, t]);

  if (error) {
    return (
      <View style={styles.centerState}>
        <SymbolView name="exclamationmark.triangle" size={34} tintColor={colors.tertiaryText} />
        <Text style={styles.stateTitle}>{t("common.loadFailed")}</Text>
        <Text style={styles.stateMessage}>{error}</Text>
        <Pressable onPress={() => setLoadRevision((value) => value + 1)} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>{t("common.retry")}</Text>
        </Pressable>
      </View>
    );
  }
  if (!bundle) return <View style={styles.centerState}><ActivityIndicator color={colors.accent} /></View>;
  return (
    <FlatList
      data={bundle.items}
      keyExtractor={(item) => String(item.ordinal)}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={styles.headerRow}>
            <Text style={styles.sender}>{item.sender_name}</Text>
            <Text style={styles.time}>{formatForwardTime(item.sent_at)}</Text>
          </View>
          <Text style={styles.summary}>{item.message_type === "voice" ? t("message.voice") : item.summary}</Text>
        </View>
      )}
      style={styles.list}
    />
  );
}

function formatForwardTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  row: { paddingHorizontal: 16, paddingVertical: 12, rowGap: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, backgroundColor: colors.card },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sender: { color: colors.text, fontSize: 14, fontWeight: "600" },
  time: { color: colors.tertiaryText, fontSize: 12 },
  summary: { color: colors.text, fontSize: 15 },
  centerState: { flex: 1, padding: 24, alignItems: "center", justifyContent: "center", rowGap: 12, backgroundColor: colors.background },
  stateTitle: { color: colors.text, fontSize: 17, fontWeight: "600" },
  stateMessage: { color: colors.secondaryText, fontSize: 14, textAlign: "center" },
  retryButton: { minHeight: 36, paddingHorizontal: 16, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  retryButtonText: { color: colors.white, fontSize: 14, fontWeight: "600" },
});
