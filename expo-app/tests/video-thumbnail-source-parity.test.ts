import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("native VideoThumbnailView parity", () => {
  const root = resolve(__dirname, "..");
  const native = readFileSync(
    resolve(root, "../BWChat/Components/VideoThumbnailView.swift"),
    "utf8",
  );
  const expo = readFileSync(resolve(root, "src/components/messages/ChatVideoBubble.tsx"), "utf8");

  it("preserves the placeholder, play indicator and frame chrome", () => {
    expect(native).toContain('Image(systemName: "video.fill")');
    expect(native).toContain("Color.black.opacity(0.42)");
    expect(native).toContain(".frame(width: 44, height: 44)");
    expect(native).toContain("size: 17, weight: .bold");
    expect(native).toContain("lineWidth: 0.5");
    expect(expo).toContain('name="video.fill" size={24}');
    expect(expo).toContain('backgroundColor: "rgba(0,0,0,0.42)"');
    expect(expo).toContain("width: 44");
    expect(expo).toContain('name="play.fill" size={17} weight="bold"');
    expect(expo).toContain("borderWidth: 0.5");
  });

  it("preserves zero-time 600px local thumbnail generation and cancellation", () => {
    expect(native).toContain("maximumSize = CGSize(width: 600, height: 600)");
    expect(native).toContain("copyCGImage(at: .zero");
    expect(native).toContain("guard !Task.isCancelled, requestedVideoURL == videoURL");
    expect(expo).toContain("generateThumbnailsAsync(0, { maxWidth: 600, maxHeight: 600 })");
    expect(expo).toContain("if (!active)");
    expect(expo).toContain("generated.release()");
  });

  it("keeps the source's no-transition behavior and adopted cache path", () => {
    expect(native).toContain("transaction.animation = nil");
    expect(expo).toContain("transition={0}");
    const outbox = readFileSync(resolve(root, "src/services/messages/ChatVideoOutbox.ts"), "utf8");
    expect(outbox).toContain("adoptLocalImageFile(thumbnailSource, keys)");
    expect(outbox).toContain(
      "confirmed.thumbnail_url?.trim() || chatVideoThumbnailPath(remoteUrl)",
    );
  });

  it("is wired into both direct and group message timelines", () => {
    for (const path of ["src/app/chat/[id].tsx", "src/app/group-chat/[id].tsx"] as const) {
      const source = readFileSync(resolve(root, path), "utf8");
      expect(source).toContain("<ChatVideoBubble");
      expect(source).toContain("thumbnailUrl={message.thumbnail_url}");
    }
  });
});
