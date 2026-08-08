import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { applyGroupAnnouncementUpdate } from "@/services/groups/GroupDetailRepository";
import { groupDetailErrorMessage } from "@/services/groups/GroupDetailPolicy";
import { updateGroupAnnouncement } from "@/services/groups/GroupInfoV2Repository";
import { colors } from "@/theme";

export default function GroupAnnouncementScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    title?: string;
    content?: string;
    updatedAt?: string;
    canEdit?: string;
  }>();
  const groupId = Number(params.id ?? "0");
  const canEdit = params.canEdit === "true";
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const scopeKey = `${encodeURIComponent(ownerId)}:${groupId}`;
  const scopeRef = useRef(scopeKey);
  const { t } = useLocalization();
  const [title, setTitle] = useState(params.title ?? "");
  const [content, setContent] = useState(params.content ?? "");
  const [isSaving, setSaving] = useState(false);
  const normalizedTitle = trimFoundationWhitespacesAndNewlines(title);
  const normalizedContent = trimFoundationWhitespacesAndNewlines(content);

  useEffect(() => {
    scopeRef.current = scopeKey;
    queueMicrotask(() => {
      if (scopeRef.current === scopeKey) setSaving(false);
    });
  }, [scopeKey]);

  const save = async () => {
    if (!ownerId || !canEdit || !normalizedContent || isSaving || groupId <= 0) return;
    const operationScope = scopeKey;
    setSaving(true);
    try {
      const saved = await updateGroupAnnouncement(groupId, normalizedTitle, normalizedContent);
      if (scopeRef.current !== operationScope) return;
      await applyGroupAnnouncementUpdate(ownerId, saved);
      if (scopeRef.current !== operationScope) return;
      router.back();
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      Alert.alert(
        t("common.error"),
        groupDetailErrorMessage(error, t, t("common.operationFailed")),
      );
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: t("group.announcement.title"),
          ...(canEdit
            ? {
                headerRight: () => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !normalizedContent || isSaving }}
                    disabled={!normalizedContent || isSaving}
                    hitSlop={8}
                    onPress={() => void save()}
                  >
                    <Text
                      style={[styles.save, (!normalizedContent || isSaving) && styles.disabled]}
                    >
                      {t("common.save")}
                    </Text>
                  </Pressable>
                ),
              }
            : {}),
        }}
      />
      {canEdit ? (
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <View style={styles.section}>
            <Text style={styles.label}>{t("group.announcement.titleField")}</Text>
            <TextInput
              accessibilityLabel={t("group.announcement.titleField")}
              editable={!isSaving}
              onChangeText={setTitle}
              placeholder={t("group.announcement.titlePlaceholder")}
              placeholderTextColor={colors.secondaryText}
              style={styles.titleInput}
              value={title}
            />
          </View>
          <View style={styles.section}>
            <Text style={styles.label}>{t("group.announcement.contentField")}</Text>
            <TextInput
              accessibilityLabel={t("group.announcement.contentField")}
              editable={!isSaving}
              multiline
              onChangeText={setContent}
              style={styles.contentInput}
              textAlignVertical="top"
              value={content}
            />
          </View>
          {params.updatedAt ? (
            <Text style={styles.updatedAt}>
              {t("group.announcement.updatedAt", formatDate(params.updatedAt))}
            </Text>
          ) : null}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.readOnly}>
          <Text style={styles.heading}>{normalizedTitle || t("group.announcement.title")}</Text>
          <Text selectable style={[styles.body, !normalizedContent && styles.empty]}>
            {normalizedContent || t("group.announcement.empty")}
          </Text>
        </ScrollView>
      )}
      {isSaving ? (
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
  screen: { flex: 1, backgroundColor: colors.background },
  form: { paddingTop: 28, rowGap: 22 },
  section: { backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 12 },
  label: { marginBottom: 8, color: colors.secondaryText, fontSize: 13 },
  titleInput: { minHeight: 36, color: colors.text, fontSize: 17 },
  contentInput: { minHeight: 180, color: colors.text, fontSize: 17, lineHeight: 25 },
  updatedAt: { paddingHorizontal: 16, color: colors.secondaryText, fontSize: 13 },
  readOnly: { padding: 16, rowGap: 14 },
  heading: { color: colors.text, fontSize: 20, fontWeight: "600" },
  body: { color: colors.text, fontSize: 17, lineHeight: 26 },
  empty: { color: colors.secondaryText },
  save: { color: colors.accent, fontSize: 16, fontWeight: "600" },
  disabled: { color: colors.tertiaryText },
  overlay: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.08)",
  },
});
