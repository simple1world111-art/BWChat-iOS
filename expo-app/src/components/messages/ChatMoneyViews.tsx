import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useChatMessageActivationGuard } from "@/components/messages/ChatReplyViews";
import type { ChatMoneyPayload, ChatMoneyReceiptPayload } from "@/models";
import { useLocalization } from "@/providers/LocalizationProvider";
import { hasViewerClaimedChatMoney } from "@/services/messages/ChatMoneyRepository";
import {
  chatMoneyBubbleFooterPrompt,
  chatMoneyBubblePolicy,
  chatMoneyBubblePrimary,
  chatMoneyBubbleSecondary,
  chatMoneyTheme,
  isMutedChatMoneyBubble,
  isTerminalChatMoneyStatus,
  localizedChatMoneyReceipt,
  normalizeChatMoneyReceipt,
  parseChatMoneyPayload,
} from "@/services/messages/chatMoneyPolicy";

export function ChatMoneyBubble({
  payload,
  isFromMe,
  viewerId,
  onPress,
}: {
  payload: ChatMoneyPayload;
  isFromMe: boolean;
  viewerId?: string | undefined;
  onPress: () => void;
}) {
  const canActivate = useChatMessageActivationGuard();
  const { t } = useLocalization();
  const ownerId = viewerId?.trim() ?? "";
  const claimLookupKey =
    payload.kind === "red_packet" && ownerId ? `${ownerId}\u0000${payload.asset_id}` : "";
  const [localClaimLookup, setLocalClaimLookup] = useState({
    claimed: false,
    key: "",
  });
  useEffect(() => {
    let active = true;
    if (!claimLookupKey)
      return () => {
        active = false;
      };
    void hasViewerClaimedChatMoney(ownerId, payload.asset_id)
      .then((claimed) => {
        if (active) setLocalClaimLookup({ claimed, key: claimLookupKey });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [claimLookupKey, ownerId, payload.asset_id, payload.status, payload.version]);
  const hasLocalClaim = localClaimLookup.key === claimLookupKey && localClaimLookup.claimed;
  const muted = isMutedChatMoneyBubble(payload, hasLocalClaim);
  const footer = chatMoneyBubbleFooterPrompt(payload, viewerId, t, isFromMe);
  if (payload.kind === "red_packet") {
    return (
      <Pressable
        accessibilityLabel={t("chatMoney.redPacket.detailTitle")}
        accessibilityRole="button"
        onPress={() => {
          if (canActivate()) onPress();
        }}
        style={[styles.card, styles.redPacketCard]}
        testID={`chatMoney.bubble.${payload.asset_id}`}
      >
        <View style={[styles.redPacketTop, muted && styles.mutedTop]}>
          <RedPacketGlyph />
          <Text numberOfLines={2} style={styles.redPacketPrimary}>
            {chatMoneyBubblePrimary(payload, t)}
          </Text>
        </View>
        <View style={[styles.redPacketDivider, muted && styles.mutedDivider]} />
        <View style={[styles.footer, muted && styles.mutedTop]}>
          <Text style={styles.redPacketBrand}>{footer.text}</Text>
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityLabel={t("chatMoney.transfer.detailTitle")}
      accessibilityRole="button"
      onPress={() => {
        if (canActivate()) onPress();
      }}
      style={[styles.card, styles.transferCard]}
      testID={`chatMoney.bubble.${payload.asset_id}`}
    >
      <View style={[styles.transferTop, muted && styles.mutedTop]}>
        <TransferGlyph status={payload.status} />
        <View style={styles.transferCopy}>
          <Text numberOfLines={1} style={styles.transferPrimary}>
            {chatMoneyBubblePrimary(payload, t)}
          </Text>
          <Text numberOfLines={1} style={styles.transferSecondary}>
            {chatMoneyBubbleSecondary(payload, viewerId, t, isFromMe)}
          </Text>
        </View>
      </View>
      <View style={styles.transferFooter}>
        <Text style={styles.transferBrand}>{t("chatMoney.transfer.brand")}</Text>
        <Text
          numberOfLines={1}
          style={[styles.transferPrompt, footer.actionable && styles.transferPromptAction]}
        >
          {footer.text}
        </Text>
      </View>
    </Pressable>
  );
}

export function ChatMoneyContentBubble({
  content,
  isFromMe,
  viewerId,
  onPress,
}: {
  content: string;
  isFromMe: boolean;
  viewerId?: string | undefined;
  onPress: (payload: ChatMoneyPayload) => void;
}) {
  const payload = parseChatMoneyPayload(content);
  return payload ? (
    <ChatMoneyBubble
      isFromMe={isFromMe}
      onPress={() => onPress(payload)}
      payload={payload}
      viewerId={viewerId}
    />
  ) : null;
}

export function ChatMoneyReceiptTip({
  content,
  viewerId,
}: {
  content: string;
  viewerId?: string | undefined;
}) {
  const receipt = normalizeChatMoneyReceipt(content);
  return receipt ? <ChatMoneyReceiptTipPayload payload={receipt} viewerId={viewerId} /> : null;
}

export function ChatMoneyReceiptTipPayload({
  payload,
  viewerId,
}: {
  payload: ChatMoneyReceiptPayload;
  viewerId?: string | undefined;
}) {
  const { t } = useLocalization();
  const appearance = receiptAppearance(payload);
  return (
    <View style={styles.receiptOuter} testID={`chatMoney.receipt.${payload.event_id}`}>
      <View style={[styles.receiptTip, { backgroundColor: appearance.backgroundColor }]}>
        {appearance.symbol ? (
          <SymbolView
            name={appearance.symbol}
            size={12}
            weight="semibold"
            tintColor={appearance.color}
          />
        ) : null}
        <Text style={[styles.receiptText, { color: appearance.color }]}>
          {localizedChatMoneyReceipt(payload, viewerId, t)}
        </Text>
      </View>
    </View>
  );
}

export function ChatMoneyPlusMenuGlyph({ kind }: { kind: "red_packet" | "transfer" }) {
  if (kind === "transfer") {
    return (
      <SymbolView name="arrow.left.arrow.right" size={22} weight="medium" tintColor="#111111" />
    );
  }
  return (
    <View style={styles.plusEnvelope}>
      <View style={styles.plusFlap} />
      <View style={styles.plusCoin}>
        <Text style={styles.plusCoinText}>¥</Text>
      </View>
    </View>
  );
}

function RedPacketGlyph() {
  return (
    <View style={styles.redGlyphFrame}>
      <View style={styles.redGlyph}>
        <View style={styles.redGlyphFold} />
        <View style={styles.redGlyphCoin}>
          <SymbolView
            name="pawprint.fill"
            size={8}
            weight="bold"
            tintColor={chatMoneyTheme.envelopeDarkRed}
          />
        </View>
      </View>
    </View>
  );
}

function TransferGlyph({ status }: { status: ChatMoneyPayload["status"] }) {
  const symbol: SFSymbol =
    status === "accepted"
      ? "checkmark"
      : status === "returned" || status === "expired_refunded"
        ? "arrow.uturn.backward"
        : "arrow.left.arrow.right";
  const terminal = isTerminalChatMoneyStatus(status);
  return (
    <View style={styles.transferGlyph}>
      <SymbolView
        name={symbol}
        size={19}
        weight="medium"
        tintColor={terminal ? "#FFFFFF" : "#F8D9A0"}
      />
    </View>
  );
}

function receiptAppearance(payload: ChatMoneyReceiptPayload): {
  color: string;
  backgroundColor: string;
  symbol: SFSymbol | null;
} {
  if (payload.event_type === "transfer_accepted") {
    return {
      color: chatMoneyTheme.accepted,
      backgroundColor: "rgba(7,138,69,0.10)",
      symbol: "checkmark.circle.fill",
    };
  }
  if (
    payload.event_type === "transfer_returned" ||
    payload.event_type === "asset_expired_refunded"
  ) {
    return {
      color: chatMoneyTheme.returned,
      backgroundColor: "rgba(127,127,127,0.10)",
      symbol: "arrow.uturn.backward.circle.fill",
    };
  }
  return { color: "#999999", backgroundColor: "rgba(0,0,0,0.06)", symbol: null };
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    width: chatMoneyBubblePolicy.width,
  },
  redPacketCard: { borderRadius: chatMoneyBubblePolicy.redPacketRadius },
  transferCard: { borderRadius: chatMoneyBubblePolicy.transferRadius },
  redPacketTop: {
    alignItems: "center",
    backgroundColor: chatMoneyTheme.cardOrange,
    borderTopLeftRadius: chatMoneyBubblePolicy.redPacketRadius,
    borderTopRightRadius: chatMoneyBubblePolicy.redPacketRadius,
    flexDirection: "row",
    gap: chatMoneyBubblePolicy.redPacketGap,
    height: chatMoneyBubblePolicy.redPacketTopHeight,
    paddingHorizontal: chatMoneyBubblePolicy.redPacketHorizontalPadding,
  },
  mutedTop: { backgroundColor: chatMoneyTheme.cardMutedOrange },
  redPacketDivider: {
    backgroundColor: "rgba(255,255,255,0.22)",
    height: 0.5,
    marginHorizontal: 10,
    position: "absolute",
    top: chatMoneyBubblePolicy.redPacketTopHeight,
    width: chatMoneyBubblePolicy.width - 20,
    zIndex: 2,
  },
  mutedDivider: { backgroundColor: "rgba(255,255,255,0.18)" },
  footer: {
    backgroundColor: chatMoneyTheme.cardOrange,
    borderBottomLeftRadius: chatMoneyBubblePolicy.redPacketRadius,
    borderBottomRightRadius: chatMoneyBubblePolicy.redPacketRadius,
    height: chatMoneyBubblePolicy.redPacketFooterHeight,
    justifyContent: "center",
    paddingHorizontal: 11,
  },
  redPacketBrand: { color: "rgba(255,255,255,0.88)", fontSize: 11 },
  redPacketPrimary: { color: "#FFFFFF", flex: 1, fontSize: 17, fontWeight: "500" },
  redGlyph: {
    alignItems: "center",
    backgroundColor: chatMoneyTheme.envelopeDarkRed,
    borderRadius: 4,
    height: chatMoneyBubblePolicy.redPacketGlyphHeight,
    justifyContent: "center",
    overflow: "hidden",
    width: 42,
  },
  redGlyphFrame: {
    alignItems: "center",
    height: chatMoneyBubblePolicy.redPacketGlyphHeight,
    justifyContent: "center",
    width: chatMoneyBubblePolicy.redPacketGlyphWidth,
  },
  redGlyphFold: {
    borderBottomColor: "rgba(255,255,255,0.16)",
    borderBottomWidth: 1,
    borderLeftColor: "transparent",
    borderLeftWidth: 22,
    borderRightColor: "transparent",
    borderRightWidth: 22,
    height: 11,
    position: "absolute",
    top: 0,
  },
  redGlyphCoin: {
    alignItems: "center",
    backgroundColor: chatMoneyTheme.gold,
    borderRadius: 9,
    height: 17,
    justifyContent: "center",
    width: 17,
  },
  transferTop: {
    alignItems: "center",
    backgroundColor: chatMoneyTheme.cardOrange,
    borderTopLeftRadius: chatMoneyBubblePolicy.transferRadius,
    borderTopRightRadius: chatMoneyBubblePolicy.transferRadius,
    flexDirection: "row",
    gap: chatMoneyBubblePolicy.transferGap,
    height: chatMoneyBubblePolicy.transferTopHeight,
    paddingHorizontal: chatMoneyBubblePolicy.transferHorizontalPadding,
  },
  transferGlyph: {
    alignItems: "center",
    borderColor: "#F8D9A0",
    borderRadius: chatMoneyBubblePolicy.transferGlyphSize / 2,
    borderWidth: 2,
    height: chatMoneyBubblePolicy.transferGlyphSize,
    justifyContent: "center",
    width: chatMoneyBubblePolicy.transferGlyphSize,
  },
  transferCopy: { flex: 1, gap: 5 },
  transferPrimary: { color: "#FFFFFF", fontSize: 16, fontWeight: "500" },
  transferSecondary: { color: "rgba(255,255,255,0.86)", fontSize: 12 },
  transferFooter: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderBottomLeftRadius: chatMoneyBubblePolicy.transferRadius,
    borderBottomRightRadius: chatMoneyBubblePolicy.transferRadius,
    flexDirection: "row",
    gap: 8,
    height: chatMoneyBubblePolicy.transferFooterHeight,
    paddingHorizontal: 10,
  },
  transferBrand: { color: "#999999", fontSize: 10 },
  transferPrompt: { color: "#999999", flex: 1, fontSize: 11, textAlign: "right" },
  transferPromptAction: { color: chatMoneyTheme.actionRed, fontWeight: "500" },
  receiptOuter: { alignItems: "center", paddingVertical: 3 },
  receiptTip: {
    alignItems: "center",
    borderRadius: 4,
    flexDirection: "row",
    gap: 6,
    maxWidth: "82%",
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  receiptText: { fontSize: 12, textAlign: "center" },
  plusEnvelope: {
    alignItems: "center",
    backgroundColor: "#111111",
    borderRadius: 3,
    height: 28,
    justifyContent: "center",
    width: 23,
  },
  plusFlap: {
    borderColor: "#FFFFFF",
    borderRadius: 2,
    borderWidth: 1.5,
    height: 7,
    position: "absolute",
    top: -1,
    width: 21,
  },
  plusCoin: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 4.5,
    height: 9,
    justifyContent: "center",
    marginTop: 6,
    width: 9,
  },
  plusCoinText: { color: "#111111", fontSize: 5, fontWeight: "700" },
});
