// BWChat/Services/APIService.swift
// HTTP API service using URLSession

import Foundation
import UIKit

enum AuthRequestAuthorizer {
    /// The only place in the client that constructs an HTTP Authorization
    /// value. `setValue` replaces any stale header, so refresh retries can
    /// never retain the previous access token or add a second Bearer prefix.
    @discardableResult
    static func addAuthHeader(_ request: inout URLRequest, token rawToken: String?) -> Bool {
        guard let token = AuthTokenNormalizer.normalize(rawToken) else {
            request.setValue(nil, forHTTPHeaderField: "Authorization")
            return false
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return true
    }

    static func logFinalRequest(_ request: URLRequest, expectsAuthorization: Bool) {
        #if DEBUG
        let value = request.value(forHTTPHeaderField: "Authorization")?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let hasBearerScheme = value?.lowercased().hasPrefix("bearer ") == true
        let token = hasBearerScheme ? AuthTokenNormalizer.normalize(value) : nil
        let metadata = AuthTokenDiagnostics.metadata(for: token)
        print(
            "[AuthRequest] final method=\(request.httpMethod ?? "GET") path=\(request.url?.path ?? "") "
                + "expected=\(expectsAuthorization) present=\(value != nil) bearer=\(hasBearerScheme) "
                + "token_length=\(metadata.length) sha256=\(metadata.sha256Prefix)"
        )
        #endif
    }
}

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
        case .serverError(let code, let message):
            // Gateway/proxy bodies are often raw HTML (for example "502 Bad Gateway").
            // Keep that detail in diagnostics, but never surface infrastructure text in UI.
            return (500...599).contains(code) ? L10n.tr("api.serverUnavailable") : message
        case .networkError: return L10n.tr("api.networkUnavailable")
        case .decodingError: return L10n.tr("api.decodingError")
        }
    }
}

enum TransientHTTPRetryPolicy {
    static let maximumRetryCount = 2
    private static let retryableStatusCodes: Set<Int> = [408, 425, 429, 500, 502, 503, 504]
    private static let retryableURLErrorCodes: Set<URLError.Code> = [
        .timedOut,
        .cannotFindHost,
        .cannotConnectToHost,
        .dnsLookupFailed,
        .networkConnectionLost,
        .notConnectedToInternet
    ]

    static func shouldRetry(method: String?, statusCode: Int, retryCount: Int) -> Bool {
        guard retryCount < maximumRetryCount else { return false }
        guard retryableStatusCodes.contains(statusCode) else { return false }
        return isIdempotent(method: method)
    }

    static func shouldRetry(method: String?, error: Error, retryCount: Int) -> Bool {
        guard retryCount < maximumRetryCount else { return false }
        guard let urlError = error as? URLError,
              retryableURLErrorCodes.contains(urlError.code) else { return false }
        return isIdempotent(method: method)
    }

    static func isCancellation(_ error: Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled
    }

    private static func isIdempotent(method: String?) -> Bool {
        switch method?.uppercased() {
        case "GET", "HEAD": return true
        default: return false
        }
    }

    static func delayNanoseconds(response: HTTPURLResponse, retryCount: Int) -> UInt64 {
        if let retryAfter = response.value(forHTTPHeaderField: "Retry-After"),
           let seconds = Double(retryAfter),
           seconds >= 0 {
            return UInt64(min(seconds, 2) * 1_000_000_000)
        }
        let delays: [UInt64] = [350_000_000, 900_000_000]
        return delays[min(retryCount, delays.count - 1)]
    }
}

struct APIResponseWrapper<T: Decodable>: Decodable {
    let code: Int
    let message: String
    let data: T?

    func requiredData() throws -> T {
        guard let data else {
            throw APIError.serverError(
                code: code,
                message: message.isBlank ? L10n.tr("api.invalidResponse") : message
            )
        }
        return data
    }
}

struct AgentSummaryRemoteResponse: Decodable {
    private struct Container: Decodable {
        let agent: AgentSummary?
        let draft: AgentSummary?
        let item: AgentSummary?
    }

    let code: Int
    let message: String
    let agent: AgentSummary?

    private enum CodingKeys: String, CodingKey {
        case code, message, data, agent, draft, item
    }

    init(from decoder: Decoder) throws {
        let container = try? decoder.container(keyedBy: CodingKeys.self)
        code = (try? container?.decodeIfPresent(Int.self, forKey: .code)) ?? 0
        message = (try? container?.decodeIfPresent(String.self, forKey: .message)) ?? ""

        if let value = try? container?.decodeIfPresent(AgentSummary.self, forKey: .data) {
            agent = value
            return
        }
        if let value = try? container?.decodeIfPresent(Container.self, forKey: .data) {
            agent = value.agent ?? value.draft ?? value.item
            return
        }
        if let value = try? container?.decodeIfPresent(AgentSummary.self, forKey: .agent) {
            agent = value
            return
        }
        if let value = try? container?.decodeIfPresent(AgentSummary.self, forKey: .draft) {
            agent = value
            return
        }
        if let value = try? container?.decodeIfPresent(AgentSummary.self, forKey: .item) {
            agent = value
            return
        }
        if let direct = try? AgentSummary(from: decoder) {
            agent = direct
            return
        }
        if container != nil {
            agent = nil
            return
        }
        throw DecodingError.dataCorrupted(
            DecodingError.Context(
                codingPath: decoder.codingPath,
                debugDescription: "Unsupported agent response envelope"
            )
        )
    }

    func requiredAgent() throws -> AgentSummary {
        guard let agent else {
            throw APIError.serverError(
                code: code,
                message: message.isBlank ? L10n.tr("api.invalidResponse") : message
            )
        }
        return agent
    }
}

struct AgentConversationRemoteResponse: Decodable {
    private struct Container: Decodable {
        let conversation: AgentConversation?
        let item: AgentConversation?
    }

    let code: Int
    let message: String
    let conversation: AgentConversation?

    private enum CodingKeys: String, CodingKey {
        case code, message, data, conversation, item
    }

    init(from decoder: Decoder) throws {
        let container = try? decoder.container(keyedBy: CodingKeys.self)
        code = (try? container?.decodeIfPresent(Int.self, forKey: .code)) ?? 0
        message = (try? container?.decodeIfPresent(String.self, forKey: .message)) ?? ""

        if let value = try? container?.decodeIfPresent(AgentConversation.self, forKey: .data) {
            conversation = value
            return
        }
        if let value = try? container?.decodeIfPresent(Container.self, forKey: .data) {
            conversation = value.conversation ?? value.item
            return
        }
        if let value = try? container?.decodeIfPresent(AgentConversation.self, forKey: .conversation) {
            conversation = value
            return
        }
        if let value = try? container?.decodeIfPresent(AgentConversation.self, forKey: .item) {
            conversation = value
            return
        }
        if let direct = try? AgentConversation(from: decoder) {
            conversation = direct
            return
        }
        if container != nil {
            conversation = nil
            return
        }
        throw DecodingError.dataCorrupted(
            DecodingError.Context(
                codingPath: decoder.codingPath,
                debugDescription: "Unsupported agent conversation response envelope"
            )
        )
    }

