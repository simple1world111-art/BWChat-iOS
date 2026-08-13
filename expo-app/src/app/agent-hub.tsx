import { MenuView, type MenuAction } from "@expo/ui/community/menu";
import { randomUUID } from "expo-crypto";
import { LinearGradient } from "expo-linear-gradient";
import { router, Stack, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type ColorSchemeName,
} from "react-native";
import { SilentRefreshControl as RefreshControl } from "@/components/ui/SilentRefreshControl";

import {
  createAgentConversation,
  getAgentConversations,
  getAgentRuntimeConfig,
  getConversationSyncSnapshot,
  getInstalledAgents,
  getWalletBalance,
  uninstallAgent,
} from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { env } from "@/config/env";
import type { AgentConversation, AgentSummary, Conversation } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  type AgentCatalogSnapshot,
  loadCachedAgentCatalog,
  saveAgentCatalog,
} from "@/services/agents/AgentCatalogRepository";
import { mergeAgentConversationSnapshots } from "@/services/agents/AgentConversationState";
import {
  rememberAgentForEditing,
  subscribeAgentUpdates,
} from "@/services/agents/AgentEditNavigationStore";
import { rememberScriptRoomConversation } from "@/services/scripts/ScriptRoomNavigationStore";
import {
  agentAvatarAssetId,
  agentConversationPreview,
  agentDescription,
  agentDisplayName,
  agentHubErrorMessage,
  agentHubMetrics,
  formatAgentHubListTime,
  isAgentCapabilityError,
  latestOpenAgentConversation,
  resolveJoinedScriptRooms,
  scriptRoomPreview,
  upsertInstalledAgent,
} from "@/services/agents/agentHubPolicy";
import { palette } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

const emptySnapshot: AgentCatalogSnapshot = {
  installedAgents: [],
  conversations: [],
  joinedScriptRooms: [],
};

export default function AgentHubScreen() {
  const { user } = useAuth();
  const { t } = useLocalization();
  const ownerId = user?.user_id ?? "";
  return <AgentHubAccountScreen key={ownerId || "signed-out"} ownerId={ownerId} t={t} />;
}

