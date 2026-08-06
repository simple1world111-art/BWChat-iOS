import XCTest
import UIKit
@testable import BBchat

final class APIResponseContractTests: XCTestCase {
    private struct ListData: Decodable, Equatable {
        let items: [Int]
    }

    private func liveSlot(
        id: String,
        userID: String,
        status: String = "waiting",
        role: String = "温柔的旅行摄影师",
        liveAvatarURL: String = ""
    ) throws -> OneToOneLiveSlot {
        let object: [String: Any] = [
            "id": id,
            "status": status,
            "character_setting": role,
            "live_avatar_url": liveAvatarURL,
            "created_at": "2026-07-23T12:00:00Z",
            "user": [
                "user_id": userID,
                "username": userID,
                "nickname": userID,
                "avatar_url": ""
            ]
        ]
        return try JSONDecoder().decode(
            OneToOneLiveSlot.self,
            from: JSONSerialization.data(withJSONObject: object)
        )
    }

    func testChatDisplayTextRemovesOnlyTrailingLineBreaks() {
        XCTAssertEqual("发送内容\n".trimmingTrailingLineBreaks, "发送内容")
        XCTAssertEqual("发送内容\r\n".trimmingTrailingLineBreaks, "发送内容")
        XCTAssertEqual("\n第一行\n第二行\n".trimmingTrailingLineBreaks, "\n第一行\n第二行")
        XCTAssertEqual("保留尾部空格 ".trimmingTrailingLineBreaks, "保留尾部空格 ")
    }

