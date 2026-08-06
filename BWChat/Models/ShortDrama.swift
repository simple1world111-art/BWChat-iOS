// BWChat/Models/ShortDrama.swift
// Short drama feed, creator, and comment models.

import Foundation

struct ShortDramaOutgoingEpisode: Codable, Sendable {
    let clientEpisodeID: String
    let serverVideoID: String?
    let episodeNumber: Int
    let title: String
    let intro: String
    let unlockPriceGoldCoins: Int
    let videoRelativePath: String?
    let coverRelativePath: String?
}

struct ShortDramaOutgoingPayload: Codable, Sendable {
    let clientSeriesID: String
    let serverSeriesID: String?
    let title: String
    let intro: String
    let coverRelativePath: String?
    let episodes: [ShortDramaOutgoingEpisode]
}

struct ShortDramaCreator: Codable, Identifiable, Equatable, Hashable {
    let userID: String
    let username: String
    let nickname: String
    let avatarURL: String
    var followedByMe: Bool
    let followsMe: Bool
    let isFriend: Bool

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
        case nickname
        case avatarURL = "avatar_url"
        case followedByMe = "followed_by_me"
        case followsMe = "follows_me"
        case isFriend = "is_friend"
        case creator
        case author
        case user
    }

    init(
        userID: String,
        username: String = "",
        nickname: String,
        avatarURL: String,
        followedByMe: Bool = false,
        followsMe: Bool = false,
        isFriend: Bool = false
    ) {
        self.userID = userID
        self.username = username
        self.nickname = nickname
        self.avatarURL = avatarURL
        self.followedByMe = followedByMe
        self.followsMe = followsMe
        self.isFriend = isFriend
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let nested = try? container.decodeIfPresent(ShortDramaCreator.self, forKey: .creator) {
            self = nested
            return
        }
        if let nested = try? container.decodeIfPresent(ShortDramaCreator.self, forKey: .author) {
            self = nested
            return
        }
        if let nested = try? container.decodeIfPresent(ShortDramaCreator.self, forKey: .user) {
            self = nested
            return
        }

        self.userID = container.flexString(for: .userID) ?? ""
        self.username = container.flexString(for: .username) ?? ""
        self.nickname = container.flexString(for: .nickname) ?? L10n.tr("profile.defaultUser")
        self.avatarURL = container.flexString(for: .avatarURL) ?? ""
        self.followedByMe = container.flexBool(for: .followedByMe) ?? false
        self.followsMe = container.flexBool(for: .followsMe) ?? false
        self.isFriend = container.flexBool(for: .isFriend) ?? false
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(userID, forKey: .userID)
        try container.encode(username, forKey: .username)
        try container.encode(nickname, forKey: .nickname)
        try container.encode(avatarURL, forKey: .avatarURL)
        try container.encode(followedByMe, forKey: .followedByMe)
        try container.encode(followsMe, forKey: .followsMe)
        try container.encode(isFriend, forKey: .isFriend)
    }

    func fillingMissingFields(from fallback: ShortDramaCreator) -> ShortDramaCreator {
        let shouldUseFallbackIdentity = userID.isBlank
        let resolvedUserID = shouldUseFallbackIdentity ? fallback.userID : userID
        let identitiesMatch = resolvedUserID == fallback.userID
        let defaultNickname = L10n.tr("profile.defaultUser")

        return ShortDramaCreator(
            userID: resolvedUserID,
            username: username.isBlank && identitiesMatch ? fallback.username : username,
            nickname: (nickname.isBlank || nickname == defaultNickname) && identitiesMatch ? fallback.nickname : nickname,
            avatarURL: avatarURL.isBlank && identitiesMatch ? fallback.avatarURL : avatarURL,
            followedByMe: identitiesMatch ? (followedByMe || fallback.followedByMe) : followedByMe,
            followsMe: identitiesMatch ? (followsMe || fallback.followsMe) : followsMe,
            isFriend: identitiesMatch ? (isFriend || fallback.isFriend) : isFriend
        )
    }
}

