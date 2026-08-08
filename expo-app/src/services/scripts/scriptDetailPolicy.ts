import type { InteractiveScript, ScriptRole } from "@/models";
import {
  scriptStatusText,
  scriptText,
  scriptVisibilityText,
} from "@/services/scripts/scriptCenterPolicy";

export const scriptDetailMetrics = {
  contentGap: 18,
  contentHorizontalInset: 16,
  contentBottomInset: 110,
  coverTopInset: 12,
  coverAspectRatio: 1.55,
  coverRadius: 18,
  coverTextInset: 16,
  coverTitleSize: 25,
  coverTitleLines: 2,
  coverCreatorSize: 13,
  coverCopyGap: 5,
  summaryGap: 10,
  sectionInset: 16,
  sectionRadius: 16,
  statusGap: 8,
  statusFontSize: 11,
  statusHorizontalInset: 8,
  statusVerticalInset: 4,
  sectionTitleSize: 17,
  synopsisSize: 15,
  hiddenReasonSize: 13,
  hiddenReasonInset: 10,
  hiddenReasonRadius: 10,
  roleListGap: 12,
  roleAvatarSize: 48,
  roleRowGap: 12,
  roleCopyGap: 4,
  roleNameSize: 15,
  roleGenderSize: 10,
  roleDescriptionSize: 13,
  roleChevronSize: 12,
  actionIconWidth: 22,
  actionRowGap: 12,
  actionTextSize: 15,
  actionVerticalInset: 14,
  actionDividerInset: 46,
  startTextSize: 16,
  startVerticalInset: 13,
  startRadius: 13,
  startHorizontalInset: 16,
  startOuterVerticalInset: 10,
  roleInfoAvatarSize: 92,
  roleInfoGap: 16,
  roleInfoNameSize: 22,
  roleInfoGenderSize: 13,
  roleInfoDescriptionSize: 15,
  roleInfoDescriptionInset: 16,
  roleInfoDescriptionRadius: 14,
  roleInfoOuterInset: 20,
  selectionGap: 10,
  selectionIntroSize: 14,
  selectionIntroBottomInset: 4,
  selectionRoleInset: 12,
  selectionRoleRadius: 14,
  selectionCopyGap: 3,
  selectionDescriptionSize: 12,
  selectionCheckSize: 22,
  selectionOuterInset: 16,
  roomNavigationDelayMilliseconds: 250,
  toastMilliseconds: 3_000,
} as const;

/**
 * SwiftUI resolves the loaded `ScriptRemoteImage` from the bitmap's intrinsic
 * dimensions before the surrounding fit proposal. Mirror that observed detail
 * layout instead of forcing every (normally portrait) poster into a landscape
 * 1.55:1 box. The source modifier remains the loading/failure fallback.
 */
export function scriptDetailCoverAspectRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return scriptDetailMetrics.coverAspectRatio;
  }
  return width / height;
}

export function scriptGenderText(selectedLanguage: string, gender: string): string {
  const normalized = gender.toLocaleLowerCase();
  const chinese =
    normalized === "male"
      ? "男"
      : normalized === "female"
        ? "女"
        : normalized === "non_binary" || normalized === "nonbinary"
          ? "非二元"
          : "未设定";
  const english =
    normalized === "male"
      ? "Male"
      : normalized === "female"
        ? "Female"
        : normalized === "non_binary" || normalized === "nonbinary"
          ? "Non-binary"
          : "Unspecified";
  return scriptText(selectedLanguage, chinese, english);
}

export function canStartScript(script: InteractiveScript, isWorking: boolean): boolean {
  return (
    script.status === "ready" && !script.is_admin_hidden && script.roles.length >= 2 && !isWorking
  );
}

export function isScriptOwner(script: InteractiveScript, currentUserId?: string): boolean {
  return Boolean(currentUserId && script.creator.user_id === currentUserId);
}

export function scriptDetailStatusBadges(
  script: InteractiveScript,
  selectedLanguage: string,
): {
  id: "status" | "visibility" | "admin";
  text: string;
  tone: "accent" | "success" | "secondary" | "danger";
}[] {
  return [
    { id: "status", text: scriptStatusText(selectedLanguage, script.status), tone: "accent" },
    {
      id: "visibility",
      text: scriptVisibilityText(selectedLanguage, script.visibility),
      tone: script.visibility === "public" ? "success" : "secondary",
    },
    ...(script.is_admin_hidden
      ? [
          {
            id: "admin" as const,
            text: scriptText(selectedLanguage, "后台隐藏", "Admin hidden"),
            tone: "danger" as const,
          },
        ]
      : []),
  ];
}

export function selectedRoleById(
  script: InteractiveScript,
  roleId?: string,
): ScriptRole | undefined {
  return roleId ? script.roles.find((role) => role.role_id === roleId) : undefined;
}
