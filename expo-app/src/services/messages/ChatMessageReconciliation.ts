export interface ReconciledMessage {
  id: number;
}

export type ChatMessageReconciliationResult<T extends ReconciledMessage> =
  | { status: "found"; messages: T[] }
  | { status: "cancelled" }
  | { status: "unavailable"; error: unknown };

export const chatMessageReconciliationPolicy = Object.freeze({
  // Conversation summaries and push notifications can briefly lead the
  // history projection. Keep the page interactive while retrying the exact
  // canonical message for about 18 seconds.
  retryDelaysMilliseconds: [0, 300, 700, 1_500, 3_000, 5_000, 8_000] as const,
});

export async function reconcileChatMessageContext<T extends ReconciledMessage>(
  messageId: number,
  fetchContext: () => Promise<T[]>,
  options: {
    isCurrent?: () => boolean;
    retryDelaysMilliseconds?: readonly number[];
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<ChatMessageReconciliationResult<T>> {
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    return {
      status: "unavailable",
      error: new Error("Canonical message ID is invalid"),
    };
  }
  const isCurrent = options.isCurrent ?? (() => true);
  const delays =
    options.retryDelaysMilliseconds ?? chatMessageReconciliationPolicy.retryDelaysMilliseconds;
  const wait = options.wait ?? waitFor;
  let lastError: unknown = new Error(`Message ${messageId} is not available in history yet`);

  for (const rawDelay of delays) {
    if (!isCurrent()) return { status: "cancelled" };
    const delay = Math.max(0, Math.trunc(rawDelay));
    if (delay > 0) await wait(delay);
    if (!isCurrent()) return { status: "cancelled" };
    try {
      const messages = await fetchContext();
      if (!isCurrent()) return { status: "cancelled" };
      if (messages.some((message) => message.id === messageId)) {
        return { status: "found", messages };
      }
      lastError = new Error(`Message ${messageId} is not available in history yet`);
    } catch (error) {
      lastError = error;
    }
  }

  return { status: "unavailable", error: lastError };
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
