import Foundation
import UIKit

@MainActor
class MomentsViewModel: ObservableObject {
    @Published var moments: [Moment] = []
    @Published var isLoading = false
    @Published var hasMore = true
    @Published var errorMessage: String?

    /// nil = public feed (friends+self); non-nil = single user's moments
    var filterUserID: String?

    func loadFeed(refresh: Bool = false) async {
        if refresh { hasMore = true }
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil

        do {
            let (items, more): ([Moment], Bool)
            if let uid = filterUserID {
                (items, more) = try await APIService.shared.getUserMoments(userID: uid)
            } else {
                (items, more) = try await APIService.shared.getMomentsFeed()
            }
            moments = items
            hasMore = more
        } catch {
            if moments.isEmpty { errorMessage = "加载失败" }
        }

        isLoading = false
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

    func addComment(momentID: Int, content: String, replyToUserID: String? = nil) async {
        do {
            let comment = try await APIService.shared.addMomentComment(
                momentID: momentID, content: content, replyToUserID: replyToUserID
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
