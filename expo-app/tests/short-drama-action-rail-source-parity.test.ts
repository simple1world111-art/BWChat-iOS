import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { followUser, unfollowUser } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import type { FollowRelationshipEvent } from "@/services/friends/FollowRelationshipStore";
import {
  publishFollowRelationship,
  subscribeFollowRelationship,
} from "@/services/friends/FollowRelationshipStore";
import {
  optimisticShortDramaLike,
  reconcileShortDramaLike,
  shortDramaActionMetrics,
  updateShortDramaCreatorFollow,
} from "@/services/short-drama/shortDramaInteractionPolicy";
import type { ShortDramaVideo } from "@/models";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

jest.mock("@/services/friends/FollowListRepository", () => ({
  mutateCachedFollowList: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/services/profile/PublicProfileRepository", () => ({
  readCachedPublicProfile: jest.fn().mockResolvedValue(null),
  saveCachedPublicProfile: jest.fn().mockResolvedValue(undefined),
}));

const request = jest.mocked(apiRequest);
const root = resolve(__dirname, "..");
const nativeSources = [
  {
    copied: "../BWChat/Views/ShortDramaActionRail.swift",
    original: "../BWChat/Views/ShortDramaActionRail.swift",
    hash: "8fa2a398c06c2297fa215185653cccca8afcacc9a20d540d956e83100f0b70cc",
  },
  {
    copied: "../BWChat/Views/ShortDramaVideoPage.swift",
    original: "../BWChat/Views/ShortDramaVideoPage.swift",
    hash: "48b5a6c5dc9962d6118652bd8994998eeba6bcf4ba9108a5bfe6e6b1f41ce662",
  },
  {
    copied: "../BWChat/Views/ShortDramaFeedView.swift",
    original: "../BWChat/Views/ShortDramaFeedView.swift",
    hash: "61bd4af279a5855af0d3ceadce6c94157be754ee29b142e40919b11274fc5f9d",
  },
  {
    copied: "../BWChat/Components/AvatarView.swift",
    original: "../BWChat/Components/AvatarView.swift",
    hash: "a3c6f6de8c1ffc38cc07dfd0d9495a60830e18cf69864392f7cf7529f46bff92",
  },
  {
    copied: "../BWChat/ViewModels/ShortDramaFeedViewModel.swift",
    original: "../BWChat/ViewModels/ShortDramaFeedViewModel.swift",
    hash: "747f33afea7bc8ea2178172baf136fba0872b535677498e72d2d8a6b741624c8",
  },
  {
    copied: "../BWChat/Models/ShortDrama.swift",
    original: "../BWChat/Models/ShortDrama.swift",
    hash: "13abb0d63f53893bd48eff56fcf6d40f3bb7d570267280bcae276100344d6a11",
  },
  {
    copied: "../BWChat/Services/APIService.swift",
    original: "../BWChat/Services/APIService.swift",
    hash: "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
  },
] as const;

