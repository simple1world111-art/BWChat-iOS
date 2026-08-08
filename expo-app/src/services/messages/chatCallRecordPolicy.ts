export type ChatCallRecordType = "video" | "voice";
export type ChatCallRecordStatus = "completed" | "cancelled" | "rejected" | "missed" | "busy";

export interface ChatCallRecord {
  callType: ChatCallRecordType;
  status: ChatCallRecordStatus;
  duration?: string | undefined;
}

export type ChatCallRecordTranslationKey =
  | "call.record.duration"
  | "call.record.cancelled.self"
  | "call.record.cancelled.peer"
  | "call.record.rejected.self"
  | "call.record.rejected.peer"
  | "call.record.missed.self"
  | "call.record.unanswered.peer"
  | "call.record.busy.self"
  | "call.record.busy.peer";

const videoLabels = ["视频", "視訊", "影片", "video", "vídeo", "ビデオ", "영상", "видео"];
const voiceLabels = [
  "语音",
  "語音",
  "voice",
  "audio",
  "voz",
  "音声",
  "음성",
  "sprach",
  "vocal",
  "голос",
];

export function parseChatCallRecord(content: string): ChatCallRecord | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("[")) return null;
  const closeBracket = trimmed.indexOf("]");
  if (closeBracket <= 1) return null;
  const label = trimmed.slice(1, closeBracket).trim().toLocaleLowerCase();
  const detail = trimmed.slice(closeBracket + 1).trim();
  if (!detail) return null;
  const callType = containsAny(label, videoLabels)
    ? "video"
    : containsAny(label, voiceLabels)
      ? "voice"
      : null;
  if (!callType) return null;

  const duration = detail.match(/(?<!\d)(?:\d{1,2}:)?\d{2}:\d{2}(?!\d)/u)?.[0];
  if (duration) return { callType, status: "completed", duration };

  const normalized = detail.toLocaleLowerCase();
  if (containsAny(normalized, ["已取消", "對方已取消", "对方已取消", "cancelled", "canceled"])) {
    return { callType, status: "cancelled" };
  }
  if (containsAny(normalized, ["已拒绝", "已拒絕", "reject", "declined"])) {
    return { callType, status: "rejected" };
  }
  if (containsAny(normalized, ["忙线", "忙線", "busy"])) {
    return { callType, status: "busy" };
  }
  if (
    containsAny(normalized, [
      "未接听",
      "未接聽",
      "无应答",
      "無應答",
      "no answer",
      "missed",
      "unanswered",
      "keine antwort",
      "sin respuesta",
      "pas de réponse",
      "応答",
      "不在着信",
      "받지 않",
      "부재중",
      "sem resposta",
      "нет ответа",
      "пропущ",
    ])
  ) {
    return { callType, status: "missed" };
  }
  return null;
}

export function localizedChatCallRecord(
  record: ChatCallRecord,
  isFromMe: boolean,
  translate: (key: ChatCallRecordTranslationKey, ...args: (string | number)[]) => string,
): string {
  if (record.status === "completed") {
    return translate("call.record.duration", record.duration ?? "");
  }
  if (record.status === "cancelled") {
    return translate(isFromMe ? "call.record.cancelled.self" : "call.record.cancelled.peer");
  }
  if (record.status === "rejected") {
    return translate(isFromMe ? "call.record.rejected.peer" : "call.record.rejected.self");
  }
  if (record.status === "missed") {
    return translate(isFromMe ? "call.record.unanswered.peer" : "call.record.missed.self");
  }
  return translate(isFromMe ? "call.record.busy.peer" : "call.record.busy.self");
}

function containsAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}
