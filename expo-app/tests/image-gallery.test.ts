import fs from "node:fs";
import path from "node:path";

import {
  aspectFitRect,
  clampGalleryOffset,
  dedupeGalleryUrls,
  galleryDismissDecision,
  galleryPanBounds,
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
  rubberBandGalleryOffset,
  shouldLoadGalleryPage,
} from "@/components/media/imageGalleryMath";
import {
  mediaPullBackdropOpacity,
  mediaPullContentOpacity,
  mediaPullDismissScale,
  mediaPullHasVerticalIntent,
  mediaPullVisualTranslation,
  MEDIA_PULL_DISMISS_DISTANCE,
  MEDIA_PULL_DISMISS_DURATION_MS,
  MEDIA_PULL_FLICK_VELOCITY,
  MEDIA_PULL_MINIMUM_FLICK_DISTANCE,
  MEDIA_PULL_RESTORE_DURATION_MS,
  MEDIA_PULL_VERTICAL_DIRECTION_RATIO,
  MEDIA_PULL_VISUAL_DEAD_ZONE,
} from "@/components/media/mediaPullDismissMath";

describe("native image gallery contracts", () => {
  it("keeps the native zoom and direction-lock constants", () => {
    expect(GALLERY_MINIMUM_SCALE).toBe(0.5);
    expect(GALLERY_MAXIMUM_SCALE).toBe(5);
    expect(GALLERY_REST_SCALE_LIMIT).toBe(1.05);
    expect(GALLERY_DOUBLE_TAP_SCALE).toBe(2.5);
    expect(GALLERY_VERTICAL_DIRECTION_RATIO).toBe(MEDIA_PULL_VERTICAL_DIRECTION_RATIO);
    expect(GALLERY_VISUAL_DEAD_ZONE).toBe(MEDIA_PULL_VISUAL_DEAD_ZONE);
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
    expect(GALLERY_DISMISS_DISTANCE).toBe(MEDIA_PULL_DISMISS_DISTANCE);
    expect(GALLERY_MINIMUM_FLICK_DISTANCE).toBe(MEDIA_PULL_MINIMUM_FLICK_DISTANCE);
    expect(GALLERY_FLICK_VELOCITY).toBe(MEDIA_PULL_FLICK_VELOCITY);
    expect(galleryDismissDecision(71, 899)).toBe(0);
    expect(galleryDismissDecision(72, 0)).toBe(1);
    expect(galleryDismissDecision(-72, 0)).toBe(-1);
    expect(galleryDismissDecision(28, 900)).toBe(1);
    expect(galleryDismissDecision(-28, -900)).toBe(-1);
    expect(galleryDismissDecision(27, 2_000)).toBe(0);
  });

  it("shares one pull-to-dismiss visual contract with full-screen video", () => {
    expect(MEDIA_PULL_RESTORE_DURATION_MS).toBe(160);
    expect(MEDIA_PULL_DISMISS_DURATION_MS).toBe(240);
    expect(mediaPullHasVerticalIntent(10, 11.2)).toBe(false);
    expect(mediaPullHasVerticalIntent(10, 11.21)).toBe(true);
    expect(mediaPullVisualTranslation(17)).toBe(0);
    expect(mediaPullVisualTranslation(18)).toBe(0);
    expect(mediaPullVisualTranslation(19)).toBe(1);
    expect(mediaPullVisualTranslation(-19)).toBe(-1);
    expect(mediaPullBackdropOpacity(320)).toBe(0.25);
    expect(mediaPullDismissScale(800, 800)).toBe(0.78);
    expect(mediaPullContentOpacity(576, 800)).toBe(0);

    const gallerySource = fs.readFileSync(
      path.join(process.cwd(), "src/components/media/ImageGallery.tsx"),
      "utf8",
    );
    expect(gallerySource).toContain("mediaPullVisualTranslation(event.translationY)");
    expect(gallerySource).toContain("mediaPullBackdropOpacity(verticalDrag.value)");
    expect(gallerySource).toContain("duration: MEDIA_PULL_RESTORE_DURATION_MS");
    expect(gallerySource).toContain("duration: MEDIA_PULL_DISMISS_DURATION_MS");
  });

  it("keeps the dismiss decision executable on the gesture UI thread", () => {
    const mathSource = fs.readFileSync(
      path.join(process.cwd(), "src/components/media/imageGalleryMath.ts"),
      "utf8",
    );
    expect(mathSource).toMatch(
      /function galleryDismissDecision\([^)]*\)[^{]*\{\s*["']worklet["'];/u,
    );
    const sharedMathSource = fs.readFileSync(
      path.join(process.cwd(), "src/components/media/mediaPullDismissMath.ts"),
      "utf8",
    );
    for (const functionName of [
      "mediaPullDismissDecision",
      "mediaPullVisualTranslation",
      "mediaPullBackdropOpacity",
      "mediaPullDismissScale",
      "mediaPullContentOpacity",
    ]) {
      expect(sharedMathSource).toMatch(
        new RegExp(`function ${functionName}\\([^)]*\\)[^{]*\\{\\s*["']worklet["'];`, "u"),
      );
    }
  });

  it("computes centered aspect-fit Hero frames", () => {
    expect(
      aspectFitRect({ width: 200, height: 100 }, { x: 10, y: 20, width: 100, height: 100 }),
    ).toEqual({ x: 10, y: 45, width: 100, height: 50 });
  });

  it("bounds zoomed image movement using the visible aspect-fit rect", () => {
    const fitted = { x: 0, y: 250, width: 390, height: 300 };
    expect(galleryPanBounds(fitted, { width: 390, height: 800 }, 1)).toEqual({ x: 0, y: 0 });
    expect(galleryPanBounds(fitted, { width: 390, height: 800 }, 3)).toEqual({ x: 390, y: 50 });
    expect(clampGalleryOffset(430, 390)).toBe(390);
    expect(clampGalleryOffset(-430, 390)).toBe(-390);
    expect(rubberBandGalleryOffset(430, 390)).toBeCloseTo(402.8);
    expect(rubberBandGalleryOffset(-430, 390)).toBeCloseTo(-402.8);
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
