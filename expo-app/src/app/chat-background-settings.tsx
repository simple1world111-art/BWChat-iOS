import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";

import { APIError } from "@/api/client";
import { ChatBackgroundLayer } from "@/components/chat/ChatBackgroundLayer";
import { useChatAppearance } from "@/providers/ChatAppearanceProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import type { ChatBackgroundTargetType } from "@/services/chat-appearance/ChatAppearanceService";
import { palette } from "@/theme";

export default function ChatBackgroundSettingsScreen() {
  const params = useLocalSearchParams<{ targetType?: string; targetId?: string; title?: string }>();
  const targetType = validTargetType(params.targetType) ?? "global";
  const targetId = params.targetId?.trim() || (targetType === "global" ? "global" : "");
  const { t } = useLocalization();
  const theme = palette(useColorScheme());
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const appearance = useChatAppearance();
  const [isUploading, setUploading] = useState(false);
  const mountedRef = useRef(true);
  const exact = appearance.exact(targetType, targetId);
  const effective = appearance.effective(targetType, targetId);
  const loadBackgrounds = appearance.load;
  const title = params.title?.trim() || t("chatBackground.globalTitle");
  useEffect(() => {
    void loadBackgrounds().catch(() => undefined);
  }, [loadBackgrounds]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const choosePhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 1,
      });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset || !mountedRef.current) return;
      setUploading(true);
      await appearance.upload(targetType, targetId, asset);
    } catch (error) {
      if (!mountedRef.current) return;
      Alert.alert(
        t("common.operationFailed"),
        backgroundActionError(error, t("chatBackground.uploadFailed"), t),
      );
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  };

  const restore = async () => {
    try {
      await appearance.remove(targetType, targetId);
    } catch (error) {
      if (!mountedRef.current) return;
      Alert.alert(
        t("common.operationFailed"),
        backgroundActionError(error, t("chatBackground.restoreFailed"), t),
      );
    }
  };

  return (
    <>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.previewCard}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewTitle}>{t("chatBackground.currentPreview")}</Text>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>
                {!effective
                  ? t("chatBackground.default")
                  : !exact
                    ? t("chatBackground.usingGlobal")
                    : t("chatBackground.set")}
              </Text>
            </View>
          </View>
          <View style={styles.preview}>
            <ChatBackgroundLayer background={effective} style={StyleSheet.absoluteFill} />
            {!effective ? (
              <View style={styles.defaultPreview}>
                <SymbolView name="photo" size={28} weight="medium" tintColor={theme.tertiaryText} />
                <Text style={styles.defaultText}>{t("chatBackground.defaultGray")}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.actionCard}>
          <ActionRow
            symbol="photo.on.rectangle"
            title={isUploading ? t("common.uploading") : t("chatBackground.chooseFromAlbum")}
            tint={theme.accent}
            loading={isUploading}
            disabled={isUploading}
            onPress={() => void choosePhoto()}
          />
          <View style={styles.divider} />
          <ActionRow
            symbol="arrow.counterclockwise"
            title={
              targetType === "global"
                ? t("chatBackground.restoreGlobal")
                : t("chatBackground.restoreChat")
            }
            tint={exact ? theme.danger : theme.tertiaryText}
            disabled={!exact || isUploading}
            onPress={() => void restore()}
          />
        </View>
      </ScrollView>
    </>
  );
}

function ActionRow({
  symbol,
  title,
  tint,
  loading = false,
  disabled = false,
  onPress,
}: {
  symbol: SFSymbol;
  title: string;
  tint: string;
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  onPress: () => void;
}) {
  const theme = palette(useColorScheme());
  const styles = useMemo(() => makeStyles(theme), [theme]);
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.actionRow,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      onPress={onPress}
    >
      <View style={[styles.actionIcon, { backgroundColor: `${tint}1A` }]}>
        <SymbolView name={symbol} size={16} weight="semibold" tintColor={tint} />
      </View>
      <Text style={[styles.actionTitle, { color: tint }]}>{title}</Text>
      {loading ? (
        <ActivityIndicator size="small" color={tint} />
      ) : (
        <SymbolView
          name="chevron.right"
          size={12}
          weight="semibold"
          tintColor={theme.tertiaryText}
        />
      )}
    </Pressable>
  );
}

function backgroundActionError(
  error: unknown,
  fallback: string,
  t: (key: string) => string,
): string {
  if (!(error instanceof APIError) || !error.message) return fallback;
  return error.code === "decoding_error" || error.message === "api.decodingError"
    ? t("api.decodingError")
    : error.message;
}

function validTargetType(value: string | undefined): ChatBackgroundTargetType | null {
  return value === "global" || value === "dm" || value === "group" ? value : null;
}

function makeStyles(theme: ReturnType<typeof palette>) {
  return StyleSheet.create({
    content: {
      flexGrow: 1,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 28,
      rowGap: 16,
      backgroundColor: theme.background,
    },
    previewCard: { padding: 14, rowGap: 12, borderRadius: 8, backgroundColor: theme.card },
    previewHeader: { flexDirection: "row", alignItems: "center" },
    previewTitle: { flex: 1, color: theme.text, fontSize: 15, fontWeight: "600" },
    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
      backgroundColor: "#F4F4F8",
    },
    statusText: { color: theme.secondaryText, fontSize: 12, fontWeight: "500" },
    preview: {
      height: 280,
      overflow: "hidden",
      borderRadius: 8,
      borderWidth: 1,
      borderColor: "rgba(0,0,0,0.05)",
      backgroundColor: theme.background,
    },
    defaultPreview: { flex: 1, alignItems: "center", justifyContent: "center", rowGap: 8 },
    defaultText: { color: theme.tertiaryText, fontSize: 14, fontWeight: "500" },
    actionCard: { overflow: "hidden", borderRadius: 8, backgroundColor: theme.card },
    actionRow: {
      minHeight: 54,
      paddingHorizontal: 14,
      paddingVertical: 13,
      flexDirection: "row",
      alignItems: "center",
      columnGap: 12,
    },
    actionIcon: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
    },
    actionTitle: { flex: 1, fontSize: 16, fontWeight: "500" },
    divider: { height: StyleSheet.hairlineWidth, marginLeft: 56, backgroundColor: theme.separator },
    disabled: { opacity: 0.62 },
    pressed: { opacity: 0.72 },
  });
}
