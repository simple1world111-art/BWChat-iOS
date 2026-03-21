// BWChat/Models/User.swift
// Data model for user information

import Foundation

struct User: Codable, Identifiable, Equatable {
    let userID: String
    let username: String
    let nickname: String
    let avatarURL: String
    var bio: String
    var gender: String
    var birthday: String
    var location: String

    var id: String { userID }

    var genderDisplay: String {
        switch gender {
        case "male": return "男"
        case "female": return "女"
        case "other": return "其他"
        default: return ""
        }
    }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
        case nickname
        case avatarURL = "avatar_url"
        case bio
        case gender
        case birthday
        case location
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        userID = try container.decode(String.self, forKey: .userID)
        username = try container.decode(String.self, forKey: .username)
        nickname = try container.decode(String.self, forKey: .nickname)
        avatarURL = try container.decode(String.self, forKey: .avatarURL)
        bio = try container.decodeIfPresent(String.self, forKey: .bio) ?? ""
        gender = try container.decodeIfPresent(String.self, forKey: .gender) ?? ""
        birthday = try container.decodeIfPresent(String.self, forKey: .birthday) ?? ""
        location = try container.decodeIfPresent(String.self, forKey: .location) ?? ""
    }
}
