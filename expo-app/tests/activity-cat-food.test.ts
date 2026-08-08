import { getActivityCatFoodTransactionPage } from "@/api/bwchat";
import { APIError, apiRequest } from "@/api/client";
import {
  normalizeActivityCatFoodTransaction,
  normalizeActivityCatFoodTransactionPage,
} from "@/api/normalizers";
import {
  activityCatFoodLocalizedTitleKey,
  activityCatFoodTransactionPageSize,
  activityCatFoodTransactionPresentation,
  appendActivityCatFoodTransactionPage,
  isActivityCatFoodConfigured,
  isActivityCatFoodDisabledError,
  loadActivityCatFoodTransactionPage,
  shouldLoadNextActivityCatFoodPage,
} from "@/services/wallet/ActivityCatFoodRepository";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, apiRequest: jest.fn() };
});

const request = jest.mocked(apiRequest);
const t = (key: string, ...args: (string | number)[]) => [key, ...args].join("|");

describe("activity cat-food parity", () => {
  beforeEach(() => request.mockReset());

  it("normalizes the native snake/camel transaction aliases and both page containers", () => {
    expect(
      normalizeActivityCatFoodTransaction({
        transactionId: 8,
        delta: "-3",
        balanceAfter: "17",
        source: "meal_reward",
        title: "Lunch",
        createdAt: "2026-08-07T01:02:03Z",
      }),
    ).toEqual({
      id: "8",
      delta: -3,
      balance_after: 17,
      source: "meal_reward",
      title: "Lunch",
      created_at: "2026-08-07T01:02:03Z",
    });
    expect(
      normalizeActivityCatFoodTransactionPage({
        data: { transactions: [{ id: "one", delta: 2, balance_after: 9 }], nextCursor: "next" },
      }),
    ).toEqual({ items: [{ id: "one", delta: 2, balance_after: 9 }], next_cursor: "next" });
  });

  it("uses the exact native no-cache endpoint, 20-row page size, cursor encoding, and 1...50 clamp", async () => {
    request
      .mockResolvedValueOnce({ items: [], next_cursor: "two" })
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [] });
    await loadActivityCatFoodTransactionPage(" a/b ");
    await getActivityCatFoodTransactionPage({ limit: 500 });
    await getActivityCatFoodTransactionPage({ limit: 0 });
    expect(activityCatFoodTransactionPageSize).toBe(20);
    expect(request.mock.calls).toEqual([
      [
        "/wallet/activity-cat-food/transactions?limit=20&cursor=a%2Fb",
        { cache: "no-store", requiredData: true, requiredEnvelope: true },
      ],
      [
        "/wallet/activity-cat-food/transactions?limit=50",
        { cache: "no-store", requiredData: true, requiredEnvelope: true },
      ],
      [
        "/wallet/activity-cat-food/transactions?limit=1",
        { cache: "no-store", requiredData: true, requiredEnvelope: true },
      ],
    ]);
  });

  it("deduplicates first-seen rows and rejects a repeated cursor", () => {
    expect(
      appendActivityCatFoodTransactionPage(
        { items: [{ id: "one", delta: 1, balance_after: 1 }], next_cursor: "same" },
        {
          items: [
            { id: "one", delta: 9, balance_after: 9 },
            { id: "two", delta: 2, balance_after: 3 },
          ],
          next_cursor: "same",
        },
      ),
    ).toEqual({
      items: [
        { id: "one", delta: 1, balance_after: 1 },
        { id: "two", delta: 2, balance_after: 3 },
      ],
    });
  });

  it("loads the next page when the last native-style row is visible, including short first pages", () => {
    expect(
      shouldLoadNextActivityCatFoodPage({
        contentHeight: 500,
        contentOffsetY: 0,
        hasNextPage: true,
        isLoading: false,
        viewportHeight: 700,
      }),
    ).toBe(true);
    expect(
      shouldLoadNextActivityCatFoodPage({
        contentHeight: 1_500,
        contentOffsetY: 500,
        hasNextPage: true,
        isLoading: false,
        viewportHeight: 500,
      }),
    ).toBe(false);
    expect(
      shouldLoadNextActivityCatFoodPage({
        contentHeight: 1_500,
        contentOffsetY: 900,
        hasNextPage: true,
        isLoading: false,
        viewportHeight: 500,
      }),
    ).toBe(true);
    expect(
      shouldLoadNextActivityCatFoodPage({
        contentHeight: 500,
        contentOffsetY: 0,
        hasNextPage: true,
        isLoading: true,
        viewportHeight: 700,
      }),
    ).toBe(false);
  });

  it("matches native activity title/source mapping and signed amount formatting", () => {
    const checkIn = { id: "one", delta: 3, balance_after: 12, source: "daily_check-in_reward" };
    expect(activityCatFoodLocalizedTitleKey(checkIn)).toBe("activityCenter.checkIn.title");
    expect(activityCatFoodTransactionPresentation(checkIn, t)).toEqual({
      title: "activityCenter.checkIn.title",
      source: "activityCatFood.transaction.grant",
      signedAmount: "+3",
    });
    expect(
      activityCatFoodTransactionPresentation(
        { id: "two", delta: -4, balance_after: 8, title: "Manual" },
        t,
      ),
    ).toEqual({
      title: "Manual",
      signedAmount: "-4",
    });
  });

  it("supports both remote-config feature shapes and fail-closes the server disabled code", () => {
    expect(isActivityCatFoodConfigured({ activity_cat_food: { enabled: true } })).toBe(true);
    expect(isActivityCatFoodConfigured({ activityCatFoodEnabled: "1" })).toBe(true);
    expect(
      isActivityCatFoodConfigured({
        activity_cat_food: { enabled: false },
        activity_cat_food_enabled: true,
      }),
    ).toBe(true);
    expect(isActivityCatFoodConfigured({ activity_cat_food_enabled: false })).toBe(false);
    expect(
      isActivityCatFoodDisabledError(
        new APIError("disabled", 400, {
          code: "activity_cat_food_disabled",
        }),
      ),
    ).toBe(true);
    expect(
      isActivityCatFoodDisabledError(
        new APIError("disabled", 400, {
          data: { error_code: "activity_cat_food_disabled" },
        }),
      ),
    ).toBe(true);
    expect(
      isActivityCatFoodDisabledError(new APIError('{"code":"activity_cat_food_disabled"}', 400)),
    ).toBe(true);
  });
});
