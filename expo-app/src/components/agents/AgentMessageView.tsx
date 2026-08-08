import { LinearGradient } from "expo-linear-gradient";
import { SymbolView } from "expo-symbols";
import { useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type View as NativeView,
} from "react-native";

import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import {
  ImageGallerySource,
  type GalleryFrame,
  type ImageGallerySelection,
} from "@/components/media/ImageGallery";
import {
  ChatMessageLongPressSurface,
  ChatQuotedMessageView,
} from "@/components/messages/ChatReplyViews";
import { env } from "@/config/env";
import type { AgentMessage, AgentMessagePart, AgentPartMetadata } from "@/models";
import {
  getActiveLanguageCode,
  localizedString,
  useLocalization,
} from "@/providers/LocalizationProvider";
import {
  agentImageReplySenderLabel,
  agentImageReplyTarget,
  agentUserVisibleText,
  resolveAgentHistoryImageReply,
  type AgentImageReplyTarget,
} from "@/services/agents/AgentImageReplyPolicy";
import {
  agentImageThumbnailSize,
  agentMessageLayout,
  orderedAgentMessageParts,
  presentAgentPaidMedia,
} from "@/services/agents/AgentMessagePresentationPolicy";
import type { ChatMessageAnchor } from "@/services/messages/chatReplyPolicy";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

type Translate = (key: string, ...args: (string | number)[]) => string;

interface AgentMessageViewProps {
  message: AgentMessage;
  allMessages: readonly AgentMessage[];
  avatarUrl: string | null;
  galleryImagePaths: string[];
  name: string;
  isUnlockingMedia: (mediaId: string) => boolean;
  onImageOpen: (selection: ImageGallerySelection) => void;
  onImagePress: (imagePath: string, sourceId: string, sourceFrame?: GalleryFrame) => void;
  onImageMenuRequested: (target: AgentImageReplyTarget, anchor: ChatMessageAnchor) => void;
  onImageMenuTouchSequenceStarted: () => void;
  onImageMenuTouchSequenceEnded: () => void;
  onSaveMedia: (mediaPath: string, isVideo: boolean) => void;
  onVideoPress: (url: string) => void;
  onUnlockMedia: (mediaId: string, mediaType: string | undefined) => void;
}

