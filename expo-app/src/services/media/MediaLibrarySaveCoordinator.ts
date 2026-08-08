export type SaveImageResult = "saved" | "permissionDenied" | "invalidImage" | "failed";

export interface DownloadedImage {
  uri: string;
  cleanup: () => void;
}

export interface MediaLibrarySaveDependencies {
  getAddPermission: () => Promise<boolean>;
  requestAddPermission: () => Promise<boolean>;
  download: (url: string) => Promise<DownloadedImage>;
  validateImage: (localUri: string) => Promise<void>;
  createAsset: (localUri: string) => Promise<void>;
}

export async function saveImageWithDependencies(
  resolvedMediaPath: string,
  dependencies: MediaLibrarySaveDependencies,
): Promise<SaveImageResult> {
  try {
    const hasPermission =
      (await dependencies.getAddPermission()) || (await dependencies.requestAddPermission());
    if (!hasPermission) return "permissionDenied";
  } catch {
    return "failed";
  }

  let downloaded: DownloadedImage | null = null;
  try {
    const localUri = isDeviceLocalUri(resolvedMediaPath)
      ? resolvedMediaPath
      : (downloaded = await dependencies.download(resolvedMediaPath)).uri;
    try {
      await dependencies.validateImage(localUri);
    } catch {
      return "invalidImage";
    }
    await dependencies.createAsset(localUri);
    return "saved";
  } catch {
    return "failed";
  } finally {
    // Swift uses `try?` for its temporary-file removal. Cleanup is best effort
    // and must never replace an already-determined save result with a thrown
    // filesystem error.
    try {
      downloaded?.cleanup();
    } catch {
      // The cache directory can be concurrently reclaimed by the OS.
    }
  }
}

export function isDeviceLocalUri(uri: string): boolean {
  return uri.startsWith("file://") || uri.startsWith("content://");
}
