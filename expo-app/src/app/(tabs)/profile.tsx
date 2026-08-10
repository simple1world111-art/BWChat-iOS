import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";
import QRCode from "react-native-qrcode-svg";

import { getProfile, getWalletGoldCoinBalance } from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import { RootTabTitle } from "@/components/RootTabTitle";
import { TopToast } from "@/components/TopToast";
import type { User } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import {
  profileLoadCanCommit,
  profileMenuSubtitle,
  profileMenuTitle,
  profileResponseBelongsToOwner,
} from "@/services/profile/ProfileScreenPolicy";
import {
  defaultContactModules,
  defaultProfileSections,
} from "@/services/remote-config/defaultConfig";
import {
  effectiveContactItems,
  effectiveProfileItems,
} from "@/services/remote-config/RemoteConfigService";
import type { DynamicSectionItem } from "@/services/remote-config/types";
import { openDynamicRoute } from "@/services/web/DynamicRouteNavigator";
import { colors, palette } from "@/theme";

const defaultItems = [...defaultProfileSections, ...defaultContactModules].flatMap(
  (section) => section.items,
);

export const profileScreenMetrics = Object.freeze({
  contentGap: 14,
  horizontalInset: 16,
  heroVerticalInset: 18,
  heroRadius: 18,
  heroGap: 14,
  avatarFrame: 82,
  avatarSize: 76,
  bioLineHeight: 20,
  bioVerticalCompensation: -1.5,
  actionHeight: 42,
  featureGap: 12,
  cardVerticalInset: 10,
  cardRadius: 14,
  rowMinHeight: 50,
  rowVerticalInset: 5,
  iconSize: 40,
  dividerHeight: 21,
  dividerLineHeight: 1,
  dividerLeadingInset: 55,
});

