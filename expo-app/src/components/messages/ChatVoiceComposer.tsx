import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from "expo-audio";
import { File } from "expo-file-system";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  interpolate,
  interpolateColor,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import {
  chatVoiceRecordingPolicy,
  chatVoiceRecordingVisualPolicy,
  formatChatVoiceRecordingDuration,
} from "@/services/messages/chatVoicePolicy";
import { stopChatVoicePlayback } from "@/services/messages/ChatVoicePlaybackService";
import { colors } from "@/theme";

export interface ChatVoiceRecording {
  uri: string;
  duration: number;
  filename: string;
}

export interface VoiceRecordingVisualState {
  duration: number;
  isCanceling: boolean;
}

type RecorderPhase = "idle" | "starting" | "recording";
type ReleaseAction = "send" | "cancel";

const recordingOptions: RecordingOptions = {
  extension: chatVoiceRecordingPolicy.extension,
  sampleRate: chatVoiceRecordingPolicy.sampleRate,
  numberOfChannels: chatVoiceRecordingPolicy.numberOfChannels,
  bitRate: chatVoiceRecordingPolicy.bitRate,
  android: {
    extension: chatVoiceRecordingPolicy.extension,
    sampleRate: chatVoiceRecordingPolicy.sampleRate,
    outputFormat: "mpeg4",
    audioEncoder: "aac",
  },
  ios: {
    extension: chatVoiceRecordingPolicy.extension,
    sampleRate: chatVoiceRecordingPolicy.sampleRate,
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
  },
  web: { mimeType: "audio/mp4", bitsPerSecond: chatVoiceRecordingPolicy.bitRate },
};

