import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import { getShortDramaComments, sendShortDramaComment } from "@/api/bwchat";
import { ShortDramaCommentsSheet } from "@/components/short-drama/ShortDramaCommentsSheet";
import type { ShortDramaComment, ShortDramaVideo, User } from "@/models";
import {
  loadCachedShortDramaComments,
  saveCachedShortDramaComments,
} from "@/services/short-drama/ShortDramaCommentsRepository";
import { readCachedUser } from "@/storage/authStorage";

jest.mock("@expo/ui/community/bottom-sheet", () => {
  const React = jest.requireActual("react") as typeof import("react");
  const {
    FlatList: MockFlatList,
    TextInput: MockTextInput,
    View: MockView,
  } = jest.requireActual("react-native") as typeof import("react-native");
  const FlatListComponent = MockFlatList as unknown as React.ComponentType<Record<string, unknown>>;
  return {
    BottomSheet: ({ children }: { children: React.ReactNode }) =>
      React.createElement(MockView, { testID: "comments-sheet" }, children),
    BottomSheetFlatList: (props: Record<string, unknown>) =>
      React.createElement(FlatListComponent, { ...props, testID: "comments-list" }),
    BottomSheetTextInput: (props: Record<string, unknown>) =>
      React.createElement(MockTextInput, { ...props, testID: "comment-input" }),
  };
});

jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "uuid") }));

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@/api/bwchat", () => ({
  getShortDramaComments: jest.fn(),
  sendShortDramaComment: jest.fn(),
}));

jest.mock("@/components/Avatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { Avatar: ({ name }: { name: string }) => <MockText>{`avatar:${name}`}</MockText> };
});

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    TopToast: ({ message }: { message: string | null }) =>
      message ? <MockText>{message}</MockText> : null,
  };
});

jest.mock("@/services/short-drama/ShortDramaCommentsRepository", () => ({
  loadCachedShortDramaComments: jest.fn(),
  saveCachedShortDramaComments: jest.fn(),
}));

jest.mock("@/storage/authStorage", () => ({ readCachedUser: jest.fn() }));

const getComments = jest.mocked(getShortDramaComments);
const sendComment = jest.mocked(sendShortDramaComment);
const loadCache = jest.mocked(loadCachedShortDramaComments);
const saveCache = jest.mocked(saveCachedShortDramaComments);
const readUser = jest.mocked(readCachedUser);
const push = jest.mocked(router.push);

