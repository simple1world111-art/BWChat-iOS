import Foundation

enum ActivityCenterTaskKind: String, Codable, CaseIterable {
    case contactSync = "contact_sync"
    case inviteShare = "invite_share"
    case validInvite = "valid_invite"
}

enum ActivityCenterClaimStatus: String, Codable {
    case locked
    case available
    case claimable
    case claimed
    case completed
    case unavailable

    var canClaim: Bool {
        self == .available || self == .claimable
    }
}

struct ActivityCenterSnapshot: Codable, Equatable {
    let configVersion: String
    let serverTime: String
    let businessTimezone: String
    let activityCatFoodBalance: Int
    let goldCoinBalance: Int
    let phoneBinding: ActivityPhoneBindingState
    let checkIn: ActivityCheckInState
    let mealRewards: [ActivityMealReward]
    let tasks: [ActivityCenterTask]
    let invitation: ActivityInvitationState
    let wheel: ActivityWheelState

    enum CodingKeys: String, CodingKey {
        case configVersion = "config_version"
        case serverTime = "server_time"
        case businessTimezone = "business_timezone"
        case activityCatFoodBalance = "activity_cat_food_balance"
        case goldCoinBalance = "gold_coin_balance"
        case phoneBinding = "phone_binding"
        case checkIn = "check_in"
        case mealRewards = "meal_rewards"
        case tasks
        case invitation
        case wheel
    }

    func task(_ kind: ActivityCenterTaskKind) -> ActivityCenterTask? {
        tasks.first { $0.kind == kind }
    }

    func optimisticallyClaimingCheckIn() -> ActivityCenterSnapshot? {
        guard let claimableDay = checkIn.nextClaimableDay else { return nil }
        let updatedDays = checkIn.days.map { day in
            guard day.id == claimableDay.id else { return day }
            return ActivityCheckInDay(
                day: day.day,
                rewardActivityCatFood: day.rewardActivityCatFood,
                status: .claimed
            )
        }
        let completed = !updatedDays.isEmpty && updatedDays.allSatisfy {
            $0.status == .claimed || $0.status == .completed
        }
        return replacing(
            activityCatFoodBalance: activityCatFoodBalance + claimableDay.rewardActivityCatFood,
            checkIn: ActivityCheckInState(
                activityID: checkIn.activityID,
                claimedDays: min(checkIn.claimedDays + 1, updatedDays.count),
                completed: completed,
                canClaim: false,
                days: updatedDays
            )
        )
    }

    func optimisticallyClaimingMeal(id: String) -> ActivityCenterSnapshot? {
        guard let meal = mealRewards.first(where: { $0.id == id && $0.status.canClaim }) else {
            return nil
        }
        let updatedMeals = mealRewards.map { candidate in
            guard candidate.id == id else { return candidate }
            return ActivityMealReward(
                id: candidate.id,
                titleKey: candidate.titleKey,
                startLocal: candidate.startLocal,
                endLocal: candidate.endLocal,
                rewardActivityCatFood: candidate.rewardActivityCatFood,
                status: .claimed,
                nextTransitionAt: candidate.nextTransitionAt,
                claimedAt: serverTime
            )
        }
        return replacing(
            activityCatFoodBalance: activityCatFoodBalance + meal.rewardActivityCatFood,
            mealRewards: updatedMeals
        )
    }

    func replacing(
        activityCatFoodBalance: Int? = nil,
        checkIn: ActivityCheckInState? = nil,
        mealRewards: [ActivityMealReward]? = nil,
        wheel: ActivityWheelState? = nil
    ) -> ActivityCenterSnapshot {
        ActivityCenterSnapshot(
            configVersion: configVersion,
            serverTime: serverTime,
            businessTimezone: businessTimezone,
            activityCatFoodBalance: activityCatFoodBalance ?? self.activityCatFoodBalance,
            goldCoinBalance: goldCoinBalance,
            phoneBinding: phoneBinding,
            checkIn: checkIn ?? self.checkIn,
            mealRewards: mealRewards ?? self.mealRewards,
            tasks: tasks,
            invitation: invitation,
            wheel: wheel ?? self.wheel
        )
    }

