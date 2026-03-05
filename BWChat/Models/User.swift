// BWChat/Models/User.swift
// Data model for user information

import Foundation

struct User: Codable, Identifiable, Equatable {
    let userID: String
    let username: String
    let nickname: String
    let avatarURL: String

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
        case nickname
        case avatarURL = "avatar_url"
    }
}
