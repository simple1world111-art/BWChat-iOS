import SwiftUI
import PhotosUI
import UIKit

private struct MomentUnlockRequest: Identifiable {
    let moment: Moment
    let idempotencyKey = UUID()

    var id: Int { moment.id }
    var kind: MediaUnlockKind {
        moment.media.first?.type == .video ? .video : .image
    }
}

private struct MomentsCoverFramePreferenceKey: PreferenceKey {
    static var defaultValue: CGRect = .null

    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        value = nextValue()
    }
}

@MainActor
private func isMomentAuthorCurrentUser(_ moment: Moment) -> Bool {
    guard let currentUserID = AuthManager.shared.currentUser?.userID, !currentUserID.isEmpty else {
        return false
    }
    return moment.author.userID == currentUserID
}

@MainActor
private func isMomentLockedForCurrentUser(_ moment: Moment) -> Bool {
    (moment.unlockPriceGoldCoins ?? 0) > 0
        && !moment.isUnlocked
        && !isMomentAuthorCurrentUser(moment)
        && (!moment.media.isEmpty || !moment.images.isEmpty)
}

@MainActor
private func isMediaLockedForCurrentUser(_ media: MomentMedia, in moment: Moment) -> Bool {
    isMomentLockedForCurrentUser(moment) || (
        (moment.unlockPriceGoldCoins ?? 0) > 0
            && !moment.isUnlocked
            && !isMomentAuthorCurrentUser(moment)
            && media.isLocked
    )
}

struct MomentsView: View {
    var filterUserID: String? = nil
    var pageTitleKey: String = "moments.title"

    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel = MomentsViewModel()
    @StateObject private var momentsNotif = MomentsNotificationManager.shared
    @ObservedObject private var authManager = AuthManager.shared
    @State private var showCreateMoment = false
    @State private var showNotificationList = false
    @State private var commentText = ""
    @State private var commentTarget: (momentID: Int, replyToUserID: String?, replyToName: String?, replyContent: String?)? = nil
    @State private var commentTriggerID = UUID()
    @State private var commentImageItem: PhotosPickerItem?
    @State private var commentImageData: Data?
    @State private var videoPreviewItem: VideoPreviewItem?
    @State private var toastMessage: String?
    @State private var useCoverChrome = true
    @FocusState private var commentFieldFocused: Bool

    var body: some View {
        GeometryReader { rootProxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    momentsHeader

                    if momentsNotif.unreadCount > 0 && filterUserID == nil {
                        notificationBanner
                            .padding(.horizontal, 12)
                            .padding(.bottom, 8)
                    }

                    if viewModel.moments.isEmpty,
                       !viewModel.isLoading,
                       let errorMessage = viewModel.errorMessage {
                        VStack(spacing: 14) {
                            Image(systemName: "exclamationmark.triangle")
                                .font(.system(size: 34))
                                .foregroundColor(AppColors.warningColor)
                            Text(errorMessage)
                                .font(.system(size: 15))
                                .foregroundColor(AppColors.secondaryText)
                                .multilineTextAlignment(.center)
                            Button(L10n.tr("common.retry")) {
                                Task { await viewModel.loadFeed(refresh: true) }
                            }
                            .font(.system(size: 14, weight: .semibold))
                            .buttonStyle(.borderedProminent)
                            .tint(AppColors.accent)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 28)
                        .padding(.top, 60)
                    } else if viewModel.moments.isEmpty && !viewModel.isLoading {
                        VStack(spacing: 14) {
                            Image(systemName: "photo.on.rectangle.angled")
                                .font(.system(size: 36))
                                .foregroundColor(AppColors.tertiaryText)
                            Text(L10n.tr("moments.empty"))
                                .font(.system(size: 15))
                                .foregroundColor(AppColors.secondaryText)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                    }

                    ForEach(viewModel.moments, id: \.presentationIdentity) { moment in
                        VStack(spacing: 0) {
                            MomentRow(
                                moment: moment,
                                onLike: {
                                    guard moment.clientRequestID == nil else { return }
                                    Task { await viewModel.toggleLike(momentID: moment.id) }
                                },
                                onComment: { replyUserID, replyName, replyContent in
                                    guard moment.clientRequestID == nil else { return }
                                    commentTarget = (moment.id, replyUserID, replyName, replyContent)
                                    commentTriggerID = UUID()
                                },
                                onDelete: { Task { await viewModel.deleteMoment(momentID: moment.id) } },
                                onMediaTap: { media, frame in
                                    handleMediaTap(media, in: moment, frame: frame)
                                },
                                onUnlock: {
                                    guard moment.clientRequestID == nil else { return }
                                    unlockMoment(MomentUnlockRequest(moment: moment))
                                }
                            )

                            if viewModel.failedMomentIDs.contains(moment.id) {
                                Button {
                                    viewModel.retryMomentUpload(momentID: moment.id)
                                } label: {
                                    Label(L10n.tr("common.retry"), systemImage: "exclamationmark.circle.fill")
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundColor(.red)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 68)
                                .padding(.bottom, 10)
                            }
                        }
                        .onAppear {
                            viewModel.loadMoreIfNeeded(currentMomentID: moment.id)
                        }

                        Divider()
                    }

                    if viewModel.hasMore && !viewModel.moments.isEmpty {
                        ProgressView()
                            .padding()
                    }
                }
                .padding(.bottom, 18)
            }
            .background(AppColors.cardBackground)
            .ignoresSafeArea(edges: .top)
            .onPreferenceChange(MomentsCoverFramePreferenceKey.self) { frame in
                let next = shouldUseCoverNavigationChrome(frame: frame, rootProxy: rootProxy)
                if next != useCoverChrome {
                    useCoverChrome = next
                }
            }
            .navigationTitle(L10n.tr(pageTitleKey))
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(true)
            .toolbar(.visible, for: .navigationBar)
            .toolbarBackground(Color(hex: "F7F7F7"), for: .navigationBar)
            .toolbarBackground(useCoverChrome ? .hidden : .visible, for: .navigationBar)
            .toolbarColorScheme(useCoverChrome ? .dark : .light, for: .navigationBar)
            .animation(.easeInOut(duration: 0.16), value: useCoverChrome)
            .hidesTabBarOnPush()
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    AppBackButton(tint: useCoverChrome ? .white : AppColors.primaryText) {
                        navigator.pop()
                    }
                }

