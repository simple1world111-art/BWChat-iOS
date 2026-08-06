import Foundation

enum ScriptScope: String, CaseIterable, Identifiable {
    case `public`
    case mine

    var id: String { rawValue }
}

enum ScriptVisibility: String, Codable, CaseIterable, Identifiable {
    case `private`
    case `public`

    var id: String { rawValue }
}

enum ScriptStatus: String, Codable {
    case draft
    case ready
    case archived
}

enum ScriptActorType: String, Codable {
    case user
    case ai
}

enum ScriptRoomStatus: String, Codable {
    case active
    case ended
}

enum ScriptTurnStatus: String, Codable {
    case queued
    case generating
    case completed
    case failed
}

enum ScriptAssetBusiness: String {
    case cover = "script_cover"
    case roleAvatar = "script_role_avatar"
}

struct ScriptCategory: Codable, Identifiable, Equatable, Hashable {
    let id: String
    let name: String
    let iconURL: String?
    let sortOrder: Int

    private enum CodingKeys: String, CodingKey {
        case id
        case categoryID = "category_id"
        case name
        case title
        case iconURL = "icon_url"
        case sortOrder = "sort_order"
        case order
    }

    init(id: String, name: String, iconURL: String? = nil, sortOrder: Int = 0) {
        self.id = id
        self.name = name
        self.iconURL = iconURL
        self.sortOrder = sortOrder
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = container.scriptString(for: .id)
            ?? container.scriptString(for: .categoryID)
            ?? ""
        name = container.scriptString(for: .name)
            ?? container.scriptString(for: .title)
            ?? id
        iconURL = container.scriptString(for: .iconURL)
        sortOrder = container.scriptInt(for: .sortOrder)
            ?? container.scriptInt(for: .order)
            ?? 0
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(iconURL, forKey: .iconURL)
        try container.encode(sortOrder, forKey: .sortOrder)
    }
}

struct ScriptCategoriesData: Decodable {
    let categories: [ScriptCategory]

    private enum CodingKeys: String, CodingKey {
        case categories
        case items
        case list
    }

    init(from decoder: Decoder) throws {
        if let direct = try? [ScriptCategory](from: decoder) {
            categories = direct
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        categories = (try? container.decodeIfPresent([ScriptCategory].self, forKey: .categories))
            ?? (try? container.decodeIfPresent([ScriptCategory].self, forKey: .items))
            ?? (try? container.decodeIfPresent([ScriptCategory].self, forKey: .list))
            ?? []
    }
}

struct ScriptCreator: Codable, Equatable, Hashable {
    let userID: String
    let nickname: String
    let avatarURL: String

    private enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case id
        case nickname
        case name
        case avatarURL = "avatar_url"
        case avatar
    }

    init(userID: String = "", nickname: String = "", avatarURL: String = "") {
        self.userID = userID
        self.nickname = nickname
        self.avatarURL = avatarURL
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        userID = container.scriptString(for: .userID)
            ?? container.scriptString(for: .id)
            ?? ""
        nickname = container.scriptString(for: .nickname)
            ?? container.scriptString(for: .name)
            ?? ""
        avatarURL = container.scriptString(for: .avatarURL)
            ?? container.scriptString(for: .avatar)
            ?? ""
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(userID, forKey: .userID)
        try container.encode(nickname, forKey: .nickname)
        try container.encode(avatarURL, forKey: .avatarURL)
    }
}

struct ScriptRole: Codable, Identifiable, Equatable, Hashable {
    let roleID: String
    let clientRoleID: String?
    let name: String
    let gender: String
    let avatarURL: String
    let roleDescription: String
    let hiddenSetting: String?
    let sortOrder: Int

    var id: String { roleID.isEmpty ? (clientRoleID ?? name) : roleID }

    private enum CodingKeys: String, CodingKey {
        case roleID = "role_id"
        case id
        case clientRoleID = "client_role_id"
        case name
        case gender
        case avatarURL = "avatar_url"
        case avatar
        case roleDescription = "description"
        case publicDescription = "public_description"
        case hiddenSetting = "hidden_setting"
        case sortOrder = "sort_order"
        case order
    }