    static let preview = ActivityCenterSnapshot(
        configVersion: "activity-preview-v1",
        serverTime: "2026-08-03T12:28:00+09:00",
        businessTimezone: "Asia/Tokyo",
        activityCatFoodBalance: 60,
        goldCoinBalance: 1_280,
        phoneBinding: ActivityPhoneBindingState(
            isVerified: false,
            maskedPhone: nil,
            defaultRegion: "JP"
        ),
        checkIn: ActivityCheckInState(
            activityID: "new_user_7d_v1",
            claimedDays: 1,
            completed: false,
            canClaim: true,
            days: [
                ActivityCheckInDay(day: 1, rewardActivityCatFood: 10, status: .claimed),
                ActivityCheckInDay(day: 2, rewardActivityCatFood: 20, status: .claimable),
                ActivityCheckInDay(day: 3, rewardActivityCatFood: 30, status: .locked),
                ActivityCheckInDay(day: 4, rewardActivityCatFood: 40, status: .locked),
                ActivityCheckInDay(day: 5, rewardActivityCatFood: 50, status: .locked),
                ActivityCheckInDay(day: 6, rewardActivityCatFood: 60, status: .locked),
                ActivityCheckInDay(day: 7, rewardActivityCatFood: 100, status: .locked)
            ]
        ),
        mealRewards: [
            ActivityMealReward(
                id: "breakfast",
                titleKey: "activityCenter.meal.breakfast",
                startLocal: "07:00",
                endLocal: "09:00",
                rewardActivityCatFood: 10,
                status: .claimed,
                nextTransitionAt: nil,
                claimedAt: "2026-08-03T08:01:00+09:00"
            ),
            ActivityMealReward(
                id: "lunch",
                titleKey: "activityCenter.meal.lunch",
                startLocal: "12:00",
                endLocal: "14:00",
                rewardActivityCatFood: 20,
                status: .claimable,
                nextTransitionAt: "2026-08-03T14:00:00+09:00",
                claimedAt: nil
            ),
            ActivityMealReward(
                id: "dinner",
                titleKey: "activityCenter.meal.dinner",
                startLocal: "18:00",
                endLocal: "21:00",
                rewardActivityCatFood: 20,
                status: .locked,
                nextTransitionAt: "2026-08-03T18:00:00+09:00",
                claimedAt: nil
            )
        ],
        tasks: [
            ActivityCenterTask(
                id: "contact_sync",
                kind: .contactSync,
                status: .available,
                rewardActivityCatFood: 100,
                dailyLimit: nil,
                completedCount: 0,
                creditedCount: 0
            ),
            ActivityCenterTask(
                id: "invite_share",
                kind: .inviteShare,
                status: .available,
                rewardActivityCatFood: 10,
                dailyLimit: 5,
                completedCount: 1,
                creditedCount: 1
            ),
            ActivityCenterTask(
                id: "valid_invite",
                kind: .validInvite,
                status: .available,
                rewardActivityCatFood: 100,
                dailyLimit: nil,
                completedCount: 0,
                creditedCount: 0
            )
        ],
        invitation: ActivityInvitationState(
            inviteCode: "MEOW88",
            shareURL: "https://example.com/i/activity-preview",
            pendingInvites: 1,
            creditedInvites: 0,
            canRedeem: true
        ),
        wheel: ActivityWheelState(
            enabled: true,
            currency: "gold_coin",
            currentTier: ActivityWheelTier(
                id: "tier_10",
                sequence: 2,
                costGoldCoins: 10,
                nextTierID: "tier_100",
                segments: [
                    ActivityWheelSegment(id: "p10", payoutGoldCoins: 10, probabilityPPM: 500_000, displayOrder: 0),
                    ActivityWheelSegment(id: "p20", payoutGoldCoins: 20, probabilityPPM: 300_000, displayOrder: 1),
                    ActivityWheelSegment(id: "p50", payoutGoldCoins: 50, probabilityPPM: 150_000, displayOrder: 2),
                    ActivityWheelSegment(id: "p100", payoutGoldCoins: 100, probabilityPPM: 50_000, displayOrder: 3)
                ]
            ),
            recentWinners: [
                ActivityWheelWinner(id: "winner-1", displayName: "M***w", avatarURL: "", payoutGoldCoins: 100),
                ActivityWheelWinner(id: "winner-2", displayName: "P***r", avatarURL: "", payoutGoldCoins: 50)
            ]
        )
    )
}

