import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { getGroupDetail } from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { groupDetailErrorMessage } from "@/services/groups/GroupDetailPolicy";
import {
  acceptGroupInvite,
  getGroupInvitePreview,
  type GroupInvitePreview,
} from "@/services/groups/GroupInfoV2Repository";
import { isGroupInviteToken } from "@/services/groups/GroupInviteRoute";
import { colors } from "@/theme";

export default function GroupInvitePreviewScreen() {
  const params = useLocalSearchParams<{ token?: string; delivery?: string }>();
  const token = params.token ?? "";
  const tokenValid = isGroupInviteToken(token);
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const scopeKey = `${encodeURIComponent(ownerId)}:${token}`;
  const scopeRef = useRef(scopeKey);
  const { t } = useLocalization();
  const errorTitle = t("common.error");
  const loadErrorMessage = t("common.operationFailed");
  const [preview, setPreview] = useState<GroupInvitePreview | null>(null);
  const [isLoading, setLoading] = useState(tokenValid);
  const [isJoining, setJoining] = useState(false);

  useEffect(() => {
    scopeRef.current = scopeKey;
    queueMicrotask(() => {
      if (scopeRef.current === scopeKey) setJoining(false);
    });
  }, [scopeKey]);

  useEffect(() => {
    let active = true;
    if (!tokenValid) {
      Alert.alert(errorTitle, loadErrorMessage);
      return () => {
        active = false;
      };
    }
    void getGroupInvitePreview(token)
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch((error: unknown) => {
        if (active) {
          Alert.alert(errorTitle, groupDetailErrorMessage(error, t, loadErrorMessage));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [errorTitle, loadErrorMessage, params.delivery, t, token, tokenValid]);

  const joinOrOpen = async () => {
    if (!ownerId || !preview || isJoining || (!preview.is_member && !preview.can_join)) return;
    const operationScope = scopeKey;
    setJoining(true);
    try {
      const groupId = preview.is_member
        ? preview.group_id
        : (await acceptGroupInvite(token)).group_id;
      if (scopeRef.current !== operationScope) return;
      await getGroupDetail(groupId);
      if (scopeRef.current !== operationScope) return;
      router.replace({ pathname: "/group-chat/[id]", params: { id: String(groupId) } });
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      Alert.alert(
        t("common.error"),
        groupDetailErrorMessage(error, t, t("common.operationFailed")),
      );
      setJoining(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: t("group.invite.previewTitle") }} />
      {isLoading ? (
        <ActivityIndicator color={colors.accent} />
      ) : preview ? (
        <>
          <Avatar name={preview.group_name} size={88} uri={preview.avatar_url} />
          <Text style={styles.title}>{preview.group_name}</Text>
          <Text style={styles.secondary}>{t("group.members.count", preview.member_count)}</Text>
          {preview.inviter_nickname ? (
            <Text style={styles.secondary}>
              {t("group.invite.invitedBy", preview.inviter_nickname)}
            </Text>
          ) : null}
          <Text style={styles.tertiary}>
            {t("group.invite.expires", formatDate(preview.expires_at))}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled: isJoining || (!preview.is_member && !preview.can_join),
            }}
            disabled={isJoining || (!preview.is_member && !preview.can_join)}
            onPress={() => void joinOrOpen()}
            style={({ pressed }) => [
              styles.button,
              !preview.is_member && !preview.can_join && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.buttonText}>
              {t(preview.is_member ? "group.invite.openGroup" : "group.invite.join")}
            </Text>
          </Pressable>
        </>
      ) : null}
      {isJoining ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
    </View>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    rowGap: 20,
    backgroundColor: colors.background,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: "600", textAlign: "center" },
  secondary: { color: colors.secondaryText, fontSize: 16, textAlign: "center" },
  tertiary: { color: colors.tertiaryText, fontSize: 13, textAlign: "center" },
  button: {
    width: "100%",
    minHeight: 50,
    marginTop: 4,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 8,
    backgroundColor: colors.accent,
  },
  buttonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.68 },
  overlay: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
