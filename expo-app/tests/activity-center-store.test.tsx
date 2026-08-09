import { act, renderHook, waitFor } from "@testing-library/react-native";

import { APIError } from "@/api/client";
import { normalizeActivityCenterSnapshot } from "@/services/activity/ActivityModels";
import * as repository from "@/services/activity/ActivityCenterRepository";
import { useActivityCenter } from "@/services/activity/useActivityCenter";
import { clearNavigationSnapshots } from "@/services/navigation/NavigationSnapshotCache";
import { activitySnapshotWire } from "./fixtures/activityCenterFixture";

jest.mock("@/services/activity/ActivityCenterRepository", () => ({
  activityContactPhoneHashes: jest.fn(),
  activityIdempotencyKey: jest.fn(),
  claimActivityCheckIn: jest.fn(),
  claimActivityMeal: jest.fn(),
  clearActivityIdempotencyKey: jest.fn(),
  completeActivityInviteShareSession: jest.fn(),
  createActivityContactDiscoverySession: jest.fn(),
  createActivityInviteShareSession: jest.fn(),
  createActivityPhoneVerificationSession: jest.fn(),
  getActivityCenter: jest.fn(),
  isAmbiguousActivityError: (error: unknown) => {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : Number.NaN;
    return status === 0 || status === 408 || status >= 500;
  },
  loadCachedActivitySnapshot: jest.fn(),
  matchActivityContacts: jest.fn(),
  normalizeActivityPhone: jest.fn(),
  redeemActivityInvite: jest.fn(),
  saveCachedActivitySnapshot: jest.fn(),
  sendActivityFriendRequest: jest.fn(),
  spinActivityWheel: jest.fn(),
  verifyActivityPhone: jest.fn(),
}));

const snapshot = normalizeActivityCenterSnapshot(activitySnapshotWire);
const nextSnapshot = normalizeActivityCenterSnapshot({
  ...activitySnapshotWire,
  activity_cat_food_balance: 80,
  gold_coin_balance: 1_290,
  wheel: {
    ...activitySnapshotWire.wheel,
    current_tier: {
      ...activitySnapshotWire.wheel.current_tier,
      id: "tier_100",
      sequence: 3,
      cost_gold_coins: 100,
    },
  },
});
const verifiedSnapshot = normalizeActivityCenterSnapshot({
  ...activitySnapshotWire,
  phone_binding: {
    ...activitySnapshotWire.phone_binding,
    is_verified: true,
    masked_phone: "+81******5678",
  },
});
const unverifiedSnapshot = normalizeActivityCenterSnapshot({
  ...activitySnapshotWire,
  phone_binding: {
    ...activitySnapshotWire.phone_binding,
    is_verified: false,
    masked_phone: null,
  },
});
const invalidWheelSnapshot = normalizeActivityCenterSnapshot({
  ...activitySnapshotWire,
  wheel: {
    ...activitySnapshotWire.wheel,
    current_tier: {
      ...activitySnapshotWire.wheel.current_tier,
      segments: activitySnapshotWire.wheel.current_tier.segments.map((segment, index) =>
        index === 0 ? { ...segment, probability_ppm: segment.probability_ppm - 1 } : segment,
      ),
    },
  },
});
const shareSession = {
  id: "share-session",
  shareURL: "https://example.com/i/share-token",
  inviteCode: "MEOW88",
  message: "Join BWChat",
  expiresAt: "2026-08-08T12:00:00Z",
};

