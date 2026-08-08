import * as Application from "expo-application";
import * as Clipboard from "expo-clipboard";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { env } from "@/config/env";
import { formatUpdateCopy, updateCopy } from "@/localization/updateCopy";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { useAppUpdate } from "@/providers/UpdateProvider";
import { captureException } from "@/services/monitoring/MonitoringService";
import {
  getCurrentLocation,
  pickChatMedia,
  requestPushPermission,
} from "@/services/native/NativeCapabilities";
import {
  getLastUpdateCheck,
  getUpdateMetadata,
  type PersistedUpdateState,
} from "@/services/update/UpdateService";
import { colors, radius, spacing } from "@/theme";

const previewOtaAcceptanceMarker = "OTA-PREVIEW-20260809-01";

export default function UpdateSettingsScreen() {
  const update = useAppUpdate();
  const remote = useRemoteConfig();
  const { activeLanguage, t } = useLocalization();
  const copy = updateCopy(activeLanguage);
  const metadata = getUpdateMetadata();
  const [lastCheck, setLastCheck] = useState<PersistedUpdateState | null>(null);

  useEffect(() => {
    let active = true;
    void getLastUpdateCheck().then((value) => {
      if (active) setLastCheck(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const checkUpdate = async () => {
    try {
      const result = await update.check(true);
      const messages = {
        disabled: copy.statusDisabled,
        throttled: copy.statusThrottled,
        "no-update": copy.statusNoUpdate,
        downloaded: copy.statusDownloaded,
        error: copy.statusError,
      } as const;
      const persisted = await getLastUpdateCheck();
      setLastCheck(persisted);
      Alert.alert("EAS Update", messages[result.status]);
    } catch (error) {
      captureException(error, { operation: "ota_manual_check" });
      Alert.alert("EAS Update", copy.operationFailed);
    }
  };

  const reload = () => {
    Alert.alert(copy.applyTitle, copy.applyMessage, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: copy.applyNow,
        style: "destructive",
        onPress: () =>
          void update.reload().catch((error: unknown) => {
            captureException(error, { operation: "ota_manual_reload" });
            Alert.alert("EAS Update", copy.operationFailed);
          }),
      },
    ]);
  };

  const copyDiagnostics = async () => {
    try {
      await Clipboard.setStringAsync(
        JSON.stringify(
          {
            environment: env.environment,
            appVersion: Application.nativeApplicationVersion,
            buildNumber: Application.nativeBuildVersion,
            remoteConfigVersion: remote.config.configVersion,
            remoteConfigSource: remote.source,
            lastUpdateCheck: lastCheck,
            ...metadata,
          },
          null,
          2,
        ),
      );
      Alert.alert(copy.copiedTitle, copy.copiedMessage);
    } catch (error) {
      captureException(error, { operation: "ota_copy_diagnostics" });
      Alert.alert(t("common.notice"), copy.operationFailed);
    }
  };

  const nativeCheckFailed = (error: unknown, capability: string) => {
    captureException(error, { operation: "native_capability_check", capability });
    Alert.alert(t("common.notice"), copy.nativeCheckFailed);
  };

  const checkNotifications = async () => {
    try {
      const granted = await requestPushPermission();
      Alert.alert(copy.notificationPermission, granted ? copy.allowed : copy.notAllowed);
    } catch (error) {
      nativeCheckFailed(error, "notifications");
    }
  };

  const checkPhotoPicker = async () => {
    try {
      const assets = await pickChatMedia();
      Alert.alert(copy.photoPicker, formatUpdateCopy(copy.selectedFiles, { count: assets.length }));
    } catch (error) {
      nativeCheckFailed(error, "photo_picker");
    }
  };

  const checkLocation = async () => {
    try {
      const value = await getCurrentLocation();
      Alert.alert(
        copy.currentLocation,
        `${value.coords.latitude.toFixed(5)}, ${value.coords.longitude.toFixed(5)}`,
      );
    } catch (error) {
      nativeCheckFailed(error, "location");
    }
  };

  const lastResultLabels = {
    "no-update": copy.lastResultNoUpdate,
    downloaded: copy.lastResultDownloaded,
    error: copy.lastResultError,
  } as const;
  const lastCheckValue = lastCheck
    ? `${new Intl.DateTimeFormat(activeLanguage, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(lastCheck.checkedAt))} · ${lastResultLabels[lastCheck.result]}`
    : copy.neverChecked;
  const currentSourceValue =
    env.environment === "preview" && !metadata.isEmbeddedLaunch
      ? `${copy.otaSource} · ${previewOtaAcceptanceMarker}`
      : metadata.isEmbeddedLaunch
        ? copy.embeddedSource
        : copy.otaSource;

  return (
    <>
      <Stack.Screen options={{ title: copy.screenTitle }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Section title={copy.sectionUpdate}>
          <InfoRow
            label={copy.environmentChannel}
            value={`${env.environment} / ${metadata.channel}`}
          />
          <InfoRow label={copy.runtime} value={metadata.runtimeVersion} mono />
          <InfoRow label={copy.updateId} value={metadata.updateId} mono />
          <InfoRow label={copy.currentSource} value={currentSourceValue} />
          <InfoRow label={copy.lastCheck} value={lastCheckValue} />
          <ActionRow
            title={update.isChecking ? copy.checking : copy.check}
            onPress={() => void checkUpdate()}
            disabled={update.isChecking}
          />
          {update.result?.status === "downloaded" ? (
            <ActionRow title={copy.restartDownloaded} onPress={reload} emphasized />
          ) : null}
        </Section>

        <Section title={copy.sectionRemote}>
          <InfoRow label={copy.configSource} value={remote.source} />
          <InfoRow label={copy.configVersion} value={String(remote.config.configVersion)} />
          <InfoRow
            label={copy.maintenanceMode}
            value={
              remote.config.killSwitch?.enabled || remote.config.features.maintenanceMode
                ? copy.enabled
                : copy.disabled
            }
          />
          <InfoRow
            label={copy.paymentFeature}
            value={remote.config.features.paymentEnabled ? copy.enabled : copy.disabled}
          />
          <ActionRow
            title={remote.isRefreshing ? copy.refreshingConfig : copy.refreshConfig}
            onPress={() => void remote.refresh()}
            disabled={remote.isRefreshing}
          />
          {remote.error ? <Text style={styles.error}>{copy.remoteRefreshFailed}</Text> : null}
        </Section>

        <Section title={copy.sectionNative}>
          <ActionRow
            title={copy.notificationPermission}
            onPress={() => void checkNotifications()}
          />
          <ActionRow title={copy.photoPicker} onPress={() => void checkPhotoPicker()} />
          <ActionRow title={copy.currentLocation} onPress={() => void checkLocation()} />
        </Section>

        <Section title={copy.sectionDiagnostics}>
          <InfoRow
            label={copy.app}
            value={`${Application.nativeApplicationVersion ?? "dev"} (${Application.nativeBuildVersion ?? "dev"})`}
          />
          <InfoRow label={copy.api} value={env.apiBaseUrl} mono />
          <ActionRow title={copy.copyDiagnostics} onPress={() => void copyDiagnostics()} />
        </Section>
      </ScrollView>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionWrap}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.section}>{children}</View>
    </View>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, mono && styles.mono]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function ActionRow({
  title,
  onPress,
  disabled = false,
  emphasized = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  emphasized?: boolean;
}) {
  return (
    <Pressable
      style={[styles.action, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.actionText, emphasized && styles.emphasized]}>{title}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.xl },
  sectionWrap: { gap: spacing.sm },
  sectionTitle: {
    color: colors.secondaryText,
    fontSize: 13,
    fontWeight: "700",
    marginLeft: spacing.sm,
  },
  section: { borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.card },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  label: { color: colors.text, fontWeight: "600" },
  value: { flex: 1, color: colors.secondaryText, textAlign: "right" },
  mono: { fontSize: 11, fontFamily: "Menlo" },
  action: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  actionText: { flex: 1, color: colors.accent, fontWeight: "700" },
  emphasized: { color: colors.success },
  chevron: { color: colors.secondaryText, fontSize: 25 },
  disabled: { opacity: 0.5 },
  error: { color: colors.warning, padding: spacing.lg, lineHeight: 20 },
});
