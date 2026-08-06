import XCTest
import MapKit
@testable import BBchat

final class MapDatingResponseTests: XCTestCase {
    func testMapUserDecodesNestedDisplayCoordinate() throws {
        let data = Data(#"{"user_id":"u1","nickname":"Nearby","display_location":{"lat":31.2304,"lng":121.4737}}"#.utf8)

        let user = try JSONDecoder().decode(MapUser.self, from: data)

        XCTAssertEqual(user.displayLat, 31.2304)
        XCTAssertEqual(user.displayLng, 121.4737)
        XCTAssertTrue(user.hasMappableCoordinate)
    }

    func testMapUserRejectsOutOfRangeCoordinateForAnnotation() throws {
        let data = Data(#"{"user_id":"u1","nickname":"Invalid","display_lat":181,"display_lng":31}"#.utf8)

        let user = try JSONDecoder().decode(MapUser.self, from: data)

        XCTAssertFalse(user.hasMappableCoordinate)
    }

    func testMapUserRejectsZeroCoordinateSentinel() throws {
        let data = Data(#"{"user_id":"u1","nickname":"Missing","display_lat":0,"display_lng":0}"#.utf8)

        let user = try JSONDecoder().decode(MapUser.self, from: data)

        XCTAssertFalse(user.hasMappableCoordinate)
    }

    func testMapUserDecodesCamelCaseDisplayCoordinate() throws {
        let data = Data(#"{"userId":"u1","nickname":"Nearby","displayLat":"35.6812","displayLng":"139.7671"}"#.utf8)

        let user = try JSONDecoder().decode(MapUser.self, from: data)

        XCTAssertEqual(user.displayLat, 35.6812)
        XCTAssertEqual(user.displayLng, 139.7671)
        XCTAssertTrue(user.hasMappableCoordinate)
    }

    func testMapPresenceKeepsRecordedAndDisplayCoordinatesSeparate() throws {
        let data = Data(
            #"{"enabled":false,"visibility_scope":"off","online_status":"invisible","status":"off","display_lat":35.6812,"display_lng":139.7671}"#.utf8
        )

        let presence = try JSONDecoder().decode(MapPresence.self, from: data)

        XCTAssertNil(presence.latitude)
        XCTAssertNil(presence.longitude)
        XCTAssertEqual(presence.displayLatitude, 35.6812)
        XCTAssertEqual(presence.displayLongitude, 139.7671)
    }

    func testMapPresencePrefersDeviceCoordinateOverPublicDisplayCoordinate() throws {
        let data = Data(
            #"{"enabled":true,"visibility_scope":"everyone","status":"active","latitude":35.7,"longitude":139.8,"display_lat":35.6,"display_lng":139.6}"#.utf8
        )

        let presence = try JSONDecoder().decode(MapPresence.self, from: data)

        XCTAssertEqual(presence.latitude, 35.7)
        XCTAssertEqual(presence.longitude, 139.8)
        XCTAssertEqual(presence.displayLatitude, 35.6)
        XCTAssertEqual(presence.displayLongitude, 139.6)
    }

    func testLocationQualityAcceptsFreshAccurateDeviceLocation() {
        let now = Date()
        let location = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 35.6812, longitude: 139.7671),
            altitude: 0,
            horizontalAccuracy: 12,
            verticalAccuracy: 20,
            timestamp: now
        )

        XCTAssertTrue(MapLocationQualityPolicy.isUsable(location, now: now))
    }

    func testLocationQualityRejectsStaleOrInaccurateLocation() {
        let now = Date()
        let stale = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 35.6812, longitude: 139.7671),
            altitude: 0,
            horizontalAccuracy: 12,
            verticalAccuracy: 20,
            timestamp: now.addingTimeInterval(-31)
        )
        let inaccurate = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 35.6812, longitude: 139.7671),
            altitude: 0,
            horizontalAccuracy: 101,
            verticalAccuracy: 20,
            timestamp: now
        )

        XCTAssertFalse(MapLocationQualityPolicy.isUsable(stale, now: now))
        XCTAssertFalse(MapLocationQualityPolicy.isUsable(inaccurate, now: now))
    }

    func testMapUsersResponseThrowsWhenListFieldIsMissing() {
        let data = Data(#"{"effective_radius_m":10000}"#.utf8)

        XCTAssertThrowsError(try JSONDecoder().decode(MapUsersResponseData.self, from: data))
    }

    func testMapUsersResponseThrowsWhenListFieldIsNull() {
        let data = Data(#"{"users":null,"effective_radius_m":10000}"#.utf8)

        XCTAssertThrowsError(try JSONDecoder().decode(MapUsersResponseData.self, from: data))
    }

    func testMapUsersResponseThrowsInsteadOfSilentlyDroppingMalformedUser() {
        let data = Data(#"{"users":[{"nickname":"Missing ID","display_lat":31,"display_lng":121}]}"#.utf8)

        XCTAssertThrowsError(try JSONDecoder().decode(MapUsersResponseData.self, from: data))
    }

    func testMapUsersResponseRejectsDifferentViewerWhenServerProvidesViewerID() throws {
        let data = Data(#"{"viewer_id":"user-a","snapshot_id":"snapshot-1","users":[]}"#.utf8)

        let response = try JSONDecoder().decode(MapUsersResponseData.self, from: data)

        XCTAssertTrue(response.belongsToViewer("user-a"))
        XCTAssertFalse(response.belongsToViewer("user-b"))
        XCTAssertEqual(response.snapshotID, "snapshot-1")
    }

    func testMapUsersResponseRemainsCompatibleWithoutViewerID() throws {
        let data = Data(#"{"users":[]}"#.utf8)

        let response = try JSONDecoder().decode(MapUsersResponseData.self, from: data)

        XCTAssertTrue(response.belongsToViewer("user-a"))
    }

    func testMapUserCollectionRemovesViewerAndPrefersMappableDuplicate() {
        let users = [
            MapUser(userID: " viewer ", nickname: "Self", displayLat: 31, displayLng: 121),
            MapUser(userID: "user-b", nickname: "Missing coordinate"),
            MapUser(userID: "user-b", nickname: "Mappable", displayLat: 31.2, displayLng: 121.4),
            MapUser(userID: "user-c", nickname: "Other", displayLat: 31.3, displayLng: 121.5)
        ]

        let normalized = MapUserCollectionPolicy.normalized(users, viewerID: "viewer")

        XCTAssertEqual(normalized.map(\.userID), ["user-b", "user-c"])
        XCTAssertEqual(normalized.first?.nickname, "Mappable")
        XCTAssertTrue(normalized.first?.hasMappableCoordinate == true)
    }

    func testViewerViewportCentersOnViewerWithFiftyMeterRadius() throws {
        let viewer = CLLocationCoordinate2D(latitude: 35.681236, longitude: 139.767125)

        let region = try XCTUnwrap(
            MapDatingViewportPolicy.viewerRegion(centeredAt: viewer)
        )
        let center = CLLocation(latitude: region.center.latitude, longitude: region.center.longitude)
        let northernEdge = CLLocation(
            latitude: region.center.latitude + region.span.latitudeDelta / 2,
            longitude: region.center.longitude
        )

        XCTAssertEqual(region.center.latitude, viewer.latitude, accuracy: 0.000001)
        XCTAssertEqual(region.center.longitude, viewer.longitude, accuracy: 0.000001)
        XCTAssertEqual(
            center.distance(from: northernEdge),
            MapDatingViewportPolicy.viewerRadiusMeters,
            accuracy: 1
        )
    }

    func testAllUsersViewportFitsViewerAndRemoteUser() throws {
        let viewer = CLLocationCoordinate2D(latitude: 35.68, longitude: 139.76)
        let remoteUser = MapUser(
            userID: "remote",
            nickname: "Remote",
            displayLat: 35.80,
            displayLng: 139.95
        )

        let region = try XCTUnwrap(
            MapDatingViewportPolicy.region(
                viewerCoordinate: viewer,
                users: [remoteUser]
            )
        )

        XCTAssertGreaterThan(region.span.latitudeDelta, 0.12)
        XCTAssertGreaterThan(region.span.longitudeDelta, 0.19)
    }

    func testAllUsersViewportShowsWholeWorldAcrossDateLine() throws {
        let users = [
            MapUser(userID: "east", nickname: "East", displayLat: 10, displayLng: 170),
            MapUser(userID: "west", nickname: "West", displayLat: -10, displayLng: -170)
        ]

        let region = try XCTUnwrap(
            MapDatingViewportPolicy.region(viewerCoordinate: nil, users: users)
        )

        XCTAssertEqual(region.span.longitudeDelta, 360)
    }
}
