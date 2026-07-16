import XCTest
@testable import BBchat

final class InteractiveScriptContractTests: XCTestCase {
    func testDiscoverKeepsExistingEntriesAndReusesStoriesAsScriptEntry() throws {
        let items = DiscoverConfigData.defaultSections.flatMap(\.items)

        XCTAssertEqual(
            items.map(\.id),
            ["moments", "games", "short_drama", "live", "stories", "groups", "benefits"]
        )
        XCTAssertFalse(items.contains { $0.id == "script_center" })

        let stories = try XCTUnwrap(items.first { $0.id == "stories" })
        XCTAssertEqual(stories.route?.normalizedType, "native")
        XCTAssertEqual(stories.route?.name, "script_center")
    }

    func testEmptyRemoteDiscoverConfigDoesNotSynthesizeScriptOnlySection() {
        let config = DiscoverConfigData(sections: [])

        XCTAssertTrue(config.effectiveSections.isEmpty)
    }

    func testLegacyConversationStillDecodesWithoutScriptMetadata() throws {
        let json = #"{"type":"group","id":"42","name":"普通群聊","group_id":42,"unread_count":0}"#.data(using: .utf8)!

        let conversation = try JSONDecoder().decode(Conversation.self, from: json)

        XCTAssertTrue(conversation.isGroup)
        XCTAssertFalse(conversation.isScriptRoom)
        XCTAssertNil(conversation.scriptRoomID)
    }

    func testScriptConversationDecodesRoutingMetadata() throws {
        let json = #"{"type":"group","id":"901","name":"失落星港","group_id":901,"conversation_kind":"script_room","script_room_id":"room_1","script_id":"sc_123"}"#.data(using: .utf8)!

        let conversation = try JSONDecoder().decode(Conversation.self, from: json)

        XCTAssertTrue(conversation.isScriptRoom)
        XCTAssertEqual(conversation.scriptRoomID, "room_1")
        XCTAssertEqual(conversation.scriptID, "sc_123")
    }

    func testScriptConversationCanReplaceGroupAvatarWithSnapshotCover() throws {
        let json = #"{"type":"group","id":"901","name":"失落星港","avatar_url":"/default-group.png","group_id":901,"conversation_kind":"script_room","script_room_id":"room_1","script_id":"sc_123"}"#.data(using: .utf8)!
        let conversation = try JSONDecoder().decode(Conversation.self, from: json)

        let resolved = conversation.replacingAvatarURL("https://cdn.example/scripts/cover.webp")

        XCTAssertTrue(resolved.isScriptRoom)
        XCTAssertEqual(resolved.avatarURL, "https://cdn.example/scripts/cover.webp")
        XCTAssertEqual(resolved.scriptRoomID, "room_1")
        XCTAssertEqual(resolved.groupID, 901)
    }

    func testLegacyGroupMessageDecodesWithoutScriptContext() throws {
        let json = #"{"id":1,"group_id":42,"sender_id":"u1","msg_type":"text","content":"hello","timestamp":"2026-07-15T10:00:00Z"}"#.data(using: .utf8)!

        let message = try JSONDecoder().decode(GroupMessage.self, from: json)

        XCTAssertNil(message.scriptContext)
        XCTAssertEqual(message.content, "hello")
    }

    func testScriptGroupMessageDecodesActorIdentity() throws {
        let json = #"{"id":2,"group_id":901,"sender_id":"system","msg_type":"text","content":"别动。","timestamp":"2026-07-15T10:00:01Z","script_context":{"room_id":"room_1","role_id":"sr_2","actor_type":"ai","turn_id":"turn_1"}}"#.data(using: .utf8)!

        let message = try JSONDecoder().decode(GroupMessage.self, from: json)

        XCTAssertEqual(message.scriptContext?.roomID, "room_1")
        XCTAssertEqual(message.scriptContext?.roleID, "sr_2")
        XCTAssertEqual(message.scriptContext?.actorType, .ai)
        XCTAssertEqual(message.scriptContext?.turnID, "turn_1")
    }

