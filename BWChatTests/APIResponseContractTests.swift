import XCTest
@testable import BBchat

final class APIResponseContractTests: XCTestCase {
    private struct ListData: Decodable, Equatable {
        let items: [Int]
    }

    func testCallStartResponsePreservesServerCallIdentity() throws {
        let data = #"""
        {
          "call_id": "call-123",
          "room_name": "call_room_123",
          "token": "livekit-token",
          "livekit_url": "http://example.test/livekit",
          "call_type": "voice"
        }
        """#.data(using: .utf8)!

        let response = try JSONDecoder().decode(CallStartResponse.self, from: data)

        XCTAssertEqual(response.callID, "call-123")
        XCTAssertEqual(response.roomName, "call_room_123")
    }

    func testCallJoinResponseKeepsBackwardCompatibilityWithoutCallID() throws {
        let data = #"""
        {
          "room_name": "call_room_legacy",
          "token": "livekit-token",
          "server_url": "http://example.test/livekit"
        }
        """#.data(using: .utf8)!

        let response = try JSONDecoder().decode(CallJoinResponse.self, from: data)

        XCTAssertNil(response.callID)
        XCTAssertEqual(response.roomName, "call_room_legacy")
    }

    func testCallSignalIdentityDeduplicatesWebSocketAndPushInvite() {
        let websocketInvite = CallSignalIdentity(callID: "call-123", roomName: "call_room_123")
        let pushInvite = CallSignalIdentity(callID: " call-123 ", roomName: "call_room_123")
        let differentCall = CallSignalIdentity(callID: "call-456", roomName: "call_room_123")
        let legacyInvite = CallSignalIdentity(callID: nil, roomName: "call_room_123")

        XCTAssertTrue(websocketInvite.matches(pushInvite))
        XCTAssertFalse(websocketInvite.matches(differentCall))
        XCTAssertTrue(websocketInvite.matches(legacyInvite))
        XCTAssertTrue(websocketInvite.hasComparableKey(with: legacyInvite))
    }

    func testCallMediaConfigurationUsesStableHighBitrate720pDefaults() {
        let roomOptions = CallMediaConfiguration.roomOptions
        let connectOptions = CallMediaConfiguration.connectOptions

        XCTAssertTrue(roomOptions.adaptiveStream)
        XCTAssertTrue(roomOptions.dynacast)
        XCTAssertFalse(roomOptions.singlePeerConnection)
        XCTAssertFalse(roomOptions.defaultVideoPublishOptions.simulcast)
        XCTAssertEqual(roomOptions.defaultVideoPublishOptions.encoding?.maxBitrate, 3_000_000)
        XCTAssertEqual(roomOptions.defaultVideoPublishOptions.encoding?.maxFps, 30)
        XCTAssertEqual(roomOptions.defaultVideoPublishOptions.preferredCodec, .vp8)
        XCTAssertFalse(CallMediaConfiguration.compatibilityVideoPublishOptions.simulcast)
        XCTAssertEqual(CallMediaConfiguration.compatibilityVideoPublishOptions.encoding?.maxBitrate, 2_200_000)
        XCTAssertEqual(CallMediaConfiguration.compatibilityVideoPublishOptions.encoding?.maxFps, 30)
        XCTAssertEqual(CallMediaConfiguration.cameraCaptureOptions(position: .front).dimensions, .h720_169)
        XCTAssertEqual(CallMediaConfiguration.cameraCaptureOptions(position: .front).fps, 30)
        XCTAssertEqual(roomOptions.defaultAudioPublishOptions.encoding?.maxBitrate, 48_000)
        XCTAssertTrue(roomOptions.defaultAudioPublishOptions.dtx)
        XCTAssertTrue(roomOptions.defaultAudioPublishOptions.red)
        XCTAssertTrue(connectOptions.isDscpEnabled)
        XCTAssertFalse(connectOptions.enableMicrophone)
        XCTAssertEqual(connectOptions.reconnectAttempts, 12)
    }

    func testDirectCallRecordParsesLegacyAndServerFormats() throws {
        let legacy = try XCTUnwrap(CallRecordContent.parse("[视频通话] 00:19"))
        XCTAssertEqual(legacy.callType, .video)
        XCTAssertEqual(legacy.status, .completed(duration: "00:19"))

        let completed = try XCTUnwrap(CallRecordContent.parse("[语音通话] 通话时长 01:02:03"))
        XCTAssertEqual(completed.callType, .voice)
        XCTAssertEqual(completed.status, .completed(duration: "01:02:03"))

        XCTAssertEqual(
            CallRecordContent.parse("[视频通话] 已拒绝")?.status,
            .rejected
        )
        XCTAssertEqual(
            CallRecordContent.parse("[视频通话] 未接听")?.status,
            .missed
        )
        XCTAssertNil(CallRecordContent.parse("[普通文本] 00:19"))
    }

    func testDirectMessageRecognizesCallRecordWithoutNewMessageType() {
        let message = Message(
            id: 9,
            senderID: "caller",
            receiverID: "callee",
            msgType: "text",
            content: "[视频通话] 通话时长 00:19",
            timestamp: "2026-07-19T06:00:00Z",
            replyToID: nil,
            replyTo: nil
        )

        XCTAssertEqual(message.callRecord?.callType, .video)
        XCTAssertEqual(message.callRecord?.status, .completed(duration: "00:19"))
    }

    func testCallQualityReportUsesBoundedPrimitivePayload() throws {
        var inbound = CallQualityStreamReport()
        inbound.width = 720
        inbound.height = 1280
        inbound.fps = 29.8
        inbound.bitrateBps = 2_650_000
        inbound.packetsLost = 2
        let report = CallQualityReport(
            appBuild: "8",
            sampleCount: 4,
            outbound: nil,
            inbound: inbound,
            iceTransport: "turn_udp",
            relay: true
        )

        XCTAssertEqual(report.body["app_build"] as? String, "8")
        XCTAssertEqual(report.body["sample_count"] as? Int, 4)
        let payload = try XCTUnwrap(report.body["inbound"] as? [String: Any])
        XCTAssertEqual(payload["width"] as? Int, 720)
        XCTAssertEqual(payload["bitrate_bps"] as? Int, 2_650_000)
        XCTAssertNil(payload["quality_limitation_reason"])
        XCTAssertEqual(report.body["ice_transport"] as? String, "turn_udp")
        XCTAssertEqual(report.body["relay"] as? Bool, true)
    }

    func testGroupCallStatusPreservesCallIdentity() throws {
        let data = #"""
        {
          "active": true,
          "call_id": "group-call-123",
          "room_name": "group_room_123",
          "call_type": "video",
          "participant_count": 3
        }
        """#.data(using: .utf8)!

        let response = try JSONDecoder().decode(GroupCallStatusResponse.self, from: data)

        XCTAssertEqual(response.callID, "group-call-123")
        XCTAssertEqual(response.roomName, "group_room_123")
        XCTAssertEqual(response.participantCount, 3)
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

    func testAgentSummaryPageDecodesProfilePaginationContract() throws {
        let json = #"""
        {
          "agents": [{
            "agent_id": "agent-profile-1",
            "visibility": "public",
            "status": "published",
            "profile": {
              "name": "旅行助手",
              "tagline": "一起出发"
            }
          }],
          "has_more": true,
          "next_cursor": "next-page"
        }
        """#.data(using: .utf8)!

        let page = try JSONDecoder().decode(AgentSummaryPage.self, from: json)

        XCTAssertEqual(page.agents.map(\.id), ["agent-profile-1"])
        XCTAssertTrue(page.hasMore)
        XCTAssertEqual(page.nextCursor, "next-page")
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

final class CallParticipantDeparturePolicyTests: XCTestCase {
    func testGroupCallWaitsForFirstRemoteParticipant() {
        XCTAssertFalse(
            CallParticipantDeparturePolicy.shouldScheduleAutoExit(
                isGroupCall: true,
                hasObservedRemoteParticipant: false,
                remoteParticipantCount: 0
            )
        )
    }

    func testGroupCallAutoExitsAfterLastRemoteParticipantLeaves() {
        XCTAssertTrue(
            CallParticipantDeparturePolicy.shouldScheduleAutoExit(
                isGroupCall: true,
                hasObservedRemoteParticipant: true,
                remoteParticipantCount: 0
            )
        )
    }

    func testCallStaysOpenWhileAnyRemoteParticipantRemains() {
        XCTAssertFalse(
            CallParticipantDeparturePolicy.shouldScheduleAutoExit(
                isGroupCall: true,
                hasObservedRemoteParticipant: true,
                remoteParticipantCount: 1
            )
        )
    }

    func testDirectCallStillAutoExitsWithoutGroupJoinHistory() {
        XCTAssertTrue(
            CallParticipantDeparturePolicy.shouldScheduleAutoExit(
                isGroupCall: false,
                hasObservedRemoteParticipant: false,
                remoteParticipantCount: 0
            )
        )
    }
}

extension APIResponseContractTests {
    func testRedPacketMessageNeverSerializesAmount() throws {
        let payload = ChatMoneyPayload(
            assetID: "rp-1",
            kind: .redPacket,
            scope: .group,
            mode: .lucky,
            senderID: "u1",
            amount: 9_999,
            packetCount: 3
        )

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try JSONEncoder().encode(payload)) as? [String: Any]
        )
        XCTAssertNil(payload.amount)
        XCTAssertNil(object["amount"])
        XCTAssertEqual(object["asset_id"] as? String, "rp-1")
    }

    func testRedPacketDecoderDropsAccidentallyLeakedAmount() throws {
        let json = #"{"asset_id":"rp-2","kind":"red_packet","scope":"dm","mode":"direct","sender_id":"u1","amount":888,"status":"pending"}"#
        let payload = try JSONDecoder().decode(ChatMoneyPayload.self, from: Data(json.utf8))

        XCTAssertNil(payload.amount)
        XCTAssertEqual(payload.schemaVersion, 1)
        XCTAssertEqual(payload.version, 1)
    }

    func testTransferMessageKeepsPublicAmount() throws {
        let payload = ChatMoneyPayload(
            assetID: "tr-1",
            kind: .transfer,
            scope: .direct,
            senderID: "u1",
            recipientID: "u2",
            amount: 321
        )
        let decoded = try JSONDecoder().decode(ChatMoneyPayload.self, from: JSONEncoder().encode(payload))

        XCTAssertEqual(decoded.amount, 321)
        XCTAssertEqual(decoded.kind, .transfer)
    }

    func testAllChatMoneyModesAndStatusesDecodeFromContractValues() throws {
        for mode in RedPacketMode.allCases {
            let encoded = try JSONEncoder().encode(mode)
            XCTAssertEqual(try JSONDecoder().decode(RedPacketMode.self, from: encoded), mode)
        }
        for raw in ["pending", "partial", "completed", "accepted", "returned", "expired_refunded"] {
            let status = try JSONDecoder().decode(ChatMoneyStatus.self, from: Data("\"\(raw)\"".utf8))
            XCTAssertEqual(status.rawValue, raw)
        }
    }

    func testRedPacketOpenPolicyAlwaysRejectsCompletedOrEmptySnapshots() throws {
        let completedPayload = ChatMoneyPayload(
            assetID: "rp-completed",
            kind: .redPacket,
            scope: .group,
            mode: .lucky,
            senderID: "u1",
            packetCount: 2,
            claimedCount: 2,
            status: .completed,
            version: 3
        )
        let stalePartialPayload = ChatMoneyPayload(
            assetID: "rp-full-count",
            kind: .redPacket,
            scope: .group,
            mode: .lucky,
            senderID: "u1",
            packetCount: 2,
            claimedCount: 2,
            status: .partial,
            version: 2
        )

        XCTAssertFalse(
            ChatMoneyRedPacketPresentationPolicy.shouldShowEnvelope(
                payload: completedPayload,
                isSender: false,
                hasLocalClaim: false
            )
        )
        XCTAssertFalse(
            ChatMoneyRedPacketPresentationPolicy.shouldShowEnvelope(
                payload: stalePartialPayload,
                isSender: false,
                hasLocalClaim: false
            )
        )

        let incomingPendingPayloadWithStaleSender = ChatMoneyPayload(
            assetID: "rp-incoming-stale-sender",
            kind: .redPacket,
            scope: .direct,
            mode: .direct,
            senderID: "u2",
            packetCount: 1,
            claimedCount: 0,
            status: .pending,
            version: 1
        )
        XCTAssertTrue(
            ChatMoneyRedPacketPresentationPolicy.shouldShowEnvelope(
                payload: incomingPendingPayloadWithStaleSender,
                isSender: false,
                hasLocalClaim: false
            ),
            "An incoming message must not be treated as outgoing only because the embedded sender snapshot is stale."
        )
        XCTAssertTrue(
            ChatMoneyRedPacketPresentationPolicy.shouldShowEnvelope(
                payload: incomingPendingPayloadWithStaleSender,
                isSender: true,
                hasLocalClaim: false
            ),
            "A still-open outgoing packet should show a non-claimable sender envelope before its details."
        )

        func detail(
            status: String,
            remainingCount: Int,
            canClaim: Bool = true,
            scope: String = "group",
            mode: String = "lucky"
        ) throws -> ChatMoneyDetail {
            let object: [String: Any] = [
                "asset_id": "rp-detail",
                "kind": "red_packet",
                "scope": scope,
                "mode": mode,
                "sender_id": "u1",
                "packet_count": 2,
                "claimed_count": remainingCount == 0 ? 2 : 1,
                "status": status,
                "can_claim": canClaim,
                "can_accept": false,
                "can_return": false,
                "claims": [],
                "version": 4,
                "viewer_state": "claimable",
                "remaining_count": remainingCount
            ]
            return try JSONDecoder().decode(
                ChatMoneyDetail.self,
                from: JSONSerialization.data(withJSONObject: object)
            )
        }

        XCTAssertFalse(
            ChatMoneyRedPacketPresentationPolicy.shouldShowEnvelope(
                detail: try detail(status: "completed", remainingCount: 0),
                viewerID: "u2",
                isSender: false,
                hasLocalClaim: false
            )
        )
        XCTAssertFalse(
            ChatMoneyRedPacketPresentationPolicy.shouldShowEnvelope(
                detail: try detail(status: "partial", remainingCount: 0),
                viewerID: "u2",
                isSender: false,
                hasLocalClaim: false
            )
        )
        XCTAssertTrue(
            ChatMoneyRedPacketPresentationPolicy.shouldShowEnvelope(
                detail: try detail(status: "partial", remainingCount: 1),
                viewerID: "u2",
                isSender: false,
                hasLocalClaim: false
            )
        )
        XCTAssertTrue(
            ChatMoneyRedPacketPresentationPolicy.shouldShowEnvelope(
                detail: try detail(
                    status: "partial",
                    remainingCount: 1,
                    canClaim: false
                ),
                viewerID: "u1",
                isSender: true,
                hasLocalClaim: false
            ),
            "The sender envelope must remain visible without depending on can_claim."
        )
        XCTAssertTrue(
            ChatMoneyRedPacketPresentationPolicy.canShowOpenAction(
                detail: try detail(status: "partial", remainingCount: 1),
                isSender: true
            ),
            "A group lucky/equal red-packet sender remains an eligible group member."
        )
        XCTAssertFalse(
            ChatMoneyRedPacketPresentationPolicy.canShowOpenAction(
                detail: try detail(
                    status: "pending",
                    remainingCount: 1,
                    scope: "dm",
                    mode: "direct"
                ),
                isSender: true
            )
        )
        XCTAssertFalse(
            ChatMoneyRedPacketPresentationPolicy.canShowOpenAction(
                detail: try detail(
                    status: "pending",
                    remainingCount: 1,
                    scope: "group",
                    mode: "exclusive"
                ),
                isSender: true
            )
        )
        XCTAssertFalse(
            ChatMoneyRedPacketPresentationPolicy.shouldShowEnvelope(
                detail: try detail(status: "partial", remainingCount: 1),
                viewerID: "u2",
                isSender: false,
                hasLocalClaim: true
            )
        )
    }

    func testDeliveryMatcherCorrelatesChatMoneyByStableAssetID() {
        let http = #"{"asset_id":"rp-stable","kind":"red_packet","scope":"dm","mode":"direct","sender_id":"u1","status":"pending","version":1}"#
        let socket = #"{"asset_id":"rp-stable","kind":"red_packet","scope":"dm","mode":"direct","sender_id":"u1","status":"completed","version":2}"#

        XCTAssertTrue(MessageDeliveryMatcher.contentsMatch(type: "red_packet", lhs: http, rhs: socket))
    }

    @MainActor
    func testChatMoneyStoreRejectsDuplicateAndOutOfOrderEvents() {
        let store = ChatMoneyStore(service: MockChatMoneyService())
        let newest = ChatMoneyPayload(
            assetID: "rp-order",
            kind: .redPacket,
            scope: .group,
            mode: .lucky,
            senderID: "u1",
            packetCount: 2,
            claimedCount: 2,
            status: .completed,
            version: 3
        )
        let stale = ChatMoneyPayload(
            assetID: "rp-order",
            kind: .redPacket,
            scope: .group,
            mode: .lucky,
            senderID: "u1",
            packetCount: 2,
            claimedCount: 1,
            status: .partial,
            version: 2
        )

        store.apply(newest)
        store.apply(stale)
        store.apply(newest)

        XCTAssertEqual(store.payloads["rp-order"]?.version, 3)
        XCTAssertEqual(store.payloads["rp-order"]?.status, .completed)
    }

    @MainActor
    func testChatMoneyConfigurationFailsClosedUntilBackendConfigurationLoads() async {
        let store = ChatMoneyStore(service: MockChatMoneyService())

        XCTAssertFalse(store.configuration.redPacketEnabled)
        XCTAssertFalse(store.configuration.transferEnabled)

        await store.loadConfiguration()

        XCTAssertTrue(store.configuration.redPacketEnabled)
        XCTAssertTrue(store.configuration.transferEnabled)
        XCTAssertTrue(store.configuration.eligibility.eligible)
    }

    @MainActor
    func testSuccessfulRedPacketClaimPersistsViewerReceiptAndBlocksDuplicateRequest() async throws {
        let suiteName = "ChatMoneyClaimReceiptTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let service = MockChatMoneyService()
        let store = ChatMoneyStore(service: service, defaults: defaults)
        await store.loadConfiguration()

        let assetID = "rp-claim-receipt"
        _ = try await store.createRedPacket(CreateRedPacketRequest(
            clientMessageID: assetID,
            scope: .group,
            receiverID: nil,
            groupID: 42,
            recipientID: nil,
            recipientName: nil,
            mode: .lucky,
            totalAmount: 30,
            amountPerPacket: nil,
            packetCount: 3,
            greeting: "test"
        ))

        _ = try await store.claim(assetID: assetID)
        XCTAssertTrue(store.hasViewerClaimed(assetID: assetID))

        let refreshed = try await store.loadDetail(assetID: assetID, force: true)
        XCTAssertFalse(refreshed.canClaim)
        XCTAssertEqual(refreshed.claims.count, 1)
        XCTAssertEqual(refreshed.claims.first?.amount, 30)
        XCTAssertFalse(refreshed.claims.first?.nickname.isEmpty ?? true)

        do {
            _ = try await store.claim(assetID: assetID)
            XCTFail("A locally receipted claim must not send a second request")
        } catch let APIError.serverError(code, _) {
            XCTAssertEqual(code, 409)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    @MainActor
    func testTransferAcceptPersistsTerminalStateAndBlocksConflictingReturn() async throws {
        let suiteName = "ChatMoneyTransferReceiptTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let service = MockChatMoneyService()
        let store = ChatMoneyStore(service: service, defaults: defaults)
        await store.loadConfiguration()

        let assetID = "tr-terminal-receipt"
        _ = try await store.createTransfer(CreateTransferRequest(
            clientMessageID: assetID,
            scope: .direct,
            receiverID: "recipient",
            groupID: nil,
            recipientID: "recipient",
            recipientName: "Recipient",
            amount: 88,
            note: "test"
        ))

        let accepted = try await store.accept(assetID: assetID)
        XCTAssertEqual(accepted.detail.status, .accepted)
        XCTAssertFalse(accepted.detail.canAccept)
        XCTAssertFalse(accepted.detail.canReturn)
        XCTAssertTrue(store.hasFinalizedTransfer(assetID: assetID))

        let refreshed = try await store.loadDetail(assetID: assetID, force: true)
        XCTAssertEqual(refreshed.status, .accepted)
        XCTAssertFalse(refreshed.canAccept)
        XCTAssertFalse(refreshed.canReturn)

        do {
            _ = try await store.returnTransfer(assetID: assetID)
            XCTFail("An accepted transfer must not be returnable")
        } catch let APIError.serverError(code, _) {
            XCTAssertEqual(code, 409)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testChatMoneyWalletTransactionSignsFollowLedgerDirection() throws {
        func transaction(type: String, amount: Int) throws -> WalletTransaction {
            let json = #"{"id":"tx","type":"\#(type)","currency":"cat_food","amount":\#(amount)}"#
            return try JSONDecoder().decode(WalletTransaction.self, from: Data(json.utf8))
        }

        XCTAssertEqual(try transaction(type: "red_packet_sent", amount: 30).signedAmountValue, -30)
        XCTAssertEqual(try transaction(type: "red_packet_received", amount: 12).signedAmountValue, 12)
        XCTAssertEqual(try transaction(type: "red_packet_refund", amount: 18).signedAmountValue, 18)
        XCTAssertEqual(try transaction(type: "transfer_sent", amount: 20).signedAmountValue, -20)
        XCTAssertEqual(try transaction(type: "transfer_received", amount: 20).signedAmountValue, 20)
        XCTAssertEqual(try transaction(type: "transfer_returned", amount: 20).signedAmountValue, 20)
    }

    func testChatMoneyConfigurationDecodesSplitLimitsAndKeepsLegacyFallback() throws {
        let splitJSON = #"""
        {
          "red_packet_enabled": true,
          "transfer_enabled": true,
          "limits": {
            "minimum_amount": 1,
            "maximum_amount": 20000,
            "red_packet_minimum_amount": 2,
            "red_packet_maximum_amount": 5000,
            "transfer_minimum_amount": 10,
            "transfer_maximum_amount": 10000,
            "maximum_packet_count": 100,
            "expires_after_seconds": 86400,
            "maximum_greeting_length": 60,
            "maximum_transfer_note_length": 20
          },
          "eligibility": {"eligible": true}
        }
        """#
        let configuration = try JSONDecoder().decode(
            ChatMoneyConfiguration.self,
            from: Data(splitJSON.utf8)
        )

        XCTAssertEqual(configuration.limits.minimumAmount(for: .redPacket), 2)
        XCTAssertEqual(configuration.limits.maximumAmount(for: .redPacket), 5_000)
        XCTAssertEqual(configuration.limits.minimumAmount(for: .transfer), 10)
        XCTAssertEqual(configuration.limits.maximumAmount(for: .transfer), 10_000)
        XCTAssertEqual(configuration.limits.maximumGreetingLength, 60)
        XCTAssertEqual(configuration.limits.maximumTransferNoteLength, 20)

        XCTAssertEqual(ChatMoneyLimits.fixture.minimumAmount(for: .redPacket), 1)
        XCTAssertEqual(ChatMoneyLimits.fixture.maximumAmount(for: .transfer), 20_000)
    }

    func testChatMoneyDetailDecodesViewerReasonAndLifecycleFields() throws {
        let json = #"""
        {
          "asset_id": "rp-detail",
          "kind": "red_packet",
          "scope": "group",
          "mode": "exclusive",
          "sender_id": "sender",
          "recipient_id": "recipient",
          "status": "pending",
          "can_claim": false,
          "can_accept": false,
          "can_return": false,
          "claims": [],
          "version": 4,
          "created_at": "2026-07-17T01:00:00Z",
          "finalized_at": null,
          "viewer_state": "not_designated",
          "unavailable_reason": "red_packet_recipient_only",
          "remaining_amount": 88,
          "remaining_count": 1
        }
        """#
        let detail = try JSONDecoder().decode(ChatMoneyDetail.self, from: Data(json.utf8))

        XCTAssertEqual(detail.viewerState, .notDesignated)
        XCTAssertEqual(detail.unavailableReason, .recipientOnly)
        XCTAssertEqual(detail.createdAt, "2026-07-17T01:00:00Z")
        XCTAssertNil(detail.finalizedAt)
        XCTAssertEqual(detail.remainingAmount, 88)
        XCTAssertEqual(detail.remainingCount, 1)
    }

    func testStructuredReceiptParsesAndLocalizesForEachPrivateChatRole() throws {
        let json = #"""
        {
          "event_id": "evt-1",
          "asset_id": "rp-1",
          "event_type": "red_packet_claimed",
          "actor_id": "recipient",
          "actor_name": "小猫",
          "sender_id": "sender",
          "sender_name": "大猫",
          "scope": "dm",
          "created_at": "2026-07-17T01:00:00Z"
        }
        """#
        let payload = try XCTUnwrap(ChatMoneyReceiptPayload.parse(json))

        XCTAssertTrue(payload.localizedText(viewerID: "recipient").contains("大猫"))
        XCTAssertTrue(payload.localizedText(viewerID: "sender").contains("小猫"))
        XCTAssertTrue(payload.localizedText(viewerID: "observer").contains("小猫"))
        XCTAssertFalse(json.contains("amount"))
    }

    func testTransferReceiptPlacesNamesInsideLocalizedMessage() throws {
        let json = #"""
        {
          "event_id": "evt-transfer",
          "asset_id": "transfer-1",
          "event_type": "transfer_returned",
          "actor_id": "recipient",
          "actor_name": "小猫",
          "sender_id": "sender",
          "sender_name": "大猫",
          "scope": "group",
          "created_at": "2026-07-17T01:00:00Z"
        }
        """#
        let payload = try XCTUnwrap(ChatMoneyReceiptPayload.parse(json))

        XCTAssertEqual(
            payload.localizedText(viewerID: "recipient"),
            L10n.tr("chatMoney.receipt.transferReturnedByMe", "大猫")
        )
        XCTAssertEqual(
            payload.localizedText(viewerID: "sender"),
            L10n.tr("chatMoney.receipt.transferReturnedMine", "小猫")
        )
        XCTAssertEqual(
            payload.localizedText(viewerID: "observer"),
            L10n.tr("chatMoney.receipt.transferReturnedBetween", "小猫", "大猫")
        )
    }

    func testExpiredRefundReceiptUsesTheMatchingAssetType() throws {
        let redPacketJSON = #"""
        {
          "event_id": "evt-red-packet-expired",
          "asset_id": "asset-1",
          "kind": "red_packet",
          "event_type": "asset_expired_refunded",
          "actor_id": "sender",
          "actor_name": "大猫",
          "sender_id": "sender",
          "sender_name": "大猫",
          "scope": "dm",
          "created_at": "2026-07-17T01:00:00Z"
        }
        """#
        let transferJSON = #"""
        {
          "event_id": "evt-transfer-expired",
          "asset_id": "asset-2",
          "asset": {"kind": "transfer"},
          "event_type": "asset_expired_refunded",
          "actor_id": "sender",
          "actor_name": "大猫",
          "sender_id": "sender",
          "sender_name": "大猫",
          "scope": "dm",
          "created_at": "2026-07-17T01:00:00Z"
        }
        """#

        let redPacket = try XCTUnwrap(ChatMoneyReceiptPayload.parse(redPacketJSON))
        let transfer = try XCTUnwrap(ChatMoneyReceiptPayload.parse(transferJSON))

        XCTAssertEqual(redPacket.kind, .redPacket)
        XCTAssertEqual(
            redPacket.localizedText(viewerID: "sender"),
            L10n.tr("chatMoney.receipt.redPacketExpiredRefunded")
        )
        XCTAssertEqual(transfer.kind, .transfer)
        XCTAssertEqual(
            transfer.localizedText(viewerID: "sender"),
            L10n.tr("chatMoney.receipt.transferExpiredRefunded")
        )
    }

    func testLegacyExpiredRefundReceiptInfersKindFromAssetID() throws {
        let redPacketJSON = #"""
        {"event_id":"evt-rp-legacy-expired","asset_id":"rp-legacy","event_type":"asset_expired_refunded","actor_id":"sender","actor_name":"大猫","sender_id":"sender","sender_name":"大猫","scope":"dm","created_at":"2026-07-17T01:00:00Z"}
        """#
        let transferJSON = #"""
        {"event_id":"evt-transfer-legacy-expired","asset_id":"transfer-legacy","event_type":"asset_expired_refunded","actor_id":"sender","actor_name":"大猫","sender_id":"sender","sender_name":"大猫","scope":"dm","created_at":"2026-07-17T01:00:00Z"}
        """#

        XCTAssertEqual(
            try XCTUnwrap(ChatMoneyReceiptPayload.parse(redPacketJSON))
                .localizedText(viewerID: "sender"),
            L10n.tr("chatMoney.receipt.redPacketExpiredRefunded")
        )
        XCTAssertEqual(
            try XCTUnwrap(ChatMoneyReceiptPayload.parse(transferJSON))
                .localizedText(viewerID: "sender"),
            L10n.tr("chatMoney.receipt.transferExpiredRefunded")
        )
    }

    func testStructuredReceiptRendersWhenHistoryDowngradesTypeOrDoubleEncodesContent() throws {
        let receiptJSON = #"""
        {"event_id":"evt-legacy","asset_id":"rp-legacy","event_type":"red_packet_claimed","actor_id":"recipient","actor_name":"小猫","sender_id":"sender","sender_name":"大猫","scope":"dm","created_at":"2026-07-17T01:00:00Z"}
        """#
        let encodedData = try JSONEncoder().encode(receiptJSON)
        let doubleEncoded = try XCTUnwrap(String(data: encodedData, encoding: .utf8))
        let message = Message(
            id: 78,
            senderID: "sender",
            receiverID: "recipient",
            msgType: "text",
            content: doubleEncoded,
            timestamp: "2026-07-17T01:00:00Z",
            replyToID: nil,
            replyTo: nil
        )

        XCTAssertEqual(message.chatMoneyReceiptPayload?.eventID, "evt-legacy")
        XCTAssertFalse(
            ChatMoneyPreview.text(content: doubleEncoded, msgType: "text")?
                .contains("event_id") ?? true
        )
    }

    func testStructuredReceiptParsesNestedCamelCasePayloadForGroupHistory() throws {
        let content = #"""
        {
          "payload": {
            "eventId": "evt-group",
            "assetId": "rp-group",
            "eventType": "red-packet-claimed",
            "actor": {"id": "u2", "nickname": "小猫"},
            "sender": {"id": "u1", "name": "大猫"},
            "scope": "group_chat",
            "createdAt": "2026-07-17T01:00:00Z"
          }
        }
        """#
        let message = GroupMessage(
            id: 79,
            groupID: 8,
            senderID: "u1",
            msgType: "system",
            content: content,
            timestamp: "2026-07-17T01:00:00Z",
            senderNickname: "大猫",
            senderAvatar: "",
            replyToID: nil,
            replyTo: nil,
            mentions: nil
        )

        let payload = try XCTUnwrap(message.chatMoneyReceiptPayload)
        XCTAssertEqual(payload.eventID, "evt-group")
        XCTAssertEqual(payload.scope, .group)
        XCTAssertEqual(payload.actorName, "小猫")
    }

    func testChatMoneyUpdateDecodesReceiptWithoutRestoringLeakedRedPacketAmount() throws {
        let receiptContent = #"""
        {"event_id":"evt-2","asset_id":"rp-2","event_type":"red_packet_claimed","actor_id":"u2","actor_name":"小猫","sender_id":"u1","sender_name":"大猫","scope":"dm","created_at":"2026-07-17T01:00:00Z"}
        """#
        let object: [String: Any] = [
            "asset": [
                "asset_id": "rp-2",
                "kind": "red_packet",
                "scope": "dm",
                "mode": "direct",
                "sender_id": "u1",
                "amount": 999,
                "status": "completed",
                "version": 2
            ],
            "receipt_message": [
                "id": 77,
                "sender_id": "u1",
                "receiver_id": "u2",
                "msg_type": "chat_money_receipt",
                "content": receiptContent,
                "timestamp": "2026-07-17T01:00:00Z"
            ]
        ]
        let event = try JSONDecoder().decode(
            ChatMoneyUpdateEvent.self,
            from: JSONSerialization.data(withJSONObject: object)
        )

        XCTAssertNil(event.payload.amount)
        XCTAssertEqual(event.payload.version, 2)
        XCTAssertEqual(event.directReceiptMessage?.chatMoneyReceiptPayload?.eventID, "evt-2")
    }

    func testChatMoneyMachineErrorsUseStableLocalizedPresentation() {
        XCTAssertEqual(
            ChatMoneyErrorText.message(
                for: APIError.serverError(
                    code: 422,
                    message: "chat_money_insufficient_balance"
                )
            ),
            L10n.tr("gift.insufficientBalance")
        )
        XCTAssertEqual(
            ChatMoneyErrorText.message(
                for: APIError.serverError(
                    code: 409,
                    message: "transfer_already_finalized"
                )
            ),
            L10n.tr("chatMoney.transfer.alreadyFinalized")
        )
    }
}
