import Foundation

struct GameCatalogPage: Codable, Equatable {
    let items: [GameCatalogItem]
    var nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items
        case nextCursor = "next_cursor"
    }
}

struct GameCatalogItem: Codable, Equatable, Identifiable, Hashable {
    let id: String
    let name: String
    let posterURL: String
    let iconURL: String?
    let summary: String?
    let gameType: String?
    let entryPriceGoldCoins: Int?
    let sortOrder: Int
    let lastPlayedAt: String?

    var displayIconURL: String {
        guard let iconURL,
              !iconURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return posterURL
        }
        return iconURL
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case posterURL = "poster_url"
        case iconURL = "icon_url"
        case summary = "description"
        case gameType = "game_type"
        case entryPriceGoldCoins = "entry_price_gold_coins"
        case sortOrder = "order"
        case lastPlayedAt = "last_played_at"
    }

    private enum LegacyCodingKeys: String, CodingKey {
        case entryPriceCatCoins = "entry_price_cat_coins"
    }

    init(
        id: String,
        name: String,
        posterURL: String,
        iconURL: String?,
        summary: String?,
        gameType: String?,
        entryPriceGoldCoins: Int?,
        sortOrder: Int,
        lastPlayedAt: String?
    ) {
        self.id = id
        self.name = name
        self.posterURL = posterURL
        self.iconURL = iconURL
        self.summary = summary
        self.gameType = gameType
        self.entryPriceGoldCoins = entryPriceGoldCoins
        self.sortOrder = sortOrder
        self.lastPlayedAt = lastPlayedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let legacyContainer = try decoder.container(keyedBy: LegacyCodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        posterURL = try container.decode(String.self, forKey: .posterURL)
        iconURL = try container.decodeIfPresent(String.self, forKey: .iconURL)
        summary = try container.decodeIfPresent(String.self, forKey: .summary)
        gameType = try container.decodeIfPresent(String.self, forKey: .gameType)
        entryPriceGoldCoins = container.flexInt(for: .entryPriceGoldCoins)
            ?? legacyContainer.flexInt(for: .entryPriceCatCoins)
        sortOrder = try container.decode(Int.self, forKey: .sortOrder)
        lastPlayedAt = try container.decodeIfPresent(String.self, forKey: .lastPlayedAt)
    }
}

enum GameLobbySessionRequest {
    static let requestBody: [String: Any] = ["purpose": "lobby"]
}

enum GameRoundStartRequestPayload {
    /// Game rounds have one server-authoritative payment path: Gold Coins.
    static let requestBody: [String: Any] = ["payment_method": "gold_coins"]
}

struct GameSession: Decodable, Equatable {
    let sessionID: String
    let launchURL: String
    let expiresAt: String
    let paymentMethod: String?
    let entryPriceGoldCoins: Int?
    let walletBalance: WalletBalanceResponseData?
    let consumedProp: PropConsumptionResult?

    init(
        sessionID: String,
        launchURL: String,
        expiresAt: String,
        paymentMethod: String? = nil,
        entryPriceGoldCoins: Int? = nil,
        walletBalance: WalletBalanceResponseData? = nil,
        consumedProp: PropConsumptionResult? = nil
    ) {
        self.sessionID = sessionID
        self.launchURL = launchURL
        self.expiresAt = expiresAt
        self.paymentMethod = paymentMethod
        self.entryPriceGoldCoins = entryPriceGoldCoins
        self.walletBalance = walletBalance
        self.consumedProp = consumedProp
    }

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case launchURL = "launch_url"
        case expiresAt = "expires_at"
        case paymentMethod = "payment_method"
        case entryPriceGoldCoins = "entry_price_gold_coins"
        case walletBalance = "wallet_balance"
        case consumedProp = "consumed_prop"
    }

    private enum LegacyCodingKeys: String, CodingKey {
        case entryPriceCatCoins = "entry_price_cat_coins"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let legacyContainer = try decoder.container(keyedBy: LegacyCodingKeys.self)

        sessionID = try container.decode(String.self, forKey: .sessionID)
        launchURL = try container.decode(String.self, forKey: .launchURL)
        expiresAt = try container.decode(String.self, forKey: .expiresAt)
        paymentMethod = try container.decodeIfPresent(String.self, forKey: .paymentMethod)
        entryPriceGoldCoins = container.flexInt(for: .entryPriceGoldCoins)
            ?? legacyContainer.flexInt(for: .entryPriceCatCoins)
        walletBalance = try container.decodeIfPresent(WalletBalanceResponseData.self, forKey: .walletBalance)
        consumedProp = try container.decodeIfPresent(PropConsumptionResult.self, forKey: .consumedProp)
    }
}

struct GameRoundStart: Decodable, Equatable {
    let roundID: String
    let roundToken: String
    let expiresAt: String
    let paymentMethod: String
    let entryPriceGoldCoins: Int
    let walletBalance: WalletBalanceResponseData
    let consumedProp: PropConsumptionResult?

    enum CodingKeys: String, CodingKey {
        case roundID = "round_id"
        case roundToken = "round_token"
        case expiresAt = "expires_at"
        case paymentMethod = "payment_method"
        case entryPriceGoldCoins = "entry_price_gold_coins"
        case walletBalance = "wallet_balance"
        case consumedProp = "consumed_prop"
    }
}

enum GameLobbySessionResponseValidationError: Error, Equatable {
    case paymentWasApplied
    case invalidEntryPrice
}

enum GameLobbySessionResponseValidator {
    static func validate(_ session: GameSession) throws {
        guard session.paymentMethod == nil,
              session.walletBalance == nil,
              session.consumedProp == nil else {
            throw GameLobbySessionResponseValidationError.paymentWasApplied
        }
        guard let price = session.entryPriceGoldCoins, price > 0 else {
            throw GameLobbySessionResponseValidationError.invalidEntryPrice
        }
    }
}

enum GameRoundStartResponseValidationError: Error, Equatable {
    case invalidRoundGrant
    case paymentMethodMismatch
    case invalidConsumption
}

enum GameRoundStartResponseValidator {
    static func validate(_ round: GameRoundStart) throws {
        guard !round.roundID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !round.roundToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              round.entryPriceGoldCoins > 0,
              round.walletBalance.isSpendableBalanceConsistent else {
            throw GameRoundStartResponseValidationError.invalidRoundGrant
        }

        guard round.paymentMethod == "gold_coins" else {
            throw GameRoundStartResponseValidationError.paymentMethodMismatch
        }
        guard round.consumedProp == nil else {
            throw GameRoundStartResponseValidationError.invalidConsumption
        }
    }
}