    init(
        roleID: String,
        clientRoleID: String? = nil,
        name: String,
        gender: String,
        avatarURL: String,
        roleDescription: String,
        hiddenSetting: String? = nil,
        sortOrder: Int = 0
    ) {
        self.roleID = roleID
        self.clientRoleID = clientRoleID
        self.name = name
        self.gender = gender
        self.avatarURL = avatarURL
        self.roleDescription = roleDescription
        self.hiddenSetting = hiddenSetting
        self.sortOrder = sortOrder
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        roleID = container.scriptString(for: .roleID)
            ?? container.scriptString(for: .id)
            ?? ""
        clientRoleID = container.scriptString(for: .clientRoleID)
        name = container.scriptString(for: .name) ?? ""
        gender = container.scriptString(for: .gender) ?? "unspecified"
        avatarURL = container.scriptString(for: .avatarURL)
            ?? container.scriptString(for: .avatar)
            ?? ""
        roleDescription = container.scriptString(for: .roleDescription)
            ?? container.scriptString(for: .publicDescription)
            ?? ""
        hiddenSetting = container.scriptString(for: .hiddenSetting)
        sortOrder = container.scriptInt(for: .sortOrder)
            ?? container.scriptInt(for: .order)
            ?? 0
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(roleID, forKey: .roleID)
        try container.encodeIfPresent(clientRoleID, forKey: .clientRoleID)
        try container.encode(name, forKey: .name)
        try container.encode(gender, forKey: .gender)
        try container.encode(avatarURL, forKey: .avatarURL)
        try container.encode(roleDescription, forKey: .roleDescription)
        try container.encodeIfPresent(hiddenSetting, forKey: .hiddenSetting)
        try container.encode(sortOrder, forKey: .sortOrder)
    }
}

struct InteractiveScript: Codable, Identifiable, Equatable {
    let scriptID: String
    let title: String
    let synopsis: String
    let coverURL: String
    let categoryIDs: [String]
    let visibility: ScriptVisibility
    let status: ScriptStatus
    let creator: ScriptCreator
    let roles: [ScriptRole]
    let worldSetting: String?
    let isAdminHidden: Bool
    let hiddenReason: String?
    let createdAt: String?
    let updatedAt: String?

    var id: String { scriptID }

