import fs from "node:fs";
import path from "node:path";

import { isCurrentAgentChatOperation } from "@/app/agent-chat";

jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("expo-symbols", () => ({ SymbolView: () => null }));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }));
jest.mock("expo-image", () => ({ Image: Object.assign(() => null, { loadAsync: jest.fn() }) }));
jest.mock("@/components/AuthenticatedImage", () => ({ AuthenticatedImage: () => null }));
jest.mock("@/components/agents/AgentMessageView", () => ({ AgentMessageView: () => null }));
jest.mock("@/components/agents/AgentVideoRoleMatchDialog", () => ({
  AgentVideoRoleMatchDialog: () => null,
}));
jest.mock("@/components/media/ImageGallery", () => ({ ImageGallery: () => null }));
jest.mock("@/components/media/VideoPlayerOverlay", () => ({ VideoPlayerOverlay: () => null }));
jest.mock("@/components/messages/ChatReplyViews", () => ({
  ChatMessageActionOverlay: () => null,
}));
jest.mock("@/components/TopToast", () => ({ TopToast: () => null }));
jest.mock("@/services/media/MediaLibrarySaver", () => ({ saveRemoteMediaToLibrary: jest.fn() }));
jest.mock("@/services/monitoring/MonitoringService", () => ({ captureException: jest.fn() }));
jest.mock("@/services/live/useAgentLiveVideoMatch", () => ({
  useAgentLiveVideoMatch: () => ({ cancel: jest.fn(), reset: jest.fn() }),
}));

function source(): string {
  return fs.readFileSync(path.join(process.cwd(), "src/app/agent-chat.tsx"), "utf8");
}

describe("AgentChat account, route and operation isolation", () => {
  it("rejects wrong account, conversation and ABA generations", () => {
    expect(isCurrentAgentChatOperation("owner-a:c1", "owner-a:c1", 4, 4)).toBe(true);
    expect(isCurrentAgentChatOperation("owner-b:c1", "owner-a:c1", 4, 4)).toBe(false);
    expect(isCurrentAgentChatOperation("owner-a:c2", "owner-a:c1", 4, 4)).toBe(false);
    expect(isCurrentAgentChatOperation("owner-a:c1", "owner-a:c1", 6, 4)).toBe(false);
  });

  it("invalidates and clears every conversation-owned transient state on scope changes", () => {
    const screen = source();
    for (const statement of [
      "scopeGenerationRef.current += 1",
      "imagePreparationGenerationRef.current += 1",
      "expectedMediaTurnIdsRef.current.clear()",
      "discardAgentComposerImage(composerUri)",
      "lastSubmissionRef.current = null",
      "sendingRef.current = false",
      "openingSettingsRef.current = false",
      "creatingLatestVersionConversationRef.current = false",
      "latestVersionConversationIdempotencyRef.current = createIdempotencyKey()",
      "runtimeConfigRef.current = null",
      "setRuntimeConfig(null)",
      "videoRoleDialogGenerationRef.current += 1",
      "cancelVideoMatch()",
      "setComposerImage(null)",
      "setImageReplyTarget(null)",
      "setOptimisticText(null)",
      "setLastFailedSubmission(null)",
      "setVideoRoleDialog(null)",
    ]) {
      expect(screen).toContain(statement);
    }
  });

  it("invalidates every asynchronous operation again when the screen unmounts", () => {
    expect(source()).toMatch(
      /useEffect\(\s*\(\) => \(\) => \{\s*scopeGenerationRef\.current \+= 1;\s*imagePreparationGenerationRef\.current \+= 1;\s*pollGenerationRef\.current \+= 1;\s*unlockLifecycleRef\.current \+= 1;\s*videoRoleDialogGenerationRef\.current \+= 1;[\s\S]*?cancelVideoMatch\(\);/u,
    );
  });

  it("checks the original scope and generation after every page-owned await", () => {
    const screen = source();
    expect(screen.match(/isCurrentAgentChatOperation\(/gu)?.length).toBeGreaterThanOrEqual(12);
    expect(screen).toMatch(
      /loadAgentChatPage\(ownerId, conversationId\);\s+if \(!isCurrentLoad\(\)\) return;/u,
    );
    expect(screen).toMatch(
      /const result = await getAgentTurn\(turnId\);\s+if \(!isCurrentPoll\(\)\) return;/u,
    );
    expect(screen).toMatch(
      /const result = await getAgentTurn\(turnId\);\s+if \(!isCurrentResume\(\)\) return;/u,
    );
    expect(screen).toMatch(
      /const agent = await getAgent\(agentId\);\s+if \(!isCurrentSettings\(\)\) return;/u,
    );
    expect(screen).toMatch(
      /if \(ownerId\) await upsertCachedAgentConversation[\s\S]*?if \(!isCurrentCreation\(\)\) return;\s+router\.push/u,
    );
    expect(screen).toMatch(
      /const prepared = await prepareAgentComposerImage\(asset\.uri\);\s+if \(!isCurrentPreparation\(\)\)/u,
    );
    expect(screen).toMatch(
      /const prepared = await prepareAgentComposerImage\(target\.imagePath\);\s+if \(!isCurrentPreparation\(\)\)/u,
    );
    expect(screen).toMatch(
      /const result = isVideo\s*\? await saveVideoToLibrary\(mediaPath\)\s*: await saveImageToLibrary\(mediaPath\);\s+if \(\s*!isCurrentAgentChatOperation/u,
    );
    expect(screen).toMatch(
      /const currentSlot = await getCurrentLiveSlot\(\);\s+if \(!isCurrentRoleLoad\(generation\)\) return;/u,
    );
    expect(screen).toMatch(
      /const assetId = await uploadAgentChatImage[\s\S]*?if \(!isCurrentSend\(\)\) return;/u,
    );
    expect(screen).toMatch(
      /const accepted = await createAgentTurn[\s\S]*?if \(!isCurrentSend\(\)\) return;/u,
    );
  });

  it("guards old finally blocks so they cannot clear a new scope operation", () => {
    const screen = source();
    expect(screen).toMatch(
      /finally \{\s+if \(isCurrentPreparation\(\)\) setPreparingImage\(false\);/u,
    );
    expect(screen).toMatch(
      /finally \{\s+if \(isCurrentPreparation\(\)\) setLoadingReplyImage\(false\);/u,
    );
    expect(screen).toMatch(/finally \{\s+if \(isCurrentSettings\(\)\) \{/u);
    expect(screen).toMatch(/finally \{\s+if \(isCurrentCreation\(\)\) \{/u);
    expect(screen).toMatch(/finally \{\s+if \(isCurrentRoleLoad\(generation\)\) \{/u);
    expect(screen).toMatch(/finally \{\s+if \(isCurrentSend\(\)\) \{/u);
  });
});
