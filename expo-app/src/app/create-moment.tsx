import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  type ColorSchemeName,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";

import { createIdempotencyKey } from "@/api/bwchat";
import { TopToast } from "@/components/TopToast";
import type { User } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  canPublishMoment,
  createMomentPolicy,
  momentContentLength,
  truncateMomentContent,
} from "@/services/moments/CreateMomentPolicy";
import {
  prepareMomentImage,
  prepareMomentVideo,
  removeMomentDraft,
  type PreparedMomentMedia,
} from "@/services/moments/MomentMediaPreparation";
import { enqueueMomentUpload } from "@/services/moments/MomentUploadQueue";
import { colors } from "@/theme";

export default function CreateMomentScreen() {
  const { user } = useAuth();
  const ownerId = user?.user_id.trim() || "anonymous";
  const currentOwnerIdRef = useRef(ownerId);
  useLayoutEffect(() => {
    currentOwnerIdRef.current = ownerId;
  }, [ownerId]);

  // An owner change must replace the entire draft component. Besides clearing
  // visible state, this makes late picker/publish continuations belong only to
  // the component instance (and account) that started them.
  return (
    <CreateMomentComposer
      key={ownerId}
      isOwnerCurrent={() => currentOwnerIdRef.current === ownerId}
      ownerId={ownerId}
      user={user}
    />
  );
}

