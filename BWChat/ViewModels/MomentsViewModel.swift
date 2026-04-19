import Foundation
import UIKit

@MainActor
class MomentsViewModel: ObservableObject {
    @Published var moments: [Moment] = []
    @Published var isLoading = false
    @Published var hasMore = true
    @Published var errorMessage: String?

    /// nil = public feed (friends+self); non-nil = single user's moments
    var filterUserID: String? {
        didSet { seedFromCacheIfNeeded() }
    }

    private static let feedCacheKey = "moments_feed"
    private var didSeedCache = false

    /// Prime `moments` from disk on first read, once we know whether this
    /// VM is rendering the public feed or a filtered user page. Only the
    /// public feed is cached — per-user pages are rare enough to skip.
    private func seedFromCacheIfNeeded() {
        guard !didSeedCache, filterUserID == nil, moments.isEmpty else { return }
        didSeedCache = true
        if let cached = LocalCache.load([Moment].self, key: Self.feedCacheKey) {
            moments = cached
        }
    }

    func loadFeed(refresh: Bool = false) async {
        seedFromCacheIfNeeded()
        if refresh { hasMore = true }
        guard !isLoading else { return }
        // Show the blocking loader only on the very first load or an explicit
        // refresh — avoid flashing the spinner over an already-populated feed
        // when the tab reappears after a NavigationStack pop.
        let showLoader = moments.isEmpty || refresh
        if showLoader { isLoading = true }
        errorMessage = nil
        defer { isLoading = false }

        do {
            let (items, more): ([Moment], Bool)
            if let uid = filterUserID {
                (items, more) = try await APIService.shared.getUserMoments(userID: uid)
            } else {
                (items, more) = try await APIService.shared.getMomentsFeed()
            }
            if moments != items {
                moments = items
            }
            hasMore = more
            if filterUserID == nil {
                LocalCache.save(items, key: Self.feedCacheKey)
            }
        } catch {
            if moments.isEmpty { errorMessage = "加载失败" }
        }
    }

    func loadMore() async {
        guard hasMore, !isLoading, let lastID = moments.last?.id else { return }
        isLoading = true

        do {
            let (items, more): ([Moment], Bool)
            if let uid = filterUserID {
                (items, more) = try await APIService.shared.getUserMoments(userID: uid, beforeID: lastID)
            } else {
                (items, more) = try await APIService.shared.getMomentsFeed(beforeID: lastID)
            }
            moments.append(contentsOf: items)
            hasMore = more
        } catch { }

        isLoading = false
    }

    func toggleLike(momentID: Int) async {
        do {
            let liked = try await APIService.shared.toggleMomentLike(momentID: momentID)
            if let index = moments.firstIndex(where: { $0.id == momentID }) {
                let m = moments[index]
                let myID = AuthManager.shared.currentUser?.userID ?? ""
                let myNick = AuthManager.shared.currentUser?.nickname ?? ""
                let myAvatar = AuthManager.shared.currentUser?.avatarURL ?? ""
                let me = MomentAuthor(userID: myID, nickname: myNick, avatarURL: myAvatar)

                var newLikes = m.likes.filter { $0.userID != myID }
                if liked { newLikes.append(me) }

                moments[index] = Moment(
                    id: m.id, author: m.author, content: m.content,
                    images: m.images, createdAt: m.createdAt,
                    likes: newLikes, comments: m.comments, likedByMe: liked
                )
            }
        } catch { }
    }

    func addComment(momentID: Int, content: String, replyToUserID: String? = nil, imageData: Data? = nil) async {
        do {
            let imgJpeg: Data? = imageData.flatMap { UIImage(data: $0)?.jpegData(compressionQuality: 0.7) }
            let comment = try await APIService.shared.addMomentComment(
                momentID: momentID, content: content, replyToUserID: replyToUserID, imageData: imgJpeg
            )
            if let index = moments.firstIndex(where: { $0.id == momentID }) {
                let m = moments[index]
                var newComments = m.comments
                newComments.append(comment)
                moments[index] = Moment(
                    id: m.id, author: m.author, content: m.content,
                    images: m.images, createdAt: m.createdAt,
                    likes: m.likes, comments: newComments, likedByMe: m.likedByMe
                )
            }
        } catch { }
    }

    func deleteMoment(momentID: Int) async {
        do {
            try await APIService.shared.deleteMoment(momentID: momentID)
            moments.removeAll { $0.id == momentID }
        } catch { }
    }

    func createMoment(content: String, images: [UIImage]) async -> Bool {
        var imageDataList: [(Data, String)] = []
        for (i, img) in images.enumerated() {
            if let data = img.jpegData(compressionQuality: 0.85) {
                imageDataList.append((data, "moment_\(Int(Date().timeIntervalSince1970))_\(i).jpg"))
            }
        }

        do {
            let moment = try await APIService.shared.createMoment(content: content, imageDataList: imageDataList)
            moments.insert(moment, at: 0)
            return true
        } catch {
            return false
        }
    }
}