struct ShortDramaVideo: Codable, Identifiable, Equatable {
    let id: String
    let dramaID: String
    var creator: ShortDramaCreator
    let dramaTitle: String
    let title: String
    let intro: String
    let episodeNumber: Int?
    let coverURL: String
    let playURL: String
    let hlsURL: String?
    let mp4URL: String?
    let durationSeconds: Double?
    var playbackPositionSeconds: Double
    var likeCount: Int
    var commentCount: Int
    var likedByMe: Bool
    let publishStatus: ShortDramaPublishStatus?
    let statusMessage: String?
    let unlockPriceGoldCoins: Int?
    var isUnlocked: Bool
    let isOwnedByCurrentUser: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case videoID = "video_id"
        case dramaID = "drama_id"
        case seriesID = "series_id"
        case creator
        case author
        case user
        case dramaTitle = "drama_title"
        case seriesTitle = "series_title"
        case showTitle = "show_title"
        case title
        case name
        case intro
        case description
        case summary
        case episodeNumber = "episode_number"
        case episodeNo = "episode_no"
        case episode
        case coverURL = "cover_url"
        case thumbnailURL = "thumbnail_url"
        case posterURL = "poster_url"
        case playURL = "play_url"
        case hlsURL = "hls_url"
        case mp4URL = "mp4_url"
        case videoURL = "video_url"
        case durationSeconds = "duration_seconds"
        case duration
        case playbackPositionSeconds = "playback_position_seconds"
        case progressSeconds = "progress_seconds"
        case likeCount = "like_count"
        case likesCount = "likes_count"
        case commentCount = "comment_count"
        case commentsCount = "comments_count"
        case likedByMe = "liked_by_me"
        case status
        case publishStatus = "publish_status"
        case statusMessage = "status_message"
        case reviewReason = "review_reason"
        case rejectionReason = "rejection_reason"
        case rejectReason = "reject_reason"
        case failureReason = "failure_reason"
        case reason
        case message
        case unlockPriceGoldCoins = "unlock_price_gold_coins"
        case unlockPriceGoldCoinsCamel = "unlockPriceGoldCoins"
        case isUnlocked = "is_unlocked"
        case isUnlockedCamel = "isUnlocked"
        case isOwnedByCurrentUser = "is_owned_by_current_user"
        case isOwnedByCurrentUserCamel = "isOwnedByCurrentUser"
    }

    var streamingURLString: String {
        if let hlsURL = hlsURL?.trimmedNonEmpty {
            return hlsURL
        }
        if playURL.lowercased().contains(".m3u8") {
            return playURL
        }
        if let mp4URL = mp4URL?.trimmedNonEmpty {
            return mp4URL
        }
        return playURL
    }

    var displayTitle: String {
        title.trimmedNonEmpty ?? dramaTitle.trimmedNonEmpty ?? L10n.tr("shortDrama.video")
    }

    var displayIntro: String {
        intro.trimmedNonEmpty ?? L10n.tr("shortDrama.noIntro")
    }

    var episodeText: String {
        guard let episodeNumber, episodeNumber > 0 else {
            return L10n.tr("shortDrama.episodeUnknown")
        }
        return L10n.tr("shortDrama.episode", episodeNumber)
    }

    var requiresUnlock: Bool {
        (unlockPriceGoldCoins ?? 0) > 0 && !isUnlocked && !isOwnedByCurrentUser
    }

    init(
        id: String,
        dramaID: String = "",
        creator: ShortDramaCreator,
        dramaTitle: String,
        title: String,
        intro: String = "",
        episodeNumber: Int? = nil,
        coverURL: String = "",
        playURL: String,
        hlsURL: String? = nil,
        mp4URL: String? = nil,
        durationSeconds: Double? = nil,
        playbackPositionSeconds: Double = 0,
        likeCount: Int = 0,
        commentCount: Int = 0,
        likedByMe: Bool = false,
        publishStatus: ShortDramaPublishStatus? = nil,
        statusMessage: String? = nil,
        unlockPriceGoldCoins: Int? = nil,
        isUnlocked: Bool = false,
        isOwnedByCurrentUser: Bool = false
    ) {
        self.id = id
        self.dramaID = dramaID
        self.creator = creator
        self.dramaTitle = dramaTitle
        self.title = title
        self.intro = intro
        self.episodeNumber = episodeNumber
        self.coverURL = coverURL
        self.playURL = playURL
        self.hlsURL = hlsURL
        self.mp4URL = mp4URL
        self.durationSeconds = durationSeconds
        self.playbackPositionSeconds = playbackPositionSeconds
        self.likeCount = likeCount
        self.commentCount = commentCount
        self.likedByMe = likedByMe
        self.publishStatus = publishStatus
        self.statusMessage = statusMessage
        self.unlockPriceGoldCoins = unlockPriceGoldCoins.flatMap { $0 > 0 ? min($0, 100) : nil }
        self.isUnlocked = isUnlocked
        self.isOwnedByCurrentUser = isOwnedByCurrentUser
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedID = container.flexString(for: .id)
            ?? container.flexString(for: .videoID)
            ?? UUID().uuidString
        let decodedCreator = (try? container.decodeIfPresent(ShortDramaCreator.self, forKey: .creator))
            ?? (try? container.decodeIfPresent(ShortDramaCreator.self, forKey: .author))
            ?? (try? container.decodeIfPresent(ShortDramaCreator.self, forKey: .user))
            ?? ShortDramaCreator(userID: "", nickname: L10n.tr("profile.defaultUser"), avatarURL: "")
        let decodedPlayURL = container.flexString(for: .playURL)
            ?? container.flexString(for: .hlsURL)
            ?? container.flexString(for: .mp4URL)
            ?? container.flexString(for: .videoURL)
            ?? ""

        self.id = decodedID
        self.dramaID = container.flexString(for: .dramaID)
            ?? container.flexString(for: .seriesID)
            ?? ""
        self.creator = decodedCreator
        self.dramaTitle = container.flexString(for: .dramaTitle)
            ?? container.flexString(for: .seriesTitle)
            ?? container.flexString(for: .showTitle)
            ?? ""
        self.title = container.flexString(for: .title)
            ?? container.flexString(for: .name)
            ?? ""
        self.intro = container.flexString(for: .intro)
            ?? container.flexString(for: .description)
            ?? container.flexString(for: .summary)
            ?? ""
        self.episodeNumber = container.flexInt(for: .episodeNumber)
            ?? container.flexInt(for: .episodeNo)
            ?? container.flexInt(for: .episode)
        self.coverURL = container.flexString(for: .coverURL)
            ?? container.flexString(for: .thumbnailURL)
            ?? container.flexString(for: .posterURL)
            ?? ""
        self.playURL = decodedPlayURL
        self.hlsURL = container.flexString(for: .hlsURL)
        self.mp4URL = container.flexString(for: .mp4URL)
            ?? container.flexString(for: .videoURL)
        self.durationSeconds = container.flexDouble(for: .durationSeconds)
            ?? container.flexDouble(for: .duration)
        self.playbackPositionSeconds = container.flexDouble(for: .playbackPositionSeconds)
            ?? container.flexDouble(for: .progressSeconds)
            ?? 0
        self.likeCount = container.flexInt(for: .likeCount)
            ?? container.flexInt(for: .likesCount)
            ?? 0
        self.commentCount = container.flexInt(for: .commentCount)
            ?? container.flexInt(for: .commentsCount)
            ?? 0
        self.likedByMe = container.flexBool(for: .likedByMe) ?? false
        self.publishStatus = (try? container.decodeIfPresent(ShortDramaPublishStatus.self, forKey: .publishStatus))
            ?? (try? container.decodeIfPresent(ShortDramaPublishStatus.self, forKey: .status))
        self.statusMessage = container.flexString(for: .statusMessage)
            ?? container.flexString(for: .failureReason)
            ?? container.flexString(for: .reviewReason)
            ?? container.flexString(for: .rejectionReason)
            ?? container.flexString(for: .rejectReason)
            ?? container.flexString(for: .reason)
            ?? container.flexString(for: .message)
        let decodedUnlockPrice = container.flexInt(for: .unlockPriceGoldCoins)
            ?? container.flexInt(for: .unlockPriceGoldCoinsCamel)
        self.unlockPriceGoldCoins = decodedUnlockPrice.flatMap { $0 > 0 ? min($0, 100) : nil }
        self.isUnlocked = container.flexBool(for: .isUnlocked)
            ?? container.flexBool(for: .isUnlockedCamel)
            ?? false
        self.isOwnedByCurrentUser = container.flexBool(for: .isOwnedByCurrentUser)
            ?? container.flexBool(for: .isOwnedByCurrentUserCamel)
            ?? false
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(dramaID, forKey: .dramaID)
        try container.encode(creator, forKey: .creator)
        try container.encode(dramaTitle, forKey: .dramaTitle)
        try container.encode(title, forKey: .title)
        try container.encode(intro, forKey: .intro)
        try container.encodeIfPresent(episodeNumber, forKey: .episodeNumber)
        try container.encode(coverURL, forKey: .coverURL)
        try container.encode(playURL, forKey: .playURL)
        try container.encodeIfPresent(hlsURL, forKey: .hlsURL)
        try container.encodeIfPresent(mp4URL, forKey: .mp4URL)
        try container.encodeIfPresent(durationSeconds, forKey: .durationSeconds)
        try container.encode(playbackPositionSeconds, forKey: .playbackPositionSeconds)
        try container.encode(likeCount, forKey: .likeCount)
        try container.encode(commentCount, forKey: .commentCount)
        try container.encode(likedByMe, forKey: .likedByMe)
        try container.encodeIfPresent(publishStatus, forKey: .publishStatus)
        try container.encodeIfPresent(statusMessage, forKey: .statusMessage)
        try container.encodeIfPresent(unlockPriceGoldCoins, forKey: .unlockPriceGoldCoins)
        try container.encode(isUnlocked, forKey: .isUnlocked)
        try container.encode(isOwnedByCurrentUser, forKey: .isOwnedByCurrentUser)
    }

    func fillingSeriesMetadata(
        seriesID: String,
        seriesTitle: String,
        seriesIntro: String,
        seriesCoverURL: String,
        seriesCreator: ShortDramaCreator
    ) -> ShortDramaVideo {
        ShortDramaVideo(
            id: id,
            dramaID: dramaID.isBlank ? seriesID : dramaID,
            creator: creator.fillingMissingFields(from: seriesCreator),
            dramaTitle: dramaTitle.isBlank ? seriesTitle : dramaTitle,
            title: title,
            intro: intro.isBlank ? seriesIntro : intro,
            episodeNumber: episodeNumber,
            coverURL: coverURL.isBlank ? seriesCoverURL : coverURL,
            playURL: playURL,
            hlsURL: hlsURL,
            mp4URL: mp4URL,
            durationSeconds: durationSeconds,
            playbackPositionSeconds: playbackPositionSeconds,
            likeCount: likeCount,
            commentCount: commentCount,
            likedByMe: likedByMe,
            publishStatus: publishStatus,
            statusMessage: statusMessage,
            unlockPriceGoldCoins: unlockPriceGoldCoins,
            isUnlocked: isUnlocked,
            isOwnedByCurrentUser: isOwnedByCurrentUser
        )
    }
}

