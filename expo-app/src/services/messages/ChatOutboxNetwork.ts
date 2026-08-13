import { getNetworkStateAsync } from "expo-network";

export type ChatOutboxRetryReason = "network_offline" | "transient_error";

export const chatOutboxNetworkRetryDelayMilliseconds = 5_000;

let networkStateRequest: Promise<boolean> | null = null;
const deferredJobs = new Map<string, () => void>();
let deferredRetryTimer: ReturnType<typeof setTimeout> | null = null;
let deferredRetryAt = Number.POSITIVE_INFINITY;

export async function isChatOutboxDefinitelyOffline(): Promise<boolean> {
  if (networkStateRequest) return networkStateRequest;
  const request = getNetworkStateAsync()
    .then((state) => state.isConnected === false || state.isInternetReachable === false)
    .catch(() => {
      // An unavailable/unknown reachability signal must not block a valid upload.
      return false;
    });
  networkStateRequest = request;
  void request.finally(() => {
    if (networkStateRequest === request) networkStateRequest = null;
  });
  return request;
}

/**
 * Coalesces every offline outbox job behind one bounded local reachability
 * probe. This intentionally does not add another expo-network listener beside
 * RealtimeProvider; an active process resumes within five seconds, while a
 * restarted process resumes when its durable outbox is loaded again.
 */
export function scheduleChatOutboxNetworkRetry(
  key: string,
  resume: () => void,
  notBefore?: string | undefined,
): void {
  const normalizedKey = key.trim();
  if (!normalizedKey) return;
  deferredJobs.set(normalizedKey, resume);
  const now = Date.now();
  const parsed = notBefore ? Date.parse(notBefore) : Number.NaN;
  const requestedAt = Number.isFinite(parsed) ? parsed : now;
  const retryAt = Math.min(
    Math.max(requestedAt, now),
    now + chatOutboxNetworkRetryDelayMilliseconds,
  );
  if (deferredRetryTimer && retryAt >= deferredRetryAt) return;
  if (deferredRetryTimer) clearTimeout(deferredRetryTimer);
  deferredRetryAt = retryAt;
  deferredRetryTimer = setTimeout(runDeferredNetworkProbe, Math.max(0, retryAt - now));
}

export function cancelChatOutboxNetworkRetry(key: string): void {
  deferredJobs.delete(key.trim());
  if (deferredJobs.size > 0 || !deferredRetryTimer) return;
  clearTimeout(deferredRetryTimer);
  deferredRetryTimer = null;
  deferredRetryAt = Number.POSITIVE_INFINITY;
}

function runDeferredNetworkProbe(): void {
  deferredRetryTimer = null;
  deferredRetryAt = Number.POSITIVE_INFINITY;
  void isChatOutboxDefinitelyOffline().then((offline) => {
    if (deferredJobs.size === 0) return;
    if (offline) {
      scheduleDeferredNetworkProbe(Date.now() + chatOutboxNetworkRetryDelayMilliseconds);
      return;
    }
    if (deferredRetryTimer) clearTimeout(deferredRetryTimer);
    deferredRetryTimer = null;
    deferredRetryAt = Number.POSITIVE_INFINITY;
    const resumptions = [...deferredJobs.values()];
    deferredJobs.clear();
    for (const resume of resumptions) {
      try {
        resume();
      } catch {
        // Each durable job remains available to the next screen-level resume.
      }
    }
  });
}

function scheduleDeferredNetworkProbe(retryAt: number): void {
  if (deferredRetryTimer || deferredJobs.size === 0) return;
  deferredRetryAt = retryAt;
  deferredRetryTimer = setTimeout(runDeferredNetworkProbe, Math.max(0, retryAt - Date.now()));
}
