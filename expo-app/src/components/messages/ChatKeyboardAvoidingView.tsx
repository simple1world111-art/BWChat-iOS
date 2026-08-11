import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  Dimensions,
  Keyboard,
  Platform,
  View,
  type KeyboardEvent,
  type ViewProps,
} from "react-native";

interface ChatKeyboardMetrics {
  height: number;
  screenY: number;
}

interface ChatKeyboardLayout {
  inset: number;
  equivalentInset: number;
}

const defaultEquivalentKeyboardInset = 346;
const ChatKeyboardLayoutContext = createContext<ChatKeyboardLayout>({
  inset: 0,
  equivalentInset: defaultEquivalentKeyboardInset,
});

export function chatKeyboardInset(
  metrics: ChatKeyboardMetrics | undefined,
  screenHeight: number,
): number {
  if (
    !metrics ||
    !Number.isFinite(metrics.height) ||
    !Number.isFinite(metrics.screenY) ||
    !Number.isFinite(screenHeight)
  )
    return 0;
  const visibleOverlap = Math.max(0, screenHeight - metrics.screenY);
  return Math.min(Math.max(0, metrics.height), visibleOverlap);
}

export function ChatKeyboardAvoidingView({
  children,
  reservesKeyboardInset = true,
  style,
  ...props
}: ViewProps & { reservesKeyboardInset?: boolean | undefined }) {
  const [initialKeyboardInset] = useState(() =>
    Platform.OS === "ios" && Keyboard.isVisible()
      ? chatKeyboardInset(Keyboard.metrics(), Dimensions.get("screen").height)
      : 0,
  );
  const [keyboardInset, setKeyboardInset] = useState(initialKeyboardInset);
  const [lastVisibleKeyboardInset, setLastVisibleKeyboardInset] = useState(initialKeyboardInset);

  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const updateInset = (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event);
      const nextInset = chatKeyboardInset(event.endCoordinates, Dimensions.get("screen").height);
      setKeyboardInset(nextInset);
      if (nextInset > 0) setLastVisibleKeyboardInset(nextInset);
    };
    const clearInset = (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardInset(0);
    };
    const subscriptions = [
      Keyboard.addListener("keyboardWillChangeFrame", updateInset),
      Keyboard.addListener("keyboardDidShow", updateInset),
      Keyboard.addListener("keyboardWillHide", clearInset),
      Keyboard.addListener("keyboardDidHide", clearInset),
    ];

    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  const keyboardLayout = useMemo<ChatKeyboardLayout>(
    () => ({
      inset: keyboardInset,
      equivalentInset:
        lastVisibleKeyboardInset > 0 ? lastVisibleKeyboardInset : defaultEquivalentKeyboardInset,
    }),
    [keyboardInset, lastVisibleKeyboardInset],
  );

  return (
    <ChatKeyboardLayoutContext.Provider value={keyboardLayout}>
      <View
        {...props}
        style={[
          style,
          reservesKeyboardInset && keyboardInset > 0 && { paddingBottom: keyboardInset },
        ]}
      >
        {children}
      </View>
    </ChatKeyboardLayoutContext.Provider>
  );
}

export function useChatKeyboardLayout(): ChatKeyboardLayout {
  return useContext(ChatKeyboardLayoutContext);
}
