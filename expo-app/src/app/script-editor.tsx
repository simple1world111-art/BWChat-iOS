import { Host, Picker, Text as SwiftUIText } from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  createScript,
  getScript,
  getScriptCategories,
  updateScript,
  uploadScriptAsset,
} from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { TopToast } from "@/components/TopToast";
import { env } from "@/config/env";
import type { InteractiveScript, ScriptCategory } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  invalidateScriptCatalog,
  loadCachedScriptCategories,
  saveCachedScriptCategories,
} from "@/services/scripts/ScriptCatalogRepository";
import {
  clearPendingScriptForNavigation,
  pendingScriptForNavigation,
} from "@/services/scripts/ScriptNavigationStore";
import { scriptText } from "@/services/scripts/scriptCenterPolicy";
import {
  emptyScriptDraft,
  emptyScriptRoleDraft,
  limitScriptCharacters,
  prepareScriptImage,
  removeDisposableScriptImage,
  scriptCharacterCount,
  scriptDraftFromScript,
  scriptDraftRequestBody,
  scriptDraftValidationMessages,
  scriptEditorMetrics,
  scriptRoleValidationMessage,
  type ScriptDraft,
  type ScriptRoleDraft,
} from "@/services/scripts/scriptEditorPolicy";
import { pickScriptRoleAvatar } from "@/services/scripts/ScriptRoleMediaPicker";
import { colors, palette } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export default function ScriptEditorScreen() {
  const params = useLocalSearchParams<{ scriptId?: string | string[] }>();
  const scriptId = firstParam(params.scriptId).trim();
  const { user } = useAuth();
  const ownerId = user?.user_id.trim() ?? "";

  return (
    <ScriptEditorOwnerScreen
      key={`${encodeURIComponent(ownerId)}:${encodeURIComponent(scriptId)}`}
      ownerId={ownerId}
      scriptId={scriptId}
    />
  );
}

