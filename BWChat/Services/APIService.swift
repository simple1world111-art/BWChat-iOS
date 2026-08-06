// BWChat/Services/APIService.swift
// HTTP API service using URLSession

import Foundation
import Combine
import UIKit
import ImageIO
import AVFoundation

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

enum SensitiveLogRedactor {
    private static let patterns: [NSRegularExpression] = [
        #"(?i)(authorization\s*[\"']?\s*[:=]\s*[\"']?(?:bearer\s+)?)[^\s,\"'}&]+"#,
        #"(?i)(round[-_]?token\s*[\"']?\s*[:=]\s*[\"']?)[^\s,\"'}&]+"#,
        #"(?i)((?:phone_e164|verification_code|sms_code|invite_token|code_or_token)\s*[\"']?\s*[:=]\s*[\"']?)[^\s,\"'}&]+"#,
        #"(?i)(ticket\s*[\"']?\s*[:=]\s*[\"']?)[^&\s,\"'}]+"#,
        #"(?i)(ticket%3d)[^&\s\"']+"#
    ].compactMap { try? NSRegularExpression(pattern: $0) }

    static func redact(_ value: String) -> String {
        patterns.reduce(value) { partial, pattern in
            pattern.stringByReplacingMatches(
                in: partial,
                range: NSRange(partial.startIndex..., in: partial),
                withTemplate: "$1<redacted>"
            )
        }
    }
}

enum SensitiveHTTPResponsePolicy {
    static func apply(to request: inout URLRequest) {
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    }
}

enum APIError: Error, LocalizedError {
    case invalidURL
    case invalidResponse
    case unauthorized
    case serverError(code: Int, message: String)
    case businessError(code: String, message: String, context: WalletBalanceErrorContext?)
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
        case .businessError(let code, let message, _):
            return WalletBusinessError.userFacingMessage(code: code, serverMessage: message)
        case .networkError: return L10n.tr("api.networkUnavailable")
        case .decodingError: return L10n.tr("api.decodingError")
        }
    }
}

struct WalletBalanceErrorContext: Decodable, Equatable {
    let requiredAmount: Int?
    let goldCoinBalance: GoldCoinAmount?
    let activityCatFoodBalance: ActivityCatFoodAmount?
    let spendableBalance: Int?

    enum CodingKeys: String, CodingKey {
        case requiredAmount = "required_amount"
        case goldCoinBalance = "gold_coin_balance"
        case activityCatFoodBalance = "activity_cat_food_balance"
        case spendableBalance = "spendable_balance"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        requiredAmount = container.flexInt(for: .requiredAmount)
        goldCoinBalance = container.flexInt(for: .goldCoinBalance).map(GoldCoinAmount.init)
        activityCatFoodBalance = container.flexInt(for: .activityCatFoodBalance).map(ActivityCatFoodAmount.init)
        spendableBalance = container.flexInt(for: .spendableBalance)
    }
}

enum WalletBusinessError {
    static let insufficientSpendableBalance = "insufficient_spendable_balance"
    static let insufficientGoldCoins = "insufficient_gold_coins"
    static let activityCatFoodDisabled = "activity_cat_food_disabled"

    static func userFacingMessage(code: String, serverMessage: String?) -> String {
        switch normalized(code) {
        case insufficientSpendableBalance:
            return L10n.tr("wallet.error.insufficientSpendableBalance")
        case insufficientGoldCoins:
            return L10n.tr("wallet.error.insufficientGoldCoins")
        case activityCatFoodDisabled:
            return L10n.tr("wallet.error.activityCatFoodDisabled")
        default:
            let clean = serverMessage?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return clean.isEmpty ? L10n.tr("api.invalidResponse") : clean
        }
    }

    static func isActivityCatFoodDisabled(_ error: Error) -> Bool {
        guard case APIError.businessError(let code, _, _) = error else { return false }
        return normalized(code) == activityCatFoodDisabled
    }

