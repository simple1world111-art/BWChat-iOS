import fs from "node:fs";
import path from "node:path";

import {
  galleryOwnerCacheKey,
  galleryOwnerSourceId,
  isCurrentGalleryOperation,
  prependGalleryUrlsAtLatestIndex,
} from "@/components/media/imageGalleryMath";

function source(): string {
  return fs.readFileSync(path.join(process.cwd(), "src/components/media/ImageGallery.tsx"), "utf8");
}

describe("ImagePreview owner and lifecycle isolation", () => {
  it("rejects account changes, stale generations, stale operations and ABA returns", () => {
    expect(isCurrentGalleryOperation("a", "a", 4, 4, 8, 8)).toBe(true);
    expect(isCurrentGalleryOperation("b", "a", 4, 4, 8, 8)).toBe(false);
    expect(isCurrentGalleryOperation("a", "a", 6, 4, 8, 8)).toBe(false);
    expect(isCurrentGalleryOperation("a", "a", 4, 4, 9, 8)).toBe(false);
  });

  it("prepends around the response-time latest page instead of the request-time page", () => {
    expect(
      prependGalleryUrlsAtLatestIndex(["b.jpg", "c.jpg", "d.jpg", "e.jpg"], ["a.jpg", "b.jpg"], 3),
    ).toEqual({
      images: ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"],
      added: 1,
      currentIndex: 4,
    });
  });

  it("scopes source and authenticated cache identities by owner", () => {
    expect(galleryOwnerSourceId("owner/a", "message-1")).toBe("owner/a\u0000message-1");
    expect(galleryOwnerSourceId("owner/b", "message-1")).not.toBe(
      galleryOwnerSourceId("owner/a", "message-1"),
    );
    expect(galleryOwnerCacheKey("owner/a", "https://api.test/media/a.jpg")).toBe(
      "https://api.test/media/a.jpg?bwchat_gallery_owner=owner%2Fa",
    );
    expect(galleryOwnerCacheKey("owner/b", "https://api.test/media/a.jpg")).not.toBe(
      galleryOwnerCacheKey("owner/a", "https://api.test/media/a.jpg"),
    );
  });

  it("closes synchronously-rendered content on owner change and invalidates on unmount", () => {
    const gallery = source();
    expect(gallery).toContain("const ownerAtOpen = useRef(ownerId).current");
    expect(gallery).toContain("if (!isCurrentOwner) return null");
    expect(gallery).toMatch(
      /ownerIdRef\.current = "";\s+lifecycleGenerationRef\.current \+= 1;\s+paginationOperationRef\.current \+= 1;\s+saveOperationRef\.current \+= 1;\s+dismissOperationRef\.current \+= 1;/u,
    );
    expect(gallery).toContain('sourceOwnerIdRef.current = ""');
  });

  it("guards pagination/save responses and old finally blocks", () => {
    const gallery = source();
    expect(gallery).toContain("latestPageIndexRef.current");
    expect(gallery).toContain("prependGalleryUrlsAtLatestIndex(");
    expect(gallery).toMatch(/\.then\(\(older\) => \{\s+if \(!isCurrentPagination\(\)\) return;/u);
    expect(gallery).toMatch(
      /\.finally\(\(\) => \{\s+if \(isCurrentPagination\(\)\) loadMoreBusy\.current = false;/u,
    );
    expect(gallery).toMatch(
      /const result = await saveImageToLibrary\(mediaPath\);\s+if \(!isCurrentSave\(\)\) return;/u,
    );
    expect(gallery).toContain("runOnJS(finishClose)(");
    expect(
      gallery.match(/sourceCacheKey=\{galleryOwnerCacheKey\(/gu)?.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("animates fallback open and every non-Hero close backdrop instead of flashing the modal", () => {
    const gallery = source();
    expect(gallery).toContain("const openProgress = useSharedValue(0)");
    expect(gallery).toContain("const backdropOpacity = useSharedValue(0)");
    expect(gallery).toContain("const contentOpacity = useSharedValue(0)");
    expect(gallery).toMatch(/const duration = 180;\s+openProgress\.value = withTiming\(0,/u);
    expect(gallery).toMatch(/backdropOpacity\.value = withTiming\(\s+0,/u);
  });

  it("preserves the source and waits for a displayed page before handing off the Hero", () => {
    const gallery = source();
    expect(gallery).not.toContain("setActiveSourceId(");
    expect(gallery).not.toContain("hiddenSource");
    expect(gallery).toContain("onShow={() => setPresented(true)}");
    expect(gallery).toContain("isPresented={isPresented}");
    expect(gallery).toContain("const initialPageReady = useSharedValue(0)");
    expect(gallery).toContain("useAnimatedReaction(");
    expect(gallery).toContain(
      "onDisplay={item === initialImageUri ? markInitialPageReady : undefined}",
    );
    expect(gallery).not.toContain("sourceMask");
    expect(gallery).toContain("const heroOpacity = useSharedValue(sourceFrame ? 1 : 0)");
    expect(gallery).toContain(
      "borderRadius: interpolate(openProgress.value, [0, 1], [selection.sourceCornerRadius ?? 14, 14])",
    );
    expect(gallery).toMatch(/contentOpacity\.value = 1;\s+heroOpacity\.value = withTiming\(0,/u);
    expect(gallery).toMatch(
      /const canReturnToSource =\s+Boolean\(sourceFrame\)[\s\S]*?heroOpacity\.value = 1;\s+contentOpacity\.value = withTiming\(0,/u,
    );
    expect(gallery).not.toContain("verticalDrag.value = withTiming(0, { duration: 70 })");
  });

  it("opens on the first tap without serial measurement or animation delays", () => {
    const gallery = source();
    expect(gallery).toContain("onPressIn={handlePressIn}");
    expect(gallery).toContain("pressedSourceFrameRef.current");
    expect(gallery).toContain("SOURCE_FRAME_MEASURE_FALLBACK_MS = 34");
    expect(gallery).toContain("if (!source) {");
    expect(gallery).toContain("open();");
    expect(gallery).toContain("HERO_OPEN_DURATION_MS = 280");
    expect(gallery).toContain("BACKDROP_OPEN_DURATION_MS = 120");
    expect(gallery).toMatch(
      /backdropOpacity\.value = withTiming\(1,[\s\S]*?openProgress\.value = withTiming\(1,/u,
    );
    expect(gallery).not.toMatch(/openProgress\.value = withDelay\(\s*72,/u);
    expect(gallery).not.toContain("const animationFrame = requestAnimationFrame");
  });

  it("keeps the swipe continuation and current-page fade off the JS and wide-strip paths", () => {
    const gallery = source();
    expect(gallery).not.toContain("runOnJS(beginDismiss)(decision)");
    expect(gallery).toContain("runOnJS(prepareSwipeDismiss)()");
    expect(gallery).toMatch(
      /const targetY = decision < 0 \? -height : height;[\s\S]*?verticalDrag\.value = withSpring\([\s\S]*?runOnJS\(finishSwipeDismissPart\)\(\)/u,
    );
    expect(gallery).toMatch(
      /const stripStyle = useAnimatedStyle\(\(\) => \(\{\s+transform: \[\{ translateX: pageOffset\.value \}\],[\s\S]*?const currentImageStyle[\s\S]*?opacity: contentOpacity\.value \* dragOpacity,/u,
    );
    expect(gallery).toContain("if (swipeDismissCompletedPartsRef.current < 2) return");
    expect(gallery).toMatch(/backdropOpacity\.value = withTiming\([\s\S]*?finishSwipeDismissPart/u);
  });
});