enum ShortDramaSeriesFilter: String, CaseIterable, Identifiable {
    case recommended
    case watched

    var id: String { rawValue }

    var localizedTitle: String {
        switch self {
        case .recommended: return L10n.tr("shortDrama.tab.recommended")
        case .watched: return L10n.tr("shortDrama.tab.watched")
        }
    }
}

enum ShortDramaPublishStatus: String, Codable, Equatable, Hashable {
    case draft
    case processing
    case reviewing
    case published
    case rejected
    case failed
    case unknown

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = (try? container.decode(String.self))?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if let rawValue {
            switch rawValue {
            case "draft", "草稿":
                self = .draft
            case "processing", "transcoding", "encoding", "queued", "uploading", "pending_transcode", "处理中", "处理", "转码中", "上传中":
                self = .processing
            case "reviewing", "review", "pending", "audit", "auditing", "pending_review", "under_review", "in_review", "审核中", "待审核":
                self = .reviewing
            case "published", "online", "approved", "ready", "complete", "completed", "success", "succeeded", "active", "available", "released", "public", "已发布", "发布成功", "已上线", "通过", "审核通过", "已完成":
                self = .published
            case "rejected", "reject", "blocked", "disabled", "content_rejected", "review_rejected", "moderation_rejected", "已拒绝", "拒绝", "审核拒绝", "审核不通过", "未通过", "内容违规", "违规":
                self = .rejected
            case "failed", "failure", "error", "processing_failed", "process_failed", "transcode_failed", "transcoding_failed", "encoding_failed", "upload_failed", "media_failed", "处理失败", "转码失败", "上传失败", "失败":
                self = .failed
            default:
                self = .unknown
            }
            return
        }