describe("ShortDramaCommentsSheet interaction state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadCache.mockResolvedValue(freshCache([]));
    saveCache.mockResolvedValue(undefined);
    getComments.mockResolvedValue({ comments: [], has_more: false });
    sendComment.mockResolvedValue(comment("sent", "sent"));
    readUser.mockResolvedValue(user());
  });

  afterEach(() => jest.useRealTimers());

  it("uses a fresh account/video cache without an unnecessary initial request", async () => {
    loadCache.mockResolvedValue(freshCache([comment("cached", "缓存评论")]));
    const screen = await renderSheet();
    expect(await screen.findByText("缓存评论")).toBeTruthy();
    expect(loadCache).toHaveBeenCalledWith("owner", "video");
    expect(getComments).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(saveCache).toHaveBeenCalledWith("owner", "video", {
        comments: [comment("cached", "缓存评论")],
        has_more: false,
      }),
    );
  });

  it("shows an expired native snapshot but reports refresh failure after retention", async () => {
    loadCache.mockResolvedValue({
      ...freshCache([comment("expired", "过期评论")]),
      isRetained: false,
      isStale: true,
    });
    getComments.mockRejectedValue(new Error("刷新失败"));
    const screen = await renderSheet();
    expect(await screen.findByText("过期评论")).toBeTruthy();
    expect(await screen.findByText("刷新失败")).toBeTruthy();
  });

  it("silently keeps and renews a retained stale snapshot when refresh fails", async () => {
    loadCache.mockResolvedValue({
      ...freshCache([comment("stale", "旧评论")]),
      isRetained: true,
      isStale: true,
    });
    getComments.mockRejectedValue(new Error("刷新失败"));
    const screen = await renderSheet();
    expect(await screen.findByText("旧评论")).toBeTruthy();
    expect(screen.queryByText("刷新失败")).toBeNull();
    await waitFor(() =>
      expect(saveCache).toHaveBeenCalledWith("owner", "video", {
        comments: [comment("stale", "旧评论")],
        has_more: false,
      }),
    );
  });

  it("allows only one same-frame send and replaces the optimistic row with the server row", async () => {
    const pending = deferred<ShortDramaComment>();
    sendComment.mockReturnValue(pending.promise);
    const onCommentSent = jest.fn();
    const screen = await renderSheet({ onCommentSent });
    await waitFor(() => expect(loadCache).toHaveBeenCalled());
    await fireEvent.changeText(screen.getByTestId("comment-input"), "  hello  ");
    const sendButton = screen.getByLabelText("发送");
    const onPress = findOnPress(sendButton);
    await act(async () => {
      onPress();
      onPress();
      await Promise.resolve();
    });
    expect(sendComment).toHaveBeenCalledTimes(1);
    expect(sendComment).toHaveBeenCalledWith("video", "hello");
    expect(screen.getByText("hello")).toBeTruthy();

    await act(async () => {
      pending.resolve(comment("server", "服务端评论"));
      await pending.promise;
    });
    await waitFor(() =>
      expect(onCommentSent).toHaveBeenCalledWith(comment("server", "服务端评论")),
    );
    expect(screen.queryByText("hello")).toBeNull();
    expect(screen.getByText("服务端评论")).toBeTruthy();
    expect(saveCache).toHaveBeenCalledWith(
      "owner",
      "video",
      expect.objectContaining({ comments: [comment("server", "服务端评论")] }),
    );
  });

  it("uses Foundation trimming and does not keep sending busy for cache persistence", async () => {
    const cacheWrite = deferred<void>();
    saveCache.mockReturnValue(cacheWrite.promise);
    const onCommentSent = jest.fn();
    const screen = await renderSheet({ onCommentSent });
    await waitFor(() => expect(loadCache).toHaveBeenCalled());
    await fireEvent.changeText(screen.getByTestId("comment-input"), "\u0085hello\u0085");
    await fireEvent.press(screen.getByLabelText("发送"));
    await waitFor(() => expect(sendComment).toHaveBeenCalledWith("video", "hello"));
    await waitFor(() => expect(onCommentSent).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByLabelText("发送").props.accessibilityState).toEqual({
        busy: false,
        disabled: true,
      }),
    );
    expect(saveCache).toHaveBeenCalledTimes(2);
    cacheWrite.resolve();
    await cacheWrite.promise;
  });

  it("removes a failed optimistic row, restores the trimmed draft and shows the backend error", async () => {
    sendComment.mockRejectedValue(new Error("发送失败"));
    const screen = await renderSheet();
    await waitFor(() => expect(loadCache).toHaveBeenCalled());
    await fireEvent.changeText(screen.getByTestId("comment-input"), "  retry me  ");
    await fireEvent.press(screen.getByLabelText("发送"));
    await waitFor(() => expect(screen.getByTestId("comment-input").props.value).toBe("retry me"));
    expect(screen.queryByText("retry me")).toBeNull();
    expect(screen.getByText("发送失败")).toBeTruthy();
  });

  it("serializes same-frame last-row pagination and appends with native de-duplication", async () => {
    loadCache.mockResolvedValue(freshCache([comment("a", "第一页")], true, "next"));
    const pending = deferred<{ comments: ShortDramaComment[]; has_more: boolean }>();
    getComments.mockReturnValue(pending.promise);
    const screen = await renderSheet();
    expect(await screen.findByText("第一页")).toBeTruthy();
    const list = screen.getByTestId("comments-list");
    await act(async () => {
      list.props.onEndReached();
      list.props.onEndReached();
      await Promise.resolve();
    });
    expect(getComments).toHaveBeenCalledTimes(1);
    expect(getComments).toHaveBeenCalledWith("video", { cursor: "next", limit: 30 });
    await act(async () => {
      pending.resolve({ comments: [comment("b", "第二页")], has_more: false });
      await pending.promise;
    });
    expect(await screen.findByText("第二页")).toBeTruthy();
    expect(saveCache).toHaveBeenCalledWith(
      "owner",
      "video",
      expect.objectContaining({
        comments: [comment("a", "第一页"), comment("b", "第二页")],
        has_more: false,
      }),
    );
  });

  it("finishes an unstructured native pagination task after sheet dismissal", async () => {
    loadCache.mockResolvedValue(freshCache([comment("a", "第一页")], true, "next"));
    const pending = deferred<{ comments: ShortDramaComment[]; has_more: boolean }>();
    getComments.mockReturnValue(pending.promise);
    const screen = await renderSheet();
    expect(await screen.findByText("第一页")).toBeTruthy();
    await act(async () => {
      screen.getByTestId("comments-list").props.onEndReached();
      await Promise.resolve();
    });
    await screen.unmount();
    await act(async () => {
      pending.resolve({ comments: [comment("b", "第二页")], has_more: false });
      await pending.promise;
    });
    await waitFor(() =>
      expect(saveCache).toHaveBeenCalledWith(
        "owner",
        "video",
        expect.objectContaining({
          comments: [comment("a", "第一页"), comment("b", "第二页")],
          has_more: false,
        }),
      ),
    );
  });

  it("finishes a successful POST after sheet dismissal so the parent count and cache stay correct", async () => {
    const pending = deferred<ShortDramaComment>();
    sendComment.mockReturnValue(pending.promise);
    const onCommentSent = jest.fn();
    const screen = await renderSheet({ onCommentSent });
    await waitFor(() => expect(loadCache).toHaveBeenCalled());
    await fireEvent.changeText(screen.getByTestId("comment-input"), "background");
    await fireEvent.press(screen.getByLabelText("发送"));
    await screen.unmount();
    await act(async () => {
      pending.resolve(comment("server", "后台完成"));
      await pending.promise;
    });
    await waitFor(() => expect(onCommentSent).toHaveBeenCalledWith(comment("server", "后台完成")));
    expect(saveCache).toHaveBeenCalledWith(
      "owner",
      "video",
      expect.objectContaining({ comments: [comment("server", "后台完成")] }),
    );
  });

  it("delays profile navigation and rejects it if the active account changed", async () => {
    jest.useFakeTimers();
    loadCache.mockResolvedValue(freshCache([comment("a", "资料", "target")]));
    const onClose = jest.fn();
    const screen = await renderSheet({ onClose });
    expect(await screen.findByText("资料")).toBeTruthy();
    await fireEvent.press(screen.getAllByLabelText("作者")[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(220);
      await Promise.resolve();
    });
    expect(push).toHaveBeenCalledWith({ pathname: "/user-profile", params: { id: "target" } });

    readUser.mockResolvedValue(user({ user_id: "other" }));
    await fireEvent.press(screen.getAllByLabelText("作者")[0]!);
    await act(async () => {
      jest.advanceTimersByTime(220);
      await Promise.resolve();
    });
    expect(push).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});