export function CreateMomentComposer({
  isOwnerCurrent,
  ownerId,
  user,
}: {
  isOwnerCurrent: () => boolean;
  ownerId: string;
  user: User | null;
}) {
  const { t } = useLocalization();
  const theme = createMomentPalette(useColorScheme());
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { width } = useWindowDimensions();
  const [draftId] = useState(createIdempotencyKey);
  const activeRef = useRef(true);
  const preserveDraftRef = useRef(false);
  const importGenerationRef = useRef(0);
  const importingRef = useRef(false);
  const publishingRef = useRef(false);
  const [content, setContent] = useState("");
  const [media, setMedia] = useState<PreparedMomentMedia[]>([]);
  const [unlockPrice, setUnlockPrice] = useState<number | undefined>();
  const [isImporting, setImporting] = useState(false);
  const [isPublishing, setPublishing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const tileSize = Math.min(96, Math.floor((width - 32 - 36 - 20) / 3));
  const canPublish = canPublishMoment(content, media, isImporting);
  const publishDisabled = !canPublish || isPublishing;
  const isDraftCurrent = () => activeRef.current && isOwnerCurrent();

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      importGenerationRef.current += 1;
      if (!preserveDraftRef.current) removeMomentDraft(ownerId, draftId);
    };
  }, [draftId, ownerId]);

  const pickImages = async () => {
    if (importingRef.current) return;
    if (media.some((item) => item.kind === "video")) {
      setToastMessage(t("moment.media.error.mixedTypes"));
      return;
    }
    const remaining = createMomentPolicy.maximumImageCount - media.length;
    if (remaining <= 0) {
      setToastMessage(t("moment.media.error.tooManyImages", createMomentPolicy.maximumImageCount));
      return;
    }
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!isDraftCurrent()) return;
      if (!permission.granted) throw new Error(t("media.photoPermissionRequired"));
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 1,
      });
      if (!isDraftCurrent() || result.canceled) return;
      const generation = importGenerationRef.current + 1;
      importGenerationRef.current = generation;
      importingRef.current = true;
      setImporting(true);
      const loaded: PreparedMomentMedia[] = [];
      for (const [index, asset] of result.assets.slice(0, remaining).entries()) {
        try {
          loaded.push(await prepareMomentImage(ownerId, draftId, asset, media.length + index));
        } catch {
          // Native PhotosPicker keeps every successfully decoded selection.
        }
      }
      if (!isDraftCurrent() || generation !== importGenerationRef.current) {
        removeMomentDraft(ownerId, draftId);
        return;
      }
      if (loaded.length === 0) setToastMessage(t("moment.media.error.loadFailed"));
      else setMedia((current) => [...current, ...loaded].slice(0, 9));
    } catch (error) {
      if (isDraftCurrent()) setToastMessage(errorMessage(error));
    } finally {
      importingRef.current = false;
      if (isDraftCurrent()) setImporting(false);
    }
  };

  const pickVideo = async () => {
    if (importingRef.current) return;
    if (media.length > 0) {
      setToastMessage(t("moment.media.error.mixedTypes"));
      return;
    }
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!isDraftCurrent()) return;
      if (!permission.granted) throw new Error(t("media.videoPermissionRequired"));
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (!isDraftCurrent() || result.canceled || !result.assets[0]) return;
      const generation = importGenerationRef.current + 1;
      importGenerationRef.current = generation;
      importingRef.current = true;
      setImporting(true);
      const prepared = await prepareMomentVideo(ownerId, draftId, result.assets[0]);
      if (!isDraftCurrent() || generation !== importGenerationRef.current) {
        removeMomentDraft(ownerId, draftId);
        return;
      }
      setMedia([prepared]);
    } catch (error) {
      if (isDraftCurrent()) setToastMessage(errorMessage(error));
    } finally {
      importingRef.current = false;
      if (isDraftCurrent()) setImporting(false);
    }
  };

  const chooseUnlockPrice = () => {
    Keyboard.dismiss();
    const labels = [
      t("moment.unlock.none"),
      ...createMomentPolicy.unlockPrices.map((price) => t("moment.unlock.price", price)),
      t("common.cancel"),
    ];
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: t("moment.goldCoinUnlock"),
          options: labels,
          cancelButtonIndex: labels.length - 1,
        },
        (index) => {
          if (index === 0) setUnlockPrice(undefined);
          else if (index > 0 && index <= createMomentPolicy.unlockPrices.length) {
            setUnlockPrice(createMomentPolicy.unlockPrices[index - 1]);
          }
        },
      );
      return;
    }
    Alert.alert(
      t("moment.goldCoinUnlock"),
      undefined,
      labels.map((label, index) => ({
        text: label,
        style: index === labels.length - 1 ? "cancel" : "default",
        onPress: () => {
          if (index === 0) setUnlockPrice(undefined);
          else if (index <= createMomentPolicy.unlockPrices.length) {
            setUnlockPrice(createMomentPolicy.unlockPrices[index - 1]);
          }
        },
      })),
    );
  };

  const publish = async () => {
    if (!canPublish || !user || publishingRef.current) return;
    publishingRef.current = true;
    Keyboard.dismiss();
    preserveDraftRef.current = true;
    setPublishing(true);
    try {
      await enqueueMomentUpload({
        owner: user,
        clientRequestId: draftId,
        content: content.trim(),
        media: media.map(({ kind, uri, preview_uri, filename, mime_type }) => ({
          kind,
          uri,
          preview_uri,
          filename,
          mime_type,
        })),
        ...(media.length > 0 && unlockPrice ? { unlockPriceGoldCoins: unlockPrice } : {}),
      });
      if (isDraftCurrent()) router.back();
    } catch (error) {
      preserveDraftRef.current = false;
      if (isDraftCurrent()) setToastMessage(errorMessage(error));
      else removeMomentDraft(ownerId, draftId);
    } finally {
      publishingRef.current = false;
      if (isDraftCurrent()) setPublishing(false);
    }
  };

  const goBack = () => {
    if (isPublishing) return;
    Keyboard.dismiss();
    router.back();
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: t("moment.create.title"),
          gestureEnabled: !isPublishing,
          headerBackVisible: false,
          headerStyle: { backgroundColor: "#F7F7F7" },
          headerTintColor: colors.text,
          headerLeft: () => (
            <Pressable
              accessibilityLabel={t("common.back")}
              accessibilityRole="button"
              accessibilityState={{ disabled: isPublishing }}
              disabled={isPublishing}
              hitSlop={8}
              onPress={goBack}
              style={styles.headerButton}
            >
              <SymbolView name="chevron.left" size={17} weight="semibold" tintColor={colors.text} />
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              accessibilityLabel={t("common.publish")}
              accessibilityRole="button"
              accessibilityState={{
                busy: isPublishing,
                disabled: publishDisabled,
              }}
              disabled={publishDisabled}
              onPress={() => void publish()}
              style={[styles.headerButton, !canPublish && styles.publishDisabled]}
            >
              <SymbolView
                name="paperplane.fill"
                size={16}
                weight="semibold"
                tintColor={canPublish ? colors.accent : theme.tertiaryText}
              />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.textSection}>
            {content.length === 0 ? (
              <Text pointerEvents="none" style={styles.placeholder}>
                {t("moment.content.placeholder")}
              </Text>
            ) : null}
            <TextInput
              accessibilityLabel={t("moment.content.placeholder")}
              multiline
              onChangeText={(value) => setContent(truncateMomentContent(value))}
              style={styles.textInput}
              textAlignVertical="top"
              value={content}
            />
            <Text accessibilityLiveRegion="polite" style={styles.count}>
              {momentContentLength(content)}/{createMomentPolicy.maximumContentLength}
            </Text>
          </View>

          <View style={styles.cardDivider} />

          <View onTouchStart={Keyboard.dismiss} style={styles.mediaSection}>
            <View style={styles.mediaGrid}>
              {media.map((item, index) => (
                <View
                  accessibilityLabel={`${item.kind === "image" ? t("moment.addImage") : t("moment.addVideo")} ${index + 1}`}
                  key={item.id}
                  style={[styles.mediaTile, { width: tileSize, height: tileSize }]}
                >
                  <View style={styles.mediaPreview}>
                    <Image
                      contentFit="cover"
                      source={item.preview_uri}
                      style={StyleSheet.absoluteFill}
                      transition={0}
                    />
                    {item.kind === "video" ? (
                      <SymbolView name="play.circle.fill" size={25} tintColor={colors.white} />
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityLabel={`${t("common.delete")} ${index + 1}`}
                    accessibilityRole="button"
                    disabled={isImporting}
                    onPress={() =>
                      setMedia((current) => current.filter((candidate) => candidate.id !== item.id))
                    }
                    style={styles.removeMedia}
                  >
                    <SymbolView name="xmark.circle.fill" size={20} tintColor={colors.white} />
                  </Pressable>
                </View>
              ))}

              {media.length === 0 || (media[0]?.kind === "image" && media.length < 9) ? (
                <AddMediaTile
                  icon="photo.on.rectangle.angled"
                  isLoading={isImporting}
                  onPress={() => void pickImages()}
                  size={tileSize}
                  styles={styles}
                  title={media.length === 0 ? t("moment.addImage") : t("moment.continueAddImage")}
                />
              ) : null}
              {media.length === 0 ? (
                <AddMediaTile
                  icon="video.fill"
                  isLoading={isImporting}
                  onPress={() => void pickVideo()}
                  size={tileSize}
                  styles={styles}
                  title={t("moment.addVideo")}
                />
              ) : null}
            </View>
            <Text style={styles.mediaHint}>{t("moment.media.limitHint")}</Text>
          </View>

          <View style={styles.cardDivider} />

          <Pressable
            accessibilityLabel={`${t("moment.goldCoinUnlock")}，${
              unlockPrice ? t("moment.unlock.price", unlockPrice) : t("moment.unlock.none")
            }`}
            accessibilityRole="button"
            onPress={chooseUnlockPrice}
            style={styles.settingRow}
          >
            <SymbolView
              name="takeoutbag.and.cup.and.straw.fill"
              size={21}
              weight="medium"
              tintColor={theme.text}
            />
            <Text style={styles.settingTitle}>{t("moment.goldCoinUnlock")}</Text>
            <View style={styles.settingSpacer} />
            <Text numberOfLines={1} style={styles.settingValue}>
              {unlockPrice ? t("moment.unlock.price", unlockPrice) : t("moment.unlock.none")}
            </Text>
            <SymbolView name="chevron.right" size={15} weight="semibold" tintColor={theme.text} />
          </Pressable>
        </View>
      </ScrollView>
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </View>
  );
}

type CreateMomentStyles = ReturnType<typeof createStyles>;

function AddMediaTile({
  icon,
  title,
  size,
  isLoading,
  onPress,
  styles,
}: {
  icon: "photo.on.rectangle.angled" | "video.fill";
  title: string;
  size: number;
  isLoading: boolean;
  onPress: () => void;
  styles: CreateMomentStyles;
}) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ busy: isLoading, disabled: isLoading }}
      disabled={isLoading}
      onPress={onPress}
      style={[styles.addTile, { width: size, height: size }]}
    >
      {isLoading ? (
        <ActivityIndicator color={colors.text} size="small" />
      ) : (
        <SymbolView name={icon} size={27} tintColor={colors.text} />
      )}
      <Text numberOfLines={1} style={styles.addTitle}>
        {title}
      </Text>
    </Pressable>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "操作失败，请稍后重试";
}