        if let intValue = try? container.decode(Int.self) {
            switch intValue {
            case 0: self = .draft
            case 1: self = .processing
            case 2: self = .reviewing
            case 3: self = .published
            case 4: self = .rejected
            case 5: self = .failed
            default: self = .unknown
            }
            return
        }

        self = .unknown
    }

    var localizedTitle: String {
        switch self {
        case .draft: return L10n.tr("shortDrama.draft")
        case .processing: return L10n.tr("shortDrama.processing")
        case .reviewing: return L10n.tr("shortDrama.reviewing")
        case .published: return L10n.tr("shortDrama.published")
        case .rejected: return L10n.tr("shortDrama.rejected")
        case .failed: return L10n.tr("shortDrama.failed")
        case .unknown: return L10n.tr("shortDrama.status.unknown")
        }
    }

    var isPending: Bool {
        self == .processing || self == .reviewing
    }

    var needsAttention: Bool {
        self == .rejected || self == .failed
    }
}

struct ShortDramaSeries: Codable, Identifiable, Equatable {
    let seriesID: String
    let title: String
    let intro: String
    let coverURL: String
    let episodeCount: Int
    let status: ShortDramaPublishStatus
    let statusMessage: String?
    let updatedAt: String
    let episodes: [ShortDramaVideo]
    let creator: ShortDramaCreator
    let resumeEpisodeID: String?
    let resumePositionSeconds: Double
    let lastWatchedAt: String?

