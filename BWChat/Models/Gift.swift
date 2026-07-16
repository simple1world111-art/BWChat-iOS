// BWChat/Models/Gift.swift
// Gift catalog, gift message payloads, and wallet transaction models.

import Foundation

enum WalletCurrency: String, Codable, Equatable, Hashable {
    case catFood = "cat_food"
    case catHair = "cat_hair"
    case unknown

    init(_ rawValue: String?) {
        let normalized = (rawValue ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")

        switch normalized {
        case "cat_food", "catfood", "coins", "coin":
            self = .catFood
        case "cat_hair", "cathair", "hair":
            self = .catHair
        case "":
            self = .unknown
        default:
            self = .unknown
        }
    }

    var localizedUnit: String {
        switch self {
        case .catHair:
            return L10n.tr("wallet.currency.catHair")
        case .catFood, .unknown:
            return L10n.tr("wallet.currency.catFood")
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
        case catFood = "cat_food"
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
        minAppVersion: String? = nil,
        receiverCurrency: WalletCurrency = .catFood
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
        self.receiverCurrency = receiverCurrency
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
            ?? container.flexInt(for: .catFood)
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
        self.receiverCurrency = WalletCurrency(
            container.flexString(for: .receiverCurrency)
                ?? container.flexString(for: .receiverCurrencyCamel)
                ?? container.flexString(for: .currency)
                ?? Self.fixed(for: giftID)?.receiverCurrency.rawValue
        )
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

    var displayAssetKey: String {
        remoteAssetKey?.isBlank == false ? remoteAssetKey! : assetKey
    }
}

struct GiftMessagePayload: Decodable, Equatable {
    let giftID: String
    let giftName: String
    let assetKey: String
    let amount: Int
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
        case amount
        case price
        case catFood = "cat_food"
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
        amount: Int,
        receiverCurrency: WalletCurrency = .catFood,
        recipientID: String? = nil,
        recipientName: String? = nil,
        senderID: String? = nil,
        senderName: String? = nil
    ) {
        self.giftID = giftID
        self.giftName = giftName
        self.assetKey = assetKey
        self.amount = amount
        self.receiverCurrency = receiverCurrency
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
        self.amount = container.flexInt(for: .amount)
            ?? container.flexInt(for: .price)
            ?? container.flexInt(for: .catFood)
            ?? fixed?.price
            ?? 0
        self.receiverCurrency = WalletCurrency(
            container.flexString(for: .receiverCurrency)
                ?? container.flexString(for: .receiverCurrencyCamel)
                ?? container.flexString(for: .currency)
                ?? fixed?.receiverCurrency.rawValue
                ?? WalletCurrency.catFood.rawValue
        )
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
                amount: gift.price,
                receiverCurrency: gift.receiverCurrency
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
            || amount > 0
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
                    amount: gift.price,
                    receiverCurrency: gift.receiverCurrency
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
    let amount: Int?
    let balanceAfter: Int?
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
        case receiverCurrencyCamel = "receiverCurrency"
        case amount
        case catFood = "cat_food"
        case catFoodAmount = "cat_food_amount"
        case catFoodDelta = "cat_food_delta"
        case catHair = "cat_hair"
        case catHairAmount = "cat_hair_amount"
        case catHairDelta = "cat_hair_delta"
        case catHairBalanceDelta = "cat_hair_balance_delta"
        case coins
        case coinAmount = "coin_amount"
        case delta
        case change
        case value
        case balanceDelta = "balance_delta"
        case balanceChange = "balance_change"
        case quantity
        case price
        case total
        case totalAmount = "total_amount"
        case balanceAfter = "balance_after"
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
        let decodedCurrency = Self.decodeCurrency(from: container, type: decodedType)
        let decodedAmount = Self.decodeAmount(from: container, currency: decodedCurrency)
        let inferredAmount = Self.inferredAmount(
            type: decodedType,
            giftID: decodedGiftID,
            giftName: decodedGiftName,
            productID: decodedProductID
        )

        self.type = decodedType
        self.currency = decodedCurrency == .unknown ? .catFood : decodedCurrency
        if let decodedAmount, decodedAmount != 0 {
            self.amount = decodedAmount
        } else {
            self.amount = inferredAmount
        }
        self.balanceAfter = container.flexInt(for: .balanceAfter)
        self.title = container.flexString(for: .title)
        self.note = container.flexString(for: .note)
            ?? container.flexString(for: .description)
        self.giftID = decodedGiftID
        self.giftName = decodedGiftName
        self.productID = decodedProductID
        self.createdAt = container.flexString(for: .createdAt)
            ?? container.flexString(for: .timestamp)
    }

    private static func decodeCurrency(
        from container: KeyedDecodingContainer<CodingKeys>,
        type: String
    ) -> WalletCurrency {
        let normalizedType = type.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalizedType == "gift_received" {
            return .catFood
        }

        let explicit = WalletCurrency(
            container.flexString(for: .currency)
                ?? container.flexString(for: .receiverCurrency)
                ?? container.flexString(for: .receiverCurrencyCamel)
        )
        if explicit != .unknown { return explicit }

        return .catFood
    }

    private static func decodeAmount(
        from container: KeyedDecodingContainer<CodingKeys>,
        currency: WalletCurrency
    ) -> Int? {
        if currency == .catHair {
            for key in [
                CodingKeys.catHairDelta,
                .catHairAmount,
                .catHair,
                .amount,
                .delta,
                .change,
                .value,
                .balanceDelta,
                .balanceChange,
                .quantity,
                .total,
                .totalAmount
            ] {
                if let value = container.flexInt(for: key) {
                    return value
                }
            }
            return nil
        }

        for key in [
            CodingKeys.amount,
            .catFood,
            .catFoodAmount,
            .catFoodDelta,
            .coins,
            .coinAmount,
            .delta,
            .change,
            .value,
            .balanceDelta,
            .balanceChange,
            .quantity,
            .price,
            .total,
            .totalAmount
        ] {
            if let value = container.flexInt(for: key) {
                return value
            }
        }
        return nil
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
           let product = AppConfig.catFoodProducts.first(where: { $0.productID == productID }) {
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

    var displayTitle: String {
        if let title, !title.isBlank { return title }
        switch type {
        case "ios_iap": return L10n.tr("wallet.transaction.iap")
        case "gift_sent": return L10n.tr("wallet.transaction.giftSent")
        case "gift_received": return L10n.tr("wallet.transaction.giftReceived")
        default:
            return currency == .catHair
                ? L10n.tr("wallet.transaction.catHairChange")
                : L10n.tr("wallet.transaction.balanceChange")
        }
    }

    var displaySubtitle: String {
        if let giftName, !giftName.isBlank { return giftName }
        if let note, !note.isBlank { return note }
        switch type {
        case "ios_iap": return L10n.tr("wallet.transaction.iapSubtitle")
        case "gift_sent": return L10n.tr("wallet.transaction.giftSentSubtitle")
        case "gift_received":
            return currency == .catHair
                ? L10n.tr("wallet.transaction.giftReceivedCatHairSubtitle")
                : L10n.tr("wallet.transaction.giftReceivedSubtitle")
        default: return type
        }
    }

    var hasDisplayableAmount: Bool {
        guard let amount else { return false }
        return amount != 0
    }

    var signedAmountValue: Int? {
        guard let amount, amount != 0 else { return nil }
        switch type {
        case "gift_sent":
            return -abs(amount)
        case "ios_iap", "gift_received":
            return abs(amount)
        default:
            return amount
        }
    }

    var signedAmountText: String {
        guard let signedAmountValue else { return "--" }
        let sign = signedAmountValue >= 0 ? "+" : "-"
        return "\(sign)\(abs(signedAmountValue)) \(currency.localizedUnit)"
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
    let balance: Int
    let totalBalance: Int
    let rechargeClaimBalance: Int
    let catHairBalance: Int
    let catHairFrozenBalance: Int
    let withdrawableCatHairBalance: Int
    let lockedCatHairBalance: Int
    let hasExplicitWithdrawableCatHairBalance: Bool

    enum CodingKeys: String, CodingKey {
        case balance
        case totalBalance = "total_balance"
        case totalBalanceCamel = "totalBalance"
        case rechargeClaimBalance = "recharge_claim_balance"
        case rechargeClaimBalanceCamel = "rechargeClaimBalance"
        case catHairBalance = "cat_hair_balance"
        case catHairBalanceCamel = "catHairBalance"
        case catHairFrozenBalance = "cat_hair_frozen_balance"
        case catHairFrozenBalanceCamel = "catHairFrozenBalance"
        case withdrawableCatHairBalance = "withdrawable_cat_hair_balance"
        case withdrawableCatHairBalanceCamel = "withdrawableCatHairBalance"
        case lockedCatHairBalance = "locked_cat_hair_balance"
        case lockedCatHairBalanceCamel = "lockedCatHairBalance"
        case catFood = "cat_food"
        case catFoodBalance = "cat_food_balance"
        case coins
        case wallet
    }

    init(balance: Int) {
        self.balance = balance
        self.totalBalance = balance
        self.rechargeClaimBalance = balance
        self.catHairBalance = 0
        self.catHairFrozenBalance = 0
        self.withdrawableCatHairBalance = 0
        self.lockedCatHairBalance = 0
        self.hasExplicitWithdrawableCatHairBalance = false
    }

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let balance = try? single.decode(Int.self) {
            self.init(balance: balance)
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let wallet = try? container.nestedContainer(keyedBy: CodingKeys.self, forKey: .wallet) {
            self = Self.decode(from: wallet)
            return
        }
        self = Self.decode(from: container)
    }

    private static func decode(from container: KeyedDecodingContainer<CodingKeys>) -> WalletBalanceResponseData {
        let balance = container.flexInt(for: .balance)
            ?? container.flexInt(for: .catFood)
            ?? container.flexInt(for: .catFoodBalance)
            ?? container.flexInt(for: .coins)
            ?? 0
        let totalBalance = container.flexInt(for: .totalBalance)
            ?? container.flexInt(for: .totalBalanceCamel)
            ?? balance
        let rechargeClaimBalance = container.flexInt(for: .rechargeClaimBalance)
            ?? container.flexInt(for: .rechargeClaimBalanceCamel)
            ?? balance
        let catHairBalance = container.flexInt(for: .catHairBalance)
            ?? container.flexInt(for: .catHairBalanceCamel)
            ?? 0
        let catHairFrozenBalance = container.flexInt(for: .catHairFrozenBalance)
            ?? container.flexInt(for: .catHairFrozenBalanceCamel)
            ?? 0
        let explicitWithdrawable = container.flexInt(for: .withdrawableCatHairBalance)
            ?? container.flexInt(for: .withdrawableCatHairBalanceCamel)
        let lockedCatHairBalance = container.flexInt(for: .lockedCatHairBalance)
            ?? container.flexInt(for: .lockedCatHairBalanceCamel)
            ?? 0

        return WalletBalanceResponseData(
            balance: balance,
            totalBalance: totalBalance,
            rechargeClaimBalance: rechargeClaimBalance,
            catHairBalance: catHairBalance,
            catHairFrozenBalance: catHairFrozenBalance,
            withdrawableCatHairBalance: explicitWithdrawable ?? 0,
            lockedCatHairBalance: lockedCatHairBalance,
            hasExplicitWithdrawableCatHairBalance: explicitWithdrawable != nil
        )
    }

    private init(
        balance: Int,
        totalBalance: Int,
        rechargeClaimBalance: Int,
        catHairBalance: Int,
        catHairFrozenBalance: Int,
        withdrawableCatHairBalance: Int,
        lockedCatHairBalance: Int,
        hasExplicitWithdrawableCatHairBalance: Bool
    ) {
        self.balance = balance
        self.totalBalance = totalBalance
        self.rechargeClaimBalance = rechargeClaimBalance
        self.catHairBalance = catHairBalance
        self.catHairFrozenBalance = catHairFrozenBalance
        self.withdrawableCatHairBalance = withdrawableCatHairBalance
        self.lockedCatHairBalance = lockedCatHairBalance
        self.hasExplicitWithdrawableCatHairBalance = hasExplicitWithdrawableCatHairBalance
    }
}

struct WalletIAPConfirmationResponseData: Decodable {
    let balance: WalletBalanceResponseData?
    let coins: Int?
    let transaction: WalletTransaction?

    enum CodingKeys: String, CodingKey {
        case balance
        case balanceData = "balance_data"
        case balanceDataCamel = "balanceData"
        case wallet
        case walletBalance = "wallet_balance"
        case walletBalanceCamel = "walletBalance"
        case coins
        case catFood = "cat_food"
        case catFoodAmount = "cat_food_amount"
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
        self.coins = container.flexInt(for: .coins)
            ?? container.flexInt(for: .catFood)
            ?? container.flexInt(for: .catFoodAmount)
            ?? container.flexInt(for: .amount)
        self.transaction = (try? container.decode(WalletTransaction.self, forKey: .transaction))
            ?? (try? container.decode(WalletTransaction.self, forKey: .walletTransaction))
            ?? (try? container.decode(WalletTransaction.self, forKey: .walletTransactionCamel))
    }
}

struct WalletTransactionsResponseData: Decodable {
    let transactions: [WalletTransaction]

    enum CodingKeys: String, CodingKey {
        case transactions
        case items
        case records
        case list
        case rows
    }

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let transactions = try? single.decode([WalletTransaction].self) {
            self.transactions = transactions
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.transactions = (try? container.decode([WalletTransaction].self, forKey: .transactions))
            ?? (try? container.decode([WalletTransaction].self, forKey: .items))
            ?? (try? container.decode([WalletTransaction].self, forKey: .records))
            ?? (try? container.decode([WalletTransaction].self, forKey: .list))
            ?? (try? container.decode([WalletTransaction].self, forKey: .rows))
            ?? []
    }
}

struct WalletWithdrawal: Codable, Identifiable, Equatable {
    let id: String
    let currency: WalletCurrency
    let amount: Int
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
        case amount
        case catFood = "cat_food"
        case catFoodAmount = "cat_food_amount"
        case coins
        case catHair = "cat_hair"
        case catHairAmount = "cat_hair_amount"
        case withdrawAmount = "withdraw_amount"
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
        self.id = container.flexString(for: .id)
            ?? container.flexString(for: .withdrawalID)
            ?? container.flexString(for: .withdrawalId)
            ?? UUID().uuidString
        let decodedCurrency = WalletCurrency(container.flexString(for: .currency))
        self.currency = decodedCurrency == .unknown ? .catFood : decodedCurrency
        self.amount = container.flexInt(for: .amount)
            ?? container.flexInt(for: .catFood)
            ?? container.flexInt(for: .catFoodAmount)
            ?? container.flexInt(for: .coins)
            ?? container.flexInt(for: .catHair)
            ?? container.flexInt(for: .catHairAmount)
            ?? container.flexInt(for: .withdrawAmount)
            ?? 0
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
            usd = Double(amount) * 0.005
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
        try c.encodeIfPresent(amount, forKey: .amount); try c.encodeIfPresent(balanceAfter, forKey: .balanceAfter)
        try c.encodeIfPresent(title, forKey: .title); try c.encodeIfPresent(note, forKey: .note)
        try c.encodeIfPresent(giftID, forKey: .giftID); try c.encodeIfPresent(giftName, forKey: .giftName)
        try c.encodeIfPresent(productID, forKey: .productID); try c.encodeIfPresent(createdAt, forKey: .createdAt)
    }
}

extension WalletBalanceResponseData {
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(balance, forKey: .balance); try c.encode(totalBalance, forKey: .totalBalance)
        try c.encode(rechargeClaimBalance, forKey: .rechargeClaimBalance); try c.encode(catHairBalance, forKey: .catHairBalance)
        try c.encode(catHairFrozenBalance, forKey: .catHairFrozenBalance)
        if hasExplicitWithdrawableCatHairBalance { try c.encode(withdrawableCatHairBalance, forKey: .withdrawableCatHairBalance) }
        try c.encode(lockedCatHairBalance, forKey: .lockedCatHairBalance)
    }
}

extension WalletWithdrawal {
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id); try c.encode(currency, forKey: .currency); try c.encode(amount, forKey: .amount)
        try c.encodeIfPresent(payoutUSD, forKey: .payoutUSD); try c.encodeIfPresent(payoutCents, forKey: .payoutCents)
        try c.encodeIfPresent(provider, forKey: .provider); try c.encodeIfPresent(payoutMethod, forKey: .payoutMethod)
        try c.encodeIfPresent(payoutAccount, forKey: .payoutAccount); try c.encodeIfPresent(network, forKey: .network)
        try c.encodeIfPresent(walletAddress, forKey: .walletAddress); try c.encode(status, forKey: .status)
        try c.encodeIfPresent(canCancelFromServer, forKey: .canCancel); try c.encodeIfPresent(note, forKey: .note)
        try c.encodeIfPresent(createdAt, forKey: .createdAt); try c.encodeIfPresent(updatedAt, forKey: .updatedAt)
    }
}
