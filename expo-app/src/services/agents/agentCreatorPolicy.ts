import { File } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";

import type { AgentSummary } from "@/models";

export const agentCreatorPolicy = {
  referenceSize: 64,
  referenceRadius: 12,
  referenceStrokeWidth: 1,
  referenceRowSpacing: 14,
  referenceCopySpacing: 5,
  referenceTitleSize: 15,
  referenceDetailSize: 12,
  referenceSymbolSize: 22,
  sectionHeaderSize: 14,
  errorSize: 13,
  minimumReferenceShortSide: 512,
  minimumReferenceRatio: 0.5,
  maximumReferenceRatio: 2,
  pickerJpegQuality: 0.92,
  uploadMaximumDimension: 1600,
  uploadInitialQuality: 0.82,
  uploadMaximumBytes: 2_000_000,
  uploadTimeoutMilliseconds: 90_000,
  apiTimeoutMilliseconds: 30_000,
  defaultRequestTimeoutMilliseconds: 60_000,
  conversationTimeoutMilliseconds: 15_000,
  uploadFieldName: "image",
  uploadFilename: "agent-reference.jpg",
  uploadMimeType: "image/jpeg",
} as const;

const compressionDimensions = [1600, 1200, 900, 675, 640] as const;
const compressionQualities = [0.82, 0.65, 0.55, 0.45, 0.35] as const;

export const agentReferenceCompressionPolicy = {
  dimensions: compressionDimensions,
  qualities: compressionQualities,
} as const;

export interface AgentCreatorValues {
  name: string;
  tagline: string;
  descriptionText: string;
  tagsText: string;
  language: string;
  visibility: string;
  identity: string;
  personalityText: string;
  toneStyle: string;
  replyLength: string;
  relationshipType: string;
  addressStyle: string;
  adultEnabled: boolean;
  intimacyStyle: string;
  initiative: string;
  greeting: string;
  paidImages: boolean;
}

export const defaultAgentCreatorValues: AgentCreatorValues = {
  name: "",
  tagline: "",
  descriptionText: "",
  tagsText: "companion",
  language: "zh-CN",
  visibility: "private",
  identity: "",
  personalityText: "温暖, 细心",
  toneStyle: "warm",
  replyLength: "medium",
  relationshipType: "companion",
  addressStyle: "natural",
  adultEnabled: false,
  intimacyStyle: "romantic",
  initiative: "responsive",
  greeting: "你好",
  paidImages: true,
};

export function agentCreatorValues(agent: AgentSummary): AgentCreatorValues {
  return {
    name: agent.profile?.name ?? "",
    tagline: agent.profile?.tagline ?? "",
    descriptionText: agent.profile?.description ?? "",
    tagsText: (agent.profile?.tags ?? []).join(", "),
    language: agent.profile?.language ?? "zh-CN",
    visibility: agent.visibility ?? "private",
    identity: agent.definition?.identity ?? "",
    personalityText: (agent.definition?.personality ?? []).join(", "),
    toneStyle: agent.definition?.tone?.style ?? "warm",
    replyLength: agent.definition?.tone?.reply_length ?? "medium",
    relationshipType: agent.definition?.relationship?.type ?? "companion",
    addressStyle: agent.definition?.relationship?.address_style ?? "natural",
    adultEnabled: agent.definition?.intimacy?.adult_enabled ?? false,
    intimacyStyle: agent.definition?.intimacy?.style ?? "romantic",
    initiative: agent.definition?.intimacy?.initiative ?? "responsive",
    greeting: agent.definition?.greetings?.[0]?.text ?? agent.greetings?.[0]?.text ?? "你好",
    paidImages:
      agent.definition?.capabilities?.paid_images ?? agent.capabilities?.paid_images ?? true,
  };
}

export function canSaveAgent(
  values: AgentCreatorValues,
  isEditing: boolean,
  hasSelectedReference: boolean,
  isSaving: boolean,
): boolean {
  return (
    values.name.trim().length > 0 &&
    values.greeting.trim().length > 0 &&
    (isEditing || hasSelectedReference) &&
    !isSaving
  );
}

