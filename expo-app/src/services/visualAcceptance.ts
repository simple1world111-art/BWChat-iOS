import type { User, WalletBalanceSnapshot, WalletTransaction } from "@/models";
import type { CatalogLanguage } from "@/localization/catalogs";

export type WalletVisualAcceptanceVariant =
  | "wallet-coins"
  | "wallet-coins-compact"
  | "wallet-transactions"
  | "wallet-transactions-rows"
  | "wallet-transactions-expense-rows"
  | "wallet-transactions-error"
  | "wallet-transactions-loading";

export type AuthVisualAcceptanceVariant = "auth-login" | "auth-register";

const requestedVariant = process.env.EXPO_PUBLIC_VISUAL_ACCEPTANCE;
const requestedLanguage = process.env.EXPO_PUBLIC_VISUAL_ACCEPTANCE_LANGUAGE;

export const mapVisualAcceptanceEnabled = __DEV__ && requestedVariant === "map";

export const authVisualAcceptanceVariant: AuthVisualAcceptanceVariant | undefined =
  __DEV__ && (requestedVariant === "auth-login" || requestedVariant === "auth-register")
    ? requestedVariant
    : undefined;

export const authVisualAcceptanceEnabled = authVisualAcceptanceVariant !== undefined;

export const walletVisualAcceptanceVariant: WalletVisualAcceptanceVariant | undefined =
  __DEV__ &&
  (requestedVariant === "wallet-coins" ||
    requestedVariant === "wallet-coins-compact" ||
    requestedVariant === "wallet-transactions" ||
    requestedVariant === "wallet-transactions-rows" ||
    requestedVariant === "wallet-transactions-expense-rows" ||
    requestedVariant === "wallet-transactions-error" ||
    requestedVariant === "wallet-transactions-loading")
    ? requestedVariant
    : undefined;

export const walletVisualAcceptanceEnabled = walletVisualAcceptanceVariant !== undefined;

export const visualAcceptanceEnabled =
  walletVisualAcceptanceEnabled || mapVisualAcceptanceEnabled || authVisualAcceptanceEnabled;

export const visualAcceptanceLanguage: CatalogLanguage | undefined =
  __DEV__ &&
  visualAcceptanceEnabled &&
  (requestedLanguage === "en" ||
    requestedLanguage === "ja" ||
    requestedLanguage === "ko" ||
    requestedLanguage === "es" ||
    requestedLanguage === "fr" ||
    requestedLanguage === "de" ||
    requestedLanguage === "pt-BR" ||
    requestedLanguage === "ru" ||
    requestedLanguage === "zh-Hans" ||
    requestedLanguage === "zh-Hant")
    ? requestedLanguage
    : undefined;

export const walletVisualAcceptanceLanguage = visualAcceptanceLanguage;

export const walletVisualAcceptanceUser: User = {
  user_id: "wallet-visual-acceptance",
  username: "wallet_visual_acceptance",
  nickname: "Wallet Visual Acceptance",
  avatar_url: "",
  bio: "",
  gender: "",
  birthday: "",
  location: "",
  following_count: 0,
  follower_count: 0,
  posts_count: 0,
  moments_count: 0,
  followed_by_me: false,
  follows_me: false,
  is_friend: false,
};

export const mapVisualAcceptanceUser: User = {
  ...walletVisualAcceptanceUser,
  user_id: "map-visual-acceptance",
  username: "map_visual_acceptance",
  nickname: "我",
};

export const visualAcceptanceUser = mapVisualAcceptanceEnabled
  ? mapVisualAcceptanceUser
  : walletVisualAcceptanceUser;

export const walletVisualAcceptanceBalance: WalletBalanceSnapshot = {
  currency: "gold_coin",
  gold_coin_balance: 85,
  activity_cat_food_balance: 20,
  spendable_balance: 105,
  chat_money_frozen_gold_coin_balance: 0,
};

export const walletVisualAcceptanceTransactions: readonly WalletTransaction[] = [
  {
    id: "tx-income-iap",
    type: "ios_iap",
    currency: "gold_coin",
    gold_coin_amount: 100,
    created_at: "2026-08-07T10:20:00Z",
  },
  {
    id: "tx-income-gift",
    type: "gift_received",
    currency: "gold_coin",
    gold_coin_amount: 24,
    gift_name: "玫瑰",
    created_at: "2026-08-06T03:05:00Z",
  },
  {
    id: "tx-income-transfer",
    type: "transfer_received",
    currency: "gold_coin",
    gold_coin_amount: 36,
    note: "来自好友小白",
    created_at: "2026-08-05T15:42:00Z",
  },
  {
    id: "tx-expense-gift",
    type: "gift_sent",
    currency: "gold_coin",
    gold_coin_amount: 20,
    gift_name: "咖啡",
    created_at: "2026-08-04T12:30:00Z",
  },
  {
    id: "tx-expense-red-packet",
    type: "red_packet_sent",
    currency: "gold_coin",
    gold_coin_amount: 15,
    created_at: "2026-08-03T01:15:00Z",
  },
  {
    id: "tx-expense-transfer",
    type: "transfer_sent",
    currency: "gold_coin",
    gold_coin_amount: 7,
    note: "转给好友阿青",
    created_at: "2026-08-02T08:08:00Z",
  },
] as const;

export const walletVisualAcceptanceRemoteConfig = {
  ad_reward_enabled: true,
  ad_reward: { reward_item: "gold_coin" },
} as const;
