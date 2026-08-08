import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";

import { getProfile, updateProfile, uploadAvatar } from "@/api/bwchat";
import EditProfileScreen from "@/app/edit-profile";
import type { User } from "@/models";
import { clearImageCache } from "@/services/cache/ImageCacheService";

const mockUpdateUser = jest.fn<Promise<void>, [User]>();
const mockSwiftEnvironment = jest.fn();
let mockAuthUser: User | null = userFixture();

jest.mock("expo-router", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    router: { back: jest.fn() },
    Stack: {
      Screen: ({
        options,
      }: {
        options: { headerLeft?: () => React.ReactNode; headerRight?: () => React.ReactNode };
      }) => (
        <MockView>
          {options.headerLeft?.()}
          {options.headerRight?.()}
        </MockView>
      ),
    },
  };
});

jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Current: "current" },
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@expo/ui/swift-ui", () => {
  const {
    Pressable: MockPressable,
    Text: MockText,
    View: MockView,
  } = jest.requireActual("react-native");
  return {
    Host: ({ children }: { children: React.ReactNode }) => <MockView>{children}</MockView>,
    Picker: ({
      children,
      onSelectionChange,
      selection,
    }: {
      children: React.ReactNode;
      onSelectionChange?: (selection: string) => void;
      selection?: string;
    }) => (
      <MockPressable
        accessibilityLabel="mock-gender-picker"
        onPress={() => onSelectionChange?.("female")}
      >
        <MockText>{selection}</MockText>
        {children}
      </MockPressable>
    ),
    DatePicker: ({ onDateChange }: { onDateChange?: (date: Date) => void }) => (
      <MockPressable
        accessibilityLabel="mock-date-picker"
        onPress={() => onDateChange?.(new Date(2000, 4, 6, 12))}
      >
        <MockText>mock-date-picker</MockText>
      </MockPressable>
    ),
    Text: ({ children }: { children: React.ReactNode }) => <MockText>{children}</MockText>,
  };
});

jest.mock("@expo/ui/swift-ui/modifiers", () => ({
  accessibilityLabel: jest.fn(),
  datePickerStyle: jest.fn(),
  environment: (...args: unknown[]) => mockSwiftEnvironment(...args),
  labelsHidden: jest.fn(),
  pickerStyle: jest.fn(),
  tag: jest.fn(),
}));

jest.mock("@/api/bwchat", () => ({
  getProfile: jest.fn(),
  updateProfile: jest.fn(),
  uploadAvatar: jest.fn(),
}));

jest.mock("@/components/Avatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { Avatar: ({ name }: { name: string }) => <MockText>{`avatar:${name}`}</MockText> };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: mockAuthUser,
    updateUser: mockUpdateUser,
  }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    activeLanguage: "ja",
    t: (key: string) => key,
  }),
}));

jest.mock("@/services/cache/ImageCacheService", () => ({ clearImageCache: jest.fn() }));

const requestProfile = jest.mocked(getProfile);
const saveProfile = jest.mocked(updateProfile);
const requestAvatarUpload = jest.mocked(uploadAvatar);
const clearImages = jest.mocked(clearImageCache);

