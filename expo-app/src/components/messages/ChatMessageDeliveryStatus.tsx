import { SymbolView } from "expo-symbols";
import { Pressable, View } from "react-native";

import { useLocalization } from "@/providers/LocalizationProvider";
import { colors } from "@/theme";

export function isPendingChatVoice(deliveryStatus: string | undefined): boolean {
  return deliveryStatus === "sending" || deliveryStatus === "failed";
}

export function ChatMessageDeliveryStatus({
  deliveryStatus,
  messageType,
  onRetry,
}: {
  deliveryStatus: string | undefined;
  messageType: string;
  onRetry: () => void;
}) {
  const { t } = useLocalization();
  if (deliveryStatus === "failed") {
    return (
      <Pressable
        accessibilityLabel={t("common.retry")}
        accessibilityRole="button"
        hitSlop={6}
        onPress={onRetry}
      >
        <SymbolView name="exclamationmark.circle.fill" size={20} tintColor={colors.danger} />
      </Pressable>
    );
  }
  const type = messageType.trim().toLocaleLowerCase();
  if (deliveryStatus === "sending" && (type === "image" || type === "video")) {
    return (
      <View accessibilityLabel={t("common.uploading")} accessibilityRole="text">
        <SymbolView name="clock" size={12} weight="medium" tintColor={colors.secondaryText} />
      </View>
    );
  }
  return null;
}