    private enum CodingKeys: String, CodingKey {
        case scriptID = "script_id"
        case id
        case title
        case synopsis
        case intro
        case coverURL = "cover_url"
        case cover
        case categoryIDs = "category_ids"
        case categoryID = "category_id"
        case visibility
        case status
        case creator
        case author
        case roles
        case characters
        case worldSetting = "world_setting"
        case isAdminHidden = "is_admin_hidden"
        case hiddenReason = "hidden_reason"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    init(
        scriptID: String,
        title: String,
        synopsis: String,
        coverURL: String,
        categoryIDs: [String],
        visibility: ScriptVisibility,
        status: ScriptStatus,
        creator: ScriptCreator,
        roles: [ScriptRole],
        worldSetting: String? = nil,
        isAdminHidden: Bool = false,
        hiddenReason: String? = nil,
        createdAt: String? = nil,
        updatedAt: String? = nil
    ) {
        self.scriptID = scriptID
        self.title = title
        self.synopsis = synopsis
        self.coverURL = coverURL
        self.categoryIDs = categoryIDs
        self.visibility = visibility
        self.status = status
        self.creator = creator
        self.roles = roles
        self.worldSetting = worldSetting
        self.isAdminHidden = isAdminHidden
        self.hiddenReason = hiddenReason
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedScriptID = container.scriptString(for: .scriptID)
            ?? container.scriptString(for: .id)
            ?? ""
        guard !decodedScriptID.isBlank else {
            throw DecodingError.dataCorruptedError(
                forKey: .scriptID,
                in: container,
                debugDescription: "Interactive script is missing script_id"
            )
        }
        scriptID = decodedScriptID
        let decodedTitle = container.scriptString(for: .title) ?? ""
        guard !decodedTitle.isBlank else {
            throw DecodingError.dataCorruptedError(
                forKey: .title,
                in: container,
                debugDescription: "Interactive script is missing title"
            )
        }
        title = decodedTitle
        synopsis = container.scriptString(for: .synopsis)
            ?? container.scriptString(for: .intro)
            ?? ""
        coverURL = container.scriptString(for: .coverURL)
            ?? container.scriptString(for: .cover)
            ?? ""
        categoryIDs = container.scriptStringArray(for: .categoryIDs)
            ?? container.scriptString(for: .categoryID).map { [$0] }
            ?? []
        visibility = (try? container.decodeIfPresent(ScriptVisibility.self, forKey: .visibility))
            ?? .private
        status = (try? container.decodeIfPresent(ScriptStatus.self, forKey: .status))
            ?? .draft
        creator = (try? container.decodeIfPresent(ScriptCreator.self, forKey: .creator))
            ?? (try? container.decodeIfPresent(ScriptCreator.self, forKey: .author))
            ?? ScriptCreator()
        roles = (try? container.decodeIfPresent([ScriptRole].self, forKey: .roles))
            ?? (try? container.decodeIfPresent([ScriptRole].self, forKey: .characters))
            ?? []
        worldSetting = container.scriptString(for: .worldSetting)
        isAdminHidden = container.scriptBool(for: .isAdminHidden) ?? false
        hiddenReason = container.scriptString(for: .hiddenReason)
        createdAt = container.scriptString(for: .createdAt)
        updatedAt = container.scriptString(for: .updatedAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(scriptID, forKey: .scriptID)
        try container.encode(title, forKey: .title)
        try container.encode(synopsis, forKey: .synopsis)
        try container.encode(coverURL, forKey: .coverURL)
        try container.encode(categoryIDs, forKey: .categoryIDs)
        try container.encode(visibility, forKey: .visibility)
        try container.encode(status, forKey: .status)
        try container.encode(creator, forKey: .creator)
        try container.encode(roles, forKey: .roles)
        try container.encodeIfPresent(worldSetting, forKey: .worldSetting)
        try container.encode(isAdminHidden, forKey: .isAdminHidden)
        try container.encodeIfPresent(hiddenReason, forKey: .hiddenReason)
        try container.encodeIfPresent(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(updatedAt, forKey: .updatedAt)
    }

    func isOwned(by userID: String?) -> Bool {
        guard let userID, !userID.isEmpty else { return false }
        return creator.userID == userID
    }
}

struct ScriptPage: Codable, Equatable {
    let scripts: [InteractiveScript]
    let hasMore: Bool
    let nextCursor: String?

    private enum CodingKeys: String, CodingKey {
        case scripts
        case items
        case list
        case hasMore = "has_more"
        case nextCursor = "next_cursor"
        case cursor
    }

    init(scripts: [InteractiveScript], hasMore: Bool, nextCursor: String?) {
        self.scripts = scripts
        self.hasMore = hasMore
        self.nextCursor = nextCursor
    }

    init(from decoder: Decoder) throws {
        if let direct = try? [InteractiveScript](from: decoder) {
            scripts = direct
            hasMore = false
            nextCursor = nil
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.scripts) {
            scripts = try container.decode([InteractiveScript].self, forKey: .scripts)
        } else if container.contains(.items) {
            scripts = try container.decode([InteractiveScript].self, forKey: .items)
        } else if container.contains(.list) {
            scripts = try container.decode([InteractiveScript].self, forKey: .list)
        } else {
            throw DecodingError.keyNotFound(
                CodingKeys.scripts,
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Script page is missing scripts"
                )
            )
        }
        hasMore = container.scriptBool(for: .hasMore) ?? false
        nextCursor = container.scriptString(for: .nextCursor)
            ?? container.scriptString(for: .cursor)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(scripts, forKey: .scripts)
        try container.encode(hasMore, forKey: .hasMore)
        try container.encodeIfPresent(nextCursor, forKey: .nextCursor)
    }
}

struct ScriptSingleData: Decodable {
    let script: InteractiveScript

    private enum CodingKeys: String, CodingKey {
        case script
        case item
    }

    init(from decoder: Decoder) throws {
        if let direct = try? InteractiveScript(from: decoder), !direct.scriptID.isEmpty {
            script = direct
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let value = try? container.decode(InteractiveScript.self, forKey: .script) {
            script = value
        } else {
            script = try container.decode(InteractiveScript.self, forKey: .item)
        }
    }
}

struct ScriptAsset: Decodable, Equatable {
    let url: String
    let mimeType: String?
    let size: Int?