    func testChatImageCompressionBoundsHighResolutionPhoto() throws {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let image = UIGraphicsImageRenderer(
            size: CGSize(width: 3_600, height: 2_400),
            format: format
        ).image { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 3_600, height: 2_400))
            UIColor.systemPink.setFill()
            context.fill(CGRect(x: 1_200, y: 800, width: 1_200, height: 800))
        }
        let source = try XCTUnwrap(image.jpegData(compressionQuality: 1))

        let compressed = APIService.compressImageForUpload(source)
        let preparedImage = try XCTUnwrap(UIImage(data: compressed))

        XCTAssertLessThanOrEqual(compressed.count, 2_000_000)
        XCTAssertLessThanOrEqual(max(preparedImage.size.width, preparedImage.size.height), 1_200)
        XCTAssertEqual(Array(compressed.prefix(3)), [0xFF, 0xD8, 0xFF])
    }

    func testChatImageCompressionDoesNotReencodePreparedJPEG() throws {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let image = UIGraphicsImageRenderer(
            size: CGSize(width: 800, height: 600),
            format: format
        ).image { context in
            UIColor.systemGreen.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 800, height: 600))
        }
        let prepared = try XCTUnwrap(image.jpegData(compressionQuality: 0.7))

        XCTAssertEqual(APIService.compressImageForUpload(prepared), prepared)
    }

    func testIncomingChatThumbnailFallsBackToOriginalMediaPath() {
        let original = "/api/v1/images/u004/photo.jpg"

        XCTAssertEqual(
            ImageCacheManager.requestPaths(for: original, thumbnail: true),
            [original + "?thumb=1", original]
        )
        XCTAssertEqual(
            ImageCacheManager.requestPaths(for: original, thumbnail: false),
            [original]
        )
    }

    func testIncomingChatThumbnailPreservesExistingQueryBeforeFallback() {
        let original = "https://cdn.example.com/photo.jpg?signature=opaque"

        XCTAssertEqual(
            ImageCacheManager.requestPaths(for: original, thumbnail: true),
            [
                "https://cdn.example.com/photo.jpg?signature=opaque&thumb=1",
                original
            ]
        )
    }

    func testChatMediaPreviewRequestMatchesBubbleCacheKeys() throws {
        let imagePath = "/api/v1/images/u004/photo.jpg"
        let imageRequest = try XCTUnwrap(ChatMediaPreviewRequest.resolve(
            messageType: "photo",
            content: imagePath
        ))

        XCTAssertEqual(imageRequest.sourcePath, imagePath)
        XCTAssertEqual(imageRequest.cacheKey, imagePath + "?thumb=1")
        XCTAssertTrue(imageRequest.usesImageThumbnailEndpoint)

        let videoPath = "/api/v1/images/u004/clip.mp4"
        let videoRequest = try XCTUnwrap(ChatMediaPreviewRequest.resolve(
            messageType: "video",
            content: videoPath
        ))
        let videoThumbnailPath = ImageCacheManager.videoThumbnailCacheKey(
            for: videoPath
        )

        XCTAssertEqual(videoRequest.sourcePath, videoThumbnailPath)
        XCTAssertEqual(videoRequest.cacheKey, videoThumbnailPath)
        XCTAssertFalse(videoRequest.usesImageThumbnailEndpoint)

        let explicitPreview = "/api/v1/public/images/u004/photo-preview.jpg"
        let explicitRequest = try XCTUnwrap(ChatMediaPreviewRequest.resolve(
            messageType: "image",
            content: imagePath,
            thumbnailURL: explicitPreview
        ))
        XCTAssertEqual(explicitRequest.sourcePath, explicitPreview)
        XCTAssertEqual(explicitRequest.cacheKey, explicitPreview)
        XCTAssertFalse(explicitRequest.usesImageThumbnailEndpoint)
    }

    func testChatMediaMessagesDecodeAtomicThumbnailContract() throws {
        let directJSON = #"{"id":1,"sender_id":"u1","receiver_id":"u2","msg_type":"image","content":"/media/original.jpg","thumbnail_url":"/media/preview.jpg","timestamp":"2026-08-05T10:00:00Z"}"#.data(using: .utf8)!
        let direct = try JSONDecoder().decode(Message.self, from: directJSON)
        XCTAssertEqual(direct.content, "/media/original.jpg")
        XCTAssertEqual(direct.thumbnailURL, "/media/preview.jpg")

        let groupJSON = #"{"id":2,"group_id":9,"sender_id":"u1","msg_type":"video","content":"/media/original.mp4","preview_url":"/media/preview.jpg","timestamp":"2026-08-05T10:00:00Z"}"#.data(using: .utf8)!
        let group = try JSONDecoder().decode(GroupMessage.self, from: groupJSON)
        XCTAssertEqual(group.content, "/media/original.mp4")
        XCTAssertEqual(group.thumbnailURL, "/media/preview.jpg")
    }

    func testChatMediaPreviewRequestRejectsNonMediaAndInvalidPaths() {
        XCTAssertNil(ChatMediaPreviewRequest.resolve(
            messageType: "text",
            content: "/api/v1/images/u004/photo.jpg"
        ))
        XCTAssertNil(ChatMediaPreviewRequest.resolve(
            messageType: "image",
            content: "  "
        ))
    }

    func testOutgoingVideoDraftKeepsFileBackedSourceWithoutDataCopy() {
        let id = UUID()
        let sourceURL = URL(fileURLWithPath: "/tmp/outgoing-video.mp4")
        let draft = OutgoingMediaDraft(
            id: id,
            kind: .video,
            localFileURL: sourceURL,
            filename: "outgoing-video.mp4"
        )

        XCTAssertEqual(draft.id, id)
        XCTAssertEqual(draft.localFileURL, sourceURL)
        XCTAssertNil(draft.data)
        XCTAssertEqual(draft.pendingPreviewCacheKey, "pending-media:\(id.uuidString)")
    }

    func testOutgoingImageDraftUsesSameIdentityForPreparedPreview() {
        let id = UUID()
        let bytes = Data([0xFF, 0xD8, 0xFF])
        let draft = OutgoingMediaDraft(
            id: id,
            kind: .image,
            data: bytes,
            filename: "outgoing-image.jpg"
        )

        XCTAssertEqual(draft.id, id)
        XCTAssertEqual(draft.data, bytes)
        XCTAssertNil(draft.localFileURL)
        XCTAssertEqual(draft.pendingPreviewCacheKey, "pending-media:\(id.uuidString)")
    }

    func testPublicProfileCanOpenDirectConversationWhenServerSendingHintIsFalse() throws {
        let json = #"""
        {
          "user_id": " user-2 ",
          "nickname": "访客",
          "avatar_url": "",
          "can_message": false
        }
        """#.data(using: .utf8)!

        let profile = try JSONDecoder().decode(PublicProfile.self, from: json)

        XCTAssertFalse(profile.canMessage)
        XCTAssertTrue(profile.canOpenDirectConversation)
        XCTAssertEqual(profile.directConversationUserID, "user-2")
    }

    func testPublicProfileWithoutUserIDCannotOpenDirectConversation() {
        let profile = PublicProfile(userID: "  ", nickname: "访客", avatarURL: "")

        XCTAssertFalse(profile.canOpenDirectConversation)
        XCTAssertNil(profile.directConversationUserID)
    }

    func testChatHistoryRestoresImageReplyWhenOnlyReplyIDIsReturned() {
        let source = Message(
            id: 101,
            senderID: "friend-1",
            receiverID: "me",
            msgType: "image",
            content: "https://example.test/image.jpg",
            timestamp: "2026-07-22T10:00:00Z",
            replyToID: nil,
            replyTo: nil
        )
        let reply = Message(
            id: 102,
            senderID: "me",
            receiverID: "friend-1",
            msgType: "text",
            content: "收到",
            timestamp: "2026-07-22T10:00:01Z",
            replyToID: source.id,
            replyTo: nil
        )

        let directPreview = ChatHistoryReplyResolver.directReply(
            for: reply,
            messagesByID: [source.id: source, reply.id: reply]
        )
        XCTAssertEqual(directPreview?.msgType, "image")
        XCTAssertEqual(directPreview?.content, source.content)

        let groupSource = GroupMessage(
            id: 201,
            groupID: 9,
            senderID: "member-1",
            msgType: "image",
            content: "https://example.test/group-image.jpg",
            timestamp: "2026-07-22T10:00:00Z",
            senderNickname: "成员",
            senderAvatar: "",
            replyToID: nil,
            replyTo: nil,
            mentions: nil
        )
        let groupReply = GroupMessage(
            id: 202,
            groupID: 9,
            senderID: "me",
            msgType: "text",
            content: "好的",
            timestamp: "2026-07-22T10:00:01Z",
            senderNickname: "我",
            senderAvatar: "",
            replyToID: groupSource.id,
            replyTo: nil,
            mentions: nil
        )

        let groupPreview = ChatHistoryReplyResolver.groupReply(
            for: groupReply,
            messagesByID: [groupSource.id: groupSource, groupReply.id: groupReply]
        )
        XCTAssertEqual(groupPreview?.msgType, "image")
        XCTAssertEqual(groupPreview?.content, groupSource.content)
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
        XCTAssertNil(response.callType)
        XCTAssertNil(response.billingPolicy)
    }

    func testCallJoinResponseDecodesVoiceAndImmutableBillingSnapshot() throws {
        let data = #"""
        {
          "call_id": "call_voice_01",
          "room_name": "live_voice_01",
          "token": "livekit-token",
          "livekit_url": "https://livekit.example.test",
          "call_type": "voice",
          "billing_policy": {
            "currency": "spendable_balance",
            "free_seconds": 10,
            "unit_seconds": 60,
            "amount_per_unit": 100,
            "minimum_starting_balance": 100,
            "rounding": "started_unit"
          }
        }
        """#.data(using: .utf8)!

        let response = try JSONDecoder().decode(CallJoinResponse.self, from: data)

        XCTAssertEqual(response.callID, "call_voice_01")
        XCTAssertEqual(response.callType, .voice)
        XCTAssertEqual(response.billingPolicy, .fallback)
    }

    func testOneToOneLiveSlotPageDecodesRealLobbyPayload() throws {
        let data = #"""
        {
          "items": [
            {
              "id": "slot_01",
              "status": "waiting",
              "character_setting": "温柔的旅行摄影师",
              "created_at": "2026-07-22T11:30:00Z",
              "user": {
                "user_id": "u004",
                "username": "simple",
                "nickname": "Simple",
                "avatar_url": "https://example.test/simple.jpg"
              }
            }
          ],
          "next_cursor": "cursor_02"
        }
        """#.data(using: .utf8)!

        let page = try JSONDecoder().decode(OneToOneLiveSlotPage.self, from: data)

        XCTAssertEqual(page.items.count, 1)
        XCTAssertEqual(page.items[0].id, "slot_01")
        XCTAssertEqual(page.items[0].user.userID, "u004")
        XCTAssertEqual(page.items[0].user.username, "simple")
        XCTAssertEqual(page.items[0].user.gender, "")
        XCTAssertEqual(page.items[0].characterSetting, "温柔的旅行摄影师")
        XCTAssertEqual(page.nextCursor, "cursor_02")
        XCTAssertEqual(page.billingPolicy, .fallback)
        XCTAssertEqual(page.supportedCallTypes, [.video])
        XCTAssertFalse(page.liveAvatarUploadSupported)
        XCTAssertEqual(page.items[0].liveAvatarURL, "")
        XCTAssertNil(page.items[0].allowedCallTypes)
    }

    func testOneToOneLiveSlotDecodesHostAllowedCallTypesInStableOrder() throws {
        let data = #"""
        {
          "id": "slot_modes",
          "status": "waiting",
          "character_setting": "音乐主播",
          "allowed_call_types": ["video", "voice", "video"],
          "user": {
            "user_id": "host_modes",
            "username": "host",
            "avatar_url": ""
          }
        }
        """#.data(using: .utf8)!

        let slot = try JSONDecoder().decode(OneToOneLiveSlot.self, from: data)

        XCTAssertEqual(slot.allowedCallTypes, [.voice, .video])
        XCTAssertEqual(
            LiveSlotCallTypePolicy.effective(
                globallySupported: [.voice, .video],
                hostAllowed: slot.allowedCallTypes
            ),
            [.voice, .video]
        )
        XCTAssertEqual(
            LiveSlotCallTypePolicy.effective(
                globallySupported: [.voice, .video],
                hostAllowed: [.voice]
            ),
            [.voice]
        )
        XCTAssertEqual(
            LiveSlotCallTypePolicy.effective(
                globallySupported: [.voice, .video],
                hostAllowed: [.video]
            ),
            [.video]
        )
    }

    func testOneToOneLiveSlotPageDecodesGenderBillingAndAudioVideoCapabilities() throws {
        let data = #"""
        {
          "items": [
            {
              "id": "slot_01",
              "status": "waiting",
              "character_setting": "雨夜电台主播",
              "live_avatar_url": "https://example.test/live-avatar.jpg",
              "user": {
                "user_id": "host_01",
                "username": "radio",
                "nickname": "晚风",
                "avatar_url": "https://example.test/avatar.jpg",
                "gender": "female"
              }
            }
          ],
          "billing_policy": {
            "currency": "spendable_balance",
            "free_seconds": "10",
            "unit_seconds": 60,
            "amount_per_unit": "100",
            "minimum_starting_balance": 100,
            "rounding": "started_unit"
          },
          "supported_call_types": ["voice", "video"],
          "live_avatar_upload_supported": true
        }
        """#.data(using: .utf8)!

        let page = try JSONDecoder().decode(OneToOneLiveSlotPage.self, from: data)

        XCTAssertEqual(page.items.first?.user.gender, "female")
        XCTAssertEqual(
            page.items.first?.liveAvatarURL,
            "https://example.test/live-avatar.jpg"
        )
        XCTAssertEqual(page.billingPolicy, .fallback)
        XCTAssertEqual(page.supportedCallTypes, [.voice, .video])
        XCTAssertTrue(page.liveAvatarUploadSupported)
    }

    func testOneToOneLiveSlotPageAcceptsLegacySlotsAndHostKeys() throws {
        let data = #"""
        {
          "slots": [
            {
              "id": 17,
              "status": "waiting",
              "character_setting": "摄影师",
              "host": {
                "user_id": 4,
                "username": "simple",
                "avatar_url": ""
              }
            }
          ]
        }
        """#.data(using: .utf8)!

        let page = try JSONDecoder().decode(OneToOneLiveSlotPage.self, from: data)

        XCTAssertEqual(page.items.first?.id, "17")
        XCTAssertEqual(page.items.first?.user.userID, "4")
        XCTAssertEqual(page.items.first?.user.gender, "")
        XCTAssertNil(page.nextCursor)
        XCTAssertEqual(page.billingPolicy, .fallback)
        XCTAssertEqual(page.supportedCallTypes, [.video])
        XCTAssertFalse(page.liveAvatarUploadSupported)
        XCTAssertEqual(page.items.first?.liveAvatarURL, "")
    }

    func testOneToOneLiveAvatarUploadDecodesAssetAndDisplayURL() throws {
        let upload = try JSONDecoder().decode(
            OneToOneLiveAvatarUpload.self,
            from: #"""
            {
              "asset_id": "live_avatar_01",
              "live_avatar_url": "https://example.test/live-avatar-01.jpg"
            }
            """#.data(using: .utf8)!
        )

        XCTAssertEqual(upload.assetID, "live_avatar_01")
        XCTAssertEqual(
            upload.liveAvatarURL,
            "https://example.test/live-avatar-01.jpg"
        )
    }

    func testLiveInvitationDefaultsLegacyPayloadToVideo() throws {
        let response = try JSONDecoder().decode(
            LiveCallInvitationResponse.self,
            from: #"{"call_id":"call_legacy"}"#.data(using: .utf8)!
        )

        XCTAssertEqual(response.callID, "call_legacy")
        XCTAssertEqual(response.callType, .video)
        XCTAssertNil(response.billingPolicy)
    }

    func testLiveInvitationDecodesServerConfirmedVoicePolicy() throws {
        let response = try JSONDecoder().decode(
            LiveCallInvitationResponse.self,
            from: #"""
            {
              "call_id": "call_voice",
              "call_type": "voice",
              "billing_policy": {
                "currency": "spendable_balance",
                "free_seconds": 5,
                "unit_seconds": 30,
                "amount_per_unit": 40,
                "minimum_starting_balance": 40,
                "rounding": "started_unit"
              }
            }
            """#.data(using: .utf8)!
        )

        XCTAssertEqual(response.callType, .voice)
        XCTAssertEqual(response.billingPolicy?.freeSeconds, 5)
        XCTAssertEqual(response.billingPolicy?.unitSeconds, 30)
        XCTAssertEqual(response.billingPolicy?.amountPerUnit, 40)
    }

    func testLiveExperienceInvitationRequestUsesExactCardContractAndStableIdempotencyKey() {
        let key = UUID(uuidString: "E02A86E8-D49B-4DA0-AB7C-43983803C910")!
        let request = LiveCallInvitationRequest(
            callType: .voice,
            paymentMethod: .experienceCard(.fiveMinutes),
            idempotencyKey: key
        )

        XCTAssertEqual(request.body["call_type"] as? String, "voice")
        XCTAssertEqual(request.body["payment_method"] as? String, "prop_card")
        XCTAssertEqual(
            request.body["prop_definition_id"] as? String,
            "live_experience_card_5m"
        )
        XCTAssertEqual(request.idempotencyHeaderValue, key.uuidString)
        XCTAssertFalse(request.paymentMethod.requiresStartingBalance)

        let legacy = LiveCallInvitationRequest(
            callType: .video,
            paymentMethod: .spendableBalance,
            idempotencyKey: key
        )
        XCTAssertEqual(legacy.body.count, 1)
        XCTAssertEqual(legacy.body["call_type"] as? String, "video")
        XCTAssertTrue(legacy.paymentMethod.requiresStartingBalance)
    }

    func testLiveInvitationDecodesReservedExperienceSnapshot() throws {
        let response = try JSONDecoder().decode(
            LiveCallInvitationResponse.self,
            from: #"""
            {
              "call_id": "call_experience_5m",
              "call_type": "video",
              "live_experience": {
                "prop_definition_id": "live_experience_card_5m",
                "duration_seconds": 300,
                "status": "reserved",
                "auto_continue_payment_method": "spendable_balance",
                "host_earning_enabled": false,
                "reserved_prop": {
                  "inventory_id": "inventory-live-5m",
                  "definition_id": "live_experience_card_5m",
                  "remaining_quantity": 1
                }
              }
            }
            """#.data(using: .utf8)!
        )

        XCTAssertEqual(response.liveExperience?.cardKind, .fiveMinutes)
        XCTAssertEqual(response.liveExperience?.durationSeconds, 300)
        XCTAssertEqual(response.liveExperience?.status, .reserved)
        XCTAssertEqual(response.liveExperience?.autoContinuePaymentMethod, "spendable_balance")
        XCTAssertEqual(response.liveExperience?.hostEarningEnabled, false)
        XCTAssertEqual(response.liveExperience?.reservedProp?.remainingQuantity, 1)
    }

    func testOneToOneLiveSlotCreationAcceptsNestedSlotEnvelope() throws {
        let data = #"""
        {
          "slot": {
            "id": "slot_01",
            "status": "waiting",
            "character_setting": "温柔的旅行摄影师",
            "user": {
              "user_id": "u004",
              "username": "simple",
              "avatar_url": ""
            }
          }
        }
        """#.data(using: .utf8)!

        let creation = try JSONDecoder().decode(OneToOneLiveSlotCreationData.self, from: data)

        XCTAssertEqual(creation.slot.id, "slot_01")
        XCTAssertEqual(creation.slot.user.userID, "u004")
    }

    func testOneToOneLiveSlotCreationStillAcceptsDirectSlot() throws {
        let data = #"""
        {
          "id": "slot_02",
          "status": "waiting",
          "character_setting": "摄影师",
          "user": {
            "user_id": "u004",
            "username": "simple",
            "avatar_url": ""
          }
        }
        """#.data(using: .utf8)!

        let creation = try JSONDecoder().decode(OneToOneLiveSlotCreationData.self, from: data)

        XCTAssertEqual(creation.slot.id, "slot_02")
    }

    func testLiveHostReturnsToLobbyAfterAcceptedIncomingLiveCallEnds() {
        XCTAssertTrue(
            LiveHostCallEndPolicy.shouldReturnToLobby(
                isLivePairCall: true,
                isOutgoing: false
            )
        )
    }

    func testLiveHostReturnPolicyIgnoresViewerAndRegularCallState() {
        XCTAssertFalse(
            LiveHostCallEndPolicy.shouldReturnToLobby(
                isLivePairCall: true,
                isOutgoing: true
            )
        )
        XCTAssertFalse(
            LiveHostCallEndPolicy.shouldReturnToLobby(
                isLivePairCall: false,
                isOutgoing: false
            )
        )
    }

    func testAgentLiveInvitationExtractsRequestedRoleForHostBanner() {
        XCTAssertEqual(
            LiveCallInvitationMetadata.requestedRoleSetting(
                from: [
                    "invitation_source": "agent_match",
                    "match_id": "match_01",
                    "role_setting": "  温柔的旅行摄影师  "
                ]
            ),
            "温柔的旅行摄影师"
        )
        XCTAssertEqual(
            LiveCallInvitationMetadata.requestedRoleSetting(
                from: [
                    "invitation_source": "agent_match",
                    "match_id": "match_02",
                    "character_setting": "古风客栈老板"
                ]
            ),
            "古风客栈老板"
        )
    }

    func testManualLiveInvitationDoesNotTreatHostSlotRoleAsRequestedRole() {
        XCTAssertNil(
            LiveCallInvitationMetadata.requestedRoleSetting(
                from: [
                    "invitation_source": "live_lobby",
                    "character_setting": "主播自己的直播设定",
                    "role_setting": "兼容字段也仍然是主播自己的直播设定"
                ]
            )
        )
    }

    func testLiveInviteCompatibilityKeepsRegularCallInviteOnRegularCallPath() {
        XCTAssertFalse(
            LiveCallWebSocketCompatibility.isLegacyLiveInvite([
                "call_id": "regular_call",
                "room_name": "regular_room",
                "caller_id": "user_01"
            ])
        )
    }

    func testLiveInviteCompatibilityRecognizesLegacyAndNestedLivePayloads() {
        XCTAssertTrue(
            LiveCallWebSocketCompatibility.isLegacyLiveInvite([
                "call_id": "live_call_01",
                "slot_id": "slot_01"
            ])
        )
        XCTAssertTrue(
            LiveCallWebSocketCompatibility.isLegacyLiveInvite([
                "invitation": [
                    "call_id": "live_call_02",
                    "slot_id": "slot_02"
                ]
            ])
        )
        XCTAssertEqual(
            LiveCallWebSocketCompatibility.normalizedType(
                " one-to-one-live.call_invite "
            ),
            "one_to_one_live.call_invite"
        )
    }

    func testIncomingLiveInviteNormalizesFlatPayload() throws {
        let payload = try XCTUnwrap(
            LiveCallIncomingInvitationPayload.normalize([
                "call_id": "call_flat",
                "slot_id": "slot_flat",
                "caller_id": "caller_flat",
                "caller_username": "Ming",
                "call_type": "video"
            ])
        )

        XCTAssertEqual(payload["call_id"] as? String, "call_flat")
        XCTAssertEqual(payload["caller_id"] as? String, "caller_flat")
        XCTAssertEqual(payload["caller_username"] as? String, "Ming")
        XCTAssertEqual(payload["call_type"] as? String, "video")
    }

    func testIncomingLiveInviteNormalizesNestedPayload() throws {
        let payload = try XCTUnwrap(
            LiveCallIncomingInvitationPayload.normalize([
                "invitation": [
                    "id": "call_nested",
                    "slotId": "slot_nested",
                    "media_type": "video"
                ],
                "caller": [
                    "id": "caller_nested",
                    "nickname": "小明",
                    "avatar_url": "https://example.test/ming.jpg",
                    "character_setting": "旅行摄影师"
                ]
            ])
        )

        XCTAssertEqual(payload["call_id"] as? String, "call_nested")
        XCTAssertEqual(payload["slot_id"] as? String, "slot_nested")
        XCTAssertEqual(payload["caller_id"] as? String, "caller_nested")
        XCTAssertEqual(payload["caller_username"] as? String, "小明")
        XCTAssertEqual(
            payload["caller_avatar_url"] as? String,
            "https://example.test/ming.jpg"
        )
        XCTAssertEqual(payload["character_setting"] as? String, "旅行摄影师")
        XCTAssertEqual(payload["call_type"] as? String, "video")
    }

    func testAcceptedLiveEventIsDeferredUntilInviteResponseProvidesCallID() {
        XCTAssertEqual(
            LiveCallEventCorrelation.result(
                for: [
                    "call_id": "call_second",
                    "slot_id": "slot_host",
                    "host_id": "host_1"
                ],
                isOutgoingInvitation: true,
                invitationCallID: nil,
                invitationSlotID: "slot_host",
                peerUserID: "host_1"
            ),
            .deferUntilCallID("call_second")
        )
    }

    func testAcceptedLiveEventHandlesMatchingSecondCallAfterCallIDArrives() {
        XCTAssertEqual(
            LiveCallEventCorrelation.result(
                for: [
                    "call_id": "call_second",
                    "slot_id": "slot_host",
                    "host_id": "host_1"
                ],
                isOutgoingInvitation: true,
                invitationCallID: " call_second ",
                invitationSlotID: "slot_host",
                peerUserID: "host_1"
            ),
            .handle("call_second")
        )
    }

    func testLiveEventCorrelationRejectsStaleOrAgentMatchEvents() {
        XCTAssertEqual(
            LiveCallEventCorrelation.result(
                for: [
                    "call_id": "call_first",
                    "slot_id": "slot_host",
                    "host_id": "host_1"
                ],
                isOutgoingInvitation: true,
                invitationCallID: "call_second",
                invitationSlotID: "slot_host",
                peerUserID: "host_1"
            ),
            .ignore
        )
        XCTAssertEqual(
            LiveCallEventCorrelation.result(
                for: [
                    "match_id": "match_agent",
                    "call_id": "call_agent",
                    "slot_id": "slot_host"
                ],
                isOutgoingInvitation: true,
                invitationCallID: nil,
                invitationSlotID: "slot_host",
                peerUserID: "host_1"
            ),
            .ignore
        )
    }

    func testOneToOneLiveCallStateSupportsAcceptedAndTerminalReconciliation() throws {
        let accepted = try JSONDecoder().decode(
            OneToOneLiveCallState.self,
            from: #"""
            {
              "call_id": "call_second",
              "slot_id": "slot_host",
              "status": "in_call",
              "expires_at": "2026-07-23T12:00:15Z",
              "accepted_at": "2026-07-23T12:00:04Z"
            }
            """#.data(using: .utf8)!
        )
        XCTAssertEqual(accepted.callID, "call_second")
        XCTAssertEqual(accepted.phase, .accepted)
        XCTAssertEqual(accepted.callType, .video)
        XCTAssertNil(accepted.billingPolicy)

        let ended = try JSONDecoder().decode(
            OneToOneLiveCallState.self,
            from: #"""
            {
              "call_id": "call_second",
              "status": "ended"
            }
            """#.data(using: .utf8)!
        )
        XCTAssertEqual(ended.phase, .terminal)
    }

    func testOneToOneLiveCallStateCarriesConfirmedMediaAndBillingSnapshot() throws {
        let state = try JSONDecoder().decode(
            OneToOneLiveCallState.self,
            from: #"""
            {
              "call_id": "call_voice",
              "status": "accepted",
              "call_type": "voice",
              "billing_policy": {
                "currency": "spendable_balance",
                "free_seconds": 10,
                "unit_seconds": 60,
                "amount_per_unit": 100,
                "minimum_starting_balance": 100,
                "rounding": "started_unit"
              }
            }
            """#.data(using: .utf8)!
        )

        XCTAssertEqual(state.phase, .accepted)
        XCTAssertEqual(state.callType, .voice)
        XCTAssertEqual(state.billingPolicy, .fallback)
    }

    func testLiveExperienceSnapshotRecoversFromCallStateAndFinalSettlement() throws {
        let state = try JSONDecoder().decode(
            OneToOneLiveCallState.self,
            from: #"""
            {
              "call_id": "call_experience_15m",
              "status": "in_call",
              "server_time": "2026-08-01T12:00:00Z",
              "live_experience": {
                "definition_id": "live_experience_card_15m",
                "duration_seconds": "900",
                "status": "active",
                "started_at": "2026-08-01T11:50:00Z",
                "experience_ends_at": "2026-08-01T12:05:00Z",
                "host_earning_enabled": false
              },
              "final_billing": {
                "experience_seconds_used": "600",
                "overage_units": 0,
                "total_charged": 0,
                "earned_gold_coins": 0,
                "consumed_prop": {
                  "inventory_id": "inventory-live-15m",
                  "definition_id": "live_experience_card_15m",
                  "remaining_quantity": 0
                }
              }
            }
            """#.data(using: .utf8)!
        )

        XCTAssertEqual(state.liveExperience?.cardKind, .fifteenMinutes)
        XCTAssertEqual(state.liveExperience?.status, .active)
        let recoveredRemaining = try XCTUnwrap(
            state.liveExperience?.displayRemainingSeconds(connectedDuration: 600)
        )
        XCTAssertTrue((299...300).contains(recoveredRemaining))
        XCTAssertEqual(state.finalBilling?.experienceSecondsUsed, 600)
        XCTAssertEqual(state.finalBilling?.overageUnits, 0)
        XCTAssertEqual(state.finalBilling?.totalCharged, 0)
        XCTAssertEqual(state.finalBilling?.earnedGoldCoins, 0)
        XCTAssertEqual(state.finalBilling?.consumedProp?.definitionID, "live_experience_card_15m")
    }

    func testLiveExperienceCountdownUsesServerClockAnchorInsteadOfDeviceWallClock() throws {
        let deviceReceiptTime = try XCTUnwrap(
            ISO8601DateFormatter().date(from: "2035-01-01T00:00:00Z")
        )
        let snapshot = LiveExperienceSnapshot(
            definitionID: LiveExperienceCardKind.fiveMinutes.definitionID,
            durationSeconds: 300,
            status: .active,
            endsAt: "2026-08-01T12:05:00Z",
            remainingSeconds: 299,
            serverTime: "2026-08-01T12:00:00Z",
            receivedAt: deviceReceiptTime
        )

        XCTAssertEqual(snapshot.displayRemainingSeconds(
            connectedDuration: 999,
            now: deviceReceiptTime.addingTimeInterval(60)
        ), 240)
    }

    func testLiveLobbySlotEventDecodesNestedSnapshotForRealtimeUpsert() {
        let payload = LiveLobbySlotEventPayload(
            data: [
                "event_id": "evt_slot_1",
                "slot": [
                    "id": "slot_1",
                    "status": "waiting",
                    "character_setting": "雨夜电台主播",
                    "user": [
                        "user_id": "host_1",
                        "username": "Miao",
                        "nickname": "喵喵",
                        "avatar_url": "https://example.com/avatar.jpg"
                    ]
                ]
            ]
        )

        XCTAssertEqual(payload.slotID, "slot_1")
        XCTAssertEqual(payload.userID, "host_1")
        XCTAssertEqual(payload.status, "waiting")
        XCTAssertEqual(payload.slot?.characterSetting, "雨夜电台主播")
    }

    func testLiveLobbyEndedEventDecodesTombstoneWithoutFullSlot() {
        let payload = LiveLobbySlotEventPayload(
            data: [
                "slot_id": "slot_ended",
                "host_user_id": "host_ended",
                "status": "ended"
            ]
        )

        XCTAssertEqual(payload.slotID, "slot_ended")
        XCTAssertEqual(payload.userID, "host_ended")
        XCTAssertEqual(payload.status, "ended")
        XCTAssertNil(payload.slot)
    }

    func testLiveCallTerminationPolicyRecognizesBalanceReasonsAndValidatesGrace() {
        XCTAssertTrue(
            LiveCallTerminationPolicy.isInsufficientBalance(
                ["end_reason": "INSUFFICIENT-BALANCE"]
            )
        )
        XCTAssertTrue(
            LiveCallTerminationPolicy.isInsufficientBalance(
                ["reason": "billing_insufficient"]
            )
        )
        XCTAssertFalse(
            LiveCallTerminationPolicy.isInsufficientBalance(
                ["reason": "remote_hangup"]
            )
        )
        XCTAssertEqual(
            LiveCallTerminationPolicy.graceNanoseconds(
                ["termination_grace_ms": 300]
            ),
            2_600_000_000
        )
        XCTAssertEqual(
            LiveCallTerminationPolicy.graceNanoseconds(
                ["termination_grace_ms": 6_000]
            ),
            2_600_000_000
        )
        XCTAssertEqual(
            LiveCallTerminationPolicy.graceNanoseconds(
                ["termination_grace_ms": 1_800]
            ),
            1_800_000_000
        )
        XCTAssertEqual(
            LiveCallTerminationPolicy.message(isPayer: true),
            "金币余额不足，本次视频即将结束"
        )
        XCTAssertEqual(
            LiveCallTerminationPolicy.message(isPayer: false),
            "对方余额不足，本次视频即将结束"
        )
    }

    func testLiveBusinessErrorsUseStableGentleMessages() {
        XCTAssertEqual(
            LiveCallBusinessErrorPolicy.message(
                code: "LIVE_HOST_CANNOT_CALL_OTHER_HOST",
                serverMessage: nil
            ),
            "正在直播，无法与其他在直播的人视频"
        )
        XCTAssertEqual(
            LiveCallBusinessErrorPolicy.message(
                code: "LIVE_SELF_CALL_FORBIDDEN",
                serverMessage: "Conflict"
            ),
            "这是你的直播，其他用户可以从这里与你连线"
        )
        XCTAssertEqual(
            LiveCallBusinessErrorPolicy.message(
                code: "LIVE_CALL_TYPE_NOT_ALLOWED",
                serverMessage: nil
            ),
            "该主播未开放这种连线方式"
        )
        XCTAssertFalse(
            LiveCallInitiationPolicy.canInitiate(isCurrentUserLive: true)
        )
        XCTAssertTrue(
            LiveCallInitiationPolicy.canInitiate(isCurrentUserLive: false)
        )
    }

    func testLiveTerminationBillingDetailsDoNotExposePayerBalanceToHost() {
        XCTAssertEqual(
            LiveCallTerminationPresentationPolicy.billingDetail(
                isPayer: true,
                chargedActivityCatFood: 100,
                chargedGoldCoins: 200,
                totalCharged: 300,
                earnedGoldCoins: nil,
                goldCoinBalanceAfter: 0,
                activityCatFoodBalanceAfter: 0,
                spendableBalanceAfter: 0
            ),
            [
                L10n.tr("live.billing.chargedActivityCatFood", 100),
                L10n.tr("live.billing.chargedGoldCoins", 200),
                L10n.tr("live.billing.totalCharged", 300),
                L10n.tr("live.billing.balanceAfter", 0, 0, 0)
            ].joined(separator: "\n")
        )
        XCTAssertNil(
            LiveCallTerminationPresentationPolicy.billingDetail(
                isPayer: false,
                chargedActivityCatFood: 100,
                chargedGoldCoins: 200,
                totalCharged: 300,
                earnedGoldCoins: nil,
                goldCoinBalanceAfter: 0,
                activityCatFoodBalanceAfter: 0,
                spendableBalanceAfter: 0
            )
        )
        XCTAssertEqual(
            LiveCallTerminationPresentationPolicy.billingDetail(
                isPayer: false,
                chargedActivityCatFood: 100,
                chargedGoldCoins: 200,
                totalCharged: 300,
                earnedGoldCoins: 300,
                goldCoinBalanceAfter: 0,
                activityCatFoodBalanceAfter: 0,
                spendableBalanceAfter: 0
            ),
            L10n.tr("live.billing.earnedGoldCoins", 300)
        )
    }

    func testLiveLobbyEventCursorRejectsDuplicatesAndOlderEvents() {
        var cursor = LiveLobbyEventCursor()
        let firstDate = ISO8601DateFormatter().date(
            from: "2026-07-23T12:00:02Z"
        )!
        let olderDate = ISO8601DateFormatter().date(
            from: "2026-07-23T12:00:01Z"
        )!
        let newerDate = ISO8601DateFormatter().date(
            from: "2026-07-23T12:00:03Z"
        )!

        XCTAssertTrue(
            cursor.shouldApply(eventID: "evt_1", slotID: "slot_1", occurredAt: firstDate)
        )
        XCTAssertFalse(
            cursor.shouldApply(eventID: "evt_1", slotID: "slot_1", occurredAt: firstDate)
        )
        XCTAssertFalse(
            cursor.shouldApply(eventID: "evt_old", slotID: "slot_1", occurredAt: olderDate)
        )
        XCTAssertTrue(
            cursor.shouldApply(eventID: "evt_new", slotID: "slot_1", occurredAt: newerDate)
        )
    }

    func testLiveLobbyAvailabilityMapsStatusAndFailsClosedForUnknownValues() {
        XCTAssertEqual(LiveLobbyAvailability(status: "waiting"), .available)
        XCTAssertEqual(LiveLobbyAvailability(status: "inviting"), .inviting)
        XCTAssertEqual(LiveLobbyAvailability(status: "connecting"), .busy)
        XCTAssertEqual(LiveLobbyAvailability(status: "in_call"), .busy)
        XCTAssertEqual(LiveLobbyAvailability(status: "unexpected_state"), .unknown)
        XCTAssertEqual(LiveLobbyAvailability(status: "ended"), .ended)

        XCTAssertTrue(LiveLobbyAvailability(status: "waiting").canReceiveCalls)
        XCTAssertFalse(LiveLobbyAvailability(status: "inviting").canReceiveCalls)
        XCTAssertFalse(LiveLobbyAvailability(status: "in_call").canReceiveCalls)
        XCTAssertFalse(LiveLobbyAvailability(status: "unexpected_state").canReceiveCalls)
    }

    func testLiveLobbySortsAvailableBeforeInvitingAndBusyWithoutReorderingTies() throws {
        let busyFirst = try liveSlot(id: "busy_1", userID: "u1", status: "in_call")
        let available = try liveSlot(id: "available", userID: "u2", status: "waiting")
        let inviting = try liveSlot(id: "inviting", userID: "u3", status: "inviting")
        let busySecond = try liveSlot(id: "busy_2", userID: "u4", status: "connecting")
        let unknown = try liveSlot(id: "unknown", userID: "u5", status: "checking")

        XCTAssertEqual(
            LiveLobbySlotPolicy.sorted([
                busyFirst,
                available,
                inviting,
                busySecond,
                unknown
            ]).map(\.id),
            ["available", "inviting", "unknown", "busy_1", "busy_2"]
        )
    }

    func testLobbySnapshotKeepsBusySlotsAndDropsOnlyEndedSlots() throws {
        let available = try liveSlot(id: "waiting", userID: "u1", status: "waiting")
        let inviting = try liveSlot(id: "inviting", userID: "u2", status: "inviting")
        let busy = try liveSlot(id: "busy", userID: "u3", status: "in_call")
        let ended = try liveSlot(id: "ended", userID: "u4", status: "ended")

        let merged = LiveLobbySnapshotMergePolicy.merge(
            snapshot: [busy, ended, inviting, available],
            current: [],
            slotMutationSequence: [:],
            requestStartingMutation: 0
        )

        XCTAssertEqual(merged.map(\.id), ["waiting", "inviting", "busy"])
    }

    func testOldLobbyRESTSnapshotCannotRestoreWebSocketEndedSlot() throws {
        let endedByWebSocket = try liveSlot(id: "slot_ended", userID: "me")
        let merged = LiveLobbySnapshotMergePolicy.merge(
            snapshot: [endedByWebSocket],
            current: [],
            slotMutationSequence: ["slot_ended": 2],
            requestStartingMutation: 1
        )

        XCTAssertTrue(merged.isEmpty)
    }

    func testNewerWebSocketWaitingSlotIncludingOwnSlotSurvivesRESTMerge() throws {
        let staleOwn = try liveSlot(
            id: "slot_me",
            userID: "me",
            role: "旧人物设定"
        )
        let updatedOwn = try liveSlot(
            id: "slot_me",
            userID: "me",
            role: "新人物设定"
        )
        let other = try liveSlot(id: "slot_other", userID: "other")

        let merged = LiveLobbySnapshotMergePolicy.merge(
            snapshot: [staleOwn, other],
            current: [updatedOwn],
            slotMutationSequence: ["slot_me": 3],
            requestStartingMutation: 2
        )

        XCTAssertEqual(merged.count, 2)
        XCTAssertEqual(
            merged.first(where: { $0.user.userID == "me" })?.characterSetting,
            "新人物设定"
        )
        XCTAssertNotNil(merged.first(where: { $0.user.userID == "other" }))
    }

    func testCurrentOwnedSlotEnvelopeDecodesWaitingAndNilStates() throws {
        let direct = #"""
        {
          "id": "slot_me",
          "status": "waiting",
          "character_setting": "旅行摄影师",
          "user": {
            "user_id": "me",
            "username": "Me",
            "nickname": "我",
            "avatar_url": ""
          }
        }
        """#.data(using: .utf8)!
        let nested = #"""
        {
          "slot": {
            "id": "slot_me",
            "status": "in_call",
            "character_setting": "旅行摄影师",
            "user": {
              "user_id": "me",
              "username": "Me",
              "nickname": "我",
              "avatar_url": ""
            }
          }
        }
        """#.data(using: .utf8)!
        let empty = #"{"slot": null}"#.data(using: .utf8)!

        XCTAssertEqual(
            try JSONDecoder().decode(
                OneToOneLiveCurrentSlotData.self,
                from: direct
            ).slot?.status,
            "waiting"
        )
        XCTAssertEqual(
            try JSONDecoder().decode(
                OneToOneLiveCurrentSlotData.self,
                from: nested
            ).slot?.status,
            "in_call"
        )
        XCTAssertNil(
            try JSONDecoder().decode(
                OneToOneLiveCurrentSlotData.self,
                from: empty
            ).slot
        )
    }

    func testLiveCallStateDecodesInsufficientTerminationAndFinalBilling() throws {
        let json = #"""
        {
          "call_id": "call_live_01",
          "slot_id": "slot_01",
          "status": "ending_insufficient_balance",
          "end_reason": "insufficient_balance",
          "termination_grace_ms": 2600,
          "final_billing": {
            "charged_units": "3",
            "charged_activity_cat_food": 100,
            "charged_gold_coins": 200,
            "total_charged": 300,
            "earned_gold_coins": 300,
            "gold_coin_balance_after": 0,
            "activity_cat_food_balance_after": 0,
            "spendable_balance_after": 0,
            "billing_status": "billing_insufficient"
          }
        }
        """#.data(using: .utf8)!

        let state = try JSONDecoder().decode(
            OneToOneLiveCallState.self,
            from: json
        )

        XCTAssertEqual(state.endReason, "insufficient_balance")
        XCTAssertEqual(state.terminationGraceMilliseconds, 2_600)
        XCTAssertEqual(state.finalBilling?.chargedUnits, 3)
        XCTAssertEqual(state.finalBilling?.chargedActivityCatFood, 100)
        XCTAssertEqual(state.finalBilling?.chargedGoldCoins, 200)
        XCTAssertEqual(state.finalBilling?.totalCharged, 300)
        XCTAssertEqual(state.finalBilling?.earnedGoldCoins, 300)
        XCTAssertEqual(state.finalBilling?.goldCoinBalanceAfter, 0)
        XCTAssertEqual(state.finalBilling?.activityCatFoodBalanceAfter, 0)
        XCTAssertEqual(state.finalBilling?.spendableBalanceAfter, 0)
        XCTAssertTrue(
            LiveCallTerminationPolicy.isInsufficientBalance([
                "status": state.status,
                "end_reason": state.endReason as Any
            ])
        )
    }

    func testLiveRoleIntroductionUsesEntrySpecificCopyForBothParticipants() {
        let lobby = LiveCallRoleContext(source: .lobby, roleSetting: "复古唱片店老板")
        XCTAssertEqual(
            lobby?.introduction(isOutgoing: true),
            LiveCallRoleIntroduction(title: "对方正在扮演", detail: "复古唱片店老板")
        )
        XCTAssertEqual(
            lobby?.introduction(isOutgoing: false),
            LiveCallRoleIntroduction(title: "我正在扮演", detail: "复古唱片店老板")
        )

        let agent = LiveCallRoleContext(source: .agentMatch, roleSetting: "温柔的旅行摄影师")
        XCTAssertEqual(
            agent?.introduction(isOutgoing: true),
            LiveCallRoleIntroduction(title: "我希望对方扮演", detail: "温柔的旅行摄影师")
        )
        XCTAssertEqual(
            agent?.introduction(isOutgoing: false),
            LiveCallRoleIntroduction(title: "对方希望我扮演", detail: "温柔的旅行摄影师")
        )
    }

    func testLiveBillingHasTenFreeSecondsThenRoundsEachMinuteUp() {
        XCTAssertEqual(LiveCallBillingPolicy.accruedSpendableAmount(for: 0), 0)
        XCTAssertEqual(LiveCallBillingPolicy.accruedSpendableAmount(for: 10), 0)
        XCTAssertEqual(LiveCallBillingPolicy.accruedSpendableAmount(for: 10.001), 100)
        XCTAssertEqual(LiveCallBillingPolicy.accruedSpendableAmount(for: 60), 100)
        XCTAssertEqual(LiveCallBillingPolicy.accruedSpendableAmount(for: 60.001), 200)
        XCTAssertEqual(LiveCallBillingPolicy.accruedSpendableAmount(for: 120), 200)
        XCTAssertEqual(LiveCallBillingPolicy.accruedSpendableAmount(for: 120.001), 300)
    }

    func testLiveBillingRequiresOneUnitBeforeStarting() {
        XCTAssertFalse(LiveCallBillingPolicy.canStart(balance: 99))
        XCTAssertTrue(LiveCallBillingPolicy.canStart(balance: 100))
    }

    func testLiveExperienceTenSecondConsumptionBoundaryAndAllDurations() {
        XCTAssertFalse(LiveExperienceBillingPolicy.shouldConsumeCard(
            connectedDuration: 10,
            freeSeconds: 10
        ))
        XCTAssertTrue(LiveExperienceBillingPolicy.shouldConsumeCard(
            connectedDuration: 10.001,
            freeSeconds: 10
        ))

        for kind in LiveExperienceCardKind.allCases {
            XCTAssertEqual(kind.durationSeconds, kind.minutes * 60)
            XCTAssertEqual(
                LiveExperienceBillingPolicy.remainingSeconds(
                    durationSeconds: kind.durationSeconds,
                    connectedDuration: 0
                ),
                kind.durationSeconds
            )
            XCTAssertEqual(
                LiveExperienceBillingPolicy.remainingSeconds(
                    durationSeconds: kind.durationSeconds,
                    connectedDuration: TimeInterval(kind.durationSeconds)
                ),
                0
            )
        }
    }

    func testLiveExperienceOverageStartsImmediatelyWithoutSecondFreePeriod() {
        let policy = LiveBillingPolicy.fallback

        XCTAssertEqual(LiveExperienceBillingPolicy.accruedOverageAmount(
            durationSeconds: 300,
            connectedDuration: 300,
            policy: policy
        ), 0)
        XCTAssertEqual(LiveExperienceBillingPolicy.accruedOverageAmount(
            durationSeconds: 300,
            connectedDuration: 300.001,
            policy: policy
        ), 100)
        XCTAssertEqual(LiveExperienceBillingPolicy.accruedOverageAmount(
            durationSeconds: 300,
            connectedDuration: 360,
            policy: policy
        ), 100)
        XCTAssertEqual(LiveExperienceBillingPolicy.accruedOverageAmount(
            durationSeconds: 300,
            connectedDuration: 360.001,
            policy: policy
        ), 200)
    }

    func testServerBillingPolicyUsesItsOwnBoundariesForBothMediaTypes() throws {
        let policy = try JSONDecoder().decode(
            LiveBillingPolicy.self,
            from: #"""
            {
              "currency": "spendable_balance",
              "free_seconds": 5,
              "unit_seconds": 30,
              "amount_per_unit": 40,
              "minimum_starting_balance": 80,
              "rounding": "started_unit"
            }
            """#.data(using: .utf8)!
        )

        for callType in [CallType.voice, .video] {
            XCTAssertEqual(policy.accruedAmount(for: 0), 0, "\(callType)")
            XCTAssertEqual(policy.accruedAmount(for: 5), 0, "\(callType)")
            XCTAssertEqual(policy.accruedAmount(for: 5.001), 40, "\(callType)")
            XCTAssertEqual(policy.accruedAmount(for: 30), 40, "\(callType)")
            XCTAssertEqual(policy.accruedAmount(for: 30.001), 80, "\(callType)")
            XCTAssertEqual(policy.accruedAmount(for: 60), 80, "\(callType)")
        }
        XCTAssertFalse(policy.canStart(balance: 79))
        XCTAssertTrue(policy.canStart(balance: 80))
        XCTAssertEqual(policy.compactRateText, L10n.tr("live.billing.ratePerSeconds", 40, 30))
        XCTAssertEqual(policy.fullRuleText, L10n.tr("live.billing.rulePerSeconds", 5, 30, 40))
    }

    func testMalformedBillingPolicySanitizesUnsafeValues() throws {
        let policy = try JSONDecoder().decode(
            LiveBillingPolicy.self,
            from: #"""
            {
              "currency": "",
              "free_seconds": -1,
              "unit_seconds": 0,
              "amount_per_unit": -8,
              "minimum_starting_balance": 0,
              "rounding": ""
            }
            """#.data(using: .utf8)!
        )

        XCTAssertEqual(policy.currency, "spendable_balance")
        XCTAssertEqual(policy.freeSeconds, 0)
        XCTAssertEqual(policy.unitSeconds, 60)
        XCTAssertEqual(policy.amountPerUnit, 100)
        XCTAssertEqual(policy.minimumStartingBalance, 100)
        XCTAssertEqual(policy.rounding, "started_unit")
    }

    func testLiveAvatarCropGeometryCentersLandscapeAndPortraitImages() {
        let landscape = LiveAvatarCropRenderer.cropRect(
            imageSize: CGSize(width: 1_200, height: 800),
            viewportSide: 300,
            zoom: 1,
            offset: .zero
        )
        XCTAssertEqual(landscape.origin.x, 200, accuracy: 0.001)
        XCTAssertEqual(landscape.origin.y, 0, accuracy: 0.001)
        XCTAssertEqual(landscape.width, 800, accuracy: 0.001)
        XCTAssertEqual(landscape.height, 800, accuracy: 0.001)

        let portrait = LiveAvatarCropRenderer.cropRect(
            imageSize: CGSize(width: 800, height: 1_200),
            viewportSide: 300,
            zoom: 1,
            offset: .zero
        )
        XCTAssertEqual(portrait.origin.x, 0, accuracy: 0.001)
        XCTAssertEqual(portrait.origin.y, 200, accuracy: 0.001)
        XCTAssertEqual(portrait.width, 800, accuracy: 0.001)
        XCTAssertEqual(portrait.height, 800, accuracy: 0.001)
    }

    func testLiveAvatarCropClampsDragAndZoomWithoutExposingEmptySpace() {
        let clamped = LiveAvatarCropRenderer.clampedOffset(
            CGSize(width: 500, height: -500),
            imageSize: CGSize(width: 1_200, height: 800),
            viewportSide: 300,
            zoom: 1
        )
        XCTAssertEqual(clamped.width, 75, accuracy: 0.001)
        XCTAssertEqual(clamped.height, 0, accuracy: 0.001)

        let zoomed = LiveAvatarCropRenderer.cropRect(
            imageSize: CGSize(width: 1_200, height: 800),
            viewportSide: 300,
            zoom: 2,
            offset: CGSize(width: 75, height: 0)
        )
        XCTAssertEqual(zoomed.width, 400, accuracy: 0.001)
        XCTAssertEqual(zoomed.height, 400, accuracy: 0.001)
        XCTAssertGreaterThanOrEqual(zoomed.minX, 0)
        XCTAssertLessThanOrEqual(zoomed.maxX, 1_200)
    }

    func testLiveAvatarCropExportsSquareJPEGWithinConfiguredLimit() throws {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let image = UIGraphicsImageRenderer(
            size: CGSize(width: 1_200, height: 800),
            format: format
        ).image { context in
            UIColor.systemPurple.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 1_200, height: 800))
        }

        let data = try XCTUnwrap(
            LiveAvatarCropRenderer.croppedJPEG(
                image: image,
                viewportSide: 300,
                zoom: 1,
                offset: .zero
            )
        )
        let output = try XCTUnwrap(UIImage(data: data))

        XCTAssertEqual(output.size.width, output.size.height, accuracy: 0.001)
        XCTAssertLessThanOrEqual(output.size.width, 1_024)
        XCTAssertLessThanOrEqual(data.count, 1_000_000)
    }

    func testLiveHostCannotInitiateVideoWithAnotherLiveHost() {
        XCTAssertFalse(
            LiveCallInitiationPolicy.canInitiate(isCurrentUserLive: true)
        )
        XCTAssertTrue(
            LiveCallInitiationPolicy.canInitiate(isCurrentUserLive: false)
        )
        XCTAssertEqual(
            LiveCallInitiationPolicy.hostingBlockMessage,
            "正在直播，无法与其他在直播的人视频"
        )
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

    func testSensitiveLogRedactorRemovesGameTokensTicketsAndAuthorization() {
        let secretTicket = "ticket-secret-value"
        let secretRoundToken = "round-secret-value"
        let camelCaseRoundToken = "camel-round-secret-value"
        let secretAuthorization = "access-secret-value"
        let source = """
        launch=https://id7.com/api/v1/game-assets/just-clear/?ticket=\(secretTicket) \
        \"round_token\":\"\(secretRoundToken)\" roundToken=\(camelCaseRoundToken) \
        {\"ticket\":\"\(secretTicket)\"} Authorization: Bearer \(secretAuthorization)
        """

        let redacted = SensitiveLogRedactor.redact(source)

        XCTAssertFalse(redacted.contains(secretTicket))
        XCTAssertFalse(redacted.contains(secretRoundToken))
        XCTAssertFalse(redacted.contains(camelCaseRoundToken))
        XCTAssertFalse(redacted.contains(secretAuthorization))
        XCTAssertTrue(redacted.contains("ticket=<redacted>"))
        XCTAssertTrue(redacted.contains("round_token\":\"<redacted>"))
        XCTAssertTrue(redacted.contains("Authorization: Bearer <redacted>"))
    }

    func testSensitiveHTTPResponsePolicyPreventsDiskCaching() throws {
        var request = URLRequest(url: try XCTUnwrap(URL(string: "https://id7.com/api/v1/game-assets/")))

        SensitiveHTTPResponsePolicy.apply(to: &request)

        XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalAndRemoteCacheData)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Cache-Control"), "no-store")
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

    func testAgentImageReplyOnlyTargetsAccessibleImagesAndKeepsSourceMessage() throws {
        let message = try JSONDecoder().decode(AgentMessage.self, from: #"""
        {
          "id": "message-source-1",
          "conversation_id": "conversation-1",
          "sequence_no": 3,
          "sender": { "type": "agent", "id": "agent-1" },
          "source": "turn",
          "status": "completed",
          "created_at": "2026-07-22T10:00:00Z",
          "updated_at": "2026-07-22T10:00:01Z",
          "parts": []
        }
        """#.data(using: .utf8)!)
        let unlocked = try JSONDecoder().decode(AgentMessagePart.self, from: #"""
        {
          "id": "part-unlocked",
          "ordinal": 0,
          "type": "paid_media",
          "reference_id": "media-1",
          "metadata": {
            "media_type": "image",
            "access": "unlocked",
            "content_url": "/agent-media/media-1/content"
          }
        }
        """#.data(using: .utf8)!)
        let locked = try JSONDecoder().decode(AgentMessagePart.self, from: #"""
        {
          "id": "part-locked",
          "ordinal": 1,
          "type": "paid_media",
          "reference_id": "media-2",
          "metadata": {
            "media_type": "image",
            "access": "locked",
            "preview_url": "/agent-media/media-2/preview"
          }
        }
        """#.data(using: .utf8)!)

        let target = try XCTUnwrap(
            AgentGalleryMediaResolver.imageReplyTarget(for: unlocked, in: message)
        )
        XCTAssertEqual(target.messageID, "message-source-1")
        XCTAssertEqual(target.partID, "part-unlocked")
        XCTAssertEqual(target.imagePath, "/agent-media/media-1/content")
        XCTAssertEqual(target.senderLabel, "智能体")
        XCTAssertNil(AgentGalleryMediaResolver.imageReplyTarget(for: locked, in: message))
    }

    func testAgentMessageDecodesImageReplyRelationship() throws {
        let message = try JSONDecoder().decode(AgentMessage.self, from: #"""
        {
          "id": "message-reply-1",
          "conversation_id": "conversation-1",
          "sequence_no": 4,
          "sender": { "type": "user", "id": "user-1" },
          "source": "turn",
          "status": "completed",
          "reply_to_id": "message-source-1",
          "created_at": "2026-07-22T10:01:00Z",
          "updated_at": "2026-07-22T10:01:01Z",
          "parts": [{
            "id": "part-input-1",
            "ordinal": 0,
            "type": "input_image",
            "asset_id": "asset-copy-1"
          }]
        }
        """#.data(using: .utf8)!)

        XCTAssertEqual(message.replyToID, "message-source-1")
        XCTAssertEqual(message.parts.first?.assetID, "asset-copy-1")

        let fallbackTarget = try XCTUnwrap(
            AgentHistoryImageReplyResolver.target(for: message, messages: [message])
        )
        XCTAssertEqual(fallbackTarget.messageID, "message-reply-1")
        XCTAssertEqual(fallbackTarget.imagePath, "/agent-assets/asset-copy-1/content")
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
        let replyWithoutAdditionalText = AgentImageRequestMode.transform.outboundText(userText: "")

        XCTAssertTrue(text.hasPrefix(AgentImageRequestMode.transformInstructionPrefix))
        XCTAssertTrue(text.contains("实际调用图片生成工具"))
        XCTAssertTrue(text.contains("把背景改成夜晚"))
        XCTAssertTrue(AgentImageRequestMode.isTransformRequest(text: text))
        XCTAssertTrue(replyWithoutAdditionalText.hasPrefix(AgentImageRequestMode.transformInstructionPrefix))
        XCTAssertTrue(replyWithoutAdditionalText.contains("实际调用图片生成工具"))
        XCTAssertTrue(replyWithoutAdditionalText.contains("请保持主体特征和整体构图"))
        XCTAssertEqual(
            AgentImageRequestMode.analyze.outboundText(userText: "  这张图里有什么？  "),
            "这张图里有什么？"
        )
    }

    func testAgentImageTransformOnlyShowsUserAuthoredTextInMessageBubble() {
        let outbound = AgentImageRequestMode.transform.outboundText(userText: "  把背景改成夜晚  ")

        XCTAssertEqual(
            AgentImageRequestMode.userVisibleText(from: outbound),
            "把背景改成夜晚"
        )
        XCTAssertEqual(
            AgentImageRequestMode.userVisibleText(
                from: AgentImageRequestMode.transform.outboundText(userText: "")
            ),
            ""
        )
        XCTAssertEqual(
            AgentImageRequestMode.userVisibleText(from: "  这张图里有什么？  "),
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

    func testAgentGeneratedMediaPollingContinuesAfterTurnCompletesUntilImageSettles() throws {
        XCTAssertEqual(
            AgentGeneratedMediaPollingPolicy.decision(
                expectsGeneratedMedia: true,
                mediaParts: []
            ),
            .waitForMediaPart
        )

        let generating = try JSONDecoder().decode(AgentMessagePart.self, from: #"""
        {
          "id": "part-generating",
          "ordinal": 0,
          "type": "paid_media",
          "reference_id": "media-1",
          "metadata": {
            "media_type": "image",
            "generation_status": "generating",
            "access": "locked"
          }
        }
        """#.data(using: .utf8)!)
        XCTAssertEqual(
            AgentGeneratedMediaPollingPolicy.decision(
                expectsGeneratedMedia: true,
                mediaParts: [generating]
            ),
            .waitForGeneration
        )

        let readyWithoutPreview = try JSONDecoder().decode(AgentMessagePart.self, from: #"""
        {
          "id": "part-ready-without-preview",
          "ordinal": 0,
          "type": "paid_media",
          "reference_id": "media-1",
          "metadata": {
            "media_type": "image",
            "generation_status": "ready",
            "access": "locked",
            "price_points": 20
          }
        }
        """#.data(using: .utf8)!)
        XCTAssertEqual(
            AgentPaidMediaStatePolicy.displayStatus(for: readyWithoutPreview.metadata),
            "ready_locked"
        )
        XCTAssertEqual(
            AgentGeneratedMediaPollingPolicy.decision(
                expectsGeneratedMedia: true,
                mediaParts: [readyWithoutPreview]
            ),
            .waitForGeneration
        )

        let readyWithoutAccess = try JSONDecoder().decode(AgentMessagePart.self, from: #"""
        {
          "id": "part-ready-without-access",
          "ordinal": 0,
          "type": "paid_media",
          "reference_id": "media-1",
          "metadata": {
            "media_type": "image",
            "generation_status": "ready"
          }
        }
        """#.data(using: .utf8)!)
        XCTAssertEqual(
            AgentPaidMediaStatePolicy.displayStatus(for: readyWithoutAccess.metadata),
            "generating"
        )
        XCTAssertEqual(
            AgentGeneratedMediaPollingPolicy.decision(
                expectsGeneratedMedia: true,
                mediaParts: [readyWithoutAccess]
            ),
            .waitForGeneration
        )

        let ready = try JSONDecoder().decode(AgentMessagePart.self, from: #"""
        {
          "id": "part-ready",
          "ordinal": 0,
          "type": "paid_media",
          "reference_id": "media-1",
          "metadata": {
            "media_type": "image",
            "generation_status": "ready_locked",
            "access": "locked",
            "preview_url": "/agent-media/media-1/preview"
          }
        }
        """#.data(using: .utf8)!)
        XCTAssertEqual(
            AgentGeneratedMediaPollingPolicy.decision(
                expectsGeneratedMedia: true,
                mediaParts: [ready]
            ),
            .stop
        )
        XCTAssertEqual(
            AgentGeneratedMediaPollingPolicy.decision(
                expectsGeneratedMedia: false,
                mediaParts: [generating]
            ),
            .stop
        )
    }

    func testAgentImageProgressCardRemainsVisibleUntilMediaBubbleAppears() {
        XCTAssertEqual(
            AgentTurnProgressPresentationPolicy.status(
                turnStatus: "completed",
                turnIsTerminal: true,
                isAwaitingGeneratedMedia: true,
                isAwaitingTerminalResponse: false,
                mediaDecision: .waitForMediaPart
            ),
            "waiting_image"
        )
        XCTAssertNil(
            AgentTurnProgressPresentationPolicy.status(
                turnStatus: "completed",
                turnIsTerminal: true,
                isAwaitingGeneratedMedia: true,
                isAwaitingTerminalResponse: false,
                mediaDecision: .waitForGeneration
            )
        )
        XCTAssertEqual(
            AgentTurnProgressPresentationPolicy.status(
                turnStatus: "running",
                turnIsTerminal: false,
                isAwaitingGeneratedMedia: false,
                isAwaitingTerminalResponse: false,
                mediaDecision: nil
            ),
            "running"
        )
    }

    func testAgentTerminalTurnKeepsPollingUntilReplyMessageIsRenderable() {
        XCTAssertTrue(
            AgentTerminalResponsePollingPolicy.shouldWait(
                turnStatus: "completed",
                hasRenderableResponse: false
            )
        )
        XCTAssertFalse(
            AgentTerminalResponsePollingPolicy.shouldWait(
                turnStatus: "completed",
                hasRenderableResponse: true
            )
        )
        XCTAssertFalse(
            AgentTerminalResponsePollingPolicy.shouldWait(
                turnStatus: "failed",
                hasRenderableResponse: false
            )
        )
        XCTAssertEqual(
            AgentTurnProgressPresentationPolicy.status(
                turnStatus: "completed",
                turnIsTerminal: true,
                isAwaitingGeneratedMedia: false,
                isAwaitingTerminalResponse: true,
                mediaDecision: .stop
            ),
            "waiting_response"
        )
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

    @MainActor
    func testGiftVisualFeedbackIsDispatchedBeforeBackendTransfer() async {
        var events: [String] = []

        let transferTask = GiftSendInteractionDispatcher.dispatch {
            events.append("animation")
        } scheduleTransfer: {
            events.append("network")
        }

        XCTAssertEqual(events, ["animation"])
        await transferTask.value
        XCTAssertEqual(events, ["animation", "network"])
    }

    func testBuiltInGiftAssetsResolveToBundledImages() {
        for gift in GiftCatalogItem.fixedCatalog {
            XCTAssertEqual(GiftCatalogItem.bundledAssetName(for: gift.assetKey), gift.assetKey)
        }
    }

    func testRemoteOnlyGiftAssetDoesNotResolveToBundledImage() {
        XCTAssertNil(GiftCatalogItem.bundledAssetName(for: "gift_festival_remote"))
    }

    func testGiftCatalogRejectsRetiredGameEntryItem() throws {
        let data = Data(
            #"{"gift_id":"legacy-entry","name":"Legacy","price":10,"asset_key":"prop_game_entry_card"}"#.utf8
        )
        let item = try JSONDecoder().decode(GiftCatalogItem.self, from: data)

        XCTAssertFalse(item.isSupportedCatalogItem)
        XCTAssertTrue(GiftCatalogItem.fixedCatalog.allSatisfy(\.isSupportedCatalogItem))
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

    @MainActor
    func testMutedConversationKeepsRowUnreadButIsExcludedFromGlobalBadge() {
        let store = UnreadBadgeStore.shared
        store.setChatUnreadCount(0)
        store.setConversationMuted(false, for: "group:42")
        defer {
            store.setConversationMuted(false, for: "group:42")
            store.setChatUnreadCount(0)
        }

        store.replaceChatUnreadCounts(
            ["dm:user-1": 2, "group:42": 3],
            mutedIdentities: ["group:42"]
        )

        XCTAssertEqual(store.conversationUnreadCount(for: "group:42"), 3)
        XCTAssertEqual(store.chatUnreadCount, 2)

        store.setConversationMuted(false, for: "group:42")
        XCTAssertEqual(store.chatUnreadCount, 5)
    }

    @MainActor
    func testUnreadBadgeCountsOneMessageOnceAcrossWebSocketListAndPush() {
        let store = UnreadBadgeStore.shared
        store.setChatUnreadCount(0)
        defer { store.setChatUnreadCount(0) }

        let websocketRoute = NotificationRoute(
            eventID: "websocket-event-101",
            conversationType: .direct,
            conversationID: "user-1",
            senderID: "user-1",
            groupID: nil,
            messageID: 101,
            conversationRevision: nil,
            unreadCount: nil,
            totalUnreadCount: nil,
            senderName: nil,
            senderAvatar: nil,
            groupName: nil,
            groupAvatar: nil,
            messageType: "text",
            contentPreview: "hello",
            sentAt: "2026-07-23T10:00:00Z",
            receivedAt: Date()
        )

        store.applyNotification(websocketRoute)
        XCTAssertEqual(store.conversationUnreadCount(for: "dm:user-1"), 1)

        let listCount = store.recordIncomingMessage(
            identity: "dm:user-1",
            messageID: 101,
            eventID: "conversation-list-event-101",
            baselineUnreadCount: 0
        )
        XCTAssertEqual(listCount, 1)
        XCTAssertEqual(store.chatUnreadCount, 1)

        let pushRoute = NotificationRoute(
            eventID: "apns-event-101",
            conversationType: .direct,
            conversationID: "user-1",
            senderID: "user-1",
            groupID: nil,
            messageID: 101,
            conversationRevision: nil,
            unreadCount: 1,
            totalUnreadCount: 1,
            senderName: nil,
            senderAvatar: nil,
            groupName: nil,
            groupAvatar: nil,
            messageType: "text",
            contentPreview: "hello",
            sentAt: "2026-07-23T10:00:00Z",
            receivedAt: Date()
        )
        store.applyNotification(pushRoute)

        XCTAssertEqual(store.conversationUnreadCount(for: "dm:user-1"), 1)
        XCTAssertEqual(store.chatUnreadCount, 1)
    }

    @MainActor
    func testUnreadBadgeSnapshotAcknowledgesAllPendingMessagesThroughLastMessageID() {
        let store = UnreadBadgeStore.shared
        store.setChatUnreadCount(0)
        defer { store.setChatUnreadCount(0) }

        XCTAssertEqual(
            store.recordIncomingMessage(
                identity: "group:42",
                messageID: 201,
                eventID: "ws-201",
                baselineUnreadCount: 0
            ),
            1
        )
        XCTAssertEqual(
            store.recordIncomingMessage(
                identity: "group:42",
                messageID: 202,
                eventID: "ws-202",
                baselineUnreadCount: 1
            ),
            2
        )

        store.applyServerSnapshot(
            identity: "group:42",
            unreadCount: 2,
            revision: nil,
            lastMessageID: 202,
            readThroughMessageID: nil
        )

        XCTAssertEqual(store.conversationUnreadCount(for: "group:42"), 2)
        XCTAssertEqual(store.chatUnreadCount, 2)
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

final class CallConnectionTransitionPolicyTests: XCTestCase {
    func testAcceptedOutgoingLivePairConnectsWhenRemoteParticipantJoins() {
        XCTAssertTrue(
            CallConnectionTransitionPolicy.shouldMarkConnected(
                isOutgoing: true,
                isGroupCall: false,
                isLivePairCall: true,
                state: .connecting,
                remoteParticipantCount: 1,
                hasRemoteAudio: false
            )
        )
    }

    func testOrdinaryConnectingCallDoesNotUseLivePairShortcut() {
        XCTAssertFalse(
            CallConnectionTransitionPolicy.shouldMarkConnected(
                isOutgoing: true,
                isGroupCall: false,
                isLivePairCall: false,
                state: .connecting,
                remoteParticipantCount: 1,
                hasRemoteAudio: true
            )
        )
    }

    func testOrdinaryOutgoingDirectCallStillWaitsForRemoteAudio() {
        XCTAssertFalse(
            CallConnectionTransitionPolicy.shouldMarkConnected(
                isOutgoing: true,
                isGroupCall: false,
                isLivePairCall: false,
                state: .outgoing,
                remoteParticipantCount: 1,
                hasRemoteAudio: false
            )
        )
        XCTAssertTrue(
            CallConnectionTransitionPolicy.shouldMarkConnected(
                isOutgoing: true,
                isGroupCall: false,
                isLivePairCall: false,
                state: .outgoing,
                remoteParticipantCount: 1,
                hasRemoteAudio: true
            )
        )
    }

    func testIncomingOrMissingRemoteParticipantNeverTransitionsHere() {
        XCTAssertFalse(
            CallConnectionTransitionPolicy.shouldMarkConnected(
                isOutgoing: false,
                isGroupCall: false,
                isLivePairCall: true,
                state: .connecting,
                remoteParticipantCount: 1,
                hasRemoteAudio: true
            )
        )
        XCTAssertFalse(
            CallConnectionTransitionPolicy.shouldMarkConnected(
                isOutgoing: true,
                isGroupCall: false,
                isLivePairCall: true,
                state: .connecting,
                remoteParticipantCount: 0,
                hasRemoteAudio: false
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
            let json = #"{"id":"tx","type":"\#(type)","currency":"gold_coin","gold_coin_amount":\#(amount)}"#
            return try JSONDecoder().decode(WalletTransaction.self, from: Data(json.utf8))
        }

        XCTAssertEqual(try transaction(type: "red_packet_sent", amount: 30).signedAmountValue, -30)
        XCTAssertEqual(try transaction(type: "red_packet_received", amount: 12).signedAmountValue, 12)
        XCTAssertEqual(try transaction(type: "red_packet_refund", amount: 18).signedAmountValue, 18)
        XCTAssertEqual(try transaction(type: "transfer_sent", amount: 20).signedAmountValue, -20)
        XCTAssertEqual(try transaction(type: "transfer_received", amount: 20).signedAmountValue, 20)
        XCTAssertEqual(try transaction(type: "transfer_returned", amount: 20).signedAmountValue, 20)
    }

    func testWalletTransactionPageKeepsEveryRowAndCursorBeyondFormerClientCap() throws {
        let items: [[String: Any]] = (0..<750).map { index in
            [
                "id": "tx-\(index)",
                "type": "balance_change",
                "currency": "gold_coin",
                "gold_coin_amount": index.isMultiple(of: 2) ? 1 : -1
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: [
            "items": items,
            "next_cursor": "cursor-751"
        ])

        let page = try JSONDecoder().decode(WalletTransactionsResponseData.self, from: data)

        XCTAssertEqual(page.transactions.count, 750)
        XCTAssertEqual(page.transactions.first?.id, "tx-0")
        XCTAssertEqual(page.transactions.last?.id, "tx-749")
        XCTAssertEqual(page.nextCursor, "cursor-751")

        let cachedPage = try JSONDecoder().decode(
            WalletTransactionsResponseData.self,
            from: JSONEncoder().encode(page)
        )
        XCTAssertEqual(cachedPage, page)
    }

    func testWalletTransactionPageReadsLegacyGoldCoinRowsWithoutDroppingValidSiblings() throws {
        let data = Data(#"""
        {
          "transactions": [
            {"id":"current","type":"ios_iap","currency":"gold_coin","gold_coin_amount":100},
            {"id":"legacy","type":"gift_sent","currency":"cat_food","cat_food_amount":-20,"balance_after":80},
            {"id":"wrong-asset","type":"activity_grant","currency":"activity_cat_food","amount":10}
          ],
          "nextCursor": "older"
        }
        """#.utf8)

        let page = try JSONDecoder().decode(WalletTransactionsResponseData.self, from: data)

        XCTAssertEqual(page.transactions.map(\.id), ["current", "legacy"])
        XCTAssertEqual(page.transactions.last?.currency, .goldCoins)
        XCTAssertEqual(page.transactions.last?.signedAmountValue, -20)
        XCTAssertEqual(page.transactions.last?.goldCoinBalanceAfter, 80)
        XCTAssertEqual(page.nextCursor, "older")
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

    func testRoleFilteredRedPacketDetailFailsClosedWithoutOptionalActionFields() throws {
        let json = #"""
        {
          "code": 0,
          "message": "ok",
          "data": {
            "asset_id": "rp-role-filtered",
            "kind": "red_packet",
            "scope": "group",
            "mode": "lucky",
            "sender_id": "sender",
            "status": "pending",
            "can_claim": "true",
            "viewer_state": "claimable",
            "total_amount": null,
            "claims": null
          }
        }
        """#

        let response = try JSONDecoder().decode(
            APIResponseWrapper<ChatMoneyDetailResponseData>.self,
            from: Data(json.utf8)
        )
        let detail = try response.requiredData().detail

        XCTAssertTrue(detail.canClaim)
        XCTAssertFalse(detail.canAccept)
        XCTAssertFalse(detail.canReturn)
        XCTAssertEqual(detail.claims, [])
        XCTAssertEqual(detail.version, 1)
        XCTAssertNil(detail.totalAmount)
    }

    func testRedPacketClaimsTolerateMissingOptionalFieldsAndFlexibleScalars() throws {
        let json = #"""
        {
          "asset_id": "rp-claim-list",
          "kind": "red_packet",
          "scope": "group",
          "mode": "lucky",
          "sender_id": "sender",
          "status": "partial",
          "can_claim": false,
          "can_accept": false,
          "can_return": false,
          "claimed_count": "2",
          "claims": [
            {
              "user_id": 101,
              "nickname": "Oscar",
              "amount": "16",
              "claimed_at": "2026-07-20T08:40:00Z"
            },
            {
              "user_id": "102",
              "amount": 9,
              "claimed_at": "2026-07-20T08:41:00Z",
              "is_luckiest": "true"
            }
          ],
          "version": 3
        }
        """#

        let detail = try JSONDecoder().decode(ChatMoneyDetail.self, from: Data(json.utf8))

        XCTAssertEqual(detail.claimedCount, 2)
        XCTAssertEqual(detail.claims.count, 2)
        XCTAssertEqual(detail.claims[0].userID, "101")
        XCTAssertEqual(detail.claims[0].amount, 16)
        XCTAssertFalse(detail.claims[0].isLuckiest)
        XCTAssertEqual(detail.claims[1].nickname, "102")
        XCTAssertTrue(detail.claims[1].isLuckiest)
    }

    func testRedPacketCardMutesOnlyForTheViewerWhoClaimed() {
        let payload = ChatMoneyPayload(
            assetID: "rp-partial-card",
            kind: .redPacket,
            scope: .group,
            mode: .lucky,
            senderID: "sender",
            packetCount: 4,
            claimedCount: 3,
            status: .partial,
            version: 4
        )

        XCTAssertTrue(
            ChatMoneyBubblePresentationPolicy.isMuted(
                payload: payload,
                hasViewerClaimedRedPacket: true
            )
        )
        XCTAssertFalse(
            ChatMoneyBubblePresentationPolicy.isMuted(
                payload: payload,
                hasViewerClaimedRedPacket: false
            )
        )
    }

    @MainActor
    func testRedPacketDetailMergeKeepsEarlierClaimsWhenActionResponseIsIncremental() async throws {
        func detail(version: Int, claimedCount: Int, claims: String) throws -> ChatMoneyDetail {
            let json = """
            {
              "asset_id": "rp-incremental-claims",
              "kind": "red_packet",
              "scope": "group",
              "mode": "lucky",
              "sender_id": "sender",
              "status": "partial",
              "can_claim": false,
              "can_accept": false,
              "can_return": false,
              "packet_count": 4,
              "claimed_count": \(claimedCount),
              "claims": \(claims),
              "version": \(version)
            }
            """
            return try JSONDecoder().decode(ChatMoneyDetail.self, from: Data(json.utf8))
        }

        let initial = try detail(
            version: 2,
            claimedCount: 2,
            claims: #"""
            [
              {"user_id":"u1","nickname":"一号","amount":5,"claimed_at":"2026-07-20T08:38:00Z"},
              {"user_id":"u2","nickname":"二号","amount":7,"claimed_at":"2026-07-20T08:39:00Z"}
            ]
            """#
        )
        let incremental = try detail(
            version: 3,
            claimedCount: 3,
            claims: #"""
            [
              {"user_id":"u3","nickname":"三号","amount":9,"claimed_at":"2026-07-20T08:40:00Z"}
            ]
            """#
        )
        let service = SequencedChatMoneyDetailService(details: [initial, incremental])
        let store = ChatMoneyStore(service: service)

        _ = try await store.loadDetail(assetID: initial.assetID, force: true)
        let merged = try await store.loadDetail(assetID: initial.assetID, force: true)

        XCTAssertEqual(merged.claimedCount, 3)
        XCTAssertEqual(merged.claims.map(\.userID), ["u1", "u2", "u3"])
    }

    @MainActor
    func testServerClaimedViewerStateRestoresLocalCardReceipt() async throws {
        let suiteName = "ChatMoneyServerClaimReceiptTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let json = #"""
        {
          "asset_id": "rp-server-confirmed-claim",
          "kind": "red_packet",
          "scope": "group",
          "mode": "lucky",
          "sender_id": "sender",
          "status": "partial",
          "can_claim": false,
          "can_accept": false,
          "can_return": false,
          "viewer_claim_amount": 12,
          "viewer_state": "claimed",
          "claims": [],
          "version": 5
        }
        """#
        let detail = try JSONDecoder().decode(ChatMoneyDetail.self, from: Data(json.utf8))
        let service = SequencedChatMoneyDetailService(details: [detail])
        let store = ChatMoneyStore(service: service, defaults: defaults)

        _ = try await store.loadDetail(assetID: detail.assetID, force: true)

        XCTAssertTrue(store.hasViewerClaimed(assetID: detail.assetID))
    }

    func testRoleFilteredTransferDetailAcceptsNestedLegacyEnvelopeAndFlexibleScalars() throws {
        let json = #"""
        {
          "code": "0",
          "data": {
            "detail": {
              "asset_id": "transfer-role-filtered",
              "kind": "transfer",
              "scope": "direct",
              "sender_id": "sender",
              "recipient_id": "recipient",
              "total_amount": "88",
              "status": "pending",
              "can_claim": 0,
              "can_accept": 1,
              "can_return": "true",
              "claims": [],
              "version": "3",
              "viewer_state": "transfer_receivable"
            }
          }
        }
        """#

        let response = try JSONDecoder().decode(
            APIResponseWrapper<ChatMoneyDetailResponseData>.self,
            from: Data(json.utf8)
        )
        let detail = try response.requiredData().detail

        XCTAssertEqual(response.message, "")
        XCTAssertEqual(detail.scope, .direct)
        XCTAssertEqual(detail.totalAmount, 88)
        XCTAssertFalse(detail.canClaim)
        XCTAssertTrue(detail.canAccept)
        XCTAssertTrue(detail.canReturn)
        XCTAssertEqual(detail.version, 3)
    }

    func testTerminalChatMoneyDetailNeverRestoresActionsFromStaleServerFlags() throws {
        let json = #"""
        {
          "asset_id": "transfer-terminal",
          "kind": "transfer",
          "scope": "dm",
          "sender_id": "sender",
          "status": "accepted",
          "can_claim": true,
          "can_accept": true,
          "can_return": true,
          "claims": [],
          "version": 4,
          "viewer_state": "transfer_receivable"
        }
        """#

        let detail = try JSONDecoder().decode(ChatMoneyDetail.self, from: Data(json.utf8))

        XCTAssertFalse(detail.canClaim)
        XCTAssertFalse(detail.canAccept)
        XCTAssertFalse(detail.canReturn)
    }

    func testUnknownOptionalViewerMetadataDoesNotBreakChatMoneyDetail() throws {
        let json = #"""
        {
          "asset_id": "transfer-future-viewer-state",
          "kind": "transfer",
          "scope": "dm",
          "sender_id": "sender",
          "status": "pending",
          "can_claim": false,
          "can_accept": false,
          "can_return": false,
          "claims": [],
          "version": 2,
          "viewer_state": "future_recipient_state",
          "unavailable_reason": "future_policy_reason"
        }
        """#

        let detail = try JSONDecoder().decode(ChatMoneyDetail.self, from: Data(json.utf8))

        XCTAssertNil(detail.viewerState)
        XCTAssertNil(detail.unavailableReason)
        XCTAssertFalse(detail.canAccept)
        XCTAssertFalse(detail.canReturn)
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

    @MainActor
    func testPropBagStoreFiltersRetiredGameEntryInventory() throws {
        let json = #"""
        {
          "summary": {
            "total_quantity": 7,
            "equipped_count": 0,
            "expiring_count": 1
          },
          "items": [
            {
              "inventory_id": "inventory-image",
              "definition_id": "media_unlock_card_image",
              "type": "media_unlock_card",
              "name": "图片解锁卡",
              "description": "解锁一条图片内容",
              "quantity": 3,
              "is_equipped": false,
              "available_actions": ["consume_for_media_unlock"],
              "metadata": { "media_type": "image" }
            },
            {
              "inventory_id": "inventory-video",
              "definition_id": "media_unlock_card_video",
              "type": "media_unlock_card",
              "name": "视频解锁卡",
              "description": "解锁一条视频内容",
              "quantity": 2,
              "is_equipped": false,
              "available_actions": ["consume_for_media_unlock"],
              "metadata": { "media_type": "video" }
            },
            {
              "inventory_id": "inventory-game-entry",
              "definition_id": "game_entry_card",
              "type": "game_entry_card",
              "name": "游戏进入卡",
              "description": "免扣金币进入一次收费游戏",
              "quantity": 2,
              "is_equipped": false,
              "available_actions": ["consume_for_game_entry"],
              "metadata": {}
            }
          ],
          "next_cursor": null,
          "server_time": "2026-08-01T12:00:00Z"
        }
        """#.data(using: .utf8)!

        let page = try JSONDecoder().decode(PropBagPage.self, from: json)

        let store = PropInventoryStore(items: page.items)

        XCTAssertEqual(store.summary.totalQuantity, 5)
        XCTAssertEqual(store.items.map(\.mediaUnlockKind), [.image, .video])
        XCTAssertTrue(store.items.allSatisfy(\.canConsumeForMediaUnlock))
        XCTAssertFalse(store.items.contains { $0.definitionID == "game_entry_card" })
        XCTAssertEqual(store.items.map(\.bundledAssetName), [
            "prop_image_unlock_card",
            "prop_video_unlock_card"
        ])
    }

    func testPropBagDecodesAllLiveExperienceCardsAndStableAssets() throws {
        let json = #"""
        {
          "summary": { "total_quantity": 6, "equipped_count": 0, "expiring_count": 0 },
          "items": [
            {
              "inventory_id": "inventory-live-5m",
              "definition_id": "live_experience_card_5m",
              "type": "live_experience_card",
              "name": "",
              "quantity": 3,
              "is_equipped": false,
              "available_actions": ["consume_for_live_experience"],
              "metadata": { "duration_seconds": 300 }
            },
            {
              "inventory_id": "inventory-live-10m",
              "definition_id": "live_experience_card_10m",
              "type": "live_experience_card",
              "name": "",
              "quantity": 2,
              "is_equipped": false,
              "available_actions": ["consume_for_live_experience"],
              "metadata": { "duration_seconds": 600 }
            },
            {
              "inventory_id": "inventory-live-15m",
              "definition_id": "live_experience_card_15m",
              "type": "live_experience_card",
              "name": "",
              "quantity": 1,
              "is_equipped": false,
              "available_actions": ["consume_for_live_experience"],
              "metadata": { "duration_seconds": 900 }
            }
          ]
        }
        """#.data(using: .utf8)!

        let page = try JSONDecoder().decode(PropBagPage.self, from: json)

        XCTAssertEqual(page.items.map(\.liveExperienceCardKind), [
            .fiveMinutes,
            .tenMinutes,
            .fifteenMinutes
        ])
        XCTAssertTrue(page.items.allSatisfy(\.canConsumeForLiveExperience))
        XCTAssertEqual(page.items.map(\.bundledAssetName), [
            "prop_live_experience_card_5m",
            "prop_live_experience_card_10m",
            "prop_live_experience_card_15m"
        ])
        XCTAssertEqual(page.items.map { $0.metadata?.durationSeconds }, [300, 600, 900])
    }

    @MainActor
    func testLiveExperienceReservationUpdatesOnlyServerConfirmedInventory() {
        let kind = LiveExperienceCardKind.tenMinutes
        let store = PropInventoryStore(items: [
            PropBagItem(
                inventoryID: "inventory-live-10m",
                definitionID: kind.definitionID,
                type: "live_experience_card",
                name: "",
                quantity: 2,
                availableActions: ["consume_for_live_experience"],
                metadata: PropBagMetadata(durationSeconds: kind.durationSeconds)
            )
        ])

        XCTAssertEqual(store.quantity(for: kind), 2)
        store.applyLiveExperienceReservation(
            PropConsumptionResult(
                inventoryID: "inventory-live-10m",
                definitionID: kind.definitionID,
                remainingQuantity: 1
            ),
            fallbackKind: kind
        )
        XCTAssertEqual(store.quantity(for: kind), 1)
        XCTAssertEqual(store.summary.totalQuantity, 1)
    }

    func testMediaUnlockAutomaticRequestDelegatesPriorityToServer() {
        let body = MediaUnlockPaymentMethod.automatic(.video).requestBody

        XCTAssertEqual(body["payment_method"] as? String, "auto")
        XCTAssertEqual(body["prop_definition_id"] as? String, "media_unlock_card_video")
        XCTAssertEqual(MediaUnlockPaymentMethod.automatic(.video).idempotencyScope, "auto:media_unlock_card_video")
        XCTAssertEqual(MediaUnlockPaymentMethod.automatic(.video).cardKind, .video)
    }

    func testLegacyExplicitMediaUnlockRequestsRemainEncodable() {
        let body = MediaUnlockPaymentMethod.unlockCard(.video).requestBody

        XCTAssertEqual(body["payment_method"] as? String, "prop_card")
        XCTAssertEqual(body["prop_definition_id"] as? String, "media_unlock_card_video")
        XCTAssertTrue(MediaUnlockPaymentMethod.spendableBalance.requestBody.isEmpty)
    }

    func testAgentMediaUnlockDecodesConsumedProp() throws {
        let json = #"""
        {
          "already_unlocked": false,
          "content_url": "https://example.test/media/image",
          "download_url": "https://example.test/media/image/download",
          "consumed_prop": {
            "inventory_id": "inventory-image",
            "definition_id": "media_unlock_card_image",
            "remaining_quantity": 2
          }
        }
        """#.data(using: .utf8)!

        let result = try JSONDecoder().decode(AgentMediaUnlock.self, from: json)

        XCTAssertNil(result.charge)
        XCTAssertEqual(result.consumedProp?.definitionID, "media_unlock_card_image")
        XCTAssertEqual(result.consumedProp?.remainingQuantity, 2)
    }

    func testGameSessionDecodesLobbyPriceWithoutPayment() throws {
        let json = #"""
        {
          "session_id": "session-1",
          "launch_url": "https://example.test/api/v1/game-assets/demo/?ticket=opaque",
          "expires_at": "2026-08-01T12:05:00Z",
          "entry_price_gold_coins": 25
        }
        """#.data(using: .utf8)!

        let session = try JSONDecoder().decode(GameSession.self, from: json)

        XCTAssertNil(session.paymentMethod)
        XCTAssertEqual(session.entryPriceGoldCoins, 25)
        XCTAssertNil(session.walletBalance)
        XCTAssertNil(session.consumedProp)
    }

    func testGameSessionDecodesPreviousCoinPriceFieldDuringRollout() throws {
        let previousCurrency = ["cat", "coin"].joined(separator: "_") + "s"
        let payload: [String: Any] = [
            "session_id": "legacy-price-session",
            "launch_url": "https://example.test/api/v1/game-assets/demo/?ticket=opaque",
            "expires_at": "2026-08-01T12:05:00Z",
            "entry_price_" + previousCurrency: 25
        ]
        let json = try JSONSerialization.data(withJSONObject: payload)
        let session = try JSONDecoder().decode(GameSession.self, from: json)

        XCTAssertEqual(session.entryPriceGoldCoins, 25)
        XCTAssertNil(session.paymentMethod)
    }

    func testGameSessionRejectsScalarWalletBalance() throws {
        let previousCurrency = ["cat", "coin"].joined(separator: "_") + "s"
        let payload: [String: Any] = [
            "session_id": "old-session",
            "launch_url": "https://example.test/api/v1/game-assets/demo/?ticket=opaque",
            "expires_at": "2026-08-01T12:05:00Z",
            "entry_price_" + previousCurrency: 25,
            "wallet_balance": 120
        ]
        let json = try JSONSerialization.data(withJSONObject: payload)

        XCTAssertThrowsError(try JSONDecoder().decode(GameSession.self, from: json))
    }

    func testMomentUnlockDecodesConsumedPropWithoutWalletMutation() throws {
        let json = #"""
        {
          "already_unlocked": false,
          "consumed_prop": {
            "inventory_id": "inventory-video",
            "definition_id": "media_unlock_card_video",
            "remaining_quantity": 0
          }
        }
        """#.data(using: .utf8)!

        let result = try JSONDecoder().decode(MomentUnlockResponseData.self, from: json)

        XCTAssertNil(result.walletBalance)
        XCTAssertFalse(result.alreadyUnlocked)
        XCTAssertEqual(result.consumedProp?.definitionID, "media_unlock_card_video")
        XCTAssertEqual(result.consumedProp?.remainingQuantity, 0)
    }
}

@MainActor
private final class SequencedChatMoneyDetailService: ChatMoneyServicing {
    private var details: [ChatMoneyDetail]

    init(details: [ChatMoneyDetail]) {
        self.details = details
    }

    func configuration() async throws -> ChatMoneyConfiguration {
        .fixture
    }

    func createRedPacket(
        _ request: CreateRedPacketRequest
    ) async throws -> ChatMoneyCreationResult {
        throw APIError.invalidResponse
    }

    func createTransfer(
        _ request: CreateTransferRequest
    ) async throws -> ChatMoneyCreationResult {
        throw APIError.invalidResponse
    }

    func detail(assetID: String) async throws -> ChatMoneyDetail {
        guard !details.isEmpty else { throw APIError.invalidResponse }
        return details.removeFirst()
    }

    func claim(assetID: String) async throws -> ChatMoneyActionResult {
        throw APIError.invalidResponse
    }

    func accept(assetID: String) async throws -> ChatMoneyActionResult {
        throw APIError.invalidResponse
    }

    func returnTransfer(assetID: String) async throws -> ChatMoneyActionResult {
        throw APIError.invalidResponse
    }
}
