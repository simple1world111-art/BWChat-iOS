import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ImagePickerAsset } from "expo-image-picker";
import type { ReactNode } from "react";
import { ActionSheetIOS } from "react-native";

import CreateMomentScreen, { createMomentPalette } from "@/app/create-moment";
import type { User } from "@/models";

let mockUser: User | null = user("owner-a");
let mockNextDraft = 0;
const mockBack = jest.fn();
const mockLaunchImageLibrary = jest.fn();
const mockPrepareImage = jest.fn();
const mockPrepareVideo = jest.fn();
const mockRemoveDraft = jest.fn();
const mockEnqueue = jest.fn();
const mockT = (key: string, ...args: (string | number)[]) => [key, ...args].join("|");

jest.mock("expo-router", () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  Stack: {
    Screen: ({
      options,
    }: {
      options?: { headerLeft?: () => ReactNode; headerRight?: () => ReactNode };
    }) => (
      <>
        {options?.headerLeft?.()}
        {options?.headerRight?.()}
      </>
    ),
  },
}));

jest.mock("expo-image", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Image: (props: object) => <MockView {...props} /> };
});

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibrary(...args),
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@/api/bwchat", () => ({
  createIdempotencyKey: () => `draft-${++mockNextDraft}`,
}));

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { TopToast: ({ message }: { message: string | null }) => <MockText>{message}</MockText> };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockT }),
}));

jest.mock("@/services/moments/MomentMediaPreparation", () => ({
  prepareMomentImage: (...args: unknown[]) => mockPrepareImage(...args),
  prepareMomentVideo: (...args: unknown[]) => mockPrepareVideo(...args),
  removeMomentDraft: (...args: unknown[]) => mockRemoveDraft(...args),
}));

jest.mock("@/services/moments/MomentUploadQueue", () => ({
  enqueueMomentUpload: (...args: unknown[]) => mockEnqueue(...args),
}));

