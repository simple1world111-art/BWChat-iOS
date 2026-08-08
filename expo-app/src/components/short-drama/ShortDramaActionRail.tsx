import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import type { ShortDramaVideo } from "@/models";
import {
  compactShortDramaCount,
  shortDramaActionMetrics,
} from "@/services/short-drama/shortDramaInteractionPolicy";
import { colors } from "@/theme";

export function ShortDramaActionRail({
  currentUserId,
  onOpenComments,
  onOpenCreator,
  onToggleFollow,
  onToggleLike,
  text,
  video,
}: {
  currentUserId?: string | undefined;
  onOpenComments(): void;
  onOpenCreator(): void;
  onToggleFollow(): void;
  onToggleLike(): void;
  text(key: string): string;
  video: ShortDramaVideo;
}) {
  return (
    <View style={styles.rail}>
      <View style={styles.creatorStack}>
        <Pressable
          accessibilityLabel={video.creator.nickname}
          accessibilityRole="button"
          onPress={onOpenCreator}
          style={styles.avatarFrame}
        >
          <Avatar
            cornerRadius={shortDramaActionMetrics.creatorAvatarRadius}
            name={video.creator.nickname}
            size={shortDramaActionMetrics.creatorAvatarSize}
            uri={video.creator.avatar_url}
          />
          <View pointerEvents="none" style={styles.avatarStroke} />
        </Pressable>
        {video.creator.user_id !== currentUserId ? (
          <Pressable
            accessibilityLabel={
              video.creator.followed_by_me
                ? text("follow.followingButton")
                : text("follow.followButton")
            }
            accessibilityRole="button"
            accessibilityState={{ selected: video.creator.followed_by_me }}
            onPress={onToggleFollow}
            style={[
              styles.followButton,
              video.creator.followed_by_me ? styles.followingButton : styles.unfollowedButton,
            ]}
          >
            <SymbolView
              name={video.creator.followed_by_me ? "checkmark" : "plus"}
              size={shortDramaActionMetrics.followSymbolSize}
              weight="bold"
              tintColor={colors.white}
            />
          </Pressable>
        ) : null}
      </View>

      <RailButton
        accessibilityLabel={text("shortDrama.like")}
        accessibilitySelected={video.liked_by_me}
        count={video.like_count}
        onPress={onToggleLike}
        symbol={video.liked_by_me ? "heart.fill" : "heart"}
        tintColor={video.liked_by_me ? colors.danger : colors.white}
      />
      <RailButton
        accessibilityLabel={text("shortDrama.comments")}
        count={video.comment_count}
        onPress={onOpenComments}
        symbol="text.bubble.fill"
        tintColor={colors.white}
      />
    </View>
  );
}

function RailButton({
  accessibilityLabel,
  accessibilitySelected,
  count,
  onPress,
  symbol,
  tintColor,
}: {
  accessibilityLabel: string;
  accessibilitySelected?: boolean | undefined;
  count: number;
  onPress(): void;
  symbol: "heart.fill" | "heart" | "text.bubble.fill";
  tintColor: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={
        accessibilitySelected === undefined ? undefined : { selected: accessibilitySelected }
      }
      onPress={onPress}
      style={styles.railButton}
    >
      <View style={styles.symbolFootprint}>
        <SymbolView
          name={symbol}
          size={shortDramaActionMetrics.buttonIconSize}
          weight="bold"
          tintColor={tintColor}
        />
      </View>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={shortDramaActionMetrics.buttonCountMinimumScale}
        numberOfLines={1}
        style={styles.count}
      >
        {compactShortDramaCount(count)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: {
    width: shortDramaActionMetrics.railWidth,
    alignItems: "center",
    gap: shortDramaActionMetrics.railGap,
    shadowColor: "#000000",
    shadowOpacity: shortDramaActionMetrics.shadowOpacity,
    shadowRadius: shortDramaActionMetrics.shadowRadius,
    shadowOffset: { width: 0, height: shortDramaActionMetrics.shadowOffsetY },
  },
  creatorStack: { alignItems: "center", gap: shortDramaActionMetrics.creatorGap },
  avatarFrame: {
    width: shortDramaActionMetrics.creatorAvatarSize,
    height: shortDramaActionMetrics.creatorAvatarSize,
    borderRadius: shortDramaActionMetrics.creatorAvatarRadius,
  },
  avatarStroke: {
    ...StyleSheet.absoluteFill,
    borderRadius: shortDramaActionMetrics.creatorAvatarRadius,
    borderWidth: shortDramaActionMetrics.creatorAvatarStroke,
    borderColor: colors.white,
  },
  followButton: {
    width: shortDramaActionMetrics.followButtonSize,
    height: shortDramaActionMetrics.followButtonSize,
    borderRadius: shortDramaActionMetrics.followButtonSize / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  followingButton: { backgroundColor: "rgba(255,255,255,0.26)" },
  unfollowedButton: { backgroundColor: colors.danger },
  railButton: { alignItems: "center", gap: shortDramaActionMetrics.buttonCopyGap },
  symbolFootprint: {
    width: shortDramaActionMetrics.buttonIconWidth,
    height: shortDramaActionMetrics.buttonIconHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  count: {
    width: shortDramaActionMetrics.buttonCountWidth,
    color: colors.white,
    fontSize: shortDramaActionMetrics.buttonCountSize,
    fontWeight: "700",
    textAlign: "center",
  },
});
