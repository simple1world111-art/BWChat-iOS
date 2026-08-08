import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  localWalletAdRemaining,
  readPendingWalletAdReward,
  recordLocalWalletAdReward,
  removePendingWalletAdReward,
  savePendingWalletAdReward,
} from "@/services/wallet/WalletAdRewardStore";

describe("wallet rewarded ad account stores", () => {
  beforeEach(async () => AsyncStorage.clear());

  it("initializes and caps the ten-view local fallback per account", async () => {
    const timestamp = Date.parse("2026-08-07T10:00:00.000Z");
    expect(await localWalletAdRemaining("owner-a", timestamp)).toBe(10);
    for (let remaining = 9; remaining >= 0; remaining -= 1) {
      await recordLocalWalletAdReward("owner-a", timestamp);
      expect(await localWalletAdRemaining("owner-a", timestamp)).toBe(remaining);
    }
    await recordLocalWalletAdReward("owner-a", timestamp);
    expect(await localWalletAdRemaining("owner-a", timestamp)).toBe(0);
    expect(await localWalletAdRemaining("owner-b", timestamp)).toBe(10);
  });

  it("resets at Shanghai midnight and persists the new business day", async () => {
    const before = Date.parse("2026-08-07T15:59:59.000Z");
    const after = Date.parse("2026-08-07T16:00:00.000Z");
    await recordLocalWalletAdReward("owner", before);
    expect(await localWalletAdRemaining("owner", before)).toBe(9);
    expect(await localWalletAdRemaining("owner", after)).toBe(10);
    expect(JSON.parse((await AsyncStorage.getItem("bbchat.adReward.daily.owner"))!)).toEqual({
      day: "2026-08-08",
      watched: 0,
    });
  });

  it("round-trips pending SSV credit by account and rejects cross-account payloads", async () => {
    const pending = {
      userId: "owner-a",
      remainingBefore: 7,
      businessDayResetAt: 2_000,
      sessionExpiresAt: 3_000,
    };
    await savePendingWalletAdReward(pending);
    expect(await readPendingWalletAdReward("owner-a")).toEqual(pending);
    expect(await readPendingWalletAdReward("owner-b")).toBeUndefined();
    await removePendingWalletAdReward("owner-a");
    expect(await readPendingWalletAdReward("owner-a")).toBeUndefined();
  });

  it("fails open to the device allowance when storage is malformed", async () => {
    await AsyncStorage.setItem("bbchat.adReward.daily.owner", "not-json");
    expect(await localWalletAdRemaining("owner")).toBe(10);
  });
});
