import type { User, WalletBalanceSnapshot, WalletTransaction, WalletWithdrawal } from "@/models";
import type { CatalogLanguage } from "@/localization/catalogs";

export type WalletVisualAcceptanceVariant =
  | "wallet-coins"
  | "wallet-coins-compact"
  | "wallet-earnings"
  | "wallet-earnings-compact"
  | "wallet-transactions"
  | "wallet-transactions-rows"
  | "wallet-transactions-expense-rows"
  | "wallet-transactions-error"
  | "wallet-transactions-loading"
  | "wallet-withdrawals"
  | "wallet-withdrawals-rows"
  | "wallet-withdrawals-error"
  | "wallet-withdrawals-loading";

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
    requestedVariant === "wallet-earnings" ||
    requestedVariant === "wallet-earnings-compact" ||
    requestedVariant === "wallet-transactions" ||
    requestedVariant === "wallet-transactions-rows" ||
    requestedVariant === "wallet-transactions-expense-rows" ||
    requestedVariant === "wallet-transactions-error" ||
    requestedVariant === "wallet-transactions-loading" ||
    requestedVariant === "wallet-withdrawals" ||
    requestedVariant === "wallet-withdrawals-rows" ||
    requestedVariant === "wallet-withdrawals-error" ||
    requestedVariant === "wallet-withdrawals-loading")
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
  recharge_gold_coin_balance: 50,
  gift_income_gold_coin_balance: 35,
  withdraw_frozen_gold_coin_balance: 0,
  withdrawable_gold_coin_balance: 35,
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

export const walletVisualAcceptanceWithdrawals: readonly WalletWithdrawal[] = [
  {
    id: "wd-pending",
    currency: "gold_coin",
    gold_coin_amount: 100,
    payout_usd: 0.5,
    network: "TRC20",
    wallet_address: "TQx3w8Yv9K2mN6pR4sUaBcDeFgHiJkLm",
    status: "pending",
    can_cancel: true,
    created_at: "2026-08-07T09:40:00Z",
  },
  {
    id: "wd-processing",
    currency: "gold_coin",
    gold_coin_amount: 200,
    payout_usd: 1,
    network: "ERC20",
    wallet_address: "0x1234567890abcdef1234567890abcdef",
    status: "processing",
    can_cancel: false,
    created_at: "2026-08-06T02:20:00Z",
  },
  {
    id: "wd-completed",
    currency: "gold_coin",
    gold_coin_amount: 300,
    payout_usd: 1.5,
    payout_account: "BEP20:0xabcdef1234567890abcdef1234567890",
    status: "completed",
    can_cancel: false,
    note: "链上已确认",
    created_at: "2026-08-05T14:15:00Z",
  },
  {
    id: "wd-rejected",
    currency: "gold_coin",
    gold_coin_amount: 400,
    payout_cents: 200,
    provider: "manual",
    status: "rejected",
    can_cancel: false,
    note: "地址无效",
    created_at: "2026-08-04T04:05:00Z",
  },
] as const;

export const walletVisualAcceptanceRemoteConfig = {
  minimum_withdrawal_usdt: 0.5,
  withdrawal_step_usdt: 0.5,
  usdt_per_gold_coin: 0.005,
  withdrawal_networks: [
    { network: "TRC20", enabled: true },
    { network: "ERC20", enabled: true },
    { network: "BEP20", enabled: true },
  ],
  ad_reward_enabled: true,
  ad_reward: { reward_item: "gold_coin" },
} as const;
