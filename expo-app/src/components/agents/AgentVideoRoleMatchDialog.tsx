import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";

import type { AgentLiveVideoMatchController } from "@/services/live/useAgentLiveVideoMatch";
import { palette } from "@/theme";

interface AgentVideoRoleMatchDialogProps {
  controller: AgentLiveVideoMatchController;
  initialRole: string;
  onDismiss(): void;
  sourceAgentId: string;
}

export function AgentVideoRoleMatchDialog({
  controller,
  initialRole,
  onDismiss,
  sourceAgentId,
}: AgentVideoRoleMatchDialogProps) {
  const cancel = controller.cancel;
  const theme = palette(useColorScheme());
  const [role, setRole] = useState(initialRole);
  const [isRoleFocused, setRoleFocused] = useState(false);
  const trimmedRole = role.trim();
  const active = controller.isActive;

  useEffect(() => () => cancel(), [cancel]);

  const dismiss = () => {
    if (active) return;
    Keyboard.dismiss();
    setRoleFocused(false);
    cancel();
    onDismiss();
  };

  const handleBackdrop = () => {
    if (isRoleFocused) {
      Keyboard.dismiss();
      setRoleFocused(false);
    } else {
      dismiss();
    }
  };

  const match = () => {
    if (!trimmedRole || active) return;
    Keyboard.dismiss();
    setRoleFocused(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => undefined);
    void controller.start(trimmedRole, sourceAgentId);
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={() => {
        if (!active) dismiss();
      }}
      transparent
      visible
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalRoot}
      >
        <Pressable
          accessibilityLabel="关闭视频角色匹配弹窗"
          disabled={active}
          onPress={handleBackdrop}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.card,
              paddingVertical: active ? 10 : 18,
            },
          ]}
        >
          <View style={[styles.dialogContent, { height: active ? 326 : 224 }]}>
            {controller.status.kind === "idle" ? (
              <View style={styles.editorContent}>
                <Text style={[styles.title, { color: theme.text }]}>我希望你能扮演</Text>
                <View
                  style={[
                    styles.roleFrame,
                    {
                      backgroundColor: theme.background,
                      borderColor: isRoleFocused ? "rgba(102,126,234,0.72)" : theme.separator,
                      borderWidth: isRoleFocused ? 1.5 : 1,
                    },
                  ]}
                >
                  <TextInput
                    accessibilityLabel="请输入角色定位"
                    maxLength={1_000}
                    multiline
                    onBlur={() => setRoleFocused(false)}
                    onChangeText={setRole}
                    onFocus={() => setRoleFocused(true)}
                    placeholder="请输入角色定位"
                    placeholderTextColor={theme.tertiaryText}
                    style={[styles.roleInput, { color: theme.text }]}
                    textAlignVertical="top"
                    value={role}
                  />
                </View>
                <Pressable
                  accessibilityLabel="匹配，视频通话每分钟消耗100金币"
                  disabled={!trimmedRole}
                  onPress={match}
                  style={({ pressed }) => [
                    styles.matchButton,
                    !trimmedRole && styles.disabled,
                    pressed && trimmedRole ? styles.pressed : null,
                  ]}
                >
                  <LinearGradient
                    colors={[theme.accent, theme.accentDark]}
                    end={{ x: 1, y: 1 }}
                    start={{ x: 0, y: 0 }}
                    style={styles.matchGradient}
                  >
                    <Text style={styles.matchTitle}>匹配</Text>
                    <View style={styles.rateRow}>
                      <SymbolView name="pawprint.fill" size={11} tintColor="rgba(255,255,255,0.86)" />
                      <Text style={styles.rateText}>100金币/分钟</Text>
                    </View>
                  </LinearGradient>
                </Pressable>
              </View>
            ) : controller.status.kind === "unavailable" ? (
              <View style={styles.unavailableContent}>
                <SymbolView name="video.slash.fill" size={34} weight="medium" tintColor={theme.secondaryText} />
                <Text style={[styles.unavailableTitle, { color: theme.text }]}>
                  {controller.status.message}
                </Text>
                <Text style={[styles.unavailableDetail, { color: theme.secondaryText }]}>
                  可以稍后再试，或调整角色设定后重新匹配
                </Text>
                <View style={styles.unavailableActions}>
                  <Pressable
                    accessibilityLabel="关闭"
                    onPress={dismiss}
                    style={[styles.secondaryAction, { backgroundColor: theme.background }]}
                  >
                    <Text style={[styles.secondaryActionText, { color: theme.secondaryText }]}>关闭</Text>
                  </Pressable>
                  <Pressable accessibilityLabel="重新匹配" onPress={controller.reset} style={styles.primaryAction}>
                    <LinearGradient
                      colors={[theme.accent, theme.accentDark]}
                      end={{ x: 1, y: 1 }}
                      start={{ x: 0, y: 0 }}
                      style={styles.actionGradient}
                    >
                      <Text style={styles.primaryActionText}>重新匹配</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              </View>
            ) : (
              <AgentMatchingGlobe
                cancellable={controller.status.kind === "matching"}
                detail={
                  controller.status.kind === "matching"
                    ? "正在依次联系正在直播的用户"
                    : "正在连接视频"
                }
                onCancel={cancel}
                title={controller.status.kind === "matching" ? "正在匹配" : "主播已接受"}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function AgentMatchingGlobe({
  title,
  detail,
  cancellable,
  onCancel,
}: {
  title: string;
  detail: string;
  cancellable: boolean;
  onCancel(): void;
}) {
  const theme = palette(useColorScheme());
  const reducedMotion = useReducedMotion();
  const [rotation] = useState(() => new Animated.Value(0));
  const [breathing] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) {
      rotation.stopAnimation();
      breathing.stopAnimation();
      rotation.setValue(0);
      breathing.setValue(0);
      return;
    }
    const spin = Animated.loop(
      Animated.timing(rotation, {
        duration: 24_000,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(breathing, {
          duration: 1_800,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(breathing, {
          duration: 1_800,
          easing: Easing.inOut(Easing.ease),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    spin.start();
    pulse.start();
    return () => {
      spin.stop();
      pulse.stop();
    };
  }, [breathing, reducedMotion, rotation]);

  return (
    <View accessibilityLabel={`${title}，${detail}`} style={styles.matchingContent}>
      <View style={styles.globeFrame}>
        <Animated.View
          style={[
            styles.glow,
            {
              backgroundColor: theme.accent,
              opacity: breathing.interpolate({ inputRange: [0, 1], outputRange: [0.13, 0.22] }),
              transform: [{ scale: breathing.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] }) }],
            },
          ]}
        />
        <Animated.View
          style={{
            transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
          }}
        >
          <Image
            contentFit="cover"
            source={require("../../../assets/native-original/Assets.xcassets/agent_matching_earth_texture.imageset/agent_matching_earth_texture.jpg")}
            style={styles.globeImage}
          />
        </Animated.View>
      </View>
      <Text style={[styles.matchingTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.matchingDetail, { color: theme.secondaryText }]}>{detail}</Text>
      {cancellable ? (
        <Pressable accessibilityLabel="取消匹配" onPress={onCancel} style={styles.cancelMatch}>
          <Text style={[styles.cancelMatchText, { color: theme.accent }]}>取消匹配</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

const styles = StyleSheet.create({
  modalRoot: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.34)",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  card: {
    borderColor: "rgba(255,255,255,0.72)",
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 330,
    paddingHorizontal: 18,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    width: "100%",
  },
  dialogContent: { justifyContent: "center", width: "100%" },
  editorContent: { gap: 16 },
  title: { fontSize: 18, fontWeight: "600" },
  roleFrame: { borderRadius: 12, height: 124, overflow: "hidden" },
  roleInput: {
    fontSize: 15,
    height: 112,
    paddingHorizontal: 13,
    paddingTop: 14,
  },
  matchButton: { borderRadius: 12, height: 46, overflow: "hidden" },
  matchGradient: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
  },
  matchTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  rateRow: { alignItems: "center", flexDirection: "row", gap: 4 },
  rateText: { color: "rgba(255,255,255,0.86)", fontSize: 12, fontWeight: "500" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.86 },
  unavailableContent: { alignItems: "center", gap: 14 },
  unavailableTitle: { fontSize: 17, fontWeight: "600", textAlign: "center" },
  unavailableDetail: { fontSize: 13, textAlign: "center" },
  unavailableActions: { flexDirection: "row", gap: 12, width: "100%" },
  secondaryAction: {
    alignItems: "center",
    borderRadius: 11,
    flex: 1,
    height: 42,
    justifyContent: "center",
  },
  secondaryActionText: { fontSize: 15, fontWeight: "500" },
  primaryAction: { borderRadius: 11, flex: 1, height: 42, overflow: "hidden" },
  actionGradient: { alignItems: "center", flex: 1, justifyContent: "center" },
  primaryActionText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  matchingContent: { alignItems: "center", width: "100%" },
  globeFrame: {
    alignItems: "center",
    height: 252,
    justifyContent: "center",
    width: 252,
  },
  glow: { borderRadius: 134, height: 248, position: "absolute", width: 248 },
  globeImage: {
    borderColor: "rgba(255,255,255,0.42)",
    borderRadius: 124,
    borderWidth: 1,
    height: 206,
    width: 206,
  },
  matchingTitle: { fontSize: 17, fontWeight: "600", marginTop: 4 },
  matchingDetail: { fontSize: 13, marginTop: 2, textAlign: "center" },
  cancelMatch: { paddingHorizontal: 12, paddingTop: 8 },
  cancelMatchText: { fontSize: 14, fontWeight: "500" },
});
