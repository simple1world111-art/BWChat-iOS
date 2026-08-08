export interface ParsedChatVoiceContent {
  url: string;
  duration: number;
}

export const chatVoiceRecordingPolicy = {
  extension: ".m4a",
  sampleRate: 22_050,
  numberOfChannels: 1,
  bitRate: 64_000,
  minimumDurationSeconds: 1,
  cancelTranslationY: -80,
  uploadTimeoutMilliseconds: 60_000,
} as const;

export const chatVoiceBubblePolicy = {
  minimumWidth: 80,
  maximumWidth: 200,
  widthPerSecond: 8,
  horizontalPadding: 12,
  verticalPadding: 10,
  cornerRadius: 18,
  contentSpacing: 6,
  durationFontSize: 14,
  waveBarWidth: 2,
  waveBarSpacing: 2,
  idleWaveHeights: [6, 10, 6],
  playingWaveHeights: [8, 14, 10],
} as const;

export const chatVoiceRecordingVisualPolicy = {
  buttonCornerRadius: 20,
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
  recordingWaveDurationMilliseconds: 400,
  recordingWaveDelayMilliseconds: 100,
} as const;

export function parseChatVoiceContent(content: string): ParsedChatVoiceContent {
  const parts = content.split("|");
  const parsedDuration = Number(parts.at(-1));
  return {
    url: parts[0]?.trim() ?? "",
    duration: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 0,
  };
}

export function chatVoiceBubbleWidth(duration: number): number {
  return Math.min(
    Math.max(
      chatVoiceBubblePolicy.minimumWidth,
      chatVoiceBubblePolicy.minimumWidth + Math.max(duration, 0) * chatVoiceBubblePolicy.widthPerSecond,
    ),
    chatVoiceBubblePolicy.maximumWidth,
  );
}

export function formatChatVoiceUploadDuration(duration: number): string {
  return Math.max(duration, 0).toFixed(1);
}

export function formatChatVoiceRecordingDuration(durationSeconds: number): string {
  const seconds = Math.max(0, Math.floor(durationSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function resolveChatVoicePlaybackUrl(rawUrl: string, apiBaseUrl: string): string | null {
  const value = rawUrl.trim();
  if (!value) return null;
  if (/^(file|content):/u.test(value)) return value;
  if (/^https?:/u.test(value)) return value;
  try {
    const api = new URL(apiBaseUrl);
    const port = api.port ? `:${api.port}` : "";
    return `${api.protocol}//${api.hostname}${port}${value}`;
  } catch {
    return null;
  }
}
