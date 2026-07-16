// BWChat/Models/MapDating.swift
// Map dating presence and visible user models.

import Foundation

enum MapVisibilityScope: String, Codable, CaseIterable, Identifiable {
    case off
    case friends
    case everyone

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .off: return L10n.tr("map.visibility.off")
        case .friends: return L10n.tr("map.visibility.friends")
        case .everyone: return L10n.tr("map.visibility.everyone")
        }
    }
}

enum MapDatingMode: String, CaseIterable, Identifiable {
    case nearby
    case friends

    var id: String { rawValue }

    var title: String {
        switch self {
        case .nearby: return L10n.tr("map.mode.nearby")
        case .friends: return L10n.tr("map.mode.friends")
        }
    }
}

enum MapOnlineStatus: String, CaseIterable, Identifiable {
    case online
    case invisible

    var id: String { rawValue }

    var title: String {
        switch self {
        case .online: return L10n.tr("map.online")
        case .invisible: return L10n.tr("map.invisible")
        }
    }
}

enum MapReportReason: String, CaseIterable, Identifiable {
    case harassment
    case fakeProfile = "fake_profile"
    case unsafe
    case spam
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .harassment: return L10n.tr("map.report.harassment")
        case .fakeProfile: return L10n.tr("map.report.fakeProfile")
        case .unsafe: return L10n.tr("map.report.unsafe")
        case .spam: return L10n.tr("map.report.spam")
        case .other: return L10n.tr("profile.gender.other")
        }
    }
}

struct MapPresence: Decodable, Equatable {
    let enabled: Bool
    let visibilityScope: MapVisibilityScope
    let onlineStatus: String
    let visibleOnMap: Bool
    let status: String?
    let latitude: Double?
    let longitude: Double?
    let accuracyM: Double?
    let statusText: String?
    let updatedAt: String?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case enabled
        case visibilityScope = "visibility_scope"
        case onlineStatus = "online_status"
        case visibleOnMap = "visible_on_map"
        case status
        case latitude
        case longitude
        case accuracyM = "accuracy_m"
        case statusText = "status_text"
        case updatedAt = "updated_at"
        case expiresAt = "expires_at"
    }

    init(
        enabled: Bool,
        visibilityScope: MapVisibilityScope,
        onlineStatus: String = MapOnlineStatus.online.rawValue,
        visibleOnMap: Bool = false,
        status: String? = nil,
        latitude: Double? = nil,
        longitude: Double? = nil,
        accuracyM: Double? = nil,
        statusText: String? = nil,
        updatedAt: String? = nil,
        expiresAt: String? = nil
    ) {
        self.enabled = enabled
        self.visibilityScope = visibilityScope
        self.onlineStatus = onlineStatus
        self.visibleOnMap = visibleOnMap
        self.status = status
        self.latitude = latitude
        self.longitude = longitude
        self.accuracyM = accuracyM
        self.statusText = statusText
        self.updatedAt = updatedAt
        self.expiresAt = expiresAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let scope = (try? container.decodeIfPresent(MapVisibilityScope.self, forKey: .visibilityScope)) ?? .off
        let decodedStatus = container.flexString(for: .status)
        let decodedOnlineStatus = container.flexString(for: .onlineStatus)
            ?? (decodedStatus == "invisible" ? MapOnlineStatus.invisible.rawValue : MapOnlineStatus.online.rawValue)
        self.enabled = container.flexBool(for: .enabled) ?? (scope != .off && decodedStatus != "off")
        self.visibilityScope = scope
        self.onlineStatus = decodedOnlineStatus
        let fallbackVisible = self.enabled
            && decodedOnlineStatus == MapOnlineStatus.online.rawValue
            && (decodedStatus == nil || decodedStatus == "active")
        self.visibleOnMap = container.flexBool(for: .visibleOnMap)
            ?? fallbackVisible
        self.status = decodedStatus
        self.latitude = container.flexDouble(for: .latitude)
        self.longitude = container.flexDouble(for: .longitude)
        self.accuracyM = container.flexDouble(for: .accuracyM)
        self.statusText = container.flexString(for: .statusText)
        self.updatedAt = container.flexString(for: .updatedAt)
        self.expiresAt = container.flexString(for: .expiresAt)
    }
}

