import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState } from "react-native";

import { getShortDramaFeed, getShortDramaSeriesDetail } from "@/api/bwchat";
import ShortDramaPlayerScreen from "@/app/short-drama-player";
import type { ShortDramaComment, ShortDramaFeedPage, User } from "@/models";
import {
  loadShortDramaFeed,
  loadShortDramaFeedCache,
} from "@/services/short-drama/ShortDramaFeedRepository";
import { saveShortDramaHistory } from "@/services/short-drama/ShortDramaHistoryRepository";

let mockParams: Record<string, string | undefined> = {};
let mockUser: User | null = { user_id: "owner-a" } as User;
let mockBlurCurrentScreen: (() => void) | undefined;
let mockVideoPlayer: {
  allowsExternalPlayback: boolean;
  audioMixingMode: string;
  bufferOptions: Record<string, unknown>;
  currentTime: number;
  duration: number;
  loop: boolean;
  muted: boolean;
  pause: jest.Mock;
  play: jest.Mock;
  playing: boolean;
  staysActiveInBackground: boolean;
  timeUpdateEventInterval: number;
  volume: number;
};
const mockPreparePlaybackSource = jest.fn();
const mockTranslate = (key: string) => key;

jest.mock("expo-router", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");
  return {
    router: { back: jest.fn(), push: jest.fn() },
    Stack: { Screen: () => null },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(() => {
        const cleanupFocus = callback();
        mockBlurCurrentScreen = typeof cleanupFocus === "function" ? cleanupFocus : undefined;
        return () => {
          if (mockBlurCurrentScreen === cleanupFocus) mockBlurCurrentScreen = undefined;
          cleanupFocus?.();
        };
      }, [callback]);
    },
  };
});

jest.mock("expo", () => ({
  requireOptionalNativeModule: jest.fn(() => null),
  useEvent: (_target: unknown, _name: string, initial: unknown) => initial,
  useEventListener: jest.fn(),
}));

jest.mock("expo-video", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    useVideoPlayer: () => mockVideoPlayer,
    VideoView: () => <MockView />,
  };
});

jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    LinearGradient: ({ children }: { children?: ReactNode }) => <MockView>{children}</MockView>,
  };
});

jest.mock("expo-status-bar", () => ({ StatusBar: () => null }));
jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@/api/bwchat", () => ({
  createIdempotencyKey: jest.fn(() => "key"),
  followUser: jest.fn(),
  getShortDramaFeed: jest.fn(),
  getShortDramaSeriesDetail: jest.fn(),
  getWalletBalance: jest.fn(),
  reportShortDramaProgress: jest.fn(() => Promise.resolve()),
  setShortDramaLiked: jest.fn(),
  unfollowUser: jest.fn(),
  unlockShortDramaEpisode: jest.fn(),
}));

