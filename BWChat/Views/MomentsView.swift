import SwiftUI
import PhotosUI
import UIKit

struct MomentsView: View {
    var filterUserID: String? = nil
    var pageTitle: String = "朋友圈"

    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel = MomentsViewModel()
    @StateObject private var momentsNotif = MomentsNotificationManager.shared
    @State private var showCreateMoment = false
    @State private var showNotificationList = false
    @State private var commentText = ""
    @State private var commentTarget: (momentID: Int, replyToUserID: String?, replyToName: String?, replyContent: String?)? = nil
    @State private var commentTriggerID = UUID()
    @State private var commentImageItem: PhotosPickerItem?
    @State private var commentImageData: Data?
    @FocusState private var commentFieldFocused: Bool

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                momentsHeader
                    .padding(.bottom, 8)

                if momentsNotif.unreadCount > 0 && filterUserID == nil {
                    notificationBanner
                        .padding(.horizontal, 12)
                        .padding(.bottom, 8)
                }

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
                        onComment: { replyUserID, replyName, replyContent in
                            commentTarget = (moment.id, replyUserID, replyName, replyContent)
                            commentTriggerID = UUID()
                        },
                        onDelete: { Task { await viewModel.deleteMoment(momentID: moment.id) } },
                        onImageTap: { url in
                            hideKeyboard()
                            ImageGalleryState.shared.show(urls: moment.images, index: moment.images.firstIndex(of: url) ?? 0)
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
        .hidesTabBarOnPush()
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
        .onChange(of: showNotificationList) { show in
            if show {
                showNotificationList = false
                navigator.push(MomentsNotificationListView())
            }
        }
        .task(id: "\(AuthManager.shared.currentUser?.userID ?? "")|\(filterUserID ?? "")") {
            viewModel.filterUserID = filterUserID
            await viewModel.loadFeed()
        }
        .refreshable {
            await viewModel.loadFeed(refresh: true)
            await momentsNotif.fetchFromServer()
        }
    }

    private var notificationBanner: some View {
        Button {
            showNotificationList = true
            momentsNotif.clearInteractionBadge()
        } label: {
            HStack(spacing: 10) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "heart.circle.fill")
                        .font(.system(size: 32))
                        .foregroundColor(Color(hex: "576B95"))

                    Text("\(momentsNotif.unreadCount)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Color.red)
                        .cornerRadius(8)
                        .offset(x: 6, y: -4)
                }

                Text("\(momentsNotif.unreadCount)条新消息")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Color(hex: "576B95"))

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(AppColors.tertiaryText)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color(hex: "576B95").opacity(0.08))
            )
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

            if let target = commentTarget, let name = target.replyToName {
                HStack(spacing: 6) {
                    Image(systemName: "arrowshape.turn.up.left.fill")
                        .font(.system(size: 10))
                        .foregroundColor(AppColors.tertiaryText)
                    Text("回复 \(name)")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Color(hex: "576B95"))
                    if let content = target.replyContent {
                        Text(": \(content)")
                            .font(.system(size: 12))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .padding(.bottom, 2)
            }

            if let imgData = commentImageData, let uiImg = UIImage(data: imgData) {
                HStack {
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: uiImg)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 60, height: 60)
                            .clipped()
                            .cornerRadius(6)

                        Button {
                            commentImageData = nil
                            commentImageItem = nil
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 16))
                                .foregroundColor(.white)
                                .background(Circle().fill(Color.black.opacity(0.5)))
                        }
                        .offset(x: 4, y: -4)
                    }
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.top, 6)
            }

            HStack(spacing: 10) {
                PhotosPicker(selection: $commentImageItem, matching: .images) {
                    Image(systemName: "photo")
                        .font(.system(size: 20))
                        .foregroundColor(AppColors.accent)
                }
                .onChange(of: commentImageItem) { item in
                    Task {
                        if let data = try? await item?.loadTransferable(type: Data.self) {
                            commentImageData = data
                        }
                    }
                }

                TextField(
                    commentTarget?.replyToName != nil ? "回复 \(commentTarget!.replyToName!)..." : "评论...",
                    text: $commentText,
                    axis: .vertical
                )
                .focused($commentFieldFocused)
                .font(.system(size: 16))
                .lineLimit(1...4)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 20).fill(AppColors.separator))

                Button {
                    sendComment()
                } label: {
                    Text("发送")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(canSendComment ? AppColors.accent : AppColors.tertiaryText)
                        .cornerRadius(20)
                }
                .disabled(!canSendComment)

                Button {
                    commentTarget = nil
                    commentText = ""
                    commentImageData = nil
                    commentImageItem = nil
                    commentFieldFocused = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 22))
                        .foregroundColor(AppColors.tertiaryText)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(AppColors.cardBackground)
        .shadow(color: .black.opacity(0.08), radius: 8, y: -2)
        .onChange(of: commentTriggerID) { _ in
            if commentTarget != nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                    commentFieldFocused = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    if commentTarget != nil && !commentFieldFocused {
                        commentFieldFocused = true
                    }
                }
            }
        }
    }

    private var canSendComment: Bool {
        !commentText.isEmpty || commentImageData != nil
    }

    private func sendComment() {
        guard let target = commentTarget, canSendComment else { return }
        let text = commentText
        let imgData = commentImageData
        commentText = ""
        commentImageData = nil
        commentImageItem = nil
        commentTarget = nil
        commentFieldFocused = false
        Task {
            await viewModel.addComment(
                momentID: target.momentID,
                content: text,
                replyToUserID: target.replyToUserID,
                imageData: imgData
            )
        }
    }
}

