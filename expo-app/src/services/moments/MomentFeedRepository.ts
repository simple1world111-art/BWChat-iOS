import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizeMomentFeedPage } from "@/api/normalizers";
import type { Moment, MomentFeedPage, MomentFeedTab } from "@/models";
import type { MomentMutation } from "@/services/moments/MomentMutationStore";

const feedCachePrefix = "bwchat.moments-feed.v1";

export interface CachedMomentFeed extends MomentFeedPage {
  cached_at: string;
}

export async function readCachedMomentFeed(
  ownerId: string,
  tab: MomentFeedTab,
): Promise<CachedMomentFeed | null> {
  const encoded = await AsyncStorage.getItem(cacheKey(ownerId, tab));
  if (!encoded) return null;
  try {
    const decoded: unknown = JSON.parse(encoded);
    if (!isRecord(decoded)) return null;
    const page = normalizeMomentFeedPage(decoded);
    return {
      ...page,
      cached_at:
        typeof decoded.cached_at === "string" ? decoded.cached_at : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function saveCachedMomentFeed(
  ownerId: string,
  tab: MomentFeedTab,
  page: MomentFeedPage,
): Promise<void> {
  await AsyncStorage.setItem(
    cacheKey(ownerId, tab),
    JSON.stringify({
      ...page,
      moments: page.moments.slice(0, 200),
      cached_at: new Date().toISOString(),
    }),
  );
}

export function mergeMomentFeed(current: Moment[], incoming: Moment[]): Moment[] {
  const confirmedRequestIds = new Set(
    incoming.flatMap((moment) =>
      moment.id > 0 && moment.client_request_id ? [moment.client_request_id] : [],
    ),
  );
  const seen = new Set<number>();
  const seenRequestIds = new Set<string>();
  return [
    ...current.filter(
      (moment) => !moment.client_request_id || !confirmedRequestIds.has(moment.client_request_id),
    ),
    ...incoming,
  ].filter((moment) => {
    if (seen.has(moment.id)) return false;
    if (moment.client_request_id && seenRequestIds.has(moment.client_request_id)) return false;
    seen.add(moment.id);
    if (moment.client_request_id) seenRequestIds.add(moment.client_request_id);
    return true;
  });
}

export function shouldAcceptMomentFeedFirstPage(
  page: MomentFeedPage,
  replacingLocalCount: number,
): boolean {
  if (page.moments.length > 0 || replacingLocalCount === 0) return true;
  return page.snapshot_complete === true;
}

export function upsertMomentInFeed(
  moments: Moment[],
  next: Moment,
  insertIfMissing = false,
): Moment[] {
  const index = moments.findIndex((item) => item.id === next.id);
  if (index < 0) return insertIfMissing ? [next, ...moments] : moments;
  return moments.map((item) => (item.id === next.id ? next : item));
}

export function momentMutationTabs(
  isMyMoments: boolean,
  mutation: Pick<MomentMutation, "kind">,
): readonly MomentFeedTab[] {
  return isMyMoments || mutation.kind === "created"
    ? ["recommended"]
    : ["recommended", "following"];
}

function cacheKey(ownerId: string, tab: MomentFeedTab): string {
  return `${feedCachePrefix}:${encodeURIComponent(ownerId)}:${tab}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
