/* eslint-disable react-hooks/immutability, react-hooks/refs -- Reanimated shared values are mutable UI-thread state, and gesture callbacks are not invoked during render. */
import type { ImageLoadEventData } from "expo-image";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  ActionSheetIOS,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { TopToast } from "@/components/TopToast";
import {
  aspectFitRect,
  dedupeGalleryUrls,
  galleryDismissDecision,
  GALLERY_DOUBLE_TAP_SCALE,
  GALLERY_MAXIMUM_SCALE,
  GALLERY_MINIMUM_SCALE,
  GALLERY_REST_SCALE_LIMIT,
  GALLERY_VERTICAL_DIRECTION_RATIO,
  GALLERY_VISUAL_DEAD_ZONE,
  galleryOwnerCacheKey,
  galleryOwnerSourceId,
  initialGalleryIndex,
  isCurrentGalleryOperation,
  prependGalleryUrlsAtLatestIndex,
  shouldLoadGalleryPage,
  type GalleryFrame,
  type GallerySize,
} from "@/components/media/imageGalleryMath";
import { useLocalization } from "@/providers/LocalizationProvider";
import { useAuth } from "@/providers/AuthProvider";
import { saveImageToLibrary } from "@/services/media/MediaLibrarySaver";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";
import { env } from "@/config/env";

export type { GalleryFrame, GallerySize } from "@/components/media/imageGalleryMath";

export interface ImageGallerySelection {
  media: {
    id: string;
    type: "image" | "video";
    url: string;
  };
  images: string[];
  index: number;
  sourceFrame?: GalleryFrame | undefined;
  sourceId?: string | undefined;
  sourceContentMode?: "fit" | "fill" | undefined;
  sourceCornerRadius?: number | undefined;
  naturalSize?: GallerySize | undefined;
  /** The already-rendered thumbnail URL used to keep the Hero transition textured. */
  sourceUri?: string | undefined;
  loadMoreOlder?: (() => Promise<string[]>) | undefined;
}

interface ImageGallerySourceProps {
  accessibilityHint?: string | undefined;
  accessibilityLabel?: string | undefined;
  children?: ReactNode;
  contentFit?: "cover" | "contain";
  cornerRadius: number;
  disabled?: boolean;
  fallback?: ReactNode;
  imageStyle: StyleProp<ImageStyle>;
  onNaturalSize?: ((size: GallerySize) => void) | undefined;
  onOpen: (selection: ImageGallerySelection) => void;
  selection: ImageGallerySelection;
  sourceId: string;
  style: StyleProp<ViewStyle>;
  uri: string;
}

let activeSourceId: string | null = null;
const sourceListeners = new Set<() => void>();

function setActiveSourceId(next: string | null) {
  if (activeSourceId === next) return;
  activeSourceId = next;
  sourceListeners.forEach((listener) => listener());
}

function subscribeSource(listener: () => void) {
  sourceListeners.add(listener);
  return () => sourceListeners.delete(listener);
}

function useSourceIsHidden(sourceId: string) {
  return useSyncExternalStore(
    subscribeSource,
    () => activeSourceId === sourceId,
    () => false,
  );
}