                if filterUserID == nil {
                    ToolbarItem(placement: .principal) {
                        feedSegmentedControl(useCoverChrome: useCoverChrome)
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { showCreateMoment = true } label: {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 16))
                            .foregroundColor(useCoverChrome ? .white : AppColors.primaryText)
                    }
                    .accessibilityLabel(L10n.tr("moment.create.title"))
                }
            }
            .sheet(isPresented: $showCreateMoment) {
                CreateMomentView { draft in
                    viewModel.publishMomentOptimistically(draft: draft)
                }
            }
            .fullScreenCover(item: $videoPreviewItem) { item in
                VideoPlayerView(videoURL: item.url)
            }
            .toast(message: $toastMessage)
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
            .task(id: "\(AuthManager.shared.currentUser?.userID ?? "")|\(filterUserID ?? "")|\(viewModel.selectedTab.rawValue)") {
                viewModel.filterUserID = filterUserID
                await viewModel.loadFeed()
            }
            .onChange(of: viewModel.selectedTab) { _ in
                resetCommentComposer()
            }
            .refreshable {
                await viewModel.loadFeed(refresh: true)
                if filterUserID == nil && viewModel.selectedTab == .following {
                    await momentsNotif.fetchFromServer()
                }
            }
        }
    }

    private func handleMediaTap(_ media: MomentMedia, in moment: Moment, frame: CGRect) {
        hideKeyboard()
        if isMomentLockedForCurrentUser(moment) || isMediaLockedForCurrentUser(media, in: moment) {
            unlockMoment(MomentUnlockRequest(moment: moment))
            return
        }

        if media.type == .video {
            guard !media.url.isEmpty else { return }
            videoPreviewItem = VideoPreviewItem(url: media.url)
            return
        }

        let urls = moment.unlockedImageURLs.isEmpty ? moment.images : moment.unlockedImageURLs
        guard !urls.isEmpty else { return }
        ImageGalleryState.shared.show(
            urls: urls,
            index: urls.firstIndex(of: media.url) ?? 0,
            sourceFrame: frame,
            sourceContentMode: .fill,
            sourceCornerRadius: moment.media.count == 1 ? 6 : 8
        )
    }

    private func unlockMoment(_ request: MomentUnlockRequest) {
        Task {
            let success = await viewModel.unlockMoment(
                momentID: request.moment.id,
                paymentMethod: .automatic(request.kind),
                idempotencyKey: request.idempotencyKey
            )
            if !success {
                await MainActor.run {
                    toastMessage = viewModel.errorMessage ?? L10n.tr("moment.unlock.failed")
                }
            }
        }
    }

    private func feedSegmentedControl(useCoverChrome: Bool) -> some View {
        SystemSegmentedTabs(
            items: MomentFeedTab.allCases,
            selection: $viewModel.selectedTab,
            title: { L10n.tr($0.titleKey) },
            accessibilityIdentifier: "moments.top.tabs",
            fontWeight: .bold
        )
        .frame(width: 196)
        .background(
            Capsule()
                .fill(useCoverChrome ? Color.black.opacity(0.16) : Color.clear)
        )
    }

    private func shouldUseCoverNavigationChrome(frame: CGRect, rootProxy: GeometryProxy) -> Bool {
        guard !frame.isNull else { return true }
        let navigationBottomY = rootProxy.frame(in: .global).minY + rootProxy.safeAreaInsets.top + 44
        return frame.maxY > navigationBottomY + 1
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

                    Text(L10n.tr("moments.newMessages.count", momentsNotif.unreadCount))
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
            MomentsCoverBackdrop(url: AuthManager.shared.currentUser?.avatarURL ?? "")
                .frame(height: 226)
                .background(
                    GeometryReader { proxy in
                        Color.clear.preference(
                            key: MomentsCoverFramePreferenceKey.self,
                            value: proxy.frame(in: .global)
                        )
                    }
                )

            if let user = AuthManager.shared.currentUser {
                HStack(alignment: .bottom, spacing: 12) {
                    Spacer()

                    Text(user.nickname)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                        .shadow(color: .black.opacity(0.35), radius: 6, x: 0, y: 2)
                        .padding(.bottom, 13)

                    MomentAvatarView(url: user.avatarURL, size: 76, cornerRadius: 16)
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(Color.white, lineWidth: 3)
                        )
                        .offset(y: 30)
                }
                .padding(.horizontal, 18)
            }
        }
        .frame(height: 226)
        .padding(.bottom, 44)
    }

    private var commentInputBar: some View {
        VStack(spacing: 0) {
            Divider()

            if let target = commentTarget, let name = target.replyToName {
                HStack(spacing: 6) {
                    Image(systemName: "arrowshape.turn.up.left.fill")
                        .font(.system(size: 10))
                        .foregroundColor(AppColors.tertiaryText)
                    Text(L10n.tr("reply.to", name))
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
                    commentTarget?.replyToName != nil ? L10n.tr("reply.placeholder", commentTarget!.replyToName!) : L10n.tr("moments.comment.placeholder"),
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
                    Text(L10n.tr("common.send"))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(canSendComment ? AppColors.accent : AppColors.tertiaryText)
                        .cornerRadius(20)
                }
                .disabled(!canSendComment)

                Button {
                    resetCommentComposer()
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

    private func resetCommentComposer() {
        commentTarget = nil
        commentText = ""
        commentImageData = nil
        commentImageItem = nil
        commentFieldFocused = false
    }

    private func sendComment() {
        guard let target = commentTarget, canSendComment else { return }
        let text = commentText
        let imgData = commentImageData
        resetCommentComposer()
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

struct MomentsCoverBackdrop: View {
    let url: String

    @State private var image: UIImage?

    private var resolvedPath: String {
        if url.isEmpty { return "" }
        if url.hasPrefix("/") || url.hasPrefix("http") { return url }
        return "/api/v1/" + url
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(hex: "5667EA"),
                    Color(hex: "7A58D6"),
                    Color(hex: "25294D")
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .blur(radius: 22)
                    .saturation(1.12)
                    .opacity(0.58)
                    .scaleEffect(1.08)
            }

            LinearGradient(
                colors: [
                    Color(hex: "5667EA").opacity(0.42),
                    Color(hex: "7A58D6").opacity(0.24),
                    Color.black.opacity(0.5)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            VStack(spacing: 0) {
                Color.white.opacity(0.08)
                    .frame(height: 1)
                Spacer()
                LinearGradient(
                    colors: [
                        Color.clear,
                        Color.black.opacity(0.38)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 118)
            }
        }
        .clipped()
        .onAppear {
            let path = resolvedPath
            guard !path.isEmpty else { return }
            if let cached = ImageCacheManager.shared.image(for: path) {
                image = cached
            }
        }
        .task(id: url) {
            let path = resolvedPath
            guard !path.isEmpty else {
                image = nil
                return
            }
            if let cached = ImageCacheManager.shared.image(for: path) {
                image = cached
                return
            }
            image = nil
            let loaded = await ImageCacheManager.shared.loadImage(from: path)
            guard !Task.isCancelled, path == resolvedPath else { return }
            image = loaded
        }
    }
}

struct MomentAvatarView: View {
    let url: String
    let size: CGFloat
    let cornerRadius: CGFloat

    @State private var image: UIImage?

    private var resolvedPath: String {
        Self.resolvedPath(for: url)
    }

    init(url: String, size: CGFloat, cornerRadius: CGFloat) {
        self.url = url
        self.size = size
        self.cornerRadius = cornerRadius

        let path = Self.resolvedPath(for: url)
        _image = State(
            initialValue: path.isEmpty ? nil : ImageCacheManager.shared.image(for: path)
        )
    }

    private static func resolvedPath(for url: String) -> String {
        if url.isEmpty { return "" }
        if url.hasPrefix("/") || url.hasPrefix("http") { return url }
        return "/api/v1/" + url
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(AppColors.accentGradient)
                    .overlay(
                        Image(systemName: "person.fill")
                            .font(.system(size: size * 0.38, weight: .medium))
                            .foregroundColor(.white.opacity(0.84))
                    )
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .onAppear {
            let path = resolvedPath
            guard !path.isEmpty else { return }
            if let cached = ImageCacheManager.shared.image(for: path) {
                image = cached
            }
        }
        .task(id: url) {
            let path = resolvedPath
            guard !path.isEmpty else {
                image = nil
                return
            }
            if let cached = ImageCacheManager.shared.image(for: path) {
                image = cached
                return
            }
            image = nil
            let loaded = await ImageCacheManager.shared.loadImage(from: path)
            guard !Task.isCancelled, path == resolvedPath else { return }
            image = loaded
        }
    }
}

struct MomentRow: View {
    let moment: Moment
    var onLike: () -> Void
    var onComment: (_ replyToUserID: String?, _ replyToName: String?, _ replyContent: String?) -> Void
    var onDelete: () -> Void
    /// Second arg: the tapped thumbnail's global-coordinate frame (for
    /// the hero grow-from-thumbnail animation).
    var onMediaTap: (MomentMedia, CGRect) -> Void
    var onUnlock: () -> Void
    @EnvironmentObject private var navigator: UIKitNavigator
    @State private var showActions = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button {
                openProfile(userID: moment.author.userID)
            } label: {
                MomentAvatarView(url: moment.author.avatarURL, size: 44, cornerRadius: 11)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 8) {
                Button {
                    openProfile(userID: moment.author.userID)
                } label: {
                    Text(moment.author.nickname)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(Color(hex: "576B95"))
                        .lineLimit(1)
                }
                .buttonStyle(.plain)

                if !moment.content.isEmpty {
                    Text(moment.content)
                        .font(.system(size: 15))
                        .foregroundColor(AppColors.primaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !moment.media.isEmpty {
                    momentMediaGrid
                }

                HStack {
                    HStack(spacing: 6) {
                        Text(moment.formattedTime)

                        if shouldShowUnlockedMarker {
                            Text(L10n.tr("moment.unlock.unlockedLabel"))
                        }
                    }
                    .font(.system(size: 12))
                    .foregroundColor(AppColors.tertiaryText)

                    Spacer()

                    Button { withAnimation(.easeInOut(duration: 0.2)) { showActions.toggle() } } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundColor(AppColors.tertiaryText)
                            .frame(width: 30, height: 24)
                            .background(
                                Capsule()
                                    .fill(AppColors.separator.opacity(0.75))
                            )
                    }
                    .buttonStyle(.plain)
                }

                if showActions {
                    HStack {
                        Spacer()

                        HStack(spacing: 0) {
                            Button {
                                showActions = false
                                onLike()
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: moment.likedByMe ? "heart.fill" : "heart")
                                        .font(.system(size: 13))
                                    Text(moment.likedByMe ? L10n.tr("moments.unlike") : L10n.tr("moments.like"))
                                        .font(.system(size: 13))
                                }
                                .foregroundColor(.white)
                                .padding(.horizontal, 13)
                                .frame(height: 34)
                            }
                            .buttonStyle(.plain)

                            Rectangle()
                                .fill(Color.white.opacity(0.16))
                                .frame(width: 1, height: 16)

                            Button {
                                showActions = false
                                onComment(nil, nil, nil)
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "bubble.left")
                                        .font(.system(size: 13))
                                    Text(L10n.tr("moments.comment"))
                                        .font(.system(size: 13))
                                }
                                .foregroundColor(.white)
                                .padding(.horizontal, 13)
                                .frame(height: 34)
                            }
                            .buttonStyle(.plain)

                            if moment.author.userID == AuthManager.shared.currentUser?.userID {
                                Rectangle()
                                    .fill(Color.white.opacity(0.16))
                                    .frame(width: 1, height: 16)

                                Button {
                                    showActions = false
                                    onDelete()
                                } label: {
                                    HStack(spacing: 4) {
                                        Image(systemName: "trash")
                                            .font(.system(size: 13))
                                        Text(L10n.tr("common.delete"))
                                            .font(.system(size: 13))
                                    }
                                    .foregroundColor(.white)
                                    .padding(.horizontal, 13)
                                    .frame(height: 34)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .background(
                            Capsule()
                                .fill(Color(hex: "252B3A"))
                                .shadow(color: .black.opacity(0.12), radius: 8, x: 0, y: 4)
                        )
                    }
                    .transition(.move(edge: .trailing).combined(with: .opacity))
                }

                if !moment.likes.isEmpty || !moment.comments.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
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
                            .padding(.horizontal, 9)
                            .padding(.vertical, 7)
                        }

                        if !moment.likes.isEmpty && !moment.comments.isEmpty {
                            Divider().padding(.horizontal, 8)
                        }

                        ForEach(moment.comments) { comment in
                            commentRow(comment)
                                .padding(.horizontal, 9)
                                .padding(.vertical, 6)
                        }
                    }
                    .background(Color(hex: "F5F6FA"))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(AppColors.cardBackground)
    }

    private var shouldShowUnlockedMarker: Bool {
        let hasPaidMedia = (moment.unlockPriceGoldCoins ?? 0) > 0
            && (!moment.media.isEmpty || !moment.images.isEmpty)
        return hasPaidMedia && (moment.isUnlocked || isMomentAuthorCurrentUser(moment))
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
                        + Text(L10n.tr("reply.separator"))
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
                        + Text(L10n.tr("reply.separator"))
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
            .contextMenu {
                Button {
                    openProfile(userID: comment.userID)
                } label: {
                    Label(L10n.tr("profile.public.title"), systemImage: "person.crop.circle")
                }
                if let replyTo = comment.replyTo {
                    Button {
                        openProfile(userID: replyTo.userID)
                    } label: {
                        Label(replyTo.nickname, systemImage: "arrowshape.turn.up.left")
                    }
                }
            }

            if let imageURL = comment.imageURL, !imageURL.isEmpty {
                HStack(spacing: 0) {
                    CommentImageView(url: imageURL)
                        .onTapCaptureFrame(sourceID: imageURL) { frame in
                            hideKeyboard()
                            ImageGalleryState.shared.show(
                                urls: [imageURL],
                                index: 0,
                                sourceFrame: frame,
                                sourceContentMode: .fill,
                                sourceCornerRadius: 4
                            )
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

    private func openProfile(userID: String) {
        guard !userID.isBlank else { return }
        navigator.push(UserProfileView(userID: userID))
    }

    @ViewBuilder
    private var momentMediaGrid: some View {
        let media = moment.media
        if !media.isEmpty {
            momentMediaContent(media)
        }
    }

    @ViewBuilder
    private func momentMediaContent(_ media: [MomentMedia]) -> some View {
        let count = media.count
        let availableWidth = max(UIScreen.main.bounds.width - MomentMediaLayout.feedHorizontalInsets, 1)
        if count == 1 {
            let side = MomentMediaLayout.singleMediaSide(availableWidth: availableWidth)
            MomentSingleMediaView(
                media: media[0],
                size: side,
                isLockedForViewer: isMediaLockedForCurrentUser(media[0], in: moment),
                unlockPriceGoldCoins: moment.unlockPriceGoldCoins,
                mediaCount: count
            )
                .padding(.top, 1)
                .onTapCaptureFrame(sourceID: media[0].url) { frame in
                    onMediaTap(media[0], frame)
                }
        } else {
            let metrics = MomentMediaLayout.gridMetrics(
                mediaCount: count,
                availableWidth: availableWidth
            )
            let columns = Array(
                repeating: GridItem(.fixed(metrics.cellSide), spacing: MomentMediaLayout.spacing),
                count: metrics.columnCount
            )

            LazyVGrid(columns: columns, alignment: .leading, spacing: MomentMediaLayout.spacing) {
                ForEach(Array(media.enumerated()), id: \.offset) { index, item in
                    MomentMediaCell(
                        media: item,
                        size: metrics.cellSide,
                        isLockedForViewer: isMediaLockedForCurrentUser(item, in: moment),
                        unlockPriceGoldCoins: moment.unlockPriceGoldCoins,
                        mediaCount: count
                    )
                        .onTapCaptureFrame(sourceID: item.url) { frame in
                            onMediaTap(media[index], frame)
                        }
                }
            }
            .frame(width: metrics.gridWidth, alignment: .leading)
        }
    }
}

// MARK: - Moment Media

enum MomentMediaLayout {
    struct GridMetrics: Equatable {
        let columnCount: Int
        let cellSide: CGFloat
        let gridWidth: CGFloat
    }

    static let feedHorizontalInsets: CGFloat = 16 + 44 + 12 + 16
    static let spacing: CGFloat = 4
    static let maximumGridWidth: CGFloat = 284
    static let maximumSingleMediaSide: CGFloat = 208

    static func columnCount(for mediaCount: Int) -> Int {
        switch mediaCount {
        case ...1:
            return 1
        case 2, 4:
            return 2
        default:
            return 3
        }
    }

    static func singleMediaSide(availableWidth: CGFloat) -> CGFloat {
        min(max(availableWidth, 1), maximumSingleMediaSide)
    }

    static func gridMetrics(mediaCount: Int, availableWidth: CGFloat) -> GridMetrics {
        let columns = columnCount(for: mediaCount)
        let usableWidth = min(max(availableWidth, 1), maximumGridWidth)
        let totalSpacing = spacing * CGFloat(columns - 1)
        let cellSide = floor(max((usableWidth - totalSpacing) / CGFloat(columns), 1))
        let gridWidth = cellSide * CGFloat(columns) + totalSpacing
        return GridMetrics(columnCount: columns, cellSide: cellSide, gridWidth: gridWidth)
    }
}

private enum MomentMediaTransition {
    static let duration: TimeInterval = 0.28
    static let animation = Animation.easeInOut(duration: duration)
    static let cleanupDelay: TimeInterval = duration + 0.06
}

struct MomentSingleMediaView: View {
    let media: MomentMedia
    let size: CGFloat
    let isLockedForViewer: Bool
    let unlockPriceGoldCoins: Int?
    let mediaCount: Int

    var body: some View {
        Group {
            if media.type == .video {
                MomentVideoThumbnailView(
                    media: media,
                    isLockedForViewer: isLockedForViewer,
                    width: size,
                    height: size,
                    cornerRadius: 6
                )
            } else {
                MomentSingleImage(
                    url: media.imageDisplayURL(isLockedForViewer: isLockedForViewer),
                    size: size
                )
            }
        }
        .lockedMomentMediaChrome(
            isLocked: isLockedForViewer,
            price: unlockPriceGoldCoins ?? 0,
            mediaCount: mediaCount
        )
    }
}

struct MomentMediaCell: View {
    let media: MomentMedia
    let size: CGFloat
    let isLockedForViewer: Bool
    let unlockPriceGoldCoins: Int?
    let mediaCount: Int

    var body: some View {
        Group {
            if media.type == .video {
                MomentVideoThumbnailView(
                    media: media,
                    isLockedForViewer: isLockedForViewer,
                    width: size,
                    height: size,
                    cornerRadius: 8
                )
            } else {
                MomentImageCell(url: media.imageDisplayURL(isLockedForViewer: isLockedForViewer), size: size)
            }
        }
        .lockedMomentMediaChrome(
            isLocked: isLockedForViewer,
            price: unlockPriceGoldCoins ?? 0,
            mediaCount: mediaCount
        )
    }
}

private struct LockedMomentMediaModifier: ViewModifier {
    let isLocked: Bool
    let price: Int
    let mediaCount: Int

    func body(content: Content) -> some View {
        ZStack {
            content
                .allowsHitTesting(!isLocked)

            if isLocked {
                LockedMediaPaymentBadge(price: price, mediaCount: mediaCount)
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .contentShape(Rectangle())
        .animation(MomentMediaTransition.animation, value: isLocked)
    }
}

private struct LockedMediaPaymentBadge: View {
    let price: Int
    let mediaCount: Int

    private var text: String {
        L10n.tr("moment.unlock.badge", price)
    }

    private var badgeScale: BadgeScale {
        if mediaCount <= 1 {
            return .single
        }
        if mediaCount <= 4 {
            return .mediumGrid
        }
        return .denseGrid
    }

    var body: some View {
        HStack(spacing: badgeScale.spacing) {
            Image(systemName: "lock.fill")
                .font(.system(size: badgeScale.iconSize, weight: .semibold))

            Text(text)
                .font(.system(size: badgeScale.fontSize, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.62)
        }
        .foregroundColor(.white)
        .padding(.horizontal, badgeScale.horizontalPadding)
        .padding(.vertical, badgeScale.verticalPadding)
        .background(
            Capsule()
                .fill(Color.black.opacity(0.46))
        )
        .overlay(
            Capsule()
                .stroke(Color.white.opacity(0.22), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.18), radius: badgeScale.shadowRadius, x: 0, y: 2)
        .accessibilityLabel(text)
    }

    private enum BadgeScale {
        case single
        case mediumGrid
        case denseGrid

        var fontSize: CGFloat {
            switch self {
            case .single: return 13
            case .mediumGrid: return 11
            case .denseGrid: return 9.5
            }
        }

        var iconSize: CGFloat {
            switch self {
            case .single: return 12
            case .mediumGrid: return 10
            case .denseGrid: return 8.5
            }
        }

        var spacing: CGFloat {
            switch self {
            case .single: return 7
            case .mediumGrid: return 5
            case .denseGrid: return 3
            }
        }

        var horizontalPadding: CGFloat {
            switch self {
            case .single: return 13
            case .mediumGrid: return 8
            case .denseGrid: return 6
            }
        }

        var verticalPadding: CGFloat {
            switch self {
            case .single: return 8
            case .mediumGrid: return 6
            case .denseGrid: return 5
            }
        }

        var shadowRadius: CGFloat {
            switch self {
            case .single: return 7
            case .mediumGrid: return 5
            case .denseGrid: return 4
            }
        }
    }
}

private extension View {
    func lockedMomentMediaChrome(isLocked: Bool, price: Int, mediaCount: Int) -> some View {
        modifier(LockedMomentMediaModifier(isLocked: isLocked, price: price, mediaCount: mediaCount))
    }
}

struct MomentVideoThumbnailView: View {
    let media: MomentMedia
    let isLockedForViewer: Bool
    let width: CGFloat
    let height: CGFloat
    let cornerRadius: CGFloat

    @State private var image: UIImage?
    @State private var isLoading = true
    @State private var loadedThumbnailURL: String?
    @State private var previousImage: UIImage?
    @State private var previousImageOpacity = 0.0

    private var explicitThumbnailURL: String? {
        Self.thumbnailURL(for: media, isLockedForViewer: isLockedForViewer)
    }

    init(
        media: MomentMedia,
        isLockedForViewer: Bool,
        width: CGFloat,
        height: CGFloat,
        cornerRadius: CGFloat
    ) {
        self.media = media
        self.isLockedForViewer = isLockedForViewer
        self.width = width
        self.height = height
        self.cornerRadius = cornerRadius

        let thumbnailURL = Self.thumbnailURL(
            for: media,
            isLockedForViewer: isLockedForViewer
        )
        let cachedImage = thumbnailURL.flatMap {
            ImageCacheManager.shared.image(for: $0)
        }
        _image = State(initialValue: cachedImage)
        _isLoading = State(initialValue: thumbnailURL != nil && cachedImage == nil)
        _loadedThumbnailURL = State(initialValue: cachedImage == nil ? nil : thumbnailURL)
    }

    private static func thumbnailURL(
        for media: MomentMedia,
        isLockedForViewer: Bool
    ) -> String? {
        media.thumbnailDisplayURL(isLockedForViewer: isLockedForViewer)
    }

    var body: some View {
        Group {
            if let explicitThumbnailURL {
                thumbnailImage(url: explicitThumbnailURL)
            } else {
                VideoThumbnailView(videoURL: media.url, width: width, height: height)
                    .clipped()
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay(
            Image(systemName: "play.circle.fill")
                .font(.system(size: min(width, height) > 120 ? 42 : 28))
                .foregroundColor(.white)
                .shadow(color: .black.opacity(0.32), radius: 5, x: 0, y: 2)
        )
        .task(id: explicitThumbnailURL ?? media.url) {
            await loadThumbnail()
        }
    }

    @ViewBuilder
    private func thumbnailImage(url: String) -> some View {
        if let image {
            ZStack {
                renderedThumbnail(image)

                if let previousImage {
                    renderedThumbnail(previousImage)
                        .opacity(previousImageOpacity)
                        .allowsHitTesting(false)
                }
            }
        } else {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(AppColors.separator)
                .overlay(
                    Image(systemName: "video.fill")
                        .font(.system(size: 26))
                        .foregroundColor(AppColors.secondaryText)
                )
        }
    }

    private func renderedThumbnail(_ image: UIImage) -> some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFill()
            .frame(width: width, height: height)
            .clipped()
    }

    private func loadThumbnail() async {
        let targetURL = explicitThumbnailURL

        guard let targetURL else {
            loadedThumbnailURL = nil
            image = nil
            isLoading = false
            return
        }

        if let cached = ImageCacheManager.shared.image(for: targetURL) {
            applyLoadedThumbnail(cached, for: targetURL, animated: false)
            return
        }

        image = nil
        loadedThumbnailURL = nil
        isLoading = true
        if let loaded = await ImageCacheManager.shared.loadImage(from: targetURL) {
            guard !Task.isCancelled, targetURL == explicitThumbnailURL else { return }
            applyLoadedThumbnail(loaded, for: targetURL, animated: true)
        } else {
            guard targetURL == explicitThumbnailURL else { return }
            loadedThumbnailURL = targetURL
            isLoading = false
        }
    }

    private func applyLoadedThumbnail(
        _ loaded: UIImage,
        for targetURL: String,
        animated: Bool
    ) {
        image = loaded
        loadedThumbnailURL = targetURL
        isLoading = false
        previousImage = nil
        previousImageOpacity = 0
    }

    private func clearPreviousThumbnail(after targetURL: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + MomentMediaTransition.cleanupDelay) {
            if loadedThumbnailURL == targetURL {
                previousImage = nil
                previousImageOpacity = 0
            }
        }
    }
}

// MARK: - Single image (uniform square crop)

struct MomentSingleImage: View {
    let url: String
    let size: CGFloat
    @State private var image: UIImage?
    @State private var isLoading = true
    @State private var loadedURL: String?
    @State private var previousImage: UIImage?
    @State private var previousImageOpacity = 0.0

    private var thumbCacheKey: String { url + "?thumb=1" }

    init(url: String, size: CGFloat) {
        self.url = url
        self.size = size

        let cacheKey = url + "?thumb=1"
        let cachedImage = url.isEmpty ? nil : ImageCacheManager.shared.image(for: cacheKey)
        _image = State(initialValue: cachedImage)
        _isLoading = State(initialValue: !url.isEmpty && cachedImage == nil)
        _loadedURL = State(initialValue: cachedImage == nil ? nil : url)
    }

    var body: some View {
        Group {
            if let image = image {
                ZStack {
                    renderedImage(image)

                    if let previousImage {
                        renderedImage(previousImage)
                            .opacity(previousImageOpacity)
                            .allowsHitTesting(false)
                    }
                }
                    .longPressToSaveImage(url: url)
            } else {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(AppColors.separator)
                    .frame(width: size, height: size)
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundColor(AppColors.secondaryText)
                    )
            }
        }
        .task(id: url) {
            await loadImage()
        }
    }

    private func renderedImage(_ image: UIImage) -> some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private func loadImage() async {
        let requestedURL = url
        let requestedCacheKey = thumbCacheKey

        guard !requestedURL.isEmpty else {
            loadedURL = requestedURL
            image = nil
            isLoading = false
            return
        }

        if let cached = ImageCacheManager.shared.image(for: requestedCacheKey) {
            applyLoadedImage(cached, for: requestedURL, animated: false)
            return
        }

        image = nil
        loadedURL = nil
        isLoading = true
        let loaded = await ImageCacheManager.shared.loadImage(from: requestedURL, thumbnail: true)
        guard !Task.isCancelled, requestedURL == url else { return }
        if let loaded {
            applyLoadedImage(loaded, for: requestedURL, animated: true)
        } else {
            loadedURL = requestedURL
            isLoading = false
        }
    }

    private func applyLoadedImage(_ loaded: UIImage, for url: String, animated: Bool) {
        image = loaded
        loadedURL = url
        isLoading = false
        previousImage = nil
        previousImageOpacity = 0
    }

    private func clearPreviousImage(after url: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + MomentMediaTransition.cleanupDelay) {
            if loadedURL == url {
                previousImage = nil
                previousImageOpacity = 0
            }
        }
    }

}

// MARK: - Square-cropped Moment Image Cell

struct MomentImageCell: View {
    let url: String
    let size: CGFloat
    @State private var image: UIImage?
    @State private var isLoading = true
    @State private var loadedURL: String?
    @State private var previousImage: UIImage?
    @State private var previousImageOpacity = 0.0

    private var thumbCacheKey: String { url + "?thumb=1" }

    init(url: String, size: CGFloat) {
        self.url = url
        self.size = size

        let cacheKey = url + "?thumb=1"
        let cachedImage = url.isEmpty ? nil : ImageCacheManager.shared.image(for: cacheKey)
        _image = State(initialValue: cachedImage)
        _isLoading = State(initialValue: !url.isEmpty && cachedImage == nil)
        _loadedURL = State(initialValue: cachedImage == nil ? nil : url)
    }

    var body: some View {
        Group {
            if let image = image {
                ZStack {
                    renderedImage(image)

                    if let previousImage {
                        renderedImage(previousImage)
                            .opacity(previousImageOpacity)
                            .allowsHitTesting(false)
                    }
                }
                    .longPressToSaveImage(url: url)
            } else {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(AppColors.separator)
                    .frame(width: size, height: size)
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundColor(AppColors.secondaryText)
                    )
            }
        }
        .task(id: url) {
            await loadImage()
        }
    }

    private func renderedImage(_ image: UIImage) -> some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func loadImage() async {
        let requestedURL = url
        let requestedCacheKey = thumbCacheKey

        guard !requestedURL.isEmpty else {
            loadedURL = requestedURL
            image = nil
            isLoading = false
            return
        }

        if let cached = ImageCacheManager.shared.image(for: requestedCacheKey) {
            applyLoadedImage(cached, for: requestedURL, animated: false)
            return
        }

        image = nil
        loadedURL = nil
        isLoading = true
        let loaded = await ImageCacheManager.shared.loadImage(from: requestedURL, thumbnail: true)
        guard !Task.isCancelled, requestedURL == url else { return }
        if let loaded {
            applyLoadedImage(loaded, for: requestedURL, animated: true)
        } else {
            loadedURL = requestedURL
            isLoading = false
        }
    }

    private func applyLoadedImage(_ loaded: UIImage, for url: String, animated: Bool) {
        image = loaded
        loadedURL = url
        isLoading = false
        previousImage = nil
        previousImageOpacity = 0
    }

    private func clearPreviousImage(after url: String) {
        DispatchQueue.main.asyncAfter(deadline: .now() + MomentMediaTransition.cleanupDelay) {
            if loadedURL == url {
                previousImage = nil
                previousImageOpacity = 0
            }
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
                    Text(L10n.tr("moments.noMessages"))
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
        .navigationTitle(L10n.tr("moments.messages.title"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .hidesTabBarOnPush()
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    navigator.pop()
                }
            }
        }
        .task {
            if let key = CacheKey.current(namespace: "moments", key: "notifications"),
               let cached: CachedSnapshot<[MomentsNotification]> = AppCacheRepository.shared.cachedValue(for: key) {
                notifications = cached.value
                isLoading = false
            }
            do {
                if let key = CacheKey.current(namespace: "moments", key: "notifications") {
                    notifications = Array(try await AppCacheRepository.shared.loadValue(
                        key: key,
                        policy: .shortLived,
                        forceRefresh: false
                    ) {
                        try await APIService.shared.getMomentsNotifications()
                    }.prefix(500))
                } else {
                    notifications = try await APIService.shared.getMomentsNotifications()
                }
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

                    Text(notification.type == "like" ? L10n.tr("moments.notification.like") : L10n.tr("moments.notification.comment"))
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
    @EnvironmentObject private var navigator: UIKitNavigator
    @State private var moment: Moment?
    @State private var isLoading = true
    @State private var commentText = ""
    @State private var commentTarget: (replyToUserID: String?, replyToName: String?, replyContent: String?)?
    @State private var commentTriggerID = UUID()
    @State private var commentImageItem: PhotosPickerItem?
    @State private var commentImageData: Data?
    @State private var videoPreviewItem: VideoPreviewItem?
    @State private var toastMessage: String?
    @State private var unlockIdempotencyKeys: [String: UUID] = [:]
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
                            onMediaTap: { media, frame in
                                handleMediaTap(media, in: moment, frame: frame)
                            },
                            onUnlock: {
                                unlockMoment(MomentUnlockRequest(moment: moment))
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
                    Text(L10n.tr("moments.detail.missing"))
                        .font(.system(size: 15))
                        .foregroundColor(AppColors.secondaryText)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("moments.detail.title"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .hidesTabBarOnPush()
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    navigator.pop()
                }
            }
        }
        .fullScreenCover(item: $videoPreviewItem) { item in
            VideoPlayerView(videoURL: item.url)
        }
        .toast(message: $toastMessage)
        .task { await loadMoment() }
    }

    private func loadMoment() async {
        let key = CacheKey.current(namespace: "moment-detail", key: "\(momentID)")
        if let key,
           let cached: CachedSnapshot<Moment> = AppCacheRepository.shared.cachedValue(for: key) {
            moment = cached.value
            isLoading = false
        }
        do {
            if let key {
                moment = try await AppCacheRepository.shared.loadValue(
                    key: key,
                    policy: .shortLived,
                    forceRefresh: false
                ) {
                    try await APIService.shared.getMomentDetail(momentID: momentID)
                }
            } else {
                moment = try await APIService.shared.getMomentDetail(momentID: momentID)
            }
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
                    likes: newLikes, comments: m.comments, likedByMe: liked,
                    media: m.media,
                    unlockPriceGoldCoins: m.unlockPriceGoldCoins,
                    isUnlocked: m.isUnlocked,
                    locationName: m.locationName
                )
            } catch { }
        }
    }

    private func handleMediaTap(_ media: MomentMedia, in moment: Moment, frame: CGRect) {
        hideKeyboard()
        if isMomentLockedForCurrentUser(moment) || isMediaLockedForCurrentUser(media, in: moment) {
            unlockMoment(MomentUnlockRequest(moment: moment))
            return
        }

        if media.type == .video {
            guard !media.url.isEmpty else { return }
            videoPreviewItem = VideoPreviewItem(url: media.url)
            return
        }

        let urls = moment.unlockedImageURLs.isEmpty ? moment.images : moment.unlockedImageURLs
        guard !urls.isEmpty else { return }
        ImageGalleryState.shared.show(
            urls: urls,
            index: urls.firstIndex(of: media.url) ?? 0,
            sourceFrame: frame,
            sourceContentMode: .fill,
            sourceCornerRadius: moment.media.count == 1 ? 6 : 8
        )
    }

    private func unlockMoment(_ request: MomentUnlockRequest) {
        let paymentMethod = MediaUnlockPaymentMethod.automatic(request.kind)
        let idempotencyScope = "\(request.moment.id)|\(paymentMethod.idempotencyScope)"
        let stableIdempotencyKey = unlockIdempotencyKeys[idempotencyScope] ?? request.idempotencyKey
        unlockIdempotencyKeys[idempotencyScope] = stableIdempotencyKey
        Task {
            do {
                let result = try await APIService.shared.unlockMoment(
                    momentID: request.moment.id,
                    paymentMethod: paymentMethod,
                    idempotencyKey: stableIdempotencyKey
                )
                unlockIdempotencyKeys.removeValue(forKey: idempotencyScope)
                if let updatedMoment = result.moment {
                    moment = updatedMoment
                } else {
                    await loadMoment()
                }
                if let charge = result.charge {
                    WalletStore.shared.applyServerBalance(charge.walletBalance)
                    WalletTelemetry.recordMixedCharge(charge, operation: "moment_unlock_detail")
                } else if !result.alreadyUnlocked, result.consumedProp == nil {
                    await WalletStore.shared.refreshBalanceFromServer()
                }
                if !result.alreadyUnlocked,
                   let consumedProp = result.consumedProp,
                   let cardKind = paymentMethod.cardKind {
                    PropInventoryStore.shared.applyConsumption(
                        consumedProp,
                        fallbackKind: cardKind
                    )
                }
            } catch {
                toastMessage = error.localizedDescription
            }
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
                    likes: m.likes, comments: newComments, likedByMe: m.likedByMe,
                    media: m.media,
                    unlockPriceGoldCoins: m.unlockPriceGoldCoins,
                    isUnlocked: m.isUnlocked,
                    locationName: m.locationName
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
                    Text(L10n.tr("reply.to", name))
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
                    commentTarget?.replyToName != nil ? L10n.tr("reply.placeholder", commentTarget!.replyToName!) : L10n.tr("moments.comment.placeholder"),
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
                    Text(L10n.tr("common.send"))
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
            } else {
                RoundedRectangle(cornerRadius: 4)
                    .fill(AppColors.separator)
                    .frame(width: 50, height: 50)
                    .overlay(
                        Image(systemName: "photo")
                            .font(.system(size: 15))
                            .foregroundColor(AppColors.secondaryText)
                    )
            }
        }
        .padding(.top, 2)
        .task(id: url) {
            let requestedURL = url
            let requestedCacheKey = thumbCacheKey
            if let cached = ImageCacheManager.shared.image(for: requestedCacheKey) {
                image = cached
                isLoading = false
                return
            }
            image = nil
            isLoading = true
            let loaded = await ImageCacheManager.shared.loadImage(from: requestedURL, thumbnail: true)
            guard !Task.isCancelled, requestedURL == url else { return }
            image = loaded
            isLoading = false
        }
    }
}