// MARK: - Moment Row

struct MomentRow: View {
    let moment: Moment
    var onLike: () -> Void
    var onComment: (_ replyToUserID: String?, _ replyToName: String?, _ replyContent: String?) -> Void
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

                HStack {
                    Text(moment.formattedTime)
                        .font(.system(size: 12))
                        .foregroundColor(AppColors.tertiaryText)

                    Spacer()

                    Button { withAnimation(.easeInOut(duration: 0.2)) { showActions.toggle() } } label: {
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
                            onComment(nil, nil, nil)
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
                            commentRow(comment)
                        }
                    }
                    .padding(8)
                    .background(AppColors.separator.opacity(0.5))
                    .cornerRadius(6)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private func commentRow(_ comment: MomentComment) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Group {
                if let replyTo = comment.replyTo {
                    if !comment.content.isEmpty {
                        (Text(comment.nickname)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(Color(hex: "576B95"))
                        + Text(" 回复 ")
                            .font(.system(size: 13))
                            .foregroundColor(AppColors.secondaryText)
                        + Text(replyTo.nickname)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(Color(hex: "576B95"))
                        + Text(": \(comment.content)")
                            .font(.system(size: 13))
                            .foregroundColor(AppColors.primaryText))
                    } else {
                        (Text(comment.nickname)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(Color(hex: "576B95"))
                        + Text(" 回复 ")
                            .font(.system(size: 13))
                            .foregroundColor(AppColors.secondaryText)
                        + Text(replyTo.nickname)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(Color(hex: "576B95")))
                    }
                } else {
                    if !comment.content.isEmpty {
                        (Text(comment.nickname)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(Color(hex: "576B95"))
                        + Text(": \(comment.content)")
                            .font(.system(size: 13))
                            .foregroundColor(AppColors.primaryText))
                    } else {
                        Text(comment.nickname)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(Color(hex: "576B95"))
                    }
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .contentShape(Rectangle())
            .onTapGesture {
                onComment(comment.userID, comment.nickname, comment.content)
            }

            if let imageURL = comment.imageURL, !imageURL.isEmpty {
                HStack(spacing: 0) {
                    CommentImageView(url: imageURL)
                        .onTapGesture {
                            hideKeyboard()
                            ImageGalleryState.shared.show(urls: [imageURL], index: 0)
                        }
                    Spacer()
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    onComment(comment.userID, comment.nickname, comment.content)
                }
            }

            if let createdAt = comment.createdAt {
                Text(Moment.relativeTime(from: createdAt))
                    .font(.system(size: 11))
                    .foregroundColor(AppColors.tertiaryText)
            }
        }
    }

