import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";

import { getProfile, getWalletGoldCoinBalance } from "@/api/bwchat";
import ProfileScreen, { profileScreenMetrics } from "@/app/(tabs)/profile";
import type { User } from "@/models";
import { defaultRemoteConfig } from "@/services/remote-config/defaultConfig";
import type { RemoteConfig } from "@/services/remote-config/types";

const mockUpdateUser = jest.fn<Promise<void>, [User]>();
const mockRefreshConfig = jest.fn<Promise<void>, []>();
const mockUseRemoteConfig = jest.fn();
const mockTranslate = (key: string, ...args: (string | number)[]) =>
  args.length > 0 ? `${key}:${args.join(",")}` : key;

jest.mock("expo-router", () => {
  const React = jest.requireActual("react") as typeof import("react");
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, [effect]),
  };
});

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { LinearGradient: MockView };
});

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("react-native-qrcode-svg", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return function MockQRCode({ value }: { value: string }) {
    return <MockText>{`qr:${value}`}</MockText>;
  };
});

jest.mock("@/api/bwchat", () => ({
  getProfile: jest.fn(),
  getWalletGoldCoinBalance: jest.fn(),
}));

jest.mock("@/components/Avatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { Avatar: ({ name }: { name: string }) => <MockText>{`avatar:${name}`}</MockText> };
});

jest.mock("@/components/RootTabTitle", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    RootTabTitle: ({ localizedKey }: { localizedKey: string }) => (
      <MockText>{localizedKey}</MockText>
    ),
  };
});

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    TopToast: ({ message }: { message: string | null }) =>
      message ? <MockText accessibilityRole="alert">{message}</MockText> : null,
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: owner, updateUser: mockUpdateUser }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    activeLanguage: "zh-Hans",
    t: mockTranslate,
  }),
}));

jest.mock("@/providers/RemoteConfigProvider", () => ({
  useRemoteConfig: () => mockUseRemoteConfig(),
}));

const requestProfile = jest.mocked(getProfile);
const requestWallet = jest.mocked(getWalletGoldCoinBalance);

describe("Profile screen interactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateUser.mockResolvedValue();
    mockRefreshConfig.mockResolvedValue();
    requestProfile.mockResolvedValue(owner);
    requestWallet.mockResolvedValue(42);
    mockUseRemoteConfig.mockReturnValue({
      config: defaultRemoteConfig,
      refresh: mockRefreshConfig,
    });
  });

  it("locks the native hero, grouped-card and divider geometry", () => {
    expect(profileScreenMetrics).toEqual({
      contentGap: 14,
      horizontalInset: 16,
      heroVerticalInset: 18,
      heroRadius: 18,
      heroGap: 14,
      avatarFrame: 82,
      avatarSize: 76,
      bioLineHeight: 20,
      bioVerticalCompensation: -1.5,
      actionHeight: 42,
      featureGap: 12,
      cardVerticalInset: 10,
      cardRadius: 14,
      rowMinHeight: 50,
      rowVerticalInset: 5,
      iconSize: 40,
      dividerHeight: 21,
      dividerLineHeight: 1,
      dividerLeadingInset: 55,
    });

    const heroHeight =
      profileScreenMetrics.heroVerticalInset * 2 +
      profileScreenMetrics.avatarFrame +
      profileScreenMetrics.heroGap * 2 +
      profileScreenMetrics.bioLineHeight +
      profileScreenMetrics.bioVerticalCompensation * 2 +
      profileScreenMetrics.actionHeight;
    const rowHeight = Math.max(
      profileScreenMetrics.rowMinHeight,
      profileScreenMetrics.iconSize + profileScreenMetrics.rowVerticalInset * 2,
    );
    expect(heroHeight).toBe(205);
    expect(profileScreenMetrics.cardVerticalInset * 2 + rowHeight).toBe(70);
    expect(
      profileScreenMetrics.cardVerticalInset * 2 +
        rowHeight * 2 +
        profileScreenMetrics.dividerHeight,
    ).toBe(141);
  });

  it("refreshes both native data sources, updates auth and renders localized wallet state", async () => {
    const view = await render(<ProfileScreen />);

    await waitFor(() => expect(view.getByText("profile.wallet.balance:42")).toBeTruthy());
    expect(requestProfile).toHaveBeenCalledTimes(1);
    expect(requestWallet).toHaveBeenCalledTimes(1);
    expect(mockRefreshConfig).toHaveBeenCalledTimes(1);
    expect(mockUpdateUser).toHaveBeenCalledWith(owner);
    expect(view.getByText("profile.posts")).toBeTruthy();
    expect(view.getByText("follow.followers")).toBeTruthy();
    expect(view.getByText("follow.following")).toBeTruthy();
  });

  it("copies the exact native profile URL and reports success with a toast", async () => {
    const view = await render(<ProfileScreen />);
    await waitFor(() => expect(requestProfile).toHaveBeenCalled());

    fireEvent.press(view.getByLabelText("profile.more.share"));
    await waitFor(() => expect(view.getByLabelText("profile.more.copyLink")).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByLabelText("profile.more.copyLink"));
    });

    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith("bwchat://profile/owner"),
    );
    expect(view.getByText("profile.more.linkCopied")).toBeTruthy();
  });

  it("honors server-driven screen routes instead of a hardcoded profile switch", async () => {
    const config: RemoteConfig = {
      ...defaultRemoteConfig,
      profileSections: [
        {
          id: "profile_core",
          items: [
            {
              id: "wallet",
              titleKey: "profile.wallet",
              route: { type: "screen", screenId: "remote-wallet" },
            },
          ],
        },
      ],
    };
    mockUseRemoteConfig.mockReturnValue({ config, refresh: mockRefreshConfig });
    const view = await render(<ProfileScreen />);
    await waitFor(() => expect(view.getByLabelText(/^wallet/u)).toBeTruthy());

    fireEvent.press(view.getByLabelText(/^wallet/u));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({
        pathname: "/dynamic-screen/[id]",
        params: { id: "remote-wallet" },
      }),
    );
  });
});

const owner: User = {
  user_id: "me",
  username: "owner",
  nickname: "Owner",
  avatar_url: "/avatars/me.jpg",
  bio: "Original bio",
  gender: "",
  birthday: "",
  location: "",
  posts_count: 11,
  following_count: 2,
  follower_count: 3,
  followed_by_me: false,
  follows_me: false,
  is_friend: false,
};
