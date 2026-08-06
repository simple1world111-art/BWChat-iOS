// BWChat/Models/Gift.swift
// Gift catalog, gift message payloads, and wallet transaction models.

import Foundation

enum WalletCurrency: String, Codable, Equatable, Hashable {
    case goldCoins = "gold_coin"
    case activityCatFood = "activity_cat_food"
    case unknown

    init(_ rawValue: String?) {
        let normalized = (rawValue ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")

        switch normalized {
        case "gold_coin":
            self = .goldCoins
        case "activity_cat_food":
            self = .activityCatFood
        case "":
            self = .unknown
        default:
            self = .unknown
        }
    }

    var localizedUnit: String {
        switch self {
        case .activityCatFood:
            return L10n.tr("wallet.currency.activityCatFood")
        case .goldCoins, .unknown:
            return L10n.tr("wallet.currency.goldCoins")
        }
    }
}

struct GiftCatalogItem: Codable, Identifiable, Equatable, Hashable {
    let giftID: String
    let name: String
    let localizedNameI18n: [String: String]?
    let price: Int
    let assetKey: String
    let remoteAssetKey: String?
    let imageURL: String?
    let animationAssetKey: String?
    let sortOrder: Int?
    let active: Bool?
    let badgeI18n: [String: String]?
    let minAppVersion: String?
    let receiverCurrency: WalletCurrency

    var id: String { giftID }

    enum CodingKeys: String, CodingKey {
        case id
        case giftID = "gift_id"
        case giftId = "giftId"
        case name
        case title
        case localizedName = "localized_name"
        case localizedNameCamel = "localizedName"
        case price
        case amount
        case goldCoinAmount = "gold_coin_amount"
        case assetKey = "asset_key"
        case assetKeyCamel = "assetKey"
        case remoteAssetKey = "remote_asset_key"
        case remoteAssetKeyCamel = "remoteAssetKey"
        case imageURL = "image_url"
        case imageURLCamel = "imageUrl"
        case animationAssetKey = "animation_asset_key"
        case animationAssetKeyCamel = "animationAssetKey"
        case sortOrder = "sort_order"
        case sortOrderCamel = "sortOrder"
        case active
        case badgeI18n = "badge_i18n"
        case minAppVersion = "min_app_version"
        case receiverCurrency = "receiver_currency"
        case receiverCurrencyCamel = "receiverCurrency"
        case currency
    }

    init(
        giftID: String,
        name: String,
        price: Int,
        assetKey: String,
        localizedNameI18n: [String: String]? = nil,
        remoteAssetKey: String? = nil,
        imageURL: String? = nil,
        animationAssetKey: String? = nil,
        sortOrder: Int? = nil,
        active: Bool? = true,
        badgeI18n: [String: String]? = nil,
        minAppVersion: String? = nil
    ) {
        self.giftID = giftID
        self.name = name
        self.localizedNameI18n = localizedNameI18n
        self.price = price
        self.assetKey = assetKey
        self.remoteAssetKey = remoteAssetKey
        self.imageURL = imageURL
        self.animationAssetKey = animationAssetKey
        self.sortOrder = sortOrder
        self.active = active
        self.badgeI18n = badgeI18n
        self.minAppVersion = minAppVersion
        self.receiverCurrency = .goldCoins
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.giftID = container.flexString(for: .giftID)
            ?? container.flexString(for: .giftId)
            ?? container.flexString(for: .id)
            ?? ""
        self.name = container.flexString(for: .name)
            ?? container.flexString(for: .title)
            ?? Self.fixedName(for: giftID)
        self.localizedNameI18n = (try? container.decodeIfPresent([String: String].self, forKey: .localizedName))
            ?? (try? container.decodeIfPresent([String: String].self, forKey: .localizedNameCamel))
        self.price = container.flexInt(for: .price)
            ?? container.flexInt(for: .amount)
            ?? container.flexInt(for: .goldCoinAmount)
            ?? Self.fixedPrice(for: giftID)
        self.assetKey = container.flexString(for: .assetKey)
            ?? container.flexString(for: .assetKeyCamel)
            ?? Self.fixedAssetKey(for: giftID)
        self.remoteAssetKey = container.flexString(for: .remoteAssetKey)
            ?? container.flexString(for: .remoteAssetKeyCamel)
        self.imageURL = container.flexString(for: .imageURL)
            ?? container.flexString(for: .imageURLCamel)
        self.animationAssetKey = container.flexString(for: .animationAssetKey)
            ?? container.flexString(for: .animationAssetKeyCamel)
        self.sortOrder = container.flexInt(for: .sortOrder)
            ?? container.flexInt(for: .sortOrderCamel)
        self.active = container.flexBool(for: .active)
        self.badgeI18n = try? container.decodeIfPresent([String: String].self, forKey: .badgeI18n)
        self.minAppVersion = container.flexString(for: .minAppVersion)
        let rawReceiverCurrency = container.flexString(for: .receiverCurrency)
            ?? container.flexString(for: .receiverCurrencyCamel)
            ?? container.flexString(for: .currency)
        if let rawReceiverCurrency,
           WalletCurrency(rawReceiverCurrency) != .goldCoins {
            throw DecodingError.dataCorruptedError(
                forKey: .receiverCurrency,
                in: container,
                debugDescription: "Gift receivers can only receive gold_coin."
            )
        }
        self.receiverCurrency = .goldCoins
    }

    static let fixedCatalog: [GiftCatalogItem] = [
        GiftCatalogItem(giftID: "fish_10", name: "Dried Fish", price: 10, assetKey: "gift_fish"),
        GiftCatalogItem(giftID: "wand_20", name: "Teaser Wand", price: 20, assetKey: "gift_wand"),
        GiftCatalogItem(giftID: "yarn_50", name: "Yarn Ball", price: 50, assetKey: "gift_yarn"),
        GiftCatalogItem(giftID: "can_100", name: "Cat Can", price: 100, assetKey: "gift_can"),
        GiftCatalogItem(giftID: "tree_200", name: "Cat Tree", price: 200, assetKey: "gift_tree"),
        GiftCatalogItem(giftID: "bell_500", name: "Golden Bell", price: 500, assetKey: "gift_bell")
    ]

    static func fixed(for giftID: String) -> GiftCatalogItem? {
        fixedCatalog.first { $0.giftID == giftID }
    }

    static func fixedName(for giftID: String) -> String {
        fixed(for: giftID)?.localizedName ?? L10n.tr("gift.title")
    }

    static func fixedPrice(for giftID: String) -> Int {
        fixed(for: giftID)?.price ?? 0
    }

    static func fixedAssetKey(for giftID: String) -> String {
        fixed(for: giftID)?.assetKey ?? "gift_fish"
    }

    static func bundledAssetName(for assetKey: String) -> String? {
        fixedCatalog.contains { $0.assetKey == assetKey } ? assetKey : nil
    }

