import Foundation

struct MomentAuthor: Codable, Identifiable, Equatable {
    let userID: String
    let nickname: String
    let avatarURL: String

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
    }
}

struct MomentComment: Codable, Identifiable, Equatable {
    let id: Int
    let content: String
    let createdAt: String?
    let userID: String
    let nickname: String
    let avatarURL: String
    let replyTo: MomentAuthor?
    let imageURL: String?

    enum CodingKeys: String, CodingKey {
        case id, content
        case createdAt = "created_at"
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case replyTo = "reply_to"
        case imageURL = "image_url"
    }
}

enum MomentMediaType: String, Codable, Equatable {
    case image
    case video

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = (try? container.decode(String.self))?.lowercased() ?? ""
        self = rawValue == "video" ? .video : .image
    }
}

struct MomentMedia: Codable, Identifiable, Equatable {
    let id: String
    let type: MomentMediaType
    let url: String
    let thumbnailURL: String?
    let lockedPreviewURL: String?
    let isLocked: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case mediaID = "media_id"
        case type
        case mediaType = "media_type"
        case url
        case thumbnailURL = "thumbnail_url"
        case thumbnailURLCamel = "thumbnailURL"
        case lockedPreviewURL = "locked_preview_url"
        case lockedPreviewURLCamel = "lockedPreviewURL"
        case isLocked = "is_locked"
        case isLockedCamel = "isLocked"
    }

    var isVideo: Bool { type == .video }

    var previewURL: String {
        lockedPreviewURL?.nilIfBlank
            ?? thumbnailURL?.nilIfBlank
            ?? url
    }

    var imageDisplayURL: String {
        previewURL
    }

    func imageDisplayURL(isLockedForViewer: Bool) -> String {
        if isLockedForViewer {
            return previewURL
        }
        return url.nilIfBlank
            ?? thumbnailURL?.nilIfBlank
            ?? lockedPreviewURL?.nilIfBlank
            ?? ""
    }

    func thumbnailDisplayURL(isLockedForViewer: Bool) -> String? {
        if isLockedForViewer {
            return lockedPreviewURL?.nilIfBlank
                ?? thumbnailURL?.nilIfBlank
                ?? url.nilIfBlank
        }
        return thumbnailURL?.nilIfBlank
            ?? url.nilIfBlank
            ?? lockedPreviewURL?.nilIfBlank
    }

    init(
        id: String,
        type: MomentMediaType,
        url: String,
        thumbnailURL: String? = nil,
        lockedPreviewURL: String? = nil,
        isLocked: Bool = false
    ) {
        self.id = id
        self.type = type
        self.url = url
        self.thumbnailURL = thumbnailURL?.nilIfBlank
        self.lockedPreviewURL = lockedPreviewURL?.nilIfBlank
        self.isLocked = isLocked
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedType = (try? container.decodeIfPresent(MomentMediaType.self, forKey: .type))
            ?? (try? container.decodeIfPresent(MomentMediaType.self, forKey: .mediaType))
            ?? .image
        let decodedURL = container.flexString(for: .url) ?? ""
        let thumb = container.flexString(for: .thumbnailURL)
            ?? container.flexString(for: .thumbnailURLCamel)
        let lockedPreview = container.flexString(for: .lockedPreviewURL)
            ?? container.flexString(for: .lockedPreviewURLCamel)
        let decodedID = container.flexString(for: .id)
            ?? container.flexString(for: .mediaID)
            ?? decodedURL.nilIfBlank
            ?? lockedPreview?.nilIfBlank
            ?? thumb?.nilIfBlank
            ?? UUID().uuidString

        self.id = decodedID
        self.type = decodedType
        self.url = decodedURL
        self.thumbnailURL = thumb?.nilIfBlank
        self.lockedPreviewURL = lockedPreview?.nilIfBlank
        self.isLocked = container.flexBool(for: .isLocked)
            ?? container.flexBool(for: .isLockedCamel)
            ?? false
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(type, forKey: .type)
        try container.encode(url, forKey: .url)
        try container.encodeIfPresent(thumbnailURL, forKey: .thumbnailURL)
        try container.encodeIfPresent(lockedPreviewURL, forKey: .lockedPreviewURL)
        try container.encode(isLocked, forKey: .isLocked)
    }
}

