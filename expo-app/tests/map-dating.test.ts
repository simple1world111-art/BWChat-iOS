import fs from "node:fs";
import path from "node:path";

import {
  fittedMapRegion,
  mapPresenceCoordinate,
  mapUserCoordinate,
  mapUsersPath,
  normalizeMapUsers,
  parseMapPresence,
  parseMapUsersResponse,
  shouldAutomaticallyPositionMapViewport,
  viewerMapRegion,
} from "@/services/location/MapDatingRepository";

describe("map dating repository and viewport parity", () => {
  it("decodes direct and wrapped presence with the Swift flexible defaults", () => {
    const direct = parseMapPresence({
      enabled: "1",
      visibility_scope: "everyone",
      online_status: "online",
      visible_on_map: true,
      latitude: "35.681236",
      longitude: 139.767125,
      accuracy_m: "12.5",
    });
    expect(direct.enabled).toBe(true);
    expect(direct.visibilityScope).toBe("everyone");
    expect(direct.onlineStatus).toBe("online");
    expect(direct.accuracyM).toBe(12.5);
    expect(mapPresenceCoordinate(direct)).toEqual({ latitude: 35.681236, longitude: 139.767125 });

    const wrapped = parseMapPresence({
      data: {
        presence: {
          visibility_scope: "friends",
          status: "invisible",
          displayLat: 35.7,
          displayLng: 139.8,
        },
      },
    });
    expect(wrapped.enabled).toBe(true);
    expect(wrapped.onlineStatus).toBe("invisible");
    expect(wrapped.visibleOnMap).toBe(false);
    expect(mapPresenceCoordinate(wrapped)).toEqual({ latitude: 35.7, longitude: 139.8 });
  });

  it("accepts all native list and coordinate aliases while excluding the viewer", () => {
    const response = parseMapUsersResponse(
      {
        data: {
          viewer_id: "viewer-1",
          snapshot_id: "snapshot-7",
          effective_radius_m: "10000",
          profiles: [
            { user_id: "viewer-1", nickname: "Me", display_lat: 35, display_lng: 139 },
            { uid: "u-1", display_name: "First", location: { coordinates: [139.7, 35.6] } },
            {
              account_id: "u-2",
              username: "Second",
              map_presence: { lat: "35.8", lng: "139.9" },
              is_online: 0,
            },
            { userId: "u-3", nickname: "Missing", latitude: 0, longitude: 0 },
          ],
        },
      },
      "viewer-1",
    );
    expect(response.viewerId).toBe("viewer-1");
    expect(response.snapshotId).toBe("snapshot-7");
    expect(response.effectiveRadiusM).toBe(10_000);
    expect(response.users.map((user) => user.userId)).toEqual(["u-1", "u-2", "u-3"]);
    expect(mapUserCoordinate(response.users[0]!)).toEqual({ latitude: 35.6, longitude: 139.7 });
    expect(mapUserCoordinate(response.users[1]!)).toEqual({ latitude: 35.8, longitude: 139.9 });
    expect(response.users[1]!.onlineStatus).toBe("invisible");
    expect(mapUserCoordinate(response.users[2]!)).toBeNull();
  });

  it("keeps first-seen ordering but replaces a coordinate-less duplicate", () => {
    const users = normalizeMapUsers(
      [
        { id: "a", nickname: "A" },
        { id: "b", nickname: "B", display_lat: 35.1, display_lng: 139.1 },
        { id: "a", nickname: "A located", display_lat: 35.2, display_lng: 139.2 },
        { id: "b", nickname: "B duplicate", display_lat: 40, display_lng: 140 },
      ],
      "viewer",
    );
    expect(users.map((user) => user.userId)).toEqual(["a", "b"]);
    expect(users[0]!.nickname).toBe("A located");
    expect(users[1]!.nickname).toBe("B");
  });

  it("builds the exact public-map path without radius, relation or result limit", () => {
    expect(mapUsersPath(null)).toBe("/map/users");
    expect(mapUsersPath({ latitude: 35.681236, longitude: 139.767125 })).toBe(
      "/map/users?lat=35.681236&lng=139.767125",
    );
  });

  it("matches the native 50 meter viewer region and 1.35 result padding", () => {
    const viewer = viewerMapRegion({ latitude: 35.681236, longitude: 139.767125 });
    expect(viewer).not.toBeNull();
    expect(viewer!.latitudeDelta).toBeCloseTo(0.000901281878203, 12);
    expect(viewer!.longitudeDelta).toBeCloseTo(0.001104665927203, 12);
    expect(viewer!.longitudeDelta).toBeGreaterThan(viewer!.latitudeDelta);

    const users = normalizeMapUsers(
      [
        { id: "a", display_lat: 35, display_lng: 139 },
        { id: "b", display_lat: 36, display_lng: 141 },
      ],
      "viewer",
    );
    expect(fittedMapRegion(null, users)).toEqual({
      latitude: 35.5,
      longitude: 140,
      latitudeDelta: 1.35,
      longitudeDelta: 2.7,
    });
    const dateline = normalizeMapUsers(
      [
        { id: "east", display_lat: 10, display_lng: 179 },
        { id: "west", display_lat: 10, display_lng: -179 },
      ],
      "viewer",
    );
    expect(fittedMapRegion(null, dateline)).toMatchObject({ longitude: 0, longitudeDelta: 360 });
  });

  it("automatically positions only before the first map movement", () => {
    expect(
      shouldAutomaticallyPositionMapViewport({
        didAutomaticallyPosition: false,
        userHasInteracted: false,
      }),
    ).toBe(true);
    expect(
      shouldAutomaticallyPositionMapViewport({
        didAutomaticallyPosition: true,
        userHasInteracted: false,
      }),
    ).toBe(false);
    expect(
      shouldAutomaticallyPositionMapViewport({
        didAutomaticallyPosition: false,
        userHasInteracted: true,
      }),
    ).toBe(false);
  });

  it("keeps the visible Swift screen contract wired into the Expo page", () => {
    const nativeRoot = path.resolve(process.cwd(), "..");
    const swiftView = fs.readFileSync(
      path.join(nativeRoot, "BWChat/Views/MapDatingView.swift"),
      "utf8",
    );
    const swiftModel = fs.readFileSync(
      path.join(nativeRoot, "BWChat/ViewModels/MapDatingViewModel.swift"),
      "utf8",
    );
    const screen = fs.readFileSync(path.join(process.cwd(), "src/app/(tabs)/map.tsx"), "utf8");
    const nativeMapBridge = fs.readFileSync(
      path.join(process.cwd(), "modules/bwchat-native-map/ios/BWChatNativeMapModule.swift"),
      "utf8",
    );
    const repository = fs.readFileSync(
      path.join(process.cwd(), "src/services/location/MapDatingRepository.ts"),
      "utf8",
    );
    const location = fs.readFileSync(
      path.join(process.cwd(), "src/services/location/MapLocationService.ts"),
      "utf8",
    );
    const acceptance = fs.readFileSync(
      path.join(process.cwd(), "src/services/visualAcceptance.ts"),
      "utf8",
    );
    const acceptanceServer = fs.readFileSync(
      path.join(process.cwd(), "scripts/map-acceptance-server.py"),
      "utf8",
    );
    const rootLayout = fs.readFileSync(path.join(process.cwd(), "src/app/_layout.tsx"), "utf8");
    const tabsLayout = fs.readFileSync(
      path.join(process.cwd(), "src/app/(tabs)/_layout.tsx"),
      "utf8",
    );
    const reactNativeMapOpening = screen.match(/<MapView\n[\s\S]*?>/)?.[0] ?? "";

    expect(swiftModel).toContain("getMapPresence()");
    expect(swiftModel).toContain("getAllMapUsers(");
    expect(repository).toContain('apiRequest<unknown>("/map/me"');
    expect(repository).toContain('return suffix ? `/map/users?${suffix}` : "/map/users"');
    expect(screen).toContain("await getMapPresence()");
    expect(screen).toContain("await getAllMapUsers(currentCoordinate, ownerId)");
    expect(screen).toContain("setErrorMessage(missingCoordinates)");
    expect(screen).not.toContain("initialRegion={TOKYO_STATION_REGION}");
    expect(screen).toContain("const MAP_ATTRIBUTION_NAV_GAP = 8");
    expect(screen).toContain("const MAP_APPLE_LOGO_VISUAL_BOTTOM_OFFSET = 12");
    expect(screen).toContain(
      "const mapAttributionBottomInset = insets.bottom + MAP_ATTRIBUTION_NAV_GAP",
    );
    expect(screen).toContain("mapAttributionBottomInset - MAP_APPLE_LOGO_VISUAL_BOTTOM_OFFSET");
    expect(reactNativeMapOpening).toContain("appleLogoInsets={{");
    expect(reactNativeMapOpening).toContain("bottom: appleLogoBottomInset");
    expect(reactNativeMapOpening).toContain("initialRegion={cameraTarget}");
    expect(reactNativeMapOpening).toContain("legalLabelInsets={{");
    expect(reactNativeMapOpening).toContain("bottom: mapAttributionBottomInset");
    expect(reactNativeMapOpening).not.toContain("mapPadding");
    expect(reactNativeMapOpening).not.toContain("onMapReady");
    expect(reactNativeMapOpening).not.toMatch(/\sregion=/);
    expect(reactNativeMapOpening).toContain("onPanDrag={markMapViewportAsUserControlled}");
    expect(reactNativeMapOpening).toContain("onTouchStart={markMapViewportAsUserControlled}");
    expect(screen).not.toContain("onRegionChangeComplete={setCameraTarget}");
    expect(screen).toContain("mapViewRef.current?.animateToRegion(cameraTarget, 300)");
    expect(screen).toContain("const focusMapOnViewer = async () =>");
    expect(screen).toContain("const centered = viewerMapRegion(coordinate)");
    expect(screen).toContain("mapViewRef.current?.animateToRegion(centered, 300)");
    expect(screen).toContain('testID="map-recenter-button"');
    expect(screen).toContain("{ bottom: insets.bottom + 50 }");
    expect(screen).toContain('mapVisualAcceptanceEnabled && Platform.OS === "ios"');
    expect(screen).toContain("<BWChatNativeMap");
    expect(screen).toContain("localeIdentifier={activeLanguage}");
    expect(nativeMapBridge).toContain("Map(");
    expect(nativeMapBridge).toContain(
      "coordinateRegion: model.regionBinding(viewportWidth: proxy.size.width)",
    );
    expect(nativeMapBridge).toContain("let legalAttributionBottomInset = tabBar.bounds.height");
    expect(nativeMapBridge).toContain("window?.firstSubview(of: UITabBar.self)");
    expect(nativeMapBridge).toContain("margins.bottom = legalAttributionBottomInset");
    expect(nativeMapBridge).toContain("mapView.layoutIfNeeded()");
    expect(nativeMapBridge).toContain("verticalCameraLatitudeOffset");
    expect(nativeMapBridge).toContain("static let verticalCameraOffsetPoints = 32.0 / 3.0");
    expect(nativeMapBridge).toContain(
      ".environment(\\.locale, Locale(identifier: model.localeIdentifier))",
    );
    expect(screen).toContain('uploadMapLocation(location, "map_visit", mapVisitEventId)');
    expect(screen).toContain('uploadMapLocation(location, "foreground_update", randomUUID())');
    expect(location).toContain("distanceInterval: 10");
    expect(screen).toContain('else if (nextState !== "active")');
    expect(screen).toContain("locationWatcher?.remove()");
    expect(screen).toContain("shouldUploadForegroundMapLocation(");
    expect(screen).toContain("}, 60_000)");
    expect(swiftView).toContain("AvatarView(url: avatarURL, size: isCurrentUser ? 46 : 40)");
    expect(nativeMapBridge).toContain(
      "private var size: CGFloat { marker.isCurrentUser ? 46 : 40 }",
    );
    expect(nativeMapBridge).toContain(
      ".stroke(Color.white, lineWidth: marker.isCurrentUser ? 4 : 3)",
    );
    expect(nativeMapBridge).toContain("width: marker.isCurrentUser ? 12 : 10");
    expect(screen).toContain('router.push({ pathname: "/user-profile"');
    expect(acceptance).toContain('requestedVariant === "map"');
    expect(acceptance).toContain('user_id: "map-visual-acceptance"');
    expect(acceptanceServer).toContain('"/api/v1/map/me"');
    expect(acceptanceServer).toContain('"/api/v1/map/users"');
    expect(rootLayout).toContain("if (!visualAcceptanceEnabled) initializePushNotifications()");
    expect(rootLayout).toContain("!visualAcceptanceEnabled ? <PushNotificationBootstrap /> : null");
    expect(tabsLayout).toContain('const NATIVE_SELECTED_TAB_COLOR = "#000000"');
    expect(tabsLayout).toContain("tintColor={NATIVE_SELECTED_TAB_COLOR}");
  });
});