export function ImageGallerySource({
  accessibilityHint,
  accessibilityLabel,
  children,
  contentFit = "cover",
  cornerRadius,
  disabled = false,
  fallback,
  imageStyle,
  onNaturalSize,
  onOpen,
  selection,
  sourceId,
  style,
  uri,
}: ImageGallerySourceProps) {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const scopedSourceId = galleryOwnerSourceId(ownerId, sourceId);
  const sourceRef = useRef<View>(null);
  const sourceOwnerIdRef = useRef(ownerId);
  const sourceLifecycleGenerationRef = useRef(0);
  const sourceOpenOperationRef = useRef(0);
  const [naturalSize, setNaturalSize] = useState<GallerySize | undefined>();
  const isHidden = useSourceIsHidden(scopedSourceId);

  useEffect(() => {
    sourceOwnerIdRef.current = ownerId;
    sourceLifecycleGenerationRef.current += 1;
    sourceOpenOperationRef.current += 1;
    return () => {
      sourceOwnerIdRef.current = "";
      sourceLifecycleGenerationRef.current += 1;
      sourceOpenOperationRef.current += 1;
    };
  }, [ownerId]);

  const handleLoad = useCallback(
    (event: ImageLoadEventData) => {
      if (event.source.width > 0 && event.source.height > 0) {
        setNaturalSize({ width: event.source.width, height: event.source.height });
        onNaturalSize?.({ width: event.source.width, height: event.source.height });
      }
    },
    [onNaturalSize],
  );

  const handleOpen = useCallback(() => {
    if (disabled) return;
    const requestedOwnerId = ownerId;
    const requestedGeneration = sourceLifecycleGenerationRef.current;
    const requestedOperation = sourceOpenOperationRef.current + 1;
    sourceOpenOperationRef.current = requestedOperation;
    const isCurrentOpen = () =>
      isCurrentGalleryOperation(
        sourceOwnerIdRef.current,
        requestedOwnerId,
        sourceLifecycleGenerationRef.current,
        requestedGeneration,
        sourceOpenOperationRef.current,
        requestedOperation,
      );
    const open = (sourceFrame?: GalleryFrame) => {
      if (!isCurrentOpen()) return;
      onOpen({
        ...selection,
        naturalSize,
        sourceContentMode: contentFit === "contain" ? "fit" : "fill",
        sourceCornerRadius: cornerRadius,
        sourceFrame,
        sourceId: scopedSourceId,
        sourceUri: uri,
      });
    };
    sourceRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 1 && height > 1) open({ x, y, width, height });
      else open();
    });
  }, [
    contentFit,
    cornerRadius,
    disabled,
    naturalSize,
    onOpen,
    ownerId,
    scopedSourceId,
    selection,
    uri,
  ]);

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={handleOpen}
      ref={sourceRef}
      style={[style, isHidden && styles.hiddenSource]}
    >
      <AuthenticatedImage
        contentFit={contentFit}
        fallback={fallback}
        onLoad={handleLoad}
        sourceCacheKey={galleryOwnerCacheKey(ownerId, uri)}
        style={imageStyle}
        transition={0}
        uri={uri}
      />
      {children}
    </Pressable>
  );
}

export function ImageGallery({
  selection,
  onClose,
}: {
  selection: ImageGallerySelection | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={selection !== null}
    >
      {selection ? (
        <ImageGalleryPresentation
          key={selection.sourceId ?? selection.media.id}
          ownerId={ownerId}
          onClose={onClose}
          selection={selection}
        />
      ) : null}
    </Modal>
  );
}

function ImageGalleryPresentation({
  selection,
  onClose,
  ownerId,
}: {
  selection: ImageGallerySelection;
  onClose: () => void;
  ownerId: string;
}) {
  const ownerAtOpen = useRef(ownerId).current;
  const isCurrentOwner = ownerAtOpen === ownerId;
  useEffect(() => {
    if (!isCurrentOwner) onClose();
  }, [isCurrentOwner, onClose]);
  if (!isCurrentOwner) return null;
  return <ImageGalleryContent onClose={onClose} ownerId={ownerAtOpen} selection={selection} />;
}