    var id: String { seriesID }

    enum CodingKeys: String, CodingKey {
        case seriesID = "series_id"
        case dramaID = "drama_id"
        case id
        case title
        case name
        case intro
        case description
        case summary
        case coverURL = "cover_url"
        case posterURL = "poster_url"
        case thumbnailURL = "thumbnail_url"
        case episodeCount = "episode_count"
        case episodesCount = "episodes_count"
        case status
        case publishStatus = "publish_status"
        case statusMessage = "status_message"
        case reviewReason = "review_reason"
        case rejectionReason = "rejection_reason"
        case rejectReason = "reject_reason"
        case failureReason = "failure_reason"
        case reason
        case message
        case updatedAt = "updated_at"
        case createdAt = "created_at"
        case episodes
        case videos
        case items
        case creator
        case author
        case user
        case resumeEpisodeID = "resume_episode_id"
        case resumeEpisodeIDCamel = "resumeEpisodeID"
        case resumePositionSeconds = "resume_position_seconds"
        case resumePositionSecondsCamel = "resumePositionSeconds"
        case lastWatchedAt = "last_watched_at"
        case lastWatchedAtCamel = "lastWatchedAt"
    }

    init(
        seriesID: String,
        title: String,
        intro: String = "",
        coverURL: String = "",
        episodeCount: Int = 0,
        status: ShortDramaPublishStatus = .draft,
        statusMessage: String? = nil,
        updatedAt: String = "",
        episodes: [ShortDramaVideo] = [],
        creator: ShortDramaCreator = ShortDramaCreator(userID: "", nickname: L10n.tr("profile.defaultUser"), avatarURL: ""),
        resumeEpisodeID: String? = nil,
        resumePositionSeconds: Double = 0,
        lastWatchedAt: String? = nil
    ) {
        self.seriesID = seriesID
        self.title = title
        self.intro = intro
        self.coverURL = coverURL
        self.episodeCount = episodeCount
        self.status = status
        self.statusMessage = statusMessage
        self.updatedAt = updatedAt
        self.episodes = episodes
        self.creator = creator
        self.resumeEpisodeID = resumeEpisodeID
        self.resumePositionSeconds = resumePositionSeconds
        self.lastWatchedAt = lastWatchedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedEpisodes = (try? container.decodeIfPresent([ShortDramaVideo].self, forKey: .episodes))
            ?? (try? container.decodeIfPresent([ShortDramaVideo].self, forKey: .videos))
            ?? (try? container.decodeIfPresent([ShortDramaVideo].self, forKey: .items))
            ?? []
        let decodedSeriesID = container.flexString(for: .seriesID)
            ?? container.flexString(for: .dramaID)
            ?? container.flexString(for: .id)
            ?? UUID().uuidString
        let decodedTitle = container.flexString(for: .title)
            ?? container.flexString(for: .name)
            ?? L10n.tr("shortDrama.series.untitled")
        let decodedIntro = container.flexString(for: .intro)
            ?? container.flexString(for: .description)
            ?? container.flexString(for: .summary)
            ?? ""
        let decodedCoverURL = container.flexString(for: .coverURL)
            ?? container.flexString(for: .posterURL)
            ?? container.flexString(for: .thumbnailURL)
            ?? ""
        let decodedCreator = (try? container.decodeIfPresent(ShortDramaCreator.self, forKey: .creator))
            ?? (try? container.decodeIfPresent(ShortDramaCreator.self, forKey: .author))
            ?? (try? container.decodeIfPresent(ShortDramaCreator.self, forKey: .user))
            ?? decodedEpisodes.first?.creator
            ?? ShortDramaCreator(userID: "", nickname: L10n.tr("profile.defaultUser"), avatarURL: "")

        self.seriesID = decodedSeriesID
        self.title = decodedTitle
        self.intro = decodedIntro
        self.coverURL = decodedCoverURL
        self.episodeCount = container.flexInt(for: .episodeCount)
            ?? container.flexInt(for: .episodesCount)
            ?? decodedEpisodes.count
        self.status = (try? container.decodeIfPresent(ShortDramaPublishStatus.self, forKey: .status))
            ?? (try? container.decodeIfPresent(ShortDramaPublishStatus.self, forKey: .publishStatus))
            ?? .draft
        self.statusMessage = container.flexString(for: .statusMessage)
            ?? container.flexString(for: .failureReason)
            ?? container.flexString(for: .reviewReason)
            ?? container.flexString(for: .rejectionReason)
            ?? container.flexString(for: .rejectReason)
            ?? container.flexString(for: .reason)
            ?? container.flexString(for: .message)
        self.updatedAt = container.flexString(for: .updatedAt)
            ?? container.flexString(for: .createdAt)
            ?? ""
        self.episodes = decodedEpisodes.map {
            $0.fillingSeriesMetadata(
                seriesID: decodedSeriesID,
                seriesTitle: decodedTitle,
                seriesIntro: decodedIntro,
                seriesCoverURL: decodedCoverURL,
                seriesCreator: decodedCreator
            )
        }
        self.creator = decodedCreator
        self.resumeEpisodeID = container.flexString(for: .resumeEpisodeID)
            ?? container.flexString(for: .resumeEpisodeIDCamel)
        self.resumePositionSeconds = container.flexDouble(for: .resumePositionSeconds)
            ?? container.flexDouble(for: .resumePositionSecondsCamel)
            ?? 0
        self.lastWatchedAt = container.flexString(for: .lastWatchedAt)
            ?? container.flexString(for: .lastWatchedAtCamel)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(seriesID, forKey: .seriesID)
        try container.encode(title, forKey: .title)
        try container.encode(intro, forKey: .intro)
        try container.encode(coverURL, forKey: .coverURL)
        try container.encode(episodeCount, forKey: .episodeCount)
        try container.encode(status, forKey: .status)
        try container.encodeIfPresent(statusMessage, forKey: .statusMessage)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(episodes, forKey: .episodes)
        try container.encode(creator, forKey: .creator)
        try container.encodeIfPresent(resumeEpisodeID, forKey: .resumeEpisodeID)
        try container.encode(resumePositionSeconds, forKey: .resumePositionSeconds)
        try container.encodeIfPresent(lastWatchedAt, forKey: .lastWatchedAt)
    }
}

