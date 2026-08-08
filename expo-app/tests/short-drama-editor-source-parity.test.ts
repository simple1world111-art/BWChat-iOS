import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const originalRoot = "/Users/wegpt.com/Desktop/BWChat-iOS/BWChat";
const copiedRoot = resolve(expoRoot, "..", "BWChat");

describe("ShortDramaUnifiedEditor native/Expo source parity", () => {
  it.each([
    "Views/ShortDramaUnifiedEditorView.swift",
    "Services/APIService.swift",
    "Services/BackgroundUploadCoordinator.swift",
  ])("keeps the copied Swift fact source byte-identical: %s", (relativePath) => {
    expect(readFileSync(resolve(copiedRoot, relativePath))).toEqual(
      readFileSync(resolve(originalRoot, relativePath)),
    );
  });

  it("locks the native editor's persistent job, two-wide episode upload and submit transaction", () => {
    const swift = source(originalRoot, "Views/ShortDramaUnifiedEditorView.swift");
    expect(swift).toContain("scene: .shortDrama");
    expect(swift).toContain('role: "episode:\\(episode.id.uuidString)"');
    expect(swift).toContain("by: 2");
    expect(swift).toContain("submitShortDramaSeries(");
    expect(swift).toContain("$0.state == .confirmationUnknown");
    expect(swift).toContain("MediaCacheManager.shared.adoptLocalFile(");
  });

  it("locks route/method/auth/body/multipart/timeout/idempotency/wrapper consumption", () => {
    const swiftAPI = source(originalRoot, "Services/APIService.swift");
    const transport = source(expoRoot, "src/services/short-drama/ShortDramaBackgroundUpload.ts");
    const nativeModule = source(
      expoRoot,
      "modules/bwchat-background-upload/ios/BWChatBackgroundUploadModule.swift",
    );
    const queue = source(expoRoot, "src/services/short-drama/ShortDramaUploadQueue.ts");

    for (const field of [
      "title",
      "intro",
      "episode_number",
      "client_episode_id",
      "client_series_id",
      "unlock_price_gold_coins",
    ]) {
      expect(swiftAPI).toContain(`name: "${field}"`);
      expect(nativeModule).toContain(`"${field}"`);
    }
    expect(swiftAPI).toContain(
      'path: "/short-drama/series/\\(Self.pathComponent(seriesID))/episodes"',
    );
    expect(swiftAPI).toContain(
      'request.setValue(job.clientRequestID, forHTTPHeaderField: "Idempotency-Key")',
    );
    expect(swiftAPI).toContain("timeout: 600");
    expect(transport).toContain("decodeSuccessfulPayload<unknown>");
    expect(transport).toContain("normalizeShortDramaEpisodeUploadResult");
    expect(nativeModule).toContain('request.httpMethod = "POST"');
    expect(nativeModule).toContain("request.timeoutInterval = 600");
    expect(nativeModule).toContain('forHTTPHeaderField: "Authorization"');
    expect(nativeModule).toContain('forHTTPHeaderField: "Idempotency-Key"');
    expect(queue).toContain("maximumConcurrentEpisodeUploads");
    expect(queue).toContain("submitShortDramaSeries(series.series_id, job.id)");
  });

  it("persists background task identity and recovers all ambiguous/failure states after termination", () => {
    const original = source(originalRoot, "Services/BackgroundUploadCoordinator.swift");
    const nativeModule = source(
      expoRoot,
      "modules/bwchat-background-upload/ios/BWChatBackgroundUploadModule.swift",
    );
    const moduleConfig = source(
      expoRoot,
      "modules/bwchat-background-upload/expo-module.config.json",
    );
    const provider = source(
      expoRoot,
      "ios/Pods/Target Support Files/Pods-BBchatdevelopment/ExpoModulesProvider.swift",
    );

    for (const token of [
      "sessionSendsLaunchEvents = true",
      "waitsForConnectivity = true",
      "httpMaximumConnectionsPerHost = 2",
      "confirmationUnknown",
      "retryWaiting",
      "failedPermanent",
      "taskDescription",
      "getAllTasks",
    ]) {
      expect(original).toContain(token);
    }
    for (const token of [
      "sessionSendsLaunchEvents = true",
      "waitsForConnectivity = true",
      "httpMaximumConnectionsPerHost = 2",
      "confirmationUnknown",
      "retryWaiting",
      "failedPermanent",
      "task.taskDescription",
      "getAllTasks",
      "response_body_base64",
    ]) {
      expect(nativeModule).toContain(token);
    }
    expect(moduleConfig).toContain("BWChatBackgroundUploadAppDelegateSubscriber");
    expect(provider).toContain("BWChatBackgroundUploadModule.self");
    expect(provider).toContain("BWChatBackgroundUploadAppDelegateSubscriber.self");
  });

  it("keeps media takeover owner-scoped and does not reintroduce the removed airplane product", () => {
    const queue = source(expoRoot, "src/services/short-drama/ShortDramaUploadQueue.ts");
    const moduleTree = [
      queue,
      source(expoRoot, "src/services/short-drama/ShortDramaBackgroundUpload.ts"),
      source(expoRoot, "modules/bwchat-background-upload/ios/BWChatBackgroundUploadModule.swift"),
    ].join("\n");
    expect(queue).toContain("shortDramaMediaCacheId(video.id)");
    expect(queue).toContain("adoptLocalMediaFile({");
    expect(queue).toContain("adoptLocalImageFile(");
    expect(queue).toContain("ownerId,");
    expect(moduleTree).not.toMatch(/飞机|airplane|flight_plane|flight-layer/iu);
  });
});

function source(root: string, relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}