function ImageGalleryContent({
  selection,
  onClose,
  ownerId,
}: {
  selection: ImageGallerySelection;
  onClose: () => void;
  ownerId: string;
}) {
  const { width, height } = useWindowDimensions();
  const { t } = useLocalization();
  const loadMoreOlder = selection.loadMoreOlder;
  const initialImages = useMemo(
    () => dedupeGalleryUrls(selection.images.length ? selection.images : [selection.media.url]),
    [selection.images, selection.media.url],
  );
  const initialIndex = useMemo(
    () => initialGalleryIndex(selection.images, initialImages, selection.index),
    [initialImages, selection.images, selection.index],
  );
  const [images, setImages] = useState(initialImages);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [heroVisible, setHeroVisible] = useState(Boolean(selection.sourceFrame));
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const loadMoreBusy = useRef(false);
  const hasMoreOlder = useRef(Boolean(loadMoreOlder));
  const dismissing = useRef(false);
  const imagesRef = useRef(initialImages);
  const latestPageIndexRef = useRef(initialIndex);
  const ownerIdRef = useRef(ownerId);
  const lifecycleGenerationRef = useRef(0);
  const paginationOperationRef = useRef(0);
  const saveOperationRef = useRef(0);
  const dismissOperationRef = useRef(0);

  const scale = useSharedValue(1);
  const scaleAtStart = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const offsetXAtStart = useSharedValue(0);
  const offsetYAtStart = useSharedValue(0);
  const pinchContentX = useSharedValue(0);
  const pinchContentY = useSharedValue(0);
  const pageIndex = useSharedValue(initialIndex);
  const pageOffset = useSharedValue(-initialIndex * width);
  const pageOffsetAtStart = useSharedValue(-initialIndex * width);
  const verticalDrag = useSharedValue(0);
  const panMode = useSharedValue(0);
  // Native commits one closed frame before every presentation, including the
  // fallback path where no measurable source frame is available. Starting at
  // zero preserves that 220 ms backdrop/content fade instead of flashing the
  // fallback gallery on fully formed.
  const openProgress = useSharedValue(0);
  const contentOpacity = useSharedValue(0);

  useEffect(
    () => () => {
      ownerIdRef.current = "";
      lifecycleGenerationRef.current += 1;
      paginationOperationRef.current += 1;
      saveOperationRef.current += 1;
      dismissOperationRef.current += 1;
      loadMoreBusy.current = false;
    },
    [],
  );

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    latestPageIndexRef.current = currentIndex;
  }, [currentIndex]);

  const sourceFrame = selection.sourceFrame;
  const naturalSize =
    selection.naturalSize ??
    (sourceFrame ? { width: sourceFrame.width, height: sourceFrame.height } : { width, height });
  const sourceVisibleFrame = sourceFrame
    ? selection.sourceContentMode === "fit"
      ? aspectFitRect(naturalSize, sourceFrame)
      : sourceFrame
    : { x: 0, y: 0, width, height };
  const targetFrame = aspectFitRect(naturalSize, { x: 0, y: 0, width, height });

  useEffect(() => {
    pageIndex.value = currentIndex;
    pageOffset.value = -currentIndex * width;
  }, [currentIndex, pageIndex, pageOffset, width]);

  useEffect(() => {
    setActiveSourceId(selection.sourceId ?? null);
    openProgress.value = withTiming(
      1,
      {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      },
      (finished) => {
        if (finished && sourceFrame) runOnJS(setHeroVisible)(false);
      },
    );
    contentOpacity.value = withTiming(1, {
      duration: sourceFrame ? 240 : 220,
      easing: Easing.out(Easing.cubic),
    });
    return () => setActiveSourceId(null);
  }, [contentOpacity, openProgress, selection.sourceId, sourceFrame]);

  useEffect(() => {
    if (!loadMoreOlder || currentIndex > 1 || loadMoreBusy.current || !hasMoreOlder.current) return;
    const requestedOwnerId = ownerId;
    const requestedGeneration = lifecycleGenerationRef.current;
    const requestedOperation = paginationOperationRef.current + 1;
    paginationOperationRef.current = requestedOperation;
    const isCurrentPagination = () =>
      isCurrentGalleryOperation(
        ownerIdRef.current,
        requestedOwnerId,
        lifecycleGenerationRef.current,
        requestedGeneration,
        paginationOperationRef.current,
        requestedOperation,
      );
    loadMoreBusy.current = true;
    void loadMoreOlder()
      .then((older) => {
        if (!isCurrentPagination()) return;
        const prepended = prependGalleryUrlsAtLatestIndex(
          imagesRef.current,
          older,
          latestPageIndexRef.current,
        );
        if (prepended.added === 0) {
          hasMoreOlder.current = false;
          return;
        }
        const nextIndex = prepended.currentIndex;
        imagesRef.current = prepended.images;
        latestPageIndexRef.current = nextIndex;
        setImages(prepended.images);
        setCurrentIndex(nextIndex);
        pageIndex.value = nextIndex;
        pageOffset.value = -nextIndex * width;
      })
      .finally(() => {
        if (isCurrentPagination()) loadMoreBusy.current = false;
      });
  }, [currentIndex, loadMoreOlder, ownerId, pageIndex, pageOffset, width]);

  const resetZoom = useCallback(() => {
    scale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
    offsetX.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
    offsetY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [offsetX, offsetY, scale]);

  const commitPage = useCallback(
    (nextIndex: number) => {
      latestPageIndexRef.current = nextIndex;
      setCurrentIndex(nextIndex);
      resetZoom();
    },
    [resetZoom],
  );

  const moveToPage = useCallback(
    (requestedIndex: number) => {
      const nextIndex = Math.max(0, Math.min(requestedIndex, images.length - 1));
      if (nextIndex === currentIndex) return;
      latestPageIndexRef.current = nextIndex;
      pageIndex.value = nextIndex;
      pageOffset.value = withTiming(
        -nextIndex * width,
        { duration: 220, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(commitPage)(nextIndex);
        },
      );
    },
    [commitPage, currentIndex, images.length, pageIndex, pageOffset, width],
  );

  const finishClose = useCallback(
    (requestedOwnerId: string, requestedGeneration: number, requestedOperation: number) => {
      if (
        isCurrentGalleryOperation(
          ownerIdRef.current,
          requestedOwnerId,
          lifecycleGenerationRef.current,
          requestedGeneration,
          dismissOperationRef.current,
          requestedOperation,
        )
      ) {
        onClose();
      }
    },
    [onClose],
  );

  const beginDismiss = useCallback(
    (direction: number) => {
      if (dismissing.current) return;
      dismissing.current = true;
      const requestedOwnerId = ownerId;
      const requestedGeneration = lifecycleGenerationRef.current;
      const requestedOperation = dismissOperationRef.current + 1;
      dismissOperationRef.current = requestedOperation;
      const canReturnToSource = Boolean(sourceFrame) && currentIndex === initialIndex;
      if (canReturnToSource) {
        setHeroVisible(true);
        contentOpacity.value = withTiming(0, { duration: 70 });
        verticalDrag.value = withTiming(0, { duration: 70 });
        scale.value = withTiming(1, { duration: 70 });
        offsetX.value = withTiming(0, { duration: 70 });
        offsetY.value = withTiming(0, { duration: 70 });
        openProgress.value = withTiming(
          0,
          {
            duration: direction === 0 ? 240 : 180,
            easing: direction === 0 ? Easing.inOut(Easing.cubic) : Easing.out(Easing.cubic),
          },
          (finished) => {
            if (finished) {
              runOnJS(finishClose)(requestedOwnerId, requestedGeneration, requestedOperation);
            }
          },
        );
        return;
      }
      const targetY = direction === 0 ? 0 : direction < 0 ? -900 : 900;
      const duration = direction === 0 ? 180 : 260;
      verticalDrag.value = withTiming(targetY, {
        duration,
        easing: Easing.out(Easing.cubic),
      });
      // When the current page cannot return to the opening thumbnail, native
      // still fades the black backdrop with `appeared`. Keeping openProgress
      // at one made Expo drop a fully opaque black frame only when the Modal
      // unmounted, producing a visible end-of-close flash.
      openProgress.value = withTiming(0, {
        duration,
        easing: Easing.out(Easing.cubic),
      });
      contentOpacity.value = withTiming(
        0,
        {
          duration,
          easing: Easing.out(Easing.cubic),
        },
        (finished) => {
          if (finished) {
            runOnJS(finishClose)(requestedOwnerId, requestedGeneration, requestedOperation);
          }
        },
      );
    },
    [
      contentOpacity,
      currentIndex,
      finishClose,
      initialIndex,
      offsetX,
      offsetY,
      openProgress,
      ownerId,
      scale,
      sourceFrame,
      verticalDrag,
    ],
  );

  const saveCurrentImage = useCallback(
    async (mediaPath: string, requestedOwnerId: string, requestedGeneration: number) => {
      const requestedOperation = saveOperationRef.current + 1;
      saveOperationRef.current = requestedOperation;
      const isCurrentSave = () =>
        isCurrentGalleryOperation(
          ownerIdRef.current,
          requestedOwnerId,
          lifecycleGenerationRef.current,
          requestedGeneration,
          saveOperationRef.current,
          requestedOperation,
        );
      if (!isCurrentSave()) return;
      const result = await saveImageToLibrary(mediaPath);
      if (!isCurrentSave()) return;
      const message =
        result === "saved"
          ? t("media.savedToAlbum")
          : result === "permissionDenied"
            ? t("media.photoPermissionRequired")
            : result === "invalidImage"
              ? t("media.invalidImageData")
              : t("media.saveFailed");
      setToastMessage(message);
    },
    [t],
  );

  const requestSave = useCallback(() => {
    const requestedOwnerId = ownerId;
    const requestedGeneration = lifecycleGenerationRef.current;
    const mediaPath = imagesRef.current[latestPageIndexRef.current];
    if (!mediaPath) return;
    const canStartSave = () =>
      ownerIdRef.current === requestedOwnerId &&
      lifecycleGenerationRef.current === requestedGeneration;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const saveTitle = t("media.saveImage");
    const cancelTitle = t("common.cancel");
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [saveTitle, cancelTitle], cancelButtonIndex: 1 },
        (buttonIndex) => {
          if (buttonIndex === 0 && canStartSave()) {
            void saveCurrentImage(mediaPath, requestedOwnerId, requestedGeneration);
          }
        },
      );
      return;
    }
    Alert.alert("", "", [
      {
        text: saveTitle,
        onPress: () => {
          if (canStartSave()) {
            void saveCurrentImage(mediaPath, requestedOwnerId, requestedGeneration);
          }
        },
      },
      { text: cancelTitle, style: "cancel" },
    ]);
  }, [ownerId, saveCurrentImage, t]);

  const recordPageTarget = useCallback((nextIndex: number) => {
    latestPageIndexRef.current = nextIndex;
  }, []);

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin((event) => {
          scaleAtStart.value = scale.value;
          offsetXAtStart.value = offsetX.value;
          offsetYAtStart.value = offsetY.value;
          pinchContentX.value = (event.focalX - width / 2 - offsetX.value) / scale.value;
          pinchContentY.value = (event.focalY - height / 2 - offsetY.value) / scale.value;
        })
        .onUpdate((event) => {
          const nextScale = Math.max(
            GALLERY_MINIMUM_SCALE,
            Math.min(GALLERY_MAXIMUM_SCALE, scaleAtStart.value * event.scale),
          );
          scale.value = nextScale;
          offsetX.value = event.focalX - width / 2 - pinchContentX.value * nextScale;
          offsetY.value = event.focalY - height / 2 - pinchContentY.value * nextScale;
        })
        .onEnd(() => {
          if (scale.value <= GALLERY_REST_SCALE_LIMIT) {
            scale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
            offsetX.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
            offsetY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
          }
        })
        .onFinalize((_event, success) => {
          if (success || scale.value > GALLERY_REST_SCALE_LIMIT) return;
          scale.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
          offsetX.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
          offsetY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
        }),
    [
      height,
      offsetX,
      offsetXAtStart,
      offsetY,
      offsetYAtStart,
      pinchContentX,
      pinchContentY,
      scale,
      scaleAtStart,
      width,
    ],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .minDistance(2)
        .onBegin(() => {
          panMode.value = scale.value > GALLERY_REST_SCALE_LIMIT ? 3 : 0;
          offsetXAtStart.value = offsetX.value;
          offsetYAtStart.value = offsetY.value;
          pageOffsetAtStart.value = pageOffset.value;
        })
        .onUpdate((event) => {
          if (panMode.value === 3 || scale.value > GALLERY_REST_SCALE_LIMIT) {
            panMode.value = 3;
            offsetX.value = offsetXAtStart.value + event.translationX;
            offsetY.value = offsetYAtStart.value + event.translationY;
            return;
          }
          if (panMode.value === 0) {
            const horizontalDistance = Math.abs(event.translationX);
            const verticalDistance = Math.abs(event.translationY);
            if (Math.max(horizontalDistance, verticalDistance) < 4) return;
            panMode.value =
              verticalDistance > horizontalDistance * GALLERY_VERTICAL_DIRECTION_RATIO ? 2 : 1;
          }
          if (panMode.value === 2) {
            const distance = Math.abs(event.translationY);
            verticalDrag.value =
              Math.sign(event.translationY) * Math.max(distance - GALLERY_VISUAL_DEAD_ZONE, 0);
          } else {
            const atFirst = pageIndex.value <= 0 && event.translationX > 0;
            const atLast = pageIndex.value >= images.length - 1 && event.translationX < 0;
            const resistance = atFirst || atLast ? 0.25 : 1;
            pageOffset.value = pageOffsetAtStart.value + event.translationX * resistance;
          }
        })
        .onEnd((event) => {
          if (panMode.value === 3) {
            offsetXAtStart.value = offsetX.value;
            offsetYAtStart.value = offsetY.value;
            return;
          }
          if (panMode.value === 2) {
            const decision = galleryDismissDecision(event.translationY, event.velocityY);
            if (decision !== 0) runOnJS(beginDismiss)(decision);
            else
              verticalDrag.value = withTiming(0, {
                duration: 160,
                easing: Easing.out(Easing.cubic),
              });
            return;
          }
          const travel = event.translationX;
          const velocity = event.velocityX;
          let nextIndex = pageIndex.value;
          if ((travel < -width * 0.18 || velocity < -650) && nextIndex < images.length - 1)
            nextIndex += 1;
          else if ((travel > width * 0.18 || velocity > 650) && nextIndex > 0) nextIndex -= 1;
          pageIndex.value = nextIndex;
          runOnJS(recordPageTarget)(nextIndex);
          pageOffset.value = withTiming(
            -nextIndex * width,
            {
              duration: 220,
              easing: Easing.out(Easing.cubic),
            },
            (finished) => {
              if (finished) runOnJS(commitPage)(nextIndex);
            },
          );
        })
        .onFinalize((_event, success) => {
          if (success) {
            panMode.value = 0;
            return;
          }
          if (panMode.value === 2) {
            verticalDrag.value = withTiming(0, {
              duration: 160,
              easing: Easing.out(Easing.cubic),
            });
          } else if (panMode.value === 1) {
            pageOffset.value = withTiming(-pageIndex.value * width, {
              duration: 160,
              easing: Easing.out(Easing.cubic),
            });
          } else if (panMode.value === 3) {
            offsetXAtStart.value = offsetX.value;
            offsetYAtStart.value = offsetY.value;
          }
          panMode.value = 0;
        }),
    [
      beginDismiss,
      commitPage,
      images.length,
      offsetX,
      offsetXAtStart,
      offsetY,
      offsetYAtStart,
      pageIndex,
      pageOffset,
      pageOffsetAtStart,
      panMode,
      recordPageTarget,
      scale,
      verticalDrag,
      width,
    ],
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(300)
        .onEnd((event, success) => {
          if (!success) return;
          if (scale.value > GALLERY_REST_SCALE_LIMIT) {
            scale.value = withTiming(1, { duration: 220, easing: Easing.inOut(Easing.cubic) });
            offsetX.value = withTiming(0, { duration: 220, easing: Easing.inOut(Easing.cubic) });
            offsetY.value = withTiming(0, { duration: 220, easing: Easing.inOut(Easing.cubic) });
          } else {
            scale.value = withTiming(GALLERY_DOUBLE_TAP_SCALE, {
              duration: 220,
              easing: Easing.inOut(Easing.cubic),
            });
            offsetX.value = withTiming(-(event.x - width / 2) * (GALLERY_DOUBLE_TAP_SCALE - 1), {
              duration: 220,
              easing: Easing.inOut(Easing.cubic),
            });
            offsetY.value = withTiming(-(event.y - height / 2) * (GALLERY_DOUBLE_TAP_SCALE - 1), {
              duration: 220,
              easing: Easing.inOut(Easing.cubic),
            });
          }
        }),
    [height, offsetX, offsetY, scale, width],
  );

  const singleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDistance(10)
        .onEnd((_, success) => {
          if (success) runOnJS(beginDismiss)(0);
        }),
    [beginDismiss],
  );

  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(500)
        .maxDistance(20)
        .onStart(() => {
          runOnJS(requestSave)();
        }),
    [requestSave],
  );

  const composedGesture = useMemo(
    () =>
      Gesture.Simultaneous(
        Gesture.Simultaneous(pinch, pan),
        longPress,
        Gesture.Exclusive(doubleTap, singleTap),
      ),
    [doubleTap, longPress, pan, pinch, singleTap],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity:
      openProgress.value * Math.max(0.25, 1 - Math.min(Math.abs(verticalDrag.value) / 320, 0.75)),
  }));
  const stripStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [{ translateX: pageOffset.value }],
  }));
  const currentImageStyle = useAnimatedStyle(() => {
    const dragScale =
      Math.abs(verticalDrag.value) < 8 ? 1 : Math.max(1 - Math.abs(verticalDrag.value) / 900, 0.55);
    return {
      transform: [
        { translateX: offsetX.value },
        { translateY: offsetY.value + verticalDrag.value },
        { scale: scale.value * dragScale },
      ],
    };
  });
  const countStyle = useAnimatedStyle(() => ({
    opacity:
      contentOpacity.value *
      interpolate(scale.value, [1.05, 1.06], [1, 0], Extrapolation.CLAMP) *
      interpolate(Math.abs(verticalDrag.value), [0, 1], [1, 0], Extrapolation.CLAMP),
  }));
  const heroStyle = useAnimatedStyle(() => ({
    borderRadius: interpolate(openProgress.value, [0, 1], [selection.sourceCornerRadius ?? 14, 14]),
    height: interpolate(
      openProgress.value,
      [0, 1],
      [sourceVisibleFrame.height, targetFrame.height],
    ),
    left: interpolate(openProgress.value, [0, 1], [sourceVisibleFrame.x, targetFrame.x]),
    top: interpolate(openProgress.value, [0, 1], [sourceVisibleFrame.y, targetFrame.y]),
    width: interpolate(openProgress.value, [0, 1], [sourceVisibleFrame.width, targetFrame.width]),
  }));

  return (
    <View accessibilityViewIsModal style={styles.root}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
      />
      <GestureDetector gesture={composedGesture}>
        <Animated.View
          accessibilityActions={[
            { name: "increment", label: `${t("media.preview.title")} +` },
            { name: "decrement", label: `${t("media.preview.title")} -` },
            { name: "save", label: t("media.saveImage") },
          ]}
          accessibilityLabel={t("media.preview.title")}
          accessibilityRole="adjustable"
          accessibilityValue={{ text: `${currentIndex + 1} / ${images.length}` }}
          accessible
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "increment") moveToPage(currentIndex + 1);
            else if (event.nativeEvent.actionName === "decrement") moveToPage(currentIndex - 1);
            else if (event.nativeEvent.actionName === "save") requestSave();
          }}
          onAccessibilityEscape={() => beginDismiss(0)}
          onAccessibilityTap={() => beginDismiss(0)}
          style={styles.gestureSurface}
        >
          <Animated.View style={[styles.strip, { width: width * images.length }, stripStyle]}>
            {images.map((item, index) => {
              const resolved = resolveMediaUrl(item, env.apiBaseUrl);
              return (
                <View key={item} style={{ width, height }}>
                  <Animated.View style={[styles.page, index === currentIndex && currentImageStyle]}>
                    {resolved && shouldLoadGalleryPage(index, currentIndex) ? (
                      <GalleryImage ownerId={ownerId} uri={resolved} />
                    ) : resolved ? null : (
                      <GalleryFailure />
                    )}
                  </Animated.View>
                </View>
              );
            })}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
      {images.length > 1 ? (
        <Animated.View pointerEvents="none" style={[styles.countBadge, countStyle]}>
          <Text style={styles.countText}>
            {currentIndex + 1} / {images.length}
          </Text>
        </Animated.View>
      ) : null}
      {heroVisible && sourceFrame ? (
        <Animated.View pointerEvents="none" style={[styles.hero, heroStyle]}>
          <AuthenticatedImage
            contentFit="cover"
            errorFallback={<GalleryFailure />}
            loadingFallback={<GalleryLoading />}
            style={styles.heroImage}
            transition={0}
            sourceCacheKey={galleryOwnerCacheKey(
              ownerId,
              resolveMediaUrl(
                selection.sourceUri ?? images[currentIndex] ?? selection.media.url,
                env.apiBaseUrl,
              ) ??
                selection.sourceUri ??
                selection.media.url,
            )}
            uri={
              resolveMediaUrl(
                selection.sourceUri ?? images[currentIndex] ?? selection.media.url,
                env.apiBaseUrl,
              ) ??
              selection.sourceUri ??
              selection.media.url
            }
          />
        </Animated.View>
      ) : null}
      <TopToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </View>
  );
}

