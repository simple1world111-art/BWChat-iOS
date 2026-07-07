// BWChat/Views/ShortDramaCommentsSheet.swift
// Lazy-loaded comments sheet for short drama videos.

import SwiftUI

struct ShortDramaCommentsSheet: View {
    let video: ShortDramaVideo
    let onCommentSent: (ShortDramaComment) -> Void

    @State private var comments: [ShortDramaComment] = []
    @State private var draftText = ""
    @State private var isLoading = false
    @State private var isLoadingMore = false
    @State private var isSending = false
    @State private var hasMore = true
    @State private var nextCursor: String?
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 0) {
            header

            Divider()

            commentsList

            Divider()

            composer
        }
        .background(AppColors.secondaryBackground)
        .task {
            await loadInitial()
        }
        .toast(message: $errorMessage)
    }

    private var header: some View {
        HStack {
            Text(L10n.tr("shortDrama.comments"))
                .font(.system(size: 17, weight: .bold))
                .foregroundColor(AppColors.primaryText)
            Spacer()
            Text("\(max(video.commentCount, comments.count))")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(AppColors.secondaryText)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
    }

    private var commentsList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if isLoading && comments.isEmpty {
                    ProgressView()
                        .tint(AppColors.accent)
                        .padding(.top, 40)
                } else if comments.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "text.bubble")
                            .font(.system(size: 30, weight: .semibold))
                            .foregroundColor(AppColors.tertiaryText)
                        Text(L10n.tr("shortDrama.comments.empty"))
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(AppColors.secondaryText)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 48)
                } else {
                    ForEach(comments) { comment in
                        ShortDramaCommentRow(comment: comment)
                            .onAppear {
                                loadMoreIfNeeded(currentCommentID: comment.id)
                            }
                    }

                    if isLoadingMore {
                        ProgressView()
                            .tint(AppColors.accent)
                            .padding(.vertical, 14)
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
        }
    }

    private var composer: some View {
        HStack(spacing: 10) {
            TextField(L10n.tr("shortDrama.comment.placeholder"), text: $draftText, axis: .vertical)
                .font(.system(size: 15))
                .lineLimit(1...4)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(AppColors.cardBackground)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            Button {
                Task { await sendComment() }
            } label: {
                if isSending {
                    ProgressView()
                        .tint(.white)
                        .frame(width: 44, height: 38)
                } else {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 44, height: 38)
                }
            }
            .background(draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? AppColors.tertiaryText : AppColors.accent)
            .clipShape(Capsule())
            .disabled(draftText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(AppColors.secondaryBackground)
    }

    private func loadInitial() async {
        guard comments.isEmpty, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await APIService.shared.getShortDramaComments(videoID: video.id)
            comments = page.comments
            hasMore = page.hasMore
            nextCursor = page.nextCursor
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadMoreIfNeeded(currentCommentID: String) {
        guard comments.last?.id == currentCommentID,
              hasMore,
              !isLoading,
              !isLoadingMore else { return }
        Task { await loadMore() }
    }

    private func loadMore() async {
        guard hasMore, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await APIService.shared.getShortDramaComments(videoID: video.id, cursor: nextCursor)
            let existingIDs = Set(comments.map(\.id))
            comments.append(contentsOf: page.comments.filter { !existingIDs.contains($0.id) })
            hasMore = page.hasMore
            nextCursor = page.nextCursor
        } catch { }
    }

    private func sendComment() async {
        let content = draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty, !isSending else { return }
        isSending = true
        draftText = ""

        let currentUser = AuthManager.shared.currentUser
        let temporaryID = "local-\(UUID().uuidString)"
        let temporaryComment = ShortDramaComment(
            id: temporaryID,
            videoID: video.id,
            userID: currentUser?.userID ?? "",
            nickname: currentUser?.nickname ?? L10n.tr("profile.defaultUser"),
            avatarURL: currentUser?.avatarURL ?? "",
            content: content,
            createdAt: ""
        )
        comments.insert(temporaryComment, at: 0)

        do {
            let sent = try await APIService.shared.sendShortDramaComment(videoID: video.id, content: content)
            if let index = comments.firstIndex(where: { $0.id == temporaryID }) {
                comments[index] = sent
            }
            onCommentSent(sent)
        } catch {
            comments.removeAll { $0.id == temporaryID }
            draftText = content
            errorMessage = error.localizedDescription
        }
        isSending = false
    }
}

private struct ShortDramaCommentRow: View {
    let comment: ShortDramaComment

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: comment.avatarURL, size: 36)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(comment.nickname)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)

                    if !comment.createdAt.isBlank {
                        Text(TimestampHelper.formatListTime(comment.createdAt))
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(AppColors.tertiaryText)
                    }
                }

                Text(comment.content)
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.primaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 10)
    }
}
