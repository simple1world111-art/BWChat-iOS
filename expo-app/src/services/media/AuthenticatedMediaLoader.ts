import { File } from "expo-file-system";

import { authenticatedResourceRequest } from "@/api/client";

/** Downloads binary media through the app's canonical token-refresh lifecycle. */
export async function downloadAuthenticatedMediaToFile(
  remoteUrl: string,
  destination: File,
): Promise<File> {
  try {
    const response = await authenticatedResourceRequest(remoteUrl);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("媒体响应为空");
    if (destination.exists) destination.delete();
    destination.write(bytes);
    return destination;
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}
