import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getFriendList, getFriendRequests, getGroups } from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";
import { GroupAvatarIcon } from "@/components/GroupAvatarIcon";
import { RootTabTitle } from "@/components/RootTabTitle";
import type { ChatGroup, FriendInfo, FriendRequest } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import {
  loadFriendRequestsWithNativeCache,
  loadFriendsWithNativeCache,
} from "@/services/friends/FriendRepository";
import { loadGroupsWithNativeCache } from "@/services/groups/GroupRepository";
import { effectiveContactItems } from "@/services/remote-config/RemoteConfigService";
import type { DynamicSectionItem } from "@/services/remote-config/types";
import { localizedDynamicText, openDynamicRoute } from "@/services/web/DynamicRouteNavigator";
import { colors } from "@/theme";

const USER_CARD_HEIGHT = 72;

export default function ContactsScreen() {
  return <ContactsContent isRootTab />;
}

export function ContactsContent({ isRootTab = true }: { isRootTab?: boolean | undefined }) {
  const { user } = useAuth();
  const { activeLanguage, t } = useLocalization();
  const { config, refresh: refreshConfig } = useRemoteConfig();
  const ownerId = user?.user_id ?? "";
  const [contactsState, setContactsState] = useState<ContactsState>(emptyContactsState);
  const activeOwnerRef = useRef(ownerId);
  const loadGenerationRef = useRef(0);
  useEffect(() => {
    activeOwnerRef.current = ownerId;
    loadGenerationRef.current += 1;
  }, [ownerId]);
  const ownerStateIsCurrent = contactsState.ownerId === ownerId;
  const friends = ownerStateIsCurrent ? contactsState.friends : [];
  const requests = ownerStateIsCurrent ? contactsState.requests : [];
  const groups = ownerStateIsCurrent ? contactsState.groups : [];
  const isLoading = ownerStateIsCurrent ? contactsState.isLoading : Boolean(ownerId);
  const isRefreshing = ownerStateIsCurrent && contactsState.isRefreshing;
  const contactItems = useMemo(() => effectiveContactItems(config), [config]);

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!ownerId) return;
      const generation = ++loadGenerationRef.current;
      const isCurrent = () =>
        activeOwnerRef.current === ownerId && loadGenerationRef.current === generation;
      setContactsState((current) => ({
        ownerId,
        friends: current.ownerId === ownerId ? current.friends : [],
        requests: current.ownerId === ownerId ? current.requests : [],
        groups: current.ownerId === ownerId ? current.groups : [],
        isLoading: forceRefresh ? current.ownerId !== ownerId : true,
        isRefreshing: forceRefresh,
      }));

      const [configResult, friendsResult, requestsResult, groupsResult] = await Promise.allSettled([
        refreshConfig(forceRefresh ? { ignoreETag: true } : undefined),
        loadFriendsWithNativeCache(ownerId, getFriendList, { forceRefresh }),
        loadFriendRequestsWithNativeCache(ownerId, getFriendRequests, { forceRefresh }),
        loadGroupsWithNativeCache(ownerId, getGroups, { forceRefresh }),
      ]);
      void configResult;
      if (!isCurrent()) return;
      setContactsState((current) => {
        if (current.ownerId !== ownerId) return current;
        return {
          ownerId,
          friends: friendsResult.status === "fulfilled" ? friendsResult.value : current.friends,
          requests: requestsResult.status === "fulfilled" ? requestsResult.value : current.requests,
          groups: groupsResult.status === "fulfilled" ? groupsResult.value : current.groups,
          isLoading: false,
          isRefreshing: false,
        };
      });
    },
    [ownerId, refreshConfig],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        loadGenerationRef.current += 1;
      };
    }, [load]),
  );

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => void load(true)}
          tintColor={colors.accent}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {isRootTab ? (
        <RootTabTitle localizedKey="tab.contacts" style={styles.rootTitle} />
      ) : (
        <View style={styles.pushedTopSpacer} />
      )}

      <View style={styles.modules}>
        {contactItems.map((item) => (
          <ContactModuleRow
            key={item.id}
            item={item}
            title={dynamicTitle(item, activeLanguage, t)}
            requestCount={requests.length}
            groupCount={groups.length}
            onAlert={(title, message) => Alert.alert(title, message, [{ text: t("common.ok") }])}
          />
        ))}
      </View>

      {friends.length === 0 && !isLoading ? (
        <View style={styles.emptyState}>
          <SymbolView name="person.2.slash" size={36} tintColor={colors.tertiaryText} />
          <Text style={styles.emptyTitle}>{t("contacts.empty.title")}</Text>
          <Text style={styles.emptySubtitle}>{t("contacts.empty.subtitle")}</Text>
        </View>
      ) : (
        <View style={styles.friendsSection}>
          <Text style={styles.sectionTitle}>{t("contacts.friends.count", friends.length)}</Text>
          <View style={styles.friendsCard}>
            {friends.map((friend, index) => (
              <View key={friend.user_id}>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/chat/[id]",
                      params: {
                        id: friend.user_id,
                        name: friend.nickname,
                        avatar: friend.avatar_url,
                      },
                    })
                  }
                  style={({ pressed }) => [styles.friendRow, pressed && styles.pressed]}
                >
                  <Avatar uri={friend.avatar_url} name={friend.nickname} size={42} />
                  <Text numberOfLines={1} style={styles.friendName}>
                    {friend.nickname}
                  </Text>
                  <SymbolView
                    name="chevron.right"
                    size={13}
                    weight="semibold"
                    tintColor={colors.tertiaryText}
                  />
                </Pressable>
                {index < friends.length - 1 ? <View style={styles.friendDivider} /> : null}
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

interface ContactsState {
  ownerId: string;
  friends: FriendInfo[];
  requests: FriendRequest[];
  groups: ChatGroup[];
  isLoading: boolean;
  isRefreshing: boolean;
}

const emptyContactsState: ContactsState = {
  ownerId: "",
  friends: [],
  requests: [],
  groups: [],
  isLoading: true,
  isRefreshing: false,
};

function ContactModuleRow({
  item,
  title,
  requestCount,
  groupCount,
  onAlert,
}: {
  item: DynamicSectionItem;
  title: string;
  requestCount: number;
  groupCount: number;
  onAlert: (title: string, message: string) => void;
}) {
  const { activeLanguage, t } = useLocalization();
  const { config } = useRemoteConfig();
  const id = normalized(item.id);
  const subtitle = dynamicSubtitle(item, activeLanguage, t);
  const open = async () => {
    const outcome = await openDynamicRoute(
      item.route ?? { type: "native", name: item.id },
      config.webViewPolicy,
      title,
      t("discover.comingSoon"),
      activeLanguage,
      t,
    );
    if (!outcome.handled) onAlert(outcome.title, outcome.message);
  };
  return (
    <Pressable
      onPress={() => void open()}
      style={({ pressed }) => [styles.moduleRow, pressed && styles.pressed]}
    >
      {id === "my_groups" ? <GroupAvatarIcon size={40} /> : <DynamicIcon item={item} />}
      <View style={styles.moduleBody}>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          numberOfLines={1}
          style={styles.moduleTitle}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.moduleSubtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {id === "my_groups" ? (
        <Text numberOfLines={1} style={styles.trailingText}>
          {t("contacts.myGroups.count", groupCount)}
        </Text>
      ) : null}
      {id === "friend_requests" && requestCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{requestCount}</Text>
        </View>
      ) : null}
      <SymbolView
        name="chevron.right"
        size={13}
        weight="semibold"
        tintColor={colors.tertiaryText}
      />
    </Pressable>
  );
}

function DynamicIcon({ item }: { item: DynamicSectionItem }) {
  const iconColors = (item.colors ?? [colors.accent]).map(normalizeColor);
  const fill =
    iconColors.length > 1 ? (
      <LinearGradient
        colors={[iconColors[0] ?? colors.accent, iconColors[1] ?? colors.accent]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    ) : (
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: iconColors[0] ?? colors.accent }]}
      />
    );
  return (
    <View style={styles.dynamicIcon}>
      {fill}
      <SymbolView
        name={(item.systemImage as SFSymbol | undefined) ?? "sparkles"}
        size={17}
        weight="semibold"
        tintColor={colors.white}
      />
    </View>
  );
}