export function ChatVoiceComposer({
  onError,
  onExitVoiceMode,
  onRecorded,
  onRecordingStateChange,
}: {
  onError: (message: string) => void;
  onExitVoiceMode: () => void;
  onRecorded: (recording: ChatVoiceRecording) => void | Promise<void>;
  onRecordingStateChange: (state: VoiceRecordingVisualState | null) => void;
}) {
  const recorder = useAudioRecorder(recordingOptions);
  const recorderState = useAudioRecorderState(recorder, 100);
  const [isRecording, setIsRecording] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const phaseRef = useRef<RecorderPhase>("idle");
  const pendingReleaseRef = useRef<ReleaseAction | null>(null);
  const endingRef = useRef(false);
  const startedAtRef = useRef(0);
  const startPageYRef = useRef(0);
  const cancelingRef = useRef(false);
  const duration = Math.max(recorderState.durationMillis / 1_000, 0);
  const buttonState = useSharedValue(0);

  useEffect(() => {
    buttonState.value = withTiming(isRecording ? (isCanceling ? 2 : 1) : 0, {
      duration: chatVoiceRecordingVisualPolicy.cancelTransitionMilliseconds,
      easing: Easing.inOut(Easing.ease),
    });
  }, [buttonState, isCanceling, isRecording]);

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      buttonState.value,
      [0, 1, 2],
      ["rgba(255,255,255,0.92)", colors.accent, "rgba(255,59,48,0.8)"],
    ),
    borderColor: interpolateColor(
      buttonState.value,
      [0, 1],
      ["rgba(255,255,255,0.85)", "rgba(255,255,255,0)"],
    ),
    shadowOpacity: interpolate(buttonState.value, [0, 1], [0.04, 0]),
  }));

  const finishRecording = useCallback(async (action: ReleaseAction) => {
    if (endingRef.current || phaseRef.current !== "recording") return;
    endingRef.current = true;
    const measuredDuration = Math.max(
      recorder.currentTime,
      (Date.now() - startedAtRef.current) / 1_000,
    );
    try {
      await recorder.stop();
      const uri = recorder.uri;
      phaseRef.current = "idle";
      setIsRecording(false);
      setIsCanceling(false);
      cancelingRef.current = false;
      await setAudioModeAsync({
        allowsRecording: false,
        interruptionMode: "doNotMix",
        playsInSilentMode: true,
      }).catch(() => undefined);
      if (
        !uri ||
        action === "cancel" ||
        measuredDuration < chatVoiceRecordingPolicy.minimumDurationSeconds
      ) {
        if (uri) deleteRecording(uri);
        return;
      }
      void Promise.resolve(onRecorded({
        uri,
        duration: measuredDuration,
        filename: `voice_${Math.floor(Date.now() / 1_000)}.m4a`,
      })).catch((error: unknown) => {
        onError(error instanceof Error ? error.message : "语音发送失败");
      });
    } catch (error) {
      phaseRef.current = "idle";
      setIsRecording(false);
      onError(error instanceof Error ? error.message : "语音录制失败");
    } finally {
      endingRef.current = false;
      pendingReleaseRef.current = null;
    }
  }, [onError, onRecorded, recorder]);

  const startRecording = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    phaseRef.current = "starting";
    pendingReleaseRef.current = null;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error("请允许麦克风权限后再发送语音");
      stopChatVoicePlayback();
      await setAudioModeAsync({
        allowsRecording: true,
        interruptionMode: "doNotMix",
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAtRef.current = Date.now();
      phaseRef.current = "recording";
      setIsRecording(true);
      const pendingAction = pendingReleaseRef.current;
      if (pendingAction) await finishRecording(pendingAction);
    } catch (error) {
      phaseRef.current = "idle";
      pendingReleaseRef.current = null;
      setIsRecording(false);
      onError(error instanceof Error ? error.message : "语音录制失败");
    }
  }, [finishRecording, onError, recorder]);

  const requestFinish = useCallback((action: ReleaseAction) => {
    if (phaseRef.current === "starting") {
      pendingReleaseRef.current = action;
      return;
    }
    if (phaseRef.current === "recording") void finishRecording(action);
  }, [finishRecording]);

  useEffect(() => {
    onRecordingStateChange(isRecording ? { duration, isCanceling } : null);
  }, [duration, isCanceling, isRecording, onRecordingStateChange]);

  useEffect(() => () => {
    onRecordingStateChange(null);
    if (recorder.isRecording) void recorder.stop();
  }, [onRecordingStateChange, recorder]);

  const updateCancelZone = (event: GestureResponderEvent) => {
    const next = event.nativeEvent.pageY - startPageYRef.current < chatVoiceRecordingPolicy.cancelTranslationY;
    if (next === cancelingRef.current) return;
    cancelingRef.current = next;
    setIsCanceling(next);
  };

  return (
    <Animated.View
      accessibilityLabel={isRecording
        ? (isCanceling ? "松开 取消" : "松开 发送")
        : "按住 说话"}
      accessibilityRole="button"
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => {
        startPageYRef.current = event.nativeEvent.pageY;
        void startRecording();
      }}
      onResponderMove={updateCancelZone}
      onResponderRelease={() => requestFinish(cancelingRef.current ? "cancel" : "send")}
      onResponderTerminate={() => requestFinish("cancel")}
      onResponderTerminationRequest={() => false}
      onStartShouldSetResponder={() => true}
      style={[styles.recordButton, buttonAnimatedStyle]}
    >
      <Text style={[styles.recordText, isRecording && styles.recordTextActive]}>
        {isRecording ? (isCanceling ? "松开 取消" : "松开 发送") : "按住 说话"}
      </Text>
      <View
        accessibilityLabel="切换键盘"
        accessibilityRole="button"
        onStartShouldSetResponder={() => true}
        onResponderRelease={() => {
          if (!isRecording) onExitVoiceMode();
        }}
        style={styles.keyboardButton}
      >
        <SymbolView
          name="keyboard"
          size={20}
          weight="medium"
          tintColor={isRecording ? "#FFFFFF" : colors.accent}
        />
      </View>
    </Animated.View>
  );
}