describe("useActivityCenter operation authority", () => {
  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    clearNavigationSnapshots();
    jest.clearAllMocks();
    jest.mocked(repository.loadCachedActivitySnapshot).mockResolvedValue(undefined);
    jest.mocked(repository.getActivityCenter).mockResolvedValue(snapshot);
    jest.mocked(repository.saveCachedActivitySnapshot).mockResolvedValue();
    jest.mocked(repository.activityIdempotencyKey).mockResolvedValue("same-key");
    jest.mocked(repository.clearActivityIdempotencyKey).mockResolvedValue();
    jest.mocked(repository.claimActivityCheckIn).mockResolvedValue({
      grantedActivityCatFood: 20,
      snapshot: nextSnapshot,
    });
    jest.mocked(repository.claimActivityMeal).mockResolvedValue({
      grantedActivityCatFood: 20,
      snapshot: nextSnapshot,
    });
    jest.mocked(repository.createActivityContactDiscoverySession).mockResolvedValue({
      id: "contact-session",
      salt: "salt",
      saltVersion: "v1",
      defaultRegion: "JP",
      maxContacts: 100,
      expiresAt: "2026-08-08T12:00:00Z",
    });
    jest.mocked(repository.activityContactPhoneHashes).mockResolvedValue(["phone-hash"]);
    jest.mocked(repository.matchActivityContacts).mockResolvedValue({
      matches: [{ userID: "friend-1", nickname: "M", avatarURL: "", relation: "none" }],
      grantedActivityCatFood: 100,
      snapshot: nextSnapshot,
    });
    jest.mocked(repository.createActivityInviteShareSession).mockResolvedValue(shareSession);
    jest.mocked(repository.completeActivityInviteShareSession).mockResolvedValue({
      grantedActivityCatFood: 10,
      snapshot: nextSnapshot,
    });
    jest.mocked(repository.redeemActivityInvite).mockResolvedValue(nextSnapshot);
    jest.mocked(repository.normalizeActivityPhone).mockReturnValue("+819012345678");
    jest.mocked(repository.createActivityPhoneVerificationSession).mockResolvedValue({
      id: "phone-session",
      expiresAt: "2026-08-08T12:00:00Z",
      retryAfterSeconds: 30,
    });
    jest.mocked(repository.verifyActivityPhone).mockResolvedValue(verifiedSnapshot);
    jest.mocked(repository.sendActivityFriendRequest).mockResolvedValue();
  });

  it("loads a server-authoritative account snapshot", async () => {
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() =>
      expect(result.current.snapshot?.configVersion).toBe(snapshot.configVersion),
    );
    expect(repository.getActivityCenter).toHaveBeenCalledTimes(1);
    expect(repository.saveCachedActivitySnapshot).toHaveBeenCalledWith("owner", snapshot);
  });

  it("restores the last activity snapshot before the remount refresh resolves", async () => {
    const first = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(first.result.current.snapshot).toEqual(snapshot));
    await first.unmount();

    const restored = await renderHook(() => useActivityCenter("owner"));

    expect(restored.result.current.snapshot).toEqual(snapshot);
    expect(restored.result.current.isLoading).toBe(false);
    await restored.unmount();
  });

  it("shows an optimistic check-in immediately and keeps it on an ambiguous 5xx", async () => {
    let rejectRequest: ((reason: unknown) => void) | undefined;
    jest.mocked(repository.claimActivityCheckIn).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    let request: Promise<void>;
    await act(async () => {
      request = result.current.claimCheckIn();
      await Promise.resolve();
    });
    expect(result.current.snapshot?.activityCatFoodBalance).toBe(80);
    expect(result.current.rewardCelebration?.amount).toBe(20);
    await act(async () => {
      rejectRequest?.(new APIError("server", 503));
      await request!;
    });
    expect(result.current.snapshot?.activityCatFoodBalance).toBe(80);
    expect(repository.clearActivityIdempotencyKey).not.toHaveBeenCalled();
  });

  it("commits the server-authoritative check-in and clears its retained key", async () => {
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => {
      await result.current.claimCheckIn();
    });
    expect(repository.activityIdempotencyKey).toHaveBeenCalledWith("owner", "check-in");
    expect(repository.claimActivityCheckIn).toHaveBeenCalledWith("same-key");
    expect(repository.clearActivityIdempotencyKey).toHaveBeenCalledWith("owner", "check-in");
    expect(result.current.snapshot?.activityCatFoodBalance).toBe(80);
    expect(result.current.rewardCelebration?.amount).toBe(20);
  });

  it("rolls an optimistic meal back and clears its key on a definite 400", async () => {
    jest.mocked(repository.claimActivityMeal).mockRejectedValue(new APIError("not claimable", 400));
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    const lunch = result.current.snapshot?.mealRewards.find((meal) => meal.id === "lunch");
    await act(async () => {
      await result.current.claimMeal(lunch!);
    });
    expect(result.current.snapshot?.activityCatFoodBalance).toBe(60);
    expect(result.current.snapshot?.mealRewards.find((meal) => meal.id === "lunch")?.status).toBe(
      "claimable",
    );
    expect(repository.clearActivityIdempotencyKey).toHaveBeenCalledWith("owner", "meal.lunch");
  });

  it("commits one server-authoritative meal claim with its window-scoped key", async () => {
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    const lunch = result.current.snapshot?.mealRewards.find((meal) => meal.id === "lunch");
    await act(async () => {
      await result.current.claimMeal(lunch!);
    });
    expect(repository.activityIdempotencyKey).toHaveBeenCalledWith("owner", "meal.lunch");
    expect(repository.claimActivityMeal).toHaveBeenCalledWith("lunch", "same-key");
    expect(repository.clearActivityIdempotencyKey).toHaveBeenCalledWith("owner", "meal.lunch");
    expect(result.current.snapshot?.activityCatFoodBalance).toBe(80);
  });

  it("single-flights a meal and keeps its optimistic state and key on an ambiguous 5xx", async () => {
    let rejectRequest: ((reason: unknown) => void) | undefined;
    jest.mocked(repository.claimActivityMeal).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    const lunch = result.current.snapshot?.mealRewards.find((meal) => meal.id === "lunch");
    let first: Promise<void>;
    let duplicate: Promise<void>;
    await act(async () => {
      first = result.current.claimMeal(lunch!);
      duplicate = result.current.claimMeal(lunch!);
      await Promise.resolve();
      await Promise.resolve();
    });
    await duplicate!;
    expect(repository.claimActivityMeal).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot?.activityCatFoodBalance).toBe(80);
    expect(result.current.snapshot?.mealRewards.find((meal) => meal.id === "lunch")?.status).toBe(
      "claimed",
    );
    await act(async () => {
      rejectRequest?.(new APIError("server", 503));
      await first!;
    });
    expect(repository.clearActivityIdempotencyKey).not.toHaveBeenCalledWith("owner", "meal.lunch");
    expect(result.current.snapshot?.activityCatFoodBalance).toBe(80);
    expect(result.current.isRunning("meal:lunch")).toBe(false);
  });

  it("defers the authoritative next-tier wheel snapshot until the full animation finishes", async () => {
    jest.mocked(repository.spinActivityWheel).mockResolvedValue({
      result: {
        spinID: "spin",
        tierID: "tier_10",
        costGoldCoins: 10,
        prizeID: "p20",
        payoutGoldCoins: 20,
        netDeltaGoldCoins: 10,
        nextTierID: "tier_100",
      },
      snapshot: nextSnapshot,
    });
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => {
      await result.current.spinWheel();
    });
    expect(result.current.snapshot?.wheel.currentTier.id).toBe("tier_10");
    expect(result.current.isRunning("wheel")).toBe(true);
    await act(async () => {
      result.current.finishSpinAnimation();
    });
    expect(result.current.snapshot?.wheel.currentTier.id).toBe("tier_100");
    expect(result.current.snapshot?.goldCoinBalance).toBe(1_290);
  });

  it("refuses an invalid wheel configuration before creating a retained key", async () => {
    jest.mocked(repository.getActivityCenter).mockResolvedValue(invalidWheelSnapshot);
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() =>
      expect(result.current.snapshot?.configVersion).toBe(invalidWheelSnapshot.configVersion),
    );
    await act(async () => {
      expect(await result.current.spinWheel()).toBeUndefined();
    });
    expect(result.current.errorMessage).toBe("activityCenter.error.wheelConfig");
    expect(repository.activityIdempotencyKey).not.toHaveBeenCalledWith("owner", "wheel");
    expect(repository.spinActivityWheel).not.toHaveBeenCalled();
  });

  it("clears a wheel key and releases the gate after a definite 400", async () => {
    jest.mocked(repository.spinActivityWheel).mockRejectedValue(new APIError("rejected", 400));
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => {
      expect(await result.current.spinWheel()).toBeUndefined();
    });
    expect(repository.clearActivityIdempotencyKey).toHaveBeenCalledWith("owner", "wheel");
    expect(result.current.isRunning("wheel")).toBe(false);
  });

  it("retains a wheel key but releases the gate after an ambiguous 5xx", async () => {
    jest.mocked(repository.spinActivityWheel).mockRejectedValue(new APIError("server", 503));
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => {
      expect(await result.current.spinWheel()).toBeUndefined();
    });
    expect(repository.clearActivityIdempotencyKey).not.toHaveBeenCalledWith("owner", "wheel");
    expect(result.current.isRunning("wheel")).toBe(false);
  });

  it("refuses contact discovery before session creation when the phone is unverified", async () => {
    jest.mocked(repository.getActivityCenter).mockResolvedValue(unverifiedSnapshot);
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => {
      expect(await result.current.discoverContacts()).toBe(false);
    });
    expect(result.current.errorMessage).toBe("activityCenter.error.phoneRequired");
    expect(repository.createActivityContactDiscoverySession).not.toHaveBeenCalled();
    expect(repository.activityIdempotencyKey).not.toHaveBeenCalledWith("owner", "contacts");
  });

  it("does not clear a retained contact-match key when session creation fails before matching", async () => {
    jest
      .mocked(repository.createActivityContactDiscoverySession)
      .mockRejectedValue(new APIError("session rejected", 400));
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => {
      await result.current.discoverContacts();
    });
    expect(repository.activityIdempotencyKey).not.toHaveBeenCalledWith("owner", "contacts");
    expect(repository.clearActivityIdempotencyKey).not.toHaveBeenCalledWith("owner", "contacts");
  });

  it("does not create a contact-match key when local permission or hashing fails", async () => {
    jest
      .mocked(repository.activityContactPhoneHashes)
      .mockRejectedValue(new Error("activityCenter.error.contactsDenied"));
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => {
      expect(await result.current.discoverContacts()).toBe(false);
    });
    expect(result.current.errorMessage).toBe("activityCenter.error.contactsDenied");
    expect(repository.activityIdempotencyKey).not.toHaveBeenCalledWith("owner", "contacts");
    expect(repository.matchActivityContacts).not.toHaveBeenCalled();
    expect(repository.clearActivityIdempotencyKey).not.toHaveBeenCalledWith("owner", "contacts");
  });

  it.each([
    { status: 400, shouldClear: true, label: "definite" },
    { status: 503, shouldClear: false, label: "ambiguous" },
  ])(
    "handles a $label contact-match failure without publishing matches",
    async ({ status, shouldClear }) => {
      jest
        .mocked(repository.matchActivityContacts)
        .mockRejectedValue(new APIError("match failed", status));
      const { result } = await renderHook(() => useActivityCenter("owner"));
      await waitFor(() => expect(result.current.snapshot).toBeDefined());
      await act(async () => {
        expect(await result.current.discoverContacts()).toBe(false);
      });
      expect(repository.clearActivityIdempotencyKey).toHaveBeenCalledTimes(shouldClear ? 1 : 0);
      expect(result.current.matchedUsers).toEqual([]);
      expect(result.current.isRunning("contacts")).toBe(false);
    },
  );

  it("does not publish an old account's contact result after the owner changes", async () => {
    let resolveMatch:
      ((value: Awaited<ReturnType<typeof repository.matchActivityContacts>>) => void) | undefined;
    jest.mocked(repository.matchActivityContacts).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMatch = resolve;
        }),
    );
    jest
      .mocked(repository.getActivityCenter)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(nextSnapshot);
    const { result, rerender } = await renderHook(
      ({ owner }: { owner: string }) => useActivityCenter(owner),
      { initialProps: { owner: "owner-a" } },
    );
    await waitFor(() => expect(result.current.snapshot?.activityCatFoodBalance).toBe(60));
    let discovery: Promise<boolean>;
    await act(async () => {
      discovery = result.current.discoverContacts();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(repository.matchActivityContacts).toHaveBeenCalledTimes(1));
    await act(async () => {
      rerender({ owner: "owner-b" });
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.snapshot?.activityCatFoodBalance).toBe(80));
    await act(async () => {
      resolveMatch?.({
        matches: [{ userID: "old-owner-friend", nickname: "Old", avatarURL: "", relation: "none" }],
        grantedActivityCatFood: 100,
        snapshot,
      });
      await expect(discovery!).resolves.toBe(false);
    });
    expect(result.current.snapshot?.activityCatFoodBalance).toBe(80);
    expect(result.current.matchedUsers).toEqual([]);
    expect(result.current.rewardCelebration).toBeUndefined();
  });

  it("hashes and matches contacts once, then publishes matches, reward and server snapshot", async () => {
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => {
      expect(await result.current.discoverContacts()).toBe(true);
    });
    expect(repository.activityContactPhoneHashes).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "contact-session",
        saltVersion: "v1",
      }),
    );
    expect(repository.matchActivityContacts).toHaveBeenCalledWith(
      "contact-session",
      "v1",
      ["phone-hash"],
      "same-key",
    );
    expect(repository.clearActivityIdempotencyKey).toHaveBeenCalledWith("owner", "contacts");
    expect(result.current.matchedUsers).toEqual([
      { userID: "friend-1", nickname: "M", avatarURL: "", relation: "none" },
    ]);
    expect(result.current.rewardCelebration?.amount).toBe(100);
  });

  it("creates and completes an invite share with a session-scoped retained key", async () => {
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    let session: typeof shareSession | undefined;
    await act(async () => {
      session = await result.current.createShareSession();
    });
    expect(session).toEqual(shareSession);
    await act(async () => {
      await result.current.completeShare(session!.id);
    });
    expect(repository.activityIdempotencyKey).toHaveBeenCalledWith("owner", "share.share-session");
    expect(repository.completeActivityInviteShareSession).toHaveBeenCalledWith(
      "share-session",
      "same-key",
    );
    expect(repository.clearActivityIdempotencyKey).toHaveBeenCalledWith(
      "owner",
      "share.share-session",
    );
    expect(result.current.rewardCelebration?.amount).toBe(10);
  });

  it("trims and redeems one invite while rejecting blank input without a request", async () => {
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => {
      expect(await result.current.redeemInvite("   ")).toBe(false);
    });
    expect(repository.redeemActivityInvite).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBe("activityCenter.error.invalidInvite");
    await act(async () => {
      expect(await result.current.redeemInvite("  MEOW88  ")).toBe(true);
    });
    expect(repository.redeemActivityInvite).toHaveBeenCalledWith("MEOW88", "same-key");
    expect(repository.clearActivityIdempotencyKey).toHaveBeenCalledWith("owner", "redeem");
  });

  it("requests and verifies a phone code with a verification-session-scoped key", async () => {
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => {
      expect(await result.current.requestPhoneCode(" 090-1234-5678 ", "JP")).toBe(true);
    });
    expect(repository.normalizeActivityPhone).toHaveBeenCalledWith(" 090-1234-5678 ", "JP");
    expect(repository.createActivityPhoneVerificationSession).toHaveBeenCalledWith("+819012345678");
    expect(result.current.phoneVerificationSession?.id).toBe("phone-session");
    await act(async () => {
      expect(await result.current.verifyPhone(" 123456 ")).toBe(true);
    });
    expect(repository.activityIdempotencyKey).toHaveBeenCalledWith(
      "owner",
      "verify-phone.phone-session",
    );
    expect(repository.verifyActivityPhone).toHaveBeenCalledWith(
      "phone-session",
      "123456",
      "same-key",
    );
    expect(result.current.phoneVerificationSession).toBeUndefined();
    expect(result.current.snapshot?.phoneBinding.isVerified).toBe(true);
  });

  it("single-flights phone verification and clears only a definitely failed session key", async () => {
    let rejectVerification: ((reason: unknown) => void) | undefined;
    jest.mocked(repository.verifyActivityPhone).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectVerification = reject;
        }),
    );
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => {
      expect(await result.current.requestPhoneCode("090-1234-5678", "JP")).toBe(true);
    });
    let first: Promise<boolean>;
    let duplicate: Promise<boolean>;
    await act(async () => {
      first = result.current.verifyPhone("123456");
      duplicate = result.current.verifyPhone("123456");
      await Promise.resolve();
      await Promise.resolve();
    });
    await expect(duplicate!).resolves.toBe(false);
    expect(repository.verifyActivityPhone).toHaveBeenCalledTimes(1);
    await act(async () => {
      rejectVerification?.(new APIError("bad code", 400));
      await expect(first!).resolves.toBe(false);
    });
    expect(repository.clearActivityIdempotencyKey).toHaveBeenCalledWith(
      "owner",
      "verify-phone.phone-session",
    );
    expect(result.current.phoneVerificationSession?.id).toBe("phone-session");
    expect(result.current.isRunning("verify-phone")).toBe(false);
  });

  it("retains the phone verification session and key after an ambiguous 5xx", async () => {
    jest.mocked(repository.verifyActivityPhone).mockRejectedValue(new APIError("server", 503));
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => {
      expect(await result.current.requestPhoneCode("090-1234-5678", "JP")).toBe(true);
      expect(await result.current.verifyPhone("123456")).toBe(false);
    });
    expect(repository.clearActivityIdempotencyKey).not.toHaveBeenCalledWith(
      "owner",
      "verify-phone.phone-session",
    );
    expect(result.current.phoneVerificationSession?.id).toBe("phone-session");
  });

  it("single-flights each matched-user friend request and releases it after success", async () => {
    let resolveRequest: (() => void) | undefined;
    jest.mocked(repository.sendActivityFriendRequest).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    const user = { userID: "friend-1", nickname: "M", avatarURL: "", relation: "none" };
    let first: Promise<boolean>;
    let second: Promise<boolean>;
    await act(async () => {
      first = result.current.sendFriendRequest(user);
      second = result.current.sendFriendRequest(user);
      await Promise.resolve();
    });
    expect(result.current.isRunning("friend:friend-1")).toBe(true);
    expect(repository.sendActivityFriendRequest).toHaveBeenCalledTimes(1);
    await expect(second!).resolves.toBe(false);
    await act(async () => {
      resolveRequest?.();
      await expect(first!).resolves.toBe(true);
    });
    expect(result.current.isRunning("friend:friend-1")).toBe(false);
  });

  it("releases a failed friend request so the same matched user can be retried", async () => {
    jest
      .mocked(repository.sendActivityFriendRequest)
      .mockRejectedValueOnce(new APIError("rejected", 400))
      .mockResolvedValueOnce();
    const { result } = await renderHook(() => useActivityCenter("owner"));
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    const user = { userID: "friend-1", nickname: "M", avatarURL: "", relation: "none" };
    await act(async () => {
      expect(await result.current.sendFriendRequest(user)).toBe(false);
    });
    expect(result.current.isRunning("friend:friend-1")).toBe(false);
    await act(async () => {
      expect(await result.current.sendFriendRequest(user)).toBe(true);
    });
    expect(repository.sendActivityFriendRequest).toHaveBeenCalledTimes(2);
  });
});
