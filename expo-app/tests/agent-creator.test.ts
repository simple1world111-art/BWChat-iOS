import * as ImageManipulator from "expo-image-manipulator";

import {
  createAgent,
  createAgentConversation,
  getAgent,
  installAgent,
  publishAgent,
  uninstallAgent,
  updateAgentDraft,
  uploadAgentReference,
} from "@/api/bwchat";
import { APIError, apiRequest } from "@/api/client";
import type { AgentSummary } from "@/models";
import {
  clearPendingAgentForEditing,
  notifyAgentUpdated,
  pendingAgentForEditing,
  rememberAgentForEditing,
  subscribeAgentUpdates,
} from "@/services/agents/AgentEditNavigationStore";
import {
  agentCreatorPolicy,
  agentCreatorErrorCode,
  agentCreatorErrorMessage,
  agentCreatorValues,
  agentPatchPayload,
  agentReferenceCompressionPolicy,
  canSaveAgent,
  commaSeparated,
  createAgentPayload,
  defaultAgentCreatorValues,
  makeAgentReferencePreview,
  prepareAgentReferenceForUpload,
  removeAgentCreatorTemporaryFile,
  validAgentReferenceDimensions,
} from "@/services/agents/agentCreatorPolicy";

const mockAgentReferenceFileSizes = new Map<string, number | null>();
const mockDeletedAgentReferenceFiles: string[] = [];

jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  manipulateAsync: jest.fn(),
}));

jest.mock("expo-file-system", () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    uri,
    size: mockAgentReferenceFileSizes.has(uri) ? mockAgentReferenceFileSizes.get(uri) : 0,
    exists: true,
    delete: () => mockDeletedAgentReferenceFiles.push(uri),
  })),
}));

