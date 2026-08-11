import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useRef } from "react";
import { Pressable, StyleSheet, type GestureResponderEvent } from "react-native";

import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { env } from "@/config/env";
import { useLocalization } from "@/providers/LocalizationProvider";
import { colors, radius } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export function Avatar({
  uri,
  name,
  size = 52,
  cornerRadius,
}: {
  uri?: string | undefined;
  name: string;
  size?: number | undefined;
  cornerRadius?: number | undefined;
}) {
  const borderRadius = cornerRadius ?? size * 0.22;
  const resolvedUri = resolveMediaUrl(uri, env.apiBaseUrl);
  const fallback = (
    <LinearGradient
      accessibilityLabel={name.trim() || undefined}
      colors={[colors.accent, colors.accentDark]}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={[styles.fallback, { width: size, height: size, borderRadius }]}
    >
      <SymbolView
        name="person.fill"
        size={size * 0.38}
        tintColor="rgba(255,255,255,0.8)"
        weight="medium"
      />
    </LinearGradient>
  );
  if (resolvedUri) {
    return (
      <AuthenticatedImage
        {...(name.trim() ? { accessibilityLabel: name.trim() } : {})}
        errorFallback={fallback}
        fallback={fallback}
        loadingFallback={fallback}
        style={{ width: size, height: size, borderRadius }}
        contentFit="cover"
        transition={0}
        uri={resolvedUri}
      />
    );
  }
  return fallback;
}

export function UserAvatarButton({
  userId,
  avatarUrl,
  size,
  accessibilityName,
  onLongPress,
  onPressOut,
  canActivate,
}: {
  userId: string;
  avatarUrl?: string | undefined;
  size: number;
  accessibilityName?: string | undefined;
  onLongPress?: ((event: GestureResponderEvent) => void) | undefined;
  onPressOut?: (() => void) | undefined;
  canActivate?: (() => boolean) | undefined;
}) {
  const { t } = useLocalization();
  const lastOpenAt = useRef(Number.NEGATIVE_INFINITY);
  const lastLongPressAt = useRef(Number.NEGATIVE_INFINITY);
  const normalizedUserId = userId.trim();
  const normalizedName = accessibilityName?.trim() ?? "";

  const openProfile = (event: GestureResponderEvent) => {
    if (canActivate && !canActivate()) return;
    const timestamp = event.nativeEvent.timestamp;
    if (!normalizedUserId || timestamp - lastLongPressAt.current < 600) return;
    if (timestamp - lastOpenAt.current <= 600) return;
    lastOpenAt.current = timestamp;
    const normalizedAvatarUrl = avatarUrl?.trim() ?? "";
    router.push({
      pathname: "/user-profile",
      params: {
        id: normalizedUserId,
        ...(normalizedName ? { name: normalizedName } : {}),
        ...(normalizedAvatarUrl ? { avatar: normalizedAvatarUrl } : {}),
      },
    });
  };

  return (
    <Pressable
      accessibilityLabel={
        normalizedName ? t("profile.open", normalizedName) : t("profile.open.default")
      }
      accessibilityRole="button"
      delayLongPress={450}
      onLongPress={
        onLongPress
          ? (event) => {
              lastLongPressAt.current = event.nativeEvent.timestamp;
              onLongPress(event);
            }
          : undefined
      }
      onPress={openProfile}
      onPressOut={onPressOut}
    >
      <Avatar name={normalizedName} size={size} uri={avatarUrl} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.round,
  },
});
