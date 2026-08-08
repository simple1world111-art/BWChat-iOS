import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Alert } from "react-native";

import SettingsScreen from "@/app/settings";
import {
  clearAllAccountData,
  clearCurrentAccountData,
  clearVideoCache,
  formattedVideoCacheSize,
} from "@/services/cache/AppCacheService";

const mockSignOut = jest.fn<Promise<void>, []>();
const mockSubscribe = jest.fn<() => void, [string, (size: string) => void]>(() => () => undefined);

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
}));

jest.mock("@/components/profile/ProfileSettingsChrome", () => {
  const {
    Pressable: MockPressable,
    Text: MockText,
    View: MockView,
  } = jest.requireActual("react-native");
  return {
    ProfileGroupedCard: ({ children }: { children: ReactNode }) => <MockView>{children}</MockView>,
    ProfileRowDivider: () => null,
    ProfileSettingsRow: ({
      title,
      trailingText,
      onPress,
      danger,
      showChevron,
    }: {
      title: string;
      trailingText?: string;
      onPress: () => void;
      danger?: boolean;
      showChevron?: boolean;
    }) => (
      <MockPressable
        accessibilityLabel={title}
        accessibilityRole="button"
        accessibilityState={{ selected: danger === true }}
        data-show-chevron={showChevron}
        onPress={onPress}
      >
        <MockText>{title}</MockText>
        {trailingText ? <MockText>{trailingText}</MockText> : null}
      </MockPressable>
    ),
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({
    user: { user_id: "test1", username: "test1" },
    signOut: mockSignOut,
  }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    activeLanguage: "zh-Hans",
    selectedLanguageName: "简体中文",
    t: (key: string) => key,
  }),
}));

jest.mock("@/localization/updateCopy", () => ({
  updateCopy: () => ({ settingsEntry: "update.settings.entry" }),
}));

jest.mock("@/services/cache/AppCacheService", () => ({
  clearAllAccountData: jest.fn(),
  clearCurrentAccountData: jest.fn(),
  clearVideoCache: jest.fn(),
  formatVideoCacheSize: jest.fn(() => "Zero KB"),
  formattedVideoCacheSize: jest.fn(),
  subscribeVideoCacheSize: (ownerId: string, listener: (size: string) => void) =>
    mockSubscribe(ownerId, listener),
}));

const clearAll = jest.mocked(clearAllAccountData);
const clearCurrent = jest.mocked(clearCurrentAccountData);
const clearVideo = jest.mocked(clearVideoCache);
const readVideoSize = jest.mocked(formattedVideoCacheSize);

describe("Profile Settings screen interactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignOut.mockResolvedValue();
    clearAll.mockResolvedValue();
    clearCurrent.mockResolvedValue();
    clearVideo.mockResolvedValue();
    readVideoSize.mockResolvedValue("12.5 MB");
  });

  it("renders every native row plus the required EAS update entry and routes exactly", async () => {
    const view = await render(<SettingsScreen />);
    await waitFor(() => expect(view.getByText("12.5 MB")).toBeTruthy());
    expect(view.getByText("简体中文")).toBeTruthy();
    expect(view.getByText("test1")).toBeTruthy();

    await fireEvent.press(view.getByLabelText("settings.language"));
    expect(router.push).toHaveBeenLastCalledWith("/language-settings");
    await fireEvent.press(view.getByLabelText("chatBackground.globalTitle"));
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: "/chat-background-settings",
      params: {
        targetType: "global",
        targetId: "global",
        title: "chatBackground.globalTitle",
      },
    });
    await fireEvent.press(view.getByLabelText("settings.usernameReset"));
    expect(router.push).toHaveBeenLastCalledWith("/username-reset");
    await fireEvent.press(view.getByLabelText("settings.changePassword"));
    expect(router.push).toHaveBeenLastCalledWith("/change-password");
    await fireEvent.press(view.getByLabelText("update.settings.entry"));
    expect(router.push).toHaveBeenLastCalledWith("/update-settings");
  });

  it("binds all destructive confirmations to the exact current/global actions", async () => {
    const alert = jest.spyOn(Alert, "alert");
    const view = await render(<SettingsScreen />);

    await fireEvent.press(view.getByLabelText("settings.cache.video"));
    invokeDestructiveAlert(alert);
    expect(clearVideo).toHaveBeenCalledWith("test1");

    await fireEvent.press(view.getByLabelText("settings.cache.account.clear"));
    invokeDestructiveAlert(alert);
    expect(clearCurrent).toHaveBeenCalledWith("test1");

    await fireEvent.press(view.getByLabelText("settings.cache.all.clear"));
    invokeDestructiveAlert(alert);
    expect(clearAll).toHaveBeenCalledWith("test1");

    await fireEvent.press(view.getByLabelText("settings.logout"));
    invokeDestructiveAlert(alert);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});

function invokeDestructiveAlert(alert: jest.SpyInstance): void {
  const buttons = alert.mock.calls.at(-1)?.[2] as
    { style?: string; onPress?: () => void }[] | undefined;
  const destructive = buttons?.find((button) => button.style === "destructive");
  expect(destructive).toBeDefined();
  destructive?.onPress?.();
}
