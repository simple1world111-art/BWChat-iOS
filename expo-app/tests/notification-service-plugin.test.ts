import { readFileSync } from "node:fs";
import path from "node:path";

/* eslint-disable @typescript-eslint/no-require-imports */
// The plugin is CommonJS because Expo loads local config plugins through require().
const {
  ensureNotificationServiceTarget,
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
    expect(notificationServiceInfoPlist(options.apiBaseUrl)).toContain(
      "https://api.example.com/v1?one=1&amp;two=2",
    );
    expect(notificationServiceInfoPlist(options.apiBaseUrl)).toContain(
      "<key>CFBundleDisplayName</key><string>BBchat</string>",
    );
    expect(notificationServiceInfoPlist(options.apiBaseUrl)).not.toContain(
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