struct MomentUploadMedia: Sendable {
    enum Kind: Sendable {
        case image
        case video
    }

    let kind: Kind
    let data: Data
    let filename: String
    let mimeType: String
    let previewImageData: Data?

    init(
        kind: Kind,
        data: Data,
        filename: String,
        mimeType: String,
        previewImageData: Data? = nil
    ) {
        self.kind = kind
        self.data = data
        self.filename = filename
        self.mimeType = mimeType
        self.previewImageData = previewImageData
    }
}

struct Moment: Codable, Identifiable, Equatable {
    let id: Int
    let author: MomentAuthor
    let content: String
    let images: [String]
    let media: [MomentMedia]
    let unlockPriceCatFood: Int?
    let isUnlocked: Bool
    let locationName: String?
    let createdAt: String
    let likes: [MomentAuthor]
    let comments: [MomentComment]
    let likedByMe: Bool

    enum CodingKeys: String, CodingKey {
        case id, author, content, images
        case media
        case unlockPriceCatFood = "unlock_price_cat_food"
        case unlockPriceCatFoodCamel = "unlockPriceCatFood"
        case isUnlocked = "is_unlocked"
        case isUnlockedCamel = "isUnlocked"
        case locationName = "location_name"
        case locationNameCamel = "locationName"
        case createdAt = "created_at"
        case likes, comments
        case likedByMe = "liked_by_me"
        case likedByMeCamel = "likedByMe"
    }

    var hasLockedMedia: Bool {
        (unlockPriceCatFood ?? 0) > 0 && !isUnlocked && (!media.isEmpty || !images.isEmpty)
    }

    var unlockedImageURLs: [String] {
        media.filter { $0.type == .image && !$0.url.isEmpty }.map(\.url)
    }

    init(
        id: Int,
        author: MomentAuthor,
        content: String,
        images: [String],
        createdAt: String,
        likes: [MomentAuthor],
        comments: [MomentComment],
        likedByMe: Bool,
        media: [MomentMedia]? = nil,
        unlockPriceCatFood: Int? = nil,
        isUnlocked: Bool? = nil,
        locationName: String? = nil
    ) {
        let resolvedMedia = media ?? Self.mediaFromLegacyImages(images)
        self.id = id
        self.author = author
        self.content = content
        self.images = images.isEmpty ? Self.legacyImages(from: resolvedMedia) : images
        self.media = resolvedMedia
        let normalizedUnlockPrice = unlockPriceCatFood.flatMap { $0 > 0 ? $0 : nil }
        self.unlockPriceCatFood = normalizedUnlockPrice
        self.isUnlocked = isUnlocked ?? (normalizedUnlockPrice == nil ? !resolvedMedia.contains { $0.isLocked } : false)
        self.locationName = locationName?.nilIfBlank
        self.createdAt = createdAt
        self.likes = likes
        self.comments = comments
        self.likedByMe = likedByMe
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let legacyImages = (try? container.decodeIfPresent([String].self, forKey: .images)) ?? []
        let decodedMedia = (try? container.decodeIfPresent([MomentMedia].self, forKey: .media)) ?? []
        let resolvedMedia = decodedMedia.isEmpty ? Self.mediaFromLegacyImages(legacyImages) : decodedMedia
        let decodedPrice = container.flexInt(for: .unlockPriceCatFood)
            ?? container.flexInt(for: .unlockPriceCatFoodCamel)
        let decodedUnlocked = container.flexBool(for: .isUnlocked)
            ?? container.flexBool(for: .isUnlockedCamel)

        self.id = container.flexInt(for: .id) ?? 0
        self.author = try container.decode(MomentAuthor.self, forKey: .author)
        self.content = container.flexString(for: .content) ?? ""
        self.images = legacyImages.isEmpty ? Self.legacyImages(from: resolvedMedia) : legacyImages
        self.media = resolvedMedia
        let normalizedUnlockPrice = decodedPrice.flatMap { $0 > 0 ? $0 : nil }
        self.unlockPriceCatFood = normalizedUnlockPrice
        self.isUnlocked = decodedUnlocked ?? (normalizedUnlockPrice == nil ? !resolvedMedia.contains { $0.isLocked } : false)
        self.locationName = (container.flexString(for: .locationName)
            ?? container.flexString(for: .locationNameCamel))?.nilIfBlank
        self.createdAt = container.flexString(for: .createdAt) ?? ""
        self.likes = (try? container.decodeIfPresent([MomentAuthor].self, forKey: .likes)) ?? []
        self.comments = (try? container.decodeIfPresent([MomentComment].self, forKey: .comments)) ?? []
        self.likedByMe = container.flexBool(for: .likedByMe)
            ?? container.flexBool(for: .likedByMeCamel)
            ?? false
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(author, forKey: .author)
        try container.encode(content, forKey: .content)
        try container.encode(images, forKey: .images)
        try container.encode(media, forKey: .media)
        try container.encodeIfPresent(unlockPriceCatFood, forKey: .unlockPriceCatFood)
        try container.encode(isUnlocked, forKey: .isUnlocked)
        try container.encodeIfPresent(locationName, forKey: .locationName)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(likes, forKey: .likes)
        try container.encode(comments, forKey: .comments)
        try container.encode(likedByMe, forKey: .likedByMe)
    }

