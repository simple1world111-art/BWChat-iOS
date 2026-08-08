export interface CallSettlementRefreshEvent {
  ownerId: string;
  sessionId: string;
  sequence: number;
}

type Listener = (event: CallSettlementRefreshEvent) => void;

const listeners = new Set<Listener>();
let sequence = 0;

export function publishCallSettlementRefresh(
  ownerId: string,
  sessionId: string,
): CallSettlementRefreshEvent | undefined {
  const normalizedOwnerId = ownerId.trim();
  const normalizedSessionId = sessionId.trim();
  if (!normalizedOwnerId || !normalizedSessionId) return undefined;
  const event = {
    ownerId: normalizedOwnerId,
    sessionId: normalizedSessionId,
    sequence: ++sequence,
  };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A failed cache consumer must not prevent the other settlement refreshes.
    }
  }
  return event;
}

export function subscribeCallSettlementRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
