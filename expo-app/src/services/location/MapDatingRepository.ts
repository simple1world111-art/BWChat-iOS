import { apiRequest } from "@/api/client";

export type MapVisibilityScope = "off" | "friends" | "everyone";
export type MapOnlineStatus = "online" | "invisible";
export type MapReportReason = "harassment" | "fake_profile" | "unsafe" | "spam" | "other";

export interface MapCoordinate {
  latitude: number;
  longitude: number;
}

export interface MapPresence {
  enabled: boolean;
  visibilityScope: MapVisibilityScope;
  onlineStatus: MapOnlineStatus;
  visibleOnMap: boolean;
  status: string | null;
  latitude: number | null;
  longitude: number | null;
  displayLatitude: number | null;
  displayLongitude: number | null;
  accuracyM: number | null;
  statusText: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
}

export interface MapDatingUser {
  userId: string;
  nickname: string;
  avatarUrl: string;
  bio: string | null;
  gender: string | null;
  age: number | null;
  profileLocation: string | null;
  relation: string | null;
  visibilityScope: MapVisibilityScope | null;
  onlineStatus: MapOnlineStatus;
  statusText: string | null;
  distanceM: number | null;
  distanceText: string | null;
  displayLatitude: number | null;
  displayLongitude: number | null;
  lastActiveAt: string | null;
}

export interface MapUsersResponse {
  users: MapDatingUser[];
  effectiveRadiusM: number | null;
  viewerId: string | null;
  snapshotId: string | null;
}

export interface MapSettingsUpdate {
  visibilityScope?: MapVisibilityScope | undefined;
  onlineStatus?: MapOnlineStatus | undefined;
  statusText?: string | undefined;
}

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface MapViewportPositionState {
  didAutomaticallyPosition: boolean;
  userHasInteracted: boolean;
}

const userListKeys = [
  "users",
  "nearby_users",
  "friends",
  "profiles",
  "items",
  "results",
  "list",
  "records",
] as const;

const coordinateKeys = [
  "location",
  "coordinate",
  "coordinates",
  "position",
  "display_location",
  "display_coordinate",
  "map_location",
  "map_coordinate",
  "map_presence",
  "presence",
  "last_location",
  "geo",
  "geometry",
  "point",
] as const;

export async function getMapPresence(): Promise<MapPresence> {
  return parseMapPresence(await apiRequest<unknown>("/map/me", { cache: "no-store" }));
}

export async function updateMapSettings(update: MapSettingsUpdate): Promise<MapPresence> {
  const body: Record<string, unknown> = {};
  if (update.visibilityScope !== undefined) body.visibility_scope = update.visibilityScope;
  if (update.onlineStatus !== undefined) body.online_status = update.onlineStatus;
  if (update.statusText !== undefined) body.status_text = update.statusText;
  const response = await apiRequest<unknown>("/map/me/settings", { method: "PUT", body });
  try {
    return parseMapPresence(response);
  } catch {
    // The Swift client accepts a successful empty envelope and then refetches `/map/me`.
    return getMapPresence();
  }
}

export async function disableMapPresence(): Promise<MapPresence> {
  return parseMapPresence(
    await apiRequest<unknown>("/map/me/disable", { method: "POST", body: {} }),
  );
}

export async function getAllMapUsers(
  coordinate: MapCoordinate | null,
  viewerId: string,
): Promise<MapUsersResponse> {
  const result = parseMapUsersResponse(
    await apiRequest<unknown>(mapUsersPath(coordinate), { cache: "no-store" }),
    viewerId,
  );
  if (result.viewerId && result.viewerId !== viewerId.trim()) {
    throw new Error("Map users response belongs to another viewer");
  }
  return result;
}

export async function getNearbyMapUsers(input: {
  coordinate: MapCoordinate;
  viewerId: string;
  radiusM?: number | undefined;
  limit?: number | undefined;
  gender?: string | undefined;
  minAge?: number | undefined;
  maxAge?: number | undefined;
  includeFriends?: boolean | undefined;
}): Promise<MapUsersResponse> {
  const query = new URLSearchParams({
    lat: String(input.coordinate.latitude),
    lng: String(input.coordinate.longitude),
    limit: String(input.limit ?? 50),
    include_friends: input.includeFriends === true ? "true" : "false",
  });
  if (input.radiusM !== undefined) query.set("radius_m", String(input.radiusM));
  if (input.gender?.trim()) query.set("gender", input.gender.trim());
  if (input.minAge !== undefined) query.set("min_age", String(input.minAge));
  if (input.maxAge !== undefined) query.set("max_age", String(input.maxAge));
  return parseViewerOwnedMapUsers(
    await apiRequest<unknown>(`/map/nearby?${query.toString()}`, { cache: "no-store" }),
    input.viewerId,
  );
}

