import AsyncStorage from "@react-native-async-storage/async-storage";

import { getChatSync, getConversationSyncSnapshot } from "@/api/bwchat";
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

    const controller = new AbortController();
    request.mockResolvedValueOnce({ conversations: [], total_unread: 0 });
    await getConversationSyncSnapshot(controller.signal);
    expect(request).toHaveBeenLastCalledWith("/chat/conversations", {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
  });

  it("loads strict messaging sync-v2 pages with bounded query values and optional cancellation", async () => {
    const response = {
      events: [],
      next_event_seq: 41,
      has_more: false,
      snapshot_revision: 7,
      server_time: "2026-08-13T01:00:00Z",
      full_sync_required: false,
    };
    request.mockResolvedValue(response);

    await expect(getChatSync(41, 100)).resolves.toEqual(response);
    expect(request).toHaveBeenNthCalledWith(1, "/chat/sync?after_event_seq=41&limit=100", {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
    });

    const controller = new AbortController();
    await expect(getChatSync(0, 1, controller.signal)).resolves.toEqual(response);
    expect(request).toHaveBeenNthCalledWith(2, "/chat/sync?after_event_seq=0&limit=1", {
      cache: "no-store",
      requiredData: true,
      requiredEnvelope: true,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
  });

  it("rejects invalid messaging sync-v2 watermarks before issuing a request", async () => {
    await expect(getChatSync(-1, 100)).rejects.toThrow(RangeError);
    await expect(getChatSync(0, 0)).rejects.toThrow(RangeError);
    await expect(getChatSync(0, 101)).rejects.toThrow(RangeError);
    expect(request).not.toHaveBeenCalled();
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
