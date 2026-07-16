import XCTest
@testable import BBchat

final class APIResponseContractTests: XCTestCase {
    private struct ListData: Decodable, Equatable {
        let items: [Int]
    }

    func testRequiredDataPreservesLegitimateEmptyList() throws {
        let response = APIResponseWrapper(
            code: 0,
            message: "ok",
            data: ListData(items: [])
        )

        XCTAssertEqual(try response.requiredData(), ListData(items: []))
    }

    func testRequiredDataThrowsInsteadOfConvertingMissingPayloadToEmptyList() {
        let response = APIResponseWrapper<ListData>(
            code: 0,
            message: "ok",
            data: nil
        )

        XCTAssertThrowsError(try response.requiredData())
    }

    func testGatewayErrorUsesSafeLocalizedMessage() {
        let error = APIError.serverError(
            code: 502,
            message: "<html><title>502 Bad Gateway</title></html>"
        )

        XCTAssertEqual(error.errorDescription, L10n.tr("api.serverUnavailable"))
        XCTAssertFalse(error.errorDescription?.contains("502") == true)
        XCTAssertFalse(error.errorDescription?.contains("<html>") == true)
    }

    func testValidationErrorPreservesServerMessage() {
        let error = APIError.serverError(code: 422, message: "Nickname is required")

        XCTAssertEqual(error.errorDescription, "Nickname is required")
    }

    func testTransientRetryPolicyOnlyRetriesIdempotentRequests() {
        XCTAssertTrue(TransientHTTPRetryPolicy.shouldRetry(method: "GET", statusCode: 502, retryCount: 0))
        XCTAssertFalse(TransientHTTPRetryPolicy.shouldRetry(method: "POST", statusCode: 502, retryCount: 0))
        XCTAssertFalse(TransientHTTPRetryPolicy.shouldRetry(method: "GET", statusCode: 400, retryCount: 0))
        XCTAssertFalse(TransientHTTPRetryPolicy.shouldRetry(method: "GET", statusCode: 502, retryCount: 2))

        let connectionFailure = URLError(.cannotConnectToHost)
        XCTAssertTrue(TransientHTTPRetryPolicy.shouldRetry(method: "GET", error: connectionFailure, retryCount: 0))
        XCTAssertFalse(TransientHTTPRetryPolicy.shouldRetry(method: "POST", error: connectionFailure, retryCount: 0))
        XCTAssertTrue(TransientHTTPRetryPolicy.isCancellation(URLError(.cancelled)))
    }

