import * as Location from "expo-location";

import {
  requestForegroundLocationPermission,
  requestFreshUsableLocation,
  watchUsableMapLocations,
} from "@/services/location/MapLocationService";

jest.mock("expo-location", () => ({
  Accuracy: { Highest: 6 },
  PermissionStatus: {
    DENIED: "denied",
    GRANTED: "granted",
    UNDETERMINED: "undetermined",
  },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));
jest.mock("@/services/monitoring/MonitoringService", () => ({ captureException: jest.fn() }));

const mockedLocation = jest.mocked(Location);

describe("map location runtime boundaries", () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("uses an existing foreground grant without opening another prompt", async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue(
      permission({ granted: true, status: Location.PermissionStatus.GRANTED }),
    );

    await expect(requestForegroundLocationPermission()).resolves.toBe(true);
    expect(mockedLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it("does not re-prompt a denied permission that cannot be requested again", async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue(
      permission({ canAskAgain: false, status: Location.PermissionStatus.DENIED }),
    );

    await expect(requestForegroundLocationPermission()).resolves.toBe(false);
    expect(mockedLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it("returns the result of the one allowed foreground permission request", async () => {
    mockedLocation.getForegroundPermissionsAsync.mockResolvedValue(permission());
    mockedLocation.requestForegroundPermissionsAsync.mockResolvedValue(
      permission({ granted: true, status: Location.PermissionStatus.GRANTED }),
    );

    await expect(requestForegroundLocationPermission()).resolves.toBe(true);
    expect(mockedLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it("ignores unusable callbacks, resolves the first usable Expo location and removes the watch", async () => {
    const remove = jest.fn();
    let deliver: ((value: Location.LocationObject) => void) | undefined;
    mockedLocation.watchPositionAsync.mockImplementation(async (_options, listener) => {
      deliver = listener;
      return { remove };
    });

    const pending = requestFreshUsableLocation(5_000);
    await Promise.resolve();
    deliver?.(expoLocation({ accuracy: 101 }));
    deliver?.(expoLocation({ accuracy: 5 }));

    await expect(pending).resolves.toMatchObject({
      coords: { accuracy: 5, latitude: 35.681236, longitude: 139.767125 },
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("returns null and stops the native watch when no usable fix arrives before timeout", async () => {
    jest.useFakeTimers();
    const remove = jest.fn();
    mockedLocation.watchPositionAsync.mockResolvedValue({ remove });

    const pending = requestFreshUsableLocation(5_000);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toBeNull();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("filters unusable foreground updates and forwards the native failure", async () => {
    const remove = jest.fn();
    let deliver: ((value: Location.LocationObject) => void) | undefined;
    let fail: ((reason: string) => void) | undefined;
    mockedLocation.watchPositionAsync.mockImplementation(
      async (_options, listener, errorHandler) => {
        deliver = listener;
        fail = errorHandler;
        return { remove };
      },
    );
    const onLocation = jest.fn();
    const onError = jest.fn();

    const subscription = await watchUsableMapLocations(onLocation, onError);
    deliver?.(expoLocation({ accuracy: -1 }));
    deliver?.(expoLocation({ accuracy: 8 }));
    fail?.("location services unavailable");

    expect(onLocation).toHaveBeenCalledTimes(1);
    expect(onLocation).toHaveBeenCalledWith(
      expect.objectContaining({ coords: expect.objectContaining({ accuracy: 8 }) }),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "location services unavailable" }),
    );
    expect(subscription.remove).toBe(remove);
  });
});

function permission(
  overrides: Partial<Location.LocationPermissionResponse> = {},
): Location.LocationPermissionResponse {
  return {
    canAskAgain: true,
    expires: "never",
    granted: false,
    status: Location.PermissionStatus.UNDETERMINED,
    ...overrides,
  };
}

function expoLocation({ accuracy }: { accuracy: number }): Location.LocationObject {
  return {
    coords: {
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      latitude: 35.681236,
      longitude: 139.767125,
      speed: null,
    },
    timestamp: Date.now(),
  };
}