export function agentCreatorErrorCode(error: unknown): number | undefined {
  const root = recordValue(error);
  const payload = recordValue(root?.payload);
  const detail = recordValue(payload?.detail);
  const nestedError = recordValue(payload?.error);
  const data = recordValue(payload?.data);
  for (const value of [
    root?.code,
    payload?.code,
    detail?.code,
    nestedError?.code,
    data?.code,
    data?.error_code,
  ]) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

export function agentCreatorErrorMessage(error: unknown): string {
  const root = recordValue(error);
  const status = Number(root?.status);
  const fallback = error instanceof Error && error.message ? error.message : "操作失败，请稍后重试";
  if (status >= 500 && status <= 599) return fallback;

  const payload = recordValue(root?.payload);
  const detail = recordValue(payload?.detail);
  const nestedError = recordValue(payload?.error);
  const data = recordValue(payload?.data);
  for (const value of [detail?.message, payload?.message, nestedError?.message, data?.message]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

export function agentPatchPayload(
  values: AgentCreatorValues,
  assets: {
    referenceAssetId?: string | undefined;
    avatarAssetId?: string | undefined;
  } = {},
): Record<string, unknown> {
  const description = values.descriptionText.trim();
  const payload: Record<string, unknown> = {
    name: values.name.trim(),
    tagline: values.tagline.trim(),
    description,
    tags: commaSeparated(values.tagsText),
    language: values.language,
    visibility: values.visibility,
    definition: {
      identity: values.identity.trim(),
      personality: commaSeparated(values.personalityText),
      tone: { style: values.toneStyle, reply_length: values.replyLength },
      relationship: {
        type: values.relationshipType,
        address_style: values.addressStyle,
      },
      intimacy: {
        adult_enabled: values.adultEnabled,
        style: values.intimacyStyle,
        initiative: values.initiative,
      },
      greetings: [{ id: "default", text: values.greeting.trim() }],
      example_dialogues: [],
      visual_identity: { description },
      capabilities: {
        paid_images: values.paidImages,
        paid_videos: false,
        stickers: false,
        platform_rewards: false,
        proactive_messages: false,
      },
    },
  };
  if (assets.referenceAssetId) {
    payload.primary_reference_asset_id = assets.referenceAssetId;
  }
  if (assets.avatarAssetId) payload.avatar_asset_id = assets.avatarAssetId;
  return payload;
}

export function createAgentPayload(
  values: AgentCreatorValues,
  referenceAssetId: string,
  avatarAssetId: string,
): Record<string, unknown> {
  return agentPatchPayload(values, { referenceAssetId, avatarAssetId });
}

export function commaSeparated(value: string): string[] {
  return value
    .split(/[,，]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function validAgentReferenceDimensions(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  const shortSide = Math.min(width, height);
  const ratio = width / Math.max(height, 1);
  return (
    shortSide >= agentCreatorPolicy.minimumReferenceShortSide &&
    ratio >= agentCreatorPolicy.minimumReferenceRatio &&
    ratio <= agentCreatorPolicy.maximumReferenceRatio
  );
}

export async function makeAgentReferencePreview(uri: string): Promise<string> {
  return (
    await ImageManipulator.manipulateAsync(uri, [], {
      compress: agentCreatorPolicy.pickerJpegQuality,
      format: ImageManipulator.SaveFormat.JPEG,
    })
  ).uri;
}

export async function prepareAgentReferenceForUpload(
  uri: string,
  width: number,
  height: number,
): Promise<string> {
  if (
    Math.max(width, height) <= agentCreatorPolicy.uploadMaximumDimension &&
    agentReferenceFileSize(uri) <= agentCreatorPolicy.uploadMaximumBytes
  ) {
    return uri;
  }

  let bestUri: string | null = null;
  try {
    for (const dimension of compressionDimensions) {
      const boundedDimension = Math.min(dimension, agentCreatorPolicy.uploadMaximumDimension);
      const actions =
        Math.max(width, height) > boundedDimension
          ? [
              {
                resize:
                  width >= height ? { width: boundedDimension } : { height: boundedDimension },
              },
            ]
          : [];
      for (const quality of compressionQualities) {
        const prepared = await ImageManipulator.manipulateAsync(uri, actions, {
          compress: quality,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        if (bestUri && bestUri !== uri && bestUri !== prepared.uri) {
          removeAgentCreatorTemporaryFile(bestUri);
        }
        bestUri = prepared.uri;
        if (agentReferenceFileSize(prepared.uri) <= agentCreatorPolicy.uploadMaximumBytes) {
          return prepared.uri;
        }
      }
    }
    if (!bestUri) throw new Error("图片处理失败");
    return bestUri;
  } catch (error) {
    if (bestUri && bestUri !== uri) removeAgentCreatorTemporaryFile(bestUri);
    throw error;
  }
}

export function removeAgentCreatorTemporaryFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // ImageManipulator results live in cache and cleanup is best effort.
  }
}

function agentReferenceFileSize(uri: string): number {
  const size = new File(uri).size;
  return typeof size === "number" && Number.isFinite(size) && size >= 0
    ? size
    : Number.POSITIVE_INFINITY;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