    private enum CodingKeys: String, CodingKey {
        case url
        case assetURL = "asset_url"
        case mimeType = "mime_type"
        case size
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        url = container.scriptString(for: .url)
            ?? container.scriptString(for: .assetURL)
            ?? ""
        mimeType = container.scriptString(for: .mimeType)
        size = container.scriptInt(for: .size)
    }
}

struct ScriptRoleAssignment: Codable, Equatable, Hashable {
    let roleID: String
    let actorType: ScriptActorType
    let userID: String?

    private enum CodingKeys: String, CodingKey {
        case roleID = "role_id"
        case actorType = "actor_type"
        case userID = "user_id"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        roleID = container.scriptString(for: .roleID) ?? ""
        actorType = (try? container.decodeIfPresent(ScriptActorType.self, forKey: .actorType)) ?? .ai
        userID = container.scriptString(for: .userID)
    }
}

struct ScriptRoomSnapshot: Codable, Equatable {
    let title: String
    let synopsis: String
    let coverURL: String
    let roles: [ScriptRole]

    private enum CodingKeys: String, CodingKey {
        case title
        case synopsis
        case intro
        case coverURL = "cover_url"
        case cover
        case roles
        case characters
    }

    init(title: String, synopsis: String, coverURL: String, roles: [ScriptRole]) {
        self.title = title
        self.synopsis = synopsis
        self.coverURL = coverURL
        self.roles = roles
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        title = container.scriptString(for: .title) ?? ""
        synopsis = container.scriptString(for: .synopsis)
            ?? container.scriptString(for: .intro)
            ?? ""
        coverURL = container.scriptString(for: .coverURL)
            ?? container.scriptString(for: .cover)
            ?? ""
        roles = (try? container.decodeIfPresent([ScriptRole].self, forKey: .roles))
            ?? (try? container.decodeIfPresent([ScriptRole].self, forKey: .characters))
            ?? []
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(title, forKey: .title)
        try container.encode(synopsis, forKey: .synopsis)
        try container.encode(coverURL, forKey: .coverURL)
        try container.encode(roles, forKey: .roles)
    }
}

struct ScriptRoom: Codable, Identifiable, Equatable {
    let roomID: String
    let scriptID: String
    let groupID: Int
    let status: ScriptRoomStatus
    let playerRoleID: String
    let assignments: [ScriptRoleAssignment]
    let scriptSnapshot: ScriptRoomSnapshot

    var id: String { roomID }

    private enum CodingKeys: String, CodingKey {
        case roomID = "room_id"
        case id
        case scriptID = "script_id"
        case groupID = "group_id"
        case status
        case playerRoleID = "player_role_id"
        case assignments
        case scriptSnapshot = "script_snapshot"
        case snapshot
    }

    init(
        roomID: String,
        scriptID: String,
        groupID: Int,
        status: ScriptRoomStatus,
        playerRoleID: String,
        assignments: [ScriptRoleAssignment],
        scriptSnapshot: ScriptRoomSnapshot
    ) {
        self.roomID = roomID
        self.scriptID = scriptID
        self.groupID = groupID
        self.status = status
        self.playerRoleID = playerRoleID
        self.assignments = assignments
        self.scriptSnapshot = scriptSnapshot
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        roomID = container.scriptString(for: .roomID)
            ?? container.scriptString(for: .id)
            ?? ""
        scriptID = container.scriptString(for: .scriptID) ?? ""
        groupID = container.scriptInt(for: .groupID) ?? 0
        status = (try? container.decodeIfPresent(ScriptRoomStatus.self, forKey: .status)) ?? .active
        playerRoleID = container.scriptString(for: .playerRoleID) ?? ""
        assignments = (try? container.decodeIfPresent([ScriptRoleAssignment].self, forKey: .assignments)) ?? []
        if container.contains(.scriptSnapshot) {
            scriptSnapshot = try container.decode(ScriptRoomSnapshot.self, forKey: .scriptSnapshot)
        } else {
            scriptSnapshot = try container.decode(ScriptRoomSnapshot.self, forKey: .snapshot)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(roomID, forKey: .roomID)
        try container.encode(scriptID, forKey: .scriptID)
        try container.encode(groupID, forKey: .groupID)
        try container.encode(status, forKey: .status)
        try container.encode(playerRoleID, forKey: .playerRoleID)
        try container.encode(assignments, forKey: .assignments)
        try container.encode(scriptSnapshot, forKey: .scriptSnapshot)
    }

    init?(provisionalConversationRow row: Conversation) {
        guard row.isScriptRoom,
              let roomID = row.scriptRoomID,
              !roomID.isBlank,
              let groupID = row.resolvedGroupID else { return nil }
        self.init(
            roomID: roomID,
            scriptID: row.scriptID ?? "",
            groupID: groupID,
            status: .active,
            playerRoleID: "",
            assignments: [],
            scriptSnapshot: ScriptRoomSnapshot(
                title: row.name,
                synopsis: "",
                coverURL: row.avatarURL,
                roles: []
            )
        )
    }
}

extension ScriptRoomSnapshot {
    static let empty = ScriptRoomSnapshot(title: "", synopsis: "", coverURL: "", roles: [])
}

struct ScriptRoomEnvelope: Decodable {
    let room: ScriptRoom