    func testScriptPageAcceptsNumericCategoryAndRoleIDs() throws {
        let json = #"{"scripts":[{"script_id":123,"title":"失落星港","synopsis":"这是一段足够长的测试剧情简介。","cover_url":"https://cdn.example/cover.jpg","category_ids":[3,8],"visibility":"public","status":"ready","creator":{"user_id":"u1","nickname":"作者"},"roles":[{"role_id":1,"name":"林夏","gender":"female","avatar_url":"https://cdn.example/a.jpg","description":"舰桥工程师"},{"role_id":2,"name":"顾言","gender":"male","avatar_url":"https://cdn.example/b.jpg","description":"失踪的领航员"}]}],"has_more":true,"next_cursor":"next"}"#.data(using: .utf8)!

        let page = try JSONDecoder().decode(ScriptPage.self, from: json)

        XCTAssertEqual(page.scripts.first?.scriptID, "123")
        XCTAssertEqual(page.scripts.first?.categoryIDs, ["3", "8"])
        XCTAssertEqual(page.scripts.first?.roles.map(\.roleID), ["1", "2"])
        XCTAssertTrue(page.hasMore)
    }

    func testPublicScriptEnvelopeDecodesCoverAndThreeRoleAvatars() throws {
        let json = #"{"code":0,"message":"success","data":{"scripts":[{"script_id":"sc_metro","title":"零点地铁终点站","synopsis":"午夜末班车驶入不存在的终点站。","cover_url":"https://d3rijhu8azna1i.cloudfront.net/bwchat/prod/images/scripts/cover-metro-v1.webp","category_ids":[1,2],"visibility":"public","status":"ready","creator":{"user_id":"u004","nickname":"Simple","avatar_url":"avatars/u004.jpg"},"roles":[{"role_id":"sr_1","name":"沈知夏","gender":"female","avatar_url":"https://cdn.example/role-1.webp","description":"医生"},{"role_id":"sr_2","name":"陆沉舟","gender":"male","avatar_url":"https://cdn.example/role-2.webp","description":"检修员"},{"role_id":"sr_3","name":"苏小满","gender":"female","avatar_url":"https://cdn.example/role-3.webp","description":"学生"}]}],"has_more":false,"next_cursor":null}}"#.data(using: .utf8)!

        let response = try JSONDecoder().decode(APIResponseWrapper<ScriptPage>.self, from: json)
        let page = try response.requiredData()

        XCTAssertEqual(page.scripts.count, 1)
        XCTAssertEqual(
            page.scripts[0].coverURL,
            "https://d3rijhu8azna1i.cloudfront.net/bwchat/prod/images/scripts/cover-metro-v1.webp"
        )
        XCTAssertEqual(page.scripts[0].roles.count, 3)
        XCTAssertEqual(page.scripts[0].roles.map(\.avatarURL), [
            "https://cdn.example/role-1.webp",
            "https://cdn.example/role-2.webp",
            "https://cdn.example/role-3.webp"
        ])
    }

    func testMediaURLResolverPreservesAbsoluteAndResolvesRelativePaths() throws {
        let baseURL = "https://api.example.com/api/v1"
        let cdnURL = "https://cdn.example.com/scripts/cover.webp"

        XCTAssertEqual(MediaURLResolver.resolve(cdnURL, apiBaseURL: baseURL)?.absoluteString, cdnURL)
        XCTAssertEqual(
            MediaURLResolver.resolve("/api/v1/images/cover.webp", apiBaseURL: baseURL)?.absoluteString,
            "https://api.example.com/api/v1/images/cover.webp"
        )
        XCTAssertEqual(
            MediaURLResolver.resolve("avatars/u004.jpg", apiBaseURL: baseURL)?.absoluteString,
            "https://api.example.com/api/v1/avatars/u004.jpg"
        )
        XCTAssertNil(MediaURLResolver.resolve("  ", apiBaseURL: baseURL))
        XCTAssertFalse(
            try XCTUnwrap(MediaURLResolver.resolve(cdnURL, apiBaseURL: baseURL)?.absoluteString)
                .contains("api.example.com/api/v1/https")
        )
    }

    func testScriptImageFallbackOnlyAppearsForMissingInvalidOrFailedURLs() {
        let baseURL = "https://api.example.com/api/v1"

        XCTAssertFalse(ScriptRemoteImage.shouldShowFallback(
            urlString: "https://cdn.example.com/cover.webp",
            didFail: false,
            apiBaseURL: baseURL
        ))
        XCTAssertTrue(ScriptRemoteImage.shouldShowFallback(
            urlString: "",
            didFail: false,
            apiBaseURL: baseURL
        ))
        XCTAssertTrue(ScriptRemoteImage.shouldShowFallback(
            urlString: "https://cdn.example.com/cover.webp",
            didFail: true,
            apiBaseURL: baseURL
        ))
    }

