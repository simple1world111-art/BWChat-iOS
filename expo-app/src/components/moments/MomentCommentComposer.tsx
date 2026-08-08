import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { MomentCommentTarget } from "@/components/profile/PublicProfileContent";
import { useLocalization } from "@/providers/LocalizationProvider";
import { prepareMomentCommentImage } from "@/services/moments/MomentCommentImageService";
import { colors } from "@/theme";

export interface PreparedMomentCommentImage {
  uri: string;
  filename: string;
}

export function MomentCommentComposer({
  target,
  onClose,
  onSubmit,
  onError,
}: {
  target: MomentCommentTarget;
  onClose: () => void;
  onSubmit: (
    text: string,
    target: MomentCommentTarget,
    image: PreparedMomentCommentImage | null,
  ) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const { t } = useLocalization();
  const [text, setText] = useState("");
  const [image, setImage] = useState<PreparedMomentCommentImage | null>(null);
  const [isPreparingImage, setPreparingImage] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const first = setTimeout(() => inputRef.current?.focus(), 150);
    const second = setTimeout(() => inputRef.current?.focus(), 400);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
    };
  }, []);

  const chooseImage = async () => {
    if (isPreparingImage) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error("需要相册权限才能选择评论图片");
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (result.canceled || !result.assets[0]) return;
      setPreparingImage(true);
      setImage(await prepareMomentCommentImage(result.assets[0]));
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setPreparingImage(false);
    }
  };

  const canSend = text.length > 0 || image !== null;
  const send = () => {
    if (!canSend) return;
    const submittedText = text;
    const submittedImage = image;
    inputRef.current?.blur();
    onClose();
    void onSubmit(submittedText, target, submittedImage);
  };

  return (
    <View style={styles.composer}>
      {target.replyToName ? (
        <View style={styles.replyBar}>
          <SymbolView
            name="arrowshape.turn.up.left.fill"
            size={10}
            tintColor={colors.tertiaryText}
          />
          <Text style={styles.replyName}>{t("reply.to", target.replyToName)}</Text>
          {target.replyContent ? (
            <Text numberOfLines={1} style={styles.replyContent}>
              : {target.replyContent}
            </Text>
          ) : null}
        </View>
      ) : null}

      {image ? (
        <View style={styles.imagePreviewRow}>
          <View>
            <Image contentFit="cover" source={image.uri} style={styles.imagePreview} />
            <Pressable onPress={() => setImage(null)} style={styles.removeImage}>
              <SymbolView
                name="xmark.circle.fill"
                size={16}
                tintColor={colors.white}
              />
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.composerRow}>
        <Pressable
          accessibilityLabel="选择评论图片"
          disabled={isPreparingImage}
          onPress={() => void chooseImage()}
          style={styles.photoButton}
        >
          {isPreparingImage ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <SymbolView name="photo" size={20} tintColor={colors.accent} />
          )}
        </Pressable>
        <TextInput
          autoFocus
          multiline
          onChangeText={setText}
          placeholder={
            target.replyToName
              ? t("reply.placeholder", target.replyToName)
              : t("moments.comment.placeholder")
          }
          placeholderTextColor={colors.tertiaryText}
          ref={inputRef}
          style={styles.commentInput}
          value={text}
        />
        <Pressable
          disabled={!canSend}
          onPress={send}
          style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
        >
          <Text style={styles.sendText}>{t("common.send")}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            inputRef.current?.blur();
            onClose();
          }}
          style={styles.closeButton}
        >
          <SymbolView
            name="xmark.circle.fill"
            size={22}
            tintColor={colors.tertiaryText}
          />
        </Pressable>
      </View>
    </View>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "操作失败，请稍后重试";
}

const styles = StyleSheet.create({
  composer: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 30,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
    backgroundColor: colors.card,
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
  },
  replyBar: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 2,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 6,
  },
  replyName: { color: "#576B95", fontSize: 12, fontWeight: "500" },
  replyContent: { flex: 1, color: colors.secondaryText, fontSize: 12 },
  imagePreviewRow: {
    paddingHorizontal: 14,
    paddingTop: 6,
    alignItems: "flex-start",
  },
  imagePreview: { width: 60, height: 60, borderRadius: 6 },
  removeImage: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  composerRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 10,
  },
  photoButton: {
    width: 22,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  commentInput: {
    minHeight: 40,
    maxHeight: 104,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    color: colors.text,
    backgroundColor: colors.separator,
    fontSize: 16,
    lineHeight: 20,
  },
  sendButton: {
    minWidth: 56,
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  sendButtonDisabled: { backgroundColor: colors.tertiaryText },
  sendText: { color: colors.white, fontSize: 15, fontWeight: "600" },
  closeButton: {
    width: 22,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
