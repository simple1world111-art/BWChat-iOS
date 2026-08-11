const fs = require("node:fs");
const path = require("node:path");

const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const TARGET_NAME = "BWChatNotificationService";
const SOURCE_FILE = "NotificationService.swift";

function notificationServiceInfoPlist(apiBaseUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
  <key>CFBundleDisplayName</key><string>BBchat</string>
  <key>CFBundlePackageType</key><string>$(PRODUCT_BUNDLE_TYPE)</string>
  <key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>
  <key>BWChatAPIBaseURL</key><string>${escapeXml(apiBaseUrl)}</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsArbitraryLoads</key><true/></dict>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionAttributes</key>
    <dict>
      <key>IntentsSupported</key>
      <array><string>INSendMessageIntent</string></array>
    </dict>
    <key>NSExtensionPointIdentifier</key><string>com.apple.usernotifications.service</string>
    <key>NSExtensionPrincipalClass</key><string>$(PRODUCT_MODULE_NAME).NotificationService</string>
  </dict>
</dict>
</plist>
`;
}

function notificationServiceEntitlements() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
`;
}

function ensureNotificationServiceTarget(project, options) {
  let target = project.pbxTargetByName(TARGET_NAME) || project.pbxTargetByName(`"${TARGET_NAME}"`);
  if (!target) {
    const added = project.addTarget(
      TARGET_NAME,
      "app_extension",
      TARGET_NAME,
      options.bundleIdentifier,
    );
    target = added.pbxNativeTarget;
    project.addBuildPhase(
      [`${TARGET_NAME}/${SOURCE_FILE}`],
      "PBXSourcesBuildPhase",
      "Sources",
      added.uuid,
    );
    project.addBuildPhase(
      ["ImageIO.framework", "Intents.framework", "UIKit.framework", "UserNotifications.framework"],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      added.uuid,
    );
  }

  const buildSettings = {
    APPLICATION_EXTENSION_API_ONLY: "YES",
    CLANG_ENABLE_MODULES: "YES",
    CODE_SIGN_ENTITLEMENTS: `"${TARGET_NAME}/${TARGET_NAME}.entitlements"`,
    CODE_SIGN_STYLE: "Automatic",
    CURRENT_PROJECT_VERSION: `"${options.buildNumber}"`,
    DEVELOPMENT_TEAM: `"${options.appleTeamId}"`,
    GENERATE_INFOPLIST_FILE: "NO",
    INFOPLIST_FILE: `"${TARGET_NAME}/${TARGET_NAME}-Info.plist"`,
    IPHONEOS_DEPLOYMENT_TARGET: `"${options.deploymentTarget}"`,
    MARKETING_VERSION: `"${options.version}"`,
    PRODUCT_BUNDLE_IDENTIFIER: `"${options.bundleIdentifier}"`,
    PRODUCT_NAME: `"${TARGET_NAME}"`,
    SKIP_INSTALL: "YES",
    SWIFT_VERSION: "5.0",
    TARGETED_DEVICE_FAMILY: `"1"`,
  };
  const configurationList = project.pbxXCConfigurationList()[target.buildConfigurationList];
  if (!configurationList) {
    throw new Error(`Missing build configuration list for ${TARGET_NAME}`);
  }
  const configurations = project.pbxXCBuildConfigurationSection();
  for (const { value: configurationId } of configurationList.buildConfigurations) {
    const configuration = configurations[configurationId];
    if (!configuration) {
      throw new Error(`Missing build configuration ${configurationId} for ${TARGET_NAME}`);
    }
    Object.assign(configuration.buildSettings, buildSettings);
  }
  return project;
}

function withNotificationServiceFiles(config, options) {
  return withDangerousMod(config, [
    "ios",
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const iosRoot = modConfig.modRequest.platformProjectRoot;
      const source = path.join(projectRoot, "plugins", "notification-service", SOURCE_FILE);
      const destination = path.join(iosRoot, TARGET_NAME);
      if (!fs.existsSync(source)) throw new Error(`Missing notification service source: ${source}`);
      fs.mkdirSync(destination, { recursive: true });
      fs.copyFileSync(source, path.join(destination, SOURCE_FILE));
      fs.writeFileSync(
        path.join(destination, `${TARGET_NAME}-Info.plist`),
        notificationServiceInfoPlist(options.apiBaseUrl),
      );
      fs.writeFileSync(
        path.join(destination, `${TARGET_NAME}.entitlements`),
        notificationServiceEntitlements(),
      );
      return modConfig;
    },
  ]);
}

function withNotificationService(config, rawOptions = {}) {
  const options = {
    apiBaseUrl: rawOptions.apiBaseUrl,
    appleTeamId: rawOptions.appleTeamId,
    buildNumber: rawOptions.buildNumber ?? "1",
    bundleIdentifier: rawOptions.bundleIdentifier,
    deploymentTarget: rawOptions.deploymentTarget ?? "16.4",
    version: rawOptions.version ?? "1.0.0",
  };
  for (const key of ["apiBaseUrl", "appleTeamId", "bundleIdentifier"]) {
    if (!options[key]) throw new Error(`with-notification-service requires ${key}`);
  }
  config = withNotificationServiceFiles(config, options);
  return withXcodeProject(config, (mod) => {
    mod.modResults = ensureNotificationServiceTarget(mod.modResults, options);
    return mod;
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

module.exports = withNotificationService;
module.exports.ensureNotificationServiceTarget = ensureNotificationServiceTarget;
module.exports.notificationServiceEntitlements = notificationServiceEntitlements;
module.exports.notificationServiceInfoPlist = notificationServiceInfoPlist;
