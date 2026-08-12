import {
  chatImageOriginalUrl,
  chatImageOriginalUrlFor,
  chatImageThumbnailUrl,
  chatImageThumbnailUrlFor,
} from "@/services/media/ChatImageSourcePolicy";

describe("chat image presentation source policy", () => {
  it("uses the thumbnail in the timeline and the original in full-screen/save surfaces", () => {
    expect(chatImageThumbnailUrl(" /media/original.jpg ", " /media/thumbnail.jpg ")).toBe(
      "/media/thumbnail.jpg",
    );
    expect(chatImageOriginalUrl(" /media/original.jpg ", " /media/thumbnail.jpg ")).toBe(
      "/media/original.jpg",
    );
    expect(
      chatImageThumbnailUrlFor({
        content: "/media/original.jpg",
        thumbnail_url: "/media/thumbnail.jpg",
      }),
    ).toBe("/media/thumbnail.jpg");
    expect(
      chatImageOriginalUrlFor({
        content: "/media/original.jpg",
        thumbnail_url: "/media/thumbnail.jpg",
      }),
    ).toBe("/media/original.jpg");
  });

  it("falls back in both directions for incomplete historical records", () => {
    expect(chatImageThumbnailUrl(" /media/original.jpg ")).toBe("/media/original.jpg");
    expect(chatImageThumbnailUrl(" /media/original.jpg ", "   ")).toBe("/media/original.jpg");
    expect(chatImageOriginalUrl("   ", " /media/thumbnail.jpg ")).toBe("/media/thumbnail.jpg");
    expect(chatImageOriginalUrl(" /media/original.jpg ", "   ")).toBe("/media/original.jpg");
  });
});
