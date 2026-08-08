import {
  clampedLiveAvatarOffset,
  integralLiveAvatarCropRect,
  liveAvatarCropRect,
  minimumLiveAvatarScale,
} from "@/services/live/LiveAvatarCrop";

describe("live avatar crop geometry", () => {
  it("aspect-fills a landscape image and keeps the initial crop centered", () => {
    expect(minimumLiveAvatarScale({ width: 1200, height: 800 }, 300)).toBe(0.375);
    expect(liveAvatarCropRect({ width: 1200, height: 800 }, 300, 1, { x: 0, y: 0 })).toEqual({ originX: 200, originY: 0, width: 800, height: 800 });
    expect(liveAvatarCropRect({ width: 800, height: 1200 }, 300, 1, { x: 0, y: 0 })).toEqual({ originX: 0, originY: 200, width: 800, height: 800 });
  });

  it("clamps zoom to 1...5 and offsets to the visible image bounds", () => {
    const clamped = clampedLiveAvatarOffset({ x: 500, y: -500 }, { width: 1200, height: 800 }, 300, 1);
    expect(clamped.x).toBeCloseTo(75);
    expect(clamped.y).toBeCloseTo(0);
    expect(liveAvatarCropRect({ width: 1200, height: 800 }, 300, 2, { x: 75, y: 0 })).toEqual({ originX: 300, originY: 200, width: 400, height: 400 });
    expect(clampedLiveAvatarOffset({ x: 999, y: -999 }, { width: 1200, height: 800 }, 320, 2)).toEqual({ x: 320, y: -160 });
    expect(liveAvatarCropRect({ width: 1200, height: 800 }, 320, 99, { x: 9999, y: -9999 })).toEqual({ originX: 0, originY: 640, width: 160, height: 160 });
  });

  it("integral-expands the crop like CGRect.integral while staying in bounds", () => {
    expect(integralLiveAvatarCropRect({ originX: 10.4, originY: 20.8, width: 50.2, height: 50.2 }, { width: 100, height: 100 })).toEqual({ originX: 10, originY: 20, width: 51, height: 51 });
    expect(integralLiveAvatarCropRect({ originX: 95.2, originY: 95.2, width: 10, height: 10 }, { width: 100, height: 100 })).toEqual({ originX: 95, originY: 95, width: 5, height: 5 });
  });
});
