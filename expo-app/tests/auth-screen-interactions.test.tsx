import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Keyboard } from "react-native";

import LoginScreen from "@/app/(auth)/login";
import RegisterScreen from "@/app/(auth)/register";

const mockSignIn = jest.fn<Promise<boolean>, [string, string]>();
const mockSignUp = jest.fn<Promise<boolean>, [string, string, string]>();
let mockPrimaryPress: (() => void) | undefined;
let mockCatMood: string | undefined;

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    LinearGradient: ({ children, ...props }: { children?: ReactNode }) => (
      <MockView {...props}>{children}</MockView>
    ),
  };
});

jest.mock("@/components/auth/AuthChrome", () => {
  const {
    Pressable: MockPressable,
    Text: MockText,
    View: MockView,
  } = jest.requireActual("react-native");
  return {
    authLayout: {
      loginTopSpacing: () => 54,
      registerTopSpacing: () => 28,
    },
    authPalette: {
      coral: "#FF6C7C",
      ink: "#20222E",
      mutedText: "#6B7280",
      placeholderText: "#8E96A6",
    },
    authPasswordVisibilitySymbolSize: 23,
    configureAuthFocusShiftAnimation: jest.fn(),
    AuthCatFormStack: ({ children, mood }: { children: ReactNode; mood: string }) => {
      mockCatMood = mood;
      return <MockView>{children}</MockView>;
    },
    AuthFieldChrome: ({ children }: { children: ReactNode }) => <MockView>{children}</MockView>,
    AuthFormCard: ({ children }: { children: ReactNode }) => <MockView>{children}</MockView>,
    AuthInlineMessage: ({ message }: { message: string }) => <MockText>{message}</MockText>,
    AuthPrimaryButton: ({
      title,
      isEnabled,
      onPress,
    }: {
      title: string;
      isEnabled: boolean;
      onPress: () => void;
    }) => {
      mockPrimaryPress = onPress;
      return (
        <MockPressable
          accessibilityLabel={title}
          accessibilityRole="button"
          disabled={!isEnabled}
          onPress={onPress}
        >
          <MockText>{title}</MockText>
        </MockPressable>
      );
    },
    AuthTitleLockup: ({ title, subtitle }: { title: string; subtitle: string }) => (
      <MockView>
        <MockText>{title}</MockText>
        <MockText>{subtitle}</MockText>
      </MockView>
    ),
    KeyboardDoneAccessory: () => null,
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@/assets/nativeAssets", () => ({
  nativeAssets: { authCatIdle: 1, authCatPeek: 2, authCatCover: 3 },
}));

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ signIn: mockSignIn, signUp: mockSignUp }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

