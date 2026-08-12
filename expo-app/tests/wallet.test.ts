import {
  cancelWalletWithdrawal,
  confirmWalletIapPurchase,
  createWalletAdRewardSession,
  createWalletWithdrawal,
  getWalletAdRewardStatus,
  getWalletBalance,
  getWalletTransactionPage,
  getWalletWithdrawals,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  normalizeWalletAdRewardSession,
  normalizeWalletAdRewardStatus,
  normalizeWalletBalanceSnapshot,
  normalizeWalletIapConfirmation,
  normalizeWalletTransactionPage,
  normalizeWalletWithdrawals,
} from "@/api/normalizers";
import type { WalletBalanceSnapshot, WalletTransactionPage } from "@/models";
import {
  deduplicateWalletTransactions,
  mergeWalletTransactionPages,
} from "@/services/wallet/WalletRepository";
import {
  canWithdraw,
  fallbackGoldCoinProducts,
  formatWalletDetailedDateTime,
  isWalletPayoutAccountConfigured,
  maximumUsdtAmount,
  nextShanghaiMidnight,
  normalizeWithdrawalUsdtText,
  pendingRewardResolution,
  requiredGoldCoins,
  resolveWalletRuntimeConfig,
  shanghaiBusinessDay,
  walletMetrics,
  walletWithdrawalErrorKey,
  withdrawalPolicyFor,
} from "@/services/wallet/walletPolicy";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const request = jest.mocked(apiRequest);

function balance(overrides: Partial<WalletBalanceSnapshot> = {}): WalletBalanceSnapshot {
  return {
    currency: "gold_coin",
    gold_coin_balance: 1_000,
    activity_cat_food_balance: 5,
    spendable_balance: 900,
    recharge_gold_coin_balance: 600,
    gift_income_gold_coin_balance: 400,
    withdraw_frozen_gold_coin_balance: 100,
    withdrawable_gold_coin_balance: 300,
    chat_money_frozen_gold_coin_balance: 0,
    ...overrides,
  };
}

