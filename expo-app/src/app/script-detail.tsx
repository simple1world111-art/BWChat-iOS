import { randomUUID } from "expo-crypto";
import type { ImageLoadEventData } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { createScriptRoom, deleteScript, getScript, updateScript } from "@/api/bwchat";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { TopToast } from "@/components/TopToast";
import { env } from "@/config/env";
import type { InteractiveScript, ScriptRole } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { invalidateAgentCatalog } from "@/services/agents/AgentCatalogRepository";
import {
  invalidateScriptCatalog,
  subscribeScriptLibraryChanges,
} from "@/services/scripts/ScriptCatalogRepository";
import {
  clearPendingScriptForNavigation,
  pendingScriptForNavigation,
  rememberScriptForNavigation,
} from "@/services/scripts/ScriptNavigationStore";
import { saveCachedScriptRoom } from "@/services/scripts/ScriptRoomRepository";
import {
  canStartScript,
  isScriptOwner,
  scriptDetailCoverAspectRatio,
  scriptDetailMetrics,
  scriptDetailStatusBadges,
  scriptGenderText,
} from "@/services/scripts/scriptDetailPolicy";
import { scriptText } from "@/services/scripts/scriptCenterPolicy";
import { palette } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export default function ScriptDetailScreen() {
  const params = useLocalSearchParams<{ scriptId?: string | string[] }>();
  const scriptId = firstParam(params.scriptId).trim();
  const { user } = useAuth();
  const ownerId = user?.user_id.trim() ?? "";

  return (
    <ScriptDetailOwnerScreen
      key={`${encodeURIComponent(ownerId)}:${encodeURIComponent(scriptId)}`}
      ownerId={ownerId}
      scriptId={scriptId}
    />
  );
}