    var formattedTime: String {
        Self.relativeTime(from: createdAt)
    }

    private static func mediaFromLegacyImages(_ images: [String]) -> [MomentMedia] {
        images.enumerated().map { index, url in
            MomentMedia(id: "image-\(index)-\(url)", type: .image, url: url)
        }
    }

    private static func legacyImages(from media: [MomentMedia]) -> [String] {
        media.filter { $0.type == .image && !$0.url.isEmpty }.map(\.url)
    }

    static func relativeTime(from dateStr: String) -> String {
        guard let date = relativeInputFormatter.date(from: dateStr) else { return dateStr }

        let now = Date()
        let interval = now.timeIntervalSince(date)

        if interval < 60 { return L10n.tr("time.justNow") }
        if interval < 3600 { return L10n.tr("time.minutesAgo", Int(interval / 60)) }
        if interval < 86400 { return L10n.tr("time.hoursAgo", Int(interval / 3600)) }
        if interval < 172800 { return L10n.tr("time.yesterday") }

        return relativeDisplayFormatter(for: AppLanguageStore.shared.locale).string(from: date)
    }

    private static var relativeInputFormatter: DateFormatter {
        let key = "Moment.relativeInputFormatter"
        if let formatter = Thread.current.threadDictionary[key] as? DateFormatter {
            return formatter
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        Thread.current.threadDictionary[key] = formatter
        return formatter
    }

    private static func relativeDisplayFormatter(for locale: Locale) -> DateFormatter {
        let key = "Moment.relativeDisplayFormatter.\(locale.identifier)"
        if let formatter = Thread.current.threadDictionary[key] as? DateFormatter {
            return formatter
        }

        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        Thread.current.threadDictionary[key] = formatter
        return formatter
    }
}

struct MomentUnlockResponseData: Decodable {
    let moment: Moment?
    let walletBalance: WalletBalanceResponseData?

    enum CodingKeys: String, CodingKey {
        case moment
        case walletBalance = "wallet_balance"
        case walletBalanceCamel = "walletBalance"
        case balance
        case wallet
    }

    init(from decoder: Decoder) throws {
        if let directMoment = try? Moment(from: decoder) {
            self.moment = directMoment
            self.walletBalance = nil
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.moment = try? container.decodeIfPresent(Moment.self, forKey: .moment)
        self.walletBalance = (try? container.decodeIfPresent(WalletBalanceResponseData.self, forKey: .walletBalance))
            ?? (try? container.decodeIfPresent(WalletBalanceResponseData.self, forKey: .walletBalanceCamel))
            ?? (try? container.decodeIfPresent(WalletBalanceResponseData.self, forKey: .wallet))
            ?? container.flexInt(for: .balance).map(WalletBalanceResponseData.init(balance:))
    }
}

struct MomentsNotification: Codable, Identifiable {
    let type: String
    let id: String
    let momentID: Int
    let userID: String
    let content: String?
    let momentContent: String?
    let momentImages: [String]?
    let createdAt: String
    let user: MomentAuthor

    enum CodingKeys: String, CodingKey {
        case type, id
        case momentID = "moment_id"
        case userID = "user_id"
        case content
        case momentContent = "moment_content"
        case momentImages = "moment_images"
        case createdAt = "created_at"
        case user
    }

    var formattedTime: String {
        Moment.relativeTime(from: createdAt)
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
