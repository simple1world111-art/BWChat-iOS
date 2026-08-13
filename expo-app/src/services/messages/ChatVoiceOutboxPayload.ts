import { File } from "expo-file-system";

export const chatVoiceOutboxDefaultMimeType = "audio/m4a";

export interface ChatVoiceOutboxPayload {
  uri: string;
  filename: string;
  mime_type: string;
  duration: number;
}

export class ChatVoiceOutboxFileUnavailableError extends Error {
  readonly code = "chat_voice_file_unavailable";

  constructor() {
    super("语音文件已不存在，请重新录制后发送");
    this.name = "ChatVoiceOutboxFileUnavailableError";
  }
}

export function isValidChatVoiceOutboxPayload(value: unknown): value is ChatVoiceOutboxPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Partial<ChatVoiceOutboxPayload>;
  return (
    typeof payload.uri === "string" &&
    /^(file|content):/u.test(payload.uri) &&
    typeof payload.filename === "string" &&
    payload.filename.trim().length > 0 &&
    typeof payload.mime_type === "string" &&
    payload.mime_type.trim().toLocaleLowerCase().startsWith("audio/") &&
    typeof payload.duration === "number" &&
    Number.isFinite(payload.duration) &&
    payload.duration > 0
  );
}

export function requireAvailableChatVoiceUpload(payload: ChatVoiceOutboxPayload | undefined): {
  uri: string;
  filename: string;
  mimeType: string;
  duration: number;
} {
  if (!isValidChatVoiceOutboxPayload(payload)) {
    throw new ChatVoiceOutboxFileUnavailableError();
  }
  try {
    if (!new File(payload.uri).exists) throw new ChatVoiceOutboxFileUnavailableError();
  } catch (error) {
    if (error instanceof ChatVoiceOutboxFileUnavailableError) throw error;
    throw new ChatVoiceOutboxFileUnavailableError();
  }
  return {
    uri: payload.uri,
    filename: payload.filename,
    mimeType: payload.mime_type,
    duration: payload.duration,
  };
}

export function chatVoiceOutboxContent(payload: ChatVoiceOutboxPayload): string {
  return `${payload.uri}|${payload.duration}`;
}
