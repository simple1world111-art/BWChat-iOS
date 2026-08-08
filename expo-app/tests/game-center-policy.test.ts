import {
  gameCenterCachePolicy,
  gameCenterMetrics,
  gameCenterPolicy,
} from "@/services/games/GameCenterPolicy";

describe("native GameCenter policy and geometry", () => {
  it("locks catalog, cache and pagination constants", () => {
    expect(gameCenterPolicy).toEqual({
      catalogLimit: 50,
      maximumCachedGames: 200,
      paginationTriggerRemainingItems: 4,
    });
    expect(gameCenterCachePolicy).toEqual({
      ttlMilliseconds: 10 * 60 * 1_000,
      staleRetentionMilliseconds: 90 * 24 * 60 * 60 * 1_000,
    });
  });

  it("locks every source-visible GameCenter geometry value", () => {
    expect(gameCenterMetrics).toEqual({
      backButton: 36,
      backSymbol: 17,
      tabWidth: 196,
      contentHorizontalInset: 16,
      contentVerticalInset: 18,
      cardGap: 12,
      cardMinimumHeight: 88,
      cardPadding: 12,
      cardRadius: 14,
      cardHorizontalGap: 12,
      posterSize: 50,
      posterRadius: 11,
      posterPlaceholderIconSize: 19,
      launchOverlayOpacity: 0.28,
      copyMinimumHeight: 64,
      copyGap: 7,
      nameSize: 17,
      summarySize: 14,
      summaryLineHeight: 17,
      badgeHorizontalInset: 9,
      badgeVerticalInset: 4,
      badgeRadius: 999,
      badgeTextSize: 12,
      initialStateMinimumHeight: 320,
      messageStatePadding: 28,
      messageStateGap: 14,
      messageIconSize: 38,
      messageTextSize: 15,
      retryHorizontalInset: 18,
      retryVerticalInset: 10,
      retryRadius: 12,
      retryTextSize: 14,
      nextPageSpinnerVerticalInset: 8,
    });
  });
});
