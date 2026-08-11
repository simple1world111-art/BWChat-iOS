/* eslint-disable react-hooks/immutability, react-hooks/refs -- Reanimated shared values are mutable UI-thread state, and gesture callbacks are not invoked during render. */
import type { ImageLoadEventData } from "expo-image";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { TopToast } from "@/components/TopToast";
import { useChatMessageLongPressBridge } from "@/components/messages/ChatReplyViews";
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

const SOURCE_FRAME_MEASURE_FALLBACK_MS = 34;
const HERO_OPEN_DURATION_MS = 280;
const BACKDROP_OPEN_DURATION_MS = 120;

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
  loadingFallback?: ReactNode;
  authenticatedRetryIntervalMilliseconds?: number | undefined;
  maximumAuthenticatedRetries?: number | undefined;
  imageStyle: StyleProp<ImageStyle>;
  onNaturalSize?: ((size: GallerySize) => void) | undefined;
  onOpen: (selection: ImageGallerySelection) => void;
  selection: ImageGallerySelection;
  sourceId: string;
  style: StyleProp<ViewStyle>;
  uri: string;
}

export function ImageGallerySource({
  accessibilityHint,
  accessibilityLabel,
  children,
  contentFit = "cover",
  cornerRadius,
  disabled = false,
  fallback,
  loadingFallback,
  authenticatedRetryIntervalMilliseconds,
  maximumAuthenticatedRetries,
  imageStyle,
  onNaturalSize,
  onOpen,
  selection,
  sourceId,
  style,
  uri,
}: ImageGallerySourceProps) {
  const { user } = useAuth();
  const longPressBridge = useChatMessageLongPressBridge();
  const ownerId = user?.user_id ?? "";
  const scopedSourceId = galleryOwnerSourceId(ownerId, sourceId);
  const sourceRef = useRef<View>(null);
  const sourceOwnerIdRef = useRef(ownerId);
  const sourceLifecycleGenerationRef = useRef(0);
  const sourceOpenOperationRef = useRef(0);
  const sourcePressGenerationRef = useRef(0);
  const pressedSourceFrameRef = useRef<GalleryFrame | undefined>(undefined);
  const [naturalSize, setNaturalSize] = useState<GallerySize | undefined>();

  useEffect(() => {
    sourceOwnerIdRef.current = ownerId;
    sourceLifecycleGenerationRef.current += 1;
    sourceOpenOperationRef.current += 1;
    sourcePressGenerationRef.current += 1;
    pressedSourceFrameRef.current = undefined;
    return () => {
      sourceOwnerIdRef.current = "";
      sourceLifecycleGenerationRef.current += 1;
      sourceOpenOperationRef.current += 1;
      sourcePressGenerationRef.current += 1;
      pressedSourceFrameRef.current = undefined;
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

  const handlePressIn = useCallback(() => {
    if (disabled) return;
    const pressGeneration = sourcePressGenerationRef.current + 1;
    sourcePressGenerationRef.current = pressGeneration;
    pressedSourceFrameRef.current = undefined;
    sourceRef.current?.measureInWindow((x, y, width, height) => {
      if (sourcePressGenerationRef.current !== pressGeneration) return;
      pressedSourceFrameRef.current = width > 1 && height > 1 ? { x, y, width, height } : undefined;
    });
  }, [disabled]);

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
    // Press-in normally finishes this measurement before press-up. That makes
    // the visible transition begin immediately instead of putting an async
    // native measurement between the tap and opening the Modal.
    const pressedSourceFrame = pressedSourceFrameRef.current;
    sourcePressGenerationRef.current += 1;
    pressedSourceFrameRef.current = undefined;
    if (pressedSourceFrame) {
      open(pressedSourceFrame);
      return;
    }

    // A very short tap can beat the press-in measurement. Retry once, but
    // never let a missing native callback swallow the first tap altogether.
    const source = sourceRef.current;
    if (!source) {
      open();
      return;
    }
    let didOpen = false;
    const openOnce = (sourceFrame?: GalleryFrame) => {
      if (didOpen) return;
      didOpen = true;
      clearTimeout(fallbackTimer);
      open(sourceFrame);
    };
    const fallbackTimer = setTimeout(() => openOnce(), SOURCE_FRAME_MEASURE_FALLBACK_MS);
    source.measureInWindow((x, y, width, height) => {
      openOnce(width > 1 && height > 1 ? { x, y, width, height } : undefined);
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
      collapsable={false}
      delayLongPress={longPressBridge.delayLongPress}
      disabled={disabled}
      onLongPress={longPressBridge.onLongPress}
      onPress={handleOpen}
      onPressIn={handlePressIn}
      onPressOut={longPressBridge.onPressOut}
      ref={sourceRef}
      style={style}
    >
      <AuthenticatedImage
        authenticatedRetryIntervalMilliseconds={authenticatedRetryIntervalMilliseconds}
        contentFit={contentFit}
        fallback={fallback}
        loadingFallback={loadingFallback}
        maximumAuthenticatedRetries={maximumAuthenticatedRetries}
        onLoad={handleLoad}
        retainLoadingFallbackUntilImageLoad={Boolean(loadingFallback)}
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
  if (!selection) return null;
  return (
    <ImageGalleryModal
      key={selection.sourceId ?? selection.media.id}
      ownerId={ownerId}
      onClose={onClose}
      selection={selection}
    />
  );
}

function ImageGalleryModal({
  selection,
  onClose,
  ownerId,
}: {
  selection: ImageGallerySelection;
  onClose: () => void;
  ownerId: string;
}) {
  const [isPresented, setPresented] = useState(false);
  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      onShow={() => setPresented(true)}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible
    >
      <ImageGalleryPresentation
        isPresented={isPresented}
        ownerId={ownerId}
        onClose={onClose}
        selection={selection}
      />
    </Modal>
  );
}

function ImageGalleryPresentation({
  isPresented,
  selection,
  onClose,
  ownerId,
}: {
  isPresented: boolean;
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
  return (
    <ImageGalleryContent
      isPresented={isPresented}
      onClose={onClose}
      ownerId={ownerAtOpen}
      selection={selection}
    />
  );
}

function ImageGalleryContent({
  isPresented,
  selection,
  onClose,
  ownerId,
}: {
  isPresented: boolean;
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
  const initialImageUri = initialImages[initialIndex] ?? selection.media.url;
  const [images, setImages] = useState(initialImages);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
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
  const swipeDismissCompletedPartsRef = useRef(0);
  const swipeDismissRequestRef = useRef<{
    ownerId: string;
    generation: number;
    operation: number;
  } | null>(null);
  const sourceFrame = selection.sourceFrame;

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
  const backdropOpacity = useSharedValue(0);
  const contentOpacity = useSharedValue(0);
  const initialPageReady = useSharedValue(0);
  const isDismissing = useSharedValue(0);
  // Keep the Hero mounted and hand visibility between it and the gallery on
  // the UI thread. A React-state handoff can miss a frame during dismissal.
  const heroOpacity = useSharedValue(sourceFrame ? 1 : 0);

  useEffect(
    () => () => {
      ownerIdRef.current = "";
      lifecycleGenerationRef.current += 1;
      paginationOperationRef.current += 1;
      saveOperationRef.current += 1;
      dismissOperationRef.current += 1;
      swipeDismissRequestRef.current = null;
      swipeDismissCompletedPartsRef.current = 0;
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

  const naturalSize =
    selection.naturalSize ??
    (sourceFrame ? { width: sourceFrame.width, height: sourceFrame.height } : { width, height });
  const sourceVisibleFrame = sourceFrame
    ? selection.sourceContentMode === "fit"
      ? aspectFitRect(naturalSize, sourceFrame)
      : sourceFrame
    : { x: 0, y: 0, width, height };
  const targetFrame = aspectFitRect(naturalSize, { x: 0, y: 0, width, height });

  useAnimatedReaction(
    () =>
      Boolean(sourceFrame) &&
      isDismissing.value === 0 &&
      openProgress.value >= 0.999 &&
      initialPageReady.value >= 1,
    (canRevealPage, wasReady) => {
      if (!canRevealPage || wasReady) return;
      // The ready full-size image is opaque underneath the Hero. Fading only
      // the top layer keeps total opacity at one and prevents a dark/bright
      // flash during the handoff.
      contentOpacity.value = 1;
      heroOpacity.value = withTiming(0, {
        duration: 72,
        easing: Easing.out(Easing.quad),
      });
    },
  );

  const markInitialPageReady = useCallback(() => {
    initialPageReady.value = 1;
  }, [initialPageReady]);

  useEffect(() => {
    pageIndex.value = currentIndex;
    pageOffset.value = -currentIndex * width;
  }, [currentIndex, pageIndex, pageOffset, width]);

  useEffect(() => {
    if (!isPresented) return;
    if (sourceFrame) {
      // The Modal has already rendered a closed Hero frame while iOS presents
      // it. Start backdrop and geometry together as soon as onShow fires: the
      // whole feed dims uniformly, with no delayed jump or local source mask.
      backdropOpacity.value = withTiming(1, {
        duration: BACKDROP_OPEN_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
      openProgress.value = withTiming(1, {
        duration: HERO_OPEN_DURATION_MS,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      });
    } else {
      const duration = 180;
      backdropOpacity.value = withTiming(1, {
        duration,
        easing: Easing.inOut(Easing.cubic),
      });
      openProgress.value = withTiming(1, {
        duration,
        easing: Easing.inOut(Easing.cubic),
      });
      contentOpacity.value = withTiming(1, {
        duration,
        easing: Easing.inOut(Easing.cubic),
      });
    }
  }, [backdropOpacity, contentOpacity, isPresented, openProgress, sourceFrame]);

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

  const beginDismiss = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    const requestedOwnerId = ownerId;
    const requestedGeneration = lifecycleGenerationRef.current;
    const requestedOperation = dismissOperationRef.current + 1;
    dismissOperationRef.current = requestedOperation;
    isDismissing.value = 1;
    const canReturnToSource =
      Boolean(sourceFrame) &&
      images[currentIndex] === initialImageUri &&
      scale.value <= GALLERY_REST_SCALE_LIMIT;
    if (canReturnToSource) {
      const handoffDuration = 64;
      // Put the opaque Hero underneath first, then fade only the page above
      // it. The combined opacity never dips, so closing cannot flash.
      heroOpacity.value = 1;
      contentOpacity.value = withTiming(0, {
        duration: handoffDuration,
        easing: Easing.inOut(Easing.cubic),
      });
      backdropOpacity.value = withDelay(
        224,
        withTiming(
          0,
          {
            duration: 96,
            easing: Easing.out(Easing.cubic),
          },
          (finished) => {
            if (finished) {
              runOnJS(finishClose)(requestedOwnerId, requestedGeneration, requestedOperation);
            }
          },
        ),
      );
      openProgress.value = withDelay(
        32,
        withTiming(0, {
          duration: 288,
          easing: Easing.inOut(Easing.cubic),
        }),
      );
      return;
    }
    const duration = 180;
    openProgress.value = withTiming(0, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
    contentOpacity.value = withTiming(0, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
    backdropOpacity.value = withTiming(
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
  }, [
    backdropOpacity,
    contentOpacity,
    currentIndex,
    finishClose,
    heroOpacity,
    images,
    initialImageUri,
    isDismissing,
    openProgress,
    ownerId,
    scale,
    sourceFrame,
  ]);

  const prepareSwipeDismiss = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    const operation = dismissOperationRef.current + 1;
    dismissOperationRef.current = operation;
    swipeDismissCompletedPartsRef.current = 0;
    swipeDismissRequestRef.current = {
      ownerId,
      generation: lifecycleGenerationRef.current,
      operation,
    };
  }, [ownerId]);

  const finishSwipeDismissPart = useCallback(() => {
    const request = swipeDismissRequestRef.current;
    if (!request) return;
    swipeDismissCompletedPartsRef.current += 1;
    if (swipeDismissCompletedPartsRef.current < 2) return;
    swipeDismissRequestRef.current = null;
    swipeDismissCompletedPartsRef.current = 0;
    finishClose(request.ownerId, request.generation, request.operation);
  }, [finishClose]);

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
            if (decision !== 0) {
              // Start the visual continuation before crossing to JS. The old
              // runOnJS(beginDismiss) handoff left the image parked for a frame
              // after the finger lifted, which read as a hitch on iOS.
              isDismissing.value = 1;
              runOnJS(prepareSwipeDismiss)();
              const targetY = decision < 0 ? -height : height;
              verticalDrag.value = withSpring(
                targetY,
                {
                  damping: 24,
                  stiffness: 150,
                  mass: 1,
                  velocity: Math.max(-2400, Math.min(event.velocityY, 2400)),
                  overshootClamping: true,
                },
                (finished) => {
                  if (finished) runOnJS(finishSwipeDismissPart)();
                },
              );
              openProgress.value = withTiming(0, {
                duration: 280,
                easing: Easing.inOut(Easing.cubic),
              });
              backdropOpacity.value = withTiming(
                0,
                {
                  duration: 280,
                  easing: Easing.inOut(Easing.cubic),
                },
                (finished) => {
                  if (finished) runOnJS(finishSwipeDismissPart)();
                },
              );
            } else
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
      commitPage,
      backdropOpacity,
      finishSwipeDismissPart,
      height,
      images.length,
      isDismissing,
      offsetX,
      offsetXAtStart,
      offsetY,
      offsetYAtStart,
      pageIndex,
      pageOffset,
      pageOffsetAtStart,
      panMode,
      prepareSwipeDismiss,
      recordPageTarget,
      scale,
      openProgress,
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
          if (success) runOnJS(beginDismiss)();
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
      backdropOpacity.value *
      Math.max(0.25, 1 - Math.min(Math.abs(verticalDrag.value) / 320, 0.75)),
  }));
  const stripStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pageOffset.value }],
  }));
  const currentImageStyle = useAnimatedStyle(() => {
    const dragDistance = Math.abs(verticalDrag.value);
    const dragScale = interpolate(
      dragDistance,
      [0, 32, Math.max(height, 33)],
      [1, 1, 0.78],
      Extrapolation.CLAMP,
    );
    const dragOpacity = interpolate(
      dragDistance,
      [0, 40, Math.max(height * 0.72, 41)],
      [1, 1, 0],
      Extrapolation.CLAMP,
    );
    return {
      opacity: contentOpacity.value * dragOpacity,
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
    opacity: heroOpacity.value,
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
          onAccessibilityEscape={beginDismiss}
          onAccessibilityTap={beginDismiss}
          style={styles.gestureSurface}
        >
          <Animated.View style={[styles.strip, { width: width * images.length }, stripStyle]}>
            {images.map((item, index) => {
              const resolved = resolveMediaUrl(item, env.apiBaseUrl);
              return (
                <View key={item} style={{ width, height }}>
                  <Animated.View style={[styles.page, index === currentIndex && currentImageStyle]}>
                    {resolved && shouldLoadGalleryPage(index, currentIndex) ? (
                      <GalleryImage
                        onDisplay={item === initialImageUri ? markInitialPageReady : undefined}
                        ownerId={ownerId}
                        uri={resolved}
                      />
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
      {sourceFrame ? (
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

function GalleryImage({
  ownerId,
  uri,
  onDisplay,
}: {
  ownerId: string;
  uri: string;
  onDisplay?: (() => void) | undefined;
}) {
  return (
    <AuthenticatedImage
      contentFit="contain"
      errorFallback={<GalleryFailure />}
      loadingFallback={<GalleryLoading />}
      {...(onDisplay ? { onDisplay } : {})}
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
});
