import Combine
import Security
import XCTest
@testable import BBchat

@MainActor
final class AuthSessionTests: XCTestCase {
    private let accessToken = "header.payload.signature"
    private let refreshToken = "refresh.payload.signature"

    func testKeychainSaveFailureKeepsAccessTokenInMemory() {
        let manager = makeManager(save: { _, _ in
            throw KeychainError(operation: "add", status: errSecMissingEntitlement)
        })

        manager.token = accessToken

        XCTAssertEqual(manager.token, accessToken)
    }

    func testStartupRestoresKeychainTokensIntoMemory() {
        let manager = makeManager(load: { [accessToken, refreshToken] key in
            key == "jwt_token" ? accessToken : refreshToken
        })

        XCTAssertEqual(manager.token, accessToken)
        XCTAssertEqual(manager.refreshToken, refreshToken)
        XCTAssertTrue(manager.isLoggedIn)
    }

    func testSimulatorKeychainConfigurationRoundTrips() throws {
        let key = "bbchat.auth-test.\(UUID().uuidString)"
        let value = "keychain-roundtrip-value"
        defer { _ = KeychainHelper.delete(key: key) }

        try KeychainHelper.save(key: key, value: value)

        XCTAssertEqual(KeychainHelper.load(key: key), value)
        XCTAssertEqual(KeychainHelper.delete(key: key), errSecSuccess)
    }

    func testUnexpectedWhitespaceIsRemovedFromLoginToken() throws {
        let manager = makeManager()

        try manager.updateSessionTokens(
            accessToken: "  \n\(accessToken)\t ",
            refreshToken: " \(refreshToken) ",
            source: "test"
        )

        XCTAssertEqual(manager.token, accessToken)
        XCTAssertEqual(manager.refreshToken, refreshToken)
    }

