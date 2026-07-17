import XCTest
@testable import BBchat

@MainActor
final class ConversationListActionTests: XCTestCase {
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
}
