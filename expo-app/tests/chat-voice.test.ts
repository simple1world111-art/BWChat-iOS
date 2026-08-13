import { sendDirectVoiceMessage, sendGroupVoiceMessage } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  chatVoiceBubbleWidth,
  chatVoiceBubblePolicy,
  chatVoiceRecordingPolicy,
  chatVoiceRecordingVisualPolicy,
  formatChatVoiceRecordingDuration,
  formatChatVoiceUploadDuration,
  parseChatVoiceContent,
  resolveChatVoicePlaybackUrl,
} from "@/services/messages/chatVoicePolicy";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client") as object;
  return { ...actual, apiRequest: jest.fn() };
});
jest.mock("expo-file-system", () => ({
  File: class MockFile {
    bytes() {
      return Promise.resolve(new Uint8Array([86, 79, 73, 67, 69]));
    }
  },
}));

const NativeFormData = jest.requireActual("react-native/Libraries/Network/FormData")
  .default as typeof FormData;
const { installFormDataPatch } = jest.requireActual("expo/src/winter/FormData") as {
  installFormDataPatch(formData: typeof FormData): typeof FormData;
};
const { convertFormDataAsync } = jest.requireActual("expo/src/winter/fetch/convertFormData") as {
  convertFormDataAsync(
    formData: FormData,
    boundary?: string,
  ): Promise<{ body: Uint8Array; boundary: string }>;
};

const request = jest.mocked(apiRequest);
const StandardFormData = global.FormData;

