import { Image, type ImageSource } from "expo-image";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";

import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { verifiedChatRemoteAssetUri } from "@/services/messages/ChatRemoteAssetService";
import { trustedChatStickerRemoteAsset } from "@/services/messages/chatStickerPolicy";
import { colors } from "@/theme";

const bundledAssets: Readonly<Record<string, ImageSource>> = {
  AuthPortraitBackdrop: require("../../../assets/native-original/Assets.xcassets/AuthPortraitBackdrop.imageset/AuthPortraitBackdrop.jpg"),
  activity_cat_food_icon: require("../../../assets/native-original/Assets.xcassets/activity_cat_food_icon.imageset/activity_cat_food_icon.png"),
  activity_claim_burst: require("../../../assets/native-original/Assets.xcassets/activity_claim_burst.imageset/activity_claim_burst.png"),
  activity_reward_paw: require("../../../assets/native-original/Assets.xcassets/activity_reward_paw.imageset/activity_reward_paw.png"),
  agent_matching_earth_texture: require("../../../assets/native-original/Assets.xcassets/agent_matching_earth_texture.imageset/agent_matching_earth_texture.jpg"),
  auth_cat_cover: require("../../../assets/native-original/Assets.xcassets/auth_cat_cover.imageset/auth_cat_cover.png"),
  auth_cat_idle: require("../../../assets/native-original/Assets.xcassets/auth_cat_idle.imageset/auth_cat_idle.png"),
  auth_cat_peek: require("../../../assets/native-original/Assets.xcassets/auth_cat_peek.imageset/auth_cat_peek.png"),
  gift_bell: require("../../../assets/native-original/Assets.xcassets/gift_bell.imageset/gift_bell.png"),
  gift_can: require("../../../assets/native-original/Assets.xcassets/gift_can.imageset/gift_can.png"),
  gift_fish: require("../../../assets/native-original/Assets.xcassets/gift_fish.imageset/gift_fish.png"),
  gift_tree: require("../../../assets/native-original/Assets.xcassets/gift_tree.imageset/gift_tree.png"),
  gift_wand: require("../../../assets/native-original/Assets.xcassets/gift_wand.imageset/gift_wand.png"),
  gift_whimsical_arrow: require("../../../assets/native-original/Assets.xcassets/gift_whimsical_arrow.imageset/gift-whimsical-arrow.png"),
  gift_yarn: require("../../../assets/native-original/Assets.xcassets/gift_yarn.imageset/gift_yarn.png"),
  message_action_cat_active: require("../../../assets/native-original/Assets.xcassets/message_action_cat_active.imageset/message_action_cat_active.png"),
  message_action_cat_default: require("../../../assets/native-original/Assets.xcassets/message_action_cat_default.imageset/message_action_cat_default.png"),
  prop_image_unlock_card: require("../../../assets/native-original/Assets.xcassets/prop_image_unlock_card.imageset/prop_image_unlock_card_gift_v2.png"),
  prop_live_experience_card_10m: require("../../../assets/native-original/Assets.xcassets/prop_live_experience_card_10m.imageset/prop_live_experience_card_10m_gift_v2.png"),
  prop_live_experience_card_15m: require("../../../assets/native-original/Assets.xcassets/prop_live_experience_card_15m.imageset/prop_live_experience_card_15m_gift_v2.png"),
  prop_live_experience_card_5m: require("../../../assets/native-original/Assets.xcassets/prop_live_experience_card_5m.imageset/prop_live_experience_card_5m_gift_v2.png"),
  prop_video_unlock_card: require("../../../assets/native-original/Assets.xcassets/prop_video_unlock_card.imageset/prop_video_unlock_card_gift_v2.png"),
  wallet_cat_hair: require("../../../assets/native-original/Assets.xcassets/wallet_cat_hair.imageset/wallet_cat_hair.png"),
  wallet_empty_cat: require("../../../assets/native-original/Assets.xcassets/wallet_empty_cat.imageset/wallet_empty_cat.png"),
  wallet_gold_coin_background: require("../../../assets/native-original/Assets.xcassets/wallet_gold_coin_background.imageset/wallet_gold_coin_background.jpg"),
  wallet_gold_coin_badge: require("../../../assets/native-original/Assets.xcassets/wallet_gold_coin_badge.imageset/wallet_gold_coin_badge.png"),
};

export function DynamicRemoteAssetImage({
  assetKey,
  fallbackAssetName,
  fallbackSystemImage = "photo",
  fallbackTintColor = colors.tertiaryText,
  contentFit = "contain",
}: {
  assetKey?: string | undefined;
  fallbackAssetName?: string | undefined;
  fallbackSystemImage?: string | undefined;
  fallbackTintColor?: string | undefined;
  contentFit?: "contain" | "cover" | undefined;
}) {
  const { config } = useRemoteConfig();
  const remoteAsset = useMemo(
    () => trustedChatStickerRemoteAsset(assetKey, config.assetManifest),
    [assetKey, config.assetManifest],
  );
  const bundled = fallbackAssetName ? bundledAssets[fallbackAssetName] : undefined;
  const [remote, setRemote] = useState<{ key: string; uri: string } | null>(null);
  const [fallbackSymbolSize, setFallbackSymbolSize] = useState(22);

  useEffect(() => {
    let active = true;
    if (!remoteAsset)
      return () => {
        active = false;
      };
    void verifiedChatRemoteAssetUri(remoteAsset)
      .then((uri) => {
        if (active) setRemote({ key: remoteAsset.key, uri });
      })
      .catch(() => {
        if (active) setRemote(null);
      });
    return () => {
      active = false;
    };
  }, [remoteAsset]);

  const source = remote !== null && remote.key === remoteAsset?.key ? remote.uri : bundled;
  return source ? (
    <Image contentFit={contentFit} source={source} style={StyleSheet.absoluteFill} transition={0} />
  ) : (
    <View
      onLayout={(event: LayoutChangeEvent) => {
        const nextSize = Math.max(
          1,
          Math.min(event.nativeEvent.layout.width, event.nativeEvent.layout.height),
        );
        if (Number.isFinite(nextSize) && nextSize !== fallbackSymbolSize) {
          setFallbackSymbolSize(nextSize);
        }
      }}
      style={styles.fallback}
    >
      <SymbolView
        name={fallbackSystemImage as SFSymbol}
        size={fallbackSymbolSize}
        tintColor={fallbackTintColor}
      />
    </View>
  );
}

export function bundledDynamicAssetNames(): readonly string[] {
  return Object.keys(bundledAssets);
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", flex: 1, justifyContent: "center" },
});
