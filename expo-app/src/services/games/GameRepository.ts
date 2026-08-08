import AsyncStorage from "@react-native-async-storage/async-storage";

import { apiRequest, APIError } from "@/api/client";
import { createIdempotencyKey } from "@/api/bwchat";
import { flexInt, isRecord } from "@/api/normalizers";
import {
  deduplicateGames,
  normalizeGameCatalogItem,
  normalizeGameCatalogPage,
  normalizeGameRoundStart,
  normalizeGameSession,
  validateGameLobbySession,
  validateGameRoundStart,
  type GameCatalogItem,
  type GameCatalogPage,
  type GameRoundStart,
  type GameSession,
} from "@/services/games/GameModels";
import { gameCenterCachePolicy, gameCenterPolicy } from "@/services/games/GameCenterPolicy";

interface CachedPage {
  savedAt: number;
  page: GameCatalogPage;
}

export interface GamePageLoadResult {
  page: GameCatalogPage;
  source: "cache" | "stale-cache" | "remote";
  refreshError?: unknown;
}

export interface GameRepositoryAccountGuard {
  operationKey: string;
  isCurrent(): boolean;
}

export class GameRepositoryAccountChangedError extends Error {
  constructor() {
    super("Game repository account scope changed");
    this.name = "GameRepositoryAccountChangedError";
  }
}

const recommendedPrefix = "bwchat.games.recommended.v1";
const playedPrefix = "bwchat.games.played.v1";
const inFlightFirstPages = new Map<string, Promise<GameCatalogPage>>();
const playedRevisions = new Map<string, number>();

export async function loadRecommendedGames(
  ownerId: string,
  forceRefresh = false,
  guard?: GameRepositoryAccountGuard,
): Promise<GamePageLoadResult> {
  return loadFirstPage("recommended", ownerId, forceRefresh, guard);
}

export async function loadPlayedGames(
  ownerId: string,
  forceRefresh = false,
  guard?: GameRepositoryAccountGuard,
): Promise<GamePageLoadResult> {
  return loadFirstPage("played", ownerId, forceRefresh, guard);
}

export async function readCachedGamePage(
  ownerId: string,
  kind: "recommended" | "played",
): Promise<GameCatalogPage | undefined> {
  return (await readPage(kind === "recommended" ? recommendedKey(ownerId) : playedKey(ownerId)))
    ?.page;
}

export function readGamePlayedRevision(ownerId: string): number {
  return playedRevisions.get(ownerId.trim()) ?? 0;
}

export async function fetchRecommendedGames(cursor?: string): Promise<GameCatalogPage> {
  return fetchGamePage("recommended", cursor);
}

export async function createGameLobbySession(
  gameID: string,
  idempotencyKey = createIdempotencyKey(),
): Promise<GameSession> {
  const value = await apiRequest<unknown>(`/games/${encodeURIComponent(gameID)}/sessions`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: { purpose: "lobby" },
    requiredData: true,
    requiredEnvelope: true,
    requiredSuccessCode: true,
    transientRetries: false,
  });
  const session = normalizeGameSession(value);
  validateGameLobbySession(session);
  return session;
}

export async function startGameRound(
  gameID: string,
  sessionID: string,
  idempotencyKey: string,
): Promise<GameRoundStart> {
  const value = await apiRequest<unknown>(
    `/games/${encodeURIComponent(gameID)}/sessions/${encodeURIComponent(sessionID)}/rounds`,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: { payment_method: "gold_coins" },
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
      transientRetries: false,
    },
  );
  const round = normalizeGameRoundStart(value);
  validateGameRoundStart(round);
  return round;
}

export async function appendRecommendedPage(
  ownerId: string,
  current: GameCatalogPage,
  cursor: string,
  guard?: GameRepositoryAccountGuard,
): Promise<GameCatalogPage> {
  const remote = await fetchRecommendedGames(cursor);
  assertCurrentAccount(guard);
  const nextCursor =
    remote.nextCursor?.trim() && remote.nextCursor !== cursor ? remote.nextCursor : undefined;
  const page: GameCatalogPage = {
    items: deduplicateGames([...current.items, ...remote.items]),
    ...(nextCursor ? { nextCursor } : {}),
  };
  await writePage(recommendedKey(ownerId), {
    ...page,
    items: page.items.slice(0, gameCenterPolicy.maximumCachedGames),
  }).catch(() => undefined);
  return page;
}

export async function recordPlayedGame(ownerId: string, game: GameCatalogItem): Promise<void> {
  const normalizedOwnerId = ownerId.trim();
  if (!normalizedOwnerId) return;
  try {
    const cached = await readPage(playedKey(normalizedOwnerId));
    const recent: GameCatalogItem = { ...game, lastPlayedAt: new Date().toISOString() };
    const page: GameCatalogPage = {
      items: [recent, ...(cached?.page.items ?? []).filter((item) => item.id !== game.id)].slice(
        0,
        gameCenterPolicy.maximumCachedGames,
      ),
    };
    await writePage(playedKey(normalizedOwnerId), page).catch(() => undefined);
  } finally {
    playedRevisions.set(normalizedOwnerId, readGamePlayedRevision(normalizedOwnerId) + 1);
  }
}