    func testRoomSnapshotAndWebSocketAvatarMapping() throws {
        let roomJSON = #"{"room_id":"room_1","script_id":"sc_1","group_id":901,"status":"active","player_role_id":"sr_player","assignments":[],"script_snapshot":{"title":"零点地铁终点站","synopsis":"午夜末班车。","cover_url":"https://cdn.example/cover.webp","roles":[{"role_id":"sr_ai","name":"陆沉舟","gender":"male","avatar_url":"https://cdn.example/snapshot-role.webp","description":"检修员"}]}}"#.data(using: .utf8)!
        let messageJSON = #"{"id":2,"group_id":901,"sender_id":"script-role:sr_ai","sender_nickname":"陆沉舟","sender_avatar":"https://cdn.example/message-role.webp","msg_type":"text","content":"别动。","timestamp":"2026-07-15T10:00:01Z","script_context":{"room_id":"room_1","role_id":"sr_ai","actor_type":"ai","turn_id":"turn_1"}}"#.data(using: .utf8)!

        let room = try JSONDecoder().decode(ScriptRoom.self, from: roomJSON)
        let message = try JSONDecoder().decode(GroupMessage.self, from: messageJSON)

        XCTAssertEqual(room.scriptSnapshot.coverURL, "https://cdn.example/cover.webp")
        XCTAssertEqual(room.scriptSnapshot.roles.first?.avatarURL, "https://cdn.example/snapshot-role.webp")
        XCTAssertEqual(message.senderAvatar, "https://cdn.example/message-role.webp")
        XCTAssertEqual(message.scriptContext?.roleID, "sr_ai")
    }

    func testScriptPageRoundTripsThroughPersistentCacheEncoding() throws {
        let role = ScriptRole(
            roleID: "role_1",
            name: "林夏",
            gender: "female",
            avatarURL: "https://cdn.example/role.jpg",
            roleDescription: "星舰工程师",
            hiddenSetting: "害怕返回母星"
        )
        let script = InteractiveScript(
            scriptID: "script_1",
            title: "失落星港",
            synopsis: "两名船员抵达失联多年的星港。",
            coverURL: "https://cdn.example/cover.jpg",
            categoryIDs: ["science_fiction"],
            visibility: .private,
            status: .ready,
            creator: ScriptCreator(userID: "user_1", nickname: "作者"),
            roles: [role],
            worldSetting: "星港由失控中枢管理",
            updatedAt: "2026-07-15T10:00:00Z"
        )
        let page = ScriptPage(scripts: [script], hasMore: true, nextCursor: "next")

        let encoded = try JSONEncoder().encode(page)
        let decoded = try JSONDecoder().decode(ScriptPage.self, from: encoded)

        XCTAssertEqual(decoded, page)
    }

    func testPublicDraftValidationRequiresCompleteFields() {
        var draft = ScriptDraft()
        draft.visibility = .public

        let messages = draft.validationMessages(requiresComplete: true)

        XCTAssertFalse(messages.isEmpty)
        XCTAssertTrue(messages.contains("至少需要两个角色"))
    }

    func testPublicDraftValidationRejectsMissingAvatarAndDuplicateRoleNames() {
        var firstRole = ScriptRoleDraft()
        firstRole.name = "林夏"
        firstRole.roleDescription = "负责维护星舰动力系统的工程师"

        var secondRole = ScriptRoleDraft()
        secondRole.name = "林夏"
        secondRole.roleDescription = "负责星图导航和航线规划的领航员"

        var draft = ScriptDraft()
        draft.title = "失落星港"
        draft.synopsis = "两名船员抵达一座失联多年的星港，并尝试找出这里发生过什么。"
        draft.coverURL = "https://cdn.example/cover.jpg"
        draft.categoryIDs = ["science_fiction"]
        draft.visibility = .public
        draft.roles = [firstRole, secondRole]

        let messages = draft.validationMessages(requiresComplete: true)

        XCTAssertTrue(messages.contains("请为所有角色选择头像"))
        XCTAssertTrue(messages.contains("角色名称不能重复"))
    }
}
