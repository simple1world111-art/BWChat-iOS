import {
  chatImagePresentationUrl,
  chatImagePresentationUrlFor,
} from "@/services/media/ChatImageSourcePolicy";

describe("chat image presentation source policy", () => {
  it("keeps timeline, gallery and save actions on the thumbnail projection", () => {
    expect(chatImagePresentationUrl(" /media/noise.jpg ", " /media/blue-thumbnail.jpg ")).toBe(
      "/media/blue-thumbnail.jpg",
    );
    expect(
      chatImagePresentationUrlFor({
        content: "/media/noise.jpg",
        thumbnail_url: "/media/blue-thumbnail.jpg",
      }),
    ).toBe("/media/blue-thumbnail.jpg");
  });

  it("falls back to the original when no usable thumbnail exists", () => {
    expect(chatImagePresentationUrl(" /media/original.jpg ")).toBe("/media/original.jpg");
    expect(chatImagePresentationUrl(" /media/original.jpg ", "   ")).toBe("/media/original.jpg");
  });
});
