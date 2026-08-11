import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "expo-symbols";
import type { PropsWithChildren, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  findNodeHandle,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type View as NativeView,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { env } from "@/config/env";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { useLocalization } from "@/providers/LocalizationProvider";
import { giftMessagePreview } from "@/services/messages/chatGiftPolicy";
import {
  localizedChatStickerText,
  parseChatStickerMessagePayload,
} from "@/services/messages/chatStickerPolicy";
import {
  calculateChatMessageMenuLayout,
  chatReplyGeometry,
  chatReplyPreviewText,
  type ChatMessageAnchor,
  type ChatMessageMenuAction,
  type ChatTimelineLocatorKind,
} from "@/services/messages/chatReplyPolicy";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export interface ChatReplyRenderValue {
  senderName: string;
  content: string;
  msgType: string;
}

interface ChatMessageActivationController {
  canActivate: () => boolean;
  onNestedLongPress?: ((event: GestureResponderEvent) => void) | undefined;
  onNestedPressOut?: (() => void) | undefined;
}

const ChatMessageActivationContext = createContext<ChatMessageActivationController>({
  canActivate: () => true,
});

/** Keeps nested bubble taps from committing after the menu long press wins. */
export function useChatMessageActivationGuard(): () => boolean {
  return useContext(ChatMessageActivationContext).canActivate;
}

/** Lets nested media Pressables hand their long press back to the message menu. */
export function useChatMessageLongPressBridge(): {
  delayLongPress: number;
  onLongPress?: ((event: GestureResponderEvent) => void) | undefined;
  onPressOut?: (() => void) | undefined;
} {
  const controller = useContext(ChatMessageActivationContext);
  return {
    delayLongPress: chatReplyGeometry.long_press_seconds * 1_000,
    onLongPress: controller.onNestedLongPress,
    onPressOut: controller.onNestedPressOut,
  };
}

export function ChatMessageHighlightSurface({
  active,
  children,
  style,
}: PropsWithChildren<{ active: boolean; style?: StyleProp<ViewStyle> }>) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    progress.stopAnimation();
    if (!active) {
      progress.setValue(0);
      return;
    }
    progress.setValue(1);
    Animated.sequence([
      Animated.delay(chatReplyGeometry.highlight_seconds * 1_000),
      Animated.timing(progress, {
        duration: chatReplyGeometry.highlight_fade_seconds * 1_000,
        easing: Easing.out(Easing.ease),
        toValue: 0,
        useNativeDriver: false,
      }),
    ]).start();
  }, [active, progress]);
  return (
    <Animated.View
      style={[
        style,
        styles.highlightSurface,
        {
          backgroundColor: progress.interpolate({
            inputRange: [0, 1],
            outputRange: ["rgba(102,126,234,0)", "rgba(102,126,234,0.15)"],
          }),
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function ChatTimelineLocatorButton({
  kind,
  onPress,
}: {
  kind: ChatTimelineLocatorKind;
  onPress: () => void;
}) {
  const { t } = useLocalization();
  const title =
    kind.kind === "mention"
      ? t("timeline.mentionedMe")
      : kind.kind === "reply"
        ? t("timeline.repliedMe")
        : kind.kind === "newMessages"
          ? t("timeline.newMessages", kind.count)
          : null;
  const symbol: SFSymbol =
    kind.kind === "mention" ? "at" : kind.kind === "reply" ? "quote.bubble" : "arrow.down";
  return (
    <Pressable
      accessibilityLabel={title ?? t("timeline.backToLatest")}
      onPress={onPress}
      style={styles.locatorShadow}
    >
      <BlurView
        intensity={90}
        style={[styles.locatorSurface, { paddingHorizontal: title === null ? 11 : 13 }]}
        tint="systemUltraThinMaterial"
      >
        <SymbolView name={symbol} size={13} weight="semibold" tintColor={colors.accent} />
        {title ? (
          <Text numberOfLines={1} style={styles.locatorText}>
            {title}
          </Text>
        ) : null}
      </BlurView>
    </Pressable>
  );
}

export function ChatMessageLongPressSurface({
  children,
  disabled = false,
  onLongPress,
  onLongPressStart,
  onTouchSequenceEnded,
}: PropsWithChildren<{
  disabled?: boolean;
  onLongPress: (anchor: ChatMessageAnchor) => boolean | void;
  onLongPressStart?: (() => void) | undefined;
  onTouchSequenceEnded?: (() => void) | undefined;
}>) {
  const surfaceRef = useRef<NativeView>(null);
  const menuOwnsTouchSequenceRef = useRef(false);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canActivate = useCallback(() => !menuOwnsTouchSequenceRef.current, []);

  useEffect(
    () => () => {
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    },
    [],
  );

  const releaseMenuTouchOwnership = useCallback(() => {
    onTouchSequenceEnded?.();
    if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = setTimeout(() => {
      menuOwnsTouchSequenceRef.current = false;
      releaseTimerRef.current = null;
    }, 150);
  }, [onTouchSequenceEnded]);

  const openMessageMenu = useCallback(
    (event: GestureResponderEvent) => {
      if (disabled || menuOwnsTouchSequenceRef.current) return;
      const pressX = event.nativeEvent.pageX;
      const pressY = event.nativeEvent.pageY;
      menuOwnsTouchSequenceRef.current = true;
      onLongPressStart?.();
      surfaceRef.current?.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) return;
        const opened = onLongPress({
          x,
          y,
          width,
          height,
          press_x: pressX,
          press_y: pressY,
        });
        if (opened !== false) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      });
    },
    [disabled, onLongPress, onLongPressStart],
  );

  const activationController = useMemo<ChatMessageActivationController>(
    () => ({
      canActivate,
      onNestedLongPress: disabled ? undefined : openMessageMenu,
      onNestedPressOut: disabled ? undefined : releaseMenuTouchOwnership,
    }),
    [canActivate, disabled, openMessageMenu, releaseMenuTouchOwnership],
  );

  return (
    <ChatMessageActivationContext.Provider value={activationController}>
      <View ref={surfaceRef} collapsable={false}>
        <Pressable
          delayLongPress={chatReplyGeometry.long_press_seconds * 1_000}
          disabled={disabled}
          onLongPress={openMessageMenu}
          onPressOut={releaseMenuTouchOwnership}
          pressRetentionOffset={chatReplyGeometry.long_press_movement}
          testID="chat.message.longPressSurface"
        >
          {children}
        </Pressable>
      </View>
    </ChatMessageActivationContext.Provider>
  );
}

export function ChatReplyPreviewBar({
  value,
  onCancel,
}: {
  value: ChatReplyRenderValue;
  onCancel: () => void;
}) {
  const { t, activeLanguage } = useLocalization();
  if (value.msgType.toLocaleLowerCase() === "image") {
    return (
      <View style={styles.previewOuter}>
        <View style={styles.imageComposerReference}>
          <View style={styles.imageComposerIndicator} />
          <View style={styles.imageComposerText}>
            <Text numberOfLines={1} style={styles.imageComposerTitle}>
              {t("reply.to", value.senderName)}
            </Text>
            <View style={styles.imageDetailRow}>
              <SymbolView name="photo" size={11} weight="medium" tintColor={colors.text} />
              <Text numberOfLines={1} style={styles.imageComposerDetail}>
                {t("message.image")}
              </Text>
            </View>
          </View>
          <AuthenticatedImage
            contentFit="cover"
            style={styles.composerThumbnail}
            transition={0}
            uri={resolveMediaUrl(value.content, env.apiBaseUrl) ?? value.content}
          />
          <Pressable
            accessibilityLabel={t("common.cancel")}
            hitSlop={8}
            onPress={onCancel}
            style={styles.imageCancelButton}
          >
            <SymbolView name="xmark" size={11} weight="semibold" tintColor={colors.secondaryText} />
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.previewBar}>
      <View style={styles.previewIndicator} />
      <View style={styles.previewTextColumn}>
        <Text numberOfLines={1} style={styles.previewTitle}>
          {t("reply.to", value.senderName)}
        </Text>
        <Text numberOfLines={1} style={styles.previewDetail}>
          {chatReplyPreviewText(
            value.msgType,
            value.content,
            t,
            (content) =>
              localizedChatStickerText(
                parseChatStickerMessagePayload(content)?.name,
                activeLanguage,
              ),
            (content) => giftMessagePreview(content, t),
          )}
        </Text>
      </View>
      <Pressable accessibilityLabel={t("common.cancel")} hitSlop={8} onPress={onCancel}>
        <SymbolView name="xmark.circle.fill" size={18} tintColor={colors.tertiaryText} />
      </Pressable>
    </View>
  );
}

export function ChatQuotedMessageView({
  value,
  isFromMe,
  onPress,
}: {
  value: ChatReplyRenderValue;
  isFromMe: boolean;
  onPress?: () => void;
}) {
  const { t, activeLanguage } = useLocalization();
  const imageQuote = value.msgType.toLocaleLowerCase() === "image";
  const body: ReactNode = imageQuote ? (
    <View
      style={[
        styles.imageQuote,
        isFromMe ? styles.mineImageQuoteSurface : styles.otherImageQuoteSurface,
      ]}
    >
      <View
        style={[
          styles.imageQuoteIndicator,
          isFromMe ? styles.mineImageIndicator : styles.otherImageIndicator,
        ]}
      />
      <View style={styles.imageQuoteColumn}>
        <Text
          numberOfLines={1}
          style={[
            styles.quoteSender,
            isFromMe ? styles.mineImageQuoteTitle : styles.otherImageQuoteTitle,
          ]}
        >
          {value.senderName}
        </Text>
        <AuthenticatedImage
          contentFit="cover"
          style={[
            styles.bubbleThumbnail,
            isFromMe ? styles.mineThumbnailBorder : styles.otherThumbnailBorder,
          ]}
          transition={0}
          uri={resolveMediaUrl(value.content, env.apiBaseUrl) ?? value.content}
        />
      </View>
    </View>
  ) : (
    <View style={[styles.textQuote, isFromMe ? styles.mineQuoteSurface : styles.otherQuoteSurface]}>
      <View
        style={[styles.textQuoteIndicator, isFromMe ? styles.mineIndicator : styles.otherIndicator]}
      />
      <View style={styles.quoteTextColumn}>
        <Text
          numberOfLines={1}
          style={[styles.quoteSender, isFromMe ? styles.mineQuoteTitle : styles.otherQuoteTitle]}
        >
          {value.senderName}
        </Text>
        <Text
          numberOfLines={2}
          style={[styles.quoteDetail, isFromMe ? styles.mineQuoteDetail : styles.otherQuoteDetail]}
        >
          {chatReplyPreviewText(
            value.msgType,
            value.content,
            t,
            (content) =>
              localizedChatStickerText(
                parseChatStickerMessagePayload(content)?.name,
                activeLanguage,
              ),
            (content) => giftMessagePreview(content, t),
          )}
        </Text>
      </View>
    </View>
  );
  return onPress ? (
    <Pressable
      accessibilityLabel={imageQuote ? `${value.senderName}，${t("message.image")}` : undefined}
      accessibilityRole="button"
      onPress={onPress}
    >
      {body}
    </Pressable>
  ) : (
    body
  );
}

export function ChatRecalledMessageTip({
  notice,
  canReedit,
  onReedit,
}: {
  notice: string;
  canReedit: boolean;
  onReedit: () => void;
}) {
  const { t } = useLocalization();
  return (
    <View accessibilityRole="text" style={styles.recalledRow}>
      <Text style={styles.recalledNotice}>{notice}</Text>
      {canReedit ? (
        <Pressable hitSlop={6} onPress={onReedit}>
          <Text style={styles.reeditText}>{t("chat.recall.reedit")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ChatMessageActionOverlay({
  anchor,
  actions,
  onDismiss,
  onSelect,
}: {
  anchor: ChatMessageAnchor | null;
  actions: readonly ChatMessageMenuAction[];
  onDismiss: () => void;
  onSelect: (action: ChatMessageMenuAction) => void;
}) {
  const { t } = useLocalization();
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const firstActionRef = useRef<NativeView>(null);
  const [keyboardOcclusion, setKeyboardOcclusion] = useState(0);
  const titles = useMemo(() => actions.map((action) => actionTitle(action, t)), [actions, t]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setKeyboardOcclusion(
        Math.max(0, height - Math.max(insets.top, event.endCoordinates.screenY)),
      );
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOcclusion(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [height, insets.top]);

  if (!anchor || actions.length === 0) return null;
  const longestTitle = titles.reduce((longest, title) => Math.max(longest, title.length), 0);
  const itemWidth = Math.min(94, Math.max(58, 52 + longestTitle * 4));
  const itemHeight = Math.min(76, Math.max(56, 56 * Math.min(fontScale, 1.35)));
  const layout = calculateChatMessageMenuLayout(anchor, actions.length, {
    width,
    height: height - keyboardOcclusion,
    topInset: insets.top,
    bottomInset: insets.bottom,
    itemWidth,
    itemHeight,
  });
  const focusFirstAction = () => {
    const handle = findNodeHandle(firstActionRef.current);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  };
  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      onShow={focusFirstAction}
      statusBarTranslucent
      transparent
      visible
    >
      <Pressable accessible={false} onPress={onDismiss} style={styles.overlay}>
        <View
          accessibilityLabel={t("chat.action.menu")}
          accessibilityRole="menu"
          accessibilityViewIsModal
          onAccessibilityEscape={onDismiss}
          onStartShouldSetResponder={() => true}
          style={[
            styles.menuContainer,
            {
              left: layout.left,
              top: layout.top,
              width: layout.menu_width,
              height: layout.total_height,
            },
          ]}
        >
          {!layout.opens_above ? (
            <MenuPointer pointerX={layout.pointer_x} pointsDown={false} />
          ) : null}
          <View
            style={[styles.menuBody, { height: layout.menu_body_height, width: layout.menu_width }]}
          >
            {actions.map((action, index) => (
              <Pressable
                accessibilityLabel={actionTitle(action, t)}
                accessibilityRole="button"
                key={action}
                onPress={() => onSelect(action)}
                ref={index === 0 ? firstActionRef : undefined}
                style={[styles.menuItem, { width: layout.item_width, height: layout.item_height }]}
              >
                <SymbolView
                  name={actionSymbol(action)}
                  size={20}
                  weight="regular"
                  tintColor={action === "delete" || action === "recall" ? "#FF8A80" : "#FFFFFF"}
                />
                <Text
                  adjustsFontSizeToFit
                  maxFontSizeMultiplier={1.35}
                  minimumFontScale={0.85}
                  numberOfLines={2}
                  style={[
                    styles.menuItemText,
                    action === "delete" || action === "recall" ? styles.destructiveMenuText : null,
                  ]}
                >
                  {actionTitle(action, t)}
                </Text>
              </Pressable>
            ))}
          </View>
          {layout.opens_above ? <MenuPointer pointerX={layout.pointer_x} pointsDown /> : null}
        </View>
      </Pressable>
    </Modal>
  );
}

function MenuPointer({ pointerX, pointsDown }: { pointerX: number; pointsDown: boolean }) {
  return (
    <View style={[styles.pointerRow, { width: "100%" }]}>
      <View
        style={[
          styles.pointer,
          { left: pointerX - chatReplyGeometry.menu_pointer_width / 2 },
          pointsDown ? styles.pointerDown : styles.pointerUp,
        ]}
      />
    </View>
  );
}

function actionTitle(
  action: ChatMessageMenuAction,
  t: (key: string, ...args: (string | number)[]) => string,
): string {
  switch (action) {
    case "copy":
      return t("common.copy");
    case "retry":
      return t("common.retry");
    case "forward":
      return t("chat.action.forward");
    case "save":
      return t("common.save");
    case "quote":
      return t("common.reply");
    case "recall":
      return t("chat.action.recall");
    case "delete":
      return t("common.delete");
    case "multiSelect":
      return t("chat.action.multiSelect");
  }
}

function actionSymbol(action: ChatMessageMenuAction): SFSymbol {
  switch (action) {
    case "copy":
      return "doc.on.doc";
    case "retry":
      return "arrow.clockwise";
    case "forward":
      return "arrowshape.turn.up.right";
    case "save":
      return "square.and.arrow.down";
    case "quote":
      return "quote.bubble";
    case "recall":
      return "arrow.uturn.backward";
    case "delete":
      return "trash";
    case "multiSelect":
      return "checkmark.circle";
  }
}

const menuColor = "rgb(61,61,64)";

const styles = StyleSheet.create({
  highlightSurface: { borderRadius: 12 },
  locatorShadow: {
    borderRadius: 18,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 7,
  },
  locatorSurface: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.8)",
    borderRadius: 18,
    borderWidth: 1,
    columnGap: 6,
    flexDirection: "row",
    height: chatReplyGeometry.locator_height,
    overflow: "hidden",
  },
  locatorText: { color: colors.accent, fontSize: 13, fontWeight: "500" },
  previewOuter: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  previewBar: {
    minHeight: 53,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 8,
    backgroundColor: "rgba(255,255,255,0.96)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  previewIndicator: { width: 3, height: 36, borderRadius: 2, backgroundColor: colors.accent },
  previewTextColumn: { flex: 1, rowGap: 2 },
  previewTitle: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  previewDetail: { color: colors.secondaryText, fontSize: 13 },
  imageComposerReference: {
    minHeight: 58,
    paddingLeft: 9,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 9,
    backgroundColor: colors.background,
  },
  imageComposerIndicator: {
    width: 2,
    height: 44,
    borderRadius: 1,
    backgroundColor: "rgba(158,158,184,0.75)",
  },
  imageComposerText: { flex: 1, rowGap: 3 },
  imageComposerTitle: { color: colors.secondaryText, fontSize: 12, fontWeight: "500" },
  imageDetailRow: { flexDirection: "row", alignItems: "center", columnGap: 4 },
  imageComposerDetail: { color: "rgba(26,26,46,0.78)", fontSize: 13 },
  composerThumbnail: {
    width: 44,
    height: 44,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
  },
  imageCancelButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(240,240,245,0.72)",
  },
  textQuote: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    flexDirection: "row",
    columnGap: 6,
  },
  textQuoteIndicator: { width: 2.5, borderRadius: 1.5 },
  quoteTextColumn: { flexShrink: 1, rowGap: 1 },
  quoteSender: { fontSize: 11, fontWeight: "600" },
  quoteDetail: { fontSize: 12 },
  imageQuote: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 6,
  },
  imageQuoteIndicator: { width: 2.5, height: 75, borderRadius: 1.5 },
  imageQuoteColumn: { width: 56, rowGap: 4 },
  bubbleThumbnail: {
    width: 56,
    height: 56,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.08)",
  },
  mineQuoteSurface: { backgroundColor: "rgba(0,0,0,0.25)" },
  otherQuoteSurface: { backgroundColor: "#DDDDE8" },
  mineImageQuoteSurface: { backgroundColor: "rgba(0,0,0,0.16)" },
  otherImageQuoteSurface: { backgroundColor: "rgba(240,240,245,0.72)" },
  mineIndicator: { backgroundColor: "#FFFFFF" },
  otherIndicator: { backgroundColor: colors.accent },
  mineImageIndicator: { backgroundColor: "rgba(255,255,255,0.55)" },
  otherImageIndicator: { backgroundColor: "rgba(158,158,184,0.72)" },
  mineQuoteTitle: { color: "#FFFFFF" },
  otherQuoteTitle: { color: colors.accent },
  mineImageQuoteTitle: { color: "rgba(255,255,255,0.84)" },
  otherImageQuoteTitle: { color: colors.secondaryText },
  mineQuoteDetail: { color: "#FFFFFF" },
  otherQuoteDetail: { color: "#3A3A50" },
  mineThumbnailBorder: { borderColor: "rgba(255,255,255,0.18)" },
  otherThumbnailBorder: { borderColor: "rgba(0,0,0,0.08)" },
  recalledRow: {
    minHeight: 31,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 5,
  },
  recalledNotice: { color: colors.secondaryText, fontSize: 12 },
  reeditText: { color: colors.accent, fontSize: 12 },
  overlay: { flex: 1 },
  menuContainer: { position: "absolute" },
  menuBody: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: menuColor,
    flexDirection: "row",
    flexWrap: "wrap",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  menuItem: { alignItems: "center", justifyContent: "center", rowGap: 4, paddingHorizontal: 3 },
  menuItemText: { color: "#FFFFFF", fontSize: 11, textAlign: "center" },
  destructiveMenuText: { color: "#FF8A80" },
  pointerRow: { height: 7, position: "relative" },
  pointer: {
    position: "absolute",
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  pointerUp: { borderBottomWidth: 7, borderBottomColor: menuColor },
  pointerDown: { borderTopWidth: 7, borderTopColor: menuColor },
});
