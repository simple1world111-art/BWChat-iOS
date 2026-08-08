import type { AgentMessage, AgentMessagePart, AgentPartMetadata } from "@/models";
import { agentPaidMediaDisplayStatus } from "@/services/props/AgentMediaUnlockState";

export type AgentPaidMediaKind = "image" | "video";

/**
 * Swift's AgentChatView owns the vertical rhythm with `LazyVStack(spacing: 10)`
 * and AgentMessageView owns part rhythm with `VStack(spacing: 7)`. Keep these
 * as explicit cell metrics rather than depending on virtual-list child
 * margins or React Native gap support, both of which drifted in the inverted
 * history list.
 */
export const agentMessageLayout = {
  timelineItemSpacing: 10,
  partSpacing: 7,
} as const;

export interface AgentMediaCardSize {
  width: number;
  height: number;
}

export interface AgentPaidMediaPresentation {
  kind: AgentPaidMediaKind;
  status: string;
  isUnlocked: boolean;
  contentPath?: string | undefined;
  previewPath?: string | undefined;
  savePath?: string | undefined;
  size: AgentMediaCardSize;
}

export function orderedAgentMessageParts(message: AgentMessage): AgentMessagePart[] {
  return message.parts
    .map((part, index) => ({ part, index }))
    .sort((left, right) => left.part.ordinal - right.part.ordinal || left.index - right.index)
    .map(({ part }) => part);
}

export function agentImageThumbnailSize(width?: number, height?: number): AgentMediaCardSize {
  if (!width || !height || width <= 0 || height <= 0) return { width: 160, height: 110 };
  const ratio = width / height;
  if (ratio < 0.85) return { width: 110, height: 156 };
  if (ratio > 1.18) return { width: 160, height: 110 };
  return { width: 140, height: 140 };
}

export function agentVideoThumbnailSize(width?: number, height?: number): AgentMediaCardSize {
  if (!width || !height || width <= 0 || height <= 0) return { width: 200, height: 140 };
  const ratio = width / height;
  if (ratio < 0.9) return { width: 112, height: 160 };
  if (ratio > 1.1) return { width: 200, height: 140 };
  return { width: 150, height: 150 };
}

export function presentAgentPaidMedia(metadata: AgentPartMetadata): AgentPaidMediaPresentation {
  const kind: AgentPaidMediaKind =
    metadata.media_type?.trim().toLowerCase() === "video" ? "video" : "image";
  const isUnlocked = metadata.access === "unlocked";
  const unlockedContentPath =
    kind === "video"
      ? metadata.content_url?.trim() || metadata.download_url?.trim()
      : metadata.content_url?.trim();
  const contentPath = isUnlocked ? unlockedContentPath : undefined;
  const previewPath =
    kind === "video" || !isUnlocked ? metadata.preview_url?.trim() : metadata.content_url?.trim();
  const savePath = isUnlocked
    ? metadata.download_url?.trim() || metadata.content_url?.trim()
    : undefined;
  return {
    kind,
    status: agentPaidMediaDisplayStatus(metadata.generation_status, metadata.access),
    isUnlocked,
    ...(contentPath ? { contentPath } : {}),
    ...(previewPath ? { previewPath } : {}),
    ...(savePath ? { savePath } : {}),
    size:
      kind === "video"
        ? agentVideoThumbnailSize(metadata.width, metadata.height)
        : agentImageThumbnailSize(metadata.width, metadata.height),
  };
}

export function agentMessageScope(ownerId: string, conversationId: string): string {
  return `${ownerId.trim()}:${conversationId.trim()}`;
}

export function isCurrentAgentMessageScope(currentScope: string, requestedScope: string): boolean {
  return Boolean(requestedScope) && currentScope === requestedScope;
}