    var localizedName: String {
        if let localized = localizedNameI18n.localizedDynamicValue(for: AppLanguageStore.shared.activeLanguage) {
            return localized
        }
        switch giftID {
        case "fish_10": return L10n.tr("gift.item.fish")
        case "wand_20": return L10n.tr("gift.item.wand")
        case "yarn_50": return L10n.tr("gift.item.yarn")
        case "can_100": return L10n.tr("gift.item.can")
        case "tree_200": return L10n.tr("gift.item.tree")
        case "bell_500": return L10n.tr("gift.item.bell")
        default: return name
        }
    }

    var isActive: Bool {
        active ?? true
    }

    /// Keeps legacy server/cache records for the retired game-entry prop out of
    /// the generic gift catalog during rollout.
    var isSupportedCatalogItem: Bool {
        let retiredIdentifiers = Set(["game_entry_card", "prop_game_entry_card"])
        let identifiers = [giftID, assetKey, remoteAssetKey, animationAssetKey]
            .compactMap { $0 }
            .map {
                $0.trimmingCharacters(in: .whitespacesAndNewlines)
                    .lowercased()
                    .replacingOccurrences(of: "-", with: "_")
            }
        return identifiers.allSatisfy { !retiredIdentifiers.contains($0) }
    }

    var displayAssetKey: String {
        remoteAssetKey?.isBlank == false ? remoteAssetKey! : assetKey
    }
}

struct GiftMessagePayload: Decodable, Equatable {
    let giftID: String
    let giftName: String
    let assetKey: String
    let goldCoinAmount: Int
    let receiverCurrency: WalletCurrency
    let recipientID: String?
    let recipientName: String?
    let senderID: String?
    let senderName: String?

    enum CodingKeys: String, CodingKey {
        case giftID = "gift_id"
        case giftId = "giftId"
        case id
        case giftName = "gift_name"
        case giftNameCamel = "giftName"
        case name
        case title
        case assetKey = "asset_key"
        case assetKeyCamel = "assetKey"
        case price
        case goldCoinAmount = "gold_coin_amount"
        case receiverCurrency = "receiver_currency"
        case receiverCurrencyCamel = "receiverCurrency"
        case currency
        case recipientID = "recipient_id"
        case recipientId = "recipientId"
        case receiverID = "receiver_id"
        case receiverId = "receiverId"
        case toUserID = "to_user_id"
        case recipientName = "recipient_name"
        case recipientNameCamel = "recipientName"
        case receiverName = "receiver_name"
        case receiverNickname = "receiver_nickname"
        case toNickname = "to_nickname"
        case senderID = "sender_id"
        case senderId = "senderId"
        case senderName = "sender_name"
        case senderNickname = "sender_nickname"
    }

    init(
        giftID: String,
        giftName: String,
        assetKey: String,
        goldCoinAmount: Int,
        recipientID: String? = nil,
        recipientName: String? = nil,
        senderID: String? = nil,
        senderName: String? = nil
    ) {
        self.giftID = giftID
        self.giftName = giftName
        self.assetKey = assetKey
        self.goldCoinAmount = goldCoinAmount
        self.receiverCurrency = .goldCoins
        self.recipientID = recipientID
        self.recipientName = recipientName
        self.senderID = senderID
        self.senderName = senderName
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedGiftID = container.flexString(for: .giftID)
            ?? container.flexString(for: .giftId)
            ?? container.flexString(for: .id)
            ?? ""
        let fixed = GiftCatalogItem.fixed(for: decodedGiftID)

        self.giftID = decodedGiftID
        self.giftName = container.flexString(for: .giftName)
            ?? container.flexString(for: .giftNameCamel)
            ?? container.flexString(for: .name)
            ?? container.flexString(for: .title)
            ?? fixed?.localizedName
            ?? L10n.tr("gift.title")
        self.assetKey = container.flexString(for: .assetKey)
            ?? container.flexString(for: .assetKeyCamel)
            ?? fixed?.assetKey
            ?? "gift_fish"
        self.goldCoinAmount = container.flexInt(for: .goldCoinAmount)
            ?? container.flexInt(for: .price)
            ?? fixed?.price
            ?? 0
        let rawReceiverCurrency = container.flexString(for: .receiverCurrency)
            ?? container.flexString(for: .receiverCurrencyCamel)
            ?? container.flexString(for: .currency)
        if let rawReceiverCurrency,
           WalletCurrency(rawReceiverCurrency) != .goldCoins {
            throw DecodingError.dataCorruptedError(
                forKey: .receiverCurrency,
                in: container,
                debugDescription: "Gift message receiver_currency must be gold_coin."
            )
        }
        self.receiverCurrency = .goldCoins
        self.recipientID = container.flexString(for: .recipientID)
            ?? container.flexString(for: .recipientId)
            ?? container.flexString(for: .receiverID)
            ?? container.flexString(for: .receiverId)
            ?? container.flexString(for: .toUserID)
        self.recipientName = container.flexString(for: .recipientName)
            ?? container.flexString(for: .recipientNameCamel)
            ?? container.flexString(for: .receiverName)
            ?? container.flexString(for: .receiverNickname)
            ?? container.flexString(for: .toNickname)
        self.senderID = container.flexString(for: .senderID)
            ?? container.flexString(for: .senderId)
        self.senderName = container.flexString(for: .senderName)
            ?? container.flexString(for: .senderNickname)
    }

    static func parse(_ content: String) -> GiftMessagePayload? {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if let gift = GiftCatalogItem.fixedCatalog.first(where: { $0.giftID == trimmed }) {
            return GiftMessagePayload(
                giftID: gift.giftID,
                giftName: gift.localizedName,
                assetKey: gift.assetKey,
                goldCoinAmount: gift.price
            )
        }

        guard let data = trimmed.data(using: .utf8) else { return nil }
        if let envelope = try? JSONDecoder().decode(GiftMessagePayloadEnvelope.self, from: data),
           let payload = envelope.payload {
            return payload
        }

        if let payload = try? JSONDecoder().decode(GiftMessagePayload.self, from: data),
           payload.isRenderable {
            return payload
        }
        return nil
    }

    static func previewText(content: String) -> String {
        guard let payload = parse(content) else { return content }
        return L10n.tr("message.giftWithName", payload.localizedGiftName)
    }

    fileprivate var isRenderable: Bool {
        !giftID.isBlank
            || !giftName.isBlank && giftName != L10n.tr("gift.title")
            || goldCoinAmount > 0
            || !assetKey.isBlank && assetKey != "gift_fish"
    }
}

private struct GiftMessagePayloadEnvelope: Decodable {
    let payload: GiftMessagePayload?

