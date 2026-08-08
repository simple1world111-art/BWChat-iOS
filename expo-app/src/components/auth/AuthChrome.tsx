import { SymbolView, type SFSymbol } from "expo-symbols";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { nativeAssets } from "../../assets/nativeAssets";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

export const authPalette = {
  blue: "#4BB7E8",
  coral: "#FF6C7C",
  tailGreen: "#57DDBB",
  amber: "#F4B642",
  ink: "#20222E",
  softInk: "#4A5160",
  cardFill: "#FFFFFF",
  cardStroke: "#E9ECF2",
  fieldFill: "#F6F8FB",
  fieldStroke: "#E2E7EF",
  placeholderText: "#8E96A6",
  mutedText: "#6B7280",
  disabledFill: "#D9DEE7",
} as const;

export const authLayout = {
  catFormTopPadding: 142,
  catSize: 258,
  catFloatingPeekOffset: -43,
  loginTopSpacing(height: number, isEditing: boolean): number {
    return isEditing
      ? Math.max(Math.min(height * 0.05, 44), 14)
      : Math.max(Math.min(height * 0.1, 84), 54);
  },
  registerTopSpacing(height: number, isEditing: boolean): number {
    return isEditing
      ? Math.max(Math.min(height * 0.035, 30), 10)
      : Math.max(Math.min(height * 0.07, 58), 28);
  },
} as const;

export type AuthCatMood = "idle" | "peek" | "coverEyes";

export function configureAuthFocusShiftAnimation(): void {
  LayoutAnimation.configureNext({
    duration: 360,
    update: {
      type: LayoutAnimation.Types.spring,
      springDamping: 0.88,
    },
  });
}

// expo-symbols uses the symbol's image bounds while SwiftUI sizes its
// typographic frame. This optical size reproduces the 15pt SwiftUI eye glyph.
export const authPasswordVisibilitySymbolSize = 23;

const catArt = {
  idle: {
    source: nativeAssets.authCatIdle,
    scale: 1.26,
    offsetY: 0,
  },
  peek: {
    source: nativeAssets.authCatPeek,
    scale: 0.9,
    offsetY: 0,
  },
  coverEyes: {
    source: nativeAssets.authCatCover,
    scale: 1.22,
    offsetY: -3,
  },
} as const;

export function AuthCatFormStack({
  mood,
  children,
}: {
  mood: AuthCatMood;
  children: React.ReactNode;
}) {
  const [opacity] = useState(() => ({
    idle: new Animated.Value(1),
    peek: new Animated.Value(0),
    coverEyes: new Animated.Value(0),
  }));

  useEffect(() => {
    const animation = Animated.parallel(
      (Object.keys(opacity) as AuthCatMood[]).map((candidate) =>
        Animated.spring(opacity[candidate], {
          toValue: candidate === mood ? 1 : 0,
          stiffness: 190,
          damping: 27,
          mass: 1,
          useNativeDriver: true,
        }),
      ),
    );
    animation.start();
    return () => animation.stop();
  }, [mood, opacity]);

  return (
    <View style={styles.catStack}>
      <AnimatedCat mood="idle" opacity={opacity.idle} />
      <AnimatedCat mood="coverEyes" opacity={opacity.coverEyes} />
      <View style={styles.formLayer}>{children}</View>
      <AnimatedCat mood="peek" opacity={opacity.peek} floating />
    </View>
  );
}

function AnimatedCat({
  mood,
  opacity,
  floating = false,
}: {
  mood: AuthCatMood;
  opacity: Animated.Value;
  floating?: boolean;
}) {
  const art = catArt[mood];
  return (
    <Animated.Image
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      resizeMode="contain"
      source={art.source}
      style={[
        styles.cat,
        floating && styles.floatingCat,
        {
          opacity,
          transform: [
            {
              scale: opacity.interpolate({
                inputRange: [0, 1],
                outputRange: [art.scale * 0.98, art.scale],
              }),
            },
            {
              translateY: opacity.interpolate({
                inputRange: [0, 1],
                outputRange: [art.offsetY + 4, art.offsetY],
              }),
            },
          ],
        },
      ]}
    />
  );
}

