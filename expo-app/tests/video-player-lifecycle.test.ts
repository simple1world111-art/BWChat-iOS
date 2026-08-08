import {
  isDisposedVideoPlayerError,
  pauseVideoPlayer,
  playVideoPlayer,
  runVideoPlayerCall,
} from "@/services/media/VideoPlayerGuard";

const disposedMessage =
  "Unable to find the native shared object associated with given JavaScript object";

describe("shared VideoPlayer lifecycle guard", () => {
  it("plays and pauses a live native player", () => {
    const player = { play: jest.fn(), pause: jest.fn() };
    playVideoPlayer(player);
    pauseVideoPlayer(player);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.pause).toHaveBeenCalledTimes(1);
  });

  it("ignores only the Expo shared-object disposal race", () => {
    const disposed = new Error(disposedMessage);
    expect(isDisposedVideoPlayerError(disposed)).toBe(true);
    expect(
      runVideoPlayerCall(() => {
        throw disposed;
      }, "released"),
    ).toBe("released");
  });

  it("keeps unrelated playback failures visible", () => {
    expect(isDisposedVideoPlayerError(new Error("decoder failed"))).toBe(false);
    expect(() =>
      runVideoPlayerCall(() => {
        throw new Error("decoder failed");
      }, undefined),
    ).toThrow("decoder failed");
  });
});