    enum CodingKeys: String, CodingKey {
        case gift
        case payload
        case data
        case item
        case content
        case message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        for key in [CodingKeys.gift, .payload, .data, .item, .content, .message] {
            if let payload = try? container.decodeIfPresent(GiftMessagePayload.self, forKey: key),
               payload.isRenderable {
                self.payload = payload
                return
            }
            if let giftID = container.flexString(for: key),
               let gift = GiftCatalogItem.fixed(for: giftID) {
                self.payload = GiftMessagePayload(
                    giftID: gift.giftID,
                    giftName: gift.localizedName,
                    assetKey: gift.assetKey,
                    goldCoinAmount: gift.price
                )
                return
            }
        }
        self.payload = nil
    }
}

extension GiftMessagePayload {
    var localizedGiftName: String {
        if let fixed = GiftCatalogItem.fixed(for: giftID) {
            return fixed.localizedName
        }
        if giftName == "\u{793C}\u{7269}" {
            return L10n.tr("gift.title")
        }
        return giftName
    }
}

struct GiftRecipient: Identifiable, Equatable, Hashable {
    let id: String
    let name: String
    let avatarURL: String
}

enum GiftRecipientSource: Equatable {
    case fixed(GiftRecipient)
    case group(groupID: Int, groupName: String)
}

extension Message {
    var isGift: Bool { msgType == "gift" }
    var giftPayload: GiftMessagePayload? { GiftMessagePayload.parse(content) }
}

extension GroupMessage {
    var isGift: Bool { msgType == "gift" }
    var giftPayload: GiftMessagePayload? { GiftMessagePayload.parse(content) }
}

struct WalletTransaction: Codable, Identifiable, Equatable {
    let id: String
    let type: String
    let currency: WalletCurrency
    let goldCoinAmount: Int?
    let goldCoinBalanceAfter: Int?
    let title: String?
    let note: String?
    let giftID: String?
    let giftName: String?
    let productID: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case transactionID = "transaction_id"
        case type
        case currency
        case receiverCurrency = "receiver_currency"
        case amount
        case goldCoinAmount = "gold_coin_amount"
        case goldCoinDelta = "gold_coin_delta"
        case delta
        case totalAmount = "total_amount"
        case goldCoinBalanceAfter = "gold_coin_balance_after"
        // Read-only compatibility for wallet rows written before the Gold Coin rename.
        case legacyCatCoin = "cat_coin"
        case legacyCatCoins = "cat_coins"
        case legacyCatCoinAmount = "cat_coin_amount"
        case legacyCatFood = "cat_food"
        case legacyCatFoodAmount = "cat_food_amount"
        case legacyCoins = "coins"
        case legacyCoinAmount = "coin_amount"
        case legacyBalanceAfter = "balance_after"
        case title
        case note
        case description
        case giftID = "gift_id"
        case giftId = "giftId"
        case giftName = "gift_name"
        case giftNameCamel = "giftName"
        case productID = "product_id"
        case productId = "productId"
        case iapProductID = "iap_product_id"
        case sku
        case createdAt = "created_at"
        case timestamp
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let rawCurrency = container.flexString(for: .currency)
            ?? container.flexString(for: .receiverCurrency)
        guard Self.isCompatibleGoldCoinCurrency(rawCurrency) else {
            throw DecodingError.dataCorruptedError(
                forKey: .currency,
                in: container,
                debugDescription: "Wallet transaction currency must be gold_coin."
            )
        }
        self.id = container.flexString(for: .id)
            ?? container.flexString(for: .transactionID)
            ?? UUID().uuidString
        let decodedType = container.flexString(for: .type) ?? ""
        let decodedGiftID = container.flexString(for: .giftID)
            ?? container.flexString(for: .giftId)
        let decodedGiftName = container.flexString(for: .giftName)
            ?? container.flexString(for: .giftNameCamel)
        let decodedProductID = container.flexString(for: .productID)
            ?? container.flexString(for: .productId)
            ?? container.flexString(for: .iapProductID)
            ?? container.flexString(for: .sku)
        let canonicalAmount = container.flexInt(for: .goldCoinAmount)
            ?? container.flexInt(for: .goldCoinDelta)
            ?? container.flexInt(for: .amount)
            ?? container.flexInt(for: .delta)
            ?? container.flexInt(for: .totalAmount)
        let legacyAmount = container.flexInt(for: .legacyCatCoinAmount)
            ?? container.flexInt(for: .legacyCatCoin)
            ?? container.flexInt(for: .legacyCatCoins)
            ?? container.flexInt(for: .legacyCatFoodAmount)
            ?? container.flexInt(for: .legacyCatFood)
            ?? container.flexInt(for: .legacyCoinAmount)
            ?? container.flexInt(for: .legacyCoins)
        let decodedAmount = canonicalAmount ?? legacyAmount
        let inferredAmount = Self.inferredAmount(
            type: decodedType,
            giftID: decodedGiftID,
            giftName: decodedGiftName,
            productID: decodedProductID
        )

        self.type = decodedType
        self.currency = .goldCoins
        if let decodedAmount, decodedAmount != 0 {
            self.goldCoinAmount = decodedAmount
        } else {
            self.goldCoinAmount = inferredAmount
        }
        self.goldCoinBalanceAfter = container.flexInt(for: .goldCoinBalanceAfter)
            ?? container.flexInt(for: .legacyBalanceAfter)
        self.title = container.flexString(for: .title)
        self.note = container.flexString(for: .note)
            ?? container.flexString(for: .description)
        self.giftID = decodedGiftID
        self.giftName = decodedGiftName
        self.productID = decodedProductID
        self.createdAt = container.flexString(for: .createdAt)
            ?? container.flexString(for: .timestamp)
    }

    /// Older wallet rows used `cat_coin`, `cat_coins`, or bare `cat_food` for
    /// the same asset. Missing currency was also valid in the legacy endpoint.
    /// New API responses must still emit only `gold_coin`.
    private static func isCompatibleGoldCoinCurrency(_ rawValue: String?) -> Bool {
        guard let rawValue else { return true }
        let normalized = rawValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")
        return ["gold_coin", "cat_coin", "cat_coins", "cat_food"].contains(normalized)
    }

    private static func inferredAmount(
        type: String,
        giftID: String?,
        giftName: String?,
        productID: String?
    ) -> Int? {
        let normalizedType = type.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        if normalizedType == "ios_iap",
           let productID,
           let product = AppConfig.goldCoinProducts.first(where: { $0.productID == productID }) {
            return product.coins
        }

        let fixedByID = giftID.flatMap { GiftCatalogItem.fixed(for: $0) }
        let trimmedGiftName = giftName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let fixedByName = GiftCatalogItem.fixedCatalog.first { $0.name == trimmedGiftName }
        let fixedGift = fixedByID ?? fixedByName

        guard let fixedGift else { return nil }
        if normalizedType == "gift_received" {
            return Int((Double(fixedGift.price) * 0.8).rounded(.down))
        }
        return fixedGift.price
    }

