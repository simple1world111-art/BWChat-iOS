import type {
  ActivityCenterSnapshot,
  ActivityInviteShareSession,
  ActivityMatchedUser,
  ActivityWheelSpinResult,
} from "@/services/activity/ActivityModels";

/** Mirrors ActivityCenterPreviewSupport in the native DEBUG build. */
export const activityCenterPreviewSnapshot: ActivityCenterSnapshot = {
  configVersion: "activity-preview-v1",
  serverTime: "2026-08-03T12:28:00+09:00",
  businessTimezone: "Asia/Tokyo",
  activityCatFoodBalance: 60,
  goldCoinBalance: 1_280,
  phoneBinding: { isVerified: false, defaultRegion: "JP" },
  checkIn: {
    activityID: "new_user_7d_v1",
    claimedDays: 1,
    completed: false,
    canClaim: true,
    days: [
      { day: 1, rewardActivityCatFood: 10, status: "claimed" },
      { day: 2, rewardActivityCatFood: 20, status: "claimable" },
      { day: 3, rewardActivityCatFood: 30, status: "locked" },
      { day: 4, rewardActivityCatFood: 40, status: "locked" },
      { day: 5, rewardActivityCatFood: 50, status: "locked" },
      { day: 6, rewardActivityCatFood: 60, status: "locked" },
      { day: 7, rewardActivityCatFood: 100, status: "locked" },
    ],
  },
  mealRewards: [
    {
      id: "breakfast",
      titleKey: "activityCenter.meal.breakfast",
      startLocal: "07:00",
      endLocal: "09:00",
      rewardActivityCatFood: 10,
      status: "claimed",
      claimedAt: "2026-08-03T08:01:00+09:00",
    },
    {
      id: "lunch",
      titleKey: "activityCenter.meal.lunch",
      startLocal: "12:00",
      endLocal: "14:00",
      rewardActivityCatFood: 20,
      status: "claimable",
      nextTransitionAt: "2026-08-03T14:00:00+09:00",
    },
    {
      id: "dinner",
      titleKey: "activityCenter.meal.dinner",
      startLocal: "18:00",
      endLocal: "21:00",
      rewardActivityCatFood: 20,
      status: "locked",
      nextTransitionAt: "2026-08-03T18:00:00+09:00",
    },
  ],
  tasks: [
    {
      id: "contact_sync",
      kind: "contact_sync",
      status: "available",
      rewardActivityCatFood: 100,
      completedCount: 0,
      creditedCount: 0,
    },
    {
      id: "invite_share",
      kind: "invite_share",
      status: "available",
      rewardActivityCatFood: 10,
      dailyLimit: 5,
      completedCount: 1,
      creditedCount: 1,
    },
    {
      id: "valid_invite",
      kind: "valid_invite",
      status: "available",
      rewardActivityCatFood: 100,
      completedCount: 0,
      creditedCount: 0,
    },
  ],
  invitation: {
    inviteCode: "MEOW88",
    shareURL: "https://example.com/i/activity-preview",
    pendingInvites: 1,
    creditedInvites: 0,
    canRedeem: true,
  },
  wheel: {
    enabled: true,
    currency: "gold_coin",
    currentTier: {
      id: "tier_10",
      sequence: 2,
      costGoldCoins: 10,
      nextTierID: "tier_100",
      segments: [
        { id: "p10", payoutGoldCoins: 10, probabilityPPM: 500_000, displayOrder: 0 },
        { id: "p20", payoutGoldCoins: 20, probabilityPPM: 300_000, displayOrder: 1 },
        { id: "p50", payoutGoldCoins: 50, probabilityPPM: 150_000, displayOrder: 2 },
        { id: "p100", payoutGoldCoins: 100, probabilityPPM: 50_000, displayOrder: 3 },
      ],
    },
    recentWinners: [
      { id: "winner-1", displayName: "M***w", avatarURL: "", payoutGoldCoins: 100 },
      { id: "winner-2", displayName: "P***r", avatarURL: "", payoutGoldCoins: 50 },
    ],
  },
};

export const activityCenterPreviewMatchedUsers: ActivityMatchedUser[] = [
  { userID: "preview-friend-1", nickname: "Momo", avatarURL: "", relation: "none" },
  { userID: "preview-friend-2", nickname: "小可", avatarURL: "", relation: "none" },
  { userID: "preview-friend-3", nickname: "Sunny", avatarURL: "", relation: "none" },
];

export const activityCenterPreviewWheelResult: ActivityWheelSpinResult = {
  spinID: "wheel-result-preview",
  tierID: "tier_10",
  costGoldCoins: 10,
  prizeID: "tier_10_p20",
  payoutGoldCoins: 20,
  netDeltaGoldCoins: 10,
  nextTierID: "tier_100",
};

export const activityCenterPreviewShareSession: ActivityInviteShareSession = {
  id: "share-preview",
  shareURL: "https://example.com/i/activity-preview",
  inviteCode: "MEOW88",
  message: "BWChat",
  expiresAt: "2099-01-01T00:00:00Z",
};
