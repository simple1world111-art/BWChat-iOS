import AsyncStorage from "@react-native-async-storage/async-storage";

import { getConversationSyncSnapshot } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  fetchDiscoverSections,
  readDiscoverRefreshCheckpoint,
  saveDiscoverRefreshCheckpoint,
} from "@/services/discover/DiscoverConfigRepository";
import { readAccessToken } from "@/storage/tokenStorage";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));
jest.mock("@/storage/tokenStorage", () => ({ readAccessToken: jest.fn() }));

const request = jest.mocked(apiRequest);
const accessToken = jest.mocked(readAccessToken);

describe("native no-cache and optional-auth request contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    accessToken.mockReset();
    await AsyncStorage.clear();
  });

  it("loads the conversation sync snapshot without URL cache reuse", async () => {
    request.mockResolvedValueOnce({ conversations: [], total_unread: 0 });
    await expect(getConversationSyncSnapshot()).resolves.toMatchObject({ conversations: [] });
    expect(request).toHaveBeenCalledWith("/chat/conversations", {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
    });
  });

  it("keeps discover config unauthenticated for a guest and disables refresh/logout", async () => {
    accessToken.mockResolvedValueOnce(null);
    request.mockResolvedValueOnce({ sections: [] });
    await fetchDiscoverSections();
    expect(request).toHaveBeenCalledWith("/app/discover-config", {
      auth: false,
      refreshAuth: false,
      invalidateSessionOnUnauthorized: false,
      cache: "no-store",
      headers: { "X-App-Build": "mock", "X-App-Version": "mock" },
      timeoutMs: 8_000,
    });
  });

  it("attaches optional auth and native refresh/logout behavior when a token exists", async () => {
    accessToken.mockResolvedValueOnce("token");
    request.mockResolvedValueOnce({ sections: [] });
    await fetchDiscoverSections();
    expect(request).toHaveBeenCalledWith("/app/discover-config", {
      auth: true,
      refreshAuth: true,
      invalidateSessionOnUnauthorized: true,
      cache: "no-store",
      headers: { "X-App-Build": "mock", "X-App-Version": "mock" },
      timeoutMs: 8_000,
    });
  });

  it("persists discover refresh checkpoints independently for each account", async () => {
    await saveDiscoverRefreshCheckpoint("owner/a", 123_456);

    await expect(readDiscoverRefreshCheckpoint("owner/a")).resolves.toBe(123_456);
    await expect(readDiscoverRefreshCheckpoint("owner/b")).resolves.toBe(0);
  });
});
