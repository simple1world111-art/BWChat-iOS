import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import {
  chatComposerPlusPanelHeight,
  chatComposerSurfacePolicy,
  chatStickerPanelPolicy,
} from "@/services/messages/chatStickerPolicy";
import { colors } from "@/theme";

export type ChatComposerPanel = "stickers" | "plus";

const chatComposerMicrophoneInset = 34;
const chatComposerMicrophoneTransitionDurationMs = 140;
const chatComposerPanelDismissDurationMs = 220;
const chatComposerKeyboardFrameTimeoutMs = 350;

export const ChatComposerTextInput = Animated.createAnimatedComponent(TextInput);

export function useChatComposerMicrophoneTransition(showsMicrophone: boolean): {
  microphoneOpacity: Animated.Value;
  microphoneScale: Animated.AnimatedInterpolation<number>;
  textTranslateX: Animated.AnimatedInterpolation<number>;
} {
  const [progress] = useState(() => new Animated.Value(showsMicrophone ? 1 : 0));
  const microphoneScale = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.82, 1],
      }),
    [progress],
  );
  const textTranslateX = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, chatComposerMicrophoneInset],
      }),
    [progress],
  );

  useEffect(() => {
    const transition = Animated.timing(progress, {
      duration: chatComposerMicrophoneTransitionDurationMs,
      easing: Easing.out(Easing.cubic),
      isInteraction: false,
      toValue: showsMicrophone ? 1 : 0,
      useNativeDriver: true,
    });
    transition.start();
    return () => transition.stop();
  }, [progress, showsMicrophone]);

  return {
    microphoneOpacity: progress,
    microphoneScale,
    textTranslateX,
  };
}

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
  restingInset,
  stickerPanel,
}: {
  isKeyboardFocused: boolean;
  keyboardEquivalentInset: number;
  keyboardInset: number;
  panel: ChatComposerPanel | null;
  plusItemCount: number;
  plusPanel: ReactNode;
  restingInset: number;
  stickerPanel: ReactNode;
}) {
  const safeRestingInset = Math.max(0, restingInset);
  const initialPanelHeight = chatComposerPanelHeight(panel, plusItemCount, keyboardEquivalentInset);
  const initialHeight =
    initialPanelHeight > 0 ? initialPanelHeight : Math.max(safeRestingInset, keyboardInset);
  const [layoutHeight, setLayoutHeight] = useState(initialHeight);
  const [panelViewportHeight, setPanelViewportHeight] = useState(initialPanelHeight);
  const [renderedPanel, setRenderedPanel] = useState(panel);
  const previousKeyboardInsetRef = useRef(keyboardInset);
  const previousPanelRef = useRef(panel);
  const targetHeightRef = useRef(initialHeight);
  const panelViewportTargetRef = useRef(initialPanelHeight);
  const transitionGenerationRef = useRef(0);
  const panelUnmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardFrameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardFocusRef = useRef(isKeyboardFocused);
  // The preceding keyboard frame is intentionally read for exactly one render so
  // the will-hide commit can animate from its native height all the way to idle.
  // eslint-disable-next-line react-hooks/refs
  const previousKeyboardInset = previousKeyboardInsetRef.current;
  const usesKeyboardEventHeight = chatComposerUsesKeyboardEventHeight(
    panel,
    keyboardInset,
    previousKeyboardInset,
  );
  const renderedHeight = usesKeyboardEventHeight
    ? Math.max(safeRestingInset, keyboardInset)
    : layoutHeight;

  /* eslint-disable react-hooks/set-state-in-effect -- The staged state commit is the
   * layout change consumed by LayoutAnimation; deferring it would miss the native
   * transaction and reintroduce a one-frame panel jump. */
  useLayoutEffect(() => {
    const previousPanel = previousPanelRef.current;
    const previousKeyboardHeight = previousKeyboardInsetRef.current;
    previousPanelRef.current = panel;
    previousKeyboardInsetRef.current = keyboardInset;
    keyboardFocusRef.current = isKeyboardFocused;
    const cancelPendingPanelUnmount = () => {
      if (panelUnmountTimerRef.current === null) return;
      clearTimeout(panelUnmountTimerRef.current);
      panelUnmountTimerRef.current = null;
    };
    const cancelKeyboardFrameTimeout = () => {
      if (keyboardFrameTimerRef.current === null) return;
      clearTimeout(keyboardFrameTimerRef.current);
      keyboardFrameTimerRef.current = null;
    };

    if (chatComposerUsesKeyboardEventHeight(panel, keyboardInset, previousKeyboardHeight)) {
      cancelKeyboardFrameTimeout();
      cancelPendingPanelUnmount();
      transitionGenerationRef.current += 1;
      const nextHeight = Math.max(safeRestingInset, keyboardInset);
      targetHeightRef.current = nextHeight;
      panelViewportTargetRef.current = 0;
      setPanelViewportHeight(0);
      setLayoutHeight((current) => (current === nextHeight ? current : nextHeight));
      if (keyboardInset > 0 && renderedPanel !== null) setRenderedPanel(null);
      return;
    }

    // A panel-to-keyboard transition keeps its current height until the first
    // keyboard frame arrives, avoiding an intermediate collapse to the safe area.
    if (panel === null && isKeyboardFocused) {
      const generation = ++transitionGenerationRef.current;
      cancelKeyboardFrameTimeout();
      cancelPendingPanelUnmount();
      if (renderedPanel !== null || targetHeightRef.current !== safeRestingInset) {
        keyboardFrameTimerRef.current = setTimeout(() => {
          keyboardFrameTimerRef.current = null;
          if (
            transitionGenerationRef.current !== generation ||
            previousPanelRef.current !== null ||
            previousKeyboardInsetRef.current > 0 ||
            !keyboardFocusRef.current
          )
            return;
          targetHeightRef.current = safeRestingInset;
          panelViewportTargetRef.current = 0;
          const finishTransition = () => {
            if (transitionGenerationRef.current !== generation) return;
            cancelPendingPanelUnmount();
            setRenderedPanel(null);
          };
          const duration = configureChatComposerPanelLayoutAnimation(true, finishTransition);
          panelUnmountTimerRef.current = setTimeout(finishTransition, duration + 34);
          setPanelViewportHeight(0);
          setLayoutHeight(safeRestingInset);
        }, chatComposerKeyboardFrameTimeoutMs);
      }
      return;
    }
    cancelKeyboardFrameTimeout();

    const nextHeight =
      chatComposerPanelHeight(panel, plusItemCount, keyboardEquivalentInset) || safeRestingInset;
    const nextPanelViewportHeight = panel === null ? 0 : nextHeight;
    const panelChanged = previousPanel !== panel;
    const heightChanged = targetHeightRef.current !== nextHeight;
    const panelViewportHeightChanged = panelViewportTargetRef.current !== nextPanelViewportHeight;
    if (!panelChanged && !heightChanged && !panelViewportHeightChanged) return;

    const generation = ++transitionGenerationRef.current;
    targetHeightRef.current = nextHeight;
    panelViewportTargetRef.current = nextPanelViewportHeight;
    if (panel !== null) {
      cancelPendingPanelUnmount();
      setRenderedPanel(panel);
    }

    if (!heightChanged && !panelViewportHeightChanged) {
      if (panel === null) setRenderedPanel(null);
      return;
    }

    const finishTransition = () => {
      if (panel !== null || transitionGenerationRef.current !== generation) return;
      cancelPendingPanelUnmount();
      setRenderedPanel(null);
    };
    const duration = configureChatComposerPanelLayoutAnimation(panel === null, finishTransition);
    if (panel === null) {
      // LayoutAnimation can be disabled by reduced-motion/runtime flags without
      // invoking its completion callback, so always retain a bounded JS fallback.
      panelUnmountTimerRef.current = setTimeout(finishTransition, duration + 34);
    }
    setPanelViewportHeight(nextPanelViewportHeight);
    setLayoutHeight(nextHeight);
  }, [
    isKeyboardFocused,
    keyboardEquivalentInset,
    keyboardInset,
    panel,
    plusItemCount,
    renderedPanel,
    safeRestingInset,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(
    () => () => {
      transitionGenerationRef.current += 1;
      if (panelUnmountTimerRef.current !== null) clearTimeout(panelUnmountTimerRef.current);
      if (keyboardFrameTimerRef.current !== null) clearTimeout(keyboardFrameTimerRef.current);
    },
    [],
  );

  return (
    <View
      accessibilityElementsHidden={panel === null}
      importantForAccessibility={panel === null ? "no-hide-descendants" : "auto"}
      pointerEvents={panel === null ? "none" : "auto"}
      testID="chat-composer-panel-host"
      style={[styles.panelHost, { height: renderedHeight }]}
    >
      <View
        testID="chat-composer-panel-viewport"
        style={[styles.panelViewport, { height: panelViewportHeight }]}
      >
        {renderedPanel === "stickers" ? stickerPanel : renderedPanel === "plus" ? plusPanel : null}
      </View>
    </View>
  );
}

export function chatComposerRestingInset(safeAreaBottom: number): number {
  return 7 + Math.max(0, safeAreaBottom);
}

export function chatComposerUsesKeyboardEventHeight(
  panel: ChatComposerPanel | null,
  keyboardInset: number,
  previousKeyboardInset: number,
): boolean {
  return panel === null && (keyboardInset > 0 || previousKeyboardInset > 0);
}

function configureChatComposerPanelLayoutAnimation(
  isDismissing: boolean,
  onAnimationDidEnd: () => void,
): number {
  const duration = isDismissing
    ? chatComposerPanelDismissDurationMs
    : chatComposerSurfacePolicy.transitionDurationMs;
  LayoutAnimation.configureNext(
    {
      duration,
      update: {
        duration,
        type: isDismissing ? LayoutAnimation.Types.easeOut : LayoutAnimation.Types.easeInEaseOut,
      },
    },
    onAnimationDidEnd,
  );
  return duration;
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
    backgroundColor: colors.card,
    overflow: "hidden",
    width: "100%",
  },
  panelViewport: {
    backgroundColor: "rgba(242,242,247,0.98)",
    overflow: "hidden",
    width: "100%",
  },
});
