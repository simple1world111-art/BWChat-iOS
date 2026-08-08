import AsyncStorage from "@react-native-async-storage/async-storage";

import { authenticatedResourceRequest } from "@/api/client";
import {
  getAuthenticatedImageUri,
  resetAdoptedImageCacheForTests,
} from "@/services/cache/ImageCacheService";

const mockFiles = new Map<string, Uint8Array>();
const mockDirectories = new Set<string>();

jest.mock("@/api/client", () => ({ authenticatedResourceRequest: jest.fn() }));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  CryptoEncoding: { HEX: "hex" },
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `hash-${value.length}`),
}));
jest.mock("expo-image", () => ({
  Image: {
    clearDiskCache: jest.fn(async () => undefined),
    clearMemoryCache: jest.fn(async () => undefined),
  },
}));
jest.mock("expo-file-system", () => {
  const join = (parts: (string | { uri: string })[]) => {
    const [first = "", ...rest] = parts.map((part) => (typeof part === "string" ? part : part.uri));
    return [first.replace(/\/$/u, ""), ...rest.map((part) => part.replace(/^\/+|\/+$/gu, ""))]
      .filter(Boolean)
      .join("/");
  };

  class MockDirectory {
    readonly uri: string;

    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }

    get exists() {
      return mockDirectories.has(this.uri);
    }

    create() {
      mockDirectories.add(this.uri);
    }

    delete() {
      mockDirectories.delete(this.uri);
      for (const key of [...mockFiles.keys()]) {
        if (key.startsWith(`${this.uri}/`)) mockFiles.delete(key);
      }
    }
  }

  class MockFile {
    uri: string;

    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }

    get exists() {
      return mockFiles.has(this.uri);
    }

    get size() {
      return mockFiles.get(this.uri)?.byteLength ?? 0;
    }

    write(bytes: Uint8Array) {
      mockFiles.set(this.uri, bytes);
    }

    delete() {
      mockFiles.delete(this.uri);
    }

    async move(destination: MockFile) {
      const bytes = mockFiles.get(this.uri);
      if (bytes) mockFiles.set(destination.uri, bytes);
      mockFiles.delete(this.uri);
      this.uri = destination.uri;
    }

    async copy(destination: MockFile) {
      const bytes = mockFiles.get(this.uri);
      if (bytes) mockFiles.set(destination.uri, bytes);
    }
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { cache: "file:///cache" },
  };
});

const request = jest.mocked(authenticatedResourceRequest);

describe("AgentAuthenticatedImage disk and refresh transport", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockFiles.clear();
    mockDirectories.clear();
    resetAdoptedImageCacheForTests();
    await AsyncStorage.clear();
  });

  it("persists authenticated bytes and reuses the disk file after memory reset", async () => {
    request.mockResolvedValue(binaryResponse([1, 2, 3]));
    const remote = "http://localhost:8000/api/v1/agent-assets/a/content";

    const first = await getAuthenticatedImageUri(remote);
    expect(first).toContain("/bwchat-images/authenticated/");
    expect(request).toHaveBeenCalledTimes(1);

    resetAdoptedImageCacheForTests();
    await expect(getAuthenticatedImageUri(remote)).resolves.toBe(first);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent requests for the same authenticated image", async () => {
    const pending = deferred<Response>();
    request.mockReturnValue(pending.promise);
    const remote = "http://localhost:8000/api/v1/agent-assets/b/content";

    const first = getAuthenticatedImageUri(remote);
    const second = getAuthenticatedImageUri(remote);
    await flushMicrotasks();
    expect(request).toHaveBeenCalledTimes(1);

    pending.resolve(binaryResponse([4, 5, 6]));
    const [firstUri, secondUri] = await Promise.all([first, second]);
    expect(firstUri).toBe(secondUri);
  });

  it("does not let an old in-flight response repopulate a cleared cache", async () => {
    const pending = deferred<Response>();
    request.mockReturnValue(pending.promise);
    const load = getAuthenticatedImageUri(
      "http://localhost:8000/api/v1/agent-assets/stale/content",
    );
    await flushMicrotasks();

    resetAdoptedImageCacheForTests();
    pending.resolve(binaryResponse([7, 8, 9]));

    await expect(load).resolves.toBeUndefined();
    expect([...mockFiles.keys()]).toEqual([]);
  });
});

function binaryResponse(values: number[]): Response {
  const bytes = new Uint8Array(values);
  return {
    status: 200,
    ok: true,
    headers: new Headers({ "Content-Type": "image/jpeg" }),
    arrayBuffer: async () => bytes.buffer,
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushMicrotasks(count = 8): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}
