import { StyleSheet, useColorScheme, View, type StyleProp, type ViewStyle } from "react-native";

import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import {
  backgroundImageCacheKey,
  resolvedBackgroundImageUri,
  type ChatBackground,
} from "@/services/chat-appearance/ChatAppearanceService";
import { colors } from "@/theme";

export const chatBackgroundAppearance = {
  saturation: 0.62,
  contrast: 0.82,
  brightness: 1.03,
  whiteOverlayOpacity: 0.46,
} as const;

export function ChatBackgroundLayer({
  background,
  style,
}: {
  background: ChatBackground | null;
  style?: StyleProp<ViewStyle> | undefined;
}) {
  const backgroundColor = useColorScheme() === "dark" ? "#1C1C1E" : colors.background;
  return (
    <View pointerEvents="none" style={[styles.layer, { backgroundColor }, style]}>
      {background ? (
        <>
          <View style={styles.filteredImage}>
            <AuthenticatedImage
              uri={resolvedBackgroundImageUri(background)}
              sourceCacheKey={backgroundImageCacheKey(background)}
              contentFit="cover"
              transition={0}
              fallback={<View style={[styles.imageFallback, { backgroundColor }]} />}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <View style={styles.whiteOverlay} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    overflow: "hidden",
  },
  filteredImage: {
    position: "absolute",
    inset: 0,
    filter: [
      { saturate: chatBackgroundAppearance.saturation },
      { contrast: chatBackgroundAppearance.contrast },
      { brightness: chatBackgroundAppearance.brightness },
    ],
  },
  imageFallback: {
    position: "absolute",
    inset: 0,
  },
  whiteOverlay: {
    position: "absolute",
    inset: 0,
    backgroundColor: `rgba(255,255,255,${chatBackgroundAppearance.whiteOverlayOpacity})`,
  },
});
