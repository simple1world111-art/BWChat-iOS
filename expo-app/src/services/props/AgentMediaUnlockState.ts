import type { AgentMediaUnlock, AgentMessage, WalletBalanceSnapshot } from "@/models";
import { normalizePropConsumption, type MediaUnlockKind, type PropConsumption } from "@/services/props/PropInventoryModels";

export interface AgentMediaUnlockSettlement {
  balance?: WalletBalanceSnapshot | undefined;
  consumption?: PropConsumption | undefined;
  refreshBalance: boolean;
  refreshInventory: boolean;
}

export function settleAgentMediaUnlock(
  result: AgentMediaUnlock,
): AgentMediaUnlockSettlement {
  const consumption = normalizePropConsumption(result.consumed_prop);
  const changed = !result.already_unlocked;
  return {
    ...(result.charge ? { balance: result.charge.wallet_balance } : {}),
    ...(consumption ? { consumption } : {}),
    refreshBalance: changed && !result.charge,
    refreshInventory: changed && !consumption,
  };
}

export function applyAgentMediaUnlockToMessages(
  messages: readonly AgentMessage[],
  mediaId: string,
  result: AgentMediaUnlock,
): AgentMessage[] {
  if (!result.already_unlocked && !result.content_url && !result.download_url) {
    return [...messages];
  }
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.reference_id !== mediaId) return part;
      return {
        ...part,
        metadata: {
          ...part.metadata,
          access: "unlocked",
          ...(result.content_url ? { content_url: result.content_url } : {}),
          ...(result.download_url ? { download_url: result.download_url } : {}),
        },
      };
    }),
  }));
}

export function isAgentMediaUnlocked(
  messages: readonly AgentMessage[],
  mediaId: string,
): boolean {
  return messages.some((message) => message.parts.some(
    (part) => part.type === "paid_media"
      && part.reference_id === mediaId
      && part.metadata.access === "unlocked"
      && Boolean(part.metadata.content_url || part.metadata.download_url),
  ));
}

export function agentPaidMediaDisplayStatus(
  generationStatus: string | undefined,
  access: string | undefined,
): string {
  const status = generationStatus?.trim().toLowerCase();
  switch (status) {
    case undefined:
    case "":
    case "queued":
    case "pending":
      return "queued";
    case "processing":
    case "generating":
      return "generating";
    case "ready":
    case "completed":
      return access === "locked" || access === "unlocked" ? "ready_locked" : "generating";
    default:
      return status;
  }
}

export function agentMediaUnlockDefinition(mediaType: MediaUnlockKind): string {
  return `media_unlock_card_${mediaType}`;
}