describe("native ShortDramaActionRail complete code-stage parity", () => {
  beforeEach(() => request.mockReset());

  it("locks the rail, avatar, models, API and interaction state machine to Swift", () => {
    for (const native of nativeSources) {
      expect(sha256(resolve(root, native.copied))).toBe(native.hash);
      const original = resolve(root, native.original);
      if (existsSync(original)) expect(sha256(original)).toBe(native.hash);
    }
  });

  it("keeps every native rail metric, symbol and visual state without invented actions", () => {
    expect(shortDramaActionMetrics).toEqual({
      railGap: 18,
      creatorGap: 6,
      creatorAvatarSize: 48,
      creatorAvatarRadius: 11,
      creatorAvatarStroke: 2,
      followButtonSize: 26,
      followSymbolSize: 13,
      railWidth: 58,
      shadowOpacity: 0.45,
      shadowRadius: 8,
      shadowOffsetY: 2,
      buttonCopyGap: 5,
      buttonIconSize: 27,
      buttonIconWidth: 44,
      buttonIconHeight: 34,
      buttonCountSize: 11,
      buttonCountWidth: 54,
      buttonCountMinimumScale: 0.72,
    });
    const rail = expo("src/components/short-drama/ShortDramaActionRail.tsx");
    expect(rail).toContain('name={video.creator.followed_by_me ? "checkmark" : "plus"}');
    expect(rail).toContain('symbol={video.liked_by_me ? "heart.fill" : "heart"}');
    expect(rail).toContain('symbol="text.bubble.fill"');
    expect(rail).toContain("video.creator.user_id !== currentUserId");
    expect(rail).toContain("cornerRadius={shortDramaActionMetrics.creatorAvatarRadius}");
    expect(rail).toContain('<View pointerEvents="none" style={styles.avatarStroke} />');
    expect(rail).not.toMatch(/share|ellipsis|moreButton|require\([^)]*\.(?:png|jpe?g|webp)/iu);
  });

  it("reads the latest optimistic like state on every rapid tap and reconciles server fields", () => {
    const initial = video({ liked_by_me: false, like_count: 4 });
    const first = optimisticShortDramaLike(initial);
    const second = optimisticShortDramaLike(first.next);
    expect(first).toMatchObject({ target: true, next: { liked_by_me: true, like_count: 5 } });
    expect(second).toMatchObject({ target: false, next: { liked_by_me: false, like_count: 4 } });
    expect(reconcileShortDramaLike(second.next, { liked: true, like_count: -9 })).toMatchObject({
      liked_by_me: true,
      like_count: 0,
    });
    expect(reconcileShortDramaLike(first.next, {})).toBeTruthy();
  });

  it("updates every episode by the same creator while preserving unrelated creators", () => {
    const first = video({ id: "a" });
    const second = video({ id: "b", liked_by_me: true });
    const unrelated = video({
      id: "c",
      creator: { ...first.creator, user_id: "other", followed_by_me: false },
    });
    const updated = updateShortDramaCreatorFollow([first, second, unrelated], "creator", true);
    expect(updated.map((item) => item.creator.followed_by_me)).toEqual([true, true, false]);
    expect(updated[2]).toBe(unrelated);
    expect(updated[1]?.liked_by_me).toBe(true);
  });

  it("uses exact follow POST/DELETE routes and normalizes nested backend acknowledgements", async () => {
    request
      .mockResolvedValueOnce({ relationship: { followedByMe: 1, followsMe: 1, isFriend: 1 } })
      .mockResolvedValueOnce({ relation: { followed_by_me: 0 } });
    await expect(followUser("creator/1")).resolves.toMatchObject({
      user_id: "creator/1",
      followed_by_me: true,
      follows_me: true,
      is_friend: true,
    });
    await expect(unfollowUser("creator/1")).resolves.toMatchObject({
      user_id: "creator/1",
      followed_by_me: false,
    });
    expect(request.mock.calls).toEqual([
      ["/follows/creator%2F1", { method: "POST", body: {}, requiredEnvelope: true }],
      ["/follows/creator%2F1", { method: "DELETE", requiredEnvelope: true }],
    ]);
  });

  it("uses the native path-component character set for creator identifiers", async () => {
    request.mockResolvedValue({});
    await followUser("creator:$&+,;=@/一");
    await unfollowUser("creator:$&+,;=@/一");
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/follows/creator:$&+,;=@%2F%E4%B8%80",
      "/follows/creator:$&+,;=@%2F%E4%B8%80",
    ]);
  });

  it("scopes successful relationship broadcasts to the active account", () => {
    const events: FollowRelationshipEvent[] = [];
    const otherEvents: FollowRelationshipEvent[] = [];
    const unsubscribe = subscribeFollowRelationship("owner-a", (event) => events.push(event));
    const unsubscribeOther = subscribeFollowRelationship("owner-b", (event) =>
      otherEvents.push(event),
    );
    publishFollowRelationship(
      {
        relationship: {
          user_id: "creator",
          followed_by_me: true,
          follows_me: false,
          is_friend: false,
        },
      },
      " owner-a ",
    );
    unsubscribe();
    unsubscribeOther();
    expect(events).toEqual([
      {
        ownerId: "owner-a",
        relationship: {
          user_id: "creator",
          followed_by_me: true,
          follows_me: false,
          is_friend: false,
        },
      },
    ]);
    expect(otherEvents).toEqual([]);
  });

  it("remounts feed state per account and preserves native whole-snapshot rollbacks", () => {
    const page = expo("src/app/short-drama-player.tsx");
    expect(page).toContain("const scopeIdentity = shortDramaFeedScopeIdentity(");
    expect(page).toContain("<ShortDramaPlayerScope key={scopeIdentity} routeScope={routeScope} />");
    expect(page).toContain("if (!mountedRef.current) return;");
    expect(page).toContain("subscribeFollowRelationship(ownerId, (event) =>");
    expect(page).toContain("const previous = videosRef.current.find");
    expect(page).toContain("video.id === selected.id ? previous : video");
    expect(page).toContain("const previousVideos = videosRef.current");
    expect(page).toContain(".catch(() => replaceVideos(previousVideos))");
    expect(page).toContain("publishFollowRelationship({ relationship }, ownerId)");
  });

  it("keeps the native callback boundary: the rail owns author/follow/like/comments, while playback remains on its video page", () => {
    const page = expo("src/app/short-drama-player.tsx");
    const rail = expo("src/components/short-drama/ShortDramaActionRail.tsx");

    expect(rail).toContain("onPress={onOpenCreator}");
    expect(rail).toContain("onPress={onToggleFollow}");
    expect(rail).toContain("onPress={onToggleLike}");
    expect(rail).toContain("onPress={onOpenComments}");
    expect(rail).not.toContain("onTogglePlayback");

    expect(page).toContain("onOpenComments={() => setCommentTarget(item)}");
    expect(page).toContain(
      'router.push({ pathname: "/user-profile", params: { id: item.creator.user_id } });',
    );
    expect(page).toContain("onToggleFollow={() => toggleFollow(item)}");
    expect(page).toContain("onToggleLike={() => toggleLike(item)}");
    expect(page).toContain("onTogglePlayback={() => togglePlayback(item)}");
    expect(page).toContain("ownerId={ownerId}");
    expect(page).toContain(
      "video={videos.find((video) => video.id === commentTarget.id) ?? commentTarget}",
    );
    expect(page).toContain(
      "if (shortDramaRequiresUnlock(video) || videos[playbackTargetIndex]?.id !== video.id) return;",
    );
    expect(page).toContain("prepareShortDramaPlaybackSource({");
    expect(page).toContain("videoId: video.id,");
  });

  it("exposes author, follow, like and comment controls across all ten native locales", () => {
    const rail = expo("src/components/short-drama/ShortDramaActionRail.tsx");
    expect(rail.match(/accessibilityRole="button"/gu)).toHaveLength(3);
    expect(rail).toContain("accessibilityLabel={video.creator.nickname}");
    expect(rail).toContain("accessibilityState={{ selected: video.creator.followed_by_me }}");
    expect(rail).toContain("accessibilitySelected={video.liked_by_me}");
    for (const language of [
      "de",
      "en",
      "es",
      "fr",
      "ja",
      "ko",
      "pt-BR",
      "ru",
      "zh-Hans",
      "zh-Hant",
    ]) {
      const catalog = JSON.parse(
        source(resolve(root, `src/localization/generated/${language}.json`)),
      ) as Record<string, string>;
      for (const key of [
        "follow.followButton",
        "follow.followingButton",
        "shortDrama.comments",
        "shortDrama.like",
      ]) {
        expect(catalog[key]).toBeTruthy();
      }
    }
  });
});

function video(overrides: Partial<ShortDramaVideo> = {}): ShortDramaVideo {
  return {
    id: "video",
    drama_id: "drama",
    creator: {
      user_id: "creator",
      username: "creator",
      nickname: "作者",
      avatar_url: "/avatar.jpg",
      followed_by_me: false,
      follows_me: false,
      is_friend: false,
    },
    drama_title: "短剧",
    title: "第一集",
    intro: "简介",
    cover_url: "/cover.jpg",
    play_url: "/video.mp4",
    playback_position_seconds: 0,
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    is_unlocked: true,
    is_owned_by_current_user: false,
    ...overrides,
  };
}

function expo(path: string): string {
  return source(resolve(root, path));
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