export async function getFriendMapUsers(input: {
  coordinate?: MapCoordinate | null | undefined;
  viewerId: string;
  radiusM?: number | undefined;
  limit?: number | undefined;
}): Promise<MapUsersResponse> {
  const query = new URLSearchParams({ limit: String(input.limit ?? 50) });
  if (input.coordinate) {
    query.set("lat", String(input.coordinate.latitude));
    query.set("lng", String(input.coordinate.longitude));
  }
  if (input.radiusM !== undefined) query.set("radius_m", String(input.radiusM));
  return parseViewerOwnedMapUsers(
    await apiRequest<unknown>(`/map/friends?${query.toString()}`, { cache: "no-store" }),
    input.viewerId,
  );
}

export async function getMapUserDetail(
  userId: string,
  coordinate?: MapCoordinate | null,
): Promise<MapDatingUser> {
  const query = new URLSearchParams();
  if (coordinate) {
    query.set("lat", String(coordinate.latitude));
    query.set("lng", String(coordinate.longitude));
  }
  const suffix = query.toString();
  const path = `/map/users/${encodeURIComponent(userId)}`;
  const value = await apiRequest<unknown>(suffix ? `${path}?${suffix}` : path, {
    cache: "no-store",
  });
  const source = unwrapMapUserDetail(value);
  const user = parseMapUser(source);
  if (!user) throw new Error("Map user response is missing the expected user");
  return user;
}

export async function blockMapUser(userId: string): Promise<void> {
  await apiRequest<unknown>(`/map/users/${encodeURIComponent(userId)}/block`, {
    method: "POST",
    body: {},
    transientRetries: false,
  });
}

export async function unblockMapUser(userId: string): Promise<void> {
  await apiRequest<unknown>(`/map/users/${encodeURIComponent(userId)}/block`, {
    method: "DELETE",
    transientRetries: false,
  });
}

export async function reportMapUser(
  userId: string,
  reason: MapReportReason,
  detail?: string,
): Promise<void> {
  const allowedReasons: readonly MapReportReason[] = [
    "harassment",
    "fake_profile",
    "unsafe",
    "spam",
    "other",
  ];
  if (!allowedReasons.includes(reason)) throw new Error("map.report.invalidReason");
  const normalizedDetail = detail?.trim();
  await apiRequest<unknown>(`/map/users/${encodeURIComponent(userId)}/report`, {
    method: "POST",
    body: { reason, ...(normalizedDetail ? { detail: normalizedDetail } : {}) },
    transientRetries: false,
  });
}

export function mapUsersPath(coordinate: MapCoordinate | null): string {
  const query = new URLSearchParams();
  if (coordinate && isMappableCoordinate(coordinate)) {
    query.set("lat", String(coordinate.latitude));
    query.set("lng", String(coordinate.longitude));
  }
  const suffix = query.toString();
  return suffix ? `/map/users?${suffix}` : "/map/users";
}

export function parseMapPresence(input: unknown): MapPresence {
  const source = unwrapRecord(input, ["presence", "item", "data"]);
  const status = optionalString(source.status);
  const visibilityScope = mapVisibilityScope(source.visibility_scope);
  const onlineStatus = mapOnlineStatus(source.online_status ?? status);
  const enabled =
    optionalBoolean(source.enabled) ?? (visibilityScope !== "off" && status !== "off");
  return {
    enabled,
    visibilityScope,
    onlineStatus,
    visibleOnMap:
      optionalBoolean(source.visible_on_map) ??
      (enabled && onlineStatus === "online" && (!status || status === "active")),
    status,
    latitude: optionalNumber(source.latitude),
    longitude: optionalNumber(source.longitude),
    displayLatitude: optionalNumber(source.display_lat ?? source.displayLat),
    displayLongitude: optionalNumber(source.display_lng ?? source.displayLng),
    accuracyM: optionalNumber(source.accuracy_m),
    statusText: optionalString(source.status_text),
    updatedAt: optionalString(source.updated_at),
    expiresAt: optionalString(source.expires_at),
  };
}