struct ActivityPhoneBindingState: Codable, Equatable {
    let isVerified: Bool
    let maskedPhone: String?
    let defaultRegion: String?

    enum CodingKeys: String, CodingKey {
        case isVerified = "is_verified"
        case maskedPhone = "masked_phone"
        case defaultRegion = "default_region"
    }
}

struct ActivityCheckInState: Codable, Equatable {
    let activityID: String
    let claimedDays: Int
    let completed: Bool
    let canClaim: Bool
    let days: [ActivityCheckInDay]

    enum CodingKeys: String, CodingKey {
        case activityID = "activity_id"
        case claimedDays = "claimed_days"
        case completed
        case canClaim = "can_claim"
        case days
    }

    var nextClaimableDay: ActivityCheckInDay? {
        days.sorted { $0.day < $1.day }.first { $0.status.canClaim }
    }
}

struct ActivityCheckInDay: Codable, Equatable, Identifiable {
    let day: Int
    let rewardActivityCatFood: Int
    let status: ActivityCenterClaimStatus

    var id: Int { day }

    enum CodingKeys: String, CodingKey {
        case day
        case rewardActivityCatFood = "reward_activity_cat_food"
        case status
    }
}

struct ActivityMealReward: Codable, Equatable, Identifiable {
    let id: String
    let titleKey: String?
    let startLocal: String
    let endLocal: String
    let rewardActivityCatFood: Int
    let status: ActivityCenterClaimStatus
    let nextTransitionAt: String?
    let claimedAt: String?

    enum CodingKeys: String, CodingKey {
        case id = "window_id"
        case titleKey = "title_key"
        case startLocal = "start_local"
        case endLocal = "end_local"
        case rewardActivityCatFood = "reward_activity_cat_food"
        case status
        case nextTransitionAt = "next_transition_at"
        case claimedAt = "claimed_at"
    }

    var displayTitle: String {
        guard let titleKey, !titleKey.isEmpty else { return id }
        let localized = L10n.tr(titleKey)
        return localized == titleKey ? id : localized
    }
}

struct ActivityCenterTask: Codable, Equatable, Identifiable {
    let id: String
    let kind: ActivityCenterTaskKind
    let status: ActivityCenterClaimStatus
    let rewardActivityCatFood: Int
    let dailyLimit: Int?
    let completedCount: Int
    let creditedCount: Int

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case status
        case rewardActivityCatFood = "reward_activity_cat_food"
        case dailyLimit = "daily_limit"
        case completedCount = "completed_count"
        case creditedCount = "credited_count"
    }
}

struct ActivityInvitationState: Codable, Equatable {
    let inviteCode: String
    let shareURL: String
    let pendingInvites: Int
    let creditedInvites: Int
    let canRedeem: Bool

    enum CodingKeys: String, CodingKey {
        case inviteCode = "invite_code"
        case shareURL = "share_url"
        case pendingInvites = "pending_invites"
        case creditedInvites = "credited_invites"
        case canRedeem = "can_redeem"
    }
}

struct ActivityWheelState: Codable, Equatable {
    let enabled: Bool
    let currency: String
    let currentTier: ActivityWheelTier
    let recentWinners: [ActivityWheelWinner]

    enum CodingKeys: String, CodingKey {
        case enabled
        case currency
        case currentTier = "current_tier"
        case recentWinners = "recent_winners"
    }
}

struct ActivityWheelTier: Codable, Equatable, Identifiable {
    let id: String
    let sequence: Int
    let costGoldCoins: Int
    let nextTierID: String
    let segments: [ActivityWheelSegment]