typealias ShortDramaSeriesPage = ShortDramaStudioPage

struct ShortDramaUnlockResult: Decodable, Equatable {
    let video: ShortDramaVideo?
    let charge: MixedAssetCharge?

    var walletBalance: WalletBalanceResponseData? { charge?.walletBalance }

    enum CodingKeys: String, CodingKey {
        case video
        case episode
    }

    init(video: ShortDramaVideo?, charge: MixedAssetCharge?) {
        self.video = video
        self.charge = charge
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.video = (try? container.decodeIfPresent(ShortDramaVideo.self, forKey: .video))
            ?? (try? container.decodeIfPresent(ShortDramaVideo.self, forKey: .episode))
        self.charge = try MixedAssetCharge.decodeIfPresent(from: decoder)
    }
}

struct ShortDramaStudioPage: Codable, Equatable {
    let series: [ShortDramaSeries]
    let hasMore: Bool
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case series
        case items
        case list
        case hasMore = "has_more"
        case nextCursor = "next_cursor"
        case cursor
    }

    init(series: [ShortDramaSeries], hasMore: Bool, nextCursor: String?) {
        self.series = series
        self.hasMore = hasMore
        self.nextCursor = nextCursor
    }

    init(from decoder: Decoder) throws {
        if let series = try? [ShortDramaSeries](from: decoder) {
            self.series = series
            self.hasMore = false
            self.nextCursor = nil
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.series = (try? container.decodeIfPresent([ShortDramaSeries].self, forKey: .series))
            ?? (try? container.decodeIfPresent([ShortDramaSeries].self, forKey: .items))
            ?? (try? container.decodeIfPresent([ShortDramaSeries].self, forKey: .list))
            ?? []
        let decodedNextCursor = container.flexString(for: .nextCursor)
            ?? container.flexString(for: .cursor)
        self.nextCursor = decodedNextCursor
        self.hasMore = container.flexBool(for: .hasMore) ?? (decodedNextCursor?.trimmedNonEmpty != nil)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(series, forKey: .series)
        try container.encode(hasMore, forKey: .hasMore)
        try container.encodeIfPresent(nextCursor, forKey: .nextCursor)
    }
}

