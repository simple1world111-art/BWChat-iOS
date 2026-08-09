import { useEffect, useState } from "react";
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

export function ChatKeyboardAvoidingView({ children, style, ...props }: ViewProps) {
  const [keyboardInset, setKeyboardInset] = useState(() =>
    Platform.OS === "ios" && Keyboard.isVisible()
      ? chatKeyboardInset(Keyboard.metrics(), Dimensions.get("screen").height)
      : 0,
  );

  useEffect(() => {
    if (Platform.OS !== "ios") return;

    const updateInset = (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardInset(chatKeyboardInset(event.endCoordinates, Dimensions.get("screen").height));
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

  return (
    <View {...props} style={[style, keyboardInset > 0 && { paddingBottom: keyboardInset }]}>
      {children}
    </View>
  );
}
