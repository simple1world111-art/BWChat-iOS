import type { ImageSourcePropType } from "react-native";

/**
 * Byte-for-byte copies of every image entry in the original Swift asset catalog.
 *
 * Keep these as static require() calls: Metro can then include the original files
 * in native builds and EAS Update bundles. Assets with @2x/@3x siblings retain
 * React Native's normal density selection.
 */
export const nativeAssets = {
  authPortraitBackdrop: require("@/assets/native-original/Assets.xcassets/AuthPortraitBackdrop.imageset/AuthPortraitBackdrop.jpg"),
  appIcon: require("@/assets/native-original/Assets.xcassets/BBchatAppIcon.appiconset/BBchatAppIcon.png"),
  activityCatFood: require("@/assets/native-original/Assets.xcassets/activity_cat_food_icon.imageset/activity_cat_food_icon.png"),
  activityClaimBurst: require("@/assets/native-original/Assets.xcassets/activity_claim_burst.imageset/activity_claim_burst.png"),
  activityRewardPaw: require("@/assets/native-original/Assets.xcassets/activity_reward_paw.imageset/activity_reward_paw.png"),
  agentMatchingEarthTexture: require("@/assets/native-original/Assets.xcassets/agent_matching_earth_texture.imageset/agent_matching_earth_texture.jpg"),
  authCatCover: require("@/assets/native-original/Assets.xcassets/auth_cat_cover.imageset/auth_cat_cover.png"),
  authCatIdle: require("@/assets/native-original/Assets.xcassets/auth_cat_idle.imageset/auth_cat_idle.png"),
  authCatPeek: require("@/assets/native-original/Assets.xcassets/auth_cat_peek.imageset/auth_cat_peek.png"),
  giftBell: require("@/assets/native-original/Assets.xcassets/gift_bell.imageset/gift_bell.png"),
  giftCan: require("@/assets/native-original/Assets.xcassets/gift_can.imageset/gift_can.png"),
  giftFish: require("@/assets/native-original/Assets.xcassets/gift_fish.imageset/gift_fish.png"),
  giftTree: require("@/assets/native-original/Assets.xcassets/gift_tree.imageset/gift_tree.png"),
  giftWand: require("@/assets/native-original/Assets.xcassets/gift_wand.imageset/gift_wand.png"),
  giftWhimsicalArrow1x: require("@/assets/native-original/Assets.xcassets/gift_whimsical_arrow.imageset/gift-whimsical-arrow-1x.png"),
  giftWhimsicalArrow2x: require("@/assets/native-original/Assets.xcassets/gift_whimsical_arrow.imageset/gift-whimsical-arrow-2x.png"),
  giftWhimsicalArrow3x: require("@/assets/native-original/Assets.xcassets/gift_whimsical_arrow.imageset/gift-whimsical-arrow.png"),
  giftYarn: require("@/assets/native-original/Assets.xcassets/gift_yarn.imageset/gift_yarn.png"),
  messageActionCatActive: require("@/assets/native-original/Assets.xcassets/message_action_cat_active.imageset/message_action_cat_active.png"),
  messageActionCatDefault: require("@/assets/native-original/Assets.xcassets/message_action_cat_default.imageset/message_action_cat_default.png"),
  propImageUnlockCard: require("@/assets/native-original/Assets.xcassets/prop_image_unlock_card.imageset/prop_image_unlock_card_gift_v2.png"),
  propLiveExperienceCard10m: require("@/assets/native-original/Assets.xcassets/prop_live_experience_card_10m.imageset/prop_live_experience_card_10m_gift_v2.png"),
  propLiveExperienceCard15m: require("@/assets/native-original/Assets.xcassets/prop_live_experience_card_15m.imageset/prop_live_experience_card_15m_gift_v2.png"),
  propLiveExperienceCard5m: require("@/assets/native-original/Assets.xcassets/prop_live_experience_card_5m.imageset/prop_live_experience_card_5m_gift_v2.png"),
  propVideoUnlockCard: require("@/assets/native-original/Assets.xcassets/prop_video_unlock_card.imageset/prop_video_unlock_card_gift_v2.png"),
  walletCatHair: require("@/assets/native-original/Assets.xcassets/wallet_cat_hair.imageset/wallet_cat_hair.png"),
  walletEmptyCat: require("@/assets/native-original/Assets.xcassets/wallet_empty_cat.imageset/wallet_empty_cat.png"),
  walletGoldCoinBackground: require("@/assets/native-original/Assets.xcassets/wallet_gold_coin_background.imageset/wallet_gold_coin_background.jpg"),
  walletGoldCoinBadge: require("@/assets/native-original/Assets.xcassets/wallet_gold_coin_badge.imageset/wallet_gold_coin_badge.png"),
} satisfies Record<string, ImageSourcePropType>;

export type NativeAssetName = keyof typeof nativeAssets;
