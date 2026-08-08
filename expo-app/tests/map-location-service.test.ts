import {
  bestUsableMapLocation,
  isUsableMapLocation,
  LoginLocationRecorder,
  mapForegroundUploadPolicy,
  mapLocationQualityPolicy,
  mapLocationUpdateBody,
  shouldUploadForegroundMapLocation,
  type LoginLocationRecorderDependencies,
  type MapDeviceLocation,
} from "@/services/location/MapLocationService";

jest.mock("@/services/monitoring/MonitoringService", () => ({ captureException: jest.fn() }));

const now = Date.parse("2026-08-07T06:00:00.000Z");

describe("map location quality and login recorder", () => {
  it("accepts a fresh nonzero coordinate at the original 100m/30s boundaries", () => {
    expect(isUsableMapLocation(location({ accuracy: 100, timestamp: now - 30_000 }), now)).toBe(true);
    expect(mapLocationQualityPolicy).toEqual({
      maximumAgeMilliseconds: 30_000,
      maximumHorizontalAccuracyMeters: 100,
      requestTimeoutMilliseconds: 12_000,
    });
  });

  it.each([
    ["stale", location({ timestamp: now - 30_001 })],
    ["future stale", location({ timestamp: now + 30_001 })],
    ["inaccurate", location({ accuracy: 100.01 })],
    ["negative accuracy", location({ accuracy: -1 })],
    ["zero sentinel", location({ latitude: 0, longitude: 0 })],
    ["latitude range", location({ latitude: 91 })],
    ["longitude range", location({ longitude: -181 })],
  ])("rejects %s locations", (_name, value) => {
    expect(isUsableMapLocation(value, now)).toBe(false);
  });

  it("selects the most accurate usable coordinate in an update batch", () => {
    const inaccurate = location({ accuracy: 110 });
    const usable = location({ accuracy: 20 });
    const best = location({ accuracy: 7 });
    expect(bestUsableMapLocation([inaccurate, usable, best], now)).toBe(best);
  });

  it("accepts both the real expo-location accuracy field and native-shaped fixtures", () => {
    const expoLocation = location({ accuracy: 5 });
    const nativeShapedLocation: MapDeviceLocation = {
      coords: {
        latitude: 35.6812,
        longitude: 139.7671,
        horizontalAccuracy: 6,
      },
      timestamp: now,
    };

    expect(isUsableMapLocation(expoLocation, now)).toBe(true);
    expect(isUsableMapLocation(nativeShapedLocation, now)).toBe(true);
    expect(mapLocationUpdateBody(expoLocation, "map_visit", "expo-event").accuracy_m).toBe(5);
    expect(
      mapLocationUpdateBody(nativeShapedLocation, "map_visit", "native-event").accuracy_m,
    ).toBe(6);
  });

  it("builds the exact map location wire body", () => {
    expect(mapLocationUpdateBody(location({ accuracy: 12 }), "map_visit", "event-1")).toEqual({
      latitude: 35.6812,
      longitude: 139.7671,
      accuracy_m: 12,
      source: "map_visit",
      event_id: "event-1",
      recorded_at: "2026-08-07T06:00:00.000Z",
    });
  });

  it("uses the original 100 meter or 60 second foreground upload boundaries", () => {
    const start = { latitude: 35.681236, longitude: 139.767125 };
    const justUnder100m = coordinateNorth(start, 99.999);
    const justOver100m = coordinateNorth(start, 100.001);
    expect(mapForegroundUploadPolicy).toEqual({
      maximumIntervalMilliseconds: 60_000,
      minimumDistanceMeters: 100,
    });
    expect(shouldUploadForegroundMapLocation(justUnder100m, start, 1_000, 60_999)).toBe(
      false,
    );
    expect(shouldUploadForegroundMapLocation(justUnder100m, start, 1_000, 61_000)).toBe(
      true,
    );
    expect(shouldUploadForegroundMapLocation(justOver100m, start, 1_000, 1_001)).toBe(true);
    expect(shouldUploadForegroundMapLocation(start, null, 1_000, 1_001)).toBe(true);
    expect(shouldUploadForegroundMapLocation(start, start, 1_000, 1_001, true)).toBe(true);
  });

  it("records an explicit login only after permission, fresh location and owner checks", async () => {
    const upload = jest.fn(async () => ({}));
    const dependencies = deps({ upload });
    const recorder = new LoginLocationRecorder(dependencies);
    await recorder.recordAfterLogin(" owner ", (candidate) => candidate === "owner");
    expect(dependencies.requestPermission).toHaveBeenCalledTimes(1);
    expect(dependencies.requestLocation).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(location(), "login", "event-1");
  });

  it("does not request or upload for a blank/mismatched owner or denied permission", async () => {
    const dependencies = deps({ requestPermission: jest.fn(async () => false) });
    const recorder = new LoginLocationRecorder(dependencies);
    await recorder.recordAfterLogin("", () => true);
    await recorder.recordAfterLogin("owner", () => false);
    await recorder.recordAfterLogin("owner", () => true);
    expect(dependencies.requestPermission).toHaveBeenCalledTimes(1);
    expect(dependencies.requestLocation).not.toHaveBeenCalled();
    expect(dependencies.upload).not.toHaveBeenCalled();
  });

  it("drops stale coordinates and an account that changes during acquisition", async () => {
    const staleDependencies = deps({ requestLocation: jest.fn(async () => location({ timestamp: now - 30_001 })) });
    await new LoginLocationRecorder(staleDependencies).recordAfterLogin("owner", () => true);
    expect(staleDependencies.upload).not.toHaveBeenCalled();

    let authenticated = true;
    const switchedDependencies = deps({
      requestLocation: jest.fn(async () => {
        authenticated = false;
        return location();
      }),
    });
    await new LoginLocationRecorder(switchedDependencies)
      .recordAfterLogin("owner", () => authenticated);
    expect(switchedDependencies.upload).not.toHaveBeenCalled();
  });

  it("allows only one recording flight and unlocks after it settles", async () => {
    let finishLocation: ((value: MapDeviceLocation | null) => void) | undefined;
    const pendingLocation = new Promise<MapDeviceLocation | null>((resolve) => { finishLocation = resolve; });
    const dependencies = deps({ requestLocation: jest.fn(() => pendingLocation) });
    const recorder = new LoginLocationRecorder(dependencies);
    const first = recorder.recordAfterLogin("owner", () => true);
    await Promise.resolve();
    await recorder.recordAfterLogin("owner", () => true);
    expect(dependencies.requestLocation).toHaveBeenCalledTimes(1);
    finishLocation?.(location());
    await first;
    await recorder.recordAfterLogin("owner", () => true);
    expect(dependencies.requestLocation).toHaveBeenCalledTimes(2);
    expect(dependencies.upload).toHaveBeenCalledTimes(2);
  });

  it("swallows upload failure so successful authentication is never rolled back", async () => {
    const dependencies = deps({ upload: jest.fn(async () => { throw new Error("offline"); }) });
    await expect(new LoginLocationRecorder(dependencies).recordAfterLogin("owner", () => true))
      .resolves.toBeUndefined();
  });
});

function location(overrides: {
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  timestamp?: number;
} = {}): MapDeviceLocation {
  return {
    coords: {
      latitude: overrides.latitude ?? 35.6812,
      longitude: overrides.longitude ?? 139.7671,
      accuracy: overrides.accuracy ?? 12,
    },
    timestamp: overrides.timestamp ?? now,
  };
}

function deps(overrides: Partial<LoginLocationRecorderDependencies> = {}): LoginLocationRecorderDependencies {
  return {
    requestPermission: jest.fn(async () => true),
    requestLocation: jest.fn(async () => location()),
    upload: jest.fn(async () => ({})),
    makeEventId: () => "event-1",
    now: () => now,
    ...overrides,
  };
}

function coordinateNorth(
  coordinate: { latitude: number; longitude: number },
  meters: number,
): { latitude: number; longitude: number } {
  return {
    latitude: coordinate.latitude + (meters / 6_371_000) * (180 / Math.PI),
    longitude: coordinate.longitude,
  };
}