export function ScriptEditorOwnerScreen({
  ownerId,
  scriptId,
}: {
  ownerId: string;
  scriptId: string;
}) {
  const { selectedLanguage } = useLocalization();
  const pendingScript = useMemo(
    () => pendingScriptForNavigation(scriptId, ownerId),
    [ownerId, scriptId],
  );
  const initialScript =
    pendingScript?.creator.user_id === ownerId && ownerId ? pendingScript : null;
  const scheme = useColorScheme();
  const theme = palette(scheme);
  const styles = useMemo(() => makeStyles(scheme), [scheme]);
  const [sourceScript, setSourceScript] = useState<InteractiveScript | null>(initialScript);
  const [draft, setDraft] = useState<ScriptDraft>(() =>
    initialScript ? scriptDraftFromScript(initialScript) : emptyScriptDraft(),
  );
  const [categories, setCategories] = useState<ScriptCategory[]>([]);
  const [editingRole, setEditingRole] = useState<ScriptRoleDraft | null>(null);
  const [isHydrating, setHydrating] = useState(Boolean(scriptId && !initialScript));
  const [isSaving, setSaving] = useState(false);
  const [isPickingCover, setPickingCover] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  const [editLoadAttempt, setEditLoadAttempt] = useState(0);
  const activeRef = useRef(true);
  const coverPickGenerationRef = useRef(0);
  const coverPickingRef = useRef(false);
  const draftRef = useRef(draft);
  const ownerIdRef = useRef(ownerId);
  const saveGenerationRef = useRef(0);
  const savingRef = useRef(false);
  const uploadingMediaRef = useRef(new Set<string>());

  const text = useCallback(
    (chinese: string, english: string) => scriptText(selectedLanguage, chinese, english),
    [selectedLanguage],
  );
  const isEditing = Boolean(sourceScript || scriptId);

  const replaceDraft = useCallback((update: (current: ScriptDraft) => ScriptDraft) => {
    const previous = draftRef.current;
    const next = update(previous);
    draftRef.current = next;
    setDraft(next);
    cleanupLostScriptDraftMedia(previous, next, uploadingMediaRef.current);
  }, []);

  useEffect(() => {
    ownerIdRef.current = ownerId;
  }, [ownerId]);

  useEffect(() => {
    activeRef.current = true;
    const protectedMedia = uploadingMediaRef.current;
    return () => {
      activeRef.current = false;
      coverPickGenerationRef.current += 1;
      saveGenerationRef.current += 1;
      coverPickingRef.current = false;
      savingRef.current = false;
      Keyboard.dismiss();
      cleanupScriptDraftMedia(draftRef.current, protectedMedia);
      if (scriptId) clearPendingScriptForNavigation(scriptId, ownerId);
    };
  }, [ownerId, scriptId]);

  useEffect(() => {
    if (!scriptId || initialScript) return;
    if (!ownerId) return;
    let active = true;
    void getScript(scriptId)
      .then((script) => {
        if (!active) return;
        if (script.creator.user_id !== ownerId) {
          throw new Error(text("你只能编辑自己的剧本", "You can only edit your own scripts"));
        }
        setSourceScript(script);
        replaceDraft(() => scriptDraftFromScript(script));
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = readableError(error);
        setEditLoadError(message);
        setErrorMessage(message);
      })
      .finally(() => {
        if (active) setHydrating(false);
      });
    return () => {
      active = false;
    };
  }, [editLoadAttempt, initialScript, ownerId, replaceDraft, scriptId, text]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = ownerId ? await loadCachedScriptCategories(ownerId).catch(() => null) : null;
      if (!active) return;
      if (cached) setCategories(cached.value);
      if (cached && !cached.isStale) return;
      try {
        const remote = await getScriptCategories();
        if (!active) return;
        setCategories(remote);
        if (ownerId) await saveCachedScriptCategories(ownerId, remote).catch(() => undefined);
      } catch (error) {
        if (active && !cached) setErrorMessage(readableError(error));
      }
    })();
    return () => {
      active = false;
    };
  }, [ownerId]);

  const pickCover = useCallback(async () => {
    if (coverPickingRef.current || savingRef.current) return;
    coverPickingRef.current = true;
    const generation = ++coverPickGenerationRef.current;
    const expectedOwnerId = ownerId;
    Keyboard.dismiss();
    setPickingCover(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        selectionLimit: 1,
        quality: 1,
      });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset) return;
      const uri = await prepareScriptImage(asset.uri, asset.width, asset.height, "script_cover");
      const isCurrent =
        activeRef.current &&
        generation === coverPickGenerationRef.current &&
        expectedOwnerId === ownerIdRef.current;
      if (!isCurrent) {
        removeDisposableScriptImage(uri);
        return;
      }
      replaceDraft((current) => ({ ...current, coverUri: uri }));
    } catch {
      // Native PhotosPicker silently preserves the existing cover when loading or decoding fails.
    } finally {
      if (generation === coverPickGenerationRef.current) {
        coverPickingRef.current = false;
        if (activeRef.current) setPickingCover(false);
      }
    }
  }, [ownerId, replaceDraft]);

  const retryEditLoad = useCallback(() => {
    if (!scriptId || isHydrating) return;
    setErrorMessage(null);
    setEditLoadError(null);
    setHydrating(true);
    setEditLoadAttempt((current) => current + 1);
  }, [isHydrating, scriptId]);

  const save = useCallback(async () => {
    if (savingRef.current || isHydrating || (scriptId && !sourceScript)) return;
    Keyboard.dismiss();
    const messages = scriptDraftValidationMessages(draft);
    if (messages.length > 0) {
      setErrorMessage(messages.join("\n"));
      return;
    }
    savingRef.current = true;
    const generation = ++saveGenerationRef.current;
    const expectedOwnerId = ownerId;
    const isCurrent = () =>
      activeRef.current &&
      generation === saveGenerationRef.current &&
      expectedOwnerId === ownerIdRef.current;
    setSaving(true);
    setErrorMessage(null);
    try {
      let preparedDraft = cloneDraft(draft);
      if (preparedDraft.coverUri) {
        const localCoverUri = preparedDraft.coverUri;
        uploadingMediaRef.current.add(localCoverUri);
        let asset: Awaited<ReturnType<typeof uploadScriptAsset>>;
        let cleanedAfterUnmount = false;
        try {
          asset = await uploadScriptAsset(
            "script_cover",
            localCoverUri,
            `script-cover-${randomUUID()}.jpg`,
          );
        } finally {
          uploadingMediaRef.current.delete(localCoverUri);
          if (!activeRef.current) {
            removeDisposableScriptImage(localCoverUri);
            cleanedAfterUnmount = true;
          }
        }
        if (!isCurrent()) {
          if (!cleanedAfterUnmount) removeDisposableScriptImage(localCoverUri);
          return;
        }
        preparedDraft = { ...preparedDraft, coverUrl: asset.url, coverUri: undefined };
        replaceDraft((current) =>
          current.coverUri === localCoverUri
            ? { ...current, coverUrl: asset.url, coverUri: undefined }
            : current,
        );
      }
      for (let index = 0; index < preparedDraft.roles.length; index += 1) {
        const role = preparedDraft.roles[index];
        if (!role?.avatarUri) continue;
        const localAvatarUri = role.avatarUri;
        uploadingMediaRef.current.add(localAvatarUri);
        let asset: Awaited<ReturnType<typeof uploadScriptAsset>>;
        let cleanedAfterUnmount = false;
        try {
          asset = await uploadScriptAsset(
            "script_role_avatar",
            localAvatarUri,
            `script-role-${randomUUID()}.jpg`,
          );
        } finally {
          uploadingMediaRef.current.delete(localAvatarUri);
          if (!activeRef.current) {
            removeDisposableScriptImage(localAvatarUri);
            cleanedAfterUnmount = true;
          }
        }
        if (!isCurrent()) {
          if (!cleanedAfterUnmount) removeDisposableScriptImage(localAvatarUri);
          return;
        }
        const roles = [...preparedDraft.roles];
        roles[index] = { ...role, avatarUrl: asset.url, avatarUri: undefined };
        preparedDraft = { ...preparedDraft, roles };
        replaceDraft((current) => ({
          ...current,
          roles: current.roles.map((currentRole) =>
            currentRole.id === role.id && currentRole.avatarUri === localAvatarUri
              ? { ...currentRole, avatarUrl: asset.url, avatarUri: undefined }
              : currentRole,
          ),
        }));
      }
      const saved =
        sourceScript?.script_id || scriptId
          ? await updateScript(
              sourceScript?.script_id || scriptId,
              scriptDraftRequestBody(preparedDraft),
            )
          : await createScript(scriptDraftRequestBody(preparedDraft));
      if (!isCurrent()) return;
      if (expectedOwnerId) {
        await invalidateScriptCatalog(expectedOwnerId, saved).catch(() => undefined);
      }
      if (!isCurrent()) return;
      if (scriptId) clearPendingScriptForNavigation(scriptId, ownerId);
      router.back();
    } catch (error) {
      if (isCurrent()) setErrorMessage(readableError(error));
    } finally {
      if (generation === saveGenerationRef.current) {
        savingRef.current = false;
        if (activeRef.current) setSaving(false);
      }
    }
  }, [draft, isHydrating, ownerId, replaceDraft, scriptId, sourceScript]);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: isEditing ? text("编辑剧本", "Edit Script") : text("创建剧本", "Create Script"),
          headerBackVisible: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTitleAlign: "center",
          headerLeft: () => (
            <Pressable
              accessibilityLabel={text("返回", "Back")}
              hitSlop={10}
              onPress={() => {
                Keyboard.dismiss();
                router.back();
              }}
              style={styles.headerButton}
            >
              <SymbolView name="chevron.left" size={19} weight="semibold" tintColor={theme.text} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              accessibilityLabel={text("保存", "Save")}
              disabled={isSaving || isHydrating || Boolean(scriptId && !sourceScript)}
              hitSlop={10}
              onPress={() => void save()}
              style={[styles.headerButton, styles.headerSaveButton]}
              testID="script-editor-save"
            >
              {isSaving ? (
                <ActivityIndicator color={theme.accent} size="small" />
              ) : (
                <Text
                  style={[
                    styles.headerSave,
                    (isHydrating || Boolean(scriptId && !sourceScript)) && styles.disabled,
                  ]}
                >
                  {text("保存", "Save")}
                </Text>
              )}
            </Pressable>
          ),
        }}
      />

      <Pressable
        accessible={false}
        onPress={Keyboard.dismiss}
        pointerEvents={isSaving ? "none" : "auto"}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <FormSection title={text("发布设置", "Publishing")} styles={styles}>
            <View style={styles.visibilityRow}>
              <View style={styles.flex}>
                <Text style={styles.primaryRowText}>{text("公开剧本", "Public script")}</Text>
                <Text style={styles.visibilityDetail}>
                  {text("完整后公开会立即展示", "Complete scripts appear immediately")}
                </Text>
              </View>
              <Switch
                accessibilityLabel={text("公开剧本", "Public script")}
                disabled={isSaving}
                ios_backgroundColor={theme.separator}
                onValueChange={(value) => {
                  Keyboard.dismiss();
                  replaceDraft((current) => ({
                    ...current,
                    visibility: value ? "public" : "private",
                  }));
                }}
                trackColor={{ false: theme.separator, true: theme.accent }}
                value={draft.visibility === "public"}
              />
            </View>
          </FormSection>

          <FormSection title={text("剧本封面", "Script Cover")} styles={styles}>
            <Pressable
              accessibilityLabel={text("剧本封面", "Script Cover")}
              disabled={isSaving || isPickingCover}
              onPress={() => void pickCover()}
              style={styles.coverButton}
              testID="script-editor-cover"
            >
              <CoverPreview draft={draft} isLoading={isPickingCover} styles={styles} text={text} />
            </Pressable>
          </FormSection>

          <FormSection
            footer={text(
              "公开剧本需要填写 5～15 个字符。",
              "Public scripts require 5–15 characters.",
            )}
            title={text("剧本标题", "Script Title")}
            styles={styles}
          >
            <CountedInput
              accessibilityLabel={text("剧本标题", "Script Title")}
              mainEditor
              maximum={scriptEditorMetrics.titleMaximumCharacters}
              onChange={(value) => replaceDraft((current) => ({ ...current, title: value }))}
              placeholder={text("请输入剧本标题", "Enter script title")}
              styles={styles}
              value={draft.title}
            />
          </FormSection>

          <FormSection
            footer={text(
              "公开剧本需要填写 20～500 个字符。",
              "Public scripts require 20–500 characters.",
            )}
            title={text("剧情简介", "Synopsis")}
            styles={styles}
          >
            <CountedInput
              accessibilityLabel={text("剧情简介", "Synopsis")}
              mainEditor
              maximum={scriptEditorMetrics.synopsisMaximumCharacters}
              minimumHeight={scriptEditorMetrics.synopsisMinimumHeight}
              multiline
              onChange={(value) => replaceDraft((current) => ({ ...current, synopsis: value }))}
              styles={styles}
              value={draft.synopsis}
            />
          </FormSection>

          <FormSection
            footer={text(
              "公开剧本至少选择一个分类。",
              "Public scripts require at least one category.",
            )}
            title={text("剧本分类", "Script Categories")}
            styles={styles}
          >
            {categories.length === 0 ? (
              <ActivityIndicator color={theme.accent} style={styles.categoryLoading} />
            ) : (
              categories.map((category, index) => {
                const selected = draft.categoryIds.includes(category.id);
                return (
                  <Pressable
                    accessibilityLabel={category.name}
                    key={category.id}
                    onPress={() => {
                      Keyboard.dismiss();
                      replaceDraft((current) => ({
                        ...current,
                        categoryIds: selected
                          ? current.categoryIds.filter((id) => id !== category.id)
                          : [...current.categoryIds, category.id],
                      }));
                    }}
                    style={[styles.choiceRow, index > 0 && styles.dividedRow]}
                  >
                    <Text style={styles.primaryRowText}>{category.name}</Text>
                    <SymbolView
                      name={selected ? "checkmark.circle.fill" : "circle"}
                      size={21}
                      tintColor={selected ? theme.accent : theme.tertiaryText}
                    />
                  </Pressable>
                );
              })
            )}
          </FormSection>

          <FormSection
            footer={text(
              "不会展示在公开详情，仅用于服务端生成剧情。",
              "Not shown publicly; used only for server-side generation.",
            )}
            title={text("世界隐藏设定", "Hidden World Setting")}
            styles={styles}
          >
            <CountedInput
              accessibilityLabel={text("世界隐藏设定", "Hidden World Setting")}
              mainEditor
              maximum={scriptEditorMetrics.worldSettingMaximumCharacters}
              minimumHeight={scriptEditorMetrics.worldSettingMinimumHeight}
              multiline
              onChange={(value) => replaceDraft((current) => ({ ...current, worldSetting: value }))}
              styles={styles}
              value={draft.worldSetting}
            />
          </FormSection>

          <FormSection
            footer={text(
              "公开或开局至少需要两个完整角色。",
              "Publishing or starting requires at least two complete characters.",
            )}
            title={text(
              `角色列表（${draft.roles.length}/12）`,
              `Characters (${draft.roles.length}/12)`,
            )}
            styles={styles}
          >
            {draft.roles.map((role, index) => (
              <View key={role.id} style={[styles.roleRow, index > 0 && styles.dividedRow]}>
                <Pressable
                  accessibilityLabel={text("编辑角色", "Edit Character")}
                  onPress={() => {
                    Keyboard.dismiss();
                    setEditingRole({ ...role });
                  }}
                  style={styles.roleMain}
                >
                  <RoleAvatar
                    role={role}
                    size={scriptEditorMetrics.roleAvatarSize}
                    styles={styles}
                  />
                  <View style={styles.roleCopy}>
                    <Text numberOfLines={1} style={styles.roleName}>
                      {trimFoundationWhitespacesAndNewlines(role.name) ||
                        text("未命名角色", "Unnamed character")}
                    </Text>
                    <Text numberOfLines={1} style={styles.roleDescription}>
                      {trimFoundationWhitespacesAndNewlines(role.roleDescription) ||
                        text("点击补充角色资料", "Tap to add details")}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  accessibilityLabel={text("删除角色", "Delete character")}
                  hitSlop={9}
                  onPress={() => {
                    Keyboard.dismiss();
                    replaceDraft((current) => ({
                      ...current,
                      roles: current.roles.filter((item) => item.id !== role.id),
                    }));
                  }}
                  style={styles.trashButton}
                >
                  <SymbolView name="trash" size={18} tintColor={theme.danger} />
                </Pressable>
              </View>
            ))}
            <Pressable
              accessibilityLabel={text("添加角色", "Add Character")}
              onPress={() => {
                Keyboard.dismiss();
                if (draft.roles.length >= scriptEditorMetrics.maximumRoles) {
                  setErrorMessage(text("最多添加 12 个角色", "You can add up to 12 characters"));
                  return;
                }
                setEditingRole(emptyScriptRoleDraft(randomUUID()));
              }}
              style={[styles.addRoleRow, draft.roles.length > 0 && styles.dividedRow]}
            >
              <SymbolView name="plus.circle.fill" size={19} tintColor={theme.accent} />
              <Text style={styles.addRoleText}>{text("添加角色", "Add Character")}</Text>
            </Pressable>
          </FormSection>
        </ScrollView>
      </Pressable>

      {scriptId && !sourceScript ? (
        <View style={styles.loadingOverlay}>
          {isHydrating ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <View style={styles.editLoadFailure}>
              <SymbolView
                name="exclamationmark.triangle"
                size={34}
                weight="semibold"
                tintColor={theme.accent}
              />
              <Text style={styles.editLoadTitle}>
                {text("无法加载剧本", "Unable to load script")}
              </Text>
              <Text style={styles.editLoadMessage}>
                {editLoadError ?? text("请稍后重试", "Please try again")}
              </Text>
              <Pressable
                accessibilityLabel={text("重试", "Retry")}
                accessibilityRole="button"
                onPress={retryEditLoad}
                style={styles.retryButton}
              >
                <Text style={styles.retryText}>{text("重试", "Retry")}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
      <TopToast
        duration={scriptEditorMetrics.editorToastMilliseconds}
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />
      {editingRole ? (
        <ScriptRoleEditorModal
          key={editingRole.id}
          onClose={() => setEditingRole(null)}
          onSave={(role) => {
            replaceDraft((current) => {
              const index = current.roles.findIndex((item) => item.id === role.id);
              if (index < 0) return { ...current, roles: [...current.roles, role] };
              const roles = [...current.roles];
              roles[index] = role;
              return { ...current, roles };
            });
            setEditingRole(null);
          }}
          role={editingRole}
          scheme={scheme}
          selectedLanguage={selectedLanguage}
          styles={styles}
          text={text}
        />
      ) : null}
    </View>
  );
}

type EditorStyles = ReturnType<typeof makeStyles>;
type EditorText = (chinese: string, english: string) => string;

function FormSection({
  children,
  footer,
  secondaryHeader = false,
  styles,
  title,
}: {
  children: React.ReactNode;
  footer?: string | undefined;
  secondaryHeader?: boolean | undefined;
  styles: EditorStyles;
  title: string;
}) {
  return (
    <View
      style={[
        styles.section,
        !secondaryHeader && styles.mainSection,
        !secondaryHeader && footer && styles.mainSectionWithFooter,
      ]}
    >
      <Text
        style={[
          styles.sectionHeader,
          !secondaryHeader && styles.mainSectionHeader,
          secondaryHeader && styles.roleSectionHeader,
        ]}
      >
        {title}
      </Text>
      <View style={[styles.sectionCard, !secondaryHeader && styles.mainSectionCard]}>
        {children}
      </View>
      {footer ? (
        <Text style={[styles.sectionFooter, !secondaryHeader && styles.mainSectionFooter]}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

function CountedInput({
  accessibilityLabel,
  mainEditor = false,
  maximum,
  minimumHeight,
  multiline = false,
  onChange,
  placeholder,
  styles,
  value,
}: {
  accessibilityLabel?: string | undefined;
  mainEditor?: boolean | undefined;
  maximum: number;
  minimumHeight?: number | undefined;
  multiline?: boolean | undefined;
  onChange(value: string): void;
  placeholder?: string | undefined;
  styles: EditorStyles;
  value: string;
}) {
  return (
    <View style={[styles.countedInput, mainEditor && styles.mainCountedInput]}>
      <TextInput
        accessibilityHint={`${scriptCharacterCount(value)}/${maximum}`}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        multiline={multiline}
        onChangeText={(next) => onChange(limitScriptCharacters(next, maximum))}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiaryText}
        scrollEnabled={multiline}
        style={[
          styles.textInput,
          multiline && styles.multilineInput,
          minimumHeight ? { minHeight: minimumHeight } : null,
        ]}
        textAlignVertical={multiline ? "top" : "center"}
        value={value}
      />
      <Text accessible={false} style={styles.counter}>
        {scriptCharacterCount(value)}/{maximum}
      </Text>
    </View>
  );
}

function CoverPreview({
  draft,
  isLoading,
  styles,
  text,
}: {
  draft: ScriptDraft;
  isLoading: boolean;
  styles: EditorStyles;
  text: EditorText;
}) {
  const remote = resolveMediaUrl(draft.coverUrl, env.apiBaseUrl);
  if (draft.coverUri) {
    return <Image contentFit="cover" source={draft.coverUri} style={styles.coverImage} />;
  }
  if (remote) {
    return <AuthenticatedImage contentFit="cover" uri={remote} style={styles.coverImage} />;
  }
  return (
    <View style={styles.coverPlaceholder}>
      {isLoading ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <SymbolView
          name="photo.badge.plus"
          size={scriptEditorMetrics.coverSymbolSize}
          weight="semibold"
          tintColor={colors.accent}
        />
      )}
      <Text style={styles.coverPlaceholderText}>{text("选择剧本封面", "Choose cover")}</Text>
    </View>
  );
}

function RoleAvatar({
  role,
  size,
  styles,
  accentStroke = false,
}: {
  role: ScriptRoleDraft;
  size: number;
  styles: EditorStyles;
  accentStroke?: boolean | undefined;
}) {
  const source = role.avatarUri ?? resolveMediaUrl(role.avatarUrl, env.apiBaseUrl);
  const imageStyle = [
    styles.roleAvatarImage,
    { width: size, height: size, borderRadius: size / 2 },
    accentStroke && styles.roleAvatarStroke,
  ];
  if (role.avatarUri)
    return <Image contentFit="cover" source={role.avatarUri} style={imageStyle} />;
  if (source) return <AuthenticatedImage contentFit="cover" uri={source} style={imageStyle} />;
  return (
    <View
      style={[styles.roleAvatarPlaceholder, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <SymbolView
        name={size > 50 ? "camera.fill" : "person.fill"}
        size={size > 50 ? 24 : 17}
        tintColor={colors.accent}
      />
    </View>
  );
}

export function ScriptRoleEditorModal({
  onClose,
  onSave,
  role,
  scheme,
  selectedLanguage,
  styles,
  text,
}: {
  onClose(): void;
  onSave(role: ScriptRoleDraft): void;
  role: ScriptRoleDraft;
  scheme: ReturnType<typeof useColorScheme>;
  selectedLanguage: string;
  styles: EditorStyles;
  text: EditorText;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<ScriptRoleDraft>({ ...role });
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const activeRef = useRef(true);
  const avatarUriRef = useRef(draft.avatarUri);
  const initialAvatarUriRef = useRef(role.avatarUri);
  const pickerGenerationRef = useRef(0);
  const pickingRef = useRef(false);
  const transferredRef = useRef(false);

  useEffect(() => {
    avatarUriRef.current = draft.avatarUri;
  }, [draft.avatarUri]);

  useEffect(() => {
    activeRef.current = true;
    const initialAvatarUri = initialAvatarUriRef.current;
    return () => {
      activeRef.current = false;
      pickerGenerationRef.current += 1;
      pickingRef.current = false;
      if (
        !transferredRef.current &&
        avatarUriRef.current &&
        avatarUriRef.current !== initialAvatarUri
      ) {
        removeDisposableScriptImage(avatarUriRef.current);
      }
    };
  }, []);

  const close = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  const pickAvatar = useCallback(async () => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    const generation = ++pickerGenerationRef.current;
    Keyboard.dismiss();
    const outcome = await pickScriptRoleAvatar({
      inspectAccess: () => ImagePicker.getMediaLibraryPermissionsAsync(),
      launchPicker: () =>
        ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          allowsMultipleSelection: false,
          selectionLimit: 1,
          preferredAssetRepresentationMode:
            ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Automatic,
          quality: 1,
        }),
      prepare: (asset) =>
        prepareScriptImage(asset.uri, asset.width, asset.height, "script_role_avatar"),
    });
    const isCurrent = activeRef.current && generation === pickerGenerationRef.current;
    if (!isCurrent) {
      if (outcome.kind === "selected") removeDisposableScriptImage(outcome.uri);
      return;
    }
    if (outcome.kind === "selected") {
      const previousUri = avatarUriRef.current;
      avatarUriRef.current = outcome.uri;
      setDraft((current) => ({ ...current, avatarUri: outcome.uri }));
      if (
        previousUri &&
        previousUri !== initialAvatarUriRef.current &&
        previousUri !== outcome.uri
      ) {
        removeDisposableScriptImage(previousUri);
      }
    }
    if (generation === pickerGenerationRef.current) {
      pickingRef.current = false;
    }
  }, []);

  return (
    <Modal
      allowSwipeDismissal
      animationType="slide"
      onRequestClose={close}
      presentationStyle="pageSheet"
      visible
    >
      <View
        accessibilityViewIsModal
        style={[styles.roleModalScreen, { paddingBottom: insets.bottom }]}
      >
        <View style={styles.roleModalHeader}>
          <Pressable
            accessibilityLabel={text("取消", "Cancel")}
            accessibilityRole="button"
            hitSlop={10}
            onPress={close}
            style={styles.roleModalAction}
          >
            <Text style={styles.roleModalCancel}>{text("取消", "Cancel")}</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.roleModalTitle}>
            {text("编辑角色", "Edit Character")}
          </Text>
          <Pressable
            accessibilityLabel={text("保存", "Save")}
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => {
              Keyboard.dismiss();
              const message = scriptRoleValidationMessage(
                draft,
                selectedLanguage === "system" || selectedLanguage.startsWith("zh"),
              );
              if (message) {
                setValidationMessage(message);
                return;
              }
              transferredRef.current = true;
              onSave(draft);
            }}
            style={styles.roleModalAction}
            testID="script-role-editor-save"
          >
            <Text style={styles.roleModalSave}>{text("保存", "Save")}</Text>
          </Pressable>
        </View>
        <Pressable accessible={false} onPress={Keyboard.dismiss} style={styles.flex}>
          <ScrollView
            contentContainerStyle={styles.roleModalForm}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <FormSection secondaryHeader title={text("头像", "Avatar")} styles={styles}>
              <Pressable
                accessibilityHint={text(
                  "从相册选择角色头像",
                  "Choose the character avatar from Photos",
                )}
                accessibilityLabel={text("角色头像", "Character avatar")}
                accessibilityRole="button"
                onPress={() => void pickAvatar()}
                style={styles.roleAvatarPicker}
              >
                <RoleAvatar
                  role={draft}
                  size={scriptEditorMetrics.roleEditorAvatarSize}
                  styles={styles}
                  accentStroke
                />
              </Pressable>
            </FormSection>
            <FormSection secondaryHeader title={text("公开资料", "Public Profile")} styles={styles}>
              <View style={styles.roleNameInput}>
                <CountedInput
                  accessibilityLabel={text("角色名称", "Character name")}
                  maximum={scriptEditorMetrics.roleNameMaximumCharacters}
                  onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
                  placeholder={text("角色名称", "Character name")}
                  styles={styles}
                  value={draft.name}
                />
              </View>
              <View style={styles.divider} />
              <View style={styles.genderHost}>
                <Text style={styles.genderLabel}>{text("性别", "Gender")}</Text>
                <Host
                  colorScheme={scheme === "dark" ? "dark" : "light"}
                  ignoreSafeArea="all"
                  seedColor={colors.accent}
                  style={styles.genderPickerHost}
                >
                  <Picker
                    label={text("性别", "Gender")}
                    modifiers={[pickerStyle("menu")]}
                    onSelectionChange={(value) => {
                      if (typeof value === "string") {
                        setDraft((current) => ({ ...current, gender: value }));
                      }
                    }}
                    selection={draft.gender}
                  >
                    <SwiftUIText modifiers={[tag("unspecified")]}>
                      {text("请选择", "Select")}
                    </SwiftUIText>
                    <SwiftUIText modifiers={[tag("female")]}>{text("女", "Female")}</SwiftUIText>
                    <SwiftUIText modifiers={[tag("male")]}>{text("男", "Male")}</SwiftUIText>
                  </Picker>
                </Host>
              </View>
              <View style={styles.divider} />
              <View style={styles.roleDescriptionBlock}>
                <Text style={styles.fieldLabel}>{text("公开描述", "Public description")}</Text>
                <TextInput
                  accessibilityHint={`${scriptCharacterCount(draft.roleDescription)}/${scriptEditorMetrics.roleDescriptionMaximumCharacters}`}
                  accessibilityLabel={text("公开描述", "Public description")}
                  multiline
                  onChangeText={(value) =>
                    setDraft((current) => ({
                      ...current,
                      roleDescription: limitScriptCharacters(
                        value,
                        scriptEditorMetrics.roleDescriptionMaximumCharacters,
                      ),
                    }))
                  }
                  scrollEnabled
                  style={[
                    styles.textInput,
                    styles.multilineInput,
                    { minHeight: scriptEditorMetrics.roleDescriptionMinimumHeight },
                  ]}
                  textAlignVertical="top"
                  value={draft.roleDescription}
                />
                <Text accessible={false} style={styles.counter}>
                  {scriptCharacterCount(draft.roleDescription)}/
                  {scriptEditorMetrics.roleDescriptionMaximumCharacters}
                </Text>
              </View>
            </FormSection>
            <FormSection
              footer={text(
                "仅你和服务端生成过程可读取，不会展示给其他用户。",
                "Only you and server-side generation can read this.",
              )}
              secondaryHeader
              title={text("AI 隐藏设定", "Hidden AI Setting")}
              styles={styles}
            >
              <View style={styles.roleHiddenInput}>
                <CountedInput
                  accessibilityLabel={text("AI 隐藏设定", "Hidden AI Setting")}
                  maximum={scriptEditorMetrics.roleHiddenMaximumCharacters}
                  minimumHeight={scriptEditorMetrics.roleHiddenMinimumHeight}
                  multiline
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, hiddenSetting: value }))
                  }
                  styles={styles}
                  value={draft.hiddenSetting}
                />
              </View>
            </FormSection>
          </ScrollView>
        </Pressable>
        <TopToast
          duration={scriptEditorMetrics.roleToastMilliseconds}
          message={validationMessage}
          onDismiss={() => setValidationMessage(null)}
        />
      </View>
    </Modal>
  );
}

