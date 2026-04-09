import SwiftUI

struct MomentsView: View {
    var filterUserID: String? = nil
    var pageTitle: String = "朋友圈"

    @StateObject private var viewModel = MomentsViewModel()
    @State private var showCreateMoment = false
    @State private var commentText = ""
    @State private var commentTarget: (momentID: Int, replyToUserID: String?, replyToName: String?)? = nil
    @State private var previewImageURLs: [String] = []
    @State private var previewImageIndex: Int = 0
    @State private var showImageGallery = false

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                momentsHeader
                    .padding(.bottom, 8)

                if viewModel.moments.isEmpty && !viewModel.isLoading {
                    VStack(spacing: 14) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.system(size: 36))
                            .foregroundColor(AppColors.tertiaryText)
                        Text("暂无动态")
                            .font(.system(size: 15))
                            .foregroundColor(AppColors.secondaryText)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 60)
                }

                ForEach(viewModel.moments) { moment in
                    MomentRow(
                        moment: moment,
                        onLike: { Task { await viewModel.toggleLike(momentID: moment.id) } },
                        onComment: { replyUserID, replyName in
                            commentTarget = (moment.id, replyUserID, replyName)
                        },
                        onDelete: { Task { await viewModel.deleteMoment(momentID: moment.id) } },
                        onImageTap: { url in
                            previewImageURLs = moment.images
                            previewImageIndex = moment.images.firstIndex(of: url) ?? 0
                            showImageGallery = true
                        }
                    )

                    Divider().padding(.leading, 62)
                }

                if viewModel.hasMore && !viewModel.moments.isEmpty {
                    ProgressView()
                        .padding()
                        .task { await viewModel.loadMore() }
                }
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(pageTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showCreateMoment = true } label: {
                    Image(systemName: "camera.fill")
                        .font(.system(size: 16))
                        .foregroundColor(AppColors.accent)
                }
            }
        }
        .sheet(isPresented: $showCreateMoment) {
            CreateMomentView { content, images in
                let success = await viewModel.createMoment(content: content, images: images)
                if success { await MainActor.run { showCreateMoment = false } }
                return success
            }
        }
        .overlay(alignment: .bottom) {
            if commentTarget != nil {
                commentInputBar
            }
        }
        .fullScreenCover(isPresented: $showImageGallery) {
            ImageGalleryPreview(imageURLs: previewImageURLs, initialIndex: previewImageIndex)
        }
        .task {
            viewModel.filterUserID = filterUserID
            await viewModel.loadFeed()
        }
        .refreshable {
            await viewModel.loadFeed(refresh: true)
        }
    }

    private var momentsHeader: some View {
        ZStack(alignment: .bottomTrailing) {
            LinearGradient(
                colors: [Color(hex: "667eea"), Color(hex: "764ba2")],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .frame(height: 200)
            .overlay(alignment: .bottomLeading) {
                if let user = AuthManager.shared.currentUser {
                    HStack(spacing: 12) {
                        AvatarView(url: user.avatarURL, size: 56)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.white, lineWidth: 2)
                            )
                        Text(user.nickname)
                            .font(.system(size: 18, weight: .bold))
                            .foregroundColor(.white)
                            .shadow(radius: 2)
                    }
                    .padding(.leading, 16)
                    .padding(.bottom, 12)
                }
            }
        }
    }

    private var commentInputBar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 10) {
                TextField(
                    commentTarget?.replyToName != nil ? "回复 \(commentTarget!.replyToName!)..." : "评论...",
                    text: $commentText
                )
                .font(.system(size: 16))
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 20).fill(AppColors.separator))

                Button {
                    guard let target = commentTarget, !commentText.isEmpty else { return }
                    let text = commentText
                    commentText = ""
                    commentTarget = nil
                    Task {
                        await viewModel.addComment(
                            momentID: target.momentID,
                            content: text,
                            replyToUserID: target.replyToUserID
                        )
                    }
                } label: {
                    Text("发送")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(commentText.isEmpty ? AppColors.tertiaryText : AppColors.accent)
                }
                .disabled(commentText.isEmpty)

                Button {
                    commentTarget = nil
                    commentText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(AppColors.tertiaryText)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(AppColors.secondaryBackground)
    }
}

// MARK: - Moment Row