    private enum LocalizedRecordKind {
        case activityWheelPrize
        case activityWheelCost
        case gameRoundStart
        case gameRankingReward

        var titleKey: String {
            switch self {
            case .activityWheelPrize: return "wallet.transaction.activityWheelPrize"
            case .activityWheelCost: return "wallet.transaction.activityWheelCost"
            case .gameRoundStart: return "wallet.transaction.gameRoundStart"
            case .gameRankingReward: return "wallet.transaction.gameRankingReward"
            }
        }

        var subtitleKey: String {
            switch self {
            case .activityWheelPrize, .activityWheelCost: return "activityCenter.tab.wheel"
            case .gameRoundStart, .gameRankingReward: return "gameCenter.title"
            }
        }
    }

    private var localizedRecordKind: LocalizedRecordKind? {
        let values = [type, title, note]
            .compactMap { $0 }
            .map(Self.normalizedRecordText)
            .filter { !$0.isEmpty }

        if values.contains(where: {
            $0 == "activity wheel prize"
                || $0 == "activity center wheel prize"
                || ($0.contains("wheel")
                    && ($0.contains("prize") || $0.contains("payout"))
                    && $0.contains("activity"))
        }) {
            return .activityWheelPrize
        }
        if values.contains(where: {
            $0 == "activity wheel cost"
                || $0 == "activity center wheel cost"
                || ($0.contains("wheel")
                    && ($0.contains("cost") || $0.contains("debit"))
                    && $0.contains("activity"))
        }) {
            return .activityWheelCost
        }
        if values.contains(where: {
            $0 == "game round start"
                || $0 == "paid game start"
                || $0.contains("收费游戏开局")
                || $0.contains("收费游戏入场")
                || $0.contains("遊戲入場")
                || $0.contains("游戏入场")
        }) {
            return .gameRoundStart
        }
        if values.contains(where: {
            $0 == "ranking reward"
                || $0 == "game ranking reward"
                || $0 == "leaderboard reward"
                || $0.contains("排行榜奖励")
                || $0.contains("排行榜獎勵")
        }) {
            return .gameRankingReward
        }
        return nil
    }

    private static func normalizedRecordText(_ value: String) -> String {
        value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    var displayTitle: String {
        if let localizedRecordKind {
            return L10n.tr(localizedRecordKind.titleKey)
        }
        if let title, !title.isBlank { return title }
        switch type {
        case "ios_iap": return L10n.tr("wallet.transaction.iap")
        case "gift_sent": return L10n.tr("wallet.transaction.giftSent")
        case "gift_received": return L10n.tr("wallet.transaction.giftReceived")
        case "red_packet_sent": return L10n.tr("wallet.transaction.redPacketSent")
        case "red_packet_received": return L10n.tr("wallet.transaction.redPacketReceived")
        case "red_packet_refund": return L10n.tr("wallet.transaction.redPacketRefund")
        case "transfer_sent": return L10n.tr("wallet.transaction.transferSent")
        case "transfer_received": return L10n.tr("wallet.transaction.transferReceived")
        case "transfer_returned": return L10n.tr("wallet.transaction.transferReturned")
        default: return L10n.tr("wallet.transaction.balanceChange")
        }
    }

    var displaySubtitle: String {
        if let localizedRecordKind {
            return L10n.tr(localizedRecordKind.subtitleKey)
        }
        if let giftName, !giftName.isBlank { return giftName }
        if let note, !note.isBlank { return note }
        switch type {
        case "ios_iap": return L10n.tr("wallet.transaction.iapSubtitle")
        case "gift_sent": return L10n.tr("wallet.transaction.giftSentSubtitle")
        case "gift_received": return L10n.tr("wallet.transaction.giftReceivedSubtitle")
        case "red_packet_sent", "red_packet_received", "red_packet_refund",
             "transfer_sent", "transfer_received", "transfer_returned":
            return L10n.tr("wallet.transaction.chatMoneySubtitle")
        default: return type
        }
    }

    var hasDisplayableAmount: Bool {
        guard let goldCoinAmount else { return false }
        return goldCoinAmount != 0
    }

    var signedAmountValue: Int? {
        guard let goldCoinAmount, goldCoinAmount != 0 else { return nil }
        switch type {
        case "gift_sent", "red_packet_sent", "transfer_sent":
            return -abs(goldCoinAmount)
        case "ios_iap", "gift_received", "red_packet_received", "red_packet_refund", "transfer_received", "transfer_returned":
            return abs(goldCoinAmount)
        default:
            return goldCoinAmount
        }
    }

    var signedAmountText: String {
        guard let signedAmountValue else { return "--" }
        let sign = signedAmountValue >= 0 ? "+" : "-"
        return "\(sign)\(abs(signedAmountValue)) \(currency.localizedUnit)"
    }
}

struct GoldCoinAmount: Equatable, Codable, Hashable, Sendable {
    let value: Int

    init(_ value: Int) {
        self.value = value
    }
}

struct ActivityCatFoodAmount: Equatable, Codable, Hashable, Sendable {
    let value: Int

    init(_ value: Int) {
        self.value = value
    }
}

struct GiftCatalogResponseData: Decodable {
    let gifts: [GiftCatalogItem]

    enum CodingKeys: String, CodingKey {
        case gifts
        case catalog
        case items
    }

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let gifts = try? single.decode([GiftCatalogItem].self) {
            self.gifts = gifts
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.gifts = (try? container.decode([GiftCatalogItem].self, forKey: .gifts))
            ?? (try? container.decode([GiftCatalogItem].self, forKey: .catalog))
            ?? (try? container.decode([GiftCatalogItem].self, forKey: .items))
            ?? []
    }
}

struct WalletBalanceResponseData: Codable, Equatable {
    let currency: WalletCurrency
    let goldCoinBalance: GoldCoinAmount
    let activityCatFoodBalance: ActivityCatFoodAmount
    let spendableBalance: Int
    let rechargeGoldCoinBalance: GoldCoinAmount
    let giftIncomeGoldCoinBalance: GoldCoinAmount
    let withdrawFrozenGoldCoinBalance: GoldCoinAmount
    let withdrawableGoldCoinBalance: GoldCoinAmount
    let chatMoneyFrozenGoldCoinBalance: GoldCoinAmount
    let hasServerActivityCatFoodBalance: Bool

    var isSpendableBalanceConsistent: Bool {
        spendableBalance == goldCoinBalance.value + activityCatFoodBalance.value
    }