describe("native wallet parity contracts", () => {
  beforeEach(() => request.mockReset());

  it("keeps the audited native pixel metrics and exact six StoreKit consumables", () => {
    expect(walletMetrics).toMatchObject({
      tabHeaderWidth: 246,
      tabSpacing: 18,
      tabWidth: 114,
      tabTitleSize: 18,
      tabUnderlineWidth: 32,
      tabUnderlineHeight: 4,
      compactHeightThreshold: 650,
      badgeStandardSize: 147,
      badgeCompactSize: 119,
      adStandardHeight: 54,
      adCompactHeight: 46,
      panelRadius: 30,
      gridColumns: 3,
      productStandardHeight: 78,
      productCompactHeight: 66,
      purchaseStandardHeight: 52,
      purchaseCompactHeight: 42,
      summaryStandardHeight: 148,
      summaryCompactHeight: 130,
      fieldStandardHeight: 68,
      fieldCompactHeight: 62,
      recordHeaderSideWidth: 78,
      recordTabGap: 48,
      recordRowRadius: 12,
      emptyCatWidth: 154,
      emptyCatHeight: 142,
      balanceCacheTtlMs: 30_000,
      listCacheTtlMs: 120_000,
      maxCachedWithdrawals: 500,
      transactionPageSize: 50,
      dailyAdLimit: 10,
      adCreditPollAttempts: 6,
      adCreditPollIntervalMs: 1_000,
    });
    expect(fallbackGoldCoinProducts).toEqual([
      { productId: "com.bwchat.app.catfood.100", coins: 100, fallbackPriceUsd: "$0.99" },
      { productId: "com.bwchat.app.catfood.800", coins: 800, fallbackPriceUsd: "$7.99" },
      { productId: "com.bwchat.app.catfood.1800", coins: 1_800, fallbackPriceUsd: "$17.99" },
      { productId: "com.bwchat.app.catfood.3000", coins: 3_000, fallbackPriceUsd: "$29.99" },
      { productId: "com.bwchat.app.catfood.9800", coins: 9_800, fallbackPriceUsd: "$99.99" },
      { productId: "com.bwchat.app.catfood.19800", coins: 19_800, fallbackPriceUsd: "$199.99" },
    ]);
  });

  it("decodes wallet remote products, network overrides and fail-closed reward delivery", () => {
    const config = resolveWalletRuntimeConfig({
      gold_coin_products: [
        { product_id: "unknown", gold_coin_amount: 99, order: 1 },
        { product_id: "com.bwchat.app.catfood.800", gold_coin_amount: 888, order: 2 },
      ],
      withdrawal_networks: [
        { network: "TRC20", enabled: true, minimum_usdt: 1, step_usdt: 0.25 },
        { network: "OFF", enabled: false, minimum_usdt: 0.1 },
      ],
      ad_reward_enabled: true,
      terms_screen_id: "legal_wallet_terms_v2",
      ad_reward: {
        reward_item: "gold_coin",
        ios_wallet_ad_unit_id: "ca-app-pub-1877504503518465/1011630693",
        ios_ad_unit_ids: ["ca-app-pub-1877504503518465/1011630693", "invalid"],
      },
    });
    expect(config.products).toEqual([
      { productId: "com.bwchat.app.catfood.800", coins: 888, fallbackPriceUsd: "$7.99" },
    ]);
    expect(config.withdrawalNetworks.map((item) => item.network)).toEqual(["TRC20"]);
    expect(withdrawalPolicyFor(config, "trc20")).toMatchObject({
      minimumUsdt: 1,
      stepUsdt: 0.25,
      usdtPerGoldCoin: 0.005,
    });
    expect(config).toMatchObject({
      adRewardEnabled: true,
      adRewardsGoldCoins: true,
      iosWalletAdUnitId: "ca-app-pub-1877504503518465/1011630693",
      termsScreenId: "legal_wallet_terms_v2",
    });
    expect(resolveWalletRuntimeConfig({ ad_reward_enabled: true }).adRewardsGoldCoins).toBe(false);
    expect(resolveWalletRuntimeConfig({}).termsScreenId).toBe("wallet_terms");
    expect(resolveWalletRuntimeConfig({ terms_screen_id: "../wallet" }).termsScreenId).toBe(
      "wallet_terms",
    );
  });

  it("matches native USDT normalization, minimum, step, maximum and coin rounding", () => {
    const policy = { usdtPerGoldCoin: 0.005, minimumUsdt: 0.5, stepUsdt: 0.5 };
    expect(normalizeWithdrawalUsdtText(",5")).toBe("0.50");
    expect(normalizeWithdrawalUsdtText("1.")).toBe("1.00");
    expect(normalizeWithdrawalUsdtText("1.234")).toBeUndefined();
    expect(maximumUsdtAmount(policy, 299)).toBe(1);
    expect(maximumUsdtAmount(policy, 99)).toBe(0);
    expect(canWithdraw(policy, 100)).toBe(true);
    expect(canWithdraw(policy, 99)).toBe(false);
    expect(requiredGoldCoins(policy, 1.01)).toBe(202);
    expect(isWalletPayoutAccountConfigured("TRC20", "T12345678901")).toBe(true);
    expect(isWalletPayoutAccountConfigured("TRC20", "short")).toBe(false);
    expect(walletWithdrawalErrorKey({ status: 404 })).toBe("wallet.withdrawal.serviceUnavailable");
    expect(
      walletWithdrawalErrorKey({ status: 400, payload: { code: "insufficient_gold_coins" } }),
    ).toBe("wallet.withdrawal.amount.insufficientGoldCoins");
    expect(
      walletWithdrawalErrorKey({ status: 400, message: '{"code":"invalid_usdt_account"}' }),
    ).toBe("wallet.usdt.invalid");
  });

  it("keeps reward credit pending until the same business day server counter decreases", () => {
    const pending = {
      userId: "u1",
      remainingBefore: 7,
      businessDayResetAt: 2_000,
      sessionExpiresAt: 3_000,
    };
    expect(pendingRewardResolution(pending, "u1", 7, 1_000)).toBe("pending");
    expect(pendingRewardResolution(pending, "u1", 6, 1_000)).toBe("confirmed");
    expect(pendingRewardResolution(pending, "u1", 6, 2_100)).toBe("pending");
    expect(pendingRewardResolution(pending, "other", 6, 1_000)).toBe("expired");
    expect(pendingRewardResolution(pending, "u1", undefined, 3_000)).toBe("expired");
  });

  it("uses the Shanghai reward day and native fixed wallet timestamp format", () => {
    const beforeShanghaiMidnight = Date.parse("2026-08-06T15:59:59.000Z");
    const afterShanghaiMidnight = Date.parse("2026-08-06T16:00:00.000Z");
    expect(shanghaiBusinessDay(beforeShanghaiMidnight)).toBe("2026-08-06");
    expect(shanghaiBusinessDay(afterShanghaiMidnight)).toBe("2026-08-07");
    expect(nextShanghaiMidnight(afterShanghaiMidnight)).toBe(
      Date.parse("2026-08-07T16:00:00.000Z"),
    );
    const formatted = formatWalletDetailedDateTime("2026-08-07 00:01:02");
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
    expect(formatted).toBe(formatWalletDetailedDateTime("2026-08-07T00:01:02Z"));
  });

  it("requires a complete nonnegative gold-coin balance and lossily drops wrong-currency records", () => {
    expect(normalizeWalletBalanceSnapshot(balance())).toEqual(balance());
    expect(() => normalizeWalletBalanceSnapshot({ ...balance(), currency: "cat_food" })).toThrow(
      "gold_coin",
    );
    expect(() => normalizeWalletBalanceSnapshot({ ...balance(), spendable_balance: -1 })).toThrow();
    expect(() =>
      normalizeWalletBalanceSnapshot({ currency: "gold_coin", gold_coin_balance: 1 }),
    ).toThrow();
    const page = normalizeWalletTransactionPage({
      items: [
        {
          id: "one",
          type: "ios_iap",
          currency: "gold_coin",
          product_id: "com.bwchat.app.catfood.100",
          amount: "100",
        },
        { id: "two", type: "gift_sent", currency: "cat_coin", cat_food_amount: 20 },
        { id: "bad", type: "gift_sent", currency: "usdt", amount: 3 },
      ],
      nextCursor: "page-2",
    });
    expect(page).toMatchObject({
      next_cursor: "page-2",
      transactions: [
        { id: "one", currency: "gold_coin", gold_coin_amount: 100 },
        { id: "two", currency: "gold_coin", gold_coin_amount: 20 },
      ],
    });
  });

  it("normalizes reward sessions, server status, withdrawals and IAP confirmation aliases", () => {
    expect(
      normalizeWalletAdRewardStatus({
        enabled: true,
        dailyLimit: 10,
        watchedCount: 3,
        remainingCount: 7,
        nextResetAt: "tomorrow",
      }),
    ).toEqual({
      enabled: true,
      daily_limit: 10,
      watched_count: 3,
      remaining_count: 7,
      next_reset_at: "tomorrow",
    });
    expect(
      normalizeWalletAdRewardSession({
        sessionId: "s",
        ssvCustomData: "signed",
        remainingCount: 4,
        expiresAt: "later",
        nextResetAt: "tomorrow",
      }),
    ).toEqual({
      session_id: "s",
      ssv_custom_data: "signed",
      remaining_count: 4,
      expires_at: "later",
      next_reset_at: "tomorrow",
    });
    expect(
      normalizeWalletWithdrawals({
        rows: [
          {
            withdrawalId: "w",
            currency: "gold_coin",
            goldCoinAmount: "100",
            payoutUSD: "0.5",
            chain: "TRC20",
            usdtAddress: "T123",
            status: "requested",
          },
          { id: "bad", currency: "cat_food", gold_coin_amount: 2 },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "w",
        gold_coin_amount: 100,
        payout_usd: 0.5,
        network: "TRC20",
        wallet_address: "T123",
      }),
    ]);
    expect(
      normalizeWalletIapConfirmation({
        walletBalance: balance({ gold_coin_balance: 1_100 }),
        amount: 100,
        walletTransaction: { id: "iap", type: "ios_iap", currency: "gold_coin", amount: 100 },
      }),
    ).toMatchObject({
      balance: { gold_coin_balance: 1_100 },
      gold_coin_amount: 100,
      transaction: { id: "iap" },
    });
  });

  it("deduplicates first-seen transactions and preserves the server cursor", () => {
    const current: WalletTransactionPage = {
      transactions: [{ id: "old", type: "gift_sent", currency: "gold_coin", gold_coin_amount: 2 }],
      next_cursor: "old-cursor",
    };
    const remote: WalletTransactionPage = {
      transactions: [
        { id: "new", type: "ios_iap", currency: "gold_coin", gold_coin_amount: 100 },
        { id: "old", type: "gift_sent", currency: "gold_coin", gold_coin_amount: 3 },
      ],
      next_cursor: "next",
    };
    expect(mergeWalletTransactionPages(remote, current)).toMatchObject({
      next_cursor: "next",
      transactions: [{ id: "new" }, { id: "old", gold_coin_amount: 3 }],
    });
    expect(
      deduplicateWalletTransactions([...remote.transactions, ...remote.transactions]).map(
        (item) => item.id,
      ),
    ).toEqual(["new", "old"]);
  });

  it("uses the native wallet endpoints and exact mutating request bodies", async () => {
    request
      .mockResolvedValueOnce(balance())
      .mockResolvedValueOnce({ items: [], next_cursor: "next" })
      .mockResolvedValueOnce({ withdrawals: [] })
      .mockResolvedValueOnce({
        withdrawal: { id: "w", currency: "gold_coin", gold_coin_amount: 100, status: "pending" },
      })
      .mockResolvedValueOnce({
        withdrawal: { id: "w", currency: "gold_coin", gold_coin_amount: 100, status: "cancelled" },
      })
      .mockResolvedValueOnce({
        enabled: true,
        daily_limit: 10,
        watched_count: 0,
        remaining_count: 10,
        next_reset_at: "tomorrow",
      })
      .mockResolvedValueOnce({
        session_id: "s",
        ssv_custom_data: "signed",
        remaining_count: 10,
        next_reset_at: "tomorrow",
      })
      .mockResolvedValueOnce({ balance: balance(), gold_coin_amount: 100 });
    await getWalletBalance();
    await getWalletTransactionPage({ cursor: "a/b", limit: 50 });
    await getWalletWithdrawals();
    await createWalletWithdrawal({
      goldCoinAmount: 100,
      usdtAmount: "0.50",
      network: "TRC20",
      walletAddress: "T-address",
    });
    await cancelWalletWithdrawal("w/a");
    await getWalletAdRewardStatus();
    await createWalletAdRewardSession({ adUnitId: "ca-app-pub-1/2", platform: "ios" });
    await confirmWalletIapPurchase({
      productId: "sku",
      transactionId: "txn",
      originalTransactionId: "original",
      signedPayload: "jws",
      purchaseDate: "2026-08-07T00:00:00.000Z",
      bundleId: "com.bwchat.app",
      appAccountToken: "account",
    });
    expect(request.mock.calls).toEqual([
      ["/wallet/balance", { requiredData: true, requiredEnvelope: true, timeoutMs: 60_000 }],
      [
        "/wallet/transactions?limit=50&cursor=a%2Fb",
        { cache: "no-store", requiredData: true, requiredEnvelope: true },
      ],
      ["/wallet/withdrawals", { requiredData: true, requiredEnvelope: true }],
      [
        "/wallet/withdrawals",
        {
          method: "POST",
          requiredEnvelope: true,
          body: {
            gold_coin_amount: 100,
            usdt_amount: "0.50",
            payout_method: "usdt",
            payout_account: "TRC20:T-address",
            network: "TRC20",
            wallet_address: "T-address",
          },
        },
      ],
      ["/wallet/withdrawals/w%2Fa/cancel", { method: "POST", body: {}, requiredEnvelope: true }],
      ["/wallet/ad-rewards/status", { requiredData: true, requiredEnvelope: true }],
      [
        "/wallet/ad-rewards/sessions",
        {
          method: "POST",
          requiredData: true,
          requiredEnvelope: true,
          body: { platform: "ios", ad_unit_id: "ca-app-pub-1/2", reward_item: "gold_coin" },
        },
      ],
      [
        "/wallet/ios-iap/confirm",
        {
          method: "POST",
          requiredData: true,
          requiredEnvelope: true,
          body: {
            platform: "ios",
            product_id: "sku",
            transaction_id: "txn",
            original_transaction_id: "original",
            signed_payload: "jws",
            signed_transaction_info: "jws",
            purchase_date: "2026-08-07T00:00:00.000Z",
            bundle_id: "com.bwchat.app",
            app_account_token: "account",
          },
        },
      ],
    ]);
  });
});
