import {
  flexInt,
  flexString,
  isRecord,
  normalizeWalletBalanceSnapshot,
} from "@/api/normalizers";
import type { PropConsumptionResult, WalletBalanceSnapshot } from "@/models";

export interface GameCatalogPage {
  items: GameCatalogItem[];
  nextCursor?: string | undefined;
}

export interface GameCatalogItem {
  id: string;
  name: string;
  posterURL: string;
  iconURL?: string | undefined;
  summary?: string | undefined;
  gameType?: string | undefined;
  entryPriceGoldCoins?: number | undefined;
  sortOrder: number;
  lastPlayedAt?: string | undefined;
}

export interface GameSession {
  sessionID: string;
  launchURL: string;
  expiresAt: string;
  paymentMethod?: string | undefined;
  entryPriceGoldCoins?: number | undefined;
  walletBalance?: WalletBalanceSnapshot | undefined;
  consumedProp?: PropConsumptionResult | undefined;
}

export interface GameRoundStart {
  roundID: string;
  roundToken: string;
  expiresAt: string;
  paymentMethod: string;
  entryPriceGoldCoins: number;
  walletBalance: WalletBalanceSnapshot;
  consumedProp?: PropConsumptionResult | undefined;
}

export function normalizeGameCatalogPage(value: unknown): GameCatalogPage {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("游戏列表响应格式无效");
  }
  const nextCursor = flexString(value.next_cursor, value.nextCursor);
  return {
    items: deduplicateGames(value.items.map(normalizeGameCatalogItem)),
    ...(nextCursor ? { nextCursor } : {}),
  };
}

export function normalizeGameCatalogItem(value: unknown): GameCatalogItem {
  if (!isRecord(value)) throw new Error("游戏数据格式无效");
  const id = requiredString(value.id, "游戏 ID");
  const name = requiredString(value.name, "游戏名称");
  const posterURL = requiredString(value.poster_url, value.posterURL, "游戏海报");
  const sortOrder = flexInt(value.order, value.sortOrder);
  if (sortOrder === undefined) throw new Error("游戏排序字段无效");
  const iconURL = flexString(value.icon_url, value.iconURL);
  const summary = flexString(value.description, value.summary);
  const gameType = flexString(value.game_type, value.gameType);
  const entryPriceGoldCoins = flexInt(
    value.entry_price_gold_coins,
    value.entryPriceGoldCoins,
    value.entry_price_cat_coins,
  );
  const lastPlayedAt = flexString(value.last_played_at, value.lastPlayedAt);
  if (entryPriceGoldCoins !== undefined && entryPriceGoldCoins < 0) {
    throw new Error("游戏价格不能为负数");
  }
  return {
    id,
    name,
    posterURL,
    ...(iconURL ? { iconURL } : {}),
    ...(summary ? { summary } : {}),
    ...(gameType ? { gameType } : {}),
    ...(entryPriceGoldCoins !== undefined ? { entryPriceGoldCoins } : {}),
    sortOrder,
    ...(lastPlayedAt ? { lastPlayedAt } : {}),
  };
}

export function normalizeGameSession(value: unknown): GameSession {
  if (!isRecord(value)) throw new Error("游戏会话响应格式无效");
  const paymentMethod = flexString(value.payment_method, value.paymentMethod);
  const entryPriceGoldCoins = flexInt(
    value.entry_price_gold_coins,
    value.entryPriceGoldCoins,
    value.entry_price_cat_coins,
  );
  const walletValue = value.wallet_balance ?? value.walletBalance;
  const consumedValue = value.consumed_prop ?? value.consumedProp;
  return {
    sessionID: requiredString(value.session_id, value.sessionID, "游戏会话 ID"),
    launchURL: requiredString(value.launch_url, value.launchURL, "游戏启动地址"),
    expiresAt: requiredString(value.expires_at, value.expiresAt, "游戏会话有效期"),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(entryPriceGoldCoins !== undefined ? { entryPriceGoldCoins } : {}),
    ...(walletValue !== undefined && walletValue !== null
      ? { walletBalance: normalizeWalletBalanceSnapshot(walletValue) }
      : {}),
    ...(consumedValue !== undefined && consumedValue !== null
      ? { consumedProp: normalizeConsumedProp(consumedValue) }
      : {}),
  };
}