    enum CodingKeys: String, CodingKey {
        case id
        case sequence
        case costGoldCoins = "cost_gold_coins"
        case nextTierID = "next_tier_id"
        case segments
    }

    var displaySegments: [ActivityWheelSegment] {
        segments.sorted { $0.displayOrder < $1.displayOrder }
    }

    var hasValidProbabilityTotal: Bool {
        displaySegments.count == ActivityWheelGeometry.prizeSegmentCount
            && displaySegments.reduce(0) { $0 + $1.probabilityPPM } == 1_000_000
    }
}

struct ActivityWheelSegment: Codable, Equatable, Identifiable {
    let id: String
    let payoutGoldCoins: Int
    let probabilityPPM: Int
    let displayOrder: Int

    enum CodingKeys: String, CodingKey {
        case id
        case payoutGoldCoins = "payout_gold_coins"
        case probabilityPPM = "probability_ppm"
        case displayOrder = "display_order"
    }

    var probabilityText: String {
        let percentage = Double(probabilityPPM) / 10_000
        return percentage.formatted(.number.precision(.fractionLength(0...4))) + "%"
    }
}

struct ActivityWheelWinner: Codable, Equatable, Identifiable {
    let id: String
    let displayName: String
    let avatarURL: String
    let payoutGoldCoins: Int

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case avatarURL = "avatar_url"
        case payoutGoldCoins = "payout_gold_coins"
    }
}

struct ActivityCenterGrantResult: Codable, Equatable {
    let grantedActivityCatFood: Int
    let snapshot: ActivityCenterSnapshot

    enum CodingKeys: String, CodingKey {
        case grantedActivityCatFood = "granted_activity_cat_food"
        case snapshot
    }
}

struct ActivityWheelSpinEnvelope: Codable, Equatable {
    let result: ActivityWheelSpinResult
    let snapshot: ActivityCenterSnapshot
}

struct ActivityWheelSpinResult: Codable, Equatable, Identifiable {
    let spinID: String
    let tierID: String
    let costGoldCoins: Int
    let prizeID: String
    let payoutGoldCoins: Int
    let netDeltaGoldCoins: Int
    let nextTierID: String

    var id: String { spinID }

    enum CodingKeys: String, CodingKey {
        case spinID = "spin_id"
        case tierID = "tier_id"
        case costGoldCoins = "cost_gold_coins"
        case prizeID = "prize_id"
        case payoutGoldCoins = "payout_gold_coins"
        case netDeltaGoldCoins = "net_delta_gold_coins"
        case nextTierID = "next_tier_id"
    }
}

struct ActivityContactDiscoverySession: Codable, Equatable {
    let id: String
    let salt: String
    let saltVersion: String
    let defaultRegion: String
    let maxContacts: Int
    let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case id = "session_id"
        case salt
        case saltVersion = "salt_version"
        case defaultRegion = "default_region"
        case maxContacts = "max_contacts"
        case expiresAt = "expires_at"
    }
}

struct ActivityContactMatchResult: Codable, Equatable {
    let matches: [ActivityMatchedUser]
    let grantedActivityCatFood: Int
    let snapshot: ActivityCenterSnapshot

    enum CodingKeys: String, CodingKey {
        case matches
        case grantedActivityCatFood = "granted_activity_cat_food"
        case snapshot
    }
}

struct ActivityMatchedUser: Codable, Equatable, Identifiable {
    let userID: String
    let nickname: String
    let avatarURL: String
    let relation: String

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case relation
    }
}

struct ActivityInviteShareSession: Codable, Equatable, Identifiable {
    let id: String
    let shareURL: String
    let inviteCode: String
    let message: String
    let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case id = "session_id"
        case shareURL = "share_url"
        case inviteCode = "invite_code"
        case message
        case expiresAt = "expires_at"
    }
}

struct ActivityPhoneVerificationSession: Codable, Equatable {
    let id: String
    let expiresAt: String
    let retryAfterSeconds: Int

