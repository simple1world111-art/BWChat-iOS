import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";

import { getGroupDetail } from "@/api/bwchat";
import type { GroupDetail, GroupNotificationSettings } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  saveCachedGroupDetail,
  subscribeGroupDetail,
} from "@/services/groups/GroupDetailRepository";
import { groupDetailErrorMessage } from "@/services/groups/GroupDetailPolicy";
import {
  getGroupNotificationSettings,
  groupImportantMemberLimit,
  updateGroupNotificationSettings,
} from "@/services/groups/GroupInfoV2Repository";
import { colors } from "@/theme";

export default function GroupNotificationSettingsScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = Number(params.id ?? "0");
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const scopeKey = `${encodeURIComponent(ownerId)}:${groupId}`;
  const scopeRef = useRef(scopeKey);
  const { t } = useLocalization();
  const [detailState, setDetail] = useState<GroupDetail | null>(null);
  const [settingsState, setSettings] = useState<GroupNotificationSettings | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const detail = loadedScope === scopeKey ? detailState : null;
  const settings = loadedScope === scopeKey ? settingsState : null;
  const [isLoading, setLoading] = useState(true);
  const [isUpdating, setUpdating] = useState(false);

  useEffect(() => {
    scopeRef.current = scopeKey;
    queueMicrotask(() => {
      if (scopeRef.current !== scopeKey) return;
      setLoading(true);
      setUpdating(false);
    });
  }, [scopeKey]);

  const load = useCallback(async () => {
    const requestScope = scopeKey;
    if (!ownerId || groupId <= 0) {
      if (scopeRef.current === requestScope) setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextDetail, nextSettings] = await Promise.all([
        getGroupDetail(groupId),
        getGroupNotificationSettings(groupId),
      ]);
      const validIds = new Set(
        nextDetail.members
          .filter((member) => member.user_id !== ownerId)
          .map((member) => member.user_id),
      );
      const retained = nextSettings.important_member_ids.filter((id) => validIds.has(id));
      const cleaned =
        retained.length === nextSettings.important_member_ids.length
          ? nextSettings
          : await updateGroupNotificationSettings(groupId, {
              importantMemberIds: retained,
            });
      if (scopeRef.current !== requestScope) return;
      const resolved = await saveCachedGroupDetail(ownerId, {
        ...nextDetail,
        notification_settings: cleaned,
      });
      if (scopeRef.current !== requestScope) return;
      setDetail(resolved);
      setSettings(resolved.notification_settings);
      setLoadedScope(requestScope);
    } catch (error) {
      if (scopeRef.current !== requestScope) return;
      Alert.alert(
        t("common.error"),
        groupDetailErrorMessage(error, t, t("group.notifications.loadFailed")),
      );
    } finally {
      if (scopeRef.current === requestScope) setLoading(false);
    }
  }, [groupId, ownerId, scopeKey, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const subscriptionScope = scopeKey;
    return subscribeGroupDetail(ownerId, (updated) => {
      if (scopeRef.current !== subscriptionScope || updated.group_id !== groupId) return;
      setDetail(updated);
      setSettings(updated.notification_settings);
      setLoadedScope(subscriptionScope);
    });
  }, [groupId, ownerId, scopeKey]);

  const update = async (patch: Parameters<typeof updateGroupNotificationSettings>[1]) => {
    if (!settings || isUpdating) return;
    const operationScope = scopeKey;
    const previous = settings;
    const optimistic: GroupNotificationSettings = {
      ...settings,
      ...(patch.notifyMentionsMe !== undefined
        ? { notify_mentions_me: patch.notifyMentionsMe }
        : {}),
      ...(patch.notifyMentionsAll !== undefined
        ? { notify_mentions_all: patch.notifyMentionsAll }
        : {}),
    };
    setSettings(optimistic);
    setUpdating(true);
    try {
      const saved = await updateGroupNotificationSettings(groupId, patch);
      if (scopeRef.current !== operationScope) return;
      setSettings(saved);
      if (detail && ownerId) {
        await saveCachedGroupDetail(ownerId, {
          ...detail,
          notification_settings: saved,
        });
      }
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      setSettings(previous);
      Alert.alert(
        t("common.error"),
        groupDetailErrorMessage(error, t, t("group.notifications.updateFailed")),
      );
    } finally {
      if (scopeRef.current === operationScope) setUpdating(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: t("group.notifications.title"),
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: colors.text,
        }}
      />
      {isLoading && !settings ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : settings ? (
        <View style={styles.content}>
          <View style={styles.section}>
            <ToggleRow
              disabled={isUpdating}
              label={t("group.notifications.mentionsMe")}
              onChange={(value) => void update({ notifyMentionsMe: value })}
              value={settings.notify_mentions_me}
            />
            <View style={styles.separator} />
            <ToggleRow
              disabled={isUpdating}
              label={t("group.notifications.mentionsAll")}
              onChange={(value) => void update({ notifyMentionsAll: value })}
              value={settings.notify_mentions_all}
            />
          </View>
          <Text style={styles.footer}>{t("group.notifications.description")}</Text>
          <View style={styles.section}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !detail }}
              disabled={!detail}
              onPress={() =>
                router.push({
                  pathname: "/group-important-members",
                  params: { id: String(groupId) },
                })
              }
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.label}>{t("group.notifications.importantMembers")}</Text>
              <Text style={styles.value}>
                {settings.important_member_ids.length}/{groupImportantMemberLimit}
              </Text>
              <SymbolView
                name="chevron.right"
                size={12}
                weight="semibold"
                tintColor={colors.tertiaryText}
              />
            </Pressable>
          </View>
          <Text style={styles.footer}>{t("group.notifications.limit")}</Text>
        </View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.error}>{t("group.notifications.loadFailed")}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()}>
            <Text style={styles.retry}>{t("common.retry")}</Text>
          </Pressable>
        </View>
      )}
      {isUpdating ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
    </View>
  );
}

function ToggleRow({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        ios_backgroundColor="#E9E9EA"
        onValueChange={onChange}
        trackColor={{ false: "#E9E9EA", true: colors.accent }}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: 36, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", rowGap: 14 },
  section: {
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: colors.card,
  },
  row: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
    backgroundColor: colors.separator,
  },
  label: { flex: 1, color: colors.text, fontSize: 17 },
  value: { color: colors.secondaryText, fontSize: 17 },
  footer: {
    marginTop: 8,
    marginBottom: 18,
    paddingHorizontal: 16,
    color: colors.secondaryText,
    fontSize: 13,
    lineHeight: 18,
  },
  error: { color: colors.secondaryText, fontSize: 16 },
  retry: { color: colors.accent, fontSize: 16 },
  pressed: { opacity: 0.68 },
  overlay: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.08)",
  },
});
