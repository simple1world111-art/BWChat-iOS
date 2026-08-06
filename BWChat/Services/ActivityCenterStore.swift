import Foundation
import Combine
import Contacts
import CryptoKit

#if canImport(PhoneNumberKit)
import PhoneNumberKit
#endif

protocol ActivityCenterClient: AnyObject {
    func getActivityCenter() async throws -> ActivityCenterSnapshot
    func claimActivityCheckIn(idempotencyKey: UUID) async throws -> ActivityCenterGrantResult
    func claimActivityMeal(windowID: String, idempotencyKey: UUID) async throws -> ActivityCenterGrantResult
    func spinActivityWheel(configVersion: String, tierID: String, idempotencyKey: UUID) async throws -> ActivityWheelSpinEnvelope
    func createActivityContactDiscoverySession() async throws -> ActivityContactDiscoverySession
    func matchActivityContacts(sessionID: String, saltVersion: String, phoneHashes: [String], idempotencyKey: UUID) async throws -> ActivityContactMatchResult
    func createActivityInviteShareSession() async throws -> ActivityInviteShareSession
    func completeActivityInviteShareSession(sessionID: String, idempotencyKey: UUID) async throws -> ActivityCenterGrantResult
    func redeemActivityInvite(codeOrToken: String, idempotencyKey: UUID) async throws -> ActivityCenterSnapshot
    func createActivityPhoneVerificationSession(e164Phone: String) async throws -> ActivityPhoneVerificationSession
    func verifyActivityPhone(sessionID: String, code: String, idempotencyKey: UUID) async throws -> ActivityCenterSnapshot
    func sendFriendRequest(targetUserID: String) async throws -> String
}

extension APIService: ActivityCenterClient {}

enum ActivityCenterOperation: Hashable {
    case checkIn
    case meal(String)
    case wheel
    case contacts
    case share
    case redeem
    case sendCode
    case verifyPhone
    case friend(String)
}

@MainActor
final class ActivityCenterOperationStatus: ObservableObject {
    @Published fileprivate(set) var isRunning = false
}

struct ActivityRewardCelebration: Identifiable, Equatable {
    let id = UUID()
    let amount: Int
}

@MainActor
final class ActivityCenterOperations {
    private var statuses: [ActivityCenterOperation: ActivityCenterOperationStatus] = [:]

    var isBusy: Bool {
        statuses.values.contains(where: \.isRunning)
    }

    func status(for operation: ActivityCenterOperation) -> ActivityCenterOperationStatus {
        if let status = statuses[operation] { return status }
        let status = ActivityCenterOperationStatus()
        statuses[operation] = status
        return status
    }

    func isRunning(_ operation: ActivityCenterOperation) -> Bool {
        statuses[operation]?.isRunning == true
    }

    func begin(_ operation: ActivityCenterOperation) -> Bool {
        let status = status(for: operation)
        guard !status.isRunning else { return false }
        status.isRunning = true
        return true
    }

    func end(_ operation: ActivityCenterOperation) {
        statuses[operation]?.isRunning = false
    }

    func reset() {
        statuses.values.forEach { $0.isRunning = false }
        statuses.removeAll(keepingCapacity: true)
    }
}

private final class ActivityCenterUserDefaultsBox: @unchecked Sendable {
    let value: UserDefaults

    init(_ value: UserDefaults) {
        self.value = value
    }
}

enum ActivityCenterLocalError: LocalizedError {
    case signInRequired
    case phoneVerificationRequired
    case contactsDenied
    case invalidPhone
    case invalidVerificationCode
    case invalidWheelConfiguration
    case noInvitation

    var errorDescription: String? {
        switch self {
        case .signInRequired: return L10n.tr("activityCenter.error.signIn")
        case .phoneVerificationRequired: return L10n.tr("activityCenter.error.phoneRequired")
        case .contactsDenied: return L10n.tr("activityCenter.error.contactsDenied")
        case .invalidPhone: return L10n.tr("activityCenter.error.invalidPhone")
        case .invalidVerificationCode: return L10n.tr("activityCenter.error.invalidCode")
        case .invalidWheelConfiguration: return L10n.tr("activityCenter.error.wheelConfig")
        case .noInvitation: return L10n.tr("activityCenter.error.invalidInvite")
        }
    }
}

