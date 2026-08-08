import { act, fireEvent, render } from "@testing-library/react-native";

import { StartLiveDialog } from "@/app/live-lobby";

const mockRandomUUID = jest.fn();

jest.mock("expo-crypto", () => ({ randomUUID: () => mockRandomUUID() }));
jest.mock("expo-file-system", () => ({ File: class MockFile { size = 100; } }));
jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
}));
jest.mock("expo-image", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Image: (props: object) => <MockView {...props} /> };
});
jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  manipulateAsync: jest.fn(),
}));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    LinearGradient: ({ children, ...props }: { children: React.ReactNode }) => (
      <MockView {...props}>{children}</MockView>
    ),
  };
});
jest.mock("expo-router", () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
  useFocusEffect: jest.fn(),
}));
jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});
jest.mock("react-native-gesture-handler", () => {
  const { View: MockView } = jest.requireActual("react-native");
  const chain = () => {
    const value = {
      maxScaleChange: () => value,
      minDistance: () => value,
      onBegin: () => value,
      onChange: () => value,
      onUpdate: () => value,
      simultaneousWithExternalGesture: () => value,
    };
    return value;
  };
  return {
    Gesture: { Pan: chain, Pinch: chain, Simultaneous: chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => <MockView>{children}</MockView>,
  };
});
jest.mock("react-native-reanimated", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: { View: MockView },
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
  };
});
jest.mock("@/components/AuthenticatedImage", () => ({ AuthenticatedImage: () => null }));
jest.mock("@/components/Avatar", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Avatar: (props: object) => <MockView {...props} /> };
});
jest.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/providers/CallProvider", () => ({ useCall: () => ({ session: null }) }));
jest.mock("@/providers/LiveCallProvider", () => ({ useLiveCall: () => ({}) }));
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: (key: string) => key }),
}));
jest.mock("@/providers/PropInventoryProvider", () => ({
  usePropInventory: () => ({ items: [], load: jest.fn() }),
}));
jest.mock("@/services/live/useLiveLobby", () => ({ useLiveLobby: jest.fn() }));

describe("start-live dialog component state machine", () => {
  beforeEach(() => {
    mockRandomUUID.mockReset();
    let index = 0;
    mockRandomUUID.mockImplementation(() => `key-${++index}`);
  });

  it("requires a trimmed role and at least one call type before submitting", async () => {
    const onStart = jest.fn().mockResolvedValue(false);
    const view = await render(
      <StartLiveDialog
        fallbackAvatar="/me.jpg"
        isSubmitting={false}
        onDismiss={jest.fn()}
        onStart={onStart}
      />,
    );
    const submit = view.getByLabelText("挂上直播");
    expect(submit.props.accessibilityState?.disabled ?? submit.props.disabled).toBe(true);

    await act(async () => fireEvent.changeText(
      view.getByLabelText("输入我扮演的人物设定"),
      "  Detective  ",
    ));
    expect(view.getByLabelText("挂上直播").props.accessibilityState?.disabled
      ?? view.getByLabelText("挂上直播").props.disabled).toBe(true);

    await act(async () => fireEvent.press(view.getByLabelText("允许语音连线")));
    const enabled = view.getByLabelText("挂上直播");
    expect(enabled.props.accessibilityState?.disabled ?? enabled.props.disabled).toBe(false);
    await act(async () => fireEvent.press(enabled));

    expect(onStart).toHaveBeenCalledWith({
      roleSetting: "Detective",
      avatarUri: undefined,
      allowedCallTypes: ["voice"],
      avatarUploadIdempotencyKey: "key-1",
      slotCreationIdempotencyKey: expect.stringMatching(/^key-\d+$/),
    });
    expect(onStart.mock.calls[0]?.[0].slotCreationIdempotencyKey).not.toBe("key-1");
  });

  it("preserves retry identity, rotates creation identity after edits, and locks while submitting", async () => {
    const onStart = jest.fn().mockResolvedValue(false);
    const props = {
      fallbackAvatar: "",
      isSubmitting: false,
      onDismiss: jest.fn(),
      onStart,
    };
    const view = await render(<StartLiveDialog {...props} />);
    await act(async () => fireEvent.changeText(view.getByLabelText("输入我扮演的人物设定"), "Role"));
    await act(async () => fireEvent.press(view.getByLabelText("允许视频连线")));
    await act(async () => fireEvent.press(view.getByLabelText("挂上直播")));
    await act(async () => fireEvent.press(view.getByLabelText("挂上直播")));
    expect(onStart.mock.calls[0]?.[0]).toEqual(onStart.mock.calls[1]?.[0]);

    await act(async () => fireEvent.changeText(view.getByLabelText("输入我扮演的人物设定"), "New Role"));
    await act(async () => fireEvent.press(view.getByLabelText("挂上直播")));
    expect(onStart.mock.calls[2]?.[0]).toMatchObject({
      roleSetting: "New Role",
      avatarUploadIdempotencyKey: "key-1",
    });
    expect(onStart.mock.calls[2]?.[0].slotCreationIdempotencyKey)
      .not.toBe(onStart.mock.calls[1]?.[0].slotCreationIdempotencyKey);

    await view.rerender(<StartLiveDialog {...props} isSubmitting />);
    expect(view.getByText("正在挂上直播…")).toBeTruthy();
    const locked = view.getByLabelText("挂上直播");
    expect(locked.props.accessibilityState?.disabled ?? locked.props.disabled).toBe(true);
  });

  it("dismisses the keyboard before dismissing a focused dialog", async () => {
    const onDismiss = jest.fn();
    const view = await render(
      <StartLiveDialog
        fallbackAvatar=""
        isSubmitting={false}
        onDismiss={onDismiss}
        onStart={jest.fn().mockResolvedValue(false)}
      />,
    );
    await act(async () => fireEvent(view.getByLabelText("输入我扮演的人物设定"), "focus"));
    await act(async () => fireEvent.press(view.getByLabelText("关闭挂播弹窗")));
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(view.getByLabelText("关闭挂播弹窗")));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
