import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("chat media picker source parity", () => {
  it("sends the system picker's result immediately in both direct and group chat", () => {
    for (const file of ["src/app/chat/[id].tsx", "src/app/group-chat/[id].tsx"]) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source).toContain("const assets = await pickChatMedia();");
      expect(source).toContain('asset.type === "image" || asset.type === "video"');
      expect(source).toContain("const jobs = supportedAssets.map");
      expect(source).toContain("startChatMediaUploadsAfterOptimisticRender");
      expect(source.indexOf("setMessages((current)")).toBeLessThan(
        source.lastIndexOf("startChatMediaUploadsAfterOptimisticRender("),
      );
      expect(source).not.toContain("pendingMediaAssets");
      expect(source).not.toContain("ChatMediaPickerPreview");
      expect(source).not.toContain("confirmedAssets");
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
    expect(source).toContain("UIImagePickerPreferredAssetRepresentationMode.Current");
    expect(source).toContain("VideoExportPreset.Passthrough");
    expect(source).toContain("quality: 1");
  });

  it("matches the native Swift select-then-send flow", () => {
    for (const file of ["../BWChat/Views/ChatView.swift", "../BWChat/Views/GroupChatView.swift"]) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source).toContain("prepareOutgoingMediaDrafts");
      expect(source).toContain("sendMediaBatch(drafts)");
    }
  });
});