export function normalizeGameRoundStart(value: unknown): GameRoundStart {
  if (!isRecord(value)) throw new Error("游戏开局响应格式无效");
  const consumedValue = value.consumed_prop ?? value.consumedProp;
  const entryPriceGoldCoins = flexInt(value.entry_price_gold_coins, value.entryPriceGoldCoins);
  if (entryPriceGoldCoins === undefined) throw new Error("游戏开局价格无效");
  return {
    roundID: requiredString(value.round_id, value.roundID, "游戏回合 ID"),
    roundToken: requiredString(value.round_token, value.roundToken, "游戏回合令牌"),
    expiresAt: requiredString(value.expires_at, value.expiresAt, "游戏回合有效期"),
    paymentMethod: requiredString(value.payment_method, value.paymentMethod, "游戏支付方式"),
    entryPriceGoldCoins,
    walletBalance: normalizeWalletBalanceSnapshot(value.wallet_balance ?? value.walletBalance),
    ...(consumedValue !== undefined && consumedValue !== null
      ? { consumedProp: normalizeConsumedProp(consumedValue) }
      : {}),
  };
}

export function validateGameLobbySession(session: GameSession): void {
  if (session.paymentMethod !== undefined || session.walletBalance || session.consumedProp) {
    throw new Error("GAME_LOBBY_PAYMENT_WAS_APPLIED");
  }
  if (!session.entryPriceGoldCoins || session.entryPriceGoldCoins <= 0) {
    throw new Error("GAME_LOBBY_INVALID_ENTRY_PRICE");
  }
}

export function validateGameRoundStart(round: GameRoundStart): void {
  if (
    !round.roundID.trim()
    || !round.roundToken.trim()
    || round.entryPriceGoldCoins <= 0
    || round.walletBalance.spendable_balance
      !== round.walletBalance.gold_coin_balance + round.walletBalance.activity_cat_food_balance
  ) {
    throw new Error("GAME_ROUND_INVALID_GRANT");
  }
  if (round.paymentMethod !== "gold_coins") throw new Error("GAME_ROUND_PAYMENT_METHOD_MISMATCH");
  if (round.consumedProp) throw new Error("GAME_ROUND_INVALID_CONSUMPTION");
}

export function deduplicateGames(games: readonly GameCatalogItem[]): GameCatalogItem[] {
  const seen = new Set<string>();
  return games.filter((game) => {
    if (seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  });
}

export function gameDisplayIconURL(game: GameCatalogItem): string {
  return game.iconURL?.trim() || game.posterURL;
}

function normalizeConsumedProp(value: unknown): PropConsumptionResult {
  if (!isRecord(value)) throw new Error("游戏道具消耗响应格式无效");
  const remainingQuantity = flexInt(value.remaining_quantity, value.remainingQuantity);
  if (remainingQuantity === undefined || remainingQuantity < 0) {
    throw new Error("游戏道具剩余数量无效");
  }
  const inventoryId = flexString(value.inventory_id, value.inventoryId);
  return {
    ...(inventoryId ? { inventory_id: inventoryId } : {}),
    definition_id: requiredString(value.definition_id, value.definitionId, "道具定义 ID"),
    remaining_quantity: remainingQuantity,
  };
}

function requiredString(...values: unknown[]): string {
  const label = typeof values.at(-1) === "string" ? String(values.pop()) : "字段";
  const value = flexString(...values);
  if (!value) throw new Error(`${label}无效`);
  return value;
}
