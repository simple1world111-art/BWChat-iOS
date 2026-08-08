import { Stack } from "expo-router";

import { ContactsContent } from "@/app/(tabs)/contacts";
import { useLocalization } from "@/providers/LocalizationProvider";

export default function PushedContactsScreen() {
  const { t } = useLocalization();
  return (
    <>
      <Stack.Screen options={{ title: t("tab.contacts") }} />
      <ContactsContent isRootTab={false} />
    </>
  );
}
