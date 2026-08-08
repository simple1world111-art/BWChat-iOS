import { Host, Picker, Text as SwiftUIText, Toggle } from "@expo/ui/swift-ui";
import { disabled, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";

import { getAgent } from "@/api/bwchat";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { env } from "@/config/env";
import type { AgentSummary } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { invalidateAgentCatalog } from "@/services/agents/AgentCatalogRepository";
import {
  clearPendingAgentForEditing,
  notifyAgentUpdated,
  pendingAgentForEditing,
} from "@/services/agents/AgentEditNavigationStore";
import {
  agentCreatorPolicy,
  agentCreatorErrorCode,
  agentCreatorErrorMessage,
  agentCreatorValues,
  canSaveAgent,
  defaultAgentCreatorValues,
  makeAgentReferencePreview,
  removeAgentCreatorTemporaryFile,
  validAgentReferenceDimensions,
  type AgentCreatorValues,
} from "@/services/agents/agentCreatorPolicy";
import {
  executeAgentCreatorTransaction,
  type AgentCreatorIdempotencyKeys,
  type AgentCreatorSelectedReference,
  type AgentCreatorTransactionCheckpoint,
} from "@/services/agents/AgentCreatorTransaction";
import { colors, palette } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

const languageOptions = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
] as const;
const visibilityOptions = [
  { value: "private", label: "私有" },
  { value: "unlisted", label: "不公开列出" },
  { value: "public", label: "公开" },
] as const;
const toneOptions = [
  { value: "warm", label: "温暖" },
  { value: "natural", label: "自然" },
  { value: "playful", label: "俏皮" },
  { value: "direct", label: "直接" },
] as const;
const replyLengthOptions = [
  { value: "short", label: "简短" },
  { value: "medium", label: "适中" },
  { value: "long", label: "详细" },
] as const;
const relationshipOptions = [
  { value: "companion", label: "陪伴者" },
  { value: "girlfriend", label: "女朋友" },
  { value: "wife", label: "妻子" },
  { value: "dating_partner", label: "约会对象" },
  { value: "romantic_partner", label: "浪漫伴侣" },
  { value: "boyfriend", label: "男朋友" },
  { value: "husband", label: "丈夫" },
] as const;
const intimacyOptions = [
  { value: "romantic", label: "浪漫" },
  { value: "playful", label: "俏皮" },
  { value: "sensual", label: "感性" },
  { value: "direct", label: "直接" },
] as const;
const initiativeOptions = [
  { value: "responsive", label: "回应式" },
  { value: "balanced", label: "平衡" },
  { value: "proactive", label: "主动" },
] as const;

export default function AgentCreatorScreen() {
  const { agentId = "" } = useLocalSearchParams<{ agentId?: string }>();
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  return (
    <AgentCreatorForm
      key={JSON.stringify([ownerId, agentId])}
      agentId={agentId}
      ownerId={ownerId}
    />
  );
}