describe("EditProfile screen interactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser = userFixture();
    mockUpdateUser.mockResolvedValue();
    clearImages.mockResolvedValue();
  });

  it("saves all five original fields, updates auth and returns", async () => {
    const updated = userFixture({ nickname: "New Owner", gender: "female" });
    saveProfile.mockResolvedValueOnce(updated);
    const view = await render(<EditProfileScreen />);

    await fireEvent.changeText(view.getByLabelText("profile.nickname"), "New Owner");
    await fireEvent.press(view.getByLabelText("mock-gender-picker"));
    await fireEvent.press(view.getByText("common.save"));

    await waitFor(() =>
      expect(saveProfile).toHaveBeenCalledWith({
        nickname: "New Owner",
        bio: "Original bio",
        gender: "female",
        birthday: "2001-02-03",
        location: "Tokyo",
      }),
    );
    expect(mockUpdateUser).toHaveBeenCalledWith(updated);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("enforces the native bio limit, birthday wheel/clear flow and whitespace save gate", async () => {
    saveProfile.mockResolvedValue(userFixture());
    const view = await render(<EditProfileScreen />);

    await fireEvent.changeText(view.getByLabelText("profile.bio"), "a".repeat(170));
    expect(view.getByDisplayValue("a".repeat(150))).toBeTruthy();

    await fireEvent.press(view.getByLabelText("profile.birthday"));
    await fireEvent.press(view.getByLabelText("mock-date-picker"));
    expect(view.getByText(/2000/u)).toBeTruthy();
    await fireEvent.press(view.getByText("profile.birthday.clear"));

    await fireEvent.press(view.getByText("common.save"));
    await waitFor(() =>
      expect(saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({ bio: "a".repeat(150), birthday: "" }),
      ),
    );

    await fireEvent.changeText(view.getByLabelText("profile.nickname"), " \t ");
    await fireEvent.press(view.getByText("common.save"));
    expect(saveProfile).toHaveBeenCalledTimes(1);
  });

  it("does not publish an old account save response after the authenticated owner changes", async () => {
    let resolveSave!: (value: User) => void;
    saveProfile.mockImplementationOnce(
      () => new Promise<User>((resolve) => (resolveSave = resolve)),
    );
    const view = await render(<EditProfileScreen />);

    await fireEvent.press(view.getByText("common.save"));
    await waitFor(() => expect(saveProfile).toHaveBeenCalledTimes(1));

    await act(async () => {
      mockAuthUser = userFixture({ user_id: "other", nickname: "Other" });
      view.rerender(<EditProfileScreen />);
    });
    await waitFor(() => expect(view.getByDisplayValue("Other")).toBeTruthy());
    await act(async () => resolveSave(userFixture({ nickname: "Old Owner Updated" })));

    await waitFor(() => expect(view.queryByText("Old Owner Updated")).toBeNull());
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  it("does not navigate after an auth persistence wait outlives the editing account", async () => {
    let finishUpdate!: () => void;
    mockUpdateUser.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishUpdate = resolve)),
    );
    saveProfile.mockResolvedValueOnce(userFixture({ nickname: "Saved Owner" }));
    const view = await render(<EditProfileScreen />);

    await fireEvent.press(view.getByText("common.save"));
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));

    await act(async () => {
      mockAuthUser = userFixture({ user_id: "other", nickname: "Other" });
      view.rerender(<EditProfileScreen />);
    });
    await waitFor(() => expect(view.getByDisplayValue("Other")).toBeTruthy());
    await act(async () => finishUpdate());

    expect(router.back).not.toHaveBeenCalled();
  });

  it("uploads one full-quality image, reloads the profile and clears the full image cache", async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///picked.heic",
          width: 1_200,
          height: 900,
          fileName: "picked.heic",
          mimeType: "image/heic",
        },
      ],
    });
    const updated = userFixture({ avatar_url: "/avatars/new.jpg" });
    requestAvatarUpload.mockResolvedValueOnce("/avatars/new.jpg");
    requestProfile.mockResolvedValueOnce(updated);
    const view = await render(<EditProfileScreen />);

    await fireEvent.press(view.getByLabelText("profile.avatar.change"));

    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith(updated));

    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      quality: 1,
      selectionLimit: 1,
      preferredAssetRepresentationMode: "current",
    });
    expect(requestAvatarUpload).toHaveBeenCalledWith("file:///picked.heic");
    expect(requestProfile).toHaveBeenCalledTimes(1);
    expect(clearImages).toHaveBeenCalledTimes(1);
    expect(mockUpdateUser).toHaveBeenCalledWith(updated);
  });

  it("keeps photo cancellation silent and stops an upload failure before reload/cache clear", async () => {
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValueOnce({ canceled: true, assets: null });
    const view = await render(<EditProfileScreen />);

    await fireEvent.press(view.getByLabelText("profile.avatar.change"));
    expect(requestAvatarUpload).not.toHaveBeenCalled();

    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///failed.jpg", width: 100, height: 100 }],
    });
    requestAvatarUpload.mockRejectedValueOnce(new Error("upload failed"));
    await fireEvent.press(view.getByLabelText("profile.avatar.change"));

    await waitFor(() => expect(view.getByText("upload failed")).toBeTruthy());
    expect(requestProfile).not.toHaveBeenCalled();
    expect(clearImages).not.toHaveBeenCalled();
  });

  it("clears avatar cache without surfacing a refresh error when cached profile remains", async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///picked.heic", width: 1_200, height: 900 }],
    });
    requestAvatarUpload.mockResolvedValueOnce("/avatars/new.jpg");
    requestProfile.mockRejectedValueOnce(new Error("refresh failed"));
    const view = await render(<EditProfileScreen />);

    await fireEvent.press(view.getByLabelText("profile.avatar.change"));

    await waitFor(() => expect(clearImages).toHaveBeenCalledTimes(1));
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(view.queryByText("refresh failed")).toBeNull();
  });

  it("preserves unsaved fields when avatar reload returns a Swift-equal profile", async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///picked.heic", width: 1_200, height: 900 }],
    });
    requestAvatarUpload.mockResolvedValueOnce("/avatars/me.jpg");
    requestProfile.mockResolvedValueOnce(userFixture());
    const view = await render(<EditProfileScreen />);

    await fireEvent.changeText(view.getByLabelText("profile.nickname"), "Unsaved draft");
    await fireEvent.press(view.getByLabelText("profile.avatar.change"));

    await waitFor(() => expect(clearImages).toHaveBeenCalledTimes(1));
    expect(view.getByDisplayValue("Unsaved draft")).toBeTruthy();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("surfaces avatar profile-reload failure only when no cached profile exists", async () => {
    mockAuthUser = null;
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///picked.heic", width: 1_200, height: 900 }],
    });
    requestAvatarUpload.mockResolvedValueOnce("/avatars/new.jpg");
    requestProfile.mockRejectedValueOnce(new Error("refresh failed without cache"));
    const view = await render(<EditProfileScreen />);

    await fireEvent.press(view.getByLabelText("profile.avatar.change"));

    await waitFor(() => expect(view.getByText("refresh failed without cache")).toBeTruthy());
    expect(clearImages).toHaveBeenCalledTimes(1);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("treats native-style image cache clearing as nonthrowing after avatar success", async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///picked.heic", width: 1_200, height: 900 }],
    });
    requestAvatarUpload.mockResolvedValueOnce("/avatars/me.jpg");
    requestProfile.mockResolvedValueOnce(userFixture());
    clearImages.mockRejectedValueOnce(new Error("cache cleanup failed"));
    const view = await render(<EditProfileScreen />);

    await fireEvent.press(view.getByLabelText("profile.avatar.change"));

    await waitFor(() => expect(clearImages).toHaveBeenCalledTimes(1));
    expect(view.queryByText("cache cleanup failed")).toBeNull();
  });

  it("uses the app language for the native wheel and keeps failures on the page", async () => {
    saveProfile.mockRejectedValueOnce(new Error("server rejected profile"));
    const view = await render(<EditProfileScreen />);

    await fireEvent.press(view.getByLabelText("profile.birthday"));
    expect(mockSwiftEnvironment).toHaveBeenCalledWith("locale", "ja");
    await fireEvent.press(view.getByText("common.save"));

    await waitFor(() => expect(view.getByText("server rejected profile")).toBeTruthy());
    expect(router.back).not.toHaveBeenCalled();
  });
});

function userFixture(change: Partial<User> = {}): User {
  return {
    user_id: "me",
    username: "owner",
    nickname: "Owner",
    avatar_url: "/avatars/me.jpg",
    bio: "Original bio",
    gender: "male",
    birthday: "2001-02-03",
    location: "Tokyo",
    following_count: 0,
    follower_count: 0,
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
    ...change,
  };
}