export default function ProfileScreen() {
  const { user: sessionUser, updateUser } = useAuth();
  const { activeLanguage, t } = useLocalization();
  const { config, refresh: refreshConfig } = useRemoteConfig();
  const theme = palette(useColorScheme());
  const styles = useProfileStyles();
  const ownerId = sessionUser?.user_id.trim() ?? "";
  const [profile, setProfile] = useState<User | null>(sessionUser);
  const [walletSnapshot, setWalletSnapshot] = useState<{
    ownerId: string;
    balance: number;
  } | null>(null);
  const [walletLoadingOwner, setWalletLoadingOwner] = useState<string | null>(null);
  const [refreshingSnapshot, setRefreshingSnapshot] = useState<{
    ownerId: string;
    generation: number;
  } | null>(null);
  const [errorSnapshot, setErrorSnapshot] = useState<{
    ownerId: string;
    message: string;
  } | null>(null);
  const [sharingOwner, setSharingOwner] = useState<string | null>(null);
  const [toastSnapshot, setToastSnapshot] = useState<{
    ownerId: string;
    message: string;
  } | null>(null);
  const activeOwnerRef = useRef(ownerId);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    activeOwnerRef.current = ownerId;
    loadGenerationRef.current += 1;
  }, [ownerId]);

  const load = useCallback(
    async (showRefresh = false) => {
      const targetOwnerId = ownerId;
      if (!targetOwnerId) return;
      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;
      if (showRefresh) setRefreshingSnapshot({ ownerId: targetOwnerId, generation });
      setWalletLoadingOwner(targetOwnerId);
      const [profileResult, walletResult] = await Promise.allSettled([
        getProfile(),
        getWalletGoldCoinBalance(),
      ]);
      if (
        !profileLoadCanCommit({
          generation,
          currentGeneration: loadGenerationRef.current,
          targetOwnerId,
          activeOwnerId: activeOwnerRef.current,
        })
      ) {
        setRefreshingSnapshot((current) => (current?.generation === generation ? null : current));
        return;
      }
      if (profileResult.status === "fulfilled") {
        const returnedOwnerId = profileResult.value.user_id.trim();
        if (profileResponseBelongsToOwner(returnedOwnerId, targetOwnerId)) {
          setProfile(profileResult.value);
          setErrorSnapshot(null);
          await updateUser(profileResult.value);
        }
      } else {
        const hasCachedProfile = sessionUser?.user_id.trim() === targetOwnerId;
        if (!hasCachedProfile) {
          setErrorSnapshot({
            ownerId: targetOwnerId,
            message:
              profileResult.reason instanceof Error && profileResult.reason.message.trim()
                ? profileResult.reason.message
                : t("common.loadFailed"),
          });
        }
      }
      if (walletResult.status === "fulfilled") {
        setWalletSnapshot({ ownerId: targetOwnerId, balance: walletResult.value });
      }
      setWalletLoadingOwner(null);
      setRefreshingSnapshot(null);
    },
    [ownerId, sessionUser?.user_id, t, updateUser],
  );

  useFocusEffect(
    useCallback(() => {
      void refreshConfig();
      void load();
    }, [load, refreshConfig]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void refreshConfig();
      void load();
    });
    return () => subscription.remove();
  }, [load, refreshConfig]);

  const user =
    sessionUser?.user_id.trim() === ownerId
      ? sessionUser
      : profile?.user_id.trim() === ownerId
        ? profile
        : null;
  const walletBalance = walletSnapshot?.ownerId === ownerId ? walletSnapshot.balance : null;
  const isWalletLoading = walletLoadingOwner === ownerId;
  const isRefreshing = refreshingSnapshot?.ownerId === ownerId;
  const error = errorSnapshot?.ownerId === ownerId ? errorSnapshot.message : null;
  const toastMessage = toastSnapshot?.ownerId === ownerId ? toastSnapshot.message : null;
  const username = clean(user?.username) || clean(user?.nickname) || t("profile.defaultUser");
  const userId = clean(user?.user_id);
  const bio = clean(user?.bio) || t("profile.emptyBio");
  const profileLink = `bwchat://profile/${encodeURIComponent(clean(user?.username) || userId)}`;
  const effectiveItems = useMemo(() => effectiveProfileItems(config), [config]);
  const effectiveContacts = useMemo(() => effectiveContactItems(config), [config]);
  const findItem = useCallback(
    (id: string) =>
      effectiveItems.find((item) => normalized(item.id) === id) ??
      effectiveContacts.find((item) => normalized(item.id) === id) ??
      defaultItems.find((item) => normalized(item.id) === id),
    [effectiveContacts, effectiveItems],
  );
  const walletItem = findItem("wallet");
  const propBagItem = findItem("prop_bag");
  const mainItems = [findItem("my_moments"), findItem("agent_hub")].filter(
    (item): item is DynamicSectionItem => item !== undefined,
  );
  const itemTitle = useCallback(
    (item: DynamicSectionItem) => profileMenuTitle(item, activeLanguage, t),
    [activeLanguage, t],
  );
  const itemSubtitle = useCallback(
    (item: DynamicSectionItem) => profileMenuSubtitle(item, activeLanguage, t),
    [activeLanguage, t],
  );
  const openItem = useCallback(
    async (item: DynamicSectionItem) => {
      const title = itemTitle(item);
      const outcome = await openDynamicRoute(
        item.route ?? { type: "native", name: item.id },
        config.webViewPolicy,
        title,
        t("discover.comingSoon"),
        activeLanguage,
        t,
      );
      if (!outcome.handled) {
        // Mirrors DynamicRouteHandler.alert without leaking route internals.
        const { Alert } = await import("react-native");
        Alert.alert(outcome.title, outcome.message, [{ text: t("common.ok") }]);
      }
    },
    [activeLanguage, config.webViewPolicy, itemTitle, t],
  );
  const copyProfileLink = useCallback(async () => {
    await Clipboard.setStringAsync(profileLink);
    setSharingOwner(null);
    setToastSnapshot({ ownerId, message: t("profile.more.linkCopied") });
  }, [ownerId, profileLink, t]);

  return (
    <>
      <ScrollView
        style={{ backgroundColor: theme.background }}
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
        <View style={styles.rootTitleSpacing}>
          <RootTabTitle localizedKey="tab.profile" />
        </View>

        <ProfileHero
          user={user}
          username={username}
          userId={userId}
          bio={bio}
          postsTitle={t("profile.posts")}
          followersTitle={t("follow.followers")}
          followingTitle={t("follow.following")}
          editTitle={t("profile.edit.title")}
          shareTitle={t("profile.more.share")}
          onEdit={() => router.push("/edit-profile")}
          onShare={() => setSharingOwner(ownerId)}
        />

        {error ? <NoticeBanner message={error} /> : null}

        <View style={styles.featureCards}>
          {walletItem ? (
            <GroupedCard>
              <ProfileMenuRow
                item={walletItem}
                title={itemTitle(walletItem)}
                subtitle={itemSubtitle(walletItem)}
                trailingText={
                  walletBalance !== null
                    ? t("profile.wallet.balance", walletBalance)
                    : isWalletLoading
                      ? t("common.loading")
                      : t("common.tapToView")
                }
                onPress={() => void openItem(walletItem)}
              />
            </GroupedCard>
          ) : null}

          {mainItems.length > 0 ? (
            <GroupedCard>
              {mainItems.map((item, index) => (
                <View key={item.id}>
                  <ProfileMenuRow
                    item={item}
                    title={itemTitle(item)}
                    subtitle={itemSubtitle(item)}
                    onPress={() => void openItem(item)}
                  />
                  {index < mainItems.length - 1 ? <RowDivider /> : null}
                </View>
              ))}
            </GroupedCard>
          ) : null}

          {propBagItem ? (
            <GroupedCard>
              <ProfileMenuRow
                item={propBagItem}
                title={itemTitle(propBagItem)}
                subtitle={itemSubtitle(propBagItem)}
                onPress={() => void openItem(propBagItem)}
              />
            </GroupedCard>
          ) : null}
        </View>

        <GroupedCard>
          <ProfileMenuRow
            item={{
              id: "settings",
              titleKey: "settings.title",
              systemImage: "gearshape.fill",
              colors: ["5E6AD2", "2EC4B6"],
            }}
            title={t("settings.title")}
            onPress={() => router.push("/settings")}
          />
        </GroupedCard>
      </ScrollView>

      <ProfileShareSheet
        visible={sharingOwner === ownerId && ownerId.length > 0}
        username={username}
        avatarUrl={user?.avatar_url}
        bio={bio}
        userId={userId}
        profileLink={profileLink}
        shareTitle={t("profile.more.share")}
        copyTitle={t("profile.more.copyLink")}
        cancelTitle={t("common.cancel")}
        idMissing={t("profile.idMissing")}
        onCopyLink={copyProfileLink}
        onClose={() => setSharingOwner(null)}
      />
      <TopToast message={toastMessage} onDismiss={() => setToastSnapshot(null)} />
    </>
  );
}