export function parseMapUsersResponse(input: unknown, viewerId: string): MapUsersResponse {
  const normalizedViewerId = viewerId.trim();
  if (Array.isArray(input)) {
    return {
      users: normalizeMapUsers(input, normalizedViewerId),
      effectiveRadiusM: null,
      viewerId: null,
      snapshotId: null,
    };
  }
  const source = requiredRecord(input, "map users response");
  if ("data" in source && source.data !== null) {
    if (Array.isArray(source.data)) {
      return {
        users: normalizeMapUsers(source.data, normalizedViewerId),
        effectiveRadiusM: optionalInteger(source.effective_radius_m ?? source.radius_m),
        viewerId: optionalString(source.viewer_id ?? source.viewerId),
        snapshotId: optionalString(source.snapshot_id ?? source.snapshotId),
      };
    }
    if (isRecord(source.data)) return parseMapUsersResponse(source.data, normalizedViewerId);
  }
  const listKey = userListKeys.find((key) => key in source);
  if (!listKey || !Array.isArray(source[listKey])) {
    throw new Error("Map users response is missing a supported users list");
  }
  return {
    users: normalizeMapUsers(source[listKey], normalizedViewerId),
    effectiveRadiusM: optionalInteger(source.effective_radius_m ?? source.radius_m),
    viewerId: optionalString(source.viewer_id ?? source.viewerId),
    snapshotId: optionalString(source.snapshot_id ?? source.snapshotId),
  };
}

function parseViewerOwnedMapUsers(input: unknown, viewerId: string): MapUsersResponse {
  const result = parseMapUsersResponse(input, viewerId);
  if (result.viewerId && result.viewerId !== viewerId.trim()) {
    throw new Error("Map users response belongs to another viewer");
  }
  return result;
}

function unwrapMapUserDetail(input: unknown): unknown {
  if (!isRecord(input)) return input;
  if (isRecord(input.user)) return input.user;
  if (isRecord(input.data)) return unwrapMapUserDetail(input.data);
  return input;
}

export function normalizeMapUsers(input: readonly unknown[], viewerId: string): MapDatingUser[] {
  const orderedIds: string[] = [];
  const byId = new Map<string, MapDatingUser>();
  for (const candidate of input) {
    const user = parseMapUser(candidate);
    if (!user || user.userId === viewerId.trim()) continue;
    const existing = byId.get(user.userId);
    if (!existing) {
      orderedIds.push(user.userId);
      byId.set(user.userId, user);
    } else if (!mapUserCoordinate(existing) && mapUserCoordinate(user)) {
      byId.set(user.userId, user);
    }
  }
  return orderedIds.flatMap((id) => {
    const user = byId.get(id);
    return user ? [user] : [];
  });
}

export function parseMapUser(input: unknown): MapDatingUser | null {
  if (!isRecord(input)) return null;
  const userId = optionalString(
    input.user_id ?? input.id ?? input.uid ?? input.userId ?? input.account_id,
  );
  if (!userId) return null;
  const nested = decodeNestedCoordinate(input);
  return {
    userId,
    nickname:
      optionalString(input.nickname ?? input.display_name ?? input.name ?? input.username) ??
      "用户",
    avatarUrl:
      optionalString(
        input.avatar_url ?? input.avatarUrl ?? input.avatar ?? input.profile_image_url,
      ) ?? "",
    bio: optionalString(input.bio),
    gender: optionalString(input.gender),
    age: optionalInteger(input.age),
    profileLocation: optionalString(input.profile_location),
    relation: optionalString(input.relation),
    visibilityScope: optionalMapVisibilityScope(input.visibility_scope),
    onlineStatus: mapOnlineStatus(
      input.online_status ?? input.onlineStatus ?? input.status,
      input.is_online,
    ),
    statusText: optionalString(input.status_text),
    distanceM: optionalNumber(input.distance_m),
    distanceText: optionalString(input.distance_text),
    displayLatitude:
      firstNumber(input, [
        "display_lat",
        "displayLat",
        "display_latitude",
        "map_lat",
        "map_latitude",
        "obfuscated_lat",
        "obfuscated_latitude",
        "latitude",
        "lat",
      ]) ??
      nested?.latitude ??
      null,
    displayLongitude:
      firstNumber(input, [
        "display_lng",
        "displayLng",
        "display_longitude",
        "display_lon",
        "map_lng",
        "map_longitude",
        "obfuscated_lng",
        "obfuscated_longitude",
        "longitude",
        "lng",
        "lon",
        "long",
      ]) ??
      nested?.longitude ??
      null,
    lastActiveAt: optionalString(input.last_active_at),
  };
}

