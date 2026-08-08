import { StyleSheet, Text, View } from "react-native";

import { ChatStickerArtwork } from "@/components/messages/ChatStickerArtwork";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  chatStickerArtworkSize,
  chatStickerBubblePolicy,
  localizedChatStickerText,
  parseChatStickerMessagePayload,
} from "@/services/messages/chatStickerPolicy";
import { colors } from "@/theme";

export function ChatStickerBubble({
  content,
  isFromMe,
  senderName,
}: {
  content: string;
  isFromMe: boolean;
  senderName?: string | undefined;
}) {
  const { activeLanguage } = useLocalization();
  const payload = parseChatStickerMessagePayload(content);
  if (!payload) return null;
  const name = localizedChatStickerText(payload.name, activeLanguage) ?? payload.stickerId;
  const size = chatStickerArtworkSize(payload);
  return (
    <View
      accessibilityLabel={name}
      style={[styles.column, isFromMe ? styles.mineColumn : styles.otherColumn]}
    >
      {senderName?.trim() ? <Text numberOfLines={1} style={styles.senderName}>{senderName}</Text> : null}
      <View style={[styles.bubble, isFromMe ? styles.mineBubble : styles.otherBubble]}>
        <ChatStickerArtwork
          accessibilityLabel={name}
          assetKey={payload.assetKey}
          style={{ width: size.width, height: size.height }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { rowGap: chatStickerBubblePolicy.senderSpacing },
  mineColumn: { alignItems: "flex-end" },
  otherColumn: { alignItems: "flex-start" },
  senderName: {
    color: colors.secondaryText,
    fontSize: chatStickerBubblePolicy.senderFontSize,
    fontWeight: "500",
  },
  bubble: {
    padding: chatStickerBubblePolicy.artworkPadding,
    borderRadius: chatStickerBubblePolicy.cornerRadius,
    shadowColor: colors.black,
    shadowOpacity: chatStickerBubblePolicy.shadowOpacity,
    shadowRadius: chatStickerBubblePolicy.shadowRadius,
    shadowOffset: { width: 0, height: chatStickerBubblePolicy.shadowOffsetY },
  },
  mineBubble: { backgroundColor: "rgba(255,255,255,0.18)" },
  otherBubble: { backgroundColor: "rgba(255,255,255,0.72)" },
});
