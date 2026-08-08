import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  clearLegacyCachedUser,
  readLegacyCachedUserJSON,
  readLegacyLastActiveAccountId,
} from "../modules/bwchat-auth-compat/src";
import type { User } from "@/models";
import { clearCachedUser, readCachedUser, saveCachedUser } from "@/storage/authStorage";

jest.mock("../modules/bwchat-auth-compat/src", () => ({
  clearLegacyCachedUser: jest.fn(),
  readLegacyCachedUserJSON: jest.fn(),
  readLegacyLastActiveAccountId: jest.fn(),
}));

const readLegacy = jest.mocked(readLegacyCachedUserJSON);
const readLastActive = jest.mocked(readLegacyLastActiveAccountId);
const clearLegacy = jest.mocked(clearLegacyCachedUser);

describe("native auth identity cache compatibility", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    readLegacy.mockResolvedValue(null);
    readLastActive.mockResolvedValue(null);
    clearLegacy.mockResolvedValue();
  });

  it("prefers the current Expo cache without consulting native compatibility data", async () => {
    await AsyncStorage.setItem("bwchat.auth.current-user.v1", JSON.stringify(user("expo")));
    await expect(readCachedUser()).resolves.toEqual(user("expo"));
    expect(readLegacy).not.toHaveBeenCalled();
    expect(readLastActive).not.toHaveBeenCalled();
  });

  it("migrates the original cached_current_user JSON into the Expo cache", async () => {
    readLegacy.mockResolvedValue(JSON.stringify(user("native")));
    await expect(readCachedUser()).resolves.toEqual(user("native"));
    await expect(AsyncStorage.getItem("bwchat.auth.current-user.v1")).resolves.toBe(
      JSON.stringify(user("native")),
    );
    expect(clearLegacy).toHaveBeenCalledTimes(1);
  });

  it("repairs a token-backed identity from the original last-active account id", async () => {
    readLegacy.mockResolvedValue("not-json");
    readLastActive.mockResolvedValue(" legacy-id ");
    await expect(readCachedUser()).resolves.toEqual(user("legacy-id"));
    expect(clearLegacy).toHaveBeenCalledTimes(1);
  });

  it("writes and clears both current and compatibility identities", async () => {
    await saveCachedUser(user("saved"));
    await expect(AsyncStorage.getItem("bwchat.auth.current-user.v1")).resolves.toBe(
      JSON.stringify(user("saved")),
    );
    expect(clearLegacy).toHaveBeenCalledTimes(1);

    await clearCachedUser();
    await expect(AsyncStorage.getItem("bwchat.auth.current-user.v1")).resolves.toBeNull();
    expect(clearLegacy).toHaveBeenCalledTimes(2);
  });
});

function user(id: string): User {
  return {
    user_id: id,
    username: id === "legacy-id" ? "" : id,
    nickname: id,
    avatar_url: "",
    bio: "",
    gender: "",
    birthday: "",
    location: "",
    following_count: 0,
    follower_count: 0,
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
  };
}