function ProfileHero({
  user,
  username,
  userId,
  bio,
  postsTitle,
  followersTitle,
  followingTitle,
  editTitle,
  shareTitle,
  onEdit,
  onShare,
}: {
  user: User | null;
  username: string;
  userId: string;
  bio: string;
  postsTitle: string;
  followersTitle: string;
  followingTitle: string;
  editTitle: string;
  shareTitle: string;
  onEdit: () => void;
  onShare: () => void;
}) {
  const styles = useProfileStyles();
  return (
    <View style={styles.hero}>
      <View style={styles.heroTopRow}>
        <LinearGradient colors={[colors.accent, colors.accentDark]} style={styles.avatarBorder}>
          <View style={styles.avatarInner}>
            <Avatar uri={user?.avatar_url} name={username} size={profileScreenMetrics.avatarSize} />
          </View>
        </LinearGradient>

        <View style={styles.identityColumn}>
          <View style={styles.titleRow}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.68}
              style={styles.name}
              accessibilityRole="header"
            >
              {username}
            </Text>
          </View>

          <View style={styles.stats}>
            <ProfileStat title={postsTitle} value={user?.posts_count ?? user?.moments_count ?? 0} />
            <ProfileStat
              title={followersTitle}
              value={user?.follower_count ?? 0}
              onPress={
                userId
                  ? () =>
                      router.push({
                        pathname: "/follow-list",
                        params: { kind: "followers", userId },
                      })
                  : undefined
              }
            />
            <ProfileStat
              title={followingTitle}
              value={user?.following_count ?? 0}
              onPress={
                userId
                  ? () =>
                      router.push({
                        pathname: "/follow-list",
                        params: { kind: "following", userId },
                      })
                  : undefined
              }
            />
          </View>
        </View>
      </View>

      <Text numberOfLines={3} style={styles.bio}>
        {bio}
      </Text>

      <View style={styles.actions}>
        <HeroAction title={editTitle} symbol="square.and.pencil" onPress={onEdit} />
        <HeroAction title={shareTitle} symbol="square.and.arrow.up" onPress={onShare} />
      </View>
      <View pointerEvents="none" style={styles.heroOutline} />
    </View>
  );
}

