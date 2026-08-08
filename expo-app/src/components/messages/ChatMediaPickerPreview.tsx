import { useEvent } from "expo";
import { Image } from "expo-image";
import type { ImagePickerAsset } from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { SymbolView } from "expo-symbols";
import { useVideoPlayer, type VideoThumbnail } from "expo-video";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutAnimation,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useLocalization } from "@/providers/LocalizationProvider";
import { palette } from "@/theme";

export const chatMediaPreviewMetrics = {
  columns: 3,
  gridSpacing: 8,
  gridPadding: 16,
  cellRadius: 10,
  videoThumbnailMaximumSize: 300,
  videoBadgeIconSize: 11,
  videoBadgeHorizontalPadding: 6,
  videoBadgeVerticalPadding: 3,
  videoBadgeInset: 6,
  removeIconSize: 22,
  removeInset: 4,
  removeAnimationDurationMs: 200,
  bottomHorizontalPadding: 16,
  bottomVerticalPadding: 12,
  sendHorizontalPadding: 24,
  sendVerticalPadding: 10,
  sendRadius: 20,
} as const;

export function ChatMediaPickerPreview({
  items,
  visible,
  onCancel,
  onChange,
  onSend,
}: {
  items: ImagePickerAsset[];
  visible: boolean;
  onCancel: () => void;
  onChange: (items: ImagePickerAsset[]) => void;
  onSend: (items: ImagePickerAsset[]) => void;
}) {
  const { t } = useLocalization();
  const theme = palette(useColorScheme());
  const { width } = useWindowDimensions();
  const cellSide = useMemo(
    () => (width - chatMediaPreviewMetrics.gridPadding * 2 - chatMediaPreviewMetrics.gridSpacing * 2) / chatMediaPreviewMetrics.columns,
    [width],
  );

  const remove = (index: number) => {
    const next = items.filter((_, itemIndex) => itemIndex !== index);
    LayoutAnimation.configureNext(LayoutAnimation.create(
      chatMediaPreviewMetrics.removeAnimationDurationMs,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity,
    ));
    onChange(next);
    if (next.length === 0) onCancel();
  };

  const send = () => {
    if (items.length === 0) return;
    const selected = [...items];
    onCancel();
    onSend(selected);
  };

  return (
    <Modal animationType="slide" onRequestClose={onCancel} visible={visible}>
      <SafeAreaView edges={["top", "bottom"]} style={[styles.screen, { backgroundColor: theme.card }]}> 
        <View style={[styles.header, { backgroundColor: theme.card, borderBottomColor: theme.separator }]}>
          <Pressable onPress={onCancel}><Text style={[styles.headerAction, { color: theme.accent }]}>{t("common.cancel")}</Text></Pressable>
          <Text style={[styles.title, { color: theme.text }]}>{t("media.preview.title")}</Text>
          <View style={styles.headerPlaceholder} />
        </View>
        <ScrollView contentContainerStyle={styles.grid}>
          {items.map((item, index) => (
            <MediaPreviewCell
              item={item}
              key={mediaItemKey(item)}
              onRemove={() => remove(index)}
              side={cellSide}
            />
          ))}
        </ScrollView>
        <View style={[styles.bottomBar, { backgroundColor: theme.background, borderTopColor: `${theme.separator}4D` }]}>
          <Text style={[styles.count, { color: theme.secondaryText }]}>{t("media.selected.count", items.length)}</Text>
          <Pressable disabled={items.length === 0} onPress={send}>
            <LinearGradient colors={[theme.accent, theme.accentDark]} end={{ x: 1, y: 1 }} start={{ x: 0, y: 0 }} style={styles.sendButton}>
              <Text style={styles.sendText}>{t("media.send.count", items.length)}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function MediaPreviewCell({ item, side, onRemove }: { item: ImagePickerAsset; side: number; onRemove: () => void }) {
  const { t } = useLocalization();
  const theme = palette(useColorScheme());
  const isVideo = item.type === "video";
  const label = item.fileName?.trim() || (isVideo ? "video" : "image");
  return (
    <View accessibilityLabel={label} style={[styles.cell, { backgroundColor: theme.separator, height: side, width: side }]}>
      {isVideo ? <LocalPickerVideoThumbnail uri={item.uri} /> : <LocalPickerImageThumbnail uri={item.uri} />}
      {isVideo ? (
        <View style={styles.videoBadge}>
          <SymbolView name="video.fill" size={chatMediaPreviewMetrics.videoBadgeIconSize} weight="medium" tintColor="#FFFFFF" />
        </View>
      ) : null}
      <Pressable
        accessibilityLabel={`${label}，${t("common.delete")}`}
        hitSlop={6}
        onPress={onRemove}
        style={styles.remove}
      >
        <SymbolView
          colors={["#FFFFFF", "rgba(0,0,0,0.6)"]}
          name="xmark.circle.fill"
          size={chatMediaPreviewMetrics.removeIconSize}
          type="palette"
        />
      </Pressable>
    </View>
  );
}

function LocalPickerVideoThumbnail({ uri }: { uri: string }) {
  const theme = palette(useColorScheme());
  const player = useVideoPlayer({ uri });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null);

  useEffect(() => {
    if (status !== "readyToPlay" || thumbnail) return;
    let active = true;
    void player.generateThumbnailsAsync(0, {
      maxWidth: chatMediaPreviewMetrics.videoThumbnailMaximumSize,
      maxHeight: chatMediaPreviewMetrics.videoThumbnailMaximumSize,
    }).then(([generated]) => {
      if (!generated) return;
      if (!active) {
        generated.release();
        return;
      }
      setThumbnail(generated);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [player, status, thumbnail]);

  useEffect(() => () => thumbnail?.release(), [thumbnail]);
  return thumbnail
    ? <Image contentFit="cover" source={thumbnail} style={StyleSheet.absoluteFill} transition={0} />
    : <View style={styles.placeholder}><SymbolView name="video.fill" size={22} tintColor={theme.secondaryText} /></View>;
}

function LocalPickerImageThumbnail({ uri }: { uri: string }) {
  const theme = palette(useColorScheme());
  const [failed, setFailed] = useState(false);
  if (failed) return <View style={styles.placeholder}><SymbolView name="photo" size={22} tintColor={theme.secondaryText} /></View>;
  return <Image contentFit="cover" onError={() => setFailed(true)} source={uri} style={StyleSheet.absoluteFill} transition={0} />;
}

function mediaItemKey(item: ImagePickerAsset): string {
  return item.assetId ?? `${item.uri}:${item.fileName ?? ""}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", height: 48, justifyContent: "space-between", paddingHorizontal: 16 },
  headerAction: { fontSize: 15, minWidth: 54 },
  headerPlaceholder: { width: 54 },
  title: { flex: 1, fontSize: 17, fontWeight: "600", textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: chatMediaPreviewMetrics.gridSpacing, padding: chatMediaPreviewMetrics.gridPadding },
  cell: { borderRadius: chatMediaPreviewMetrics.cellRadius, overflow: "hidden" },
  placeholder: { alignItems: "center", flex: 1, justifyContent: "center" },
  videoBadge: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 4, bottom: chatMediaPreviewMetrics.videoBadgeInset, justifyContent: "center", left: chatMediaPreviewMetrics.videoBadgeInset, paddingHorizontal: chatMediaPreviewMetrics.videoBadgeHorizontalPadding, paddingVertical: chatMediaPreviewMetrics.videoBadgeVerticalPadding, position: "absolute" },
  remove: { padding: chatMediaPreviewMetrics.removeInset, position: "absolute", right: 0, top: 0 },
  bottomBar: { alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: chatMediaPreviewMetrics.bottomHorizontalPadding, paddingVertical: chatMediaPreviewMetrics.bottomVerticalPadding },
  count: { fontSize: 14 },
  sendButton: { borderRadius: chatMediaPreviewMetrics.sendRadius, paddingHorizontal: chatMediaPreviewMetrics.sendHorizontalPadding, paddingVertical: chatMediaPreviewMetrics.sendVerticalPadding },
  sendText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
});
