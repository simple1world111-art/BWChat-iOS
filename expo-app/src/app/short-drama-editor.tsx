import { BlurView } from "expo-blur";
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
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
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { deleteShortDramaEpisode, getShortDramaSeriesDetail } from "@/api/bwchat";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { TopToast } from "@/components/TopToast";
import { env } from "@/config/env";
import type { ShortDramaCreator, ShortDramaSeries } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  clearPendingShortDramaSeriesForEditing,
  pendingShortDramaSeriesForEditing,
} from "@/services/short-drama/ShortDramaEditorNavigationStore";
import {
  prepareShortDramaEpisodeAsset,
  removeShortDramaLocalFile,
  stageShortDramaCover,
} from "@/services/short-drama/ShortDramaMediaService";
import { publishShortDramaLibraryEvent } from "@/services/short-drama/ShortDramaLibraryStore";
import {
  enqueueShortDramaPublish,
  readShortDramaUploadJob,
} from "@/services/short-drama/ShortDramaUploadQueue";
import {
  appendPreparedShortDramaEpisodes,
  canPublishShortDramaDraft,
  clampShortDramaPrice,
  normalizeShortDramaPriceText,
  renumberShortDramaEpisodeDrafts,
  shortDramaAvailableImportCount,
  shortDramaDraftFromSeries,
  shortDramaEditorMetrics,
  updateShortDramaEpisodeDraft,
  type ShortDramaEditorDraft,
  type ShortDramaEpisodeDraft,
} from "@/services/short-drama/shortDramaEditorPolicy";
import { colors, palette } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export default function ShortDramaEditorScreen() {
  const params = useLocalSearchParams<{
    seriesId?: string | string[];
    resumeJobId?: string | string[];
  }>();
  const seriesId = firstParam(params.seriesId).trim();
  const resumeJobId = firstParam(params.resumeJobId).trim();
  const pendingSeries = useMemo(() => pendingShortDramaSeriesForEditing(seriesId), [seriesId]);
  const { user } = useAuth();
  const { t } = useLocalization();
  const ownerId = user?.user_id ?? "";
  const [draftId] = useState(randomUUID);
  const scheme = useColorScheme();
  const theme = palette(scheme);
  const styles = useMemo(() => makeStyles(scheme), [scheme]);
  const [draft, setDraft] = useState<ShortDramaEditorDraft>(() =>
    shortDramaDraftFromSeries(
      pendingSeries ?? undefined,
      draftId,
      randomUUID,
      t("shortDrama.video"),
    ),
  );
  const [editingEpisode, setEditingEpisode] = useState<ShortDramaEpisodeDraft | null>(null);
  const [focusedField, setFocusedField] = useState<"title" | "intro" | null>(null);
  const [isHydrating, setHydrating] = useState(
    Boolean(resumeJobId || (seriesId && !pendingSeries)),
  );
  const [isPickingCover, setPickingCover] = useState(false);
  const [isImportingEpisodes, setImportingEpisodes] = useState(false);
  const [isPublishing, setPublishing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const activeRef = useRef(true);
  const canPublish = canPublishShortDramaDraft(draft);
  const isEditing = Boolean(draft.source_series || seriesId || resumeJobId);

  useEffect(
    () => () => {
      activeRef.current = false;
      Keyboard.dismiss();
      if (seriesId) clearPendingShortDramaSeriesForEditing(seriesId);
    },
    [seriesId],
  );

  useEffect(() => {
    if (!resumeJobId && (!seriesId || pendingSeries)) return;
    let active = true;
    void (async () => {
      try {
        if (resumeJobId) {
          if (!ownerId) throw new Error(t("messages.sendFailed"));
          const job = await readShortDramaUploadJob(ownerId, resumeJobId);
          if (!job) throw new Error(t("common.operationFailed"));
          if (active) setDraft(job.draft);
          return;
        }
        const series = await getShortDramaSeriesDetail(seriesId);
        if (active) {
          setDraft(shortDramaDraftFromSeries(series, draftId, randomUUID, t("shortDrama.video")));
        }
      } catch (error) {
        if (active) setToastMessage(readableError(error, t("common.operationFailed")));
      } finally {
        if (active) setHydrating(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [draftId, ownerId, pendingSeries, resumeJobId, seriesId, t]);

  const pickCover = useCallback(async () => {
    if (isPickingCover || isPublishing) return;
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
      const uri = await stageShortDramaCover(ownerId || "anonymous", draft.draft_id, asset);
      if (activeRef.current) setDraft((current) => ({ ...current, cover_uri: uri }));
    } catch (error) {
      if (activeRef.current) setToastMessage(readableError(error, t("common.operationFailed")));
    } finally {
      if (activeRef.current) setPickingCover(false);
    }
  }, [draft.draft_id, isPickingCover, isPublishing, ownerId, t]);

  const importEpisodes = useCallback(async () => {
    if (isImportingEpisodes || isPublishing) return;
    Keyboard.dismiss();
    const available = shortDramaAvailableImportCount(draft.episodes);
    if (available <= 0) {
      setToastMessage(t("shortDrama.upload.limit", shortDramaEditorMetrics.maximumLocalEpisodes));
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsMultipleSelection: true,
        selectionLimit: shortDramaEditorMetrics.maximumLocalEpisodes,
        quality: 1,
      });
      if (result.canceled) return;
      setImportingEpisodes(true);
      const prepared = (
        await Promise.all(
          result.assets.slice(0, available).map(async (asset, selectionIndex) => {
            try {
              return await prepareShortDramaEpisodeAsset(
                ownerId || "anonymous",
                draft.draft_id,
                asset,
                selectionIndex,
              );
            } catch {
              return null;
            }
          }),
        )
      )
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((left, right) => left.selection_index - right.selection_index);
      if (activeRef.current && prepared.length > 0) {
        setDraft((current) => ({
          ...current,
          episodes: appendPreparedShortDramaEpisodes(current.episodes, prepared, (number) =>
            t("shortDrama.episode", number),
          ),
        }));
      }
    } catch (error) {
      if (activeRef.current) setToastMessage(readableError(error, t("common.operationFailed")));
    } finally {
      if (activeRef.current) setImportingEpisodes(false);
    }
  }, [draft.draft_id, draft.episodes, isImportingEpisodes, isPublishing, ownerId, t]);

  const deleteEpisode = useCallback(
    (episode: ShortDramaEpisodeDraft) => {
      setEditingEpisode(null);
      removeShortDramaLocalFile(episode.local_video_uri);
      setDraft((current) => ({
        ...current,
        episodes: renumberShortDramaEpisodeDrafts(
          current.episodes.filter((item) => item.id !== episode.id),
          (number) => t("shortDrama.episode", number),
        ),
      }));
      if (!episode.server_video) return;
      void deleteShortDramaEpisode(episode.server_video.id).catch((error: unknown) => {
        if (!activeRef.current) return;
        setToastMessage(readableError(error, t("common.operationFailed")));
        setDraft((current) => {
          if (current.episodes.some((item) => item.id === episode.id)) return current;
          const episodes = renumberShortDramaEpisodeDrafts(
            [...current.episodes, episode],
            (number) => t("shortDrama.episode", number),
          );
          notifySeriesSnapshot(ownerId, current.source_series, episodes);
          return { ...current, episodes };
        });
      });
    },
    [ownerId, t],
  );

  const publish = useCallback(async () => {
    if (!canPublish || isPublishing || !user) return;
    Keyboard.dismiss();
    setPublishing(true);
    try {
      await enqueueShortDramaPublish({
        ownerId: user.user_id,
        creator: creatorFromUser(user),
        draft,
      });
      router.back();
    } catch (error) {
      if (activeRef.current) {
        setPublishing(false);
        setToastMessage(readableError(error, t("messages.sendFailed")));
      }
    }
  }, [canPublish, draft, isPublishing, t, user]);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: t(isEditing ? "shortDrama.series.edit" : "shortDrama.series.create"),
          headerBackVisible: false,
          headerTitleAlign: "center",
          headerLeft: () => (
            <Pressable
              accessibilityLabel={t("common.back")}
              disabled={isPublishing}
              hitSlop={9}
              onPress={() => {
                Keyboard.dismiss();
                router.back();
              }}
              style={styles.backButton}
            >
              <SymbolView name="chevron.left" size={17} weight="semibold" tintColor={theme.text} />
            </Pressable>
          ),
        }}
      />

      <Pressable accessible={false} onPress={Keyboard.dismiss} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <SeriesEditorCard
            draft={draft}
            focusedField={focusedField}
            isPickingCover={isPickingCover}
            onChange={(update) => setDraft((current) => ({ ...current, ...update }))}
            onFocus={setFocusedField}
            onPickCover={() => void pickCover()}
            styles={styles}
            t={t}
          />
          <EpisodeGrid
            draft={draft}
            isImporting={isImportingEpisodes}
            onEdit={setEditingEpisode}
            onImport={() => void importEpisodes()}
            styles={styles}
            t={t}
          />
        </ScrollView>
      </Pressable>

      <PublishBar
        enabled={canPublish}
        isPublishing={isPublishing}
        onPress={() => void publish()}
        scheme={scheme}
        styles={styles}
        t={t}
      />
      {isHydrating ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : null}
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      {editingEpisode ? (
        <EpisodeEditorModal
          episode={editingEpisode}
          onClose={() => setEditingEpisode(null)}
          onDelete={deleteEpisode}
          onSave={(updated) => {
            setDraft((current) => ({
              ...current,
              episodes: updateShortDramaEpisodeDraft(current.episodes, updated),
            }));
            setEditingEpisode(null);
          }}
          styles={styles}
          t={t}
        />
      ) : null}
    </View>
  );
}

