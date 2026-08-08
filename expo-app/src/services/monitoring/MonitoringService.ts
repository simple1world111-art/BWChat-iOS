import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Updates from "expo-updates";
import * as Sentry from "@sentry/react-native";
import { Platform } from "react-native";

import { env } from "@/config/env";

let initialized = false;

export function initializeMonitoring(): void {
  if (initialized) return;
  initialized = true;
  Sentry.init({
    dsn: env.sentryDsn,
    enabled: Boolean(env.sentryDsn),
    sendDefaultPii: false,
    enableNative: true,
    tracesSampleRate: env.environment === "production" ? 0.1 : 0,
  });
  Sentry.setTags({
    environment: env.environment,
    app_version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "unknown",
    build_number: Application.nativeBuildVersion ?? "unknown",
    runtime_version: Updates.runtimeVersion ?? "embedded",
    update_id: Updates.updateId ?? "embedded",
    channel: Updates.channel ?? "unknown",
    platform: Platform.OS,
    device_os: Device.osVersion ?? String(Platform.Version),
    device: Device.modelName ?? "unknown",
    embedded_update: String(Updates.isEmbeddedLaunch),
  });
}

export function recordUpdateCheckState(result: string, checkedAt: number): void {
  Sentry.setTags({
    last_update_check_at: new Date(checkedAt).toISOString(),
    last_update_check_result: result,
  });
}

export function captureException(error: unknown, context: Record<string, string> = {}): void {
  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => scope.setTag(key, value));
    Sentry.captureException(error);
  });
}

export function captureMessage(message: string, context: Record<string, string> = {}): void {
  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => scope.setTag(key, value));
    Sentry.captureMessage(message);
  });
}
