import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";

import {
  chatComposerPlusPanelHeight,
  chatComposerSurfacePolicy,
  chatStickerPanelPolicy,
} from "@/services/messages/chatStickerPolicy";
import { colors } from "@/theme";

export type ChatComposerPanel = "stickers" | "plus";

export function ChatComposerPanelToggleButton({
  accessibilityLabel,
  activeSystemName,
  inactiveSystemName,
  isActive,
  onPress,
}: {
  accessibilityLabel: string;
  activeSystemName: SFSymbol;
  inactiveSystemName: SFSymbol;
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected: isActive }}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={styles.toggleButton}
    >
      <SymbolView
        name={isActive ? activeSystemName : inactiveSystemName}
        size={chatComposerSurfacePolicy.toggleSymbolSize}
        tintColor={colors.accent}
        weight="regular"
      />
    </Pressable>
  );
}

export function ChatComposerSurfaceBackground({
  showsStickerPanel,
}: {
  showsStickerPanel: boolean;
}) {
  const [stickerOpacity] = useState(() => new Animated.Value(showsStickerPanel ? 1 : 0));

  useEffect(() => {
    Animated.timing(stickerOpacity, {
      duration: chatComposerSurfacePolicy.transitionDurationMs,
      easing: Easing.inOut(Easing.ease),
      toValue: showsStickerPanel ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [showsStickerPanel, stickerOpacity]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[colors.card, colors.card]}
        end={{ x: 0, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.stickerBackground, { opacity: stickerOpacity }]}
      />
    </View>
  );
}

export function ChatComposerPanelHost({
  isKeyboardFocused,
  keyboardEquivalentInset,
  keyboardInset,
  panel,
  plusItemCount,
  plusPanel,
  stickerPanel,
}: {
  isKeyboardFocused: boolean;
  keyboardEquivalentInset: number;
  keyboardInset: number;
  panel: ChatComposerPanel | null;
  plusItemCount: number;
  plusPanel: ReactNode;
  stickerPanel: ReactNode;
}) {
  const initialPanelHeight = chatComposerPanelHeight(panel, plusItemCount, keyboardEquivalentInset);
  const [height] = useState(() => new Animated.Value(initialPanelHeight));
  const lastPanelHeightRef = useRef(initialPanelHeight);

  useEffect(() => {
    const activePanelHeight = chatComposerPanelHeight(
      panel,
      plusItemCount,
      keyboardEquivalentInset,
    );
    if (activePanelHeight > 0) lastPanelHeightRef.current = activePanelHeight;
    height.stopAnimation();
    Animated.timing(height, {
      duration: chatComposerSurfacePolicy.transitionDurationMs,
      easing: Easing.inOut(Easing.ease),
      toValue: chatComposerBottomInset(
        panel,
        plusItemCount,
        keyboardInset,
        keyboardEquivalentInset,
        isKeyboardFocused,
        lastPanelHeightRef.current,
      ),
      useNativeDriver: false,
    }).start();
  }, [height, isKeyboardFocused, keyboardEquivalentInset, keyboardInset, panel, plusItemCount]);

  return (
    <Animated.View
      accessibilityElementsHidden={panel === null}
      importantForAccessibility={panel === null ? "no-hide-descendants" : "auto"}
      pointerEvents={panel === null ? "none" : "auto"}
      style={[styles.panelHost, panel === null && styles.keyboardHost, { height }]}
    >
      {panel === "stickers" ? stickerPanel : panel === "plus" ? plusPanel : null}
    </Animated.View>
  );
}

export function chatComposerPanelHeight(
  panel: ChatComposerPanel | null,
  plusItemCount: number,
  keyboardEquivalentInset: number,
): number {
  if (panel === "stickers") {
    return Math.max(chatStickerPanelPolicy.preferredHeight, keyboardEquivalentInset);
  }
  if (panel === "plus") return chatComposerPlusPanelHeight(plusItemCount);
  return 0;
}

export function chatComposerBottomInset(
  panel: ChatComposerPanel | null,
  plusItemCount: number,
  keyboardInset: number,
  keyboardEquivalentInset: number,
  isKeyboardFocused: boolean,
  lastPanelHeight: number,
): number {
  const activePanelHeight = chatComposerPanelHeight(panel, plusItemCount, keyboardEquivalentInset);
  if (activePanelHeight > 0) return activePanelHeight;
  if (keyboardInset > 0) return keyboardInset;
  if (isKeyboardFocused) return Math.max(0, lastPanelHeight);
  return 0;
}

const styles = StyleSheet.create({
  toggleButton: {
    alignItems: "center",
    height: chatComposerSurfacePolicy.actionButtonHeight,
    justifyContent: "center",
    width: chatComposerSurfacePolicy.actionButtonWidth,
  },
  stickerBackground: { backgroundColor: "rgba(242,242,247,0.98)" },
  panelHost: {
    backgroundColor: "rgba(242,242,247,0.98)",
    overflow: "hidden",
    width: "100%",
  },
  keyboardHost: { backgroundColor: colors.card },
});
