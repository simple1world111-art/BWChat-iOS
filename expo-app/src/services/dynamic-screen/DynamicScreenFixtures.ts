import type { DynamicScreen } from "@/services/dynamic-screen/DynamicScreenModels";

export const bundledDynamicScreens: readonly DynamicScreen[] = [
  {
    screenId: "daily_rewards",
    schemaVersion: 1,
    configVersion: "bundled-fixture",
    titleI18n: { "zh-Hans": "每日奖励", en: "Daily Rewards" },
    components: [
      {
        id: "hero",
        type: "banner",
        props: {
          title: { "zh-Hans": "今天也来领金币", en: "Claim today's gold coins" },
          subtitle: {
            "zh-Hans": "完成聊天、发动态、送礼物获得奖励",
            en: "Chat, post, and gift to earn rewards",
          },
          system_image: "gift.fill",
        },
      },
      {
        id: "wallet",
        type: "walletBalance",
        props: {},
        action: { type: "native", name: "wallet" },
      },
      {
        id: "open_moments",
        type: "button",
        props: { title: { "zh-Hans": "去发动态", en: "Post a Moment" } },
        action: { type: "native", name: "moments" },
      },
    ],
  },
  {
    screenId: "festival_home",
    schemaVersion: 1,
    configVersion: "bundled-fixture",
    titleI18n: { "zh-Hans": "节日活动", en: "Festival" },
    components: [
      {
        id: "festival_banner",
        type: "banner",
        props: {
          title: { "zh-Hans": "限时活动进行中", en: "Limited-time event" },
          subtitle: {
            "zh-Hans": "入口、文案、图片都可以由配置更新",
            en: "Entry, copy, and artwork are config-driven",
          },
          system_image: "sparkles",
        },
        action: { type: "native", name: "moments" },
      },
      {
        id: "open_rewards",
        type: "actionRow",
        props: {
          title: { "zh-Hans": "领取每日奖励", en: "Claim daily rewards" },
          system_image: "gift.fill",
        },
        action: { type: "screen", screenId: "daily_rewards" },
      },
    ],
  },
  {
    screenId: "agent_hub",
    schemaVersion: 1,
    configVersion: "bundled-fixture",
    titleI18n: { "zh-Hans": "我的智能体", en: "My Agents" },
    components: [
      {
        id: "agent_intro",
        type: "text",
        props: { title: { "zh-Hans": "我的智能体", en: "My Agents" }, style: "title" },
      },
      {
        id: "agent_list",
        type: "agentList",
        props: {},
        action: { type: "native", name: "agent_hub" },
      },
    ],
  },
  {
    screenId: "help_center",
    schemaVersion: 1,
    configVersion: "bundled-fixture",
    titleI18n: { "zh-Hans": "帮助中心", en: "Help Center" },
    components: [
      {
        id: "help_rows",
        type: "card",
        props: {},
        children: [
          {
            id: "wallet_help",
            type: "row",
            props: {
              title: { "zh-Hans": "钱包与金币", en: "Wallet and gold coins" },
              system_image: "pawprint.fill",
            },
            action: { type: "screen", screenId: "wallet_terms" },
          },
          {
            id: "settings",
            type: "row",
            props: {
              title: { "zh-Hans": "账号设置", en: "Account settings" },
              system_image: "gearshape.fill",
            },
            action: { type: "native", name: "settings" },
          },
        ],
      },
    ],
  },
  {
    screenId: "wallet_terms",
    schemaVersion: 1,
    configVersion: "bundled-fixture",
    titleI18n: { "zh-Hans": "钱包说明", en: "Wallet Terms" },
    components: [
      {
        id: "wallet_terms_text",
        type: "text",
        props: {
          title: {
            "zh-Hans": "金币购买始终通过 App Store StoreKit 完成。价格以系统展示为准。",
            en: "Gold Coins purchases always use App Store StoreKit. System price display is authoritative.",
          },
        },
      },
    ],
  },
];