    enum CodingKeys: String, CodingKey {
        case currency
        case goldCoinBalance = "gold_coin_balance"
        case activityCatFoodBalance = "activity_cat_food_balance"
        case spendableBalance = "spendable_balance"
        case rechargeGoldCoinBalance = "recharge_gold_coin_balance"
        case giftIncomeGoldCoinBalance = "gift_income_gold_coin_balance"
        case withdrawFrozenGoldCoinBalance = "withdraw_frozen_gold_coin_balance"
        case withdrawableGoldCoinBalance = "withdrawable_gold_coin_balance"
        case chatMoneyFrozenGoldCoinBalance = "chat_money_frozen_gold_coin_balance"
    }

    init(
        goldCoinBalance: Int,
        activityCatFoodBalance: Int = 0,
        spendableBalance: Int,
        rechargeGoldCoinBalance: Int? = nil,
        giftIncomeGoldCoinBalance: Int = 0,
        withdrawFrozenGoldCoinBalance: Int = 0,
        withdrawableGoldCoinBalance: Int = 0,
        chatMoneyFrozenGoldCoinBalance: Int = 0,
        hasServerActivityCatFoodBalance: Bool = true
    ) {
        self.currency = .goldCoins
        self.goldCoinBalance = GoldCoinAmount(goldCoinBalance)
        self.activityCatFoodBalance = ActivityCatFoodAmount(activityCatFoodBalance)
        self.spendableBalance = spendableBalance
        self.rechargeGoldCoinBalance = GoldCoinAmount(rechargeGoldCoinBalance ?? goldCoinBalance)
        self.giftIncomeGoldCoinBalance = GoldCoinAmount(giftIncomeGoldCoinBalance)
        self.withdrawFrozenGoldCoinBalance = GoldCoinAmount(withdrawFrozenGoldCoinBalance)
        self.withdrawableGoldCoinBalance = GoldCoinAmount(withdrawableGoldCoinBalance)
        self.chatMoneyFrozenGoldCoinBalance = GoldCoinAmount(chatMoneyFrozenGoldCoinBalance)
        self.hasServerActivityCatFoodBalance = hasServerActivityCatFoodBalance
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let rawCurrency = container.flexString(for: .currency)
        guard WalletCurrency(rawCurrency) == .goldCoins else {
            throw DecodingError.dataCorruptedError(
                forKey: .currency,
                in: container,
                debugDescription: "Wallet currency must be gold_coin."
            )
        }

        let goldCoins = try container.requiredFlexInt(for: .goldCoinBalance)
        let activityCatFood = try container.requiredFlexInt(for: .activityCatFoodBalance)
        let spendable = try container.requiredFlexInt(for: .spendableBalance)
        let rechargeGoldCoins = try container.requiredFlexInt(for: .rechargeGoldCoinBalance)
        let giftIncomeGoldCoins = try container.requiredFlexInt(for: .giftIncomeGoldCoinBalance)
        let withdrawFrozenGoldCoins = try container.requiredFlexInt(for: .withdrawFrozenGoldCoinBalance)
        let withdrawableGoldCoins = try container.requiredFlexInt(for: .withdrawableGoldCoinBalance)
        let chatMoneyFrozenGoldCoins = try container.requiredFlexInt(for: .chatMoneyFrozenGoldCoinBalance)
        let balances = [
            goldCoins,
            activityCatFood,
            spendable,
            rechargeGoldCoins,
            giftIncomeGoldCoins,
            withdrawFrozenGoldCoins,
            withdrawableGoldCoins,
            chatMoneyFrozenGoldCoins
        ]
        guard balances.allSatisfy({ $0 >= 0 }) else {
            throw DecodingError.dataCorruptedError(
                forKey: .goldCoinBalance,
                in: container,
                debugDescription: "Wallet balances must be non-negative."
            )
        }

        self.currency = .goldCoins
        self.goldCoinBalance = GoldCoinAmount(goldCoins)
        self.activityCatFoodBalance = ActivityCatFoodAmount(activityCatFood)
        self.spendableBalance = spendable
        self.rechargeGoldCoinBalance = GoldCoinAmount(rechargeGoldCoins)
        self.giftIncomeGoldCoinBalance = GoldCoinAmount(giftIncomeGoldCoins)
        self.withdrawFrozenGoldCoinBalance = GoldCoinAmount(withdrawFrozenGoldCoins)
        self.withdrawableGoldCoinBalance = GoldCoinAmount(withdrawableGoldCoins)
        self.chatMoneyFrozenGoldCoinBalance = GoldCoinAmount(chatMoneyFrozenGoldCoins)
        self.hasServerActivityCatFoodBalance = true
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(WalletCurrency.goldCoins.rawValue, forKey: .currency)
        try container.encode(goldCoinBalance.value, forKey: .goldCoinBalance)
        try container.encode(activityCatFoodBalance.value, forKey: .activityCatFoodBalance)
        try container.encode(spendableBalance, forKey: .spendableBalance)
        try container.encode(rechargeGoldCoinBalance.value, forKey: .rechargeGoldCoinBalance)
        try container.encode(giftIncomeGoldCoinBalance.value, forKey: .giftIncomeGoldCoinBalance)
        try container.encode(withdrawFrozenGoldCoinBalance.value, forKey: .withdrawFrozenGoldCoinBalance)
        try container.encode(withdrawableGoldCoinBalance.value, forKey: .withdrawableGoldCoinBalance)
        try container.encode(chatMoneyFrozenGoldCoinBalance.value, forKey: .chatMoneyFrozenGoldCoinBalance)
    }
}

struct MixedAssetCharge: Decodable, Equatable {
    let chargedActivityCatFood: ActivityCatFoodAmount
    let chargedGoldCoins: GoldCoinAmount
    let totalCharged: Int
    let walletBalance: WalletBalanceResponseData

    enum CodingKeys: String, CodingKey {
        case chargedActivityCatFood = "charged_activity_cat_food"
        case chargedGoldCoins = "charged_gold_coins"
        case totalCharged = "total_charged"
        case walletBalance = "wallet_balance"
    }

    init(
        chargedActivityCatFood: Int,
        chargedGoldCoins: Int,
        totalCharged: Int,
        walletBalance: WalletBalanceResponseData
    ) {
        self.chargedActivityCatFood = ActivityCatFoodAmount(chargedActivityCatFood)
        self.chargedGoldCoins = GoldCoinAmount(chargedGoldCoins)
        self.totalCharged = totalCharged
        self.walletBalance = walletBalance
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let activityCatFood = try container.requiredFlexInt(for: .chargedActivityCatFood)
        let goldCoins = try container.requiredFlexInt(for: .chargedGoldCoins)
        let total = try container.requiredFlexInt(for: .totalCharged)
        guard activityCatFood >= 0, goldCoins >= 0, total >= 0 else {
            throw DecodingError.dataCorruptedError(
                forKey: .totalCharged,
                in: container,
                debugDescription: "Mixed-charge amounts must be non-negative."
            )
        }
        guard total == activityCatFood + goldCoins else {
            throw DecodingError.dataCorruptedError(
                forKey: .totalCharged,
                in: container,
                debugDescription: "total_charged must equal the two charged asset amounts."
            )
        }

        chargedActivityCatFood = ActivityCatFoodAmount(activityCatFood)
        chargedGoldCoins = GoldCoinAmount(goldCoins)
        totalCharged = total
        walletBalance = try container.decode(WalletBalanceResponseData.self, forKey: .walletBalance)
    }