type EditorStyles = ReturnType<typeof makeStyles>;
type Translate = (key: string, ...args: (string | number)[]) => string;

function SeriesEditorCard({
  draft,
  focusedField,
  isPickingCover,
  onChange,
  onFocus,
  onPickCover,
  styles,
  t,
}: {
  draft: ShortDramaEditorDraft;
  focusedField: "title" | "intro" | null;
  isPickingCover: boolean;
  onChange(update: Partial<Pick<ShortDramaEditorDraft, "title" | "intro">>): void;
  onFocus(value: "title" | "intro" | null): void;
  onPickCover(): void;
  styles: EditorStyles;
  t: Translate;
}) {
  const hasCover = Boolean(draft.cover_uri || draft.source_series?.cover_url);
  return (
    <View style={styles.card}>
      <View style={styles.seriesCardContent}>
        <View style={styles.fieldGroup}>
          <Text style={styles.blackLabel}>{t("shortDrama.series.title")}</Text>
          <TextInput
            onBlur={() => onFocus(null)}
            onChangeText={(title) => onChange({ title })}
            onFocus={() => onFocus("title")}
            placeholder={t("shortDrama.series.title.placeholder")}
            placeholderTextColor={colors.tertiaryText}
            style={[styles.titleInput, focusedField === "title" && styles.focusedInput]}
            value={draft.title}
          />
        </View>
        <Text style={styles.blackLabel}>{t("shortDrama.series.poster")}</Text>
        <Pressable onPress={onPickCover} style={styles.poster}>
          <PosterImage draft={draft} styles={styles} />
          <View style={styles.coverBadge}>
            {isPickingCover ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <SymbolView name="photo" size={12} weight="bold" tintColor="#FFFFFF" />
            )}
            <Text style={styles.coverBadgeText}>
              {t(hasCover ? "shortDrama.cover.replace" : "shortDrama.cover.choose")}
            </Text>
          </View>
        </Pressable>
        <View style={styles.fieldGroup}>
          <Text style={styles.blackLabel}>{t("shortDrama.series.intro")}</Text>
          <TextInput
            multiline
            numberOfLines={3}
            onBlur={() => onFocus(null)}
            onChangeText={(intro) => onChange({ intro })}
            onFocus={() => onFocus("intro")}
            placeholder={t("shortDrama.series.intro.placeholder")}
            placeholderTextColor={colors.tertiaryText}
            scrollEnabled
            style={[styles.introInput, focusedField === "intro" && styles.focusedInput]}
            textAlignVertical="top"
            value={draft.intro}
          />
        </View>
      </View>
      <View pointerEvents="none" style={styles.cardBorder} />
    </View>
  );
}