export function ScriptDetailOwnerScreen({
  ownerId,
  scriptId,
}: {
  ownerId: string;
  scriptId: string;
}) {
  const { selectedLanguage } = useLocalization();
  const initialScript = useMemo(
    () => pendingScriptForNavigation(scriptId, ownerId),
    [ownerId, scriptId],
  );
  const scheme = useColorScheme();
  const theme = palette(scheme);
  const styles = useMemo(() => makeStyles(scheme), [scheme]);
  const insets = useSafeAreaInsets();
  const [script, setScript] = useState<InteractiveScript | null>(initialScript);
  const [isLoading, setLoading] = useState(!initialScript);
  const [isWorking, setWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<ScriptRole | null>(null);
  const [showRoleSelection, setShowRoleSelection] = useState(false);
  const activeRef = useRef(true);
  const loadGenerationRef = useRef(0);
  const actionGenerationRef = useRef(0);
  const navigationGenerationRef = useRef(0);
  const navigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workingRef = useRef(false);
  const scriptRef = useRef(script);

  useEffect(() => {
    scriptRef.current = script;
  }, [script]);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      loadGenerationRef.current += 1;
      actionGenerationRef.current += 1;
      navigationGenerationRef.current += 1;
      workingRef.current = false;
      if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current);
      navigationTimerRef.current = null;
      clearPendingScriptForNavigation(scriptId, ownerId);
    };
  }, [ownerId, scriptId]);

  const text = useCallback(
    (chinese: string, english: string) => scriptText(selectedLanguage, chinese, english),
    [selectedLanguage],
  );

  const load = useCallback(
    async (force = false) => {
      if (!force && scriptRef.current) return;
      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;
      setLoading(true);
      setErrorMessage(null);
      try {
        const remote = await getScript(scriptId);
        if (!activeRef.current || loadGenerationRef.current !== generation) return;
        scriptRef.current = remote;
        setScript(remote);
      } catch (error) {
        if (activeRef.current && loadGenerationRef.current === generation) {
          setErrorMessage(readableError(error));
        }
      } finally {
        if (activeRef.current && loadGenerationRef.current === generation) setLoading(false);
      }
    },
    [scriptId],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(
    () =>
      subscribeScriptLibraryChanges(ownerId, (changed) => {
        if (typeof changed !== "object" || changed?.script_id !== scriptId) return;
        void load(true);
      }),
    [load, ownerId, scriptId],
  );

  const beginAction = useCallback((): number | null => {
    if (!activeRef.current || workingRef.current) return null;
    workingRef.current = true;
    loadGenerationRef.current += 1;
    const generation = actionGenerationRef.current + 1;
    actionGenerationRef.current = generation;
    setLoading(false);
    setWorking(true);
    return generation;
  }, []);

  const isCurrentAction = useCallback(
    (generation: number) => activeRef.current && actionGenerationRef.current === generation,
    [],
  );

  const finishAction = useCallback(
    (generation: number) => {
      if (!isCurrentAction(generation)) return;
      workingRef.current = false;
      setWorking(false);
    },
    [isCurrentAction],
  );

  const changeVisibility = useCallback(async () => {
    const current = scriptRef.current;
    if (!current) return;
    const generation = beginAction();
    if (generation === null) return;
    const visibility = current.visibility === "public" ? "private" : "public";
    try {
      const updated = await updateScript(scriptId, { visibility });
      if (!isCurrentAction(generation)) return;
      scriptRef.current = updated;
      setScript(updated);
      await invalidateScriptCatalog(ownerId, updated);
    } catch (error) {
      if (isCurrentAction(generation)) setErrorMessage(readableError(error));
    } finally {
      finishAction(generation);
    }
  }, [beginAction, finishAction, isCurrentAction, ownerId, scriptId]);

  const removeScript = useCallback(async () => {
    const generation = beginAction();
    if (generation === null) return;
    try {
      await deleteScript(scriptId);
      if (!isCurrentAction(generation)) return;
      await invalidateScriptCatalog(ownerId, scriptId);
      if (!isCurrentAction(generation)) return;
      clearPendingScriptForNavigation(scriptId, ownerId);
      router.back();
    } catch (error) {
      if (isCurrentAction(generation)) setErrorMessage(readableError(error));
    } finally {
      finishAction(generation);
    }
  }, [beginAction, finishAction, isCurrentAction, ownerId, scriptId]);

  const createRoom = useCallback(
    async (roleId: string): Promise<boolean> => {
      const generation = beginAction();
      if (generation === null) return false;
      try {
        const result = await createScriptRoom(scriptId, roleId, randomUUID().toUpperCase());
        if (!isCurrentAction(generation)) return false;
        await Promise.all([
          saveCachedScriptRoom(ownerId, result.room),
          invalidateAgentCatalog(ownerId),
        ]);
        if (!isCurrentAction(generation)) return false;
        setShowRoleSelection(false);
        navigationGenerationRef.current += 1;
        const navigationGeneration = navigationGenerationRef.current;
        if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current);
        navigationTimerRef.current = setTimeout(() => {
          navigationTimerRef.current = null;
          if (!activeRef.current || navigationGenerationRef.current !== navigationGeneration) {
            return;
          }
          router.push({
            pathname: "/script-room-chat",
            params: { roomId: result.room.room_id },
          });
        }, scriptDetailMetrics.roomNavigationDelayMilliseconds);
        return true;
      } catch (error) {
        if (isCurrentAction(generation)) setErrorMessage(readableError(error));
        return false;
      } finally {
        finishAction(generation);
      }
    },
    [beginAction, finishAction, isCurrentAction, ownerId, scriptId],
  );

  const confirmDelete = useCallback(() => {
    Alert.alert(
      text("删除这个剧本？", "Delete this script?"),
      text("已有房间不会被删除。", "Existing rooms will remain available."),
      [
        { text: text("取消", "Cancel"), style: "cancel" },
        { text: text("删除", "Delete"), style: "destructive", onPress: () => void removeScript() },
      ],
    );
  }, [removeScript, text]);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: script?.title || text("剧本详情", "Script Details"),
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerTitleAlign: "center",
        }}
      />
      {script ? (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <ScriptCover script={script} styles={styles} />
            <ScriptSummary
              script={script}
              selectedLanguage={selectedLanguage}
              styles={styles}
              text={text}
            />
            <ScriptRoles
              onSelect={setSelectedRole}
              script={script}
              selectedLanguage={selectedLanguage}
              styles={styles}
              text={text}
            />
            {isScriptOwner(script, ownerId) ? (
              <OwnerActions
                isWorking={isWorking}
                onDelete={confirmDelete}
                onEdit={() => {
                  rememberScriptForNavigation(script, ownerId);
                  router.push({
                    pathname: "/script-editor",
                    params: { scriptId },
                  });
                }}
                onVisibility={() => void changeVisibility()}
                script={script}
                styles={styles}
                text={text}
              />
            ) : null}
          </ScrollView>
          <View style={[styles.startBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <Pressable
              accessibilityLabel="script-detail-start"
              disabled={!canStartScript(script, isWorking)}
              onPress={() => setShowRoleSelection(true)}
              style={!canStartScript(script, isWorking) && styles.startDisabled}
            >
              <LinearGradient
                colors={[theme.accent, theme.accentDark]}
                end={{ x: 1, y: 1 }}
                start={{ x: 0, y: 0 }}
                style={styles.startButton}
              >
                {isWorking ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
                <Text style={styles.startText}>
                  {text("选择角色，开始剧情", "Choose a role and begin")}
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        </>
      ) : isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <View style={styles.emptyState}>
          <SymbolView
            name="exclamationmark.triangle"
            size={36}
            weight="semibold"
            tintColor={theme.accent}
          />
          <Text style={styles.emptyTitle}>{text("无法加载剧本", "Unable to load script")}</Text>
          <Text style={styles.emptySubtitle}>
            {errorMessage ?? text("请稍后重试", "Please try again")}
          </Text>
        </View>
      )}

      <RoleInfoModal
        onClose={() => setSelectedRole(null)}
        role={selectedRole}
        selectedLanguage={selectedLanguage}
        styles={styles}
        text={text}
      />
      {script ? (
        <RoleSelectionModal
          onClose={() => setShowRoleSelection(false)}
          onCreated={createRoom}
          script={script}
          styles={styles}
          text={text}
          visible={showRoleSelection}
        />
      ) : null}
      <TopToast
        duration={scriptDetailMetrics.toastMilliseconds}
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />
    </View>
  );
}

