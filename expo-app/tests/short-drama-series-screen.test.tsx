import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import type { ReactNode } from "react";

import { getShortDramaSeriesDetail, getShortDramaSeriesFeed } from "@/api/bwchat";
import ShortDramaSeriesScreen from "@/app/short-drama-series";
import type { ShortDramaSeries, ShortDramaSeriesPage, ShortDramaVideo, User } from "@/models";
import {
  loadCachedShortDramaSeriesPage,
  saveCachedShortDramaSeriesPage,
} from "@/services/short-drama/ShortDramaSeriesRepository";
import { publishShortDramaLibraryEvent } from "@/services/short-drama/ShortDramaLibraryStore";
import { clearNavigationSnapshots } from "@/services/navigation/NavigationSnapshotCache";

let mockUser: User | null = { user_id: "owner-a" } as User;
const mockTranslate = (key: string) => key;

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
  Stack: { Screen: () => null },
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactModule = jest.requireActual<typeof import("react")>("react");
    ReactModule.useEffect(callback, [callback]);
  },
}));

jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    LinearGradient: ({ children }: { children?: ReactNode }) => <MockView>{children}</MockView>,
  };
});
jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});
jest.mock("@/api/bwchat", () => ({
  getShortDramaFeed: jest.fn(),
  getShortDramaSeriesDetail: jest.fn(),
  getShortDramaSeriesFeed: jest.fn(),
}));
jest.mock("@/components/AuthenticatedImage", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { AuthenticatedImage: () => <MockView /> };
});
jest.mock("@/components/Avatar", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { UserAvatarButton: () => <MockView /> };
});
jest.mock("@/components/SystemSegmentedTabs", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { SystemSegmentedTabs: () => <MockView /> };
});
jest.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockTranslate }),
}));
jest.mock("@/services/navigation/NavigationWorkScheduler", () => ({
  runAfterNavigationInteractions: (work: () => void) => {
    work();
    return () => undefined;
  },
}));
jest.mock("@/services/short-drama/ShortDramaHistoryRepository", () => ({
  readShortDramaHistory: jest.fn(() => Promise.resolve({})),
  subscribeShortDramaHistory: jest.fn(() => () => undefined),
}));
jest.mock("@/services/short-drama/ShortDramaSeriesRepository", () => ({
  coalesceShortDramaSeriesInitialLoad: jest.fn(
    (_owner: string, _filter: string, fetch: () => Promise<ShortDramaSeriesPage>) => fetch(),
  ),
  isShortDramaSeriesRepositoryResetError: jest.fn(() => false),
  loadCachedShortDramaSeriesPage: jest.fn(),
  saveCachedShortDramaSeriesPage: jest.fn(() => Promise.resolve()),
}));

const mockGetSeriesFeed = jest.mocked(getShortDramaSeriesFeed);
const mockGetSeriesDetail = jest.mocked(getShortDramaSeriesDetail);
const mockLoadCache = jest.mocked(loadCachedShortDramaSeriesPage);
const mockSaveCache = jest.mocked(saveCachedShortDramaSeriesPage);

