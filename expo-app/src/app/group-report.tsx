import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
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
import { groupDetailErrorMessage } from "@/services/groups/GroupDetailPolicy";
import { reportGroup } from "@/services/groups/GroupInfoV2Repository";
import { colors } from "@/theme";

const reasons = ["spam", "fraud", "harassment", "inappropriate", "other"] as const;
type GroupReportReason = (typeof reasons)[number];

export default function GroupReportScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = Number(params.id ?? "0");
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const scopeKey = `${encodeURIComponent(ownerId)}:${groupId}`;
  const scopeRef = useRef(scopeKey);
  const { t } = useLocalization();
  const [reason, setReason] = useState<GroupReportReason>("spam");
  const [detail, setDetail] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);

  useEffect(() => {
    scopeRef.current = scopeKey;
    queueMicrotask(() => {
      if (scopeRef.current === scopeKey) setSubmitting(false);
    });
  }, [scopeKey]);

  const submit = async () => {
    if (!ownerId || isSubmitting || groupId <= 0) return;
    const operationScope = scopeKey;
    setSubmitting(true);
    try {
      await reportGroup(groupId, reason, trimFoundationWhitespacesAndNewlines(detail));
      if (scopeRef.current !== operationScope) return;
      Alert.alert(t("group.report.success"), undefined, [
        { text: t("common.confirm"), onPress: () => router.back() },
      ]);
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      Alert.alert(
        t("common.error"),
        groupDetailErrorMessage(error, t, t("common.operationFailed")),
      );
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: t("group.report.title"),
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: colors.text,
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>{t("group.report.reason")}</Text>
        <View style={styles.section}>
          {reasons.map((candidate, index) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: reason === candidate }}
              key={candidate}
              onPress={() => setReason(candidate)}
              style={({ pressed }) => [
                styles.reasonRow,
                index > 0 && styles.separator,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.reasonText}>{t(`group.report.reason.${candidate}`)}</Text>
              <View style={styles.selectionMark}>
                {reason === candidate ? (
                  <SymbolView
                    name="checkmark"
                    size={17}
                    weight="semibold"
                    tintColor={colors.accent}
                  />
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
        <Text style={styles.sectionTitle}>{t("group.report.detail")}</Text>
        <View style={styles.section}>
          <TextInput
            accessibilityLabel={t("group.report.detail")}
            editable={!isSubmitting}
            multiline
            onChangeText={setDetail}
            style={styles.detailInput}
            textAlignVertical="top"
            value={detail}
          />
        </View>
        <Text style={styles.footer}>{t("group.report.privacyHint")}</Text>
        <View style={[styles.section, styles.submitSection]}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isSubmitting }}
            disabled={isSubmitting}
            onPress={() => void submit()}
            style={({ pressed }) => [styles.submit, pressed && styles.pressed]}
          >
            <Text style={styles.submitText}>{t("group.report.submit")}</Text>
          </Pressable>
        </View>
      </ScrollView>
      {isSubmitting ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: 24, paddingBottom: 32, paddingHorizontal: 16, rowGap: 8 },
  sectionTitle: {
    paddingHorizontal: 16,
    marginTop: 8,
    color: colors.secondaryText,
    fontSize: 13,
  },
  section: {
    overflow: "hidden",
    borderRadius: 22,
    backgroundColor: colors.card,
  },
  reasonRow: {
    minHeight: 50,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  separator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  reasonText: { flex: 1, color: colors.text, fontSize: 17 },
  selectionMark: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  detailInput: { minHeight: 130, padding: 16, color: colors.text, fontSize: 17 },
  footer: { paddingHorizontal: 16, color: colors.secondaryText, fontSize: 13, lineHeight: 18 },
  submitSection: { marginTop: 18 },
  submit: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { color: colors.accent, fontSize: 17 },
  pressed: { opacity: 0.68 },
  overlay: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.08)",
  },
});
