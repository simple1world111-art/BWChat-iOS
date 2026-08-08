import {
  BottomSheet,
  BottomSheetFlatList,
  BottomSheetTextInput,
} from "@expo/ui/community/bottom-sheet";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  PlatformColor,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";

import { getShortDramaComments, sendShortDramaComment } from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { Avatar } from "@/components/Avatar";
import { TopToast } from "@/components/TopToast";
import type { ShortDramaComment, ShortDramaVideo, User } from "@/models";
import {
  loadCachedShortDramaComments,
  saveCachedShortDramaComments,
} from "@/services/short-drama/ShortDramaCommentsRepository";
import {
  appendNewShortDramaComments,
  formatShortDramaCommentTime,
  makeOptimisticShortDramaComment,
  removeOptimisticShortDramaComment,
  replaceOptimisticShortDramaComment,
  shortDramaCommentMetrics,
} from "@/services/short-drama/shortDramaInteractionPolicy";
import { readCachedUser } from "@/storage/authStorage";
import { colors, palette } from "@/theme";

export function ShortDramaCommentsSheet({
  currentUser,
  onClose,
  onCommentSent,
  ownerId,
  t,
  video,
}: {
  currentUser: User | null;
  onClose(): void;
  onCommentSent(comment: ShortDramaComment): void;
  ownerId: string;
  t(key: string, ...args: (string | number)[]): string;
  video: ShortDramaVideo;
}) {
  const scheme = useColorScheme();
  const theme = palette(scheme);
  const sheetBackgroundColor = scheme === "dark" ? "#2C2C2E" : colors.background;
  const styles = useMemo(() => makeStyles(scheme), [scheme]);
  const [comments, setComments] = useState<ShortDramaComment[]>([]);
  const [draftText, setDraftText] = useState("");
  const [isLoading, setLoading] = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [isSending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const stateRef = useRef({ comments, hasMore, nextCursor });
  const activeRef = useRef(true);
  const initialLoadingRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const sendingRef = useRef(false);

  useEffect(() => {
    stateRef.current = { comments, hasMore, nextCursor };
  }, [comments, hasMore, nextCursor]);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const persist = useCallback(
    async (nextComments: ShortDramaComment[], nextHasMore: boolean, cursor: string | undefined) => {
      if (!ownerId) return;
      await saveCachedShortDramaComments(ownerId, video.id, {
        comments: nextComments,
        has_more: nextHasMore,
        ...(cursor ? { next_cursor: cursor } : {}),
      });
    },
    [ownerId, video.id],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      initialLoadingRef.current = true;
      setLoading(true);
      try {
        const cached = ownerId ? await loadCachedShortDramaComments(ownerId, video.id) : null;
        if (!active) return;
        if (cached) {
          setComments(cached.value.comments);
          setHasMore(cached.value.has_more);
          setNextCursor(cached.value.next_cursor);
          stateRef.current = {
            comments: cached.value.comments,
            hasMore: cached.value.has_more,
            nextCursor: cached.value.next_cursor,
          };
        }
        if (cached && !cached.isStale) {
          void persist(cached.value.comments, cached.value.has_more, cached.value.next_cursor);
        } else {
          try {
            const page = await getShortDramaComments(video.id, {
              limit: shortDramaCommentMetrics.pageLimit,
            });
            if (!active) return;
            setComments(page.comments);
            setHasMore(page.has_more);
            setNextCursor(page.next_cursor);
            stateRef.current = {
              comments: page.comments,
              hasMore: page.has_more,
              nextCursor: page.next_cursor,
            };
            await persist(page.comments, page.has_more, page.next_cursor);
          } catch (error) {
            if (!cached?.isRetained) throw error;
            void persist(cached.value.comments, cached.value.has_more, cached.value.next_cursor);
          }
        }
      } catch (error) {
        if (active) setErrorMessage(readableError(error, t("common.operationFailed")));
      } finally {
        initialLoadingRef.current = false;
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [ownerId, persist, t, video.id]);

  const loadMore = useCallback(async () => {
    const state = stateRef.current;
    if (!state.hasMore || initialLoadingRef.current || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await getShortDramaComments(video.id, {
        cursor: state.nextCursor,
        limit: shortDramaCommentMetrics.pageLimit,
      });
      const next = appendNewShortDramaComments(stateRef.current.comments, page.comments);
      stateRef.current = { comments: next, hasMore: page.has_more, nextCursor: page.next_cursor };
      if (activeRef.current) {
        setComments(next);
        setHasMore(page.has_more);
        setNextCursor(page.next_cursor);
      }
      void persist(next, page.has_more, page.next_cursor);
    } catch {
      // The native sheet deliberately keeps pagination failures silent.
    } finally {
      loadingMoreRef.current = false;
      if (activeRef.current) setLoadingMore(false);
    }
  }, [persist, video.id]);

  const send = useCallback(async () => {
    const content = trimFoundationWhitespacesAndNewlines(draftText);
    if (!content || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setDraftText("");
    const temporaryId = `local-${randomUUID()}`;
    const temporary = makeOptimisticShortDramaComment({
      content,
      currentUser,
      defaultNickname: t("profile.defaultUser"),
      temporaryId,
      videoId: video.id,
    });
    const optimistic = [temporary, ...stateRef.current.comments];
    setComments(optimistic);
    stateRef.current = { ...stateRef.current, comments: optimistic };
    try {
      const sent = await sendShortDramaComment(video.id, content);
      const next = replaceOptimisticShortDramaComment(stateRef.current.comments, temporaryId, sent);
      stateRef.current = { ...stateRef.current, comments: next };
      if (activeRef.current) setComments(next);
      onCommentSent(sent);
      void persist(next, stateRef.current.hasMore, stateRef.current.nextCursor);
    } catch (error) {
      const next = removeOptimisticShortDramaComment(stateRef.current.comments, temporaryId);
      stateRef.current = { ...stateRef.current, comments: next };
      if (activeRef.current) {
        setComments(next);
        setDraftText(content);
        setErrorMessage(readableError(error, t("common.operationFailed")));
      }
    } finally {
      sendingRef.current = false;
      if (activeRef.current) setSending(false);
    }
  }, [currentUser, draftText, onCommentSent, persist, t, video.id]);

  const openProfile = useCallback(
    (userId: string) => {
      if (!trimFoundationWhitespacesAndNewlines(userId)) return;
      onClose();
      setTimeout(() => {
        void readCachedUser().then((activeUser) => {
          if (activeUser?.user_id !== ownerId) return;
          router.push({ pathname: "/user-profile", params: { id: userId } });
        });
      }, shortDramaCommentMetrics.profileNavigationDelayMilliseconds);
    },
    [onClose, ownerId],
  );

  const trimmedDraft = trimFoundationWhitespacesAndNewlines(draftText);

  return (
    <BottomSheet
      backgroundStyle={{ backgroundColor: sheetBackgroundColor }}
      enableDynamicSizing={false}
      enablePanDownToClose
      index={0}
      onClose={onClose}
    >
      <KeyboardAvoidingView
        accessibilityViewIsModal
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.screen}
      >
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.headerTitle}>
            {t("shortDrama.comments")}
          </Text>
          <Text style={styles.headerCount}>{Math.max(video.comment_count, comments.length)}</Text>
        </View>
        <View style={styles.divider} />

        <BottomSheetFlatList
          accessibilityLabel={t("shortDrama.comments")}
          contentContainerStyle={styles.listContent}
          data={comments}
          keyExtractor={(comment) => comment.id}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            isLoading ? (
              <ActivityIndicator
                accessibilityLabel={t("common.loading")}
                accessibilityRole="progressbar"
                color={theme.accent}
                style={styles.loading}
              />
            ) : (
              <View
                accessible
                accessibilityLabel={t("shortDrama.comments.empty")}
                style={styles.empty}
              >
                <SymbolView
                  name="text.bubble"
                  size={shortDramaCommentMetrics.emptyIconSize}
                  weight="semibold"
                  tintColor={theme.tertiaryText}
                />
                <Text style={styles.emptyText}>{t("shortDrama.comments.empty")}</Text>
              </View>
            )
          }
          ListFooterComponent={
            isLoadingMore ? (
              <ActivityIndicator
                accessibilityLabel={t("common.loading")}
                accessibilityRole="progressbar"
                color={theme.accent}
                style={styles.loadingMore}
              />
            ) : null
          }
          onEndReached={() => {
            if (comments.length > 0) void loadMore();
          }}
          onEndReachedThreshold={0.1}
          renderItem={({ item }) => (
            <ShortDramaCommentRow
              comment={item}
              onOpenProfile={() => openProfile(item.user_id)}
              styles={styles}
              yesterdayText={t("time.yesterday")}
            />
          )}
          style={styles.list}
        />

        <View style={styles.divider} />
        <View style={styles.composer}>
          <BottomSheetTextInput
            accessibilityLabel={t("shortDrama.comment.placeholder")}
            multiline
            onChangeText={setDraftText}
            placeholder={t("shortDrama.comment.placeholder")}
            placeholderTextColor={theme.tertiaryText}
            scrollEnabled
            style={styles.input}
            value={draftText}
          />
          <Pressable
            accessibilityLabel={t("common.send")}
            accessibilityRole="button"
            accessibilityState={{ disabled: !trimmedDraft || isSending, busy: isSending }}
            disabled={!trimmedDraft || isSending}
            onPress={() => void send()}
            style={[
              styles.sendButton,
              { backgroundColor: trimmedDraft ? theme.accent : theme.tertiaryText },
            ]}
          >
            {isSending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <SymbolView
                name="paperplane.fill"
                size={shortDramaCommentMetrics.sendSymbolSize}
                weight="bold"
                tintColor={colors.white}
              />
            )}
          </Pressable>
        </View>
        <TopToast
          duration={shortDramaCommentMetrics.toastMilliseconds}
          message={errorMessage}
          onDismiss={() => setErrorMessage(null)}
        />
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

type CommentStyles = ReturnType<typeof makeStyles>;

function ShortDramaCommentRow({
  comment,
  onOpenProfile,
  styles,
  yesterdayText,
}: {
  comment: ShortDramaComment;
  onOpenProfile(): void;
  styles: CommentStyles;
  yesterdayText: string;
}) {
  const time = formatShortDramaCommentTime(comment.created_at, new Date(), yesterdayText);
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel={comment.nickname}
        accessibilityRole="button"
        onPress={onOpenProfile}
      >
        <Avatar
          name={comment.nickname}
          size={shortDramaCommentMetrics.rowAvatarSize}
          uri={comment.avatar_url}
        />
      </Pressable>
      <View style={styles.rowCopy}>
        <View style={styles.rowHeader}>
          <Pressable
            accessibilityLabel={comment.nickname}
            accessibilityRole="button"
            onPress={onOpenProfile}
            style={styles.nicknameButton}
          >
            <Text numberOfLines={1} style={styles.nickname}>
              {comment.nickname}
            </Text>
          </Pressable>
          {time ? <Text style={styles.timestamp}>{time}</Text> : null}
        </View>
        <Text style={styles.commentContent}>{comment.content}</Text>
      </View>
    </View>
  );
}

