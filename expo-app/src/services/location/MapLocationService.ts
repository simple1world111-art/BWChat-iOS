import { randomUUID } from "expo-crypto";
import * as Location from "expo-location";

import { apiRequest } from "@/api/client";
import { captureException } from "@/services/monitoring/MonitoringService";

export type MapLocationRecordSource = "login" | "map_visit" | "foreground_update";

export interface MapDeviceLocation {
  coords: {
    latitude: number;
    longitude: number;
    /** Expo LocationObjectCoords exposes horizontal accuracy as `accuracy`. */
    accuracy?: number | null | undefined;
    /** Kept for native-shaped fixtures and callers that already normalize CLLocation. */
    horizontalAccuracy?: number | null | undefined;
  };
  timestamp: number;
}

export const mapLocationQualityPolicy = Object.freeze({
  maximumAgeMilliseconds: 30_000,
  maximumHorizontalAccuracyMeters: 100,
  requestTimeoutMilliseconds: 12_000,
});

export const mapForegroundUploadPolicy = Object.freeze({
  minimumDistanceMeters: 100,
  maximumIntervalMilliseconds: 60_000,
});

export interface MapLocationCoordinate {
  latitude: number;
  longitude: number;
}

export function isUsableMapLocation(
  location: MapDeviceLocation,
  nowMilliseconds = Date.now(),
): boolean {
  const { latitude, longitude } = location.coords;
  const horizontalAccuracy = mapHorizontalAccuracy(location);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    (Math.abs(latitude) > 0.000001 || Math.abs(longitude) > 0.000001) &&
    typeof horizontalAccuracy === "number" &&
    Number.isFinite(horizontalAccuracy) &&
    horizontalAccuracy >= 0 &&
    horizontalAccuracy <= mapLocationQualityPolicy.maximumHorizontalAccuracyMeters &&
    Number.isFinite(location.timestamp) &&
    Math.abs(nowMilliseconds - location.timestamp) <=
      mapLocationQualityPolicy.maximumAgeMilliseconds
  );
}

export function mapHorizontalAccuracy(location: MapDeviceLocation): number | null {
  const value = location.coords.accuracy ?? location.coords.horizontalAccuracy;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function mapDistanceMeters(
  left: MapLocationCoordinate,
  right: MapLocationCoordinate,
): number {
  const earthRadius = 6_371_000;
  const latitude1 = (left.latitude * Math.PI) / 180;
  const latitude2 = (right.latitude * Math.PI) / 180;
  const latitudeDelta = ((right.latitude - left.latitude) * Math.PI) / 180;
  const longitudeDelta = ((right.longitude - left.longitude) * Math.PI) / 180;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function shouldUploadForegroundMapLocation(
  current: MapLocationCoordinate,
  lastUploaded: MapLocationCoordinate | null,
  lastUploadedAtMilliseconds: number,
  nowMilliseconds = Date.now(),
  force = false,
): boolean {
  if (force || !lastUploaded) return true;
  return (
    mapDistanceMeters(lastUploaded, current) >=
      mapForegroundUploadPolicy.minimumDistanceMeters ||
    nowMilliseconds - lastUploadedAtMilliseconds >=
      mapForegroundUploadPolicy.maximumIntervalMilliseconds
  );
}

export function bestUsableMapLocation(
  locations: readonly MapDeviceLocation[],
  nowMilliseconds = Date.now(),
): MapDeviceLocation | null {
  return (
    locations
      .filter((location) => isUsableMapLocation(location, nowMilliseconds))
      .sort(
        (left, right) =>
          (mapHorizontalAccuracy(left) ?? Number.POSITIVE_INFINITY) -
          (mapHorizontalAccuracy(right) ?? Number.POSITIVE_INFINITY),
      )[0] ?? null
  );
}

export function mapLocationUpdateBody(
  location: MapDeviceLocation,
  source: MapLocationRecordSource,
  eventId: string,
): Record<string, unknown> {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy_m: mapHorizontalAccuracy(location),
    source,
    event_id: eventId,
    recorded_at: new Date(location.timestamp).toISOString(),
  };
}

export async function requestForegroundLocationPermission(): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Location.requestForegroundPermissionsAsync()).granted;
}