    func testAgentSummaryDecodesPlatformContract() throws {
        let json = #"""
        {
          "agent_id": "agent-1",
          "visibility": "public",
          "status": "published",
          "version_number": 3,
          "profile": {
            "name": "旅行助手",
            "tagline": "一起出发",
            "avatar_asset_id": "asset-avatar"
          },
          "capabilities": {
            "paid_images": true,
            "paid_videos": false
          }
        }
        """#.data(using: .utf8)!

        let agent = try JSONDecoder().decode(AgentSummary.self, from: json)

        XCTAssertEqual(agent.id, "agent-1")
        XCTAssertEqual(agent.displayName, "旅行助手")
        XCTAssertEqual(agent.resolvedAvatarAssetID, "asset-avatar")
        XCTAssertEqual(agent.versionNumber, 3)
        XCTAssertEqual(agent.capabilities?.paidImages, true)
        XCTAssertEqual(agent.capabilities?.paidVideos, false)
    }

    func testAgentRuntimeConfigDecodesDocumentedNestedFeatureContract() throws {
        let json = #"""
        {
          "code": 0,
          "message": "success",
          "data": {
            "schema_version": 1,
            "config_version": "2026.07.15.2",
            "features": {
              "agents_enabled": true,
              "image_input_enabled": true,
              "paid_images_enabled": true,
              "paid_videos_enabled": false
            },
            "vision": {
              "max_images_per_turn": 4,
              "max_image_bytes": 10485760
            },
            "paid_media": {
              "image": {
                "price_points": 200,
                "daily_budget_points": 2000,
                "max_count_per_day": 10,
                "cooldown_seconds": 0,
                "min_user_turns_between": 0
              }
            }
          }
        }
        """#.data(using: .utf8)!

        let response = try JSONDecoder().decode(APIResponseWrapper<AgentRuntimeConfig>.self, from: json)
        let config = try response.requiredData()

        XCTAssertTrue(config.agentsEnabled)
        XCTAssertTrue(config.imageInputEnabled)
        XCTAssertTrue(config.paidImagesEnabled)
        XCTAssertFalse(config.paidVideosEnabled)
        XCTAssertEqual(config.vision.maxImagesPerTurn, 4)
        XCTAssertEqual(config.imagePricePoints, 200)
    }

    func testAgentRuntimeConfigRejectsMissingDocumentedFeaturesObject() throws {
        let json = #"""
        {
          "paid_images_enabled": true,
          "paid_videos_enabled": false,
          "vision": {"max_images_per_turn": 4}
        }
        """#.data(using: .utf8)!

        XCTAssertThrowsError(try JSONDecoder().decode(AgentRuntimeConfig.self, from: json))
    }

    func testAgentGalleryOnlyOpensInputAndUnlockedGeneratedImages() throws {
        let input = try JSONDecoder().decode(AgentMessagePart.self, from: #"""
        {
          "id": "part-input",
          "ordinal": 0,
          "type": "input_image",
          "asset_id": "asset-input-1"
        }
        """#.data(using: .utf8)!)
        let locked = try JSONDecoder().decode(AgentMessagePart.self, from: #"""
        {
          "id": "part-locked",
          "ordinal": 1,
          "type": "paid_media",
          "reference_id": "media-1",
          "metadata": {
            "media_type": "image",
            "access": "locked",
            "preview_url": "/agent-media/media-1/preview",
            "content_url": "/agent-media/media-1/content"
          }
        }
        """#.data(using: .utf8)!)
        let unlocked = try JSONDecoder().decode(AgentMessagePart.self, from: #"""
        {
          "id": "part-unlocked",
          "ordinal": 2,
          "type": "paid_media",
          "reference_id": "media-2",
          "metadata": {
            "media_type": "image",
            "access": "unlocked",
            "content_url": "/agent-media/media-2/content"
          }
        }
        """#.data(using: .utf8)!)

        XCTAssertEqual(
            AgentGalleryMediaResolver.imageURL(for: input),
            "/agent-assets/asset-input-1/content"
        )
        XCTAssertNil(AgentGalleryMediaResolver.imageURL(for: locked))
        XCTAssertEqual(
            AgentGalleryMediaResolver.imageURL(for: unlocked),
            "/agent-media/media-2/content"
        )
    }

    func testAgentSummaryDecodesDraftContractVariants() throws {
        let json = #"""
        {
          "agent_id": 42,
          "revision": "1",
          "is_owner": 1,
          "profile": {
            "name": "旅行助手",
            "tags": "companion，travel"
          },
          "definition": {
            "personality": "温暖, 细心",
            "greetings": [{"text": "你好"}],
            "capabilities": {"paid_images": "true", "paid_videos": 0}
          }
        }
        """#.data(using: .utf8)!

        let agent = try JSONDecoder().decode(AgentSummary.self, from: json)

        XCTAssertEqual(agent.id, "42")
        XCTAssertEqual(agent.revision, 1)
        XCTAssertEqual(agent.isOwner, true)
        XCTAssertEqual(agent.profile?.tags, ["companion", "travel"])
        XCTAssertEqual(agent.definition?.personality, ["温暖", "细心"])
        XCTAssertEqual(agent.definition?.greetings?.first?.id, "default")
        XCTAssertEqual(agent.definition?.capabilities?.paidImages, true)
        XCTAssertEqual(agent.definition?.capabilities?.paidVideos, false)
    }

    func testAgentCreateResponseUnwrapsNestedAgent() throws {
        let json = #"""
        {
          "code": 0,
          "message": "ok",
          "data": {
            "agent": {
              "agent_id": "agent-draft-1",
              "status": "draft",
              "profile": {"name": "旅行助手"}
            }
          }
        }
        """#.data(using: .utf8)!

        let response = try JSONDecoder().decode(AgentSummaryRemoteResponse.self, from: json)

        XCTAssertEqual(try response.requiredAgent().id, "agent-draft-1")
        XCTAssertEqual(try response.requiredAgent().status, "draft")
    }

    func testAgentCreateResponseAllowsMissingEnvelopeMessage() throws {
        let json = #"""
        {
          "code": 0,
          "data": {
            "agent_id": "agent-draft-2",
            "status": "draft"
          }
        }
        """#.data(using: .utf8)!

        let response = try JSONDecoder().decode(AgentSummaryRemoteResponse.self, from: json)

        XCTAssertEqual(try response.requiredAgent().id, "agent-draft-2")
    }

    func testAgentConversationCreateResponseUnwrapsNestedConversation() throws {
        let json = #"""
        {
          "code": 0,
          "message": "ok",
          "data": {
            "conversation": {
              "id": "agent-conversation-1",
              "title": "开始聊天",
              "status": "active",
              "agent_id": "agent-1",
              "agent_version_id": "version-1",
              "agent_profile": {
                "name": "旅行助手",
                "avatar_asset_id": "avatar-1"
              },
              "agent_capabilities": {
                "paid_images": false,
                "paid_videos": false
              },
              "latest_message": null,
              "created_at": "2026-07-15T10:00:00Z",
              "updated_at": "2026-07-15T10:00:01Z"
            }
          }
        }
        """#.data(using: .utf8)!

        let response = try JSONDecoder().decode(AgentConversationRemoteResponse.self, from: json)
        let conversation = try response.requiredConversation()

        XCTAssertEqual(conversation.id, "agent-conversation-1")
        XCTAssertEqual(conversation.agentID, "agent-1")
        XCTAssertEqual(conversation.agentProfile.name, "旅行助手")
    }

    func testAgentMessagePartsRemainServerOrderedByOrdinal() throws {
        let json = #"""
        {
          "id": "message-1",
          "conversation_id": "conversation-1",
          "sequence_no": 9,
          "sender": { "type": "agent", "id": "agent-1" },
          "source": "turn",
          "status": "completed",
          "created_at": "2026-07-15T10:00:00Z",
          "updated_at": "2026-07-15T10:00:01Z",
          "parts": [
            { "id": "part-2", "ordinal": 2, "type": "text", "text": "后" },
            { "id": "part-1", "ordinal": 1, "type": "paid_media", "asset_id": "asset-1",
              "metadata": { "generation_status": "ready", "access": "locked", "price_points": 20 } }
          ]
        }
        """#.data(using: .utf8)!

        let message = try JSONDecoder().decode(AgentMessage.self, from: json)

        XCTAssertEqual(message.orderedParts.map(\.id), ["part-1", "part-2"])
        XCTAssertEqual(message.orderedParts.first?.metadata.access, "locked")
        XCTAssertEqual(message.orderedParts.first?.metadata.pricePoints, 20)
    }

    func testAgentImageTransformModeBuildsExplicitToolInstruction() {
        let text = AgentImageRequestMode.transform.outboundText(userText: "把背景改成夜晚")

        XCTAssertTrue(text.hasPrefix(AgentImageRequestMode.transformInstructionPrefix))
        XCTAssertTrue(text.contains("实际调用图片生成工具"))
        XCTAssertTrue(text.contains("把背景改成夜晚"))
        XCTAssertTrue(AgentImageRequestMode.isTransformRequest(text: text))
        XCTAssertEqual(
            AgentImageRequestMode.analyze.outboundText(userText: "  这张图里有什么？  "),
            "这张图里有什么？"
        )
    }

    func testAgentImageGenerationPolicyExplainsEveryBlockingState() {
        XCTAssertEqual(
            AgentImageGenerationPolicy(
                isRuntimeConfigLoaded: false,
                isGloballyEnabled: false,
                isEnabledForAgentVersion: true,
                hasBlockingLockedMedia: false
            ).blockReason,
            "正在加载图片生成能力，请稍后再试"
        )
        XCTAssertEqual(
            AgentImageGenerationPolicy(
                isRuntimeConfigLoaded: true,
                isGloballyEnabled: false,
                isEnabledForAgentVersion: true,
                hasBlockingLockedMedia: false
            ).blockReason,
            "图片生成功能当前未开放"
        )
        XCTAssertEqual(
            AgentImageGenerationPolicy(
                isRuntimeConfigLoaded: true,
                isGloballyEnabled: true,
                isEnabledForAgentVersion: false,
                hasBlockingLockedMedia: false
            ).blockReason,
            "当前会话使用的智能体版本未开启图片能力"
        )
        XCTAssertEqual(
            AgentImageGenerationPolicy(
                isRuntimeConfigLoaded: true,
                isGloballyEnabled: true,
                isEnabledForAgentVersion: true,
                hasBlockingLockedMedia: true
            ).blockReason,
            "请先解锁上一张图片，再继续调整图片"
        )

        let available = AgentImageGenerationPolicy(
            isRuntimeConfigLoaded: true,
            isGloballyEnabled: true,
            isEnabledForAgentVersion: true,
            hasBlockingLockedMedia: false
        )
        XCTAssertTrue(available.canGenerate)
        XCTAssertNil(available.blockReason)
    }

    func testAgentEntryBelongsToProfileAndIsHiddenFromContacts() {
        let config = AppRemoteConfig()
        let profileIDs = config.effectiveProfileSections.flatMap(\.items).map(\.id)
        let contactIDs = config.effectiveContactModules.flatMap(\.items).map(\.id)

        XCTAssertTrue(profileIDs.contains("agent_hub"))
        XCTAssertFalse(contactIDs.contains("agent_hub"))
    }

    func testConversationTimeComparisonHandlesMixedTimestampFormats() {
        let sqlStyle = "2026-07-14 18:20:38"
        let earlierISO = "2026-07-14T17:20:38+08:00"

        XCTAssertEqual(
            Conversation.compareMessageTimes(sqlStyle, earlierISO),
            .orderedDescending
        )
    }

    func testConversationTimeComparisonTreatsMissingTimestampAsOldest() {
        XCTAssertEqual(
            Conversation.compareMessageTimes(nil, "2026-07-14T18:20:38+08:00"),
            .orderedAscending
        )
        XCTAssertEqual(Conversation.compareMessageTimes(nil, nil), .orderedSame)
    }

    func testConversationReadTargetsUseStableListIdentities() {
        XCTAssertEqual(ConversationReadTarget.direct(userID: "user-1").listIdentity, "dm:user-1")
        XCTAssertEqual(ConversationReadTarget.group(groupID: 42).listIdentity, "group:42")
    }

    func testDeliveryMatcherTreatsRelativeAndAbsoluteImageURLsAsOneConfirmation() {
        XCTAssertTrue(MessageDeliveryMatcher.contentsMatch(
            type: "image",
            lhs: "/api/v1/images/u1/photo.jpg",
            rhs: "https://example.com/api/v1/images/u1/photo.jpg"
        ))
    }

    func testDeliveryMatcherNormalizesMediaTypeAliases() {
        XCTAssertEqual(MessageDeliveryMatcher.normalizedType("photo"), "image")
        XCTAssertEqual(MessageDeliveryMatcher.normalizedType("audio"), "voice")
        XCTAssertEqual(MessageDeliveryMatcher.normalizedType("emoji"), "text")
    }

    func testDeliveryMatcherMatchesEquivalentGiftPayloadsWithDifferentJSONOrder() {
        let lhs = #"{"gift_id":"fish_10","recipient_id":"u2","gift_name":"Fish"}"#
        let rhs = #"{"recipient_id":"u2","gift_name":"Dried Fish","gift_id":"fish_10"}"#

        XCTAssertTrue(MessageDeliveryMatcher.contentsMatch(type: "gift", lhs: lhs, rhs: rhs))
    }

    func testDeliveryMatcherDoesNotCollapseDifferentTextMessages() {
        XCTAssertFalse(MessageDeliveryMatcher.contentsMatch(
            type: "text",
            lhs: "第一条",
            rhs: "第二条"
        ))
    }

    @MainActor
    func testUnreadBadgeAggregatesPerConversationAndClearsOneConversationOnly() {
        let store = UnreadBadgeStore.shared
        store.setChatUnreadCount(0)
        defer { store.setChatUnreadCount(0) }

        store.replaceChatUnreadCounts(["dm:user-1": 2, "group:42": 3])
        XCTAssertEqual(store.chatUnreadCount, 5)

        store.setConversationUnreadCount(0, for: "dm:user-1")
        XCTAssertEqual(store.chatUnreadCount, 3)

        store.incrementConversationUnread(for: "dm:user-1")
        XCTAssertEqual(store.chatUnreadCount, 4)
    }

    @MainActor
    func testUnreadBadgeRetainsKnownZeroAndReplacesStaleSnapshot() {
        let store = UnreadBadgeStore.shared
        store.setChatUnreadCount(0)
        defer { store.setChatUnreadCount(0) }

        store.replaceChatUnreadCounts(["dm:read": 0, "group:42": 2])
        XCTAssertEqual(store.conversationUnreadCount(for: "dm:read"), 0)
        XCTAssertNil(store.conversationUnreadCount(for: "dm:not-loaded"))
        XCTAssertEqual(store.chatUnreadCount, 2)

        store.replaceChatUnreadCounts(["dm:read": 3])
        XCTAssertEqual(store.conversationUnreadCount(for: "dm:read"), 3)
        XCTAssertNil(store.conversationUnreadCount(for: "group:42"))
        XCTAssertEqual(store.chatUnreadCount, 3)
    }
}
