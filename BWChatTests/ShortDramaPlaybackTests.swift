import XCTest
@testable import BBchat

@MainActor
final class ShortDramaPlaybackTests: XCTestCase {
    func testOutgoingStateMachineAcceptsOnlyLegalForwardTransitions() {
        XCTAssertTrue(OutgoingState.staging.canTransition(to: .queued))
        XCTAssertTrue(OutgoingState.queued.canTransition(to: .uploading))
        XCTAssertTrue(OutgoingState.uploading.canTransition(to: .committing))
        XCTAssertTrue(OutgoingState.committing.canTransition(to: .succeeded))
        XCTAssertTrue(OutgoingState.retryWaiting.canTransition(to: .queued))
        XCTAssertTrue(OutgoingState.confirmationUnknown.canTransition(to: .retryWaiting))
        XCTAssertTrue(OutgoingState.failedPermanent.canTransition(to: .queued))

        XCTAssertFalse(OutgoingState.succeeded.canTransition(to: .uploading))
        XCTAssertFalse(OutgoingState.cancelled.canTransition(to: .queued))
        XCTAssertFalse(OutgoingState.queued.canTransition(to: .staging))
    }

    func testOnlyPermanentFailureIsUserVisible() {
        XCTAssertFalse(OutgoingState.queued.isUserVisibleFailure)
        XCTAssertFalse(OutgoingState.uploading.isUserVisibleFailure)
        XCTAssertFalse(OutgoingState.committing.isUserVisibleFailure)
        XCTAssertFalse(OutgoingState.retryWaiting.isUserVisibleFailure)
        XCTAssertFalse(OutgoingState.confirmationUnknown.isUserVisibleFailure)
        XCTAssertTrue(OutgoingState.failedPermanent.isUserVisibleFailure)
    }

    func testMediaRetryPolicyIncludesWeakNetworkAndTransientServerFailures() {
        XCTAssertTrue(UploadEngine.isTransient(URLError(.networkConnectionLost)))
        XCTAssertTrue(UploadEngine.isTransient(URLError(.badServerResponse)))
        XCTAssertTrue(UploadEngine.isTransient(APIError.networkError(URLError(.timedOut))))
        XCTAssertTrue(UploadEngine.isTransient(APIError.serverError(code: 503, message: "unavailable")))
        XCTAssertFalse(UploadEngine.isTransient(APIError.serverError(code: 400, message: "bad request")))
    }

    func testConfirmationUnknownEntersBoundedRetryPipeline() {
        let now = Date(timeIntervalSince1970: 1_000)
        let retryAt = now.addingTimeInterval(12)
        let job = OutgoingJob(
            ownerID: "owner",
            scene: .directMessage,
            state: .confirmationUnknown,
            attemptCount: 2,
            nextAttemptAt: retryAt
        )

        XCTAssertTrue(
            OutgoingRetryPolicy.shouldRetry(
                job: job,
                error: APIError.decodingError(URLError(.cannotDecodeContentData))
            )
        )
        XCTAssertEqual(OutgoingRetryPolicy.scheduledDate(for: job, now: now), retryAt)

        let exhausted = OutgoingJob(
            ownerID: "owner",
            scene: .directMessage,
            state: .confirmationUnknown,
            attemptCount: OutgoingRetryPolicy.maximumAutomaticAttempts
        )
        XCTAssertFalse(
            OutgoingRetryPolicy.shouldRetry(
                job: exhausted,
                error: URLError(.networkConnectionLost)
            )
        )
    }

    func testSeriesCreatorAndMetadataFillEpisodeFields() throws {
        let json = #"""
        {
          "series_id": "series-1",
          "title": "剧集标题",
          "intro": "剧集简介",
          "cover_url": "/api/v1/covers/series-1.jpg",
          "status": "published",
          "creator": {
            "user_id": "user-1",
            "username": "creator_name",
            "nickname": "创作者昵称",
            "avatar_url": "/api/v1/avatars/user-1.jpg",
            "followed_by_me": true
          },
          "episodes": [{
            "video_id": "episode-1",
            "episode_number": 1,
            "title": "第一集",
            "play_url": "/api/v1/short-drama/videos/episode-1/play"
          }]
        }
        """#.data(using: .utf8)!

        let series = try JSONDecoder().decode(ShortDramaSeries.self, from: json)
        let episode = try XCTUnwrap(series.episodes.first)

        XCTAssertEqual(episode.dramaID, "series-1")
        XCTAssertEqual(episode.dramaTitle, "剧集标题")
        XCTAssertEqual(episode.intro, "剧集简介")
        XCTAssertEqual(episode.coverURL, "/api/v1/covers/series-1.jpg")
        XCTAssertEqual(episode.creator.userID, "user-1")
        XCTAssertEqual(episode.creator.username, "creator_name")
        XCTAssertEqual(episode.creator.nickname, "创作者昵称")
        XCTAssertEqual(episode.creator.avatarURL, "/api/v1/avatars/user-1.jpg")
        XCTAssertTrue(episode.creator.followedByMe)
    }

    func testPartialEpisodeCreatorUsesMatchingSeriesCreatorFields() throws {
        let json = #"""
        {
          "series_id": "series-1",
          "title": "剧集标题",
          "creator": {
            "user_id": "user-1",
            "username": "creator_name",
            "nickname": "创作者昵称",
            "avatar_url": "/api/v1/avatars/user-1.jpg"
          },
          "episodes": [{
            "video_id": "episode-1",
            "creator": { "user_id": "user-1" },
            "play_url": "/api/v1/short-drama/videos/episode-1/play"
          }]
        }
        """#.data(using: .utf8)!

        let series = try JSONDecoder().decode(ShortDramaSeries.self, from: json)
        let creator = try XCTUnwrap(series.episodes.first?.creator)

        XCTAssertEqual(creator.username, "creator_name")
        XCTAssertEqual(creator.nickname, "创作者昵称")
        XCTAssertEqual(creator.avatarURL, "/api/v1/avatars/user-1.jpg")
    }

    func testProtectedSameAPIURLReceivesAuthorizationHeader() {
        let headers = ShortDramaMediaSecurity.authorizationHeaders(
            for: URL(string: "http://52.193.78.191/api/v1/short-drama/videos/e1/play")!,
            apiBaseURL: "http://52.193.78.191/api/v1",
            token: "test-token"
        )

        XCTAssertEqual(headers?["Authorization"], "Bearer test-token")
    }

    func testAuthorizationHeaderIsNotSentOutsideAPIOriginOrPath() {
        let apiBaseURL = "http://52.193.78.191/api/v1"

        XCTAssertNil(ShortDramaMediaSecurity.authorizationHeaders(
            for: URL(string: "https://cdn.example.com/video.m3u8")!,
            apiBaseURL: apiBaseURL,
            token: "test-token"
        ))
        XCTAssertNil(ShortDramaMediaSecurity.authorizationHeaders(
            for: URL(string: "http://52.193.78.191/public/signed-video.m3u8")!,
            apiBaseURL: apiBaseURL,
            token: "test-token"
        ))
        XCTAssertNil(ShortDramaMediaSecurity.authorizationHeaders(
            for: URL(string: "http://52.193.78.191/api/v1/video.m3u8")!,
            apiBaseURL: apiBaseURL,
            token: nil
        ))
    }
}
