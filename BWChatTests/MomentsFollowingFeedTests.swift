import XCTest
@testable import BBchat

final class MomentsFollowingFeedTests: XCTestCase {
    func testFollowingFeedPreservesServerFilteringAndOrdering() {
        let moments = [
            moment(id: 1, authorID: "followed-a"),
            moment(id: 2, authorID: "server-authoritative"),
            moment(id: 3, authorID: "followed-b")
        ]

        let result = MomentsViewModel.followingFeedItems(from: moments)

        XCTAssertEqual(result.map(\.id), [1, 2, 3])
    }

    func testFollowingFeedDoesNotBecomeEmptyBecauseClientHasNoFollowSnapshot() {
        let result = MomentsViewModel.followingFeedItems(
            from: [moment(id: 1, authorID: "followed-on-server")]
        )

        XCTAssertEqual(result.map(\.id), [1])
    }

    func testBothPublicMomentTabsSupportOfflineCache() {
        XCTAssertTrue(MomentsViewModel.supportsOfflineCache(for: .recommended))
        XCTAssertTrue(MomentsViewModel.supportsOfflineCache(for: .following))
    }

    func testUnconfirmedEmptyMomentPageCannotReplaceNonEmptyCache() {
        XCTAssertFalse(MomentsViewModel.shouldAcceptRemoteFirstPage(
            itemCount: 0,
            replacingLocalCount: 12,
            snapshotComplete: nil
        ))
        XCTAssertFalse(MomentsViewModel.shouldAcceptRemoteFirstPage(
            itemCount: 0,
            replacingLocalCount: 12,
            snapshotComplete: false
        ))
        XCTAssertTrue(MomentsViewModel.shouldAcceptRemoteFirstPage(
            itemCount: 0,
            replacingLocalCount: 12,
            snapshotComplete: true
        ))
        XCTAssertTrue(MomentsViewModel.shouldAcceptRemoteFirstPage(
            itemCount: 0,
            replacingLocalCount: 0,
            snapshotComplete: nil
        ))
    }

    func testLegacyUserMomentCacheDecodesIntoSharedSnapshot() throws {
        let legacy = #"{"items":[],"hasMore":true}"#.data(using: .utf8)!

        let snapshot = try JSONDecoder().decode(CachedMomentFeedSnapshot.self, from: legacy)

        XCTAssertTrue(snapshot.items.isEmpty)
        XCTAssertTrue(snapshot.hasMore)
        XCTAssertNil(snapshot.nextBeforeID)
        XCTAssertNil(snapshot.snapshotComplete)
        XCTAssertEqual(MomentCacheNamespace.userFeed, "moments-user")
        XCTAssertEqual(MomentCacheNamespace.legacyProfileUserFeed, "user-moments")
    }

    func testCompleteEmptyMomentPageCanReplaceNonEmptyCache() {
        XCTAssertTrue(MomentFirstPageReplacementPolicy.shouldAccept(
            itemCount: 0,
            replacingLocalCount: 5,
            snapshotComplete: true
        ))
    }

    func testMomentFeedResponseRejectsMissingMomentsField() {
        let degradedResponse = #"{"has_more":false}"#.data(using: .utf8)!

        XCTAssertThrowsError(
            try JSONDecoder().decode(MomentFeedResponseData.self, from: degradedResponse)
        )
    }

    func testMomentFeedResponseReadsCompletenessSignal() throws {
        let completeEmpty = #"{"moments":[],"has_more":false,"snapshot_complete":true}"#
            .data(using: .utf8)!

        let response = try JSONDecoder().decode(MomentFeedResponseData.self, from: completeEmpty)

        XCTAssertTrue(response.moments.isEmpty)
        XCTAssertFalse(response.hasMore)
        XCTAssertEqual(response.snapshotComplete, true)
    }

    func testMomentMediaLayoutMatchesWechatStyleColumnRules() {
        XCTAssertEqual(MomentMediaLayout.columnCount(for: 1), 1)
        XCTAssertEqual(MomentMediaLayout.columnCount(for: 2), 2)
        XCTAssertEqual(MomentMediaLayout.columnCount(for: 3), 3)
        XCTAssertEqual(MomentMediaLayout.columnCount(for: 4), 2)
        XCTAssertEqual(MomentMediaLayout.columnCount(for: 5), 3)
        XCTAssertEqual(MomentMediaLayout.columnCount(for: 9), 3)
    }

    func testMomentMediaLayoutMakesTwoItemsLargerThanDenseGridItems() {
        let twoItemLayout = MomentMediaLayout.gridMetrics(mediaCount: 2, availableWidth: 286)
        let threeItemLayout = MomentMediaLayout.gridMetrics(mediaCount: 3, availableWidth: 286)

        XCTAssertEqual(twoItemLayout.cellSide, 140)
        XCTAssertEqual(twoItemLayout.gridWidth, 284)
        XCTAssertEqual(threeItemLayout.cellSide, 92)
        XCTAssertEqual(threeItemLayout.gridWidth, 284)
        XCTAssertGreaterThan(twoItemLayout.cellSide, threeItemLayout.cellSide)
    }

    func testMomentSingleMediaIsCappedAndGridShrinksOnNarrowScreens() {
        XCTAssertEqual(MomentMediaLayout.singleMediaSide(availableWidth: 286), 208)

        let narrowLayout = MomentMediaLayout.gridMetrics(mediaCount: 2, availableWidth: 216)
        XCTAssertEqual(narrowLayout.cellSide, 106)
        XCTAssertLessThanOrEqual(narrowLayout.gridWidth, 216)
    }

    func testMomentMediaPolicyAllowsPhotosOnlyOrOneVideo() throws {
        try MomentMediaPolicy.validate([])
        try MomentMediaPolicy.validate(Array(
            repeating: .image,
            count: MomentMediaPolicy.maximumImageCount
        ))
        try MomentMediaPolicy.validate([.video])
    }

    func testMomentMediaPolicyRejectsMixedPhotosAndVideo() {
        XCTAssertThrowsError(try MomentMediaPolicy.validate([.image, .video])) { error in
            XCTAssertEqual(error as? MomentMediaValidationError, .mixedMediaTypes)
        }
    }

    func testMomentMediaPolicyRejectsMoreThanOneVideo() {
        XCTAssertThrowsError(try MomentMediaPolicy.validate([.video, .video])) { error in
            XCTAssertEqual(
                error as? MomentMediaValidationError,
                .tooManyVideos(maximum: MomentMediaPolicy.maximumVideoCount)
            )
        }
    }

    func testMomentMediaPolicyRejectsMoreThanNinePhotos() {
        let kinds = Array(
            repeating: MomentUploadMedia.Kind.image,
            count: MomentMediaPolicy.maximumImageCount + 1
        )
        XCTAssertThrowsError(try MomentMediaPolicy.validate(kinds)) { error in
            XCTAssertEqual(
                error as? MomentMediaValidationError,
                .tooManyImages(maximum: MomentMediaPolicy.maximumImageCount)
            )
        }
    }

    private func moment(id: Int, authorID: String) -> Moment {
        Moment(
            id: id,
            author: MomentAuthor(userID: authorID, nickname: authorID, avatarURL: ""),
            content: "",
            images: [],
            createdAt: "2026-07-13 00:00:00",
            likes: [],
            comments: [],
            likedByMe: false
        )
    }
}
