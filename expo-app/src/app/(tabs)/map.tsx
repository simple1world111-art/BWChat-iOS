import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  type AlertButton,
  AppState,
  type AppStateStatus,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { TopToast } from "@/components/TopToast";
import { env } from "@/config/env";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  fittedMapRegion,
  getAllMapUsers,
  getMapPresence,
  mapPresenceCoordinate,
  mapUserCoordinate,
  type MapCoordinate,
  type MapDatingUser,
  type MapPresence,
  mapViewportSignature,
  parseMapPresence,
  viewerMapRegion,
} from "@/services/location/MapDatingRepository";
import {
  type MapDeviceLocation,
  requestForegroundLocationPermission,
  requestFreshUsableLocation,
  shouldUploadForegroundMapLocation,
  uploadMapLocation,
  watchUsableMapLocations,
} from "@/services/location/MapLocationService";
import { captureException } from "@/services/monitoring/MonitoringService";
import { mapVisualAcceptanceEnabled } from "@/services/visualAcceptance";
import { colors } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";
import {
  BWChatNativeMap,
  type BWChatNativeMapMarker,
} from "../../../modules/bwchat-native-map/src";

const TOKYO_STATION_REGION: Region = {
  latitude: 35.681236,
  longitude: 139.767125,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

const MAP_VISUAL_ACCEPTANCE_VIEWER: MapCoordinate = {
  latitude: 35.681236,
  longitude: 139.767125,
};

const MAP_VISUAL_ACCEPTANCE_USERS: readonly MapDatingUser[] = [
  mapVisualAcceptanceUser("map-fixture-blue", "Blue", 35.681535, 139.767125, "online"),
  mapVisualAcceptanceUser("map-fixture-pink", "Pink", 35.681036, 139.767455, "invisible"),
  mapVisualAcceptanceUser("map-fixture-green", "Green", 35.680936, 139.766795, "online"),
];

const MAP_VISUAL_ACCEPTANCE_REGION =
  viewerMapRegion(MAP_VISUAL_ACCEPTANCE_VIEWER) ?? TOKYO_STATION_REGION;

type MapFilter = "nearby" | "online" | "friends";

export default function MapScreen() {
  const { user } = useAuth();
  const { activeLanguage, t } = useLocalization();
  const insets = useSafeAreaInsets();
  const ownerId = user?.user_id?.trim() || null;
  const operationFailed = t("common.operationFailed");
  const missingCoordinates = t("map.users.missingCoordinates");
  const [region, setRegion] = useState<Region>(() =>
    mapVisualAcceptanceEnabled ? MAP_VISUAL_ACCEPTANCE_REGION : TOKYO_STATION_REGION,
  );
  const [viewerCoordinate, setViewerCoordinate] = useState<MapCoordinate | null>(() =>
    mapVisualAcceptanceEnabled ? MAP_VISUAL_ACCEPTANCE_VIEWER : null,
  );
  const [mapUsers, setMapUsers] = useState<MapDatingUser[]>(() =>
    mapVisualAcceptanceEnabled ? [...MAP_VISUAL_ACCEPTANCE_USERS] : [],
  );
  const [isLoading, setIsLoading] = useState(mapVisualAcceptanceEnabled ? false : Boolean(ownerId));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mapFilter, setMapFilter] = useState<MapFilter>("nearby");

  useEffect(() => {
    let active = true;
    if (mapVisualAcceptanceEnabled) {
      return () => {
        active = false;
      };
    }
    let appState: AppStateStatus = AppState.currentState;
    let presence: MapPresence | null = null;
    let currentCoordinate: MapCoordinate | null = null;
    let latestLocation: MapDeviceLocation | null = null;
    let locationWatcher: { remove(): void } | null = null;
    const mapVisitEventId = randomUUID();
    let didRecordMapVisit = false;
    let lastUploadedCoordinate: MapCoordinate | null = null;
    let lastUploadedAt = Number.NEGATIVE_INFINITY;
    let lastAutoFitKey = "";
    let isRefreshingUsers = false;
    let refreshUsersAgain = false;
    let isResolvingLocation = false;

    const applyRegion = (next: Region) => {
      if (active) setRegion(next);
    };

    const applyViewerCoordinate = (coordinate: MapCoordinate) => {
      currentCoordinate = coordinate;
      if (!active) return;
      setViewerCoordinate(coordinate);
      const centered = viewerMapRegion(coordinate);
      if (centered) applyRegion(centered);
    };

    const refreshUsers = async () => {
      if (!ownerId) return;
      if (isRefreshingUsers) {
        refreshUsersAgain = true;
        return;
      }
      isRefreshingUsers = true;
      try {
        do {
          refreshUsersAgain = false;
          const response = await getAllMapUsers(currentCoordinate, ownerId);
          if (!active) return;
          setMapUsers(response.users);
          if (
            response.users.length > 0 &&
            !response.users.some((candidate) => mapUserCoordinate(candidate))
          ) {
            setErrorMessage(missingCoordinates);
          }
          if (!currentCoordinate) {
            const signature = mapViewportSignature(null, response.users);
            const fitted = fittedMapRegion(null, response.users);
            if (fitted && signature !== lastAutoFitKey) {
              lastAutoFitKey = signature;
              applyRegion(fitted);
            }
          }
        } while (refreshUsersAgain && active);
      } catch (error) {
        if (active) setErrorMessage(errorMessageFor(error, operationFailed));
      } finally {
        isRefreshingUsers = false;
      }
    };

    const canUploadForegroundLocation = () =>
      Boolean(presence?.enabled) &&
      presence?.visibilityScope !== "off" &&
      presence?.onlineStatus === "online";

    const applyUploadedPresence = (payload: unknown) => {
      presence = parseMapPresence(payload);
    };

    const uploadForegroundLocation = async (location: MapDeviceLocation, force: boolean) => {
      if (!didRecordMapVisit || !canUploadForegroundLocation()) return;
      const coordinate = coordinateFromLocation(location);
      const now = Date.now();
      if (
        !shouldUploadForegroundMapLocation(
          coordinate,
          lastUploadedCoordinate,
          lastUploadedAt,
          now,
          force,
        )
      )
        return;
      try {
        const response = await uploadMapLocation(location, "foreground_update", randomUUID());
        if (!active) return;
        applyUploadedPresence(response);
        lastUploadedCoordinate = coordinate;
        lastUploadedAt = now;
        await refreshUsers();
      } catch (error) {
        if (active) setErrorMessage(errorMessageFor(error, operationFailed));
      }
    };

    const handleWatchedLocation = (location: MapDeviceLocation) => {
      const coordinate = coordinateFromLocation(location);
      latestLocation = location;
      applyViewerCoordinate(coordinate);
      if (didRecordMapVisit) void uploadForegroundLocation(location, false);
    };

    const ensureLocationWatcher = async () => {
      if (locationWatcher) return;
      locationWatcher = await watchUsableMapLocations(handleWatchedLocation, (error) => {
        if (active) setErrorMessage(errorMessageFor(error, operationFailed));
      });
      if (!active) {
        locationWatcher.remove();
        locationWatcher = null;
      }
    };

    const resolveViewerLocation = async () => {
      if (!ownerId || isResolvingLocation) return;
      isResolvingLocation = true;
      try {
        const granted = await requestForegroundLocationPermission();
        if (!granted || !active) return;
        await ensureLocationWatcher();
        const location = await requestFreshUsableLocation(5_000);
        if (!location || !active) return;
        latestLocation = location;
        const coordinate = coordinateFromLocation(location);
        applyViewerCoordinate(coordinate);
        if (!didRecordMapVisit) {
          const featureWasEnabled = Boolean(
            presence?.enabled && presence.visibilityScope !== "off",
          );
          const response = await uploadMapLocation(location, "map_visit", mapVisitEventId);
          if (!active) return;
          didRecordMapVisit = true;
          lastUploadedCoordinate = coordinate;
          lastUploadedAt = Date.now();
          applyUploadedPresence(response);
          if (!featureWasEnabled && presence) {
            presence = { ...presence, enabled: false };
          }
        }
        await refreshUsers();
      } catch (error) {
        captureException(error, { operation: "map_visit_location" });
        if (active) setErrorMessage(errorMessageFor(error, operationFailed));
      } finally {
        isResolvingLocation = false;
      }
    };

    const loadInitial = async () => {
      if (!ownerId) {
        if (active) setIsLoading(false);
        return;
      }
      if (active) {
        setIsLoading(true);
        setMapUsers([]);
        setViewerCoordinate(null);
        setErrorMessage(null);
      }
      try {
        try {
          presence = await getMapPresence();
          const fallbackCoordinate = mapPresenceCoordinate(presence);
          if (fallbackCoordinate) applyViewerCoordinate(fallbackCoordinate);
        } catch (error) {
          if (active) setErrorMessage(errorMessageFor(error, operationFailed));
        }
        await refreshUsers();
        await resolveViewerLocation();
      } finally {
        if (active) setIsLoading(false);
      }
    };

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      const becameActive = appState !== "active" && nextState === "active";
      appState = nextState;
      if (becameActive) {
        void resolveViewerLocation();
        void refreshUsers();
      } else if (nextState !== "active") {
        locationWatcher?.remove();
        locationWatcher = null;
      }
    });
    const uploadTimer = setInterval(() => {
      if (!active || appState !== "active" || !latestLocation) return;
      void uploadForegroundLocation(latestLocation, true);
    }, 60_000);

    void loadInitial();
    return () => {
      active = false;
      appStateSubscription.remove();
      clearInterval(uploadTimer);
      locationWatcher?.remove();
    };
  }, [missingCoordinates, operationFailed, ownerId]);

  const mappableUsers = useMemo(() => {
    const filtered = mapUsers.filter((candidate) => {
      if (mapFilter === "online") return candidate.onlineStatus === "online";
      if (mapFilter === "friends") return isFriendMapUser(candidate);
      return true;
    });
    return filtered.flatMap((candidate) => (mapUserCoordinate(candidate) ? [candidate] : []));
  }, [mapFilter, mapUsers]);
  const nativeMapMarkers = useMemo<BWChatNativeMapMarker[]>(() => {
    const markers: BWChatNativeMapMarker[] = [];
    if (viewerCoordinate) {
      markers.push({
        id: "current-user",
        latitude: viewerCoordinate.latitude,
        longitude: viewerCoordinate.longitude,
        avatarUrl: resolveMediaUrl(user?.avatar_url, env.apiBaseUrl) ?? "",
        accessibilityLabel: t("map.myLocation"),
        isCurrentUser: true,
        isOnline: true,
      });
    }
    for (const candidate of mappableUsers) {
      const coordinate = mapUserCoordinate(candidate);
      if (!coordinate) continue;
      markers.push({
        id: candidate.userId,
        userId: candidate.userId,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        avatarUrl: resolveMediaUrl(candidate.avatarUrl, env.apiBaseUrl) ?? "",
        accessibilityLabel: candidate.nickname,
        isCurrentUser: false,
        isOnline: candidate.onlineStatus === "online",
      });
    }
    return markers;
  }, [mappableUsers, t, user?.avatar_url, viewerCoordinate]);

  const showFilterMenu = () => {
    const filters: readonly { key: MapFilter; title: string }[] = [
      { key: "nearby", title: t("map.mode.nearby") },
      { key: "online", title: t("map.online") },
      { key: "friends", title: t("map.mode.friends") },
    ];
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...filters.map((filter) => filter.title), t("common.cancel")],
          cancelButtonIndex: filters.length,
          title: t("group.search.filters"),
        },
        (index) => {
          const selected = filters[index];
          if (selected) setMapFilter(selected.key);
        },
      );
      return;
    }
    const buttons: AlertButton[] = filters.map((filter) => ({
      text: filter.title,
      onPress: () => setMapFilter(filter.key),
    }));
    buttons.push({ text: t("common.cancel"), style: "cancel" });
    Alert.alert(t("group.search.filters"), undefined, buttons);
  };

  return (
    <View style={styles.screen}>
      {Platform.OS === "ios" ? (
        <BWChatNativeMap
          localeIdentifier={activeLanguage}
          markers={nativeMapMarkers}
          onMarkerPress={(userId) => {
            router.push({ pathname: "/user-profile", params: { id: userId } });
          }}
          onRegionChange={setRegion}
          region={region}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <MapView onRegionChangeComplete={setRegion} region={region} style={StyleSheet.absoluteFill}>
          {viewerCoordinate ? (
            <Marker
              accessibilityLabel={t("map.myLocation")}
              anchor={{ x: 0.5, y: 0.5 }}
              coordinate={viewerCoordinate}
            >
              <MapAvatarMarker
                avatarUrl={user?.avatar_url ?? ""}
                isCurrentUser
                isOnline
                name={user?.nickname ?? t("map.myLocation")}
              />
            </Marker>
          ) : null}
          {mappableUsers.map((candidate) => {
            const coordinate = mapUserCoordinate(candidate);
            if (!coordinate) return null;
            return (
              <Marker
                accessibilityLabel={candidate.nickname}
                anchor={{ x: 0.5, y: 0.5 }}
                coordinate={coordinate}
                key={candidate.userId}
                onPress={() => {
                  router.push({ pathname: "/user-profile", params: { id: candidate.userId } });
                }}
              >
                <MapAvatarMarker
                  avatarUrl={candidate.avatarUrl}
                  isCurrentUser={false}
                  isOnline={candidate.onlineStatus === "online"}
                  name={candidate.nickname}
                />
              </Marker>
            );
          })}
        </MapView>
      )}
      <Pressable
        accessibilityLabel={t("group.search.filters")}
        accessibilityRole="button"
        onPress={showFilterMenu}
        style={({ pressed }) => [
          styles.filterButton,
          { top: insets.top + 8 },
          pressed && styles.filterButtonPressed,
        ]}
        testID="map-filter-button"
      >
        <SymbolView
          name="line.3.horizontal.decrease"
          size={15}
          tintColor={colors.text}
          weight="semibold"
        />
        <Text style={styles.filterButtonText}>{t("group.search.filters")}</Text>
      </Pressable>
      {isLoading ? (
        <View style={[styles.loadingBubble, { top: insets.top + 8 }]}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
      <TopToast
        duration={2_000}
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
        topInset={insets.top}
      />
    </View>
  );
}

function mapVisualAcceptanceUser(
  userId: string,
  nickname: string,
  displayLatitude: number,
  displayLongitude: number,
  onlineStatus: "online" | "invisible",
): MapDatingUser {
  return {
    userId,
    nickname,
    avatarUrl: "",
    bio: null,
    gender: null,
    age: null,
    profileLocation: null,
    relation: null,
    visibilityScope: "everyone",
    onlineStatus,
    statusText: null,
    distanceM: null,
    distanceText: null,
    displayLatitude,
    displayLongitude,
    lastActiveAt: null,
  };
}

function MapAvatarMarker({
  avatarUrl,
  name,
  isCurrentUser,
  isOnline,
}: {
  avatarUrl: string;
  name: string;
  isCurrentUser: boolean;
  isOnline: boolean;
}) {
  const size = isCurrentUser ? 46 : 40;
  const strokeWidth = isCurrentUser ? 4 : 3;
  const strokeCornerRadius = isCurrentUser ? 10 : 9;
  const onlineDotSize = isCurrentUser ? 12 : 10;
  return (
    <View style={[styles.avatarMarker, { width: size, height: size }]}>
      <Avatar name={name} size={size} uri={avatarUrl} />
      <View
        pointerEvents="none"
        style={[
          styles.avatarStroke,
          {
            borderRadius: strokeCornerRadius + strokeWidth / 2,
            borderWidth: strokeWidth,
            height: size + strokeWidth,
            left: -strokeWidth / 2,
            top: -strokeWidth / 2,
            width: size + strokeWidth,
          },
        ]}
      />
      {isOnline ? (
        <View
          pointerEvents="none"
          style={[
            styles.onlineDot,
            {
              width: onlineDotSize,
              height: onlineDotSize,
              borderRadius: onlineDotSize / 2,
            },
          ]}
        >
          <View
            pointerEvents="none"
            style={[
              styles.onlineDotStroke,
              {
                borderRadius: onlineDotSize / 2 + 1,
                height: onlineDotSize + 2,
                width: onlineDotSize + 2,
              },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

function coordinateFromLocation(location: MapDeviceLocation): MapCoordinate {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };
}

function isFriendMapUser(user: MapDatingUser): boolean {
  const relation = user.relation?.trim().toLocaleLowerCase().replaceAll("-", "_") ?? "";
  return ["friend", "friends", "mutual_friend", "mutual_friends"].includes(relation);
}

function errorMessageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  filterButton: {
    position: "absolute",
    left: 16,
    minHeight: 40,
    paddingHorizontal: 13,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 6,
    backgroundColor: colors.card,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  filterButtonPressed: { opacity: 0.72 },
  filterButtonText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  loadingBubble: {
    position: "absolute",
    alignSelf: "center",
    padding: 18,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  avatarMarker: {
    shadowColor: "#000000",
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  avatarStroke: {
    position: "absolute",
    borderColor: colors.white,
  },
  onlineDot: {
    position: "absolute",
    right: 0,
    bottom: 0,
    backgroundColor: colors.success,
  },
  onlineDotStroke: {
    position: "absolute",
    left: -1,
    top: -1,
    borderColor: colors.white,
    borderWidth: 2,
  },
});