function AgentHubAccountScreen({
  ownerId,
  t,
}: {
  ownerId: string;
  t(key: string, ...args: (string | number)[]): string;
}) {
  const scheme = useColorScheme();
  const theme = palette(scheme);
  const styles = useMemo(() => makeStyles(scheme), [scheme]);
  const [snapshot, setSnapshot] = useState<AgentCatalogSnapshot>(emptySnapshot);
  const snapshotRef = useRef(snapshot);
  const [isLoading, setLoading] = useState(false);
  const [hasLoadedContent, setHasLoadedContent] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [removingAgentIds, setRemovingAgentIds] = useState<Set<string>>(new Set());
  const [openingAgentIds, setOpeningAgentIds] = useState<Set<string>>(new Set());
  const removingAgentIdsRef = useRef(new Set<string>());
  const openingAgentIdsRef = useRef(new Set<string>());
  const loadingOwnerRef = useRef<string | null>(null);
  const activeOwnerRef = useRef(ownerId);
  const snapshotOwnerRef = useRef(ownerId);
  const idempotencyKeys = useRef(new Map<string, string>());
  const lastRuntimeLoad = useRef<number | null>(null);

  const applySnapshot = useCallback((value: AgentCatalogSnapshot) => {
    snapshotRef.current = value;
    setSnapshot(value);
  }, []);

  const persist = useCallback(
    async (value: AgentCatalogSnapshot) => {
      if (!ownerId) return;
      try {
        await saveAgentCatalog(ownerId, value);
      } catch {
        // A cache write must never discard a successfully loaded remote value.
      }
    },
    [ownerId],
  );

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!ownerId || loadingOwnerRef.current === ownerId) return;
      const requestedOwner = ownerId;
      loadingOwnerRef.current = requestedOwner;
      let startedRemoteLoad = false;
      try {
        if (snapshotOwnerRef.current !== ownerId) {
          snapshotOwnerRef.current = ownerId;
          applySnapshot(emptySnapshot);
          idempotencyKeys.current.clear();
          openingAgentIdsRef.current = new Set();
          removingAgentIdsRef.current = new Set();
          setOpeningAgentIds(new Set());
          setRemovingAgentIds(new Set());
          setHasLoadedContent(false);
          lastRuntimeLoad.current = null;
        }
        const cached = await loadCachedAgentCatalog(ownerId).catch(() => null);
        if (activeOwnerRef.current !== requestedOwner) return;
        if (cached) {
          applySnapshot({
            ...cached.value,
            conversations: sortAgentConversations(cached.value.conversations),
            joinedScriptRooms: resolveJoinedScriptRooms(cached.value.joinedScriptRooms),
          });
          lastRuntimeLoad.current = cached.updatedAt;
          setHasLoadedContent(true);
          if (!cached.isStale && !forceRefresh) return;
        }

        startedRemoteLoad = true;
        setLoading(true);
        setErrorMessage(null);
        const results = await Promise.allSettled([
          getAgentRuntimeConfig(),
          getInstalledAgents(),
          getAgentConversations(),
          getConversationSyncSnapshot(),
          getWalletBalance(),
        ] as const);
        if (activeOwnerRef.current !== requestedOwner) return;
        const next: AgentCatalogSnapshot = { ...snapshotRef.current };
        if (results[0].status === "fulfilled") {
          next.runtimeConfig = results[0].value;
          lastRuntimeLoad.current = Date.now();
        }
        if (results[1].status === "fulfilled") next.installedAgents = results[1].value;
        if (results[2].status === "fulfilled") {
          next.conversations = sortAgentConversations(
            mergeAgentConversationSnapshots(snapshotRef.current.conversations, results[2].value),
          );
        }
        if (results[3].status === "fulfilled") {
          next.joinedScriptRooms = resolveJoinedScriptRooms(results[3].value.conversations);
        }
        if (results[4].status === "fulfilled") {
          next.spendableBalance = results[4].value.spendable_balance;
        }
        applySnapshot(next);
        const firstFailure = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (firstFailure) setErrorMessage(readableError(firstFailure.reason));
        if (results.some((result) => result.status === "fulfilled")) await persist(next);
      } finally {
        if (loadingOwnerRef.current === requestedOwner) {
          loadingOwnerRef.current = null;
        }
        if (startedRemoteLoad && activeOwnerRef.current === requestedOwner) {
          setLoading(false);
          setHasLoadedContent(true);
        }
      }
    },
    [applySnapshot, ownerId, persist],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(
    () =>
      subscribeAgentUpdates((agent) => {
        if (activeOwnerRef.current !== ownerId) return;
        const next = {
          ...snapshotRef.current,
          installedAgents: upsertInstalledAgent(snapshotRef.current.installedAgents, agent),
        };
        applySnapshot(next);
        void (async () => {
          await persist(next);
          if (activeOwnerRef.current === ownerId) await load(true);
        })();
      }),
    [applySnapshot, load, ownerId, persist],
  );

  useEffect(() => {
    activeOwnerRef.current = ownerId;
    if (snapshotOwnerRef.current !== ownerId) {
      snapshotOwnerRef.current = ownerId;
      applySnapshot(emptySnapshot);
      idempotencyKeys.current.clear();
      openingAgentIdsRef.current = new Set();
      removingAgentIdsRef.current = new Set();
      setOpeningAgentIds(new Set());
      setRemovingAgentIds(new Set());
      setHasLoadedContent(false);
      setErrorMessage(null);
      lastRuntimeLoad.current = null;
    }
    return () => {
      activeOwnerRef.current = "";
    };
  }, [applySnapshot, ownerId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const loadedAt = lastRuntimeLoad.current;
      if (loadedAt !== null && Date.now() - loadedAt < agentHubMetrics.runtimeRefreshMilliseconds) {
        return;
      }
      void getAgentRuntimeConfig()
        .then(async (runtimeConfig) => {
          if (activeOwnerRef.current !== ownerId) return;
          lastRuntimeLoad.current = Date.now();
          const next = { ...snapshotRef.current, runtimeConfig };
          applySnapshot(next);
          await persist(next);
        })
        .catch((error: unknown) => {
          if (activeOwnerRef.current === ownerId) setErrorMessage(readableError(error));
        });
    });
    return () => subscription.remove();
  }, [applySnapshot, ownerId, persist]);

  const openCreator = useCallback(
    (agent?: AgentSummary) => {
      if (agent) rememberAgentForEditing(agent, ownerId);
      router.push({
        pathname: "/agent-creator",
        params: {
          ...(agent ? { agentId: agent.id } : {}),
        },
      });
    },
    [ownerId],
  );

  const openConversation = useCallback((conversation: AgentConversation) => {
    router.push({
      pathname: "/agent-chat",
      params: {
        conversationId: conversation.id,
        agentId: conversation.agent_id,
        name: conversation.agent_profile.name,
        avatarId: conversation.agent_profile.avatar_asset_id ?? "",
      },
    });
  }, []);

  const openAgent = useCallback(
    async (agent: AgentSummary) => {
      if (openingAgentIdsRef.current.has(agent.id)) return;
      const existing = latestOpenAgentConversation(snapshotRef.current.conversations, agent.id);
      if (existing) {
        openConversation(existing);
        return;
      }
      setWorkingId(agent.id, true, openingAgentIdsRef, setOpeningAgentIds);
      const key = idempotencyKeys.current.get(agent.id) ?? randomUUID();
      const requestedOwner = ownerId;
      idempotencyKeys.current.set(agent.id, key);
      try {
        const conversation = await createAgentConversation(
          agent.id,
          agent.greetings?.[0]?.id ?? "default",
          key,
        );
        if (activeOwnerRef.current !== requestedOwner) return;
        idempotencyKeys.current.delete(agent.id);
        const next = {
          ...snapshotRef.current,
          conversations: [
            conversation,
            ...snapshotRef.current.conversations.filter((item) => item.id !== conversation.id),
          ],
        };
        applySnapshot(next);
        await persist(next);
        if (activeOwnerRef.current !== requestedOwner) return;
        openConversation(conversation);
      } catch (error) {
        if (activeOwnerRef.current !== requestedOwner) return;
        setErrorMessage(readableError(error));
        if (isAgentCapabilityError(error)) {
          lastRuntimeLoad.current = null;
          try {
            const runtimeConfig = await getAgentRuntimeConfig();
            if (activeOwnerRef.current !== requestedOwner) return;
            lastRuntimeLoad.current = Date.now();
            const next = { ...snapshotRef.current, runtimeConfig };
            applySnapshot(next);
            await persist(next);
          } catch (refreshError) {
            if (activeOwnerRef.current === requestedOwner) {
              setErrorMessage(readableError(refreshError));
            }
          }
        }
      } finally {
        if (activeOwnerRef.current === requestedOwner) {
          setWorkingId(agent.id, false, openingAgentIdsRef, setOpeningAgentIds);
        }
      }
    },
    [applySnapshot, openConversation, ownerId, persist],
  );

  const removeAgent = useCallback(
    async (agent: AgentSummary) => {
      if (removingAgentIdsRef.current.has(agent.id)) return;
      setWorkingId(agent.id, true, removingAgentIdsRef, setRemovingAgentIds);
      const requestedOwner = ownerId;
      try {
        await uninstallAgent(agent.id);
        if (activeOwnerRef.current !== requestedOwner) return;
        const next = {
          ...snapshotRef.current,
          installedAgents: snapshotRef.current.installedAgents.filter(
            (candidate) => candidate.id !== agent.id,
          ),
        };
        applySnapshot(next);
        await persist(next);
      } catch (error) {
        if (activeOwnerRef.current !== requestedOwner) return;
        setErrorMessage(readableError(error));
      } finally {
        if (activeOwnerRef.current === requestedOwner) {
          setWorkingId(agent.id, false, removingAgentIdsRef, setRemovingAgentIds);
        }
      }
    },
    [applySnapshot, ownerId, persist],
  );

  const openScriptRoom = useCallback(
    (conversation: Conversation) => {
      if (!trimFoundationWhitespacesAndNewlines(conversation.script_room_id ?? "")) return;
      rememberScriptRoomConversation(conversation, ownerId);
      router.push({
        pathname: "/script-room-chat",
        params: {
          roomId: conversation.script_room_id,
        },
      });
    },
    [ownerId],
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: "智能体",
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTitleAlign: "center",
          headerTitleStyle: styles.headerTitle,
          headerRight: () => (
            <Pressable
              accessibilityLabel="创建智能体"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => openCreator()}
              style={styles.headerButton}
            >
              <SymbolView name="plus" size={16} weight="semibold" tintColor={theme.accent} />
            </Pressable>
          ),
        }}
      />

      {isLoading && !hasLoadedContent ? (
        <View
          accessibilityLabel="正在加载智能体…"
          accessibilityRole="progressbar"
          style={styles.initialLoading}
        >
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.loadingText}>正在加载智能体…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              onRefresh={() => void load(true)}
              refreshing={isLoading}
              tintColor={theme.secondaryText}
            />
          }
        >
          {snapshot.conversations.length > 0 ? (
            <Section title="最近会话" styles={styles}>
              {snapshot.conversations.map((conversation) => (
                <Pressable
                  accessibilityLabel={`${conversation.agent_profile.name}，${agentConversationPreview(conversation, t)}`}
                  accessibilityRole="button"
                  key={conversation.id}
                  onPress={() => openConversation(conversation)}
                  style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                >
                  <AgentAvatar
                    assetId={conversation.agent_profile.avatar_asset_id}
                    scheme={scheme}
                    size={agentHubMetrics.conversationAvatarSize}
                  />
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>{conversation.agent_profile.name}</Text>
                    <Text numberOfLines={1} style={styles.rowBody}>
                      {agentConversationPreview(conversation, t)}
                    </Text>
                  </View>
                  <SymbolView
                    name="chevron.right"
                    size={agentHubMetrics.chevronSize}
                    weight="semibold"
                    tintColor={theme.tertiaryText}
                  />
                </Pressable>
              ))}
            </Section>
          ) : null}

          {snapshot.joinedScriptRooms.length > 0 ? (
            <Section title="我加入的剧本" styles={styles}>
              {snapshot.joinedScriptRooms.map((conversation) => (
                <Pressable
                  accessibilityLabel={`${conversation.name}，剧本，${scriptRoomPreview(conversation)}`}
                  accessibilityRole="button"
                  key={`${conversation.type}:${conversation.id}:${conversation.script_room_id}`}
                  onPress={() => openScriptRoom(conversation)}
                  style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                >
                  <ScriptAvatar conversation={conversation} scheme={scheme} />
                  <View style={styles.rowCopy}>
                    <View style={styles.scriptTitleRow}>
                      <Text numberOfLines={1} style={[styles.rowTitle, styles.scriptTitle]}>
                        {conversation.name}
                      </Text>
                      <AgentTag text="剧本" styles={styles} />
                    </View>
                    <Text numberOfLines={1} style={styles.rowBody}>
                      {scriptRoomPreview(conversation)}
                    </Text>
                  </View>
                  <View style={styles.scriptTrailing}>
                    {formatAgentHubListTime(
                      conversation.last_message_time,
                      new Date(),
                      t("time.yesterday"),
                    ) ? (
                      <Text style={styles.rowTime}>
                        {formatAgentHubListTime(
                          conversation.last_message_time,
                          new Date(),
                          t("time.yesterday"),
                        )}
                      </Text>
                    ) : null}
                    <SymbolView
                      name="chevron.right"
                      size={agentHubMetrics.chevronSize}
                      weight="semibold"
                      tintColor={theme.tertiaryText}
                    />
                  </View>
                </Pressable>
              ))}
            </Section>
          ) : null}

          <Section title="我的智能体" styles={styles}>
            {snapshot.installedAgents.length === 0 ? (
              <View style={styles.emptySection}>
                <View style={styles.emptyState}>
                  <SymbolView
                    name="sparkles.rectangle.stack"
                    size={agentHubMetrics.emptySymbolSize}
                    weight="medium"
                    tintColor={theme.tertiaryText}
                  />
                  <Text style={styles.emptyTitle}>还没有创建智能体</Text>
                  <Text style={styles.emptySubtitle}>创建一个有独立形象和性格的智能体</Text>
                </View>
                <Pressable
                  accessibilityLabel="创建智能体"
                  accessibilityRole="button"
                  onPress={() => openCreator()}
                  style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
                >
                  <SymbolView
                    name="plus.circle.fill"
                    size={16}
                    weight="semibold"
                    tintColor="#FFFFFF"
                  />
                  <Text style={styles.createButtonText}>创建智能体</Text>
                </Pressable>
              </View>
            ) : (
              snapshot.installedAgents.map((agent) => {
                const working = openingAgentIds.has(agent.id);
                const disabled = working || removingAgentIds.has(agent.id);
                const row = (
                  <Pressable
                    accessibilityHint={
                      agent.is_owner ? "长按可调整或移除智能体" : "长按可移除智能体"
                    }
                    accessibilityLabel={`${agentDisplayName(agent)}，${agentDescription(agent)}，聊天`}
                    accessibilityRole="button"
                    accessibilityState={{ busy: working, disabled }}
                    disabled={disabled}
                    onPress={() => void openAgent(agent)}
                    style={({ pressed }) => [
                      styles.card,
                      pressed && styles.pressed,
                      disabled && styles.disabled,
                    ]}
                  >
                    <AgentAvatar
                      assetId={agentAvatarAssetId(agent)}
                      scheme={scheme}
                      size={agentHubMetrics.agentAvatarSize}
                    />
                    <View style={styles.rowCopy}>
                      <Text numberOfLines={1} style={styles.rowTitle}>
                        {agentDisplayName(agent)}
                      </Text>
                      <Text numberOfLines={2} style={styles.rowBody}>
                        {agentDescription(agent)}
                      </Text>
                      <View style={styles.tags}>
                        {agent.visibility ? (
                          <AgentTag
                            text={agent.visibility === "public" ? "公开" : "私有"}
                            styles={styles}
                          />
                        ) : null}
                        {agent.capabilities?.paid_images ? (
                          <AgentTag text="图片" styles={styles} />
                        ) : null}
                      </View>
                    </View>
                    {working ? (
                      <ActivityIndicator
                        color={theme.secondaryText}
                        size="small"
                        style={styles.working}
                      />
                    ) : (
                      <Text style={styles.chatAction}>聊天</Text>
                    )}
                  </Pressable>
                );
                if (disabled) return <View key={agent.id}>{row}</View>;
                const menuActions: MenuAction[] = [
                  ...(agent.is_owner
                    ? [
                        {
                          id: "edit-agent",
                          title: "调整智能体",
                          image: "slider.horizontal.3" as const,
                        },
                      ]
                    : []),
                  {
                    id: "remove-agent",
                    title: "从我的智能体中移除",
                    image: "trash" as const,
                    attributes: { destructive: true },
                  },
                ];
                return (
                  <MenuView
                    actions={menuActions}
                    key={agent.id}
                    onPressAction={(event) => {
                      if (event.nativeEvent.event === "edit-agent") openCreator(agent);
                      if (event.nativeEvent.event === "remove-agent") void removeAgent(agent);
                    }}
                    shouldOpenOnLongPress
                    style={styles.agentMenuHost}
                  >
                    {row}
                  </MenuView>
                );
              })
            )}
          </Section>
        </ScrollView>
      )}

      {errorMessage ? (
        <View pointerEvents="box-none" style={styles.errorOverlay}>
          <View
            accessibilityLiveRegion="assertive"
            accessibilityRole="alert"
            style={styles.errorBanner}
          >
            <SymbolView name="exclamationmark.circle.fill" size={16} tintColor="#FFFFFF" />
            <Text numberOfLines={2} style={styles.errorText}>
              {errorMessage}
            </Text>
            <Pressable
              accessibilityLabel="关闭错误提示"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setErrorMessage(null)}
            >
              <Text style={styles.errorClose}>关闭</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

type AgentHubStyles = ReturnType<typeof makeStyles>;

function Section({
  title,
  children,
  styles,
}: {
  title: string;
  children: React.ReactNode;
  styles: AgentHubStyles;
}) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function AgentAvatar({
  assetId,
  size,
  scheme,
}: {
  assetId: string | undefined;
  size: number;
  scheme: ColorSchemeName;
}) {
  const theme = palette(scheme);
  const uri = assetId
    ? resolveMediaUrl(`/agent-assets/${encodeURIComponent(assetId)}`, env.apiBaseUrl)
    : null;
  const radius = size * 0.22;
  const fallback = (
    <LinearGradient
      colors={[theme.accent, theme.accentDark]}
      style={[localStyles.avatarFallback, { width: size, height: size, borderRadius: radius }]}
    >
      <SymbolView name="sparkles" size={size * 0.34} weight="semibold" tintColor="#FFFFFF" />
    </LinearGradient>
  );
  return uri ? (
    <AuthenticatedImage
      accessible={false}
      contentFit="cover"
      errorFallback={fallback}
      fallback={fallback}
      style={{ width: size, height: size, borderRadius: radius }}
      uri={uri}
    />
  ) : (
    fallback
  );
}

function ScriptAvatar({
  conversation,
  scheme,
}: {
  conversation: Conversation;
  scheme: ColorSchemeName;
}) {
  const theme = palette(scheme);
  const uri = conversation.avatar_url
    ? resolveMediaUrl(conversation.avatar_url, env.apiBaseUrl)
    : null;
  const loadingFallback = (
    <View style={[localStyles.scriptFallback, { backgroundColor: theme.accentSoft }]}>
      <ActivityIndicator color={theme.accent} size="small" />
    </View>
  );
  const errorFallback = (
    <LinearGradient colors={[theme.accentSoft, "#F2E8FF"]} style={localStyles.scriptFallback}>
      <View style={localStyles.scriptFallbackSymbol}>
        <SymbolView name="book.closed.fill" size={24} weight="semibold" tintColor={theme.accent} />
      </View>
    </LinearGradient>
  );
  return uri ? (
    <AuthenticatedImage
      accessible={false}
      contentFit="cover"
      errorFallback={errorFallback}
      loadingFallback={loadingFallback}
      style={localStyles.scriptAvatar}
      uri={uri}
    />
  ) : (
    errorFallback
  );
}

function AgentTag({ text, styles }: { text: string; styles: AgentHubStyles }) {
  return <Text style={styles.tag}>{text}</Text>;
}

function sortAgentConversations(conversations: readonly AgentConversation[]): AgentConversation[] {
  return [...conversations].sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

function setWorkingId(
  value: string,
  included: boolean,
  reference: React.MutableRefObject<Set<string>>,
  setter: React.Dispatch<React.SetStateAction<Set<string>>>,
): void {
  const next = new Set(reference.current);
  if (included) next.add(value);
  else next.delete(value);
  reference.current = next;
  setter(next);
}

function readableError(error: unknown): string {
  return agentHubErrorMessage(error);
}

function makeStyles(scheme: ColorSchemeName) {
  const theme = palette(scheme);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    headerTitle: { color: theme.text, fontSize: 17, fontWeight: "600" },
    headerButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
    initialLoading: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    loadingText: { color: theme.secondaryText, fontSize: 14 },
    content: {
      padding: agentHubMetrics.contentInset,
      paddingBottom: agentHubMetrics.contentBottomInset + agentHubMetrics.contentInset,
      gap: agentHubMetrics.contentSpacing,
    },
    section: { gap: agentHubMetrics.contentSpacing },
    sectionTitle: {
      paddingTop: agentHubMetrics.sectionTitleTopInset,
      color: theme.secondaryText,
      fontSize: agentHubMetrics.sectionTitleSize,
      fontWeight: "600",
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: agentHubMetrics.rowSpacing,
      padding: agentHubMetrics.cardInset,
      borderRadius: agentHubMetrics.cardRadius,
      backgroundColor: theme.card,
    },
    agentMenuHost: { width: "100%" },
    rowCopy: { flex: 1, gap: agentHubMetrics.copySpacing },
    rowTitle: { color: theme.text, fontSize: agentHubMetrics.rowTitleSize, fontWeight: "600" },
    rowBody: { color: theme.secondaryText, fontSize: agentHubMetrics.rowBodySize, lineHeight: 17 },
    chatAction: { color: theme.accent, fontSize: 13, fontWeight: "600", marginLeft: 8 },
    working: { marginLeft: 8, transform: [{ scale: 0.8 }] },
    tags: { flexDirection: "row", gap: 8 },
    tag: {
      alignSelf: "flex-start",
      overflow: "hidden",
      borderRadius: 99,
      paddingHorizontal: agentHubMetrics.tagHorizontalInset,
      paddingVertical: agentHubMetrics.tagVerticalInset,
      backgroundColor: theme.accentSoft,
      color: theme.accent,
      fontSize: agentHubMetrics.tagSize,
      fontWeight: "600",
    },
    scriptTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    scriptTitle: { flexShrink: 1 },
    scriptTrailing: { alignItems: "flex-end", gap: 7, marginLeft: 8 },
    rowTime: { color: theme.tertiaryText, fontSize: agentHubMetrics.rowTimeSize },
    emptySection: { alignItems: "center", gap: 16 },
    emptyState: {
      width: "100%",
      alignItems: "center",
      gap: agentHubMetrics.emptySpacing,
      paddingVertical: agentHubMetrics.emptyVerticalInset,
    },
    emptyTitle: { color: theme.text, fontSize: 16, fontWeight: "600" },
    emptySubtitle: { color: theme.secondaryText, fontSize: 13 },
    createButton: {
      height: agentHubMetrics.createButtonHeight,
      paddingHorizontal: agentHubMetrics.createButtonHorizontalInset,
      borderRadius: 99,
      backgroundColor: theme.accent,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    },
    createButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
    pressed: { opacity: 0.72 },
    disabled: { opacity: 0.72 },
    errorOverlay: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      justifyContent: "flex-end",
    },
    errorBanner: {
      margin: agentHubMetrics.errorOuterInset,
      padding: agentHubMetrics.errorInset,
      borderRadius: agentHubMetrics.errorRadius,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: "rgba(255,59,48,0.95)",
    },
    errorText: { flex: 1, color: "#FFFFFF", fontSize: 13, lineHeight: 17 },
    errorClose: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  });
}

const localStyles = StyleSheet.create({
  avatarFallback: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  scriptAvatar: {
    width: agentHubMetrics.scriptAvatarSize,
    height: agentHubMetrics.scriptAvatarSize,
    borderRadius: agentHubMetrics.scriptAvatarRadius,
  },
  scriptFallback: {
    width: agentHubMetrics.scriptAvatarSize,
    height: agentHubMetrics.scriptAvatarSize,
    borderRadius: agentHubMetrics.scriptAvatarRadius,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  scriptFallbackSymbol: { opacity: 0.7 },
});