export function AgentMessageView({
  message,
  allMessages,
  avatarUrl,
  galleryImagePaths,
  name,
  isUnlockingMedia,
  onImageOpen,
  onImagePress,
  onImageMenuRequested,
  onImageMenuTouchSequenceStarted,
  onImageMenuTouchSequenceEnded,
  onSaveMedia,
  onVideoPress,
  onUnlockMedia,
}: AgentMessageViewProps) {
  const { t } = useLocalization();
  const isMine = message.sender.type === "user";
  const replyTarget = resolveAgentHistoryImageReply(message, allMessages);
  const replySourceId = replyTarget
    ? `agent-reply-${replyTarget.messageId}-${replyTarget.partId}`
    : "";
  const replySourceRef = useRef<NativeView>(null);
  const replySourceFrameRef = useRef<GalleryFrame | undefined>(undefined);
  const visibleParts = orderedAgentMessageParts(message).filter((part) =>
    isRenderableAgentPart(part, message, isMine, Boolean(replyTarget)),
  );

  return (
    <View style={styles.messageRow}>
      {isMine ? (
        <View style={styles.messageSpacer} />
      ) : (
        <AgentMessageAvatar name={name} uri={avatarUrl} />
      )}
      <View style={[styles.messageParts, isMine ? styles.mineParts : styles.otherParts]}>
        {replyTarget ? (
          <ChatMessageLongPressSurface
            onLongPress={(anchor) => onImageMenuRequested(replyTarget, anchor)}
            onLongPressStart={onImageMenuTouchSequenceStarted}
            onTouchSequenceEnded={onImageMenuTouchSequenceEnded}
          >
            <View
              collapsable={false}
              onTouchStart={() =>
                measureAgentImageSource(replySourceRef, (sourceFrame) => {
                  replySourceFrameRef.current = sourceFrame;
                })
              }
              ref={replySourceRef}
            >
              <ChatQuotedMessageView
                isFromMe={isMine}
                onPress={() => {
                  const sourceFrame = replySourceFrameRef.current;
                  if (sourceFrame) onImagePress(replyTarget.imagePath, replySourceId, sourceFrame);
                  else onImagePress(replyTarget.imagePath, replySourceId);
                }}
                value={{
                  senderName: agentImageReplySenderLabel(replyTarget),
                  content: replyTarget.imagePath,
                  msgType: "image",
                }}
              />
            </View>
          </ChatMessageLongPressSurface>
        ) : null}
        {visibleParts.map((part, index) => (
          <View
            key={part.id || `${message.id}:${part.ordinal}`}
            style={index ? styles.partAfter : undefined}
          >
            <AgentPart
              galleryImagePaths={galleryImagePaths}
              isMine={isMine}
              isUnlockingMedia={isUnlockingMedia}
              message={message}
              onImageMenuRequested={onImageMenuRequested}
              onImageMenuTouchSequenceEnded={onImageMenuTouchSequenceEnded}
              onImageMenuTouchSequenceStarted={onImageMenuTouchSequenceStarted}
              onImageOpen={onImageOpen}
              onImagePress={onImagePress}
              onSaveMedia={onSaveMedia}
              onUnlockMedia={onUnlockMedia}
              onVideoPress={onVideoPress}
              part={part}
              translate={t}
            />
          </View>
        ))}
      </View>
      {!isMine ? <View style={styles.messageSpacer} /> : null}
    </View>
  );
}

function isRenderableAgentPart(
  part: AgentMessagePart,
  message: AgentMessage,
  isMine: boolean,
  hidesReplySourceImage: boolean,
): boolean {
  if (hidesReplySourceImage && part.type === "input_image") return false;
  if (part.type === "text") {
    const text = (isMine ? agentUserVisibleText(part.text) : part.text).replace(/[\r\n]+$/gu, "");
    return Boolean(text.trim());
  }
  if (part.type === "input_image") return agentImageReplyTarget(part, message) !== null;
  return part.type === "paid_media";
}

