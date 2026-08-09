import { useCallback, useState } from "react";

export const chatComposerInputMetrics = Object.freeze({
  minimum: 40,
  maximum: 120,
});

export function clampChatComposerInputHeight(contentHeight: number): number {
  if (!Number.isFinite(contentHeight)) return chatComposerInputMetrics.minimum;
  return Math.min(
    chatComposerInputMetrics.maximum,
    Math.max(chatComposerInputMetrics.minimum, contentHeight),
  );
}

export function useChatComposerInputHeight(draft: string) {
  const [measuredHeight, setMeasuredHeight] = useState<number>(chatComposerInputMetrics.minimum);
  const inputHeight = draft.length === 0 ? chatComposerInputMetrics.minimum : measuredHeight;

  const updateInputHeight = useCallback(
    (contentHeight: number) => {
      const nextHeight =
        draft.length === 0
          ? chatComposerInputMetrics.minimum
          : clampChatComposerInputHeight(contentHeight);
      setMeasuredHeight((current) => (current === nextHeight ? current : nextHeight));
    },
    [draft],
  );

  const resetInputHeight = useCallback(() => {
    setMeasuredHeight(chatComposerInputMetrics.minimum);
  }, []);

  return { inputHeight, resetInputHeight, updateInputHeight };
}