    @ViewBuilder
    private var momentImageGrid: some View {
        let count = moment.images.count

        if count == 1 {
            MomentSingleImage(url: moment.images[0])
                .onTapGesture {
                    onImageTap(moment.images[0])
                }
        } else {
            let cols = count <= 4 ? 2 : 3
            let spacing: CGFloat = 3
            let maxGridWidth: CGFloat = CGFloat(cols) * 80 + spacing * CGFloat(cols - 1)

            VStack(alignment: .leading, spacing: spacing) {
                ForEach(0..<((count + cols - 1) / cols), id: \.self) { row in
                    HStack(spacing: spacing) {
                        ForEach(0..<cols, id: \.self) { col in
                            let idx = row * cols + col
                            if idx < count {
                                MomentImageCell(url: moment.images[idx], size: 80)
                                    .onTapGesture {
                                        onImageTap(moment.images[idx])
                                    }
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: maxGridWidth, alignment: .leading)
        }
    }
}

// MARK: - Single image (keeps original aspect ratio)

struct MomentSingleImage: View {
    let url: String
    @State private var image: UIImage?
    @State private var isLoading = true

    private var thumbCacheKey: String { url + "?thumb=1" }

    var body: some View {
        Group {
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 200, maxHeight: 260)
                    .cornerRadius(6)
                    .longPressToSaveImage(url: url)
            } else if isLoading {
                RoundedRectangle(cornerRadius: 6)
                    .fill(AppColors.separator)
                    .frame(width: 140, height: 140)
                    .overlay(ProgressView().tint(AppColors.accent))
            } else {
                RoundedRectangle(cornerRadius: 6)
                    .fill(AppColors.separator)
                    .frame(width: 140, height: 140)
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundColor(AppColors.secondaryText)
                    )
            }
        }
        .onAppear {
            if image == nil, let cached = ImageCacheManager.shared.image(for: thumbCacheKey) {
                image = cached
                isLoading = false
            }
        }
        .task(id: url) {
            if image == nil {
                image = await ImageCacheManager.shared.loadImage(from: url, thumbnail: true)
            }
            isLoading = false
        }
    }
}

// MARK: - Square-cropped Moment Image Cell

struct MomentImageCell: View {
    let url: String
    let size: CGFloat
    @State private var image: UIImage?
    @State private var isLoading = true

    private var thumbCacheKey: String { url + "?thumb=1" }

    var body: some View {
        Group {
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipped()
                    .cornerRadius(4)
                    .longPressToSaveImage(url: url)
            } else if isLoading {
                RoundedRectangle(cornerRadius: 4)
                    .fill(AppColors.separator)
                    .frame(width: size, height: size)
                    .overlay(ProgressView().tint(AppColors.accent).scaleEffect(0.6))
            } else {
                RoundedRectangle(cornerRadius: 4)
                    .fill(AppColors.separator)
                    .frame(width: size, height: size)
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundColor(AppColors.secondaryText)
                    )
            }
        }
        .onAppear {
            if image == nil, let cached = ImageCacheManager.shared.image(for: thumbCacheKey) {
                image = cached
                isLoading = false
            }
        }
        .task(id: url) {
            if image == nil {
                image = await ImageCacheManager.shared.loadImage(from: url, thumbnail: true)
            }
            isLoading = false
        }
    }
}

// MARK: - Moments Notification List

struct MomentsNotificationListView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @State private var notifications: [MomentsNotification] = []
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if notifications.isEmpty {
                VStack(spacing: 14) {
                    Image(systemName: "bell.slash")
                        .font(.system(size: 36))
                        .foregroundColor(AppColors.tertiaryText)
                    Text("暂无消息")
                        .font(.system(size: 15))
                        .foregroundColor(AppColors.secondaryText)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(notifications) { notif in
                    Button {
                        navigator.push(MomentDetailView(momentID: notif.momentID))
                    } label: {
                        MomentsNotificationRow(notification: notif)
                    }
                    .listRowSeparator(.visible)
                }
                .listStyle(.plain)
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle("消息")
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .task {
            do {
                notifications = try await APIService.shared.getMomentsNotifications()
            } catch { }
            isLoading = false
        }
    }
}