export function mapUserCoordinate(user: MapDatingUser): MapCoordinate | null {
  const coordinate = {
    latitude: user.displayLatitude ?? Number.NaN,
    longitude: user.displayLongitude ?? Number.NaN,
  };
  return isMappableCoordinate(coordinate) ? coordinate : null;
}

export function mapPresenceCoordinate(presence: MapPresence | null): MapCoordinate | null {
  if (!presence) return null;
  const candidates = [
    { latitude: presence.latitude ?? Number.NaN, longitude: presence.longitude ?? Number.NaN },
    {
      latitude: presence.displayLatitude ?? Number.NaN,
      longitude: presence.displayLongitude ?? Number.NaN,
    },
  ];
  return candidates.find(isMappableCoordinate) ?? null;
}

export function isMappableCoordinate(coordinate: MapCoordinate): boolean {
  return (
    Number.isFinite(coordinate.latitude) &&
    Number.isFinite(coordinate.longitude) &&
    coordinate.latitude >= -90 &&
    coordinate.latitude <= 90 &&
    coordinate.longitude >= -180 &&
    coordinate.longitude <= 180 &&
    (Math.abs(coordinate.latitude) > 0.000001 || Math.abs(coordinate.longitude) > 0.000001)
  );
}

export function viewerMapRegion(coordinate: MapCoordinate): MapRegion | null {
  if (!isMappableCoordinate(coordinate)) return null;
  const latitudeRadians = (coordinate.latitude * Math.PI) / 180;
  // Match MapKit's WGS84-backed MKCoordinateRegion(center:latitudinalMeters:
  // longitudinalMeters:) conversion instead of using one spherical constant.
  const metersPerLatitudeDegree =
    111_132.92 -
    559.82 * Math.cos(2 * latitudeRadians) +
    1.175 * Math.cos(4 * latitudeRadians) -
    0.0023 * Math.cos(6 * latitudeRadians);
  const metersPerLongitudeDegree = Math.max(
    1,
    111_412.84 * Math.cos(latitudeRadians) -
      93.5 * Math.cos(3 * latitudeRadians) +
      0.118 * Math.cos(5 * latitudeRadians),
  );
  return {
    ...coordinate,
    latitudeDelta: 100 / metersPerLatitudeDegree,
    longitudeDelta: 100 / metersPerLongitudeDegree,
  };
}

export function shouldAutomaticallyPositionMapViewport(
  state: MapViewportPositionState,
): boolean {
  return !state.didAutomaticallyPosition && !state.userHasInteracted;
}

