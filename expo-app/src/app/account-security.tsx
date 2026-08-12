import { router, Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet } from "react-native";

import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";
import {
  accountComplianceFallbackMessage,
  getAccountSecurity,
  type AccountSecuritySummary,
} from "@/services/account/AccountComplianceService";
import {
  copySupportEmail,
  normalizedSupportEmail,
  openSupportEmail,
} from "@/services/account/SupportEmailService";
import {
  ProfileGroupedCard,
  ProfileNoticeBanner,
  ProfileRowDivider,
  ProfileSettingsRow,
} from "@/components/profile/ProfileSettingsChrome";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { colors } from "@/theme";

export default function AccountSecurityScreen() {
  const { t } = useLocalization();
  const { isSessionUnverified } = useAuth();
  const { config } = useRemoteConfig();
  const supportEmail = normalizedSupportEmail(config.account?.supportEmail);
  const mounted = useRef(true);
  const generation = useRef(0);
  const [summary, setSummary] = useState<AccountSecuritySummary | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const privacyScreenId = config.account?.privacyScreenId ?? "privacy_policy";
  const dataPrivacyScreenId = config.account?.dataPrivacyScreenId ?? "data_privacy";
  const sensitiveDisabled = isSessionUnverified;

  useEffect(
    () => () => {
      mounted.current = false;
      generation.current += 1;
    },
    [],
  );

  const load = useCallback(async () => {
    if (isSessionUnverified) {
      setSummary(null);
      setError(null);
      return;
    }
    const operation = ++generation.current;
    const current = () => mounted.current && operation === generation.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getAccountSecurity();
      if (current()) setSummary(next);
    } catch (nextError) {
      if (current()) setError(accountComplianceFallbackMessage(nextError, t));
    } finally {
      if (current()) setLoading(false);
    }
  }, [isSessionUnverified, t]);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  const contactSupport = async () => {
    if (!supportEmail) {
      Alert.alert(t("common.notice"), t("account.support.unavailable"));
      return;
    }
    if (await openSupportEmail(supportEmail)) return;
    Alert.alert(t("account.support.openFailed.title"), t("account.support.openFailed.message"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("account.support.copy"),
        onPress: () => void copySupportEmail(supportEmail),
      },
    ]);
  };

  const emailTrailing = isSessionUnverified
    ? t("account.security.onlineRequired.short")
    : summary?.email.verified
      ? t("account.email.verifiedValue", summary.email.maskedEmail ?? "")
      : t("account.email.unbound");

  return (
    <>
      <Stack.Screen options={{ title: t("account.security.title") }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => void load()} />}
        showsVerticalScrollIndicator={false}
      >
        {sensitiveDisabled ? (
          <ProfileNoticeBanner message={t("account.security.onlineRequired")} />
        ) : error ? (
          <ProfileNoticeBanner message={error} />
        ) : null}

        <ProfileGroupedCard>
          <ProfileSettingsRow
            title={t("account.email.security")}
            trailingText={emailTrailing}
            systemImage="envelope.fill"
            gradient={["#3A86FF", "#2EC4B6"]}
            disabled={sensitiveDisabled}
            onPress={() => router.push("/email-security" as never)}
          />
          <ProfileRowDivider />
          <ProfileSettingsRow
            title={t("account.privacyPolicy")}
            systemImage="hand.raised.fill"
            gradient={["#2EC4B6", "#34C759"]}
            onPress={() =>
              router.push({ pathname: "/dynamic-screen/[id]", params: { id: privacyScreenId } })
            }
          />
          <ProfileRowDivider />
          <ProfileSettingsRow
            title={t("account.dataPrivacy")}
            systemImage="doc.text.fill"
            gradient={["#667EEA", "#3A86FF"]}
            onPress={() =>
              router.push({ pathname: "/dynamic-screen/[id]", params: { id: dataPrivacyScreenId } })
            }
          />
          <ProfileRowDivider />
          <ProfileSettingsRow
            title={t("account.contactSupport")}
            trailingText={supportEmail ?? t("account.support.notConfigured")}
            systemImage="envelope.open.fill"
            gradient={["#FF9F1C", "#FFBF69"]}
            onPress={() => void contactSupport()}
          />
        </ProfileGroupedCard>

        <ProfileGroupedCard>
          <ProfileSettingsRow
            title={t("account.deletion.title")}
            subtitle={t("account.deletion.irreversible")}
            systemImage="person.crop.circle.badge.minus"
            gradient={[colors.danger, colors.danger]}
            danger
            disabled={sensitiveDisabled}
            onPress={() => router.push("/account-deletion" as never)}
          />
        </ProfileGroupedCard>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 30,
    rowGap: 14,
    backgroundColor: colors.background,
  },
});
