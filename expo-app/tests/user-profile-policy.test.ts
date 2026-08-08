import type { FollowUser } from "@/models";
import {
  encodeURLPathComponent,
  filterUserProfileSuggestions,
  profileDeepLink,
  profileWebsiteDisplay,
  profileWebsiteURL,
  userProfileMetrics,
  UserProfileGenerationBusySet,
  UserProfileRequestScope,
  userProfileIdentity,
} from "@/services/profile/UserProfilePolicy";

describe("native user-profile policy", () => {
  it("locks the native profile, tabs, state and sheet geometry", () => {
    expect(userProfileMetrics.navigation).toEqual({
      gap: 2,
      button: 36,
      symbol: 17,
      title: 17,
      titleMaxWidth: 180,
      titleMinimumScale: 0.82,
    });
    expect(userProfileMetrics.header).toMatchObject({
      horizontalInset: 16,
      topInset: 4,
      bottomInset: 12,
      gap: 10,
      topGap: 16,
      avatar: 72,
      avatarRadius: 16,
      avatarBorder: 1,
      highlightedAvatarBorder: 2,
      name: 16,
      nameMinimumScale: 0.78,
      verified: 14,
      statValue: 17,
      statTitle: 12,
      statTitleMinimumScale: 0.75,
    });
    expect(userProfileMetrics.actions).toEqual({
      horizontalInset: 16,
      bottomInset: 12,
      gap: 8,
      height: 36,
      radius: 8,
      title: 15,
    });
    expect(userProfileMetrics.suggestions).toMatchObject({
      loadingHeight: 120,
      cardWidth: 106,
      cardHeight: 136,
      avatar: 55,
      followHeight: 28,
    });
    expect(userProfileMetrics.tabs).toEqual({
      rowHeight: 44,
      labelHeight: 43,
      underlineHeight: 1,
      title: 15,
      titleMinimumScale: 0.72,
    });
    expect(userProfileMetrics.more).toMatchObject({
      cornerRadius: 24,
      handleWidth: 36,
      handleHeight: 4,
      rowHeight: 46,
      rowHorizontalInset: 22,
      iconWidth: 24,
      dividerLeadingInset: 60,
    });
  });

  it("blocks duplicate work only within one lifecycle generation", () => {
    const busy = new UserProfileGenerationBusySet();
    expect(busy.tryEnter(1)).toBe(true);
    expect(busy.tryEnter(1)).toBe(false);
    expect(busy.tryEnter(2)).toBe(true);
    busy.leave(1);
    expect(busy.tryEnter(2)).toBe(false);
    busy.leave(2);
    expect(busy.tryEnter(2)).toBe(true);
  });

  it("invalidates old account and target requests, including A to B to A", () => {
    const scope = new UserProfileRequestScope();
    const firstA = scope.reset("owner-a", "target-a");
    expect(scope.isCurrent(firstA)).toBe(true);
    const b = scope.reset("owner-b", "target-a");
    expect(scope.isCurrent(firstA)).toBe(false);
    expect(scope.isCurrent(b)).toBe(true);
    const secondA = scope.reset("owner-a", "target-a");
    expect(scope.isCurrent(firstA)).toBe(false);
    expect(scope.isCurrent(secondA)).toBe(true);
    scope.invalidate();
    expect(scope.isCurrent(secondA)).toBe(false);
    expect(userProfileIdentity(" owner-a ", " target-a ")).toBe("owner-a\u0000target-a");
  });

  it("uses the native URL-path allowance without admitting query or fragment delimiters", () => {
    expect(encodeURLPathComponent("name/part:@&=+$,;?x#y")).toBe("name/part:@&=+$,;%3Fx%23y");
    expect(profileDeepLink({ username: " friend/name ", user_id: "7" })).toBe(
      "bwchat://profile/friend/name",
    );
    expect(profileDeepLink({ username: " ", user_id: "user/7" })).toBe("bwchat://profile/user/7");
  });

  it("matches native website display and opening normalization", () => {
    expect(profileWebsiteDisplay("https://one.test/http://two")).toBe("one.test/two");
    expect(profileWebsiteURL(" example.com/path ")).toBe("https://example.com/path");
    expect(profileWebsiteURL("http://example.com")).toBe("http://example.com");
    expect(profileWebsiteURL("   ")).toBeNull();
  });

  it("keeps first suggested user while excluding blank, viewer and viewed profile IDs", () => {
    const user = (userId: string, nickname: string): FollowUser => ({
      user_id: userId,
      username: "",
      nickname,
      avatar_url: "",
      bio: "",
      following_count: 0,
      follower_count: 0,
      followed_by_me: false,
      follows_me: false,
      is_friend: false,
    });
    expect(
      filterUserProfileSuggestions(
        [
          user("", "空"),
          user("owner", "本人"),
          user("target", "主页"),
          user("friend", "第一次"),
          user("friend", "重复项"),
        ],
        "owner",
        "target",
      ).map((item) => item.nickname),
    ).toEqual(["第一次"]);
  });
});
