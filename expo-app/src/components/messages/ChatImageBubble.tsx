import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  ImageGallerySource,
  type ImageGallerySelection,
  type GallerySize,
} from "@/components/media/ImageGallery";
import {
  chatImageThumbnailSize,
  chatMediaAvailabilityRetryPolicy,
} from "@/components/messages/chatMediaLayout";
import { useChatMessageActivationGuard } from "@/components/messages/ChatReplyViews";
import { env } from "@/config/env";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  chatImageOriginalUrl,
  chatImageThumbnailUrl,
} from "@/services/media/ChatImageSourcePolicy";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export function ChatImageBubble({
  imageUrls,
  initialSize,
  index,
  loadMoreOlder,
  messageId,
  onOpen,
  thumbnailUrl,
  url,
}: {
  imageUrls: string[];
  initialSize?: GallerySize | undefined;
  index: number;
  loadMoreOlder?: (() => Promise<string[]>) | undefined;
  messageId: string;
  onOpen: (selection: ImageGallerySelection) => void;
  thumbnailUrl?: string | undefined;
  url: string;
}) {
  const canActivate = useChatMessageActivationGuard();
  const { t } = useLocalization();
  const [lockedDisplaySize] = useState(() =>
    hasUsableSize(initialSize) ? chatImageThumbnailSize(initialSize) : undefined,
  );
  const [naturalSize, setNaturalSize] = useState<GallerySize | undefined>(initialSize);
  const displaySize = useMemo(
    () => lockedDisplaySize ?? chatImageThumbnailSize(naturalSize),
    [lockedDisplaySize, naturalSize],
  );
  const thumbnailPresentationUrl = chatImageThumbnailUrl(url, thumbnailUrl);
  const originalUrl = chatImageOriginalUrl(url, thumbnailUrl);
  const displayUrl = resolveMediaUrl(thumbnailPresentationUrl, env.apiBaseUrl);
  const selection = useMemo<ImageGallerySelection>(
    () => ({
      media: { id: messageId, type: "image", url: originalUrl },
      images: imageUrls,
      index,
      loadMoreOlder,
    }),
    [imageUrls, index, loadMoreOlder, messageId, originalUrl],
  );
  const frame = { width: displaySize.width, height: displaySize.height };
  if (!displayUrl) return <ChatImagePlaceholder size={frame} />;
  return (
    <ImageGallerySource
      accessibilityLabel={t("message.image")}
      authenticatedRetryIntervalMilliseconds={chatMediaAvailabilityRetryPolicy.intervalMilliseconds}
      contentFit="cover"
      cornerRadius={10}
      fallback={<ChatImagePlaceholder size={frame} />}
      loadingFallback={<ChatImagePlaceholder size={frame} />}
      imageStyle={[styles.image, frame]}
      maximumAuthenticatedRetries={chatMediaAvailabilityRetryPolicy.maximumRetries}
      onNaturalSize={lockedDisplaySize ? undefined : setNaturalSize}
      onOpen={(nextSelection) => {
        if (canActivate()) onOpen(nextSelection);
      }}
      selection={selection}
      sourceId={`chat-image-${messageId}`}
      style={[styles.frame, frame]}
      uri={displayUrl}
    />
  );
}

function hasUsableSize(size: GallerySize | undefined): size is GallerySize {
  return Boolean(
    size &&
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0,
  );
}

function ChatImagePlaceholder({ size }: { size: { width: number; height: number } }) {
  return (
    <View style={[styles.placeholder, size]}>
      <SymbolView name="photo" size={22} tintColor={colors.secondaryText} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: "hidden",
    borderRadius: 10,
    backgroundColor: "transparent",
  },
  // The frame owns clipping. Rounding both layers leaves a light antialiasing
  // seam between the image and its parent on @3x iOS screens.
  image: { backgroundColor: "transparent" },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.separator,
  },
});