struct ShortDramaEpisodeUploadResult: Decodable, Equatable {
    let video: ShortDramaVideo?
    let status: ShortDramaPublishStatus?
    let statusMessage: String?

    enum CodingKeys: String, CodingKey {
        case video
        case episode
        case item
        case status
        case publishStatus = "publish_status"
        case statusMessage = "status_message"
        case reviewReason = "review_reason"
        case rejectionReason = "rejection_reason"
        case rejectReason = "reject_reason"
        case failureReason = "failure_reason"
        case reason
        case message
        case id
        case videoID = "video_id"
    }

    init(video: ShortDramaVideo?, status: ShortDramaPublishStatus?, statusMessage: String? = nil) {
        self.video = video
        self.status = status
        self.statusMessage = statusMessage
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let nestedVideo = (try? container.decodeIfPresent(ShortDramaVideo.self, forKey: .video))
            ?? (try? container.decodeIfPresent(ShortDramaVideo.self, forKey: .episode))
            ?? (try? container.decodeIfPresent(ShortDramaVideo.self, forKey: .item))

        let resolvedVideo: ShortDramaVideo?
        if let nestedVideo {
            resolvedVideo = nestedVideo
        } else if container.flexString(for: .videoID) != nil || container.flexString(for: .id) != nil {
            resolvedVideo = try? ShortDramaVideo(from: decoder)
        } else {
            resolvedVideo = nil
        }
        self.video = resolvedVideo
        self.status = (try? container.decodeIfPresent(ShortDramaPublishStatus.self, forKey: .status))
            ?? (try? container.decodeIfPresent(ShortDramaPublishStatus.self, forKey: .publishStatus))
            ?? resolvedVideo?.publishStatus
        self.statusMessage = container.flexString(for: .statusMessage)
            ?? container.flexString(for: .failureReason)
            ?? container.flexString(for: .reviewReason)
            ?? container.flexString(for: .rejectionReason)
            ?? container.flexString(for: .rejectReason)
            ?? container.flexString(for: .reason)
            ?? container.flexString(for: .message)
            ?? resolvedVideo?.statusMessage
    }
}

struct ShortDramaComment: Codable, Identifiable, Equatable {
    let id: String
    let videoID: String
    let userID: String
    let nickname: String
    let avatarURL: String
    let content: String
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case commentID = "comment_id"
        case videoID = "video_id"
        case userID = "user_id"
        case nickname
        case avatarURL = "avatar_url"
        case content
        case text
        case createdAt = "created_at"
    }

    init(
        id: String,
        videoID: String,
        userID: String,
        nickname: String,
        avatarURL: String,
        content: String,
        createdAt: String
    ) {
        self.id = id
        self.videoID = videoID
        self.userID = userID
        self.nickname = nickname
        self.avatarURL = avatarURL
        self.content = content
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = container.flexString(for: .id)
            ?? container.flexString(for: .commentID)
            ?? UUID().uuidString
        self.videoID = container.flexString(for: .videoID) ?? ""
        self.userID = container.flexString(for: .userID) ?? ""
        self.nickname = container.flexString(for: .nickname) ?? L10n.tr("profile.defaultUser")
        self.avatarURL = container.flexString(for: .avatarURL) ?? ""
        self.content = container.flexString(for: .content)
            ?? container.flexString(for: .text)
            ?? ""
        self.createdAt = container.flexString(for: .createdAt) ?? ""
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(videoID, forKey: .videoID)
        try container.encode(userID, forKey: .userID)
        try container.encode(nickname, forKey: .nickname)
        try container.encode(avatarURL, forKey: .avatarURL)
        try container.encode(content, forKey: .content)
        try container.encode(createdAt, forKey: .createdAt)
    }
}