describe("native chat voice contracts", () => {
  beforeAll(() => {
    global.FormData = installFormDataPatch(NativeFormData);
  });

  afterAll(() => {
    global.FormData = StandardFormData;
  });

  beforeEach(() => request.mockReset());

  it("parses the original URL|duration payload and 80-200pt width", () => {
    expect(parseChatVoiceContent("/api/v1/voice/a.m4a|12.75")).toEqual({
      url: "/api/v1/voice/a.m4a",
      duration: 12.75,
    });
    expect(parseChatVoiceContent("broken")).toEqual({ url: "broken", duration: 0 });
    expect(chatVoiceBubbleWidth(0)).toBe(80);
    expect(chatVoiceBubbleWidth(1)).toBe(88);
    expect(chatVoiceBubbleWidth(15)).toBe(200);
    expect(chatVoiceBubbleWidth(999)).toBe(200);
    expect(chatVoiceBubblePolicy).toMatchObject({
      horizontalPadding: 12,
      verticalPadding: 10,
      cornerRadius: 18,
      contentSpacing: 6,
      durationFontSize: 14,
      waveBarWidth: 2,
      waveBarSpacing: 2,
      idleWaveHeights: [6, 10, 6],
      playingWaveHeights: [8, 14, 10],
    });
  });

  it("keeps the native recorder, duration and origin-resolution policy", () => {
    expect(chatVoiceRecordingPolicy).toMatchObject({
      extension: ".m4a",
      sampleRate: 22_050,
      numberOfChannels: 1,
      minimumDurationSeconds: 1,
      cancelTranslationY: -80,
      uploadTimeoutMilliseconds: 60_000,
    });
    expect(formatChatVoiceUploadDuration(1.26)).toBe("1.3");
    expect(formatChatVoiceRecordingDuration(65.9)).toBe("1:05");
    expect(chatVoiceRecordingVisualPolicy).toMatchObject({
      cancelTransitionMilliseconds: 150,
      overlayOpacity: 0.6,
      overlaySpacing: 24,
      circleSize: 100,
      cancelCircleScale: 1.1,
      circleTransitionMilliseconds: 200,
      timerFontSize: 48,
      hintFontSize: 15,
      hintBottomPadding: 120,
      recordingWaveBarWidth: 4,
      recordingWaveBarSpacing: 4,
      recordingWaveHeights: [16, 24, 32, 24, 16],
    });
    expect(resolveChatVoicePlaybackUrl("/api/v1/voices/a.m4a", "https://example.com/api/v1")).toBe(
      "https://example.com/api/v1/voices/a.m4a",
    );
    expect(resolveChatVoicePlaybackUrl("file:///voice.m4a", "https://example.com/api/v1")).toBe(
      "file:///voice.m4a",
    );
  });

  it("uploads direct voice with receiver, one-decimal duration and audio/m4a", async () => {
    request.mockResolvedValueOnce({
      id: 21,
      sender_id: "me",
      receiver_id: "friend",
      msg_type: "voice",
      content: "/voice/direct.m4a|4.2",
    });
    await sendDirectVoiceMessage("friend", voiceInput(4.24));
    expect(request).toHaveBeenCalledWith("/chat/messages/voice", {
      method: "POST",
      body: expect.any(FormData),
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
    });
    const form = request.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("receiver_id")).toBe("friend");
    expect(form.get("duration")).toBe("4.2");
    expectExpoByteBackedVoice(form.get("voice"));
    await expectExpoSerializableVoiceMultipart(form);
    expect(form.has("client_message_id")).toBe(false);
  });

  it("uploads group voice without inventing receiver or client identity", async () => {
    request.mockResolvedValueOnce({
      id: 22,
      group_id: 31,
      sender_id: "me",
      msg_type: "voice",
      content: "/voice/group.m4a|7.8",
    });
    await sendGroupVoiceMessage(31, voiceInput(7.84));
    expect(request).toHaveBeenCalledWith("/groups/31/messages/voice", {
      method: "POST",
      body: expect.any(FormData),
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
    });
    const form = request.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("duration")).toBe("7.8");
    expectExpoByteBackedVoice(form.get("voice"));
    await expectExpoSerializableVoiceMultipart(form);
    expect(form.has("receiver_id")).toBe(false);
    expect(form.has("client_message_id")).toBe(false);
  });

  it("makes a retried voice upload idempotent when the caller supplies its outbox identity", async () => {
    request.mockResolvedValueOnce({
      id: 23,
      sender_id: "me",
      receiver_id: "friend",
      msg_type: "voice",
      content: "/voice/direct.m4a|4.2",
    });
    await sendDirectVoiceMessage("friend", voiceInput(4.24), "voice-job-23");
    expect(request).toHaveBeenCalledWith(
      "/chat/messages/voice",
      expect.objectContaining({ headers: { "Idempotency-Key": "voice-job-23" } }),
    );
    const form = request.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("client_message_id")).toBe("voice-job-23");
  });

  it("uses the same optional outbox identity for a retried group voice upload", async () => {
    request.mockResolvedValueOnce({
      id: 24,
      group_id: 31,
      sender_id: "me",
      msg_type: "voice",
      content: "/voice/group.m4a|7.8",
    });
    await sendGroupVoiceMessage(31, voiceInput(7.84), "group-voice-job-24");
    expect(request).toHaveBeenCalledWith(
      "/groups/31/messages/voice",
      expect.objectContaining({ headers: { "Idempotency-Key": "group-voice-job-24" } }),
    );
    const form = request.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("client_message_id")).toBe("group-voice-job-24");
    expect(form.has("receiver_id")).toBe(false);
  });

  it("does not show a voice message as sent without a canonical server record", async () => {
    request.mockResolvedValueOnce({ id: 0, msg_type: "voice", content: "" });
    await expect(sendDirectVoiceMessage("friend", voiceInput(4.24))).rejects.toMatchObject({
      code: "unconfirmed_media_message",
      status: 502,
    });

    request.mockResolvedValueOnce({
      id: 25,
      group_id: 31,
      msg_type: "text",
      content: "not-voice",
    });
    await expect(sendGroupVoiceMessage(31, voiceInput(7.84))).rejects.toMatchObject({
      code: "unconfirmed_media_message",
      status: 502,
    });
  });
});

function voiceInput(duration: number) {
  return {
    uri: "file:///voice.m4a",
    filename: "voice_123.m4a",
    duration,
  };
}

function expectExpoByteBackedVoice(value: FormDataEntryValue | null) {
  expect(value).toMatchObject({
    name: "voice_123.m4a",
    type: "audio/m4a",
    bytes: expect.any(Function),
  });
  expect(value).not.toHaveProperty("uri");
}

async function expectExpoSerializableVoiceMultipart(form: FormData) {
  const boundary = "----ExpoFetchFormBoundaryVoiceRegression";
  const result = await convertFormDataAsync(form, boundary);
  const multipart = new TextDecoder().decode(result.body);
  expect(result.boundary).toBe(boundary);
  expect(multipart).toContain('name="voice"; filename="voice_123.m4a"');
  expect(multipart).toContain("content-type: audio/m4a");
  expect(multipart).toContain("VOICE");
}
