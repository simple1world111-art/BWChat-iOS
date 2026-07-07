// BWChat/Models/ShortDrama.swift
// Short drama feed, creator, and comment models.

import Foundation

struct ShortDramaCreator: Decodable, Identifiable, Equatable, Hashable {
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
}

struct ShortDramaVideo: Decodable, Identifiable, Equatable {
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
    var favoriteCount: Int
    var commentCount: Int
    var likedByMe: Bool
    var favoritedByMe: Bool

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
        case favoriteCount = "favorite_count"
        case favoritesCount = "favorites_count"
        case collectCount = "collect_count"
        case commentCount = "comment_count"
        case commentsCount = "comments_count"
        case likedByMe = "liked_by_me"
        case favoritedByMe = "favorited_by_me"
        case collectedByMe = "collected_by_me"
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
        favoriteCount: Int = 0,
        commentCount: Int = 0,
        likedByMe: Bool = false,
        favoritedByMe: Bool = false
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
        self.favoriteCount = favoriteCount
        self.commentCount = commentCount
        self.likedByMe = likedByMe
        self.favoritedByMe = favoritedByMe
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
        self.favoriteCount = container.flexInt(for: .favoriteCount)
            ?? container.flexInt(for: .favoritesCount)
            ?? container.flexInt(for: .collectCount)
            ?? 0
        self.commentCount = container.flexInt(for: .commentCount)
            ?? container.flexInt(for: .commentsCount)
            ?? 0
        self.likedByMe = container.flexBool(for: .likedByMe) ?? false
        self.favoritedByMe = container.flexBool(for: .favoritedByMe)
            ?? container.flexBool(for: .collectedByMe)
            ?? false
    }
}

struct ShortDramaComment: Decodable, Identifiable, Equatable {
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
}

struct ShortDramaFeedPage: Decodable, Equatable {
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
}

struct ShortDramaCommentsPage: Decodable, Equatable {
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
    let favorited: Bool?
    let likeCount: Int?
    let favoriteCount: Int?

    enum CodingKeys: String, CodingKey {
        case liked
        case favorited
        case favorite
        case collected
        case likeCount = "like_count"
        case favoriteCount = "favorite_count"
        case collectCount = "collect_count"
    }

    init(liked: Bool?, favorited: Bool?, likeCount: Int?, favoriteCount: Int?) {
        self.liked = liked
        self.favorited = favorited
        self.likeCount = likeCount
        self.favoriteCount = favoriteCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.liked = container.flexBool(for: .liked)
        self.favorited = container.flexBool(for: .favorited)
            ?? container.flexBool(for: .favorite)
            ?? container.flexBool(for: .collected)
        self.likeCount = container.flexInt(for: .likeCount)
        self.favoriteCount = container.flexInt(for: .favoriteCount)
            ?? container.flexInt(for: .collectCount)
    }
}

private extension String {
    var trimmedNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
