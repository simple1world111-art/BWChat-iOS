import type { WalletTransaction, WalletWithdrawal } from "@/models";
import { flexBool, flexDouble, flexInt, flexString, isRecord } from "@/api/normalizers";

export interface GoldCoinProductConfig {
  productId: string;
  coins: number;
  fallbackPriceUsd: string;
}

export interface WalletWithdrawalPolicy {
  usdtPerGoldCoin: number;
  minimumUsdt: number;
  stepUsdt: number;
}

export interface WalletPendingRewardCredit {
  userId: string;
  remainingBefore: number;
  businessDayResetAt: number;
  sessionExpiresAt: number;
}

interface WalletWithdrawalNetworkConfig {
  network: string;
  enabled: boolean;
  minimumUsdt?: number | undefined;
  stepUsdt?: number | undefined;
  usdtPerGoldCoin?: number | undefined;
}

export interface WalletRuntimeConfig {
  products: GoldCoinProductConfig[];
  withdrawalNetworks: WalletWithdrawalNetworkConfig[];
  termsUrl?: string | undefined;
  adRewardEnabled: boolean;
  adRewardsGoldCoins: boolean;
  iosWalletAdUnitId?: string | undefined;
  iosAdUnitIds: string[];
  androidWalletAdUnitId?: string | undefined;
  androidAdUnitIds: string[];
  baseWithdrawalPolicy: WalletWithdrawalPolicy;
  hasGlobalWithdrawalMinimum: boolean;
}

export const walletMetrics = {
  tabHeaderWidth: 246,
  tabSpacing: 18,
  tabWidth: 114,
  tabTitleSize: 18,
  tabUnderlineWidth: 32,
  tabUnderlineHeight: 4,
  tabUnderlineGap: 3,
  compactHeightThreshold: 650,
  standardTopPadding: 48,
  compactTopPadding: 30,
  standardSectionGap: 26,
  compactSectionGap: 18,
  badgeStandardSize: 147,
  badgeCompactSize: 119,
  badgeStandardContainerHeight: 153,
  badgeCompactContainerHeight: 122,
  adHorizontalInset: 20,
  adStandardHeight: 54,
  adCompactHeight: 46,
  panelRadius: 30,
  panelHorizontalInset: 18,
  gridColumns: 3,
  gridColumnGap: 12,
  gridStandardRowGap: 16,
  gridCompactRowGap: 12,
  productStandardHeight: 78,
  productCompactHeight: 66,
  productStandardRadius: 18,
  productCompactRadius: 14,
  productStandardBorder: 3,
  productCompactBorder: 2.5,
  purchaseStandardHeight: 52,
  purchaseCompactHeight: 42,
  purchaseRadius: 16,
  summaryStandardHeight: 148,
  summaryCompactHeight: 130,
  fieldStandardHeight: 68,
  fieldCompactHeight: 62,
  fieldRadius: 18,
  recordHeaderHorizontalInset: 14,
  recordHeaderTopInset: 14,
  recordHeaderBottomInset: 18,
  recordHeaderSideWidth: 78,
  recordTabGap: 48,
  recordTabSize: 20,
  recordTabUnderlineWidth: 31,
  recordTabUnderlineHeight: 3,
  recordTabUnderlineGap: 7,
  recordListInset: 16,
  recordListGap: 8,
  recordRowRadius: 12,
  recordIconSize: 36,
  emptyCatWidth: 154,
  emptyCatHeight: 142,
  networkMenuAnimationMs: 160,
  networkMenuLayerReleaseMs: 200,
  navigationAfterKeyboardMs: 180,
  balanceCacheTtlMs: 30_000,
  listCacheTtlMs: 120_000,
  staleRetentionMs: 30 * 24 * 60 * 60 * 1_000,
  maxCachedWithdrawals: 500,
  transactionPageSize: 50,
  dailyAdLimit: 10,
  adCreditPollAttempts: 6,
  adCreditPollIntervalMs: 1_000,
  adPendingFallbackTtlMs: 30 * 60 * 1_000,
} as const;

