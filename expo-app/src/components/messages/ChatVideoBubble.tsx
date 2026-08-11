import { useEvent } from "expo";
import { Image, type ImageLoadEventData } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useVideoPlayer, type VideoThumbnail } from "expo-video";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import {
  chatMediaAvailabilityRetryPolicy,
  chatVideoThumbnailPath,
  chatVideoThumbnailSize,
  type MediaNaturalSize,
} from "@/components/messages/chatMediaLayout";
import {
  useChatMessageActivationGuard,
  useChatMessageLongPressBridge,
} from "@/components/messages/ChatReplyViews";
import { env } from "@/config/env";
import { useLocalization } from "@/providers/LocalizationProvider";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export function ChatVideoBubble({
  onOpen,
  thumbnailUrl,
  url,
}: {
  onOpen: (url: string) => void;
  thumbnailUrl?: string | undefined;
  url: string;
}) {
  const canActivate = useChatMessageActivationGuard();
  const longPressBridge = useChatMessageLongPressBridge();
  const { t } = useLocalization();
  const [naturalSize, setNaturalSize] = useState<MediaNaturalSize | undefined>();
  const displaySize = useMemo(() => chatVideoThumbnailSize(naturalSize), [naturalSize]);
  const local = isLocalVideoUrl(url);
  const explicitThumbnail = resolveMediaUrl(thumbnailUrl, env.apiBaseUrl);
  const resolvedThumbnail =
    explicitThumbnail ??
    (local ? null : resolveMediaUrl(chatVideoThumbnailPath(url), env.apiBaseUrl));

  return (
    <Pressable
      accessibilityLabel={t("message.video")}
      accessibilityRole="button"
      delayLongPress={longPressBridge.delayLongPress}
      onLongPress={longPressBridge.onLongPress}
      onPress={() => {
        if (canActivate()) onOpen(url);
      }}
      onPressOut={longPressBridge.onPressOut}
      style={[styles.frame, displaySize]}
    >
      {resolvedThumbnail ? (
        <AuthenticatedImage
          authenticatedRetryIntervalMilliseconds={
            chatMediaAvailabilityRetryPolicy.intervalMilliseconds
          }
          contentFit="cover"
          fallback={<VideoPlaceholder />}
          onLoad={(event: ImageLoadEventData) => setNaturalSize(event.source)}
          maximumAuthenticatedRetries={chatMediaAvailabilityRetryPolicy.maximumRetries}
          style={styles.thumbnail}
          transition={0}
          uri={resolvedThumbnail}
        />
      ) : local ? (
        <LocalVideoThumbnail onNaturalSize={setNaturalSize} uri={url} />
      ) : (
        <VideoPlaceholder />
      )}
      <PlayIndicator />
    </Pressable>
  );
}

function LocalVideoThumbnail({
  onNaturalSize,
  uri,
}: {
  onNaturalSize: (size: MediaNaturalSize) => void;
  uri: string;
}) {
  const player = useVideoPlayer({ uri });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null);

  useEffect(() => {
    if (status !== "readyToPlay" || thumbnail) return;
    let active = true;
    void player
      .generateThumbnailsAsync(0, { maxWidth: 600, maxHeight: 600 })
      .then(([generated]) => {
        if (!generated) return;
        if (!active) {
          generated.release();
          return;
        }
        setThumbnail(generated);
        onNaturalSize({ width: generated.width, height: generated.height });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [onNaturalSize, player, status, thumbnail]);

  useEffect(() => () => thumbnail?.release(), [thumbnail]);

  return thumbnail ? (
    <Image contentFit="cover" source={thumbnail} style={styles.thumbnail} transition={0} />
  ) : (
    <VideoPlaceholder />
  );
}

function VideoPlaceholder() {
  return (
    <View style={styles.placeholder}>
      <SymbolView name="video.fill" size={24} tintColor="rgba(255,255,255,0.7)" />
    </View>
  );
}

function PlayIndicator() {
  return (
    <View pointerEvents="none" style={styles.playCircle}>
      {/* prettier-ignore */}
      <SymbolView name="play.fill" size={17} weight="bold" tintColor={colors.white} style={styles.playIcon} />
    </View>
  );
}

function isLocalVideoUrl(url: string): boolean {
  return /^(file|content|ph):/u.test(url.trim());
}

const styles = StyleSheet.create({
  frame: {
    overflow: "hidden",
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: "rgba(0,0,0,0.08)",
    backgroundColor: "rgba(0,0,0,0.1)",
  },
  thumbnail: { width: "100%", height: "100%" },
  placeholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.1)",
  },
  playCircle: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 44,
    height: 44,
    marginLeft: -22,
    marginTop: -22,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  playIcon: { transform: [{ translateX: 1 }] },
});
