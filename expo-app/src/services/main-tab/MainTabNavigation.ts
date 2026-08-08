import { router, type Href } from "expo-router";

import { activeMainTabRouteName, type MainTabID } from "@/services/main-tab/MainTabRegistry";

export function selectMainTab(tab: MainTabID): boolean {
  const routeName = activeMainTabRouteName(tab);
  if (!routeName) return false;
  router.dismissAll();
  router.replace(`/(tabs)/${routeName}` as Href);
  return true;
}

export function selectMainTabThenPush(tab: MainTabID, destination: Href): void {
  selectMainTab(tab);
  queueMicrotask(() => router.push(destination));
}