export const fallbackGoldCoinProducts: readonly GoldCoinProductConfig[] = [
  { productId: "com.bwchat.app.catfood.100", coins: 100, fallbackPriceUsd: "$0.99" },
  { productId: "com.bwchat.app.catfood.800", coins: 800, fallbackPriceUsd: "$7.99" },
  { productId: "com.bwchat.app.catfood.1800", coins: 1_800, fallbackPriceUsd: "$17.99" },
  { productId: "com.bwchat.app.catfood.3000", coins: 3_000, fallbackPriceUsd: "$29.99" },
  { productId: "com.bwchat.app.catfood.9800", coins: 9_800, fallbackPriceUsd: "$99.99" },
  { productId: "com.bwchat.app.catfood.19800", coins: 19_800, fallbackPriceUsd: "$199.99" },
] as const;

export const fallbackWithdrawalPolicy: WalletWithdrawalPolicy = {
  usdtPerGoldCoin: 0.005,
  minimumUsdt: 0.5,
  stepUsdt: 0.5,
};

const defaultWithdrawalNetworks = ["TRC20", "ERC20", "BEP20"] as const;
const iosProductionRewardedAdUnitId = "ca-app-pub-1877504503518465/1011630693";
const androidTestRewardedAdUnitId = "ca-app-pub-3940256099942544/5224354917";

export function resolveWalletRuntimeConfig(value: unknown): WalletRuntimeConfig {
  const wallet = isRecord(value) ? value : {};
  const knownProducts = new Map(fallbackGoldCoinProducts.map((item) => [item.productId, item]));
  const remoteProductsSource = Array.isArray(wallet.gold_coin_products)
    ? wallet.gold_coin_products
    : Array.isArray(wallet.goldCoinProducts)
      ? wallet.goldCoinProducts
      : [];
  const remoteProducts = remoteProductsSource
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      const productId = flexString(item.product_id, item.productId, item.id);
      const fallback = productId ? knownProducts.get(productId) : undefined;
      if (!productId || !fallback) return [];
      return [{
        product: {
          productId,
          coins: Math.max(flexInt(item.gold_coin_amount, item.goldCoinAmount, item.coins) ?? fallback.coins, 0),
          fallbackPriceUsd: fallback.fallbackPriceUsd,
        },
        order: flexInt(item.order, item.sort_order, item.sortOrder) ?? Number.MAX_SAFE_INTEGER,
      }];
    })
    .filter((item) => item.product.coins > 0)
    .sort((left, right) => left.order - right.order)
    .map((item) => item.product);

  const rawNetworks = Array.isArray(wallet.withdrawal_networks)
    ? wallet.withdrawal_networks
    : Array.isArray(wallet.withdrawalNetworks)
      ? wallet.withdrawalNetworks
      : [];
  const withdrawalNetworks = rawNetworks
    .flatMap((item) => normalizeWithdrawalNetwork(item))
    .filter((item) => item.enabled && item.network.length > 0);
  const nestedAd = isRecord(wallet.ad_reward)
    ? wallet.ad_reward
    : isRecord(wallet.adReward)
      ? wallet.adReward
      : {};

  const globalMinimum = flexDouble(
    wallet.minimum_withdrawal_usdt,
    wallet.minimumWithdrawalUSDT,
  );
  const enabledMinimums = withdrawalNetworks.flatMap((item) =>
    item.minimumUsdt !== undefined && item.minimumUsdt > 0 ? [item.minimumUsdt] : [],
  );

  return {
    products: remoteProducts.length > 0 ? remoteProducts : [...fallbackGoldCoinProducts],
    withdrawalNetworks:
      withdrawalNetworks.length > 0
        ? withdrawalNetworks
        : defaultWithdrawalNetworks.map((network) => ({ network, enabled: true })),
    ...(flexString(wallet.terms_url, wallet.termsUrl)
      ? { termsUrl: flexString(wallet.terms_url, wallet.termsUrl) }
      : {}),
    adRewardEnabled: flexBool(wallet.ad_reward_enabled, wallet.adRewardEnabled) ?? false,
    adRewardsGoldCoins:
      flexString(nestedAd.reward_item, nestedAd.rewardItem)?.toLocaleLowerCase() === "gold_coin",
    ...(validAdUnitId(nestedAd.ios_wallet_ad_unit_id, nestedAd.iosWalletAdUnitId)
      ? { iosWalletAdUnitId: validAdUnitId(nestedAd.ios_wallet_ad_unit_id, nestedAd.iosWalletAdUnitId) }
      : {}),
    iosAdUnitIds: normalizedAdUnitIds(nestedAd.ios_ad_unit_ids, nestedAd.iosAdUnitIds),
    ...(validAdUnitId(nestedAd.android_wallet_ad_unit_id, nestedAd.androidWalletAdUnitId)
      ? { androidWalletAdUnitId: validAdUnitId(nestedAd.android_wallet_ad_unit_id, nestedAd.androidWalletAdUnitId) }
      : {}),
    androidAdUnitIds: normalizedAdUnitIds(nestedAd.android_ad_unit_ids, nestedAd.androidAdUnitIds),
    baseWithdrawalPolicy: makeWithdrawalPolicy(
      flexDouble(wallet.usdt_per_gold_coin, wallet.usdtPerGoldCoin),
      globalMinimum ?? (enabledMinimums.length > 0 ? Math.min(...enabledMinimums) : undefined),
      flexDouble(wallet.withdrawal_step_usdt, wallet.withdrawalStepUSDT),
    ),
    hasGlobalWithdrawalMinimum: globalMinimum !== undefined && globalMinimum > 0,
  };
}

