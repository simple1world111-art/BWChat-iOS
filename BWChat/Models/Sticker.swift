// BWChat/Models/Sticker.swift
// Sticker pack config and sticker message payloads.

import Foundation

struct StickerPack: Codable, Equatable, Identifiable {
    let id: String
    let name: [String: String]?
    let order: Int?
    let enabled: Bool?
    let coverAssetKey: String?
    let packType: String?
    let inputMode: String?
    let coverEmoji: String?
    let insertsIntoText: Bool?
    let sendAsSticker: Bool?
    let emojiCount: Int?
    let emojis: [EmojiItem]
    let stickers: [StickerItem]

    enum CodingKeys: String, CodingKey {
        case id
        case packID = "pack_id"
        case name
        case title
        case order
        case sortOrder = "sort_order"
        case enabled
        case coverAssetKey = "cover_asset_key"
        case packType = "pack_type"
        case inputMode = "input_mode"
        case coverEmoji = "cover_emoji"
        case insertsIntoText = "inserts_into_text"
        case sendAsSticker = "send_as_sticker"
        case emojiCount = "emoji_count"
        case emojis
        case stickers
    }

    init(
        id: String,
        name: [String: String]? = nil,
        order: Int? = nil,
        enabled: Bool? = true,
        coverAssetKey: String? = nil,
        packType: String? = nil,
        inputMode: String? = nil,
        coverEmoji: String? = nil,
        insertsIntoText: Bool? = nil,
        sendAsSticker: Bool? = nil,
        emojiCount: Int? = nil,
        emojis: [EmojiItem] = [],
        stickers: [StickerItem] = []
    ) {
        self.id = id
        self.name = name
        self.order = order
        self.enabled = enabled
        self.coverAssetKey = coverAssetKey
        self.packType = packType
        self.inputMode = inputMode
        self.coverEmoji = coverEmoji
        self.insertsIntoText = insertsIntoText
        self.sendAsSticker = sendAsSticker
        self.emojiCount = emojiCount
        self.emojis = emojis
        self.stickers = stickers
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decodeIfPresent(String.self, forKey: .id)
            ?? container.decodeIfPresent(String.self, forKey: .packID)
            ?? ""
        self.name = try container.decodeIfPresent([String: String].self, forKey: .name)
            ?? container.decodeIfPresent([String: String].self, forKey: .title)
        self.order = try container.decodeIfPresent(Int.self, forKey: .order)
            ?? container.decodeIfPresent(Int.self, forKey: .sortOrder)
        self.enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled)
        self.coverAssetKey = try container.decodeIfPresent(String.self, forKey: .coverAssetKey)
        self.packType = try container.decodeIfPresent(String.self, forKey: .packType)
        self.inputMode = try container.decodeIfPresent(String.self, forKey: .inputMode)
        self.coverEmoji = try container.decodeIfPresent(String.self, forKey: .coverEmoji)
        self.insertsIntoText = try container.decodeIfPresent(Bool.self, forKey: .insertsIntoText)
        self.sendAsSticker = try container.decodeIfPresent(Bool.self, forKey: .sendAsSticker)
        self.emojiCount = try container.decodeIfPresent(Int.self, forKey: .emojiCount)
        self.emojis = try container.decodeIfPresent([EmojiItem].self, forKey: .emojis) ?? []
        self.stickers = try container.decodeIfPresent([StickerItem].self, forKey: .stickers) ?? []
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(order, forKey: .order)
        try container.encodeIfPresent(enabled, forKey: .enabled)
        try container.encodeIfPresent(coverAssetKey, forKey: .coverAssetKey)
        try container.encodeIfPresent(packType, forKey: .packType)
        try container.encodeIfPresent(inputMode, forKey: .inputMode)
        try container.encodeIfPresent(coverEmoji, forKey: .coverEmoji)
        try container.encodeIfPresent(insertsIntoText, forKey: .insertsIntoText)
        try container.encodeIfPresent(sendAsSticker, forKey: .sendAsSticker)
        try container.encodeIfPresent(emojiCount, forKey: .emojiCount)
        try container.encode(emojis, forKey: .emojis)
        try container.encode(stickers, forKey: .stickers)
    }

    var isEnabled: Bool {
        enabled ?? true
    }

    var localizedName: String {
        name.localizedDynamicValue(for: AppLanguageStore.shared.activeLanguage)
            ?? id
    }

    var isEmojiInput: Bool {
        packType?.lowercased() == "emoji"
            || inputMode?.lowercased() == "insert_text"
            || id.lowercased() == "emoji_default"
            || insertsIntoText == true
    }

    var hasPickerContent: Bool {
        isEmojiInput ? !emojis.isEmpty : !stickers.isEmpty
    }

    static func sort(_ lhs: StickerPack, _ rhs: StickerPack) -> Bool {
        let left = lhs.order ?? Int.max
        let right = rhs.order ?? Int.max
        if left != right { return left < right }
        return lhs.id.localizedStandardCompare(rhs.id) == .orderedAscending
    }
}