export function gameCenterErrorKey(error: unknown): string {
  const normalized = errorCandidates(error).join(" ").trim().toLocaleLowerCase();
  if (
    normalized.includes("insufficient_gold_coins") ||
    normalized.includes("insufficient_balance") ||
    normalized.includes("金币余额不足")
  )
    return "gameRound.error.insufficientCoins";
  if (normalized.includes("idempotency_conflict")) return "gameRound.error.requestConflict";
  if (normalized.includes("game_session_rate_limited")) return "gameRound.error.rateLimited";
  if (normalized.includes("game_not_found") || normalized.includes("game_unavailable")) {
    return "gameRound.error.gameUnavailable";
  }
  return "gameCenter.sessionFailed";
}

async function loadFirstPage(
  kind: "recommended" | "played",
  ownerId: string,
  forceRefresh: boolean,
  guard?: GameRepositoryAccountGuard,
): Promise<GamePageLoadResult> {
  const key = kind === "recommended" ? recommendedKey(ownerId) : playedKey(ownerId);
  const cached = await readPage(key);
  assertCurrentAccount(guard);
  if (
    !forceRefresh &&
    cached &&
    Date.now() - cached.savedAt < gameCenterCachePolicy.ttlMilliseconds
  ) {
    return { page: cached.page, source: "cache" };
  }
  try {
    const operationKey = `${key}\u0000${guard?.operationKey ?? "unscoped"}`;
    let refresh = inFlightFirstPages.get(operationKey);
    if (!refresh) {
      refresh = fetchGamePage(kind).finally(() => {
        if (inFlightFirstPages.get(operationKey) === refresh) {
          inFlightFirstPages.delete(operationKey);
        }
      });
      inFlightFirstPages.set(operationKey, refresh);
    }
    const page = await refresh;
    assertCurrentAccount(guard);
    await writePage(key, page).catch(() => undefined);
    return { page, source: "remote" };
  } catch (error) {
    if (error instanceof GameRepositoryAccountChangedError) throw error;
    assertCurrentAccount(guard);
    if (
      cached &&
      Date.now() - cached.savedAt <=
        gameCenterCachePolicy.ttlMilliseconds + gameCenterCachePolicy.staleRetentionMilliseconds
    ) {
      return { page: cached.page, source: "stale-cache", refreshError: error };
    }
    throw error;
  }
}

async function fetchGamePage(
  kind: "recommended" | "played",
  cursor?: string,
): Promise<GameCatalogPage> {
  const query = new URLSearchParams({ limit: String(gameCenterPolicy.catalogLimit) });
  if (cursor?.trim()) query.set("cursor", cursor.trim());
  return normalizeGameCatalogPage(
    await apiRequest<unknown>(`/games/${kind}?${query.toString()}`, {
      requiredData: true,
      requiredEnvelope: true,
      requiredSuccessCode: true,
    }),
  );
}

async function readPage(key: string): Promise<CachedPage | undefined> {
  try {
    const encoded = await AsyncStorage.getItem(key);
    if (!encoded) return undefined;
    const value: unknown = JSON.parse(encoded);
    if (!isRecord(value)) return undefined;
    const savedAt = flexInt(value.savedAt);
    const pageValue = isRecord(value.page) ? value.page : value;
    if (savedAt === undefined || savedAt < 0 || !Array.isArray(pageValue.items)) return undefined;
    return {
      savedAt,
      page: {
        items: deduplicateGames(pageValue.items.map(normalizeGameCatalogItem)),
        ...(typeof pageValue.nextCursor === "string" && pageValue.nextCursor.trim()
          ? { nextCursor: pageValue.nextCursor.trim() }
          : {}),
      },
    };
  } catch {
    return undefined;
  }
}

async function writePage(key: string, page: GameCatalogPage): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), page }));
}

function recommendedKey(ownerId: string): string {
  return `${recommendedPrefix}:${encodeURIComponent(ownerId)}`;
}

function playedKey(ownerId: string): string {
  return `${playedPrefix}:${encodeURIComponent(ownerId)}`;
}

function errorCandidates(error: unknown): string[] {
  if (error instanceof APIError) {
    const payload = isRecord(error.payload) ? error.payload : {};
    return [String(payload.code ?? ""), String(payload.message ?? ""), error.message];
  }
  if (error instanceof Error) return [error.message];
  return [String(error ?? "")];
}

function assertCurrentAccount(guard: GameRepositoryAccountGuard | undefined): void {
  if (guard && !guard.isCurrent()) throw new GameRepositoryAccountChangedError();
}

export function resetGameRepositoryMemoryForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  inFlightFirstPages.clear();
  playedRevisions.clear();
}
