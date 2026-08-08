import type { DynamicSectionItem } from "@/services/remote-config/types";
import { localizedDynamicText } from "@/services/web/DynamicRouteNavigator";

export type ProfileTranslate = (key: string, ...args: (string | number)[]) => string;

export function profileLoadCanCommit(input: {
  generation: number;
  currentGeneration: number;
  targetOwnerId: string;
  activeOwnerId: string;
}): boolean {
  return (
    input.generation === input.currentGeneration &&
    input.targetOwnerId.length > 0 &&
    input.targetOwnerId === input.activeOwnerId
  );
}

export function profileResponseBelongsToOwner(
  responseOwnerId: string,
  targetOwnerId: string,
): boolean {
  return responseOwnerId.trim() === targetOwnerId.trim() && targetOwnerId.trim().length > 0;
}

export function profileMenuTitle(
  item: DynamicSectionItem,
  language: string,
  translate: ProfileTranslate,
): string {
  const id = normalizeToken(item.id);
  // These three exceptions intentionally mirror ProfileView.profileMenuTitle.
  if (id === "agent_hub") return "智能体";
  if (id === "my_short_dramas") return translate("shortDrama.title");
  if (id === "my_groups") return translate("discover.groups");
  const translated = translatedKey(item.titleKey, translate);
  return (
    localizedDynamicText(item.titleI18n, language) ?? translated ?? item.title?.trim() ?? item.id
  );
}

export function profileMenuSubtitle(
  item: DynamicSectionItem,
  language: string,
  translate: ProfileTranslate,
): string | undefined {
  return (
    localizedDynamicText(item.subtitleI18n, language) ??
    translatedKey(item.subtitleKey, translate) ??
    item.subtitle?.trim() ??
    undefined
  );
}

function translatedKey(key: string | undefined, translate: ProfileTranslate): string | undefined {
  const normalized = key?.trim();
  if (!normalized) return undefined;
  const translated = translate(normalized).trim();
  return translated && translated !== normalized ? translated : undefined;
}

function normalizeToken(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}