function AgentPart({
  part,
  message,
  galleryImagePaths,
  isMine,
  translate,
  onImageOpen,
  onImagePress,
  onImageMenuRequested,
  onImageMenuTouchSequenceStarted,
  onImageMenuTouchSequenceEnded,
  onSaveMedia,
  onVideoPress,
  isUnlockingMedia,
  onUnlockMedia,
}: {
  part: AgentMessagePart;
  message: AgentMessage;
  galleryImagePaths: string[];
  isMine: boolean;
  translate: Translate;
  onImageOpen: (selection: ImageGallerySelection) => void;
  onImagePress: (imagePath: string, sourceId: string, sourceFrame?: GalleryFrame) => void;
  onImageMenuRequested: (target: AgentImageReplyTarget, anchor: ChatMessageAnchor) => void;
  onImageMenuTouchSequenceStarted: () => void;
  onImageMenuTouchSequenceEnded: () => void;
  onSaveMedia: (mediaPath: string, isVideo: boolean) => void;
  onVideoPress: (url: string) => void;
  isUnlockingMedia: (mediaId: string) => boolean;
  onUnlockMedia: (mediaId: string, mediaType: string | undefined) => void;
}) {
  if (part.type === "text") {
    const text = (isMine ? agentUserVisibleText(part.text) : part.text).replace(/[\r\n]+$/gu, "");
    if (!text.trim()) return null;
    if (isMine) {
      return (
        <LinearGradient
          colors={[colors.accent, colors.accentDark]}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={[styles.textBubble, styles.mineBubble]}
        >
          <Text selectable style={styles.mineText}>
            {text}
          </Text>
        </LinearGradient>
      );
    }
    return (
      <View style={[styles.textBubble, styles.otherBubble]}>
        <Text selectable style={styles.otherText}>
          {text}
        </Text>
      </View>
    );
  }

  if (part.type === "input_image") {
    const target = agentImageReplyTarget(part, message);
    return target ? (
      <MediaThumbnail
        galleryImagePaths={galleryImagePaths}
        metadata={part.metadata}
        onImageMenuRequested={onImageMenuRequested}
        onImageMenuTouchSequenceEnded={onImageMenuTouchSequenceEnded}
        onImageMenuTouchSequenceStarted={onImageMenuTouchSequenceStarted}
        onOpen={onImageOpen}
        target={target}
        translate={translate}
      />
    ) : null;
  }

  if (part.type === "paid_media") {
    const paidImageReplyTarget = agentImageReplyTarget(part, message);
    return (
      <PaidMediaPart
        galleryImagePaths={galleryImagePaths}
        imageReplyTarget={paidImageReplyTarget}
        isUnlocking={part.reference_id ? isUnlockingMedia(part.reference_id) : false}
        mediaId={part.reference_id}
        metadata={part.metadata}
        onImageMenuRequested={onImageMenuRequested}
        onImageMenuTouchSequenceEnded={onImageMenuTouchSequenceEnded}
        onImageMenuTouchSequenceStarted={onImageMenuTouchSequenceStarted}
        onImageOpen={onImageOpen}
        onImagePress={(imagePath, sourceFrame) =>
          onImagePress(
            paidImageReplyTarget?.imagePath ?? imagePath,
            `agent-paid-${message.id}-${part.id}`,
            sourceFrame,
          )
        }
        onSave={onSaveMedia}
        onUnlock={onUnlockMedia}
        onVideoPress={onVideoPress}
        translate={translate}
      />
    );
  }
  return null;
}

function MediaThumbnail({
  target,
  galleryImagePaths,
  metadata,
  translate,
  onOpen,
  onImageMenuRequested,
  onImageMenuTouchSequenceStarted,
  onImageMenuTouchSequenceEnded,
}: {
  target: AgentImageReplyTarget;
  galleryImagePaths: string[];
  metadata: AgentPartMetadata;
  translate: Translate;
  onOpen: (selection: ImageGallerySelection) => void;
  onImageMenuRequested: (target: AgentImageReplyTarget, anchor: ChatMessageAnchor) => void;
  onImageMenuTouchSequenceStarted: () => void;
  onImageMenuTouchSequenceEnded: () => void;
}) {
  const size = agentImageThumbnailSize(metadata.width, metadata.height);
  const sourceId = `agent-image-${target.messageId}-${target.partId}`;
  const displayUrl = resolveMediaUrl(target.imagePath, env.apiBaseUrl) ?? target.imagePath;
  const images = galleryImagePaths.includes(target.imagePath)
    ? galleryImagePaths
    : [target.imagePath];
  return (
    <ChatMessageLongPressSurface
      onLongPress={(anchor) => onImageMenuRequested(target, anchor)}
      onLongPressStart={onImageMenuTouchSequenceStarted}
      onTouchSequenceEnded={onImageMenuTouchSequenceEnded}
    >
      <ImageGallerySource
        accessibilityHint={translate("message.image")}
        accessibilityLabel={`${translate("media.preview.title")}: ${translate("message.image")}`}
        contentFit="cover"
        cornerRadius={10}
        imageStyle={[styles.mediaThumbnail, size]}
        onOpen={onOpen}
        selection={{
          media: { id: sourceId, type: "image", url: target.imagePath },
          images,
          index: Math.max(0, images.indexOf(target.imagePath)),
        }}
        sourceId={sourceId}
        style={[styles.mediaThumbnail, size]}
        uri={displayUrl}
      />
    </ChatMessageLongPressSurface>
  );
}