export async function requestFreshUsableLocation(
  timeoutMilliseconds: number = mapLocationQualityPolicy.requestTimeoutMilliseconds,
): Promise<MapDeviceLocation | null> {
  return new Promise((resolve) => {
    let finished = false;
    let subscription: Location.LocationSubscription | null = null;
    const finish = (location: MapDeviceLocation | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      subscription?.remove();
      resolve(location);
    };
    const timeout = setTimeout(() => finish(null), timeoutMilliseconds);
    void Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Highest,
        distanceInterval: 0,
        mayShowUserSettingsDialog: true,
      },
      (location) => {
        if (isUsableMapLocation(location)) finish(location);
      },
      () => finish(null),
    )
      .then((value) => {
        subscription = value;
        if (finished) value.remove();
      })
      .catch((error) => {
        captureException(error, { operation: "map_location_watch" });
        finish(null);
      });
  });
}

export async function watchUsableMapLocations(
  onLocation: (location: MapDeviceLocation) => void,
  onError?: ((error: unknown) => void) | undefined,
): Promise<Location.LocationSubscription> {
  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Highest,
      distanceInterval: 10,
      mayShowUserSettingsDialog: true,
    },
    (location) => {
      if (isUsableMapLocation(location)) onLocation(location);
    },
    (reason) => {
      const error = new Error(reason);
      captureException(error, { operation: "map_foreground_location_watch" });
      onError?.(error);
    },
  );
}

export async function uploadMapLocation(
  location: MapDeviceLocation,
  source: MapLocationRecordSource,
  eventId = randomUUID(),
): Promise<unknown> {
  if (!isUsableMapLocation(location))
    throw new Error("Location does not satisfy the map quality policy");
  return apiRequest<unknown>("/map/me/location", {
    method: "PUT",
    body: mapLocationUpdateBody(location, source, eventId),
  });
}

export interface LoginLocationRecorderDependencies {
  requestPermission(): Promise<boolean>;
  requestLocation(): Promise<MapDeviceLocation | null>;
  upload(
    location: MapDeviceLocation,
    source: MapLocationRecordSource,
    eventId: string,
  ): Promise<unknown>;
  makeEventId(): string;
  now(): number;
}

export class LoginLocationRecorder {
  private recordingUserId: string | null = null;

  constructor(
    private readonly dependencies: LoginLocationRecorderDependencies = liveDependencies,
  ) {}

  async recordAfterLogin(
    userId: string,
    isAuthenticated: (ownerId: string) => boolean,
  ): Promise<void> {
    const ownerId = userId.trim();
    if (!ownerId || this.recordingUserId !== null || !isAuthenticated(ownerId)) return;
    this.recordingUserId = ownerId;
    try {
      if (!(await this.dependencies.requestPermission()) || !isAuthenticated(ownerId)) return;
      const location = await this.dependencies.requestLocation();
      if (
        !location ||
        !isUsableMapLocation(location, this.dependencies.now()) ||
        !isAuthenticated(ownerId)
      )
        return;
      try {
        await this.dependencies.upload(location, "login", this.dependencies.makeEventId());
      } catch (error) {
        captureException(error, { operation: "login_location_upload" });
      }
    } finally {
      this.recordingUserId = null;
    }
  }
}

const liveDependencies: LoginLocationRecorderDependencies = {
  requestPermission: requestForegroundLocationPermission,
  requestLocation: requestFreshUsableLocation,
  upload: uploadMapLocation,
  makeEventId: randomUUID,
  now: Date.now,
};

export const loginLocationRecorder = new LoginLocationRecorder();