export function withdrawalPolicyFor(
  config: WalletRuntimeConfig,
  network?: string | undefined,
): WalletWithdrawalPolicy {
  const normalized = network?.trim().toLocaleLowerCase();
  const match = normalized
    ? config.withdrawalNetworks.find((item) => item.network.toLocaleLowerCase() === normalized)
    : undefined;
  const enabledMinimums = config.withdrawalNetworks
    .flatMap((item) => (item.minimumUsdt !== undefined && item.minimumUsdt > 0 ? [item.minimumUsdt] : []));
  return makeWithdrawalPolicy(
    match?.usdtPerGoldCoin ?? config.baseWithdrawalPolicy.usdtPerGoldCoin,
    match?.minimumUsdt ??
      (config.hasGlobalWithdrawalMinimum
        ? config.baseWithdrawalPolicy.minimumUsdt
        : enabledMinimums.length > 0
          ? Math.min(...enabledMinimums)
          : config.baseWithdrawalPolicy.minimumUsdt),
    match?.stepUsdt ?? config.baseWithdrawalPolicy.stepUsdt,
  );
}

export function rawUsdtAmount(policy: WalletWithdrawalPolicy, goldCoins: number): number {
  return Math.max(Math.trunc(goldCoins), 0) * policy.usdtPerGoldCoin;
}

export function maximumUsdtAmount(policy: WalletWithdrawalPolicy, goldCoins: number): number {
  const raw = rawUsdtAmount(policy, goldCoins);
  if (raw + 0.000_000_1 < policy.stepUsdt) return 0;
  return Math.floor((raw + 0.000_000_1) / policy.stepUsdt) * policy.stepUsdt;
}

export function canWithdraw(policy: WalletWithdrawalPolicy, goldCoins: number): boolean {
  return maximumUsdtAmount(policy, goldCoins) + 0.000_000_1 >= policy.minimumUsdt;
}

export function isValidUsdtIncrement(policy: WalletWithdrawalPolicy, amount: number): boolean {
  if (!(amount > 0)) return false;
  const units = amount / policy.stepUsdt;
  return Math.abs(units - Math.round(units)) < 0.000_001;
}

export function requiredGoldCoins(policy: WalletWithdrawalPolicy, usdtAmount: number): number {
  return Math.max(1, Math.ceil(usdtAmount / policy.usdtPerGoldCoin));
}