    private enum CodingKeys: String, CodingKey { case room }

    init(from decoder: Decoder) throws {
        if let direct = try? ScriptRoom(from: decoder), !direct.roomID.isEmpty {
            room = direct
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        room = try container.decode(ScriptRoom.self, forKey: .room)
    }
}

struct ScriptRoomCreationData: Decodable {
    let room: ScriptRoom
    let conversation: Conversation?

    private enum CodingKeys: String, CodingKey {
        case room
        case conversation
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        room = try container.decode(ScriptRoom.self, forKey: .room)
        conversation = try? container.decodeIfPresent(Conversation.self, forKey: .conversation)
    }
}

struct ScriptTurnResponse: Decodable, Equatable {
    let turnID: String
    let status: ScriptTurnStatus
    let userMessage: GroupMessage?
    let aiMessage: GroupMessage?

    private enum CodingKeys: String, CodingKey {
        case turnID = "turn_id"
        case status
        case userMessage = "user_message"
        case aiMessage = "ai_message"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        turnID = container.scriptString(for: .turnID) ?? ""
        status = (try? container.decodeIfPresent(ScriptTurnStatus.self, forKey: .status)) ?? .queued
        userMessage = try? container.decodeIfPresent(GroupMessage.self, forKey: .userMessage)
        aiMessage = try? container.decodeIfPresent(GroupMessage.self, forKey: .aiMessage)
    }
}

struct ScriptTurnState: Decodable, Equatable {
    let roomID: String
    let turnID: String
    let status: ScriptTurnStatus
    let errorCode: String?
    let message: String?

    private enum CodingKeys: String, CodingKey {
        case roomID = "room_id"
        case turnID = "turn_id"
        case status
        case errorCode = "error_code"
        case message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        roomID = container.scriptString(for: .roomID) ?? ""
        turnID = container.scriptString(for: .turnID) ?? ""
        status = (try? container.decodeIfPresent(ScriptTurnStatus.self, forKey: .status)) ?? .failed
        errorCode = container.scriptString(for: .errorCode)
        message = container.scriptString(for: .message)
    }
}

struct ScriptRoleDraft: Identifiable, Equatable {
    var id: String
    var serverRoleID: String?
    var name: String
    var gender: String
    var avatarURL: String
    var avatarData: Data?
    var roleDescription: String
    var hiddenSetting: String

    init(role: ScriptRole? = nil) {
        id = role?.clientRoleID ?? role?.roleID ?? UUID().uuidString
        serverRoleID = role?.roleID.isEmpty == false ? role?.roleID : nil
        name = role?.name ?? ""
        gender = role?.gender ?? "unspecified"
        avatarURL = role?.avatarURL ?? ""
        avatarData = nil
        roleDescription = role?.roleDescription ?? ""
        hiddenSetting = role?.hiddenSetting ?? ""
    }

    var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedDescription: String { roleDescription.trimmingCharacters(in: .whitespacesAndNewlines) }

    var requestBody: [String: Any] {
        var body: [String: Any] = [
            "client_role_id": id,
            "name": trimmedName,
            "gender": gender,
            "avatar_url": avatarURL,
            "description": trimmedDescription,
            "hidden_setting": hiddenSetting.trimmingCharacters(in: .whitespacesAndNewlines)
        ]
        if let serverRoleID, !serverRoleID.isEmpty {
            body["role_id"] = serverRoleID
        }
        return body
    }
}

struct ScriptDraft: Equatable {
    var title: String
    var synopsis: String
    var coverURL: String
    var coverData: Data?
    var categoryIDs: Set<String>
    var visibility: ScriptVisibility
    var worldSetting: String
    var roles: [ScriptRoleDraft]

