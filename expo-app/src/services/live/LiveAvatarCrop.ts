export const maximumLiveAvatarZoom = 5;

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface CropRect { originX: number; originY: number; width: number; height: number }

export function minimumLiveAvatarScale(imageSize: Size, viewportSide: number): number {
  if (imageSize.width <= 0 || imageSize.height <= 0 || viewportSide <= 0) return 1;
  return Math.max(viewportSide / imageSize.width, viewportSide / imageSize.height);
}

export function clampLiveAvatarZoom(zoom: number): number {
  return Math.min(Math.max(zoom, 1), maximumLiveAvatarZoom);
}

export function clampedLiveAvatarOffset(offset: Point, imageSize: Size, viewportSide: number, zoom: number): Point {
  const baseScale = minimumLiveAvatarScale(imageSize, viewportSide);
  const safeZoom = clampLiveAvatarZoom(zoom);
  const maximumX = Math.max((imageSize.width * baseScale * safeZoom - viewportSide) / 2, 0);
  const maximumY = Math.max((imageSize.height * baseScale * safeZoom - viewportSide) / 2, 0);
  return {
    x: Math.min(Math.max(offset.x, -maximumX), maximumX),
    y: Math.min(Math.max(offset.y, -maximumY), maximumY),
  };
}

export function liveAvatarCropRect(imageSize: Size, viewportSide: number, zoom: number, offset: Point): CropRect {
  if (imageSize.width <= 0 || imageSize.height <= 0 || viewportSide <= 0) return { originX: 0, originY: 0, width: 0, height: 0 };
  const safeZoom = clampLiveAvatarZoom(zoom);
  const displayScale = minimumLiveAvatarScale(imageSize, viewportSide) * safeZoom;
  const side = Math.min(viewportSide / displayScale, imageSize.width, imageSize.height);
  const safeOffset = clampedLiveAvatarOffset(offset, imageSize, viewportSide, safeZoom);
  const centerX = imageSize.width / 2 - safeOffset.x / displayScale;
  const centerY = imageSize.height / 2 - safeOffset.y / displayScale;
  return {
    originX: Math.min(Math.max(centerX - side / 2, 0), imageSize.width - side),
    originY: Math.min(Math.max(centerY - side / 2, 0), imageSize.height - side),
    width: side,
    height: side,
  };
}

export function integralLiveAvatarCropRect(rect: CropRect, imageSize: Size): CropRect {
  const originX = Math.max(0, Math.floor(rect.originX));
  const originY = Math.max(0, Math.floor(rect.originY));
  return {
    originX,
    originY,
    width: Math.max(0, Math.min(imageSize.width - originX, Math.ceil(rect.originX + rect.width) - originX)),
    height: Math.max(0, Math.min(imageSize.height - originY, Math.ceil(rect.originY + rect.height) - originY)),
  };
}