@MainActor
final class ActivityCenterStore: ObservableObject {
    @Published private(set) var snapshot: ActivityCenterSnapshot?
    @Published private(set) var isLoading = false
    @Published private(set) var isShowingCachedData = false
    @Published private(set) var matchedUsers: [ActivityMatchedUser] = []
    @Published private(set) var phoneVerificationSession: ActivityPhoneVerificationSession?
    @Published private(set) var rewardCelebration: ActivityRewardCelebration?
    private(set) var lastSpin: ActivityWheelSpinResult?
    @Published var errorMessage: String?

    private let client: ActivityCenterClient
    private let defaults: UserDefaults
    private let cacheDefaults: ActivityCenterUserDefaultsBox
    private let cacheQueue = DispatchQueue(
        label: "com.bwchat.activity-center.cache",
        qos: .utility
    )
    let operations = ActivityCenterOperations()
    private let usesPreviewData: Bool
    private var loadedScopeID: String?
    private var deferredSpinSnapshot: ActivityCenterSnapshot?
    private var serverTimeAnchor: Date?
    private var deviceTimeAnchor: Date?

    init(
        client: ActivityCenterClient? = nil,
        defaults: UserDefaults = .standard,
        initialSnapshot: ActivityCenterSnapshot? = nil,
        initialMatchedUsers: [ActivityMatchedUser] = []
    ) {
        self.client = client ?? APIService.shared
        self.defaults = defaults
        cacheDefaults = ActivityCenterUserDefaultsBox(defaults)
        usesPreviewData = initialSnapshot != nil
        snapshot = initialSnapshot
        matchedUsers = initialMatchedUsers
        loadedScopeID = initialSnapshot == nil ? nil : Self.scopeID
    }

    var isBusy: Bool { operations.isBusy }

    func serverNow(at deviceDate: Date = Date()) -> Date {
        guard let serverTimeAnchor, let deviceTimeAnchor else { return deviceDate }
        return serverTimeAnchor.addingTimeInterval(deviceDate.timeIntervalSince(deviceTimeAnchor))
    }

    func isRunning(_ operation: ActivityCenterOperation) -> Bool {
        operations.isRunning(operation)
    }

    func operationStatus(for operation: ActivityCenterOperation) -> ActivityCenterOperationStatus {
        operations.status(for: operation)
    }

