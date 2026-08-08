import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const originalRoot = "/Users/wegpt.com/Desktop/BWChat-iOS/BWChat";
const copiedRoot = "/Users/wegpt.com/Desktop/BWChat-Expo-HotUpdate/BWChat";
const expoRoot = resolve(__dirname, "..");

describe("locked Swift to Expo wallet source parity", () => {
  it("locks matching untouched original and desktop-copy wallet fact sources", () => {
    const sources: Readonly<Record<string, string>> = {
      "Views/WalletView.swift": "4d8208be25e0bdc19b0fd7631b50c23d78c43e796e91686653e5e21f80f70920",
      "Services/WalletStore.swift":
        "cbc20644b9619fd707cf3372265af42e13528f5dcc2d3924455351af66b3cbe6",
      "Services/APIService.swift":
        "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274",
      "Services/CacheRepository.swift":
        "530f9734eeb9fdc8aeafc3e5430d5eae876754462372bb3c05c9b830526f0b66",
      "Models/Gift.swift": "62961899ae81d7d7f16438fbd61a42ca44f6b2eb21227bd21b7b51f5f6b28fd1",
      "Models/DynamicConfigModels.swift":
        "8a09512ab3e119ac63499fae8aafd0f69c6d1dbc6489d97979bc7c29e3726803",
    };
    for (const [file, expected] of Object.entries(sources)) {
      expect(hash(readFileSync(resolve(originalRoot, file)))).toBe(expected);
      expect(hash(readFileSync(resolve(copiedRoot, file)))).toBe(expected);
    }
  });

  it("keeps all four wallet images byte-for-byte identical across both Swift trees and Expo", () => {
    const assets: Readonly<Record<string, string>> = {
      "wallet_cat_hair.imageset/wallet_cat_hair.png":
        "5fa8c4b7280de9c11eb80d31f449b6a0e7d72ee686fe3bd049d3ee71d5c986bd",
      "wallet_empty_cat.imageset/wallet_empty_cat.png":
        "44bba6bc806bf2d633984dec2cbd4c8c02d319807feb71bca3523f0ae8ad5bb2",
      "wallet_gold_coin_background.imageset/wallet_gold_coin_background.jpg":
        "4fcf09b09c2c0ffa96e748dace4540ab486ae6de59713f53e8127ecaf2fe5142",
      "wallet_gold_coin_badge.imageset/wallet_gold_coin_badge.png":
        "8685a0a49e36af5d3bd426d21a3b983b2929d5dc0ffcb3333d4b3b46e1b776b2",
    };
    for (const [asset, expected] of Object.entries(assets)) {
      const nativePath = `Assets.xcassets/${asset}`;
      const expoPath = `assets/native-original/Assets.xcassets/${asset}`;
      expect(hash(readFileSync(resolve(originalRoot, nativePath)))).toBe(expected);
      expect(hash(readFileSync(resolve(copiedRoot, nativePath)))).toBe(expected);
      expect(hash(readFileSync(resolve(expoRoot, expoPath)))).toBe(expected);
    }
    const registry = expo("src/assets/nativeAssets.ts");
    expect(registry).toContain("walletCatHair:");
    expect(registry).toContain("walletEmptyCat:");
    expect(registry).toContain("walletGoldCoinBackground:");
    expect(registry).toContain("walletGoldCoinBadge:");
  });

  it("keeps the complete balance, transaction, activity, withdrawal, ad and IAP route family", () => {
    const api = expo("src/api/bwchat.ts");
    for (const route of [
      '"/wallet/balance"',
      "`/wallet/transactions?${query.toString()}`",
      "`/wallet/activity-cat-food/transactions?${query.toString()}`",
      '"/wallet/withdrawals"',
      "`/wallet/withdrawals/${encodeURIComponent(id)}/cancel`",
      '"/wallet/ad-rewards/status"',
      '"/wallet/ad-rewards/sessions"',
      '"/wallet/ios-iap/confirm"',
    ]) {
      expect(api).toContain(route);
    }
    expect(api).toContain("limit: String(Math.min(Math.max(options.limit ?? 50, 1), 100))");
    expect(api).toContain("limit: String(Math.min(Math.max(options.limit ?? 20, 1), 50))");
    expect(api).toContain('reward_item: "gold_coin"');
    expect(api).toContain("signed_transaction_info: input.signedPayload");
    expect(api).toContain('payout_method: "usdt"');
    expect(api).not.toContain("requiredSuccessCode: true");
  });

  it("preserves native cache, account, paging and mutation semantics in the Expo state machine", () => {
    const repository = expo("src/services/wallet/WalletRepository.ts");
    const provider = expo("src/providers/WalletProvider.tsx");
    const policy = expo("src/services/wallet/walletPolicy.ts");
    expect(policy).toContain("balanceCacheTtlMs: 30_000");
    expect(policy).toContain("listCacheTtlMs: 120_000");
    expect(policy).toContain("staleRetentionMs: 30 * 24 * 60 * 60 * 1_000");
    expect(policy).toContain("maxCachedWithdrawals: 500");
    expect(repository).toContain("Date.now() - envelope.savedAt < ttlMs");
    expect(repository).toContain("ttlMs + walletMetrics.staleRetentionMs");
    expect(repository).toContain("inFlightLoads");
    expect(repository).toContain("WalletRepositoryAccountChangedError");
    expect(repository).toContain("void refreshTransactionCache(ownerId, cached.value, guard)");
    expect(provider).toContain("readCachedWalletBalance(ownerId)");
    expect(provider).toContain("requestedCursors.current.has(nextCursor)");
    expect(provider).toContain("validateWithdrawalInput(input, balance, runtime, t)");
    expect(provider).toContain("await Promise.all([refreshBalance(), refreshWithdrawals()])");
  });

  it("preserves current-versus-background StoreKit delivery and all three wallet screens", () => {
    const purchase = expo("src/services/wallet/useWalletPurchases.ts");
    expect(purchase).toContain("expectedProduct.current === purchase.productId");
    expect(purchase).toContain("await isTransactionVerifiedIOS(purchase.productId)");
    expect(purchase).toContain("await refreshBalance(true)");
    expect(purchase).toContain("await finishTransaction({ purchase, isConsumable: true })");
    expect(purchase).toContain("if (presentsOutcome)");
    for (const route of [
      "src/app/wallet.tsx",
      "src/app/wallet-transactions.tsx",
      "src/app/wallet-withdrawals.tsx",
    ]) {
      expect(existsSync(resolve(expoRoot, route))).toBe(true);
    }
    expect(expo("src/app/wallet-transactions.tsx")).toContain(
      "if (!error && !loading) void retry()",
    );
  });
});

function expo(path: string): string {
  return readFileSync(resolve(expoRoot, path), "utf8");
}

function hash(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}