export function normalizeWithdrawalUsdtText(raw: string): string | undefined {
  let value = raw.trim().replaceAll(",", ".");
  if (value.startsWith(".")) value = `0${value}`;
  if (value.endsWith(".")) value += "0";
  if (!/^\d+(\.\d{1,2})?$/u.test(value)) return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : undefined;
}

export function isWalletPayoutAccountConfigured(network: string, address: string): boolean {
  return network.trim().length > 0 && address.trim().length >= 12;
}

export function walletWithdrawalErrorKey(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  if (flexInt(error.status) === 404) return "wallet.withdrawal.serviceUnavailable";
  const payload = isRecord(error.payload) ? error.payload : {};
  const rawCode = flexString(payload.code, error.code);
  const rawMessage = flexString(payload.message, error.message);
  const parsedMessage = parseEmbeddedWalletError(rawMessage);
  const normalized = (rawCode ?? parsedMessage.code ?? rawMessage ?? "").trim().toLocaleLowerCase();
  const keys: Readonly<Record<string, string>> = {
    invalid_withdrawal_amount: "wallet.withdrawal.amount.invalid",
    insufficient_gold_coins: "wallet.withdrawal.amount.insufficientGoldCoins",
    insufficient_withdrawable_gold_coin_balance: "wallet.withdrawal.amount.insufficientGoldCoins",
    usdt_account_required: "wallet.withdrawal.usdt.required",
    payout_account_required: "wallet.withdrawal.usdt.required",
    invalid_usdt_account: "wallet.usdt.invalid",
    invalid_payout_account: "wallet.usdt.invalid",
  };
  return keys[normalized];
}

export function pendingRewardResolution(
  pending: WalletPendingRewardCredit,
  currentUserId: string,
  serverRemainingCount: number | undefined,
  now: number,
): "confirmed" | "expired" | "pending" {
  if (currentUserId !== pending.userId || now >= pending.sessionExpiresAt) return "expired";
  if (now >= pending.businessDayResetAt || serverRemainingCount === undefined) return "pending";
  return serverRemainingCount < pending.remainingBefore ? "confirmed" : "pending";
}

export function shanghaiBusinessDay(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

export function nextShanghaiMidnight(now = Date.now()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date(now));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day) + 1) - 8 * 60 * 60 * 1_000;
}

