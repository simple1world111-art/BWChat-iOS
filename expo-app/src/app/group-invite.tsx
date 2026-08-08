import { SymbolView } from "expo-symbols";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { groupDetailErrorMessage } from "@/services/groups/GroupDetailPolicy";
import {
  createGroupInvite,
  revokeGroupInvite,
  type GroupInvite,
} from "@/services/groups/GroupInfoV2Repository";
import { colors } from "@/theme";

export default function GroupInviteScreen() {
  const params = useLocalSearchParams<{ id?: string; name?: string }>();
  const groupId = Number(params.id ?? "0");
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const scopeKey = `${encodeURIComponent(ownerId)}:${groupId}`;
  const scopeRef = useRef(scopeKey);
  const { t } = useLocalization();
  const [invite, setInvite] = useState<GroupInvite | null>(null);
  const [isWorking, setWorking] = useState(false);

  useEffect(() => {
    scopeRef.current = scopeKey;
    queueMicrotask(() => {
      if (scopeRef.current !== scopeKey) return;
      setInvite(null);
      setWorking(false);
    });
  }, [scopeKey]);

  const perform = async (operation: () => Promise<void>) => {
    if (!ownerId || groupId <= 0 || isWorking) return;
    const operationScope = scopeKey;
    setWorking(true);
    try {
      await operation();
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      Alert.alert(
        t("common.error"),
        groupDetailErrorMessage(error, t, t("common.operationFailed")),
      );
    } finally {
      if (scopeRef.current === operationScope) setWorking(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: t("group.invite.title") }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.groupName}>{params.name ?? ""}</Text>
        {invite?.invite_url ? (
          <>
            <View
              accessibilityLabel={t("group.invite.qrAccessibility")}
              accessibilityRole="image"
              style={styles.qrCard}
            >
              <QRCode backgroundColor="#FFFFFF" size={260} value={invite.invite_url} />
            </View>
            <Text style={styles.hint}>
              {t("group.invite.expires", formatDate(invite.expires_at))}
            </Text>
            <PrimaryButton
              disabled={isWorking}
              label={t("group.invite.share")}
              onPress={() =>
                void Share.share({ message: invite.invite_url, url: invite.invite_url })
              }
              symbol="square.and.arrow.up"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isWorking }}
              disabled={isWorking}
              onPress={() =>
                void perform(async () => {
                  await revokeGroupInvite(groupId, invite.invite_id);
                  if (scopeRef.current === scopeKey) setInvite(null);
                })
              }
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.dangerText}>{t("group.invite.revoke")}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <SymbolView name="qrcode" size={80} tintColor={colors.secondaryText} />
            <Text style={styles.hint}>{t("group.invite.validityHint")}</Text>
            <PrimaryButton
              disabled={!ownerId || groupId <= 0 || isWorking}
              label={t("group.invite.generate")}
              onPress={() =>
                void perform(async () => {
                  const created = await createGroupInvite(groupId);
                  if (scopeRef.current === scopeKey) setInvite(created);
                })
              }
              symbol="qrcode"
            />
          </>
        )}
      </ScrollView>
      {isWorking ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
    </View>
  );
}

function PrimaryButton({
  disabled = false,
  label,
  onPress,
  symbol,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  symbol: "qrcode" | "square.and.arrow.up";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <SymbolView name={symbol} size={17} tintColor="#FFFFFF" />
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
    rowGap: 22,
  },
  groupName: { color: colors.text, fontSize: 20, fontWeight: "600", textAlign: "center" },
  qrCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  hint: {
    maxWidth: 360,
    color: colors.secondaryText,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  primaryButton: {
    width: "100%",
    minHeight: 50,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 8,
    backgroundColor: colors.accent,
  },
  primaryText: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
  secondaryButton: {
    width: "100%",
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    backgroundColor: colors.card,
  },
  dangerText: { color: colors.danger, fontSize: 17 },
  pressed: { opacity: 0.68 },
  disabled: { opacity: 0.45 },
  overlay: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.08)",
  },
});