struct MapUser: Decodable, Identifiable, Equatable {
    let userID: String
    let nickname: String
    let avatarURL: String
    let bio: String?
    let gender: String?
    let age: Int?
    let profileLocation: String?
    let relation: String?
    let visibilityScope: MapVisibilityScope?
    let onlineStatus: String
    let statusText: String?
    let distanceM: Double?
    let distanceText: String?
    let displayLat: Double?
    let displayLng: Double?
    let lastActiveAt: String?

    var id: String { userID }

    var hasMappableCoordinate: Bool {
        guard let displayLat, let displayLng,
              displayLat.isFinite, displayLng.isFinite else {
            return false
        }
        return (-90...90).contains(displayLat) && (-180...180).contains(displayLng)
    }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case id
        case uid
        case userIDCamel = "userId"
        case accountID = "account_id"
        case nickname
        case username
        case name
        case displayName = "display_name"
        case avatarURL = "avatar_url"
        case avatar
        case avatarUrlCamel = "avatarUrl"
        case profileImageURL = "profile_image_url"
        case bio
        case gender
        case age
        case profileLocation = "profile_location"
        case relation
        case visibilityScope = "visibility_scope"
        case onlineStatus = "online_status"
        case onlineStatusCamel = "onlineStatus"
        case status
        case isOnline = "is_online"
        case statusText = "status_text"
        case distanceM = "distance_m"
        case distanceText = "distance_text"
        case displayLat = "display_lat"
        case displayLng = "display_lng"
        case displayLatitude = "display_latitude"
        case displayLongitude = "display_longitude"
        case displayLon = "display_lon"
        case mapLat = "map_lat"
        case mapLng = "map_lng"
        case mapLatitude = "map_latitude"
        case mapLongitude = "map_longitude"
        case obfuscatedLat = "obfuscated_lat"
        case obfuscatedLng = "obfuscated_lng"
        case obfuscatedLatitude = "obfuscated_latitude"
        case obfuscatedLongitude = "obfuscated_longitude"
        case latitude
        case longitude
        case lat
        case lng
        case lon
        case long
        case location
        case coordinate
        case coordinates
        case position
        case displayLocation = "display_location"
        case displayCoordinate = "display_coordinate"
        case mapLocation = "map_location"
        case mapCoordinate = "map_coordinate"
        case mapPresence = "map_presence"
        case presence
        case lastLocation = "last_location"
        case geo
        case geometry
        case point
        case lastActiveAt = "last_active_at"
    }

    init(
        userID: String,
        nickname: String,
        avatarURL: String = "",
        bio: String? = nil,
        gender: String? = nil,
        age: Int? = nil,
        profileLocation: String? = nil,
        relation: String? = nil,
        visibilityScope: MapVisibilityScope? = nil,
        onlineStatus: String = MapOnlineStatus.online.rawValue,
        statusText: String? = nil,
        distanceM: Double? = nil,
        distanceText: String? = nil,
        displayLat: Double? = nil,
        displayLng: Double? = nil,
        lastActiveAt: String? = nil
    ) {
        self.userID = userID
        self.nickname = nickname
        self.avatarURL = avatarURL
        self.bio = bio
        self.gender = gender
        self.age = age
        self.profileLocation = profileLocation
        self.relation = relation
        self.visibilityScope = visibilityScope
        self.onlineStatus = onlineStatus
        self.statusText = statusText
        self.distanceM = distanceM
        self.distanceText = distanceText
        self.displayLat = displayLat
        self.displayLng = displayLng
        self.lastActiveAt = lastActiveAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let nestedCoordinate = Self.decodeCoordinate(from: container)
        let decodedStatus = container.flexString(for: .onlineStatus)
            ?? container.flexString(for: .onlineStatusCamel)
            ?? container.flexString(for: .status)
        let normalizedStatus = Self.normalizedOnlineStatus(
            rawValue: decodedStatus,
            isOnline: container.flexBool(for: .isOnline)
        )

        guard let userID = container.flexString(for: .userID)
            ?? container.flexString(for: .id)
            ?? container.flexString(for: .uid)
            ?? container.flexString(for: .userIDCamel)
            ?? container.flexString(for: .accountID),
              !userID.isBlank else {
            throw DecodingError.keyNotFound(
                CodingKeys.userID,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Map user is missing a non-empty user identifier"
                )
            )
        }
        self.userID = userID
        self.nickname = container.flexString(for: .nickname)
            ?? container.flexString(for: .displayName)
            ?? container.flexString(for: .name)
            ?? container.flexString(for: .username)
            ?? L10n.tr("profile.defaultUser")
        self.avatarURL = container.flexString(for: .avatarURL)
            ?? container.flexString(for: .avatarUrlCamel)
            ?? container.flexString(for: .avatar)
            ?? container.flexString(for: .profileImageURL)
            ?? ""
        self.bio = container.flexString(for: .bio)
        self.gender = container.flexString(for: .gender)
        self.age = container.flexInt(for: .age)
        self.profileLocation = container.flexString(for: .profileLocation)
        self.relation = container.flexString(for: .relation)
        self.visibilityScope = try? container.decodeIfPresent(MapVisibilityScope.self, forKey: .visibilityScope)
        self.onlineStatus = normalizedStatus
        self.statusText = container.flexString(for: .statusText)
        self.distanceM = container.flexDouble(for: .distanceM)
        self.distanceText = container.flexString(for: .distanceText)
        self.displayLat = Self.firstDouble(
            in: container,
            keys: [.displayLat, .displayLatitude, .mapLat, .mapLatitude, .obfuscatedLat, .obfuscatedLatitude, .latitude, .lat]
        )
            ?? nestedCoordinate?.latitude
        self.displayLng = Self.firstDouble(
            in: container,
            keys: [.displayLng, .displayLongitude, .displayLon, .mapLng, .mapLongitude, .obfuscatedLng, .obfuscatedLongitude, .longitude, .lng, .lon, .long]
        )
            ?? nestedCoordinate?.longitude
        self.lastActiveAt = container.flexString(for: .lastActiveAt)
    }

    private static func decodeCoordinate(from container: KeyedDecodingContainer<CodingKeys>) -> MapUserCoordinate? {
        for key in nestedCoordinateKeys {
            if let coordinate = try? container.decodeIfPresent(MapUserCoordinate.self, forKey: key) {
                return coordinate
            }
        }
        return nil
    }

    private static func firstDouble(in container: KeyedDecodingContainer<CodingKeys>, keys: [CodingKeys]) -> Double? {
        for key in keys {
            if let value = container.flexDouble(for: key) {
                return value
            }
        }
        return nil
    }

    private static let nestedCoordinateKeys: [CodingKeys] = [
        .location,
        .coordinate,
        .coordinates,
        .position,
        .displayLocation,
        .displayCoordinate,
        .mapLocation,
        .mapCoordinate,
        .mapPresence,
        .presence,
        .lastLocation,
        .geo,
        .geometry,
        .point
    ]

    private static func normalizedOnlineStatus(rawValue: String?, isOnline: Bool?) -> String {
        if let isOnline {
            return isOnline ? MapOnlineStatus.online.rawValue : MapOnlineStatus.invisible.rawValue
        }
        switch rawValue?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "online", "active", "visible", "available", "true", "1", "在线", "上線":
            return MapOnlineStatus.online.rawValue
        case "invisible", "offline", "hidden", "false", "0", "隐身", "隱身", "离线", "離線":
            return MapOnlineStatus.invisible.rawValue
        default:
            return MapOnlineStatus.online.rawValue
        }
    }

    func replacingRelation(_ relation: String?) -> MapUser {
        MapUser(
            userID: userID,
            nickname: nickname,
            avatarURL: avatarURL,
            bio: bio,
            gender: gender,
            age: age,
            profileLocation: profileLocation,
            relation: relation,
            visibilityScope: visibilityScope,
            onlineStatus: onlineStatus,
            statusText: statusText,
            distanceM: distanceM,
            distanceText: distanceText,
            displayLat: displayLat,
            displayLng: displayLng,
            lastActiveAt: lastActiveAt
        )
    }
}