    func requiredConversation() throws -> AgentConversation {
        guard let conversation else {
            throw APIError.serverError(
                code: code,
                message: message.isBlank ? L10n.tr("api.invalidResponse") : message
            )
        }
        return conversation
    }
}

struct AppRemoteConfigFetchResult {
    let config: AppRemoteConfig?
    let etag: String?
    let notModified: Bool
}

struct DynamicScreenFetchResult {
    let screen: DynamicScreen?
    let etag: String?
    let notModified: Bool
}

private struct ConditionalHTTPResult<T: Decodable> {
    let value: T?
    let etag: String?
    let notModified: Bool
}

private struct AppRemoteConfigRemoteResponse: Decodable {
    let config: AppRemoteConfig

    private enum CodingKeys: String, CodingKey {
        case code
        case message
        case data
    }

    init(from decoder: Decoder) throws {
        let container = try? decoder.container(keyedBy: CodingKeys.self)
        if container?.contains(.data) == true || container?.contains(.code) == true {
            let wrapped = try APIResponseWrapper<AppRemoteConfig>(from: decoder)
            guard let config = wrapped.data else {
                throw DecodingError.valueNotFound(
                    AppRemoteConfig.self,
                    DecodingError.Context(
                        codingPath: decoder.codingPath + [CodingKeys.data],
                        debugDescription: "Missing app remote config data"
                    )
                )
            }
            self.config = config
            return
        }
        self.config = try AppRemoteConfig(from: decoder)
    }
}

private struct DynamicScreenRemoteResponse: Decodable {
    let screen: DynamicScreen

    init(from decoder: Decoder) throws {
        if let wrapped = try? APIResponseWrapper<DynamicScreen>(from: decoder),
           let screen = wrapped.data {
            self.screen = screen
            return
        }
        self.screen = try DynamicScreen(from: decoder)
    }
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

private struct StructuredErrorResponse: Decodable {
    struct ErrorData: Decodable {
        let errorCode: String?
        let fieldErrors: [String: String]?

        private enum CodingKeys: String, CodingKey {
            case errorCode = "error_code"
            case fieldErrors = "field_errors"
        }
    }

    let message: String?
    let data: ErrorData?

    var userFacingMessage: String? {
        let fieldMessages = (data?.fieldErrors ?? [:])
            .sorted { $0.key < $1.key }
            .map(\.value)
        let messages = [message]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            + fieldMessages
        guard !messages.isEmpty else { return nil }
        var seen = Set<String>()
        return messages
            .filter { seen.insert($0).inserted }
            .joined(separator: "\n")
    }
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
        AuthTokenDiagnostics.log("login-response-raw", token: data.token)
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

    func fetchAppRemoteConfig(ifNoneMatch: String? = nil) async throws -> AppRemoteConfigFetchResult {
        guard let url = URL(string: baseURL + "/app/config") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        applyAppConfigHeaders(to: &request, ifNoneMatch: ifNoneMatch)

        let hasToken = AuthManager.shared.token != nil
        if hasToken {
            addAuthHeader(&request)
        }

        let response: ConditionalHTTPResult<AppRemoteConfigRemoteResponse> = try await performConditional(
            request,
            allowRetry: hasToken,
            logoutOnUnauthorized: false
        )
        return AppRemoteConfigFetchResult(
            config: response.value?.config,
            etag: response.etag,
            notModified: response.notModified
        )
    }

