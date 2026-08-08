import type { FollowUser, PublicProfile } from "@/models";

/**
 * Geometry transcribed from UserProfileView.swift. Keeping the native values
 * together makes the source-level visual contract reviewable without a
 * simulator and prevents individual states from drifting independently.
 */
export const userProfileMetrics = {
  navigation: {
    gap: 2,
    button: 36,
    symbol: 17,
    title: 17,
    titleMaxWidth: 180,
    titleMinimumScale: 0.82,
  },
  content: { bottomInset: 28, topStateInset: 96 },
  header: {
    horizontalInset: 16,
    topInset: 4,
    bottomInset: 12,
    gap: 10,
    topGap: 16,
    avatar: 72,
    avatarRadius: 16,
    avatarBorder: 1,
    highlightedAvatarBorder: 2,
    identityGap: 2,
    nameGap: 4,
    name: 16,
    nameMinimumScale: 0.78,
    verified: 14,
    relationship: 11,
    relationshipHorizontalInset: 7,
    relationshipVerticalInset: 3,
    detailGap: 5,
    pronouns: 14,
    category: 13,
    bio: 14,
    metadata: 13,
    mutual: 12,
    website: 14,
    websiteGap: 5,
    statValue: 17,
    statTitle: 12,
    statTitleMinimumScale: 0.75,
  },
  actions: {
    horizontalInset: 16,
    bottomInset: 12,
    gap: 8,
    height: 36,
    radius: 8,
    title: 15,
  },
  suggestions: {
    topInset: 4,
    bottomInset: 14,
    gap: 12,
    horizontalInset: 16,
    title: 16,
    showAll: 14,
    loadingHeight: 120,
    emptyVerticalInset: 36,
    cardsGap: 6,
    cardWidth: 106,
    cardHeight: 136,
    cardHorizontalInset: 8,
    cardTopInset: 12,
    cardBottomInset: 8,
    cardRadius: 8,
    cardGap: 7,
    avatar: 55,
    identityGap: 6,
    copyGap: 2,
    name: 12,
    id: 10,
    followHeight: 28,
    followRadius: 6,
    followTitle: 12,
    dismiss: 24,
    dismissSymbol: 10,
  },
  highlights: {
    maximumCount: 12,
    horizontalInset: 16,
    verticalInset: 10,
    gap: 14,
    width: 72,
    itemGap: 6,
    cover: 64,
    coverRadius: 32,
    title: 12,
  },
  tabs: {
    rowHeight: 44,
    labelHeight: 43,
    underlineHeight: 1,
    title: 15,
    titleMinimumScale: 0.72,
  },
  states: {
    contentTopInset: 54,
    privateHorizontalInset: 36,
    privateIcon: 34,
    privateTitle: 16,
    privateSubtitle: 14,
    missingTopInset: 96,
    missingIcon: 38,
    missingTitle: 15,
    gap: 12,
  },
  more: {
    cornerRadius: 24,
    handleWidth: 36,
    handleHeight: 4,
    handleTopInset: 9,
    handleBottomInset: 5,
    sectionGap: 8,
    rowHeight: 46,
    rowHorizontalInset: 22,
    rowGap: 14,
    iconWidth: 24,
    symbol: 17,
    title: 15,
    titleMinimumScale: 0.82,
    dividerLeadingInset: 60,
  },
} as const;

export interface UserProfileRequestTicket {
  readonly key: string;
  readonly generation: number;
}

export class UserProfileRequestScope {
  private key = "";
  private generation = 0;

  reset(ownerId: string, targetId: string): UserProfileRequestTicket {
    this.key = userProfileIdentity(ownerId, targetId);
    this.generation += 1;
    return this.current();
  }

  current(): UserProfileRequestTicket {
    return { key: this.key, generation: this.generation };
  }

  isCurrent(ticket: UserProfileRequestTicket): boolean {
    return ticket.key === this.key && ticket.generation === this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }
}

export class UserProfileGenerationBusySet {
  private readonly active = new Set<number>();

  tryEnter(generation: number): boolean {
    if (this.active.has(generation)) return false;
    this.active.add(generation);
    return true;
  }

  leave(generation: number): void {
    this.active.delete(generation);
  }
}

export function userProfileIdentity(ownerId: string, targetId: string): string {
  return `${ownerId.trim()}\u0000${targetId.trim()}`;
}

export function profileDeepLink(profile: Pick<PublicProfile, "username" | "user_id">): string {
  const path = profile.username.trim() || profile.user_id.trim();
  return `bwchat://profile/${encodeURLPathComponent(path)}`;
}

export function encodeURLPathComponent(value: string): string {
  return encodeURIComponent(value)
    .replace(/%2F/giu, "/")
    .replace(/%3A/giu, ":")
    .replace(/%40/giu, "@")
    .replace(/%26/giu, "&")
    .replace(/%3D/giu, "=")
    .replace(/%2B/giu, "+")
    .replace(/%24/giu, "$")
    .replace(/%2C/giu, ",")
    .replace(/%3B/giu, ";");
}

export function profileWebsiteDisplay(value: string | undefined): string {
  return (value ?? "").replaceAll("https://", "").replaceAll("http://", "");
}

export function profileWebsiteURL(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.includes("://") ? trimmed : `https://${trimmed}`;
}

export function filterUserProfileSuggestions(
  candidates: readonly FollowUser[],
  ownerId: string,
  targetId: string,
): FollowUser[] {
  const excluded = new Set([ownerId.trim(), targetId.trim()]);
  const seen = new Set<string>();
  return candidates.filter((user) => {
    const userId = user.user_id.trim();
    if (!userId || excluded.has(userId) || seen.has(userId)) return false;
    seen.add(userId);
    return true;
  });
}
