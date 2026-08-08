import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";

import ConversationsScreen from "@/app/(tabs)/conversations";
import DiscoverScreen from "@/app/(tabs)/discover";
import MapScreen from "@/app/(tabs)/map";
import ProfileScreen from "@/app/(tabs)/profile";
import { DynamicScreenContent } from "@/app/dynamic-screen/[id]";
import { InAppWebContent } from "@/app/in-app-web";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import {
  mainTabDescriptorTitle,
  resolveDynamicMainTabRoot,
  resolveMainTabEntries,
} from "@/services/main-tab/MainTabRegistry";
import { effectiveTabs } from "@/services/remote-config/RemoteConfigService";
import type { DynamicTabDescriptor } from "@/services/remote-config/types";
import { colors } from "@/theme";

export function DynamicMainTabSlotRoot({ slotIndex }: { slotIndex: number }) {
  const { config } = useRemoteConfig();
  const entry = resolveMainTabEntries(effectiveTabs(config)).find(
    (candidate) => candidate.slotIndex === slotIndex,
  );
  return entry ? <DynamicMainTabDescriptorRoot descriptor={entry.descriptor} /> : null;
}

export function DynamicMainTabDescriptorRoot({ descriptor }: { descriptor: DynamicTabDescriptor }) {
  const { config } = useRemoteConfig();
  const { activeLanguage, t } = useLocalization();
  const title = mainTabDescriptorTitle(descriptor, descriptor.id, activeLanguage, t);
  const resolution = resolveDynamicMainTabRoot(descriptor, config.webViewPolicy);

  if (resolution.kind === "native") {
    switch (resolution.name) {
      case "messages":
        return <ConversationsScreen />;
      case "map":
      case "nearby":
        return <MapScreen />;
      case "discover":
        return <DiscoverScreen />;
      case "profile":
        return <ProfileScreen />;
    }
  }
  if (resolution.kind === "screen") {
    return (
      <DynamicScreenContent
        fallbackTitle={title}
        isTabRoot
        key={`${descriptor.id}:${resolution.screenId}`}
        screenId={resolution.screenId}
      />
    );
  }
  if (resolution.kind === "web") {
    return (
      <InAppWebContent
        isTabRoot
        key={`${descriptor.id}:${resolution.url}`}
        params={{ title, url: resolution.url }}
      />
    );
  }
  return <DynamicTabPlaceholder title={title} />;
}

export function DynamicTabPlaceholder({ title }: { title: string }) {
  const { t } = useLocalization();
  return (
    <View style={styles.placeholder}>
      <SymbolView
        accessibilityElementsHidden
        accessible={false}
        name="sparkles.rectangle.stack"
        size={38}
        weight="semibold"
        tintColor={colors.tertiaryText}
      />
      <Text style={styles.placeholderTitle}>{title}</Text>
      <Text style={styles.placeholderMessage}>{t("discover.comingSoon")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    rowGap: 14,
    backgroundColor: colors.background,
  },
  placeholderTitle: { color: colors.text, fontSize: 17, fontWeight: "600" },
  placeholderMessage: { color: colors.secondaryText, fontSize: 14 },
});