    enum CodingKeys: String, CodingKey {
        case id = "session_id"
        case expiresAt = "expires_at"
        case retryAfterSeconds = "retry_after_seconds"
    }
}

// MARK: - Activity Center response compatibility

private extension KeyedDecodingContainer {
    func activityString(forKey key: Key) -> String? {
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            return value
        }
        if let value = try? decodeIfPresent(Int.self, forKey: key) {
            return String(value)
        }
        return nil
    }

    func activityRequiredString(forKey key: Key) throws -> String {
        guard let value = activityString(forKey: key), !value.isEmpty else {
            throw DecodingError.keyNotFound(
                key,
                DecodingError.Context(
                    codingPath: codingPath,
                    debugDescription: "Missing required string field \(key.stringValue)."
                )
            )
        }
        return value
    }

    func activityInt(forKey key: Key) -> Int? {
        if let value = try? decodeIfPresent(Int.self, forKey: key) {
            return value
        }
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            return Int(value.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        if let value = try? decodeIfPresent(Double.self, forKey: key),
           value.isFinite,
           value.rounded() == value {
            return Int(exactly: value)
        }
        return nil
    }

    func activityRequiredInt(forKey key: Key) throws -> Int {
        guard let value = activityInt(forKey: key) else {
            throw DecodingError.typeMismatch(
                Int.self,
                DecodingError.Context(
                    codingPath: codingPath + [key],
                    debugDescription: "Missing or invalid required integer field \(key.stringValue)."
                )
            )
        }
        return value
    }

    func activityOptionalInt(forKey key: Key) throws -> Int? {
        guard contains(key), try !decodeNil(forKey: key) else { return nil }
        guard let value = activityInt(forKey: key) else {
            throw DecodingError.typeMismatch(
                Int.self,
                DecodingError.Context(
                    codingPath: codingPath + [key],
                    debugDescription: "Invalid optional integer field \(key.stringValue)."
                )
            )
        }
        return value
    }

    func activityBool(forKey key: Key) -> Bool? {
        if let value = try? decodeIfPresent(Bool.self, forKey: key) {
            return value
        }
        if let value = try? decodeIfPresent(Int.self, forKey: key), value == 0 || value == 1 {
            return value == 1
        }
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "true", "1": return true
            case "false", "0": return false
            default: return nil
            }
        }
        return nil
    }

    func activityArray<Element: Decodable>(
        _ type: Element.Type,
        forKey key: Key
    ) throws -> [Element] {
        guard contains(key), try !decodeNil(forKey: key) else { return [] }
        return try decode([Element].self, forKey: key)
    }

    func activityOptional<Value: Decodable>(
        _ type: Value.Type,
        forKey key: Key
    ) throws -> Value? {
        guard contains(key), try !decodeNil(forKey: key) else { return nil }
        return try decode(Value.self, forKey: key)
    }
}

extension ActivityCenterSnapshot {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // The backend uses a null version when no activity configuration has
        // been activated yet. This is a valid read-only/unavailable snapshot,
        // not a malformed wallet response. Mutating wheel requests still require
        // a non-empty version at the view boundary.
        configVersion = container.activityString(forKey: .configVersion) ?? ""
        serverTime = try container.activityRequiredString(forKey: .serverTime)
        businessTimezone = try container.activityRequiredString(forKey: .businessTimezone)
        activityCatFoodBalance = try container.activityRequiredInt(forKey: .activityCatFoodBalance)
        goldCoinBalance = try container.activityRequiredInt(forKey: .goldCoinBalance)
        phoneBinding = try container.activityOptional(ActivityPhoneBindingState.self, forKey: .phoneBinding)
            ?? .unverified
        checkIn = try container.activityOptional(ActivityCheckInState.self, forKey: .checkIn)
            ?? .unavailable
        mealRewards = try container.activityArray(ActivityMealReward.self, forKey: .mealRewards)
        tasks = try container.activityArray(ActivityCenterTask.self, forKey: .tasks)
        invitation = try container.activityOptional(ActivityInvitationState.self, forKey: .invitation)
            ?? .unavailable
        wheel = try container.activityOptional(ActivityWheelState.self, forKey: .wheel)
            ?? .unavailable
    }
}

