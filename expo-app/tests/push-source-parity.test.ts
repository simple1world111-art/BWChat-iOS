import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("push source parity", () => {
  it("boots notifications before login and keeps token registration alive across auth/foreground/token rotation", () => {
    const layout = read("src/app/_layout.tsx");
    const bootstrap = read("src/components/PushNotificationBootstrap.tsx");
    expect(layout).toContain("initializePushNotifications();");
    expect(layout).toContain("<PushNotificationBootstrap />");
    for (const expected of [
      "requestPushPermission()",
      "ensureNativePushTokenUploaded(user.user_id",
      "Notifications.addPushTokenListener",
      'state === "active"',
      "Notifications.addNotificationReceivedListener",
      "Notifications.addNotificationResponseReceivedListener",
      "Notifications.getLastNotificationResponseAsync()",
    ])
      expect(bootstrap).toContain(expected);
  });

  it("passes an already-known APNs token to login/register and preserves the original upload endpoint/retry schedule", () => {
    const api = read("src/api/bwchat.ts");
    const service = read("src/services/push/PushService.ts");
    expect(api.match(/device_token: deviceToken/gu)).toHaveLength(2);
    expect(service).toContain('apiRequest<unknown>("/push/device-token"');
    expect(service).toContain("requiredEnvelope: true");
    expect(service).toContain("beginNativePushUploadSession");
    expect(service).toContain("for (let attempt = 0; attempt <= 3; attempt += 1)");
    expect(service).toContain("2 ** (attempt + 1) * 1_000");
  });

  it("routes direct/group pushes to the exact message and preserves active-chat/badge-only/call suppression", () => {
    const bootstrap = read("src/components/PushNotificationBootstrap.tsx");
    const service = read("src/services/push/PushService.ts");
    expect(bootstrap).toContain('pathname: "/chat/[id]"');
    expect(bootstrap).toContain('pathname: "/group-chat/[id]"');
    expect(bootstrap).toContain("messageId: String(route.messageId)");
    expect(service).toContain('route?.notificationMode === "badge_only"');
    expect(service).toContain("conversationNotificationRouteIdentities(route)");
    expect(service).toContain("hydrateAndCheckConversationNotificationRead");
    expect(service).toContain("callPushTypes.has(type)");
    for (const file of ["src/app/chat/[id].tsx", "src/app/group-chat/[id].tsx"]) {
      const screen = read(file);
      expect(screen).toContain("initialPushMessageHandledRef");
      expect(screen).toContain("void scrollToMessage(target)");
    }
  });

  it("keeps the application icon badge aligned with the original combined unread total", () => {
    const bootstrap = read("src/components/PushNotificationBootstrap.tsx");
    const native = read("../BWChat/Services/PushService.swift");
    expect(bootstrap).toContain("useConversationUnread(ownerId)");
    expect(bootstrap).toContain("useMomentsUnread(ownerId)");
    expect(bootstrap).toContain("conversationUnread + momentsUnread");
    expect(bootstrap).toContain("Notifications.setBadgeCountAsync");
    expect(native).toContain("chatUnreadCount + momentsUnreadCount");
    expect(native).toContain("UIApplication.shared.applicationIconBadgeNumber = totalUnreadCount");
  });

  it("declares APNs and communication entitlements while leaving the rich NSE gap explicit", () => {
    const config = read("app.config.ts");
    const eas = read("eas.json");
    const status = read("docs/migration-status.md");
    expect(config).toContain('appleTeamId: "A5U93R249R"');
    expect(config).toContain(
      '"aps-environment": environment === "production" ? "production" : "development"',
    );
    expect(config).toContain('"com.apple.developer.usernotifications.communication": true');
    expect(eas).toContain('"APP_ENV": "production"');
    expect(status).toContain("富媒体 NSE");
  });
});

function read(file: string): string {
  return fs.readFileSync(path.join(root, file), "utf8");
}