async function renderSheet(
  overrides: {
    onClose?: () => void;
    onCommentSent?: (comment: ShortDramaComment) => void;
  } = {},
) {
  return render(
    <ShortDramaCommentsSheet
      currentUser={user()}
      onClose={overrides.onClose ?? jest.fn()}
      onCommentSent={overrides.onCommentSent ?? jest.fn()}
      ownerId="owner"
      t={translate}
      video={video()}
    />,
  );
}

function translate(key: string): string {
  return (
    {
      "common.loading": "加载中",
      "common.operationFailed": "操作失败",
      "common.send": "发送",
      "profile.defaultUser": "BBchat 用户",
      "shortDrama.comment.placeholder": "说点什么...",
      "shortDrama.comments": "评论",
      "shortDrama.comments.empty": "还没有评论",
      "time.yesterday": "昨天",
    }[key] ?? key
  );
}

function freshCache(comments: ShortDramaComment[], hasMore = false, nextCursor?: string) {
  return {
    value: {
      comments,
      has_more: hasMore,
      ...(nextCursor ? { next_cursor: nextCursor } : {}),
    },
    updatedAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
    isRetained: true,
    isStale: false,
  };
}

function comment(id: string, content: string, userId = "author"): ShortDramaComment {
  return {
    id,
    video_id: "video",
    user_id: userId,
    nickname: "作者",
    avatar_url: "",
    content,
    created_at: "",
  };
}

function user(overrides: Partial<User> = {}): User {
  return {
    user_id: "owner",
    username: "owner",
    nickname: "我",
    avatar_url: "",
    bio: "",
    gender: "",
    birthday: "",
    location: "",
    following_count: 0,
    follower_count: 0,
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
    ...overrides,
  };
}

function video(): ShortDramaVideo {
  return {
    id: "video",
    drama_id: "drama",
    creator: {
      user_id: "creator",
      username: "creator",
      nickname: "创作者",
      avatar_url: "",
      followed_by_me: false,
      follows_me: false,
      is_friend: false,
    },
    drama_title: "短剧",
    title: "第一集",
    intro: "",
    cover_url: "",
    play_url: "",
    playback_position_seconds: 0,
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    is_unlocked: true,
    is_owned_by_current_user: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type RenderedInstance = Awaited<ReturnType<typeof render>>["container"];
type FiberWithProps = {
  memoizedProps?: { onPress?: () => void };
  return: FiberWithProps | null;
};

function findOnPress(instance: RenderedInstance): () => void {
  let current: RenderedInstance | null = instance;
  while (current) {
    if (typeof current.props.onPress === "function") return current.props.onPress as () => void;
    current = current.parent;
  }

  let fiber = instance.unstable_fiber as FiberWithProps | null;
  while (fiber) {
    if (typeof fiber.memoizedProps?.onPress === "function") return fiber.memoizedProps.onPress;
    fiber = fiber.return;
  }
  throw new Error("Press handler not found");
}