export function PaidMediaPart({
  galleryImagePaths = [],
  isUnlocking,
  imageReplyTarget,
  mediaId,
  metadata,
  translate = fallbackTranslate,
  onImageMenuRequested,
  onImageMenuTouchSequenceStarted,
  onImageMenuTouchSequenceEnded,
  onImageOpen,
  onImagePress,
  onSave,
  onVideoPress,
  onUnlock,
}: {
  galleryImagePaths?: string[] | undefined;
  isUnlocking: boolean;
  imageReplyTarget?: AgentImageReplyTarget | null | undefined;
  mediaId?: string | undefined;
  metadata: AgentPartMetadata;
  translate?: Translate | undefined;
  onImageMenuRequested?:
    ((target: AgentImageReplyTarget, anchor: ChatMessageAnchor) => void) | undefined;
  onImageMenuTouchSequenceStarted?: (() => void) | undefined;
  onImageMenuTouchSequenceEnded?: (() => void) | undefined;
  onImageOpen?: ((selection: ImageGallerySelection) => void) | undefined;
  onImagePress: (url: string, sourceFrame?: GalleryFrame) => void;
  onSave?: ((mediaPath: string, isVideo: boolean) => void) | undefined;
  onVideoPress: (url: string) => void;
  onUnlock: (mediaId: string, mediaType: string | undefined) => void;
}) {
  const mediaCardRef = useRef<NativeView>(null);
  const mediaSourceFrameRef = useRef<GalleryFrame | undefined>(undefined);
  const presentation = presentAgentPaidMedia(metadata);
  const { kind, status, isUnlocked, contentPath, previewPath, savePath, size } = presentation;
  const isVideo = kind === "video";
  const content = resolveMediaUrl(contentPath, env.apiBaseUrl);
  const preview = resolveMediaUrl(previewPath, env.apiBaseUrl);
  const rawImagePath = !isVideo ? (imageReplyTarget?.imagePath ?? contentPath) : undefined;
  const gallerySourceId = imageReplyTarget
    ? `agent-paid-${imageReplyTarget.messageId}-${imageReplyTarget.partId}`
    : `agent-paid-${mediaId ?? rawImagePath ?? "image"}`;
  const galleryImages =
    rawImagePath && galleryImagePaths.includes(rawImagePath)
      ? galleryImagePaths
      : rawImagePath
        ? [rawImagePath]
        : [];

  if (status === "failed" || status === "expired") {
    return (
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[styles.mediaState, size]}
      >
        <SymbolView
          name={status === "failed" ? "exclamationmark.triangle" : "clock.badge.exclamationmark"}
          size={26}
          tintColor={colors.secondaryText}
        />
        <Text style={styles.mediaStateText}>{translate("mediaUnlock.unavailable")}</Text>
      </View>
    );
  }

  if (status === "queued" || status === "generating") {
    return (
      <View
        accessibilityLabel={translate("common.loading")}
        accessibilityLiveRegion="polite"
        accessibilityRole="progressbar"
        style={[styles.mediaState, size]}
      >
        <ActivityIndicator color={colors.secondaryText} size="small" />
        <Text style={styles.mediaStateText}>{translate("common.loading")}</Text>
      </View>
    );
  }

  if (status !== "ready_locked") {
    return (
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[styles.mediaState, size]}
      >
        <SymbolView name={isVideo ? "video" : "photo"} size={26} tintColor={colors.secondaryText} />
        <Text style={styles.mediaStateText}>{translate("mediaUnlock.unavailable")}</Text>
      </View>
    );
  }

  const canUnlock = !isUnlocked && Boolean(mediaId);
  const canOpen = isUnlocked && Boolean(content);
  const unlockTitle = translate(`mediaUnlock.title.${kind}`);

  if (!isUnlocked) {
    return (
      <View style={[styles.mediaState, size]}>
        {preview ? (
          <AuthenticatedImage
            blurRadius={9}
            contentFit="cover"
            uri={preview}
            style={StyleSheet.absoluteFill}
            transition={0}
          />
        ) : (
          <View style={styles.lockedMediaFallback} />
        )}
        <View style={styles.lockedMediaScrim} />
        <View style={styles.lockedMediaContent}>
          <SymbolView name="lock.fill" size={24} weight="semibold" tintColor={colors.white} />
          <Pressable
            accessibilityLabel={isUnlocking ? translate("mediaUnlock.unlocking") : unlockTitle}
            accessibilityRole="button"
            accessibilityState={{ busy: isUnlocking, disabled: isUnlocking || !canUnlock }}
            disabled={isUnlocking || !canUnlock}
            onPress={() => {
              if (mediaId) onUnlock(mediaId, metadata.media_type);
            }}
            style={styles.unlockMediaButton}
          >
            {isUnlocking ? <ActivityIndicator color={colors.white} size="small" /> : null}
            <Text style={styles.unlockMediaButtonText}>
              {isUnlocking ? translate("mediaUnlock.unlocking") : unlockTitle}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!isVideo && !content) {
    return (
      <View
        accessibilityLabel={translate("common.loading")}
        accessibilityLiveRegion="polite"
        accessibilityRole="progressbar"
        style={[styles.mediaState, size]}
      >
        <ActivityIndicator color={colors.secondaryText} size="small" />
        <Text style={styles.mediaStateText}>{translate("common.loading")}</Text>
      </View>
    );
  }

  const openLabel = isVideo
    ? translate("mediaUnlock.playVideo")
    : `${translate("media.preview.title")}: ${translate("message.image")}`;
  const legacyMediaCard = (
    <Pressable
      accessibilityHint={!isVideo ? translate("message.image") : undefined}
      accessibilityLabel={openLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: !canOpen }}
      disabled={!canOpen}
      ref={mediaCardRef}
      onPressIn={() =>
        measureAgentImageSource(mediaCardRef, (sourceFrame) => {
          mediaSourceFrameRef.current = sourceFrame;
        })
      }
      onPress={() => {
        if (canOpen && content) {
          if (isVideo) onVideoPress(content);
          else {
            const sourceFrame = mediaSourceFrameRef.current;
            if (sourceFrame) onImagePress(content, sourceFrame);
            else onImagePress(content);
          }
        }
      }}
      style={[styles.mediaState, size]}
    >
      {preview ? (
        <AuthenticatedImage
          contentFit="cover"
          uri={preview}
          style={StyleSheet.absoluteFill}
          transition={0}
        />
      ) : isVideo ? (
        <View style={styles.videoPreviewFallback} />
      ) : null}
      {isVideo ? (
        <View style={styles.mediaOverlay}>
          <View style={styles.playCircle}>
            <View style={styles.playIconOffset}>
              <SymbolView name="play.fill" size={17} weight="bold" tintColor={colors.white} />
            </View>
          </View>
        </View>
      ) : null}
    </Pressable>
  );

  const mediaCard =
    !isVideo && rawImagePath && content && onImageOpen ? (
      <ImageGallerySource
        accessibilityHint={translate("message.image")}
        accessibilityLabel={openLabel}
        contentFit="cover"
        cornerRadius={10}
        imageStyle={StyleSheet.absoluteFill}
        onOpen={onImageOpen}
        selection={{
          media: { id: gallerySourceId, type: "image", url: rawImagePath },
          images: galleryImages,
          index: Math.max(0, galleryImages.indexOf(rawImagePath)),
        }}
        sourceId={gallerySourceId}
        style={[styles.mediaState, size]}
        uri={content}
      />
    ) : (
      legacyMediaCard
    );

  return (
    <View style={styles.paidMediaColumn}>
      {imageReplyTarget && onImageMenuRequested ? (
        <ChatMessageLongPressSurface
          onLongPress={(anchor) => onImageMenuRequested(imageReplyTarget, anchor)}
          onLongPressStart={onImageMenuTouchSequenceStarted}
          onTouchSequenceEnded={onImageMenuTouchSequenceEnded}
        >
          {mediaCard}
        </ChatMessageLongPressSurface>
      ) : (
        mediaCard
      )}
      {savePath ? (
        <Pressable
          accessibilityLabel={translate(`mediaUnlock.save.${kind}`)}
          accessibilityRole="button"
          onPress={() => onSave?.(savePath, isVideo)}
          style={styles.saveMediaButton}
        >
          <SymbolView
            name="square.and.arrow.down"
            size={13}
            weight="semibold"
            tintColor={colors.accent}
          />
          <Text style={styles.saveMediaText}>{translate(`mediaUnlock.save.${kind}`)}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AgentMessageAvatar({ name, uri }: { name: string; uri: string | null }) {
  const fallback = (
    <LinearGradient colors={[colors.accent, colors.accentDark]} style={styles.agentAvatarFallback}>
      <SymbolView name="sparkles" size={11} weight="semibold" tintColor={colors.white} />
    </LinearGradient>
  );
  return (
    <View accessibilityLabel={name} accessibilityRole="image">
      {uri ? (
        <AuthenticatedImage
          contentFit="cover"
          fallback={fallback}
          uri={uri}
          style={styles.agentAvatar}
          transition={0}
        />
      ) : (
        fallback
      )}
    </View>
  );
}

function measureAgentImageSource(
  sourceRef: { current: NativeView | null },
  open: (sourceFrame?: GalleryFrame) => void,
): void {
  const source = sourceRef.current;
  if (!source || typeof source.measureInWindow !== "function") {
    open();
    return;
  }
  source.measureInWindow((x, y, width, height) => {
    open(width > 1 && height > 1 ? { x, y, width, height } : undefined);
  });
}

function fallbackTranslate(key: string, ...args: (string | number)[]): string {
  return localizedString(getActiveLanguageCode(), key, ...args);
}

const styles = StyleSheet.create({
  messageRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 8,
  },
  messageSpacer: { minWidth: 48, flex: 1 },
  messageParts: { maxWidth: 290 },
  partAfter: { marginTop: agentMessageLayout.partSpacing },
  mineParts: { alignItems: "flex-end" },
  otherParts: { alignItems: "flex-start" },
  textBubble: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16 },
  mineBubble: { alignSelf: "flex-end" },
  otherBubble: {
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(240,240,245,0.7)",
  },
  mineText: { color: colors.white, fontSize: 15, lineHeight: 18 },
  otherText: { color: colors.text, fontSize: 15, lineHeight: 18 },
  mediaThumbnail: { borderRadius: 10, backgroundColor: colors.separator },
  mediaState: {
    overflow: "hidden",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
    backgroundColor: colors.separator,
    alignItems: "center",
    justifyContent: "center",
    rowGap: 9,
  },
  mediaStateText: { color: colors.secondaryText, fontSize: 13 },
  paidMediaColumn: { alignItems: "flex-start", rowGap: 8 },
  saveMediaButton: {
    minHeight: 16,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 4,
  },
  saveMediaText: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  mediaOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  lockedMediaScrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  lockedMediaFallback: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.12)",
  },
  videoPreviewFallback: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  lockedMediaContent: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    rowGap: 10,
  },
  unlockMediaButton: {
    minHeight: 32,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
    backgroundColor: colors.accent,
  },
  unlockMediaButtonText: { color: colors.white, fontSize: 13, fontWeight: "600" },
  playCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  playIconOffset: { transform: [{ translateX: 2 }] },
  agentAvatar: { width: 32, height: 32, borderRadius: 7.04 },
  agentAvatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 7.04,
    alignItems: "center",
    justifyContent: "center",
  },
});