private struct MapUserCoordinate: Decodable {
    let latitude: Double?
    let longitude: Double?

    enum CodingKeys: String, CodingKey {
        case latitude
        case longitude
        case lat
        case lng
        case lon
        case long
        case displayLat = "display_lat"
        case displayLng = "display_lng"
        case displayLatitude = "display_latitude"
        case displayLongitude = "display_longitude"
        case displayLon = "display_lon"
        case mapLat = "map_lat"
        case mapLng = "map_lng"
        case mapLatitude = "map_latitude"
        case mapLongitude = "map_longitude"
        case obfuscatedLat = "obfuscated_lat"
        case obfuscatedLng = "obfuscated_lng"
        case obfuscatedLatitude = "obfuscated_latitude"
        case obfuscatedLongitude = "obfuscated_longitude"
        case coordinate
        case coordinates
        case position
        case displayLocation = "display_location"
        case displayCoordinate = "display_coordinate"
        case mapLocation = "map_location"
        case mapCoordinate = "map_coordinate"
        case mapPresence = "map_presence"
        case presence
        case lastLocation = "last_location"
        case geo
        case geometry
        case point
    }

    init(from decoder: Decoder) throws {
        if let coordinate = Self.decodeCoordinateArray(from: decoder) {
            self.latitude = coordinate.latitude
            self.longitude = coordinate.longitude
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        let nestedCoordinate = Self.decodeNestedCoordinate(from: container)
        self.latitude = Self.firstDouble(
            in: container,
            keys: [.displayLat, .displayLatitude, .mapLat, .mapLatitude, .obfuscatedLat, .obfuscatedLatitude, .latitude, .lat]
        )
            ?? nestedCoordinate?.latitude
        self.longitude = Self.firstDouble(
            in: container,
            keys: [.displayLng, .displayLongitude, .displayLon, .mapLng, .mapLongitude, .obfuscatedLng, .obfuscatedLongitude, .longitude, .lng, .lon, .long]
        )
            ?? nestedCoordinate?.longitude
    }

    private static func firstDouble(in container: KeyedDecodingContainer<CodingKeys>, keys: [CodingKeys]) -> Double? {
        for key in keys {
            if let value = container.flexDouble(for: key) {
                return value
            }
        }
        return nil
    }

    private static func decodeNestedCoordinate(from container: KeyedDecodingContainer<CodingKeys>) -> MapUserCoordinate? {
        for key in nestedCoordinateKeys {
            if let coordinate = try? container.decodeIfPresent(MapUserCoordinate.self, forKey: key) {
                return coordinate
            }
        }
        return nil
    }

    private static let nestedCoordinateKeys: [CodingKeys] = [
        .coordinate,
        .coordinates,
        .position,
        .displayLocation,
        .displayCoordinate,
        .mapLocation,
        .mapCoordinate,
        .mapPresence,
        .presence,
        .lastLocation,
        .geo,
        .geometry,
        .point
    ]

    private static func decodeCoordinateArray(from decoder: Decoder) -> (latitude: Double?, longitude: Double?)? {
        let values: [Double]
        if let doubles = try? [Double](from: decoder) {
            values = doubles
        } else if let strings = try? [String](from: decoder) {
            values = strings.compactMap { Double($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
        } else {
            return nil
        }
        guard values.count >= 2 else { return nil }
        let first = values[0]
        let second = values[1]

        if abs(first) <= 90, abs(second) > 90 {
            return (latitude: first, longitude: second)
        }
        return (latitude: second, longitude: first)
    }
}

struct MapRadiusConstraints: Decodable, Equatable {
    let minRadiusM: Int
    let maxRadiusM: Int
    let defaultRadiusM: Int
    let publicGridM: Int

    static let fallback = MapRadiusConstraints(
        minRadiusM: 200,
        maxRadiusM: 50_000,
        defaultRadiusM: 10_000,
        publicGridM: 500
    )

    enum CodingKeys: String, CodingKey {
        case minRadiusM = "min_radius_m"
        case maxRadiusM = "max_radius_m"
        case defaultRadiusM = "default_radius_m"
        case publicGridM = "public_grid_m"
    }

    init(
        minRadiusM: Int,
        maxRadiusM: Int,
        defaultRadiusM: Int,
        publicGridM: Int
    ) {
        self.minRadiusM = minRadiusM
        self.maxRadiusM = maxRadiusM
        self.defaultRadiusM = defaultRadiusM
        self.publicGridM = publicGridM
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.minRadiusM = container.flexInt(for: .minRadiusM) ?? 200
        self.maxRadiusM = container.flexInt(for: .maxRadiusM) ?? 50_000
        self.defaultRadiusM = container.flexInt(for: .defaultRadiusM) ?? 10_000
        self.publicGridM = container.flexInt(for: .publicGridM) ?? 500
    }
}

struct MapPresenceResponseData: Decodable {
    let presence: MapPresence?

    enum CodingKeys: String, CodingKey {
        case presence
        case item
        case data
    }

    init(from decoder: Decoder) throws {
        let directContainer = try decoder.container(keyedBy: MapPresence.CodingKeys.self)
        if directContainer.contains(.enabled)
            || directContainer.contains(.visibilityScope)
            || directContainer.contains(.onlineStatus)
            || directContainer.contains(.visibleOnMap)
            || directContainer.contains(.status) {
            let presence = try MapPresence(from: decoder)
            self.presence = presence
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.presence = (try? container.decodeIfPresent(MapPresence.self, forKey: .presence))
            ?? (try? container.decodeIfPresent(MapPresence.self, forKey: .item))
            ?? (try? container.decodeIfPresent(MapPresence.self, forKey: .data))
            ?? nil
    }
}

struct MapUsersResponseData: Decodable {
    let users: [MapUser]
    let effectiveRadiusM: Int?
    let constraints: MapRadiusConstraints?

    enum CodingKeys: String, CodingKey {
        case users
        case nearbyUsers = "nearby_users"
        case friends
        case profiles
        case items
        case results
        case data
        case list
        case records
        case effectiveRadiusM = "effective_radius_m"
        case radiusM = "radius_m"
        case constraints
    }

    init(
        users: [MapUser],
        effectiveRadiusM: Int? = nil,
        constraints: MapRadiusConstraints? = nil
    ) {
        self.users = users
        self.effectiveRadiusM = effectiveRadiusM
        self.constraints = constraints
    }

    init(from decoder: Decoder) throws {
        if let list = try? [MapUser](from: decoder) {
            self.users = list
            self.effectiveRadiusM = nil
            self.constraints = nil
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.data), try !container.decodeNil(forKey: .data) {
            if let nested = try? container.decode(MapUsersResponseData.self, forKey: .data) {
                self = nested
                return
            }
        }

        let listKeys: [CodingKeys] = [
            .users, .nearbyUsers, .friends, .profiles, .items, .results, .data, .list, .records
        ]
        guard let listKey = listKeys.first(where: { container.contains($0) }) else {
            throw DecodingError.keyNotFound(
                CodingKeys.users,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Map users response is missing a supported users list"
                )
            )
        }
        // An explicit empty array is valid. A missing or null list is a broken
        // response contract and must not be rendered as "no nearby users".
        self.users = try container.decode([MapUser].self, forKey: listKey)
        self.effectiveRadiusM = container.flexInt(for: .effectiveRadiusM)
            ?? container.flexInt(for: .radiusM)
        self.constraints = try? container.decodeIfPresent(MapRadiusConstraints.self, forKey: .constraints)
    }
}

struct MapUserResponseData: Decodable {
    let user: MapUser?

    enum CodingKeys: String, CodingKey {
        case user
        case item
        case profile
        case data
    }

    init(from decoder: Decoder) throws {
        if let user = try? MapUser(from: decoder), !user.userID.isEmpty {
            self.user = user
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.user = (try? container.decodeIfPresent(MapUser.self, forKey: .user))
            ?? (try? container.decodeIfPresent(MapUser.self, forKey: .item))
            ?? (try? container.decodeIfPresent(MapUser.self, forKey: .profile))
            ?? (try? container.decodeIfPresent(MapUser.self, forKey: .data))
            ?? nil
    }
}

struct MapFlightCoordinate: Decodable, Equatable {
    let lat: Double
    let lng: Double

    enum CodingKeys: String, CodingKey {
        case lat
        case latitude
        case lng
        case lon
        case longitude
    }

    init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }

    init(from decoder: Decoder) throws {
        if var array = try? decoder.unkeyedContainer() {
            let first = (try? array.decode(Double.self)) ?? 0
            let second = (try? array.decode(Double.self)) ?? 0
            if abs(first) > 90, abs(second) <= 90 {
                self.lat = second
                self.lng = first
            } else {
                self.lat = first
                self.lng = second
            }
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.lat = container.flexDouble(for: .lat)
            ?? container.flexDouble(for: .latitude)
            ?? 0
        self.lng = container.flexDouble(for: .lng)
            ?? container.flexDouble(for: .lon)
            ?? container.flexDouble(for: .longitude)
            ?? 0
    }
}

struct MapFlightAircraft: Decodable, Identifiable, Equatable {
    let id: String
    let callsign: String
    let lat: Double
    let lng: Double
    let heading: Double
    let altitudeM: Double
    let speedMps: Double
    let assetKey: String
    let updatedAt: String?
    let routePoints: [MapFlightCoordinate]

    enum CodingKeys: String, CodingKey {
        case id
        case icao24
        case hex
        case callsign
        case flight
        case lat
        case latitude
        case lng
        case lon
        case longitude
        case heading
        case trueTrack = "true_track"
        case track
        case bearing
        case altitudeM = "altitude_m"
        case altitudeMeters = "altitudeM"
        case geoAltitude = "geo_altitude"
        case baroAltitude = "baro_altitude"
        case speedMps = "speed_mps"
        case speedMetersPerSecond = "speedMps"
        case velocity
        case assetKey = "asset_key"
        case assetKeyCamel = "assetKey"
        case updatedAt = "updated_at"
        case updatedAtCamel = "updatedAt"
        case route
        case routePoints = "route_points"
        case path
        case polyline
    }

    init(
        id: String,
        callsign: String,
        lat: Double,
        lng: Double,
        heading: Double,
        altitudeM: Double,
        speedMps: Double,
        assetKey: String,
        updatedAt: String? = nil,
        routePoints: [MapFlightCoordinate] = []
    ) {
        self.id = id
        self.callsign = callsign
        self.lat = lat
        self.lng = lng
        self.heading = heading
        self.altitudeM = altitudeM
        self.speedMps = speedMps
        self.assetKey = Self.normalizedAssetKey(assetKey, seed: id)
        self.updatedAt = updatedAt
        self.routePoints = routePoints
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedID = container.flexString(for: .id)
            ?? container.flexString(for: .icao24)
            ?? container.flexString(for: .hex)
            ?? UUID().uuidString
        let decodedCallsign = container.flexString(for: .callsign)
            ?? container.flexString(for: .flight)
            ?? decodedID.uppercased()

        self.id = decodedID
        self.callsign = decodedCallsign.trimmingCharacters(in: .whitespacesAndNewlines)
        self.lat = container.flexDouble(for: .lat)
            ?? container.flexDouble(for: .latitude)
            ?? 0
        self.lng = container.flexDouble(for: .lng)
            ?? container.flexDouble(for: .lon)
            ?? container.flexDouble(for: .longitude)
            ?? 0
        self.heading = container.flexDouble(for: .heading)
            ?? container.flexDouble(for: .trueTrack)
            ?? container.flexDouble(for: .track)
            ?? container.flexDouble(for: .bearing)
            ?? 90
        self.altitudeM = container.flexDouble(for: .altitudeM)
            ?? container.flexDouble(for: .altitudeMeters)
            ?? container.flexDouble(for: .geoAltitude)
            ?? container.flexDouble(for: .baroAltitude)
            ?? 0
        self.speedMps = container.flexDouble(for: .speedMps)
            ?? container.flexDouble(for: .speedMetersPerSecond)
            ?? container.flexDouble(for: .velocity)
            ?? 0
        let rawAssetKey = container.flexString(for: .assetKey)
            ?? container.flexString(for: .assetKeyCamel)
            ?? ""
        self.assetKey = Self.normalizedAssetKey(rawAssetKey, seed: decodedID)
        self.updatedAt = container.flexString(for: .updatedAt)
            ?? container.flexString(for: .updatedAtCamel)
        self.routePoints = (try? container.decodeIfPresent([MapFlightCoordinate].self, forKey: .route))
            ?? (try? container.decodeIfPresent([MapFlightCoordinate].self, forKey: .routePoints))
            ?? (try? container.decodeIfPresent([MapFlightCoordinate].self, forKey: .path))
            ?? (try? container.decodeIfPresent([MapFlightCoordinate].self, forKey: .polyline))
            ?? []
    }

    private static func normalizedAssetKey(_ raw: String, seed: String) -> String {
        let allowed = [
            "flight_plane_blue",
            "flight_plane_pink",
            "flight_plane_gold",
            "flight_plane_green",
            "flight_plane_orange",
            "flight_plane_star"
        ]
        if allowed.contains(raw) {
            return raw
        }
        let checksum = seed.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        return allowed[abs(checksum) % allowed.count]
    }
}

struct MapFlightRoute: Decodable, Identifiable, Equatable {
    let id: String
    let aircraftID: String?
    let assetKey: String?
    let points: [MapFlightCoordinate]

    enum CodingKeys: String, CodingKey {
        case id
        case routeID = "route_id"
        case aircraftID = "aircraft_id"
        case aircraftIDCamel = "aircraftId"
        case flightID = "flight_id"
        case assetKey = "asset_key"
        case assetKeyCamel = "assetKey"
        case points
        case coordinates
        case route
        case path
        case fromLat = "from_lat"
        case fromLng = "from_lng"
        case toLat = "to_lat"
        case toLng = "to_lng"
        case originLat = "origin_lat"
        case originLng = "origin_lng"
        case destinationLat = "destination_lat"
        case destinationLng = "destination_lng"
        case startLat = "start_lat"
        case startLng = "start_lng"
        case endLat = "end_lat"
        case endLng = "end_lng"
    }

    init(
        id: String,
        aircraftID: String? = nil,
        assetKey: String? = nil,
        points: [MapFlightCoordinate]
    ) {
        self.id = id
        self.aircraftID = aircraftID
        self.assetKey = assetKey
        self.points = points
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedAircraftID = container.flexString(for: .aircraftID)
            ?? container.flexString(for: .aircraftIDCamel)
            ?? container.flexString(for: .flightID)
        self.id = container.flexString(for: .id)
            ?? container.flexString(for: .routeID)
            ?? decodedAircraftID
            ?? UUID().uuidString
        self.aircraftID = decodedAircraftID
        self.assetKey = container.flexString(for: .assetKey)
            ?? container.flexString(for: .assetKeyCamel)

        if let decodedPoints = (try? container.decodeIfPresent([MapFlightCoordinate].self, forKey: .points))
            ?? (try? container.decodeIfPresent([MapFlightCoordinate].self, forKey: .coordinates))
            ?? (try? container.decodeIfPresent([MapFlightCoordinate].self, forKey: .route))
            ?? (try? container.decodeIfPresent([MapFlightCoordinate].self, forKey: .path)),
           !decodedPoints.isEmpty {
            self.points = decodedPoints
            return
        }

        let fromLat = container.flexDouble(for: .fromLat)
            ?? container.flexDouble(for: .originLat)
            ?? container.flexDouble(for: .startLat)
        let fromLng = container.flexDouble(for: .fromLng)
            ?? container.flexDouble(for: .originLng)
            ?? container.flexDouble(for: .startLng)
        let toLat = container.flexDouble(for: .toLat)
            ?? container.flexDouble(for: .destinationLat)
            ?? container.flexDouble(for: .endLat)
        let toLng = container.flexDouble(for: .toLng)
            ?? container.flexDouble(for: .destinationLng)
            ?? container.flexDouble(for: .endLng)

        if let fromLat, let fromLng, let toLat, let toLng {
            self.points = [
                MapFlightCoordinate(lat: fromLat, lng: fromLng),
                MapFlightCoordinate(lat: toLat, lng: toLng)
            ]
        } else {
            self.points = []
        }
    }
}

struct MapFlightLayerResponseData: Decodable, Equatable {
    let ttlSeconds: Int
    let aircraft: [MapFlightAircraft]
    let routes: [MapFlightRoute]

    enum CodingKeys: String, CodingKey {
        case ttlSeconds = "ttl_seconds"
        case ttlSecondsCamel = "ttlSeconds"
        case aircraft
        case flights
        case planes
        case items
        case results
        case routes
        case routeLines = "route_lines"
        case lines
        case data
    }

    init(
        ttlSeconds: Int = 15,
        aircraft: [MapFlightAircraft] = [],
        routes: [MapFlightRoute] = []
    ) {
        self.ttlSeconds = ttlSeconds
        self.aircraft = aircraft
        self.routes = routes
    }

    init(from decoder: Decoder) throws {
        if let list = try? [MapFlightAircraft](from: decoder) {
            self.ttlSeconds = 15
            self.aircraft = list
            self.routes = []
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let nested = try? container.decodeIfPresent(MapFlightLayerResponseData.self, forKey: .data) {
            self = nested
            return
        }

        self.ttlSeconds = container.flexInt(for: .ttlSeconds)
            ?? container.flexInt(for: .ttlSecondsCamel)
            ?? 15
        self.aircraft = (try? container.decodeIfPresent([MapFlightAircraft].self, forKey: .aircraft))
            ?? (try? container.decodeIfPresent([MapFlightAircraft].self, forKey: .flights))
            ?? (try? container.decodeIfPresent([MapFlightAircraft].self, forKey: .planes))
            ?? (try? container.decodeIfPresent([MapFlightAircraft].self, forKey: .items))
            ?? (try? container.decodeIfPresent([MapFlightAircraft].self, forKey: .results))
            ?? []
        self.routes = (try? container.decodeIfPresent([MapFlightRoute].self, forKey: .routes))
            ?? (try? container.decodeIfPresent([MapFlightRoute].self, forKey: .routeLines))
            ?? (try? container.decodeIfPresent([MapFlightRoute].self, forKey: .lines))
            ?? []
    }
}

extension KeyedDecodingContainer {
    func flexDouble(for key: Key) -> Double? {
        if let double = try? decodeIfPresent(Double.self, forKey: key) {
            return double
        }
        if let int = try? decodeIfPresent(Int.self, forKey: key) {
            return Double(int)
        }
        if let string = try? decodeIfPresent(String.self, forKey: key) {
            return Double(string)
        }
        return nil
    }

    func flexBool(for key: Key) -> Bool? {
        if let bool = try? decodeIfPresent(Bool.self, forKey: key) {
            return bool
        }
        if let int = try? decodeIfPresent(Int.self, forKey: key) {
            return int != 0
        }
        if let string = try? decodeIfPresent(String.self, forKey: key) {
            switch string.lowercased() {
            case "true", "1", "yes": return true
            case "false", "0", "no": return false
            default: return nil
            }
        }
        return nil
    }
}
