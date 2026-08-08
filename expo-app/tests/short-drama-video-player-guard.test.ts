import {
  isDisposedShortDramaVideoPlayerError,
  readShortDramaVideoPlayerSnapshot,
  runShortDramaVideoPlayerCall,
} from "@/services/short-drama/ShortDramaVideoPlayerGuard";

describe("ShortDrama VideoPlayer disposed-object guard", () => {
  it("uses the last playback snapshot when Expo has already released the shared object", () => {
    const disposed = disposedPlayerError();
    const player = {
      get currentTime(): number {
        throw disposed;
      },
      get duration(): number {
        throw disposed;
      },
    };
    expect(readShortDramaVideoPlayerSnapshot(player, { position: 7.25, duration: 18 })).toEqual({
      position: 7.25,
      duration: 18,
    });
  });

  it("suppresses only the native disposed-object race and rethrows every other failure", () => {
    const disposed = disposedPlayerError();
    expect(isDisposedShortDramaVideoPlayerError(disposed)).toBe(true);
    expect(
      runShortDramaVideoPlayerCall(() => {
        throw disposed;
      }, "released"),
    ).toBe("released");

    const businessFailure = new Error("media authorization failed");
    expect(isDisposedShortDramaVideoPlayerError(businessFailure)).toBe(false);
    expect(() =>
      runShortDramaVideoPlayerCall(() => {
        throw businessFailure;
      }, undefined),
    ).toThrow(businessFailure);
  });
});

function disposedPlayerError(): Error {
  const error = new Error(
    "Calling the 'pause' function has failed: Unable to find the native shared object associated with given JavaScript object",
  );
  error.name = "FunctionCallException: NotFoundException";
  return error;
}