    private static func normalized(_ code: String) -> String {
        code.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
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

    private enum CodingKeys: String, CodingKey {
        case code, message, data
    }

    init(code: Int, message: String, data: T?) {
        self.code = code
        self.message = message
        self.data = data
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let integerCode = try? container.decodeIfPresent(Int.self, forKey: .code) {
            code = integerCode
        } else if let stringCode = try? container.decodeIfPresent(String.self, forKey: .code),
                  let integerCode = Int(stringCode) {
            code = integerCode
        } else {
            code = 0
        }
        message = (try? container.decodeIfPresent(String.self, forKey: .message)) ?? ""
        data = try container.decodeIfPresent(T.self, forKey: .data)
    }

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

private struct SymbolicBusinessErrorResponse: Decodable {
    let code: String?
    let message: String?
    let data: WalletBalanceErrorContext?

    enum CodingKeys: String, CodingKey {
        case code
        case message
        case data
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        code = container.flexString(for: .code)
        message = container.flexString(for: .message)
        let nested = try? container.decodeIfPresent(WalletBalanceErrorContext.self, forKey: .data)
        self.data = nested ?? (try? WalletBalanceErrorContext(from: decoder))
    }
}

private struct GiftDirectMessageResponseData: Decodable {
    let message: Message?
    let fallbackContent: String?
    let charge: MixedAssetCharge?

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
        let decodedCharge = try MixedAssetCharge.decodeIfPresent(from: decoder)
        for key in [CodingKeys.message, .msg, .chatMessage, .chatMessageCamel, .data, .item] {
            if let message = try? container.decodeIfPresent(Message.self, forKey: key),
               message.isUsableGiftResponse {
                self.message = message
                self.fallbackContent = message.content
                self.charge = decodedCharge
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
        self.charge = decodedCharge
    }
}

private struct GiftGroupMessageResponseData: Decodable {
    let message: GroupMessage?
    let fallbackContent: String?
    let charge: MixedAssetCharge?

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
        let decodedCharge = try MixedAssetCharge.decodeIfPresent(from: decoder)
        for key in [CodingKeys.message, .msg, .groupMessage, .groupMessageCamel, .chatMessage, .chatMessageCamel, .data, .item] {
            if let message = try? container.decodeIfPresent(GroupMessage.self, forKey: key),
               message.isUsableGiftResponse {
                self.message = message
                self.fallbackContent = message.content
                self.charge = decodedCharge
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
        self.charge = decodedCharge
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

struct FollowRelationshipChange {
    let relationship: FollowRelationship
    let user: FollowUser?
}

@MainActor
final class FollowRelationshipStore {
    static let shared = FollowRelationshipStore()

    let changes = PassthroughSubject<FollowRelationshipChange, Never>()

    private init() {}

    @discardableResult
    func apply(_ relationship: FollowRelationship, targetUserID: String) -> FollowRelationship {
        let normalized = normalizedRelationship(relationship, targetUserID: targetUserID)
        let user = updateCachedProfile(with: normalized)
        updateCurrentUserFollowCaches(with: normalized, user: user)
        changes.send(FollowRelationshipChange(relationship: normalized, user: user))
        return normalized
    }

    private func normalizedRelationship(
        _ relationship: FollowRelationship,
        targetUserID: String
    ) -> FollowRelationship {
        guard relationship.userID != targetUserID else { return relationship }
        return FollowRelationship(
            userID: targetUserID,
            followedByMe: relationship.followedByMe,
            followsMe: relationship.followsMe,
            isFriend: relationship.isFriend,
            followRequested: relationship.followRequested,
            followingCount: relationship.followingCount,
            followerCount: relationship.followerCount
        )
    }

    private func updateCachedProfile(with relationship: FollowRelationship) -> FollowUser? {
        guard let key = CacheKey.current(namespace: "profiles", key: relationship.userID),
              let cached: CachedSnapshot<PublicProfile> = AppCacheRepository.shared.cachedValue(for: key)
        else {
            return nil
        }

        var profile = cached.value
        let wasFollowedByMe = profile.followedByMe
        apply(relationship, to: &profile)
        if relationship.followerCount == nil, wasFollowedByMe != relationship.followedByMe {
            profile.followerCount = max(
                0,
                profile.followerCount + (relationship.followedByMe ? 1 : -1)
            )
        }
        AppCacheRepository.shared.save(profile, for: key, policy: .profile)
        return profile.followUser
    }

    private func updateCurrentUserFollowCaches(
        with relationship: FollowRelationship,
        user: FollowUser?
    ) {
        guard let currentUserID = AuthManager.shared.currentUser?.userID else { return }
        updateCachedList(
            key: CacheKey.current(namespace: "follows", key: "\(currentUserID).followers"),
            relationship: relationship,
            user: user,
            controlsMembership: false
        )
        updateCachedList(
            key: CacheKey.current(namespace: "follows", key: "\(currentUserID).following"),
            relationship: relationship,
            user: user,
            controlsMembership: true
        )
    }

    private func updateCachedList(
        key: CacheKey?,
        relationship: FollowRelationship,
        user: FollowUser?,
        controlsMembership: Bool
    ) {
        guard let key,
              let cached: CachedSnapshot<FollowUsersPage> = AppCacheRepository.shared.cachedValue(for: key)
        else {
            return
        }

        let page = cached.value
        var users = page.users
        var didChange = false
        if let index = users.firstIndex(where: { $0.userID == relationship.userID }) {
            if controlsMembership && !relationship.followedByMe {
                users.remove(at: index)
                didChange = true
            } else {
                let wasFollowedByMe = users[index].followedByMe
                apply(relationship, to: &users[index])
                if relationship.followerCount == nil,
                   wasFollowedByMe != relationship.followedByMe {
                    users[index].followerCount = max(
                        0,
                        users[index].followerCount + (relationship.followedByMe ? 1 : -1)
                    )
                }
                didChange = true
            }
        } else if controlsMembership, relationship.followedByMe, var user {
            apply(relationship, to: &user)
            users.insert(user, at: 0)
            didChange = true
        } else if controlsMembership, relationship.followedByMe {
            AppCacheRepository.shared.invalidate(key)
            return
        }
        guard didChange else { return }

        AppCacheRepository.shared.save(
            FollowUsersPage(users: users, hasMore: page.hasMore, nextPage: page.nextPage),
            for: key,
            policy: .profile
        )
    }

    private func apply(_ relationship: FollowRelationship, to profile: inout PublicProfile) {
        profile.followedByMe = relationship.followedByMe
        profile.followsMe = relationship.followsMe
        profile.isFriend = relationship.isFriend
        if let followRequested = relationship.followRequested {
            profile.followRequested = followRequested
        } else if relationship.followedByMe {
            profile.followRequested = false
        }
        if let followerCount = relationship.followerCount {
            profile.followerCount = followerCount
        }
        if let followingCount = relationship.followingCount {
            profile.followingCount = followingCount
        }
    }

    private func apply(_ relationship: FollowRelationship, to user: inout FollowUser) {
        user.followedByMe = relationship.followedByMe
        user.followsMe = relationship.followsMe
        user.isFriend = relationship.isFriend
        if let followerCount = relationship.followerCount {
            user.followerCount = followerCount
        }
        if let followingCount = relationship.followingCount {
            user.followingCount = followingCount
        }
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
        try await getConversationSyncSnapshot().conversations
    }

    func getConversationSyncSnapshot() async throws -> ConversationSyncSnapshot {
        let response: APIResponseWrapper<ConversationSyncSnapshot> = try await get(
            path: "/chat/conversations",
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        return try response.requiredData()
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

    func clearDirectMessageHistory(contactID: String) async throws -> DirectHistoryClearReceipt {
        guard let url = URL(
            string: baseURL + "/chat/messages/\(Self.pathComponent(contactID))/history"
        ) else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue(UUID().uuidString, forHTTPHeaderField: "Idempotency-Key")
        addAuthHeader(&request)
        let response: APIResponseWrapper<DirectHistoryClearReceipt> = try await perform(request)
        let receipt = try response.requiredData()
        guard receipt.conversationID.isBlank else { return receipt }
        return DirectHistoryClearReceipt(
            conversationID: contactID,
            clearedBeforeMessageID: receipt.clearedBeforeMessageID,
            clearedAt: receipt.clearedAt,
            revision: receipt.revision
        )
    }

    func getMessageContext(
        contactID: String,
        messageID: Int,
        before: Int = 20,
        after: Int = 20
    ) async throws -> [Message] {
        struct ContextData: Decodable {
            let messages: [Message]
        }
        let response: APIResponseWrapper<ContextData> = try await get(
            path: "/chat/messages/\(contactID)/\(messageID)/context",
            queryItems: [
                URLQueryItem(name: "before", value: "\(before)"),
                URLQueryItem(name: "after", value: "\(after)")
            ]
        )
        return try response.requiredData().messages
    }

    func recallMessage(contactID: String, messageID: Int) async throws -> Message {
        let response: APIResponseWrapper<Message> = try await postJSON(
            path: "/chat/messages/\(Self.pathComponent(contactID))/\(messageID)/recall",
            body: [:]
        )
        return try response.requiredData()
    }

    func markMessagesAsRead(
        contactID: String,
        throughMessageID: Int? = nil,
        idempotencyKey: UUID = UUID()
    ) async throws -> ConversationReadReceipt? {
        var body: [String: Any] = ["idempotency_key": idempotencyKey.uuidString]
        if let throughMessageID { body["through_message_id"] = throughMessageID }
        let response: APIResponseWrapper<ConversationReadReceipt> = try await postJSON(
            path: "/chat/messages/\(contactID)/read",
            body: body
        )
        return response.data
    }

    func markGroupMessagesAsRead(
        groupID: Int,
        throughMessageID: Int? = nil,
        idempotencyKey: UUID = UUID()
    ) async throws -> ConversationReadReceipt? {
        var body: [String: Any] = ["idempotency_key": idempotencyKey.uuidString]
        if let throughMessageID { body["through_message_id"] = throughMessageID }
        let response: APIResponseWrapper<ConversationReadReceipt> = try await postJSON(
            path: "/groups/\(groupID)/messages/read",
            body: body
        )
        return response.data
    }

    func sendTextMessage(
        receiverID: String,
        content: String,
        replyToID: Int? = nil,
        clientMessageID: String? = nil
    ) async throws -> Message {
        var body: [String: Any] = [
            "receiver_id": receiverID,
            "content": content,
        ]
        if let replyID = replyToID {
            body["reply_to_id"] = replyID
        }
        if let clientMessageID {
            body["client_message_id"] = clientMessageID
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
        replyToID: Int? = nil,
        clientMessageID: String? = nil
    ) async throws -> Message {
        var body: [String: Any] = [
            "receiver_id": receiverID,
            "pack_id": packID,
            "sticker_id": stickerID
        ]
        if let replyToID {
            body["reply_to_id"] = replyToID
        }
        if let clientMessageID {
            body["client_message_id"] = clientMessageID
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

    func sendGiftMessage(
        receiverID: String,
        giftID: String,
        idempotencyKey: UUID
    ) async throws -> Message {
        let body: [String: Any] = [
            "receiver_id": receiverID,
            "recipient_id": receiverID,
            "gift_id": giftID,
            "idempotency_key": idempotencyKey.uuidString
        ]
        let response: APIResponseWrapper<GiftDirectMessageResponseData> = try await postJSON(
            path: "/chat/messages/gift",
            body: body,
            idempotencyKey: idempotencyKey
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        if let charge = data.charge {
            WalletStore.shared.applyServerBalance(charge.walletBalance)
            WalletTelemetry.recordMixedCharge(charge, operation: "gift_direct")
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
            payload["gold_coin_amount"] = fixed.price
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

    func sendImageMessage(
        receiverID: String,
        imageData: Data,
        filename: String,
        clientMessageID: String? = nil
    ) async throws -> Message {
        let compressed = Self.compressImageForUpload(imageData)
        let response: APIResponseWrapper<Message> = try await uploadImage(
            path: "/chat/messages/image",
            fieldName: "receiver_id",
            fieldValue: receiverID,
            imageData: compressed,
            filename: filename,
            additionalFields: clientMessageID.map { ["client_message_id": $0] } ?? [:]
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendImageMessage(
        receiverID: String,
        imageFileURL: URL,
        filename: String,
        job: OutgoingJob,
        part: OutgoingPart
    ) async throws -> Message {
        // The durable/file-backed path is the one used by the chat UI. Keep
        // the upload policy here as a final guard so restored outbox jobs and
        // callers that did not originate in PhotosPicker cannot bypass image
        // resizing and the byte cap.
        let files = try await Self.preparedChatImageFilesForUpload(imageFileURL)
        let response: APIResponseWrapper<Message> = try await legacyBackgroundMultipartUpload(
            path: "/chat/messages/image",
            textFields: [
                LegacyMultipartTextField(name: "receiver_id", value: receiverID),
                LegacyMultipartTextField(name: "client_message_id", value: job.clientRequestID)
            ],
            fileFields: [
                LegacyMultipartFileField(
                    name: "image",
                    filename: filename,
                    mimeType: "image/jpeg",
                    fileURL: files.original
                ),
                LegacyMultipartFileField(
                    name: "thumbnail",
                    filename: Self.chatThumbnailFilename(for: filename),
                    mimeType: "image/jpeg",
                    fileURL: files.thumbnail
                )
            ],
            job: job,
            part: part,
            timeout: 180
        )
        return try response.requiredData()
    }

    func sendVideoMessage(
        receiverID: String,
        videoData: Data,
        filename: String,
        clientMessageID: String? = nil
    ) async throws -> Message {
        let response: APIResponseWrapper<Message> = try await uploadVideo(
            path: "/chat/messages/video",
            fieldName: "receiver_id",
            fieldValue: receiverID,
            videoData: videoData,
            filename: filename,
            additionalFields: clientMessageID.map { ["client_message_id": $0] } ?? [:]
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendVideoMessage(
        receiverID: String,
        videoFileURL: URL,
        filename: String,
        job: OutgoingJob,
        part: OutgoingPart
    ) async throws -> Message {
        let thumbnailURL = try await Self.preparedChatVideoThumbnailFileForUpload(videoFileURL)
        let response: APIResponseWrapper<Message> = try await legacyBackgroundMultipartUpload(
            path: "/chat/messages/video",
            textFields: [
                LegacyMultipartTextField(name: "receiver_id", value: receiverID),
                LegacyMultipartTextField(name: "client_message_id", value: job.clientRequestID)
            ],
            fileFields: [
                LegacyMultipartFileField(
                    name: "video",
                    filename: filename,
                    mimeType: Self.videoMIMEType(filename: filename),
                    fileURL: videoFileURL
                ),
                LegacyMultipartFileField(
                    name: "thumbnail",
                    filename: Self.chatThumbnailFilename(for: filename),
                    mimeType: "image/jpeg",
                    fileURL: thumbnailURL
                )
            ],
            job: job,
            part: part,
            timeout: 600
        )
        return try response.requiredData()
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
        let response: APIResponseWrapper<MapPresenceResponseData> = try await get(
            path: "/map/me",
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        guard let presence = response.data?.presence else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return presence
    }

    func updateMapLocation(
        latitude: Double,
        longitude: Double,
        accuracyM: Double?,
        source: MapLocationRecordSource,
        eventID: String,
        recordedAt: Date
    ) async throws -> MapPresence {
        var body: [String: Any] = [
            "latitude": latitude,
            "longitude": longitude,
            "source": source.rawValue,
            "event_id": eventID,
            "recorded_at": ISO8601DateFormatter().string(from: recordedAt)
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
            queryItems: queryItems,
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        let data = try response.requiredData()
        guard data.belongsToViewer(AuthManager.shared.currentUser?.userID) else {
            throw APIError.invalidResponse
        }
        return data
    }

    /// Loads every account that the backend can place on the public map.
    /// This collection endpoint intentionally has no radius, relationship,
    /// visibility-scope, online-status, or client-side result-limit parameter.
    func getAllMapUsers(lat: Double?, lng: Double?) async throws -> MapUsersResponseData {
        var queryItems: [URLQueryItem] = []
        if let lat {
            queryItems.append(URLQueryItem(name: "lat", value: "\(lat)"))
        }
        if let lng {
            queryItems.append(URLQueryItem(name: "lng", value: "\(lng)"))
        }

        let response: APIResponseWrapper<MapUsersResponseData> = try await get(
            path: "/map/users",
            queryItems: queryItems,
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        let data = try response.requiredData()
        guard data.belongsToViewer(AuthManager.shared.currentUser?.userID) else {
            throw APIError.invalidResponse
        }
        return data
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
            queryItems: queryItems,
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        let data = try response.requiredData()
        guard data.belongsToViewer(AuthManager.shared.currentUser?.userID) else {
            throw APIError.invalidResponse
        }
        return data
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
            queryItems: queryItems,
            cachePolicy: .reloadIgnoringLocalCacheData
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

    func getGroupMessageContext(
        groupID: Int,
        messageID: Int,
        before: Int = 20,
        after: Int = 20
    ) async throws -> [GroupMessage] {
        struct ContextData: Decodable {
            let messages: [GroupMessage]
        }
        let response: APIResponseWrapper<ContextData> = try await get(
            path: "/groups/\(groupID)/messages/\(messageID)/context",
            queryItems: [
                URLQueryItem(name: "before", value: "\(before)"),
                URLQueryItem(name: "after", value: "\(after)")
            ]
        )
        return try response.requiredData().messages
    }

    func recallGroupMessage(groupID: Int, messageID: Int) async throws -> GroupMessage {
        let response: APIResponseWrapper<GroupMessage> = try await postJSON(
            path: "/groups/\(groupID)/messages/\(messageID)/recall",
            body: [:]
        )
        return try response.requiredData()
    }

    func sendGroupText(
        groupID: Int,
        content: String,
        replyToID: Int? = nil,
        mentions: [String] = [],
        mentionAll: Bool = false,
        clientMessageID: String? = nil
    ) async throws -> GroupMessage {
        var body: [String: Any] = ["content": content]
        if let replyID = replyToID {
            body["reply_to_id"] = replyID
        }
        if !mentions.isEmpty {
            body["mentions"] = mentions
        }
        if mentionAll {
            body["mention_all"] = true
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

    func sendGroupGift(
        groupID: Int,
        recipientID: String,
        giftID: String,
        idempotencyKey: UUID
    ) async throws -> GroupMessage {
        let body: [String: Any] = [
            "recipient_id": recipientID,
            "receiver_id": recipientID,
            "gift_id": giftID,
            "idempotency_key": idempotencyKey.uuidString
        ]
        let response: APIResponseWrapper<GiftGroupMessageResponseData> = try await postJSON(
            path: "/groups/\(groupID)/messages/gift",
            body: body,
            idempotencyKey: idempotencyKey
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        if let charge = data.charge {
            WalletStore.shared.applyServerBalance(charge.walletBalance)
            WalletTelemetry.recordMixedCharge(charge, operation: "gift_group")
        }
        return Self.normalizedGroupGiftMessage(
            data.message,
            groupID: groupID,
            recipientID: recipientID,
            giftID: giftID,
            fallbackContent: data.fallbackContent
        )
    }

    func sendGroupImage(
        groupID: Int,
        imageData: Data,
        filename: String,
        clientMessageID: String? = nil
    ) async throws -> GroupMessage {
        let compressed = Self.compressImageForUpload(imageData)
        let response: APIResponseWrapper<GroupMessage> = try await uploadImage(
            path: "/groups/\(groupID)/messages/image",
            fieldName: nil,
            fieldValue: nil,
            imageData: compressed,
            filename: filename,
            additionalFields: clientMessageID.map { ["client_message_id": $0] } ?? [:]
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendGroupImage(
        groupID: Int,
        imageFileURL: URL,
        filename: String,
        job: OutgoingJob,
        part: OutgoingPart
    ) async throws -> GroupMessage {
        let files = try await Self.preparedChatImageFilesForUpload(imageFileURL)
        let response: APIResponseWrapper<GroupMessage> = try await legacyBackgroundMultipartUpload(
            path: "/groups/\(groupID)/messages/image",
            textFields: [LegacyMultipartTextField(name: "client_message_id", value: job.clientRequestID)],
            fileFields: [
                LegacyMultipartFileField(
                    name: "image",
                    filename: filename,
                    mimeType: "image/jpeg",
                    fileURL: files.original
                ),
                LegacyMultipartFileField(
                    name: "thumbnail",
                    filename: Self.chatThumbnailFilename(for: filename),
                    mimeType: "image/jpeg",
                    fileURL: files.thumbnail
                )
            ],
            job: job,
            part: part,
            timeout: 180
        )
        return try response.requiredData()
    }

    func sendGroupVideo(
        groupID: Int,
        videoData: Data,
        filename: String,
        clientMessageID: String? = nil
    ) async throws -> GroupMessage {
        let response: APIResponseWrapper<GroupMessage> = try await uploadVideo(
            path: "/groups/\(groupID)/messages/video",
            fieldName: nil,
            fieldValue: nil,
            videoData: videoData,
            filename: filename,
            additionalFields: clientMessageID.map { ["client_message_id": $0] } ?? [:]
        )
        guard let msg = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return msg
    }

    func sendGroupVideo(
        groupID: Int,
        videoFileURL: URL,
        filename: String,
        job: OutgoingJob,
        part: OutgoingPart
    ) async throws -> GroupMessage {
        let thumbnailURL = try await Self.preparedChatVideoThumbnailFileForUpload(videoFileURL)
        let response: APIResponseWrapper<GroupMessage> = try await legacyBackgroundMultipartUpload(
            path: "/groups/\(groupID)/messages/video",
            textFields: [LegacyMultipartTextField(name: "client_message_id", value: job.clientRequestID)],
            fileFields: [
                LegacyMultipartFileField(
                    name: "video",
                    filename: filename,
                    mimeType: Self.videoMIMEType(filename: filename),
                    fileURL: videoFileURL
                ),
                LegacyMultipartFileField(
                    name: "thumbnail",
                    filename: Self.chatThumbnailFilename(for: filename),
                    mimeType: "image/jpeg",
                    fileURL: thumbnailURL
                )
            ],
            job: job,
            part: part,
            timeout: 600
        )
        return try response.requiredData()
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

    func getGroupNotificationSettings(groupID: Int) async throws -> GroupNotificationSettings {
        let response: APIResponseWrapper<GroupNotificationSettings> = try await get(
            path: "/groups/\(groupID)/notification-settings",
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        return try response.requiredData()
    }

    func updateGroupNotificationSettings(
        groupID: Int,
        isMuted: Bool? = nil,
        notifyMentionsMe: Bool? = nil,
        notifyMentionsAll: Bool? = nil,
        importantMemberIDs: [String]? = nil
    ) async throws -> GroupNotificationSettings {
        var body: [String: Any] = [:]
        if let isMuted { body["muted"] = isMuted }
        if let notifyMentionsMe { body["notify_mentions_me"] = notifyMentionsMe }
        if let notifyMentionsAll { body["notify_mentions_all"] = notifyMentionsAll }
        if let importantMemberIDs { body["important_member_ids"] = importantMemberIDs }
        guard !body.isEmpty else {
            return try await getGroupNotificationSettings(groupID: groupID)
        }

        let response: APIResponseWrapper<GroupNotificationSettings> = try await patchJSON(
            path: "/groups/\(groupID)/notification-settings",
            body: body
        )
        return try response.requiredData()
    }

    func updateGroupViewerSettings(
        groupID: Int,
        remark: String? = nil,
        showMemberNicknames: Bool? = nil
    ) async throws -> GroupViewerSettings {
        var body: [String: Any] = [:]
        if let remark { body["remark"] = remark }
        if let showMemberNicknames { body["show_member_nicknames"] = showMemberNicknames }
        guard !body.isEmpty else {
            return try await getGroupDetail(groupID: groupID).viewerSettings
        }
        let response: APIResponseWrapper<GroupViewerSettings> = try await patchJSON(
            path: "/groups/\(groupID)/viewer-settings",
            body: body
        )
        return try response.requiredData()
    }

    func updateMyGroupNickname(groupID: Int, nickname: String) async throws -> GroupMember {
        let response: APIResponseWrapper<GroupMember> = try await patchJSON(
            path: "/groups/\(groupID)/members/me",
            body: ["nickname": nickname]
        )
        return try response.requiredData()
    }

    func updateGroupAnnouncement(
        groupID: Int,
        title: String,
        content: String
    ) async throws -> GroupAnnouncement {
        let response: APIResponseWrapper<GroupAnnouncement> = try await putJSON(
            path: "/groups/\(groupID)/announcement",
            body: ["title": title, "content": content]
        )
        return try response.requiredData()
    }

    func createGroupInvite(groupID: Int) async throws -> GroupInvite {
        let response: APIResponseWrapper<GroupInvite> = try await postJSON(
            path: "/groups/\(groupID)/invites",
            body: ["expires_in_days": 7],
            idempotencyKey: UUID()
        )
        return try response.requiredData()
    }

    func revokeGroupInvite(groupID: Int, inviteID: String) async throws {
        guard let url = URL(
            string: baseURL + "/groups/\(groupID)/invites/\(Self.pathComponent(inviteID))"
        ) else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        try await performNoContent(request)
    }

    func getGroupInvitePreview(token: String) async throws -> GroupInvitePreview {
        let response: APIResponseWrapper<GroupInvitePreview> = try await get(
            path: "/group-invites/\(Self.pathComponent(token))",
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        return try response.requiredData()
    }

    func acceptGroupInvite(token: String) async throws -> GroupInviteAcceptResult {
        let response: APIResponseWrapper<GroupInviteAcceptResult> = try await postJSON(
            path: "/group-invites/\(Self.pathComponent(token))/accept",
            body: [:],
            idempotencyKey: UUID()
        )
        return try response.requiredData()
    }

    func searchGroupMessages(
        groupID: Int,
        query: String,
        senderID: String? = nil,
        messageType: String? = nil,
        from: Date? = nil,
        to: Date? = nil,
        cursor: String? = nil,
        limit: Int = 30
    ) async throws -> GroupMessageSearchPage {
        var queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(max(1, min(limit, 100))))
        ]
        if let senderID, !senderID.isBlank {
            queryItems.append(URLQueryItem(name: "sender_id", value: senderID))
        }
        if let messageType, !messageType.isBlank {
            queryItems.append(URLQueryItem(name: "message_type", value: messageType))
        }
        let formatter = ISO8601DateFormatter()
        if let from { queryItems.append(URLQueryItem(name: "from", value: formatter.string(from: from))) }
        if let to { queryItems.append(URLQueryItem(name: "to", value: formatter.string(from: to))) }
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        let response: APIResponseWrapper<GroupMessageSearchPage> = try await get(
            path: "/groups/\(groupID)/messages/search",
            queryItems: queryItems,
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        return try response.requiredData()
    }

    func clearGroupMessageHistory(groupID: Int) async throws -> GroupHistoryClearReceipt {
        guard let url = URL(string: baseURL + "/groups/\(groupID)/messages/history") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue(UUID().uuidString, forHTTPHeaderField: "Idempotency-Key")
        addAuthHeader(&request)
        let response: APIResponseWrapper<GroupHistoryClearReceipt> = try await perform(request)
        return try response.requiredData()
    }

    func reportGroup(groupID: Int, reason: String, detail: String?) async throws {
        var body: [String: Any] = ["reason": reason]
        if let detail, !detail.isBlank { body["detail"] = detail }
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/groups/\(groupID)/reports",
            body: body,
            idempotencyKey: UUID()
        )
    }

    func updateConversationPreference(
        conversationType: String,
        targetID: String,
        isPinned: Bool
    ) async throws -> ConversationPreference {
        let response: APIResponseWrapper<ConversationPreference> = try await putJSON(
            path: "/chat/conversations/\(Self.pathComponent(conversationType))/\(Self.pathComponent(targetID))/preferences",
            body: ["is_pinned": isPinned, "is_hidden": false]
        )
        return try response.requiredData()
    }

    func hideConversation(conversationType: String, targetID: String) async throws -> ConversationPreference {
        let response: APIResponseWrapper<ConversationPreference> = try await putJSON(
            path: "/chat/conversations/\(Self.pathComponent(conversationType))/\(Self.pathComponent(targetID))/preferences",
            body: ["is_pinned": false, "is_hidden": true]
        )
        return try response.requiredData()
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

    /// Idempotent authenticated fallback for lifecycle events that are also
    /// sent over WebSocket. This keeps hang-up/reject/busy reliable while the
    /// signaling socket is reconnecting or refreshing its access token.
    func endCall(callID: String) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/call/\(callID)/end",
            body: [:]
        )
    }

    func rejectCall(callID: String) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/call/\(callID)/reject",
            body: [:]
        )
    }

    func markCallBusy(callID: String) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/call/\(callID)/busy",
            body: [:]
        )
    }

    // MARK: One-to-one live call invitations

    func getOneToOneLiveSlots(
        filter: String,
        cursor: String? = nil,
        limit: Int = 30
    ) async throws -> OneToOneLiveSlotPage {
        var queryItems = [
            URLQueryItem(name: "filter", value: filter),
            URLQueryItem(name: "limit", value: String(limit))
        ]
        if let cursor, !cursor.isEmpty {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        guard var components = URLComponents(string: baseURL + "/one-to-one-live/slots") else {
            throw APIError.invalidURL
        }
        components.queryItems = queryItems
        guard let url = components.url else {
            throw APIError.invalidURL
        }
        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 15
        )
        request.httpMethod = "GET"
        request.setValue("no-cache, no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")
        addAuthHeader(&request)
        let response: APIResponseWrapper<OneToOneLiveSlotPage> = try await perform(request)
        return try response.requiredData()
    }

    func getCurrentOneToOneLiveSlot() async throws -> OneToOneLiveSlot? {
        let response: APIResponseWrapper<OneToOneLiveCurrentSlotData> = try await get(
            path: "/one-to-one-live/slots/me/current",
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        return response.data?.slot
    }

    func createOneToOneLiveSlot(
        characterSetting: String,
        liveAvatarAssetID: String?,
        allowedCallTypes: [CallType],
        idempotencyKey: UUID
    ) async throws -> OneToOneLiveSlot {
        var body: [String: Any] = [
            "character_setting": characterSetting,
            "allowed_call_types": LiveSlotCallTypePolicy.normalized(allowedCallTypes).map(\.rawValue),
            "idempotency_key": idempotencyKey.uuidString
        ]
        if let liveAvatarAssetID,
           !liveAvatarAssetID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["live_avatar_asset_id"] = liveAvatarAssetID
        }
        let response: APIResponseWrapper<OneToOneLiveSlotCreationData> = try await postJSON(
            path: "/one-to-one-live/slots",
            body: body,
            idempotencyKey: idempotencyKey
        )
        return try response.requiredData().slot
    }

    func uploadOneToOneLiveAvatar(
        imageData: Data,
        idempotencyKey: UUID
    ) async throws -> OneToOneLiveAvatarUpload {
        let compressed = Self.compressImageForUpload(
            imageData,
            maxDimension: 1024,
            quality: 0.82,
            maxBytes: 1_000_000
        )
        let response: APIResponseWrapper<OneToOneLiveAvatarUpload> = try await uploadImage(
            path: "/one-to-one-live/assets/avatar",
            fieldName: nil,
            fieldValue: nil,
            imageFieldName: "file",
            imageData: compressed,
            filename: "live-avatar.jpg",
            idempotencyKey: idempotencyKey
        )
        guard let data = response.data,
              !data.assetID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !data.liveAvatarURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func deleteOneToOneLiveSlot(slotID: String, idempotencyKey: UUID) async throws {
        guard let url = URL(string: baseURL + "/one-to-one-live/slots/\(Self.pathComponent(slotID))") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue(idempotencyKey.uuidString, forHTTPHeaderField: "Idempotency-Key")
        addAuthHeader(&request)
        let _: APIResponseWrapper<EmptyData> = try await perform(request)
    }

    func heartbeatOneToOneLiveSlot(slotID: String) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/one-to-one-live/slots/\(Self.pathComponent(slotID))/heartbeat",
            body: [:]
        )
    }

    func requestOneToOneLiveCall(
        slotID: String,
        callType: CallType,
        paymentMethod: LiveCallPaymentMethod = .spendableBalance,
        idempotencyKey: UUID = UUID()
    ) async throws -> LiveCallInvitationResponse {
        let invitation = LiveCallInvitationRequest(
            callType: callType,
            paymentMethod: paymentMethod,
            idempotencyKey: idempotencyKey
        )
        let response: APIResponseWrapper<LiveCallInvitationResponse> = try await postJSON(
            path: "/one-to-one-live/slots/\(slotID)/invite",
            body: invitation.body,
            idempotencyKey: invitation.idempotencyKey
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func acceptOneToOneLiveCall(callID: String) async throws -> CallJoinResponse {
        let response: APIResponseWrapper<CallJoinResponse> = try await postJSON(
            path: "/one-to-one-live/calls/\(callID)/accept",
            body: [:]
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func joinAcceptedOneToOneLiveCall(callID: String) async throws -> CallJoinResponse {
        let response: APIResponseWrapper<CallJoinResponse> = try await postJSON(
            path: "/one-to-one-live/calls/\(callID)/join",
            body: [:]
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func getOneToOneLiveCallState(callID: String) async throws -> OneToOneLiveCallState {
        let response: APIResponseWrapper<OneToOneLiveCallState> = try await get(
            path: "/one-to-one-live/calls/\(Self.pathComponent(callID))",
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        return try response.requiredData()
    }

    func rejectOneToOneLiveCall(callID: String, reason: String) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/one-to-one-live/calls/\(callID)/reject",
            body: ["reason": reason]
        )
    }

    func cancelOneToOneLiveCall(callID: String) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/one-to-one-live/calls/\(callID)/cancel",
            body: [:]
        )
    }

    func startAgentOneToOneLiveMatch(
        roleSetting: String,
        sourceAgentID: String,
        clientMatchID: String
    ) async throws -> AgentLiveMatchResponse {
        let response: APIResponseWrapper<AgentLiveMatchResponse> = try await postJSON(
            path: "/one-to-one-live/matches",
            body: [
                "role_setting": roleSetting,
                "source_agent_id": sourceAgentID,
                "client_match_id": clientMatchID
            ]
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func cancelAgentOneToOneLiveMatch(matchID: String) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/one-to-one-live/matches/\(matchID)/cancel",
            body: [:]
        )
    }

    func reportCallQuality(callID: String, report: CallQualityReport) async throws {
        let _: APIResponseWrapper<EmptyData> = try await postJSON(
            path: "/call/\(callID)/quality-report",
            body: report.body
        )
    }

    func startGroupCall(groupID: Int, callType: String) async throws -> CallStartResponse {
        let body: [String: Any] = ["call_type": callType]
        let response: APIResponseWrapper<CallStartResponse> = try await postJSON(path: "/call/group/\(groupID)/start", body: body)
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func leaveGroupCall(groupID: Int, callID: String? = nil, roomName: String? = nil) async throws {
        var body: [String: Any] = [:]
        if let callID, !callID.isEmpty { body["call_id"] = callID }
        if let roomName, !roomName.isEmpty { body["room_name"] = roomName }
        let _: APIResponseWrapper<EmptyData> = try await postJSON(path: "/call/group/\(groupID)/leave", body: body)
    }

    func getGroupCallStatus(groupID: Int) async throws -> GroupCallStatusResponse {
        let response: APIResponseWrapper<GroupCallStatusResponse> = try await get(path: "/call/group/\(groupID)/status")
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    // MARK: - Chat Forwarding

    func forwardMessages(_ requestBody: ForwardRequest) async throws -> ForwardOperationResult {
        let response: APIResponseWrapper<ForwardOperationResult> = try await sendEncodable(
            method: "POST",
            path: "/chat/forwards",
            body: requestBody,
            idempotencyKey: requestBody.clientOperationID
        )
        return try response.requiredData()
    }

    func getForwardBundle(bundleID: String) async throws -> ForwardBundle {
        let response: APIResponseWrapper<ForwardBundle> = try await get(
            path: "/chat/forward-bundles/\(Self.pathComponent(bundleID))"
        )
        return try response.requiredData()
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
        let relationship = response.data ?? FollowRelationship(userID: userID, followedByMe: true)
        return FollowRelationshipStore.shared.apply(relationship, targetUserID: userID)
    }

    func unfollowUser(userID: String) async throws -> FollowRelationship {
        guard let url = URL(string: baseURL + "/follows/\(Self.pathComponent(userID))") else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        let response: APIResponseWrapper<FollowRelationship> = try await perform(request)
        let relationship = response.data ?? FollowRelationship(userID: userID, followedByMe: false)
        return FollowRelationshipStore.shared.apply(relationship, targetUserID: userID)
    }

    func getFollowRelationship(userID: String) async throws -> FollowRelationship {
        let response: APIResponseWrapper<FollowRelationship> = try await get(
            path: "/follows/\(Self.pathComponent(userID))/relationship"
        )
        let relationship = response.data ?? FollowRelationship(userID: userID, followedByMe: false)
        return FollowRelationshipStore.shared.apply(relationship, targetUserID: userID)
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

    func getPropBag() async throws -> PropBagPage {
        let response: APIResponseWrapper<PropBagPage> = try await get(
            path: "/me/prop-bag",
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        return try response.requiredData()
    }

    func getWalletTransactionPage(
        cursor: String? = nil,
        limit: Int = 50
    ) async throws -> WalletTransactionsResponseData {
        var queryItems = [
            URLQueryItem(name: "limit", value: String(max(1, min(limit, 100))))
        ]
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        let response: APIResponseWrapper<WalletTransactionsResponseData> = try await get(
            path: "/wallet/transactions",
            queryItems: queryItems,
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        return try response.requiredData()
    }

    func getActivityCatFoodTransactions(
        cursor: String? = nil,
        limit: Int = 20
    ) async throws -> ActivityCatFoodTransactionPage {
        var queryItems = [
            URLQueryItem(name: "limit", value: String(max(1, min(limit, 50))))
        ]
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        let response: APIResponseWrapper<ActivityCatFoodTransactionPage> = try await get(
            path: "/wallet/activity-cat-food/transactions",
            queryItems: queryItems,
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        return try response.requiredData()
    }

    func getWalletAdRewardStatus() async throws -> WalletAdRewardStatusResponseData {
        let response: APIResponseWrapper<WalletAdRewardStatusResponseData> = try await get(
            path: "/wallet/ad-rewards/status"
        )
        return try response.requiredData()
    }

    func createWalletAdRewardSession(adUnitID: String) async throws -> WalletAdRewardSessionResponseData {
        let response: APIResponseWrapper<WalletAdRewardSessionResponseData> = try await postJSON(
            path: "/wallet/ad-rewards/sessions",
            body: [
                "platform": "ios",
                "ad_unit_id": adUnitID,
                "reward_item": WalletCurrency.goldCoins.rawValue
            ]
        )
        return try response.requiredData()
    }

    // MARK: Activity Center

    func getActivityCenter() async throws -> ActivityCenterSnapshot {
        let response: APIResponseWrapper<ActivityCenterSnapshot> = try await get(
            path: "/activity-center",
            cachePolicy: .reloadIgnoringLocalCacheData
        )
        return try response.requiredData()
    }

    func claimActivityCheckIn(idempotencyKey: UUID) async throws -> ActivityCenterGrantResult {
        let response: APIResponseWrapper<ActivityCenterGrantResult> = try await postJSON(
            path: "/activity-center/check-in/claim",
            body: [:],
            idempotencyKey: idempotencyKey
        )
        return try response.requiredData()
    }

    func claimActivityMeal(
        windowID: String,
        idempotencyKey: UUID
    ) async throws -> ActivityCenterGrantResult {
        let response: APIResponseWrapper<ActivityCenterGrantResult> = try await postJSON(
            path: "/activity-center/meals/\(Self.pathComponent(windowID))/claim",
            body: [:],
            idempotencyKey: idempotencyKey
        )
        return try response.requiredData()
    }

    func spinActivityWheel(
        configVersion: String,
        tierID: String,
        idempotencyKey: UUID
    ) async throws -> ActivityWheelSpinEnvelope {
        let response: APIResponseWrapper<ActivityWheelSpinEnvelope> = try await postJSON(
            path: "/activity-center/wheel/spins",
            body: [
                "expected_config_version": configVersion,
                "tier_id": tierID
            ],
            idempotencyKey: idempotencyKey
        )
        return try response.requiredData()
    }

    func createActivityContactDiscoverySession() async throws -> ActivityContactDiscoverySession {
        let response: APIResponseWrapper<ActivityContactDiscoverySession> = try await postJSON(
            path: "/activity-center/contact-discovery/sessions",
            body: [:],
            containsSensitiveResponse: true
        )
        return try response.requiredData()
    }

    func matchActivityContacts(
        sessionID: String,
        saltVersion: String,
        phoneHashes: [String],
        idempotencyKey: UUID
    ) async throws -> ActivityContactMatchResult {
        let response: APIResponseWrapper<ActivityContactMatchResult> = try await postJSON(
            path: "/activity-center/contact-discovery/sessions/\(Self.pathComponent(sessionID))/match",
            body: [
                "salt_version": saltVersion,
                "phone_hashes": phoneHashes
            ],
            idempotencyKey: idempotencyKey,
            containsSensitiveResponse: true
        )
        return try response.requiredData()
    }

    func createActivityInviteShareSession() async throws -> ActivityInviteShareSession {
        let response: APIResponseWrapper<ActivityInviteShareSession> = try await postJSON(
            path: "/activity-center/invite-share-sessions",
            body: [:],
            containsSensitiveResponse: true
        )
        return try response.requiredData()
    }

    func completeActivityInviteShareSession(
        sessionID: String,
        idempotencyKey: UUID
    ) async throws -> ActivityCenterGrantResult {
        let response: APIResponseWrapper<ActivityCenterGrantResult> = try await postJSON(
            path: "/activity-center/invite-share-sessions/\(Self.pathComponent(sessionID))/complete",
            body: [:],
            idempotencyKey: idempotencyKey,
            containsSensitiveResponse: true
        )
        return try response.requiredData()
    }

    func redeemActivityInvite(
        codeOrToken: String,
        idempotencyKey: UUID
    ) async throws -> ActivityCenterSnapshot {
        let response: APIResponseWrapper<ActivityCenterSnapshot> = try await postJSON(
            path: "/activity-center/invites/redeem",
            body: ["code_or_token": codeOrToken],
            idempotencyKey: idempotencyKey,
            containsSensitiveResponse: true
        )
        return try response.requiredData()
    }

    func createActivityPhoneVerificationSession(
        e164Phone: String
    ) async throws -> ActivityPhoneVerificationSession {
        let response: APIResponseWrapper<ActivityPhoneVerificationSession> = try await postJSON(
            path: "/account/phone/verification-sessions",
            body: ["phone_e164": e164Phone],
            containsSensitiveResponse: true
        )
        return try response.requiredData()
    }

    func verifyActivityPhone(
        sessionID: String,
        code: String,
        idempotencyKey: UUID
    ) async throws -> ActivityCenterSnapshot {
        let response: APIResponseWrapper<ActivityCenterSnapshot> = try await postJSON(
            path: "/account/phone/verify",
            body: [
                "session_id": sessionID,
                "code": code
            ],
            idempotencyKey: idempotencyKey,
            containsSensitiveResponse: true
        )
        return try response.requiredData()
    }

    // MARK: Chat Money

    func getChatMoneyConfiguration() async throws -> ChatMoneyConfiguration {
        let response: APIResponseWrapper<ChatMoneyConfiguration> = try await get(
            path: "/wallet/chat-money/config"
        )
        return try response.requiredData()
    }

    func createRedPacket(_ request: CreateRedPacketRequest) async throws -> ChatMoneyCreationResult {
        var body: [String: Any] = [
            "client_message_id": request.clientMessageID,
            "scope": request.scope.rawValue,
            "mode": request.mode.rawValue,
            "total_amount": request.totalAmount,
            "packet_count": request.packetCount,
            "greeting": request.greeting
        ]
        if let receiverID = request.receiverID { body["receiver_id"] = receiverID }
        if let groupID = request.groupID { body["group_id"] = groupID }
        if let recipientID = request.recipientID { body["recipient_id"] = recipientID }
        if let recipientName = request.recipientName { body["recipient_name"] = recipientName }
        if let amountPerPacket = request.amountPerPacket { body["amount_per_packet"] = amountPerPacket }

        let response: APIResponseWrapper<ChatMoneyCreationResponseData> = try await postJSON(
            path: "/wallet/red-packets",
            body: body
        )
        return try response.requiredData().result()
    }

    func createTransfer(_ request: CreateTransferRequest) async throws -> ChatMoneyCreationResult {
        var body: [String: Any] = [
            "client_message_id": request.clientMessageID,
            "scope": request.scope.rawValue,
            "recipient_id": request.recipientID,
            "amount": request.amount,
            "note": request.note
        ]
        if let receiverID = request.receiverID { body["receiver_id"] = receiverID }
        if let groupID = request.groupID { body["group_id"] = groupID }
        if let recipientName = request.recipientName { body["recipient_name"] = recipientName }

        let response: APIResponseWrapper<ChatMoneyCreationResponseData> = try await postJSON(
            path: "/wallet/transfers",
            body: body
        )
        return try response.requiredData().result()
    }

    func getChatMoneyDetail(assetID: String) async throws -> ChatMoneyDetail {
        let response: APIResponseWrapper<ChatMoneyDetailResponseData> = try await get(
            path: "/wallet/chat-money/\(Self.pathComponent(assetID))"
        )
        return try response.requiredData().detail
    }

    func claimRedPacket(assetID: String) async throws -> ChatMoneyActionResult {
        let response: APIResponseWrapper<ChatMoneyActionResponseData> = try await postJSON(
            path: "/wallet/red-packets/\(Self.pathComponent(assetID))/claim",
            body: [:]
        )
        return try response.requiredData().result
    }

    func acceptTransfer(assetID: String) async throws -> ChatMoneyActionResult {
        let response: APIResponseWrapper<ChatMoneyActionResponseData> = try await postJSON(
            path: "/wallet/transfers/\(Self.pathComponent(assetID))/accept",
            body: [:]
        )
        return try response.requiredData().result
    }

    func returnTransfer(assetID: String) async throws -> ChatMoneyActionResult {
        let response: APIResponseWrapper<ChatMoneyActionResponseData> = try await postJSON(
            path: "/wallet/transfers/\(Self.pathComponent(assetID))/return",
            body: [:]
        )
        return try response.requiredData().result
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
        goldCoinAmount: Int,
        usdtAmount: String? = nil,
        payoutMethod: String? = nil,
        payoutAccount: String? = nil,
        network: String? = nil,
        walletAddress: String? = nil
    ) async throws -> WalletWithdrawal? {
        var body: [String: Any] = ["gold_coin_amount": goldCoinAmount]
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
        try await getPublicAgentsPage(limit: limit).agents
    }

    func getPublicAgentsPage(
        ownerUserID: String? = nil,
        cursor: String? = nil,
        limit: Int = 20
    ) async throws -> AgentSummaryPage {
        var queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let ownerUserID, !ownerUserID.isBlank {
            queryItems.append(URLQueryItem(name: "owner_user_id", value: ownerUserID))
        }
        if let cursor, !cursor.isBlank {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }

        let response: APIResponseWrapper<AgentSummaryPage> = try await get(
            path: "/agents/public",
            queryItems: queryItems
        )
        return try response.requiredData()
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

    func unlockAgentMedia(
        id: String,
        paymentMethod: MediaUnlockPaymentMethod,
        idempotencyKey: UUID
    ) async throws -> AgentMediaUnlock {
        let response: APIResponseWrapper<AgentMediaUnlock> = try await agentJSONRequest(
            method: "POST",
            path: "/agent-media/\(Self.pathComponent(id))/unlock",
            body: paymentMethod.requestBody,
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
        guard maxDimension > 0,
              maxBytes > 0,
              let source = CGImageSourceCreateWithData(data as CFData, nil)
        else { return data }

        // Avoid a second lossy JPEG pass when the picker already prepared the
        // photo. Reading ImageIO metadata does not decode the full-size bitmap.
        if data.count <= maxBytes,
           isJPEG(data),
           let pixelSize = imagePixelSize(source),
           max(pixelSize.width, pixelSize.height) <= maxDimension {
            return data
        }

        let minDimension = min(maxDimension, 640)
        var currentMaxDimension = maxDimension
        var bestData: Data?
        let qualitySteps = [quality, 0.65, 0.55, 0.45, 0.35]
            .map { min(max($0, 0.1), 1.0) }
            .reduce(into: [CGFloat]()) { result, value in
                if !result.contains(value) {
                    result.append(value)
                }
            }

        while true {
            // ImageIO creates a bounded thumbnail directly from the encoded
            // source. UIImage(data:) could otherwise decode a 48 MP photo into
            // hundreds of MB before it is resized.
            guard let resized = downsampledImage(
                source,
                maxDimension: currentMaxDimension
            ) else { break }

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

    /// Produces a JPEG sibling inside the durable outbox directory. The
    /// original remains available for the optimistic preview while the much
    /// smaller derivative is streamed by the background URLSession.
    nonisolated private static func preparedChatImageFilesForUpload(
        _ sourceURL: URL
    ) async throws -> (original: URL, thumbnail: URL) {
        try await Task.detached(priority: .utility) {
            let sourceData = try Data(contentsOf: sourceURL, options: .mappedIfSafe)
            let preparedData = compressImageForUpload(sourceData)
            let originalURL: URL
            if preparedData == sourceData {
                originalURL = sourceURL
            } else {
                originalURL = sourceURL
                    .deletingPathExtension()
                    .appendingPathExtension("upload.jpg")
                try preparedData.write(
                    to: originalURL,
                    options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
                )
            }

            let thumbnailData = compressImageForUpload(
                preparedData,
                maxDimension: 360,
                quality: 0.58,
                maxBytes: 140_000
            )
            let thumbnailURL = sourceURL
                .deletingPathExtension()
                .appendingPathExtension("thumbnail.jpg")
            try thumbnailData.write(
                to: thumbnailURL,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
            return (originalURL, thumbnailURL)
        }.value
    }

    nonisolated private static func preparedChatVideoThumbnailFileForUpload(
        _ sourceURL: URL
    ) async throws -> URL {
        try await Task.detached(priority: .utility) {
            let asset = AVURLAsset(url: sourceURL)
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 480, height: 480)
            let cgImage = try generator.copyCGImage(at: .zero, actualTime: nil)
            let image = UIImage(cgImage: cgImage)
            guard let data = image.jpegData(compressionQuality: 0.62) else {
                throw APIError.invalidResponse
            }
            let destinationURL = sourceURL
                .deletingPathExtension()
                .appendingPathExtension("thumbnail.jpg")
            try data.write(
                to: destinationURL,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
            return destinationURL
        }.value
    }

    nonisolated private static func chatThumbnailFilename(for filename: String) -> String {
        let base = URL(fileURLWithPath: filename)
            .deletingPathExtension()
            .lastPathComponent
        return "\(base)_thumb.jpg"
    }

    nonisolated static func compressBackgroundImageForUpload(_ data: Data) -> Data {
        compressImageForUpload(data, maxDimension: 1280, quality: 0.72, maxBytes: 900_000)
    }

    nonisolated private static func downsampledImage(
        _ source: CGImageSource,
        maxDimension: CGFloat
    ) -> UIImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, Int(maxDimension)),
            kCGImageSourceShouldCacheImmediately: true
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(
            source,
            0,
            options as CFDictionary
        ) else { return nil }
        return UIImage(cgImage: image)
    }

    nonisolated private static func imagePixelSize(_ source: CGImageSource) -> CGSize? {
        guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
            as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
              let height = properties[kCGImagePropertyPixelHeight] as? NSNumber
        else { return nil }
        return CGSize(width: width.doubleValue, height: height.doubleValue)
    }

    nonisolated private static func isJPEG(_ data: Data) -> Bool {
        data.count >= 3
            && data[data.startIndex] == 0xFF
            && data[data.index(after: data.startIndex)] == 0xD8
            && data[data.index(data.startIndex, offsetBy: 2)] == 0xFF
    }

    private static func pathComponent(_ raw: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return raw.addingPercentEncoding(withAllowedCharacters: allowed) ?? raw
    }

    // MARK: - Private Helpers

    private func sendEncodable<Body: Encodable, Response: Decodable>(
        method: String,
        path: String,
        body: Body,
        idempotencyKey: UUID? = nil
    ) async throws -> Response {
        guard let url = URL(string: baseURL + path) else { throw APIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let idempotencyKey {
            request.setValue(idempotencyKey.uuidString, forHTTPHeaderField: "Idempotency-Key")
        }
        request.httpBody = try JSONEncoder().encode(body)
        addAuthHeader(&request)
        return try await perform(request)
    }

    private func get<T: Decodable>(
        path: String,
        queryItems: [URLQueryItem] = [],
        cachePolicy: URLRequest.CachePolicy = .useProtocolCachePolicy
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

        var request = URLRequest(url: url, cachePolicy: cachePolicy)
        request.httpMethod = "GET"
        if cachePolicy == .reloadIgnoringLocalCacheData {
            request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        }
        addAuthHeader(&request)

        return try await perform(request)
    }

    private func postJSON<T: Decodable>(
        path: String,
        body: [String: Any],
        auth: Bool = true,
        idempotencyKey: UUID? = nil,
        containsSensitiveResponse: Bool = false
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let idempotencyKey {
            request.setValue(
                idempotencyKey.uuidString,
                forHTTPHeaderField: "Idempotency-Key"
            )
        }
        if containsSensitiveResponse {
            SensitiveHTTPResponsePolicy.apply(to: &request)
        }
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

    private func legacyBackgroundMultipartUpload<T: Decodable>(
        path: String,
        textFields: [LegacyMultipartTextField],
        fileFields: [LegacyMultipartFileField],
        job: OutgoingJob,
        part: OutgoingPart,
        timeout: TimeInterval
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else { throw APIError.invalidURL }
        let boundary = "BWChat-\(UUID().uuidString)"
        let multipartURL = try OutgoingFileStore.jobDirectory(ownerID: job.ownerID, jobID: job.clientRequestID)
            .appendingPathComponent("multipart-\(part.id).body", isDirectory: false)

        OutgoingStore.shared.updateJob(id: job.id, ownerID: job.ownerID, state: .preparing)
        if let sourceURL = fileFields.first?.fileURL,
           let digest = try? await OutgoingFileStore.sha256(of: sourceURL) {
            OutgoingStore.shared.updatePart(
                id: part.id,
                ownerID: job.ownerID,
                state: .preparing,
                sha256: digest
            )
        }
        try await Task.detached(priority: .utility) {
            try LegacyMultipartAdapter.build(
                textFields: textFields,
                fileFields: fileFields,
                destinationURL: multipartURL,
                boundary: boundary
            )
        }.value

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(job.clientRequestID, forHTTPHeaderField: "Idempotency-Key")
        addAuthHeader(&request)

        do {
            let result = try await UploadEngine.shared.upload(
                request: request,
                multipartFileURL: multipartURL,
                job: job,
                part: part
            )
            try? FileManager.default.removeItem(at: multipartURL)
            guard (200..<300).contains(result.response.statusCode) else {
                let message = String(data: result.data, encoding: .utf8) ?? "HTTP \(result.response.statusCode)"
                if result.response.statusCode == 408
                    || result.response.statusCode == 429
                    || (500...599).contains(result.response.statusCode) {
                    await UploadEngine.shared.markRetryWaiting(
                        jobID: job.id,
                        ownerID: job.ownerID,
                        error: URLError(.badServerResponse),
                        attempt: job.attemptCount
                    )
                    throw URLError(.badServerResponse)
                }
                throw APIError.serverError(code: result.response.statusCode, message: message)
            }
            do {
                return try JSONDecoder().decode(T.self, from: result.data)
            } catch {
                await UploadEngine.shared.markConfirmationUnknown(
                    jobID: job.id,
                    ownerID: job.ownerID,
                    code: "response-decode-failed"
                )
                throw APIError.decodingError(error)
            }
        } catch {
            if (error as NSError).code == NSURLErrorCancelled {
                throw error
            }
            throw error
        }
    }

    nonisolated private static func videoMIMEType(filename: String) -> String {
        switch (filename as NSString).pathExtension.lowercased() {
        case "mov": return "video/quicktime"
        case "m4v": return "video/x-m4v"
        default: return "video/mp4"
        }
    }

    private func uploadImage<T: Decodable>(
        path: String,
        fieldName: String?,
        fieldValue: String?,
        imageFieldName: String = "image",
        imageData: Data,
        filename: String,
        additionalFields: [String: String] = [:],
        idempotencyKey: UUID? = nil
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let idempotencyKey {
            request.setValue(idempotencyKey.uuidString, forHTTPHeaderField: "Idempotency-Key")
        }
        request.timeoutInterval = 90
        addAuthHeader(&request)

        var body = Data()
        // Optional extra field (e.g. receiver_id for DM images)
        if let fieldName = fieldName, let fieldValue = fieldValue {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(fieldName)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(fieldValue)\r\n".data(using: .utf8)!)
        }
        for (name, value) in additionalFields.sorted(by: { $0.key < $1.key }) {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        // image field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(imageFieldName)\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
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
        filename: String,
        additionalFields: [String: String] = [:]
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
        for (name, value) in additionalFields.sorted(by: { $0.key < $1.key }) {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
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

    func createGameLobbySession(
        gameID: String,
        idempotencyKey: UUID = UUID()
    ) async throws -> GameSession {
        let response: APIResponseWrapper<GameSession> = try await postJSON(
            path: "/games/\(Self.pathComponent(gameID))/sessions",
            body: GameLobbySessionRequest.requestBody,
            idempotencyKey: idempotencyKey,
            containsSensitiveResponse: true
        )
        guard response.code == 0, let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        #if DEBUG
        print(
            "[GameLobby] created entry_price_gold_coins="
                + "\(data.entryPriceGoldCoins.map(String.init) ?? "-")"
        )
        #endif
        return data
    }

    func startGameRound(
        gameID: String,
        sessionID: String,
        idempotencyKey: UUID
    ) async throws -> GameRoundStart {
        let response: APIResponseWrapper<GameRoundStart> = try await postJSON(
            path: "/games/\(Self.pathComponent(gameID))/sessions/\(Self.pathComponent(sessionID))/rounds",
            body: GameRoundStartRequestPayload.requestBody,
            idempotencyKey: idempotencyKey,
            containsSensitiveResponse: true
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
        unlockPriceGoldCoins: Int? = nil
    ) async throws -> ShortDramaEpisodeUploadResult {
        var fields: [(String, String)] = [
            ("title", title),
            ("intro", intro),
            ("episode_number", "\(episodeNumber)")
        ]
        if let unlockPriceGoldCoins {
            fields.append(("unlock_price_gold_coins", "\(min(max(unlockPriceGoldCoins, 0), 100))"))
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

    func uploadShortDramaEpisode(
        seriesID: String,
        clientEpisodeID: String,
        title: String,
        intro: String,
        episodeNumber: Int,
        videoFileURL: URL,
        videoFilename: String,
        coverFileURL: URL,
        coverFilename: String,
        unlockPriceGoldCoins: Int? = nil,
        job: OutgoingJob,
        part: OutgoingPart
    ) async throws -> ShortDramaEpisodeUploadResult {
        var fields = [
            LegacyMultipartTextField(name: "title", value: title),
            LegacyMultipartTextField(name: "intro", value: intro),
            LegacyMultipartTextField(name: "episode_number", value: String(episodeNumber)),
            LegacyMultipartTextField(name: "client_episode_id", value: clientEpisodeID),
            LegacyMultipartTextField(name: "client_series_id", value: job.clientRequestID)
        ]
        if let unlockPriceGoldCoins {
            fields.append(LegacyMultipartTextField(
                name: "unlock_price_gold_coins",
                value: String(min(max(unlockPriceGoldCoins, 0), 100))
            ))
        }
        let response: APIResponseWrapper<ShortDramaEpisodeUploadResult> = try await legacyBackgroundMultipartUpload(
            path: "/short-drama/series/\(Self.pathComponent(seriesID))/episodes",
            textFields: fields,
            fileFields: [
                LegacyMultipartFileField(
                    name: "video",
                    filename: videoFilename,
                    mimeType: Self.videoMIMEType(filename: videoFilename),
                    fileURL: videoFileURL
                ),
                LegacyMultipartFileField(
                    name: "cover",
                    filename: coverFilename,
                    mimeType: "image/jpeg",
                    fileURL: coverFileURL
                )
            ],
            job: job,
            part: part,
            timeout: 600
        )
        return response.data ?? ShortDramaEpisodeUploadResult(video: nil, status: nil)
    }

    func updateShortDramaEpisode(
        videoID: String,
        title: String,
        intro: String,
        episodeNumber: Int,
        unlockPriceGoldCoins: Int
    ) async throws -> ShortDramaVideo {
        let response: APIResponseWrapper<ShortDramaVideo> = try await patchJSON(
            path: "/short-drama/videos/\(Self.pathComponent(videoID))",
            body: [
                "title": title,
                "intro": intro,
                "episode_number": episodeNumber,
                "unlock_price_gold_coins": min(max(unlockPriceGoldCoins, 0), 100)
            ]
        )
        guard let video = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return video
    }

    func submitShortDramaSeries(seriesID: String, clientRequestID: String? = nil) async throws -> ShortDramaSeries {
        var body: [String: String] = [:]
        if let clientRequestID { body["client_request_id"] = clientRequestID }
        let response: APIResponseWrapper<ShortDramaSeries> = try await postJSON(
            path: "/short-drama/series/\(Self.pathComponent(seriesID))/submit",
            body: body
        )
        guard let series = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return series
    }

    func unlockShortDramaEpisode(
        videoID: String,
        idempotencyKey: UUID
    ) async throws -> ShortDramaUnlockResult {
        let response: APIResponseWrapper<ShortDramaUnlockResult> = try await postJSON(
            path: "/short-drama/videos/\(Self.pathComponent(videoID))/unlock",
            body: ["idempotency_key": idempotencyKey.uuidString],
            idempotencyKey: idempotencyKey
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
            return response.data ?? ShortDramaInteractionResult(liked: true, likeCount: nil)
        }

        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        addAuthHeader(&request)
        let response: APIResponseWrapper<ShortDramaInteractionResult> = try await perform(request)
        return response.data ?? ShortDramaInteractionResult(liked: false, likeCount: nil)
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
    func getMomentsFollowing(beforeID: Int? = nil, limit: Int = 20) async throws -> ([Moment], Bool, Bool?) {
        var path = "/moments/feed?limit=\(limit)"
        if let bid = beforeID { path += "&before_id=\(bid)" }
        let response: APIResponseWrapper<MomentFeedResponseData> = try await get(path: path)
        let data = try response.requiredData()
        return (data.moments, data.hasMore, data.snapshotComplete)
    }

    func getMomentsWorld(beforeID: Int? = nil, limit: Int = 20) async throws -> ([Moment], Bool, Bool?) {
        var path = "/moments/world?limit=\(limit)"
        if let bid = beforeID { path += "&before_id=\(bid)" }
        let response: APIResponseWrapper<MomentFeedResponseData> = try await get(path: path)
        let data = try response.requiredData()
        return (data.moments, data.hasMore, data.snapshotComplete)
    }

    func createMoment(content: String, imageDataList: [(Data, String)]) async throws -> Moment {
        let mediaDataList = imageDataList.map {
            MomentUploadMedia(kind: .image, data: $0.0, filename: $0.1, mimeType: "image/jpeg")
        }
        return try await createMoment(
            content: content,
            mediaDataList: mediaDataList,
            unlockPriceGoldCoins: nil
        )
    }

    func createMoment(
        content: String,
        mediaDataList: [MomentUploadMedia],
        unlockPriceGoldCoins: Int?
    ) async throws -> Moment {
        try MomentMediaPolicy.validate(mediaDataList.map(\.kind))
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
            unlockPriceGoldCoins: unlockPriceGoldCoins
        )

        let response: APIResponseWrapper<Moment> = try await performUpload(request, body: body)
        guard let moment = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return moment
    }

    func createMoment(
        content: String,
        mediaFiles: [MomentUploadFile],
        unlockPriceGoldCoins: Int?,
        job: OutgoingJob,
        parts: [OutgoingPart]
    ) async throws -> Moment {
        try MomentMediaPolicy.validate(mediaFiles.map(\.kind))
        guard let trackingPart = parts.first else { throw APIError.invalidResponse }
        for (part, media) in zip(parts, mediaFiles) {
            if let digest = try? await OutgoingFileStore.sha256(of: media.fileURL) {
                OutgoingStore.shared.updatePart(
                    id: part.id,
                    ownerID: job.ownerID,
                    state: .preparing,
                    sha256: digest
                )
            }
        }
        var fields = [
            LegacyMultipartTextField(name: "content", value: content),
            LegacyMultipartTextField(name: "client_request_id", value: job.clientRequestID)
        ]
        if let unlockPriceGoldCoins, unlockPriceGoldCoins > 0 {
            fields.append(LegacyMultipartTextField(
                name: "unlock_price_gold_coins",
                value: String(unlockPriceGoldCoins)
            ))
        }
        let response: APIResponseWrapper<Moment> = try await legacyBackgroundMultipartUpload(
            path: "/moments/create",
            textFields: fields,
            fileFields: mediaFiles.map {
                LegacyMultipartFileField(
                    name: "media",
                    filename: $0.filename,
                    mimeType: $0.mimeType,
                    fileURL: $0.fileURL
                )
            },
            job: job,
            part: trackingPart,
            timeout: mediaFiles.contains { $0.kind == .video } ? 600 : 180
        )
        let moment = try response.requiredData()
        for part in parts {
            OutgoingStore.shared.updatePart(
                id: part.id,
                ownerID: job.ownerID,
                state: .succeeded,
                uploadedBytes: part.byteSize
            )
        }
        return moment
    }

    nonisolated private static func momentMultipartBody(
        boundary: String,
        content: String,
        mediaDataList: [MomentUploadMedia],
        unlockPriceGoldCoins: Int?
    ) async -> Data {
        await Task.detached(priority: .utility) {
            var body = Data()
            appendMomentTextField(name: "content", value: content, boundary: boundary, to: &body)

            if let unlockPriceGoldCoins, unlockPriceGoldCoins > 0 {
                appendMomentTextField(
                    name: "unlock_price_gold_coins",
                    value: "\(unlockPriceGoldCoins)",
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

    func unlockMoment(
        momentID: Int,
        paymentMethod: MediaUnlockPaymentMethod,
        idempotencyKey: UUID = UUID()
    ) async throws -> MomentUnlockResponseData {
        let response: APIResponseWrapper<MomentUnlockResponseData> = try await postJSON(
            path: "/moments/\(momentID)/unlock",
            body: paymentMethod.requestBody,
            idempotencyKey: idempotencyKey
        )
        guard let data = response.data else {
            throw APIError.serverError(code: response.code, message: response.message)
        }
        return data
    }

    func getUserMoments(userID: String, limit: Int = 20, beforeID: Int? = nil) async throws -> ([Moment], Bool, Bool?) {
        var path = "/moments/user/\(Self.pathComponent(userID))?limit=\(limit)"
        if let bid = beforeID { path += "&before_id=\(bid)" }
        let response: APIResponseWrapper<MomentFeedResponseData> = try await get(path: path)
        let data = try response.requiredData()
        return (data.moments, data.hasMore, data.snapshotComplete)
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
        } decode: { data, request, response in
            do {
                return try JSONDecoder().decode(T.self, from: data)
            } catch {
                Self.logDecodingError(
                    error,
                    data: data,
                    request: request,
                    response: response,
                    type: T.self
                )
                throw APIError.decodingError(error)
            }
        }
    }

    /// Accepts both the app's JSON envelope and a standards-compliant empty
    /// 204 response. Delete endpoints may legitimately return either shape.
    private func performNoContent(
        _ request: URLRequest,
        allowRetry: Bool = true,
        logoutOnUnauthorized: Bool = true
    ) async throws {
        let _: Bool = try await performTransport(
            request,
            allowRetry: allowRetry,
            logoutOnUnauthorized: logoutOnUnauthorized
        ) { request in
            try await self.session.data(for: request)
        } decode: { data, request, _ in
            if data.isEmpty {
                return true
            }
            do {
                _ = try JSONDecoder().decode(APIResponseWrapper<EmptyData>.self, from: data)
                return true
            } catch {
                Self.logDecodingError(
                    error,
                    data: data,
                    request: request,
                    type: APIResponseWrapper<EmptyData>.self
                )
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
        let symbolicResponse = try? decoder.decode(SymbolicBusinessErrorResponse.self, from: data)
        let structuredResponse = try? decoder.decode(StructuredErrorResponse.self, from: data)
        if let detailMessage = detailResponse?.detail?.message,
           !detailMessage.isEmpty {
            message = detailMessage
        } else if let businessMessage = LiveCallBusinessErrorPolicy.message(
            code: symbolicResponse?.code,
            serverMessage: symbolicResponse?.message
        ) {
            message = businessMessage
        } else if let structuredMessage = structuredResponse?.userFacingMessage {
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
        let diagnosticMessage = SensitiveLogRedactor.redact(message)
        print("[APIService] HTTP \(response.statusCode) \(path) request_id=\(requestID): \(diagnosticMessage)")
        #if DEBUG
        if path.hasPrefix("/api/v1/games/"), path.hasSuffix("/rounds") {
            let context = symbolicResponse?.data
            let symbolicCode = symbolicResponse?.code
                ?? structuredResponse?.data?.errorCode
                ?? "-"
            print(
                "[GameRoundStart] rejected http_status=\(response.statusCode) "
                    + "code=\(SensitiveLogRedactor.redact(symbolicCode)) "
                    + "required=\(context?.requiredAmount.map(String.init) ?? "-") "
                    + "gold=\(context?.goldCoinBalance.map { String($0.value) } ?? "-") "
                    + "activity=\(context?.activityCatFoodBalance.map { String($0.value) } ?? "-") "
                    + "spendable=\(context?.spendableBalance.map(String.init) ?? "-")"
            )
        }
        #endif
        if let symbolicCode = symbolicResponse?.code ?? structuredResponse?.data?.errorCode,
           !symbolicCode.isBlank,
           Int(symbolicCode) == nil {
            return APIError.businessError(
                code: symbolicCode,
                message: message,
                context: symbolicResponse?.data
            )
        }
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
        response: HTTPURLResponse? = nil,
        type: T.Type
    ) {
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
        let jsonObject = try? JSONSerialization.jsonObject(with: data)
        let topLevelKeys = (jsonObject as? [String: Any])?
            .keys.sorted().joined(separator: ",") ?? "-"
        let responseShape = sanitizedJSONShape(jsonObject, depth: 3)
        let requestID = response?.value(forHTTPHeaderField: "x-request-id") ?? "-"
        print(
            "[APIService] decode failure \(request.url?.path ?? "") "
                + "type=\(String(describing: type)) coding_path=\(path.isEmpty ? "-" : path) "
                + "request_id=\(requestID) bytes=\(data.count) top_keys=\(topLevelKeys) "
                + "shape=\(responseShape) detail=\(description)"
        )
    }

    /// Logs JSON field names and value types only. This is intentionally safe for
    /// production diagnostics: response values, tokens, invite codes, phone data,
    /// and user-generated content never enter the console.
    private static func sanitizedJSONShape(_ value: Any?, depth: Int) -> String {
        guard depth > 0, let value else { return value == nil ? "missing" : "…" }
        if value is NSNull { return "null" }
        if let object = value as? [String: Any] {
            let fields = object.keys.sorted().map { key in
                "\(key):\(sanitizedJSONShape(object[key], depth: depth - 1))"
            }.joined(separator: ",")
            return "{\(fields)}"
        }
        if let array = value as? [Any] {
            guard let first = array.first else { return "[]" }
            return "[\(array.count)x\(sanitizedJSONShape(first, depth: depth - 1))]"
        }
        if value is String { return "string" }
        if value is NSNumber { return "number" }
        return String(describing: type(of: value))
    }
}