export function formatWalletDetailedDateTime(value: string): string {
  const trimmed = value.trim();
  const normalized = /(Z|[+-]\d{2}:?\d{2})$/u.test(trimmed)
    ? trimmed
    : `${trimmed.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) return value;
  const twoDigits = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;
}

function parseEmbeddedWalletError(value: string | undefined): { code?: string | undefined } {
  if (!value?.trim().startsWith("{")) return {};
  try {
    const decoded: unknown = JSON.parse(value);
    return isRecord(decoded) && flexString(decoded.code)
      ? { code: flexString(decoded.code)?.trim() }
      : {};
  } catch {
    return {};
  }
}

export function walletTransactionSignedAmount(transaction: WalletTransaction): number | undefined {
  const amount = transaction.gold_coin_amount;
  if (amount === undefined || amount === 0) return undefined;
  if (["gift_sent", "red_packet_sent", "transfer_sent"].includes(transaction.type)) {
    return -Math.abs(amount);
  }
  if ([
    "ios_iap",
    "gift_received",
    "red_packet_received",
    "red_packet_refund",
    "transfer_received",
    "transfer_returned",
  ].includes(transaction.type)) {
    return Math.abs(amount);
  }
  return amount;
}

export function walletTransactionTitleKey(transaction: WalletTransaction): string | undefined {
  const known = localizedWalletRecordKind(transaction);
  if (known) return known.titleKey;
  const keys: Readonly<Record<string, string>> = {
    ios_iap: "wallet.transaction.iap",
    gift_sent: "wallet.transaction.giftSent",
    gift_received: "wallet.transaction.giftReceived",
    red_packet_sent: "wallet.transaction.redPacketSent",
    red_packet_received: "wallet.transaction.redPacketReceived",
    red_packet_refund: "wallet.transaction.redPacketRefund",
    transfer_sent: "wallet.transaction.transferSent",
    transfer_received: "wallet.transaction.transferReceived",
    transfer_returned: "wallet.transaction.transferReturned",
  };
  return keys[transaction.type];
}

export function walletTransactionSubtitleKey(transaction: WalletTransaction): string | undefined {
  const known = localizedWalletRecordKind(transaction);
  if (known) return known.subtitleKey;
  if (transaction.type === "ios_iap") return "wallet.transaction.iapSubtitle";
  if (transaction.type === "gift_sent") return "wallet.transaction.giftSentSubtitle";
  if (transaction.type === "gift_received") return "wallet.transaction.giftReceivedSubtitle";
  if ([
    "red_packet_sent",
    "red_packet_received",
    "red_packet_refund",
    "transfer_sent",
    "transfer_received",
    "transfer_returned",
  ].includes(transaction.type)) return "wallet.transaction.chatMoneySubtitle";
  return undefined;
}

export function walletTransactionIcon(transaction: WalletTransaction) {
  const icons: Readonly<Record<string, string>> = {
    ios_iap: "cart.fill",
    gift_sent: "paperplane.fill",
    gift_received: "gift.fill",
    red_packet_sent: "envelope.fill",
    red_packet_received: "envelope.open.fill",
    red_packet_refund: "envelope.open.fill",
    transfer_sent: "arrow.up.right.circle.fill",
    transfer_received: "arrow.down.left.circle.fill",
    transfer_returned: "arrow.uturn.backward.circle.fill",
  };
  return icons[transaction.type] ?? "pawprint.fill";
}

export function walletWithdrawalCanCancel(withdrawal: WalletWithdrawal): boolean {
  return withdrawal.can_cancel ?? ["pending", "requested", "reviewing"].includes(withdrawal.status.toLocaleLowerCase());
}

export function walletWithdrawalPayoutText(withdrawal: WalletWithdrawal): string {
  const amount =
    withdrawal.payout_usd ??
    (withdrawal.payout_cents !== undefined ? withdrawal.payout_cents / 100 : undefined) ??
    withdrawal.gold_coin_amount * fallbackWithdrawalPolicy.usdtPerGoldCoin;
  return `${amount.toFixed(2)} USDT`;
}

export function walletWithdrawalDestination(withdrawal: WalletWithdrawal): string | undefined {
  if (withdrawal.wallet_address?.trim()) {
    return compactWalletLine(withdrawal.network, withdrawal.wallet_address);
  }
  if (withdrawal.payout_account?.trim()) {
    const separator = withdrawal.payout_account.indexOf(":");
    if (separator >= 0) {
      return compactWalletLine(
        withdrawal.payout_account.slice(0, separator),
        withdrawal.payout_account.slice(separator + 1),
      );
    }
    return withdrawal.payout_account;
  }
  const method = withdrawal.payout_method ?? withdrawal.provider;
  return method?.trim() ? method.toLocaleUpperCase() : undefined;
}

export function walletRewardedAdUnitId(
  config: WalletRuntimeConfig,
  platform: "ios" | "android",
  isDevelopment: boolean,
): string {
  if (platform === "android") {
    if (isDevelopment) return androidTestRewardedAdUnitId;
    const configured = config.androidAdUnitIds.filter((value) => value !== androidTestRewardedAdUnitId);
    return config.androidWalletAdUnitId && configured.includes(config.androidWalletAdUnitId)
      ? config.androidWalletAdUnitId
      : configured[0] ?? androidTestRewardedAdUnitId;
  }
  const configured = config.iosAdUnitIds.filter((value) => !value.endsWith("/1712485313"));
  if (config.iosWalletAdUnitId && (configured.length === 0 || configured.includes(config.iosWalletAdUnitId))) {
    return config.iosWalletAdUnitId;
  }
  return configured[0] ?? iosProductionRewardedAdUnitId;
}

function normalizeWithdrawalNetwork(value: unknown): WalletWithdrawalNetworkConfig[] {
  if (typeof value === "string") {
    const network = value.trim();
    return network ? [{ network, enabled: true }] : [];
  }
  if (!isRecord(value)) return [];
  const network = flexString(value.network)?.trim() ?? "";
  return network
    ? [{
        network,
        enabled: flexBool(value.enabled) ?? true,
        ...(positive(value.min_usdt, value.minimum_usdt, value.minimumUSDT) !== undefined
          ? { minimumUsdt: positive(value.min_usdt, value.minimum_usdt, value.minimumUSDT) }
          : {}),
        ...(positive(value.step_usdt, value.stepUSDT) !== undefined
          ? { stepUsdt: positive(value.step_usdt, value.stepUSDT) }
          : {}),
        ...(positive(value.usdt_per_gold_coin, value.usdtPerGoldCoin) !== undefined
          ? { usdtPerGoldCoin: positive(value.usdt_per_gold_coin, value.usdtPerGoldCoin) }
          : {}),
      }]
    : [];
}

function makeWithdrawalPolicy(
  rate: number | undefined,
  minimum: number | undefined,
  step: number | undefined,
): WalletWithdrawalPolicy {
  return {
    usdtPerGoldCoin: rate !== undefined && rate > 0 ? rate : fallbackWithdrawalPolicy.usdtPerGoldCoin,
    minimumUsdt: minimum !== undefined && minimum > 0 ? minimum : fallbackWithdrawalPolicy.minimumUsdt,
    stepUsdt: step !== undefined && step > 0 ? step : fallbackWithdrawalPolicy.stepUsdt,
  };
}

function positive(...values: unknown[]): number | undefined {
  const value = flexDouble(...values);
  return value !== undefined && value > 0 ? value : undefined;
}

function validAdUnitId(...values: unknown[]): string | undefined {
  const value = flexString(...values);
  if (!value || value.length > 128) return undefined;
  return /^ca-app-pub-\d+\/\d+$/u.test(value) ? value : undefined;
}

function normalizedAdUnitIds(...values: unknown[]): string[] {
  const source = values.find(Array.isArray);
  if (!Array.isArray(source)) return [];
  return [...new Set(source.flatMap((item) => validAdUnitId(item) ?? []))];
}

function localizedWalletRecordKind(transaction: WalletTransaction): {
  titleKey: string;
  subtitleKey: string;
} | undefined {
  const values = [transaction.type, transaction.title, transaction.note]
    .flatMap((value) => (value ? [normalizeRecordText(value)] : []));
  if (values.some((value) => value === "activity wheel prize" || (value.includes("wheel") && value.includes("activity") && (value.includes("prize") || value.includes("payout"))))) {
    return { titleKey: "wallet.transaction.activityWheelPrize", subtitleKey: "activityCenter.tab.wheel" };
  }
  if (values.some((value) => value === "activity wheel cost" || (value.includes("wheel") && value.includes("activity") && (value.includes("cost") || value.includes("debit"))))) {
    return { titleKey: "wallet.transaction.activityWheelCost", subtitleKey: "activityCenter.tab.wheel" };
  }
  if (values.some((value) => value === "game round start" || value === "paid game start" || value.includes("收费游戏开局") || value.includes("收费游戏入场") || value.includes("遊戲入場") || value.includes("游戏入场"))) {
    return { titleKey: "wallet.transaction.gameRoundStart", subtitleKey: "gameCenter.title" };
  }
  if (values.some((value) => value === "ranking reward" || value === "game ranking reward" || value === "leaderboard reward" || value.includes("排行榜奖励") || value.includes("排行榜獎勵"))) {
    return { titleKey: "wallet.transaction.gameRankingReward", subtitleKey: "gameCenter.title" };
  }
  return undefined;
}

function normalizeRecordText(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll("_", " ").replaceAll("-", " ").split(/\s+/u).join(" ");
}

function compactWalletLine(network: string | undefined, address: string): string {
  const clean = address.trim();
  const compact = clean.length > 14 ? `${clean.slice(0, 6)}...${clean.slice(-6)}` : clean;
  return [network?.trim(), compact].filter(Boolean).join(" ");
}