    init(script: InteractiveScript? = nil) {
        title = script?.title ?? ""
        synopsis = script?.synopsis ?? ""
        coverURL = script?.coverURL ?? ""
        coverData = nil
        categoryIDs = Set(script?.categoryIDs ?? [])
        visibility = script?.visibility ?? .private
        worldSetting = script?.worldSetting ?? ""
        roles = (script?.roles ?? []).map(ScriptRoleDraft.init(role:))
    }

    var requestBody: [String: Any] {
        let serializedCategoryIDs: [Any] = categoryIDs.sorted().map { id in
            if let numericID = Int(id) { return numericID }
            return id
        }
        return [
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "synopsis": synopsis.trimmingCharacters(in: .whitespacesAndNewlines),
            "cover_url": coverURL,
            "category_ids": serializedCategoryIDs,
            "visibility": visibility.rawValue,
            "world_setting": worldSetting.trimmingCharacters(in: .whitespacesAndNewlines),
            "roles": roles.map(\.requestBody)
        ]
    }

    func validationMessages(requiresComplete: Bool) -> [String] {
        var messages: [String] = []
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSynopsis = synopsis.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedWorldSetting = worldSetting.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedTitle.count > 15 { messages.append("标题最多 15 个字符") }
        if trimmedSynopsis.count > 500 { messages.append("剧情简介最多 500 个字符") }
        if trimmedWorldSetting.count > 500 { messages.append("世界隐藏设定最多 500 个字符") }
        if roles.count > 12 { messages.append("角色最多 12 个") }

        if roles.contains(where: { !["female", "male"].contains($0.gender) }) {
            messages.append("请选择每个角色的性别")
        }
        if roles.contains(where: { $0.trimmedName.count > 8 }) {
            messages.append("角色名称最多 8 个字符")
        }
        if roles.contains(where: { $0.trimmedDescription.count > 100 }) {
            messages.append("角色公开描述最多 100 个字符")
        }
        if roles.contains(where: {
            $0.hiddenSetting.trimmingCharacters(in: .whitespacesAndNewlines).count > 500
        }) {
            messages.append("角色隐藏设定最多 500 个字符")
        }

        if requiresComplete {
            if trimmedTitle.count < 5 { messages.append("标题至少需要 5 个字符") }
            if trimmedSynopsis.count < 20 { messages.append("剧情简介至少需要 20 个字符") }
            if coverURL.isEmpty && coverData == nil { messages.append("请选择封面") }
            if categoryIDs.isEmpty { messages.append("请选择至少一个分类") }
            if roles.count < 2 { messages.append("至少需要两个角色") }
            for role in roles where role.trimmedName.isEmpty || role.trimmedDescription.isEmpty {
                messages.append("请补全所有角色的名称和公开描述")
                break
            }
            if roles.contains(where: { $0.avatarURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.avatarData == nil }) {
                messages.append("请为所有角色选择头像")
            }
            let normalizedRoleNames = roles.map {
                $0.trimmedName.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            }.filter { !$0.isEmpty }
            if Set(normalizedRoleNames).count != normalizedRoleNames.count {
                messages.append("角色名称不能重复")
            }
        }
        return messages
    }
}

private extension KeyedDecodingContainer {
    func scriptString(for key: Key) -> String? {
        if let value = try? decodeIfPresent(String.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return String(value) }
        return nil
    }

    func scriptInt(for key: Key) -> Int? {
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(String.self, forKey: key) { return Int(value) }
        return nil
    }

    func scriptBool(for key: Key) -> Bool? {
        if let value = try? decodeIfPresent(Bool.self, forKey: key) { return value }
        if let value = scriptInt(for: key) { return value != 0 }
        if let value = try? decodeIfPresent(String.self, forKey: key) {
            return ["true", "1", "yes"].contains(value.lowercased())
        }
        return nil
    }

    func scriptStringArray(for key: Key) -> [String]? {
        if let values = try? decodeIfPresent([String].self, forKey: key) { return values }
        if let values = try? decodeIfPresent([Int].self, forKey: key) { return values.map(String.init) }
        return nil
    }
}
