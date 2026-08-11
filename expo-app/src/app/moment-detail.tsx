import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  addMomentComment,
  createIdempotencyKey,
  getMomentDetail,
  toggleMomentLike,
  unlockMoment,
} from "@/api/bwchat";
import {
  MediaViewer,
  MomentRow,
  type MediaSelection,
  type MomentCommentTarget,
} from "@/components/profile/PublicProfileContent";
import { TopToast } from "@/components/TopToast";
import type { Moment } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { usePropInventory } from "@/providers/PropInventoryProvider";
import { useWallet } from "@/providers/WalletProvider";
import { normalizePropConsumption } from "@/services/props/PropInventoryModels";
import { prepareMomentCommentImage } from "@/services/moments/MomentCommentImageService";
import {
  readCachedMomentDetail,
  saveCachedMomentDetail,
} from "@/services/moments/MomentDetailRepository";
import { publishMomentMutation } from "@/services/moments/MomentMutationStore";
import { colors } from "@/theme";

interface PreparedCommentImage {
  uri: string;
  filename: string;
}

export default function MomentDetailScreen() {
  const params = useLocalSearchParams<{ momentId?: string }>();
  const momentId = Number(params.momentId);
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  return (
    <MomentDetailAccountScreen
      key={`${ownerId || "signed-out"}|${Number.isFinite(momentId) ? momentId : "invalid"}`}
      momentId={momentId}
      ownerId={ownerId}
      viewerAvatarUrl={user?.avatar_url ?? ""}
      viewerNickname={user?.nickname ?? ""}
    />
  );
}

