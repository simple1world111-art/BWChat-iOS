import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import {
  useChatMessageActivationGuard,
  useChatMessageLongPressBridge,
} from "@/components/messages/ChatReplyViews";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  getChatVoicePlaybackSnapshot,
  subscribeChatVoicePlayback,
  toggleChatVoicePlayback,
} from "@/services/messages/ChatVoicePlaybackService";
import {
  chatVoiceBubblePolicy,
  chatVoiceBubbleWidth,
  parseChatVoiceContent,
} from "@/services/messages/chatVoicePolicy";
import { colors } from "@/theme";

export function ChatVoiceBubble({
  content,
  isFromMe,
  isPending = false,
}: {
  content: string;
  isFromMe: boolean;
  isPending?: boolean | undefined;
}) {
  const canActivate = useChatMessageActivationGuard();
  const longPressBridge = useChatMessageLongPressBridge();
  const { t } = useLocalization();
  const voice = parseChatVoiceContent(content);
  const playback = useSyncExternalStore(
    subscribeChatVoicePlayback,
    getChatVoicePlaybackSnapshot,
    getChatVoicePlaybackSnapshot,
  );
  const isPlaying = !isPending && playback.url === voice.url && playback.is_playing;
  const displayedDuration = Math.floor(isPlaying ? playback.current_time : voice.duration);
  const width = isPending ? 100 : chatVoiceBubbleWidth(voice.duration);
  const foreground = isFromMe ? "#FFFFFF" : colors.text;
  const body = (
    <View style={styles.content}>
      {!isFromMe ? <VoiceWaveBars color={foreground} isPlaying={isPlaying} /> : null}
      {!isFromMe ? <View style={styles.spacer} /> : null}
      <Text style={[styles.duration, { color: foreground }]}>{displayedDuration}&quot;</Text>
      {isFromMe ? <View style={styles.spacer} /> : null}
      {isFromMe ? <VoiceWaveBars color={foreground} isPlaying={isPlaying} /> : null}
    </View>
  );

  if (isFromMe) {
    return (
      <Pressable
        accessibilityLabel={`${t("message.voice")} ${displayedDuration}\"`}
        accessibilityRole="button"
        accessibilityState={{ disabled: isPending || !voice.url }}
        delayLongPress={longPressBridge.delayLongPress}
        disabled={isPending || !voice.url}
        onLongPress={longPressBridge.onLongPress}
        onPress={() => {
          if (canActivate()) void toggleChatVoicePlayback(voice.url);
        }}
        onPressOut={longPressBridge.onPressOut}
      >
        <LinearGradient
          colors={[colors.accent, "#764BA2"]}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={[styles.bubble, styles.fromMe, { width }]}
        >
          {body}
        </LinearGradient>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityLabel={`${t("message.voice")} ${displayedDuration}\"`}
      accessibilityRole="button"
      accessibilityState={{ disabled: isPending || !voice.url }}
      delayLongPress={longPressBridge.delayLongPress}
      disabled={isPending || !voice.url}
      onLongPress={longPressBridge.onLongPress}
      onPress={() => {
        if (canActivate()) void toggleChatVoicePlayback(voice.url);
      }}
      onPressOut={longPressBridge.onPressOut}
      style={[styles.bubble, styles.received, { width }]}
    >
      {body}
    </Pressable>
  );
}

function VoiceWaveBars({ color, isPlaying }: { color: string; isPlaying: boolean }) {
  return (
    <View style={styles.wave}>
      {chatVoiceBubblePolicy.idleWaveHeights.map((height, index) => (
        <VoiceWaveBar
          color={color}
          idleHeight={height}
          index={index}
          isPlaying={isPlaying}
          key={index}
        />
      ))}
    </View>
  );
}

function VoiceWaveBar({
  color,
  idleHeight,
  index,
  isPlaying,
}: {
  color: string;
  idleHeight: number;
  index: number;
  isPlaying: boolean;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = isPlaying
      ? withDelay(index * 150, withRepeat(withTiming(1, { duration: 400 }), -1, true))
      : withTiming(0, { duration: 150 });
  }, [index, isPlaying, progress]);
  const animatedStyle = useAnimatedStyle(() => ({
    height:
      idleHeight + (chatVoiceBubblePolicy.playingWaveHeights[index]! - idleHeight) * progress.value,
  }));
  return <Animated.View style={[styles.bar, { backgroundColor: color }, animatedStyle]} />;
}

const styles = StyleSheet.create({
  bubble: {
    paddingHorizontal: chatVoiceBubblePolicy.horizontalPadding,
    paddingVertical: chatVoiceBubblePolicy.verticalPadding,
    borderRadius: chatVoiceBubblePolicy.cornerRadius,
    justifyContent: "center",
  },
  fromMe: { borderBottomRightRadius: 0 },
  received: { borderBottomLeftRadius: 0, backgroundColor: colors.card },
  content: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: chatVoiceBubblePolicy.contentSpacing,
  },
  spacer: { flex: 1 },
  duration: { fontSize: chatVoiceBubblePolicy.durationFontSize },
  wave: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: chatVoiceBubblePolicy.waveBarSpacing,
    height: 14,
  },
  bar: { width: chatVoiceBubblePolicy.waveBarWidth, borderRadius: 1 },
});