struct MomentsNotificationRow: View {
    let notification: MomentsNotification

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: notification.user.avatarURL, size: 40)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 0) {
                    Text(notification.user.nickname)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Color(hex: "576B95"))

                    Text(notification.type == "like" ? " 赞了你的动态" : " 评论了你的动态")
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.primaryText)
                }

                if let content = notification.content, notification.type == "comment" {
                    Text(content)
                        .font(.system(size: 13))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(2)
                }

                Text(notification.formattedTime)
                    .font(.system(size: 11))
                    .foregroundColor(AppColors.tertiaryText)
            }

            Spacer()

            notifMomentPreview
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var notifMomentPreview: some View {
        if let images = notification.momentImages, let first = images.first, !first.isEmpty {
            MomentImageCell(url: first, size: 44)
        } else if let text = notification.momentContent, !text.isEmpty {
            Text(text)
                .font(.system(size: 11))
                .foregroundColor(AppColors.secondaryText)
                .lineLimit(2)
                .frame(width: 44, height: 44)
                .background(AppColors.separator.opacity(0.5))
                .cornerRadius(4)
        }
    }
}

// MARK: - Moment Detail View

struct MomentDetailView: View {
    let momentID: Int
    @State private var moment: Moment?
    @State private var isLoading = true
    @State private var commentText = ""
    @State private var commentTarget: (replyToUserID: String?, replyToName: String?, replyContent: String?)?
    @State private var commentTriggerID = UUID()
    @State private var commentImageItem: PhotosPickerItem?
    @State private var commentImageData: Data?
    @FocusState private var commentFieldFocused: Bool

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let moment = moment {
                ScrollView {
                    VStack(spacing: 0) {
                        MomentRow(
                            moment: moment,
                            onLike: { toggleLike() },
                            onComment: { replyUserID, replyName, replyContent in
                                commentTarget = (replyUserID, replyName, replyContent)
                                commentTriggerID = UUID()
                            },
                            onDelete: { },
                            onImageTap: { url in
                                hideKeyboard()
                                ImageGalleryState.shared.show(
                                    urls: moment.images,
                                    index: moment.images.firstIndex(of: url) ?? 0
                                )
                            }
                        )
                    }
                }
                .overlay(alignment: .bottom) {
                    if commentTarget != nil {
                        detailCommentInput
                    }
                }
            } else {
                VStack(spacing: 14) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 36))
                        .foregroundColor(AppColors.tertiaryText)
                    Text("动态不存在或已删除")
                        .font(.system(size: 15))
                        .foregroundColor(AppColors.secondaryText)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle("动态详情")
        .navigationBarTitleDisplayMode(.inline)
        .hidesTabBarOnPush()
        .task { await loadMoment() }
    }

    private func loadMoment() async {
        do {
            moment = try await APIService.shared.getMomentDetail(momentID: momentID)
        } catch { }
        isLoading = false
    }

    private func toggleLike() {
        Task {
            guard let m = moment else { return }
            do {
                let liked = try await APIService.shared.toggleMomentLike(momentID: m.id)
                let myID = AuthManager.shared.currentUser?.userID ?? ""
                let myNick = AuthManager.shared.currentUser?.nickname ?? ""
                let myAvatar = AuthManager.shared.currentUser?.avatarURL ?? ""
                let me = MomentAuthor(userID: myID, nickname: myNick, avatarURL: myAvatar)
                var newLikes = m.likes.filter { $0.userID != myID }
                if liked { newLikes.append(me) }
                moment = Moment(
                    id: m.id, author: m.author, content: m.content,
                    images: m.images, createdAt: m.createdAt,
                    likes: newLikes, comments: m.comments, likedByMe: liked
                )
            } catch { }
        }
    }

    private var canSendDetailComment: Bool {
        !commentText.isEmpty || commentImageData != nil
    }

    private func sendComment() {
        guard let target = commentTarget, canSendDetailComment, let m = moment else { return }
        let text = commentText
        let imgData = commentImageData
        commentText = ""
        commentImageData = nil
        commentImageItem = nil
        commentTarget = nil
        commentFieldFocused = false
        Task {
            do {
                let imgJpeg: Data? = imgData.flatMap { UIImage(data: $0)?.jpegData(compressionQuality: 0.7) }
                let comment = try await APIService.shared.addMomentComment(
                    momentID: m.id, content: text, replyToUserID: target.replyToUserID, imageData: imgJpeg
                )
                var newComments = m.comments
                newComments.append(comment)
                moment = Moment(
                    id: m.id, author: m.author, content: m.content,
                    images: m.images, createdAt: m.createdAt,
                    likes: m.likes, comments: newComments, likedByMe: m.likedByMe
                )
            } catch { }
        }
    }

    private var detailCommentInput: some View {
        VStack(spacing: 0) {
            Divider()

            if let target = commentTarget, let name = target.replyToName {
                HStack(spacing: 6) {
                    Image(systemName: "arrowshape.turn.up.left.fill")
                        .font(.system(size: 10))
                        .foregroundColor(AppColors.tertiaryText)
                    Text("回复 \(name)")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(Color(hex: "576B95"))
                    if let content = target.replyContent {
                        Text(": \(content)")
                            .font(.system(size: 12))
                            .foregroundColor(AppColors.secondaryText)
                            .lineLimit(1)
                    }
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .padding(.bottom, 2)
            }

            if let imgData = commentImageData, let uiImg = UIImage(data: imgData) {
                HStack {
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: uiImg)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 60, height: 60)
                            .clipped()
                            .cornerRadius(6)

                        Button {
                            commentImageData = nil
                            commentImageItem = nil
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 16))
                                .foregroundColor(.white)
                                .background(Circle().fill(Color.black.opacity(0.5)))
                        }
                        .offset(x: 4, y: -4)
                    }
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.top, 6)
            }

            HStack(spacing: 10) {
                PhotosPicker(selection: $commentImageItem, matching: .images) {
                    Image(systemName: "photo")
                        .font(.system(size: 20))
                        .foregroundColor(AppColors.accent)
                }
                .onChange(of: commentImageItem) { item in
                    Task {
                        if let data = try? await item?.loadTransferable(type: Data.self) {
                            commentImageData = data
                        }
                    }
                }

                TextField(
                    commentTarget?.replyToName != nil ? "回复 \(commentTarget!.replyToName!)..." : "评论...",
                    text: $commentText,
                    axis: .vertical
                )
                .focused($commentFieldFocused)
                .font(.system(size: 16))
                .lineLimit(1...4)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(RoundedRectangle(cornerRadius: 20).fill(AppColors.separator))

                Button { sendComment() } label: {
                    Text("发送")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(canSendDetailComment ? AppColors.accent : AppColors.tertiaryText)
                        .cornerRadius(20)
                }
                .disabled(!canSendDetailComment)

                Button {
                    commentTarget = nil
                    commentText = ""
                    commentImageData = nil
                    commentImageItem = nil
                    commentFieldFocused = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 22))
                        .foregroundColor(AppColors.tertiaryText)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(AppColors.cardBackground)
        .shadow(color: .black.opacity(0.08), radius: 8, y: -2)
        .onChange(of: commentTriggerID) { _ in
            if commentTarget != nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                    commentFieldFocused = true
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    if commentTarget != nil && !commentFieldFocused {
                        commentFieldFocused = true
                    }
                }
            }
        }
    }
}

// MARK: - Comment Image View (small thumbnail)

struct CommentImageView: View {
    let url: String
    @State private var image: UIImage?
    @State private var isLoading = true

    private var thumbCacheKey: String { url + "?thumb=1" }

    var body: some View {
        Group {
            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 50, height: 50)
                    .clipped()
                    .cornerRadius(4)
                    .longPressToSaveImage(url: url)
            } else if isLoading {
                RoundedRectangle(cornerRadius: 4)
                    .fill(AppColors.separator)
                    .frame(width: 50, height: 50)
                    .overlay(ProgressView().tint(AppColors.accent).scaleEffect(0.5))
            }
        }
        .padding(.top, 2)
        .onAppear {
            if image == nil, let cached = ImageCacheManager.shared.image(for: thumbCacheKey) {
                image = cached
                isLoading = false
            }
        }
        .task(id: url) {
            if image == nil {
                image = await ImageCacheManager.shared.loadImage(from: url, thumbnail: true)
            }
            isLoading = false
        }
    }
}
