import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { type ReactNode, useEffect, useState } from "react";
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
        colors={["rgba(255,255,255,0.82)", "rgba(255,255,255,0.96)"]}
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
  panel,
  plusItemCount,
  plusPanel,
  stickerPanel,
}: {
  panel: ChatComposerPanel | null;
  plusItemCount: number;
  plusPanel: ReactNode;
  stickerPanel: ReactNode;
}) {
  const [height] = useState(() => new Animated.Value(panelHeight(panel, plusItemCount)));

  useEffect(() => {
    height.stopAnimation();
    Animated.timing(height, {
      duration: chatComposerSurfacePolicy.transitionDurationMs,
      easing: Easing.inOut(Easing.ease),
      toValue: panelHeight(panel, plusItemCount),
      useNativeDriver: false,
    }).start();
  }, [height, panel, plusItemCount]);

  return (
    <Animated.View
      accessibilityElementsHidden={panel === null}
      importantForAccessibility={panel === null ? "no-hide-descendants" : "auto"}
      pointerEvents={panel === null ? "none" : "auto"}
      style={[styles.panelHost, { height }]}
    >
      {panel === "stickers" ? stickerPanel : panel === "plus" ? plusPanel : null}
    </Animated.View>
  );
}

function panelHeight(panel: ChatComposerPanel | null, plusItemCount: number): number {
  if (panel === "stickers") return chatStickerPanelPolicy.preferredHeight;
  if (panel === "plus") return chatComposerPlusPanelHeight(plusItemCount);
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
});