    var isTotalConsistent: Bool {
        totalCharged == chargedActivityCatFood.value + chargedGoldCoins.value
    }

    static func decodeIfPresent(from decoder: Decoder) throws -> MixedAssetCharge? {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let hasCharge = container.contains(.chargedActivityCatFood)
            || container.contains(.chargedGoldCoins)
            || container.contains(.totalCharged)
            || container.contains(.walletBalance)
        guard hasCharge else { return nil }
        return try MixedAssetCharge(from: decoder)
    }
}

struct ActivityCatFoodTransaction: Decodable, Identifiable, Equatable {
    let id: String
    let delta: Int
    let balanceAfter: Int
    let source: String?
    let title: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case delta
        case balanceAfter = "balance_after"
        case source
        case title
        case createdAt = "created_at"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = container.flexString(for: .id) ?? UUID().uuidString
        delta = container.flexInt(for: .delta) ?? 0
        balanceAfter = container.flexInt(for: .balanceAfter) ?? 0
        source = container.flexString(for: .source)
        title = container.flexString(for: .title)
        createdAt = container.flexString(for: .createdAt)
    }

    private var localizedActivityTitleKey: String? {
        let value = Self.normalizedActivityText([source, title].compactMap { $0 }.joined(separator: " "))
        guard !value.isEmpty else { return nil }

        if value.contains("check in") || value.contains("checkin") || value.contains("sign in") {
            return "activityCenter.checkIn.title"
        }
        if value.contains("breakfast") || value.contains("lunch") || value.contains("dinner")
            || value.contains("meal") {
            return "activityCenter.meals.title"
        }
        if value.contains("contact") {
            return "activityCenter.contacts.title"
        }
        if value.contains("valid invite") || value.contains("invite reward") {
            return "activityCenter.invite.title"
        }
        if value.contains("share") {
            return "activityCenter.share.title"
        }
        if value.contains("invite") {
            return "activityCenter.invite.title"
        }
        return nil
    }

    private static func normalizedActivityText(_ value: String) -> String {
        value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    var displayTitle: String {
        if let localizedActivityTitleKey {
            return L10n.tr(localizedActivityTitleKey)
        }
        if let title, !title.isBlank { return title }
        return L10n.tr("activityCatFood.transaction.adjust")
    }

    var displaySource: String? {
        guard localizedActivityTitleKey != nil else { return nil }
        return L10n.tr("activityCatFood.transaction.grant")
    }

    var signedAmountText: String {
        let sign = delta >= 0 ? "+" : "-"
        return "\(sign)\(abs(delta))"
    }
}

struct ActivityCatFoodTransactionPage: Decodable, Equatable {
    let items: [ActivityCatFoodTransaction]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case items
        case transactions
        case nextCursor = "next_cursor"
        case nextCursorCamel = "nextCursor"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        items = (try? container.decodeIfPresent([ActivityCatFoodTransaction].self, forKey: .items))
            ?? (try? container.decodeIfPresent([ActivityCatFoodTransaction].self, forKey: .transactions))
            ?? []
        nextCursor = container.flexString(for: .nextCursor)
            ?? container.flexString(for: .nextCursorCamel)
    }
}

struct WalletIAPConfirmationResponseData: Decodable {
    let balance: WalletBalanceResponseData?
    let goldCoinAmount: Int?
    let transaction: WalletTransaction?

    enum CodingKeys: String, CodingKey {
        case balance
        case balanceData = "balance_data"
        case balanceDataCamel = "balanceData"
        case wallet
        case walletBalance = "wallet_balance"
        case walletBalanceCamel = "walletBalance"
        case goldCoinAmount = "gold_coin_amount"
        case amount
        case transaction
        case walletTransaction = "wallet_transaction"
        case walletTransactionCamel = "walletTransaction"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.balance = (try? container.decode(WalletBalanceResponseData.self, forKey: .balance))
            ?? (try? container.decode(WalletBalanceResponseData.self, forKey: .balanceData))
            ?? (try? container.decode(WalletBalanceResponseData.self, forKey: .balanceDataCamel))
            ?? (try? container.decode(WalletBalanceResponseData.self, forKey: .wallet))
            ?? (try? container.decode(WalletBalanceResponseData.self, forKey: .walletBalance))
            ?? (try? container.decode(WalletBalanceResponseData.self, forKey: .walletBalanceCamel))
        self.goldCoinAmount = container.flexInt(for: .goldCoinAmount)
            ?? container.flexInt(for: .amount)
        self.transaction = (try? container.decode(WalletTransaction.self, forKey: .transaction))
            ?? (try? container.decode(WalletTransaction.self, forKey: .walletTransaction))
            ?? (try? container.decode(WalletTransaction.self, forKey: .walletTransactionCamel))
    }
}

struct WalletTransactionsResponseData: Codable, Equatable {
    let transactions: [WalletTransaction]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case transactions
        case items
        case records
        case list
        case rows
        case nextCursor = "next_cursor"
        case nextCursorCamel = "nextCursor"
    }

    init(transactions: [WalletTransaction], nextCursor: String?) {
        self.transactions = transactions
        self.nextCursor = nextCursor?.isBlank == false ? nextCursor : nil
    }

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let transactions = Self.decodeTransactions(from: single) {
            self.transactions = transactions
            self.nextCursor = nil
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.transactions = Self.decodeTransactions(from: container, forKey: .transactions)
            ?? Self.decodeTransactions(from: container, forKey: .items)
            ?? Self.decodeTransactions(from: container, forKey: .records)
            ?? Self.decodeTransactions(from: container, forKey: .list)
            ?? Self.decodeTransactions(from: container, forKey: .rows)
            ?? []
        let decodedCursor = container.flexString(for: .nextCursor)
            ?? container.flexString(for: .nextCursorCamel)
        self.nextCursor = decodedCursor?.isBlank == false ? decodedCursor : nil
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(transactions, forKey: .items)
        try container.encodeIfPresent(nextCursor, forKey: .nextCursor)
    }

    private static func decodeTransactions(
        from container: SingleValueDecodingContainer
    ) -> [WalletTransaction]? {
        if let transactions = try? container.decode([WalletTransaction].self) {
            return transactions
        }
        return try? container.decode([LossyWalletTransaction].self).compactMap(\.value)
    }

    private static func decodeTransactions(
        from container: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> [WalletTransaction]? {
        guard container.contains(key) else { return nil }
        if let transactions = try? container.decode([WalletTransaction].self, forKey: key) {
            return transactions
        }
        return try? container.decode([LossyWalletTransaction].self, forKey: key).compactMap(\.value)
    }

    private struct LossyWalletTransaction: Decodable {
        let value: WalletTransaction?

        init(from decoder: Decoder) throws {
            value = try? WalletTransaction(from: decoder)
        }
    }
}