extension ActivityPhoneBindingState {
    static let unverified = ActivityPhoneBindingState(
        isVerified: false,
        maskedPhone: nil,
        defaultRegion: nil
    )

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        isVerified = container.activityBool(forKey: .isVerified) ?? false
        maskedPhone = container.activityString(forKey: .maskedPhone)
        defaultRegion = container.activityString(forKey: .defaultRegion)
    }
}

extension ActivityCheckInState {
    static let unavailable = ActivityCheckInState(
        activityID: "",
        claimedDays: 0,
        completed: false,
        canClaim: false,
        days: []
    )

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedDays = try container.activityArray(ActivityCheckInDay.self, forKey: .days)
        activityID = container.activityString(forKey: .activityID) ?? ""
        claimedDays = container.activityInt(forKey: .claimedDays)
            ?? decodedDays.filter { $0.status == .claimed || $0.status == .completed }.count
        completed = container.activityBool(forKey: .completed)
            ?? (!decodedDays.isEmpty && decodedDays.allSatisfy { $0.status == .claimed || $0.status == .completed })
        canClaim = container.activityBool(forKey: .canClaim)
            ?? decodedDays.contains { $0.status.canClaim }
        days = decodedDays
    }
}

extension ActivityCheckInDay {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        day = try container.activityRequiredInt(forKey: .day)
        rewardActivityCatFood = try container.activityRequiredInt(forKey: .rewardActivityCatFood)
        status = try container.decode(ActivityCenterClaimStatus.self, forKey: .status)
    }
}

extension ActivityMealReward {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.activityRequiredString(forKey: .id)
        titleKey = container.activityString(forKey: .titleKey)
        startLocal = try container.activityRequiredString(forKey: .startLocal)
        endLocal = try container.activityRequiredString(forKey: .endLocal)
        rewardActivityCatFood = try container.activityRequiredInt(forKey: .rewardActivityCatFood)
        status = try container.decode(ActivityCenterClaimStatus.self, forKey: .status)
        nextTransitionAt = container.activityString(forKey: .nextTransitionAt)
        claimedAt = container.activityString(forKey: .claimedAt)
    }
}

extension ActivityCenterTask {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.activityRequiredString(forKey: .id)
        kind = try container.decode(ActivityCenterTaskKind.self, forKey: .kind)
        status = try container.decode(ActivityCenterClaimStatus.self, forKey: .status)
        rewardActivityCatFood = try container.activityRequiredInt(forKey: .rewardActivityCatFood)
        dailyLimit = try container.activityOptionalInt(forKey: .dailyLimit)
        completedCount = container.activityInt(forKey: .completedCount) ?? 0
        creditedCount = container.activityInt(forKey: .creditedCount) ?? 0
    }
}

extension ActivityInvitationState {
    static let unavailable = ActivityInvitationState(
        inviteCode: "",
        shareURL: "",
        pendingInvites: 0,
        creditedInvites: 0,
        canRedeem: false
    )

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        inviteCode = container.activityString(forKey: .inviteCode) ?? ""
        shareURL = container.activityString(forKey: .shareURL) ?? ""
        pendingInvites = container.activityInt(forKey: .pendingInvites) ?? 0
        creditedInvites = container.activityInt(forKey: .creditedInvites) ?? 0
        canRedeem = container.activityBool(forKey: .canRedeem) ?? false
    }
}

extension ActivityWheelState {
    static let unavailable = ActivityWheelState(
        enabled: false,
        currency: "gold_coin",
        currentTier: .unavailable,
        recentWinners: []
    )

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = container.activityBool(forKey: .enabled) ?? false
        currency = container.activityString(forKey: .currency) ?? "gold_coin"
        currentTier = try container.activityOptional(ActivityWheelTier.self, forKey: .currentTier)
            ?? .unavailable
        recentWinners = try container.activityArray(ActivityWheelWinner.self, forKey: .recentWinners)
    }
}

