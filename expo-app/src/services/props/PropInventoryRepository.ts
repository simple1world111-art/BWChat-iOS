import { apiRequest } from "@/api/client";
import { normalizePropBagPage, type PropBagPage } from "@/services/props/PropInventoryModels";

export async function getPropBag(): Promise<PropBagPage> {
  return normalizePropBagPage(await apiRequest<unknown>("/me/prop-bag", { cache: "no-store" }));
}
