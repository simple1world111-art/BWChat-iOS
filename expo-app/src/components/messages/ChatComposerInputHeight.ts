export const chatComposerInitialInputHeight = 40;

/**
 * Keep React Native's intrinsic multiline sizing while text exists. Once the
 * controlled draft is cleared after send, override the stale iOS intrinsic
 * size for one empty state so the composer returns to its initial height.
 */
export function chatComposerInputHeight(draft: string): number | undefined {
  return draft.length === 0 ? chatComposerInitialInputHeight : undefined;
}
