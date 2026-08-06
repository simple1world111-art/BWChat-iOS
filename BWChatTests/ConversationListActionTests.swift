import XCTest
@testable import BBchat

@MainActor
final class ConversationListActionTests: XCTestCase {
    func testUnconfirmedEmptyConversationSnapshotCannotEraseLocalRows() {
        let unconfirmed = ConversationSyncSnapshot(
            conversations: [],
            revision: 8,
            snapshotComplete: nil
        )
        let confirmed = ConversationSyncSnapshot(
            conversations: [],
            revision: 8,
            snapshotComplete: true
        )

        XCTAssertFalse(ConversationSnapshotReplacementPolicy.shouldAccept(
            unconfirmed,
            replacingLocalCount: 4,
            lastAcceptedRevision: 7
        ))
        XCTAssertTrue(ConversationSnapshotReplacementPolicy.shouldAccept(
            confirmed,
            replacingLocalCount: 4,
            lastAcceptedRevision: 7
        ))
        XCTAssertTrue(ConversationSnapshotReplacementPolicy.shouldAccept(
            unconfirmed,
            replacingLocalCount: 0,
            lastAcceptedRevision: nil
        ))
    }

    func testConversationSnapshotRejectsRevisionRegression() {
        let stale = ConversationSyncSnapshot(
            conversations: [],
            revision: 4,
            snapshotComplete: true
        )
        XCTAssertFalse(ConversationSnapshotReplacementPolicy.shouldAccept(
            stale,
            replacingLocalCount: 0,
            lastAcceptedRevision: 5
        ))
    }

    func testOfflineCacheCannotRemoveMessageStoreRowsMissingFromSnapshot() {
        let local = Conversation(
            type: "dm",
            id: "offline-peer",
            name: "Offline Peer",
            avatarURL: "",
            lastMessage: "cached message",
            lastMessageTime: "2026-08-05T10:00:00Z",
            unreadCount: 0,
            subtitle: nil,
            groupID: nil,
            memberCount: nil
        )

        let result = ConversationListViewModel.preservingLiveChatRows(
            cachedRows: [],
            liveRows: [local]
        )

        XCTAssertEqual(result, [local])
    }

    func testNotificationRouteParsesEverySupportedContainer() throws {
        let routeFields: [String: Any] = [
            "push_type": "group_message",
            "event_id": "event-1",
            "conversation_type": "group",
            "conversation_id": "42",
            "group_id": 42,
            "message_id": 987,
            "conversation_revision": 123_450,
            "unread_count": 3,
            "total_unread_count": 7
        ]

        let topLevel = try XCTUnwrap(NotificationRoute.parse(routeFields))
        let data = try XCTUnwrap(NotificationRoute.parse(["data": routeFields]))
        let payload = try XCTUnwrap(NotificationRoute.parse(["payload": routeFields]))
        let jsonData = try JSONSerialization.data(withJSONObject: routeFields)
        let jsonString = try XCTUnwrap(String(data: jsonData, encoding: .utf8))
        let notificationData = try XCTUnwrap(NotificationRoute.parse([
            "notification_data": jsonString
        ]))

        for route in [topLevel, data, payload, notificationData] {
            XCTAssertEqual(route.eventID, "group:42:message:987")
            XCTAssertEqual(route.conversationType, .group)
            XCTAssertEqual(route.groupID, 42)
            XCTAssertEqual(route.messageID, 987)
            XCTAssertEqual(route.conversationRevision, 123_450)
            XCTAssertEqual(route.unreadCount, 3)
            XCTAssertEqual(route.totalUnreadCount, 7)
        }
    }

    func testConversationRevisionAndReadThroughDecode() throws {
        let data = Data("""
        {
          "type": "dm",
          "id": "peer-1",
          "name": "Peer",
          "avatar_url": "",
          "unread_count": 1,
          "last_message_id": 99,
          "read_through_message_id": 98,
          "revision": 123456
        }
        """.utf8)

        let conversation = try JSONDecoder().decode(Conversation.self, from: data)
        XCTAssertEqual(conversation.lastMessageID, 99)
        XCTAssertEqual(conversation.readThroughMessageID, 98)
        XCTAssertEqual(conversation.revision, 123_456)
    }

    func testTimelineLinearMergePreservesStableChronologicalOrder() {
        let merged = ChatTimelineOrdering.merge(
            [("m1", 1), ("m3", 3)],
            [("p2", 2), ("p4", 4)]
        ) { $0.1 < $1.1 }

        XCTAssertEqual(merged.map { $0.0 }, ["m1", "p2", "m3", "p4"])
    }

    func testTimelineOrderingKeepsFailedMessageAtOriginalPosition() {
        let failedAt = Date(timeIntervalSince1970: 200)
        let newerMessageAt = Date(timeIntervalSince1970: 300)

        XCTAssertTrue(ChatTimelineOrdering.precedes(
            date: failedAt,
            stableID: "client:failed",
            date: newerMessageAt,
            stableID: "server:newer"
        ))
        XCTAssertFalse(ChatTimelineOrdering.precedes(
            date: newerMessageAt,
            stableID: "server:newer",
            date: failedAt,
            stableID: "client:failed"
        ))
    }