export function fittedMapRegion(
  viewerCoordinate: MapCoordinate | null,
  users: readonly MapDatingUser[],
): MapRegion | null {
  const coordinates = users.flatMap((user) => {
    const coordinate = mapUserCoordinate(user);
    return coordinate ? [coordinate] : [];
  });
  if (viewerCoordinate && isMappableCoordinate(viewerCoordinate))
    coordinates.push(viewerCoordinate);
  if (coordinates.length === 0) return null;
  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates.map((coordinate) => coordinate.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const longitudeSpread = maxLongitude - minLongitude;
  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: longitudeSpread > 180 ? 0 : (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.min(180, Math.max(0.02, (maxLatitude - minLatitude) * 1.35)),
    longitudeDelta:
      longitudeSpread > 180 ? 360 : Math.min(360, Math.max(0.02, longitudeSpread * 1.35)),
  };
}

export function mapViewportSignature(
  viewerCoordinate: MapCoordinate | null,
  users: readonly MapDatingUser[],
): string {
  const viewer = viewerCoordinate
    ? `${viewerCoordinate.latitude.toFixed(4)},${viewerCoordinate.longitude.toFixed(4)}`
    : "none";
  const people = users
    .flatMap((user) => {
      const coordinate = mapUserCoordinate(user);
      return coordinate
        ? [`${user.userId}:${coordinate.latitude.toFixed(4)},${coordinate.longitude.toFixed(4)}`]
        : [];
    })
    .sort()
    .join("|");
  return `${viewer};${people}`;
}

function decodeNestedCoordinate(source: Record<string, unknown>): MapCoordinate | null {
  for (const key of coordinateKeys) {
    const candidate = source[key];
    const coordinate = decodeCoordinate(candidate);
    if (coordinate) return coordinate;
  }
  return null;
}

function decodeCoordinate(input: unknown): MapCoordinate | null {
  if (Array.isArray(input) && input.length >= 2) {
    const first = optionalNumber(input[0]);
    const second = optionalNumber(input[1]);
    if (first === null || second === null) return null;
    const coordinate =
      Math.abs(first) <= 90 && Math.abs(second) > 90
        ? { latitude: first, longitude: second }
        : { latitude: second, longitude: first };
    return isMappableCoordinate(coordinate) ? coordinate : null;
  }
  if (!isRecord(input)) return null;
  const nested = decodeNestedCoordinate(input);
  const coordinate = {
    latitude:
      firstNumber(input, [
        "display_lat",
        "displayLat",
        "display_latitude",
        "map_lat",
        "map_latitude",
        "obfuscated_lat",
        "obfuscated_latitude",
        "latitude",
        "lat",
      ]) ??
      nested?.latitude ??
      Number.NaN,
    longitude:
      firstNumber(input, [
        "display_lng",
        "displayLng",
        "display_longitude",
        "display_lon",
        "map_lng",
        "map_longitude",
        "obfuscated_lng",
        "obfuscated_longitude",
        "longitude",
        "lng",
        "lon",
        "long",
      ]) ??
      nested?.longitude ??
      Number.NaN,
  };
  return isMappableCoordinate(coordinate) ? coordinate : null;
}

function mapVisibilityScope(input: unknown): MapVisibilityScope {
  return optionalMapVisibilityScope(input) ?? "off";
}

function optionalMapVisibilityScope(input: unknown): MapVisibilityScope | null {
  const value = optionalString(input)?.toLowerCase();
  return value === "off" || value === "friends" || value === "everyone" ? value : null;
}

function mapOnlineStatus(input: unknown, isOnline?: unknown): MapOnlineStatus {
  const explicit = optionalBoolean(isOnline);
  if (explicit !== null) return explicit ? "online" : "invisible";
  const value = optionalString(input)?.toLowerCase();
  if (
    ["invisible", "offline", "hidden", "false", "0", "隐身", "離線", "离线"].includes(value ?? "")
  ) {
    return "invisible";
  }
  return "online";
}

function unwrapRecord(input: unknown, keys: readonly string[]): Record<string, unknown> {
  const source = requiredRecord(input, "map response");
  const looksDirect = [
    "enabled",
    "visibility_scope",
    "online_status",
    "visible_on_map",
    "status",
  ].some((key) => key in source);
  if (looksDirect) return source;
  for (const key of keys) {
    if (isRecord(source[key])) return unwrapRecord(source[key], keys);
  }
  throw new Error("Map response is missing the expected object");
}

function firstNumber(source: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = optionalNumber(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function requiredRecord(input: unknown, label: string): Record<string, unknown> {
  if (!isRecord(input)) throw new Error(`${label} is invalid`);
  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function optionalString(input: unknown): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const value = String(input).trim();
  return value || null;
}

function optionalNumber(input: unknown): number | null {
  const text = optionalString(input);
  const value = typeof input === "number" ? input : text === null ? Number.NaN : Number(text);
  return Number.isFinite(value) ? value : null;
}

function optionalInteger(input: unknown): number | null {
  const value = optionalNumber(input);
  return value === null ? null : Math.trunc(value);
}

function optionalBoolean(input: unknown): boolean | null {
  if (typeof input === "boolean") return input;
  if (typeof input === "number") return input !== 0;
  const value = optionalString(input)?.toLowerCase();
  if (["true", "1", "yes", "on"].includes(value ?? "")) return true;
  if (["false", "0", "no", "off"].includes(value ?? "")) return false;
  return null;
}
