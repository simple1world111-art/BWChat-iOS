import { LinearGradient } from "expo-linear-gradient";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";

import { useLocalization } from "@/providers/LocalizationProvider";
import {
  localizedChatCallRecord,
  type ChatCallRecord,
} from "@/services/messages/chatCallRecordPolicy";
import { colors } from "@/theme";

export function ChatCallRecordBubble({
  isFromMe,
  record,
}: {
  isFromMe: boolean;
  record: ChatCallRecord;
}) {
  const { t } = useLocalization();
  const detail = localizedChatCallRecord(record, isFromMe, t);
  const foreground = isFromMe ? colors.white : colors.text;
  const content = (
    <>
      <Text numberOfLines={2} style={[styles.detail, { color: foreground }]}>
        {detail}
      </Text>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.iconFrame}
      >
        <SymbolView
          name={(record.callType === "video" ? "video.fill" : "phone.fill") as SFSymbol}
          size={20}
          weight="medium"
          tintColor={foreground}
        />
      </View>
    </>
  );
  if (isFromMe) {
    return (
      <LinearGradient
        accessibilityLabel={detail}
        colors={[colors.accent, colors.accentDark]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={[styles.bubble, styles.mineBubble]}
      >
        {content}
      </LinearGradient>
    );
  }
  return (
    <View accessibilityLabel={detail} style={[styles.bubble, styles.otherBubble]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignItems: "center",
    borderRadius: 18,
    columnGap: 10,
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  mineBubble: { borderBottomRightRadius: 0 },
  otherBubble: { backgroundColor: colors.card, borderBottomLeftRadius: 0 },
  detail: { fontSize: 16 },
  iconFrame: { alignItems: "center", height: 28, justifyContent: "center", width: 28 },
});
