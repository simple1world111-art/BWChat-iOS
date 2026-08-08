import { act, render, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

import { ChatAppearanceProvider, useChatAppearance } from "@/providers/ChatAppearanceProvider";
import {
  cacheUploadedBackgroundImage,
  deleteChatBackground,
  getChatBackgrounds,
  removeCachedBackgroundImage,
  uploadChatBackground,
  type ChatBackground,
} from "@/services/chat-appearance/ChatAppearanceService";

let mockUserId = "owner-a";

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockUserId ? { user_id: mockUserId } : null }),
}));
jest.mock("@/services/chat-appearance/ChatAppearanceService", () => {
  const actual = jest.requireActual("@/services/chat-appearance/ChatAppearanceService");
  return {
    ...actual,
    getChatBackgrounds: jest.fn(),
    uploadChatBackground: jest.fn(),
    deleteChatBackground: jest.fn(),
    cacheUploadedBackgroundImage: jest.fn(),
    removeCachedBackgroundImage: jest.fn(),
  };
});

const mockedGet = jest.mocked(getChatBackgrounds);
const mockedUpload = jest.mocked(uploadChatBackground);
const mockedDelete = jest.mocked(deleteChatBackground);
const mockedCacheUpload = jest.mocked(cacheUploadedBackgroundImage);
const mockedRemoveCache = jest.mocked(removeCachedBackgroundImage);

const ownerA: ChatBackground = {
  target_type: "global",
  target_id: "global",
  image_url: "/backgrounds/owner-a.jpg",
  updated_at: "a1",
};
const ownerB: ChatBackground = {
  target_type: "global",
  target_id: "global",
  image_url: "/backgrounds/owner-b.jpg",
  updated_at: "b1",
};

let latest: ReturnType<typeof useChatAppearance> | undefined;

function Probe() {
  const appearance = useChatAppearance();
  useEffect(() => {
    latest = appearance;
  }, [appearance]);
  return (
    <Text testID="background-image">{appearance.exact("global", "global")?.image_url ?? ""}</Text>
  );
}

function tree() {
  return (
    <ChatAppearanceProvider>
      <Probe />
    </ChatAppearanceProvider>
  );
}