jest.mock("@/components/AuthenticatedImage", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { AuthenticatedImage: () => <MockView /> };
});
jest.mock("@/components/short-drama/ShortDramaActionRail", () => {
  const { Pressable: MockPressable, Text: MockText } = jest.requireActual("react-native");
  return {
    ShortDramaActionRail: ({
      onOpenComments,
      video,
    }: {
      onOpenComments(): void;
      video: ShortDramaFeedPage["videos"][number];
    }) => (
      <MockPressable onPress={onOpenComments} testID="open-short-drama-comments">
        <MockText testID="short-drama-comment-count">{video.comment_count}</MockText>
      </MockPressable>
    ),
  };
});
jest.mock("@/components/short-drama/ShortDramaCommentsSheet", () => {
  const { Pressable: MockPressable } = jest.requireActual("react-native");
  const sent: ShortDramaComment = {
    id: "comment-1",
    video_id: "",
    user_id: "owner-a",
    nickname: "Owner",
    avatar_url: "",
    content: "comment",
    created_at: "",
  };
  return {
    ShortDramaCommentsSheet: ({
      onCommentSent,
    }: {
      onCommentSent(comment: ShortDramaComment): void;
    }) => <MockPressable onPress={() => onCommentSent(sent)} testID="send-short-drama-comment" />,
  };
});
jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    TopToast: ({ message }: { message: string | null }) =>
      message ? <MockText>{message}</MockText> : null,
  };
});
jest.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockTranslate }),
}));
jest.mock("@/providers/WalletProvider", () => ({
  useWallet: () => ({ applyBalance: jest.fn(), balance: null }),
}));
jest.mock("@/services/cache/MediaCacheService", () => ({
  cancelScheduledMediaCache: jest.fn(),
  scheduleMediaCache: jest.fn(),
}));
jest.mock("@/services/friends/FollowRelationshipStore", () => ({
  publishFollowRelationship: jest.fn(),
  subscribeFollowRelationship: jest.fn(() => () => undefined),
}));
jest.mock("@/services/short-drama/ShortDramaFeedRepository", () => ({
  loadShortDramaFeed: jest.fn(
    (_ownerId: string, _seriesId: string | undefined, fetch: () => Promise<ShortDramaFeedPage>) =>
      fetch(),
  ),
  loadShortDramaFeedCache: jest.fn(),
  saveShortDramaFeedCache: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/services/short-drama/ShortDramaHistoryRepository", () => ({
  saveShortDramaHistory: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/services/short-drama/ShortDramaPlaybackSource", () => {
  const actual = jest.requireActual("@/services/short-drama/ShortDramaPlaybackSource");
  return {
    ...actual,
    prepareShortDramaPlaybackSource: (...args: unknown[]) => mockPreparePlaybackSource(...args),
  };
});

const mockGetFeed = jest.mocked(getShortDramaFeed);
const mockGetSeriesDetail = jest.mocked(getShortDramaSeriesDetail);
const mockLoadFeed = jest.mocked(loadShortDramaFeed);
const mockLoadCache = jest.mocked(loadShortDramaFeedCache);
const mockSaveHistory = jest.mocked(saveShortDramaHistory);

describe("ShortDramaFeed route/focus lifetime", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeed.mockReset();
    mockGetSeriesDetail.mockReset();
    mockLoadFeed.mockImplementation(
      (_ownerId, _seriesId, fetch: () => Promise<ShortDramaFeedPage>) => fetch(),
    );
    mockParams = {};
    mockUser = { user_id: "owner-a" } as User;
    mockBlurCurrentScreen = undefined;
    mockLoadCache.mockResolvedValue(null);
    (AppState as unknown as { currentState: string }).currentState = "active";
    mockPreparePlaybackSource.mockReset();
    mockPreparePlaybackSource.mockResolvedValue({ uri: "https://example.com/video.mp4" });
    mockVideoPlayer = {
      allowsExternalPlayback: true,
      audioMixingMode: "doNotMix",
      bufferOptions: {},
      currentTime: 7.25,
      duration: 18,
      loop: false,
      muted: false,
      pause: jest.fn(),
      play: jest.fn(),
      playing: false,
      staysActiveInBackground: false,
      timeUpdateEventInterval: 0,
      volume: 1,
    };
  });

  afterEach(() => cleanup());

  it("keeps a same-route initial result that finishes while the screen is blurred", async () => {
    const pending = deferred<ShortDramaFeedPage>();
    mockGetFeed.mockReturnValueOnce(pending.promise);
    const view = await render(<ShortDramaPlayerScreen />);
    expect(mockGetFeed).toHaveBeenCalledWith({ limit: 12 });
    expect(view.queryByText("shortDrama.empty")).toBeNull();

    await act(async () => {
      mockBlurCurrentScreen?.();
      pending.resolve({ videos: [], has_more: false });
      await pending.promise;
    });

    expect(await view.findByText("shortDrama.empty")).toBeTruthy();
  });

  it("creates a new lifetime when the requested episode changes and drops the old result", async () => {
    const oldPage = deferred<ShortDramaFeedPage>();
    mockParams = { episodeId: "episode-a", initialPosition: "1" };
    mockGetFeed
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce({ videos: [], has_more: false });
    const view = await render(<ShortDramaPlayerScreen />);
    expect(mockGetFeed).toHaveBeenCalledTimes(1);

    mockParams = { episodeId: "episode-b", initialPosition: "1" };
    await act(async () => {
      await view.rerender(<ShortDramaPlayerScreen />);
    });
    expect(mockGetFeed).toHaveBeenCalledTimes(2);
    expect(await view.findByText("shortDrama.empty")).toBeTruthy();

    await act(async () => {
      oldPage.resolve({ videos: [], has_more: false });
      await oldPage.promise;
    });
    expect(view.getByText("shortDrama.empty")).toBeTruthy();
  });

  it("treats an explicitly empty series id as native series mode", async () => {
    mockParams = { seriesId: "" };
    mockGetSeriesDetail.mockResolvedValueOnce({ episodes: [] } as never);
    const view = await render(<ShortDramaPlayerScreen />);
    expect(await view.findByText("shortDrama.empty")).toBeTruthy();
    expect(mockGetSeriesDetail).toHaveBeenCalledWith("");
    expect(mockGetFeed).not.toHaveBeenCalled();
  });

  it("overrides a requested episode's server resume point with an explicit zero", async () => {
    mockParams = { episodeId: "episode-1", initialPosition: "0" };
    mockGetFeed.mockResolvedValueOnce({ videos: [videoPage()], has_more: false });
    await render(<ShortDramaPlayerScreen />);
    await waitFor(() =>
      expect(mockSaveHistory).toHaveBeenCalledWith("owner-a", "series-1", "episode-1", 0),
    );
  });

  it("increments the focused video after a successful comment even when the response omits video_id", async () => {
    mockGetFeed.mockResolvedValueOnce({ videos: [videoPage()], has_more: false });
    const view = await render(<ShortDramaPlayerScreen />);
    await act(async () => {
      fireEvent(view.getByTestId("short-drama-feed"), "layout", {
        nativeEvent: { layout: { height: 800 } },
      });
      await Promise.resolve();
    });
    expect(view.getByTestId("short-drama-comment-count").props.children).toBe(0);
    await act(async () => {
      fireEvent.press(view.getByTestId("open-short-drama-comments"));
    });
    await act(async () => {
      fireEvent.press(await view.findByTestId("send-short-drama-comment"));
    });
    expect(view.getByTestId("short-drama-comment-count").props.children).toBe(1);
  });

  it("unmounts after Expo releases the active player without surfacing a RedBox", async () => {
    mockGetFeed.mockResolvedValueOnce({ videos: [videoPage()], has_more: false });
    const view = await render(<ShortDramaPlayerScreen />);
    await waitFor(() => expect(mockGetFeed).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent(view.getByTestId("short-drama-feed"), "layout", {
        nativeEvent: { layout: { height: 800 } },
      });
      await Promise.resolve();
    });
    await waitFor(() => expect(mockPreparePlaybackSource).toHaveBeenCalled());
    await waitFor(() => expect(mockVideoPlayer.play).toHaveBeenCalled());

    mockVideoPlayer.pause.mockImplementation(() => {
      const error = new Error(
        "Calling the 'pause' function has failed: Unable to find the native shared object associated with given JavaScript object",
      );
      error.name = "FunctionCallException: NotFoundException";
      throw error;
    });
    await act(async () => view.unmount());
  });
});

function videoPage(): ShortDramaFeedPage["videos"][number] {
  return {
    id: "episode-1",
    drama_id: "series-1",
    creator: {
      user_id: "creator-1",
      username: "creator",
      nickname: "Creator",
      avatar_url: "",
      followed_by_me: false,
      follows_me: false,
      is_friend: false,
    },
    drama_title: "Drama",
    title: "Episode 1",
    intro: "Intro",
    cover_url: "",
    play_url: "https://example.com/video.mp4",
    playback_position_seconds: 7.25,
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    is_unlocked: false,
    is_owned_by_current_user: false,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