    func testPendingMessageMenuIncludesRetryActionMetadata() {
        XCTAssertEqual(MessageMenuAction.retry.title, L10n.tr("common.retry"))
        XCTAssertEqual(MessageMenuAction.retry.systemImage, "arrow.clockwise")
    }

    func testAgentConversationBecomesDistinctMessageListRow() throws {
        let data = Data("""
        {
          "id": "agent-conversation-1",
          "title": "开始聊天",
          "status": "active",
          "agent_id": "agent-1",
          "agent_version_id": "version-1",
          "agent_profile": {
            "name": "小白",
            "avatar_asset_id": "avatar-1"
          },
          "agent_capabilities": {
            "paid_images": false,
            "paid_videos": false
          },
          "latest_message": null,
          "created_at": "2026-07-15T10:00:00Z",
          "updated_at": "2026-07-15T10:01:00Z"
        }
        """.utf8)

        let remote = try JSONDecoder().decode(AgentConversation.self, from: data)
        let row = Conversation(agentConversation: remote)

        XCTAssertTrue(row.isAgentConversation)
        XCTAssertFalse(row.isDM)
        XCTAssertEqual(row.listIdentity, "agent:agent-conversation-1")
        XCTAssertEqual(row.name, "小白")
        XCTAssertEqual(row.agentAvatarAssetID, "avatar-1")
    }

