import { act, fireEvent, render } from "@testing-library/react-native";
import { router as expoRouter } from "expo-router";

import { Avatar, UserAvatarButton } from "@/components/Avatar";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { LinearGradient: MockView };
});
jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});
jest.mock("@/components/AuthenticatedImage", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    AuthenticatedImage: ({ uri, fallback }: { uri: string; fallback?: React.ReactNode }) => (
      <MockText>{`authenticated:${uri}:${fallback ? "fallback" : "none"}`}</MockText>
    ),
  };
});
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    t: (key: string, value?: string) => (value ? `${key}:${value}` : key),
  }),
}));

const mockPush = jest.mocked(expoRouter.push);

describe("native avatar parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses the native person.fill gradient placeholder instead of a name initial", async () => {
    const view = await render(<Avatar name="Alice" size={40} uri="" />);
    expect(view.getByText("person.fill")).toBeTruthy();
    expect(view.queryByText("A")).toBeNull();
    await view.unmount();
  });

  it("routes resolved media through the authenticated image cache with a fallback", async () => {
    const view = await render(<Avatar name="Alice" size={40} uri="/avatars/a.jpg" />);
    expect(
      view.getByText("authenticated:http://localhost:8000/api/v1/avatars/a.jpg:fallback"),
    ).toBeTruthy();
    await view.unmount();
  });

  it("opens a trimmed user id once within the native 0.6 second throttle", async () => {
    const view = await render(
      <UserAvatarButton accessibilityName="Alice" avatarUrl="" size={36} userId=" user-1 " />,
    );
    const button = view.getByLabelText("profile.open:Alice");
    await act(async () => fireEvent.press(button, { nativeEvent: { timestamp: 1_000 } }));
    await act(async () => fireEvent.press(button, { nativeEvent: { timestamp: 1_000 } }));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/user-profile",
      params: { id: "user-1", name: "Alice" },
    });
    await view.unmount();
  });

  it("keeps a 0.45 second avatar long press exclusive from profile navigation", async () => {
    const onLongPress = jest.fn();
    const view = await render(
      <UserAvatarButton avatarUrl="" onLongPress={onLongPress} size={36} userId="user-2" />,
    );
    const button = view.getByLabelText("profile.open.default");
    await act(async () => fireEvent(button, "longPress", { nativeEvent: { timestamp: 2_000 } }));
    await act(async () => fireEvent.press(button, { nativeEvent: { timestamp: 2_000 } }));
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("lets the enclosing gift-message long press gate suppress recipient profile navigation", async () => {
    const canActivate = jest.fn(() => false);
    const view = await render(
      <UserAvatarButton
        accessibilityName="Gift recipient"
        avatarUrl=""
        canActivate={canActivate}
        size={28}
        userId="recipient-1"
      />,
    );
    await act(async () => fireEvent.press(view.getByLabelText("profile.open:Gift recipient")));
    expect(canActivate).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    await view.unmount();
  });
});
