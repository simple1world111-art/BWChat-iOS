import type { AndroidSymbol, SFSymbol } from "expo-symbols";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useLayoutEffect, useMemo } from "react";

import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import {
  conversationUnreadBadgeText,
  useConversationUnread,
} from "@/services/conversations/ConversationUnreadStore";
import {
  mainTabDescriptorTitle,
  mainTabSignature,
  publishActiveMainTabEntries,
  resolveMainTabEntries,
} from "@/services/main-tab/MainTabRegistry";
import { momentsUnreadBadgeText, useMomentsUnread } from "@/services/moments/MomentsUnreadStore";
import { effectiveTabs, normalizedTabName } from "@/services/remote-config/RemoteConfigService";
import type { DynamicTabDescriptor } from "@/services/remote-config/types";

const NATIVE_SELECTED_TAB_COLOR = "#000000";

const knownTabs = {
  messages: {
    route: "conversations",
    title: "消息",
    normal: "bubble.left.and.bubble.right",
    selected: "bubble.left.and.bubble.right.fill",
    android: "chat_bubble_outline",
  },
  map: {
    route: "map",
    title: "地图",
    normal: "map",
    selected: "map.fill",
    android: "map",
  },
  nearby: {
    route: "map",
    title: "地图",
    normal: "map",
    selected: "map.fill",
    android: "map",
  },
  discover: {
    route: "discover",
    title: "发现",
    normal: "safari",
    selected: "safari.fill",
    android: "explore",
  },
  profile: {
    route: "profile",
    title: "我的",
    normal: "gearshape",
    selected: "gearshape.fill",
    android: "settings",
  },
} as const satisfies Record<
  string,
  {
    route: string;
    title: string;
    normal: SFSymbol;
    selected: SFSymbol;
    android: AndroidSymbol;
  }
>;

export default function TabsLayout() {
  const { config } = useRemoteConfig();
  const { user } = useAuth();
  const { activeLanguage, t } = useLocalization();
  const messagesUnread = useConversationUnread(user?.user_id ?? "");
  const momentsUnread = useMomentsUnread(user?.user_id ?? "");
  const tabs = useMemo(() => resolveMainTabEntries(effectiveTabs(config)), [config]);
  const signature = mainTabSignature(tabs, activeLanguage, t);
  useLayoutEffect(() => publishActiveMainTabEntries(tabs), [signature, tabs]);

  return (
    <NativeTabs
      key={signature}
      iconColor={{ selected: NATIVE_SELECTED_TAB_COLOR }}
      minimizeBehavior="never"
      tintColor={NATIVE_SELECTED_TAB_COLOR}
    >
      {tabs.map(({ descriptor, routeName }) => {
        const definition = resolveTabDefinition(descriptor);
        const badge = nativeTabBadgeText(descriptor, messagesUnread, momentsUnread);
        return (
          <NativeTabs.Trigger
            key={descriptor.id}
            name={routeName}
            disablePopToTop
            disableScrollToTop
          >
            <NativeTabs.Trigger.Icon
              md={definition.android}
              sf={{ default: definition.normal, selected: definition.selected }}
            />
            <NativeTabs.Trigger.Label>
              {mainTabDescriptorTitle(descriptor, definition.title, activeLanguage, t)}
            </NativeTabs.Trigger.Label>
            {badge ? <NativeTabs.Trigger.Badge>{badge}</NativeTabs.Trigger.Badge> : null}
          </NativeTabs.Trigger>
        );
      })}
    </NativeTabs>
  );
}

function resolveKnownTab(descriptor: DynamicTabDescriptor) {
  const name = normalizedTabName(descriptor) as keyof typeof knownTabs;
  const definition = knownTabs[name];
  return definition ? [{ descriptor, definition }] : [];
}

function resolveTabDefinition(descriptor: DynamicTabDescriptor): {
  title: string;
  normal: SFSymbol;
  selected: SFSymbol;
  android: AndroidSymbol;
} {
  const known = resolveKnownTab(descriptor)[0]?.definition;
  if (known) return known;
  return {
    title: descriptor.id,
    normal: (descriptor.systemImage?.trim() || "circle") as SFSymbol,
    selected: (descriptor.selectedSystemImage?.trim() ||
      descriptor.systemImage?.trim() ||
      "circle.fill") as SFSymbol,
    android: "circle" as AndroidSymbol,
  };
}

function nativeTabBadgeText(
  descriptor: DynamicTabDescriptor,
  messagesUnread: number,
  momentsUnread: number,
): string | null {
  const name = normalizedTabName(descriptor);
  const badgeKey = (descriptor.badgeKey ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s-]+/gu, "_");
  if (
    name === "messages" ||
    ["messages_unread", "chat_unread", "conversations_unread", "messages"].includes(badgeKey)
  ) {
    return conversationUnreadBadgeText(messagesUnread);
  }
  if (name === "discover" || ["moments_unread", "moments"].includes(badgeKey)) {
    return momentsUnreadBadgeText(momentsUnread);
  }
  return null;
}
