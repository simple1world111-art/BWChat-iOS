import { Directory, Paths } from "expo-file-system";

export function momentDraftDirectory(ownerId: string, draftId: string): Directory {
  return new Directory(
    Paths.document,
    "bwchat-outbox",
    "moments",
    encodeURIComponent(ownerId.trim() || "anonymous"),
    draftId,
  );
}

export function removeMomentDraft(ownerId: string, draftId: string): void {
  const directory = momentDraftDirectory(ownerId, draftId);
  try {
    if (directory.exists) directory.delete();
  } catch {
    // Cleanup is best-effort, matching the native outbox store.
  }
}
