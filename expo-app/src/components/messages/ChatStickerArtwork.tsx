import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { verifiedChatRemoteAssetUri } from "@/services/messages/ChatRemoteAssetService";
import {
  chatStickerBubblePolicy,
  trustedChatStickerRemoteAsset,
} from "@/services/messages/chatStickerPolicy";
import { colors } from "@/theme";

export function ChatStickerArtwork({
  assetKey,
  accessibilityLabel,
  style,
}: {
  assetKey: string | undefined;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { config } = useRemoteConfig();
  const asset = useMemo(
    () => trustedChatStickerRemoteAsset(assetKey, config.assetManifest),
    [assetKey, config.assetManifest],
  );
  const [verifiedState, setVerifiedState] = useState<{ key: string; uri: string } | null>(null);
  const uri = asset && verifiedState?.key === asset.key ? verifiedState.uri : null;

  useEffect(() => {
    let active = true;
    if (!asset) return;
    void verifiedChatRemoteAssetUri(asset)
      .then((nextUri) => {
        if (active) setVerifiedState({ key: asset.key, uri: nextUri });
      })
      .catch(() => {
        if (active) setVerifiedState(null);
      });
    return () => {
      active = false;
    };
  }, [asset]);

  return (
    <View accessibilityLabel={accessibilityLabel || undefined} style={[styles.container, style]}>
      {uri ? (
        <Image contentFit="contain" source={uri} style={StyleSheet.absoluteFill} transition={0} />
      ) : (
        <ChatStickerArtworkFallback label={accessibilityLabel} />
      )}
    </View>
  );
}

function ChatStickerArtworkFallback({ label }: { label: string }) {
  if (!label.trim()) {
    return (
      <View style={styles.systemFallback}>
        <SymbolView name="face.smiling" size={28} tintColor={colors.tertiaryText} />
      </View>
    );
  }
  return (
    <View style={styles.textFallback}>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={chatStickerBubblePolicy.fallbackMinimumScale}
        numberOfLines={2}
        style={styles.fallbackText}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: "hidden" },
  systemFallback: { flex: 1, alignItems: "center", justifyContent: "center" },
  textFallback: {
    flex: 1,
    padding: chatStickerBubblePolicy.fallbackPadding,
    borderRadius: chatStickerBubblePolicy.fallbackCornerRadius,
    borderWidth: chatStickerBubblePolicy.fallbackBorderWidth,
    borderColor: "rgba(102,126,234,0.18)",
    backgroundColor: "rgba(102,126,234,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackText: {
    color: colors.secondaryText,
    fontSize: chatStickerBubblePolicy.fallbackFontSize,
    fontWeight: "600",
    textAlign: "center",
  },
});