function PosterImage({ draft, styles }: { draft: ShortDramaEditorDraft; styles: EditorStyles }) {
  if (draft.cover_uri) {
    return <Image contentFit="cover" source={draft.cover_uri} style={StyleSheet.absoluteFill} />;
  }
  const remote = resolveMediaUrl(draft.source_series?.cover_url, env.apiBaseUrl);
  if (remote) {
    return <AuthenticatedImage contentFit="cover" uri={remote} style={StyleSheet.absoluteFill} />;
  }
  return (
    <LinearGradient
      colors={["#000000", "#FFD43B"]}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={styles.posterFallback}
    >
      <SymbolView
        name="play.rectangle.fill"
        size={22}
        weight="semibold"
        tintColor="rgba(255,255,255,0.9)"
      />
    </LinearGradient>
  );
}

function EpisodeGrid({
  draft,
  isImporting,
  onEdit,
  onImport,
  styles,
  t,
}: {
  draft: ShortDramaEditorDraft;
  isImporting: boolean;
  onEdit(episode: ShortDramaEpisodeDraft): void;
  onImport(): void;
  styles: EditorStyles;
  t: Translate;
}) {
  const { width } = useWindowDimensions();
  const squareWidth = Math.max(
    1,
    (width -
      shortDramaEditorMetrics.contentInset * 2 -
      shortDramaEditorMetrics.cardInset * 2 -
      shortDramaEditorMetrics.episodeGap * 4) /
      shortDramaEditorMetrics.episodeColumns,
  );
  return (
    <View style={styles.card}>
      <Text style={styles.episodeListTitle}>{t("shortDrama.episode.list")}</Text>
      <View style={styles.episodeDivider} />
      <View style={styles.episodeGrid}>
        {draft.episodes.map((episode) => (
          <Pressable
            key={episode.id}
            onPress={() => onEdit(episode)}
            style={[styles.episodeSquare, { width: squareWidth }]}
          >
            {episode.preview_uri ? (
              <Image
                contentFit="cover"
                source={episode.preview_uri}
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <Text style={styles.episodeCenterNumber}>{episode.episode_number}</Text>
            )}
            <View style={styles.episodeOverlay}>
              <View style={styles.episodeTopRow}>
                {episode.unlock_price_gold_coins > 0 ? (
                  <View style={styles.episodePrice}>
                    <SymbolView name="pawprint.fill" size={9} weight="bold" tintColor="#FFFFFF" />
                    <Text style={styles.episodePriceText}>{episode.unlock_price_gold_coins}</Text>
                  </View>
                ) : (
                  <View />
                )}
                <UploadStateMark state={episode.upload_state} styles={styles} />
              </View>
              <Text style={styles.episodeNumberBadge}>{episode.episode_number}</Text>
            </View>
          </Pressable>
        ))}
        <Pressable
          accessibilityLabel={t("shortDrama.episode.upload")}
          disabled={isImporting}
          onPress={onImport}
          style={[styles.episodeSquare, styles.addEpisodeSquare, { width: squareWidth }]}
        >
          {isImporting ? (
            <ActivityIndicator color={styles.accent.color} size="small" />
          ) : (
            <SymbolView name="plus" size={17} weight="bold" tintColor={styles.accent.color} />
          )}
        </Pressable>
      </View>
      <View pointerEvents="none" style={styles.cardBorder} />
    </View>
  );
}