function ProfileStat({
  title,
  value,
  onPress,
}: {
  title: string;
  value: number;
  onPress?: (() => void) | undefined;
}) {
  const styles = useProfileStyles();
  const content = (
    <View style={styles.statContent}>
      <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.statValue}>
        {formattedCount(value)}
      </Text>
      <Text adjustsFontSizeToFit minimumFontScale={0.68} numberOfLines={1} style={styles.statTitle}>
        {title}
      </Text>
    </View>
  );
  return onPress ? (
    <Pressable
      accessibilityLabel={`${title}, ${formattedCount(value)}`}
      accessibilityRole="button"
      onPress={onPress}
    >
      {content}
    </Pressable>
  ) : (
    content
  );
}

function HeroAction({
  title,
  symbol,
  onPress,
}: {
  title: string;
  symbol: SFSymbol;
  onPress: () => void;
}) {
  const styles = useProfileStyles();
  const theme = palette(useColorScheme());
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      style={({ pressed }) => [styles.heroAction, pressed && styles.pressed]}
      onPress={onPress}
    >
      <SymbolView name={symbol} size={15} weight="semibold" tintColor={theme.text} />
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        numberOfLines={1}
        style={styles.heroActionText}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function GroupedCard({ children }: { children: React.ReactNode }) {
  const styles = useProfileStyles();
  return (
    <View style={styles.groupedCard}>
      {children}
      <View pointerEvents="none" style={styles.groupedCardOutline} />
    </View>
  );
}

function ProfileMenuRow({
  item,
  title,
  subtitle,
  trailingText,
  onPress,
}: {
  item: DynamicSectionItem;
  title: string;
  subtitle?: string | undefined;
  trailingText?: string;
  onPress: () => void;
}) {
  const styles = useProfileStyles();
  const theme = palette(useColorScheme());
  const itemColors = item.colors?.map(colorHex).filter(Boolean) ?? [];
  const gradient = itemColors.length > 0 ? itemColors : [colors.accent, colors.accentDark];
  return (
    <Pressable
      accessibilityLabel={[title, subtitle, trailingText].filter(Boolean).join(", ")}
      accessibilityRole="button"
      style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
      onPress={onPress}
    >
      <LinearGradient
        colors={[gradient[0] as string, gradient[1] ?? (gradient[0] as string)]}
        style={styles.menuIcon}
      >
        <SymbolView name={symbolForItem(item)} size={17} weight="semibold" tintColor="#FFFFFF" />
      </LinearGradient>
      <View style={styles.menuCopy}>
        <Text
          adjustsFontSizeToFit
          minimumFontScale={0.82}
          numberOfLines={1}
          style={styles.menuTitle}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.82}
            numberOfLines={1}
            style={styles.menuSubtitle}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.menuTrailing}>
        {trailingText ? (
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            numberOfLines={1}
            style={styles.trailingText}
          >
            {trailingText}
          </Text>
        ) : null}
        <SymbolView name="chevron.right" size={13} weight="bold" tintColor={theme.tertiaryText} />
      </View>
    </Pressable>
  );
}

function NoticeBanner({ message }: { message: string }) {
  const styles = useProfileStyles();
  return (
    <View style={styles.notice}>
      <SymbolView
        name="exclamationmark.circle.fill"
        size={15}
        weight="semibold"
        tintColor="#8A4B00"
      />
      <Text numberOfLines={2} style={styles.noticeText}>
        {message}
      </Text>
    </View>
  );
}

function RowDivider() {
  const styles = useProfileStyles();
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
    </View>
  );
}