private enum ActivityWheelTierDecodingKeys: String, CodingKey {
    case id
    case tierID = "tier_id"
    case sequence
    case costGoldCoins = "cost_gold_coins"
    case nextTierID = "next_tier_id"
    case segments
}

extension ActivityWheelTier {
    static let unavailable = ActivityWheelTier(
        id: "",
        sequence: 0,
        costGoldCoins: 0,
        nextTierID: "",
        segments: []
    )

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: ActivityWheelTierDecodingKeys.self)
        guard let decodedID = container.activityString(forKey: .id)
            ?? container.activityString(forKey: .tierID),
            !decodedID.isEmpty else {
            throw DecodingError.keyNotFound(
                ActivityWheelTierDecodingKeys.id,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Missing wheel tier id/tier_id."
                )
            )
        }
        id = decodedID
        sequence = try container.activityRequiredInt(forKey: .sequence)
        costGoldCoins = try container.activityRequiredInt(forKey: .costGoldCoins)
        nextTierID = container.activityString(forKey: .nextTierID) ?? ""
        segments = try container.activityArray(ActivityWheelSegment.self, forKey: .segments)
    }
}

private enum ActivityWheelSegmentDecodingKeys: String, CodingKey {
    case id
    case prizeID = "prize_id"
    case payoutGoldCoins = "payout_gold_coins"
    case probabilityPPM = "probability_ppm"
    case displayOrder = "display_order"
}

extension ActivityWheelSegment {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: ActivityWheelSegmentDecodingKeys.self)
        guard let decodedID = container.activityString(forKey: .id)
            ?? container.activityString(forKey: .prizeID),
            !decodedID.isEmpty else {
            throw DecodingError.keyNotFound(
                ActivityWheelSegmentDecodingKeys.id,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Missing wheel prize id/prize_id."
                )
            )
        }
        id = decodedID
        payoutGoldCoins = try container.activityRequiredInt(forKey: .payoutGoldCoins)
        probabilityPPM = try container.activityRequiredInt(forKey: .probabilityPPM)
        displayOrder = try container.activityRequiredInt(forKey: .displayOrder)
    }
}

extension ActivityWheelWinner {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        displayName = try container.activityRequiredString(forKey: .displayName)
        payoutGoldCoins = try container.activityRequiredInt(forKey: .payoutGoldCoins)
        avatarURL = container.activityString(forKey: .avatarURL) ?? ""
        id = container.activityString(forKey: .id)
            ?? "winner-\(decoder.codingPath.last?.intValue ?? 0)-\(payoutGoldCoins)"
    }
}

extension ActivityWheelSpinResult {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        spinID = try container.activityRequiredString(forKey: .spinID)
        tierID = try container.activityRequiredString(forKey: .tierID)
        costGoldCoins = try container.activityRequiredInt(forKey: .costGoldCoins)
        prizeID = try container.activityRequiredString(forKey: .prizeID)
        payoutGoldCoins = try container.activityRequiredInt(forKey: .payoutGoldCoins)
        netDeltaGoldCoins = try container.activityRequiredInt(forKey: .netDeltaGoldCoins)
        nextTierID = container.activityString(forKey: .nextTierID) ?? ""
    }
}

enum ActivityWheelGeometry {
    // Each tier has four prize wedges. This is not a limit on tier progression.
    static let prizeSegmentCount = 4

    static func landingRotation(segmentIndex: Int, turns: Int = 6) -> Double {
        landingRotation(from: 0, segmentIndex: segmentIndex, turns: turns)
    }

    static func landingRotation(
        from currentRotation: Double,
        segmentIndex: Int,
        turns: Int = 6
    ) -> Double {
        let normalizedIndex = max(0, min(segmentIndex, prizeSegmentCount - 1))
        let segmentAngle = 360.0 / Double(prizeSegmentCount)
        let segmentCenter = -90.0 + (Double(normalizedIndex) + 0.5) * segmentAngle
        let alignment = -90.0 - segmentCenter
        let currentAngle = positiveModulo(currentRotation, 360)
        let landingAngle = positiveModulo(alignment, 360)
        let forwardArc = positiveModulo(landingAngle - currentAngle, 360)
        return currentRotation + Double(max(turns, 1)) * 360.0 + forwardArc
    }

