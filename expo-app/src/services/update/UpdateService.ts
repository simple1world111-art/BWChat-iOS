import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";

import { env } from "@/config/env";
import {
  captureException,
  captureMessage,
  recordUpdateCheckState,
} from "@/services/monitoring/MonitoringService";

const stateKey = "bwchat.update-state.v1";
const minimumCheckIntervalMs = 15 * 60 * 1_000;

export type UpdateCheckResult =
  | { status: "disabled" }
  | { status: "throttled"; checkedAt: number }
  | { status: "no-update"; checkedAt: number }
  | { status: "downloaded"; checkedAt: number }
  | { status: "error"; checkedAt: number; message: string };

type PersistedUpdateResult = "no-update" | "downloaded" | "error";

export interface PersistedUpdateState {
  checkedAt: number;
  result: PersistedUpdateResult;
}

async function readState(): Promise<PersistedUpdateState | null> {
  try {
    const raw = await AsyncStorage.getItem(stateKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedUpdateState>;
    return typeof value.checkedAt === "number" && isPersistedResult(value.result)
      ? { checkedAt: value.checkedAt, result: value.result }
      : null;
  } catch (error) {
    captureException(error, { operation: "ota_state_read" });
    return null;
  }
}

function isPersistedResult(value: unknown): value is PersistedUpdateResult {
  return value === "no-update" || value === "downloaded" || value === "error";
}

async function persist(status: PersistedUpdateResult, checkedAt: number): Promise<void> {
  recordUpdateCheckState(status, checkedAt);
  try {
    await AsyncStorage.setItem(stateKey, JSON.stringify({ result: status, checkedAt }));
  } catch (error) {
    captureException(error, { operation: "ota_state_write" });
  }
}

let inFlightCheck: Promise<UpdateCheckResult> | null = null;

export function checkAndDownloadUpdate(force = false): Promise<UpdateCheckResult> {
  if (__DEV__ || env.environment === "development" || !Updates.isEnabled) {
    return Promise.resolve({ status: "disabled" });
  }
  if (inFlightCheck) return inFlightCheck;

  const pending = performUpdateCheck(force);
  inFlightCheck = pending;
  void pending.finally(() => {
    if (inFlightCheck === pending) inFlightCheck = null;
  });
  return pending;
}

async function performUpdateCheck(force: boolean): Promise<UpdateCheckResult> {
  const now = Date.now();
  if (!force) {
    const previous = await readState();
    if (previous && now - previous.checkedAt < minimumCheckIntervalMs) {
      recordUpdateCheckState(previous.result, previous.checkedAt);
      return { status: "throttled", checkedAt: previous.checkedAt };
    }
  }

  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) {
      await persist("no-update", now);
      return { status: "no-update", checkedAt: now };
    }
    await Updates.fetchUpdateAsync();
    await persist("downloaded", now);
    captureMessage("OTA update downloaded", { channel: Updates.channel ?? "unknown" });
    return { status: "downloaded", checkedAt: now };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown update error";
    await persist("error", now);
    captureException(error, { operation: "ota_check_download" });
    return { status: "error", checkedAt: now, message };
  }
}

export async function getLastUpdateCheck(): Promise<PersistedUpdateState | null> {
  return readState();
}

export async function reloadToApplyUpdate(): Promise<void> {
  if (__DEV__ || env.environment === "development" || !Updates.isEnabled) return;
  try {
    await Updates.reloadAsync();
  } catch (error) {
    captureException(error, { operation: "ota_reload" });
    throw error;
  }
}

export function getUpdateMetadata() {
  return {
    channel: Updates.channel ?? "embedded",
    runtimeVersion: Updates.runtimeVersion ?? "embedded",
    updateId: Updates.updateId ?? "embedded",
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
  } as const;
}
