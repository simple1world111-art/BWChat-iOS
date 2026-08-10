import type {
  AgentCapabilities,
  AgentMessage,
  AgentMessagePart,
  AgentRuntimeConfig,
} from "@/models";
import { agentPaidMediaDisplayStatus } from "@/services/props/AgentMediaUnlockState";

export const agentTransformInstructionPrefix = "请基于我上传的图片进行调整并生成一张新的图片。";
export const agentToolInvocationInstruction =
  "请实际调用图片生成工具，不要只用文字描述。调整要求：";
export const agentDefaultTransformInstruction = "请保持主体特征和整体构图。";

export interface AgentImageReplyTarget {
  messageId: string;
  partId: string;
  imagePath: string;
  isFromUser: boolean;
}

export function agentImageReplyTargetId(target: AgentImageReplyTarget): string {
  return `${target.messageId}:${target.partId}`;
}

export function agentImageReplySenderLabel(target: AgentImageReplyTarget): string {
  return target.isFromUser ? "你" : "智能体";
}

export function agentImagePath(part: AgentMessagePart): string | null {
  if (part.type === "input_image") {
    const localContent = part.metadata.content_url?.trim();
    if (localContent && /^(?:file|content|data|blob):/iu.test(localContent)) return localContent;
    const assetId = part.asset_id?.trim();
    return assetId ? `/agent-assets/${encodeURIComponent(assetId)}/content` : null;
  }
  if (
    part.type === "paid_media" &&
    part.metadata.media_type?.trim().toLowerCase() !== "video" &&
    part.metadata.access === "unlocked"
  ) {
    return part.metadata.content_url?.trim() || null;
  }
  return null;
}

export function agentImageReplyTarget(
  part: AgentMessagePart,
  message: AgentMessage,
): AgentImageReplyTarget | null {
  const imagePath = agentImagePath(part);
  if (!imagePath) return null;
  return {
    messageId: message.id,
    partId: part.id,
    imagePath,
    isFromUser: message.sender.type === "user",
  };
}

export function agentGalleryImagePaths(messages: readonly AgentMessage[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const message of messages) {
    for (const part of orderedAgentParts(message)) {
      const path = agentImagePath(part);
      if (path && !seen.has(path)) {
        seen.add(path);
        paths.push(path);
      }
    }
  }
  return paths;
}

export function resolveAgentHistoryImageReply(
  message: AgentMessage,
  messages: readonly AgentMessage[],
): AgentImageReplyTarget | null {
  const replyToId = message.reply_to_id?.trim();
  if (replyToId) {
    const source = messages.find((candidate) => candidate.id === replyToId);
    const sourceTarget = source ? firstAgentImageTarget(source) : null;
    if (sourceTarget) return sourceTarget;
  }

  const isImageReply =
    Boolean(replyToId) ||
    orderedAgentParts(message).some(
      (part) => part.type === "text" && isAgentTransformRequest(part.text),
    );
  return isImageReply ? firstAgentImageTarget(message) : null;
}

export function isAgentTransformRequest(text: string): boolean {
  return text.startsWith(agentTransformInstructionPrefix);
}

export function agentTransformOutboundText(userText: string): string {
  const trimmed = userText.trim();
  return (
    agentTransformInstructionPrefix +
    agentToolInvocationInstruction +
    (trimmed || agentDefaultTransformInstruction)
  );
}

export function agentUserVisibleText(outboundText: string): string {
  const trimmed = outboundText.trim();
  if (!isAgentTransformRequest(trimmed)) return trimmed;

  const payload = trimmed.slice(agentTransformInstructionPrefix.length);
  if (
    payload === agentDefaultTransformInstruction ||
    payload === agentToolInvocationInstruction + agentDefaultTransformInstruction
  ) {
    return "";
  }
  if (payload.startsWith(agentToolInvocationInstruction)) {
    return payload.slice(agentToolInvocationInstruction.length).trim();
  }
  const marker = "调整要求：";
  const markerIndex = payload.indexOf(marker);
  return markerIndex >= 0 ? payload.slice(markerIndex + marker.length).trim() : "";
}

export function agentImageGenerationBlockReason(
  runtimeConfig: AgentRuntimeConfig | null,
  capabilities: AgentCapabilities | null,
  messages: readonly AgentMessage[],
): string | null {
  if (!runtimeConfig) return "正在加载图片生成能力，请稍后再试";
  if (
    !runtimeConfig.agents_enabled ||
    !runtimeConfig.image_input_enabled ||
    !runtimeConfig.paid_images_enabled
  ) {
    return "图片生成功能当前未开放";
  }
  if (!capabilities?.paid_images) return "当前会话使用的智能体版本未开启图片能力";
  const hasBlockingLockedMedia = messages.some((message) =>
    message.parts.some((part) => {
      if (
        part.type !== "paid_media" ||
        part.metadata.media_type?.trim().toLowerCase() === "video"
      ) {
        return false;
      }
      const status = agentPaidMediaDisplayStatus(
        part.metadata.generation_status,
        part.metadata.access,
      );
      return (
        ["queued", "generating", "ready_locked"].includes(status) &&
        part.metadata.access !== "unlocked"
      );
    }),
  );
  return hasBlockingLockedMedia ? "请先解锁上一张图片，再继续调整图片" : null;
}

function firstAgentImageTarget(message: AgentMessage): AgentImageReplyTarget | null {
  for (const part of orderedAgentParts(message)) {
    const target = agentImageReplyTarget(part, message);
    if (target) return target;
  }
  return null;
}

function orderedAgentParts(message: AgentMessage): AgentMessagePart[] {
  return [...message.parts].sort((left, right) => left.ordinal - right.ordinal);
}