function ProfileShareSheet({
  visible,
  username,
  avatarUrl,
  bio,
  userId,
  profileLink,
  shareTitle,
  copyTitle,
  cancelTitle,
  idMissing,
  onCopyLink,
  onClose,
}: {
  visible: boolean;
  username: string;
  avatarUrl?: string | undefined;
  bio: string;
  userId: string;
  profileLink: string;
  shareTitle: string;
  copyTitle: string;
  cancelTitle: string;
  idMissing: string;
  onCopyLink: () => Promise<void>;
  onClose: () => void;
}) {
  const styles = useProfileStyles();
  const theme = palette(useColorScheme());
  const share = async () => {
    await Share.share({ message: profileLink, url: profileLink, title: username });
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.shareSheet}>
        <View style={styles.dragHandle} />
        <View style={styles.sheetHeader}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {shareTitle}
          </Text>
          <Pressable
            accessibilityLabel={cancelTitle}
            accessibilityRole="button"
            style={styles.closeButton}
            onPress={onClose}
          >
            <SymbolView name="xmark" size={13} weight="bold" tintColor={theme.secondaryText} />
          </Pressable>
        </View>
        <View style={styles.sheetDivider} />
        <ScrollView
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.shareCard}>
            <View style={styles.shareIdentity}>
              <Avatar uri={avatarUrl} name={username} size={62} />
              <View style={styles.shareIdentityCopy}>
                <Text numberOfLines={1} style={styles.shareName}>
                  {username}
                </Text>
                <Text numberOfLines={1} style={styles.shareId}>
                  {userId ? `ID: ${userId}` : idMissing}
                </Text>
                {bio ? (
                  <Text numberOfLines={2} style={styles.shareBio}>
                    {bio}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.shareCardDivider} />
            <View style={styles.qrFrame}>
              <QRCode
                value={profileLink}
                size={172}
                ecl="M"
                backgroundColor="#FFFFFF"
                color={colors.text}
              />
            </View>
          </View>
          <Pressable
            accessibilityLabel={shareTitle}
            accessibilityRole="button"
            style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
            onPress={() => void share()}
          >
            <SymbolView
              name="square.and.arrow.up"
              size={16}
              weight="semibold"
              tintColor="#FFFFFF"
            />
            <Text style={styles.shareButtonText}>{shareTitle}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={copyTitle}
            accessibilityRole="button"
            style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}
            onPress={() => void onCopyLink()}
          >
            <SymbolView name="link" size={16} weight="semibold" tintColor={theme.text} />
            <Text style={styles.copyButtonText}>{copyTitle}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function symbolForItem(item: DynamicSectionItem): SFSymbol {
  const symbols: Record<string, SFSymbol> = {
    wallet: "pawprint.fill",
    prop_bag: "shippingbox.fill",
    my_moments: "camera.fill",
    agent_hub: "sparkles",
    my_short_dramas: "play.rectangle.fill",
    contacts: "person.2.fill",
    settings: "gearshape.fill",
  };
  return symbols[normalized(item.id)] ?? "sparkles";
}

function formattedCount(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".0", "")}M`;
  if (absolute >= 10_000) return `${(value / 1_000).toFixed(1).replace(".0", "")}K`;
  return String(value);
}

function colorHex(value: string): string {
  const cleanValue = value.trim().replace(/^#/, "");
  return /^[0-9A-Fa-f]{6}$/.test(cleanValue) ? `#${cleanValue}` : colors.accent;
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function useProfileStyles() {
  const scheme = useColorScheme();
  return useMemo(() => createProfileStyles(palette(scheme)), [scheme]);
}