function MomentDetailAccountScreen({
  momentId,
  ownerId,
  viewerNickname,
  viewerAvatarUrl,
}: {
  momentId: number;
  ownerId: string;
  viewerNickname: string;
  viewerAvatarUrl: string;
}) {
  const { t } = useLocalization();
  const { applyMediaConsumption } = usePropInventory();
  const { applyBalance, refreshBalance } = useWallet();
  const activeRef = useRef(true);
  const [momentState, setMomentState] = useState<Moment | null>(null);
  const momentRef = useRef<Moment | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [commentTarget, setCommentTarget] = useState<MomentCommentTarget | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentImage, setCommentImage] = useState<PreparedCommentImage | null>(null);
  const [isPreparingImage, setPreparingImage] = useState(false);
  const [isSendingComment, setSendingComment] = useState(false);
  const [isUnlocking, setUnlocking] = useState(false);
  const [mediaSelection, setMediaSelection] = useState<MediaSelection | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const unlockKeysRef = useRef(new Map<string, string>());

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const setMoment = useCallback((next: Moment | null) => {
    momentRef.current = next;
    setMomentState(next);
  }, []);

  const persistMoment = useCallback(
    async (next: Moment) => {
      if (!activeRef.current) return;
      setMoment(next);
      publishMomentMutation(ownerId, { kind: "upsert", moment: next });
      if (ownerId) await saveCachedMomentDetail(ownerId, next);
    },
    [ownerId, setMoment],
  );

  const load = useCallback(async () => {
    if (!ownerId || !Number.isInteger(momentId) || momentId <= 0) {
      setLoading(false);
      return;
    }
    const cached = await readCachedMomentDetail(ownerId, momentId);
    if (!activeRef.current) return;
    if (cached) {
      setMoment(cached);
      setLoading(false);
    }
    try {
      const remote = await getMomentDetail(momentId);
      if (!activeRef.current) return;
      await persistMoment(remote);
    } catch {
      // Native detail treats an unavailable uncached item as missing.
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, [momentId, ownerId, persistMoment, setMoment]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const toggleLike = async () => {
    const current = momentRef.current;
    if (!current) return;
    try {
      const liked = await toggleMomentLike(current.id);
      if (!activeRef.current) return;
      const viewer = {
        user_id: ownerId,
        nickname: viewerNickname,
        avatar_url: viewerAvatarUrl,
      };
      const likes = current.likes.filter((author) => author.user_id !== ownerId);
      if (liked) likes.push(viewer);
      await persistMoment({ ...current, liked_by_me: liked, likes });
    } catch (error) {
      if (activeRef.current) setToastMessage(errorMessage(error));
    }
  };

  const beginComment = (target: MomentCommentTarget) => {
    setCommentTarget(target);
    setTimeout(() => {
      if (activeRef.current) inputRef.current?.focus();
    }, 150);
    setTimeout(() => {
      if (activeRef.current) inputRef.current?.focus();
    }, 400);
  };

  const chooseCommentImage = async () => {
    if (isPreparingImage) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!activeRef.current) return;
      if (!permission.granted) throw new Error("需要相册权限才能选择评论图片");
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (!activeRef.current) return;
      if (result.canceled || !result.assets[0]) return;
      setPreparingImage(true);
      const prepared = await prepareMomentCommentImage(result.assets[0]);
      if (activeRef.current) setCommentImage(prepared);
    } catch (error) {
      if (activeRef.current) setToastMessage(errorMessage(error));
    } finally {
      if (activeRef.current) setPreparingImage(false);
    }
  };

  const closeComposer = () => {
    setCommentTarget(null);
    setCommentText("");
    setCommentImage(null);
    inputRef.current?.blur();
  };

  const sendComment = async () => {
    const current = momentRef.current;
    const target = commentTarget;
    if (!current || !target || isSendingComment || (commentText.length === 0 && !commentImage)) {
      return;
    }
    const text = commentText;
    const image = commentImage;
    closeComposer();
    setSendingComment(true);
    try {
      const comment = await addMomentComment(current.id, text, {
        ...(target.replyToUserId ? { replyToUserId: target.replyToUserId } : {}),
        ...(image ? { image } : {}),
      });
      if (!activeRef.current) return;
      const latest = momentRef.current ?? current;
      await persistMoment({
        ...latest,
        comments: [...latest.comments, comment],
      });
    } catch (error) {
      if (activeRef.current) setToastMessage(errorMessage(error));
    } finally {
      if (activeRef.current) setSendingComment(false);
    }
  };

  const performUnlock = async () => {
    const current = momentRef.current;
    if (!current || isUnlocking || current.is_unlocked) return;
    const mediaType = current.media[0]?.type === "video" ? "video" : "image";
    const scope = `${current.id}|auto:${
      mediaType === "video" ? "media_unlock_card_video" : "media_unlock_card_image"
    }`;
    const idempotencyKey = unlockKeysRef.current.get(scope) ?? createIdempotencyKey();
    unlockKeysRef.current.set(scope, idempotencyKey);
    setUnlocking(true);
    try {
      const result = await unlockMoment(current.id, mediaType, idempotencyKey);
      if (!activeRef.current) return;
      unlockKeysRef.current.delete(scope);
      const updated = result.moment ?? (await getMomentDetail(current.id));
      if (!activeRef.current) return;
      await persistMoment(updated);
      if (!activeRef.current) return;
      if (result.charge) {
        await applyBalance(result.charge.wallet_balance);
      } else if (!result.already_unlocked && !result.consumed_prop) {
        await refreshBalance(true);
      }
      if (!result.already_unlocked && result.consumed_prop) {
        applyMediaConsumption(normalizePropConsumption(result.consumed_prop), mediaType);
      }
    } catch (error) {
      if (activeRef.current) setToastMessage(errorMessage(error));
    } finally {
      if (activeRef.current) setUnlocking(false);
    }
  };

  const canSendComment = !isSendingComment && (commentText.length > 0 || commentImage !== null);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
      style={styles.screen}
    >
      <Stack.Screen options={{ title: t("moments.detail.title") }} />
      {isLoading && !momentState ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : momentState ? (
        <ScrollView
          contentContainerStyle={commentTarget ? styles.contentWithComposer : undefined}
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <MomentRow
            moment={momentState}
            onComment={beginComment}
            onDelete={() => {}}
            onLike={() => void toggleLike()}
            onMedia={setMediaSelection}
            onUnlock={() => void performUnlock()}
            showsAllComments
            viewerId={ownerId}
          />
        </ScrollView>
      ) : (
        <View style={styles.missing}>
          <SymbolView name="exclamationmark.triangle" size={36} tintColor={colors.tertiaryText} />
          <Text style={styles.missingText}>{t("moments.detail.missing")}</Text>
        </View>
      )}

      {commentTarget ? (
        <View style={styles.composer}>
          {commentTarget.replyToName ? (
            <View style={styles.replyBar}>
              <SymbolView
                name="arrowshape.turn.up.left.fill"
                size={10}
                tintColor={colors.tertiaryText}
              />
              <Text style={styles.replyName}>{t("reply.to", commentTarget.replyToName)}</Text>
              {commentTarget.replyContent ? (
                <Text numberOfLines={1} style={styles.replyContent}>
                  : {commentTarget.replyContent}
                </Text>
              ) : null}
            </View>
          ) : null}

          {commentImage ? (
            <View style={styles.imagePreviewRow}>
              <View>
                <Image contentFit="cover" source={commentImage.uri} style={styles.imagePreview} />
                <Pressable onPress={() => setCommentImage(null)} style={styles.removeImage}>
                  <SymbolView name="xmark.circle.fill" size={16} tintColor={colors.white} />
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={styles.composerRow}>
            <Pressable
              accessibilityLabel="选择评论图片"
              disabled={isPreparingImage}
              onPress={() => void chooseCommentImage()}
              style={styles.photoButton}
            >
              {isPreparingImage ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <SymbolView name="photo" size={20} tintColor={colors.accent} />
              )}
            </Pressable>
            <TextInput
              autoFocus
              multiline
              onChangeText={setCommentText}
              placeholder={
                commentTarget.replyToName
                  ? t("reply.placeholder", commentTarget.replyToName)
                  : t("moments.comment.placeholder")
              }
              placeholderTextColor={colors.tertiaryText}
              ref={inputRef}
              style={styles.commentInput}
              value={commentText}
            />
            <Pressable
              disabled={!canSendComment}
              onPress={() => void sendComment()}
              style={[styles.sendButton, !canSendComment && styles.sendButtonDisabled]}
            >
              {isSendingComment ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.sendText}>{t("common.send")}</Text>
              )}
            </Pressable>
            <Pressable onPress={closeComposer} style={styles.closeButton}>
              <SymbolView name="xmark.circle.fill" size={22} tintColor={colors.tertiaryText} />
            </Pressable>
          </View>
        </View>
      ) : null}

      <MediaViewer onClose={() => setMediaSelection(null)} selection={mediaSelection} />
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </KeyboardAvoidingView>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "操作失败，请稍后重试";
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { marginTop: 54 },
  contentWithComposer: { paddingBottom: 128 },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", rowGap: 14 },
  missingText: { color: colors.secondaryText, fontSize: 15 },
  composer: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    backgroundColor: colors.card,
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
  },
  replyBar: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 2,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
  },
  replyName: { color: "#576B95", fontSize: 12, fontWeight: "500" },
  replyContent: { flex: 1, color: colors.secondaryText, fontSize: 12 },
  imagePreviewRow: { paddingHorizontal: 14, paddingTop: 6, alignItems: "flex-start" },
  imagePreview: { width: 60, height: 60, borderRadius: 6 },
  removeImage: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  composerRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
  },
  photoButton: { width: 22, height: 40, alignItems: "center", justifyContent: "center" },
  commentInput: {
    minHeight: 40,
    maxHeight: 104,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    color: colors.text,
    backgroundColor: colors.separator,
    fontSize: 16,
    lineHeight: 20,
  },
  sendButton: {
    minWidth: 56,
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  sendButtonDisabled: { backgroundColor: colors.tertiaryText },
  sendText: { color: colors.white, fontSize: 15, fontWeight: "600" },
  closeButton: { width: 22, height: 40, alignItems: "center", justifyContent: "center" },
});
