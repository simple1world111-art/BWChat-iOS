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
}