function ScriptCover({
  script,
  styles,
}: {
  script: InteractiveScript;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [loadedCover, setLoadedCover] = useState<{
    url: string;
    aspectRatio: number;
  } | null>(null);
  const aspectRatio =
    loadedCover?.url === script.cover_url
      ? loadedCover.aspectRatio
      : scriptDetailMetrics.coverAspectRatio;

  return (
    <View accessibilityLabel="script-detail-cover" style={[styles.cover, { aspectRatio }]}>
      <DetailImage
        fallback="book.closed.fill"
        onLoad={(event) => {
          setLoadedCover({
            url: script.cover_url,
            aspectRatio: scriptDetailCoverAspectRatio(event.source.width, event.source.height),
          });
        }}
        radius={scriptDetailMetrics.coverRadius}
        styles={styles}
        url={script.cover_url}
      />
      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.72)"]}
        locations={[0.5, 1]}
        style={styles.coverShade}
      />
      <View style={styles.coverCopy}>
        <Text numberOfLines={2} style={styles.coverTitle}>
          {script.title}
        </Text>
        <Text style={styles.coverCreator}>{script.creator.nickname}</Text>
      </View>
    </View>
  );
}

function ScriptSummary({
  script,
  selectedLanguage,
  styles,
  text,
}: {
  script: InteractiveScript;
  selectedLanguage: string;
  styles: ReturnType<typeof makeStyles>;
  text: (chinese: string, english: string) => string;
}) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.badges}>
        {scriptDetailStatusBadges(script, selectedLanguage).map((badge) => (
          <Text key={badge.id} style={[styles.statusBadge, styles[`badge_${badge.tone}`]]}>
            {badge.text}
          </Text>
        ))}
      </View>
      <Text style={styles.sectionTitle}>{text("剧情简介", "Story")}</Text>
      <Text style={styles.synopsis}>{script.synopsis}</Text>
      {script.is_admin_hidden && script.hidden_reason ? (
        <View style={styles.hiddenReason}>
          <SymbolView
            name="exclamationmark.shield.fill"
            size={13}
            tintColor={styles.danger.color}
          />
          <Text style={styles.hiddenReasonText}>{script.hidden_reason}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ScriptRoles({
  onSelect,
  script,
  selectedLanguage,
  styles,
  text,
}: {
  onSelect(role: ScriptRole): void;
  script: InteractiveScript;
  selectedLanguage: string;
  styles: ReturnType<typeof makeStyles>;
  text: (chinese: string, english: string) => string;
}) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{text("登场角色", "Characters")}</Text>
      {script.roles.map((role, index) => (
        <View key={role.role_id || role.client_role_id || role.name}>
          <Pressable
            accessibilityLabel={`script-detail-role-${role.role_id || role.client_role_id || role.name}`}
            onPress={() => onSelect(role)}
            style={styles.roleRow}
          >
            <DetailImage
              fallback="person.fill"
              radius={24}
              size={48}
              styles={styles}
              url={role.avatar_url}
            />
            <View style={styles.roleCopy}>
              <View style={styles.roleNameRow}>
                <Text style={styles.roleName}>{role.name}</Text>
                <Text style={styles.roleGender}>
                  {scriptGenderText(selectedLanguage, role.gender)}
                </Text>
              </View>
              <Text numberOfLines={2} style={styles.roleDescription}>
                {role.description}
              </Text>
            </View>
            <SymbolView
              name="chevron.right"
              size={12}
              weight="semibold"
              tintColor={styles.tertiary.color}
            />
          </Pressable>
          {index < script.roles.length - 1 ? <View style={styles.roleDivider} /> : null}
        </View>
      ))}
    </View>
  );
}

