import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { chatKeyboardInset } from "@/components/messages/ChatKeyboardAvoidingView";
import {
  chatComposerInitialInputHeight,
  chatComposerInputHeight,
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

  it("makes the visible send return key submit on every chat surface", () => {
    for (const path of [
      "src/app/chat/[id].tsx",
      "src/app/group-chat/[id].tsx",
      "src/app/agent-chat.tsx",
      "src/app/script-room-chat.tsx",
    ]) {
      const page = source(path);
      expect(page).toContain("<ChatKeyboardAvoidingView");
      expect(page).toContain('returnKeyType="send"');
      expect(page).toContain('submitBehavior="submit"');
      expect(page).toContain("Keyboard.dismiss()");
    }
  });

  it("preserves intrinsic multiline growth and only collapses an empty draft", () => {
    for (const path of [
      "src/app/chat/[id].tsx",
      "src/app/group-chat/[id].tsx",
      "src/app/agent-chat.tsx",
      "src/app/script-room-chat.tsx",
    ]) {
      const page = source(path);
      expect(page).toContain("chatComposerInputHeight(");
      expect(page).toContain("initialInputHeight !== undefined && { height: initialInputHeight }");
      expect(page).not.toContain("updateInputHeight(nativeEvent.contentSize.height)");
      expect(page).not.toContain("scrollEnabled={inputHeight");
    }
  });

  it("dismisses direct and group chat keyboards before native back navigation", () => {
    for (const path of ["src/app/chat/[id].tsx", "src/app/group-chat/[id].tsx"]) {
      const page = source(path);
      expect(page).toContain("onSubmitEditing={onSend}");
      expect(page).toContain("onPress={onSend}");
      expect(page).toContain('navigation.addListener("beforeRemove"');
      expect(page).toContain("Keyboard.dismiss()");
    }
  });

  it("does not impose a controlled height while multiline text is present", () => {
    expect(chatComposerInputHeight("")).toBe(chatComposerInitialInputHeight);
    expect(chatComposerInputHeight("single line")).toBeUndefined();
    expect(chatComposerInputHeight("first line\nsecond line")).toBeUndefined();
  });

  it("keeps the script composer above the safe area and centers the agent input", () => {
    const scriptChat = source("src/app/script-room-chat.tsx");
    expect(scriptChat).toContain("const safeAreaInsets = useSafeAreaInsets();");
    expect(scriptChat).toContain(
      "{ paddingBottom: isInputFocused ? 12 : 12 + safeAreaInsets.bottom }",
    );
    expect(scriptChat).toContain("onBlur={() => setInputFocused(false)}");
    expect(scriptChat).toContain("onFocus={() => setInputFocused(true)}");

    const agentChat = source("src/app/agent-chat.tsx");
    expect(agentChat).toContain('justifyContent: "center"');
    expect(agentChat).toContain("paddingVertical: 8");
  });

  it("remounts the native pull-to-refresh control after returning to messages", () => {
    const page = source("src/app/(tabs)/conversations.tsx");
    expect(page).toContain("setRefreshControlRevision((current) => current + 1)");
    expect(page).toContain("`conversation-refresh-${refreshControlRevision}`");
    expect(page).toContain('void load(itemsRef.current.length > 0 ? "background" : "initial")');
  });
});