    func testBearerPrefixIsNotDuplicated() {
        var request = URLRequest(url: URL(string: "http://example.test/protected")!)

        AuthRequestAuthorizer.addAuthHeader(
            &request,
            token: "  Bearer \(accessToken)  "
        )

        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Authorization"),
            "Bearer \(accessToken)"
        )
    }

    func testAddAuthHeaderSetsAuthorization() {
        var request = URLRequest(url: URL(string: "http://example.test/protected")!)

        XCTAssertTrue(AuthRequestAuthorizer.addAuthHeader(&request, token: accessToken))
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "Authorization"),
            "Bearer \(accessToken)"
        )
    }

    func testLoginPublishesLoggedInOnlyAfterTokenIsReadable() throws {
        let manager = makeManager()
        var tokenObservedWhenLoggedInChanged: String?
        let observation = manager.$isLoggedIn
            .dropFirst()
            .sink { isLoggedIn in
                if isLoggedIn {
                    tokenObservedWhenLoggedInChanged = manager.token
                }
            }
        defer { observation.cancel() }

        try manager.login(
            token: accessToken,
            refreshToken: refreshToken,
            user: User(userID: "u1", username: "tester", nickname: "Tester", avatarURL: "")
        )

        XCTAssertTrue(manager.isLoggedIn)
        XCTAssertEqual(tokenObservedWhenLoggedInChanged, accessToken)
    }

    func testRefreshRetryReplacesOldAuthorizationWithNewToken() throws {
        let manager = makeManager()
        try manager.updateSessionTokens(
            accessToken: "old.payload.signature",
            refreshToken: refreshToken,
            source: "test-initial"
        )
        var retryRequest = URLRequest(url: URL(string: "http://example.test/protected")!)
        AuthRequestAuthorizer.addAuthHeader(&retryRequest, token: manager.token)

        try manager.updateSessionTokens(
            accessToken: "new.payload.signature",
            refreshToken: refreshToken,
            source: "test-refresh"
        )
        AuthRequestAuthorizer.addAuthHeader(&retryRequest, token: manager.token)

        XCTAssertEqual(
            retryRequest.value(forHTTPHeaderField: "Authorization"),
            "Bearer new.payload.signature"
        )
    }

    func testLogoutClearsMemoryAndBothKeychainAccounts() throws {
        final class State {
            var deletedKeys: [String] = []
        }
        let state = State()
        let manager = makeManager(delete: { key in
            state.deletedKeys.append(key)
            return errSecSuccess
        })
        try manager.updateSessionTokens(
            accessToken: accessToken,
            refreshToken: refreshToken,
            source: "test"
        )

        manager.logout()

        XCTAssertNil(manager.token)
        XCTAssertNil(manager.refreshToken)
        XCTAssertEqual(state.deletedKeys.count, 2)
        XCTAssertTrue(state.deletedKeys.contains("jwt_token"))
        XCTAssertTrue(state.deletedKeys.contains("jwt_refresh_token"))
    }

    func testConcurrentProtectedRequestsUseSameAccessToken() async {
        let paths = ["/groups", "/friends/list", "/chat/conversations"]

        let headers = await withTaskGroup(of: String?.self, returning: [String?].self) { group in
            for path in paths {
                group.addTask { [accessToken] in
                    var request = URLRequest(url: URL(string: "http://example.test\(path)")!)
                    AuthRequestAuthorizer.addAuthHeader(&request, token: accessToken)
                    return request.value(forHTTPHeaderField: "Authorization")
                }
            }
            var values: [String?] = []
            for await value in group {
                values.append(value)
            }
            return values
        }

        XCTAssertEqual(headers.count, paths.count)
        XCTAssertTrue(headers.allSatisfy { $0 == "Bearer \(accessToken)" })
    }

    func testCachedSessionSurvivesTransientValidationFailures() {
        XCTAssertFalse(CachedSessionValidationFailurePolicy.shouldInvalidateSession(
            for: APIError.networkError(URLError(.notConnectedToInternet))
        ))
        XCTAssertFalse(CachedSessionValidationFailurePolicy.shouldInvalidateSession(
            for: APIError.serverError(code: 503, message: "unavailable")
        ))
        XCTAssertFalse(CachedSessionValidationFailurePolicy.shouldInvalidateSession(
            for: APIError.decodingError(DecodingError.dataCorrupted(.init(
                codingPath: [],
                debugDescription: "bad gateway body"
            )))
        ))
        XCTAssertFalse(CachedSessionValidationFailurePolicy.shouldInvalidateSession(
            for: CancellationError()
        ))
    }

    func testCachedSessionIsInvalidatedOnlyByExplicitCredentialRejection() {
        XCTAssertTrue(CachedSessionValidationFailurePolicy.shouldInvalidateSession(
            for: APIError.unauthorized
        ))
        XCTAssertTrue(CachedSessionValidationFailurePolicy.shouldInvalidateSession(
            for: APIError.serverError(code: 403, message: "revoked")
        ))
        XCTAssertTrue(CachedSessionValidationFailurePolicy.shouldInvalidateSession(
            for: APIError.businessError(
                code: "refresh_token_expired",
                message: "expired",
                context: nil
            )
        ))
    }

    func testAdRewardCounterIsSeparatedByAccountLimitedToTenAndResetsAtMidnight() throws {
        let suiteName = "bbchat.ad-reward-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 8 * 60 * 60))
        var currentDate = try XCTUnwrap(
            calendar.date(from: DateComponents(year: 2026, month: 7, day: 21, hour: 23, minute: 59))
        )
        let counter = AdRewardDailyCounter(
            defaults: defaults,
            calendar: calendar,
            dailyLimit: 10,
            now: { currentDate }
        )

        XCTAssertEqual(counter.remainingViews(for: "account-a"), 10)
        XCTAssertEqual(counter.remainingViews(for: "account-b"), 10)

        for expectedRemaining in stride(from: 9, through: 0, by: -1) {
            XCTAssertEqual(counter.recordCompletedView(for: "account-a"), expectedRemaining)
        }
        XCTAssertEqual(counter.recordCompletedView(for: "account-a"), 0)
        XCTAssertEqual(counter.remainingViews(for: "account-a"), 0)
        XCTAssertEqual(counter.remainingViews(for: "account-b"), 10)

        let resetDate = try XCTUnwrap(counter.nextResetDate())
        XCTAssertEqual(calendar.component(.hour, from: resetDate), 0)
        XCTAssertEqual(calendar.component(.minute, from: resetDate), 0)
        currentDate = resetDate

        XCTAssertEqual(counter.remainingViews(for: "account-a"), 10)
        XCTAssertEqual(counter.remainingViews(for: "account-b"), 10)
    }

    func testAdRewardDefaultCounterUsesShanghaiBusinessDay() throws {
        let suiteName = "bbchat.ad-reward-timezone-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        var currentDate = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-07-21T15:59:59Z")
        )
        let counter = AdRewardDailyCounter(
            defaults: defaults,
            dailyLimit: 10,
            now: { currentDate }
        )

        XCTAssertEqual(counter.recordCompletedView(for: "account-a"), 9)
        currentDate = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2026-07-21T16:00:00Z")
        )
        XCTAssertEqual(counter.remainingViews(for: "account-a"), 10)
    }

    func testPendingAdRewardWaitsForServerDecreaseOrSessionExpiry() throws {
        let formatter = ISO8601DateFormatter()
        let startedAt = try XCTUnwrap(formatter.date(from: "2026-07-21T10:00:00Z"))
        let pending = AdRewardPendingCredit(
            userID: "account-a",
            remainingCountBeforeReward: 7,
            businessDayResetAt: startedAt.addingTimeInterval(6 * 60 * 60),
            sessionExpiresAt: startedAt.addingTimeInterval(30 * 60)
        )

        XCTAssertFalse(pending.isResolved(
            currentUserID: "account-a",
            serverRemainingCount: 7,
            now: startedAt.addingTimeInterval(5)
        ))
        XCTAssertTrue(pending.isResolved(
            currentUserID: "account-a",
            serverRemainingCount: 6,
            now: startedAt.addingTimeInterval(5)
        ))
        XCTAssertTrue(pending.isResolved(
            currentUserID: "account-a",
            serverRemainingCount: 7,
            now: startedAt.addingTimeInterval(30 * 60)
        ))
        XCTAssertFalse(pending.isServerCreditConfirmed(
            currentUserID: "account-a",
            serverRemainingCount: 7,
            now: startedAt.addingTimeInterval(30 * 60)
        ))
        XCTAssertTrue(pending.isServerCreditConfirmed(
            currentUserID: "account-a",
            serverRemainingCount: 6,
            now: startedAt.addingTimeInterval(5)
        ))
    }

    func testPendingAdRewardDoesNotUseNextBusinessDaysCounterAsConfirmation() throws {
        let formatter = ISO8601DateFormatter()
        let startedAt = try XCTUnwrap(formatter.date(from: "2026-07-21T15:59:50Z"))
        let pending = AdRewardPendingCredit(
            userID: "account-a",
            remainingCountBeforeReward: 1,
            businessDayResetAt: startedAt.addingTimeInterval(10),
            sessionExpiresAt: startedAt.addingTimeInterval(30 * 60)
        )

        XCTAssertFalse(pending.isResolved(
            currentUserID: "account-a",
            serverRemainingCount: 0,
            now: startedAt.addingTimeInterval(11)
        ))
    }

    func testPendingAdRewardStoreIsAccountScopedAndRoundTrips() throws {
        let suiteName = "bbchat.ad-reward-pending-store-tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = AdRewardPendingCreditStore(defaults: defaults)
        let pending = AdRewardPendingCredit(
            userID: "account-a",
            remainingCountBeforeReward: 5,
            businessDayResetAt: Date(timeIntervalSince1970: 1_800_000_000),
            sessionExpiresAt: Date(timeIntervalSince1970: 1_799_950_000)
        )

        store.save(pending)

        XCTAssertEqual(store.pendingCredit(for: "account-a"), pending)
        XCTAssertNil(store.pendingCredit(for: "account-b"))
        store.remove(for: "account-a")
        XCTAssertNil(store.pendingCredit(for: "account-a"))
    }

    private func makeManager(
        load: @escaping (String) -> String? = { _ in nil },
        save: @escaping (String, String) throws -> Void = { _, _ in },
        delete: @escaping (String) -> OSStatus = { _ in errSecItemNotFound }
    ) -> AuthManager {
        AuthManager(
            tokenStore: AuthTokenStore(load: load, save: save, delete: delete),
            restoreCachedUser: false,
            applicationSideEffectsEnabled: false
        )
    }
}