struct ShortDramaFeedPage: Codable, Equatable {
    let videos: [ShortDramaVideo]
    let hasMore: Bool
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case videos
        case items
        case list
        case feed
        case hasMore = "has_more"
        case nextCursor = "next_cursor"
        case cursor
    }

    init(videos: [ShortDramaVideo], hasMore: Bool, nextCursor: String?) {
        self.videos = videos
        self.hasMore = hasMore
        self.nextCursor = nextCursor
    }

    init(from decoder: Decoder) throws {
        if let videos = try? [ShortDramaVideo](from: decoder) {
            self.videos = videos
            self.hasMore = false
            self.nextCursor = nil
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedVideos = Self.decodeVideos(from: container)
        let nextCursor = container.flexString(for: .nextCursor)
            ?? container.flexString(for: .cursor)
        self.videos = decodedVideos
        self.nextCursor = nextCursor
        self.hasMore = container.flexBool(for: .hasMore) ?? (nextCursor?.trimmedNonEmpty != nil)
    }

    private static func decodeVideos(from container: KeyedDecodingContainer<CodingKeys>) -> [ShortDramaVideo] {
        if let videos = try? container.decodeIfPresent([ShortDramaVideo].self, forKey: .videos) {
            return videos
        }
        if let items = try? container.decodeIfPresent([ShortDramaVideo].self, forKey: .items) {
            return items
        }
        if let list = try? container.decodeIfPresent([ShortDramaVideo].self, forKey: .list) {
            return list
        }
        if let feed = try? container.decodeIfPresent([ShortDramaVideo].self, forKey: .feed) {
            return feed
        }
        return []
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(videos, forKey: .videos)
        try container.encode(hasMore, forKey: .hasMore)
        try container.encodeIfPresent(nextCursor, forKey: .nextCursor)
    }
}

struct ShortDramaCommentsPage: Codable, Equatable {
    let comments: [ShortDramaComment]
    let hasMore: Bool
    let nextCursor: String?

    enum CodingKeys: String, CodingKey {
        case comments
        case items
        case list
        case hasMore = "has_more"
        case nextCursor = "next_cursor"
        case cursor
    }

    init(comments: [ShortDramaComment], hasMore: Bool, nextCursor: String?) {
        self.comments = comments
        self.hasMore = hasMore
        self.nextCursor = nextCursor
    }

    init(from decoder: Decoder) throws {
        if let comments = try? [ShortDramaComment](from: decoder) {
            self.comments = comments
            self.hasMore = false
            self.nextCursor = nil
            return
        }

        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedComments = Self.decodeComments(from: container)
        let nextCursor = container.flexString(for: .nextCursor)
            ?? container.flexString(for: .cursor)
        self.comments = decodedComments
        self.nextCursor = nextCursor
        self.hasMore = container.flexBool(for: .hasMore) ?? (nextCursor?.trimmedNonEmpty != nil)
    }


    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(comments, forKey: .comments)
        try container.encode(hasMore, forKey: .hasMore)
        try container.encodeIfPresent(nextCursor, forKey: .nextCursor)
    }

    private static func decodeComments(from container: KeyedDecodingContainer<CodingKeys>) -> [ShortDramaComment] {
        if let comments = try? container.decodeIfPresent([ShortDramaComment].self, forKey: .comments) {
            return comments
        }
        if let items = try? container.decodeIfPresent([ShortDramaComment].self, forKey: .items) {
            return items
        }
        if let list = try? container.decodeIfPresent([ShortDramaComment].self, forKey: .list) {
            return list
        }
        return []
    }
}

struct ShortDramaInteractionResult: Decodable, Equatable {
    let liked: Bool?
    let likeCount: Int?

    enum CodingKeys: String, CodingKey {
        case liked
        case likeCount = "like_count"
    }

    init(liked: Bool?, likeCount: Int?) {
        self.liked = liked
        self.likeCount = likeCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.liked = container.flexBool(for: .liked)
        self.likeCount = container.flexInt(for: .likeCount)
    }
}

private extension String {
    var trimmedNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