describe("ShortDramaSeries owner/cache lifetime", () => {
  beforeEach(() => {
    clearNavigationSnapshots();
    jest.clearAllMocks();
    mockUser = { user_id: "owner-a" } as User;
    mockLoadCache.mockResolvedValue(null);
  });

  afterEach(() => cleanup());

  it("does not extend a fresh cache TTL merely by rendering it", async () => {
    mockLoadCache.mockResolvedValueOnce({
      value: page(series("cached", "缓存短剧")),
      updatedAt: 100,
      expiresAt: 200,
      isStale: false,
    });
    const view = await render(<ShortDramaSeriesScreen />);

    expect(await view.findByText("缓存短剧")).toBeTruthy();
    expect(mockGetSeriesFeed).not.toHaveBeenCalled();
    expect(mockSaveCache).not.toHaveBeenCalled();
  });

  it("remounts on A-to-B account change and drops A's late initial result", async () => {
    const ownerAPage = deferred<ShortDramaSeriesPage>();
    mockGetSeriesFeed
      .mockReturnValueOnce(ownerAPage.promise)
      .mockResolvedValueOnce(page(series("b", "账号 B")));
    const view = await render(<ShortDramaSeriesScreen />);
    expect(mockGetSeriesFeed).toHaveBeenCalledTimes(1);

    mockUser = { user_id: "owner-b" } as User;
    await act(async () => {
      await view.rerender(<ShortDramaSeriesScreen />);
    });
    expect(await view.findByText("账号 B")).toBeTruthy();
    expect(mockGetSeriesFeed).toHaveBeenCalledTimes(2);

    await act(async () => {
      ownerAPage.resolve(page(series("a", "账号 A")));
      await ownerAPage.promise;
    });
    expect(view.queryByText("账号 A")).toBeNull();
    expect(view.getByText("账号 B")).toBeTruthy();
  });

  it("ignores another owner's library completion and refreshes its own owner", async () => {
    mockGetSeriesFeed.mockResolvedValue(page(series("b", "账号 B")));
    mockUser = { user_id: "owner-b" } as User;
    await render(<ShortDramaSeriesScreen />);
    expect(mockGetSeriesFeed).toHaveBeenCalledTimes(1);

    await act(async () => {
      publishShortDramaLibraryEvent({
        kind: "upsert",
        owner_id: "owner-a",
        series: series("a", "账号 A"),
      });
      await Promise.resolve();
    });
    expect(mockGetSeriesFeed).toHaveBeenCalledTimes(1);

    await act(async () => {
      publishShortDramaLibraryEvent({
        kind: "refresh",
        owner_id: "owner-b",
      });
      await Promise.resolve();
    });
    expect(mockGetSeriesFeed).toHaveBeenCalledTimes(2);
  });

  it("loads a visible tail once and does not drain duplicate empty pages", async () => {
    const pagination = deferred<ShortDramaSeriesPage>();
    mockGetSeriesFeed
      .mockResolvedValueOnce({
        series: [series("tail", "末尾短剧")],
        has_more: true,
        next_cursor: "cursor-1",
      })
      .mockReturnValueOnce(pagination.promise);
    const view = await render(<ShortDramaSeriesScreen />);
    expect(await view.findByText("末尾短剧")).toBeTruthy();

    const list = view.getByTestId("short-drama-series-list");
    await act(async () => {
      list.props.onEndReached?.({ distanceFromEnd: 0 });
      list.props.onEndReached?.({ distanceFromEnd: 0 });
      await Promise.resolve();
    });
    expect(mockGetSeriesFeed).toHaveBeenCalledTimes(2);

    await act(async () => {
      pagination.resolve({
        series: [series("tail", "重复末尾")],
        has_more: true,
        next_cursor: "cursor-2",
      });
      await pagination.promise;
    });
    await act(async () => {
      list.props.onEndReached?.({ distanceFromEnd: 0 });
      await Promise.resolve();
    });
    expect(mockGetSeriesFeed).toHaveBeenCalledTimes(2);
    expect(view.queryByText("重复末尾")).toBeNull();
  });

  it("auto-loads an incomplete series only once and retries only when its missing slot is tapped", async () => {
    const first = video("episode-one", 1);
    const second = video("episode-two", 2);
    const incomplete = { ...series("series", "待补全短剧"), episode_count: 2, episodes: [first] };
    const initialDetail = deferred<ShortDramaSeries>();
    const retriedDetail = deferred<ShortDramaSeries>();
    mockGetSeriesFeed.mockResolvedValue(page(incomplete));
    mockGetSeriesDetail
      .mockReturnValueOnce(initialDetail.promise)
      .mockReturnValueOnce(retriedDetail.promise);

    const view = await render(<ShortDramaSeriesScreen />);
    expect(await view.findByText("待补全短剧")).toBeTruthy();
    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledTimes(1));
    await act(async () => {
      initialDetail.resolve(incomplete);
      await initialDetail.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockGetSeriesDetail).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(view.getByTestId("short-drama-episode-2"));
      await Promise.resolve();
    });
    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledTimes(2));
    await act(async () => {
      retriedDetail.resolve({ ...incomplete, episodes: [first, second] });
      await retriedDetail.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({
        pathname: "/short-drama-player",
        params: { seriesId: "series", episodeId: "episode-two", initialPosition: "0" },
      }),
    );
  });
});

function page(...items: ShortDramaSeries[]): ShortDramaSeriesPage {
  return { series: items, has_more: false };
}

function series(id: string, title: string): ShortDramaSeries {
  return {
    series_id: id,
    title,
    intro: "简介",
    cover_url: "",
    episode_count: 0,
    status: "published",
    updated_at: "",
    episodes: [],
    creator: {
      user_id: "creator",
      username: "creator",
      nickname: "创作者",
      avatar_url: "",
      followed_by_me: false,
      follows_me: false,
      is_friend: false,
    },
    resume_position_seconds: 0,
  };
}

function video(id: string, episodeNumber: number): ShortDramaVideo {
  return {
    id,
    drama_id: "series",
    creator: series("creator-source", "").creator,
    drama_title: "待补全短剧",
    title: `第 ${episodeNumber} 集`,
    intro: "",
    episode_number: episodeNumber,
    cover_url: "",
    play_url: "/video.mp4",
    playback_position_seconds: 0,
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
