import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { useLocalization } from "@/providers/LocalizationProvider";
import { copySupportEmail, openSupportEmail } from "@/services/account/SupportEmailService";
import { useConfiguredSupportEmail } from "@/services/account/useConfiguredSupportEmail";
import { colors } from "@/theme";

export default function AccountDeletionAcceptedScreen() {
  const params = useLocalSearchParams<{
    requestId?: string;
    purgeBy?: string;
  }>();
  const { activeLanguage, t } = useLocalization();
  const { supportEmail } = useConfiguredSupportEmail();
  const requestId = firstParam(params.requestId);
  const purgeBy = firstParam(params.purgeBy);

  const contactSupport = async () => {
    if (!supportEmail) {
      Alert.alert(t("common.notice"), t("account.support.unavailable"));
      return;
    }
    if (await openSupportEmail(supportEmail)) return;
    Alert.alert(t("account.support.openFailed.title"), t("account.support.openFailed.message"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("account.support.copy"), onPress: () => void copySupportEmail(supportEmail) },
    ]);
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.icon}>
        <SymbolView name="checkmark.circle.fill" size={72} tintColor={colors.success} />
      </View>
      <Text style={styles.title}>{t("account.deletion.accepted.title")}</Text>
      <Text style={styles.message}>{t("account.deletion.accepted.message")}</Text>
      <View style={styles.receipt}>
        <ReceiptRow label={t("account.deletion.requestId")} value={requestId} />
        <ReceiptRow
          label={t("account.deletion.purgeBy")}
          value={formatDate(purgeBy, activeLanguage)}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => void contactSupport()}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryButtonText}>{t("account.contactSupport")}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace("/(auth)/login")}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>{t("password.reset.backToLogin")}</Text>
      </Pressable>
    </View>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>
        {value || "—"}
      </Text>
    </View>
  );
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale).format(date);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    rowGap: 18,
    backgroundColor: colors.background,
  },
  icon: { marginBottom: 2 },
  title: { color: colors.text, fontSize: 24, fontWeight: "700", textAlign: "center" },
  message: {
    color: colors.secondaryText,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
    textAlign: "center",
  },
  receipt: {
    width: "100%",
    padding: 16,
    rowGap: 12,
    borderRadius: 16,
    backgroundColor: colors.card,
  },
  row: { rowGap: 4 },
  label: { color: colors.secondaryText, fontSize: 13, fontWeight: "600" },
  value: { color: colors.text, fontSize: 14, fontWeight: "600" },
  primaryButton: {
    width: "100%",
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.accent,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  secondaryButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: colors.accent, fontSize: 15, fontWeight: "600" },
});
