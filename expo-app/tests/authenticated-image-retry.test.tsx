import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { AuthenticatedImage } from "@/components/AuthenticatedImage";

const mockGetAdoptedImageUri = jest.fn<Promise<string | undefined>, [string]>();
const mockGetAuthenticatedImageUri = jest.fn<Promise<string | undefined>, [string, string?]>();

jest.mock("expo-image", () => ({
  Image: (props: Record<string, unknown>) => {
    const { View } = jest.requireActual("react-native") as typeof import("react-native");
    return <View {...props} />;
  },
}));
jest.mock("expo-symbols", () => ({
  SymbolView: () => {
    const { View } = jest.requireActual("react-native") as typeof import("react-native");
    return <View />;
  },
}));
jest.mock("@/services/cache/ImageCacheService", () => ({
  getAdoptedImageUri: (cacheKey: string) => mockGetAdoptedImageUri(cacheKey),
  getAuthenticatedImageUri: (uri: string, cacheKey?: string) =>
    mockGetAuthenticatedImageUri(uri, cacheKey),
  imageCachePolicy: { cachePolicy: "memory-disk" },
  peekAdoptedImageUri: () => undefined,
  peekAuthenticatedImageUri: () => undefined,
}));

describe("AuthenticatedImage transient availability", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetAdoptedImageUri.mockReset().mockResolvedValue(undefined);
    mockGetAuthenticatedImageUri.mockReset();
  });

  afterEach(() => jest.useRealTimers());

  it("retries the same authenticated URL in place until its bytes become available", async () => {
    mockGetAuthenticatedImageUri
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("file:///cache/generated-image.jpg");

    await render(
      <AuthenticatedImage
        authenticatedRetryIntervalMilliseconds={1_000}
        maximumAuthenticatedRetries={2}
        testID="generated-image"
        uri="http://localhost:8000/api/v1/agent-media/media-1/preview"
      />,
    );
    await flushMicrotasks();
    expect(mockGetAuthenticatedImageUri).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("generated-image")).toBeNull();

    await advanceRetry();
    expect(mockGetAuthenticatedImageUri).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("generated-image")).toBeNull();

    await advanceRetry();
    expect(mockGetAuthenticatedImageUri).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("generated-image")).toBeTruthy();
  });

  it("retains the supplied preview until the replacement image has actually loaded", async () => {
    const { View } = jest.requireActual("react-native") as typeof import("react-native");
    await render(
      <AuthenticatedImage
        loadingFallback={<View testID="unlock-preview" />}
        retainLoadingFallbackUntilImageLoad
        testID="unlocked-image"
        uri="https://cdn.example.com/unlocked-image.jpg"
      />,
    );

    const initialImage = screen.getByTestId("unlocked-image");
    expect(screen.getByTestId("unlock-preview")).toBeTruthy();
    await fireEvent(screen.getByTestId("unlocked-image"), "load", {
      source: { height: 100, width: 100 },
    });
    expect(screen.queryByTestId("unlock-preview")).toBeNull();
    expect(screen.getByTestId("unlocked-image")).toBe(initialImage);
  });
});

async function advanceRetry(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(1_000);
    await flushMicrotasks();
  });
}

async function flushMicrotasks(count = 8): Promise<void> {
  await act(async () => {
    for (let index = 0; index < count; index += 1) await Promise.resolve();
  });
}