function readableError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function makeStyles(scheme: ReturnType<typeof useColorScheme>) {
  const sheetBackground =
    Platform.OS === "ios"
      ? PlatformColor("secondarySystemBackgroundColor")
      : scheme === "dark"
        ? "#2C2C2E"
        : colors.background;
  const inputBackground =
    Platform.OS === "ios"
      ? PlatformColor("systemBackgroundColor")
      : scheme === "dark"
        ? "#1C1C1E"
        : colors.card;
  const separator = Platform.OS === "ios" ? PlatformColor("separatorColor") : colors.separator;
  return StyleSheet.create({
    screen: {
      flex: 1,
      marginTop:
        Platform.OS === "ios" ? -shortDramaCommentMetrics.nativeSheetHostTopCompensation : 0,
      backgroundColor: sheetBackground,
    },
    header: {
      paddingHorizontal: shortDramaCommentMetrics.headerHorizontalInset,
      paddingVertical: shortDramaCommentMetrics.headerVerticalInset,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headerTitle: {
      color: colors.text,
      fontSize: shortDramaCommentMetrics.headerTitleSize,
      fontWeight: "700",
    },
    headerCount: {
      color: colors.secondaryText,
      fontSize: shortDramaCommentMetrics.headerCountSize,
      fontWeight: "700",
    },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: separator },
    list: { flex: 1 },
    listContent: {
      flexGrow: 1,
      paddingHorizontal: shortDramaCommentMetrics.listHorizontalInset,
      paddingVertical: shortDramaCommentMetrics.listVerticalInset,
    },
    loading: { marginTop: shortDramaCommentMetrics.loadingTopInset },
    empty: {
      alignItems: "center",
      gap: shortDramaCommentMetrics.emptyGap,
      marginTop: shortDramaCommentMetrics.emptyTopInset,
    },
    emptyText: {
      color: colors.secondaryText,
      fontSize: shortDramaCommentMetrics.emptyTitleSize,
      fontWeight: "600",
    },
    loadingMore: { marginVertical: shortDramaCommentMetrics.loadMoreVerticalInset },
    composer: {
      paddingHorizontal: shortDramaCommentMetrics.composerHorizontalInset,
      paddingVertical: shortDramaCommentMetrics.composerVerticalInset,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: shortDramaCommentMetrics.composerGap,
      backgroundColor: sheetBackground,
    },
    input: {
      flex: 1,
      minHeight: 38,
      maxHeight:
        shortDramaCommentMetrics.composerMaximumLines *
          shortDramaCommentMetrics.composerInputLineHeight +
        shortDramaCommentMetrics.composerInputVerticalInset * 2,
      paddingHorizontal: shortDramaCommentMetrics.composerInputHorizontalInset,
      paddingVertical: shortDramaCommentMetrics.composerInputVerticalInset,
      borderRadius: shortDramaCommentMetrics.composerInputRadius,
      color: colors.text,
      backgroundColor: inputBackground,
      fontSize: shortDramaCommentMetrics.composerInputSize,
      lineHeight: shortDramaCommentMetrics.composerInputLineHeight,
    },
    sendButton: {
      width: shortDramaCommentMetrics.sendButtonWidth,
      height: shortDramaCommentMetrics.sendButtonHeight,
      borderRadius: shortDramaCommentMetrics.sendButtonHeight / 2,
      alignItems: "center",
      justifyContent: "center",
    },
    row: {
      paddingVertical: shortDramaCommentMetrics.rowVerticalInset,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: shortDramaCommentMetrics.rowGap,
    },
    rowCopy: { flex: 1, alignItems: "flex-start", gap: shortDramaCommentMetrics.rowCopyGap },
    rowHeader: {
      maxWidth: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: shortDramaCommentMetrics.rowHeaderGap,
    },
    nicknameButton: { flexShrink: 1 },
    nickname: {
      color: colors.text,
      fontSize: shortDramaCommentMetrics.rowNicknameSize,
      fontWeight: "700",
    },
    timestamp: {
      color: colors.tertiaryText,
      fontSize: shortDramaCommentMetrics.rowTimestampSize,
      fontWeight: "500",
    },
    commentContent: { color: colors.text, fontSize: shortDramaCommentMetrics.rowContentSize },
  });
}