    func load(force: Bool = false) async {
        if usesPreviewData { return }
        let scopeID = Self.scopeID
        guard scopeID != "anonymous" else {
            resetForAccount(scopeID)
            errorMessage = ActivityCenterLocalError.signInRequired.localizedDescription
            return
        }

        if loadedScopeID != scopeID {
            resetForAccount(scopeID)
        }
        if snapshot == nil, let cached = cachedSnapshot(scopeID: scopeID) {
            snapshot = cached
            isShowingCachedData = true
        }
        if isLoading || (!force && snapshot != nil && !isShowingCachedData) { return }

        isLoading = true
        defer { isLoading = false }
        do {
            let latest = try await client.getActivityCenter()
            guard scopeID == Self.scopeID else { return }
            apply(latest, cache: true)
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }

    func claimCheckIn() async {
        guard let current = snapshot,
              let optimistic = current.optimisticallyClaimingCheckIn(),
              let amount = current.checkIn.nextClaimableDay?.rewardActivityCatFood else { return }
        await performOptimisticGrant(
            operation: .checkIn,
            keyName: "check-in",
            original: current,
            optimistic: optimistic,
            amount: amount
        ) { key in
            try await self.client.claimActivityCheckIn(idempotencyKey: key)
        }
    }

    func claimMeal(_ meal: ActivityMealReward) async {
        guard let current = snapshot,
              let optimistic = current.optimisticallyClaimingMeal(id: meal.id) else { return }
        await performOptimisticGrant(
            operation: .meal(meal.id),
            keyName: "meal.\(meal.id)",
            original: current,
            optimistic: optimistic,
            amount: meal.rewardActivityCatFood
        ) { key in
            try await self.client.claimActivityMeal(windowID: meal.id, idempotencyKey: key)
        }
    }

    func spinWheel() async -> ActivityWheelSpinEnvelope? {
        guard let snapshot else { return nil }
        let tier = snapshot.wheel.currentTier
        guard snapshot.wheel.enabled, tier.hasValidProbabilityTotal else {
            errorMessage = ActivityCenterLocalError.invalidWheelConfiguration.localizedDescription
            return nil
        }
        let operation: ActivityCenterOperation = .wheel
        guard begin(operation) else { return nil }

        let key = idempotencyKey(for: "wheel")
        do {
            let envelope = try await client.spinActivityWheel(
                configVersion: snapshot.configVersion,
                tierID: tier.id,
                idempotencyKey: key
            )
            clearIdempotencyKey(for: "wheel")
            lastSpin = envelope.result
            deferredSpinSnapshot = ActivityCenterSnapshotAuthority.resolve(
                local: snapshot,
                server: envelope.snapshot
            )
            return envelope
        } catch {
            end(operation)
            handleOperationError(error, keyName: "wheel")
            return nil
        }
    }

    func finishSpinAnimation() {
        end(.wheel)
        if let deferredSpinSnapshot {
            self.deferredSpinSnapshot = nil
            apply(deferredSpinSnapshot, cache: true)
        }
    }

    func discoverContacts() async -> Bool {
        guard snapshot?.phoneBinding.isVerified == true else {
            errorMessage = ActivityCenterLocalError.phoneVerificationRequired.localizedDescription
            return false
        }
        let operation: ActivityCenterOperation = .contacts
        guard begin(operation) else { return false }
        defer { end(operation) }
        do {
            let session = try await client.createActivityContactDiscoverySession()
            let hashes = try await ActivityContactDiscoveryService.phoneHashes(
                session: session
            )
            let key = idempotencyKey(for: "contacts")
            do {
                let result = try await client.matchActivityContacts(
                    sessionID: session.id,
                    saltVersion: session.saltVersion,
                    phoneHashes: hashes,
                    idempotencyKey: key
                )
                clearIdempotencyKey(for: "contacts")
                matchedUsers = result.matches
                apply(result.snapshot, cache: true)
                presentRewardCelebration(amount: result.grantedActivityCatFood)
                return true
            } catch {
                handleOperationError(error, keyName: "contacts")
                return false
            }
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func createShareSession() async -> ActivityInviteShareSession? {
        let operation: ActivityCenterOperation = .share
        guard begin(operation) else { return nil }
        defer { end(operation) }
        do {
            return try await client.createActivityInviteShareSession()
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func completeShare(sessionID: String) async {
        await performGrant(operation: .share, keyName: "share.\(sessionID)") { key in
            try await self.client.completeActivityInviteShareSession(
                sessionID: sessionID,
                idempotencyKey: key
            )
        }
    }

    func redeemInvite(_ input: String) async -> Bool {
        let clean = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else {
            errorMessage = ActivityCenterLocalError.noInvitation.localizedDescription
            return false
        }
        let operation: ActivityCenterOperation = .redeem
        guard begin(operation) else { return false }
        defer { end(operation) }
        let key = idempotencyKey(for: "redeem")
        do {
            let latest = try await client.redeemActivityInvite(
                codeOrToken: clean,
                idempotencyKey: key
            )
            clearIdempotencyKey(for: "redeem")
            apply(latest, cache: true)
            return true
        } catch {
            handleOperationError(error, keyName: "redeem")
            return false
        }
    }

    func requestPhoneCode(rawPhone: String, region: String?) async -> Bool {
        let operation: ActivityCenterOperation = .sendCode
        guard begin(operation) else { return false }
        defer { end(operation) }
        do {
            let e164 = try await Task.detached(priority: .userInitiated) {
                try ActivityPhoneNormalizer.e164(rawPhone, region: region)
            }.value
            phoneVerificationSession = try await client.createActivityPhoneVerificationSession(
                e164Phone: e164
            )
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func verifyPhone(code: String) async -> Bool {
        let clean = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, let session = phoneVerificationSession else {
            errorMessage = ActivityCenterLocalError.invalidVerificationCode.localizedDescription
            return false
        }
        let operation: ActivityCenterOperation = .verifyPhone
        guard begin(operation) else { return false }
        defer { end(operation) }
        let key = idempotencyKey(for: "verify-phone.\(session.id)")
        do {
            let latest = try await client.verifyActivityPhone(
                sessionID: session.id,
                code: clean,
                idempotencyKey: key
            )
            clearIdempotencyKey(for: "verify-phone.\(session.id)")
            phoneVerificationSession = nil
            apply(latest, cache: true)
            return true
        } catch {
            handleOperationError(error, keyName: "verify-phone.\(session.id)")
            return false
        }
    }

    func sendFriendRequest(to user: ActivityMatchedUser) async -> Bool {
        let operation: ActivityCenterOperation = .friend(user.userID)
        guard begin(operation) else { return false }
        defer { end(operation) }
        do {
            _ = try await client.sendFriendRequest(targetUserID: user.userID)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func dismissRewardCelebration(id: UUID) {
        guard rewardCelebration?.id == id else { return }
        rewardCelebration = nil
    }

    private func performGrant(
        operation: ActivityCenterOperation,
        keyName: String,
        request: @escaping (UUID) async throws -> ActivityCenterGrantResult
    ) async {
        guard begin(operation) else { return }
        defer { end(operation) }
        let key = idempotencyKey(for: keyName)
        do {
            let result = try await request(key)
            clearIdempotencyKey(for: keyName)
            apply(result.snapshot, cache: true)
            presentRewardCelebration(amount: result.grantedActivityCatFood)
        } catch {
            handleOperationError(error, keyName: keyName)
        }
    }

    private func performOptimisticGrant(
        operation: ActivityCenterOperation,
        keyName: String,
        original: ActivityCenterSnapshot,
        optimistic: ActivityCenterSnapshot,
        amount: Int,
        request: @escaping (UUID) async throws -> ActivityCenterGrantResult
    ) async {
        guard begin(operation) else { return }
        defer { end(operation) }

        apply(optimistic, cache: false)
        presentRewardCelebration(amount: amount)

        let key = idempotencyKey(for: keyName)
        do {
            let result = try await request(key)
            clearIdempotencyKey(for: keyName)
            apply(result.snapshot, cache: true)
        } catch {
            if !Self.isAmbiguous(error) {
                apply(original, cache: false)
            }
            handleOperationError(error, keyName: keyName)
        }
    }

    private func presentRewardCelebration(amount: Int) {
        guard amount > 0 else { return }
        rewardCelebration = ActivityRewardCelebration(amount: amount)
    }

    private func begin(_ operation: ActivityCenterOperation) -> Bool {
        guard operations.begin(operation) else { return false }
        if errorMessage != nil {
            errorMessage = nil
        }
        return true
    }

    private func end(_ operation: ActivityCenterOperation) {
        operations.end(operation)
    }

    private func apply(_ latest: ActivityCenterSnapshot, cache: Bool) {
        var reconciled = ActivityCenterSnapshotAuthority.resolve(
            local: snapshot,
            server: latest
        )
        if isRunning(.wheel), let currentWheel = snapshot?.wheel {
            reconciled = reconciled.replacing(wheel: currentWheel)
        }
        snapshot = reconciled
        serverTimeAnchor = ActivityCenterDateParser.date(from: reconciled.serverTime)
        deviceTimeAnchor = Date()
        if isShowingCachedData {
            isShowingCachedData = false
        }
        if errorMessage != nil {
            errorMessage = nil
        }
        guard cache else { return }
        let cachedValue = reconciled.redactedForCache
        let key = cacheKey(scopeID: Self.scopeID)
        let cacheDefaults = cacheDefaults
        cacheQueue.async {
            do {
                let data = try JSONEncoder().encode(cachedValue)
                cacheDefaults.value.set(data, forKey: key)
            } catch {
                cacheDefaults.value.removeObject(forKey: key)
            }
        }
    }

    private func cachedSnapshot(scopeID: String) -> ActivityCenterSnapshot? {
        guard let data = defaults.data(forKey: cacheKey(scopeID: scopeID)) else { return nil }
        return try? JSONDecoder().decode(ActivityCenterSnapshot.self, from: data)
    }

    private func resetForAccount(_ scopeID: String) {
        loadedScopeID = scopeID
        snapshot = nil
        matchedUsers = []
        phoneVerificationSession = nil
        rewardCelebration = nil
        lastSpin = nil
        deferredSpinSnapshot = nil
        serverTimeAnchor = nil
        deviceTimeAnchor = nil
        isShowingCachedData = false
        errorMessage = nil
        operations.reset()
    }

    private func handleOperationError(_ error: Error, keyName: String) {
        if !Self.isAmbiguous(error) {
            clearIdempotencyKey(for: keyName)
        }
        errorMessage = error.localizedDescription
    }

    private func idempotencyKey(for name: String) -> UUID {
        let key = operationKey(name)
        if let raw = defaults.string(forKey: key), let existing = UUID(uuidString: raw) {
            return existing
        }
        let created = UUID()
        defaults.set(created.uuidString, forKey: key)
        return created
    }

    private func clearIdempotencyKey(for name: String) {
        defaults.removeObject(forKey: operationKey(name))
    }

    private func operationKey(_ name: String) -> String {
        "bbchat.activity-center.idempotency.\(Self.scopeID).\(name)"
    }

    private func cacheKey(scopeID: String) -> String {
        "bbchat.activity-center.snapshot.\(scopeID)"
    }

    private static var scopeID: String {
        let value = AuthManager.shared.currentUser?.userID.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? "anonymous" : value
    }

    private static func isAmbiguous(_ error: Error) -> Bool {
        switch error {
        case APIError.networkError, APIError.invalidResponse, APIError.decodingError:
            return true
        case APIError.serverError(let code, _):
            return code >= 500
        default:
            return false
        }
    }
}

enum ActivityCenterSnapshotAuthority {
    static func resolve(
        local _: ActivityCenterSnapshot?,
        server: ActivityCenterSnapshot
    ) -> ActivityCenterSnapshot {
        // Cached/local state only keeps the screen responsive while loading.
        // Once a request succeeds, the complete server snapshot is authoritative.
        return server
    }
}

private extension ActivityCenterSnapshot {
    var redactedForCache: ActivityCenterSnapshot {
        ActivityCenterSnapshot(
            configVersion: configVersion,
            serverTime: serverTime,
            businessTimezone: businessTimezone,
            activityCatFoodBalance: activityCatFoodBalance,
            goldCoinBalance: goldCoinBalance,
            phoneBinding: phoneBinding,
            checkIn: checkIn,
            mealRewards: mealRewards,
            tasks: tasks,
            invitation: ActivityInvitationState(
                inviteCode: invitation.inviteCode,
                shareURL: "",
                pendingInvites: invitation.pendingInvites,
                creditedInvites: invitation.creditedInvites,
                canRedeem: invitation.canRedeem
            ),
            wheel: wheel
        )
    }
}

enum ActivityPhoneNormalizer {
    #if canImport(PhoneNumberKit)
    private static let utility = PhoneNumberUtility()
    #endif

    static func e164(_ rawPhone: String, region: String?) throws -> String {
        let clean = rawPhone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { throw ActivityCenterLocalError.invalidPhone }
        #if canImport(PhoneNumberKit)
        do {
            let parsed = try utility.parse(
                clean,
                withRegion: normalizedRegion(region),
                ignoreType: true
            )
            return utility.format(parsed, toType: .e164)
        } catch {
            throw ActivityCenterLocalError.invalidPhone
        }
        #else
        // Production targets link PhoneNumberKit. This constrained fallback keeps
        // non-Xcode tooling and previews usable without accepting local numbers.
        let allowed = clean.filter { $0 == "+" || $0.isNumber }
        guard allowed.first == "+", (8...16).contains(allowed.count) else {
            throw ActivityCenterLocalError.invalidPhone
        }
        return allowed
        #endif
    }

    private static func normalizedRegion(_ region: String?) -> String {
        let clean = region?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() ?? ""
        return clean.count == 2 ? clean : (Locale.current.region?.identifier ?? "US")
    }
}

enum ActivityContactDiscoveryService {
    static func phoneHashes(session: ActivityContactDiscoverySession) async throws -> [String] {
        let store = CNContactStore()
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .denied || status == .restricted {
            throw ActivityCenterLocalError.contactsDenied
        }
        if status == .notDetermined {
            let granted: Bool = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Bool, Error>) in
                store.requestAccess(for: .contacts) { granted, error in
                    if let error { continuation.resume(throwing: error) }
                    else { continuation.resume(returning: granted) }
                }
            }
            guard granted else { throw ActivityCenterLocalError.contactsDenied }
        }

        return try await Task.detached(priority: .userInitiated) {
            var result = Set<String>()
            let request = CNContactFetchRequest(keysToFetch: [CNContactPhoneNumbersKey as CNKeyDescriptor])
            try store.enumerateContacts(with: request) { contact, stop in
                for phone in contact.phoneNumbers {
                    guard result.count < session.maxContacts else {
                        stop.pointee = true
                        return
                    }
                    guard let e164 = try? ActivityPhoneNormalizer.e164(
                        phone.value.stringValue,
                        region: session.defaultRegion
                    ) else { continue }
                    result.insert(hash(salt: session.salt, e164: e164))
                }
            }
            return Array(result.prefix(max(0, session.maxContacts))).sorted()
        }.value
    }

    static func hash(salt: String, e164: String) -> String {
        let digest = SHA256.hash(data: Data("\(salt)\u{0}\(e164)".utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

@MainActor
final class ActivityInviteRouteStore: ObservableObject {
    static let shared = ActivityInviteRouteStore()
    @Published private(set) var pendingToken: String?

    private init() {}

    @discardableResult
    func handle(_ url: URL) -> Bool {
        guard let token = Self.token(from: url) else { return false }
        pendingToken = token
        NotificationCenter.default.post(name: .openActivityCenterInvite, object: nil)
        return true
    }

    func consumePendingToken() -> String? {
        defer { pendingToken = nil }
        return pendingToken
    }

    nonisolated static func token(from url: URL) -> String? {
        let components = url.pathComponents.filter { $0 != "/" }
        let candidate: String?
        if url.scheme?.lowercased() == "bwchat", url.host?.lowercased() == "invite" {
            candidate = components.first
        } else if ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                  let marker = components.firstIndex(where: { ["i", "invite"].contains($0.lowercased()) }),
                  components.indices.contains(marker + 1) {
            candidate = components[marker + 1]
        } else {
            candidate = nil
        }
        guard let clean = candidate?.trimmingCharacters(in: .whitespacesAndNewlines),
              (6...256).contains(clean.count),
              clean.unicodeScalars.allSatisfy({
                  CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_.~")).contains($0)
              }) else { return nil }
        return clean
    }
}

extension Notification.Name {
    static let openActivityCenterInvite = Notification.Name("bbchat.openActivityCenterInvite")
}
