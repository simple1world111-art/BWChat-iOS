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