function GalleryImage({ ownerId, uri }: { ownerId: string; uri: string }) {
  return (
    <AuthenticatedImage
      contentFit="contain"
      errorFallback={<GalleryFailure />}
      loadingFallback={<GalleryLoading />}
      sourceCacheKey={galleryOwnerCacheKey(ownerId, uri)}
      style={styles.pageImage}
      transition={0}
      uri={uri}
    />
  );
}

function GalleryLoading() {
  return (
    <View style={styles.imageState}>
      <ActivityIndicator color={colors.white} />
    </View>
  );
}

function GalleryFailure() {
  return (
    <View style={styles.imageState}>
      <SymbolView name="photo" size={48} tintColor="#8E8E93" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  backdrop: { backgroundColor: "#000000" },
  gestureSurface: { flex: 1, overflow: "hidden" },
  strip: { height: "100%", flexDirection: "row" },
  page: { flex: 1, alignItems: "center", justifyContent: "center" },
  pageImage: { width: "100%", height: "100%", borderRadius: 14 },
  imageState: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  countBadge: {
    position: "absolute",
    top: 54,
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  countText: { color: "rgba(255,255,255,0.9)", fontSize: 14, fontWeight: "500" },
  hero: { position: "absolute", overflow: "hidden", backgroundColor: "#000000" },
  heroImage: { width: "100%", height: "100%" },
  hiddenSource: { opacity: 0 },
});