    func testAgentConversationPreviewPrefersCompletedImageOverProcessingText() throws {
        let data = Data(#"""
        {
          "id": "agent-conversation-image",
          "title": "图片助手",
          "status": "active",
          "agent_id": "agent-image",
          "agent_version_id": "version-image",
          "agent_profile": { "name": "图片助手" },
          "agent_capabilities": { "paid_images": true, "paid_videos": false },
          "latest_message": {
            "id": "message-image",
            "conversation_id": "agent-conversation-image",
            "sequence_no": 9,
            "sender": { "type": "agent", "id": "agent-image" },
            "source": "turn",
            "status": "completed",
            "created_at": "2026-07-22T10:00:00Z",
            "updated_at": "2026-07-22T10:01:00Z",
            "parts": [
              {
                "id": "part-processing",
                "ordinal": 0,
                "type": "text",
                "text": "正在按你的要求处理这张图片"
              },
              {
                "id": "part-image",
                "ordinal": 1,
                "type": "paid_media",
                "reference_id": "media-image",
                "metadata": {
                  "media_type": "image",
                  "generation_status": "ready_locked",
                  "access": "locked",
                  "preview_url": "/agent-media/media-image/preview"
                }
              }
            ]
          },
          "created_at": "2026-07-22T09:00:00Z",
          "updated_at": "2026-07-22T10:01:00Z"
        }
        """#.utf8)

        let remote = try JSONDecoder().decode(AgentConversation.self, from: data)
        let row = Conversation(agentConversation: remote)

        XCTAssertEqual(row.lastMessage, L10n.tr("message.image"))
    }

    func testCreatedAgentWithoutConversationStillGetsMessageListRow() throws {
        let data = Data("""
        {
          "id": "agent-2",
          "is_owner": true,
          "profile": {
            "name": "小黑",
            "tagline": "陪你聊天",
            "avatar_asset_id": "avatar-2"
          },
          "greetings": [
            { "id": "greeting-2", "text": "你好" }
          ]
        }
        """.utf8)

        let agent = try JSONDecoder().decode(AgentSummary.self, from: data)
        let row = Conversation(createdAgent: agent)

        XCTAssertTrue(row.isAgentConversation)
        XCTAssertEqual(row.listIdentity, "agent-profile:agent-2")
        XCTAssertEqual(row.agentID, "agent-2")
        XCTAssertEqual(row.agentGreetingID, "greeting-2")
        XCTAssertEqual(row.lastMessage, "陪你聊天")
    }

    func testFailedAgentRefreshPreservesLiveAgentRows() {
        let thread = makeAgentRow(
            id: "agent-conversation-live",
            agentID: "agent-live",
            conversationKind: "agent_conversation",
            agentConversationID: "agent-conversation-live"
        )
        let profile = makeAgentRow(
            id: "agent-profile-live",
            agentID: "agent-profile-live",
            conversationKind: "agent_profile"
        )

        let rows = ConversationListViewModel.reconciledAgentRows(
            liveConversations: [thread, profile],
            fetchedConversationRows: nil,
            fetchedInstalledRows: nil
        )

        XCTAssertEqual(
            Set(rows.map(\.listIdentity)),
            Set([thread.listIdentity, profile.listIdentity])
        )
    }

    func testSuccessfulEmptyAgentRefreshRemovesLiveAgentRows() {
        let thread = makeAgentRow(
            id: "agent-conversation-removed",
            agentID: "agent-removed",
            conversationKind: "agent_conversation",
            agentConversationID: "agent-conversation-removed"
        )

        let rows = ConversationListViewModel.reconciledAgentRows(
            liveConversations: [thread],
            fetchedConversationRows: [],
            fetchedInstalledRows: []
        )

        XCTAssertTrue(rows.isEmpty)
    }

    func testFreshAgentConversationSuppressesMatchingProfileCard() {
        let profile = makeAgentRow(
            id: "agent-duplicate",
            agentID: "agent-duplicate",
            conversationKind: "agent_profile"
        )
        let thread = makeAgentRow(
            id: "agent-conversation-fresh",
            agentID: "agent-duplicate",
            conversationKind: "agent_conversation",
            agentConversationID: "agent-conversation-fresh"
        )

        let rows = ConversationListViewModel.reconciledAgentRows(
            liveConversations: [profile],
            fetchedConversationRows: [thread],
            fetchedInstalledRows: [profile]
        )

        XCTAssertEqual(rows.map(\.listIdentity), [thread.listIdentity])
    }

    func testLegacyCachedAgentThreadKeepsConversationIdentity() {
        let legacyThread = makeAgentRow(
            id: "legacy-agent-conversation",
            agentID: nil,
            conversationKind: "agent_conversation"
        )

        XCTAssertTrue(legacyThread.isAgentChatThread)
        XCTAssertEqual(legacyThread.listIdentity, "agent:legacy-agent-conversation")
    }

    func testAgentConversationCacheRoundTripsRoutingMetadata() throws {
        let ownerID = "agent-cache-test-\(UUID().uuidString)"
        defer { MessageStore.shared.clearAccount(userID: ownerID) }
        let row = Conversation(
            type: "agent",
            id: "agent-conversation-cache",
            name: "缓存智能体",
            avatarURL: "",
            lastMessage: "缓存消息",
            lastMessageTime: "2026-07-21T10:00:00Z",
            unreadCount: 0,
            subtitle: nil,
            groupID: nil,
            memberCount: nil,
            conversationKind: "agent_conversation",
            agentConversationID: "agent-conversation-cache",
            agentID: "agent-cache",
            agentAvatarAssetID: "avatar-cache",
            agentGreetingID: "greeting-cache",
            lastMessageID: 88,
            readThroughMessageID: 80,
            revision: 901,
            isMuted: true
        )

        MessageStore.shared.saveConversations([row], ownerID: ownerID)
        let restored = try XCTUnwrap(
            MessageStore.shared.loadConversations(ownerID: ownerID).first
        )

        XCTAssertEqual(restored.agentConversationID, row.agentConversationID)
        XCTAssertEqual(restored.agentID, row.agentID)
        XCTAssertEqual(restored.agentAvatarAssetID, row.agentAvatarAssetID)
        XCTAssertEqual(restored.agentGreetingID, row.agentGreetingID)
        XCTAssertEqual(restored.lastMessageID, 88)
        XCTAssertEqual(restored.readThroughMessageID, 80)
        XCTAssertEqual(restored.revision, 901)
        XCTAssertTrue(restored.isMuted)
        XCTAssertEqual(restored.listIdentity, row.listIdentity)
    }

    func testProvisionalConversationRefreshPreservesCachedAgentRows() {
        let direct = Conversation(
            type: "dm",
            id: "friend-1",
            name: "Friend",
            avatarURL: "",
            lastMessage: "hello",
            lastMessageTime: "2026-07-27T09:00:00Z",
            unreadCount: 0,
            subtitle: nil,
            groupID: nil,
            memberCount: nil
        )
        let agent = makeAgentRow(
            id: "agent-thread-1",
            agentID: "agent-1",
            conversationKind: "agent_conversation"
        )

        let rows = ConversationListViewModel.preservingLiveAgentRows(
            chatRows: [direct],
            liveRows: [agent]
        )

        XCTAssertEqual(Set(rows.map(\.listIdentity)), Set([direct.listIdentity, agent.listIdentity]))
    }

    func testCachedAgentRowCanOpenAsOfflineConversation() throws {
        let row = Conversation(
            type: "agent",
            id: "offline-thread",
            name: "离线智能体",
            avatarURL: "",
            lastMessage: "本地消息",
            lastMessageTime: "2026-07-27T10:00:00Z",
            unreadCount: 0,
            subtitle: nil,
            groupID: nil,
            memberCount: nil,
            conversationKind: "agent_conversation",
            agentConversationID: "offline-thread",
            agentID: "agent-offline",
            agentAvatarAssetID: "avatar-offline"
        )

        let conversation = try XCTUnwrap(AgentConversation(cachedConversationRow: row))
        XCTAssertEqual(conversation.id, "offline-thread")
        XCTAssertEqual(conversation.agentID, "agent-offline")
        XCTAssertEqual(conversation.agentProfile.name, "离线智能体")
    }

    func testAgentConversationAndMessagesAreCodableForDiskCache() throws {
        let json = """
        {
          "id": "agent-thread-codable",
          "title": "缓存会话",
          "status": "active",
          "agent_id": "agent-codable",
          "agent_version_id": "version-1",
          "agent_profile": { "name": "缓存智能体", "avatar_asset_id": "avatar-1" },
          "agent_capabilities": { "paid_images": true, "paid_videos": false },
          "latest_message": null,
          "created_at": "2026-07-27T10:00:00Z",
          "updated_at": "2026-07-27T10:00:00Z"
        }
        """.data(using: .utf8)!
        let decoded = try JSONDecoder().decode(AgentConversation.self, from: json)

        let encoded = try JSONEncoder().encode(decoded)
        let restored = try JSONDecoder().decode(AgentConversation.self, from: encoded)

        XCTAssertEqual(restored, decoded)
    }

    func testGroupMessageCacheRoundTripsMentionAll() throws {
        let ownerID = "group-message-cache-\(UUID().uuidString)"
        defer { MessageStore.shared.clearAccount(userID: ownerID) }
        let message = GroupMessage(
            id: 9_001,
            groupID: 42,
            senderID: "admin",
            msgType: "text",
            content: "@所有人 hello",
            timestamp: "2026-07-24T10:00:00Z",
            senderNickname: "Admin",
            senderAvatar: "",
            replyToID: nil,
            replyTo: nil,
            mentions: ["user-1"],
            mentionAll: true,
            clientMessageID: "mention-all-cache"
        )

        XCTAssertTrue(MessageStore.shared.saveGroupMessage(message, ownerID: ownerID))
        let restored = try XCTUnwrap(
            MessageStore.shared.loadGroupMessages(
                ownerID: ownerID,
                groupID: 42,
                limit: 10
            ).first
        )
        XCTAssertTrue(restored.mentionAll)
        XCTAssertEqual(restored.mentions, ["user-1"])
        XCTAssertEqual(restored.clientMessageID, "mention-all-cache")
    }

    func testPinThenDeleteUpdatesConversationListImmediately() {
        let uniqueID = "swipe-action-\(UUID().uuidString)"
        let conversation = Conversation(
            type: "dm",
            id: uniqueID,
            name: "测试会话",
            avatarURL: "",
            lastMessage: "最后一条消息",
            lastMessageTime: "2026-07-15T10:00:00Z",
            unreadCount: 2,
            subtitle: nil,
            groupID: nil,
            memberCount: nil
        )
        let viewModel = ConversationListViewModel()
        viewModel.conversations = [conversation]

        viewModel.togglePinned(conversation)

        XCTAssertTrue(viewModel.isPinned(conversation))
        XCTAssertEqual(viewModel.conversations.first?.listIdentity, conversation.listIdentity)

        viewModel.deleteConversation(conversation)

        XCTAssertFalse(viewModel.isPinned(conversation))
        XCTAssertFalse(viewModel.conversations.contains { $0.listIdentity == conversation.listIdentity })
    }

    func testAcceptedLivePairCreatesPersistentEmptyConversationCard() throws {
        let ownerID = "live-owner-\(UUID().uuidString)"
        let peerID = "live-peer-\(UUID().uuidString)"
        let storageKey = "bbchat.conversationList.livePairConversations.\(ownerID)"
        defer {
            MessageStore.shared.clearAccount(userID: ownerID)
            UserDefaults.standard.removeObject(forKey: storageKey)
            UserDefaults.standard.removeObject(
                forKey: "bbchat.conversationList.hidden.\(ownerID)"
            )
        }

        let viewModel = ConversationListViewModel()
        viewModel.conversations = []
        viewModel.ensureLivePairConversation(
            for: Contact(
                userID: peerID,
                nickname: "直播对象",
                avatarURL: "https://example.test/live-avatar.png",
                lastMessage: nil,
                lastMessageTime: nil,
                unreadCount: 0
            ),
            ownerID: ownerID
        )

        let row = try XCTUnwrap(viewModel.conversations.first)
        XCTAssertEqual(row.listIdentity, "dm:\(peerID)")
        XCTAssertEqual(row.name, "直播对象")
        XCTAssertEqual(row.conversationKind, "live_call")
        XCTAssertNil(row.lastMessage)
        XCTAssertTrue(
            UserDefaults.standard.stringArray(forKey: storageKey)?.contains(peerID) == true
        )
        XCTAssertEqual(
            MessageStore.shared.loadConversations(ownerID: ownerID).first?.listIdentity,
            row.listIdentity
        )
    }

    func testRepeatedLivePairRegistrationDoesNotDuplicateConversationCard() {
        let ownerID = "live-owner-\(UUID().uuidString)"
        let peerID = "live-peer-\(UUID().uuidString)"
        let storageKey = "bbchat.conversationList.livePairConversations.\(ownerID)"
        defer {
            MessageStore.shared.clearAccount(userID: ownerID)
            UserDefaults.standard.removeObject(forKey: storageKey)
            UserDefaults.standard.removeObject(
                forKey: "bbchat.conversationList.hidden.\(ownerID)"
            )
        }

        let viewModel = ConversationListViewModel()
        let first = Contact(
            userID: peerID,
            nickname: "旧昵称",
            avatarURL: "",
            lastMessage: nil,
            lastMessageTime: nil,
            unreadCount: 0
        )
        let refreshed = Contact(
            userID: peerID,
            nickname: "新昵称",
            avatarURL: "https://example.test/new-avatar.png",
            lastMessage: nil,
            lastMessageTime: nil,
            unreadCount: 0
        )

        viewModel.ensureLivePairConversation(for: first, ownerID: ownerID)
        viewModel.ensureLivePairConversation(for: refreshed, ownerID: ownerID)

        XCTAssertEqual(viewModel.conversations.count, 1)
        XCTAssertEqual(viewModel.conversations.first?.name, "新昵称")
        XCTAssertEqual(
            viewModel.conversations.first?.avatarURL,
            "https://example.test/new-avatar.png"
        )
    }

    func testLivePairCardSurvivesConversationEndpointCatchUpWindow() {
        let peerID = "live-peer"
        let localRow = Conversation(
            type: "dm",
            id: peerID,
            name: "直播对象",
            avatarURL: "",
            lastMessage: nil,
            lastMessageTime: nil,
            unreadCount: 0,
            subtitle: nil,
            groupID: nil,
            memberCount: nil,
            conversationKind: "live_call"
        )

        let rows = ConversationListViewModel.reconciledLivePairRows(
            serverRows: [],
            liveRows: [localRow],
            registeredPeerIDs: [peerID]
        )

        XCTAssertEqual(rows, [localRow])
    }

    func testChatMoneyReceiptPreviewNeverUsesGroupSenderPrefix() {
        let receipt = #"""
        {
          "event_id": "evt-list",
          "asset_id": "rp-list",
          "event_type": "red_packet_claimed",
          "actor_id": "recipient",
          "actor_name": "小猫",
          "sender_id": "sender",
          "sender_name": "大猫",
          "scope": "group",
          "created_at": "2026-07-17T01:00:00Z"
        }
        """#

        XCTAssertTrue(ChatMoneyPreview.isReceipt(content: receipt, msgType: "text"))
        XCTAssertNil(
            ConversationPreviewFormatter.senderPrefix("未知", content: receipt)
        )
        XCTAssertNil(
            ConversationPreviewFormatter.senderPrefix("系统消息", content: receipt)
        )
        let normalizedReceipt = L10n.tr(
            "chatMoney.receipt.transferReturnedBetween",
            "小猫",
            "大猫"
        )
        XCTAssertNil(
            ConversationPreviewFormatter.senderPrefix("小猫", content: normalizedReceipt)
        )
        XCTAssertEqual(
            ConversationPreviewFormatter.senderPrefix("小猫", content: "普通群消息"),
            "小猫"
        )
    }

    func testChatMoneyPreviewUsesViewerSpecificActionPrompt() throws {
        let transfer = ChatMoneyPayload(
            assetID: "transfer-preview",
            kind: .transfer,
            scope: .direct,
            senderID: "sender",
            recipientID: "recipient",
            recipientName: "小猫",
            amount: 88
        )
        let transferContent = try XCTUnwrap(transfer.encodedContent)

        XCTAssertEqual(
            ChatMoneyPreview.text(
                content: transferContent,
                msgType: "transfer",
                viewerID: "recipient"
            ),
            "\(L10n.tr("chatMoney.preview.transfer")) \(L10n.tr("chatMoney.transfer.receivePrompt"))"
        )
        XCTAssertEqual(
            ChatMoneyPreview.text(
                content: transferContent,
                msgType: "transfer",
                viewerID: "sender"
            ),
            "\(L10n.tr("chatMoney.preview.transfer")) \(L10n.tr("chatMoney.transfer.waitingForRecipient"))"
        )

        let redPacket = ChatMoneyPayload(
            assetID: "red-packet-preview",
            kind: .redPacket,
            scope: .direct,
            mode: .direct,
            senderID: "sender",
            recipientID: "recipient",
            greeting: "恭喜发财"
        )
        let redPacketContent = try XCTUnwrap(redPacket.encodedContent)

        XCTAssertEqual(
            ChatMoneyPreview.text(
                content: redPacketContent,
                msgType: "red_packet",
                viewerID: "recipient"
            ),
            "\(L10n.tr("chatMoney.preview.redPacket")) \(L10n.tr("chatMoney.redPacket.claimPrompt"))"
        )
        XCTAssertEqual(
            ChatMoneyPreview.text(
                content: redPacketContent,
                msgType: "red_packet",
                viewerID: "sender"
            ),
            "\(L10n.tr("chatMoney.preview.redPacket")) \(L10n.tr("chatMoney.redPacket.waitingForRecipient"))"
        )
    }

    func testTerminalTransferPromptDistinguishesAcceptedAndReturnedByViewer() {
        let accepted = ChatMoneyPayload(
            assetID: "transfer-accepted",
            kind: .transfer,
            scope: .direct,
            senderID: "sender",
            recipientID: "recipient",
            amount: 88,
            status: .accepted
        )
        let returned = ChatMoneyPayload(
            assetID: "transfer-returned",
            kind: .transfer,
            scope: .direct,
            senderID: "sender",
            recipientID: "recipient",
            amount: 88,
            status: .returned
        )

        XCTAssertEqual(
            ChatMoneyMessagePromptResolver.prompt(
                for: accepted,
                viewerID: "sender",
                isFromMe: true
            ).text,
            L10n.tr("chatMoney.transfer.card.acceptedByRecipient")
        )
        XCTAssertEqual(
            ChatMoneyMessagePromptResolver.prompt(
                for: accepted,
                viewerID: "recipient",
                isFromMe: false
            ).text,
            L10n.tr("chatMoney.transfer.card.receivedByMe")
        )
        XCTAssertEqual(
            ChatMoneyMessagePromptResolver.prompt(
                for: returned,
                viewerID: "sender",
                isFromMe: true
            ).text,
            L10n.tr("chatMoney.transfer.card.returnedToMe")
        )
        XCTAssertEqual(
            ChatMoneyMessagePromptResolver.prompt(
                for: returned,
                viewerID: "recipient",
                isFromMe: false
            ).text,
            L10n.tr("chatMoney.transfer.card.returnedByMe")
        )
    }

    func testGroupNotificationSettingsDecodeDefaultsAndNormalizesMembers() throws {
        let defaults = try JSONDecoder().decode(
            GroupNotificationSettings.self,
            from: Data(#"{"group_id":42}"#.utf8)
        )
        XCTAssertEqual(defaults.groupID, 42)
        XCTAssertFalse(defaults.isMuted)
        XCTAssertTrue(defaults.notifyMentionsMe)
        XCTAssertTrue(defaults.notifyMentionsAll)
        XCTAssertEqual(defaults.importantMemberIDs, [])
        XCTAssertEqual(defaults.revision, 0)

        let full = try JSONDecoder().decode(
            GroupNotificationSettings.self,
            from: Data("""
            {
              "groupID": 42,
              "isMuted": true,
              "notifyMentionsMe": false,
              "notifyMentionsAll": true,
              "importantMemberIDs": [" a ", "a", "", "b", "c", "d", "e"],
              "revision": 9
            }
            """.utf8)
        )
        XCTAssertTrue(full.isMuted)
        XCTAssertFalse(full.notifyMentionsMe)
        XCTAssertEqual(full.importantMemberIDs, ["a", "b", "c", "d"])
        XCTAssertEqual(full.revision, 9)
    }

    func testGroupNotificationSettingsAlertDecisionUsesORRules() {
        let settings = GroupNotificationSettings(
            groupID: 42,
            isMuted: true,
            notifyMentionsMe: true,
            notifyMentionsAll: false,
            importantMemberIDs: ["important"]
        )

        XCTAssertFalse(settings.shouldAlert(
            senderID: "ordinary",
            isDirectMention: false,
            isMentionAll: false
        ))
        XCTAssertTrue(settings.shouldAlert(
            senderID: "ordinary",
            isDirectMention: true,
            isMentionAll: false
        ))
        XCTAssertFalse(settings.shouldAlert(
            senderID: "ordinary",
            isDirectMention: false,
            isMentionAll: true
        ))
        XCTAssertTrue(settings.shouldAlert(
            senderID: "important",
            isDirectMention: false,
            isMentionAll: false
        ))
        XCTAssertTrue(GroupNotificationSettings(groupID: 42).shouldAlert(
            senderID: "ordinary",
            isDirectMention: false,
            isMentionAll: false
        ))
    }

    func testConversationAndGroupMessageDecodeMuteAndMentionAllCompatibly() throws {
        let legacyConversation = try JSONDecoder().decode(
            Conversation.self,
            from: Data("""
            {
              "type": "group",
              "id": "42",
              "name": "Group",
              "avatar_url": "",
              "unread_count": 3,
              "group_id": 42
            }
            """.utf8)
        )
        XCTAssertFalse(legacyConversation.isMuted)

        let mutedConversation = try JSONDecoder().decode(
            Conversation.self,
            from: Data("""
            {
              "type": "group",
              "id": "42",
              "name": "Group",
              "avatar_url": "",
              "unread_count": 3,
              "group_id": 42,
              "is_muted": true
            }
            """.utf8)
        )
        XCTAssertTrue(mutedConversation.isMuted)

        let groupMessage = try JSONDecoder().decode(
            GroupMessage.self,
            from: Data("""
            {
              "id": 99,
              "group_id": 42,
              "sender_id": "admin",
              "msg_type": "text",
              "content": "@所有人 hello",
              "timestamp": "2026-07-24T10:00:00Z",
              "sender_nickname": "Admin",
              "sender_avatar": "",
              "mention_all": true
            }
            """.utf8)
        )
        XCTAssertTrue(groupMessage.mentionAll)
    }

    func testOutgoingPayloadKeepsMentionAllAcrossLegacyAndNewJobs() throws {
        let legacy = try JSONDecoder().decode(
            ChatOutgoingPayload.self,
            from: Data("""
            {
              "conversationID": "42",
              "msgType": "text",
              "content": "hello",
              "mentions": []
            }
            """.utf8)
        )
        XCTAssertFalse(legacy.mentionAll)

        let encoded = try JSONEncoder().encode(ChatOutgoingPayload(
            conversationID: "42",
            msgType: "text",
            content: "@所有人 hello",
            mentions: ["user-1"],
            mentionAll: true
        ))
        let restored = try JSONDecoder().decode(ChatOutgoingPayload.self, from: encoded)
        XCTAssertTrue(restored.mentionAll)
        XCTAssertEqual(restored.mentions, ["user-1"])
    }

    func testNotificationRouteParsesMuteDecisionMetadata() throws {
        let route = try XCTUnwrap(NotificationRoute.parse([
            "conversation_type": "group",
            "group_id": 42,
            "message_id": 100,
            "sender_id": "admin",
            "is_direct_mention": "1",
            "is_mention_all": true,
            "notification_mode": "badge_only"
        ]))
        XCTAssertTrue(route.isDirectMention)
        XCTAssertTrue(route.isMentionAll)
        XCTAssertEqual(route.notificationMode, "badge_only")
    }

    func testLegacyPersistedNotificationRouteDefaultsNewFields() throws {
        let route = try JSONDecoder().decode(
            NotificationRoute.self,
            from: Data("""
            {
              "eventID": "legacy",
              "conversationType": "group",
              "conversationID": "42",
              "groupID": 42,
              "receivedAt": 0
            }
            """.utf8)
        )
        XCTAssertFalse(route.isDirectMention)
        XCTAssertFalse(route.isMentionAll)
        XCTAssertNil(route.notificationMode)
    }

    func testLegacyGroupDetailDecodesWithSafeV2Defaults() throws {
        let detail = try JSONDecoder().decode(GroupDetail.self, from: Data(#"""
        {
          "group_id": 42,
          "name": "Legacy Group",
          "avatar_url": "",
          "creator_id": "owner",
          "is_public": false,
          "members": [
            {"user_id":"owner","nickname":"Owner","avatar_url":"","role":"owner"}
          ]
        }
        """#.utf8))

        XCTAssertEqual(detail.groupID, 42)
        XCTAssertEqual(detail.viewerSettings.groupID, 42)
        XCTAssertEqual(detail.viewerSettings.remark, "")
        XCTAssertTrue(detail.viewerSettings.showMemberNicknames)
        XCTAssertNil(detail.announcement)
        XCTAssertNil(detail.currentMember)
    }

    func testGroupDetailV2DecodesViewerSettingsAnnouncementAndPermissions() throws {
        let detail = try JSONDecoder().decode(GroupDetail.self, from: Data(#"""
        {
          "group_id": 42,
          "name": "Canonical Name",
          "display_name": "My Group Remark",
          "avatar_url": "https://example.com/group.png",
          "creator_id": "owner",
          "is_public": false,
          "members": [{
            "user_id":"me",
            "nickname":"Profile Name",
            "group_nickname":"Group Name",
            "avatar_url":"",
            "role":"admin"
          }],
          "current_member": {
            "user_id":"me",
            "nickname":"Profile Name",
            "group_nickname":"Group Name",
            "avatar_url":"",
            "role":"admin"
          },
          "viewer_settings": {
            "group_id":42,
            "remark":"My Group Remark",
            "show_member_nicknames":false,
            "cleared_before_sequence":120,
            "revision":7
          },
          "announcement": {
            "id":"announcement-1",
            "group_id":42,
            "title":"Rules",
            "content":"Be kind",
            "revision":9
          },
          "permissions": {
            "can_manage_members":true,
            "can_edit_group":true,
            "can_edit_announcement":true,
            "can_create_invite":true,
            "can_change_visibility":false,
            "can_dismiss_group":false
          }
        }
        """#.utf8))

        XCTAssertEqual(detail.displayName, "My Group Remark")
        XCTAssertEqual(detail.currentMember?.displayNickname, "Group Name")
        XCTAssertFalse(detail.viewerSettings.showMemberNicknames)
        XCTAssertEqual(detail.viewerSettings.clearedBeforeSequence, 120)
        XCTAssertEqual(detail.announcement?.title, "Rules")
        XCTAssertTrue(detail.capabilities.canManageMembers)
        XCTAssertFalse(detail.capabilities.canDismissGroup)
    }

    func testGroupMessageSearchResultProvidesStableLocator() throws {
        let page = try JSONDecoder().decode(GroupMessageSearchPage.self, from: Data(#"""
        {
          "results": [{
            "message": {
              "id":9001,
              "group_id":42,
              "sender_id":"member",
              "msg_type":"text",
              "content":"hello",
              "timestamp":"2026-07-31T10:00:00Z",
              "sender_nickname":"Member",
              "sender_avatar":"",
              "history_sequence":880
            },
            "locator":{"message_id":9001,"history_sequence":880}
          }],
          "next_cursor":"next-page",
          "has_more":true
        }
        """#.utf8))

        XCTAssertEqual(page.results.first?.locator.messageID, 9001)
        XCTAssertEqual(page.results.first?.locator.historySequence, 880)
        XCTAssertEqual(page.results.first?.message.historySequence, 880)
        XCTAssertEqual(page.nextCursor, "next-page")
        XCTAssertTrue(page.hasMore)
    }

    func testGroupHistoryWatermarkFiltersCacheAndFutureBackfill() throws {
        let ownerID = "group-history-clear-\(UUID().uuidString)"
        let groupID = 4_242
        defer { MessageStore.shared.clearAccount(userID: ownerID) }

        func message(id: Int, sequence: Int64?) -> GroupMessage {
            GroupMessage(
                id: id,
                groupID: groupID,
                senderID: "member",
                msgType: "text",
                content: "message-\(id)",
                timestamp: "2026-07-31T10:00:00Z",
                senderNickname: "Member",
                senderAvatar: "",
                replyToID: nil,
                replyTo: nil,
                mentions: nil,
                historySequence: sequence
            )
        }

        XCTAssertTrue(MessageStore.shared.saveGroupMessage(message(id: 1, sequence: 10), ownerID: ownerID))
        XCTAssertTrue(MessageStore.shared.saveGroupMessage(message(id: 2, sequence: 20), ownerID: ownerID))
        MessageStore.shared.applyGroupHistoryClear(ownerID: ownerID, groupID: groupID, throughSequence: 10)

        XCTAssertEqual(
            MessageStore.shared.loadGroupMessages(ownerID: ownerID, groupID: groupID, limit: 20).map(\.id),
            [2]
        )
        XCTAssertFalse(MessageStore.shared.saveGroupMessage(message(id: 3, sequence: 9), ownerID: ownerID))
        XCTAssertFalse(MessageStore.shared.saveGroupMessage(message(id: 4, sequence: nil), ownerID: ownerID))
        XCTAssertTrue(MessageStore.shared.saveGroupMessage(message(id: 5, sequence: 11), ownerID: ownerID))
    }

    func testDirectHistoryClearReceiptDecodesCompatibleAliases() throws {
        let data = """
        {
          "contact_id": "peer-42",
          "cleared_before_id": "987",
          "cleared_at": "2026-08-06T02:00:00Z",
          "revision": "12"
        }
        """.data(using: .utf8)!

        let receipt = try JSONDecoder().decode(DirectHistoryClearReceipt.self, from: data)

        XCTAssertEqual(receipt.conversationID, "peer-42")
        XCTAssertEqual(receipt.clearedBeforeMessageID, 987)
        XCTAssertEqual(receipt.revision, 12)
    }

    func testDirectHistoryWatermarkFiltersCacheAndFutureBackfill() {
        let ownerID = "direct-history-clear-\(UUID().uuidString)"
        let contactID = "peer-\(UUID().uuidString)"
        defer { MessageStore.shared.clearAccount(userID: ownerID) }

        func message(id: Int) -> Message {
            Message(
                id: id,
                senderID: contactID,
                receiverID: ownerID,
                msgType: "text",
                content: "message-\(id)",
                timestamp: "2026-08-06T02:00:00Z",
                replyToID: nil,
                replyTo: nil,
                thumbnailURL: nil
            )
        }

        XCTAssertTrue(MessageStore.shared.saveMessage(message(id: 10), ownerID: ownerID))
        XCTAssertTrue(MessageStore.shared.saveMessage(message(id: 20), ownerID: ownerID))

        MessageStore.shared.applyDirectHistoryClear(
            ownerID: ownerID,
            contactID: contactID,
            throughMessageID: 10
        )

        XCTAssertEqual(
            MessageStore.shared.loadMessages(
                userID: ownerID,
                contactID: contactID,
                limit: 20
            ).map(\.id),
            [20]
        )
        XCTAssertFalse(MessageStore.shared.saveMessage(message(id: 9), ownerID: ownerID))
        XCTAssertTrue(MessageStore.shared.isDirectMessageHidden(
            ownerID: ownerID,
            contactID: contactID,
            messageID: 10
        ))
        XCTAssertTrue(MessageStore.shared.saveMessage(message(id: 11), ownerID: ownerID))
    }

    func testGroupInviteDeepLinkParsesUniversalAndCustomURLs() throws {
        XCTAssertEqual(
            GroupInviteRouteStore.token(from: try XCTUnwrap(URL(string: "https://chat.example.com/group-invites/token_1234"))),
            "token_1234"
        )
        XCTAssertEqual(
            GroupInviteRouteStore.token(from: try XCTUnwrap(URL(string: "bwchat://group-invite/token.5678"))),
            "token.5678"
        )
        XCTAssertNil(GroupInviteRouteStore.token(from: try XCTUnwrap(URL(string: "https://chat.example.com/groups/42"))))
    }

    func testLegacyPinnedConversationMigrationIsAccountScoped() throws {
        let suiteName = "group-info-pins-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        defaults.set(["group:42", "dm:alice"], forKey: "bbchat.conversationList.pinned.account-a")
        defaults.set(["group:99"], forKey: "bbchat.conversationList.pinned.account-b")

        let accountA = ConversationPreferenceStore.loadAndMigrate(
            defaults: defaults,
            scopeID: "account-a"
        )
        let accountB = ConversationPreferenceStore.loadAndMigrate(
            defaults: defaults,
            scopeID: "account-b"
        )

        XCTAssertEqual(accountA, ["group:42", "dm:alice"])
        XCTAssertEqual(accountB, ["group:99"])
        XCTAssertNil(defaults.object(forKey: "bbchat.conversationList.pinned.account-a"))
        XCTAssertEqual(
            Set(defaults.stringArray(forKey: "bbchat.conversation.preferences.v1.account-a") ?? []),
            accountA
        )
    }

    private func makeAgentRow(
        id: String,
        agentID: String?,
        conversationKind: String,
        agentConversationID: String? = nil
    ) -> Conversation {
        Conversation(
            type: "agent",
            id: id,
            name: "测试智能体",
            avatarURL: "",
            lastMessage: "你好",
            lastMessageTime: "2026-07-21T10:00:00Z",
            unreadCount: 0,
            subtitle: nil,
            groupID: nil,
            memberCount: nil,
            conversationKind: conversationKind,
            agentConversationID: agentConversationID,
            agentID: agentID
        )
    }
}
