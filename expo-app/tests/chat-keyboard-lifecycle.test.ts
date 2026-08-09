import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react-native";

import { chatKeyboardInset } from "@/components/messages/ChatKeyboardAvoidingView";
import {
  chatComposerInputMetrics,
  clampChatComposerInputHeight,
  useChatComposerInputHeight,
} from "@/components/messages/ChatComposerInputHeight";

const root = resolve(__dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("chat keyboard lifecycle", () => {
  it("normalizes the native iOS keyboard inset", () => {
    expect(chatKeyboardInset({ height: 346, screenY: 528 }, 874)).toBe(346);
    expect(chatKeyboardInset({ height: 346, screenY: 874 }, 874)).toBe(0);
    expect(chatKeyboardInset({ height: 346, screenY: 800 }, 874)).toBe(74);
    expect(chatKeyboardInset({ height: Number.NaN, screenY: 528 }, 874)).toBe(0);
    expect(chatKeyboardInset(undefined, 874)).toBe(0);
  });

  it("makes the visible send return key submit in direct and group chats", () => {
    for (const path of ["src/app/chat/[id].tsx", "src/app/group-chat/[id].tsx"]) {
      const page = source(path);
      expect(page).toContain("<ChatKeyboardAvoidingView");
      expect(page).toContain('returnKeyType="send"');
      expect(page).toContain('submitBehavior="submit"');
      expect(page).toContain("useChatComposerInputHeight(draft)");
      expect(page).toContain("updateInputHeight(nativeEvent.contentSize.height)");
      expect(page).toContain("resetInputHeight();");
      expect(page).toContain("onSubmitEditing={submitDraft}");
      expect(page).toContain("onPress={submitDraft}");
      expect(page).toContain('navigation.addListener("beforeRemove"');
      expect(page).toContain("Keyboard.dismiss()");
    }
  });

  it("clamps multiline composer content and restores the single-line height", () => {
    expect(clampChatComposerInputHeight(Number.NaN)).toBe(chatComposerInputMetrics.minimum);
    expect(clampChatComposerInputHeight(12)).toBe(40);
    expect(clampChatComposerInputHeight(72)).toBe(72);
    expect(clampChatComposerInputHeight(240)).toBe(120);
  });

  it("ignores stale multiline measurements after the sent draft is cleared", async () => {
    const hook = await renderHook(
      ({ draft }: { draft: string }) => useChatComposerInputHeight(draft),
      { initialProps: { draft: "a long draft" } },
    );
    await act(async () => hook.result.current.updateInputHeight(110));
    expect(hook.result.current.inputHeight).toBe(110);

    await act(async () => hook.result.current.resetInputHeight());
    await hook.rerender({ draft: "" });
    expect(hook.result.current.inputHeight).toBe(40);

    await act(async () => hook.result.current.updateInputHeight(110));
    expect(hook.result.current.inputHeight).toBe(40);
    await hook.rerender({ draft: "next" });
    expect(hook.result.current.inputHeight).toBe(40);
  });

  it("remounts the native pull-to-refresh control after returning to messages", () => {
    const page = source("src/app/(tabs)/conversations.tsx");
    expect(page).toContain("setRefreshControlRevision((current) => current + 1)");
    expect(page).toContain("`conversation-refresh-${refreshControlRevision}`");
    expect(page).toContain('void load(itemsRef.current.length > 0 ? "background" : "initial")');
  });
});