export function AuthTitleLockup({
  title,
  subtitle,
  spacing = 6,
}: {
  title: string;
  subtitle: string;
  spacing?: number;
}) {
  return (
    <View style={[styles.titleLockup, { rowGap: spacing }]}>
      <Text allowFontScaling={false} adjustsFontSizeToFit numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <Text allowFontScaling={false} adjustsFontSizeToFit numberOfLines={1} style={styles.subtitle}>
        {subtitle}
      </Text>
    </View>
  );
}

export function AuthFormCard({
  children,
  rowGap = 14,
}: {
  children: React.ReactNode;
  rowGap?: number;
}) {
  return (
    <View style={[styles.formCard, { rowGap }]}>
      <View pointerEvents="none" style={styles.formCardSurface} />
      {children}
    </View>
  );
}

export function AuthFieldChrome({
  symbol,
  isFocused,
  children,
  onPress,
}: {
  symbol: SFSymbol;
  isFocused: boolean;
  children: React.ReactNode;
  onPress?: (() => void) | undefined;
}) {
  return (
    <View style={styles.field}>
      <View
        pointerEvents="none"
        style={[styles.fieldSurface, isFocused && styles.focusedFieldSurface]}
      />
      {onPress ? (
        <Pressable accessible={false} onPress={onPress} style={StyleSheet.absoluteFill} />
      ) : null}
      <SymbolView
        pointerEvents="none"
        name={symbol}
        size={authFieldSymbolSize(symbol)}
        weight="semibold"
        tintColor={isFocused ? authPalette.tailGreen : "rgba(74,81,96,0.62)"}
        style={[styles.fieldSymbol, symbol === "person.fill" && styles.personSymbolCorrection]}
      />
      {children}
    </View>
  );
}

function authFieldSymbolSize(symbol: SFSymbol): number {
  switch (symbol) {
    case "person.fill":
      return 17.25;
    case "face.smiling":
      return 19.5;
    case "lock.fill":
      return 18.75;
    case "lock.rotation":
      return 19.5;
    default:
      return 16;
  }
}

export function AuthPrimaryButton({
  title,
  isLoading,
  isEnabled,
  onPress,
}: {
  title: string;
  isLoading: boolean;
  isEnabled: boolean;
  onPress: () => void;
}) {
  return (
    <View
      style={[
        styles.primaryButtonShadow,
        isEnabled ? styles.primaryButtonEnabledShadow : styles.primaryButtonDisabledShadow,
      ]}
    >
      <Pressable
        accessibilityLabel={title}
        accessibilityRole="button"
        accessibilityState={{ busy: isLoading, disabled: !isEnabled }}
        disabled={!isEnabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.primaryButton,
          !isEnabled && styles.primaryButtonDisabled,
          pressed && isEnabled && styles.buttonPressed,
        ]}
      >
        {isEnabled ? (
          <LinearGradient
            colors={[authPalette.tailGreen, authPalette.coral]}
            end={{ x: 1, y: 0.5 }}
            start={{ x: 0, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.disabledButton]} />
        )}
        {isLoading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text allowFontScaling={false} style={styles.primaryButtonText}>
            {title}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

export function AuthInlineMessage({
  message,
  symbol = "exclamationmark.triangle.fill",
  color = "#FF3B30",
}: {
  message: string;
  symbol?: SFSymbol;
  color?: string;
}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.inlineMessage}>
      <SymbolView
        name={symbol}
        size={12}
        weight="semibold"
        tintColor={color}
        style={styles.inlineIcon}
      />
      <Text allowFontScaling={false} numberOfLines={2} style={[styles.inlineText, { color }]}>
        {message}
      </Text>
    </View>
  );
}

