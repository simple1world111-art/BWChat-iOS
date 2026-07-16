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