function OwnerActions({
  isWorking,
  onDelete,
  onEdit,
  onVisibility,
  script,
  styles,
  text,
}: {
  isWorking: boolean;
  onDelete(): void;
  onEdit(): void;
  onVisibility(): void;
  script: InteractiveScript;
  styles: ReturnType<typeof makeStyles>;
  text: (chinese: string, english: string) => string;
}) {
  const makePrivate = script.visibility === "public";
  return (
    <View style={styles.ownerActions}>
      <ActionRow
        color={styles.accent.color}
        icon="square.and.pencil"
        onPress={onEdit}
        styles={styles}
        title={text("编辑剧本", "Edit script")}
      />
      <View style={styles.actionDivider} />
      <ActionRow
        color={makePrivate ? styles.secondary.color : styles.success.color}
        disabled={isWorking}
        icon={makePrivate ? "lock.fill" : "globe.asia.australia.fill"}
        onPress={onVisibility}
        styles={styles}
        title={makePrivate ? text("设为私人", "Make private") : text("立即公开", "Publish now")}
      />
      <View style={styles.actionDivider} />
      <ActionRow
        color={styles.danger.color}
        icon="trash"
        onPress={onDelete}
        styles={styles}
        title={text("删除剧本", "Delete script")}
      />
    </View>
  );
}

function ActionRow({
  color,
  disabled,
  icon,
  onPress,
  styles,
  title,
}: {
  color: string;
  disabled?: boolean;
  icon: string;
  onPress(): void;
  styles: ReturnType<typeof makeStyles>;
  title: string;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={styles.actionRow}>
      <View style={styles.actionIcon}>
        <SymbolView name={icon as never} size={17} tintColor={color} />
      </View>
      <Text style={[styles.actionText, { color }]}>{title}</Text>
      <SymbolView
        name="chevron.right"
        size={12}
        weight="semibold"
        tintColor={styles.tertiary.color}
      />
    </Pressable>
  );
}

