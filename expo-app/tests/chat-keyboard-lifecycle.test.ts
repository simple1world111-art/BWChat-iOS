import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { chatKeyboardInset } from "@/components/messages/ChatKeyboardAvoidingView";
import {
  chatComposerBottomInset,
  chatComposerPanelHeight,
  chatComposerRestingInset,
  chatComposerUsesKeyboardEventHeight,
} from "@/components/messages/ChatComposerSurface";
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

  it("uses one bottom inset for keyboard and composer panels without adding their heights", () => {
    expect(chatComposerPanelHeight("stickers", 6, 346)).toBe(346);
    expect(chatComposerPanelHeight("plus", 6, 346)).toBe(202);
    expect(chatComposerBottomInset("stickers", 6, 0, 346, false, 0)).toBe(346);
    expect(chatComposerBottomInset(null, 6, 0, 346, true, 346)).toBe(346);
    expect(chatComposerBottomInset(null, 6, 346, 346, true, 346)).toBe(346);
    expect(chatComposerBottomInset("plus", 6, 346, 346, false, 346)).toBe(202);
    expect(chatComposerRestingInset(34)).toBe(41);
    expect(chatComposerRestingInset(-1)).toBe(7);
  });

  it("uses the native keyboard layout transaction for both opening and closing", () => {
    expect(chatComposerUsesKeyboardEventHeight(null, 346, 0)).toBe(true);
    expect(chatComposerUsesKeyboardEventHeight(null, 0, 346)).toBe(true);
    expect(chatComposerUsesKeyboardEventHeight(null, 0, 0)).toBe(false);
    expect(chatComposerUsesKeyboardEventHeight("stickers", 0, 346)).toBe(false);
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

  it("keeps the native caret stable and slides it left on the UI thread", () => {
    const direct = source("src/app/chat/[id].tsx");
    const group = source("src/app/group-chat/[id].tsx");
    const surface = source("src/components/messages/ChatComposerSurface.tsx");

    for (const page of [direct, group]) {
      expect(page).toContain("useChatComposerMicrophoneTransition(");
      expect(page).toContain("<ChatComposerTextInput");
      expect(page).toContain("{ transform: [{ translateX: textTranslateX }] }");
      expect(page).toContain("opacity: microphoneOpacity");
      expect(page).toContain("scale: microphoneScale");
      expect(page).not.toContain("setReservesFocusedMicrophoneInset");
      expect(page).toContain(
        "onChangeText={(value) => {\n                cancelScheduledSelection();",
      );
      expect(page).toContain("scheduleSelection(inserted.selection)");
    }

    expect(surface).toContain("const chatComposerMicrophoneInset = 34;");
    expect(surface).toContain("const chatComposerMicrophoneTransitionDurationMs = 140;");
    expect(surface).toContain("easing: Easing.out(Easing.cubic)");
    expect(surface).toContain("useNativeDriver: true");
    expect(surface).not.toContain("paddingLeft: microphoneInset");

    expect(group).not.toContain(
      "selection={{ start: selection.location, end: selection.location + selection.length }}",
    );
    expect(group).toContain("requestedSelectionRef.current = selection;");
    expect(group).toContain("inputRef.current?.setNativeProps({ selection });");
  });

  it("runs custom panel resizing as one native layout transaction", () => {
    const surface = source("src/components/messages/ChatComposerSurface.tsx");
    expect(surface).toContain("LayoutAnimation.configureNext(");
    expect(surface).toContain("const chatComposerPanelDismissDurationMs = 220;");
    expect(surface).toContain("LayoutAnimation.Types.easeOut");
    expect(surface).toContain("LayoutAnimation.Types.easeInEaseOut");
    expect(surface).toContain("const [renderedPanel, setRenderedPanel] = useState(panel);");
    expect(surface).toContain("const [panelViewportHeight, setPanelViewportHeight]");
    expect(surface).toContain("const nextPanelViewportHeight = panel === null ? 0 : nextHeight;");
    expect(surface).toContain('testID="chat-composer-panel-viewport"');
    expect(surface).toContain("setPanelViewportHeight(nextPanelViewportHeight);");
    expect(surface).toContain("transitionGenerationRef.current !== generation");
    expect(surface).not.toContain("Animated.timing(height");
    expect(surface).not.toContain("useNativeDriver: false");
  });

  it("lets the keyboard event animate safe-area and spacer changes in one layout transaction", () => {
    const keyboard = source("src/components/messages/ChatKeyboardAvoidingView.tsx");
    for (const page of [source("src/app/chat/[id].tsx"), source("src/app/group-chat/[id].tsx")]) {
      expect(page).toContain("{ paddingBottom: 5 }");
      expect(page).toContain("restingInset={chatComposerRestingInset(safeAreaInsets.bottom)}");
      expect(page).not.toContain("paddingBottom: keyboardLayout.inset > 0");
    }
    const surface = source("src/components/messages/ChatComposerSurface.tsx");
    expect(surface).toContain("previousKeyboardInsetRef");
    expect(surface).toContain("chatComposerUsesKeyboardEventHeight(");
    expect(surface).toContain("Math.max(safeRestingInset, keyboardInset)");
    expect(keyboard).toContain("if (nextInset === keyboardInsetRef.current) return;");
    expect(keyboard).toContain("if (schedulesAnimation) Keyboard.scheduleLayoutAnimation(event);");
    expect(keyboard).toContain("updateInset(event, false)");
    expect(keyboard).toContain("clearInset(event, false)");
  });

  it("dismisses on tap end and leaves keyboard dragging to the interactive system gesture", () => {
    for (const path of ["src/app/chat/[id].tsx", "src/app/group-chat/[id].tsx"]) {
      const page = source(path);
      expect(page).toContain('keyboardDismissMode="interactive"');
      expect(page).toContain("const timelineTouchDraggedRef = useRef(false);");
      expect(page).toContain("const dismissComposerSurface = useCallback(() => {");
      expect(page).toContain("onTouchEnd={() => {");
      expect(page).toContain("onTouchMove={({ nativeEvent }) => {");
      expect(page).toContain("deltaX * deltaX + deltaY * deltaY >= 64");
      expect(page).toContain("dismissComposerSurface();");
      expect(page).toContain("data={reversedTimeline}");
      expect(page).toContain("onTimelineLongPressStart={claimTimelineTouchSequence}");
      expect(page).toContain("onLongPressStart={onTimelineLongPressStart}");

      const scrollDismiss = page.match(
        /onScrollBeginDrag=\{\(\) => \{[\s\S]*?\}\}\s*onTouchCancel=/u,
      )?.[0];
      expect(scrollDismiss).toBeDefined();
      expect(scrollDismiss).not.toContain("Keyboard.dismiss()");
      expect(scrollDismiss).not.toContain("setInputFocused(false)");
      expect(scrollDismiss).not.toContain("setFocused(false)");

      const touchStart = page.match(/onTouchStart=\{\(\{ nativeEvent \}\) => \{[\s\S]*?\}\}/u)?.[0];
      expect(touchStart).toBeDefined();
      expect(touchStart).not.toContain("Keyboard.dismiss()");
    }
  });

  it("lets the shared composer reserve the iOS keyboard instead of stacking parent padding", () => {
    for (const path of ["src/app/chat/[id].tsx", "src/app/group-chat/[id].tsx"]) {
      const page = source(path);
      expect(page).toContain("<ChatKeyboardAvoidingView reservesKeyboardInset={false}");
      expect(page).toContain("useChatKeyboardLayout()");
      expect(page).toContain("keyboardInset={keyboardLayout.inset}");
      expect(page).toContain("keyboardEquivalentInset={keyboardLayout.equivalentInset}");
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
    const provider = source("src/providers/RealtimeProvider.tsx");
    expect(page).toContain("setRefreshControlRevision((current) => current + 1)");
    expect(page).toContain("`conversation-refresh-${refreshControlRevision}`");
    expect(page).toContain('void load(itemsRef.current.length > 0 ? "projection" : "initial")');
    expect(page).not.toContain('void load(itemsRef.current.length > 0 ? "background" : "initial")');
    expect(provider).toContain("conversationSyncCoordinator.subscribe(ownerId");
    expect(provider).toContain("catchUpConversationState(ownerId, controller.signal)");
  });
});
