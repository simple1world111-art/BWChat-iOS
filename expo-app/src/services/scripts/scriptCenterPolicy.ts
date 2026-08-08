import type { InteractiveScript, ScriptStatus, ScriptVisibility } from "@/models";

export const scriptCenterMetrics = {
  segmentedWidth: 196,
  segmentedFontSize: 17,
  createIconSize: 18,
  createButtonSize: 34,
  categoryGap: 8,
  categoryHorizontalOuterInset: 16,
  categoryTopInset: 10,
  categoryBottomInset: 12,
  categoryHorizontalInset: 13,
  categoryVerticalInset: 7,
  categoryFontSize: 13,
  gridColumns: 2,
  gridGap: 12,
  gridHorizontalInset: 16,
  gridBottomInset: 24,
  skeletonCount: 6,
  cardGap: 9,
  cardInset: 10,
  cardRadius: 15,
  coverAspectRatio: 0.82,
  coverRadius: 12,
  badgeFontSize: 10,
  badgeHorizontalInset: 7,
  badgeVerticalInset: 4,
  badgeOuterInset: 7,
  titleFontSize: 15,
  synopsisFontSize: 12,
  synopsisMinimumHeight: 32,
  roleAvatarSize: 22,
  roleAvatarOverlap: -5,
  roleAvatarStroke: 1.5,
  creatorFontSize: 10,
  emptyGap: 12,
  emptyIconSize: 36,
  emptyTitleSize: 17,
  emptySubtitleSize: 14,
  emptyInset: 30,
  retryGap: 14,
  retryFontSize: 15,
  retryBottomInset: 28,
  loadMoreBottomInset: 20,
  pageLimit: 20,
  categoryTtlMilliseconds: 60 * 60 * 1_000,
  pageTtlMilliseconds: 5 * 60 * 1_000,
  staleRetentionMilliseconds: 90 * 24 * 60 * 60 * 1_000,
} as const;

export function scriptText(
  selectedLanguage: string,
  simplifiedChinese: string,
  english: string,
): string {
  return selectedLanguage === "system" || selectedLanguage.startsWith("zh")
    ? simplifiedChinese
    : english;
}

export function scriptStatusText(selectedLanguage: string, status: ScriptStatus): string {
  const chinese = status === "draft" ? "草稿" : status === "ready" ? "可开局" : "已归档";
  const english = status === "draft" ? "Draft" : status === "ready" ? "Ready" : "Archived";
  return selectedLanguage === "system" || selectedLanguage.startsWith("zh") ? chinese : english;
}

export function scriptVisibilityText(
  selectedLanguage: string,
  visibility: ScriptVisibility,
): string {
  const chinese = visibility === "private" ? "私人" : "公开";
  const english = visibility === "private" ? "Private" : "Public";
  return selectedLanguage === "system" || selectedLanguage.startsWith("zh") ? chinese : english;
}

export function scriptBadgeText(
  script: InteractiveScript,
  selectedLanguage: string,
): string | null {
  if (!script.is_admin_hidden && script.status === "ready" && script.visibility === "public")
    return null;
  if (script.is_admin_hidden) {
    return selectedLanguage === "system" || selectedLanguage.startsWith("zh") ? "已隐藏" : "Hidden";
  }
  if (script.status !== "ready") return scriptStatusText(selectedLanguage, script.status);
  return scriptVisibilityText(selectedLanguage, script.visibility);
}

export function appendUniqueScripts(
  current: readonly InteractiveScript[],
  incoming: readonly InteractiveScript[],
): InteractiveScript[] {
  const seen = new Set(current.map((script) => script.script_id));
  return [...current, ...incoming.filter((script) => !seen.has(script.script_id))];
}

export function scriptCoverAspectRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return scriptCenterMetrics.coverAspectRatio;
  }
  return width / height;
}