describe("authentication screen interactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrimaryPress = undefined;
    mockCatMood = undefined;
  });

  it("submits login only once when two press callbacks arrive in the same render frame", async () => {
    mockSignIn.mockResolvedValue(true);
    const view = await render(<LoginScreen />);

    await fireEvent.changeText(view.getByPlaceholderText("auth.username"), "test-user");
    await fireEvent.changeText(view.getByPlaceholderText("auth.password"), "test-password");
    const press = mockPrimaryPress;
    expect(press).toBeDefined();

    await act(() => {
      press?.();
      press?.();
    });
    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(mockSignIn).toHaveBeenCalledWith("test-user", "test-password");

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/(tabs)/conversations"));
  });

  it("submits register only once and preserves the raw optional nickname", async () => {
    mockSignUp.mockResolvedValue(true);
    const view = await render(<RegisterScreen />);

    await fireEvent.changeText(view.getByPlaceholderText("auth.username.rules"), "new-user");
    await fireEvent.changeText(view.getByPlaceholderText("auth.nickname.optional"), " Nick ");
    await fireEvent.changeText(view.getByPlaceholderText("auth.password.rules"), "secret1");
    await fireEvent.changeText(view.getByPlaceholderText("auth.confirmPassword"), "secret1");
    const press = mockPrimaryPress;
    expect(press).toBeDefined();

    await act(() => {
      press?.();
      press?.();
    });
    expect(mockSignUp).toHaveBeenCalledTimes(1);
    expect(mockSignUp).toHaveBeenCalledWith("new-user", "secret1", " Nick ");

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/(tabs)/conversations"));
  });

  it("dismisses the keyboard from each native-equivalent page background", async () => {
    const dismiss = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => undefined);
    const login = await render(<LoginScreen />);
    await fireEvent.press(login.getByTestId("auth-login-background-dismiss"));
    expect(dismiss).toHaveBeenCalledTimes(1);
    await login.unmount();

    const register = await render(<RegisterScreen />);
    await fireEvent.press(register.getByTestId("auth-register-background-dismiss"));
    expect(dismiss).toHaveBeenCalledTimes(2);
    dismiss.mockRestore();
  });

  it("exposes native button roles for password visibility and clear controls", async () => {
    const login = await render(<LoginScreen />);
    expect(login.getByLabelText("password.show").props.accessibilityRole).toBe("button");
    await fireEvent.changeText(login.getByPlaceholderText("auth.username"), "user");
    expect(login.getByLabelText("common.clear").props.accessibilityRole).toBe("button");
    await login.unmount();

    const register = await render(<RegisterScreen />);
    expect(register.getAllByLabelText("password.show")).toHaveLength(2);
    for (const control of register.getAllByLabelText("password.show")) {
      expect(control.props.accessibilityRole).toBe("button");
    }
    await fireEvent.changeText(register.getByPlaceholderText("auth.nickname.optional"), "Nick");
    expect(register.getByLabelText("common.clear").props.accessibilityRole).toBe("button");
  });

  it("tracks the native cat mood for every login and register focus class", async () => {
    const login = await render(<LoginScreen />);
    expect(mockCatMood).toBe("idle");
    await fireEvent(login.getByPlaceholderText("auth.username"), "focus");
    expect(mockCatMood).toBe("peek");
    await fireEvent(login.getByPlaceholderText("auth.password"), "focus");
    expect(mockCatMood).toBe("coverEyes");
    await fireEvent(login.getByPlaceholderText("auth.password"), "blur");
    expect(mockCatMood).toBe("idle");
    await login.unmount();

    const register = await render(<RegisterScreen />);
    await fireEvent(register.getByPlaceholderText("auth.username.rules"), "focus");
    expect(mockCatMood).toBe("peek");
    await fireEvent(register.getByPlaceholderText("auth.nickname.optional"), "focus");
    expect(mockCatMood).toBe("peek");
    await fireEvent(register.getByPlaceholderText("auth.password.rules"), "focus");
    expect(mockCatMood).toBe("coverEyes");
    await fireEvent(register.getByPlaceholderText("auth.confirmPassword"), "focus");
    expect(mockCatMood).toBe("coverEyes");
    await fireEvent(register.getByPlaceholderText("auth.confirmPassword"), "blur");
    expect(mockCatMood).toBe("idle");
  });

  it("keeps register password visibility independent and clears both text fields", async () => {
    const view = await render(<RegisterScreen />);
    const password = view.getByPlaceholderText("auth.password.rules");
    const confirmation = view.getByPlaceholderText("auth.confirmPassword");
    expect(password.props.secureTextEntry).toBe(true);
    expect(confirmation.props.secureTextEntry).toBe(true);

    await fireEvent.press(view.getAllByLabelText("password.show")[0]!);
    expect(view.getByPlaceholderText("auth.password.rules").props.secureTextEntry).toBe(false);
    expect(view.getByPlaceholderText("auth.confirmPassword").props.secureTextEntry).toBe(true);
    await fireEvent.press(view.getByLabelText("password.show"));
    expect(view.getByPlaceholderText("auth.confirmPassword").props.secureTextEntry).toBe(false);

    await fireEvent.changeText(view.getByPlaceholderText("auth.username.rules"), "name");
    await fireEvent.changeText(view.getByPlaceholderText("auth.nickname.optional"), "nick");
    const clearButtons = view.getAllByLabelText("common.clear");
    expect(clearButtons).toHaveLength(2);
    await fireEvent.press(clearButtons[0]!);
    await fireEvent.press(clearButtons[1]!);
    expect(view.getByPlaceholderText("auth.username.rules").props.value).toBe("");
    expect(view.getByPlaceholderText("auth.nickname.optional").props.value).toBe("");
  });

  it("preserves native register hint priority over an earlier server error", async () => {
    mockSignUp.mockRejectedValueOnce(new Error("rejected"));
    const view = await render(<RegisterScreen />);
    const secret = ["s", "e", "c", "r", "e", "t"].join("");
    await fireEvent.changeText(view.getByPlaceholderText("auth.username.rules"), "valid-name");
    await fireEvent.changeText(view.getByPlaceholderText("auth.password.rules"), secret);
    await fireEvent.changeText(view.getByPlaceholderText("auth.confirmPassword"), secret);
    await fireEvent.press(view.getByLabelText("auth.register.action"));
    await waitFor(() => expect(view.getByText("auth.register.failed")).toBeTruthy());

    await fireEvent.changeText(view.getByPlaceholderText("auth.username.rules"), "ab");
    expect(view.getByText("auth.validation.usernameTooShort")).toBeTruthy();
    expect(view.queryByText("auth.register.failed")).toBeNull();
    await fireEvent.changeText(view.getByPlaceholderText("auth.username.rules"), "valid-name");
    expect(view.getByText("auth.register.failed")).toBeTruthy();
  });

  it("uses native-equivalent register presentation and dismissal routes", async () => {
    const login = await render(<LoginScreen />);
    await fireEvent.press(login.getByText("auth.registerNow"));
    expect(router.push).toHaveBeenCalledWith("/(auth)/register");
    await login.unmount();

    const register = await render(<RegisterScreen />);
    await fireEvent.press(register.getByText("auth.haveAccount"));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("does not navigate or write page state after a late login completion is unmounted", async () => {
    const login = deferred<boolean>();
    mockSignIn.mockReturnValue(login.promise);
    const view = await render(<LoginScreen />);
    await fireEvent.changeText(view.getByPlaceholderText("auth.username"), "late-user");
    await fireEvent.changeText(view.getByPlaceholderText("auth.password"), "late-password");
    await fireEvent.press(view.getByLabelText("auth.login.action"));
    expect(mockSignIn).toHaveBeenCalledTimes(1);

    await view.unmount();
    await act(async () => login.resolve(true));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("does not navigate when the provider rejects a superseded login commit", async () => {
    mockSignIn.mockResolvedValue(false);
    const view = await render(<LoginScreen />);
    await fireEvent.changeText(view.getByPlaceholderText("auth.username"), "newer-user");
    await fireEvent.changeText(view.getByPlaceholderText("auth.password"), "newer-password");
    await fireEvent.press(view.getByLabelText("auth.login.action"));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
    expect(router.replace).not.toHaveBeenCalled();
    expect(view.queryByText("auth.login.failed")).toBeNull();
  });

  it("normalizes only a Foundation-blank nickname before registration", async () => {
    mockSignUp.mockResolvedValue(true);
    const view = await render(<RegisterScreen />);
    await fireEvent.changeText(view.getByPlaceholderText("auth.username.rules"), "new-user");
    await fireEvent.changeText(view.getByPlaceholderText("auth.nickname.optional"), "\u200B");
    await fireEvent.changeText(view.getByPlaceholderText("auth.password.rules"), "secret1");
    await fireEvent.changeText(view.getByPlaceholderText("auth.confirmPassword"), "secret1");
    await fireEvent.press(view.getByLabelText("auth.register.action"));
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledWith("new-user", "secret1", ""));
    await view.unmount();

    jest.clearAllMocks();
    mockSignUp.mockResolvedValue(true);
    const byteOrderMarkView = await render(<RegisterScreen />);
    await fireEvent.changeText(
      byteOrderMarkView.getByPlaceholderText("auth.username.rules"),
      "new-user",
    );
    await fireEvent.changeText(
      byteOrderMarkView.getByPlaceholderText("auth.nickname.optional"),
      "\uFEFF",
    );
    await fireEvent.changeText(
      byteOrderMarkView.getByPlaceholderText("auth.password.rules"),
      "secret1",
    );
    await fireEvent.changeText(
      byteOrderMarkView.getByPlaceholderText("auth.confirmPassword"),
      "secret1",
    );
    await fireEvent.press(byteOrderMarkView.getByLabelText("auth.register.action"));
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledWith("new-user", "secret1", "\uFEFF"));
  });

  it("does not navigate or write page state after a late registration completion is unmounted", async () => {
    const registration = deferred<boolean>();
    mockSignUp.mockReturnValue(registration.promise);
    const view = await render(<RegisterScreen />);
    await fireEvent.changeText(view.getByPlaceholderText("auth.username.rules"), "late-user");
    await fireEvent.changeText(view.getByPlaceholderText("auth.password.rules"), "late-password");
    await fireEvent.changeText(view.getByPlaceholderText("auth.confirmPassword"), "late-password");
    await fireEvent.press(view.getByLabelText("auth.register.action"));
    expect(mockSignUp).toHaveBeenCalledTimes(1);

    await view.unmount();
    await act(async () => registration.resolve(true));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("does not navigate or show a failure when a registration commit is superseded", async () => {
    mockSignUp.mockResolvedValue(false);
    const view = await render(<RegisterScreen />);
    await fireEvent.changeText(view.getByPlaceholderText("auth.username.rules"), "new-user");
    await fireEvent.changeText(view.getByPlaceholderText("auth.password.rules"), "new-password");
    await fireEvent.changeText(view.getByPlaceholderText("auth.confirmPassword"), "new-password");
    await fireEvent.press(view.getByLabelText("auth.register.action"));
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1));
    expect(router.replace).not.toHaveBeenCalled();
    expect(view.queryByText("auth.register.failed")).toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
