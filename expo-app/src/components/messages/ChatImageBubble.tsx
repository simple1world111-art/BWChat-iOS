import { SymbolView } from "expo-symbols";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  ImageGallerySource,
  type ImageGallerySelection,
  type GallerySize,
} from "@/components/media/ImageGallery";
import { chatImageThumbnailSize } from "@/components/messages/chatMediaLayout";
import { useChatMessageActivationGuard } from "@/components/messages/ChatReplyViews";
import { env } from "@/config/env";
import { useLocalization } from "@/providers/LocalizationProvider";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export function ChatImageBubble({
  imageUrls,
  index,
  loadMoreOlder,
  messageId,
  onOpen,
  thumbnailUrl,
  url,
}: {
  imageUrls: string[];
  index: number;
  loadMoreOlder?: (() => Promise<string[]>) | undefined;
  messageId: string;
  onOpen: (selection: ImageGallerySelection) => void;
  thumbnailUrl?: string | undefined;
  url: string;
}) {
  const canActivate = useChatMessageActivationGuard();
  const { t } = useLocalization();
  const [naturalSize, setNaturalSize] = useState<GallerySize | undefined>();
  const displaySize = useMemo(() => chatImageThumbnailSize(naturalSize), [naturalSize]);
  const displayUrl = resolveMediaUrl(thumbnailUrl || url, env.apiBaseUrl);
  const selection = useMemo<ImageGallerySelection>(
    () => ({
      media: { id: messageId, type: "image", url },
      images: imageUrls,
      index,
      loadMoreOlder,
    }),
    [imageUrls, index, loadMoreOlder, messageId, url],
  );
  const frame = { width: displaySize.width, height: displaySize.height };
  if (!displayUrl) return <ChatImagePlaceholder size={frame} />;
  return (
    <ImageGallerySource
      accessibilityLabel={t("message.image")}
      contentFit="cover"
      cornerRadius={10}
      fallback={<ChatImagePlaceholder size={frame} />}
      imageStyle={[styles.image, frame]}
      onNaturalSize={setNaturalSize}
      onOpen={(nextSelection) => {
        if (canActivate()) onOpen(nextSelection);
      }}
      selection={selection}
      sourceId={`chat-image-${messageId}-${url}`}
      style={[styles.frame, frame]}
      uri={displayUrl}
    />
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
    borderWidth: 0.5,
    borderColor: "rgba(0,0,0,0.08)",
    backgroundColor: colors.separator,
  },
  image: { borderRadius: 10, backgroundColor: colors.separator },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: colors.separator,
  },
});
