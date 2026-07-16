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
        case sortOrder = "order"
        case lastPlayedAt = "last_played_at"
    }
}

struct GameSession: Decodable, Equatable {
    let sessionID: String
    let launchURL: String
    let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case launchURL = "launch_url"
        case expiresAt = "expires_at"
    }
}
