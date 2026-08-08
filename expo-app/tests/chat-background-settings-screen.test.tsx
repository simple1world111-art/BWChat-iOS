import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import { Alert } from "react-native";

import { APIError } from "@/api/client";
import ChatBackgroundSettingsScreen from "@/app/chat-background-settings";
import type { ChatBackground } from "@/services/chat-appearance/ChatAppearanceService";

const mockLoad = jest.fn();
const mockUpload = jest.fn();
const mockRemove = jest.fn();
let mockExact: ChatBackground | null = null;
let mockEffective: ChatBackground | null = null;

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({
    targetType: "dm",
    targetId: "friend/1",
    title: "好友背景",
  }),
}));

jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText>,
  };
});

jest.mock("@/components/chat/ChatBackgroundLayer", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    ChatBackgroundLayer: ({ background }: { background: ChatBackground | null }) => (
      <MockText>{`layer:${background?.image_url ?? "default"}`}</MockText>
    ),
  };
});

jest.mock("@/providers/ChatAppearanceProvider", () => ({
  useChatAppearance: () => ({
    backgrounds: {},
    isLoading: false,
    load: mockLoad,
    exact: () => mockExact,
    effective: () => mockEffective,
    upload: mockUpload,
    remove: mockRemove,
  }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

describe("chat background settings interactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExact = null;
    mockEffective = null;
    mockLoad.mockResolvedValue(undefined);
    mockUpload.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
  });

  afterEach(() => jest.restoreAllMocks());

  it("loads on entry and exposes the original default gray state", async () => {
    await render(<ChatBackgroundSettingsScreen />);
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(1));
    expect(screen.getByText("layer:default")).toBeTruthy();
    expect(screen.getByText("chatBackground.defaultGray")).toBeTruthy();
    expect(screen.getByLabelText("chatBackground.restoreChat").props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });
  });

  it("selects one full-quality photo and forwards the exact target", async () => {
    const asset = {
      uri: "file:///picked.jpg",
      width: 1_200,
      height: 800,
      mimeType: "image/jpeg",
      fileName: "picked.jpg",
    };
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [asset],
    });
    await render(<ChatBackgroundSettingsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText("chatBackground.chooseFromAlbum"));
    });

    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      quality: 1,
    });
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(mockUpload).toHaveBeenCalledWith("dm", "friend/1", asset);
  });

  it("shows server API errors but hides arbitrary implementation errors", async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///picked.jpg",
          width: 500,
          height: 500,
          mimeType: "image/jpeg",
          fileName: "picked.jpg",
        },
      ],
    });
    mockUpload.mockRejectedValueOnce(new APIError("服务器拒绝图片", 422));
    await render(<ChatBackgroundSettingsScreen />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText("chatBackground.chooseFromAlbum"));
    });
    expect(Alert.alert).toHaveBeenLastCalledWith("common.operationFailed", "服务器拒绝图片");

    mockUpload.mockRejectedValueOnce(new Error("internal path leaked"));
    await act(async () => {
      fireEvent.press(screen.getByLabelText("chatBackground.chooseFromAlbum"));
    });
    expect(Alert.alert).toHaveBeenLastCalledWith(
      "common.operationFailed",
      "chatBackground.uploadFailed",
    );

    mockUpload.mockRejectedValueOnce(
      new APIError("api.decodingError", 200, undefined, "decoding_error"),
    );
    await act(async () => {
      fireEvent.press(screen.getByLabelText("chatBackground.chooseFromAlbum"));
    });
    expect(Alert.alert).toHaveBeenLastCalledWith("common.operationFailed", "api.decodingError");
  });

  it("suppresses a late upload error after the settings screen unmounts", async () => {
    const lateUpload = deferred<void>();
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///picked.jpg",
          width: 500,
          height: 500,
          mimeType: "image/jpeg",
          fileName: "picked.jpg",
        },
      ],
    });
    mockUpload.mockImplementationOnce(() => lateUpload.promise);
    const view = await render(<ChatBackgroundSettingsScreen />);

    await fireEvent.press(screen.getByLabelText("chatBackground.chooseFromAlbum"));
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    await view.unmount();
    lateUpload.reject(new APIError("late failure", 422));
    await lateUpload.promise.catch(() => undefined);

    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("restores only an exact chat background and keeps global fallback separate", async () => {
    mockExact = {
      target_type: "dm",
      target_id: "friend/1",
      image_url: "/backgrounds/exact.jpg",
    };
    mockEffective = mockExact;
    await render(<ChatBackgroundSettingsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText("chatBackground.restoreChat"));
    });

    expect(mockRemove).toHaveBeenCalledWith("dm", "friend/1");
    expect(screen.getByText("layer:/backgrounds/exact.jpg")).toBeTruthy();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}