export function VoiceRecordingOverlay({ state }: { state: VoiceRecordingVisualState | null }) {
  const cancelProgress = useSharedValue(state?.isCanceling ? 1 : 0);
  useEffect(() => {
    cancelProgress.value = withTiming(state?.isCanceling ? 1 : 0, {
      duration: chatVoiceRecordingVisualPolicy.circleTransitionMilliseconds,
      easing: Easing.inOut(Easing.ease),
    });
  }, [cancelProgress, state?.isCanceling]);
  const circleAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      cancelProgress.value,
      [0, 1],
      [colors.accent, "rgba(255,59,48,0.9)"],
    ),
    transform: [{
      scale: interpolate(
        cancelProgress.value,
        [0, 1],
        [1, chatVoiceRecordingVisualPolicy.cancelCircleScale],
      ),
    }],
  }));
  if (!state) return null;
  return (
    <View pointerEvents="none" style={styles.overlay}>
      <View style={styles.overlayStack}>
        <Animated.View style={[styles.recordCircle, circleAnimatedStyle]}>
          {state.isCanceling ? (
            <SymbolView name="xmark" size={36} weight="bold" tintColor="#FFFFFF" />
          ) : <RecordingWave />}
        </Animated.View>
        <Text style={styles.timer}>{formatChatVoiceRecordingDuration(state.duration)}</Text>
        <Text style={styles.cancelHint}>
          {state.isCanceling ? "松开 取消发送" : "上滑 取消"}
        </Text>
      </View>
    </View>
  );
}

function RecordingWave() {
  return (
    <View style={styles.recordingWave}>
      {chatVoiceRecordingVisualPolicy.recordingWaveHeights.map((height, index) => (
        <RecordingBar height={height} index={index} key={index} />
      ))}
    </View>
  );
}

function RecordingBar({ height, index }: { height: number; index: number }) {
  const scale = useSharedValue(0.72);
  useEffect(() => {
    scale.value = withDelay(
      index * chatVoiceRecordingVisualPolicy.recordingWaveDelayMilliseconds,
      withRepeat(withTiming(1, {
        duration: chatVoiceRecordingVisualPolicy.recordingWaveDurationMilliseconds,
        easing: Easing.inOut(Easing.ease),
      }), -1, true),
    );
  }, [index, scale]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: scale.value }] }));
  return <Animated.View style={[styles.recordingBar, { height }, animatedStyle]} />;
}

function deleteRecording(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup may already have removed a short/cancelled recording.
  }
}

const styles = StyleSheet.create({
  recordButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: chatVoiceRecordingVisualPolicy.buttonCornerRadius,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  recordText: { color: colors.text, fontSize: 16, fontWeight: "500" },
  recordTextActive: { color: "#FFFFFF" },
  keyboardButton: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 100,
    backgroundColor: `rgba(0,0,0,${chatVoiceRecordingVisualPolicy.overlayOpacity})`,
  },
  overlayStack: { flex: 1, alignItems: "center", justifyContent: "flex-end", rowGap: chatVoiceRecordingVisualPolicy.overlaySpacing },
  recordCircle: {
    width: chatVoiceRecordingVisualPolicy.circleSize,
    height: chatVoiceRecordingVisualPolicy.circleSize,
    borderRadius: chatVoiceRecordingVisualPolicy.circleSize / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  timer: {
    color: "#FFFFFF",
    fontSize: chatVoiceRecordingVisualPolicy.timerFontSize,
    fontWeight: "300",
    fontVariant: ["tabular-nums"],
  },
  cancelHint: {
    marginBottom: chatVoiceRecordingVisualPolicy.hintBottomPadding,
    color: "rgba(255,255,255,0.7)",
    fontSize: chatVoiceRecordingVisualPolicy.hintFontSize,
  },
  recordingWave: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: chatVoiceRecordingVisualPolicy.recordingWaveBarSpacing,
  },
  recordingBar: {
    width: chatVoiceRecordingVisualPolicy.recordingWaveBarWidth,
    borderRadius: chatVoiceRecordingVisualPolicy.recordingWaveBarWidth / 2,
    backgroundColor: "#FFFFFF",
  },
});
