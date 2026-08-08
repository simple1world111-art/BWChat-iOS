import { prepareScriptImage } from "@/services/scripts/scriptEditorPolicy";

interface MockFileRecord {
  deleted: jest.Mock;
  exists: boolean;
  size: number;
}

const mockFiles = new Map<string, MockFileRecord>();
const mockManipulate = jest.fn();

jest.mock("expo-file-system", () => ({
  File: class MockFile {
    readonly uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    get exists(): boolean {
      return mockFiles.get(this.uri)?.exists ?? false;
    }

    get size(): number | undefined {
      return mockFiles.get(this.uri)?.size;
    }

    delete(): void {
      const record = mockFiles.get(this.uri);
      if (!record) return;
      record.deleted();
      record.exists = false;
    }

    slice(): { arrayBuffer(): Promise<ArrayBuffer> } {
      return {
        arrayBuffer: async () => new Uint8Array([0, 0, 0]).buffer,
      };
    }
  },
  Paths: { cache: { uri: "file:///cache" } },
}));

jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulate(...args),
  SaveFormat: { JPEG: "jpeg" },
}));

describe("script image preparation cache ownership", () => {
  beforeEach(() => {
    mockFiles.clear();
    mockManipulate.mockReset();
    addFile("file:///picker/source.heic", 4_000_000);
  });

  it("deletes superseded compression candidates but preserves the selected result and source", async () => {
    const first = addFile("file:///cache/first.jpg", 900_000);
    const selected = addFile("file:///cache/selected.jpg", 650_000);
    mockManipulate
      .mockResolvedValueOnce({ uri: "file:///cache/first.jpg" })
      .mockResolvedValueOnce({ uri: "file:///cache/selected.jpg" });

    await expect(
      prepareScriptImage("file:///picker/source.heic", 3_024, 4_032, "script_role_avatar"),
    ).resolves.toBe("file:///cache/selected.jpg");

    expect(first.deleted).toHaveBeenCalledTimes(1);
    expect(selected.deleted).not.toHaveBeenCalled();
    expect(mockFiles.get("file:///picker/source.heic")?.deleted).not.toHaveBeenCalled();
  });

  it("deletes the last generated candidate when a later compression attempt fails", async () => {
    const first = addFile("file:///cache/failed-pass.jpg", 900_000);
    mockManipulate
      .mockResolvedValueOnce({ uri: "file:///cache/failed-pass.jpg" })
      .mockRejectedValueOnce(new Error("decode failed"));

    await expect(
      prepareScriptImage("file:///picker/source.heic", 3_024, 4_032, "script_role_avatar"),
    ).rejects.toThrow("decode failed");

    expect(first.deleted).toHaveBeenCalledTimes(1);
    expect(mockFiles.get("file:///picker/source.heic")?.deleted).not.toHaveBeenCalled();
  });
});

function addFile(uri: string, size: number): MockFileRecord {
  const record = { deleted: jest.fn(), exists: true, size };
  mockFiles.set(uri, record);
  return record;
}