export function KeyboardDoneAccessory({ doneLabel }: { doneLabel: string; nativeID: string }) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const changeSubscription = Keyboard.addListener("keyboardWillChangeFrame", (event) => {
      setKeyboardHeight(Math.max(0, event.endCoordinates.height));
    });
    const hideSubscription = Keyboard.addListener("keyboardWillHide", () => setKeyboardHeight(0));
    return () => {
      changeSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  if (Platform.OS !== "ios") return null;
  if (keyboardHeight <= 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={doneLabel}
      hitSlop={8}
      onPress={() => Keyboard.dismiss()}
      style={[styles.doneButton, { bottom: keyboardHeight }]}
    >
      <Text allowFontScaling={false} style={styles.doneText}>
        {doneLabel}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  catStack: { width: "100%", minHeight: authLayout.catFormTopPadding, alignItems: "center" },
  cat: {
    position: "absolute",
    top: 0,
    width: authLayout.catSize,
    height: authLayout.catSize,
    zIndex: 0,
  },
  floatingCat: { top: authLayout.catFloatingPeekOffset, zIndex: 3 },
  formLayer: { width: "100%", paddingTop: authLayout.catFormTopPadding, zIndex: 1 },
  titleLockup: {
    width: "100%",
    alignItems: "center",
    transform: [{ translateX: 1 / 3 }],
  },
  title: {
    color: authPalette.ink,
    fontFamily: Platform.select({ ios: ".AppleSystemUIFontRounded-Heavy", default: undefined }),
    fontSize: 35,
  },
  subtitle: { color: authPalette.mutedText, fontSize: 15, fontWeight: "600" },
  formCard: {
    width: "100%",
    padding: 16,
  },
  formCardSurface: {
    position: "absolute",
    // SwiftUI's overlay stroke straddles the shape edge. A one-physical-pixel
    // expansion at the 3x acceptance scale reproduces that outside half.
    top: -1 / 3,
    right: -1 / 3,
    bottom: -1 / 3,
    left: -1 / 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: authPalette.cardStroke,
    backgroundColor: authPalette.cardFill,
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  field: {
    width: "100%",
    height: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 12,
  },
  fieldSurface: {
    position: "absolute",
    top: -1 / 3,
    right: -1 / 3,
    bottom: -1 / 3,
    left: -1 / 3,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: authPalette.fieldStroke,
    backgroundColor: authPalette.fieldFill,
    // SwiftUI's shadow on AuthFormCard is rendered for its descendant
    // shapes as well as the outer card silhouette.
    shadowColor: "#000000",
    shadowOpacity: 0.085,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  focusedFieldSurface: { borderColor: "rgba(87,221,187,0.82)" },
  fieldSymbol: { width: 22 },
  personSymbolCorrection: { transform: [{ translateY: 2 / 3 }] },
  primaryButtonShadow: {
    width: "100%",
    height: 52,
    marginTop: 4,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
  },
  primaryButtonEnabledShadow: {
    shadowColor: authPalette.coral,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  primaryButtonDisabledShadow: {
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  primaryButton: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  // RN composites disabled opacity in sRGB differently from SwiftUI. This
  // calibrated source color renders as the native #E8EAEF screenshot pixel.
  disabledButton: { backgroundColor: "#D9DCE4" },
  primaryButtonDisabled: { opacity: 0.6 },
  buttonPressed: { opacity: 0.86, transform: [{ scale: 0.995 }] },
  primaryButtonText: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  inlineMessage: {
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 7,
    paddingHorizontal: 2,
  },
  inlineIcon: { marginTop: 2 },
  inlineText: { flex: 1, fontSize: 13, fontWeight: "500" },
  doneButton: {
    position: "absolute",
    right: 20,
    width: 64,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.96)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 5 },
    zIndex: 100,
  },
  doneText: {
    color: "#000000",
    fontSize: 15,
    fontWeight: "600",
    transform: [{ translateX: 1 }],
  },
});