function UploadStateMark({
  state,
  styles,
}: {
  state: ShortDramaEpisodeDraft["upload_state"];
  styles: EditorStyles;
}) {
  if (state === "uploaded") {
    return (
      <SymbolView
        name="checkmark.circle.fill"
        size={12}
        weight="bold"
        tintColor={styles.success.color}
      />
    );
  }
  if (state === "failed") {
    return (
      <SymbolView
        name="exclamationmark.circle.fill"
        size={12}
        weight="bold"
        tintColor={styles.danger.color}
      />
    );
  }
  return <View />;
}

function EpisodeEditorModal({
  episode,
  onClose,
  onDelete,
  onSave,
  styles,
  t,
}: {
  episode: ShortDramaEpisodeDraft;
  onClose(): void;
  onDelete(episode: ShortDramaEpisodeDraft): void;
  onSave(episode: ShortDramaEpisodeDraft): void;
  styles: EditorStyles;
  t: Translate;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState({ ...episode });
  const [priceText, setPriceText] = useState(String(episode.unlock_price_gold_coins));
  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.modalScreen, { paddingBottom: insets.bottom }]}>
        <View style={styles.modalHeader}>
          <Pressable hitSlop={9} onPress={onClose} style={styles.modalAction}>
            <Text style={styles.modalCancel}>{t("common.cancel")}</Text>
          </Pressable>
          <Text numberOfLines={1} style={styles.modalTitle}>
            {episode.title}
          </Text>
          <Pressable
            hitSlop={9}
            onPress={() =>
              onSave({
                ...draft,
                title: draft.title.trim(),
                intro: draft.intro.trim(),
                unlock_price_gold_coins: clampShortDramaPrice(priceText),
              })
            }
            style={styles.modalAction}
          >
            <Text style={styles.modalSave}>{t("common.save")}</Text>
          </Pressable>
        </View>
        <Pressable accessible={false} onPress={Keyboard.dismiss} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.modalForm} keyboardShouldPersistTaps="handled">
            <View style={styles.formSection}>
              <View style={styles.priceRow}>
                <Text style={styles.formText}>{t("shortDrama.episode.goldCoinSetting")}</Text>
                <View style={styles.flex} />
                <TextInput
                  keyboardType="number-pad"
                  onChangeText={(value) => setPriceText(normalizeShortDramaPriceText(value))}
                  style={styles.priceInput}
                  textAlign="right"
                  value={priceText}
                />
                <Text style={styles.formSecondary}>{t("wallet.currency.goldCoins")}</Text>
              </View>
            </View>
            <Text style={styles.formFooter}>0–100</Text>
            <View style={styles.formSection}>
              <TextInput
                onChangeText={(title) => setDraft((current) => ({ ...current, title }))}
                placeholder={t("shortDrama.episode.title.placeholder")}
                placeholderTextColor={colors.tertiaryText}
                style={styles.formInput}
                value={draft.title}
              />
              <View style={styles.formDivider} />
              <TextInput
                multiline
                numberOfLines={3}
                onChangeText={(intro) => setDraft((current) => ({ ...current, intro }))}
                placeholder={t("shortDrama.episode.intro.placeholder")}
                placeholderTextColor={colors.tertiaryText}
                style={[styles.formInput, styles.episodeIntroInput]}
                textAlignVertical="top"
                value={draft.intro}
              />
            </View>
            <View style={styles.formSection}>
              <Pressable onPress={() => onDelete(draft)} style={styles.deleteRow}>
                <Text style={styles.deleteText}>{t("shortDrama.episode.delete")}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </View>
    </Modal>
  );
}

