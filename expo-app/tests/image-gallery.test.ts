import {
  aspectFitRect,
  dedupeGalleryUrls,
  galleryDismissDecision,
  GALLERY_DISMISS_DISTANCE,
  GALLERY_DOUBLE_TAP_SCALE,
  GALLERY_FLICK_VELOCITY,
  GALLERY_MAXIMUM_SCALE,
  GALLERY_MINIMUM_FLICK_DISTANCE,
  GALLERY_MINIMUM_SCALE,
  GALLERY_REST_SCALE_LIMIT,
  GALLERY_VERTICAL_DIRECTION_RATIO,
  GALLERY_VISUAL_DEAD_ZONE,
  initialGalleryIndex,
  prependUniqueGalleryUrls,
  shouldLoadGalleryPage,
} from "@/components/media/imageGalleryMath";

describe("native image gallery contracts", () => {
  it("keeps the native zoom and direction-lock constants", () => {
    expect(GALLERY_MINIMUM_SCALE).toBe(0.5);
    expect(GALLERY_MAXIMUM_SCALE).toBe(5);
    expect(GALLERY_REST_SCALE_LIMIT).toBe(1.05);
    expect(GALLERY_DOUBLE_TAP_SCALE).toBe(2.5);
    expect(GALLERY_VERTICAL_DIRECTION_RATIO).toBe(1.12);
    expect(GALLERY_VISUAL_DEAD_ZONE).toBe(18);
  });

  it("deduplicates stably and remaps the selected URL", () => {
    const original = [" a.jpg ", "b.jpg", "a.jpg", "", "c.jpg"];
    const deduped = dedupeGalleryUrls(original);
    expect(deduped).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(initialGalleryIndex(original, deduped, 2)).toBe(0);
    expect(initialGalleryIndex(original, deduped, 4)).toBe(2);
    expect(initialGalleryIndex(original, deduped, -1)).toBe(0);
    expect(initialGalleryIndex(original, deduped, 99)).toBe(0);
    expect(initialGalleryIndex(["a.jpg", "   ", "c.jpg"], deduped, 1)).toBe(0);
  });

  it("uses the native distance and flick dismiss thresholds", () => {
    expect(GALLERY_DISMISS_DISTANCE).toBe(72);
    expect(GALLERY_MINIMUM_FLICK_DISTANCE).toBe(28);
    expect(GALLERY_FLICK_VELOCITY).toBe(900);
    expect(galleryDismissDecision(71, 899)).toBe(0);
    expect(galleryDismissDecision(72, 0)).toBe(1);
    expect(galleryDismissDecision(-72, 0)).toBe(-1);
    expect(galleryDismissDecision(28, 900)).toBe(1);
    expect(galleryDismissDecision(-28, -900)).toBe(-1);
    expect(galleryDismissDecision(27, 2_000)).toBe(0);
  });

  it("computes centered aspect-fit Hero frames", () => {
    expect(
      aspectFitRect({ width: 200, height: 100 }, { x: 10, y: 20, width: 100, height: 100 }),
    ).toEqual({ x: 10, y: 45, width: 100, height: 50 });
  });

  it("prepends only stable unique older URLs without remounting existing URL identities", () => {
    expect(prependUniqueGalleryUrls(["b.jpg", "c.jpg"], ["a.jpg", "a.jpg", "b.jpg"])).toEqual({
      images: ["a.jpg", "b.jpg", "c.jpg"],
      added: 1,
    });
  });

  it("decodes only the current page and its immediate neighbours", () => {
    expect([0, 1, 2, 3, 4].filter((index) => shouldLoadGalleryPage(index, 2))).toEqual([1, 2, 3]);
  });
});
