import * as SecureStore from "expo-secure-store";

import {
  clearTokens,
  readAccessToken,
  readRefreshToken,
  resetTokenStorageForTests,
  saveTokens,
} from "@/storage/tokenStorage";

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 3,
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const getItem = jest.mocked(SecureStore.getItemAsync);
const setItem = jest.mocked(SecureStore.setItemAsync);
const deleteItem = jest.mocked(SecureStore.deleteItemAsync);
const nativeOptions = {
  keychainService: "com.bwchat.app",
  keychainAccessible: 3,
};

describe("native Keychain-compatible token storage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTokenStorageForTests();
    setItem.mockResolvedValue();
    deleteItem.mockResolvedValue();
  });

  it("reads the original Swift Keychain service and account names", async () => {
    getItem.mockResolvedValueOnce(" Bearer access-token ");
    await expect(readAccessToken()).resolves.toBe("access-token");
    expect(getItem).toHaveBeenCalledWith("jwt_token", nativeOptions);
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it("migrates an earlier Expo development key when the native key is absent", async () => {
    getItem.mockResolvedValueOnce(null).mockResolvedValueOnce(" refresh-token ");
    await expect(readRefreshToken()).resolves.toBe("refresh-token");
    expect(getItem.mock.calls).toEqual([
      ["jwt_refresh_token", nativeOptions],
      ["bwchat.auth.refresh-token.v1"],
    ]);
    expect(setItem).toHaveBeenCalledWith("jwt_refresh_token", "refresh-token", nativeOptions);
    expect(deleteItem).toHaveBeenCalledWith("bwchat.auth.refresh-token.v1");
  });

  it("writes both tokens with the source accessibility and removes old Expo aliases", async () => {
    await saveTokens({ accessToken: " access ", refreshToken: "Bearer refresh" });
    expect(setItem.mock.calls).toEqual([
      ["jwt_token", "access", nativeOptions],
      ["jwt_refresh_token", "refresh", nativeOptions],
    ]);
    expect(deleteItem.mock.calls).toEqual([
      ["bwchat.auth.access-token.v1"],
      ["bwchat.auth.refresh-token.v1"],
    ]);
  });

  it("uses Foundation rather than JavaScript whitespace semantics for secure token writes", async () => {
    await saveTokens({
      accessToken: "\u0085\u200BBearer access\u0085\u200B",
      refreshToken: "\uFEFFrefresh\uFEFF",
    });
    expect(setItem).toHaveBeenNthCalledWith(1, "jwt_token", "access", nativeOptions);
    expect(setItem).toHaveBeenNthCalledWith(
      2,
      "jwt_refresh_token",
      "\uFEFFrefresh\uFEFF",
      nativeOptions,
    );
  });

  it("clears native and legacy token accounts together", async () => {
    await clearTokens();
    expect(deleteItem.mock.calls).toEqual([
      ["jwt_token", nativeOptions],
      ["jwt_refresh_token", nativeOptions],
      ["bwchat.auth.access-token.v1"],
      ["bwchat.auth.refresh-token.v1"],
    ]);
  });

  it("keeps the normalized active session in memory when Keychain writes fail", async () => {
    setItem.mockRejectedValue(new Error("keychain unavailable"));
    await expect(
      saveTokens({ accessToken: " access ", refreshToken: " refresh " }),
    ).resolves.toBeUndefined();
    jest.clearAllMocks();

    await expect(readAccessToken()).resolves.toBe("access");
    await expect(readRefreshToken()).resolves.toBe("refresh");
    expect(getItem).not.toHaveBeenCalled();
  });

  it("clears the in-memory session even when Keychain deletion fails", async () => {
    await saveTokens({ accessToken: "access", refreshToken: "refresh" });
    deleteItem.mockRejectedValue(new Error("keychain unavailable"));
    await expect(clearTokens()).resolves.toBeUndefined();
    getItem.mockResolvedValue(null);

    await expect(readAccessToken()).resolves.toBeNull();
  });
});
