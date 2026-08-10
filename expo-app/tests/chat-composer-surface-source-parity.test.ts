import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("native chat composer surface parity", () => {
  const root = resolve(__dirname, "..");
  const nativeComponents = source("../BWChat/Components/StickerViews.swift");
  const nativeDirect = source("../BWChat/Views/ChatView.swift");
  const nativeGroup = source("../BWChat/Views/GroupChatView.swift");
  const expoSurface = source("src/components/messages/ChatComposerSurface.tsx");
  const expoStickerPanel = source("src/components/messages/ChatStickerPanel.tsx");
  const expoDirect = source("src/app/chat/[id].tsx");
  const expoGroup = source("src/app/group-chat/[id].tsx");

  it("preserves the non-animated 28pt regular toggle and selection feedback", () => {
    expect(nativeComponents).toContain("pointSize: 28");
    expect(nativeComponents).toContain("weight: .regular");
    expect(nativeComponents).toContain("CATransaction.setDisableActions(true)");
    expect(nativeComponents).toContain("accessibilityTraits.insert(.selected)");
    expect(nativeDirect).toContain("UISelectionFeedbackGenerator().selectionChanged()");
    expect(nativeGroup).toContain("UISelectionFeedbackGenerator().selectionChanged()");
    expect(expoSurface).toContain("Haptics.selectionAsync()");
    expect(expoSurface).toContain('weight="regular"');
    expect(expoSurface).toContain("accessibilityState={{ selected: isActive }}");
    expect(expoSurface).toContain("chatComposerSurfacePolicy.toggleSymbolSize");
  });

  it("keeps the 250ms height/background transition and native background layers", () => {
    expect(nativeDirect).toContain("Animation.easeInOut(duration: 0.25)");
    expect(nativeGroup).toContain("Animation.easeInOut(duration: 0.25)");
    expect(expoSurface).toContain("chatComposerSurfacePolicy.transitionDurationMs");
    expect(expoSurface).toContain("Easing.inOut(Easing.ease)");
    expect(expoSurface).toContain('"rgba(255,255,255,0.82)"');
    expect(expoSurface).toContain('"rgba(255,255,255,0.96)"');
    expect(expoSurface).toContain('backgroundColor: "rgba(242,242,247,0.98)"');
  });

  it("routes both direct and group composers through the shared host and buttons", () => {
    for (const file of [expoDirect, expoGroup]) {
      expect(file).toContain("<ChatComposerPanelHost");
      expect(file).toContain("<ChatComposerPanelToggleButton");
      expect(file).toContain("<ChatComposerSurfaceBackground");
      expect(file).toContain('activeSystemName="face.smiling.fill"');
      expect(file).toContain('activeSystemName="xmark.circle.fill"');
    }
  });

  it("keeps the chat wallpaper outside keyboard and custom-panel resizing", () => {
    for (const file of [expoDirect, expoGroup]) {
      expect(file).toMatch(
        /<View style=\{styles\.screen\}>\s*<ChatBackgroundLayer[\s\S]*?<ChatKeyboardAvoidingView style=\{styles\.chatContent\}>/u,
      );
      expect(file).not.toMatch(/<View style=\{styles\.timelineSurface\}>\s*<ChatBackgroundLayer/u);
      expect(file).toContain("chatContent: { flex: 1 }");
    }
  });

  it("prevents iOS from inserting navigation or keyboard insets above sticker grids", () => {
    expect(expoStickerPanel.match(/automaticallyAdjustContentInsets=\{false\}/gu)).toHaveLength(2);
    expect(expoStickerPanel.match(/automaticallyAdjustKeyboardInsets=\{false\}/gu)).toHaveLength(2);
    expect(expoStickerPanel.match(/contentInsetAdjustmentBehavior="never"/gu)).toHaveLength(2);
    expect(expoStickerPanel.match(/alignContent: "flex-start"/gu)).toHaveLength(2);
  });

  it("pins the horizontal pack tabs to their 48pt content height", () => {
    expect(expoStickerPanel).toContain("style={styles.tabScroll}");
    expect(expoStickerPanel).toMatch(
      /tabScroll: \{\s*flexGrow: 0,\s*flexShrink: 0,\s*height:\s*chatStickerPanelPolicy\.tabHeight \+\s*chatStickerPanelPolicy\.tabVerticalPadding \* 2,/u,
    );
  });

  it("keeps self-chat to the album-only 108pt panel and other chats at 202pt", () => {
    expect(nativeDirect).toContain("itemCount: isSelfConversation ? 1 : 6");
    expect(expoDirect).toContain("plusItemCount={isSelfChat ? 1 : 6}");
    expect(expoDirect).toContain("if (!isSelfChat)");
    expect(expoDirect).toContain("isSelfChat={Boolean(user?.user_id && id === user.user_id)}");
    expect(expoGroup).toContain("plusItemCount={6}");
    expect(expoDirect).toContain("height: 76");
    expect(expoGroup).toContain("height: 76");
  });

  it("uses localization keys for the placeholder, album and both accessibility labels", () => {
    for (const file of [expoDirect, expoGroup]) {
      expect(file).toContain('placeholder={t("chat.input.placeholder")}');
      expect(file).toContain('title: t("chat.album")');
      expect(file).toContain('accessibilityLabel={t("chat.stickers")}');
      expect(file).toContain('accessibilityLabel={t("accessibility.moreActions")}');
    }
  });

  function source(path: string): string {
    return readFileSync(resolve(root, path), "utf8");
  }
});
