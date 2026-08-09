import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const copiedNativeRoot = resolve(expoRoot, "..");

describe("Moments visual source parity", () => {
  it("locks the native Moments view and owner-scoped view model", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/MomentsView.swift":
        "a840ea4a35566b8ff0fa14e924f9fb4e2074f0fa3385a039066a4012808a7e55",
      "BWChat/ViewModels/MomentsViewModel.swift":
        "dd376d1a5618073db2f69972c66c65e05a11c4590b9f770d958e955e21ae935d",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      expect(createHash("sha256").update(native(relativePath)).digest("hex")).toBe(expected);
    }
  });

  it("keeps cover chrome light while matching the native icon-only toolbar", () => {
    const screen = expo("src/app/moments.tsx");
    expect(screen).toContain('<StatusBar style="light" />');
    expect(screen).toContain("headerBackVisible: false");
    expect(screen).toContain("headerTintColor: colors.white");
    expect(screen).toContain("headerLeft: () => (");
    expect(screen).toContain('name="chevron.left"');
    expect(screen).toContain('resizeMode="center"');
    expect(screen).toContain('colorScheme="dark"');
    expect(screen).not.toContain("setCoverChrome");
  });

  it("matches the visible 270pt hero and the offset 76pt overlay avatar", () => {
    const screen = expo("src/app/moments.tsx");
    for (const contract of [
      "coverBackdrop: { height: 270",
      "bottom: 14",
      "width: 76",
      "height: 76",
      "top: -1.5",
      "borderWidth: 3",
      "borderRadius: 17.5",
      'backgroundColor: "rgba(255,255,255,0.08)"',
    ]) {
      expect(screen).toContain(contract);
    }
    expect(screen).not.toContain("top: -10");
    expect(screen).not.toContain("padding: 3");
  });

  it("keeps native feed spacing, intrinsic text metrics and compact social pills", () => {
    const content = expo("src/components/profile/PublicProfileContent.tsx");
    for (const contract of [
      "paddingHorizontal: 16",
      "paddingVertical: 14",
      "columnGap: 12",
      "rowGap: 8",
      "singleMediaGrid: { paddingTop: 1 }",
      'maxWidth: "100%"',
      'alignSelf: "flex-start"',
      "likesText: { flexShrink: 1",
      'name="ellipsis" size={15}',
    ]) {
      expect(content).toContain(contract);
    }
    expect(content).not.toContain("fontSize: 15, lineHeight: 20");
  });

  it("retains every Moments mutation and authenticated-media route", () => {
    const screen = expo("src/app/moments.tsx");
    const content = expo("src/components/profile/PublicProfileContent.tsx");
    for (const contract of [
      "getMomentsWorld(options)",
      "getMomentsFollowing(options)",
      "getUserMoments(filterUserId, options)",
      "toggleMomentLike(moment.id)",
      "addMomentComment(momentId, text",
      "deleteMoment(momentId)",
      "unlockMoment(moment.id, mediaType, key)",
      "subscribeMomentMutation(ownerId",
      "subscribeMomentUploads(ownerId",
    ]) {
      expect(screen).toContain(contract);
    }
    expect(content).toContain("<AuthenticatedImage");
    expect(content).toContain("<ImageGallerySource");
    expect(content).toContain("<VideoPlayerOverlay");
  });
});

function expo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function native(relativePath: string): Buffer {
  return readFileSync(resolve(copiedNativeRoot, relativePath));
}