struct WalletWithdrawal: Codable, Identifiable, Equatable {
    let id: String
    let currency: WalletCurrency
    let goldCoinAmount: GoldCoinAmount
    let payoutUSD: Double?
    let payoutCents: Int?
    let provider: String?
    let payoutMethod: String?
    let payoutAccount: String?
    let network: String?
    let walletAddress: String?
    let status: String
    let canCancelFromServer: Bool?
    let note: String?
    let createdAt: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case withdrawalID = "withdrawal_id"
        case withdrawalId = "withdrawalId"
        case currency
        case goldCoinAmount = "gold_coin_amount"
        case payoutUSD = "payout_usd"
        case payoutUSDCamel = "payoutUSD"
        case payoutCents = "payout_cents"
        case payoutCentsCamel = "payoutCents"
        case provider
        case payoutMethod = "payout_method"
        case payoutMethodCamel = "payoutMethod"
        case payoutAccount = "payout_account"
        case payoutAccountCamel = "payoutAccount"
        case network
        case chain
        case walletAddress = "wallet_address"
        case walletAddressCamel = "walletAddress"
        case usdtAddress = "usdt_address"
        case usdtAddressCamel = "usdtAddress"
        case status
        case canCancel = "can_cancel"
        case canCancelCamel = "canCancel"
        case note
        case remark
        case reason
        case createdAt = "created_at"
        case createdAtCamel = "createdAt"
        case updatedAt = "updated_at"
        case updatedAtCamel = "updatedAt"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard WalletCurrency(container.flexString(for: .currency)) == .goldCoins else {
            throw DecodingError.dataCorruptedError(
                forKey: .currency,
                in: container,
                debugDescription: "Withdrawal currency must be gold_coin."
            )
        }
        self.id = container.flexString(for: .id)
            ?? container.flexString(for: .withdrawalID)
            ?? container.flexString(for: .withdrawalId)
            ?? UUID().uuidString
        self.currency = .goldCoins
        self.goldCoinAmount = GoldCoinAmount(container.flexInt(for: .goldCoinAmount) ?? 0)
        self.payoutUSD = container.flexDouble(for: .payoutUSD)
            ?? container.flexDouble(for: .payoutUSDCamel)
        self.payoutCents = container.flexInt(for: .payoutCents)
            ?? container.flexInt(for: .payoutCentsCamel)
        self.provider = container.flexString(for: .provider)
        self.payoutMethod = container.flexString(for: .payoutMethod)
            ?? container.flexString(for: .payoutMethodCamel)
        self.payoutAccount = container.flexString(for: .payoutAccount)
            ?? container.flexString(for: .payoutAccountCamel)
        self.network = container.flexString(for: .network)
            ?? container.flexString(for: .chain)
        self.walletAddress = container.flexString(for: .walletAddress)
            ?? container.flexString(for: .walletAddressCamel)
            ?? container.flexString(for: .usdtAddress)
            ?? container.flexString(for: .usdtAddressCamel)
        self.status = container.flexString(for: .status) ?? "pending"
        self.canCancelFromServer = container.flexBool(for: .canCancel)
            ?? container.flexBool(for: .canCancelCamel)
        self.note = container.flexString(for: .note)
            ?? container.flexString(for: .remark)
            ?? container.flexString(for: .reason)
        self.createdAt = container.flexString(for: .createdAt)
            ?? container.flexString(for: .createdAtCamel)
        self.updatedAt = container.flexString(for: .updatedAt)
            ?? container.flexString(for: .updatedAtCamel)
    }

    var canCancel: Bool {
        if let canCancelFromServer { return canCancelFromServer }
        return ["pending", "requested", "reviewing"].contains(status.lowercased())
    }

    var payoutDisplayText: String {
        let usd: Double
        if let payoutUSD {
            usd = payoutUSD
        } else if let payoutCents {
            usd = Double(payoutCents) / 100
        } else {
            usd = Double(goldCoinAmount.value) * 0.005
        }
        return String(format: "%.2f USDT", usd)
    }

    var displayStatus: String {
        switch status.lowercased() {
        case "pending", "requested":
            return L10n.tr("wallet.withdrawal.status.pending")
        case "reviewing", "processing":
            return L10n.tr("wallet.withdrawal.status.processing")
        case "paid", "completed", "success", "succeeded":
            return L10n.tr("wallet.withdrawal.status.completed")
        case "cancelled", "canceled":
            return L10n.tr("wallet.withdrawal.status.cancelled")
        case "rejected", "failed":
            return L10n.tr("wallet.withdrawal.status.rejected")
        default:
            return status
        }
    }

    var payoutDestinationText: String? {
        if let walletAddress, !walletAddress.isBlank {
            return compactWalletLine(network: network, address: walletAddress)
        }
        if let payoutAccount, !payoutAccount.isBlank {
            let parts = payoutAccount.split(separator: ":", maxSplits: 1).map(String.init)
            if parts.count == 2 {
                return compactWalletLine(network: parts[0], address: parts[1])
            }
            return payoutAccount
        }
        let method = payoutMethod ?? provider
        guard let method, !method.isBlank else { return nil }
        return method.uppercased()
    }

    private func compactWalletLine(network: String?, address: String) -> String {
        let cleanAddress = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard cleanAddress.count > 14 else {
            return [network, cleanAddress].compactMap { $0 }.joined(separator: " ")
        }
        let prefix = String(cleanAddress.prefix(6))
        let suffix = String(cleanAddress.suffix(6))
        return [network, "\(prefix)...\(suffix)"].compactMap { $0 }.joined(separator: " ")
    }
}

struct WalletWithdrawalsResponseData: Decodable {
    let withdrawals: [WalletWithdrawal]

    enum CodingKeys: String, CodingKey {
        case withdrawals
        case items
        case records
        case list
        case rows
    }

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let withdrawals = try? single.decode([WalletWithdrawal].self) {
            self.withdrawals = withdrawals
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.withdrawals = (try? container.decode([WalletWithdrawal].self, forKey: .withdrawals))
            ?? (try? container.decode([WalletWithdrawal].self, forKey: .items))
            ?? (try? container.decode([WalletWithdrawal].self, forKey: .records))
            ?? (try? container.decode([WalletWithdrawal].self, forKey: .list))
            ?? (try? container.decode([WalletWithdrawal].self, forKey: .rows))
            ?? []
    }
}

