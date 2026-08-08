import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet } from "react-native";

import {
  ProfileGroupedCard,
  ProfileRowDivider,
  ProfileSettingsRow,
} from "@/components/profile/ProfileSettingsChrome";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { updateCopy } from "@/localization/updateCopy";
import {
  clearAllAccountData,
  clearCurrentAccountData,
  clearVideoCache,
  formatVideoCacheSize,
  formattedVideoCacheSize,
  subscribeVideoCacheSize,
} from "@/services/cache/AppCacheService";
import { colors } from "@/theme";

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { activeLanguage, selectedLanguageName, t } = useLocalization();
  const otaCopy = updateCopy(activeLanguage);
  const ownerId = user?.user_id ?? "";
  const [cacheSize, setCacheSize] = useState(() => formatVideoCacheSize(0));

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeVideoCacheSize(ownerId, (size) => {
      if (active) setCacheSize(size);
    });
    void formattedVideoCacheSize(ownerId)
      .then((size) => {
        if (active) setCacheSize(size);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [ownerId]);

  const confirmLogout = () => {
    Alert.alert(t("settings.logout.confirmTitle"), t("settings.logout.message"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("settings.logout.confirm"), style: "destructive", onPress: () => void signOut() },
    ]);
  };
  const confirmClearVideo = () => {
    Alert.alert(t("settings.cache.video.clear"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        style: "destructive",
        onPress: () => void clearVideoCache(ownerId).catch(() => undefined),
      },
    ]);
  };
  const confirmClearAccount = () => {
    Alert.alert(t("settings.cache.account.clear"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        style: "destructive",
        onPress: () => void clearCurrentAccountData(ownerId).catch(() => undefined),
      },
    ]);
  };
  const confirmClearAll = () => {
    Alert.alert(t("settings.cache.all.clear"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.confirm"),
        style: "destructive",
        onPress: () => void clearAllAccountData(ownerId).catch(() => undefined),
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: t("settings.title") }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ProfileGroupedCard>
          <ProfileSettingsRow
            title={t("settings.language")}
            trailingText={selectedLanguageName}
            systemImage="globe"
            gradient={["#2EC4B6", "#3A86FF"]}
            onPress={() => router.push("/language-settings")}
          />
          <ProfileRowDivider />
          <ProfileSettingsRow
            title={t("chatBackground.globalTitle")}
            systemImage="photo.on.rectangle.angled"
            gradient={["#3A86FF", "#7C3AED"]}
            onPress={() =>
              router.push({
                pathname: "/chat-background-settings",
                params: {
                  targetType: "global",
                  targetId: "global",
                  title: t("chatBackground.globalTitle"),
                },
              })
            }
          />
        </ProfileGroupedCard>

        <ProfileGroupedCard>
          <ProfileSettingsRow
            title={t("settings.usernameReset")}
            trailingText={user?.username ?? ""}
            systemImage="person.text.rectangle.fill"
            gradient={["#7C3AED", "#3A86FF"]}
            onPress={() => router.push("/username-reset")}
          />
          <ProfileRowDivider />
          <ProfileSettingsRow
            title={t("settings.changePassword")}
            systemImage="key.fill"
            gradient={["#3A86FF", "#2EC4B6"]}
            onPress={() => router.push("/change-password")}
          />
        </ProfileGroupedCard>

        <ProfileGroupedCard>
          <ProfileSettingsRow
            title={t("settings.cache.video")}
            trailingText={cacheSize}
            systemImage="externaldrive.fill"
            gradient={["#3A86FF", "#2EC4B6"]}
            onPress={confirmClearVideo}
          />
          <ProfileRowDivider />
          <ProfileSettingsRow
            title={t("settings.cache.account.clear")}
            systemImage="person.crop.circle.badge.minus"
            gradient={["#FF9F1C", "#FFBF69"]}
            onPress={confirmClearAccount}
          />
          <ProfileRowDivider />
          <ProfileSettingsRow
            title={t("settings.cache.all.clear")}
            systemImage="trash.fill"
            gradient={[colors.danger, "#FF6B6B"]}
            onPress={confirmClearAll}
          />
        </ProfileGroupedCard>

        <ProfileGroupedCard>
          <ProfileSettingsRow
            title={otaCopy.settingsEntry}
            systemImage="arrow.triangle.2.circlepath"
            gradient={["#16A34A", "#22C55E"]}
            onPress={() => router.push("/update-settings")}
          />
        </ProfileGroupedCard>

        <ProfileGroupedCard>
          <ProfileSettingsRow
            title={t("settings.logout")}
            systemImage="rectangle.portrait.and.arrow.right"
            gradient={[colors.danger, colors.danger]}
            danger
            showChevron={false}
            onPress={confirmLogout}
          />
        </ProfileGroupedCard>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 30,
    rowGap: 14,
    backgroundColor: colors.background,
  },
});