interface CreateMomentPalette {
  background: string;
  card: string;
  text: string;
  secondaryText: string;
  tertiaryText: string;
  separator: string;
}

export function createMomentPalette(scheme: ColorSchemeName): CreateMomentPalette {
  return {
    // These are UIKit's secondarySystemBackground/systemBackground values,
    // while the original AppColors text/separator hex values stay fixed.
    background: scheme === "dark" ? "#1C1C1E" : colors.background,
    card: scheme === "dark" ? "#000000" : colors.card,
    text: colors.text,
    secondaryText: colors.secondaryText,
    tertiaryText: colors.tertiaryText,
    separator: colors.separator,
  };
}

function createStyles(theme: CreateMomentPalette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24 },
    card: {
      overflow: "hidden",
      borderWidth: 1,
      borderColor: theme.separator,
      borderRadius: 12,
      backgroundColor: theme.card,
    },
    headerButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    publishDisabled: { opacity: 0.72 },
    textSection: { height: 236 },
    textInput: {
      height: 236,
      paddingHorizontal: 22,
      paddingTop: 18,
      paddingBottom: 28,
      color: theme.text,
      fontSize: 16,
      lineHeight: 22,
    },
    placeholder: {
      position: "absolute",
      zIndex: 1,
      top: 26,
      left: 26,
      right: 26,
      color: theme.tertiaryText,
      fontSize: 16,
      lineHeight: 22,
    },
    count: {
      position: "absolute",
      right: 20,
      bottom: 14,
      color: theme.tertiaryText,
      fontSize: 14,
    },
    cardDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.separator,
      opacity: 0.8,
    },
    mediaSection: {
      paddingHorizontal: 18,
      paddingTop: 18,
      paddingBottom: 22,
      rowGap: 10,
    },
    mediaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    addTile: {
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      rowGap: 9,
      backgroundColor: "#F7F7F7",
    },
    addTitle: { color: "#9E9EB8", fontSize: 14, fontWeight: "500" },
    mediaTile: {
      overflow: "visible",
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#ECEEF4",
    },
    mediaPreview: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      overflow: "hidden",
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
    },
    removeMedia: {
      position: "absolute",
      top: -7,
      right: -7,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: colors.black,
      shadowOpacity: 0.3,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
    },
    mediaHint: { color: theme.tertiaryText, fontSize: 12 },
    settingRow: {
      height: 64,
      paddingHorizontal: 22,
      flexDirection: "row",
      alignItems: "center",
      columnGap: 13,
    },
    settingTitle: { color: theme.text, fontSize: 16, fontWeight: "500" },
    settingSpacer: { flex: 1, minWidth: 12 },
    settingValue: {
      maxWidth: "40%",
      color: theme.tertiaryText,
      fontSize: 14,
    },
  });
}
