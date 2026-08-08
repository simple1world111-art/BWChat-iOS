import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useMemo, useState } from "react";
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
import { clearDirectMessageHistory } from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import { TopToast } from "@/components/TopToast";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { clearCachedDirectConversationPreview } from "@/services/conversations/ConversationRepository";
import { applyDirectHistoryClear } from "@/services/messages/DirectHistoryClearRepository";
import { palette } from "@/theme";

export default function DirectChatSettingsScreen() {
  const { id, name, avatar } = useLocalSearchParams<{
    id?: string;
    name?: string;
    avatar?: string;
  }>();
  const { user } = useAuth();
  const { t } = useLocalization();
  const theme = palette(useColorScheme());
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [isClearing, setClearing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const contactId = id?.trim() ?? "";
  const nickname = name?.trim() || contactId;
  const dismissToast = useCallback(() => setToastMessage(null), []);

  const clearHistory = async () => {
    if (!contactId || !user?.user_id || isClearing) return;
    setClearing(true);
    try {
      const receipt = await clearDirectMessageHistory(contactId);
      await applyDirectHistoryClear(user.user_id, receipt);
      await clearCachedDirectConversationPreview(user.user_id, contactId);
      setToastMessage(t("chat.clear.success"));
    } catch (error) {
      Alert.alert(
        t("common.operationFailed"),
        error instanceof APIError && error.message ? error.message : t("common.operationFailed"),
      );
    } finally {
      setClearing(false);
    }
  };

  const confirmClearHistory = () => {
    Alert.alert(t("chat.clear.confirmTitle"), t("chat.clear.message"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("chat.clear.action"),
        style: "destructive",
        onPress: () => clearHistory(),
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: t("chat.info") }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.profileCard}>
          <Avatar uri={avatar} name={nickname} size={66} />
          <Text style={styles.nickname}>{nickname}</Text>
        </View>

        <Pressable
          accessibilityLabel={t("chatBackground.currentChat")}
          accessibilityRole="button"
          style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
          onPress={() =>
            router.push({
              pathname: "/chat-background-settings",
              params: {
                targetType: "dm",
                targetId: contactId,
                title: t("chatBackground.currentChat"),
              },
            })
          }
        >
          <SymbolView
            name="photo.on.rectangle.angled"
            size={17}
            weight="semibold"
            tintColor={theme.accent}
            style={styles.symbol}
          />
          <Text style={styles.actionText}>{t("chatBackground.currentChat")}</Text>
          <SymbolView
            name="chevron.right"
            size={12}
            weight="semibold"
            tintColor={theme.tertiaryText}
          />
        </Pressable>

        <Pressable
          accessibilityLabel={t("chat.clear.action")}
          accessibilityRole="button"
          accessibilityState={{ disabled: isClearing || !contactId, busy: isClearing }}
          disabled={isClearing || !contactId}
          style={({ pressed }) => [
            styles.actionCard,
            (isClearing || !contactId) && styles.disabled,
            pressed && !isClearing && styles.pressed,
          ]}
          onPress={confirmClearHistory}
        >
          <SymbolView
            name="trash"
            size={17}
            weight="semibold"
            tintColor={theme.danger}
            style={styles.symbol}
          />
          <Text style={styles.dangerText}>{t("chat.clear.action")}</Text>
        </Pressable>
      </ScrollView>

      <TopToast message={toastMessage} onDismiss={dismissToast} />

      {isClearing ? (
        <View
          accessibilityLabel={t("common.loading")}
          accessibilityRole="progressbar"
          accessibilityViewIsModal
          style={styles.progressOverlay}
        >
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : null}
    </View>
  );
}

function makeStyles(theme: ReturnType<typeof palette>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: {
      flexGrow: 1,
      padding: 16,
      rowGap: 18,
      backgroundColor: theme.background,
    },
    profileCard: {
      width: "100%",
      alignItems: "center",
      paddingVertical: 22,
      rowGap: 10,
      borderRadius: 12,
      backgroundColor: theme.card,
    },
    nickname: { color: theme.text, fontSize: 18, fontWeight: "600" },
    actionCard: {
      minHeight: 54,
      flexDirection: "row",
      alignItems: "center",
      columnGap: 12,
      padding: 16,
      borderRadius: 12,
      backgroundColor: theme.card,
    },
    symbol: { width: 28 },
    actionText: { flex: 1, color: theme.text, fontSize: 16 },
    dangerText: { flex: 1, color: theme.danger, fontSize: 16 },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.62 },
    progressOverlay: {
      position: "absolute",
      inset: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.08)",
    },
  });
}
