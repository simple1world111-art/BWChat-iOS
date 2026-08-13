import { Redirect, useLocalSearchParams, useNavigation, type Href } from "expo-router";
import { useLayoutEffect } from "react";
import { Image } from "expo-image";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { getCurrentLocation } from "@/services/native/NativeCapabilities";
import { colors, radius, spacing } from "@/theme";

const details: Record<string, { icon: string; description: string; endpoints: string[] }> = {
  moments: {
    icon: "🌤️",
    description: "动态流、图片/视频发布、点赞与评论入口。",
    endpoints: ["/moments", "/moments/following"],
  },
  agents: {
    icon: "🤖",
    description: "智能体目录、安装、创建和会话入口。",
    endpoints: ["/agents/public", "/agents/installed", "/agents/runtime-config"],
  },
  map: {
    icon: "🗺️",
    description: "附近用户和好友位置。",
    endpoints: ["/map/me", "/map/nearby", "/map/friends"],
  },
  games: {
    icon: "🎮",
    description: "游戏目录、回合与奖励入口。",
    endpoints: ["/games", "/game-rounds"],
  },
  scripts: {
    icon: "🎭",
    description: "剧本目录、编辑器和多人房间入口。",
    endpoints: ["/scripts", "/script-rooms"],
  },
  "short-drama": {
    icon: "🎬",
    description: "短剧系列、视频流、评论和创作入口。",
    endpoints: ["/short-dramas", "/short-drama-videos"],
  },
  activity: {
    icon: "🎁",
    description: "签到、饭点奖励、转盘、通讯录匹配与邀请入口。",
    endpoints: [
      "/activity-center",
      "/activity-center/check-in/claim",
      "/activity-center/wheel/spins",
    ],
  },
  wallet: {
    icon: "🪙",
    description: "金币余额、道具包、充值、交易和转账入口。",
    endpoints: ["/wallet/balance", "/me/prop-bag", "/wallet/transactions", "/wallet/transfers"],
  },
};

export default function FeatureScreen() {
  const { slug, title } = useLocalSearchParams<{ slug: string; title?: string }>();
  const navigation = useNavigation();
  const info = details[slug] ?? {
    icon: "🐾",
    description: "该业务模块已进入 Expo 迁移目录。",
    endpoints: [],
  };

  useLayoutEffect(() => navigation.setOptions({ title: title ?? "功能" }), [navigation, title]);

  if (slug === "moments") return <Redirect href="/moments" />;
  if (slug === "wallet") return <Redirect href="/wallet" />;
  if (slug === "games") return <Redirect href={"/game-center" as Href} />;

  const testLocation = async () => {
    try {
      const location = await getCurrentLocation();
      Alert.alert(
        "定位成功",
        `${location.coords.latitude.toFixed(5)}, ${location.coords.longitude.toFixed(5)}`,
      );
    } catch (error) {
      Alert.alert("定位不可用", error instanceof Error ? error.message : "未知错误");
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        {slug === "wallet" ? (
          <Image
            source={require("@/assets/images/bwchat/gold-coin.png")}
            style={styles.asset}
            contentFit="contain"
          />
        ) : (
          <Text style={styles.icon}>{info.icon}</Text>
        )}
        <Text style={styles.title}>{title ?? slug}</Text>
        <Text style={styles.description}>{info.description}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>迁移状态</Text>
        <Text style={styles.status}>React Native 路由与功能开关已就绪</Text>
        <Text style={styles.copy}>
          该页面、样式、文案和后续 TypeScript 业务实现均可通过 EAS Update 发布，不需要重新安装 App。
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>原后端接口族</Text>
        {info.endpoints.map((endpoint) => (
          <Text key={endpoint} style={styles.endpoint}>
            {endpoint}
          </Text>
        ))}
      </View>
      {slug === "map" ? (
        <Pressable style={styles.button} onPress={() => void testLocation()}>
          <Text style={styles.buttonText}>测试定位原生能力</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  hero: {
    alignItems: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    padding: spacing.xxl,
    gap: spacing.md,
  },
  icon: { fontSize: 58 },
  asset: { width: 82, height: 82 },
  title: { color: colors.text, fontSize: 25, fontWeight: "900" },
  description: { color: colors.secondaryText, textAlign: "center", lineHeight: 21 },
  card: {
    borderRadius: radius.md,
    backgroundColor: colors.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { color: colors.text, fontWeight: "800", fontSize: 17 },
  status: { color: colors.success, fontWeight: "700" },
  copy: { color: colors.secondaryText, lineHeight: 21 },
  endpoint: {
    color: colors.accent,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  button: {
    alignItems: "center",
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    padding: spacing.lg,
  },
  buttonText: { color: "white", fontWeight: "800" },
});