    private static func positiveModulo(_ value: Double, _ divisor: Double) -> Double {
        (value.truncatingRemainder(dividingBy: divisor) + divisor)
            .truncatingRemainder(dividingBy: divisor)
    }
}

enum ActivityWheelMotion: Equatable {
    case anticipation(
        startedAt: Date,
        startRotation: Double,
        degreesPerSecond: Double
    )
    case landing(
        startedAt: Date,
        startRotation: Double,
        targetRotation: Double,
        duration: TimeInterval
    )

    func rotation(at date: Date) -> Double {
        switch self {
        case let .anticipation(startedAt, startRotation, degreesPerSecond):
            let elapsed = max(0, date.timeIntervalSince(startedAt))
            return startRotation + elapsed * degreesPerSecond
        case let .landing(startedAt, startRotation, targetRotation, duration):
            guard duration > 0 else { return targetRotation }
            let elapsed = max(0, date.timeIntervalSince(startedAt))
            let progress = Self.landingProgress(elapsed / duration)
            return startRotation + (targetRotation - startRotation) * progress
        }
    }

    static func landingProgress(_ rawProgress: Double) -> Double {
        let progress = min(max(rawProgress, 0), 1)
        let coastEnd = 0.6
        let coastProgress = 0.75
        guard progress > coastEnd else {
            return coastProgress * progress / coastEnd
        }

        let decelerationProgress = (progress - coastEnd) / (1 - coastEnd)
        let easedDeceleration = 1 - pow(1 - decelerationProgress, 2)
        return coastProgress + (1 - coastProgress) * easedDeceleration
    }
}

enum ActivityCenterDateParser {
    private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let standard = ISO8601DateFormatter()

    static func date(from value: String?) -> Date? {
        guard let value else { return nil }
        return fractional.date(from: value) ?? standard.date(from: value)
    }
}

enum ActivityMealSchedule {
    /// Orders meals by the next applicable local window. A currently open
    /// window comes first, followed by today's upcoming windows, then tomorrow's.
    /// Claimability still comes exclusively from the server-provided status.
    static func ordered(
        _ meals: [ActivityMealReward],
        at serverDate: Date,
        timezoneID: String
    ) -> [ActivityMealReward] {
        guard let timezone = TimeZone(identifier: timezoneID) else { return meals }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timezone
        let components = calendar.dateComponents([.hour, .minute], from: serverDate)
        guard let hour = components.hour, let minute = components.minute else { return meals }
        let currentMinute = hour * 60 + minute

        return meals.enumerated().sorted { lhs, rhs in
            let left = sortKey(for: lhs.element, currentMinute: currentMinute, fallbackIndex: lhs.offset)
            let right = sortKey(for: rhs.element, currentMinute: currentMinute, fallbackIndex: rhs.offset)
            return left < right
        }.map(\.element)
    }

    private static func sortKey(
        for meal: ActivityMealReward,
        currentMinute: Int,
        fallbackIndex: Int
    ) -> (Int, Int, Int) {
        guard let start = minuteOfDay(meal.startLocal),
              let end = minuteOfDay(meal.endLocal),
              start < end else {
            return (Int.max, fallbackIndex, fallbackIndex)
        }

        let minutesUntilWindow: Int
        if currentMinute < start {
            minutesUntilWindow = start - currentMinute
        } else if currentMinute < end {
            minutesUntilWindow = 0
        } else {
            minutesUntilWindow = (24 * 60 - currentMinute) + start
        }
        return (minutesUntilWindow, start, fallbackIndex)
    }

    private static func minuteOfDay(_ value: String) -> Int? {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2,
              let hour = Int(parts[0]), (0..<24).contains(hour),
              let minute = Int(parts[1]), (0..<60).contains(minute) else {
            return nil
        }
        return hour * 60 + minute
    }
}
