import { Stack } from "expo-router";

import MapScreen from "@/app/(tabs)/map";
import { useLocalization } from "@/providers/LocalizationProvider";

export default function NearbyScreen() {
  const { t } = useLocalization();
  return (
    <>
      <Stack.Screen options={{ title: t("tab.map") }} />
      <MapScreen />
    </>
  );
}
