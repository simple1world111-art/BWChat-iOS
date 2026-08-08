import { act, renderHook, waitFor } from "@testing-library/react-native";

import { normalizeActivityCenterSnapshot } from "@/services/activity/ActivityModels";
import * as repository from "@/services/activity/ActivityCenterRepository";
import { useActivityCenter } from "@/services/activity/useActivityCenter";
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
  isAmbiguousActivityError: jest.fn(() => false),
  loadCachedActivitySnapshot: jest.fn(),
  matchActivityContacts: jest.fn(),
  normalizeActivityPhone: jest.fn(),
  redeemActivityInvite: jest.fn(),
  saveCachedActivitySnapshot: jest.fn(),
  sendActivityFriendRequest: jest.fn(),
  spinActivityWheel: jest.fn(),
  verifyActivityPhone: jest.fn(),
}));

function activitySnapshot(balance: number) {
  return normalizeActivityCenterSnapshot({
    ...activitySnapshotWire,
    activity_cat_food_balance: balance,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("ActivityCenter lifecycle and ABA isolation", () => {
  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(repository.loadCachedActivitySnapshot).mockResolvedValue(undefined);
    jest.mocked(repository.saveCachedActivitySnapshot).mockResolvedValue();
    jest.mocked(repository.activityIdempotencyKey).mockResolvedValue("stable-key");
    jest.mocked(repository.clearActivityIdempotencyKey).mockResolvedValue();
  });

  it("continues to the authoritative network load when account cache reading fails", async () => {
    jest.mocked(repository.loadCachedActivitySnapshot).mockRejectedValue(new Error("storage"));
    jest.mocked(repository.getActivityCenter).mockResolvedValue(activitySnapshot(90));

    const { result } = await renderHook(() => useActivityCenter("owner-a"));
    await waitFor(() => expect(result.current.snapshot?.activityCatFoodBalance).toBe(90));

    expect(repository.getActivityCenter).toHaveBeenCalledTimes(1);
    expect(result.current.errorMessage).toBeUndefined();
    expect(result.current.isShowingCachedData).toBe(false);
  });

  it("rejects a late initial A load after A to B to A creates a new A generation", async () => {
    const oldA = deferred<ReturnType<typeof activitySnapshot>>();
    const ownerB = deferred<ReturnType<typeof activitySnapshot>>();
    const newA = deferred<ReturnType<typeof activitySnapshot>>();
    jest
      .mocked(repository.getActivityCenter)
      .mockImplementationOnce(() => oldA.promise)
      .mockImplementationOnce(() => ownerB.promise)
      .mockImplementationOnce(() => newA.promise);

    const { result, rerender } = await renderHook(
      ({ owner }: { owner: string }) => useActivityCenter(owner),
      { initialProps: { owner: "owner-a" } },
    );
    await waitFor(() => expect(repository.getActivityCenter).toHaveBeenCalledTimes(1));

    await rerender({ owner: "owner-b" });
    await waitFor(() => expect(repository.getActivityCenter).toHaveBeenCalledTimes(2));
    await act(async () => ownerB.resolve(activitySnapshot(200)));
    await waitFor(() => expect(result.current.snapshot?.activityCatFoodBalance).toBe(200));

    await rerender({ owner: "owner-a" });
    await waitFor(() => expect(repository.getActivityCenter).toHaveBeenCalledTimes(3));
    await act(async () => newA.resolve(activitySnapshot(300)));
    await waitFor(() => expect(result.current.snapshot?.activityCatFoodBalance).toBe(300));

    await act(async () => oldA.resolve(activitySnapshot(100)));
    expect(result.current.snapshot?.activityCatFoodBalance).toBe(300);
    expect(result.current.isLoading).toBe(false);
    expect(repository.saveCachedActivitySnapshot).not.toHaveBeenCalledWith(
      "owner-a",
      activitySnapshot(100),
    );
  });

  it("does not let an old A mutation response or finally release the new A operation", async () => {
    jest.mocked(repository.getActivityCenter).mockResolvedValue(activitySnapshot(60));
    const oldClaim = deferred<Awaited<ReturnType<typeof repository.claimActivityCheckIn>>>();
    const newClaim = deferred<Awaited<ReturnType<typeof repository.claimActivityCheckIn>>>();
    jest
      .mocked(repository.claimActivityCheckIn)
      .mockImplementationOnce(() => oldClaim.promise)
      .mockImplementationOnce(() => newClaim.promise);

    const { result, rerender } = await renderHook(
      ({ owner }: { owner: string }) => useActivityCenter(owner),
      { initialProps: { owner: "owner-a" } },
    );
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    let oldRequest!: Promise<void>;
    await act(async () => {
      oldRequest = result.current.claimCheckIn();
      await Promise.resolve();
    });
    await waitFor(() => expect(repository.claimActivityCheckIn).toHaveBeenCalledTimes(1));

    await rerender({ owner: "owner-b" });
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await rerender({ owner: "owner-a" });
    await waitFor(() => expect(result.current.snapshot?.activityCatFoodBalance).toBe(60));

    let currentRequest!: Promise<void>;
    await act(async () => {
      currentRequest = result.current.claimCheckIn();
      await Promise.resolve();
    });
    await waitFor(() => expect(repository.claimActivityCheckIn).toHaveBeenCalledTimes(2));
    expect(result.current.isRunning("check-in")).toBe(true);

    await act(async () => {
      oldClaim.resolve({ grantedActivityCatFood: 20, snapshot: activitySnapshot(100) });
      await oldRequest;
    });
    expect(result.current.snapshot?.activityCatFoodBalance).toBe(80);
    expect(result.current.isRunning("check-in")).toBe(true);
    expect(repository.clearActivityIdempotencyKey).not.toHaveBeenCalled();

    await act(async () => {
      newClaim.resolve({ grantedActivityCatFood: 20, snapshot: activitySnapshot(300) });
      await currentRequest;
    });
    expect(result.current.snapshot?.activityCatFoodBalance).toBe(300);
    expect(result.current.isRunning("check-in")).toBe(false);
    expect(repository.clearActivityIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it("cannot complete a share session created by an earlier account generation", async () => {
    jest.mocked(repository.getActivityCenter).mockResolvedValue(activitySnapshot(60));
    jest.mocked(repository.createActivityInviteShareSession).mockResolvedValue({
      id: "old-share",
      shareURL: "https://example.com/i/old-share",
      inviteCode: "MEOW88",
      message: "Join BWChat",
      expiresAt: "2026-08-08T12:00:00Z",
    });

    const { result, rerender } = await renderHook(
      ({ owner }: { owner: string }) => useActivityCenter(owner),
      { initialProps: { owner: "owner-a" } },
    );
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => expect(await result.current.createShareSession()).toBeDefined());

    await rerender({ owner: "owner-b" });
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await rerender({ owner: "owner-a" });
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    await act(async () => result.current.completeShare("old-share"));

    expect(repository.activityIdempotencyKey).not.toHaveBeenCalledWith(
      "owner-a",
      "share.old-share",
    );
    expect(repository.completeActivityInviteShareSession).not.toHaveBeenCalled();
  });
});
