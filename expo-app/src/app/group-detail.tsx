import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  clearGroupMessageHistory,
  dismissGroup,
  getGroupDetail,
  leaveGroup,
  updateConversationPreference,
  updateGroupVisibility,
} from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { UserAvatarButton } from "@/components/Avatar";
import { TopToast } from "@/components/TopToast";
import type { GroupDetail, GroupMember } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import {
  effectiveGroupCapabilities,
  groupDetailGeneration,
  groupMemberDisplayName,
  loadCachedGroupDetailSnapshot,
  removeCachedGroupDetail,
  saveCachedGroupDetail,
  subscribeGroupDetail,
} from "@/services/groups/GroupDetailRepository";
import { groupDetailErrorMessage } from "@/services/groups/GroupDetailPolicy";
import {
  updateGroupNotificationSettings,
  updateGroupViewerSettings,
} from "@/services/groups/GroupInfoV2Repository";
import { readGroupPinned, saveGroupPinned } from "@/services/groups/GroupPreferenceRepository";
import { removeCachedGroup } from "@/services/groups/GroupRepository";
import { applyGroupHistoryClear } from "@/services/messages/GroupHistoryClearRepository";
import { featureFlagEnabled } from "@/services/remote-config/RemoteConfigService";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";
import { colors } from "@/theme";