function RoleInfoModal({
  onClose,
  role,
  selectedLanguage,
  styles,
  text,
}: {
  onClose(): void;
  role: ScriptRole | null;
  selectedLanguage: string;
  styles: ReturnType<typeof makeStyles>;
  text: (chinese: string, english: string) => string;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={role !== null}
    >
      <View style={styles.modalScreen}>
        <ModalHeader
          onClose={onClose}
          title={text("角色详情", "Character")}
          trailing={text("完成", "Done")}
          styles={styles}
        />
        {role ? (
          <ScrollView contentContainerStyle={styles.roleInfoContent}>
            <DetailImage
              fallback="person.fill"
              radius={46}
              size={92}
              styles={styles}
              url={role.avatar_url}
            />
            <Text style={styles.roleInfoName}>{role.name}</Text>
            <Text style={styles.roleInfoGender}>
              {scriptGenderText(selectedLanguage, role.gender)}
            </Text>
            <Text style={styles.roleInfoDescription}>{role.description}</Text>
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

function RoleSelectionModal({
  onClose,
  onCreated,
  script,
  styles,
  text,
  visible,
}: {
  onClose(): void;
  onCreated(roleId: string): Promise<boolean>;
  script: InteractiveScript;
  styles: ReturnType<typeof makeStyles>;
  text: (chinese: string, english: string) => string;
  visible: boolean;
}) {
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [isCreating, setCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeRef = useRef(true);
  const creatingRef = useRef(false);
  const startGenerationRef = useRef(0);
  useEffect(
    () => () => {
      activeRef.current = false;
      creatingRef.current = false;
      startGenerationRef.current += 1;
    },
    [],
  );
  const close = useCallback(() => {
    if (creatingRef.current) return;
    setSelectedRoleId(null);
    setErrorMessage(null);
    onClose();
  }, [onClose]);
  const start = useCallback(async () => {
    if (!selectedRoleId || creatingRef.current) return;
    creatingRef.current = true;
    const generation = startGenerationRef.current + 1;
    startGenerationRef.current = generation;
    setCreating(true);
    try {
      const created = await onCreated(selectedRoleId);
      if (!activeRef.current || startGenerationRef.current !== generation) return;
      if (created) {
        setSelectedRoleId(null);
        setErrorMessage(null);
      } else {
        setErrorMessage(text("创建房间失败，请重试", "Unable to create room"));
      }
    } finally {
      if (activeRef.current && startGenerationRef.current === generation) {
        creatingRef.current = false;
        setCreating(false);
      }
    }
  }, [onCreated, selectedRoleId, text]);
  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={styles.modalScreen}>
        <View style={styles.modalHeader}>
          <Pressable disabled={isCreating} onPress={close}>
            <Text style={styles.modalAction}>{text("取消", "Cancel")}</Text>
          </Pressable>
          <Text style={styles.modalTitle}>{text("选择角色", "Choose Character")}</Text>
          <Pressable
            accessibilityLabel="script-role-selection-start"
            disabled={!selectedRoleId || isCreating}
            onPress={() => void start()}
            style={!selectedRoleId && styles.modalActionDisabled}
          >
            {isCreating ? (
              <ActivityIndicator color={styles.accent.color} size="small" />
            ) : (
              <Text style={styles.modalAction}>{text("开始", "Start")}</Text>
            )}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.selectionContent}>
          <Text style={styles.selectionIntro}>
            {text(
              "你将扮演一个角色，其余角色由 AI 群演。",
              "You play one character; AI plays the rest.",
            )}
          </Text>
          {script.roles.map((role) => {
            const selected = selectedRoleId === role.role_id;
            return (
              <Pressable
                accessibilityLabel={`script-role-selection-${role.role_id || role.client_role_id || role.name}`}
                key={role.role_id || role.client_role_id || role.name}
                onPress={() => setSelectedRoleId(role.role_id)}
                style={styles.selectionRole}
              >
                <DetailImage
                  fallback="person.fill"
                  radius={24}
                  size={48}
                  styles={styles}
                  url={role.avatar_url}
                />
                <View style={styles.selectionCopy}>
                  <Text style={styles.roleName}>{role.name}</Text>
                  <Text numberOfLines={1} style={styles.selectionDescription}>
                    {role.description}
                  </Text>
                </View>
                <SymbolView
                  name={selected ? "checkmark.circle.fill" : "circle"}
                  size={22}
                  tintColor={selected ? styles.accent.color : styles.tertiary.color}
                />
              </Pressable>
            );
          })}
        </ScrollView>
        <TopToast duration={3_000} message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      </View>
    </Modal>
  );
}

function ModalHeader({
  onClose,
  styles,
  title,
  trailing,
}: {
  onClose(): void;
  styles: ReturnType<typeof makeStyles>;
  title: string;
  trailing: string;
}) {
  return (
    <View style={styles.modalHeader}>
      <View style={styles.modalHeaderSpacer} />
      <Text style={styles.modalTitle}>{title}</Text>
      <Pressable onPress={onClose}>
        <Text style={styles.modalAction}>{trailing}</Text>
      </Pressable>
    </View>
  );
}

function DetailImage({
  fallback,
  onLoad,
  radius,
  size,
  styles,
  url,
}: {
  fallback: string;
  onLoad?: ((event: ImageLoadEventData) => void) | undefined;
  radius: number;
  size?: number;
  styles: ReturnType<typeof makeStyles>;
  url: string;
}) {
  const resolved = resolveMediaUrl(url, env.apiBaseUrl);
  const imageStyle = size
    ? { width: size, height: size, borderRadius: radius }
    : { width: "100%" as const, height: "100%" as const, borderRadius: radius };
  const fallbackView = (
    <LinearGradient
      colors={["rgba(102,126,234,0.12)", "#F2E8FF"]}
      style={[imageStyle, styles.imageFallback]}
    >
      <SymbolView
        name={fallback as never}
        size={size ? Math.min(24, size / 2) : 28}
        weight="semibold"
        tintColor="rgba(102,126,234,0.70)"
      />
    </LinearGradient>
  );
  return resolved ? (
    <AuthenticatedImage
      contentFit="cover"
      errorFallback={fallbackView}
      fallback={fallbackView}
      loadingFallback={
        <View style={[imageStyle, styles.imageLoading]}>
          <ActivityIndicator color="#667EEA" />
        </View>
      }
      {...(onLoad ? { onLoad } : {})}
      style={imageStyle}
      transition={0}
      uri={resolved}
    />
  ) : (
    fallbackView
  );
}

function makeStyles(scheme: ReturnType<typeof useColorScheme>) {
  const theme = palette(scheme);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    accent: { color: theme.accent },
    secondary: { color: theme.secondaryText },
    tertiary: { color: theme.tertiaryText },
    success: { color: theme.success },
    danger: { color: theme.danger },
    content: {
      gap: scriptDetailMetrics.contentGap,
      paddingHorizontal: scriptDetailMetrics.contentHorizontalInset,
      paddingBottom: scriptDetailMetrics.contentBottomInset,
    },
    cover: {
      width: "100%",
      marginTop: scriptDetailMetrics.coverTopInset,
      overflow: "hidden",
      borderRadius: scriptDetailMetrics.coverRadius,
    },
    coverShade: {
      position: "absolute",
      inset: 0,
      borderRadius: scriptDetailMetrics.coverRadius,
    },
    coverCopy: {
      position: "absolute",
      left: scriptDetailMetrics.coverTextInset,
      right: scriptDetailMetrics.coverTextInset,
      bottom: scriptDetailMetrics.coverTextInset,
      gap: scriptDetailMetrics.coverCopyGap,
    },
    coverTitle: {
      color: "#FFFFFF",
      fontSize: scriptDetailMetrics.coverTitleSize,
      fontWeight: "700",
      lineHeight: 30,
    },
    coverCreator: {
      color: "rgba(255,255,255,0.82)",
      fontSize: scriptDetailMetrics.coverCreatorSize,
      fontWeight: "500",
    },
    sectionCard: {
      gap: scriptDetailMetrics.summaryGap,
      padding: scriptDetailMetrics.sectionInset,
      borderRadius: scriptDetailMetrics.sectionRadius,
      backgroundColor: theme.card,
    },
    badges: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: scriptDetailMetrics.statusGap,
    },
    statusBadge: {
      overflow: "hidden",
      fontSize: scriptDetailMetrics.statusFontSize,
      fontWeight: "600",
      paddingHorizontal: scriptDetailMetrics.statusHorizontalInset,
      paddingVertical: scriptDetailMetrics.statusVerticalInset,
      borderRadius: 999,
    },
    badge_accent: { color: theme.accent, backgroundColor: "rgba(102,126,234,0.10)" },
    badge_success: { color: theme.success, backgroundColor: "rgba(52,199,89,0.10)" },
    badge_secondary: {
      color: theme.secondaryText,
      backgroundColor: scheme === "dark" ? "rgba(167,167,181,0.10)" : "rgba(158,158,184,0.10)",
    },
    badge_danger: { color: theme.danger, backgroundColor: "rgba(255,59,48,0.10)" },
    sectionTitle: {
      color: theme.text,
      fontSize: scriptDetailMetrics.sectionTitleSize,
      fontWeight: "600",
    },
    synopsis: {
      color: theme.secondaryText,
      fontSize: scriptDetailMetrics.synopsisSize,
      lineHeight: 21,
    },
    hiddenReason: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      padding: scriptDetailMetrics.hiddenReasonInset,
      borderRadius: scriptDetailMetrics.hiddenReasonRadius,
      backgroundColor: "rgba(255,59,48,0.08)",
    },
    hiddenReasonText: {
      flex: 1,
      color: theme.danger,
      fontSize: scriptDetailMetrics.hiddenReasonSize,
    },
    roleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: scriptDetailMetrics.roleRowGap,
    },
    roleCopy: { flex: 1, gap: scriptDetailMetrics.roleCopyGap },
    roleNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    roleName: {
      color: theme.text,
      fontSize: scriptDetailMetrics.roleNameSize,
      fontWeight: "600",
    },
    roleGender: {
      color: theme.accent,
      fontSize: scriptDetailMetrics.roleGenderSize,
      fontWeight: "500",
    },
    roleDescription: {
      color: theme.secondaryText,
      fontSize: scriptDetailMetrics.roleDescriptionSize,
      lineHeight: 17,
    },
    roleDivider: {
      height: StyleSheet.hairlineWidth,
      marginVertical: scriptDetailMetrics.roleListGap,
      backgroundColor: theme.separator,
    },
    ownerActions: {
      paddingHorizontal: scriptDetailMetrics.sectionInset,
      borderRadius: scriptDetailMetrics.sectionRadius,
      backgroundColor: theme.card,
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: scriptDetailMetrics.actionRowGap,
      paddingVertical: scriptDetailMetrics.actionVerticalInset,
    },
    actionIcon: { width: scriptDetailMetrics.actionIconWidth, alignItems: "center" },
    actionText: {
      flex: 1,
      fontSize: scriptDetailMetrics.actionTextSize,
      fontWeight: "500",
    },
    actionDivider: {
      height: StyleSheet.hairlineWidth,
      marginLeft: scriptDetailMetrics.actionDividerInset,
      backgroundColor: theme.separator,
    },
    startBar: {
      paddingHorizontal: scriptDetailMetrics.startHorizontalInset,
      paddingTop: scriptDetailMetrics.startOuterVerticalInset,
      borderTopColor: theme.separator,
      borderTopWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.card,
    },
    startButton: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      paddingVertical: scriptDetailMetrics.startVerticalInset,
      borderRadius: scriptDetailMetrics.startRadius,
    },
    startText: {
      color: "#FFFFFF",
      fontSize: scriptDetailMetrics.startTextSize,
      fontWeight: "600",
    },
    startDisabled: { opacity: 0.45 },
    loadingState: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 30 },
    emptyTitle: { color: theme.text, fontSize: 17, fontWeight: "600" },
    emptySubtitle: { color: theme.secondaryText, fontSize: 14, textAlign: "center" },
    modalScreen: { flex: 1, backgroundColor: theme.background },
    modalHeader: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      borderBottomColor: theme.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.card,
    },
    modalHeaderSpacer: { minWidth: 44 },
    modalTitle: { color: theme.text, fontSize: 17, fontWeight: "600" },
    modalAction: { minWidth: 44, color: theme.accent, fontSize: 17, textAlign: "right" },
    modalActionDisabled: { opacity: 0.38 },
    roleInfoContent: { alignItems: "center", gap: 16, padding: 20 },
    roleInfoName: { color: theme.text, fontSize: 22, fontWeight: "700" },
    roleInfoGender: { color: theme.accent, fontSize: 13, fontWeight: "600" },
    roleInfoDescription: {
      width: "100%",
      color: theme.secondaryText,
      fontSize: 15,
      lineHeight: 21,
      padding: 16,
      borderRadius: 14,
      backgroundColor: theme.card,
    },
    selectionContent: { gap: 10, padding: 16 },
    selectionIntro: { color: theme.secondaryText, fontSize: 14, paddingBottom: 4 },
    selectionRole: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: 14,
      backgroundColor: theme.card,
    },
    selectionCopy: { flex: 1, gap: 3 },
    selectionDescription: { color: theme.secondaryText, fontSize: 12 },
    imageFallback: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
    imageLoading: {
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
    },
  });
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}