struct EmojiItem: Codable, Equatable, Identifiable {
    let id: String
    let emoji: String?
    let value: String?
    let name: [String: String]?
    let order: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case emojiID = "emoji_id"
        case emoji
        case value
        case name
        case order
        case sortOrder = "sort_order"
    }

    init(
        id: String,
        emoji: String? = nil,
        value: String? = nil,
        name: [String: String]? = nil,
        order: Int? = nil
    ) {
        self.id = id
        self.emoji = emoji
        self.value = value
        self.name = name
        self.order = order
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decodeIfPresent(String.self, forKey: .id)
            ?? container.decodeIfPresent(String.self, forKey: .emojiID)
            ?? ""
        self.emoji = try container.decodeIfPresent(String.self, forKey: .emoji)
        self.value = try container.decodeIfPresent(String.self, forKey: .value)
        self.name = try container.decodeIfPresent([String: String].self, forKey: .name)
        self.order = try container.decodeIfPresent(Int.self, forKey: .order)
            ?? container.decodeIfPresent(Int.self, forKey: .sortOrder)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encodeIfPresent(emoji, forKey: .emoji)
        try container.encodeIfPresent(value, forKey: .value)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(order, forKey: .order)
    }

    var insertionValue: String? {
        if let emoji, !emoji.isBlank { return emoji }
        if let value, !value.isBlank { return value }
        return nil
    }

    var localizedName: String {
        name.localizedDynamicValue(for: AppLanguageStore.shared.activeLanguage)
            ?? id
    }

    static func sort(_ lhs: EmojiItem, _ rhs: EmojiItem) -> Bool {
        let left = lhs.order ?? Int.max
        let right = rhs.order ?? Int.max
        if left != right { return left < right }
        return lhs.id.localizedStandardCompare(rhs.id) == .orderedAscending
    }
}

struct StickerItem: Codable, Equatable, Identifiable {
    let id: String
    let packID: String?
    let assetKey: String?
    let name: [String: String]?
    let width: Int?
    let height: Int?
    let order: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case stickerID = "sticker_id"
        case packID = "pack_id"
        case assetKey = "asset_key"
        case name
        case width
        case height
        case order
        case sortOrder = "sort_order"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decodeIfPresent(String.self, forKey: .id)
            ?? container.decodeIfPresent(String.self, forKey: .stickerID)
            ?? ""
        self.packID = try container.decodeIfPresent(String.self, forKey: .packID)
        self.assetKey = try container.decodeIfPresent(String.self, forKey: .assetKey)
        self.name = try container.decodeIfPresent([String: String].self, forKey: .name)
        self.width = try container.decodeIfPresent(Int.self, forKey: .width)
        self.height = try container.decodeIfPresent(Int.self, forKey: .height)
        self.order = try container.decodeIfPresent(Int.self, forKey: .order)
            ?? container.decodeIfPresent(Int.self, forKey: .sortOrder)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encodeIfPresent(packID, forKey: .packID)
        try container.encodeIfPresent(assetKey, forKey: .assetKey)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(width, forKey: .width)
        try container.encodeIfPresent(height, forKey: .height)
        try container.encodeIfPresent(order, forKey: .order)
    }

    var localizedName: String {
        name.localizedDynamicValue(for: AppLanguageStore.shared.activeLanguage)
            ?? id
    }

    static func sort(_ lhs: StickerItem, _ rhs: StickerItem) -> Bool {
        let left = lhs.order ?? Int.max
        let right = rhs.order ?? Int.max
        if left != right { return left < right }
        return lhs.id.localizedStandardCompare(rhs.id) == .orderedAscending
    }
}

struct StickerMessagePayload: Codable, Equatable {
    let stickerID: String
    let packID: String
    let assetKey: String
    let name: [String: String]?
    let width: Int?
    let height: Int?

    enum CodingKeys: String, CodingKey {
        case stickerID = "sticker_id"
        case packID = "pack_id"
        case assetKey = "asset_key"
        case name
        case width
        case height
    }

    init(
        stickerID: String,
        packID: String,
        assetKey: String,
        name: [String: String]? = nil,
        width: Int? = nil,
        height: Int? = nil
    ) {
        self.stickerID = stickerID
        self.packID = packID
        self.assetKey = assetKey
        self.name = name
        self.width = width
        self.height = height
    }

    init(pack: StickerPack, sticker: StickerItem) {
        self.init(
            stickerID: sticker.id,
            packID: pack.id,
            assetKey: sticker.assetKey ?? sticker.id,
            name: sticker.name,
            width: sticker.width,
            height: sticker.height
        )
    }

    var localizedName: String {
        name.localizedDynamicValue(for: AppLanguageStore.shared.activeLanguage)
            ?? stickerID
    }

