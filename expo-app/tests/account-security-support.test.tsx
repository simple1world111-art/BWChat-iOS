import { render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import AccountSecurityScreen from "@/app/account-security";
import { getAccountSecurity } from "@/services/account/AccountComplianceService";
import { defaultRemoteConfig } from "@/services/remote-config/defaultConfig";
import {
  persistLastKnownGoodSupportEmail,
  resetSupportEmailMemoryForTests,
} from "@/services/account/SupportEmailService";

const mockRefreshConfig = jest.fn<Promise<void>, [{ ignoreETag?: boolean }?]>();
const mockTranslate = (key: string) => key;
let mockRemoteConfig = remoteContext();

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
}));

jest.mock("@/components/ui/SilentRefreshControl", () => ({
  SilentRefreshControl: () => null,
}));

jest.mock("@/components/profile/ProfileSettingsChrome", () => {
  const {
    Pressable: MockPressable,
    Text: MockText,
    View: MockView,
  } = jest.requireActual("react-native");
  return {
    ProfileGroupedCard: ({ children }: { children: React.ReactNode }) => (
      <MockView>{children}</MockView>
    ),
    ProfileNoticeBanner: ({ message }: { message: string }) => <MockText>{message}</MockText>,
    ProfileRowDivider: () => null,
    ProfileSettingsRow: ({
      disabled,
      onPress,
      title,
      trailingText,
    }: {
      disabled?: boolean;
      onPress: () => void;
      title: string;
      trailingText?: string;
    }) => (
      <MockPressable
        accessibilityLabel={title}
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={onPress}
      >
        <MockText>{`${title}:${trailingText ?? ""}`}</MockText>
      </MockPressable>
    ),
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ isSessionUnverified: false }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockTranslate }),
}));

jest.mock("@/providers/RemoteConfigProvider", () => ({
  useRemoteConfig: () => mockRemoteConfig,
}));

jest.mock("@/services/account/AccountComplianceService", () => ({
  accountComplianceFallbackMessage: () => "account-error",
  getAccountSecurity: jest.fn(),
}));

const requestSecurity = jest.mocked(getAccountSecurity);

describe("account security support configuration", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    resetSupportEmailMemoryForTests();
    mockRefreshConfig.mockResolvedValue();
    requestSecurity.mockResolvedValue({
      email: { verified: false },
      deletionStatus: "active",
    });
    mockRemoteConfig = remoteContext();
  });

  it("shows a loading state before the server-configured support email arrives", async () => {
    mockRemoteConfig = remoteContext({ isRefreshing: true });
    const view = await render(<AccountSecurityScreen />);

    expect(view.getByText("account.contactSupport:common.loading")).toBeTruthy();
    await waitFor(() => expect(requestSecurity).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(view.getByText("account.email.security:account.email.unbound")).toBeTruthy(),
    );

    mockRemoteConfig = remoteContext({
      config: {
        ...defaultRemoteConfig,
        account: {
          ...defaultRemoteConfig.account!,
          supportEmail: "support@example.com",
        },
      },
    });
    await view.rerender(<AccountSecurityScreen />);

    expect(view.getByText("account.contactSupport:support@example.com")).toBeTruthy();
    expect(view.queryByText("account.contactSupport:account.support.notConfigured")).toBeNull();
  });

  it("forces a non-ETag refresh and distinguishes load failure from missing server config", async () => {
    mockRemoteConfig = remoteContext({ error: "network failed" });
    const view = await render(<AccountSecurityScreen />);

    await waitFor(() => expect(mockRefreshConfig).toHaveBeenCalledWith({ ignoreETag: true }));
    await waitFor(() =>
      expect(
        view.getByText("account.contactSupport:account.support.unavailableShort"),
      ).toBeTruthy(),
    );
    expect(view.queryByText("account.contactSupport:account.support.notConfigured")).toBeNull();
  });

  it("retains the last-known-good email when the network refresh fails", async () => {
    await persistLastKnownGoodSupportEmail("last-good@example.com");
    resetSupportEmailMemoryForTests();
    mockRemoteConfig = remoteContext({ error: "network failed" });
    const view = await render(<AccountSecurityScreen />);

    await waitFor(() =>
      expect(view.getByText("account.contactSupport:last-good@example.com")).toBeTruthy(),
    );
    expect(mockRefreshConfig).not.toHaveBeenCalled();
    expect(view.queryByText("account.contactSupport:account.support.notConfigured")).toBeNull();
  });

  it("shows not configured only after refresh returns no valid email and no cache exists", async () => {
    const view = await render(<AccountSecurityScreen />);

    await waitFor(() => expect(mockRefreshConfig).toHaveBeenCalledWith({ ignoreETag: true }));
    await waitFor(() =>
      expect(view.getByText("account.contactSupport:account.support.notConfigured")).toBeTruthy(),
    );
  });
});

function remoteContext(
  overrides: Partial<{
    config: typeof defaultRemoteConfig;
    error: string | null;
    isRefreshing: boolean;
  }> = {},
) {
  return {
    config: overrides.config ?? defaultRemoteConfig,
    error: overrides.error ?? null,
    isRefreshing: overrides.isRefreshing ?? false,
    refresh: mockRefreshConfig,
  };
}
