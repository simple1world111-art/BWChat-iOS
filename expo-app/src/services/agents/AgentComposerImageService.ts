import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";

import { env } from "@/config/env";
import { agentComposerImagePolicy } from "@/services/agents/AgentComposerImagePolicy";
import { downloadAuthenticatedMediaToFile } from "@/services/media/AuthenticatedMediaLoader";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export interface PreparedAgentComposerImage {
  uri: string;
  filename: string;
}

export async function prepareAgentComposerImage(
  mediaPath: string,
): Promise<PreparedAgentComposerImage> {
  const resolved = resolveMediaUrl(mediaPath, env.apiBaseUrl) ?? mediaPath;
  let downloaded: File | null = null;
  try {
    let localUri = resolved;
    if (!isLocalUri(resolved)) {
      const destination = new File(
        Paths.cache,
        `bwchat-agent-reply-${Date.now()}-${Math.random().toString(16).slice(2)}.image`,
      );
      downloaded = await downloadAuthenticatedMediaToFile(resolved, destination);
      localUri = downloaded.uri;
    }

    await Image.loadAsync(localUri);
    const prepared = await ImageManipulator.manipulateAsync(localUri, [], {
      compress: agentComposerImagePolicy.jpegQuality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    const boundedUri = await enforceAgentUploadBounds(
      prepared.uri,
      prepared.width,
      prepared.height,
    );
    return {
      uri: boundedUri,
      filename: `agent_${createLocalId()}.jpg`,
    };
  } finally {
    if (downloaded?.exists) downloaded.delete();
  }
}

async function enforceAgentUploadBounds(
  sourceUri: string,
  sourceWidth: number,
  sourceHeight: number,
): Promise<string> {
  const sourceSize = new File(sourceUri).size;
  if (
    sourceSize !== null &&
    sourceSize <= agentComposerImagePolicy.uploadMaximumBytes &&
    Math.max(sourceWidth, sourceHeight) <= agentComposerImagePolicy.uploadMaximumDimension
  ) {
    return sourceUri;
  }

  let bestUri = sourceUri;
  try {
    for (const maximumDimension of agentComposerImagePolicy.uploadDimensions) {
      const resize = resizeAction(sourceWidth, sourceHeight, maximumDimension);
      for (const quality of agentComposerImagePolicy.uploadQualities) {
        const candidate = await ImageManipulator.manipulateAsync(sourceUri, resize, {
          compress: quality,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        if (bestUri !== sourceUri) deleteLocalFile(bestUri);
        bestUri = candidate.uri;
        const candidateSize = new File(candidate.uri).size;
        if (
          candidateSize !== null &&
          candidateSize <= agentComposerImagePolicy.uploadMaximumBytes
        ) {
          deleteLocalFile(sourceUri);
          return candidate.uri;
        }
      }
    }
  } catch {
    if (bestUri !== sourceUri) deleteLocalFile(bestUri);
    return sourceUri;
  }
  if (bestUri !== sourceUri) deleteLocalFile(sourceUri);
  return bestUri;
}

function resizeAction(
  width: number,
  height: number,
  maximumDimension: number,
): ImageManipulator.Action[] {
  if (Math.max(width, height) <= maximumDimension) return [];
  return width >= height
    ? [{ resize: { width: maximumDimension } }]
    : [{ resize: { height: maximumDimension } }];
}

export function discardAgentComposerImage(uri: string | null | undefined): void {
  if (!uri?.startsWith("file://")) return;
  deleteLocalFile(uri);
}

function deleteLocalFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup is best effort and must never affect the composer.
  }
}

function isLocalUri(uri: string): boolean {
  return uri.startsWith("file://") || uri.startsWith("content://") || uri.startsWith("data:");
}

function createLocalId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 10)}`;
}
