import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  TextInput,
  View,
  Pressable,
  Text,
} from "react-native";

import { getGroupDetail, renameGroup } from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  updateGroupViewerSettings,
  updateMyGroupNickname,
} from "@/services/groups/GroupInfoV2Repository";
import { saveCachedGroupDetail } from "@/services/groups/GroupDetailRepository";
import { groupDetailErrorMessage } from "@/services/groups/GroupDetailPolicy";
import { colors } from "@/theme";

export default function GroupTextSettingScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    kind?: "name" | "remark" | "nickname";
    value?: string;
  }>();
  const groupId = Number(params.id ?? "0");
  const kind = params.kind ?? "name";
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const scopeKey = `${encodeURIComponent(ownerId)}:${groupId}:${kind}`;
  const scopeRef = useRef(scopeKey);
  const { t } = useLocalization();
  const [value, setValue] = useState(params.value ?? "");
  const [isSaving, setSaving] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const normalized = trimFoundationWhitespacesAndNewlines(value);
  const allowsEmpty = kind !== "name";
  const isValid = Boolean(ownerId) && (allowsEmpty || normalized.length > 0) && groupId > 0;
  const titleKey =
    kind === "remark"
      ? "group.remark.title"
      : kind === "nickname"
        ? "group.myNickname.title"
        : "group.name.title";
  const placeholderKey =
    kind === "remark"
      ? "group.remark.placeholder"
      : kind === "nickname"
        ? "group.myNickname.placeholder"
        : "group.rename.placeholder";

  useEffect(() => {
    scopeRef.current = scopeKey;
    queueMicrotask(() => {
      if (scopeRef.current === scopeKey) setSaving(false);
    });
    const timer = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, [scopeKey]);

  const save = async () => {
    if (!isValid || isSaving) return;
    const operationScope = scopeKey;
    setSaving(true);
    try {
      if (kind === "remark") {
        const settings = await updateGroupViewerSettings(
          groupId,
          { remark: normalized },
          async () => (await getGroupDetail(groupId)).viewer_settings,
        );
        if (scopeRef.current !== operationScope) return;
        const detail = await getGroupDetail(groupId);
        if (scopeRef.current !== operationScope) return;
        await saveCachedGroupDetail(ownerId, {
          ...detail,
          viewer_settings: settings,
        });
      } else if (kind === "nickname") {
        await updateMyGroupNickname(groupId, normalized);
        if (scopeRef.current !== operationScope) return;
        const detail = await getGroupDetail(groupId);
        if (scopeRef.current !== operationScope) return;
        await saveCachedGroupDetail(ownerId, detail);
      } else {
        await renameGroup(groupId, normalized);
        if (scopeRef.current !== operationScope) return;
        const detail = await getGroupDetail(groupId);
        if (scopeRef.current !== operationScope) return;
        await saveCachedGroupDetail(ownerId, detail);
      }
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
          title: t(titleKey),
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: colors.text,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !isValid || isSaving }}
              disabled={!isValid || isSaving}
              hitSlop={8}
              onPress={() => void save()}
            >
              <Text style={[styles.saveText, (!isValid || isSaving) && styles.disabledText]}>
                {t("common.save")}
              </Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.formSection}>
        <View style={styles.formRow}>
          <TextInput
            accessibilityLabel={t(titleKey)}
            editable={!isSaving}
            onChangeText={setValue}
            onSubmitEditing={() => void save()}
            placeholder={t(placeholderKey)}
            placeholderTextColor={colors.secondaryText}
            ref={inputRef}
            returnKeyType="done"
            style={styles.input}
            value={value}
          />
        </View>
        {allowsEmpty ? (
          <>
            <View style={styles.separator} />
            <View style={styles.hintRow}>
              <Text style={styles.hint}>{t("group.textSetting.emptyHint")}</Text>
            </View>
          </>
        ) : null}
      </View>
      {isSaving ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  formSection: {
    overflow: "hidden",
    marginTop: 35,
    marginHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.card,
  },
  formRow: {
    minHeight: 54,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  input: { color: colors.text, fontSize: 17, paddingVertical: 10 },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
    backgroundColor: colors.separator,
  },
  hintRow: { minHeight: 44, paddingHorizontal: 16, justifyContent: "center" },
  hint: { color: colors.secondaryText, fontSize: 13 },
  saveText: { color: colors.accent, fontSize: 16, fontWeight: "600" },
  disabledText: { color: colors.tertiaryText },
  overlay: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
});
