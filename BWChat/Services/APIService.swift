// BWChat/Services/APIService.swift
// HTTP API service using URLSession

import Foundation
import UIKit

enum APIError: Error, LocalizedError {
    case invalidURL
    case invalidResponse
    case unauthorized
    case serverError(code: Int, message: String)
    case networkError(Error)
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return L10n.tr("api.invalidURL")
        case .invalidResponse: return L10n.tr("api.invalidResponse")
        case .unauthorized: return L10n.tr("api.unauthorized")
        case .serverError(_, let message): return message
        case .networkError(let error): return L10n.tr("api.networkError", error.localizedDescription)
        case .decodingError: return L10n.tr("api.decodingError")
        }
    }
}

struct APIResponseWrapper<T: Decodable>: Decodable {
    let code: Int
    let message: String
    let data: T?
}

private struct DiscoverConfigRemoteResponse: Decodable {
    private struct Wrapped: Decodable {
        let data: DiscoverConfigData?
    }

    let config: DiscoverConfigData

    init(from decoder: Decoder) throws {
        if let wrapped = try? Wrapped(from: decoder),
           let config = wrapped.data {
            self.config = config
            return
        }
        self.config = try DiscoverConfigData(from: decoder)
    }
}

private struct MapFlightLayerRemoteResponse: Decodable {
    let layer: MapFlightLayerResponseData

    init(from decoder: Decoder) throws {
        if let wrapped = try? APIResponseWrapper<MapFlightLayerResponseData>(from: decoder),
           let data = wrapped.data {
            self.layer = data
            return
        }
        self.layer = try MapFlightLayerResponseData(from: decoder)
    }
}

struct EmptyData: Decodable {}

private struct DetailErrorResponse: Decodable {
    struct Detail: Decodable {
        let code: Int?
        let message: String?
    }
    let detail: Detail?
}

private struct GiftDirectMessageResponseData: Decodable {
    let message: Message?
    let fallbackContent: String?

    enum CodingKeys: String, CodingKey {
        case message
        case msg
        case chatMessage = "chat_message"
        case chatMessageCamel = "chatMessage"
        case data
        case item
        case gift
        case payload
        case content
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        for key in [CodingKeys.message, .msg, .chatMessage, .chatMessageCamel, .data, .item] {
            if let message = try? container.decodeIfPresent(Message.self, forKey: key),
               message.isUsableGiftResponse {
                self.message = message
                self.fallbackContent = message.content
                return
            }
        }

        let directMessage = (try? Message(from: decoder)).flatMap { $0.isUsableGiftResponse ? $0 : nil }
        let content = [CodingKeys.gift, .payload, .content, .data, .item]
            .lazy
            .compactMap { container.flexContent(for: $0) }
            .first { GiftMessagePayload.parse($0) != nil }

        self.message = directMessage
        self.fallbackContent = content ?? directMessage?.content
    }
}

private struct GiftGroupMessageResponseData: Decodable {
    let message: GroupMessage?
    let fallbackContent: String?

    enum CodingKeys: String, CodingKey {
        case message
        case msg
        case groupMessage = "group_message"
        case groupMessageCamel = "groupMessage"
        case chatMessage = "chat_message"
        case chatMessageCamel = "chatMessage"
        case data
        case item
        case gift
        case payload
        case content
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        for key in [CodingKeys.message, .msg, .groupMessage, .groupMessageCamel, .chatMessage, .chatMessageCamel, .data, .item] {
            if let message = try? container.decodeIfPresent(GroupMessage.self, forKey: key),
               message.isUsableGiftResponse {
                self.message = message
                self.fallbackContent = message.content
                return
            }
        }

        let directMessage = (try? GroupMessage(from: decoder)).flatMap { $0.isUsableGiftResponse ? $0 : nil }
        let content = [CodingKeys.gift, .payload, .content, .data, .item]
            .lazy
            .compactMap { container.flexContent(for: $0) }
            .first { GiftMessagePayload.parse($0) != nil }

        self.message = directMessage
        self.fallbackContent = content ?? directMessage?.content
    }
}

private extension Message {
    var isUsableGiftResponse: Bool {
        id != 0 || msgType == "gift" || GiftMessagePayload.parse(content) != nil
    }
}

private extension GroupMessage {
    var isUsableGiftResponse: Bool {
        id != 0 || msgType == "gift" || GiftMessagePayload.parse(content) != nil
    }
}

