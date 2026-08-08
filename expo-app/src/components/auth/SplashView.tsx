import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Animated, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocalization } from "@/providers/LocalizationProvider";
import { splashMetrics, splashSpringPhysics } from "@/services/auth/splashPolicy";
import { authPalette } from "@/components/auth/AuthChrome";

export function SplashView() {
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.spring(progress, {
      toValue: 1,
      ...splashSpringPhysics,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  const opacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [splashMetrics.logoInitialScale, splashMetrics.logoFinalScale],
  });

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.topSpacer} />
      <View style={styles.stack}>
        <Animated.Text
          allowFontScaling={false}
          style={[styles.logo, { opacity, transform: [{ scale }] }]}
        >
          BBchat
        </Animated.Text>
        <Animated.Text allowFontScaling={false} style={[styles.entering, { opacity }]}>
          {t("splash.entering")}
        </Animated.Text>
        <Animated.Text allowFontScaling={false} style={[styles.tagline, { opacity }]}>
          {t("splash.tagline")}
        </Animated.Text>
        <Animated.View style={[styles.progress, { opacity }]}>
          <ActivityIndicator color={authPalette.tailGreen} />
        </Animated.View>
      </View>
      <View
        style={[
          styles.bottomSpacer,
          {
            height: splashMetrics.bottomInset + splashMetrics.contentGap + insets.bottom,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: "stretch", backgroundColor: "#FFFFFF" },
  topSpacer: { flex: 1 },
  stack: { alignItems: "center", gap: splashMetrics.contentGap },
  logo: {
    color: authPalette.ink,
    fontFamily: Platform.select({ ios: ".AppleSystemUIFontRounded-Heavy", default: undefined }),
    fontSize: splashMetrics.logoSize,
    fontWeight: "900",
    top: splashMetrics.logoVerticalOpticalOffset,
  },
  entering: {
    color: authPalette.mutedText,
    fontSize: splashMetrics.enteringSize,
    fontWeight: "600",
  },
  tagline: {
    color: "rgba(107,114,128,0.72)",
    fontSize: splashMetrics.taglineSize,
    fontWeight: "500",
    textAlign: "center",
  },
  progress: { marginTop: splashMetrics.progressTopInset },
  bottomSpacer: {},
});
