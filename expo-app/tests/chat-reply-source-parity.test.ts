import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("reply preview source parity", () => {
  it("connects preview, quoted bubble, action menu, locator and animated highlight in both chats", () => {
    for (const file of ["src/app/chat/[id].tsx", "src/app/group-chat/[id].tsx"]) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      for (const expected of [
        "<ChatReplyPreviewBar",
        "<ChatQuotedMessageView",
        "<ChatMessageActionOverlay",
        "<ChatMessageLongPressSurface",
        "<ChatTimelineLocatorButton",
        "<ChatMessageHighlightSurface",
        "newMessagesBelowCount",
        "replyLocatorMessageIds",
        "contentOffset.y <= 24",
        "scrollToOffset({ animated: true, offset: 0 })",
      ])
        expect(source).toContain(expected);
    }
    const group = fs.readFileSync(path.join(root, "src/app/group-chat/[id].tsx"), "utf8");
    expect(group).toContain("mentionLocatorMessageIds");
    expect(group).toContain("message.mentions?.includes(ownerId)");
  });

  it("preserves the audited Swift geometry, locator priority and 1.5+0.5 second highlight", () => {
    const policy = fs.readFileSync(
      path.join(root, "src/services/messages/chatReplyPolicy.ts"),
      "utf8",
    );
    for (const expected of [
      "long_press_seconds: 0.45",
      "long_press_movement: 20",
      "menu_item_width: 58",
      "menu_item_height: 56",
      "menu_padding: 6",
      "menu_columns: 4",
      "menu_pointer_width: 14",
      "menu_pointer_height: 7",
      "composer_indicator_width: 3",
      "composer_indicator_height: 36",
      "composer_image_thumbnail: 44",
      "bubble_image_indicator_height: 75",
      "bubble_image_thumbnail: 56",
      "locator_height: 36",
      "highlight_seconds: 1.5",
      "highlight_fade_seconds: 0.5",
      'return { kind: "mention" }',
      'return { kind: "reply" }',
      'return { kind: "newMessages", count: options.newMessagesBelowCount }',
      'return options.isNearBottom ? null : { kind: "bottom" }',
    ])
      expect(policy).toContain(expected);
  });

  it("keeps all eight native menu actions and source SF Symbols", () => {
    const view = fs.readFileSync(
      path.join(root, "src/components/messages/ChatReplyViews.tsx"),
      "utf8",
    );
    const compactView = view.replace(/\s+/gu, " ");
    for (const [action, symbol] of [
      ["copy", "doc.on.doc"],
      ["retry", "arrow.clockwise"],
      ["forward", "arrowshape.turn.up.right"],
      ["save", "square.and.arrow.down"],
      ["quote", "quote.bubble"],
      ["recall", "arrow.uturn.backward"],
      ["delete", "trash"],
      ["multiSelect", "checkmark.circle"],
    ]) {
      expect(compactView).toContain(`case "${action}": return "${symbol}"`);
    }
    for (const expected of [
      "systemUltraThinMaterial",
      "Animated.delay(chatReplyGeometry.highlight_seconds * 1_000)",
      "duration: chatReplyGeometry.highlight_fade_seconds * 1_000",
    ])
      expect(view).toContain(expected);
  });
});