export default function GroupDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = Number(params.id ?? "0");
  const { user } = useAuth();
  const { t } = useLocalization();
  const { config } = useRemoteConfig();
  const ownerId = user?.user_id ?? "";
  const scopeKey = `${encodeURIComponent(ownerId)}:${groupId}`;
  const scopeRef = useRef(scopeKey);
  const [scopedDetail, setDetailState] = useState<{
    scope: string;
    value: GroupDetail | null;
  }>({ scope: "", value: null });
  const detailRef = useRef(scopedDetail);
  const detail = scopedDetail.scope === scopeKey ? scopedDetail.value : null;
  const [isLoading, setLoading] = useState(true);
  const [isProcessing, setProcessing] = useState(false);
  const [isUpdatingVisibility, setUpdatingVisibility] = useState(false);
  const [isUpdatingPinned, setUpdatingPinned] = useState(false);
  const [isUpdatingNotifications, setUpdatingNotifications] = useState(false);
  const [isUpdatingViewerSettings, setUpdatingViewerSettings] = useState(false);
  const [isPinned, setPinned] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const processingRef = useRef(false);
  const processingGenerationRef = useRef(0);

  const setDetail = useCallback((next: GroupDetail | null) => {
    const scoped = { scope: scopeRef.current, value: next };
    detailRef.current = scoped;
    setDetailState(scoped);
  }, []);

  useEffect(() => {
    scopeRef.current = scopeKey;
    loadGenerationRef.current += 1;
    processingGenerationRef.current += 1;
    processingRef.current = false;
    queueMicrotask(() => {
      if (scopeRef.current !== scopeKey) return;
      setLoading(true);
      setProcessing(false);
      setUpdatingVisibility(false);
      setUpdatingPinned(false);
      setUpdatingNotifications(false);
      setUpdatingViewerSettings(false);
      setErrorMessage(null);
      setToastMessage(null);
    });
    return () => {
      loadGenerationRef.current += 1;
      processingGenerationRef.current += 1;
      processingRef.current = false;
    };
  }, [scopeKey]);

  const load = useCallback(
    async (forceRefresh = false) => {
      const requestScope = scopeKey;
      const requestGeneration = ++loadGenerationRef.current;
      if (!ownerId || !Number.isInteger(groupId) || groupId <= 0) {
        if (scopeRef.current === requestScope && requestGeneration === loadGenerationRef.current) {
          setLoading(false);
          if (ownerId) setErrorMessage(t("group.loadFailed"));
        }
        return;
      }
      const currentDetail =
        detailRef.current.scope === requestScope ? detailRef.current.value : null;
      if (!currentDetail) setLoading(true);
      const cacheGeneration = groupDetailGeneration(ownerId, groupId);
      const [cachedSnapshot, cachedPinned] = await Promise.all([
        loadCachedGroupDetailSnapshot(ownerId, groupId),
        readGroupPinned(ownerId, groupId),
      ]);
      if (scopeRef.current !== requestScope || requestGeneration !== loadGenerationRef.current) {
        return;
      }
      const cached = cachedSnapshot?.detail ?? null;
      if (detailRef.current.scope !== requestScope && cached) setDetail(cached);
      setPinned(cachedPinned);
      if (cachedSnapshot?.isFresh && !forceRefresh) {
        setErrorMessage(null);
        setLoading(false);
        return;
      }
      try {
        const fetched = await getGroupDetail(groupId);
        if (scopeRef.current !== requestScope || requestGeneration !== loadGenerationRef.current) {
          return;
        }
        const resolved = await saveCachedGroupDetail(ownerId, fetched, cacheGeneration);
        if (
          scopeRef.current !== requestScope ||
          requestGeneration !== loadGenerationRef.current ||
          cacheGeneration !== groupDetailGeneration(ownerId, groupId)
        ) {
          return;
        }
        setDetail(resolved);
        setErrorMessage(null);
      } catch {
        if (
          scopeRef.current === requestScope &&
          requestGeneration === loadGenerationRef.current &&
          detailRef.current.scope !== requestScope &&
          !cached
        ) {
          setErrorMessage(t("group.loadFailed"));
        }
      } finally {
        if (scopeRef.current === requestScope && requestGeneration === loadGenerationRef.current) {
          setLoading(false);
        }
      }
    },
    [groupId, ownerId, scopeKey, setDetail, t],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const subscriptionScope = scopeKey;
    return subscribeGroupDetail(ownerId, (updated) => {
      if (scopeRef.current === subscriptionScope && updated.group_id === groupId) {
        setDetail(updated);
      }
    });
  }, [groupId, ownerId, scopeKey, setDetail]);

  useEffect(
    () =>
      chatRealtimeService.subscribe((event) => {
        if (event.type === "group_member_updated" && event.update.group_id === groupId) {
          void load(true);
        }
      }),
    [groupId, load],
  );

  const updatePinned = async (next: boolean) => {
    if (isUpdatingPinned || !ownerId) return;
    const operationScope = scopeKey;
    const previous = isPinned;
    setUpdatingPinned(true);
    setPinned(next);
    await saveGroupPinned(ownerId, groupId, next);
    try {
      const receipt = await updateConversationPreference("group", String(groupId), next);
      if (scopeRef.current !== operationScope) return;
      setPinned(receipt.is_pinned);
      await saveGroupPinned(ownerId, groupId, receipt.is_pinned);
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      setPinned(previous);
      await saveGroupPinned(ownerId, groupId, previous);
      showError(error);
    } finally {
      if (scopeRef.current === operationScope) setUpdatingPinned(false);
    }
  };

  const updateVisibility = async (next: boolean) => {
    const operationScope = scopeKey;
    const current = detailRef.current.scope === operationScope ? detailRef.current.value : null;
    if (!current || isUpdatingVisibility || current.is_public === next) return;
    loadGenerationRef.current += 1;
    const optimistic = { ...current, is_public: next };
    setUpdatingVisibility(true);
    setDetail(optimistic);
    if (ownerId) await saveCachedGroupDetail(ownerId, optimistic);
    try {
      await updateGroupVisibility(groupId, next);
      if (scopeRef.current !== operationScope) return;
      await load(true);
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      setDetail(current);
      if (ownerId) await saveCachedGroupDetail(ownerId, current);
      showError(error, t("group.publicSettingFailed"));
    } finally {
      if (scopeRef.current === operationScope) setUpdatingVisibility(false);
    }
  };

  const updateMuted = async (next: boolean) => {
    const operationScope = scopeKey;
    const current = detailRef.current.scope === operationScope ? detailRef.current.value : null;
    if (!current || isUpdatingNotifications || current.notification_settings.muted === next) {
      return;
    }
    loadGenerationRef.current += 1;
    const optimistic = {
      ...current,
      notification_settings: { ...current.notification_settings, muted: next },
    };
    setUpdatingNotifications(true);
    setDetail(optimistic);
    if (ownerId) await saveCachedGroupDetail(ownerId, optimistic);
    try {
      const saved = await updateGroupNotificationSettings(groupId, { muted: next });
      if (scopeRef.current !== operationScope) return;
      const latest = detailRef.current.scope === operationScope ? detailRef.current.value : null;
      const resolved = { ...(latest ?? optimistic), notification_settings: saved };
      setDetail(resolved);
      if (ownerId) await saveCachedGroupDetail(ownerId, resolved);
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      setDetail(current);
      if (ownerId) await saveCachedGroupDetail(ownerId, current);
      showError(error, t("group.notifications.updateFailed"));
    } finally {
      if (scopeRef.current === operationScope) setUpdatingNotifications(false);
    }
  };

  const updateShowMemberNicknames = async (next: boolean) => {
    const operationScope = scopeKey;
    const current = detailRef.current.scope === operationScope ? detailRef.current.value : null;
    if (
      !current ||
      isUpdatingViewerSettings ||
      current.viewer_settings.show_member_nicknames === next
    ) {
      return;
    }
    loadGenerationRef.current += 1;
    const optimistic = {
      ...current,
      viewer_settings: { ...current.viewer_settings, show_member_nicknames: next },
    };
    setUpdatingViewerSettings(true);
    setDetail(optimistic);
    if (ownerId) await saveCachedGroupDetail(ownerId, optimistic);
    try {
      const saved = await updateGroupViewerSettings(
        groupId,
        { showMemberNicknames: next },
        async () => (await getGroupDetail(groupId)).viewer_settings,
      );
      if (scopeRef.current !== operationScope) return;
      const latest = detailRef.current.scope === operationScope ? detailRef.current.value : null;
      const resolved = { ...(latest ?? optimistic), viewer_settings: saved };
      setDetail(resolved);
      if (ownerId) await saveCachedGroupDetail(ownerId, resolved);
    } catch (error) {
      if (scopeRef.current !== operationScope) return;
      setDetail(current);
      if (ownerId) await saveCachedGroupDetail(ownerId, current);
      showError(error);
    } finally {
      if (scopeRef.current === operationScope) setUpdatingViewerSettings(false);
    }
  };

  const clearHistory = () => {
    Alert.alert(t("group.clear.confirmTitle"), t("group.clear.message"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("group.clear.action"),
        style: "destructive",
        onPress: () => {
          const operationScope = scopeKey;
          void perform(async () => {
            const receipt = await clearGroupMessageHistory(groupId);
            await applyGroupHistoryClear(ownerId, receipt);
            if (scopeRef.current === operationScope) setToastMessage(t("group.clear.success"));
          });
        },
      },
    ]);
  };

  const leaveOrDismiss = (dismisses: boolean) => {
    const title = t(dismisses ? "group.dismiss.confirmTitle" : "group.leave.confirmTitle");
    const message = t(dismisses ? "group.dismiss.message" : "group.leave.message");
    const action = t(dismisses ? "group.dismiss.confirm" : "group.leave.confirm");
    Alert.alert(title, message, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: action,
        style: "destructive",
        onPress: () => {
          const operationScope = scopeKey;
          loadGenerationRef.current += 1;
          void perform(
            async () => {
              if (dismisses) await dismissGroup(groupId);
              else await leaveGroup(groupId);
              await Promise.all([
                removeCachedGroupDetail(ownerId, groupId),
                removeCachedGroup(ownerId, groupId),
              ]);
              if (scopeRef.current === operationScope) router.dismissAll();
            },
            t(dismisses ? "group.dismissFailed" : "group.leaveFailed"),
          );
        },
      },
    ]);
  };

  const perform = async (operation: () => Promise<void>, fallback?: string) => {
    if (processingRef.current) return;
    const operationScope = scopeKey;
    const operationGeneration = ++processingGenerationRef.current;
    processingRef.current = true;
    setProcessing(true);
    try {
      await operation();
    } catch (error) {
      if (scopeRef.current === operationScope) showError(error, fallback);
    } finally {
      if (operationGeneration === processingGenerationRef.current) {
        processingRef.current = false;
        if (scopeRef.current === operationScope) setProcessing(false);
      }
    }
  };

  const showError = (error: unknown, fallback = t("common.operationFailed")) => {
    Alert.alert(t("common.error"), groupDetailErrorMessage(error, t, fallback));
  };

  const capabilities = detail ? effectiveGroupCapabilities(detail, user?.user_id) : null;
  const groupInfoV2Enabled = featureFlagEnabled(config, "group_info_v2", ownerId, true);
  const inviteEnabled =
    groupInfoV2Enabled && featureFlagEnabled(config, "group_invite_qr_v1", ownerId, false);
  const announcementEnabled =
    groupInfoV2Enabled && featureFlagEnabled(config, "group_announcement_v1", ownerId, false);
  const viewerSettingsEnabled =
    groupInfoV2Enabled && featureFlagEnabled(config, "group_viewer_settings_v1", ownerId, false);
  const notificationSettingsEnabled = featureFlagEnabled(
    config,
    "group_notification_settings_v1",
    ownerId,
    false,
  );
  const reportEnabled =
    groupInfoV2Enabled && featureFlagEnabled(config, "group_reporting_v1", ownerId, false);
  const messageSearchEnabled =
    groupInfoV2Enabled && featureFlagEnabled(config, "group_message_search_v1", ownerId, false);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: t("group.info.title.count", detail?.members.length ?? 0),
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: colors.text,
          headerRight: () => (
            <Pressable
              accessibilityLabel={t("group.members.search")}
              accessibilityRole="button"
              disabled={!detail}
              hitSlop={8}
              onPress={() =>
                router.push({ pathname: "/group-members", params: { id: String(groupId) } })
              }
              style={!detail ? styles.disabled : undefined}
            >
              <SymbolView name="magnifyingglass" size={17} tintColor={colors.text} />
            </Pressable>
          ),
        }}
      />

      {isLoading && !detail ? (
        <View style={styles.blockingState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : detail && capabilities ? (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <MemberPreview
            canManage={capabilities.can_manage_members}
            members={detail.members}
            onAdd={() =>
              router.push({
                pathname: "/add-group-members",
                params: { id: String(groupId) },
              })
            }
            onMore={() =>
              router.push({ pathname: "/group-members", params: { id: String(groupId) } })
            }
          />

          <View style={styles.section}>
            <NavigationRow
              chevron={capabilities.can_edit_group}
              onPress={
                capabilities.can_edit_group
                  ? () =>
                      router.push({
                        pathname: "/group-text-setting",
                        params: { id: String(groupId), value: detail.name },
                      })
                  : undefined
              }
              title={t("group.name.title")}
              value={detail.name}
            />
            {inviteEnabled ? (
              <>
                <View style={styles.separator} />
                <NavigationRow
                  chevron={capabilities.can_create_invite}
                  onPress={
                    capabilities.can_create_invite
                      ? () =>
                          router.push({
                            pathname: "/group-invite",
                            params: { id: String(groupId), name: detail.name },
                          })
                      : undefined
                  }
                  symbol="qrcode"
                  title={t("group.invite.title")}
                  value={
                    capabilities.can_create_invite ? undefined : t("group.invite.managersOnly")
                  }
                />
              </>
            ) : null}
            {announcementEnabled ? (
              <>
                <View style={styles.separator} />
                <NavigationRow
                  onPress={() =>
                    router.push({
                      pathname: "/group-announcement",
                      params: {
                        id: String(groupId),
                        title: detail.announcement?.title ?? "",
                        content: detail.announcement?.content ?? "",
                        updatedAt: detail.announcement?.updated_at ?? "",
                        canEdit: String(capabilities.can_edit_announcement),
                      },
                    })
                  }
                  subtitle={announcementSummary(detail, t)}
                  title={t("group.announcement.title")}
                />
              </>
            ) : null}
            {viewerSettingsEnabled ? (
              <>
                <View style={styles.separator} />
                <NavigationRow
                  onPress={() =>
                    router.push({
                      pathname: "/group-text-setting",
                      params: {
                        id: String(groupId),
                        kind: "remark",
                        value: detail.viewer_settings.remark,
                      },
                    })
                  }
                  title={t("group.remark.title")}
                  value={detail.viewer_settings.remark || t("common.notSet")}
                />
              </>
            ) : null}
          </View>

          {messageSearchEnabled ? (
            <View style={styles.section}>
              <NavigationRow
                onPress={() =>
                  router.push({
                    pathname: "/group-message-search",
                    params: { id: String(groupId) },
                  })
                }
                title={t("group.search.title")}
              />
            </View>
          ) : null}

          <View style={styles.section}>
            {notificationSettingsEnabled ? (
              <>
                <View style={styles.toggleRow}>
                  <Text style={[styles.rowTitle, styles.toggleTitle]}>
                    {t("group.notifications.mute")}
                  </Text>
                  <Switch
                    accessibilityLabel={t("group.notifications.mute")}
                    accessibilityState={{
                      checked: detail.notification_settings.muted,
                      disabled: isUpdatingNotifications,
                    }}
                    disabled={isUpdatingNotifications}
                    ios_backgroundColor="#E9E9EA"
                    onValueChange={(value) => void updateMuted(value)}
                    trackColor={{ false: "#E9E9EA", true: colors.accent }}
                    value={detail.notification_settings.muted}
                  />
                </View>
                {detail.notification_settings.muted ? (
                  <>
                    <View style={styles.separator} />
                    <NavigationRow
                      onPress={() =>
                        router.push({
                          pathname: "/group-notification-settings",
                          params: { id: String(groupId) },
                        })
                      }
                      subtitle={notificationSummary(detail, t)}
                      title={t("group.notifications.exceptions")}
                    />
                  </>
                ) : null}
                <View style={styles.separator} />
              </>
            ) : null}
            <View style={styles.toggleRow}>
              <Text style={[styles.rowTitle, styles.toggleTitle]}>{t("group.pin.title")}</Text>
              <Switch
                accessibilityLabel={t("group.pin.title")}
                accessibilityState={{ checked: isPinned, disabled: isUpdatingPinned }}
                disabled={isUpdatingPinned}
                ios_backgroundColor="#E9E9EA"
                onValueChange={(value) => void updatePinned(value)}
                trackColor={{ false: "#E9E9EA", true: colors.accent }}
                value={isPinned}
              />
            </View>
          </View>

          {viewerSettingsEnabled ? (
            <View style={styles.section}>
              <NavigationRow
                onPress={() =>
                  router.push({
                    pathname: "/group-text-setting",
                    params: {
                      id: String(groupId),
                      kind: "nickname",
                      value: detail.current_member?.group_nickname ?? "",
                    },
                  })
                }
                title={t("group.myNickname.title")}
                value={detail.current_member?.group_nickname || t("common.notSet")}
              />
              <View style={styles.separator} />
              <View style={styles.toggleRow}>
                <Text style={[styles.rowTitle, styles.toggleTitle]}>
                  {t("group.showMemberNicknames")}
                </Text>
                <Switch
                  accessibilityLabel={t("group.showMemberNicknames")}
                  accessibilityState={{
                    checked: detail.viewer_settings.show_member_nicknames,
                    disabled: isUpdatingViewerSettings,
                  }}
                  disabled={isUpdatingViewerSettings}
                  ios_backgroundColor="#E9E9EA"
                  onValueChange={(value) => void updateShowMemberNicknames(value)}
                  trackColor={{ false: "#E9E9EA", true: colors.accent }}
                  value={detail.viewer_settings.show_member_nicknames}
                />
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <NavigationRow
              onPress={() =>
                router.push({
                  pathname: "/chat-background-settings",
                  params: {
                    targetType: "group",
                    targetId: String(groupId),
                    title: t("chatBackground.currentChat"),
                  },
                })
              }
              title={t("chatBackground.currentChat")}
            />
          </View>

          <View style={styles.section}>
            <Pressable
              accessibilityRole="button"
              onPress={clearHistory}
              style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
            >
              <Text style={styles.destructiveLeading}>{t("group.clear.action")}</Text>
            </Pressable>
          </View>

          {reportEnabled ? (
            <View style={styles.section}>
              <NavigationRow
                onPress={() =>
                  router.push({ pathname: "/group-report", params: { id: String(groupId) } })
                }
                title={t("group.report.title")}
              />
            </View>
          ) : null}

          {capabilities.can_change_visibility ? (
            <View style={styles.section}>
              <View style={[styles.toggleRow, styles.toggleRowWithSubtitle]}>
                <View style={styles.toggleLabel}>
                  <Text style={styles.rowTitle}>{t("group.isPublic")}</Text>
                  <Text style={styles.rowSubtitle}>
                    {t(detail.is_public ? "group.public" : "group.private")}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={t("group.isPublic")}
                  accessibilityState={{
                    checked: detail.is_public,
                    disabled: isUpdatingVisibility,
                  }}
                  disabled={isUpdatingVisibility}
                  ios_backgroundColor="#E9E9EA"
                  onValueChange={(value) => void updateVisibility(value)}
                  trackColor={{ false: "#E9E9EA", true: colors.accent }}
                  value={detail.is_public}
                />
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Pressable
              accessibilityRole="button"
              onPress={() => leaveOrDismiss(capabilities.can_dismiss_group)}
              style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
            >
              <Text style={styles.destructiveCentered}>
                {t(capabilities.can_dismiss_group ? "group.dismiss.action" : "group.leave.action")}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.blockingState}>
          <SymbolView name="person.3.sequence" size={28} tintColor={colors.secondaryText} />
          <Text style={styles.errorText}>{errorMessage ?? t("group.loadFailed")}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load(true)}>
            <Text style={styles.retryText}>{t("common.retry")}</Text>
          </Pressable>
        </View>
      )}

      {isProcessing ? (
        <View style={styles.processingOverlay}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </View>
  );
}

function MemberPreview({
  canManage,
  members,
  onAdd,
  onMore,
}: {
  canManage: boolean;
  members: readonly GroupMember[];
  onAdd: () => void;
  onMore: () => void;
}) {
  const { width } = useWindowDimensions();
  const { t } = useLocalization();
  const columns = width <= 375 ? 5 : 6;
  const capacity = columns * 3 - (canManage ? 1 : 0);
  const visible = members.slice(0, Math.max(capacity, 0));
  const itemWidth = (width - 32 - (columns - 1) * 8) / columns;
  return (
    <View style={styles.memberSection}>
      <View style={styles.memberGrid}>
        {visible.map((member) => (
          <View key={member.user_id} style={[styles.memberItem, { width: itemWidth }]}>
            <UserAvatarButton
              accessibilityName={groupMemberDisplayName(member)}
              avatarUrl={member.avatar_url}
              size={48}
              userId={member.user_id}
            />
            <Text numberOfLines={1} style={styles.memberName}>
              {groupMemberDisplayName(member)}
            </Text>
          </View>
        ))}
        {canManage ? (
          <Pressable
            accessibilityLabel={t("group.addMembers")}
            accessibilityRole="button"
            onPress={onAdd}
            style={({ pressed }) => [
              styles.memberItem,
              { width: itemWidth },
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.addMemberBox}>
              <SymbolView name="plus" size={20} tintColor={colors.secondaryText} />
            </View>
            <Text numberOfLines={1} style={styles.memberName}>
              {t("group.members.addShort")}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onMore}
        style={({ pressed }) => [styles.moreMembers, pressed && styles.pressed]}
      >
        <Text style={styles.moreText}>{t("group.members.more")}</Text>
        <SymbolView
          name="chevron.down"
          size={12}
          weight="semibold"
          tintColor={colors.secondaryText}
        />
      </Pressable>
    </View>
  );
}

function NavigationRow({
  chevron = true,
  onPress,
  subtitle,
  symbol,
  title,
  value,
}: {
  chevron?: boolean | undefined;
  onPress?: (() => void) | undefined;
  subtitle?: string | undefined;
  symbol?: "qrcode" | undefined;
  title: string;
  value?: string | undefined;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navigationRow,
        subtitle !== undefined &&
          trimFoundationWhitespacesAndNewlines(subtitle) &&
          styles.navigationRowWithSubtitle,
        pressed && styles.pressed,
      ]}
    >
      {symbol ? <SymbolView name={symbol} size={18} tintColor={colors.secondaryText} /> : null}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle !== undefined && trimFoundationWhitespacesAndNewlines(subtitle) ? (
          <Text numberOfLines={2} style={styles.rowSubtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.flexSpacer} />
      {value !== undefined && trimFoundationWhitespacesAndNewlines(value) ? (
        <Text numberOfLines={1} style={styles.rowValue}>
          {value}
        </Text>
      ) : null}
      {chevron ? (
        <SymbolView
          name="chevron.right"
          size={12}
          weight="semibold"
          tintColor={colors.tertiaryText}
        />
      ) : null}
    </Pressable>
  );
}

function announcementSummary(
  detail: GroupDetail,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const title = trimFoundationWhitespacesAndNewlines(detail.announcement?.title ?? "");
  const content = trimFoundationWhitespacesAndNewlines(detail.announcement?.content ?? "");
  if (title && content) return `${title} · ${content}`;
  return title || content || t("group.announcement.empty");
}

function notificationSummary(
  detail: GroupDetail,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  const settings = detail.notification_settings;
  const items: string[] = [];
  if (settings.notify_mentions_me) items.push(t("group.notifications.mentionsMe"));
  if (settings.notify_mentions_all) items.push(t("group.notifications.mentionsAll"));
  if (settings.important_member_ids.length > 0) {
    items.push(t("group.notifications.importantSummary", settings.important_member_ids.length));
  }
  return items.length > 0 ? items.join("、") : t("group.notifications.none");
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 30 },
  blockingState: { flex: 1, alignItems: "center", justifyContent: "center", rowGap: 14 },
  errorText: { color: colors.secondaryText, fontSize: 16 },
  retryText: { color: colors.accent, fontSize: 16, fontWeight: "500" },
  memberSection: { marginBottom: 6, backgroundColor: colors.background },
  memberGrid: {
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingTop: 18,
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 8,
    rowGap: 14,
  },
  memberItem: { alignItems: "center", rowGap: 6 },
  memberName: { width: "100%", color: colors.secondaryText, fontSize: 12, textAlign: "center" },
  addMemberBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.tertiaryText,
    alignItems: "center",
    justifyContent: "center",
  },
  moreMembers: {
    minHeight: 46,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 6,
  },
  moreText: { color: colors.secondaryText, fontSize: 17 },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    backgroundColor: colors.card,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
    backgroundColor: colors.separator,
  },
  navigationRow: {
    minHeight: 54,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  navigationRowWithSubtitle: { minHeight: 70 },
  toggleRow: {
    minHeight: 54,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  toggleRowWithSubtitle: { minHeight: 70 },
  toggleLabel: { flex: 1, rowGap: 2 },
  rowText: { flexShrink: 1, rowGap: 3 },
  rowTitle: { color: colors.text, fontSize: 17 },
  toggleTitle: { flex: 1 },
  rowSubtitle: { color: colors.secondaryText, fontSize: 15 },
  rowValue: {
    maxWidth: 190,
    flexShrink: 1,
    color: colors.secondaryText,
    fontSize: 17,
    textAlign: "right",
  },
  flexSpacer: { flex: 1 },
  actionRow: { minHeight: 54, paddingHorizontal: 16, justifyContent: "center" },
  destructiveLeading: { color: colors.danger, fontSize: 17 },
  destructiveCentered: { color: colors.danger, fontSize: 17, textAlign: "center" },
  processingOverlay: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.68 },
});