function cloneDraft(draft: ScriptDraft): ScriptDraft {
  return {
    ...draft,
    categoryIds: [...draft.categoryIds],
    roles: draft.roles.map((role) => ({ ...role })),
  };
}

function cleanupScriptDraftMedia(
  draft: ScriptDraft,
  protectedUris: ReadonlySet<string> = new Set(),
): void {
  for (const uri of new Set(scriptDraftMediaReferences(draft).values())) {
    if (!protectedUris.has(uri)) removeDisposableScriptImage(uri);
  }
}

function cleanupLostScriptDraftMedia(
  previous: ScriptDraft,
  next: ScriptDraft,
  protectedUris: ReadonlySet<string>,
): void {
  const previousReferences = scriptDraftMediaReferences(previous);
  const nextReferences = scriptDraftMediaReferences(next);
  const retainedUris = new Set(nextReferences.values());
  for (const [identity, uri] of previousReferences) {
    if (nextReferences.get(identity) === uri || retainedUris.has(uri) || protectedUris.has(uri)) {
      continue;
    }
    removeDisposableScriptImage(uri);
  }
}

function scriptDraftMediaReferences(draft: ScriptDraft): Map<string, string> {
  const references = new Map<string, string>();
  if (draft.coverUri) references.set("cover", draft.coverUri);
  for (const role of draft.roles) {
    if (role.avatarUri) references.set(`role:${role.id}`, role.avatarUri);
  }
  return references;
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

function makeStyles(scheme: ReturnType<typeof useColorScheme>) {
  const theme = palette(scheme);
  return StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: theme.background },
    headerButton: { minWidth: 36, height: 36, alignItems: "flex-start", justifyContent: "center" },
    headerSaveButton: { alignItems: "flex-end", minWidth: 52 },
    headerSave: { color: theme.text, fontSize: 17, fontWeight: "600" },
    disabled: { opacity: 0.38 },
    form: {
      paddingHorizontal: 20,
      paddingTop: 13,
      paddingBottom: scriptEditorMetrics.formBottomInset,
      gap: 31,
    },
    section: { gap: scriptEditorMetrics.sectionHeaderCardGap },
    mainSection: {},
    mainSectionWithFooter: { marginBottom: -13 },
    sectionHeader: {
      paddingLeft: scriptEditorMetrics.sectionHeaderInset,
      color: "#000000",
      fontSize: scriptEditorMetrics.sectionHeaderSize,
      fontWeight: "600",
    },
    mainSectionHeader: { paddingLeft: 20 },
    roleSectionHeader: { color: theme.secondaryText, fontWeight: "400" },
    sectionCard: {
      overflow: "hidden",
      borderRadius: scriptEditorMetrics.sectionRadius,
      backgroundColor: theme.card,
    },
    mainSectionCard: { borderRadius: 22 },
    sectionFooter: {
      paddingHorizontal: scriptEditorMetrics.sectionHeaderInset,
      color: theme.secondaryText,
      fontSize: 13,
      lineHeight: 18,
    },
    mainSectionFooter: { paddingHorizontal: 20 },
    visibilityRow: {
      minHeight: 68,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    primaryRowText: { color: theme.text, fontSize: 16 },
    visibilityDetail: {
      marginTop: scriptEditorMetrics.visibilityCopyGap,
      color: theme.secondaryText,
      fontSize: scriptEditorMetrics.visibilityDetailSize,
    },
    coverButton: { paddingHorizontal: 20, paddingVertical: 15 },
    coverImage: {
      width: "100%",
      height: scriptEditorMetrics.coverHeight,
      borderRadius: scriptEditorMetrics.coverRadius,
    },
    coverPlaceholder: {
      minHeight: scriptEditorMetrics.emptyCoverMinimumHeight,
      alignItems: "center",
      justifyContent: "center",
      gap: scriptEditorMetrics.coverPlaceholderGap,
      backgroundColor: scheme === "dark" ? theme.accentSoft : "#EDF0FC",
      borderRadius: scriptEditorMetrics.coverRadius,
    },
    coverPlaceholderText: {
      color: theme.accent,
      fontSize: scriptEditorMetrics.coverLabelSize,
      fontWeight: "500",
    },
    countedInput: {
      paddingHorizontal: scriptEditorMetrics.rowHorizontalInset,
      paddingVertical: scriptEditorMetrics.rowVerticalInset,
      gap: scriptEditorMetrics.textStackGap,
    },
    mainCountedInput: { paddingHorizontal: 20, paddingVertical: 14.5 },
    textInput: { minHeight: 23, padding: 0, color: theme.text, fontSize: 16, lineHeight: 21 },
    multilineInput: { paddingTop: 0 },
    counter: {
      alignSelf: "flex-end",
      color: theme.tertiaryText,
      fontSize: scriptEditorMetrics.counterSize,
    },
    categoryLoading: { height: 50 },
    choiceRow: {
      minHeight: 50,
      marginLeft: 20,
      paddingRight: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    dividedRow: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator },
    roleRow: {
      minHeight: 64,
      marginLeft: 16,
      paddingRight: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    roleMain: {
      flex: 1,
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      gap: scriptEditorMetrics.roleRowGap,
    },
    roleCopy: { flex: 1, gap: scriptEditorMetrics.roleCopyGap },
    roleName: { color: theme.text, fontSize: scriptEditorMetrics.roleNameSize, fontWeight: "600" },
    roleDescription: {
      color: theme.secondaryText,
      fontSize: scriptEditorMetrics.roleDescriptionSize,
    },
    roleAvatarImage: { overflow: "hidden" },
    roleAvatarStroke: {
      borderWidth: scriptEditorMetrics.roleEditorAvatarStroke,
      borderColor: theme.accent,
    },
    roleAvatarPlaceholder: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
    },
    trashButton: { width: 32, height: 44, alignItems: "flex-end", justifyContent: "center" },
    addRoleRow: {
      minHeight: 50,
      marginLeft: 16,
      paddingRight: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    addRoleText: { color: theme.accent, fontSize: 15, fontWeight: "600" },
    loadingOverlay: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.background,
    },
    editLoadFailure: { maxWidth: 300, alignItems: "center", gap: 11, padding: 24 },
    editLoadTitle: { color: theme.text, fontSize: 17, fontWeight: "600" },
    editLoadMessage: { color: theme.secondaryText, fontSize: 14, textAlign: "center" },
    retryButton: {
      minWidth: 96,
      minHeight: 40,
      marginTop: 3,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      backgroundColor: theme.accent,
    },
    retryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
    roleModalScreen: {
      flex: 1,
      backgroundColor: scheme === "dark" ? "#1C1C1E" : theme.background,
    },
    roleModalHeader: {
      height: 78,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: theme.background,
    },
    roleModalAction: {
      minWidth: 64,
      height: 44,
      paddingHorizontal: 12,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: scheme === "dark" ? "rgba(58,58,60,0.82)" : "rgba(255,255,255,0.78)",
      shadowColor: "#000000",
      shadowOpacity: scheme === "dark" ? 0.2 : 0.1,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
    },
    roleModalCancel: { color: theme.text, fontSize: 17 },
    roleModalTitle: {
      position: "absolute",
      left: 80,
      right: 80,
      textAlign: "center",
      color: theme.text,
      fontSize: 17,
      fontWeight: "600",
    },
    roleModalSave: { color: theme.text, fontSize: 17, fontWeight: "600" },
    roleModalForm: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40, gap: 22 },
    roleAvatarPicker: { minHeight: 122, alignItems: "center", justifyContent: "center" },
    roleNameInput: { paddingVertical: 3 },
    genderHost: {
      height: 52,
      paddingLeft: 16,
      flexDirection: "row",
      alignItems: "center",
    },
    genderLabel: { color: theme.text, fontSize: 16 },
    genderPickerHost: { flex: 1, height: 52 },
    divider: { height: StyleSheet.hairlineWidth, marginLeft: 16, backgroundColor: theme.separator },
    roleDescriptionBlock: { paddingHorizontal: 16, paddingVertical: 15, gap: 6 },
    roleHiddenInput: { paddingVertical: 4 },
    fieldLabel: { color: theme.secondaryText, fontSize: 13, fontWeight: "500" },
  });
}