describe("chat appearance account and mutation lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGet.mockReset();
    mockedUpload.mockReset();
    mockedDelete.mockReset();
    mockedCacheUpload.mockReset();
    mockedRemoveCache.mockReset();
    mockUserId = "owner-a";
    latest = undefined;
    mockedDelete.mockResolvedValue(undefined);
    mockedCacheUpload.mockResolvedValue(undefined);
    mockedRemoveCache.mockResolvedValue(undefined);
  });

  it("never shows the previous account background while the next account loads", async () => {
    const ownerBLoad = deferred<ChatBackground[]>();
    mockedGet.mockResolvedValueOnce([ownerA]).mockImplementationOnce(() => ownerBLoad.promise);
    const view = await render(tree());

    await waitFor(() =>
      expect(view.getByTestId("background-image").props.children).toBe(ownerA.image_url),
    );

    mockUserId = "owner-b";
    await view.rerender(tree());
    expect(view.getByTestId("background-image").props.children).toBe("");

    ownerBLoad.resolve([ownerB]);
    await waitFor(() =>
      expect(view.getByTestId("background-image").props.children).toBe(ownerB.image_url),
    );
  });

  it("ignores an old account response that arrives after the new account", async () => {
    const ownerALoad = deferred<ChatBackground[]>();
    mockedGet.mockImplementationOnce(() => ownerALoad.promise).mockResolvedValueOnce([ownerB]);
    const view = await render(tree());
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));

    mockUserId = "owner-b";
    await view.rerender(tree());
    await waitFor(() =>
      expect(view.getByTestId("background-image").props.children).toBe(ownerB.image_url),
    );

    ownerALoad.resolve([ownerA]);
    await act(async () => ownerALoad.promise);
    expect(view.getByTestId("background-image").props.children).toBe(ownerB.image_url);
  });

  it("keeps the new A session when an old A response resolves after A to B to A", async () => {
    const oldOwnerALoad = deferred<ChatBackground[]>();
    const newOwnerA = { ...ownerA, image_url: "/backgrounds/owner-a-new.jpg", updated_at: "a2" };
    mockedGet
      .mockImplementationOnce(() => oldOwnerALoad.promise)
      .mockResolvedValueOnce([ownerB])
      .mockResolvedValueOnce([newOwnerA]);
    const view = await render(tree());
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));

    mockUserId = "owner-b";
    await view.rerender(tree());
    await waitFor(() =>
      expect(view.getByTestId("background-image").props.children).toBe(ownerB.image_url),
    );

    mockUserId = "owner-a";
    await view.rerender(tree());
    await waitFor(() =>
      expect(view.getByTestId("background-image").props.children).toBe(newOwnerA.image_url),
    );

    oldOwnerALoad.resolve([ownerA]);
    await act(async () => {
      await oldOwnerALoad.promise;
    });
    expect(view.getByTestId("background-image").props.children).toBe(newOwnerA.image_url);
  });

  it("does not invalidate caches or commit a load that resolves after teardown", async () => {
    const lateLoad = deferred<ChatBackground[]>();
    mockedGet.mockResolvedValueOnce([ownerA]).mockImplementationOnce(() => lateLoad.promise);
    const view = await render(tree());
    await waitFor(() =>
      expect(view.getByTestId("background-image").props.children).toBe(ownerA.image_url),
    );
    mockedRemoveCache.mockClear();

    let pending!: Promise<void>;
    await act(async () => {
      pending = latest!.load(true);
      await Promise.resolve();
    });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2));
    await view.unmount();
    lateLoad.resolve([ownerB]);
    await pending;

    expect(mockedRemoveCache).not.toHaveBeenCalled();
  });

  it("does not apply an upload that resolves after teardown", async () => {
    const lateUpload = deferred<Awaited<ReturnType<typeof uploadChatBackground>>>();
    const replacement: ChatBackground = {
      ...ownerA,
      image_url: "/backgrounds/late.jpg",
      updated_at: "late",
    };
    mockedGet.mockResolvedValueOnce([ownerA]);
    mockedUpload.mockImplementationOnce(() => lateUpload.promise);
    const view = await render(tree());
    await waitFor(() =>
      expect(view.getByTestId("background-image").props.children).toBe(ownerA.image_url),
    );

    let pending!: Promise<void>;
    await act(async () => {
      pending = latest!.upload("global", "global", imageAsset());
      await Promise.resolve();
    });
    await waitFor(() => expect(mockedUpload).toHaveBeenCalledTimes(1));
    await view.unmount();
    lateUpload.resolve({ background: replacement, preparedUri: "file:///late.jpg" });
    await pending;

    expect(mockedRemoveCache).not.toHaveBeenCalled();
    expect(mockedCacheUpload).not.toHaveBeenCalled();
  });

  it("does not apply a delete that resolves after teardown", async () => {
    const lateDelete = deferred<void>();
    mockedGet.mockResolvedValueOnce([ownerA]);
    mockedDelete.mockImplementationOnce(() => lateDelete.promise);
    const view = await render(tree());
    await waitFor(() =>
      expect(view.getByTestId("background-image").props.children).toBe(ownerA.image_url),
    );

    let pending!: Promise<void>;
    await act(async () => {
      pending = latest!.remove("global", "global");
      await Promise.resolve();
    });
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledTimes(1));
    await view.unmount();
    lateDelete.resolve(undefined);
    await pending;

    expect(mockedRemoveCache).not.toHaveBeenCalled();
  });

  it("invalidates the prior version and immediately adopts the prepared upload", async () => {
    const replacement: ChatBackground = {
      ...ownerA,
      image_url: "/backgrounds/new.jpg",
      updated_at: "a2",
    };
    mockedGet.mockResolvedValueOnce([ownerA]);
    mockedUpload.mockResolvedValueOnce({
      background: replacement,
      preparedUri: "file:///prepared.jpg",
    });
    const view = await render(tree());
    await waitFor(() => expect(latest?.backgrounds).toBeDefined());
    await waitFor(() =>
      expect(view.getByTestId("background-image").props.children).toBe(ownerA.image_url),
    );

    await act(async () => {
      await latest!.upload("global", "global", imageAsset());
    });

    expect(mockedRemoveCache).toHaveBeenCalledWith(ownerA);
    expect(mockedCacheUpload).toHaveBeenCalledWith(replacement, "file:///prepared.jpg");
    expect(view.getByTestId("background-image").props.children).toBe(replacement.image_url);
  });

  it("force reloads metadata when the native upload response omits the background", async () => {
    mockedGet.mockResolvedValueOnce([ownerA]).mockResolvedValueOnce([ownerB]);
    mockedUpload.mockResolvedValueOnce({
      background: null,
      preparedUri: "file:///prepared.jpg",
    });
    const view = await render(tree());
    await waitFor(() =>
      expect(view.getByTestId("background-image").props.children).toBe(ownerA.image_url),
    );

    await act(async () => {
      await latest!.upload("global", "global", imageAsset());
    });

    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(mockedRemoveCache).toHaveBeenCalledWith(ownerA);
    expect(view.getByTestId("background-image").props.children).toBe(ownerB.image_url);
  });

  it("retains the current background and allows retry after a load failure", async () => {
    mockedGet.mockResolvedValueOnce([ownerA]);
    const view = await render(tree());
    await waitFor(() =>
      expect(view.getByTestId("background-image").props.children).toBe(ownerA.image_url),
    );
    mockedGet.mockRejectedValueOnce(new Error("offline"));

    await act(async () => {
      await latest!.load(true);
    });

    expect(view.getByTestId("background-image").props.children).toBe(ownerA.image_url);
    mockedGet.mockResolvedValueOnce([ownerB]);
    await act(async () => {
      await latest!.load(true);
    });
    expect(view.getByTestId("background-image").props.children).toBe(ownerB.image_url);
  });

  it("removes the server setting and every local image cache entry", async () => {
    mockedGet.mockResolvedValueOnce([ownerA]);
    const view = await render(tree());
    await waitFor(() =>
      expect(view.getByTestId("background-image").props.children).toBe(ownerA.image_url),
    );

    await act(async () => {
      await latest!.remove("global", "global");
    });

    expect(mockedDelete).toHaveBeenCalledWith("global", "global");
    expect(mockedRemoveCache).toHaveBeenCalledWith(ownerA);
    expect(view.getByTestId("background-image").props.children).toBe("");
  });
});

function imageAsset() {
  return {
    uri: "file:///picked.jpg",
    width: 1_000,
    height: 1_000,
    mimeType: "image/jpeg",
    fileName: "picked.jpg",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}
