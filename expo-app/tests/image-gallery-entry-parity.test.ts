import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("native ImagePreviewView entry parity", () => {
  it("locks the complete read-only native ImagePreviewView fact source", () => {
    const native = fs.readFileSync(
      "/Users/wegpt.com/Desktop/BWChat-Expo-HotUpdate/BWChat/Views/ImagePreviewView.swift",
    );
    expect(createHash("sha256").update(native).digest("hex")).toBe(
      "9b0a8f707861dbf4f7b0af0243341812ad4ebeda8992050154603803c18364be",
    );
  });

  it("routes direct and group chat images through the shared gallery with older pagination", () => {
    const bubble = source("src/components/messages/ChatImageBubble.tsx");
    const direct = source("src/app/chat/[id].tsx");
    const group = source("src/app/group-chat/[id].tsx");

    expect(bubble).toContain("<ImageGallerySource");
    expect(bubble).toContain("loadMoreOlder");
    expect(bubble).toContain("url: originalUrl");
    expect(bubble).toContain("chatImageThumbnailUrl(url, thumbnailUrl)");
    expect(direct).toContain("map(chatImageOriginalUrlFor)");
    expect(group).toContain("map(chatImageOriginalUrlFor)");
    expect(direct).toContain("saveImageToLibrary(chatImageOriginalUrlFor(message))");
    expect(group).toContain("saveImageToLibrary(chatImageOriginalUrlFor(message))");
    expect(direct).toContain("loadMoreGalleryImages={loadMoreGalleryImages}");
    expect(group).toContain("loadMoreGalleryImages={loadMoreGalleryImages}");
    expect(direct).toContain("<ImageGallery onClose=");
    expect(group).toContain("<ImageGallery onClose=");
  });

  it("routes unlocked Moment grids and comment images through the same Hero source", () => {
    const profileContent = source("src/components/profile/PublicProfileContent.tsx");
    expect(profileContent).toContain("sourceId={`moment-${moment.id}-media-${item.id}-${index}`}");
    expect(profileContent).toContain("sourceId={`comment-${comment.id}-image`}");
    expect(profileContent).toContain(
      "return <ImageGallery onClose={onClose} selection={selection} />",
    );
  });

  it("routes Agent input and unlocked paid images through shared gallery sources", () => {
    const agent = source("src/app/agent-chat.tsx");
    const message = source("src/components/agents/AgentMessageView.tsx");
    expect(message.match(/<ImageGallerySource/gu)).toHaveLength(2);
    expect(agent).toContain("galleryImagePaths={galleryImagePaths}");
    expect(message).toContain("onImageOpen={onImageOpen}");
    expect(message).toContain("images: galleryImages");
    expect(agent).toContain("agentGalleryImagePaths(messages)");
  });
});