describe("CreateMoment screen owner and interaction parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = user("owner-a");
    mockNextDraft = 0;
    mockLaunchImageLibrary.mockResolvedValue({ assets: [pickerAsset()], canceled: false });
    mockPrepareImage.mockResolvedValue(preparedImage());
    mockPrepareVideo.mockResolvedValue(preparedVideo());
    mockEnqueue.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("uses the original system surfaces and fixed AppColors values", () => {
    expect(createMomentPalette("light")).toEqual({
      background: "#F2F2F7",
      card: "#FFFFFF",
      text: "#1A1A2E",
      secondaryText: "#9E9EB8",
      tertiaryText: "#C4C4D4",
      separator: "#F0F0F5",
    });
    expect(createMomentPalette("dark")).toEqual({
      background: "#1C1C1E",
      card: "#000000",
      text: "#1A1A2E",
      secondaryText: "#9E9EB8",
      tertiaryText: "#C4C4D4",
      separator: "#F0F0F5",
    });
  });

  it("remounts the whole account-owned draft and cleans only the old owner directory", async () => {
    const view = await render(<CreateMomentScreen />);
    await fireEvent.changeText(screen.getByLabelText("moment.content.placeholder"), "旧账号草稿");
    await fireEvent.press(screen.getByLabelText("moment.addImage"));
    await waitFor(() => expect(screen.getByLabelText("common.delete 1")).toBeTruthy());
    expect(mockPrepareImage).toHaveBeenCalledWith(
      "owner-a",
      "draft-1",
      expect.objectContaining({ uri: "file:///picked.jpg" }),
      0,
    );

    mockUser = user("owner-b");
    await act(async () => {
      view.rerender(<CreateMomentScreen />);
      await Promise.resolve();
    });

    expect(screen.getByLabelText("moment.content.placeholder").props.value).toBe("");
    expect(screen.queryByLabelText("common.delete 1")).toBeNull();
    expect(mockRemoveDraft).toHaveBeenCalledWith("owner-a", "draft-1");
    expect(mockNextDraft).toBe(2);
  });

  it("does not prepare a late picker result after the account changes", async () => {
    const picker = deferred<{ assets: ImagePickerAsset[]; canceled: false }>();
    mockLaunchImageLibrary.mockReturnValueOnce(picker.promise);
    const view = await render(<CreateMomentScreen />);
    await fireEvent.press(screen.getByLabelText("moment.addImage"));
    await waitFor(() => expect(mockLaunchImageLibrary).toHaveBeenCalledTimes(1));

    mockUser = user("owner-b");
    await act(async () => {
      view.rerender(<CreateMomentScreen />);
      await Promise.resolve();
    });
    await act(async () => {
      picker.resolve({ assets: [pickerAsset()], canceled: false });
      await picker.promise;
    });

    expect(mockPrepareImage).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("common.delete 1")).toBeNull();
    expect(mockRemoveDraft).toHaveBeenCalledWith("owner-a", "draft-1");
  });

  it("discards media preparation that finishes after the account-owned composer unmounts", async () => {
    const preparation = deferred<ReturnType<typeof preparedImage>>();
    mockPrepareImage.mockReturnValueOnce(preparation.promise);
    const view = await render(<CreateMomentScreen />);
    await fireEvent.press(screen.getByLabelText("moment.addImage"));
    await waitFor(() => expect(mockPrepareImage).toHaveBeenCalledTimes(1));

    mockUser = user("owner-b");
    await act(async () => {
      view.rerender(<CreateMomentScreen />);
      await Promise.resolve();
    });
    await act(async () => {
      preparation.resolve(preparedImage());
      await preparation.promise;
    });

    expect(screen.queryByLabelText("common.delete 1")).toBeNull();
    expect(screen.getByLabelText("moment.content.placeholder").props.value).toBe("");
    expect(mockRemoveDraft).toHaveBeenCalledWith("owner-a", "draft-1");
  });

  it("publishes once with trimmed native input and keeps the paper plane stable while queuing", async () => {
    const queued = deferred<void>();
    mockEnqueue.mockReturnValueOnce(queued.promise);
    await render(<CreateMomentScreen />);
    await fireEvent.changeText(screen.getByLabelText("moment.content.placeholder"), "  新动态  ");

    const publish = screen.getByLabelText("common.publish");
    await fireEvent.press(publish);
    await fireEvent.press(publish);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith({
      owner: expect.objectContaining({ user_id: "owner-a" }),
      clientRequestId: "draft-1",
      content: "新动态",
      media: [],
    });
    expect(screen.getByLabelText("common.publish").props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    expect(screen.getByText("paperplane.fill")).toBeTruthy();

    await act(async () => {
      queued.resolve();
      await queued.promise;
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("publishes prepared media with the selected native unlock price", async () => {
    const actionSheet = jest
      .spyOn(ActionSheetIOS, "showActionSheetWithOptions")
      .mockImplementation((_options, callback) => callback(2));
    await render(<CreateMomentScreen />);
    await fireEvent.press(screen.getByLabelText("moment.addImage"));
    await waitFor(() => expect(screen.getByLabelText("common.delete 1")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("moment.goldCoinUnlock，moment.unlock.none"));
    await waitFor(() =>
      expect(screen.getByLabelText("moment.goldCoinUnlock，moment.unlock.price|50")).toBeTruthy(),
    );
    await fireEvent.press(screen.getByLabelText("common.publish"));

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockEnqueue).toHaveBeenCalledWith({
      owner: expect.objectContaining({ user_id: "owner-a" }),
      clientRequestId: "draft-1",
      content: "",
      media: [
        {
          kind: "image",
          uri: "file:///documents/image.jpg",
          preview_uri: "file:///documents/preview.jpg",
          filename: "image.jpg",
          mime_type: "image/jpeg",
        },
      ],
      unlockPriceGoldCoins: 50,
    });
    actionSheet.mockRestore();
  });

  it("keeps every successfully prepared image when another selected item fails", async () => {
    mockLaunchImageLibrary.mockResolvedValueOnce({
      assets: [pickerAsset("first.jpg"), pickerAsset("second.jpg")],
      canceled: false,
    });
    mockPrepareImage
      .mockRejectedValueOnce(new Error("broken first image"))
      .mockResolvedValueOnce(preparedImage());
    await render(<CreateMomentScreen />);
    await fireEvent.press(screen.getByLabelText("moment.addImage"));

    await waitFor(() => expect(screen.getByLabelText("common.delete 1")).toBeTruthy());
    expect(mockPrepareImage).toHaveBeenNthCalledWith(
      1,
      "owner-a",
      "draft-1",
      expect.objectContaining({ uri: "file:///first.jpg" }),
      0,
    );
    expect(mockPrepareImage).toHaveBeenNthCalledWith(
      2,
      "owner-a",
      "draft-1",
      expect.objectContaining({ uri: "file:///second.jpg" }),
      1,
    );
    expect(screen.queryByText("moment.media.error.loadFailed")).toBeNull();
  });

  it("keeps a failed queue attempt on the page and allows an explicit retry", async () => {
    mockEnqueue
      .mockRejectedValueOnce(new Error("outbox unavailable"))
      .mockResolvedValueOnce(undefined);
    await render(<CreateMomentScreen />);
    await fireEvent.changeText(screen.getByLabelText("moment.content.placeholder"), "重试动态");
    await fireEvent.press(screen.getByLabelText("common.publish"));

    await waitFor(() => expect(screen.getByText("outbox unavailable")).toBeTruthy());
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByLabelText("common.publish").props.accessibilityState).toEqual({
      busy: false,
      disabled: false,
    });
    await fireEvent.press(screen.getByLabelText("common.publish"));
    await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });

  it("removes the account-owned staged draft when backing out before publish", async () => {
    const view = await render(<CreateMomentScreen />);
    await fireEvent.press(screen.getByLabelText("moment.addImage"));
    await waitFor(() => expect(screen.getByLabelText("common.delete 1")).toBeTruthy());
    await fireEvent.press(screen.getByLabelText("common.back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
    await act(async () => view.unmount());
    expect(mockRemoveDraft).toHaveBeenCalledWith("owner-a", "draft-1");
  });

  it("lets the old owner's queued job finish without navigating the new owner", async () => {
    const queued = deferred<void>();
    mockEnqueue.mockReturnValueOnce(queued.promise);
    const view = await render(<CreateMomentScreen />);
    await fireEvent.changeText(screen.getByLabelText("moment.content.placeholder"), "旧账号发布");
    await fireEvent.press(screen.getByLabelText("common.publish"));
    await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1));

    mockUser = user("owner-b");
    await act(async () => {
      view.rerender(<CreateMomentScreen />);
      await Promise.resolve();
    });
    await act(async () => {
      queued.resolve();
      await queued.promise;
    });

    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByLabelText("moment.content.placeholder").props.value).toBe("");
    expect(mockRemoveDraft).not.toHaveBeenCalledWith("owner-a", "draft-1");
  });
});

function user(userId: string): User {
  return {
    user_id: userId,
    username: userId,
    nickname: userId,
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
  };
}

function pickerAsset(filename = "picked.jpg"): ImagePickerAsset {
  return {
    assetId: filename,
    fileName: filename,
    fileSize: 1_000,
    height: 900,
    mimeType: "image/jpeg",
    type: "image",
    uri: `file:///${filename}`,
    width: 1_200,
  };
}

function preparedImage() {
  return {
    id: "prepared-image",
    kind: "image" as const,
    uri: "file:///documents/image.jpg",
    preview_uri: "file:///documents/preview.jpg",
    filename: "image.jpg",
    mime_type: "image/jpeg",
  };
}

function preparedVideo() {
  return {
    id: "prepared-video",
    kind: "video" as const,
    uri: "file:///documents/video.mp4",
    preview_uri: "file:///documents/preview_video.jpg",
    filename: "video.mp4",
    mime_type: "video/mp4",
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}