struct WalletWithdrawalResponseData: Decodable {
    let withdrawal: WalletWithdrawal?

    enum CodingKeys: String, CodingKey {
        case withdrawal
        case item
        case record
        case data
    }

    init(from decoder: Decoder) throws {
        let decodedWithdrawal: WalletWithdrawal?
        if let container = try? decoder.container(keyedBy: CodingKeys.self) {
            decodedWithdrawal = (try? container.decode(WalletWithdrawal.self, forKey: .withdrawal))
                ?? (try? container.decode(WalletWithdrawal.self, forKey: .item))
                ?? (try? container.decode(WalletWithdrawal.self, forKey: .record))
                ?? (try? container.decode(WalletWithdrawal.self, forKey: .data))
        } else {
            decodedWithdrawal = nil
        }
        self.withdrawal = decodedWithdrawal ?? (try? WalletWithdrawal(from: decoder))
    }
}

extension KeyedDecodingContainer {
    func flexString(for key: Key) -> String? {
        if let string = try? decodeIfPresent(String.self, forKey: key) {
            return string
        }
        if let int = try? decodeIfPresent(Int.self, forKey: key) {
            return String(int)
        }
        if let double = try? decodeIfPresent(Double.self, forKey: key) {
            return String(double)
        }
        return nil
    }

    func flexInt(for key: Key) -> Int? {
        if let int = try? decodeIfPresent(Int.self, forKey: key) {
            return int
        }
        if let double = try? decodeIfPresent(Double.self, forKey: key) {
            return Int(double)
        }
        if let string = try? decodeIfPresent(String.self, forKey: key) {
            let normalized = string
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: ",", with: "")
            if let int = Int(normalized) {
                return int
            }
            if let double = Double(normalized) {
                return Int(double)
            }
        }
        return nil
    }

    func requiredFlexInt(for key: Key) throws -> Int {
        guard let value = flexInt(for: key) else {
            throw DecodingError.keyNotFound(
                key,
                DecodingError.Context(
                    codingPath: codingPath,
                    debugDescription: "Missing required integer field \(key.stringValue)."
                )
            )
        }
        return value
    }

    func flexContent(for key: Key) -> String? {
        if let string = flexString(for: key) {
            return string
        }
        if let value = try? decodeIfPresent(FlexibleJSONValue.self, forKey: key) {
            return value.contentString
        }
        return nil
    }

    func flexStringArray(for key: Key) -> [String]? {
        if let strings = try? decodeIfPresent([String].self, forKey: key) {
            return strings
        }
        if let ints = try? decodeIfPresent([Int].self, forKey: key) {
            return ints.map(String.init)
        }
        if let value = flexString(for: key) {
            if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return []
            }
            if let data = value.data(using: .utf8),
               let strings = try? JSONDecoder().decode([String].self, from: data) {
                return strings
            }
            return value
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        }
        return nil
    }
}

enum FlexibleJSONValue: Decodable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case object([String: FlexibleJSONValue])
    case array([FlexibleJSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let string = try? container.decode(String.self) {
            self = .string(string)
        } else if let int = try? container.decode(Int.self) {
            self = .int(int)
        } else if let double = try? container.decode(Double.self) {
            self = .double(double)
        } else if let bool = try? container.decode(Bool.self) {
            self = .bool(bool)
        } else if let object = try? container.decode([String: FlexibleJSONValue].self) {
            self = .object(object)
        } else if let array = try? container.decode([FlexibleJSONValue].self) {
            self = .array(array)
        } else {
            self = .null
        }
    }

    var contentString: String? {
        switch self {
        case .string(let string):
            return string
        case .null:
            return nil
        case .int, .double, .bool, .object, .array:
            guard JSONSerialization.isValidJSONObject(jsonObject),
                  let data = try? JSONSerialization.data(withJSONObject: jsonObject),
                  let string = String(data: data, encoding: .utf8)
            else { return nil }
            return string
        }
    }

    private var jsonObject: Any {
        switch self {
        case .string(let string): return string
        case .int(let int): return int
        case .double(let double): return double
        case .bool(let bool): return bool
        case .object(let object): return object.mapValues { $0.jsonObject }
        case .array(let array): return array.map { $0.jsonObject }
        case .null: return NSNull()
        }
    }
}

extension GiftCatalogItem {
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(giftID, forKey: .giftID); try c.encode(name, forKey: .name)
        try c.encodeIfPresent(localizedNameI18n, forKey: .localizedName); try c.encode(price, forKey: .price)
        try c.encode(assetKey, forKey: .assetKey); try c.encodeIfPresent(remoteAssetKey, forKey: .remoteAssetKey)
        try c.encodeIfPresent(imageURL, forKey: .imageURL); try c.encodeIfPresent(animationAssetKey, forKey: .animationAssetKey)
        try c.encodeIfPresent(sortOrder, forKey: .sortOrder); try c.encodeIfPresent(active, forKey: .active)
        try c.encodeIfPresent(badgeI18n, forKey: .badgeI18n); try c.encodeIfPresent(minAppVersion, forKey: .minAppVersion)
        try c.encode(receiverCurrency, forKey: .receiverCurrency)
    }
}

extension WalletTransaction {
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(type, forKey: .type); try c.encode(currency, forKey: .currency)
        try c.encodeIfPresent(goldCoinAmount, forKey: .goldCoinAmount)
        try c.encodeIfPresent(goldCoinBalanceAfter, forKey: .goldCoinBalanceAfter)
        try c.encodeIfPresent(title, forKey: .title); try c.encodeIfPresent(note, forKey: .note)
        try c.encodeIfPresent(giftID, forKey: .giftID); try c.encodeIfPresent(giftName, forKey: .giftName)
        try c.encodeIfPresent(productID, forKey: .productID); try c.encodeIfPresent(createdAt, forKey: .createdAt)
    }
}

extension WalletWithdrawal {
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(currency, forKey: .currency)
        try c.encode(goldCoinAmount.value, forKey: .goldCoinAmount)
        try c.encodeIfPresent(payoutUSD, forKey: .payoutUSD); try c.encodeIfPresent(payoutCents, forKey: .payoutCents)
        try c.encodeIfPresent(provider, forKey: .provider); try c.encodeIfPresent(payoutMethod, forKey: .payoutMethod)
        try c.encodeIfPresent(payoutAccount, forKey: .payoutAccount); try c.encodeIfPresent(network, forKey: .network)
        try c.encodeIfPresent(walletAddress, forKey: .walletAddress); try c.encode(status, forKey: .status)
        try c.encodeIfPresent(canCancelFromServer, forKey: .canCancel); try c.encodeIfPresent(note, forKey: .note)
        try c.encodeIfPresent(createdAt, forKey: .createdAt); try c.encodeIfPresent(updatedAt, forKey: .updatedAt)
    }
}
