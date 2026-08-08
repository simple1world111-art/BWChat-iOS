import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("media picker preview source parity", () => {
  it("connects preview-before-send to both direct and group chat", () => {
    for (const file of ["src/app/chat/[id].tsx", "src/app/group-chat/[id].tsx"]) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source).toContain("const [pendingMediaAssets, setPendingMediaAssets]");
      expect(source).toMatch(/confirmedAssets\s*\?\?\s*\(?await pickChatMedia\(\)\)?/u);
      expect(source).toContain("if (!confirmedAssets)");
      expect(source).toContain("<ChatMediaPickerPreview");
      expect(source).toContain("onSend={(items) => void chooseMedia(items)}");
    }
  });

  it("preserves the native multi-selection order and nine-item limit", () => {
    const source = fs.readFileSync(
      path.join(root, "src/services/native/NativeCapabilities.ts"),
      "utf8",
    );
    expect(source).toContain("allowsMultipleSelection: true");
    expect(source).toContain("orderedSelection: true");
    expect(source).toContain("selectionLimit: 9");
    expect(source).toContain('mediaTypes: ["images", "videos"]');
  });

  it("preserves every audited Swift layout constant and interaction", () => {
    const source = fs.readFileSync(
      path.join(root, "src/components/messages/ChatMediaPickerPreview.tsx"),
      "utf8",
    );
    for (const expected of [
      "columns: 3",
      "gridSpacing: 8",
      "gridPadding: 16",
      "cellRadius: 10",
      "videoThumbnailMaximumSize: 300",
      "videoBadgeIconSize: 11",
      "videoBadgeHorizontalPadding: 6",
      "videoBadgeVerticalPadding: 3",
      "videoBadgeInset: 6",
      "removeIconSize: 22",
      "removeInset: 4",
      "removeAnimationDurationMs: 200",
      "bottomHorizontalPadding: 16",
      "bottomVerticalPadding: 12",
      "sendHorizontalPadding: 24",
      "sendVerticalPadding: 10",
      "sendRadius: 20",
      "if (next.length === 0) onCancel()",
      "const selected = [...items]",
      "onCancel();",
      "onSend(selected);",
    ])
      expect(source).toContain(expected);
  });
});