jest.mock("@/api/client", () => ({
  ...jest.requireActual<typeof import("@/api/client")>("@/api/client"),
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);

describe("native AgentCreatorView contracts", () => {
  beforeEach(() => {
    request.mockReset();
    jest.mocked(ImageManipulator.manipulateAsync).mockReset();
    mockAgentReferenceFileSizes.clear();
    mockDeletedAgentReferenceFiles.length = 0;
  });

  it("keeps reference-image geometry, validation, compression and upload constants", () => {
    expect(agentCreatorPolicy).toMatchObject({
      referenceSize: 64,
      referenceRadius: 12,
      referenceStrokeWidth: 1,
      referenceRowSpacing: 14,
      referenceCopySpacing: 5,
      referenceTitleSize: 15,
      referenceDetailSize: 12,
      referenceSymbolSize: 22,
      sectionHeaderSize: 14,
      errorSize: 13,
      minimumReferenceShortSide: 512,
      minimumReferenceRatio: 0.5,
      maximumReferenceRatio: 2,
      pickerJpegQuality: 0.92,
      uploadMaximumDimension: 1600,
      uploadInitialQuality: 0.82,
      uploadMaximumBytes: 2_000_000,
      uploadTimeoutMilliseconds: 90_000,
      apiTimeoutMilliseconds: 30_000,
      defaultRequestTimeoutMilliseconds: 60_000,
      conversationTimeoutMilliseconds: 15_000,
      uploadFieldName: "image",
      uploadFilename: "agent-reference.jpg",
      uploadMimeType: "image/jpeg",
    });
    expect(agentReferenceCompressionPolicy).toEqual({
      dimensions: [1600, 1200, 900, 675, 640],
      qualities: [0.82, 0.65, 0.55, 0.45, 0.35],
    });
    expect(validAgentReferenceDimensions(512, 1024)).toBe(true);
    expect(validAgentReferenceDimensions(1024, 512)).toBe(true);
    expect(validAgentReferenceDimensions(511, 1024)).toBe(false);
    expect(validAgentReferenceDimensions(512, 1025)).toBe(false);
  });

  it("normalizes the picker image to the native 0.92 JPEG preview", async () => {
    jest.mocked(ImageManipulator.manipulateAsync).mockResolvedValueOnce({
      uri: "file:///preview.jpg",
      width: 1_200,
      height: 900,
    });
    await expect(makeAgentReferencePreview("file:///picker.heic")).resolves.toBe(
      "file:///preview.jpg",
    );
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith("file:///picker.heic", [], {
      compress: 0.92,
      format: "jpeg",
    });
  });

  it("keeps an eligible prepared JPEG and otherwise follows the native resize/quality ladder", async () => {
    mockAgentReferenceFileSizes.set("file:///eligible.jpg", 1_900_000);
    await expect(prepareAgentReferenceForUpload("file:///eligible.jpg", 1_200, 900)).resolves.toBe(
      "file:///eligible.jpg",
    );
    expect(ImageManipulator.manipulateAsync).not.toHaveBeenCalled();

    mockAgentReferenceFileSizes.set("file:///large.jpg", 4_000_000);
    mockAgentReferenceFileSizes.set("file:///q82.jpg", 2_100_000);
    mockAgentReferenceFileSizes.set("file:///q65.jpg", 1_950_000);
    jest
      .mocked(ImageManipulator.manipulateAsync)
      .mockResolvedValueOnce({ uri: "file:///q82.jpg", width: 1_600, height: 1_200 })
      .mockResolvedValueOnce({ uri: "file:///q65.jpg", width: 1_600, height: 1_200 });

    await expect(prepareAgentReferenceForUpload("file:///large.jpg", 4_000, 3_000)).resolves.toBe(
      "file:///q65.jpg",
    );
    expect(ImageManipulator.manipulateAsync).toHaveBeenNthCalledWith(
      1,
      "file:///large.jpg",
      [{ resize: { width: 1_600 } }],
      { compress: 0.82, format: "jpeg" },
    );
    expect(ImageManipulator.manipulateAsync).toHaveBeenNthCalledWith(
      2,
      "file:///large.jpg",
      [{ resize: { width: 1_600 } }],
      { compress: 0.65, format: "jpeg" },
    );
  });

  it("falls through all 1600/1200/900/675/640 JPEG candidates when the byte cap is unmet", async () => {
    mockAgentReferenceFileSizes.set("file:///large.jpg", 4_000_000);
    const candidates = Array.from({ length: 25 }, (_, index) => `file:///candidate-${index}.jpg`);
    for (const uri of candidates) mockAgentReferenceFileSizes.set(uri, 2_100_000);
    jest.mocked(ImageManipulator.manipulateAsync).mockImplementation(async () => ({
      uri: candidates[jest.mocked(ImageManipulator.manipulateAsync).mock.calls.length - 1]!,
      width: 640,
      height: 640,
    }));

    await expect(prepareAgentReferenceForUpload("file:///large.jpg", 3_000, 4_000)).resolves.toBe(
      candidates[24],
    );
    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledTimes(25);
    expect(
      jest.mocked(ImageManipulator.manipulateAsync).mock.calls.map(([_, actions, options]) => ({
        dimension:
          actions?.[0] && "resize" in actions[0]
            ? (actions[0].resize as { height?: number }).height
            : undefined,
        quality: options?.compress,
      })),
    ).toEqual(
      [1600, 1200, 900, 675, 640].flatMap((dimension) =>
        [0.82, 0.65, 0.55, 0.45, 0.35].map((quality) => ({ dimension, quality })),
      ),
    );
  });

  it("treats an unknown byte size as unsafe and removes only generated compression files", async () => {
    mockAgentReferenceFileSizes.set("file:///unknown-size.jpg", null);
    mockAgentReferenceFileSizes.set("file:///too-large.jpg", 2_100_000);
    mockAgentReferenceFileSizes.set("file:///accepted.jpg", 1_900_000);
    jest
      .mocked(ImageManipulator.manipulateAsync)
      .mockResolvedValueOnce({ uri: "file:///too-large.jpg", width: 1_200, height: 900 })
      .mockResolvedValueOnce({ uri: "file:///accepted.jpg", width: 1_200, height: 900 });

    await expect(
      prepareAgentReferenceForUpload("file:///unknown-size.jpg", 1_200, 900),
    ).resolves.toBe("file:///accepted.jpg");
    expect(mockDeletedAgentReferenceFiles).toEqual(["file:///too-large.jpg"]);
    expect(mockDeletedAgentReferenceFiles).not.toContain("file:///unknown-size.jpg");

    removeAgentCreatorTemporaryFile("file:///accepted.jpg");
    expect(mockDeletedAgentReferenceFiles).toEqual([
      "file:///too-large.jpg",
      "file:///accepted.jpg",
    ]);
  });

  it("preserves all native defaults and save-gating rules", () => {
    expect(defaultAgentCreatorValues).toEqual({
      name: "",
      tagline: "",
      descriptionText: "",
      tagsText: "companion",
      language: "zh-CN",
      visibility: "private",
      identity: "",
      personalityText: "温暖, 细心",
      toneStyle: "warm",
      replyLength: "medium",
      relationshipType: "companion",
      addressStyle: "natural",
      adultEnabled: false,
      intimacyStyle: "romantic",
      initiative: "responsive",
      greeting: "你好",
      paidImages: true,
    });
    const complete = { ...defaultAgentCreatorValues, name: " 伙伴 ", greeting: " 你好 " };
    expect(canSaveAgent(complete, false, false, false)).toBe(false);
    expect(canSaveAgent(complete, false, true, false)).toBe(true);
    expect(canSaveAgent(complete, true, false, false)).toBe(true);
    expect(canSaveAgent(complete, true, false, true)).toBe(false);
  });

  it("builds the exact trimmed draft and fixed capability definition", () => {
    const values = {
      ...defaultAgentCreatorValues,
      name: " 伙伴 ",
      tagline: " 温暖陪伴 ",
      descriptionText: " 背景描述 ",
      tagsText: " companion， 温暖, ,细心 ",
      identity: " 身份 ",
      personalityText: "温暖， 细心",
      addressStyle: " 亲爱的 ",
      greeting: " 你好呀 ",
      adultEnabled: true,
      paidImages: false,
    };
    expect(commaSeparated(values.tagsText)).toEqual(["companion", "温暖", "细心"]);
    const payload = agentPatchPayload(values, {
      referenceAssetId: "reference-1",
      avatarAssetId: "avatar-1",
    });
    expect(payload).toEqual({
      name: "伙伴",
      tagline: "温暖陪伴",
      description: "背景描述",
      tags: ["companion", "温暖", "细心"],
      language: "zh-CN",
      visibility: "private",
      primary_reference_asset_id: "reference-1",
      avatar_asset_id: "avatar-1",
      definition: {
        identity: "身份",
        personality: ["温暖", "细心"],
        tone: { style: "warm", reply_length: "medium" },
        relationship: { type: "companion", address_style: " 亲爱的 " },
        intimacy: { adult_enabled: true, style: "romantic", initiative: "responsive" },
        greetings: [{ id: "default", text: "你好呀" }],
        example_dialogues: [],
        visual_identity: { description: "背景描述" },
        capabilities: {
          paid_images: false,
          paid_videos: false,
          stickers: false,
          platform_rewards: false,
          proactive_messages: false,
        },
      },
    });
    expect(createAgentPayload(values, "reference-1", "avatar-1")).toEqual(payload);
  });

  it("populates edit values with definition-first and summary fallbacks", () => {
    const agent = makeAgent({
      visibility: "public",
      profile: {
        name: "伙伴",
        tagline: "tagline",
        description: "description",
        tags: ["a", "b"],
        language: "ja",
      },
      capabilities: { paid_images: false, paid_videos: false },
      greetings: [{ id: "summary", text: "摘要开场" }],
      definition: {
        identity: "身份",
        personality: ["活泼"],
        tone: { style: "playful", reply_length: "long" },
        relationship: { type: "girlfriend", address_style: "主人" },
        intimacy: { adult_enabled: true, style: "sensual", initiative: "proactive" },
        greetings: [{ id: "default", text: "定义开场" }],
        capabilities: { paid_images: true, paid_videos: false },
      },
    });
    expect(agentCreatorValues(agent)).toMatchObject({
      name: "伙伴",
      tagsText: "a, b",
      language: "ja",
      visibility: "public",
      identity: "身份",
      personalityText: "活泼",
      toneStyle: "playful",
      replyLength: "long",
      relationshipType: "girlfriend",
      addressStyle: "主人",
      adultEnabled: true,
      intimacyStyle: "sensual",
      initiative: "proactive",
      greeting: "定义开场",
      paidImages: true,
    });
  });

  it("passes the complete installed summary into the edit route without a blank form flash", () => {
    const agent = makeAgent({ definition: { identity: "身份" } });
    rememberAgentForEditing(agent, "owner-1");
    expect(pendingAgentForEditing("another-agent", "owner-1")).toBeNull();
    expect(pendingAgentForEditing("agent-1", "owner-2")).toBeNull();
    expect(pendingAgentForEditing("agent-1", "owner-1")).toBe(agent);
    clearPendingAgentForEditing("agent-1", "owner-2");
    expect(pendingAgentForEditing("agent-1", "owner-1")).toBe(agent);
    clearPendingAgentForEditing("agent-1", "owner-1");
    expect(pendingAgentForEditing("agent-1", "owner-1")).toBeNull();
  });

  it("notifies the open chat with the installed profile returned after editing", () => {
    const updates: AgentSummary[] = [];
    const unsubscribe = subscribeAgentUpdates((agent) => updates.push(agent));
    const installed = makeAgent({ profile: { name: "更新后的伙伴", avatar_asset_id: "avatar-2" } });
    notifyAgentUpdated(installed);
    unsubscribe();
    notifyAgentUpdated(makeAgent({ profile: { name: "不应投递" } }));
    expect(updates).toEqual([installed]);
  });

  it("uploads the exact JPEG multipart field with retained idempotency and timeout", async () => {
    request.mockResolvedValueOnce({
      primary_reference_asset_id: "reference-1",
      avatar_asset_id: "avatar-1",
    });
    await expect(uploadAgentReference("file:///reference.heic", "upload-key")).resolves.toEqual({
      primary_reference_asset_id: "reference-1",
      avatar_asset_id: "avatar-1",
    });
    expect(request).toHaveBeenCalledWith("/agent-assets/reference-images", {
      method: "POST",
      headers: { "Idempotency-Key": "upload-key" },
      body: expect.any(FormData),
      timeoutMs: 90_000,
      requiredData: true,
      requiredEnvelope: true,
      transientRetries: false,
    });
    const form = request.mock.calls[0]?.[1]?.body as FormData;
    expect(form.has("image")).toBe(true);
  });

  it("uses exact get/create/revision-patch/publish routes, bodies, keys and 30s timeouts", async () => {
    const response = makeAgent({
      definition: {
        identity: "身份",
        capabilities: { paid_images: true, paid_videos: false },
      },
    });
    request
      .mockResolvedValueOnce({ agent: response })
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ agent_id: "agent-1", version_number: "2", status: "published" })
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ conversation: makeConversation() })
      .mockResolvedValueOnce(undefined);

    await expect(getAgent("agent/1")).resolves.toMatchObject({
      id: "agent-1",
      definition: { identity: "身份", capabilities: { paid_images: true } },
    });
    const payload = createAgentPayload(
      { ...defaultAgentCreatorValues, name: "伙伴" },
      "reference-1",
      "avatar-1",
    );
    await createAgent(payload, "create-key");
    await updateAgentDraft("agent/1", 7, payload);
    await expect(publishAgent("agent/1", "publish-key")).resolves.toMatchObject({
      agent_id: "agent-1",
      version_number: 2,
      status: "published",
    });
    await expect(installAgent("agent/1")).resolves.toMatchObject({ id: "agent-1" });
    await expect(
      createAgentConversation("agent/1", "greeting-1", "conversation-key"),
    ).resolves.toMatchObject({ id: "conversation-1", agent_id: "agent-1" });
    await uninstallAgent("agent/1");

    expect(request.mock.calls).toEqual([
      ["/agents/agent%2F1", { requiredData: true, requiredSuccessCode: true, timeoutMs: 60_000 }],
      [
        "/agents",
        {
          method: "POST",
          headers: { "Idempotency-Key": "create-key" },
          body: payload,
          timeoutMs: 30_000,
          requiredData: true,
          transientRetries: false,
        },
      ],
      [
        "/agents/agent%2F1/draft",
        {
          method: "PATCH",
          body: { expected_revision: 7, patch: payload },
          timeoutMs: 30_000,
          requiredData: true,
        },
      ],
      [
        "/agents/agent%2F1/publish",
        {
          method: "POST",
          headers: { "Idempotency-Key": "publish-key" },
          body: {},
          timeoutMs: 30_000,
          requiredData: true,
          requiredEnvelope: true,
          transientRetries: false,
        },
      ],
      [
        "/agents/agent%2F1/install",
        { method: "POST", body: {}, requiredData: true, timeoutMs: 60_000 },
      ],
      [
        "/agent-conversations",
        {
          method: "POST",
          headers: { "Idempotency-Key": "conversation-key" },
          body: { agent_id: "agent/1", greeting_id: "greeting-1" },
          requiredData: true,
          timeoutMs: 15_000,
          transientRetries: false,
        },
      ],
      [
        "/agents/agent%2F1/install",
        { method: "DELETE", requiredEnvelope: true, timeoutMs: 60_000 },
      ],
    ]);
  });

  it("accepts every native AgentSummaryRemoteResponse container and extracts conflict codes", async () => {
    request
      .mockResolvedValueOnce({ draft: makeAgent() })
      .mockResolvedValueOnce({ item: makeAgent() })
      .mockResolvedValueOnce(makeAgent());
    await expect(getAgent("draft")).resolves.toMatchObject({ id: "agent-1" });
    await expect(getAgent("item")).resolves.toMatchObject({ id: "agent-1" });
    await expect(getAgent("direct")).resolves.toMatchObject({ id: "agent-1" });
    expect(agentCreatorErrorCode(new APIError("conflict", 200, undefined, 6002))).toBe(6002);
    expect(agentCreatorErrorCode({ payload: { code: "6002" } })).toBe(6002);
    expect(agentCreatorErrorCode({ payload: { detail: { code: 6002 } } })).toBe(6002);
    expect(agentCreatorErrorCode({ payload: { error: { code: "6002" } } })).toBe(6002);
    expect(agentCreatorErrorCode({ payload: { data: { error_code: 6002 } } })).toBe(6002);
    expect(
      agentCreatorErrorMessage(
        new APIError("请求失败（409）", 409, {
          detail: { code: 6002, message: "revision conflict" },
        }),
      ),
    ).toBe("revision conflict");
    expect(
      agentCreatorErrorMessage(
        new APIError("服务暂时不可用，请稍后重试", 503, {
          message: "internal trace must stay hidden",
        }),
      ),
    ).toBe("服务暂时不可用，请稍后重试");
  });

  it("retains or recovers the requested identity for nested editable agent details", async () => {
    request
      .mockResolvedValueOnce({
        agent_id: "agent-outer",
        draft: { revision: 8, profile: { name: "外层身份" } },
      })
      .mockResolvedValueOnce({
        draft: { revision: 9, profile: { name: "路由身份" } },
      });

    await expect(getAgent("agent-outer")).resolves.toMatchObject({
      id: "agent-outer",
      revision: 8,
      profile: { name: "外层身份" },
    });
    await expect(getAgent("agent-route")).resolves.toMatchObject({
      id: "agent-route",
      revision: 9,
      profile: { name: "路由身份" },
    });
  });
});

function makeAgent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: "agent-1",
    revision: 7,
    profile: { name: "伙伴" },
    ...overrides,
  };
}

function makeConversation() {
  return {
    id: "conversation-1",
    title: "伙伴",
    status: "active",
    agent_id: "agent-1",
    agent_version_id: "version-1",
    agent_profile: { name: "伙伴" },
    agent_capabilities: { paid_images: false, paid_videos: false },
    created_at: "2026-08-08T00:00:00Z",
    updated_at: "2026-08-08T00:00:00Z",
  };
}
