import * as Linking from "expo-linking";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { requiresStoreUpdate } from "@/services/remote-config/RemoteConfigService";
import { colors, radius, spacing } from "@/theme";

export function AppGate({ children }: { children: React.ReactNode }) {
  const { config, isRefreshing, refresh } = useRemoteConfig();
  if (config.killSwitch?.enabled || config.features.maintenanceMode) {
    const killSwitchMessage =
      typeof config.killSwitch?.message === "string"
        ? config.killSwitch.message
        : (config.killSwitch?.message?.["zh-Hans"] ?? config.killSwitch?.message?.zh);
    return (
      <View style={styles.gate}>
        <Text style={styles.emoji}>🛠️</Text>
        <Text style={styles.title}>正在维护</Text>
        <Text style={styles.message}>
          {killSwitchMessage ?? "朋友们稍等一下，服务恢复后点击重试即可。"}
        </Text>
        <Pressable style={styles.button} onPress={() => void refresh()} disabled={isRefreshing}>
          <Text style={styles.buttonText}>重新检查</Text>
        </Pressable>
      </View>
    );
  }
  if (requiresStoreUpdate(config) && config.update?.storeUrl) {
    return (
      <View style={styles.gate}>
        <Text style={styles.emoji}>✨</Text>
        <Text style={styles.title}>需要安装新版本</Text>
        <Text style={styles.message}>{config.update.message ?? "这个更新包含新的原生能力。"}</Text>
        <Pressable
          style={styles.button}
          onPress={() => void Linking.openURL(config.update?.storeUrl ?? "")}
        >
          <Text style={styles.buttonText}>前往更新</Text>
        </Pressable>
      </View>
    );
  }
  return children;
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  emoji: { fontSize: 56 },
  title: { color: colors.text, fontSize: 24, fontWeight: "800" },
  message: { color: colors.secondaryText, lineHeight: 22, textAlign: "center" },
  button: {
    minWidth: 160,
    alignItems: "center",
    borderRadius: radius.round,
    backgroundColor: colors.accent,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  buttonText: { color: "white", fontWeight: "800" },
});