function createProfileStyles(theme: ReturnType<typeof palette>) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: profileScreenMetrics.horizontalInset,
      paddingBottom: 28,
      rowGap: profileScreenMetrics.contentGap,
      backgroundColor: theme.background,
    },
    rootTitleSpacing: { paddingBottom: 2 },
    hero: {
      width: "100%",
      paddingHorizontal: profileScreenMetrics.horizontalInset,
      paddingVertical: profileScreenMetrics.heroVerticalInset,
      rowGap: profileScreenMetrics.heroGap,
      borderRadius: profileScreenMetrics.heroRadius,
      backgroundColor: theme.card,
    },
    heroOutline: {
      position: "absolute",
      inset: 0,
      borderRadius: profileScreenMetrics.heroRadius,
      borderWidth: 1,
      borderColor: `${theme.separator}B3`,
    },
    heroTopRow: { flexDirection: "row", alignItems: "flex-start", columnGap: 14 },
    avatarBorder: {
      width: profileScreenMetrics.avatarFrame,
      height: profileScreenMetrics.avatarFrame,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarInner: {
      width: 78,
      height: 78,
      borderRadius: 18,
      padding: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.card,
    },
    identityColumn: { flex: 1, paddingTop: 3, alignItems: "flex-start", rowGap: 5 },
    titleRow: {
      width: "100%",
      paddingLeft: 12,
      flexDirection: "row",
      alignItems: "center",
      columnGap: 8,
    },
    name: { flexShrink: 1, color: theme.text, fontSize: 24, fontWeight: "700" },
    stats: { width: "100%", flexDirection: "row", alignItems: "flex-start", columnGap: 8 },
    statContent: { width: 48, minHeight: 40, alignItems: "center", rowGap: 1 },
    statValue: {
      color: theme.text,
      fontSize: 22,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    statTitle: { color: theme.secondaryText, fontSize: 13, fontWeight: "600" },
    bio: {
      paddingHorizontal: 2,
      color: theme.text,
      fontSize: 14,
      lineHeight: profileScreenMetrics.bioLineHeight,
      marginVertical: profileScreenMetrics.bioVerticalCompensation,
      fontWeight: "500",
    },
    actions: { flexDirection: "row", columnGap: 8 },
    heroAction: {
      flex: 1,
      height: profileScreenMetrics.actionHeight,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      columnGap: 6,
      borderRadius: 10,
      backgroundColor: theme.background,
    },
    heroActionText: { color: theme.text, fontSize: 15, fontWeight: "600" },
    pressed: { opacity: 0.72 },
    featureCards: { rowGap: profileScreenMetrics.featureGap },
    groupedCard: {
      paddingHorizontal: profileScreenMetrics.horizontalInset,
      paddingVertical: profileScreenMetrics.cardVerticalInset,
      borderRadius: profileScreenMetrics.cardRadius,
      backgroundColor: theme.card,
    },
    groupedCardOutline: {
      position: "absolute",
      inset: 0,
      borderRadius: profileScreenMetrics.cardRadius,
      borderWidth: 1,
      borderColor: `${theme.separator}B3`,
    },
    menuRow: {
      minHeight: profileScreenMetrics.rowMinHeight,
      paddingVertical: profileScreenMetrics.rowVerticalInset,
      flexDirection: "row",
      alignItems: "center",
      columnGap: 13,
    },
    menuIcon: {
      width: profileScreenMetrics.iconSize,
      height: profileScreenMetrics.iconSize,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    menuCopy: { flex: 1, alignItems: "flex-start", rowGap: 3 },
    menuTitle: { color: theme.text, fontSize: 16, fontWeight: "600" },
    menuSubtitle: { color: theme.secondaryText, fontSize: 12, fontWeight: "500" },
    menuTrailing: { maxWidth: "48%", flexDirection: "row", alignItems: "center", columnGap: 5 },
    trailingText: { flexShrink: 1, color: theme.secondaryText, fontSize: 13, fontWeight: "600" },
    divider: {
      height: profileScreenMetrics.dividerHeight,
      marginLeft: profileScreenMetrics.dividerLeadingInset,
      justifyContent: "center",
    },
    dividerLine: {
      height: profileScreenMetrics.dividerLineHeight,
      backgroundColor: theme.separator,
    },
    notice: {
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
      columnGap: 10,
      borderRadius: 16,
      backgroundColor: "#FFF2CC",
    },
    noticeText: { flex: 1, color: "#8A4B00", fontSize: 13, lineHeight: 18, fontWeight: "500" },
    modalBackdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.28)" },
    shareSheet: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: "78%",
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      overflow: "hidden",
      backgroundColor: theme.card,
    },
    dragHandle: {
      width: 38,
      height: 4,
      marginTop: 8,
      marginBottom: 12,
      alignSelf: "center",
      borderRadius: 2,
      backgroundColor: theme.separator,
    },
    sheetHeader: {
      paddingHorizontal: 20,
      paddingBottom: 14,
      flexDirection: "row",
      alignItems: "center",
    },
    sheetTitle: { flex: 1, color: theme.text, fontSize: 20, fontWeight: "700" },
    closeButton: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 16,
      backgroundColor: theme.background,
    },
    sheetDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.separator },
    sheetContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, rowGap: 10 },
    shareCard: {
      padding: 18,
      marginBottom: 6,
      alignItems: "center",
      rowGap: 18,
      borderRadius: 24,
      backgroundColor: theme.background,
    },
    shareIdentity: { width: "100%", flexDirection: "row", alignItems: "center", columnGap: 14 },
    shareIdentityCopy: { flex: 1, alignItems: "flex-start", rowGap: 4 },
    shareName: { color: theme.text, fontSize: 20, fontWeight: "700" },
    shareId: { color: theme.secondaryText, fontSize: 13, fontWeight: "600" },
    shareBio: { color: theme.secondaryText, fontSize: 12, lineHeight: 16 },
    shareCardDivider: {
      width: "100%",
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.separator,
    },
    qrFrame: { padding: 14, borderRadius: 20, backgroundColor: "#FFFFFF" },
    shareButton: {
      height: 50,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      columnGap: 7,
      borderRadius: 14,
      backgroundColor: colors.accent,
    },
    shareButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
    copyButton: {
      height: 50,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      columnGap: 7,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.separator,
      backgroundColor: theme.background,
    },
    copyButtonText: { color: theme.text, fontSize: 16, fontWeight: "600" },
  });
}