function PublishBar({
  enabled,
  isPublishing,
  onPress,
  scheme,
  styles,
  t,
}: {
  enabled: boolean;
  isPublishing: boolean;
  onPress(): void;
  scheme: ReturnType<typeof useColorScheme>;
  styles: EditorStyles;
  t: Translate;
}) {
  const insets = useSafeAreaInsets();
  return (
    <BlurView
      intensity={28}
      tint={scheme === "dark" ? "dark" : "light"}
      style={[styles.publishBar, { paddingBottom: Math.max(8, insets.bottom) }]}
    >
      <Pressable
        disabled={!enabled || isPublishing}
        onPress={onPress}
        style={[styles.publishButton, !enabled && styles.publishButtonDisabled]}
      >
        {isPublishing ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.publishText}>{t("common.publish")}</Text>
        )}
      </Pressable>
      <Text style={styles.publishHint}>{t("shortDrama.publish.reviewHint")}</Text>
    </BlurView>
  );
}

function creatorFromUser(user: NonNullable<ReturnType<typeof useAuth>["user"]>): ShortDramaCreator {
  return {
    user_id: user.user_id,
    username: user.username,
    nickname: user.nickname,
    avatar_url: user.avatar_url,
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
  };
}

function notifySeriesSnapshot(
  ownerId: string,
  series: ShortDramaSeries | undefined,
  episodes: ShortDramaEpisodeDraft[],
): void {
  if (!ownerId.trim() || !series) return;
  publishShortDramaLibraryEvent({
    kind: "upsert",
    owner_id: ownerId,
    series: {
      ...series,
      episode_count: episodes.filter((episode) => episode.server_video).length,
      episodes: episodes.flatMap((episode) => (episode.server_video ? [episode.server_video] : [])),
    },
  });
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function makeStyles(scheme: ReturnType<typeof useColorScheme>) {
  const theme = palette(scheme);
  return StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1, backgroundColor: theme.background },
    accent: { color: theme.accent },
    success: { color: theme.success },
    danger: { color: theme.danger },
    backButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
    content: {
      gap: shortDramaEditorMetrics.contentGap,
      padding: shortDramaEditorMetrics.contentInset,
      paddingBottom: shortDramaEditorMetrics.contentBottomInset,
    },
    card: {
      position: "relative",
      padding: shortDramaEditorMetrics.cardInset,
      borderRadius: shortDramaEditorMetrics.cardRadius,
      backgroundColor: theme.card,
    },
    cardBorder: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      borderWidth: shortDramaEditorMetrics.cardBorderWidth,
      borderRadius: shortDramaEditorMetrics.cardRadius,
      borderColor: `${theme.separator}B3`,
    },
    seriesCardContent: { gap: shortDramaEditorMetrics.seriesGap },
    fieldGroup: { gap: shortDramaEditorMetrics.fieldGap },
    blackLabel: { color: "#000000", fontSize: 12, lineHeight: 16, fontWeight: "700" },
    titleInput: {
      minHeight: shortDramaEditorMetrics.titleMinimumHeight,
      paddingHorizontal: shortDramaEditorMetrics.titleHorizontalInset,
      borderWidth: shortDramaEditorMetrics.idleBorderWidth,
      borderColor: `${theme.separator}8C`,
      borderRadius: shortDramaEditorMetrics.inputRadius,
      color: theme.text,
      backgroundColor: theme.background,
      fontSize: 17,
      fontWeight: "700",
    },
    introInput: {
      minHeight: shortDramaEditorMetrics.introMinimumHeight,
      maxHeight: 112,
      padding: shortDramaEditorMetrics.introInset,
      borderWidth: shortDramaEditorMetrics.idleBorderWidth,
      borderColor: `${theme.separator}8C`,
      borderRadius: shortDramaEditorMetrics.inputRadius,
      color: theme.text,
      backgroundColor: theme.background,
      fontSize: 15,
      lineHeight: 20,
    },
    focusedInput: {
      borderWidth: shortDramaEditorMetrics.focusedBorderWidth,
      borderColor: theme.accent,
    },
    poster: {
      height: shortDramaEditorMetrics.posterHeight,
      overflow: "hidden",
      borderRadius: shortDramaEditorMetrics.posterRadius,
      backgroundColor: "#000000",
    },
    posterFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
    coverBadge: {
      position: "absolute",
      right: shortDramaEditorMetrics.posterBadgeOuterInset,
      bottom: shortDramaEditorMetrics.posterBadgeOuterInset,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      minHeight: 28,
      paddingHorizontal: shortDramaEditorMetrics.posterBadgeHorizontalInset,
      paddingVertical: shortDramaEditorMetrics.posterBadgeVerticalInset,
      borderRadius: 999,
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    coverBadgeText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
    episodeListTitle: {
      color: theme.text,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "700",
      marginBottom: 12,
    },
    episodeDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: `${theme.separator}80`,
      marginBottom: 12,
    },
    episodeGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: shortDramaEditorMetrics.episodeGap,
    },
    episodeSquare: {
      height: shortDramaEditorMetrics.episodeHeight,
      overflow: "hidden",
      borderRadius: shortDramaEditorMetrics.episodeRadius,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.background,
    },
    addEpisodeSquare: { backgroundColor: theme.background },
    episodeCenterNumber: { color: theme.text, fontSize: 15, fontWeight: "700" },
    episodeOverlay: {
      position: "absolute",
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
      justifyContent: "space-between",
      alignItems: "flex-end",
    },
    episodeTopRow: {
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    episodePrice: {
      flexDirection: "row",
      alignItems: "center",
      gap: shortDramaEditorMetrics.episodePriceGap,
    },
    episodePriceText: {
      color: "#FFFFFF",
      fontSize: shortDramaEditorMetrics.episodePriceSize,
      fontWeight: "700",
    },
    episodeNumberBadge: {
      overflow: "hidden",
      paddingHorizontal: shortDramaEditorMetrics.episodeNumberHorizontalInset,
      paddingVertical: shortDramaEditorMetrics.episodeNumberVerticalInset,
      borderRadius: 999,
      color: "#FFFFFF",
      backgroundColor: "rgba(0,0,0,0.55)",
      fontSize: 11,
      fontWeight: "700",
    },
    publishBar: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      gap: 6,
      paddingHorizontal: 16,
      paddingTop: 10,
      overflow: "hidden",
    },
    publishButton: {
      minHeight: 48,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.accent,
    },
    publishButtonDisabled: { backgroundColor: theme.tertiaryText },
    publishText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
    publishHint: { color: theme.secondaryText, fontSize: 12, textAlign: "center" },
    loadingOverlay: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: `${theme.background}D9`,
    },
    modalScreen: { flex: 1, backgroundColor: theme.background },
    modalHeader: {
      height: 52,
      paddingHorizontal: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.separator,
      flexDirection: "row",
      alignItems: "center",
    },
    modalAction: { width: 72, height: 44, justifyContent: "center" },
    modalCancel: { color: theme.accent, fontSize: 17 },
    modalSave: { color: theme.accent, fontSize: 17, fontWeight: "600", textAlign: "right" },
    modalTitle: {
      flex: 1,
      color: theme.text,
      fontSize: 17,
      fontWeight: "600",
      textAlign: "center",
    },
    modalForm: { paddingTop: 28, paddingBottom: 40, gap: 22 },
    formSection: {
      overflow: "hidden",
      marginHorizontal: 16,
      borderRadius: 10,
      backgroundColor: theme.card,
    },
    priceRow: {
      minHeight: 48,
      paddingHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    priceInput: { width: 70, color: theme.text, fontSize: 17, paddingVertical: 8 },
    formText: { color: theme.text, fontSize: 17 },
    formSecondary: { color: theme.secondaryText, fontSize: 17 },
    formFooter: { marginHorizontal: 32, marginTop: -18, color: theme.secondaryText, fontSize: 13 },
    formInput: { minHeight: 48, paddingHorizontal: 16, color: theme.text, fontSize: 17 },
    episodeIntroInput: { minHeight: 88, paddingTop: 12, paddingBottom: 12, lineHeight: 22 },
    formDivider: {
      height: StyleSheet.hairlineWidth,
      marginLeft: 16,
      backgroundColor: theme.separator,
    },
    deleteRow: { minHeight: 48, paddingHorizontal: 16, justifyContent: "center" },
    deleteText: { color: theme.danger, fontSize: 17 },
  });
}
