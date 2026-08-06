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
    enum Kind: String, Sendable, Equatable, Codable {
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

enum MomentMediaValidationError: Error, Equatable, Sendable, LocalizedError {
    case mixedMediaTypes
    case tooManyImages(maximum: Int)
    case tooManyVideos(maximum: Int)

    var errorDescription: String? {
        switch self {
        case .mixedMediaTypes:
            return L10n.tr("moment.media.error.mixedTypes")
        case .tooManyImages(let maximum):
            return L10n.tr("moment.media.error.tooManyImages", maximum)
        case .tooManyVideos:
            return L10n.tr("moment.media.error.tooManyVideos")
        }
    }
}

enum MomentMediaPolicy {
    static let maximumImageCount = 9
    static let maximumVideoCount = 1

    static func validate(_ kinds: [MomentUploadMedia.Kind]) throws {
        let imageCount = kinds.filter { $0 == .image }.count
        let videoCount = kinds.filter { $0 == .video }.count

        if imageCount > 0, videoCount > 0 {
            throw MomentMediaValidationError.mixedMediaTypes
        }
        if imageCount > maximumImageCount {
            throw MomentMediaValidationError.tooManyImages(maximum: maximumImageCount)
        }
        if videoCount > maximumVideoCount {
            throw MomentMediaValidationError.tooManyVideos(maximum: maximumVideoCount)
        }
    }
}

struct MomentUploadFile: Sendable {
    let kind: MomentUploadMedia.Kind
    let fileURL: URL
    let filename: String
    let mimeType: String
    let previewFileURL: URL?
}

struct MomentOutgoingPayload: Codable, Sendable {
    let content: String
    let unlockPriceGoldCoins: Int?
}

struct MomentPublishDraft: Sendable {
    let clientRequestID: String
    let content: String
    let mediaFiles: [MomentUploadFile]
    let unlockPriceGoldCoins: Int?
}

struct Moment: Codable, Identifiable, Equatable {
    let id: Int
    let author: MomentAuthor
    let content: String
    let images: [String]
    let media: [MomentMedia]
    let unlockPriceGoldCoins: Int?
    let isUnlocked: Bool
    let locationName: String?
    let createdAt: String
    let likes: [MomentAuthor]
    let comments: [MomentComment]
    let likedByMe: Bool
    let clientRequestID: String?

    enum CodingKeys: String, CodingKey {
        case id, author, content, images
        case media
        case unlockPriceGoldCoins = "unlock_price_gold_coins"
        case unlockPriceGoldCoinsCamel = "unlockPriceGoldCoins"
        case isUnlocked = "is_unlocked"
        case isUnlockedCamel = "isUnlocked"
        case locationName = "location_name"
        case locationNameCamel = "locationName"
        case createdAt = "created_at"
        case likes, comments
        case likedByMe = "liked_by_me"
        case likedByMeCamel = "likedByMe"
        case clientRequestID = "client_request_id"
        case clientRequestIDCamel = "clientRequestId"
    }

    var hasLockedMedia: Bool {
        (unlockPriceGoldCoins ?? 0) > 0 && !isUnlocked && (!media.isEmpty || !images.isEmpty)
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
        unlockPriceGoldCoins: Int? = nil,
        isUnlocked: Bool? = nil,
        locationName: String? = nil,
        clientRequestID: String? = nil
    ) {
        let resolvedMedia = media ?? Self.mediaFromLegacyImages(images)
        self.id = id
        self.author = author
        self.content = content
        self.images = images.isEmpty ? Self.legacyImages(from: resolvedMedia) : images
        self.media = resolvedMedia
        let normalizedUnlockPrice = unlockPriceGoldCoins.flatMap { $0 > 0 ? $0 : nil }
        self.unlockPriceGoldCoins = normalizedUnlockPrice
        self.isUnlocked = isUnlocked ?? (normalizedUnlockPrice == nil ? !resolvedMedia.contains { $0.isLocked } : false)
        self.locationName = locationName?.nilIfBlank
        self.createdAt = createdAt
        self.likes = likes
        self.comments = comments
        self.likedByMe = likedByMe
        self.clientRequestID = clientRequestID
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let legacyImages = (try? container.decodeIfPresent([String].self, forKey: .images)) ?? []
        let decodedMedia = (try? container.decodeIfPresent([MomentMedia].self, forKey: .media)) ?? []
        let resolvedMedia = decodedMedia.isEmpty ? Self.mediaFromLegacyImages(legacyImages) : decodedMedia
        let decodedPrice = container.flexInt(for: .unlockPriceGoldCoins)
            ?? container.flexInt(for: .unlockPriceGoldCoinsCamel)
        let decodedUnlocked = container.flexBool(for: .isUnlocked)
            ?? container.flexBool(for: .isUnlockedCamel)

        self.id = container.flexInt(for: .id) ?? 0
        self.author = try container.decode(MomentAuthor.self, forKey: .author)
        self.content = container.flexString(for: .content) ?? ""
        self.images = legacyImages.isEmpty ? Self.legacyImages(from: resolvedMedia) : legacyImages
        self.media = resolvedMedia
        let normalizedUnlockPrice = decodedPrice.flatMap { $0 > 0 ? $0 : nil }
        self.unlockPriceGoldCoins = normalizedUnlockPrice
        self.isUnlocked = decodedUnlocked ?? (normalizedUnlockPrice == nil ? !resolvedMedia.contains { $0.isLocked } : false)
        self.locationName = (container.flexString(for: .locationName)
            ?? container.flexString(for: .locationNameCamel))?.nilIfBlank
        self.createdAt = container.flexString(for: .createdAt) ?? ""
        self.likes = (try? container.decodeIfPresent([MomentAuthor].self, forKey: .likes)) ?? []
        self.comments = (try? container.decodeIfPresent([MomentComment].self, forKey: .comments)) ?? []
        self.likedByMe = container.flexBool(for: .likedByMe)
            ?? container.flexBool(for: .likedByMeCamel)
            ?? false
        self.clientRequestID = container.flexString(for: .clientRequestID)
            ?? container.flexString(for: .clientRequestIDCamel)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(author, forKey: .author)
        try container.encode(content, forKey: .content)
        try container.encode(images, forKey: .images)
        try container.encode(media, forKey: .media)
        try container.encodeIfPresent(unlockPriceGoldCoins, forKey: .unlockPriceGoldCoins)
        try container.encode(isUnlocked, forKey: .isUnlocked)
        try container.encodeIfPresent(locationName, forKey: .locationName)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(likes, forKey: .likes)
        try container.encode(comments, forKey: .comments)
        try container.encode(likedByMe, forKey: .likedByMe)
        try container.encodeIfPresent(clientRequestID, forKey: .clientRequestID)
    }

    var presentationIdentity: String {
        clientRequestID.map { "client:\($0)" } ?? "server:\(id)"
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

/// Account-scoped disk snapshot shared by the public feed, "My Moments", and
/// public profile screens. Optional fields keep snapshots written by older app
/// versions decodable during migration.
struct CachedMomentFeedSnapshot: Codable, Equatable {
    let items: [Moment]
    let hasMore: Bool
    let nextBeforeID: Int?
    let snapshotComplete: Bool?

    init(
        items: [Moment],
        hasMore: Bool,
        nextBeforeID: Int? = nil,
        snapshotComplete: Bool? = nil
    ) {
        self.items = items
        self.hasMore = hasMore
        self.nextBeforeID = nextBeforeID
        self.snapshotComplete = snapshotComplete
    }
}

/// Strict transport contract for all first-page Moments endpoints. A missing
/// `moments` field is a malformed/degraded response, not an empty feed.
struct MomentFeedResponseData: Decodable {
    let moments: [Moment]
    let hasMore: Bool
    let snapshotComplete: Bool?

    enum CodingKeys: String, CodingKey {
        case moments
        case hasMore = "has_more"
        case snapshotComplete = "snapshot_complete"
        case isComplete = "is_complete"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        moments = try container.decode([Moment].self, forKey: .moments)
        hasMore = container.flexBool(for: .hasMore) ?? false
        snapshotComplete = container.flexBool(for: .snapshotComplete)
            ?? container.flexBool(for: .isComplete)
    }
}

enum MomentCacheNamespace {
    static let publicFeed = "moments-feed"
    static let userFeed = "moments-user"

    /// UserProfileViewModel used this namespace before all Moments surfaces
    /// were consolidated. Keep it readable so an app upgrade cannot strand a
    /// user's existing offline snapshot.
    static let legacyProfileUserFeed = "user-moments"
}

enum MomentFirstPageReplacementPolicy {
    /// A transport-successful empty array is not necessarily an authoritative
    /// empty feed. During backend restart, cache warm-up, replica lag, or a
    /// degraded response, preserving the last non-empty snapshot is safer.
    /// The backend can explicitly confirm a legitimate empty snapshot with
    /// `snapshot_complete: true`.
    static func shouldAccept(
        itemCount: Int,
        replacingLocalCount: Int,
        snapshotComplete: Bool?
    ) -> Bool {
        guard itemCount == 0, replacingLocalCount > 0 else { return true }
        return snapshotComplete == true
    }
}

struct MomentUnlockResponseData: Decodable {
    let moment: Moment?
    let charge: MixedAssetCharge?
    let consumedProp: PropConsumptionResult?
    let alreadyUnlocked: Bool

    var walletBalance: WalletBalanceResponseData? { charge?.walletBalance }

    enum CodingKeys: String, CodingKey {
        case moment
        case consumedProp = "consumed_prop"
        case alreadyUnlocked = "already_unlocked"
    }

    init(from decoder: Decoder) throws {
        if let directMoment = try? Moment(from: decoder) {
            self.moment = directMoment
            self.charge = nil
            self.consumedProp = nil
            self.alreadyUnlocked = false
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.moment = try? container.decodeIfPresent(Moment.self, forKey: .moment)
        self.charge = try MixedAssetCharge.decodeIfPresent(from: decoder)
        self.consumedProp = try? container.decodeIfPresent(PropConsumptionResult.self, forKey: .consumedProp)
        self.alreadyUnlocked = (try? container.decodeIfPresent(Bool.self, forKey: .alreadyUnlocked)) ?? false
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