struct MomentRow: View {
    let moment: Moment
    var onLike: () -> Void
    var onComment: (_ replyToUserID: String?, _ replyToName: String?) -> Void
    var onDelete: () -> Void
    var onImageTap: (String) -> Void
    @State private var showActions = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: moment.author.avatarURL, size: 42)

            VStack(alignment: .leading, spacing: 6) {
                Text(moment.author.nickname)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Color(hex: "576B95"))

                if !moment.content.isEmpty {
                    Text(moment.content)
                        .font(.system(size: 15))
                        .foregroundColor(AppColors.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !moment.images.isEmpty {
                    momentImageGrid
                }

                if !moment.likes.isEmpty || !moment.comments.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        if !moment.likes.isEmpty {
                            HStack(spacing: 4) {
                                Image(systemName: "heart.fill")
                                    .font(.system(size: 11))
                                    .foregroundColor(Color(hex: "576B95"))
                                Text(moment.likes.map(\.nickname).joined(separator: ", "))
                                    .font(.system(size: 13))
                                    .foregroundColor(Color(hex: "576B95"))
                                    .lineLimit(2)
                            }
                        }

                        if !moment.likes.isEmpty && !moment.comments.isEmpty {
                            Divider()
                        }

                        ForEach(moment.comments) { comment in
                            commentView(comment)
                                .onTapGesture {
                                    onComment(comment.userID, comment.nickname)
                                }
                        }
                    }
                    .padding(8)
                    .background(AppColors.separator.opacity(0.5))
                    .cornerRadius(6)
                }

                HStack {
                    Text(moment.formattedTime)
                        .font(.system(size: 12))
                        .foregroundColor(AppColors.tertiaryText)

                    Spacer()

                    Button { showActions.toggle() } label: {
                        Image(systemName: "ellipsis.bubble")
                            .font(.system(size: 14))
                            .foregroundColor(AppColors.tertiaryText)
                    }
                }

                if showActions {
                    HStack(spacing: 20) {
                        Button {
                            showActions = false
                            onLike()
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: moment.likedByMe ? "heart.fill" : "heart")
                                    .font(.system(size: 13))
                                Text(moment.likedByMe ? "取消" : "赞")
                                    .font(.system(size: 13))
                            }
                            .foregroundColor(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 6)
                            .background(Color(hex: "4C566A"))
                            .cornerRadius(6)
                        }

                        Button {
                            showActions = false
                            onComment(nil, nil)
                        } label: {
                            HStack(spacing: 4) {
                                Image(systemName: "bubble.left")
                                    .font(.system(size: 13))
                                Text("评论")
                                    .font(.system(size: 13))
                            }
                            .foregroundColor(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 6)
                            .background(Color(hex: "4C566A"))
                            .cornerRadius(6)
                        }

                        if moment.author.userID == AuthManager.shared.currentUser?.userID {
                            Button {
                                showActions = false
                                onDelete()
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "trash")
                                        .font(.system(size: 13))
                                    Text("删除")
                                        .font(.system(size: 13))
                                }
                                .foregroundColor(.white)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 6)
                                .background(Color.red.opacity(0.8))
                                .cornerRadius(6)
                            }
                        }
                    }
                    .transition(.scale.combined(with: .opacity))
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private func commentView(_ comment: MomentComment) -> some View {
        HStack(spacing: 0) {
            Text(comment.nickname)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color(hex: "576B95"))

            if let replyTo = comment.replyTo {
                Text(" 回复 ")
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
                Text(replyTo.nickname)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color(hex: "576B95"))
            }

            Text(": \(comment.content)")
                .font(.system(size: 13))
                .foregroundColor(AppColors.primaryText)
        }
    }

    private var momentImageGrid: some View {
        let imageCount = moment.images.count
        let columns = imageCount == 1 ? 1 : (imageCount <= 4 ? 2 : 3)
        let gridColumns = Array(repeating: GridItem(.flexible(), spacing: 4), count: columns)

        return LazyVGrid(columns: gridColumns, spacing: 4) {
            ForEach(moment.images, id: \.self) { imageURL in
                CachedAsyncImage(url: imageURL, maxWidth: imageCount == 1 ? 220 : 120)
                    .onTapGesture { onImageTap(imageURL) }
            }
        }
        .frame(maxWidth: imageCount == 1 ? 220 : .infinity, alignment: .leading)
    }
}
