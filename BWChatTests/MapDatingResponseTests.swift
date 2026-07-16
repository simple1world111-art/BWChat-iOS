import XCTest
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
}
