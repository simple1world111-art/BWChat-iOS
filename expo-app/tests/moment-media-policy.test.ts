import type { Moment, MomentMedia } from "@/models";
import {
  momentFeedPreviewUrls,
  momentMediaFeedDisplayUrl,
} from "@/services/moments/MomentMediaPolicy";

const media = (overrides: Partial<MomentMedia> = {}): MomentMedia => ({
  id: "media-1",
  type: "image",
  url: "https://cdn.example/original.jpg",
  thumbnail_url: "https://cdn.example/thumb.jpg",
  locked_preview_url: "https://cdn.example/locked.jpg",
  is_locked: false,
  ...overrides,
});

const moment = (overrides: Partial<Moment> = {}): Moment => ({
  id: 1,
  author: { user_id: "author", nickname: "Author", avatar_url: "" },
  content: "",
  images: [],
  media: [media()],
  unlock_price_gold_coins: 0,
  is_unlocked: true,
  created_at: "2026-08-11T00:00:00Z",
  likes: [],
  comments: [],
  liked_by_me: false,
  ...overrides,
});

describe("moment media feed policy", () => {
  it("prefers a thumbnail in the feed while retaining an original fallback", () => {
    expect(momentMediaFeedDisplayUrl(media(), false)).toBe("https://cdn.example/thumb.jpg");
    expect(momentMediaFeedDisplayUrl(media({ thumbnail_url: undefined }), false)).toBe(
      "https://cdn.example/original.jpg",
    );
  });

  it("does not prefetch paid originals for a locked viewer", () => {
    const paid = moment({ unlock_price_gold_coins: 10, is_unlocked: false });
    expect(momentFeedPreviewUrls([paid], "viewer")).toEqual(["https://cdn.example/locked.jpg"]);
    expect(momentFeedPreviewUrls([paid], "author")).toEqual(["https://cdn.example/thumb.jpg"]);
  });

  it("caps speculative prefetch work", () => {
    const many = moment({
      media: Array.from({ length: 8 }, (_, index) =>
        media({ id: String(index), thumbnail_url: `https://cdn.example/${index}.jpg` }),
      ),
    });
    expect(momentFeedPreviewUrls([many], "viewer", 3)).toEqual([
      "https://cdn.example/0.jpg",
      "https://cdn.example/1.jpg",
      "https://cdn.example/2.jpg",
    ]);
  });
});
