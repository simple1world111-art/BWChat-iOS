import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, type LayoutChangeEvent } from "react-native";

import { colors } from "@/theme";

export function TopToast({
  message,
  onDismiss,
  duration = 2_000,
  topInset = 0,
}: {
  message: string | null;
  onDismiss: () => void;
  duration?: number | undefined;
  topInset?: number | undefined;
}) {
  const [progress] = useState(() => new Animated.Value(0));
  const [toastHeight, setToastHeight] = useState(40);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!message) return;
    progress.stopAnimation();
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 350,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(
      () => {
        Animated.timing(progress, {
          toValue: 0,
          duration: 350,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) onDismissRef.current();
        });
      },
      Math.max(0, duration),
    );
    return () => {
      clearTimeout(timer);
      progress.stopAnimation();
    };
  }, [duration, message, progress]);

  if (!message) return null;
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-(toastHeight + 8), 0],
  });
  return (
    <Animated.View
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      onLayout={(event: LayoutChangeEvent) => setToastHeight(event.nativeEvent.layout.height)}
      pointerEvents="none"
      style={[
        styles.position,
        { top: topInset + 8, opacity: progress, transform: [{ translateY }] },
      ]}
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

export function CenterToast({
  message,
  onDismiss,
  duration = 2_000,
}: {
  message: string | null;
  onDismiss: () => void;
  duration?: number | undefined;
}) {
  const [progress] = useState(() => new Animated.Value(0));
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!message) return;
    progress.stopAnimation();
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 350,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(
      () => {
        Animated.timing(progress, {
          toValue: 0,
          duration: 350,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) onDismissRef.current();
        });
      },
      Math.max(0, duration),
    );
    return () => {
      clearTimeout(timer);
      progress.stopAnimation();
    };
  }, [duration, message, progress]);

  if (!message) return null;
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
  return (
    <Animated.View
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      pointerEvents="none"
      style={[styles.centerPosition, { opacity: progress, transform: [{ scale }] }]}
    >
      <Text style={styles.centerText}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  position: { position: "absolute", left: 0, right: 0, zIndex: 20, alignItems: "center" },
  text: {
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    color: colors.white,
    backgroundColor: "rgba(0,0,0,0.75)",
    fontSize: 15,
  },
  centerPosition: {
    position: "absolute",
    inset: 0,
    zIndex: 20,
    paddingHorizontal: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  centerText: {
    overflow: "hidden",
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 22,
    color: colors.white,
    backgroundColor: "rgba(0,0,0,0.78)",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
});
