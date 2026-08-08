import { act, cleanup, fireEvent, render } from "@testing-library/react-native";

import { ShortDramaActionRail } from "@/components/short-drama/ShortDramaActionRail";
import type { ShortDramaVideo } from "@/models";

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual<typeof import("react-native")>("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@/components/Avatar", () => {
  const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
  return { Avatar: () => <MockView testID="creator-avatar" /> };
});

const copy: Record<string, string> = {
  "follow.followButton": "关注",
  "follow.followingButton": "已关注",
  "shortDrama.comments": "评论",
  "shortDrama.like": "点赞",
};

describe("ShortDramaActionRail", () => {
  afterEach(() => cleanup());

  it("renders every native action state and invokes each action exactly once", async () => {
    const onOpenComments = jest.fn();
    const onOpenCreator = jest.fn();
    const onToggleFollow = jest.fn();
    const onToggleLike = jest.fn();
    const video = makeVideo({ liked_by_me: true, like_count: 1_500, comment_count: 25_000 });
    const screen = await render(
      <ShortDramaActionRail
        currentUserId="viewer"
        onOpenComments={onOpenComments}
        onOpenCreator={onOpenCreator}
        onToggleFollow={onToggleFollow}
        onToggleLike={onToggleLike}
        text={(key) => copy[key] ?? key}
        video={video}
      />,
    );

    expect(screen.getByText("heart.fill")).toBeTruthy();
    expect(screen.getByText("plus")).toBeTruthy();
    expect(screen.getByText("1.5K")).toBeTruthy();
    expect(screen.getByText("2.5W")).toBeTruthy();
    expect(screen.getByLabelText("点赞").props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByLabelText("关注").props.accessibilityState).toEqual({ selected: false });

    await fireEvent.press(screen.getByLabelText("作者"));
    await fireEvent.press(screen.getByLabelText("关注"));
    await fireEvent.press(screen.getByLabelText("点赞"));
    await fireEvent.press(screen.getByLabelText("评论"));
    expect(onOpenCreator).toHaveBeenCalledTimes(1);
    expect(onToggleFollow).toHaveBeenCalledTimes(1);
    expect(onToggleLike).toHaveBeenCalledTimes(1);
    expect(onOpenComments).toHaveBeenCalledTimes(1);

    await act(async () => {
      screen.rerender(
        <ShortDramaActionRail
          currentUserId="viewer"
          onOpenComments={onOpenComments}
          onOpenCreator={onOpenCreator}
          onToggleFollow={onToggleFollow}
          onToggleLike={onToggleLike}
          text={(key) => copy[key] ?? key}
          video={{ ...video, creator: { ...video.creator, followed_by_me: true } }}
        />,
      );
      await Promise.resolve();
    });
    expect(screen.getByText("checkmark")).toBeTruthy();
    expect(screen.getByLabelText("已关注").props.accessibilityState).toEqual({ selected: true });
  });

  it("hides follow for the creator and does not invent share or more actions", async () => {
    const screen = await render(
      <ShortDramaActionRail
        currentUserId="creator"
        onOpenComments={jest.fn()}
        onOpenCreator={jest.fn()}
        onToggleFollow={jest.fn()}
        onToggleLike={jest.fn()}
        text={(key) => copy[key] ?? key}
        video={makeVideo()}
      />,
    );

    expect(screen.queryByLabelText("关注")).toBeNull();
    expect(screen.queryByLabelText("已关注")).toBeNull();
    expect(screen.queryByText("plus")).toBeNull();
    expect(screen.queryByText("square.and.arrow.up")).toBeNull();
    expect(screen.queryByText("ellipsis")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});

function makeVideo(overrides: Partial<ShortDramaVideo> = {}): ShortDramaVideo {
  return {
    id: "episode",
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