function dynamicTitle(
  item: DynamicSectionItem,
  language: string,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const titleKey = item.titleKey?.trim();
  const translated = titleKey ? t(titleKey) : "";
  return (
    localizedDynamicText(item.titleI18n, language) ||
    (titleKey && translated !== titleKey ? translated : "") ||
    item.title?.trim() ||
    item.id
  );
}

function dynamicSubtitle(
  item: DynamicSectionItem,
  language: string,
  t: (key: string, ...args: (string | number)[]) => string,
): string | undefined {
  const subtitleKey = item.subtitleKey?.trim();
  const translated = subtitleKey ? t(subtitleKey) : "";
  return (
    localizedDynamicText(item.subtitleI18n, language) ||
    (subtitleKey && translated !== subtitleKey ? translated : "") ||
    item.subtitle?.trim() ||
    undefined
  );
}

function normalizeColor(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

const styles = StyleSheet.create({
  content: { paddingBottom: 20, backgroundColor: colors.background },
  rootTitle: {
    marginHorizontal: 16,
    paddingBottom: 12,
  },
  pushedTopSpacer: { height: 16 },
  modules: { paddingBottom: 12, rowGap: 10 },
  moduleRow: {
    minHeight: USER_CARD_HEIGHT,
    marginHorizontal: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
    backgroundColor: colors.card,
  },
  moduleBody: { flex: 1, minWidth: 0, rowGap: 3 },
  moduleTitle: { color: colors.text, fontSize: 16, fontWeight: "500" },
  moduleSubtitle: { color: colors.secondaryText, fontSize: 12 },
  trailingText: { color: colors.secondaryText, fontSize: 13 },
  dynamicIcon: {
    width: 40,
    height: 40,
    overflow: "hidden",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: colors.danger,
  },
  badgeText: { color: colors.white, fontSize: 12, fontWeight: "700" },
  emptyState: { alignItems: "center", paddingTop: 40, rowGap: 14 },
  emptyTitle: { color: colors.secondaryText, fontSize: 15 },
  emptySubtitle: { color: colors.tertiaryText, fontSize: 13 },
  friendsSection: { alignItems: "stretch" },
  sectionTitle: {
    paddingLeft: 24,
    paddingRight: 16,
    paddingTop: 20,
    paddingBottom: 8,
    color: colors.secondaryText,
    fontSize: 13,
    fontWeight: "500",
    textTransform: "uppercase",
  },
  friendsCard: {
    marginHorizontal: 16,
    overflow: "hidden",
    borderRadius: 14,
    backgroundColor: colors.card,
  },
  friendRow: {
    minHeight: USER_CARD_HEIGHT,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  friendName: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "500" },
  friendDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 70,
    backgroundColor: colors.separator,
  },
  pressed: { opacity: 0.68 },
});
