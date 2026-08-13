import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const copiedNativeRoot = resolve(expoRoot, "..");
const originalNativeRoot = "/Users/wegpt.com/Desktop/BWChat-Expo-HotUpdate";

describe("CreateMoment source parity", () => {
  it("locks every copied native source used by the page and durable upload state machine", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/CreateMomentView.swift":
        "1d57ef0c3eeb972b6e4a4af60a8ae49ad8456ac609ca6e3137c5a8603575c8bd",
      "BWChat/ViewModels/MomentsViewModel.swift":
        "dd376d1a5618073db2f69972c66c65e05a11c4590b9f770d958e955e21ae935d",
      "BWChat/Models/Moment.swift":
        "75814fd44cd59b1519dd2d6b3162f676008ac7f754eb3ea7957c85817b965b98",
      "BWChat/Services/APIService.swift":
        "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
      "BWChat/Services/BackgroundUploadCoordinator.swift":
        "eb08d47e191c583fb6315d266406da84a52dba73f8be2e47b66898a0b1b49fd9",
      "BWChat/Components/MediaPickerPreview.swift":
        "08f18a46a8675b5a62fa3916167542c711c3489b08bd07e9dacf5eea5e983e5e",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      expect(createHash("sha256").update(sourceCopiedNative(relativePath)).digest("hex")).toBe(
        expected,
      );
      expect(createHash("sha256").update(sourceOriginalNative(relativePath)).digest("hex")).toBe(
        expected,
      );
    }
  });

  it("preserves editor, grid, price and toolbar geometry at the 95-98 percent target", () => {
    const native = sourceNative("BWChat/Views/CreateMomentView.swift");
    const expo = sourceExpo("src/app/create-moment.tsx");
    for (const contract of [
      ".padding(.horizontal, 16)",
      ".padding(.top, 14)",
      ".frame(height: 190)",
      ".padding(.horizontal, 22)",
      ".padding(.top, 18)",
      ".padding(.bottom, 28)",
      ".padding(.trailing, 20)",
      ".padding(.bottom, 14)",
      "min(96, floor((UIScreen.main.bounds.width - 32 - 36 - 20) / 3))",
      "VStack(alignment: .leading, spacing: 10)",
      ".frame(height: 64)",
      ".frame(width: 36, height: 36)",
    ]) {
      expect(native).toContain(contract);
    }
    for (const contract of [
      "paddingHorizontal: 16",
      "paddingTop: 14",
      "height: 236",
      "paddingHorizontal: 22",
      "paddingTop: 18",
      "paddingBottom: 28",
      "right: 20",
      "bottom: 14",
      "Math.min(96, Math.floor((width - 32 - 36 - 20) / 3))",
      "gap: 10",
      "height: 64",
      "width: 36",
      "height: 36",
    ]) {
      expect(expo).toContain(contract);
    }
  });

  it("matches selection-stage durability, bounded image prep and persistent video first frame", () => {
    const native = sourceNative("BWChat/Views/CreateMomentView.swift");
    const preparation = sourceExpo("src/services/moments/MomentMediaPreparation.ts");
    const page = sourceExpo("src/app/create-moment.tsx");
    for (const contract of [
      "APIService.compressImageForUpload(data)",
      "maxDimension: 360",
      'filename: "preview_video.jpg"',
      "maximumSize = CGSize(width: 320, height: 320)",
      "OutgoingFileStore.stage",
      "OutgoingFileStore.removeJob",
    ]) {
      expect(native).toContain(contract);
    }
    for (const contract of [
      "uploadMaximumDimension: 1_200",
      "uploadJPEGQuality: 0.7",
      "uploadTargetBytes: 2_000_000",
      "imagePreviewMaximumDimension: 360",
      "videoPreviewMaximumDimension: 320",
      "previewJPEGQuality: 0.82",
      'new File(directory, "preview_video.jpg")',
      "createVideoPlayer",
      "generateThumbnailsAsync",
      "removeTemporaryFile",
      "Native accepts a video even when AVAsset cannot produce a first frame",
    ]) {
      expect(preparation).toContain(contract);
    }
    expect(preparation).toContain("Preserve publishability for arbitrary source sizes");
    expect(preparation).not.toContain("图片压缩后仍超过");
    expect(page).toContain("prepareMomentImage(ownerId");
    expect(page).toContain("prepareMomentVideo(");
    expect(page).toContain("removeMomentDraft(ownerId");
    expect(page).toContain("onTouchStart={Keyboard.dismiss}");
  });

  it("uses native background URLSession semantics and every exact backend field", () => {
    const nativeApi = sourceNative("BWChat/Services/APIService.swift");
    const nativeBackground = sourceNative("BWChat/Services/BackgroundUploadCoordinator.swift");
    const transport = sourceExpo("src/services/moments/MomentBackgroundUpload.ts");
    const queue = sourceExpo("src/services/moments/MomentUploadQueue.ts");
    expect(nativeApi).toContain('path: "/moments/create"');
    expect(nativeApi).toContain('name: "content"');
    expect(nativeApi).toContain('name: "client_request_id"');
    expect(nativeApi).toContain('name: "unlock_price_gold_coins"');
    expect(nativeApi).toContain('name: "media"');
    expect(nativeApi).toContain(
      'request.setValue(job.clientRequestID, forHTTPHeaderField: "Idempotency-Key")',
    );
    expect(nativeApi).toContain("? 600 : 180");
    expect(nativeBackground).toContain("URLSessionConfiguration.background");
    expect(nativeBackground).toContain("configuration.sessionSendsLaunchEvents = true");
    expect(transport).toContain('sessionType: "background"');
    expect(transport).toContain('name="media"');
    expect(transport).toContain("momentMultipartFields(input)");
    expect(transport).toContain('{ name: "content", value: input.content }');
    expect(transport).toContain('{ name: "client_request_id", value: input.clientRequestId }');
    expect(transport).toContain('"unlock_price_gold_coins"');
    expect(transport).toContain('"Idempotency-Key": safeHeaderValue(clientRequestId)');
    expect(transport).toContain("decodeSuccessfulPayload<unknown>(payload, status, true, true)");
    expect(queue).toContain("? 600_000");
    expect(queue).toContain(": 180_000");
  });

  it("keeps confirmation-unknown, five attempts, account isolation and local cache adoption", () => {
    const native = sourceNative("BWChat/ViewModels/MomentsViewModel.swift");
    const queue = sourceExpo("src/services/moments/MomentUploadQueue.ts");
    const transport = sourceExpo("src/services/moments/MomentBackgroundUpload.ts");
    const bootstrap = sourceExpo("src/components/MomentUploadBootstrap.tsx");
    expect(native).toContain("$0.state == .confirmationUnknown");
    expect(native).toContain("job.attemptCount < 5");
    expect(native).toContain("min(pow(2, Double(job.attemptCount)), 30)");
    expect(queue).toContain('state: "confirmation_unknown"');
    expect(queue).toContain("preparing.attempt_count < 5");
    expect(queue).toContain("momentRetryDelayMilliseconds");
    expect(queue).toContain("encodeURIComponent(ownerId)");
    expect(queue).toContain("adoptLocalImageFile");
    expect(queue).toContain("adoptLocalMediaFile");
    expect(queue).toContain("error instanceof MomentUploadOwnerChangedError");
    expect(queue).toContain("momentUploadOwnerChangedPatch(job.attempt_count)");
    expect(queue).toContain("momentUploadRuntimeKey(job.owner_id, job.id)");
    expect(queue).toContain("resumeParkedOwnerJob(preparing.owner_id, preparing.id)");
    expect(transport).toContain("MomentUploadConfirmationUnknownError");
    expect(transport).toContain("momentBackgroundUploadRuntimeKey(ownerId, clientRequestId)");
    expect(transport).toContain("momentUploadTimeoutMilliseconds(");
    expect(transport).not.toContain("body.parentDirectory");
    expect(transport.match(/assertMomentUploadOwner\(/gu)).toHaveLength(4);
    expect(transport).toContain("(await readCachedUser())?.user_id");
    expect(bootstrap).toContain("BackgroundTask.registerTaskAsync");
    expect(bootstrap).toContain("readCachedUser");
  });

  it("remounts drafts by owner and blocks stale picker and navigation continuations", () => {
    const page = sourceExpo("src/app/create-moment.tsx");
    expect(page).toContain("key={ownerId}");
    expect(page).toContain("isOwnerCurrent={() => currentOwnerIdRef.current === ownerId}");
    expect(page).toContain("if (!isDraftCurrent() || result.canceled) return;");
    expect(page).toContain("if (isDraftCurrent()) router.back();");
    expect(page).toContain("const publishDisabled = !canPublish || isPublishing;");
  });

  it("enters as the native modal and inserts new moments only into the recommended context", () => {
    const feed = sourceExpo("src/app/moments.tsx");
    const layout = sourceExpo("src/app/_layout.tsx");
    const native = sourceNative("BWChat/ViewModels/MomentsViewModel.swift");
    expect(feed).toContain('router.push("/create-moment")');
    expect(layout).toMatch(/name="create-moment"[\s\S]*?presentation: "modal"/u);
    expect(native).toMatch(
      /private func insertMomentIntoPublicTabs[\s\S]*?\.tab\(\.recommended\)/u,
    );
    expect(feed).toContain("momentMutationTabs(isMyMoments, mutation)");
    expect(sourceExpo("src/services/moments/MomentFeedRepository.ts")).toContain(
      'isMyMoments || mutation.kind === "created"',
    );
    expect(feed).toContain("persistTab(tab, next[tab]).catch(() => undefined)");
  });

  it("copies no invented bitmap assets because the original page uses only SF Symbols and picks", () => {
    const native = sourceNative("BWChat/Views/CreateMomentView.swift");
    const expo = sourceExpo("src/app/create-moment.tsx");
    expect(native).toContain("PhotosPicker");
    expect(native).toContain('Image(systemName: "paperplane.fill")');
    expect(native).toContain('icon: "photo.on.rectangle.angled"');
    expect(native).toContain('icon: "video.fill"');
    expect(expo).toContain('name="paperplane.fill"');
    expect(expo).toContain('icon="photo.on.rectangle.angled"');
    expect(expo).toContain('icon="video.fill"');
    expect(expo).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
  });

  it("keeps every CreateMoment string identical in all ten native languages", () => {
    const languages = ["de", "en", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-Hans", "zh-Hant"];
    const keys = [
      "common.back",
      "common.cancel",
      "common.delete",
      "common.publish",
      "moment.addImage",
      "moment.addVideo",
      "moment.content.placeholder",
      "moment.continueAddImage",
      "moment.create.title",
      "moment.goldCoinUnlock",
      "moment.media.error.loadFailed",
      "moment.media.error.mixedTypes",
      "moment.media.error.tooManyImages",
      "moment.media.error.tooManyVideos",
      "moment.media.limitHint",
      "moment.unlock.none",
      "moment.unlock.price",
    ];
    for (const language of languages) {
      const native = sourceNative(`BWChat/${language}.lproj/Localizable.strings`);
      const expo = JSON.parse(sourceExpo(`src/localization/generated/${language}.json`)) as Record<
        string,
        string
      >;
      for (const key of keys) {
        expect(expo[key]).toBe(nativeLocalizedValue(native, key));
      }
    }
  });
});

function sourceExpo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function sourceNative(relativePath: string): string {
  return sourceCopiedNative(relativePath);
}

function sourceCopiedNative(relativePath: string): string {
  return readFileSync(resolve(copiedNativeRoot, relativePath), "utf8");
}

function sourceOriginalNative(relativePath: string): string {
  return readFileSync(resolve(originalNativeRoot, relativePath), "utf8");
}

function nativeLocalizedValue(source: string, key: string): string {
  const escapedKey = key.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^"${escapedKey}"\\s*=\\s*"((?:\\\\.|[^"])*)";`, "mu"));
  if (!match?.[1]) throw new Error(`Missing native localization key: ${key}`);
  return JSON.parse(`"${match[1]}"`) as string;
}
