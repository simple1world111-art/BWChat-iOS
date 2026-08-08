import { apiRequest } from "@/api/client";
import {
  disableMapPresence,
  updateMapSettings,
} from "@/services/location/MapDatingRepository";

jest.mock("@/api/client", () => ({ apiRequest: jest.fn() }));

const mockedApiRequest = jest.mocked(apiRequest);

describe("map settings backend contract", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("sends only the supplied Swift settings fields to the exact PUT endpoint", async () => {
    mockedApiRequest.mockResolvedValueOnce({
      presence: {
        enabled: true,
        online_status: "online",
        status: "active",
        visibility_scope: "everyone",
      },
    });

    await expect(
      updateMapSettings({
        onlineStatus: "online",
        statusText: "",
        visibilityScope: "everyone",
      }),
    ).resolves.toMatchObject({
      enabled: true,
      onlineStatus: "online",
      visibilityScope: "everyone",
    });
    expect(mockedApiRequest).toHaveBeenCalledWith("/map/me/settings", {
      body: {
        online_status: "online",
        status_text: "",
        visibility_scope: "everyone",
      },
      method: "PUT",
    });
  });

  it("matches the Swift successful-empty-response fallback to GET /map/me", async () => {
    mockedApiRequest
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        presence: {
          enabled: true,
          online_status: "invisible",
          status: "invisible",
          visibility_scope: "friends",
        },
      });

    await expect(updateMapSettings({ onlineStatus: "invisible" })).resolves.toMatchObject({
      enabled: true,
      onlineStatus: "invisible",
      visibilityScope: "friends",
    });
    expect(mockedApiRequest).toHaveBeenNthCalledWith(2, "/map/me", { cache: "no-store" });
  });

  it("uses the exact POST disable endpoint and empty JSON body", async () => {
    mockedApiRequest.mockResolvedValueOnce({
      presence: {
        enabled: false,
        online_status: "invisible",
        status: "off",
        visibility_scope: "off",
      },
    });

    await expect(disableMapPresence()).resolves.toMatchObject({
      enabled: false,
      onlineStatus: "invisible",
      visibilityScope: "off",
    });
    expect(mockedApiRequest).toHaveBeenCalledWith("/map/me/disable", {
      body: {},
      method: "POST",
    });
  });
});
