import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { Alert } from "react-native";

import { APIError } from "@/api/client";
import DirectChatSettingsScreen from "@/app/direct-chat-settings";

const mockClear = jest.fn();
const mockApply = jest.fn();
const mockClearPreview = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({
    id: "friend/1",
    name: "朋友",
    avatar: "/avatars/friend.jpg",
  }),
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText>,
  };
});

jest.mock("@/components/Avatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    Avatar: ({ name, size }: { name: string; size: number }) => (
      <MockText>{`avatar:${name}:${size}`}</MockText>
    ),
  };
});

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    TopToast: ({ message }: { message: string | null }) =>
      message ? <MockText>{`toast:${message}`}</MockText> : null,
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { user_id: "owner-a" } }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));

jest.mock("@/api/bwchat", () => ({
  clearDirectMessageHistory: (...args: unknown[]) => mockClear(...args),
}));

jest.mock("@/services/messages/DirectHistoryClearRepository", () => ({
  applyDirectHistoryClear: (...args: unknown[]) => mockApply(...args),
}));

jest.mock("@/services/conversations/ConversationRepository", () => ({
  clearCachedDirectConversationPreview: (...args: unknown[]) => mockClearPreview(...args),
}));

describe("DirectChatSettings native interactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClear.mockResolvedValue(receipt());
    mockApply.mockResolvedValue(receipt());
    mockClearPreview.mockResolvedValue(undefined);
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
  });

  afterEach(() => jest.restoreAllMocks());

  it("renders the native 66pt profile and opens the exact DM background target", async () => {
    await render(<DirectChatSettingsScreen />);

    expect(screen.getByText("avatar:朋友:66")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("chatBackground.currentChat"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/chat-background-settings",
      params: {
        targetType: "dm",
        targetId: "friend/1",
        title: "chatBackground.currentChat",
      },
    });
  });

  it("confirms, applies the monotonic receipt, clears the preview and shows toast", async () => {
    const view = await render(<DirectChatSettingsScreen />);
    await fireEvent.press(screen.getByLabelText("chat.clear.action"));
    const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    const destructive = buttons?.find((button) => button.style === "destructive");
    expect(destructive).toBeDefined();

    await act(async () => destructive?.onPress?.());

    expect(mockClear).toHaveBeenCalledWith("friend/1");
    expect(mockApply).toHaveBeenCalledWith("owner-a", receipt());
    expect(mockClearPreview).toHaveBeenCalledWith("owner-a", "friend/1");
    await waitFor(() => expect(view.getByText("toast:chat.clear.success")).toBeTruthy());
  });

  it("keeps the original blocking overlay and operation lock while clearing", async () => {
    const pending = deferred<ReturnType<typeof receipt>>();
    mockClear.mockImplementationOnce(() => pending.promise);
    await render(<DirectChatSettingsScreen />);
    await fireEvent.press(screen.getByLabelText("chat.clear.action"));
    const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    const destructive = buttons?.find((button) => button.style === "destructive");
    await act(async () => {
      destructive?.onPress?.();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByLabelText("common.loading").props.accessibilityRole).toBe("progressbar"),
    );
    expect(
      screen.getByLabelText("chat.clear.action", {
        includeHiddenElements: true,
      }).props.accessibilityState,
    ).toEqual({ disabled: true, busy: true });
    pending.resolve(receipt());
    await waitFor(() => expect(screen.queryByLabelText("common.loading")).toBeNull());
  });

  it("shows API descriptions but hides arbitrary implementation errors", async () => {
    mockClear.mockRejectedValueOnce(new APIError("服务器拒绝清空", 422));
    await render(<DirectChatSettingsScreen />);
    await triggerDestructiveClear();
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenLastCalledWith("common.operationFailed", "服务器拒绝清空"),
    );

    mockClear.mockRejectedValueOnce(new Error("internal path leaked"));
    await triggerDestructiveClear();
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenLastCalledWith(
        "common.operationFailed",
        "common.operationFailed",
      ),
    );
  });
});

async function triggerDestructiveClear(): Promise<void> {
  await fireEvent.press(screen.getByLabelText("chat.clear.action"));
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  const destructive = buttons?.find((button) => button.style === "destructive");
  await act(async () => destructive?.onPress?.());
}

function receipt() {
  return {
    conversation_id: "friend/1",
    cleared_before_message_id: 88,
    cleared_at: "2026-08-08T10:00:00Z",
    revision: 2,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}
