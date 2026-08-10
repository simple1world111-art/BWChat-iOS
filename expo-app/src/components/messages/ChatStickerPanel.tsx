import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ChatStickerArtwork } from "@/components/messages/ChatStickerArtwork";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import {
  chatEmojiInsertionValue,
  chatEmojiItemName,
  chatStickerItemName,
  chatStickerPackName,
  chatStickerPanelPolicy,
  effectiveChatStickerPacks,
  isChatEmojiPack,
  sortedChatEmojiItems,
  sortedChatStickerItems,
  type ChatStickerItem,
  type ChatStickerPack,
} from "@/services/messages/chatStickerPolicy";
import { colors } from "@/theme";

export function ChatStickerPanel({
  onInsertEmoji,
  onSendSticker,
}: {
  onInsertEmoji: (value: string) => void;
  onSendSticker: (pack: ChatStickerPack, sticker: ChatStickerItem) => void;
}) {
  const { activeLanguage, t } = useLocalization();
  const { config, source, refresh } = useRemoteConfig();
  const packs = useMemo(
    () => effectiveChatStickerPacks(config.stickerPacks),
    [config.stickerPacks],
  );
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const selectedPack = packs.find((pack) => pack.id === selectedPackId) ?? packs[0] ?? null;
  const refreshed = useRef(false);
  const [panelWidth, setPanelWidth] = useState(0);

  useEffect(() => {
    if (refreshed.current) return;
    if (source !== "bundled" && !packs.every((pack) => pack.id === "emoji_default")) return;
    refreshed.current = true;
    void refresh({ ignoreETag: true });
  }, [packs, refresh, source]);

  const onLayout = (event: LayoutChangeEvent) => setPanelWidth(event.nativeEvent.layout.width);
  return (
    <View onLayout={onLayout} style={styles.panel}>
      {packs.length === 0 ? (
        <View style={styles.emptyState}>
          <SymbolView
            name="face.smiling"
            size={chatStickerPanelPolicy.emptyIconSize}
            tintColor={colors.tertiaryText}
          />
          <Text style={styles.emptyText}>{t("chat.stickers.empty")}</Text>
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={styles.tabs}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {packs.map((pack) => {
              const selected = selectedPack?.id === pack.id;
              const packName = chatStickerPackName(pack, activeLanguage);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={pack.id}
                  onPress={() => setSelectedPackId(pack.id)}
                  style={[styles.tab, selected && styles.selectedTab]}
                >
                  {isChatEmojiPack(pack) && pack.coverEmoji?.trim() ? (
                    <Text style={styles.tabEmoji}>{pack.coverEmoji}</Text>
                  ) : pack.coverAssetKey?.trim() ? (
                    <ChatStickerArtwork
                      accessibilityLabel={packName}
                      assetKey={pack.coverAssetKey}
                      style={styles.tabArtwork}
                    />
                  ) : null}
                  <Text style={[styles.tabName, selected && styles.selectedTabName]}>
                    {packName}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.divider} />
          {selectedPack ? (
            isChatEmojiPack(selectedPack) ? (
              <EmojiGrid
                language={activeLanguage}
                onInsertEmoji={onInsertEmoji}
                pack={selectedPack}
                panelWidth={panelWidth}
              />
            ) : (
              <StickerGrid
                language={activeLanguage}
                onSendSticker={onSendSticker}
                pack={selectedPack}
                panelWidth={panelWidth}
              />
            )
          ) : null}
        </>
      )}
    </View>
  );
}

function EmojiGrid({
  language,
  onInsertEmoji,
  pack,
  panelWidth,
}: {
  language: string;
  onInsertEmoji: (value: string) => void;
  pack: ChatStickerPack;
  panelWidth: number;
}) {
  const items = sortedChatEmojiItems(pack);
  const width = gridItemWidth(
    panelWidth,
    chatStickerPanelPolicy.emojiHorizontalPadding,
    chatStickerPanelPolicy.emojiColumns,
    chatStickerPanelPolicy.emojiColumnSpacing,
  );
  return (
    <ScrollView
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustKeyboardInsets={false}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={styles.emojiGrid}
      style={styles.gridScroll}
    >
      {items.map((item) => {
        const value = chatEmojiInsertionValue(item) ?? "";
        return (
          <Pressable
            accessibilityLabel={chatEmojiItemName(item, language)}
            key={item.id}
            onPress={() => onInsertEmoji(value)}
            style={[styles.emojiItem, { width }]}
          >
            <Text style={styles.emojiText}>{value}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function StickerGrid({
  language,
  onSendSticker,
  pack,
  panelWidth,
}: {
  language: string;
  onSendSticker: (pack: ChatStickerPack, sticker: ChatStickerItem) => void;
  pack: ChatStickerPack;
  panelWidth: number;
}) {
  const items = sortedChatStickerItems(pack);
  const width = gridItemWidth(
    panelWidth,
    chatStickerPanelPolicy.stickerPadding,
    chatStickerPanelPolicy.stickerColumns,
    chatStickerPanelPolicy.stickerColumnSpacing,
  );
  return (
    <ScrollView
      automaticallyAdjustContentInsets={false}
      automaticallyAdjustKeyboardInsets={false}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={styles.stickerGrid}
      style={styles.gridScroll}
    >
      {items.map((item) => {
        const itemName = chatStickerItemName(item, language);
        return (
          <Pressable
            accessibilityLabel={itemName}
            key={item.id}
            onPress={() => onSendSticker(pack, item)}
            style={[styles.stickerItem, { width }]}
          >
            <ChatStickerArtwork
              accessibilityLabel={itemName}
              assetKey={item.assetKey}
              style={styles.stickerArtwork}
            />
            <Text numberOfLines={1} style={styles.stickerName}>
              {itemName}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function gridItemWidth(
  panelWidth: number,
  padding: number,
  columns: number,
  spacing: number,
): number {
  if (panelWidth <= 0) return 0;
  return (panelWidth - padding * 2 - spacing * (columns - 1)) / columns;
}

const styles = StyleSheet.create({
  panel: {
    height: chatStickerPanelPolicy.preferredHeight,
    minHeight: chatStickerPanelPolicy.minimumHeight,
    backgroundColor: "rgba(242,242,247,0.98)",
  },
  emptyState: {
    flex: 1,
    rowGap: chatStickerPanelPolicy.emptySpacing,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { color: colors.secondaryText, fontSize: chatStickerPanelPolicy.emptyTextFontSize },
  tabs: {
    paddingHorizontal: chatStickerPanelPolicy.tabHorizontalPadding,
    paddingVertical: chatStickerPanelPolicy.tabVerticalPadding,
    columnGap: chatStickerPanelPolicy.tabSpacing,
  },
  tab: {
    height: chatStickerPanelPolicy.tabHeight,
    paddingHorizontal: chatStickerPanelPolicy.tabItemHorizontalPadding,
    borderRadius: 999,
    columnGap: chatStickerPanelPolicy.tabContentSpacing,
    flexDirection: "row",
    alignItems: "center",
  },
  selectedTab: { backgroundColor: "rgba(102,126,234,0.12)" },
  tabEmoji: { fontSize: chatStickerPanelPolicy.tabEmojiFontSize },
  tabArtwork: {
    width: chatStickerPanelPolicy.tabArtworkSize,
    height: chatStickerPanelPolicy.tabArtworkSize,
  },
  tabName: { color: colors.secondaryText, fontSize: chatStickerPanelPolicy.tabNameFontSize },
  selectedTabName: { color: colors.accent, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  gridScroll: { flex: 1 },
  emojiGrid: {
    alignContent: "flex-start",
    paddingHorizontal: chatStickerPanelPolicy.emojiHorizontalPadding,
    paddingVertical: chatStickerPanelPolicy.emojiVerticalPadding,
    columnGap: chatStickerPanelPolicy.emojiColumnSpacing,
    rowGap: chatStickerPanelPolicy.emojiRowSpacing,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  emojiItem: {
    minHeight: chatStickerPanelPolicy.emojiMinimumHeight,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiText: { fontSize: chatStickerPanelPolicy.emojiFontSize },
  stickerGrid: {
    alignContent: "flex-start",
    padding: chatStickerPanelPolicy.stickerPadding,
    columnGap: chatStickerPanelPolicy.stickerColumnSpacing,
    rowGap: chatStickerPanelPolicy.stickerRowSpacing,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  stickerItem: {
    minHeight: chatStickerPanelPolicy.stickerMinimumHeight,
    rowGap: chatStickerPanelPolicy.stickerLabelSpacing,
    alignItems: "center",
  },
  stickerArtwork: {
    width: chatStickerPanelPolicy.stickerArtworkSize,
    height: chatStickerPanelPolicy.stickerArtworkSize,
  },
  stickerName: {
    width: "100%",
    color: colors.secondaryText,
    fontSize: chatStickerPanelPolicy.stickerLabelFontSize,
    textAlign: "center",
  },
});