@MainActor
class APIService {
    static let shared = APIService()
    private let session: URLSession
    private(set) var baseURL: String
    private var isRefreshing = false
    private var refreshContinuations: [CheckedContinuation<Void, Error>] = []
    private static let iso8601Formatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 120
        config.waitsForConnectivity = true
        self.session = URLSession(configuration: config)
        self.baseURL = AppConfig.apiBaseURL
    }

    // MARK: - Auth

    func login(username: String, password: String, deviceToken: String? = nil) async throws -> (String, String, User) {
        var body: [String: Any] = [
            "username": username,
            "password": password,
        ]
        if let token = deviceToken {
            body["device_token"] = token
        }

        struct LoginData: Decodable {
            let token: String
            let refreshToken: String
            let user: User

            enum CodingKeys: String, CodingKey {
                case token
                case refreshToken = "refresh_token"
                case user
            }
        }

        let response: APIResponseWrapper<LoginData> = try await postJSON(path: "/auth/login", body: body, auth: false)
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return (data.token, data.refreshToken, data.user)
    }

    func register(
        username: String,
        password: String,
        nickname: String?,
        deviceToken: String?
    ) async throws -> (String, String, User) {
        var body: [String: Any] = [
            "username": username,
            "password": password,
        ]
        if let nickname = nickname, !nickname.isEmpty {
            body["nickname"] = nickname
        }
        if let token = deviceToken {
            body["device_token"] = token
        }

        struct RegisterData: Decodable {
            let token: String
            let refreshToken: String
            let user: User

            enum CodingKeys: String, CodingKey {
                case token
                case refreshToken = "refresh_token"
                case user
            }
        }

        let response: APIResponseWrapper<RegisterData> = try await postJSON(
            path: "/auth/register", body: body, auth: false
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return (data.token, data.refreshToken, data.user)
    }

    func verifyToken() async throws -> User {
        struct VerifyData: Decodable {
            let user: User
        }

        let response: APIResponseWrapper<VerifyData> = try await get(path: "/auth/verify")
        guard let data = response.data else {
            throw APIError.unauthorized
        }
        return data.user
    }

    func logout() async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(path: "/auth/logout", body: [:])
    }

    func changePassword(currentPassword: String, newPassword: String) async throws {
        let body: [String: Any] = [
            "old_password": currentPassword,
            "new_password": newPassword
        ]
        let _: APIResponseWrapper<EmptyData> = try await postJSON(path: "/auth/change-password", body: body)
    }

    /// Refresh access token using the stored refresh token.
    /// Returns the new (accessToken, refreshToken, user).
    func refreshTokens() async throws -> (String, String, User) {
        guard let rt = AuthManager.shared.refreshToken else {
            throw APIError.unauthorized
        }

        struct RefreshData: Decodable {
            let token: String
            let refreshToken: String
            let user: User

            enum CodingKeys: String, CodingKey {
                case token
                case refreshToken = "refresh_token"
                case user
            }
        }

        let body: [String: Any] = ["refresh_token": rt]
        let response: APIResponseWrapper<RefreshData> = try await postJSON(
            path: "/auth/refresh",
            body: body,
            auth: false
        )
        guard let data = response.data else {
            throw APIError.unauthorized
        }
        return (data.token, data.refreshToken, data.user)
    }

    // MARK: - App Config

    func fetchDiscoverConfig() async throws -> DiscoverConfigData {
        guard let url = URL(string: baseURL + "/app/discover-config") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(
            Locale.preferredLanguages.first ?? Locale.current.identifier,
            forHTTPHeaderField: "Accept-Language"
        )

        let info = Bundle.main.infoDictionary
        if let version = info?["CFBundleShortVersionString"] as? String, !version.isEmpty {
            request.setValue(version, forHTTPHeaderField: "X-App-Version")
        }
        if let build = info?["CFBundleVersion"] {
            request.setValue("\(build)", forHTTPHeaderField: "X-App-Build")
        }

        let hasToken = AuthManager.shared.token != nil
        if hasToken {
            addAuthHeader(&request)
        }

        let response: DiscoverConfigRemoteResponse = try await perform(
            request,
            allowRetry: hasToken,
            logoutOnUnauthorized: hasToken
        )
        return response.config
    }

    /// Attempt to refresh the token, coalescing concurrent requests.
    private func attemptTokenRefresh() async throws {
        if isRefreshing {
            // Wait for the in-flight refresh to finish
            try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
                refreshContinuations.append(cont)
            }
            return
        }

        isRefreshing = true
        do {
            let (newToken, newRefreshToken, user) = try await refreshTokens()
            AuthManager.shared.token = newToken
            AuthManager.shared.refreshToken = newRefreshToken
            AuthManager.shared.updateUser(user)
            isRefreshing = false
            let continuations = refreshContinuations
            refreshContinuations.removeAll()
            for cont in continuations {
                cont.resume()
            }
        } catch {
            isRefreshing = false
            let continuations = refreshContinuations
            refreshContinuations.removeAll()
            for cont in continuations {
                cont.resume(throwing: error)
            }
            throw error
        }
    }

    // MARK: - Contacts

    func getContacts() async throws -> [Contact] {
        struct ContactsData: Decodable {
            let contacts: [Contact]
        }

        let response: APIResponseWrapper<ContactsData> = try await get(path: "/chat/contacts")
        return response.data?.contacts ?? []
    }

    func getConversations() async throws -> [Conversation] {
        struct ConversationsData: Decodable {
            let conversations: [Conversation]
        }

        let response: APIResponseWrapper<ConversationsData> = try await get(path: "/chat/conversations")
        return response.data?.conversations ?? []
    }

    // MARK: - Messages

    func getMessages(contactID: String, beforeID: Int? = nil, afterID: Int? = nil, limit: Int = 30) async throws -> ([Message], Bool) {
        struct MessagesData: Decodable {
            let messages: [Message]
            let hasMore: Bool

            enum CodingKeys: String, CodingKey {
                case messages
                case hasMore = "has_more"
            }
        }

        var queryItems = [URLQueryItem]()
        if let beforeID = beforeID {
            queryItems.append(URLQueryItem(name: "before_id", value: "\(beforeID)"))
        }
        if let afterID = afterID {
            queryItems.append(URLQueryItem(name: "after_id", value: "\(afterID)"))
        }
        queryItems.append(URLQueryItem(name: "limit", value: "\(limit)"))

        let response: APIResponseWrapper<MessagesData> = try await get(
            path: "/chat/messages/\(contactID)",
            queryItems: queryItems
        )
        let data = response.data
        return (data?.messages ?? [], data?.hasMore ?? false)
    }

    func markMessagesAsRead(contactID: String) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/chat/messages/\(contactID)/read",
            body: [:]
        )
    }

    func markGroupMessagesAsRead(groupID: Int) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/groups/\(groupID)/messages/read",
            body: [:]
        )
    }

    func sendTextMessage(receiverID: String, content: String, replyToID: Int? = nil) async throws -> Message {
        var body: [String: Any] = [
            "receiver_id": receiverID,
            "content": content,
        ]
        if let replyID = replyToID {
            body["reply_to_id"] = replyID
        }

        let response: APIResponseWrapper<Message> = try await postJSON(path: "/chat/messages/text", body: body)
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func getGiftCatalog() async throws -> [GiftCatalogItem] {
        let response: APIResponseWrapper<GiftCatalogResponseData> = try await get(path: "/wallet/gifts/catalog")
        return response.data?.gifts ?? []
    }

    func sendGiftMessage(receiverID: String, giftID: String) async throws -> Message {
        let body: [String: Any] = [
            "receiver_id": receiverID,
            "recipient_id": receiverID,
            "gift_id": giftID
        ]
        let response: APIResponseWrapper<GiftDirectMessageResponseData> = try await postJSON(path: "/chat/messages/gift", body: body)
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return Self.normalizedGiftMessage(
            data.message,
            receiverID: receiverID,
            giftID: giftID,
            fallbackContent: data.fallbackContent
        )
    }

    private static func normalizedGiftMessage(
        _ message: Message?,
        receiverID: String,
        giftID: String,
        fallbackContent: String?
    ) -> Message {
        let currentUser = AuthManager.shared.currentUser
        let content = normalizedGiftContent(
            giftID: giftID,
            recipientID: receiverID,
            fallbackContent: fallbackContent ?? message?.content
        )
        let resolvedType = GiftMessagePayload.parse(content) == nil ? (message?.msgType ?? "gift") : "gift"

        return Message(
            id: resolvedMessageID(message?.id),
            senderID: nonBlank(message?.senderID) ?? currentUser?.userID ?? "",
            receiverID: nonBlank(message?.receiverID) ?? receiverID,
            msgType: resolvedType.isBlank ? "gift" : resolvedType,
            content: content,
            timestamp: nonBlank(message?.timestamp) ?? ISO8601DateFormatter().string(from: Date()),
            replyToID: message?.replyToID,
            replyTo: message?.replyTo
        )
    }

    private static func normalizedGroupGiftMessage(
        _ message: GroupMessage?,
        groupID: Int,
        recipientID: String,
        giftID: String,
        fallbackContent: String?
    ) -> GroupMessage {
        let currentUser = AuthManager.shared.currentUser
        let content = normalizedGiftContent(
            giftID: giftID,
            recipientID: recipientID,
            fallbackContent: fallbackContent ?? message?.content
        )
        let resolvedType = GiftMessagePayload.parse(content) == nil ? (message?.msgType ?? "gift") : "gift"
        let senderID = nonBlank(message?.senderID) ?? currentUser?.userID ?? ""

        return GroupMessage(
            id: resolvedMessageID(message?.id),
            groupID: message?.groupID == 0 ? groupID : (message?.groupID ?? groupID),
            senderID: senderID,
            msgType: resolvedType.isBlank ? "gift" : resolvedType,
            content: content,
            timestamp: nonBlank(message?.timestamp) ?? ISO8601DateFormatter().string(from: Date()),
            senderNickname: nonBlank(message?.senderNickname) ?? currentUser?.nickname ?? senderID,
            senderAvatar: nonBlank(message?.senderAvatar) ?? currentUser?.avatarURL ?? "",
            replyToID: message?.replyToID,
            replyTo: message?.replyTo,
            mentions: message?.mentions
        )
    }

    private static func normalizedGiftContent(
        giftID: String,
        recipientID: String,
        fallbackContent: String?
    ) -> String {
        if let fallbackContent,
           GiftMessagePayload.parse(fallbackContent) != nil {
            return fallbackContent
        }

        var payload: [String: Any] = [
            "gift_id": giftID,
            "recipient_id": recipientID
        ]
        if let currentUser = AuthManager.shared.currentUser {
            payload["sender_id"] = currentUser.userID
            payload["sender_name"] = currentUser.nickname
        }
        if let fixed = GiftCatalogItem.fixed(for: giftID) {
            payload["gift_name"] = fixed.name
            payload["asset_key"] = fixed.assetKey
            payload["amount"] = fixed.price
            payload["receiver_currency"] = fixed.receiverCurrency.rawValue
        }

        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let string = String(data: data, encoding: .utf8)
        else { return giftID }
        return string
    }

    private static func resolvedMessageID(_ id: Int?) -> Int {
        if let id, id != 0 { return id }
        return Int(Date().timeIntervalSince1970 * 1000) + Int.random(in: 0..<1_000)
    }

    private static func nonBlank(_ value: String?) -> String? {
        guard let value, !value.isBlank else { return nil }
        return value
    }

    func sendImageMessage(receiverID: String, imageData: Data, filename: String) async throws -> Message {
        let compressed = Self.compressImageForUpload(imageData)
        let response: APIResponseWrapper<Message> = try await uploadImage(
            path: "/chat/messages/image",
            fieldName: "receiver_id",
            fieldValue: receiverID,
            imageData: compressed,
            filename: filename
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendVideoMessage(receiverID: String, videoData: Data, filename: String) async throws -> Message {
        let response: APIResponseWrapper<Message> = try await uploadVideo(
            path: "/chat/messages/video",
            fieldName: "receiver_id",
            fieldValue: receiverID,
            videoData: videoData,
            filename: filename
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendVoiceMessage(receiverID: String, voiceData: Data, duration: Double, filename: String) async throws -> Message {
        guard let url = URL(string: baseURL + "/chat/messages/voice") else { throw APIError.invalidURL }
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        addAuthHeader(&request)

        var body = Data()
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"receiver_id\"\r\n\r\n\(receiverID)\r\n".data(using: .utf8)!)
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"duration\"\r\n\r\n\(String(format: "%.1f", duration))\r\n".data(using: .utf8)!)
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"voice\"; filename=\"\(filename)\"\r\nContent-Type: audio/m4a\r\n\r\n".data(using: .utf8)!)
        body.append(voiceData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let response: APIResponseWrapper<Message> = try await perform(request)
        guard let msg = response.data else { throw APIError.serverError(code: response.code, message: response.message) }
        return msg
    }

    // MARK: - Friends

    func searchUsers(keyword: String) async throws -> [SearchUser] {
        struct SearchData: Decodable {
            let users: [SearchUser]
        }

        let response: APIResponseWrapper<SearchData> = try await get(
            path: "/friends/search",
            queryItems: [URLQueryItem(name: "keyword", value: keyword)]
        )
        return response.data?.users ?? []
    }

    func getFriendList() async throws -> [FriendInfo] {
        struct FriendListData: Decodable {
            let friends: [FriendInfo]
        }

        let response: APIResponseWrapper<FriendListData> = try await get(path: "/friends/list")
        return response.data?.friends ?? []
    }

    func getFriendRequests() async throws -> [FriendRequest] {
        struct RequestsData: Decodable {
            let requests: [FriendRequest]
        }

        let response: APIResponseWrapper<RequestsData> = try await get(path: "/friends/requests")
        return response.data?.requests ?? []
    }

    func sendFriendRequest(targetUserID: String) async throws -> String {
        let body: [String: Any] = ["target_user_id": targetUserID]
        let response: APIResponseWrapper<EmptyData> = try await postJSON(path: "/friends/request", body: body)
        return response.message
    }

    func acceptFriendRequest(requestID: Int) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/friends/requests/\(requestID)/accept",
            body: [:]
        )
    }

    func rejectFriendRequest(requestID: Int) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/friends/requests/\(requestID)/reject",
            body: [:]
        )
    }

    // MARK: - Map Dating

    func getMapPresence() async throws -> MapPresence {
        let response: APIResponseWrapper<MapPresenceResponseData> = try await get(path: "/map/me")
        guard let presence = response.data?.presence else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return presence
    }

    func updateMapLocation(
        latitude: Double,
        longitude: Double,
        accuracyM: Double?
    ) async throws -> MapPresence {
        var body: [String: Any] = [
            "latitude": latitude,
            "longitude": longitude
        ]
        if let accuracyM {
            body["accuracy_m"] = accuracyM
        }

        let response: APIResponseWrapper<MapPresenceResponseData> = try await putJSON(
            path: "/map/me/location",
            body: body
        )
        guard let presence = response.data?.presence else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return presence
    }

    func updateMapSettings(
        visibilityScope: MapVisibilityScope? = nil,
        onlineStatus: String? = nil,
        statusText: String? = nil
    ) async throws -> MapPresence {
        var body: [String: Any] = [:]
        if let visibilityScope {
            body["visibility_scope"] = visibilityScope.rawValue
        }
        if let onlineStatus {
            body["online_status"] = onlineStatus
        }
        if let statusText {
            body["status_text"] = statusText
        }

        let response: APIResponseWrapper<MapPresenceResponseData> = try await putJSON(
            path: "/map/me/settings",
            body: body
        )
        if let presence = response.data?.presence {
            return presence
        }
        if response.code == 0 {
            return try await getMapPresence()
        }
        throw APIError.serverError(code: response.code, message: response.message)
    }

    func disableMapPresence() async throws -> MapPresence {
        let response: APIResponseWrapper<MapPresenceResponseData> = try await postJSON(
            path: "/map/me/disable",
            body: [:]
        )
        guard let presence = response.data?.presence else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return presence
    }

    func getNearbyMapUsers(
        lat: Double,
        lng: Double,
        radiusM: Int = 10_000,
        limit: Int = 50,
        gender: String? = nil,
        minAge: Int? = nil,
        maxAge: Int? = nil,
        includeFriends: Bool = false
    ) async throws -> MapUsersResponseData {
        var queryItems = [
            URLQueryItem(name: "lat", value: "\(lat)"),
            URLQueryItem(name: "lng", value: "\(lng)"),
            URLQueryItem(name: "radius_m", value: "\(radiusM)"),
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "include_friends", value: includeFriends ? "true" : "false")
        ]
        if let gender, !gender.isBlank {
            queryItems.append(URLQueryItem(name: "gender", value: gender))
        }
        if let minAge {
            queryItems.append(URLQueryItem(name: "min_age", value: "\(minAge)"))
        }
        if let maxAge {
            queryItems.append(URLQueryItem(name: "max_age", value: "\(maxAge)"))
        }

        let response: APIResponseWrapper<MapUsersResponseData> = try await get(
            path: "/map/nearby",
            queryItems: queryItems
        )
        return response.data ?? MapUsersResponseData(users: [])
    }

    func getFriendMapUsers(
        lat: Double?,
        lng: Double?,
        radiusM: Int?,
        limit: Int = 50
    ) async throws -> MapUsersResponseData {
        var queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let lat {
            queryItems.append(URLQueryItem(name: "lat", value: "\(lat)"))
        }
        if let lng {
            queryItems.append(URLQueryItem(name: "lng", value: "\(lng)"))
        }
        if let radiusM {
            queryItems.append(URLQueryItem(name: "radius_m", value: "\(radiusM)"))
        }

        let response: APIResponseWrapper<MapUsersResponseData> = try await get(
            path: "/map/friends",
            queryItems: queryItems
        )
        return response.data ?? MapUsersResponseData(users: [])
    }

    func getMapUserDetail(userID: String, lat: Double?, lng: Double?) async throws -> MapUser {
        var queryItems = [URLQueryItem]()
        if let lat {
            queryItems.append(URLQueryItem(name: "lat", value: "\(lat)"))
        }
        if let lng {
            queryItems.append(URLQueryItem(name: "lng", value: "\(lng)"))
        }

        let response: APIResponseWrapper<MapUserResponseData> = try await get(
            path: "/map/users/\(Self.pathComponent(userID))",
            queryItems: queryItems
        )
        guard let user = response.data?.user else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return user
    }

    func getMapFlightLayer(
        minLat: Double,
        minLng: Double,
        maxLat: Double,
        maxLng: Double,
        zoom: Int
    ) async throws -> MapFlightLayerResponseData {
        let queryItems = [
            URLQueryItem(name: "minLat", value: "\(minLat)"),
            URLQueryItem(name: "minLng", value: "\(minLng)"),
            URLQueryItem(name: "maxLat", value: "\(maxLat)"),
            URLQueryItem(name: "maxLng", value: "\(maxLng)"),
            URLQueryItem(name: "min_lat", value: "\(minLat)"),
            URLQueryItem(name: "min_lng", value: "\(minLng)"),
            URLQueryItem(name: "max_lat", value: "\(maxLat)"),
            URLQueryItem(name: "max_lng", value: "\(maxLng)"),
            URLQueryItem(name: "zoom", value: "\(zoom)")
        ]
        let response: MapFlightLayerRemoteResponse = try await get(
            path: "/map/flight-layer",
            queryItems: queryItems
        )
        return response.layer
    }

    func blockMapUser(userID: String) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/map/users/\(Self.pathComponent(userID))/block",
            body: [:]
        )
    }

    func unblockMapUser(userID: String) async throws {
        guard let url = URL(string: baseURL + "/map/users/\(Self.pathComponent(userID))/block") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        let _: APIResponseWrapper<EmptyData> = try await perform(request)
    }

    func reportMapUser(userID: String, reason: String, detail: String?) async throws {
        let allowedReasons = Set(MapReportReason.allCases.map(\.rawValue))
        guard allowedReasons.contains(reason) else {
            throw APIError.serverError(code: 400, message: L10n.tr("map.report.invalidReason"))
        }

        var body: [String: Any] = ["reason": reason]
        if let detail, !detail.isBlank {
            body["detail"] = detail
        }

        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/map/users/\(Self.pathComponent(userID))/report",
            body: body
        )
    }

    // MARK: - Groups

    func getGroups() async throws -> [ChatGroup] {
        struct GroupsData: Decodable {
            let groups: [ChatGroup]
        }

        let response: APIResponseWrapper<GroupsData> = try await get(path: "/groups/list")
        return response.data?.groups ?? []
    }

    func createGroup(name: String, memberIDs: [String], isPublic: Bool = false) async throws {
        let body: [String: Any] = [
            "name": name,
            "member_ids": memberIDs,
            "is_public": isPublic
        ]
        let _: APIResponseWrapper<EmptyData> = try await postJSON(path: "/groups/create", body: body)
    }

    func getGroupMessages(groupID: Int, beforeID: Int? = nil, afterID: Int? = nil, limit: Int = 30) async throws -> ([GroupMessage], Bool) {
        struct GroupMessagesData: Decodable {
            let messages: [GroupMessage]
            let hasMore: Bool

            enum CodingKeys: String, CodingKey {
                case messages
                case hasMore = "has_more"
            }
        }

        var queryItems = [URLQueryItem]()
        if let beforeID = beforeID {
            queryItems.append(URLQueryItem(name: "before_id", value: "\(beforeID)"))
        }
        if let afterID = afterID {
            queryItems.append(URLQueryItem(name: "after_id", value: "\(afterID)"))
        }
        queryItems.append(URLQueryItem(name: "limit", value: "\(limit)"))

        let response: APIResponseWrapper<GroupMessagesData> = try await get(
            path: "/groups/\(groupID)/messages",
            queryItems: queryItems
        )
        let data = response.data
        return (data?.messages ?? [], data?.hasMore ?? false)
    }

    func sendGroupText(
        groupID: Int,
        content: String,
        replyToID: Int? = nil,
        mentions: [String] = [],
        clientMessageID: String? = nil
    ) async throws -> GroupMessage {
        var body: [String: Any] = ["content": content]
        if let replyID = replyToID {
            body["reply_to_id"] = replyID
        }
        if !mentions.isEmpty {
            body["mentions"] = mentions
        }
        if let clientMessageID {
            body["client_message_id"] = clientMessageID
        }

        let response: APIResponseWrapper<GroupMessage> = try await postJSON(
            path: "/groups/\(groupID)/messages/text",
            body: body
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendGroupGift(groupID: Int, recipientID: String, giftID: String) async throws -> GroupMessage {
        let body: [String: Any] = [
            "recipient_id": recipientID,
            "receiver_id": recipientID,
            "gift_id": giftID
        ]
        let response: APIResponseWrapper<GiftGroupMessageResponseData> = try await postJSON(
            path: "/groups/\(groupID)/messages/gift",
            body: body
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return Self.normalizedGroupGiftMessage(
            data.message,
            groupID: groupID,
            recipientID: recipientID,
            giftID: giftID,
            fallbackContent: data.fallbackContent
        )
    }

    func sendGroupImage(groupID: Int, imageData: Data, filename: String) async throws -> GroupMessage {
        let compressed = Self.compressImageForUpload(imageData)
        let response: APIResponseWrapper<GroupMessage> = try await uploadImage(
            path: "/groups/\(groupID)/messages/image",
            fieldName: nil,
            fieldValue: nil,
            imageData: compressed,
            filename: filename
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendGroupVideo(groupID: Int, videoData: Data, filename: String) async throws -> GroupMessage {
        let response: APIResponseWrapper<GroupMessage> = try await uploadVideo(
            path: "/groups/\(groupID)/messages/video",
            fieldName: nil,
            fieldValue: nil,
            videoData: videoData,
            filename: filename
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendGroupVoice(groupID: Int, voiceData: Data, duration: Double, filename: String) async throws -> GroupMessage {
        guard let url = URL(string: baseURL + "/groups/\(groupID)/messages/voice") else { throw APIError.invalidURL }
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        addAuthHeader(&request)

        var body = Data()
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"duration\"\r\n\r\n\(String(format: "%.1f", duration))\r\n".data(using: .utf8)!)
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"voice\"; filename=\"\(filename)\"\r\nContent-Type: audio/m4a\r\n\r\n".data(using: .utf8)!)
        body.append(voiceData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let response: APIResponseWrapper<GroupMessage> = try await perform(request)
        guard let msg = response.data else { throw APIError.serverError(code: response.code, message: response.message) }
        return msg
    }

    func getGroupDetail(groupID: Int) async throws -> GroupDetail {
        let response: APIResponseWrapper<GroupDetail> = try await get(path: "/groups/\(groupID)")
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func addGroupMembers(groupID: Int, memberIDs: [String]) async throws {
        let body: [String: Any] = ["user_ids": memberIDs]
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/groups/\(groupID)/members/add",
            body: body
        )
    }

    func removeGroupMember(groupID: Int, userID: String) async throws {
        let body: [String: Any] = ["user_id": userID]
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/groups/\(groupID)/members/remove",
            body: body
        )
    }

    func renameGroup(groupID: Int, name: String) async throws {
        let body: [String: Any] = ["name": name]
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/groups/\(groupID)/rename",
            body: body
        )
    }

    func updateGroupVisibility(groupID: Int, isPublic: Bool) async throws {
        let body: [String: Any] = ["is_public": isPublic]
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/groups/\(groupID)/visibility",
            body: body
        )
    }

    func leaveGroup(groupID: Int) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/groups/\(groupID)/leave",
            body: [:]
        )
    }

    func dismissGroup(groupID: Int) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/groups/\(groupID)/dismiss",
            body: [:]
        )
    }

    // MARK: - Calls (LiveKit)

    func startCall(targetID: String, callType: String) async throws -> CallStartResponse {
        let body: [String: Any] = ["target_id": targetID, "call_type": callType]
        let response: APIResponseWrapper<CallStartResponse> = try await postJSON(path: "/call/start", body: body)
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func joinCall(roomName: String) async throws -> CallJoinResponse {
        let body: [String: Any] = ["room_name": roomName]
        let response: APIResponseWrapper<CallJoinResponse> = try await postJSON(path: "/call/join", body: body)
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func startGroupCall(groupID: Int, callType: String) async throws -> CallStartResponse {
        let body: [String: Any] = ["call_type": callType]
        let response: APIResponseWrapper<CallStartResponse> = try await postJSON(path: "/call/group/\(groupID)/start", body: body)
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func leaveGroupCall(groupID: Int) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(path: "/call/group/\(groupID)/leave", body: [:])
    }

    func getGroupCallStatus(groupID: Int) async throws -> GroupCallStatusResponse {
        let response: APIResponseWrapper<GroupCallStatusResponse> = try await get(path: "/call/group/\(groupID)/status")
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    // MARK: - Push

    func registerDeviceToken(_ token: String) async throws {
        let body = ["device_token": token]
        let _: APIResponseWrapper<EmptyData> = try await postJSON(path: "/push/device-token", body: body)
    }

    // MARK: - Profile

    func getMyProfile() async throws -> User {
        struct ProfileData: Decodable {
            let profile: User
        }
        let response: APIResponseWrapper<ProfileData> = try await get(path: "/profile/me")
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data.profile
    }

    func updateProfile(nickname: String? = nil, bio: String? = nil, gender: String? = nil, birthday: String? = nil, location: String? = nil) async throws -> User {
        struct ProfileData: Decodable {
            let profile: User
        }
        var body: [String: Any] = [:]
        if let nickname = nickname { body["nickname"] = nickname }
        if let bio = bio { body["bio"] = bio }
        if let gender = gender { body["gender"] = gender }
        if let birthday = birthday { body["birthday"] = birthday }
        if let location = location { body["location"] = location }

        let response: APIResponseWrapper<ProfileData> = try await putJSON(path: "/profile/me", body: body)
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data.profile
    }

    func updateUsername(_ username: String) async throws -> User {
        struct UsernameData: Decodable {
            let profile: User?
            let user: User?
        }
        let response: APIResponseWrapper<UsernameData> = try await putJSON(
            path: "/profile/username",
            body: ["username": username]
        )
        guard let updatedUser = response.data?.profile ?? response.data?.user else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return updatedUser
    }

    func uploadAvatar(imageData: Data, filename: String) async throws -> String {
        struct AvatarData: Decodable {
            let avatarUrl: String
            enum CodingKeys: String, CodingKey {
                case avatarUrl = "avatar_url"
            }
        }
        let response: APIResponseWrapper<AvatarData> = try await uploadImage(
            path: "/profile/avatar",
            fieldName: nil,
            fieldValue: nil,
            imageData: imageData,
            filename: filename
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data.avatarUrl
    }

    // MARK: - Follow

    func getPublicProfile(userID: String) async throws -> PublicProfile {
        let response: APIResponseWrapper<PublicProfile> = try await get(
            path: "/profile/public/\(Self.pathComponent(userID))"
        )
        guard let profile = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return profile
    }

    func followUser(userID: String) async throws -> FollowRelationship {
        let response: APIResponseWrapper<FollowRelationship> = try await postJSON(
            path: "/follows/\(Self.pathComponent(userID))",
            body: [:]
        )
        return response.data ?? FollowRelationship(userID: userID, followedByMe: true)
    }

    func unfollowUser(userID: String) async throws -> FollowRelationship {
        guard let url = URL(string: baseURL + "/follows/\(Self.pathComponent(userID))") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        let response: APIResponseWrapper<FollowRelationship> = try await perform(request)
        return response.data ?? FollowRelationship(userID: userID, followedByMe: false)
    }

    func getFollowRelationship(userID: String) async throws -> FollowRelationship {
        let response: APIResponseWrapper<FollowRelationship> = try await get(
            path: "/follows/\(Self.pathComponent(userID))/relationship"
        )
        return response.data ?? FollowRelationship(userID: userID, followedByMe: false)
    }

    func getFollowing(userID: String? = nil, page: Int = 1, limit: Int = 30) async throws -> FollowUsersPage {
        var queryItems = [
            URLQueryItem(name: "page", value: "\(page)"),
            URLQueryItem(name: "limit", value: "\(limit)")
        ]
        if let userID, !userID.isBlank {
            queryItems.append(URLQueryItem(name: "user_id", value: userID))
        }
        let response: APIResponseWrapper<FollowUsersPage> = try await get(
            path: "/follows/following",
            queryItems: queryItems
        )
        return response.data ?? FollowUsersPage(users: [], hasMore: false, nextPage: nil)
    }

    func getFollowers(userID: String? = nil, page: Int = 1, limit: Int = 30) async throws -> FollowUsersPage {
        var queryItems = [
            URLQueryItem(name: "page", value: "\(page)"),
            URLQueryItem(name: "limit", value: "\(limit)")
        ]
        if let userID, !userID.isBlank {
            queryItems.append(URLQueryItem(name: "user_id", value: userID))
        }
        let response: APIResponseWrapper<FollowUsersPage> = try await get(
            path: "/follows/followers",
            queryItems: queryItems
        )
        return response.data ?? FollowUsersPage(users: [], hasMore: false, nextPage: nil)
    }

    // MARK: - Chatbot Bots

    func getChatbotBots() async throws -> [BotConfig] {
        struct BotsData: Decodable {
            let bots: [BotConfig]

            enum CodingKeys: String, CodingKey {
                case bots
                case items
                case data
            }

            init(from decoder: Decoder) throws {
                if let list = try? [BotConfig](from: decoder) {
                    bots = list
                    return
                }

                let container = try decoder.container(keyedBy: CodingKeys.self)
                bots = try container.decodeIfPresent([BotConfig].self, forKey: .bots)
                    ?? container.decodeIfPresent([BotConfig].self, forKey: .items)
                    ?? container.decodeIfPresent([BotConfig].self, forKey: .data)
                    ?? []
            }
        }

        let response: APIResponseWrapper<BotsData> = try await get(path: "/chatbot/bots")
        return response.data?.bots ?? []
    }

    func getPublicChatbotBots(limit: Int = 60) async throws -> [BotConfig] {
        struct BotsData: Decodable {
            let bots: [BotConfig]

            enum CodingKeys: String, CodingKey {
                case bots
                case items
                case data
            }

            init(from decoder: Decoder) throws {
                if let list = try? [BotConfig](from: decoder) {
                    bots = list
                    return
                }

                let container = try decoder.container(keyedBy: CodingKeys.self)
                bots = try container.decodeIfPresent([BotConfig].self, forKey: .bots)
                    ?? container.decodeIfPresent([BotConfig].self, forKey: .items)
                    ?? container.decodeIfPresent([BotConfig].self, forKey: .data)
                    ?? []
            }
        }

        let response: APIResponseWrapper<BotsData> = try await get(
            path: "/chatbot/bots/public",
            queryItems: [URLQueryItem(name: "limit", value: "\(limit)")]
        )
        return response.data?.bots ?? []
    }

    func createChatbotBot(_ bot: BotConfig) async throws -> BotConfig {
        let response: APIResponseWrapper<ChatbotBotData> = try await postJSON(
            path: "/chatbot/bots",
            body: Self.chatbotBotBody(bot)
        )
        guard let bot = response.data?.bot else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return bot
    }

    func updateChatbotBot(_ bot: BotConfig) async throws -> BotConfig {
        let response: APIResponseWrapper<ChatbotBotData> = try await putJSON(
            path: "/chatbot/bots/\(Self.pathComponent(bot.id))",
            body: Self.chatbotBotBody(bot)
        )
        guard let updated = response.data?.bot else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return updated
    }

    func deleteChatbotBot(botID: String) async throws {
        guard let url = URL(string: baseURL + "/chatbot/bots/\(Self.pathComponent(botID))") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        let _: APIResponseWrapper<EmptyData> = try await perform(request)
    }

    func uploadBotAvatar(botID: String, imageData: Data, filename: String) async throws -> String {
        struct AvatarData: Decodable {
            let avatarUrl: String
            enum CodingKeys: String, CodingKey {
                case avatarUrl = "avatar_url"
            }
        }

        let compressed = Self.compressImageForUpload(imageData, maxDimension: 640, quality: 0.78, maxBytes: 500_000)
        let response: APIResponseWrapper<AvatarData> = try await uploadImage(
            path: "/chatbot/bots/\(Self.pathComponent(botID))/avatar",
            fieldName: nil,
            fieldValue: nil,
            imageData: compressed,
            filename: filename
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data.avatarUrl
    }

    func generateChatbotCharacterBackground(
        name: String,
        gender: String
    ) async throws -> String {
        var body: [String: Any] = [
            "gender": BotConfig.normalizedGender(gender)
        ]
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedName.isEmpty {
            body["name"] = trimmedName
        }

        let data = try await generateChatbotSetting(
            path: "/chatbot/bots/generate-character-background",
            body: body
        )
        return try Self.generatedText(
            data.characterBackgroundText,
            fallbackMessage: L10n.tr("bot.config.characterBackground.generateFailed")
        )
    }

    func generateChatbotOpeningLine(
        name: String,
        gender: String,
        characterBackground: String?
    ) async throws -> String {
        var body: [String: Any] = [
            "gender": BotConfig.normalizedGender(gender)
        ]
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedName.isEmpty {
            body["name"] = trimmedName
        }
        if let characterBackground,
           !characterBackground.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["character_background"] = characterBackground
        }

        let data = try await generateChatbotSetting(
            path: "/chatbot/bots/generate-opening-line",
            body: body
        )
        return try Self.generatedText(
            data.openingLineText,
            fallbackMessage: L10n.tr("bot.config.openingLine.generateFailed")
        )
    }

    private func generateChatbotSetting(
        path: String,
        body: [String: Any]
    ) async throws -> ChatbotGeneratedSettingData {
        let response: APIResponseWrapper<ChatbotGeneratedSettingData> = try await postJSON(
            path: path,
            body: body
        )
        if response.code != 0 {
            print("[ChatbotGenerate] \(path) code=\(response.code) message=\(response.message)")
        }
        guard let data = response.data else {
            print("[ChatbotGenerate] \(path) missing data code=\(response.code) message=\(response.message)")
            throw APIError.serverError(code: response.code, message: response.message)
        }
        if data.isEmpty {
            print("[ChatbotGenerate] \(path) empty generated text: \(data.debugSummary)")
        }
        return data
    }

    private struct ChatbotBotData: Decodable {
        let bot: BotConfig?

        enum CodingKeys: String, CodingKey {
            case bot
            case item
            case data
            case id
            case botID = "bot_id"
            case name
            case displayName = "display_name"
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            if let bot = try container.decodeIfPresent(BotConfig.self, forKey: .bot) {
                self.bot = bot
                return
            }
            if let bot = try container.decodeIfPresent(BotConfig.self, forKey: .item) {
                self.bot = bot
                return
            }
            if let bot = try container.decodeIfPresent(BotConfig.self, forKey: .data) {
                self.bot = bot
                return
            }
            if container.contains(.id)
                || container.contains(.botID)
                || container.contains(.name)
                || container.contains(.displayName) {
                self.bot = try BotConfig(from: decoder)
                return
            }
            self.bot = nil
        }
    }

    private struct ChatbotGeneratedSettingData: Decodable {
        let characterBackground: String?
        let openingLine: String?
        let text: String?
        let content: String?
        let result: String?
        let generatedText: String?
        let value: String?
        let output: String?
        let background: String?
        let persona: String?
        let opening: String?
        let line: String?
        let nested: [ChatbotGeneratedSettingData]

        enum CodingKeys: String, CodingKey {
            case characterBackground = "character_background"
            case characterBackgroundCamel = "characterBackground"
            case openingLine = "opening_line"
            case openingLineCamel = "openingLine"
            case text
            case content
            case result
            case generated
            case generatedText = "generated_text"
            case generatedTextCamel = "generatedText"
            case value
            case output
            case background
            case persona
            case opening
            case line
            case payload
            case data
        }

        init(from decoder: Decoder) throws {
            if let container = try? decoder.singleValueContainer(),
               let value = try? container.decode(String.self) {
                characterBackground = nil
                openingLine = nil
                text = value
                content = nil
                result = nil
                generatedText = nil
                self.value = nil
                output = nil
                background = nil
                persona = nil
                opening = nil
                line = nil
                nested = []
                return
            }

            let container = try decoder.container(keyedBy: CodingKeys.self)
            characterBackground = Self.decodeString(
                from: container,
                keys: [.characterBackground, .characterBackgroundCamel]
            )
            openingLine = Self.decodeString(
                from: container,
                keys: [.openingLine, .openingLineCamel]
            )
            text = Self.decodeString(from: container, keys: [.text])
            content = Self.decodeString(from: container, keys: [.content])
            result = Self.decodeString(from: container, keys: [.result, .generated])
            generatedText = Self.decodeString(from: container, keys: [.generatedText, .generatedTextCamel])
            value = Self.decodeString(from: container, keys: [.value])
            output = Self.decodeString(from: container, keys: [.output])
            background = Self.decodeString(from: container, keys: [.background])
            persona = Self.decodeString(from: container, keys: [.persona])
            opening = Self.decodeString(from: container, keys: [.opening])
            line = Self.decodeString(from: container, keys: [.line])

            nested = [.data, .payload, .result, .generated].compactMap { key in
                try? container.decode(ChatbotGeneratedSettingData.self, forKey: key)
            }
        }

        var characterBackgroundText: String? {
            Self.firstNonBlank(
                characterBackground,
                background,
                persona,
                text,
                content,
                result,
                generatedText,
                value,
                output,
                nested.compactMap(\.characterBackgroundText).first
            )
        }

        var openingLineText: String? {
            Self.firstNonBlank(
                openingLine,
                opening,
                line,
                text,
                content,
                result,
                generatedText,
                value,
                output,
                nested.compactMap(\.openingLineText).first
            )
        }

        var isEmpty: Bool {
            characterBackgroundText == nil && openingLineText == nil
        }

        var debugSummary: String {
            let fields = [
                "character_background": characterBackground,
                "opening_line": openingLine,
                "text": text,
                "content": content,
                "result": result,
                "generated_text": generatedText,
                "value": value,
                "output": output,
                "background": background,
                "persona": persona,
                "opening": opening,
                "line": line
            ]
            let nonEmpty = fields.compactMap { key, value -> String? in
                guard let text = Self.sanitized(value) else { return nil }
                return "\(key)=\(String(text.prefix(40)))"
            }
            if !nonEmpty.isEmpty {
                return nonEmpty.joined(separator: ", ")
            }
            return "no known text fields, nested=\(nested.count)"
        }

        private static func decodeString(
            from container: KeyedDecodingContainer<CodingKeys>,
            keys: [CodingKeys]
        ) -> String? {
            for key in keys {
                if let value = try? container.decodeIfPresent(String.self, forKey: key),
                   let sanitized = sanitized(value) {
                    return sanitized
                }
            }
            return nil
        }

        private static func firstNonBlank(_ values: String?...) -> String? {
            for value in values {
                if let sanitized = sanitized(value) {
                    return sanitized
                }
            }
            return nil
        }

        private static func sanitized(_ value: String?) -> String? {
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !trimmed.isEmpty else { return nil }
            guard trimmed.lowercased() != "success" else { return nil }
            return trimmed
        }
    }

    private static func generatedText(_ value: String?, fallbackMessage: String) throws -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else {
            throw APIError.serverError(code: 2002, message: fallbackMessage)
        }
        return trimmed
    }

    private static func chatbotBotBody(_ bot: BotConfig) -> [String: Any] {
        let name = bot.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let emoji = bot.emoji.trimmingCharacters(in: .whitespacesAndNewlines)
        let sourceBotID = bot.sourceBotID.trimmingCharacters(in: .whitespacesAndNewlines)
        let originBotID = bot.originBotID.trimmingCharacters(in: .whitespacesAndNewlines)
        var body: [String: Any] = [
            "name": name.isEmpty ? L10n.tr("bot.label") : name,
            "emoji": emoji.isEmpty ? "🤖" : emoji,
            "gender": BotConfig.normalizedGender(bot.gender),
            "character_background": bot.characterBackground
                .trimmingCharacters(in: .whitespacesAndNewlines),
            "opening_line": bot.openingLine
                .trimmingCharacters(in: .whitespacesAndNewlines),
            "avatar_url": bot.avatarURL,
            "is_public": bot.isPublic
        ]
        if !sourceBotID.isEmpty {
            body["source_bot_id"] = sourceBotID
        }
        if !originBotID.isEmpty {
            body["origin_bot_id"] = originBotID
        } else if !sourceBotID.isEmpty {
            body["origin_bot_id"] = sourceBotID
        }
        return body
    }

    // MARK: - Chat Appearance

    func getChatBackgrounds() async throws -> [ChatBackground] {
        struct BackgroundsData: Decodable {
            let backgrounds: [ChatBackground]
        }

        let response: APIResponseWrapper<BackgroundsData> = try await get(path: "/chat/backgrounds")
        return response.data?.backgrounds ?? []
    }

    func uploadChatBackground(
        targetType: ChatBackgroundTargetType,
        targetID: String,
        imageData: Data,
        filename: String
    ) async throws -> (background: ChatBackground?, imageData: Data) {
        struct BackgroundUploadData: Decodable {
            let background: ChatBackground?
            let imageURL: String?

            enum CodingKeys: String, CodingKey {
                case background
                case imageURL = "image_url"
            }
        }

        let compressed = Self.compressBackgroundImageForUpload(imageData)
        let response: APIResponseWrapper<BackgroundUploadData> = try await uploadImage(
            path: "/chat/backgrounds/\(targetType.rawValue)/\(Self.pathComponent(targetID))",
            fieldName: nil,
            fieldValue: nil,
            imageData: compressed,
            filename: filename
        )
        if let background = response.data?.background {
            return (background, compressed)
        }
        if let imageURL = response.data?.imageURL {
            return (ChatBackground(
                targetType: targetType,
                targetID: targetID,
                imageURL: imageURL,
                updatedAt: nil
            ), compressed)
        }
        return (nil, compressed)
    }

    func deleteChatBackground(targetType: ChatBackgroundTargetType, targetID: String) async throws {
        guard let url = URL(
            string: baseURL + "/chat/backgrounds/\(targetType.rawValue)/\(Self.pathComponent(targetID))"
        ) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        let _: APIResponseWrapper<EmptyData> = try await perform(request)
    }

    // MARK: - Wallet

    func getWalletBalance() async throws -> WalletBalanceResponseData {
        let response: APIResponseWrapper<WalletBalanceResponseData> = try await get(path: "/wallet/balance")
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func getWalletTransactions() async throws -> [WalletTransaction] {
        let response: APIResponseWrapper<WalletTransactionsResponseData> = try await get(path: "/wallet/transactions")
        return response.data?.transactions ?? []
    }

    func confirmWalletIAPPurchase(
        productID: String,
        transactionID: String,
        originalTransactionID: String,
        signedPayload: String,
        purchaseDate: Date,
        appAccountToken: String?
    ) async throws -> WalletIAPConfirmationResponseData {
        var body: [String: Any] = [
            "platform": "ios",
            "product_id": productID,
            "transaction_id": transactionID,
            "original_transaction_id": originalTransactionID,
            "signed_payload": signedPayload,
            "signed_transaction_info": signedPayload,
            "purchase_date": Self.iso8601Formatter.string(from: purchaseDate),
            "bundle_id": Bundle.main.bundleIdentifier ?? ""
        ]
        if let appAccountToken {
            body["app_account_token"] = appAccountToken
        }

        let response: APIResponseWrapper<WalletIAPConfirmationResponseData> = try await postJSON(
            path: "/wallet/ios-iap/confirm",
            body: body
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func createWalletWithdrawal(
        amount: Int,
        usdtAmount: String? = nil,
        payoutMethod: String? = nil,
        payoutAccount: String? = nil,
        network: String? = nil,
        walletAddress: String? = nil
    ) async throws -> WalletWithdrawal? {
        var body: [String: Any] = ["amount": amount]
        if let usdtAmount {
            body["usdt_amount"] = usdtAmount
        }
        if let payoutMethod {
            body["payout_method"] = payoutMethod
        }
        if let payoutAccount {
            body["payout_account"] = payoutAccount
        }
        if let network {
            body["network"] = network
        }
        if let walletAddress {
            body["wallet_address"] = walletAddress
        }
        let response: APIResponseWrapper<WalletWithdrawalResponseData> = try await postJSON(
            path: "/wallet/withdrawals",
            body: body
        )
        return response.data?.withdrawal
    }

    func getWalletWithdrawals() async throws -> [WalletWithdrawal] {
        let response: APIResponseWrapper<WalletWithdrawalsResponseData> = try await get(path: "/wallet/withdrawals")
        return response.data?.withdrawals ?? []
    }

    func cancelWalletWithdrawal(id: String) async throws -> WalletWithdrawal? {
        let response: APIResponseWrapper<WalletWithdrawalResponseData> = try await postJSON(
            path: "/wallet/withdrawals/\(Self.pathComponent(id))/cancel",
            body: [:]
        )
        return response.data?.withdrawal
    }

    // MARK: - Image Loading

    func loadImage(path: String) async throws -> Data {
        let urlString: String
        if path.hasPrefix("http") {
            urlString = path
        } else if path.hasPrefix("/api/v1/") {
            urlString = baseURL.replacingOccurrences(of: "/api/v1", with: "") + path
        } else if path.hasPrefix("/") {
            urlString = baseURL + path
        } else {
            urlString = baseURL + "/" + path
        }

        guard let url = URL(string: urlString) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        if let token = AuthManager.shared.token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw APIError.invalidResponse
        }
        return data
    }

    /// Authenticated GET for images, videos, or any media path (same URL rules as `loadImage`).
    func loadAuthenticatedMedia(path: String) async throws -> Data {
        try await loadImage(path: path)
    }

    // MARK: - Image Compression

    nonisolated static func compressImageForUpload(
        _ data: Data,
        maxDimension: CGFloat = 1200,
        quality: CGFloat = 0.7,
        maxBytes: Int = 2_000_000
    ) -> Data {
        guard let image = UIImage(data: data) else { return data }
        let minDimension = min(maxDimension, 640)
        var currentMaxDimension = maxDimension
        var bestData: Data?

        while true {
            let resized = resizedImage(image, maxDimension: currentMaxDimension)
            let qualitySteps = [quality, 0.65, 0.55, 0.45, 0.35]
                .map { min(max($0, 0.1), 1.0) }
                .reduce(into: [CGFloat]()) { result, value in
                    if !result.contains(value) {
                        result.append(value)
                    }
                }

            for step in qualitySteps {
                guard let compressed = resized.jpegData(compressionQuality: step) else { continue }
                bestData = compressed
                if compressed.count <= maxBytes {
                    print("[APIService] Image compressed: \(data.count / 1024)KB -> \(compressed.count / 1024)KB")
                    return compressed
                }
            }

            guard currentMaxDimension > minDimension else { break }
            currentMaxDimension = max(minDimension, currentMaxDimension * 0.75)
        }

        if let bestData {
            print("[APIService] Image compressed: \(data.count / 1024)KB -> \(bestData.count / 1024)KB")
            return bestData
        }
        return data
    }

    nonisolated static func compressBackgroundImageForUpload(_ data: Data) -> Data {
        compressImageForUpload(data, maxDimension: 1280, quality: 0.72, maxBytes: 900_000)
    }

    nonisolated private static func resizedImage(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let width = image.size.width
        let height = image.size.height
        guard max(width, height) > maxDimension else { return image }

        let ratio = maxDimension / max(width, height)
        let newSize = CGSize(width: width * ratio, height: height * ratio)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: newSize, format: format)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }

    private static func pathComponent(_ raw: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return raw.addingPercentEncoding(withAllowedCharacters: allowed) ?? raw
    }

    // MARK: - Private Helpers

    private func get<T: Decodable>(
        path: String,
        queryItems: [URLQueryItem] = []
    ) async throws -> T {
        guard var components = URLComponents(string: baseURL + path) else {
            throw APIError.invalidURL
        }
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        addAuthHeader(&request)

        return try await perform(request)
    }

    private func postJSON<T: Decodable>(
        path: String,
        body: [String: Any],
        auth: Bool = true
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        if auth {
            addAuthHeader(&request)
        }

        // For unauthenticated endpoints (login, refresh) a 401 is genuine —
        // trying to "fix" it by running attemptTokenRefresh would recurse
        // into the same endpoint and deadlock on `isRefreshing`. Only let
        // authenticated requests go through the retry-with-refresh path.
        return try await perform(request, allowRetry: auth, logoutOnUnauthorized: auth)
    }

    private func putJSON<T: Decodable>(
        path: String,
        body: [String: Any],
        auth: Bool = true
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        if auth {
            addAuthHeader(&request)
        }

        return try await perform(request, allowRetry: auth, logoutOnUnauthorized: auth)
    }

    private func uploadImage<T: Decodable>(
        path: String,
        fieldName: String?,
        fieldValue: String?,
        imageData: Data,
        filename: String
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 90
        addAuthHeader(&request)

        var body = Data()
        // Optional extra field (e.g. receiver_id for DM images)
        if let fieldName = fieldName, let fieldValue = fieldValue {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(fieldName)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(fieldValue)\r\n".data(using: .utf8)!)
        }
        // image field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"image\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n".data(using: .utf8)!)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body
        print("[APIService] Upload image \(path): \(body.count / 1024)KB")

        return try await perform(request)
    }

    private func uploadVideo<T: Decodable>(
        path: String,
        fieldName: String?,
        fieldValue: String?,
        videoData: Data,
        filename: String
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 600
        addAuthHeader(&request)

        var body = Data()
        if let fieldName = fieldName, let fieldValue = fieldValue {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(fieldName)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(fieldValue)\r\n".data(using: .utf8)!)
        }
        let ext = (filename as NSString).pathExtension.lowercased()
        let mimeType: String
        switch ext {
        case "mov": mimeType = "video/quicktime"
        case "m4v": mimeType = "video/x-m4v"
        default: mimeType = "video/mp4"
        }
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"video\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(videoData)
        body.append("\r\n".data(using: .utf8)!)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        return try await perform(request)
    }

    // MARK: - Short Drama

    func getShortDramaFeed(cursor: String? = nil, limit: Int = 12) async throws -> ShortDramaFeedPage {
        var queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }

        let response: APIResponseWrapper<ShortDramaFeedPage> = try await get(
            path: "/short-drama/feed",
            queryItems: queryItems
        )
        return response.data ?? ShortDramaFeedPage(videos: [], hasMore: false, nextCursor: nil)
    }

    func setShortDramaLiked(videoID: String, liked: Bool) async throws -> ShortDramaInteractionResult {
        let path = "/short-drama/videos/\(Self.pathComponent(videoID))/like"
        if liked {
            let response: APIResponseWrapper<ShortDramaInteractionResult> = try await postJSON(path: path, body: [:])
            return response.data ?? ShortDramaInteractionResult(liked: true, favorited: nil, likeCount: nil, favoriteCount: nil)
        }

        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        let response: APIResponseWrapper<ShortDramaInteractionResult> = try await perform(request)
        return response.data ?? ShortDramaInteractionResult(liked: false, favorited: nil, likeCount: nil, favoriteCount: nil)
    }

    func setShortDramaFavorited(videoID: String, favorited: Bool) async throws -> ShortDramaInteractionResult {
        let path = "/short-drama/videos/\(Self.pathComponent(videoID))/favorite"
        if favorited {
            let response: APIResponseWrapper<ShortDramaInteractionResult> = try await postJSON(path: path, body: [:])
            return response.data ?? ShortDramaInteractionResult(liked: nil, favorited: true, likeCount: nil, favoriteCount: nil)
        }

        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        let response: APIResponseWrapper<ShortDramaInteractionResult> = try await perform(request)
        return response.data ?? ShortDramaInteractionResult(liked: nil, favorited: false, likeCount: nil, favoriteCount: nil)
    }

    func getShortDramaComments(
        videoID: String,
        cursor: String? = nil,
        limit: Int = 30
    ) async throws -> ShortDramaCommentsPage {
        var queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        let response: APIResponseWrapper<ShortDramaCommentsPage> = try await get(
            path: "/short-drama/videos/\(Self.pathComponent(videoID))/comments",
            queryItems: queryItems
        )
        return response.data ?? ShortDramaCommentsPage(comments: [], hasMore: false, nextCursor: nil)
    }

    func sendShortDramaComment(videoID: String, content: String) async throws -> ShortDramaComment {
        let response: APIResponseWrapper<ShortDramaComment> = try await postJSON(
            path: "/short-drama/videos/\(Self.pathComponent(videoID))/comments",
            body: ["content": content]
        )
        guard let comment = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return comment
    }

    func reportShortDramaProgress(
        videoID: String,
        positionSeconds: Double,
        durationSeconds: Double?
    ) async throws {
        var body: [String: Any] = [
            "position_seconds": max(0, positionSeconds)
        ]
        if let durationSeconds, durationSeconds > 0 {
            body["duration_seconds"] = durationSeconds
        }

        guard let url = URL(string: baseURL + "/short-drama/videos/\(Self.pathComponent(videoID))/progress") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 4
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        addAuthHeader(&request)

        let _: APIResponseWrapper<EmptyData> = try await perform(request)
    }

    // MARK: - Moments

    func getMomentsFeed(beforeID: Int? = nil, limit: Int = 20) async throws -> ([Moment], Bool) {
        struct FeedData: Decodable {
            let moments: [Moment]
            let hasMore: Bool
            enum CodingKeys: String, CodingKey {
                case moments
                case hasMore = "has_more"
            }
        }

        var path = "/moments/feed?limit=\(limit)"
        if let bid = beforeID { path += "&before_id=\(bid)" }
        let response: APIResponseWrapper<FeedData> = try await get(path: path)
        return (response.data?.moments ?? [], response.data?.hasMore ?? false)
    }

    func getMomentsWorld(beforeID: Int? = nil, limit: Int = 20) async throws -> ([Moment], Bool) {
        struct FeedData: Decodable {
            let moments: [Moment]
            let hasMore: Bool
            enum CodingKeys: String, CodingKey {
                case moments
                case hasMore = "has_more"
            }
        }

        var path = "/moments/world?limit=\(limit)"
        if let bid = beforeID { path += "&before_id=\(bid)" }
        let response: APIResponseWrapper<FeedData> = try await get(path: path)
        return (response.data?.moments ?? [], response.data?.hasMore ?? false)
    }

    func createMoment(content: String, imageDataList: [(Data, String)]) async throws -> Moment {
        let mediaDataList = imageDataList.map {
            MomentUploadMedia(kind: .image, data: $0.0, filename: $0.1, mimeType: "image/jpeg")
        }
        return try await createMoment(
            content: content,
            mediaDataList: mediaDataList,
            unlockPriceCatFood: nil
        )
    }

    func createMoment(
        content: String,
        mediaDataList: [MomentUploadMedia],
        unlockPriceCatFood: Int?
    ) async throws -> Moment {
        guard let url = URL(string: baseURL + "/moments/create") else {
            throw APIError.invalidURL
        }
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = mediaDataList.contains { $0.kind == .video } ? 600 : 180
        addAuthHeader(&request)

        let body = await Self.momentMultipartBody(
            boundary: boundary,
            content: content,
            mediaDataList: mediaDataList,
            unlockPriceCatFood: unlockPriceCatFood
        )

        let response: APIResponseWrapper<Moment> = try await performUpload(request, body: body)
        guard let moment = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return moment
    }

    nonisolated private static func momentMultipartBody(
        boundary: String,
        content: String,
        mediaDataList: [MomentUploadMedia],
        unlockPriceCatFood: Int?
    ) async -> Data {
        await Task.detached(priority: .utility) {
            var body = Data()
            appendMomentTextField(name: "content", value: content, boundary: boundary, to: &body)

            if let unlockPriceCatFood, unlockPriceCatFood > 0 {
                appendMomentTextField(
                    name: "unlock_price_cat_food",
                    value: "\(unlockPriceCatFood)",
                    boundary: boundary,
                    to: &body
                )
            }

            for media in mediaDataList.prefix(9) {
                appendMomentMediaField(media, boundary: boundary, to: &body)
            }

            body.append("--\(boundary)--\r\n".data(using: .utf8)!)
            return body
        }.value
    }

    nonisolated private static func appendMomentTextField(
        name: String,
        value: String,
        boundary: String,
        to body: inout Data
    ) {
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(value)\r\n".data(using: .utf8)!)
    }

    nonisolated private static func appendMomentMediaField(
        _ media: MomentUploadMedia,
        boundary: String,
        to body: inout Data
    ) {
        let uploadData = preparedMomentUploadData(media)
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"media\"; filename=\"\(media.filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(media.mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(uploadData)
        body.append("\r\n".data(using: .utf8)!)
    }

    nonisolated private static func preparedMomentUploadData(_ media: MomentUploadMedia) -> Data {
        guard media.kind == .image else {
            return media.data
        }
        guard media.data.count > 2_000_000 else {
            return media.data
        }
        return compressImageForUpload(media.data)
    }

    func unlockMoment(momentID: Int) async throws -> MomentUnlockResponseData {
        let response: APIResponseWrapper<MomentUnlockResponseData> = try await postJSON(
            path: "/moments/\(momentID)/unlock",
            body: [:] as [String: String]
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func getUserMoments(userID: String, limit: Int = 20, beforeID: Int? = nil) async throws -> ([Moment], Bool) {
        struct FeedData: Decodable {
            let moments: [Moment]
            let hasMore: Bool
            enum CodingKeys: String, CodingKey {
                case moments
                case hasMore = "has_more"
            }
        }

        var path = "/moments/user/\(userID)?limit=\(limit)"
        if let bid = beforeID { path += "&before_id=\(bid)" }
        let response: APIResponseWrapper<FeedData> = try await get(path: path)
        return (response.data?.moments ?? [], response.data?.hasMore ?? false)
    }

    func toggleMomentLike(momentID: Int) async throws -> Bool {
        struct LikeData: Decodable { let liked: Bool }
        let response: APIResponseWrapper<LikeData> = try await postJSON(path: "/moments/\(momentID)/like", body: [:] as [String: String])
        return response.data?.liked ?? false
    }

    func addMomentComment(momentID: Int, content: String, replyToUserID: String? = nil, imageData: Data? = nil) async throws -> MomentComment {
        guard let url = URL(string: baseURL + "/moments/\(momentID)/comment") else {
            throw APIError.invalidURL
        }
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        addAuthHeader(&request)

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"content\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(content)\r\n".data(using: .utf8)!)

        if let rid = replyToUserID {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"reply_to_user_id\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(rid)\r\n".data(using: .utf8)!)
        }

        if let imgData = imageData {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"image\"; filename=\"comment.jpg\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
            body.append(imgData)
            body.append("\r\n".data(using: .utf8)!)
        }

        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let response: APIResponseWrapper<MomentComment> = try await perform(request)
        guard let comment = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return comment
    }

    func deleteMoment(momentID: Int) async throws {
        guard let url = URL(string: baseURL + "/moments/\(momentID)") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        let _: APIResponseWrapper<EmptyData> = try await perform(request)
    }

    func getMomentsUnreadInfo() async throws -> (unreadCount: Int, hasNewMoments: Bool) {
        struct UnreadData: Decodable {
            let unreadCount: Int
            let hasNewMoments: Bool
            enum CodingKeys: String, CodingKey {
                case unreadCount = "unread_count"
                case hasNewMoments = "has_new_moments"
            }
        }
        let response: APIResponseWrapper<UnreadData> = try await get(path: "/moments/notifications/unread")
        let data = response.data
        return (data?.unreadCount ?? 0, data?.hasNewMoments ?? false)
    }

    func getMomentsNotifications(limit: Int = 50) async throws -> [MomentsNotification] {
        struct NotifData: Decodable {
            let notifications: [MomentsNotification]
        }
        let response: APIResponseWrapper<NotifData> = try await get(path: "/moments/notifications/list?limit=\(limit)")
        return response.data?.notifications ?? []
    }

    func markMomentsNotificationsRead() async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(path: "/moments/notifications/read", body: [:] as [String: String])
    }

    func markMomentsFeedViewed() async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(path: "/moments/feed/viewed", body: [:] as [String: String])
    }

    func getMomentDetail(momentID: Int) async throws -> Moment {
        let response: APIResponseWrapper<Moment> = try await get(path: "/moments/detail/\(momentID)")
        guard let moment = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return moment
    }

    private struct EmptyData: Decodable {}

    private func addAuthHeader(_ request: inout URLRequest) {
        if let token = AuthManager.shared.token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    private func perform<T: Decodable>(
        _ request: URLRequest,
        allowRetry: Bool = true,
        logoutOnUnauthorized: Bool = true
    ) async throws -> T {
        try await performTransport(
            request,
            allowRetry: allowRetry,
            logoutOnUnauthorized: logoutOnUnauthorized
        ) { request in
            try await self.session.data(for: request)
        }
    }

    private func performUpload<T: Decodable>(
        _ request: URLRequest,
        body: Data,
        allowRetry: Bool = true,
        logoutOnUnauthorized: Bool = true
    ) async throws -> T {
        try await performTransport(
            request,
            allowRetry: allowRetry,
            logoutOnUnauthorized: logoutOnUnauthorized
        ) { request in
            try await self.session.upload(for: request, from: body)
        }
    }

    private func performTransport<T: Decodable>(
        _ request: URLRequest,
        allowRetry: Bool,
        logoutOnUnauthorized: Bool,
        operation: @escaping (URLRequest) async throws -> (Data, URLResponse)
    ) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await operation(request)
        } catch {
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode == 401 && allowRetry {
            // Try to refresh the token and retry the request once.
            do {
                try await attemptTokenRefresh()
            } catch APIError.unauthorized {
                // Refresh token was DEFINITIVELY rejected by the server
                // (status 401 from /auth/refresh — token expired,
                // blacklisted, or signature mismatch). Only NOW logout.
                AuthManager.shared.logout()
                throw APIError.unauthorized
            } catch {
                // Refresh failed for a non-auth reason (network blip,
                // server 5xx, JSON decode error, timeout). Tokens are
                // probably still valid — bouncing the user to LoginView
                // this is the bug behind being unexpectedly asked to log in again later:
                // momentary connectivity issues during a 401-triggered
                // refresh would nuke the session permanently. Re-throw
                // the underlying error so the caller can render a
                // transient-failure state and the next attempt can
                // succeed normally.
                throw error
            }
            // Rebuild request with new token
            var retryRequest = request
            if let newToken = AuthManager.shared.token {
                retryRequest.setValue("Bearer \(newToken)", forHTTPHeaderField: "Authorization")
            }
            return try await performTransport(
                retryRequest,
                allowRetry: false,
                logoutOnUnauthorized: logoutOnUnauthorized,
                operation: operation
            )
        }

        if httpResponse.statusCode == 401 {
            if logoutOnUnauthorized {
                AuthManager.shared.logout()
            }
            throw APIError.unauthorized
        }

        if !(200..<300).contains(httpResponse.statusCode) {
            let decoder = JSONDecoder()
            let fallback = HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            let message: String
            if let detailResponse = try? decoder.decode(DetailErrorResponse.self, from: data),
               let detailMessage = detailResponse.detail?.message,
               !detailMessage.isEmpty {
                message = detailMessage
            } else if let errorResponse = try? decoder.decode(APIResponseWrapper<EmptyData>.self, from: data) {
                message = errorResponse.message
            } else if let body = String(data: data, encoding: .utf8), !body.isEmpty {
                message = String(body.prefix(240))
            } else {
                message = fallback
            }
            print("[APIService] HTTP \(httpResponse.statusCode) \(request.url?.path ?? ""): \(message)")
            throw APIError.serverError(code: httpResponse.statusCode, message: message)
        }

        do {
            let decoder = JSONDecoder()
            return try decoder.decode(T.self, from: data)
        } catch {
            if request.url?.path.contains("/chatbot/bots/generate") == true {
                let body = String(data: data, encoding: .utf8) ?? "<non-utf8 body>"
                print("[APIService] Decode error \(request.url?.path ?? ""): \(error). body=\(String(body.prefix(800)))")
            }
            throw APIError.decodingError(error)
        }
    }
}
