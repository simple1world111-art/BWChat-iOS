import { CryptoDigestAlgorithm, digest, randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

import {
  chatRemoteAssetPolicy,
  normalizedRemoteAssetContentType,
  type ChatRemoteAsset,
} from "@/services/messages/chatStickerPolicy";

const cacheDirectory = new Directory(Paths.cache, "RemoteAssets");
const inFlight = new Map<string, Promise<string>>();

export async function verifiedChatRemoteAssetUri(asset: ChatRemoteAsset): Promise<string> {
  const existing = inFlight.get(asset.key);
  if (existing) return existing;
  const operation = verifyAndCache(asset).finally(() => inFlight.delete(asset.key));
  inFlight.set(asset.key, operation);
  return operation;
}

async function verifyAndCache(asset: ChatRemoteAsset): Promise<string> {
  const file = cacheFile(asset);
  if (file.exists) return file.uri;

  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`Remote asset HTTP ${response.status}`);
  const responseType = normalizedRemoteAssetContentType(response.headers.get("Content-Type") ?? undefined);
  if (!responseType || !chatRemoteAssetPolicy.allowedImageContentTypes.includes(responseType as never)) {
    throw new Error("Unsupported remote asset content type");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (asset.byteSize !== undefined && bytes.byteLength !== asset.byteSize) {
    throw new Error("Remote asset size mismatch");
  }
  if (bytes.byteLength > Math.min(asset.byteSize ?? chatRemoteAssetPolicy.maximumSingleFileBytes, chatRemoteAssetPolicy.maximumSingleFileBytes)) {
    throw new Error("Remote asset is too large");
  }
  if (asset.sha256?.trim()) {
    const actual = bytesToHex(await digest(CryptoDigestAlgorithm.SHA256, bytes));
    if (actual !== asset.sha256.toLocaleLowerCase()) throw new Error("Remote asset checksum mismatch");
  }

  cacheDirectory.create({ intermediates: true, idempotent: true });
  const temporary = new File(cacheDirectory, `${file.name}.${randomUUID()}.tmp`);
  try {
    temporary.create({ intermediates: true, overwrite: true });
    temporary.write(bytes);
    await temporary.move(file, { overwrite: true });
  } catch (error) {
    if (temporary.exists) temporary.delete();
    throw error;
  }
  return file.uri;
}

function cacheFile(asset: ChatRemoteAsset): File {
  const filename = asset.key.replaceAll("/", "_").replaceAll(":", "_");
  let extension = "asset";
  try {
    const candidate = new URL(asset.url).pathname.split(".").pop();
    if (candidate?.trim()) extension = candidate;
  } catch {
    // URL trust is checked by the policy before this service is called.
  }
  return new File(cacheDirectory, `${filename}.${extension}`);
}

function bytesToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