    @MainActor
    var previewText: String {
        guard let name = previewName else {
            return L10n.tr("message.sticker")
        }
        return "[\(name)]"
    }

    @MainActor
    private var previewName: String? {
        if let payloadName = name.localizedDynamicValue(for: AppLanguageStore.shared.activeLanguage)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !payloadName.isEmpty {
            return payloadName
        }

        let packs = AppRemoteConfigStore.shared.config.effectiveStickerPacks
        let packCandidates = packID.isBlank ? packs : packs.filter { $0.id == packID }
        let sticker = packCandidates
            .flatMap(\.stickers)
            .first { item in
                item.id == stickerID
                    || item.assetKey == assetKey
                    || item.id == assetKey
                    || item.assetKey == stickerID
            }

        if let configuredName = sticker?.name.localizedDynamicValue(for: AppLanguageStore.shared.activeLanguage)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !configuredName.isEmpty {
            return configuredName
        }

        return nil
    }

    var encodedContent: String {
        guard let data = try? JSONEncoder().encode(self),
              let string = String(data: data, encoding: .utf8) else {
            return assetKey
        }
        return string
    }

    static func parse(_ content: String) -> StickerMessagePayload? {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let payload = parseJSONPayload(trimmed) {
            return payload
        }
        return StickerMessagePayload(stickerID: trimmed, packID: "", assetKey: trimmed)
    }

    static func parseJSONPayload(_ content: String) -> StickerMessagePayload? {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.first == "{",
              let data = trimmed.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(StickerMessagePayload.self, from: data)
    }

    @MainActor
    static func previewText(content: String?, msgType: String? = nil) -> String? {
        guard let content,
              !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        if msgType == "sticker", let payload = parse(content) {
            return payload.previewText
        }
        if let payload = parseJSONPayload(content) {
            return payload.previewText
        }
        return nil
    }
}

extension AppRemoteConfig {
    var effectiveStickerPacks: [StickerPack] {
        var packs = (stickerPacks ?? [])
            .filter { !$0.id.isBlank && $0.isEnabled && $0.hasPickerContent }

        if let emojiIndex = packs.firstIndex(where: { $0.id == "emoji_default" }) {
            if emojiIndex > 0 {
                let emoji = packs.remove(at: emojiIndex)
                packs.insert(emoji, at: 0)
            }
        } else {
            packs.insert(.fallbackEmojiPack, at: 0)
        }
        return packs
    }
}

extension StickerPack {
    static let fallbackEmojiPack = StickerPack(
        id: "emoji_default",
        name: ["zh-Hans": "表情", "zh-Hant": "表情", "en": "Emoji", "ja": "絵文字"],
        order: 0,
        enabled: true,
        coverAssetKey: "",
        packType: "emoji",
        inputMode: "insert_text",
        coverEmoji: "😀",
        insertsIntoText: true,
        sendAsSticker: false,
        emojiCount: fallbackEmojis.count,
        emojis: fallbackEmojis,
        stickers: []
    )

    private static let fallbackEmojis: [EmojiItem] = {
        let values = [
            "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣",
            "😊", "🙂", "🙃", "😉", "😍", "🥰", "😘", "😋",
            "😎", "🤩", "🥳", "😏", "😔", "😢", "😭", "😤",
            "😡", "🤯", "😱", "😳", "🥺", "😴", "🤔", "🤗",
            "🤭", "🤫", "🙄", "😬", "👍", "👎", "👏", "🙏",
            "💪", "👌", "✌️", "🤝", "❤️", "💛", "💚", "💙",
            "💜", "🖤", "💯", "🎉", "🔥", "✨", "🌟", "🐱", "🐾"
        ]
        return values.enumerated().map { index, value in
            EmojiItem(id: "fallback_\(index)", emoji: value, value: value, order: (index + 1) * 10)
        }
    }()
}

enum StickerPackDiagnostics {
    static func logDecoded(_ packs: [StickerPack], configVersion: String) {
        print("[StickerConfig] decoded config_version=\(configVersion) pack_ids=\(packs.map(\.id))")
        for pack in packs {
            print("[StickerConfig] pack_id=\(pack.id) pack_type=\(pack.packType ?? "nil") stickers=\(pack.stickers.count) emojis=\(pack.emojis.count)")
        }
    }

    static func logDisplayed(_ packs: [StickerPack]) {
        print("[StickerConfig] displayed_tabs=\(packs.map(\.id))")
    }
}

extension Message {
    var isSticker: Bool {
        msgType == "sticker"
    }

    var stickerPayload: StickerMessagePayload? {
        guard isSticker else { return nil }
        return StickerMessagePayload.parse(content)
    }
}

extension GroupMessage {
    var isSticker: Bool {
        msgType == "sticker"
    }

    var stickerPayload: StickerMessagePayload? {
        guard isSticker else { return nil }
        return StickerMessagePayload.parse(content)
    }
}