    func fetchDynamicScreen(screenID: String, ifNoneMatch: String? = nil) async throws -> DynamicScreenFetchResult {
        let escapedID = Self.pathComponent(screenID)
        guard let url = URL(string: baseURL + "/app/screens/\(escapedID)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        applyAppConfigHeaders(to: &request, ifNoneMatch: ifNoneMatch)

        let hasToken = AuthManager.shared.token != nil
        if hasToken {
            addAuthHeader(&request)
        }

        let response: ConditionalHTTPResult<DynamicScreenRemoteResponse> = try await performConditional(
            request,
            allowRetry: hasToken,
            logoutOnUnauthorized: false
        )
        return DynamicScreenFetchResult(
            screen: response.value?.screen,
            etag: response.etag,
            notModified: response.notModified
        )
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
            try AuthManager.shared.updateSessionTokens(
                accessToken: newToken,
                refreshToken: newRefreshToken,
                source: "refresh"
            )
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
        return try response.requiredData().contacts
    }

    func getConversations() async throws -> [Conversation] {
        struct ConversationsData: Decodable {
            let conversations: [Conversation]
        }

        let response: APIResponseWrapper<ConversationsData> = try await get(path: "/chat/conversations")
        return try response.requiredData().conversations
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
        let data = try response.requiredData()
        return (data.messages, data.hasMore)
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

    func sendStickerMessage(
        receiverID: String,
        packID: String,
        stickerID: String,
        replyToID: Int? = nil
    ) async throws -> Message {
        var body: [String: Any] = [
            "receiver_id": receiverID,
            "pack_id": packID,
            "sticker_id": stickerID
        ]
        if let replyToID {
            body["reply_to_id"] = replyToID
        }

        let response: APIResponseWrapper<Message> = try await postJSON(path: "/chat/messages/sticker", body: body)
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func getGiftCatalog() async throws -> [GiftCatalogItem] {
        let response: APIResponseWrapper<GiftCatalogResponseData> = try await get(path: "/wallet/gifts/catalog")
        return try response.requiredData().gifts
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
        return try response.requiredData().users
    }

    func getFriendList() async throws -> [FriendInfo] {
        struct FriendListData: Decodable {
            let friends: [FriendInfo]
        }

        let response: APIResponseWrapper<FriendListData> = try await get(path: "/friends/list")
        return try response.requiredData().friends
    }

    func getFriendRequests() async throws -> [FriendRequest] {
        struct RequestsData: Decodable {
            let requests: [FriendRequest]
        }

        let response: APIResponseWrapper<RequestsData> = try await get(path: "/friends/requests")
        return try response.requiredData().requests
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
        radiusM: Int? = nil,
        limit: Int = 50,
        gender: String? = nil,
        minAge: Int? = nil,
        maxAge: Int? = nil,
        includeFriends: Bool = false
    ) async throws -> MapUsersResponseData {
        var queryItems = [
            URLQueryItem(name: "lat", value: "\(lat)"),
            URLQueryItem(name: "lng", value: "\(lng)"),
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "include_friends", value: includeFriends ? "true" : "false")
        ]
        if let radiusM {
            queryItems.append(URLQueryItem(name: "radius_m", value: "\(radiusM)"))
        }
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
        return try response.requiredData()
    }

    func getFriendMapUsers(
        lat: Double?,
        lng: Double?,
        radiusM: Int? = nil,
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
        return try response.requiredData()
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
        return try response.requiredData().groups
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
        let data = try response.requiredData()
        return (data.messages, data.hasMore)
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

    func sendGroupSticker(
        groupID: Int,
        packID: String,
        stickerID: String,
        replyToID: Int? = nil,
        clientMessageID: String? = nil
    ) async throws -> GroupMessage {
        var body: [String: Any] = [
            "pack_id": packID,
            "sticker_id": stickerID
        ]
        if let replyToID {
            body["reply_to_id"] = replyToID
        }
        if let clientMessageID {
            body["client_message_id"] = clientMessageID
        }

        let response: APIResponseWrapper<GroupMessage> = try await postJSON(
            path: "/groups/\(groupID)/messages/sticker",
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

    func getRecommendedUsers(limit: Int = 18, excludeUserID: String? = nil) async throws -> [FollowUser] {
        var queryItems = [
            URLQueryItem(name: "limit", value: "\(min(max(limit, 1), 50))")
        ]
        if let excludeUserID, !excludeUserID.isBlank {
            queryItems.append(URLQueryItem(name: "exclude_user_id", value: excludeUserID))
        }
        let response: APIResponseWrapper<FollowUsersPage> = try await get(
            path: "/users/recommended",
            queryItems: queryItems
        )
        return try response.requiredData().users
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
        return try response.requiredData()
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
        return try response.requiredData()
    }

    // MARK: - Chat Appearance

    func getChatBackgrounds() async throws -> [ChatBackground] {
        struct BackgroundsData: Decodable {
            let backgrounds: [ChatBackground]
        }

        let response: APIResponseWrapper<BackgroundsData> = try await get(path: "/chat/backgrounds")
        return try response.requiredData().backgrounds
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
        return try response.requiredData().transactions
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
        return try response.requiredData().withdrawals
    }

    func cancelWalletWithdrawal(id: String) async throws -> WalletWithdrawal? {
        let response: APIResponseWrapper<WalletWithdrawalResponseData> = try await postJSON(
            path: "/wallet/withdrawals/\(Self.pathComponent(id))/cancel",
            body: [:]
        )
        return response.data?.withdrawal
    }

    // MARK: - Interactive Scripts

    func getScriptCategories() async throws -> [ScriptCategory] {
        let response: APIResponseWrapper<ScriptCategoriesData> = try await get(path: "/scripts/categories")
        return try response.requiredData().categories.sorted { lhs, rhs in
            (lhs.sortOrder, lhs.id) < (rhs.sortOrder, rhs.id)
        }
    }

    func getScripts(
        scope: ScriptScope,
        categoryID: String? = nil,
        cursor: String? = nil,
        limit: Int = 20
    ) async throws -> ScriptPage {
        var queryItems = [
            URLQueryItem(name: "scope", value: scope.rawValue),
            URLQueryItem(name: "limit", value: "\(min(max(limit, 1), 50))")
        ]
        if let categoryID, !categoryID.isBlank {
            queryItems.append(URLQueryItem(name: "category_id", value: categoryID))
        }
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        let response: APIResponseWrapper<ScriptPage> = try await get(
            path: "/scripts",
            queryItems: queryItems
        )
        return try response.requiredData()
    }

    func getScript(scriptID: String) async throws -> InteractiveScript {
        let response: APIResponseWrapper<ScriptSingleData> = try await get(
            path: "/scripts/\(Self.pathComponent(scriptID))"
        )
        return try response.requiredData().script
    }

    func createScript(body: [String: Any]) async throws -> InteractiveScript {
        let response: APIResponseWrapper<ScriptSingleData> = try await postJSON(
            path: "/scripts",
            body: body
        )
        return try response.requiredData().script
    }

    func updateScript(scriptID: String, body: [String: Any]) async throws -> InteractiveScript {
        let response: APIResponseWrapper<ScriptSingleData> = try await patchJSON(
            path: "/scripts/\(Self.pathComponent(scriptID))",
            body: body
        )
        return try response.requiredData().script
    }

    func deleteScript(scriptID: String) async throws {
        guard let url = URL(string: baseURL + "/scripts/\(Self.pathComponent(scriptID))") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        let _: APIResponseWrapper<EmptyData> = try await perform(request)
    }

    func uploadScriptAsset(
        business: ScriptAssetBusiness,
        imageData: Data,
        filename: String = "script.jpg"
    ) async throws -> ScriptAsset {
        guard let url = URL(string: baseURL + "/scripts/assets") else {
            throw APIError.invalidURL
        }
        let compressed = Self.compressImageForUpload(
            imageData,
            maxDimension: business == .cover ? 1600 : 800,
            quality: 0.8,
            maxBytes: business == .cover ? 1_500_000 : 700_000
        )
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 90
        addAuthHeader(&request)

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"business\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(business.rawValue)\r\n".data(using: .utf8)!)
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(compressed)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let response: APIResponseWrapper<ScriptAsset> = try await perform(request)
        let asset = try response.requiredData()
        guard !asset.url.isBlank else { throw APIError.invalidResponse }
        return asset
    }

    func createScriptRoom(
        scriptID: String,
        playerRoleID: String,
        idempotencyKey: String
    ) async throws -> ScriptRoomCreationData {
        guard let url = URL(string: baseURL + "/scripts/\(Self.pathComponent(scriptID))/rooms") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["player_role_id": playerRoleID])
        addAuthHeader(&request)
        let response: APIResponseWrapper<ScriptRoomCreationData> = try await perform(request)
        return try response.requiredData()
    }

    func getScriptRoom(roomID: String) async throws -> ScriptRoom {
        let response: APIResponseWrapper<ScriptRoomEnvelope> = try await get(
            path: "/script-rooms/\(Self.pathComponent(roomID))"
        )
        return try response.requiredData().room
    }

    func submitScriptTurn(
        roomID: String,
        content: String,
        clientMessageID: String
    ) async throws -> ScriptTurnResponse {
        let response: APIResponseWrapper<ScriptTurnResponse> = try await postJSON(
            path: "/script-rooms/\(Self.pathComponent(roomID))/turns",
            body: [
                "content": content,
                "client_message_id": clientMessageID
            ]
        )
        return try response.requiredData()
    }

    func retryScriptTurn(roomID: String, turnID: String) async throws -> ScriptTurnResponse {
        let response: APIResponseWrapper<ScriptTurnResponse> = try await postJSON(
            path: "/script-rooms/\(Self.pathComponent(roomID))/turns/\(Self.pathComponent(turnID))/retry",
            body: [:]
        )
        return try response.requiredData()
    }

    func endScriptRoom(roomID: String) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/script-rooms/\(Self.pathComponent(roomID))/end",
            body: [:]
        )
    }

    // MARK: - Agent Platform

    func getAgentRuntimeConfig() async throws -> AgentRuntimeConfig {
        let response: APIResponseWrapper<AgentRuntimeConfig> = try await get(path: "/agents/runtime-config")
        return try response.requiredData()
    }

    func getPublicAgents(limit: Int = 60) async throws -> [AgentSummary] {
        struct AgentListData: Decodable {
            let agents: [AgentSummary]

            private enum CodingKeys: String, CodingKey { case agents, items }

            init(from decoder: Decoder) throws {
                if let list = try? [AgentSummary](from: decoder) {
                    agents = list
                    return
                }
                let container = try decoder.container(keyedBy: CodingKeys.self)
                agents = try container.decodeIfPresent([AgentSummary].self, forKey: .agents)
                    ?? container.decodeIfPresent([AgentSummary].self, forKey: .items)
                    ?? []
            }
        }

        let response: APIResponseWrapper<AgentListData> = try await get(
            path: "/agents/public",
            queryItems: [URLQueryItem(name: "limit", value: "\(limit)")]
        )
        return try response.requiredData().agents
    }

    func getInstalledAgents() async throws -> [AgentSummary] {
        struct AgentListData: Decodable {
            let agents: [AgentSummary]

            private enum CodingKeys: String, CodingKey { case agents, items }

            init(from decoder: Decoder) throws {
                if let list = try? [AgentSummary](from: decoder) {
                    agents = list
                    return
                }
                let container = try decoder.container(keyedBy: CodingKeys.self)
                agents = try container.decodeIfPresent([AgentSummary].self, forKey: .agents)
                    ?? container.decodeIfPresent([AgentSummary].self, forKey: .items)
                    ?? []
            }
        }

        let response: APIResponseWrapper<AgentListData> = try await get(path: "/agents/installed")
        return try response.requiredData().agents
    }

    func getAgent(id: String) async throws -> AgentSummary {
        let response: AgentSummaryRemoteResponse = try await get(
            path: "/agents/\(Self.pathComponent(id))"
        )
        return try response.requiredAgent()
    }

    func installAgent(id: String) async throws -> AgentSummary {
        let response: AgentSummaryRemoteResponse = try await postJSON(
            path: "/agents/\(Self.pathComponent(id))/install",
            body: [:]
        )
        return try response.requiredAgent()
    }

    func uninstallAgent(id: String) async throws {
        guard let url = URL(string: baseURL + "/agents/\(Self.pathComponent(id))/install") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        let _: APIResponseWrapper<EmptyData> = try await perform(request)
    }

    func createAgentConversation(
        agentID: String,
        greetingID: String = "default",
        idempotencyKey: UUID
    ) async throws -> AgentConversation {
        let response: AgentConversationRemoteResponse = try await agentJSONRequest(
            method: "POST",
            path: "/agent-conversations",
            body: ["agent_id": agentID, "greeting_id": greetingID],
            idempotencyKey: idempotencyKey
        )
        return try response.requiredConversation()
    }

    func getAgentConversations() async throws -> [AgentConversation] {
        struct ConversationListData: Decodable {
            let conversations: [AgentConversation]

            private enum CodingKeys: String, CodingKey { case conversations, items }

            init(from decoder: Decoder) throws {
                if let list = try? [AgentConversation](from: decoder) {
                    conversations = list
                    return
                }
                let container = try decoder.container(keyedBy: CodingKeys.self)
                conversations = try container.decodeIfPresent([AgentConversation].self, forKey: .conversations)
                    ?? container.decodeIfPresent([AgentConversation].self, forKey: .items)
                    ?? []
            }
        }
        let response: APIResponseWrapper<ConversationListData> = try await get(path: "/agent-conversations")
        return try response.requiredData().conversations
    }

    func getAgentConversation(id: String) async throws -> AgentConversation {
        let response: AgentConversationRemoteResponse = try await get(
            path: "/agent-conversations/\(Self.pathComponent(id))"
        )
        return try response.requiredConversation()
    }

    func getAgentMessages(
        conversationID: String,
        beforeSequence: Int? = nil,
        limit: Int = 30
    ) async throws -> ([AgentMessage], Bool) {
        struct MessagesData: Decodable {
            let messages: [AgentMessage]
            let hasMore: Bool

            enum CodingKeys: String, CodingKey {
                case messages
                case hasMore = "has_more"
            }
        }

        var queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let beforeSequence {
            queryItems.append(URLQueryItem(name: "before_sequence", value: "\(beforeSequence)"))
        }
        let response: APIResponseWrapper<MessagesData> = try await get(
            path: "/agent-conversations/\(Self.pathComponent(conversationID))/messages",
            queryItems: queryItems
        )
        let data = try response.requiredData()
        return (data.messages, data.hasMore)
    }

    func uploadAgentChatImage(
        _ data: Data,
        filename: String,
        idempotencyKey: UUID
    ) async throws -> String {
        let compressed = Self.compressImageForUpload(data)
        let response: APIResponseWrapper<AgentImageUpload> = try await uploadAgentImage(
            path: "/agent-assets/images",
            imageData: compressed,
            filename: filename,
            idempotencyKey: idempotencyKey
        )
        return try response.requiredData().assetID
    }

    func uploadAgentReference(
        _ data: Data,
        filename: String,
        idempotencyKey: UUID
    ) async throws -> AgentReferenceUpload {
        guard let image = UIImage(data: data) else { throw APIError.invalidResponse }
        let shortSide = min(image.size.width, image.size.height)
        let ratio = image.size.width / max(image.size.height, 1)
        guard shortSide >= 512, (0.5...2).contains(ratio) else {
            throw APIError.serverError(code: 400, message: "参考图短边至少 512 像素，宽高比需在 1:2 到 2:1 之间")
        }
        let compressed = Self.compressImageForUpload(data, maxDimension: 1600, quality: 0.82, maxBytes: 2_000_000)
        let response: APIResponseWrapper<AgentReferenceUpload> = try await uploadAgentImage(
            path: "/agent-assets/reference-images",
            imageData: compressed,
            filename: filename,
            idempotencyKey: idempotencyKey
        )
        return try response.requiredData()
    }

    func createAgent(
        payload: [String: Any],
        idempotencyKey: UUID
    ) async throws -> AgentSummary {
        let response: AgentSummaryRemoteResponse = try await agentJSONRequest(
            method: "POST",
            path: "/agents",
            body: payload,
            idempotencyKey: idempotencyKey,
            timeout: 30
        )
        return try response.requiredAgent()
    }

    func updateAgentDraft(
        id: String,
        expectedRevision: Int,
        patch: [String: Any]
    ) async throws -> AgentSummary {
        let response: AgentSummaryRemoteResponse = try await agentJSONRequest(
            method: "PATCH",
            path: "/agents/\(Self.pathComponent(id))/draft",
            body: ["expected_revision": expectedRevision, "patch": patch],
            idempotencyKey: nil,
            timeout: 30
        )
        return try response.requiredAgent()
    }

    func publishAgent(id: String, idempotencyKey: UUID) async throws -> AgentVersion {
        let response: APIResponseWrapper<AgentVersion> = try await agentJSONRequest(
            method: "POST",
            path: "/agents/\(Self.pathComponent(id))/publish",
            body: [:],
            idempotencyKey: idempotencyKey,
            timeout: 30
        )
        return try response.requiredData()
    }

    func createAgentTurn(
        conversationID: String,
        clientMessageID: UUID,
        parts: [[String: Any]],
        replyToID: String? = nil,
        idempotencyKey: UUID
    ) async throws -> AgentTurnAccepted {
        var body: [String: Any] = [
            "client_message_id": clientMessageID.uuidString,
            "parts": parts
        ]
        if let replyToID { body["reply_to_id"] = replyToID }
        let response: APIResponseWrapper<AgentTurnAccepted> = try await agentJSONRequest(
            method: "POST",
            path: "/agent-conversations/\(Self.pathComponent(conversationID))/turns",
            body: body,
            idempotencyKey: idempotencyKey,
            timeout: 30
        )
        return try response.requiredData()
    }

    func getAgentTurn(id: String) async throws -> AgentTurnResult {
        let response: APIResponseWrapper<AgentTurnResult> = try await get(
            path: "/agent-turns/\(Self.pathComponent(id))"
        )
        return try response.requiredData()
    }

    func unlockAgentMedia(id: String, idempotencyKey: UUID) async throws -> AgentMediaUnlock {
        let response: APIResponseWrapper<AgentMediaUnlock> = try await agentJSONRequest(
            method: "POST",
            path: "/agent-media/\(Self.pathComponent(id))/unlock",
            body: [:],
            idempotencyKey: idempotencyKey
        )
        return try response.requiredData()
    }

    func loadAgentMedia(path: String, range: String? = nil) async throws -> AgentMediaResponse {
        guard let url = MediaURLResolver.resolve(path, apiBaseURL: baseURL) else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let range { request.setValue(range, forHTTPHeaderField: "Range") }
        addAuthHeader(&request)
        return try await performRaw(request)
    }

    private func agentJSONRequest<T: Decodable>(
        method: String,
        path: String,
        body: [String: Any],
        idempotencyKey: UUID?,
        timeout: TimeInterval = 15
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let idempotencyKey {
            request.setValue(idempotencyKey.uuidString, forHTTPHeaderField: "Idempotency-Key")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        addAuthHeader(&request)
        return try await perform(request)
    }

    private func uploadAgentImage<T: Decodable>(
        path: String,
        imageData: Data,
        filename: String,
        idempotencyKey: UUID
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else { throw APIError.invalidURL }
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(idempotencyKey.uuidString, forHTTPHeaderField: "Idempotency-Key")
        addAuthHeader(&request)

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"image\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body
        return try await perform(request)
    }

    // MARK: - Image Loading

    func loadImage(path: String) async throws -> Data {
        try await loadAgentMedia(path: path).data
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

    private func patchJSON<T: Decodable>(
        path: String,
        body: [String: Any]
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        addAuthHeader(&request)
        return try await perform(request)
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

    // MARK: - Game Center

    func getRecommendedGames(limit: Int = 50, cursor: String? = nil) async throws -> GameCatalogPage {
        var queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        let response: APIResponseWrapper<GameCatalogPage> = try await get(
            path: "/games/recommended",
            queryItems: queryItems
        )
        guard response.code == 0, let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func getPlayedGames(limit: Int = 50, cursor: String? = nil) async throws -> GameCatalogPage {
        var queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        let response: APIResponseWrapper<GameCatalogPage> = try await get(
            path: "/games/played",
            queryItems: queryItems
        )
        guard response.code == 0, let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func createGameSession(gameID: String) async throws -> GameSession {
        let response: APIResponseWrapper<GameSession> = try await postJSON(
            path: "/games/\(Self.pathComponent(gameID))/sessions",
            body: [:]
        )
        guard response.code == 0, let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    // MARK: - Short Drama

    func getShortDramaSeriesFeed(
        filter: ShortDramaSeriesFilter,
        cursor: String? = nil,
        limit: Int = 12
    ) async throws -> ShortDramaSeriesPage {
        var queryItems = [
            URLQueryItem(name: "tab", value: filter.rawValue),
            URLQueryItem(name: "limit", value: "\(limit)")
        ]
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }

        let response: APIResponseWrapper<ShortDramaSeriesPage> = try await get(
            path: "/short-drama/series",
            queryItems: queryItems
        )
        return try response.requiredData()
    }

    func getUserShortDramaSeries(
        creatorUserID: String,
        cursor: String? = nil,
        limit: Int = 12
    ) async throws -> ShortDramaSeriesPage {
        var queryItems = [
            URLQueryItem(name: "creator_user_id", value: creatorUserID),
            URLQueryItem(name: "limit", value: "\(limit)")
        ]
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }

        let response: APIResponseWrapper<ShortDramaSeriesPage> = try await get(
            path: "/short-drama/series",
            queryItems: queryItems
        )
        return try response.requiredData()
    }

    func getShortDramaFeed(cursor: String? = nil, limit: Int = 12) async throws -> ShortDramaFeedPage {
        var queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }

        let response: APIResponseWrapper<ShortDramaFeedPage> = try await get(
            path: "/short-drama/feed",
            queryItems: queryItems
        )
        return try response.requiredData()
    }

    func getMyShortDramaSeries(cursor: String? = nil, limit: Int = 20) async throws -> ShortDramaStudioPage {
        var queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }

        let response: APIResponseWrapper<ShortDramaStudioPage> = try await get(
            path: "/short-drama/mine",
            queryItems: queryItems
        )
        return try response.requiredData()
    }

    func createShortDramaSeries(
        title: String,
        intro: String,
        coverData: Data,
        coverFilename: String
    ) async throws -> ShortDramaSeries {
        let response: APIResponseWrapper<ShortDramaSeries> = try await shortDramaMultipartRequest(
            path: "/short-drama/series",
            method: "POST",
            fields: [
                ("title", title),
                ("intro", intro)
            ],
            files: [
                ShortDramaMultipartFile(
                    name: "cover",
                    filename: coverFilename,
                    mimeType: Self.mimeType(for: coverFilename, fallback: "image/jpeg"),
                    data: coverData
                )
            ],
            timeout: 180
        )
        guard let series = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return series
    }

    func updateShortDramaSeries(
        seriesID: String,
        title: String,
        intro: String,
        coverData: Data?,
        coverFilename: String?
    ) async throws -> ShortDramaSeries {
        var files: [ShortDramaMultipartFile] = []
        if let coverData, let coverFilename {
            files.append(ShortDramaMultipartFile(
                name: "cover",
                filename: coverFilename,
                mimeType: Self.mimeType(for: coverFilename, fallback: "image/jpeg"),
                data: coverData
            ))
        }

        let response: APIResponseWrapper<ShortDramaSeries> = try await shortDramaMultipartRequest(
            path: "/short-drama/series/\(Self.pathComponent(seriesID))",
            method: "PATCH",
            fields: [
                ("title", title),
                ("intro", intro)
            ],
            files: files,
            timeout: 180
        )
        guard let series = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return series
    }

    func getShortDramaSeriesDetail(seriesID: String) async throws -> ShortDramaSeries {
        let response: APIResponseWrapper<ShortDramaSeries> = try await get(
            path: "/short-drama/series/\(Self.pathComponent(seriesID))"
        )
        guard let series = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return series
    }

    func uploadShortDramaEpisode(
        seriesID: String,
        title: String,
        intro: String,
        episodeNumber: Int,
        videoData: Data,
        videoFilename: String,
        coverData: Data,
        coverFilename: String,
        unlockPriceCatFood: Int? = nil
    ) async throws -> ShortDramaEpisodeUploadResult {
        var fields: [(String, String)] = [
            ("title", title),
            ("intro", intro),
            ("episode_number", "\(episodeNumber)")
        ]
        if let unlockPriceCatFood {
            fields.append(("unlock_price_cat_food", "\(min(max(unlockPriceCatFood, 0), 100))"))
        }
        let response: APIResponseWrapper<ShortDramaEpisodeUploadResult> = try await shortDramaMultipartRequest(
            path: "/short-drama/series/\(Self.pathComponent(seriesID))/episodes",
            method: "POST",
            fields: fields,
            files: [
                ShortDramaMultipartFile(
                    name: "video",
                    filename: videoFilename,
                    mimeType: Self.mimeType(for: videoFilename, fallback: "video/mp4"),
                    data: videoData
                ),
                ShortDramaMultipartFile(
                    name: "cover",
                    filename: coverFilename,
                    mimeType: Self.mimeType(for: coverFilename, fallback: "image/jpeg"),
                    data: coverData
                )
            ],
            timeout: 600
        )
        return response.data ?? ShortDramaEpisodeUploadResult(video: nil, status: nil)
    }

    func updateShortDramaEpisode(
        videoID: String,
        title: String,
        intro: String,
        episodeNumber: Int,
        unlockPriceCatFood: Int
    ) async throws -> ShortDramaVideo {
        let response: APIResponseWrapper<ShortDramaVideo> = try await patchJSON(
            path: "/short-drama/videos/\(Self.pathComponent(videoID))",
            body: [
                "title": title,
                "intro": intro,
                "episode_number": episodeNumber,
                "unlock_price_cat_food": min(max(unlockPriceCatFood, 0), 100)
            ]
        )
        guard let video = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return video
    }

    func submitShortDramaSeries(seriesID: String) async throws -> ShortDramaSeries {
        let response: APIResponseWrapper<ShortDramaSeries> = try await postJSON(
            path: "/short-drama/series/\(Self.pathComponent(seriesID))/submit",
            body: [:]
        )
        guard let series = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return series
    }

    func unlockShortDramaEpisode(videoID: String) async throws -> ShortDramaUnlockResult {
        let response: APIResponseWrapper<ShortDramaUnlockResult> = try await postJSON(
            path: "/short-drama/videos/\(Self.pathComponent(videoID))/unlock",
            body: [:]
        )
        guard let result = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return result
    }

    func deleteShortDramaEpisode(videoID: String) async throws {
        guard let url = URL(string: baseURL + "/short-drama/videos/\(Self.pathComponent(videoID))") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        let _: APIResponseWrapper<EmptyData> = try await perform(request)
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
        return try response.requiredData()
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

    private struct ShortDramaMultipartFile: Sendable {
        let name: String
        let filename: String
        let mimeType: String
        let data: Data
    }

    private func shortDramaMultipartRequest<T: Decodable>(
        path: String,
        method: String,
        fields: [(String, String)],
        files: [ShortDramaMultipartFile],
        timeout: TimeInterval
    ) async throws -> APIResponseWrapper<T> {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeout
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        addAuthHeader(&request)

        let body = await Self.shortDramaMultipartBody(boundary: boundary, fields: fields, files: files)
        return try await performUpload(request, body: body)
    }

    nonisolated private static func shortDramaMultipartBody(
        boundary: String,
        fields: [(String, String)],
        files: [ShortDramaMultipartFile]
    ) async -> Data {
        await Task.detached(priority: .utility) {
            var body = Data()
            for field in fields {
                appendMomentTextField(name: field.0, value: field.1, boundary: boundary, to: &body)
            }
            for file in files {
                appendShortDramaFileField(file, boundary: boundary, to: &body)
            }
            body.append("--\(boundary)--\r\n".data(using: .utf8)!)
            return body
        }.value
    }

    nonisolated private static func appendShortDramaFileField(
        _ file: ShortDramaMultipartFile,
        boundary: String,
        to body: inout Data
    ) {
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(file.name)\"; filename=\"\(file.filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(file.mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(file.data)
        body.append("\r\n".data(using: .utf8)!)
    }

    nonisolated private static func mimeType(for filename: String, fallback: String) -> String {
        switch filename.lowercased().split(separator: ".").last {
        case "mov": return "video/quicktime"
        case "m4v": return "video/x-m4v"
        case "mp4": return "video/mp4"
        case "heic": return "image/heic"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        default: return fallback
        }
    }

    // MARK: - Moments

    /// Personalized feed containing posts from users followed by the current user.
    func getMomentsFollowing(beforeID: Int? = nil, limit: Int = 20) async throws -> ([Moment], Bool) {
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
        let data = try response.requiredData()
        return (data.moments, data.hasMore)
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
        let data = try response.requiredData()
        return (data.moments, data.hasMore)
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

        var path = "/moments/user/\(Self.pathComponent(userID))?limit=\(limit)"
        if let bid = beforeID { path += "&before_id=\(bid)" }
        let response: APIResponseWrapper<FeedData> = try await get(path: path)
        let data = try response.requiredData()
        return (data.moments, data.hasMore)
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
        let data = try response.requiredData()
        return (data.unreadCount, data.hasNewMoments)
    }

    func getMomentsNotifications(limit: Int = 50) async throws -> [MomentsNotification] {
        struct NotifData: Decodable {
            let notifications: [MomentsNotification]
        }
        let response: APIResponseWrapper<NotifData> = try await get(path: "/moments/notifications/list?limit=\(limit)")
        return try response.requiredData().notifications
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

    private func applyAppConfigHeaders(to request: inout URLRequest, ifNoneMatch: String?) {
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(AppLanguageStore.shared.activeLanguage.localeIdentifier, forHTTPHeaderField: "Accept-Language")
        request.setValue(AppBuildInfo.appVersion, forHTTPHeaderField: "X-App-Version")
        request.setValue("\(AppBuildInfo.buildNumber)", forHTTPHeaderField: "X-App-Build")
        request.setValue("iOS", forHTTPHeaderField: "X-Platform")
        request.setValue(TimeZone.current.identifier, forHTTPHeaderField: "X-Timezone")
        if let ifNoneMatch, !ifNoneMatch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            request.setValue(ifNoneMatch, forHTTPHeaderField: "If-None-Match")
        }
    }

    private func addAuthHeader(_ request: inout URLRequest) {
        AuthRequestAuthorizer.addAuthHeader(&request, token: AuthManager.shared.token)
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
        } decode: { data, request, _ in
            do {
                return try JSONDecoder().decode(T.self, from: data)
            } catch {
                Self.logDecodingError(error, data: data, request: request, type: T.self)
                throw APIError.decodingError(error)
            }
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
        } decode: { data, _, _ in
            do {
                return try JSONDecoder().decode(T.self, from: data)
            } catch {
                throw APIError.decodingError(error)
            }
        }
    }

    private func performRaw(
        _ request: URLRequest,
        allowRetry: Bool = true,
        logoutOnUnauthorized: Bool = true
    ) async throws -> AgentMediaResponse {
        try await performTransport(
            request,
            allowRetry: allowRetry,
            logoutOnUnauthorized: logoutOnUnauthorized
        ) { request in
            try await self.session.data(for: request)
        } decode: { data, _, response in
            AgentMediaResponse(
                data: data,
                mimeType: response.value(forHTTPHeaderField: "Content-Type"),
                contentRange: response.value(forHTTPHeaderField: "Content-Range"),
                contentLength: response.value(forHTTPHeaderField: "Content-Length").flatMap(Int64.init),
                acceptsRanges: response.value(forHTTPHeaderField: "Accept-Ranges")?.lowercased() == "bytes"
            )
        }
    }

    private func performConditional<T: Decodable>(
        _ request: URLRequest,
        allowRetry: Bool = true,
        logoutOnUnauthorized: Bool = false,
        transientRetryCount: Int = 0
    ) async throws -> ConditionalHTTPResult<T> {
        var finalRequest = request
        let expectsAuthorization = allowRetry
            || request.value(forHTTPHeaderField: "Authorization") != nil
        if expectsAuthorization {
            addAuthHeader(&finalRequest)
        }
        AuthRequestAuthorizer.logFinalRequest(
            finalRequest,
            expectsAuthorization: expectsAuthorization
        )

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: finalRequest)
        } catch {
            if TransientHTTPRetryPolicy.isCancellation(error) {
                throw CancellationError()
            }
            if TransientHTTPRetryPolicy.shouldRetry(
                method: finalRequest.httpMethod,
                error: error,
                retryCount: transientRetryCount
            ) {
                try await retryTransientRequest(
                    finalRequest,
                    error: error,
                    retryCount: transientRetryCount
                )
                return try await performConditional(
                    finalRequest,
                    allowRetry: allowRetry,
                    logoutOnUnauthorized: logoutOnUnauthorized,
                    transientRetryCount: transientRetryCount + 1
                )
            }
            Self.logTransportError(error, request: finalRequest)
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode == 304 {
            return ConditionalHTTPResult(
                value: nil,
                etag: httpResponse.value(forHTTPHeaderField: "ETag"),
                notModified: true
            )
        }

        if httpResponse.statusCode == 401 && allowRetry {
            do {
                try await attemptTokenRefresh()
            } catch APIError.unauthorized {
                if logoutOnUnauthorized {
                    AuthManager.shared.logout()
                }
                throw APIError.unauthorized
            } catch {
                throw error
            }

            var retryRequest = finalRequest
            addAuthHeader(&retryRequest)
            return try await performConditional(
                retryRequest,
                allowRetry: false,
                logoutOnUnauthorized: logoutOnUnauthorized,
                transientRetryCount: transientRetryCount
            )
        }

        if httpResponse.statusCode == 401 {
            if logoutOnUnauthorized {
                AuthManager.shared.logout()
            }
            throw APIError.unauthorized
        }

        if TransientHTTPRetryPolicy.shouldRetry(
            method: finalRequest.httpMethod,
            statusCode: httpResponse.statusCode,
            retryCount: transientRetryCount
        ) {
            try await retryTransientRequest(
                finalRequest,
                response: httpResponse,
                retryCount: transientRetryCount
            )
            return try await performConditional(
                finalRequest,
                allowRetry: allowRetry,
                logoutOnUnauthorized: logoutOnUnauthorized,
                transientRetryCount: transientRetryCount + 1
            )
        }

        if !(200..<300).contains(httpResponse.statusCode) {
            throw Self.httpError(from: data, response: httpResponse, path: finalRequest.url?.path ?? "")
        }

        do {
            return ConditionalHTTPResult(
                value: try JSONDecoder().decode(T.self, from: data),
                etag: httpResponse.value(forHTTPHeaderField: "ETag"),
                notModified: false
            )
        } catch {
            throw APIError.decodingError(error)
        }
    }

    private static func httpError(from data: Data, response: HTTPURLResponse, path: String) -> APIError {
        let decoder = JSONDecoder()
        let fallback = HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
        let message: String
        let detailResponse = try? decoder.decode(DetailErrorResponse.self, from: data)
        let envelopeResponse = try? decoder.decode(APIResponseWrapper<EmptyData>.self, from: data)
        if let detailMessage = detailResponse?.detail?.message,
           !detailMessage.isEmpty {
            message = detailMessage
        } else if let structuredResponse = try? decoder.decode(StructuredErrorResponse.self, from: data),
                  let structuredMessage = structuredResponse.userFacingMessage {
            message = structuredMessage
        } else if let errorResponse = envelopeResponse {
            message = errorResponse.message
        } else if let body = String(data: data, encoding: .utf8), !body.isEmpty {
            message = String(body.prefix(240))
        } else {
            message = fallback
        }
        let requestID = response.value(forHTTPHeaderField: "X-Request-ID")
            ?? response.value(forHTTPHeaderField: "X-Correlation-ID")
            ?? "-"
        print("[APIService] HTTP \(response.statusCode) \(path) request_id=\(requestID): \(message)")
        let envelopeCode = envelopeResponse.flatMap { $0.code == 0 ? nil : $0.code }
        let businessCode = detailResponse?.detail?.code ?? envelopeCode
        return APIError.serverError(code: businessCode ?? response.statusCode, message: message)
    }

    private func performTransport<T>(
        _ request: URLRequest,
        allowRetry: Bool,
        logoutOnUnauthorized: Bool,
        transientRetryCount: Int = 0,
        operation: @escaping (URLRequest) async throws -> (Data, URLResponse),
        decode: @escaping (Data, URLRequest, HTTPURLResponse) throws -> T
    ) async throws -> T {
        var finalRequest = request
        let expectsAuthorization = allowRetry
            || request.value(forHTTPHeaderField: "Authorization") != nil
        if expectsAuthorization {
            addAuthHeader(&finalRequest)
        }
        AuthRequestAuthorizer.logFinalRequest(
            finalRequest,
            expectsAuthorization: expectsAuthorization
        )

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await operation(finalRequest)
        } catch {
            if TransientHTTPRetryPolicy.isCancellation(error) {
                throw CancellationError()
            }
            if TransientHTTPRetryPolicy.shouldRetry(
                method: finalRequest.httpMethod,
                error: error,
                retryCount: transientRetryCount
            ) {
                try await retryTransientRequest(
                    finalRequest,
                    error: error,
                    retryCount: transientRetryCount
                )
                return try await performTransport(
                    finalRequest,
                    allowRetry: allowRetry,
                    logoutOnUnauthorized: logoutOnUnauthorized,
                    transientRetryCount: transientRetryCount + 1,
                    operation: operation,
                    decode: decode
                )
            }
            Self.logTransportError(error, request: finalRequest)
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
            var retryRequest = finalRequest
            addAuthHeader(&retryRequest)
            return try await performTransport(
                retryRequest,
                allowRetry: false,
                logoutOnUnauthorized: logoutOnUnauthorized,
                transientRetryCount: transientRetryCount,
                operation: operation,
                decode: decode
            )
        }

        if httpResponse.statusCode == 401 {
            if logoutOnUnauthorized {
                AuthManager.shared.logout()
            }
            throw APIError.unauthorized
        }

        if TransientHTTPRetryPolicy.shouldRetry(
            method: finalRequest.httpMethod,
            statusCode: httpResponse.statusCode,
            retryCount: transientRetryCount
        ) {
            try await retryTransientRequest(
                finalRequest,
                response: httpResponse,
                retryCount: transientRetryCount
            )
            return try await performTransport(
                finalRequest,
                allowRetry: allowRetry,
                logoutOnUnauthorized: logoutOnUnauthorized,
                transientRetryCount: transientRetryCount + 1,
                operation: operation,
                decode: decode
            )
        }

        if !(200..<300).contains(httpResponse.statusCode) {
            throw Self.httpError(from: data, response: httpResponse, path: finalRequest.url?.path ?? "")
        }

        return try decode(data, finalRequest, httpResponse)
    }

    private func retryTransientRequest(
        _ request: URLRequest,
        response: HTTPURLResponse,
        retryCount: Int
    ) async throws {
        let delay = TransientHTTPRetryPolicy.delayNanoseconds(
            response: response,
            retryCount: retryCount
        )
        #if DEBUG
        print(
            "[APIService] transient HTTP \(response.statusCode) "
                + "\(request.url?.path ?? "") retry=\(retryCount + 1)/\(TransientHTTPRetryPolicy.maximumRetryCount)"
        )
        #endif
        try await Task.sleep(nanoseconds: delay)
    }

    private func retryTransientRequest(
        _ request: URLRequest,
        error: Error,
        retryCount: Int
    ) async throws {
        let delays: [UInt64] = [350_000_000, 900_000_000]
        let delay = delays[min(retryCount, delays.count - 1)]
        #if DEBUG
        let nsError = error as NSError
        print(
            "[APIService] transient transport failure \(request.url?.path ?? "") "
                + "domain=\(nsError.domain) code=\(nsError.code) "
                + "retry=\(retryCount + 1)/\(TransientHTTPRetryPolicy.maximumRetryCount)"
        )
        #endif
        try await Task.sleep(nanoseconds: delay)
    }

    private static func logTransportError(_ error: Error, request: URLRequest) {
        let nsError = error as NSError
        print(
            "[APIService] transport failure \(request.httpMethod ?? "GET") "
                + "\(request.url?.path ?? "") domain=\(nsError.domain) code=\(nsError.code)"
        )
    }

    private static func logDecodingError<T>(
        _ error: Error,
        data: Data,
        request: URLRequest,
        type: T.Type
    ) {
        #if DEBUG
        let codingPath: [CodingKey]
        let description: String
        switch error {
        case let DecodingError.keyNotFound(_, context),
             let DecodingError.typeMismatch(_, context),
             let DecodingError.valueNotFound(_, context),
             let DecodingError.dataCorrupted(context):
            codingPath = context.codingPath
            description = context.debugDescription
        default:
            codingPath = []
            description = error.localizedDescription
        }
        let path = codingPath.map(\.stringValue).joined(separator: ".")
        let topLevelKeys = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?
            .keys.sorted().joined(separator: ",") ?? "-"
        print(
            "[APIService] decode failure \(request.url?.path ?? "") "
                + "type=\(String(describing: type)) coding_path=\(path.isEmpty ? "-" : path) "
                + "bytes=\(data.count) top_keys=\(topLevelKeys) detail=\(description)"
        )
        #endif
    }
}
