import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { env } from "@/config/env";
import { resolveChatVoicePlaybackUrl } from "@/services/messages/chatVoicePolicy";
import { readAccessToken } from "@/storage/tokenStorage";

export interface ChatVoicePlaybackSnapshot {
  url: string | null;
  is_playing: boolean;
  current_time: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: ChatVoicePlaybackSnapshot = { url: null, is_playing: false, current_time: 0 };
let player: AudioPlayer | null = null;
let statusSubscription: { remove: () => void } | null = null;
let generation = 0;

export function subscribeChatVoicePlayback(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChatVoicePlaybackSnapshot(): ChatVoicePlaybackSnapshot {
  return snapshot;
}

export async function toggleChatVoicePlayback(rawUrl: string): Promise<void> {
  if (snapshot.url === rawUrl && snapshot.is_playing) {
    stopChatVoicePlayback();
    return;
  }
  await playChatVoice(rawUrl);
}

export function stopChatVoicePlayback(): void {
  generation += 1;
  statusSubscription?.remove();
  statusSubscription = null;
  if (player) {
    player.pause();
    player.remove();
  }
  player = null;
  publish({ url: null, is_playing: false, current_time: 0 });
}

async function playChatVoice(rawUrl: string): Promise<void> {
  stopChatVoicePlayback();
  const currentGeneration = generation;
  const playbackUrl = resolveChatVoicePlaybackUrl(rawUrl, env.apiBaseUrl);
  if (!playbackUrl) return;
  const isRemote = /^https?:/u.test(playbackUrl);
  const token = isRemote ? await readAccessToken() : null;
  if (generation !== currentGeneration) return;
  await setAudioModeAsync({
    allowsRecording: false,
    interruptionMode: "doNotMix",
    playsInSilentMode: true,
  }).catch(() => undefined);
  if (generation !== currentGeneration) return;

  const nextPlayer = createAudioPlayer(
    token && isRemote
      ? { uri: playbackUrl, headers: { Authorization: `Bearer ${token}` } }
      : { uri: playbackUrl },
    { downloadFirst: true, updateInterval: 100 },
  );
  player = nextPlayer;
  publish({ url: rawUrl, is_playing: false, current_time: 0 });
  let requestedPlay = false;
  statusSubscription = nextPlayer.addListener("playbackStatusUpdate", (status) => {
    if (player !== nextPlayer) return;
    if (status.error || status.didJustFinish) {
      stopChatVoicePlayback();
      return;
    }
    if (status.isLoaded && !requestedPlay) {
      requestedPlay = true;
      nextPlayer.play();
    }
    publish({
      url: rawUrl,
      is_playing: status.playing,
      current_time: status.currentTime,
    });
  });
}

function publish(next: ChatVoicePlaybackSnapshot): void {
  if (
    snapshot.url === next.url &&
    snapshot.is_playing === next.is_playing &&
    snapshot.current_time === next.current_time
  ) return;
  snapshot = next;
  for (const listener of listeners) listener();
}
