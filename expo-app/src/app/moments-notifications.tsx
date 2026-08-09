import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { getMomentsNotifications } from "@/api/bwchat";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { Avatar } from "@/components/Avatar";
import { env } from "@/config/env";
import type { MomentsNotification } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  readCachedMomentsNotifications,
  saveCachedMomentsNotifications,
} from "@/services/moments/MomentsNotificationRepository";
import { markMomentsNotificationsReadEverywhere } from "@/services/moments/MomentsReadService";
import { clearMomentsUnread } from "@/services/moments/MomentsUnreadStore";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export default function MomentsNotificationsScreen() {
  const { user } = useAuth();
  const { t } = useLocalization();
  const ownerId = user?.user_id ?? "";
  const [notifications, setNotifications] = useState<MomentsNotification[]>([]);
  const [isLoading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!ownerId) {
      setLoading(false);
      return;
    }
    const cached = await readCachedMomentsNotifications(ownerId);
    if (cached) {
      setNotifications(cached);
      setLoading(false);
    }
    try {
      const remote = await getMomentsNotifications(50);
      setNotifications(remote.slice(0, 500));
      await saveCachedMomentsNotifications(ownerId, remote);
    } catch {
      // Native notification list intentionally keeps cache and suppresses errors.
    } finally {
      setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    clearMomentsUnread(ownerId);
    void markMomentsNotificationsReadEverywhere().catch(() => undefined);
    return () => clearTimeout(timer);
  }, [load, ownerId]);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: t("moments.messages.title") }} />
      {isLoading && notifications.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : notifications.length === 0 ? (
        <View style={styles.empty}>
          <SymbolView name="bell.slash" size={36} tintColor={colors.tertiaryText} />
          <Text style={styles.emptyText}>{t("moments.noMessages")}</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <NotificationRow
              notification={item}
              onPress={() =>
                router.push({
                  pathname: "/moment-detail",
                  params: { momentId: String(item.moment_id) },
                })
              }
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

function NotificationRow({
  notification,
  onPress,
}: {
  notification: MomentsNotification;
  onPress: () => void;
}) {
  const { t } = useLocalization();
  const firstImage = notification.moment_images?.find((item) => item.trim());
  const resolvedImage = resolveMediaUrl(firstImage, env.apiBaseUrl);
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <Avatar name={notification.user.nickname} size={40} uri={notification.user.avatar_url} />
      <View style={styles.copy}>
        <View style={styles.titleLine}>
          <Text style={styles.name}>{notification.user.nickname}</Text>
          <Text style={styles.action}>
            {t(
              notification.type === "like"
                ? "moments.notification.like"
                : "moments.notification.comment",
            )}
          </Text>
        </View>
        {notification.type === "comment" && notification.content ? (
          <Text numberOfLines={2} style={styles.comment}>
            {notification.content}
          </Text>
        ) : null}
        <Text style={styles.time}>{formatRelativeTime(notification.created_at)}</Text>
      </View>
      {resolvedImage ? (
        <AuthenticatedImage
          contentFit="cover"
          style={styles.preview}
          transition={0}
          uri={resolvedImage}
        />
      ) : notification.moment_content ? (
        <View style={styles.textPreview}>
          <Text numberOfLines={2} style={styles.previewText}>
            {notification.moment_content}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}小时前`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}天前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}-${date.getDate()}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { marginTop: 54 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    rowGap: 14,
  },
  emptyText: { color: colors.secondaryText, fontSize: 15 },
  row: {
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 10,
    backgroundColor: colors.card,
  },
  copy: { flex: 1, rowGap: 4 },
  titleLine: { flexDirection: "row", flexWrap: "wrap" },
  name: { color: "#576B95", fontSize: 14, fontWeight: "600" },
  action: { color: colors.text, fontSize: 14 },
  comment: { color: colors.secondaryText, fontSize: 13 },
  time: { color: colors.tertiaryText, fontSize: 11 },
  preview: { width: 44, height: 44, borderRadius: 4 },
  textPreview: {
    width: 44,
    height: 44,
    padding: 3,
    borderRadius: 4,
    justifyContent: "center",
    backgroundColor: "rgba(240,240,245,0.5)",
  },
  previewText: { color: colors.secondaryText, fontSize: 11 },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 66,
    backgroundColor: colors.separator,
  },
});
