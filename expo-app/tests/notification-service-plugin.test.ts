import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/* eslint-disable @typescript-eslint/no-require-imports */
// The plugin is CommonJS because Expo loads local config plugins through require().
const {
  ensureNotificationServiceTarget,
  notificationAssetHosts,
  notificationServiceEntitlements,
  notificationServiceInfoPlist,
} = require("../plugins/with-notification-service");

const options = {
  apiBaseUrl: "https://api.example.com/v1?one=1&two=2",
  appleTeamId: "TEAM123",
  buildNumber: "8",
  bundleIdentifier: "com.example.app.notificationservice",
  deploymentTarget: "16.4",
  version: "1.0.0",
};

describe("notification service config plugin", () => {
  it("creates one extension target with source and system-framework phases", () => {
    const project = fakeProject(null);
    ensureNotificationServiceTarget(project, options);

    expect(project.addTarget).toHaveBeenCalledWith(
      "BWChatNotificationService",
      "app_extension",
      "BWChatNotificationService",
      options.bundleIdentifier,
    );
    expect(project.addBuildPhase).toHaveBeenCalledTimes(2);
    expect(project.addBuildPhase).toHaveBeenCalledWith(
      ["BWChatNotificationService/NotificationService.swift"],
      "PBXSourcesBuildPhase",
      "Sources",
      "extension-target-id",
    );
    for (const configuration of Object.values(project.buildConfigurations)) {
      expect(configuration.buildSettings).toMatchObject({
        CODE_SIGN_ENTITLEMENTS:
          '"BWChatNotificationService/BWChatNotificationService.entitlements"',
        CURRENT_PROJECT_VERSION: '"8"',
        INFOPLIST_FILE: '"BWChatNotificationService/BWChatNotificationService-Info.plist"',
        SWIFT_VERSION: "5.0",
      });
    }
  });

  it("is idempotent when the target already exists", () => {
    const project = fakeProject({
      name: '"BWChatNotificationService"',
      buildConfigurationList: "extension-config-list",
    });
    ensureNotificationServiceTarget(project, options);
    expect(project.addTarget).not.toHaveBeenCalled();
    expect(project.addBuildPhase).not.toHaveBeenCalled();
    expect(project.buildConfigurations["extension-release"].buildSettings.SWIFT_VERSION).toBe(
      "5.0",
    );
  });

  it("keeps extension entitlements empty, escapes API config and includes the complete service", () => {
    expect(notificationServiceEntitlements()).toContain("<dict/>");
    expect(notificationServiceEntitlements()).not.toContain("aps-environment");
    const infoPlist = notificationServiceInfoPlist(options.apiBaseUrl, [
      "https://cdn.example.com/avatars",
      "https://api.example.com/media",
    ]);
    expect(infoPlist).toContain("https://api.example.com/v1?one=1&amp;two=2");
    expect(infoPlist).toContain("<string>api.example.com</string>");
    expect(infoPlist).toContain("<string>cdn.example.com</string>");
    expect(infoPlist).not.toContain("NSAllowsArbitraryLoads");
    expect(infoPlist).toContain("<key>CFBundleDisplayName</key><string>BBchat</string>");
    expect(infoPlist).not.toContain(
      "<key>CFBundleDisplayName</key><string>BWChatNotificationService</string>",
    );
    const source = readFileSync(
      path.resolve(__dirname, "../plugins/notification-service/NotificationService.swift"),
      "utf8",
    );
    expect(source).toContain("UNNotificationServiceExtension");
    expect(source).toContain("INSendMessageIntent");
    expect(source).toContain("serviceExtensionTimeWillExpire");
    expect(source).toContain("notificationDisplayTextWithoutPreviewSuffix");
    expect(source).toContain("enum NotificationSurface");
    expect(source).toContain("maximumAssetBytes = 1_024 * 1_024");
    expect(source).toContain('hasPrefix("image/")');
    expect(source).toContain("willPerformHTTPRedirection");
    expect(source).toContain("URLSessionDataDelegate");
    expect(source).toContain("dataTask.cancel()");
    expect(source).not.toContain("assetSession.dataTask(with: request) {");
    expect(source).toContain("speakableGroupName: speakableGroupName");
    expect(source).toContain("forParameterNamed: \\.speakableGroupName");
    expect(source).toContain("senderIdentityName = communication.senderName");
    expect(source).toContain("guard communication.surface.supportsCommunicationIntent else");
    expect(source).toContain("self == .dm || self == .group");
    expect(source).toContain("never donate an INPerson/INSendMessageIntent identity");
  });

  it("downgrades malformed ordinary messages before identity parsing and exempts only calls/security", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../plugins/notification-service/NotificationService.swift"),
      "utf8",
    );
    const policyCall = source.indexOf(
      "let handlesAsOrdinaryMessage = shouldNormalizeMessageInterruption(userInfo)",
    );
    const identityParse = source.indexOf("? CommunicationInfo(");

    expect(policyCall).toBeGreaterThan(0);
    expect(policyCall).toBeLessThan(identityParse);
    expect(source).toContain("guard let explicitType else");
    expect(source).toContain("return true");
    expect(source).toContain('"call", "call_invite", "group_call", "group_call_invite"');
    expect(source).toContain('"account_security", "safety_alert", "security", "security_alert"');
    expect(source).toContain("return !elevatedTypes.contains(explicitType)");
    expect(source).toContain("let communication = handlesAsOrdinaryMessage");
    expect(source).toContain(": nil");
  });

  it("keeps a locally generated native tree aligned with the CNG source when present", () => {
    const nativeServicePath = path.resolve(
      __dirname,
      "../ios/BWChatNotificationService/NotificationService.swift",
    );
    if (!existsSync(nativeServicePath)) return;

    const source = readFileSync(
      path.resolve(__dirname, "../plugins/notification-service/NotificationService.swift"),
      "utf8",
    );
    expect(readFileSync(nativeServicePath, "utf8")).toBe(source);

    const nativeExtensionPlist = readFileSync(
      path.resolve(
        __dirname,
        "../ios/BWChatNotificationService/BWChatNotificationService-Info.plist",
      ),
      "utf8",
    );
    expect(nativeExtensionPlist).toContain("<string>id7.com</string>");
    expect(nativeExtensionPlist).toContain("<string>d3rijhu8azna1i.cloudfront.net</string>");
    expect(nativeExtensionPlist).not.toContain("NSAllowsArbitraryLoads");

    const debugInfo = readFileSync(path.resolve(__dirname, "../ios/BBchat/Info.plist"), "utf8");
    const releaseInfo = readFileSync(
      path.resolve(__dirname, "../ios/BBchat/Info-Release.plist"),
      "utf8",
    );
    const project = readFileSync(
      path.resolve(__dirname, "../ios/BBchat.xcodeproj/project.pbxproj"),
      "utf8",
    );
    const entitlements = readFileSync(
      path.resolve(__dirname, "../ios/BBchat/BBchat.entitlements"),
      "utf8",
    );

    expect(debugInfo).toContain("<key>NSAllowsArbitraryLoads</key>\n\t\t<false/>");
    expect(debugInfo).toContain("<key>NSAllowsLocalNetworking</key>\n\t\t<true/>");
    expect(releaseInfo).toContain("<key>NSAllowsArbitraryLoads</key>\n\t\t<false/>");
    expect(releaseInfo).toContain("<string>INSendMessageIntent</string>");
    expect(project).toContain('INFOPLIST_FILE = "BBchat/Info-Release.plist";');
    expect(entitlements).toContain("<string>applinks:id7.com</string>");
  });

  it("derives a deduplicated exact-host allowlist and rejects unsafe base values", () => {
    expect(
      notificationAssetHosts("https://API.example.com/v1", [
        "https://cdn.example.com/a",
        "https://api.example.com/b",
      ]),
    ).toEqual(["api.example.com", "cdn.example.com"]);
    expect(() => notificationAssetHosts("file:///tmp/avatar", [])).toThrow(/HTTP\(S\)/);
    expect(() => notificationAssetHosts("https://user:secret@example.com", [])).toThrow(
      /credentials/,
    );
  });
});

function fakeProject(existingTarget: object | null) {
  const buildConfigurations = {
    "extension-debug": { name: "Debug", buildSettings: {} as Record<string, string> },
    "extension-release": { name: "Release", buildSettings: {} as Record<string, string> },
  };
  return {
    buildConfigurations,
    pbxTargetByName: jest.fn((name: string) =>
      name === '"BWChatNotificationService"' ? existingTarget : null,
    ),
    addTarget: jest.fn(() => ({
      uuid: "extension-target-id",
      pbxNativeTarget: {
        name: '"BWChatNotificationService"',
        buildConfigurationList: "extension-config-list",
      },
    })),
    addBuildPhase: jest.fn(),
    pbxXCConfigurationList: jest.fn(() => ({
      "extension-config-list": {
        buildConfigurations: [
          { value: "extension-debug", comment: "Debug" },
          { value: "extension-release", comment: "Release" },
        ],
      },
    })),
    pbxXCBuildConfigurationSection: jest.fn(() => buildConfigurations),
  };
}
