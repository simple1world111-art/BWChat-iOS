import { resolveMediaUrl } from "@/utils/mediaUrl";

describe("resolveMediaUrl", () => {
  const base = "http://52.193.78.191/api/v1";

  it("keeps absolute HTTP URLs", () => {
    expect(resolveMediaUrl("https://cdn.example.com/a.png", base)).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  it("keeps durable local outbox URLs for optimistic media", () => {
    expect(resolveMediaUrl("file:///documents/outbox/a.jpg", base)).toBe(
      "file:///documents/outbox/a.jpg",
    );
    expect(resolveMediaUrl("content://picker/video/1", base)).toBe(
      "content://picker/video/1",
    );
  });

  it("resolves legacy API-root paths", () => {
    expect(resolveMediaUrl("/api/v1/images/a.png", base)).toBe(
      "http://52.193.78.191/api/v1/images/a.png",
    );
  });

  it("resolves paths relative to the configured API", () => {
    expect(resolveMediaUrl("avatars/a.png", base)).toBe(
      "http://52.193.78.191/api/v1/avatars/a.png",
    );
  });
});
