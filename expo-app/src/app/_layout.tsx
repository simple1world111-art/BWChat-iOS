import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { registerGlobals } from "@livekit/react-native";
import { StatusBar } from "expo-status-bar";
import * as Sentry from "@sentry/react-native";
import { useEffect, useState } from "react";
import { LogBox, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "react-native-reanimated";

import { AppGate } from "@/components/AppGate";
import { ActivityInviteLinkHandler } from "@/components/ActivityInviteLinkHandler";
import { GroupInviteLinkHandler } from "@/components/GroupInviteLinkHandler";
import { MomentUploadBootstrap } from "@/components/MomentUploadBootstrap";
import { PushBackgroundTaskBootstrap } from "@/components/PushBackgroundTaskBootstrap";
import { PushNotificationBootstrap } from "@/components/PushNotificationBootstrap";
import { SessionNavigationGuard } from "@/components/SessionNavigationGuard";
import { ShortDramaUploadBootstrap } from "@/components/ShortDramaUploadBootstrap";
import { SplashView } from "@/components/auth/SplashView";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { ChatAppearanceProvider } from "@/providers/ChatAppearanceProvider";
import { CallProvider } from "@/providers/CallProvider";
import { LocalizationProvider } from "@/providers/LocalizationProvider";
import { LiveCallProvider } from "@/providers/LiveCallProvider";
import { PropInventoryProvider } from "@/providers/PropInventoryProvider";
import { RemoteConfigProvider } from "@/providers/RemoteConfigProvider";
import { RealtimeProvider } from "@/providers/RealtimeProvider";
import { UpdateProvider } from "@/providers/UpdateProvider";
import { WalletProvider } from "@/providers/WalletProvider";
import { initializeMonitoring } from "@/services/monitoring/MonitoringService";
import { hydrateNavigationSnapshots } from "@/services/navigation/NavigationSnapshotCache";
import { initializePushNotifications } from "@/services/push/PushService";
import { visualAcceptanceEnabled } from "@/services/visualAcceptance";

registerGlobals();
LogBox.ignoreLogs(["[expo-notifications] Error reading persisted server registration info"]);
initializeMonitoring();
if (!visualAcceptanceEnabled) initializePushNotifications();
if (visualAcceptanceEnabled) LogBox.ignoreAllLogs();

function BootstrapGate({ children }: { children: React.ReactNode }) {
  const { isBootstrapping } = useAuth();
  const [isCacheBootstrapping, setCacheBootstrapping] = useState(true);

  useEffect(() => {
    let active = true;
    void hydrateNavigationSnapshots().finally(() => {
      if (active) setCacheBootstrapping(false);
    });
    return () => {
      active = false;
    };
  }, []);

  if (isCacheBootstrapping) return <SplashView />;
  return isBootstrapping ? <SplashView /> : children;
}

function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          <LocalizationProvider>
            <AuthProvider>
              <BootstrapGate>
                <SessionNavigationGuard />
                {!visualAcceptanceEnabled ? <PushNotificationBootstrap /> : null}
                {!visualAcceptanceEnabled ? <PushBackgroundTaskBootstrap /> : null}
                <ActivityInviteLinkHandler />
                <MomentUploadBootstrap />
                <ShortDramaUploadBootstrap />
                <RealtimeProvider>
                  <CallProvider>
                    <PropInventoryProvider>
                      <LiveCallProvider>
                        <ChatAppearanceProvider>
                          <RemoteConfigProvider>
                            <GroupInviteLinkHandler />
                            <WalletProvider>
                              <UpdateProvider>
                                <AppGate>
                                  <Stack screenOptions={{ headerBackTitle: "返回" }}>
                                    <Stack.Screen
                                      name="index"
                                      options={{ animation: "none", headerShown: false }}
                                    />
                                    <Stack.Screen
                                      name="(auth)"
                                      options={{ animation: "none", headerShown: false }}
                                    />
                                    <Stack.Screen
                                      name="(tabs)"
                                      options={{ animation: "none", headerShown: false }}
                                    />
                                    <Stack.Screen name="chat/[id]" options={{ title: "聊天" }} />
                                    <Stack.Screen
                                      name="direct-chat-settings"
                                      options={{ title: "聊天信息" }}
                                    />
                                    <Stack.Screen
                                      name="add-friend"
                                      options={{ presentation: "modal", title: "添加好友" }}
                                    />
                                    <Stack.Screen
                                      name="friend-requests"
                                      options={{ title: "好友请求" }}
                                    />
                                    <Stack.Screen name="contacts" options={{ title: "" }} />
                                    <Stack.Screen name="nearby" options={{ title: "" }} />
                                    <Stack.Screen name="follow-list" options={{ title: "关注" }} />
                                    <Stack.Screen name="user-profile" options={{ title: "" }} />
                                    <Stack.Screen
                                      name="edit-profile"
                                      options={{ title: "编辑资料" }}
                                    />
                                    <Stack.Screen name="moments" options={{ title: "朋友圈" }} />
                                    <Stack.Screen
                                      name="create-moment"
                                      options={{ presentation: "modal", title: "发布动态" }}
                                    />
                                    <Stack.Screen
                                      name="moments-notifications"
                                      options={{ title: "消息" }}
                                    />
                                    <Stack.Screen
                                      name="moment-detail"
                                      options={{ title: "动态详情" }}
                                    />
                                    <Stack.Screen name="agent-chat" options={{ title: "智能体" }} />
                                    <Stack.Screen name="agent-hub" options={{ title: "智能体" }} />
                                    <Stack.Screen
                                      name="agent-creator"
                                      options={{ title: "创建智能体" }}
                                    />
                                    <Stack.Screen
                                      name="script-room-chat"
                                      options={{ title: "剧本房间" }}
                                    />
                                    <Stack.Screen name="script-center" options={{ title: "" }} />
                                    <Stack.Screen
                                      name="script-detail"
                                      options={{ title: "剧本详情" }}
                                    />
                                    <Stack.Screen
                                      name="script-editor"
                                      options={{ title: "创建剧本" }}
                                    />
                                    <Stack.Screen
                                      name="short-drama-player"
                                      options={{ title: "短剧" }}
                                    />
                                    <Stack.Screen
                                      name="short-drama-series"
                                      options={{ title: "" }}
                                    />
                                    <Stack.Screen
                                      name="short-drama-studio"
                                      options={{ title: "" }}
                                    />
                                    <Stack.Screen
                                      name="short-drama-editor"
                                      options={{ title: "创建剧集" }}
                                    />
                                    <Stack.Screen name="group-list" options={{ title: "" }} />
                                    <Stack.Screen
                                      name="create-group"
                                      options={{ presentation: "modal", title: "创建群聊" }}
                                    />
                                    <Stack.Screen name="group-chat/[id]" options={{ title: "" }} />
                                    <Stack.Screen name="group-detail" options={{ title: "" }} />
                                    <Stack.Screen
                                      name="group-message-search"
                                      options={{ title: "" }}
                                    />
                                    <Stack.Screen name="group-members" options={{ title: "" }} />
                                    <Stack.Screen
                                      name="group-announcement"
                                      options={{ title: "" }}
                                    />
                                    <Stack.Screen name="group-invite" options={{ title: "" }} />
                                    <Stack.Screen
                                      name="group-invite-preview"
                                      options={{ title: "" }}
                                    />
                                    <Stack.Screen name="group-report" options={{ title: "" }} />
                                    <Stack.Screen
                                      name="group-notification-settings"
                                      options={{ title: "" }}
                                    />
                                    <Stack.Screen
                                      name="group-important-members"
                                      options={{ title: "" }}
                                    />
                                    <Stack.Screen
                                      name="add-group-members"
                                      options={{ presentation: "modal", title: "" }}
                                    />
                                    <Stack.Screen
                                      name="group-text-setting"
                                      options={{ title: "" }}
                                    />
                                    <Stack.Screen
                                      name="forward-bundle/[id]"
                                      options={{ title: "聊天记录" }}
                                    />
                                    <Stack.Screen
                                      name="feature/[slug]"
                                      options={{ title: "功能" }}
                                    />
                                    <Stack.Screen
                                      name="dynamic-screen/[id]"
                                      options={{ title: "" }}
                                    />
                                    <Stack.Screen name="game-center" options={{ title: "" }} />
                                    <Stack.Screen name="activity-center" options={{ title: "" }} />
                                    <Stack.Screen name="live-lobby" options={{ title: "" }} />
                                    <Stack.Screen name="prop-bag" options={{ title: "" }} />
                                    <Stack.Screen
                                      name="activity-cat-food"
                                      options={{ title: "" }}
                                    />
                                    <Stack.Screen
                                      name="in-app-web"
                                      options={{ headerShown: false, gestureEnabled: false }}
                                    />
                                    <Stack.Screen name="wallet" options={{ headerShown: false }} />
                                    <Stack.Screen
                                      name="wallet-transactions"
                                      options={{ headerShown: false }}
                                    />
                                    <Stack.Screen
                                      name="wallet-withdrawals"
                                      options={{ headerShown: false }}
                                    />
                                    <Stack.Screen name="settings" options={{ title: "设置" }} />
                                    <Stack.Screen
                                      name="language-settings"
                                      options={{ title: "语言" }}
                                    />
                                    <Stack.Screen
                                      name="username-reset"
                                      options={{ title: "用户名重置" }}
                                    />
                                    <Stack.Screen
                                      name="change-password"
                                      options={{ title: "修改密码" }}
                                    />
                                    <Stack.Screen
                                      name="chat-background-settings"
                                      options={{ title: "聊天背景" }}
                                    />
                                    <Stack.Screen
                                      name="update-settings"
                                      options={{ title: "更新诊断" }}
                                    />
                                  </Stack>
                                </AppGate>
                              </UpdateProvider>
                            </WalletProvider>
                          </RemoteConfigProvider>
                        </ChatAppearanceProvider>
                      </LiveCallProvider>
                    </PropInventoryProvider>
                  </CallProvider>
                </RealtimeProvider>
              </BootstrapGate>
            </AuthProvider>
          </LocalizationProvider>
          <StatusBar style="auto" />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
