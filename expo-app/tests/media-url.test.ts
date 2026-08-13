import { resolveMediaUrl } from "@/utils/mediaUrl";

describe("resolveMediaUrl", () => {
  const base = "http://52.193.78.191/api/v1";

  it("keeps absolute HTTP URLs", () => {
    expect(resolveMediaUrl("https://cdn.example.com/a.png", base)).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  it("upgrades known legacy API media when the configured API uses HTTPS", () => {
    expect(
      resolveMediaUrl(
        "http://52.193.78.191/api/v1/avatars/a.png?revision=2",
        "https://id7.com/api/v1",
      ),
    ).toBe("https://id7.com/api/v1/avatars/a.png?revision=2");
    expect(resolveMediaUrl("http://id7.com/assets/a.png", "https://id7.com/api/v1")).toBe(
      "https://id7.com/assets/a.png",
    );
    expect(
      resolveMediaUrl(
        "https://52.193.78.191/api/v1/images/a.mp4?revision=3",
        "https://id7.com/api/v1",
      ),
    ).toBe("https://id7.com/api/v1/images/a.mp4?revision=3");
  });

  it("rejects unapproved cleartext media when the configured API uses HTTPS", () => {
    expect(resolveMediaUrl("http://untrusted.example/avatar.png", "https://id7.com/api/v1")).toBe(
      null,
    );
  });

  it("keeps durable local outbox URLs for optimistic media", () => {
    expect(resolveMediaUrl("file:///documents/outbox/a.jpg", base)).toBe(
      "file:///documents/outbox/a.jpg",
    );
    expect(resolveMediaUrl("content://picker/video/1", base)).toBe("content://picker/video/1");
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