function AgentCreatorForm({ agentId, ownerId }: { agentId: string; ownerId: string }) {
  const initialAgent = useMemo(
    () => (agentId ? pendingAgentForEditing(agentId, ownerId) : null),
    [agentId, ownerId],
  );
  const scheme = useColorScheme();
  const theme = palette(scheme);
  const styles = useMemo(() => makeStyles(scheme), [scheme]);
  const [currentAgent, setCurrentAgent] = useState<AgentSummary | null>(initialAgent);
  const [values, setValues] = useState<AgentCreatorValues>(() =>
    initialAgent ? agentCreatorValues(initialAgent) : { ...defaultAgentCreatorValues },
  );
  const valuesRef = useRef(values);
  const [selectedReference, setSelectedReference] = useState<AgentCreatorSelectedReference | null>(
    null,
  );
  const [isLoadingReference, setLoadingReference] = useState(false);
  const [isHydrating, setHydrating] = useState(Boolean(agentId && !initialAgent));
  const [isSaving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const referenceAssetId = useRef(initialAgent?.primary_reference_asset_id);
  const avatarAssetId = useRef(
    initialAgent?.avatar_asset_id ?? initialAgent?.profile?.avatar_asset_id,
  );
  const idempotencyKeysRef = useRef<AgentCreatorIdempotencyKeys>(makeIdempotencyKeys());
  const transactionCheckpointRef = useRef<AgentCreatorTransactionCheckpoint | null>(null);
  const saveLockRef = useRef(false);
  const referencePickerLockRef = useRef(false);
  const activeOwnerRef = useRef(ownerId);
  const routeGenerationRef = useRef(0);

  const isEditing = agentId ? currentAgent?.id === agentId : currentAgent !== null;
  const showsEditingPresentation = isEditing || Boolean(agentId);
  const hasResolvedMode = !agentId || isEditing;
  const canSave =
    Boolean(ownerId) &&
    hasResolvedMode &&
    canSaveAgent(
      values,
      showsEditingPresentation,
      selectedReference !== null,
      isSaving || isHydrating,
    );

  const populate = useCallback((agent: AgentSummary) => {
    const populatedValues = agentCreatorValues(agent);
    setCurrentAgent(agent);
    valuesRef.current = populatedValues;
    setValues(populatedValues);
    referenceAssetId.current = agent.primary_reference_asset_id;
    avatarAssetId.current = agent.avatar_asset_id ?? agent.profile?.avatar_asset_id;
  }, []);

  useEffect(() => {
    activeOwnerRef.current = ownerId;
    routeGenerationRef.current += 1;
    const generation = routeGenerationRef.current;
    const isActive = () =>
      routeGenerationRef.current === generation && activeOwnerRef.current === ownerId;

    saveLockRef.current = false;
    referencePickerLockRef.current = false;
    transactionCheckpointRef.current = null;
    idempotencyKeysRef.current = makeIdempotencyKeys();
    void Promise.resolve().then(() => {
      if (!isActive()) return;
      setSaving(false);
      setLoadingReference(false);
      setSelectedReference(null);
      setErrorMessage(null);

      if (!ownerId || !agentId) {
        setCurrentAgent(null);
        valuesRef.current = { ...defaultAgentCreatorValues };
        setValues(valuesRef.current);
        referenceAssetId.current = undefined;
        avatarAssetId.current = undefined;
        setHydrating(false);
        return;
      }

      if (initialAgent) {
        populate(initialAgent);
        setHydrating(false);
        return;
      }

      setCurrentAgent(null);
      valuesRef.current = { ...defaultAgentCreatorValues };
      setValues(valuesRef.current);
      referenceAssetId.current = undefined;
      avatarAssetId.current = undefined;
      setHydrating(true);
      void getAgent(agentId)
        .then((agent) => {
          if (!isActive()) return;
          if (agent.id !== agentId) throw new Error("智能体响应与编辑链接不一致");
          populate(agent);
        })
        .catch((error: unknown) => {
          if (isActive()) setErrorMessage(readableError(error));
        })
        .finally(() => {
          if (isActive()) setHydrating(false);
        });
    });
    return () => {
      if (isActive()) routeGenerationRef.current += 1;
    };
  }, [agentId, initialAgent, ownerId, populate]);

  useEffect(
    () => () => {
      Keyboard.dismiss();
      if (agentId) clearPendingAgentForEditing(agentId, ownerId);
    },
    [agentId, ownerId],
  );

  useEffect(() => {
    const temporaryReferenceUri = selectedReference?.uri;
    return () => {
      if (temporaryReferenceUri) removeAgentCreatorTemporaryFile(temporaryReferenceUri);
    };
  }, [selectedReference?.uri]);

  const setField = useCallback(
    <Key extends keyof AgentCreatorValues>(key: Key, value: AgentCreatorValues[Key]) => {
      if (transactionCheckpointRef.current?.draft) {
        idempotencyKeysRef.current = {
          ...idempotencyKeysRef.current,
          publish: randomUUID(),
        };
      }
      setValues((current) => {
        const next = { ...current, [key]: value };
        valuesRef.current = next;
        return next;
      });
    },
    [],
  );

  const pickReference = useCallback(async () => {
    if (referencePickerLockRef.current || isLoadingReference || isSaving) return;
    const requestedOwner = ownerId;
    const generation = routeGenerationRef.current;
    const isActive = () =>
      routeGenerationRef.current === generation && activeOwnerRef.current === requestedOwner;
    referencePickerLockRef.current = true;
    Keyboard.dismiss();
    setLoadingReference(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        selectionLimit: 1,
        quality: 1,
      });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!isActive() || !asset) return;
      if (!validAgentReferenceDimensions(asset.width, asset.height)) {
        setErrorMessage("参考图短边至少 512 像素，宽高比需在 1:2 到 2:1 之间");
        return;
      }
      const uri = await makeAgentReferencePreview(asset.uri);
      if (!isActive()) {
        removeAgentCreatorTemporaryFile(uri);
        return;
      }
      idempotencyKeysRef.current = {
        ...idempotencyKeysRef.current,
        upload: randomUUID(),
        ...(transactionCheckpointRef.current?.draft ? { publish: randomUUID() } : {}),
      };
      setSelectedReference({ uri, width: asset.width, height: asset.height });
      setErrorMessage(null);
    } catch {
      if (isActive()) setErrorMessage("无法读取所选图片");
    } finally {
      if (isActive()) {
        referencePickerLockRef.current = false;
        setLoadingReference(false);
      }
    }
  }, [isLoadingReference, isSaving, ownerId]);

  const save = useCallback(async () => {
    if (!canSave || saveLockRef.current || (agentId && !currentAgent)) return;
    const requestedOwner = ownerId;
    const requestedAgentId = agentId;
    const generation = routeGenerationRef.current;
    const isActive = () =>
      routeGenerationRef.current === generation &&
      activeOwnerRef.current === requestedOwner &&
      requestedOwner.length > 0;
    const assertActive = () => {
      if (!isActive()) throw new Error("编辑会话已变更");
    };
    saveLockRef.current = true;
    Keyboard.dismiss();
    setSaving(true);
    setErrorMessage(null);
    try {
      const { installed } = await executeAgentCreatorTransaction({
        ownerId: requestedOwner,
        currentAgent,
        selectedReference,
        referenceAssetId: referenceAssetId.current,
        avatarAssetId: avatarAssetId.current,
        idempotencyKeys: idempotencyKeysRef.current,
        checkpoint: transactionCheckpointRef.current,
        currentValues: () => valuesRef.current,
        assertActive,
        onAssetsUploaded: (nextReferenceAssetId, nextAvatarAssetId) => {
          assertActive();
          referenceAssetId.current = nextReferenceAssetId;
          avatarAssetId.current = nextAvatarAssetId;
        },
        onCheckpoint: (checkpoint) => {
          assertActive();
          transactionCheckpointRef.current = checkpoint;
        },
      });
      assertActive();
      setCurrentAgent(installed);
      await invalidateAgentCatalog(requestedOwner).catch(() => undefined);
      assertActive();
      notifyAgentUpdated(installed);
      if (requestedAgentId) clearPendingAgentForEditing(requestedAgentId, requestedOwner);
      router.back();
    } catch (error) {
      if (!isActive()) return;
      if (agentCreatorErrorCode(error) === 6002 && currentAgent) {
        transactionCheckpointRef.current = null;
        try {
          const latest = await getAgent(currentAgent.id);
          assertActive();
          if (latest.id !== currentAgent.id) throw new Error("智能体响应与编辑链接不一致");
          populate(latest);
        } catch {
          // The conflict message remains useful even when reloading fails.
        }
        if (!isActive()) return;
        setErrorMessage("草稿已在其他位置更新，已重新加载最新版本，请确认后再保存。");
      } else {
        setErrorMessage(readableError(error));
      }
    } finally {
      if (isActive()) {
        saveLockRef.current = false;
        setSaving(false);
      }
    }
  }, [agentId, canSave, currentAgent, ownerId, populate, selectedReference]);

  const currentAvatar = currentAgent?.avatar_asset_id ?? currentAgent?.profile?.avatar_asset_id;
  const currentAvatarUri = currentAvatar
    ? resolveMediaUrl(`/agent-assets/${encodeURIComponent(currentAvatar)}`, env.apiBaseUrl)
    : null;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: showsEditingPresentation ? "调整智能体" : "创建智能体",
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerRight: () => (
            <Pressable
              accessibilityLabel={showsEditingPresentation ? "保存" : "创建"}
              accessibilityRole="button"
              accessibilityState={{ busy: isSaving, disabled: !canSave }}
              disabled={!canSave}
              hitSlop={8}
              onPress={() => void save()}
              style={styles.headerAction}
            >
              {isSaving ? (
                <ActivityIndicator color={theme.accent} size="small" style={styles.headerSpinner} />
              ) : (
                <Text style={[styles.headerActionText, !canSave && styles.headerActionDisabled]}>
                  {showsEditingPresentation ? "保存" : "创建"}
                </Text>
              )}
            </Pressable>
          ),
        }}
      />

      <Pressable onPress={Keyboard.dismiss} style={styles.dismissArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <FormSection title="视觉形象" styles={styles}>
            <Pressable
              accessibilityHint="短边至少 512 像素，宽高比 1:2 到 2:1"
              accessibilityLabel={showsEditingPresentation ? "更换主参考图" : "上传主参考图"}
              accessibilityRole="button"
              accessibilityState={{
                busy: isLoadingReference,
                disabled: isLoadingReference || isSaving,
              }}
              disabled={isLoadingReference || isSaving}
              onPress={() => void pickReference()}
              style={({ pressed }) => [styles.referenceRow, pressed && styles.pressed]}
            >
              <View
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                style={styles.referencePreview}
              >
                {selectedReference ? (
                  <Image
                    contentFit="cover"
                    source={selectedReference.uri}
                    style={styles.referenceImage}
                  />
                ) : currentAvatarUri ? (
                  <AuthenticatedImage
                    contentFit="cover"
                    fallback={<ReferencePlaceholder styles={styles} />}
                    style={styles.referenceImage}
                    uri={currentAvatarUri}
                  />
                ) : (
                  <ReferencePlaceholder styles={styles} />
                )}
              </View>
              <View style={styles.referenceCopy}>
                <Text style={styles.referenceTitle}>
                  {showsEditingPresentation ? "更换主参考图" : "上传主参考图"}
                </Text>
                <Text style={styles.referenceDetail}>短边至少 512 像素，宽高比 1:2 到 2:1</Text>
              </View>
              {isLoadingReference ? <ActivityIndicator color={theme.secondaryText} /> : null}
            </Pressable>
          </FormSection>

          <InputSection
            multiline={false}
            onChangeText={(value) => setField("name", value)}
            placeholder="请输入智能体名称"
            styles={styles}
            title="智能体名称"
            value={values.name}
          />
          <InputSection
            multiline={false}
            onChangeText={(value) => setField("tagline", value)}
            placeholder="用一句话介绍这个智能体"
            styles={styles}
            title="一句话介绍"
            value={values.tagline}
          />
          <InputSection
            minHeight={92}
            multiline
            onChangeText={(value) => setField("descriptionText", value)}
            placeholder="补充角色背景、特点和用途"
            styles={styles}
            title="详细描述"
            value={values.descriptionText}
          />
          <InputSection
            multiline={false}
            onChangeText={(value) => setField("tagsText", value)}
            placeholder="多个标签请用逗号分隔"
            styles={styles}
            title="标签"
            value={values.tagsText}
          />

          <MenuSection
            label="对话语言"
            onChange={(value) => setField("language", value)}
            options={languageOptions}
            scheme={scheme}
            selection={values.language}
            styles={styles}
            title="语言"
          />
          <MenuSection
            label="谁可以看到"
            onChange={(value) => setField("visibility", value)}
            options={visibilityOptions}
            scheme={scheme}
            selection={values.visibility}
            styles={styles}
            title="可见性"
          />

          <InputSection
            minHeight={92}
            multiline
            onChangeText={(value) => setField("identity", value)}
            placeholder="身份设定"
            styles={styles}
            title="身份设定"
            value={values.identity}
          />
          <InputSection
            multiline={false}
            onChangeText={(value) => setField("personalityText", value)}
            placeholder="性格，用逗号分隔"
            styles={styles}
            title="性格"
            value={values.personalityText}
          />

          <MenuSection
            label="语气"
            onChange={(value) => setField("toneStyle", value)}
            options={toneOptions}
            scheme={scheme}
            selection={values.toneStyle}
            styles={styles}
            title="对话语气"
          />
          <MenuSection
            label="回复长度"
            onChange={(value) => setField("replyLength", value)}
            options={replyLengthOptions}
            scheme={scheme}
            selection={values.replyLength}
            styles={styles}
            title="回复长度"
          />

          <InputSection
            minHeight={72}
            multiline
            onChangeText={(value) => setField("greeting", value)}
            placeholder="开场白"
            styles={styles}
            title="开场白"
            value={values.greeting}
          />
          <MenuSection
            label="关系类型"
            onChange={(value) => setField("relationshipType", value)}
            options={relationshipOptions}
            scheme={scheme}
            selection={values.relationshipType}
            styles={styles}
            title="关系类型"
          />
          <InputSection
            multiline={false}
            onChangeText={(value) => setField("addressStyle", value)}
            placeholder="例如：你、主人、亲爱的"
            styles={styles}
            title="称呼方式"
            value={values.addressStyle}
          />

          <ToggleSection
            isOn={values.adultEnabled}
            label="允许成人互动"
            onChange={(value) => setField("adultEnabled", value)}
            scheme={scheme}
            styles={styles}
            title="成人互动"
          />
          <MenuSection
            label="亲密风格"
            onChange={(value) => setField("intimacyStyle", value)}
            options={intimacyOptions}
            scheme={scheme}
            selection={values.intimacyStyle}
            styles={styles}
            title="亲密风格"
          />
          <MenuSection
            label="主动程度"
            onChange={(value) => setField("initiative", value)}
            options={initiativeOptions}
            scheme={scheme}
            selection={values.initiative}
            styles={styles}
            title="主动程度"
          />
          <ToggleSection
            isOn={values.paidImages}
            label="付费图片"
            onChange={(value) => setField("paidImages", value)}
            scheme={scheme}
            styles={styles}
            title="图片能力"
          />

          <FormSection title="视频能力" styles={styles}>
            <Host
              colorScheme={scheme === "dark" ? "dark" : "light"}
              ignoreSafeArea="all"
              seedColor={colors.accent}
              style={styles.nativeRow}
            >
              <Toggle isOn={false} label="付费视频" modifiers={[disabled()]} />
            </Host>
            <View style={styles.cardDivider} />
            <Text style={styles.videoNotice}>
              视频 Provider 当前未启用，客户端不会开放视频生成。
            </Text>
          </FormSection>

          {errorMessage ? (
            <View
              accessibilityLiveRegion="assertive"
              accessibilityRole="alert"
              style={styles.errorCard}
            >
              <SymbolView
                name="exclamationmark.triangle.fill"
                size={15}
                tintColor={colors.danger}
              />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}
        </ScrollView>
      </Pressable>

      {isHydrating ? (
        <View
          accessible
          accessibilityLabel="正在加载智能体"
          accessibilityRole="progressbar"
          style={styles.hydratingOverlay}
        >
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : null}
    </View>
  );
}

type CreatorStyles = ReturnType<typeof makeStyles>;
type MenuOption = { value: string; label: string };

function FormSection({
  title,
  children,
  styles,
}: {
  title: string;
  children: React.ReactNode;
  styles: CreatorStyles;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function InputSection({
  title,
  placeholder,
  value,
  multiline,
  minHeight,
  onChangeText,
  styles,
}: {
  title: string;
  placeholder: string;
  value: string;
  multiline: boolean;
  minHeight?: number;
  onChangeText(value: string): void;
  styles: CreatorStyles;
}) {
  return (
    <FormSection title={title} styles={styles}>
      <TextInput
        accessibilityLabel={title}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiaryText}
        scrollEnabled={false}
        style={[
          styles.textInput,
          multiline && styles.multilineInput,
          minHeight ? { minHeight } : null,
        ]}
        textAlignVertical={multiline ? "top" : "center"}
        value={value}
      />
    </FormSection>
  );
}

function MenuSection({
  title,
  label,
  selection,
  options,
  scheme,
  onChange,
  styles,
}: {
  title: string;
  label: string;
  selection: string;
  options: readonly MenuOption[];
  scheme: ReturnType<typeof useColorScheme>;
  onChange(value: string): void;
  styles: CreatorStyles;
}) {
  return (
    <FormSection title={title} styles={styles}>
      <View style={styles.menuRow}>
        <Text pointerEvents="none" style={styles.menuLabel}>
          {label}
        </Text>
        <Host
          colorScheme={scheme === "dark" ? "dark" : "light"}
          ignoreSafeArea="all"
          seedColor={colors.secondaryText}
          style={styles.menuPicker}
        >
          <Picker
            label=""
            modifiers={[pickerStyle("menu")]}
            onSelectionChange={(value) => {
              if (typeof value === "string") onChange(value);
            }}
            selection={selection}
          >
            {options.map((option) => (
              <SwiftUIText key={option.value} modifiers={[tag(option.value)]}>
                {option.label}
              </SwiftUIText>
            ))}
          </Picker>
        </Host>
      </View>
    </FormSection>
  );
}

function ToggleSection({
  title,
  label,
  isOn,
  scheme,
  onChange,
  styles,
}: {
  title: string;
  label: string;
  isOn: boolean;
  scheme: ReturnType<typeof useColorScheme>;
  onChange(value: boolean): void;
  styles: CreatorStyles;
}) {
  return (
    <FormSection title={title} styles={styles}>
      <Host
        colorScheme={scheme === "dark" ? "dark" : "light"}
        ignoreSafeArea="all"
        seedColor={colors.accent}
        style={styles.nativeRow}
      >
        <Toggle isOn={isOn} label={label} onIsOnChange={onChange} />
      </Host>
    </FormSection>
  );
}

function ReferencePlaceholder({ styles }: { styles: CreatorStyles }) {
  return (
    <View style={styles.referencePlaceholder}>
      <SymbolView
        name="photo.badge.plus"
        size={agentCreatorPolicy.referenceSymbolSize}
        weight="semibold"
        tintColor={colors.accent}
      />
    </View>
  );
}

function readableError(error: unknown): string {
  return agentCreatorErrorMessage(error);
}

function makeIdempotencyKeys(): AgentCreatorIdempotencyKeys {
  return {
    upload: randomUUID(),
    create: randomUUID(),
    publish: randomUUID(),
    conversation: randomUUID(),
  };
}

function makeStyles(scheme: ReturnType<typeof useColorScheme>) {
  const theme = palette(scheme);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    dismissArea: { flex: 1 },
    content: { paddingHorizontal: 20, paddingTop: 13, paddingBottom: 40, gap: 31 },
    headerAction: { minWidth: 44, height: 36, alignItems: "flex-end", justifyContent: "center" },
    headerActionText: { color: theme.text, fontSize: 17, fontWeight: "600" },
    headerActionDisabled: { opacity: 0.38 },
    headerSpinner: { transform: [{ scale: 0.8 }] },
    section: { gap: 7 },
    sectionHeader: {
      paddingLeft: 20,
      color: "#000000",
      fontSize: agentCreatorPolicy.sectionHeaderSize,
      fontWeight: "600",
    },
    sectionCard: { overflow: "hidden", borderRadius: 22, backgroundColor: theme.card },
    referenceRow: {
      minHeight: 94,
      paddingHorizontal: 20,
      paddingVertical: 15,
      flexDirection: "row",
      alignItems: "center",
      gap: agentCreatorPolicy.referenceRowSpacing,
    },
    referencePreview: {
      width: agentCreatorPolicy.referenceSize,
      height: agentCreatorPolicy.referenceSize,
      overflow: "hidden",
      borderRadius: agentCreatorPolicy.referenceRadius,
      borderWidth: agentCreatorPolicy.referenceStrokeWidth,
      borderColor: "rgba(102,126,234,0.16)",
    },
    referenceImage: { width: "100%", height: "100%" },
    referencePlaceholder: {
      width: "100%",
      height: "100%",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accentSoft,
    },
    referenceCopy: { flex: 1, gap: agentCreatorPolicy.referenceCopySpacing },
    referenceTitle: {
      color: theme.text,
      fontSize: agentCreatorPolicy.referenceTitleSize,
      fontWeight: "600",
    },
    referenceDetail: {
      color: theme.secondaryText,
      fontSize: agentCreatorPolicy.referenceDetailSize,
    },
    textInput: {
      minHeight: 52,
      paddingHorizontal: 20,
      paddingVertical: 14.5,
      color: theme.text,
      fontSize: 17,
    },
    multilineInput: { lineHeight: 22 },
    nativeRow: { width: "100%", height: 52 },
    menuRow: {
      minHeight: 52,
      paddingLeft: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    menuLabel: { color: theme.text, fontSize: 17 },
    menuPicker: { width: 190, height: 52 },
    cardDivider: {
      height: StyleSheet.hairlineWidth,
      marginLeft: 16,
      backgroundColor: theme.separator,
    },
    videoNotice: {
      paddingHorizontal: 16,
      paddingVertical: 11,
      color: theme.secondaryText,
      fontSize: 12,
    },
    errorCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      borderRadius: 10,
      padding: 12,
      backgroundColor: theme.card,
    },
    errorText: {
      flex: 1,
      color: colors.danger,
      fontSize: agentCreatorPolicy.errorSize,
      lineHeight: 18,
    },
    pressed: { opacity: 0.72 },
    hydratingOverlay: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.background,
    },
  });
}
