import XCTest
@testable import BBchat

@MainActor
final class StickerPickerTests: XCTestCase {
    func testEmojiDefaultDecodesWithSnakeCaseAndEmptyStickers() throws {
        let pack = try decodePack(#"""
        {
          "pack_id": "emoji_default",
          "pack_type": "emoji",
          "input_mode": "insert_text",
          "title": {"zh-Hans": "表情", "en": "Emoji", "ja": "絵文字"},
          "cover_emoji": "😀",
          "inserts_into_text": true,
          "send_as_sticker": false,
          "emoji_count": 57,
          "emojis": [{
            "emoji_id": "grinning_face",
            "emoji": "😀",
            "value": "fallback",
            "name": {"zh-Hans": "开心", "en": "Grinning"},
            "sort_order": 10
          }]
        }
        """#)

        XCTAssertEqual(pack.id, "emoji_default")
        XCTAssertTrue(pack.isEmojiInput)
        XCTAssertEqual(pack.coverEmoji, "😀")
        XCTAssertEqual(pack.emojiCount, 57)
        XCTAssertEqual(pack.emojis.first?.insertionValue, "😀")
        XCTAssertTrue(pack.stickers.isEmpty)
    }

    func testEmojiPackWithEmptyStickersRemainsVisibleAndFirst() throws {
        let packs = try decodePacks(#"""
        [
          {"pack_id":"bbcat_default","stickers":[{"sticker_id":"cat","asset_key":"stickers/cat"}]},
          {"pack_id":"emoji_default","enabled":true,"cover_emoji":"😀","emojis":[{"emoji_id":"grinning","emoji":"😀"}],"stickers":[]},
          {"pack_id":"quick_reactions_lite","stickers":[{"sticker_id":"ok","asset_key":"stickers/ok"}]},
          {"pack_id":"daily_status_lite","stickers":[{"sticker_id":"busy","asset_key":"stickers/busy"}]}
        ]
        """#)
        let config = AppRemoteConfig(configVersion: "2026.07.12.1", stickerPacks: packs)

        XCTAssertEqual(
            config.effectiveStickerPacks.map(\.id),
            ["emoji_default", "bbcat_default", "quick_reactions_lite", "daily_status_lite"]
        )
        XCTAssertTrue(config.effectiveStickerPacks.first?.stickers.isEmpty == true)
        XCTAssertEqual(config.effectiveStickerPacks.first?.coverEmoji, "😀")
    }

    func testOldThreePackConfigReceivesLocalEmojiFallback() throws {
        let packs = try decodePacks(#"""
        [
          {"pack_id":"bbcat_default","stickers":[{"sticker_id":"cat","asset_key":"stickers/cat"}]},
          {"pack_id":"quick_reactions_lite","stickers":[{"sticker_id":"ok","asset_key":"stickers/ok"}]},
          {"pack_id":"daily_status_lite","stickers":[{"sticker_id":"busy","asset_key":"stickers/busy"}]}
        ]
        """#)
        let config = AppRemoteConfig(configVersion: "2026.07.11.2", stickerPacks: packs)

        XCTAssertEqual(config.effectiveStickerPacks.first?.id, "emoji_default")
        XCTAssertEqual(config.effectiveStickerPacks.first?.coverEmoji, "😀")
        XCTAssertFalse(config.effectiveStickerPacks.first?.emojis.isEmpty ?? true)
    }

    func testEmojiSelectionInsertsAtCursorWithoutStickerSend() throws {
        let pack = try decodePack(#"{"pack_id":"emoji_default","pack_type":"emoji","emojis":[{"emoji_id":"grinning","emoji":"😀"}]}"#)
        let emoji = try XCTUnwrap(pack.emojis.first)
        var text = "AB"
        var selection = NSRange(location: 1, length: 0)
        var sendCount = 0

        pack.performPickerSelection(
            pack.pickerSelection(for: emoji),
            onInsertEmoji: { ComposerTextInsertion.insert($0, into: &text, selectedRange: &selection) },
            onSendSticker: { _, _ in sendCount += 1 }
        )

        XCTAssertEqual(text, "A😀B")
        XCTAssertEqual(sendCount, 0)
    }

    func testConsecutiveEmojiTapsAppendAtUpdatedCursor() throws {
        let pack = try decodePack(#"{"pack_id":"emoji_default","input_mode":"insert_text","emojis":[{"emoji_id":"grinning","value":"😀"}]}"#)
        let emoji = try XCTUnwrap(pack.emojis.first)
        var text = "Hi"
        var selection = NSRange(location: 2, length: 0)

        for _ in 0..<2 {
            pack.performPickerSelection(
                pack.pickerSelection(for: emoji),
                onInsertEmoji: { ComposerTextInsertion.insert($0, into: &text, selectedRange: &selection) },
                onSendSticker: { _, _ in XCTFail("Emoji must not use the sticker sender") }
            )
        }

        XCTAssertEqual(text, "Hi😀😀")
    }

    func testImageStickerStillUsesStickerSender() throws {
        let pack = try decodePack(#"{"pack_id":"cats","stickers":[{"sticker_id":"cat_hi","asset_key":"stickers/cat_hi"}]}"#)
        let sticker = try XCTUnwrap(pack.stickers.first)
        var insertedText: String?
        var sentStickerID: String?

        pack.performPickerSelection(
            pack.pickerSelection(for: sticker),
            onInsertEmoji: { insertedText = $0 },
            onSendSticker: { _, sticker in sentStickerID = sticker.id }
        )

        XCTAssertNil(insertedText)
        XCTAssertEqual(sentStickerID, "cat_hi")
    }

    func testDirectStickerKeepsTimelineIdentityWhenServerAcknowledgementOmitsClientID() {
        let clientID = UUID().uuidString
        let local = Message(
            id: Int.max / 4,
            senderID: "me",
            receiverID: "peer",
            msgType: "sticker",
            content: #"{"pack_id":"cats","sticker_id":"cat_hi"}"#,
            timestamp: "2026-08-05T12:00:00Z",
            replyToID: nil,
            replyTo: nil,
            clientMessageID: clientID
        )
        let server = Message(
            id: 42,
            senderID: "me",
            receiverID: "peer",
            msgType: "sticker",
            content: local.content,
            timestamp: "2026-08-05T12:00:01Z",
            replyToID: nil,
            replyTo: nil
        )

        let acknowledged = server.inheritingClientMessageID(local.clientMessageID)

        XCTAssertEqual(acknowledged.id, 42)
        XCTAssertEqual(acknowledged.clientMessageID, clientID)
        XCTAssertEqual(
            ChatTimelineIdentity.value(
                clientMessageID: local.clientMessageID,
                serverID: local.id
            ),
            ChatTimelineIdentity.value(
                clientMessageID: acknowledged.clientMessageID,
                serverID: acknowledged.id
            )
        )
    }

    func testGroupStickerKeepsTimelineIdentityAcrossWebSocketAndHTTPConfirmation() {
        let clientID = UUID().uuidString
        let webSocketMessage = GroupMessage(
            id: 84,
            groupID: 7,
            senderID: "me",
            msgType: "sticker",
            content: #"{"pack_id":"cats","sticker_id":"cat_hi"}"#,
            timestamp: "2026-08-05T12:00:01Z",
            senderNickname: "Me",
            senderAvatar: "",
            replyToID: nil,
            replyTo: nil,
            mentions: nil
        )

        let acknowledged = webSocketMessage.inheritingClientMessageID(clientID)

        XCTAssertEqual(acknowledged.clientMessageID, clientID)
        XCTAssertEqual(
            ChatTimelineIdentity.value(clientMessageID: clientID, serverID: Int.max / 4),
            ChatTimelineIdentity.value(
                clientMessageID: acknowledged.clientMessageID,
                serverID: acknowledged.id
            )
        )
    }

    func testAllChatComposersUseIdenticalInsertionBehavior() {
        var directText = "Direct"
        var directRange = NSRange(location: 6, length: 0)
        var groupText = "Direct"
        var groupRange = NSRange(location: 6, length: 0)
        var botText = "Direct"
        var botRange = NSRange(location: 6, length: 0)

        ComposerTextInsertion.insert("😀", into: &directText, selectedRange: &directRange)
        ComposerTextInsertion.insert("😀", into: &groupText, selectedRange: &groupRange)
        ComposerTextInsertion.insert("😀", into: &botText, selectedRange: &botRange)

        XCTAssertEqual(directText, groupText)
        XCTAssertEqual(directRange, groupRange)
        XCTAssertEqual(directText, botText)
        XCTAssertEqual(directRange, botRange)
    }

    func testMentionInsertionUsesUTF16OffsetsAfterEmoji() {
        let source = ComposerDocument(text: "😀 hi @", mentions: [])
        let trigger = NSRange(location: ("😀 hi " as NSString).length, length: 1)

        let result = MentionTextEditing.inserting(
            [MentionSelection(userID: "u007", nickname: "Oscar", kind: .direct)],
            replacing: trigger,
            in: source,
            selectedRange: NSRange(location: (source.text as NSString).length, length: 0)
        )

        XCTAssertEqual(result.document.text, "😀 hi @Oscar ")
        XCTAssertEqual(result.document.mentions, [
            MentionSpan(
                userID: "u007",
                kind: .direct,
                locationUTF16: ("😀 hi " as NSString).length,
                lengthUTF16: ("@Oscar" as NSString).length
            )
        ])
        XCTAssertEqual(result.selectedRange.location, (result.document.text as NSString).length)
    }

    func testBackspaceAfterMentionRemovesWholeAtomicTokenAndSeparator() {
        let source = ComposerDocument(
            text: "Hello @Oscar world",
            mentions: [MentionSpan(userID: "u007", kind: .direct, locationUTF16: 6, lengthUTF16: 6)]
        )

        let result = MentionTextEditing.applyingUserEdit(
            range: NSRange(location: 12, length: 1),
            replacementText: "",
            to: source
        )

        XCTAssertTrue(result.handledAtomically)
        XCTAssertEqual(result.document.text, "Hello world")
        XCTAssertTrue(result.document.mentions.isEmpty)
        XCTAssertEqual(result.selectedRange.location, 6)
    }

    func testStandaloneAtDoesNotTriggerInsideEmail() {
        XCTAssertTrue(MentionTextEditing.isStandaloneAtInsertion(
            text: "hello ",
            range: NSRange(location: 6, length: 0),
            replacement: "@"
        ))
        XCTAssertFalse(MentionTextEditing.isStandaloneAtInsertion(
            text: "a",
            range: NSRange(location: 1, length: 0),
            replacement: "@"
        ))
    }

    func testComposerDocumentDerivesUniqueMentionRecipients() {
        let document = ComposerDocument(
            text: "@A @B @A ",
            mentions: [
                MentionSpan(userID: "u1", kind: .direct, locationUTF16: 0, lengthUTF16: 2),
                MentionSpan(userID: "u2", kind: .direct, locationUTF16: 3, lengthUTF16: 2),
                MentionSpan(userID: "u1", kind: .direct, locationUTF16: 6, lengthUTF16: 2),
                MentionSpan(userID: nil, kind: .all, locationUTF16: 9, lengthUTF16: 4)
            ]
        )

        XCTAssertEqual(document.mentionedUserIDs, ["u1", "u2"])
        XCTAssertTrue(document.mentionsAll)
    }

    func testMentionMemberResolverExcludesSelfDeduplicatesAndUsesStableFallbacks() throws {
        let members = [
            GroupMember(userID: "me", nickname: "Me", avatarURL: "me.png", role: "owner"),
            GroupMember(userID: "u2", nickname: " ", avatarURL: "u2.png", role: "member"),
            GroupMember(userID: "u1", nickname: "Alice", avatarURL: "", role: "member"),
            GroupMember(userID: "u2", nickname: "Zed", avatarURL: "", role: "admin"),
            GroupMember(userID: " ", nickname: "Invalid", avatarURL: "", role: "member")
        ]

        let result = MentionMemberResolver.visibleMembers(from: members, excludingUserID: "me")

        XCTAssertEqual(result.map(\.userID), ["u1", "u2"])
        XCTAssertEqual(result.map(\.nickname), ["Alice", "Zed"])
        let merged = try XCTUnwrap(result.first(where: { $0.userID == "u2" }))
        XCTAssertEqual(merged.avatarURL, "u2.png")
        XCTAssertEqual(merged.role, "admin")
    }

    func testGroupDetailMentionContractDecodesRequiredMemberFields() throws {
        let data = Data(#"""
        {
          "code": 0,
          "message": "ok",
          "data": {
            "group_id": 42,
            "name": "测试群",
            "avatar_url": "https://example.com/group.png",
            "creator_id": "owner-1",
            "is_public": false,
            "members": [{
              "user_id": "member-1",
              "nickname": "群成员",
              "avatar_url": "https://example.com/member.png",
              "role": "member"
            }]
          }
        }
        """#.utf8)

        let response = try JSONDecoder().decode(APIResponseWrapper<GroupDetail>.self, from: data)
        let detail = try XCTUnwrap(response.data)

        XCTAssertEqual(response.code, 0)
        XCTAssertEqual(detail.groupID, 42)
        XCTAssertEqual(detail.members.first?.userID, "member-1")
        XCTAssertEqual(detail.members.first?.nickname, "群成员")
    }

    func testMessageSelectionCapsAt99AndKeepsTimelineOrdering() {
        var state = MessageSelectionState()
        let conversation = ConversationRef.direct(userID: "peer")
        for id in (1...99).reversed() {
            let reference = MessageRef(accountID: "owner", conversation: conversation, messageID: id)
            XCTAssertTrue(state.toggle(reference, descriptor: MessageSelectionDescriptor(
                timestamp: Date(timeIntervalSince1970: TimeInterval(id)),
                messageType: "text",
                canForwardIndividually: true,
                canMerge: true,
                canDelete: true
            )))
        }

        let hundredth = MessageRef(accountID: "owner", conversation: conversation, messageID: 100)
        XCTAssertFalse(state.toggle(hundredth, descriptor: MessageSelectionDescriptor(
            timestamp: Date(timeIntervalSince1970: 100),
            messageType: "text",
            canForwardIndividually: true,
            canMerge: true,
            canDelete: true
        )))
        XCTAssertEqual(state.selected.count, 99)
        XCTAssertEqual(state.orderedSelection.map(\.messageID), Array(1...99))
    }

    func testForwardRequestUsesStableSnakeCaseWireContract() throws {
        let operationID = UUID(uuidString: "00000000-0000-0000-0000-000000000007")!
        let request = ForwardRequest(
            clientOperationID: operationID,
            mode: .merged,
            sources: [ForwardMessageSource(
                conversationType: .group,
                conversationID: "42",
                messageID: 987,
                expectedVersion: 2
            )],
            targets: [ForwardTarget(
                conversationType: .dm,
                conversationID: "u007",
                displayName: "Oscar",
                avatarURL: "/avatar.jpg"
            )]
        )

        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any])
        XCTAssertEqual(object["client_operation_id"] as? String, operationID.uuidString)
        XCTAssertEqual(object["mode"] as? String, "merged")
        let source = try XCTUnwrap((object["sources"] as? [[String: Any]])?.first)
        XCTAssertEqual(source["conversation_type"] as? String, "group")
        XCTAssertEqual(source["conversation_id"] as? String, "42")
        XCTAssertEqual(source["message_id"] as? Int, 987)
        XCTAssertEqual(source["expected_version"] as? Int, 2)
        let target = try XCTUnwrap((object["targets"] as? [[String: Any]])?.first)
        XCTAssertEqual(Set(target.keys), ["conversation_type", "conversation_id"])
    }

    private func decodePack(_ json: String) throws -> StickerPack {
        try JSONDecoder().decode(StickerPack.self, from: Data(json.utf8))
    }

    private func decodePacks(_ json: String) throws -> [StickerPack] {
        try JSONDecoder().decode([StickerPack].self, from: Data(json.utf8))
    }
}
