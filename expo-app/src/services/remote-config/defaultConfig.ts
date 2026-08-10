import type {
  DynamicSection,
  DynamicTabDescriptor,
  RemoteConfig,
} from "@/services/remote-config/types";
import { defaultWebViewPolicy } from "@/services/web/WebViewPolicy";
import { bundledDynamicScreens } from "@/services/dynamic-screen/DynamicScreenFixtures";

export const defaultTabs: DynamicTabDescriptor[] = [
  {
    id: "messages",
    type: "native",
    titleKey: "tab.messages",
    systemImage: "bubble.left.and.bubble.right",
    selectedSystemImage: "bubble.left.and.bubble.right.fill",
    order: 10,
    route: { type: "native", name: "messages" },
  },
  {
    id: "map",
    type: "native",
    titleKey: "tab.map",
    systemImage: "map",
    selectedSystemImage: "map.fill",
    order: 30,
    route: { type: "native", name: "map" },
  },
  {
    id: "discover",
    type: "native",
    titleKey: "tab.discover",
    systemImage: "safari",
    selectedSystemImage: "safari.fill",
    order: 40,
    route: { type: "native", name: "discover" },
  },
  {
    id: "test",
    type: "native",
    titleKey: "tab.test",
    systemImage: "ladybug",
    selectedSystemImage: "ladybug.fill",
    order: 45,
    route: { type: "native", name: "test" },
  },
  {
    id: "profile",
    type: "native",
    titleKey: "tab.profile",
    systemImage: "gearshape",
    selectedSystemImage: "gearshape.fill",
    order: 50,
    route: { type: "native", name: "profile" },
  },
];

export const defaultFeatures: RemoteConfig["features"] = {
  aiImageEnabled: true,
  aiVideoEnabled: true,
  paymentEnabled: true,
  maintenanceMode: false,
  momentsEnabled: true,
  mapEnabled: true,
  gamesEnabled: true,
  shortDramaEnabled: true,
  voiceVideoCallEnabled: true,
};

export const defaultProfileSections: DynamicSection[] = [
  {
    id: "profile_core",
    order: 10,
    items: [
      {
        id: "wallet",
        type: "row",
        titleKey: "profile.wallet",
        systemImage: "pawprint.fill",
        colors: ["FFB703", "FB8500"],
        order: 10,
        route: { type: "native", name: "wallet" },
      },
      {
        id: "prop_bag",
        type: "row",
        titleKey: "propBag.title",
        systemImage: "shippingbox.fill",
        colors: ["675AF5", "9D64F4"],
        order: 15,
        route: { type: "native", name: "prop_bag" },
      },
      {
        id: "my_moments",
        type: "row",
        titleKey: "profile.moments",
        systemImage: "camera.fill",
        colors: ["3A86FF", "8ECAE6"],
        order: 20,
        route: { type: "native", name: "my_moments" },
      },
      {
        id: "agent_hub",
        type: "row",
        titleKey: "contacts.aiCompanions",
        systemImage: "sparkles",
        colors: ["8B7CFF", "C779FF"],
        order: 25,
        route: { type: "native", name: "agent_hub" },
      },
      {
        id: "my_short_dramas",
        type: "row",
        titleKey: "profile.shortDramaStudio",
        systemImage: "play.rectangle.fill",
        colors: ["FF4D8D", "7C3AED"],
        order: 30,
        route: { type: "native", name: "my_short_dramas" },
      },
      {
        id: "contacts",
        type: "row",
        titleKey: "tab.contacts",
        systemImage: "person.2.fill",
        colors: ["34C759", "30B0C7"],
        order: 40,
        route: { type: "native", name: "contacts" },
      },
    ],
  },
];

export const defaultContactModules: DynamicSection[] = [
  {
    id: "contacts_core",
    order: 10,
    items: [
      {
        id: "friend_requests",
        type: "row",
        titleKey: "contacts.friendRequests",
        systemImage: "person.crop.circle.badge.clock",
        colors: ["FF9500"],
        order: 10,
        route: { type: "native", name: "friend_requests" },
      },
      {
        id: "my_groups",
        type: "row",
        titleKey: "contacts.myGroups",
        systemImage: "person.3.fill",
        colors: ["34C759", "00B894"],
        order: 20,
        route: { type: "native", name: "my_groups" },
      },
    ],
  },
];

export const defaultRemoteConfig: RemoteConfig = {
  schemaVersion: 1,
  configVersion: "bundled-default",
  refreshIntervalSeconds: 300,
  featureFlags: [],
  tabs: defaultTabs,
  profileSections: defaultProfileSections,
  contactModules: defaultContactModules,
  webViewPolicy: defaultWebViewPolicy,
  screens: [...bundledDynamicScreens],
  features: defaultFeatures,
};
