// BWChat/Views/ShortDramaFeedView.swift
// Full-screen vertical short drama feed.

import AVFoundation
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ShortDramaFeedView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var viewModel: ShortDramaFeedViewModel
    @State private var commentTarget: ShortDramaVideo?
    @State private var unlockTarget: ShortDramaVideo?
    @State private var isUnlocking = false

    init(viewModel: ShortDramaFeedViewModel) {
        self.viewModel = viewModel
    }

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

            if viewModel.hasContent {
                verticalPager
            } else {
                emptyOrLoadingState
            }

            topBar
        }
        .navigationTitle("")
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .hidesTabBarOnPush()
        .task {
            await viewModel.loadInitial()
        }
        .onChange(of: viewModel.selectedVideoID) { videoID in
            guard let videoID, let video = viewModel.video(videoID: videoID) else { return }
            if video.requiresUnlock {
                unlockTarget = video
                return
            }
            viewModel.activate(videoID: videoID)
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                viewModel.resumeAfterForeground()
            } else {
                viewModel.pauseForBackground()
            }
        }
        .onDisappear {
            viewModel.leaveFeed()
        }
        .sheet(item: $commentTarget) { video in
            ShortDramaCommentsSheet(video: video) { comment in
                viewModel.incrementCommentCount(videoID: comment.videoID)
            }
            .presentationDetents([.medium, .large])
        }
        .alert(item: $unlockTarget) { video in
            Alert(
                title: Text(L10n.tr("shortDrama.unlock.confirmTitle")),
                message: Text(L10n.tr("shortDrama.unlock.confirmMessage", video.unlockPriceGoldCoins ?? 0)),
                primaryButton: .default(Text(L10n.tr("shortDrama.unlock.pay"))) {
                    confirmUnlock(video)
                },
                secondaryButton: .cancel(Text(L10n.tr("common.cancel")))
            )
        }
        .toast(message: $viewModel.errorMessage)
    }

    private var verticalPager: some View {
        GeometryReader { proxy in
            ShortDramaVerticalPager(
                videos: viewModel.videos,
                players: viewModel.players,
                selectedVideoID: $viewModel.selectedVideoID,
                isPlaybackPaused: { viewModel.isPlaybackPaused(videoID: $0.id) },
                isPlaybackTarget: { viewModel.isPlaybackTarget(videoID: $0.id) },
                onTogglePlayback: { viewModel.togglePlayback(videoID: $0.id) },
                onToggleLike: { viewModel.toggleLike(videoID: $0.id) },
                onToggleFollow: { viewModel.toggleFollowCreator(userID: $0.creator.userID) },
                onOpenComments: { commentTarget = $0 },
                onOpenCreator: { navigator.push(UserProfileView(userID: $0.creator.userID)) },
                onPageWillBecomeActive: { viewModel.activateUpcoming(videoID: $0.id) }
            )
            .frame(width: proxy.size.width, height: proxy.size.height)
            .ignoresSafeArea()
        }
        .ignoresSafeArea()
    }

    private var topBar: some View {
        VStack {
            HStack {
                Button {
                    viewModel.leaveFeed()
                    navigator.pop()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 42, height: 42)
                        .background(Color.black.opacity(0.32))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr("common.back"))

                Spacer()

                Text(L10n.tr("shortDrama.title"))
                    .font(.system(size: 17, weight: .bold))
                    .foregroundColor(.white)
                    .shadow(color: .black.opacity(0.35), radius: 6, x: 0, y: 2)

                Spacer()

                Color.clear
                    .frame(width: 42, height: 42)
            }
            .padding(.horizontal, 14)
            .padding(.top, 8)

            Spacer()
        }
        .allowsHitTesting(true)
    }

    private var emptyOrLoadingState: some View {
        VStack(spacing: 14) {
            if viewModel.isLoading {
                ProgressView()
                    .tint(.white)
            } else {
                Image(systemName: "play.slash")
                    .font(.system(size: 38, weight: .semibold))
                    .foregroundColor(.white.opacity(0.72))
                Text(L10n.tr("shortDrama.empty"))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white.opacity(0.78))
            }
        }
    }

    private func confirmUnlock(_ video: ShortDramaVideo) {
        let price = video.unlockPriceGoldCoins ?? 0
        guard !isUnlocking else { return }
        isUnlocking = true
        Task {
            if WalletStore.shared.spendableBalance == nil {
                await WalletStore.shared.refreshBalanceFromServer()
            }
            if let balance = WalletStore.shared.spendableBalance, balance < price {
                isUnlocking = false
                navigator.push(WalletView())
                return
            }
            _ = await viewModel.unlock(videoID: video.id)
            isUnlocking = false
        }
    }
}

private struct ShortDramaVerticalPager: UIViewControllerRepresentable {
    let videos: [ShortDramaVideo]
    let players: [String: AVPlayer]
    @Binding var selectedVideoID: String?
    let isPlaybackPaused: (ShortDramaVideo) -> Bool
    let isPlaybackTarget: (ShortDramaVideo) -> Bool
    let onTogglePlayback: (ShortDramaVideo) -> Void
    let onToggleLike: (ShortDramaVideo) -> Void
    let onToggleFollow: (ShortDramaVideo) -> Void
    let onOpenComments: (ShortDramaVideo) -> Void
    let onOpenCreator: (ShortDramaVideo) -> Void
    let onPageWillBecomeActive: (ShortDramaVideo) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIViewController(context: Context) -> UIPageViewController {
        let controller = UIPageViewController(
            transitionStyle: .scroll,
            navigationOrientation: .vertical
        )
        controller.dataSource = context.coordinator
        controller.delegate = context.coordinator
        controller.view.backgroundColor = .black

        if let index = initialIndex {
            controller.setViewControllers(
                [context.coordinator.makePageController(for: index)],
                direction: .forward,
                animated: false
            )
        }

        return controller
    }

    func updateUIViewController(_ pageViewController: UIPageViewController, context: Context) {
        context.coordinator.parent = self
        guard !videos.isEmpty else {
            pageViewController.setViewControllers([], direction: .forward, animated: false)
            return
        }
        guard !context.coordinator.isUserTransitioning else { return }

        let targetIndex = initialIndex ?? 0
        let targetID = videos[targetIndex].id
        if selectedVideoID == nil {
            DispatchQueue.main.async {
                selectedVideoID = targetID
            }
        }

        if context.coordinator.currentVideoID(in: pageViewController) != targetID {
            let currentIndex = context.coordinator.currentIndex(in: pageViewController) ?? targetIndex
            let direction: UIPageViewController.NavigationDirection = targetIndex >= currentIndex ? .forward : .reverse
            pageViewController.setViewControllers(
                [context.coordinator.makePageController(for: targetIndex)],
                direction: direction,
                animated: false
            )
        } else {
            context.coordinator.refreshVisiblePages(in: pageViewController)
        }
    }

    private var initialIndex: Int? {
        if let selectedVideoID,
           let selectedIndex = videos.firstIndex(where: { $0.id == selectedVideoID }) {
            return selectedIndex
        }
        return videos.indices.first
    }

    final class Coordinator: NSObject, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
        var parent: ShortDramaVerticalPager
        var isUserTransitioning = false

        init(parent: ShortDramaVerticalPager) {
            self.parent = parent
        }

        func makePageController(for index: Int) -> ShortDramaPageHostingController {
            let video = parent.videos[index]
            return ShortDramaPageHostingController(
                videoID: video.id,
                rootView: pageView(for: index)
            )
        }

        func pageViewController(
            _ pageViewController: UIPageViewController,
            viewControllerBefore viewController: UIViewController
        ) -> UIViewController? {
            guard let current = viewController as? ShortDramaPageHostingController,
                  let index = parent.videos.firstIndex(where: { $0.id == current.videoID }),
                  index > parent.videos.startIndex else { return nil }
            return makePageController(for: index - 1)
        }

        func pageViewController(
            _ pageViewController: UIPageViewController,
            viewControllerAfter viewController: UIViewController
        ) -> UIViewController? {
            guard let current = viewController as? ShortDramaPageHostingController,
                  let index = parent.videos.firstIndex(where: { $0.id == current.videoID }) else { return nil }
            let nextIndex = index + 1
            guard parent.videos.indices.contains(nextIndex) else { return nil }
            return makePageController(for: nextIndex)
        }

        func pageViewController(
            _ pageViewController: UIPageViewController,
            willTransitionTo pendingViewControllers: [UIViewController]
        ) {
            isUserTransitioning = true
            guard let pending = pendingViewControllers.first as? ShortDramaPageHostingController,
                  let index = parent.videos.firstIndex(where: { $0.id == pending.videoID }) else { return }
            parent.onPageWillBecomeActive(parent.videos[index])
        }

        func pageViewController(
            _ pageViewController: UIPageViewController,
            didFinishAnimating finished: Bool,
            previousViewControllers: [UIViewController],
            transitionCompleted completed: Bool
        ) {
            isUserTransitioning = false
            if completed,
               let currentID = currentVideoID(in: pageViewController) {
                if parent.selectedVideoID != currentID {
                    parent.selectedVideoID = currentID
                }
                return
            }

            guard let selectedID = parent.selectedVideoID,
                  let index = parent.videos.firstIndex(where: { $0.id == selectedID }) else { return }
            parent.onPageWillBecomeActive(parent.videos[index])
        }

        func refreshVisiblePages(in pageViewController: UIPageViewController) {
            pageViewController.viewControllers?
                .compactMap { $0 as? ShortDramaPageHostingController }
                .forEach { controller in
                    guard let index = parent.videos.firstIndex(where: { $0.id == controller.videoID }) else { return }
                    controller.rootView = pageView(for: index)
                }
        }

        func currentVideoID(in pageViewController: UIPageViewController) -> String? {
            (pageViewController.viewControllers?.first as? ShortDramaPageHostingController)?.videoID
        }

        func currentIndex(in pageViewController: UIPageViewController) -> Int? {
            guard let currentID = currentVideoID(in: pageViewController) else { return nil }
            return parent.videos.firstIndex { $0.id == currentID }
        }

        private func pageView(for index: Int) -> ShortDramaVideoPage {
            let video = parent.videos[index]
            return ShortDramaVideoPage(
                video: video,
                player: parent.players[video.id],
                isActive: parent.selectedVideoID == video.id,
                isPlaybackPaused: parent.isPlaybackPaused(video),
                isPlaybackTarget: parent.isPlaybackTarget(video),
                onTogglePlayback: { self.parent.onTogglePlayback(video) },
                onToggleLike: { self.parent.onToggleLike(video) },
                onToggleFollow: { self.parent.onToggleFollow(video) },
                onOpenComments: { self.parent.onOpenComments(video) },
                onOpenCreator: { self.parent.onOpenCreator(video) }
            )
        }
    }
}

private final class ShortDramaPageHostingController: UIHostingController<ShortDramaVideoPage> {
    let videoID: String

    init(videoID: String, rootView: ShortDramaVideoPage) {
        self.videoID = videoID
        super.init(rootView: rootView)
        view.backgroundColor = .black
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

// MARK: - Creator Studio

struct ShortDramaStudioView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel = ShortDramaStudioViewModel()

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                if viewModel.isLoading && viewModel.series.isEmpty {
                    ShortDramaStudioLoadingState()
                        .padding(.top, 92)
                } else if viewModel.series.isEmpty {
                    ShortDramaStudioEmptyState(action: openCreateSeries)
                        .padding(.top, 70)
                } else {
                    LazyVStack(spacing: 12) {
                        ForEach(viewModel.series) { series in
                            ShortDramaSeriesCard(
                                series: series,
                                showsCreator: true,
                                showsPublishStatus: true,
                                onOpenSeries: { openEditor(series) },
                                onOpenEpisode: { _ in openEditor(series) }
                            )
                            .onAppear {
                                viewModel.loadMoreIfNeeded(currentSeriesID: series.id)
                            }
                        }

                        if viewModel.isLoadingMore {
                            ProgressView()
                                .tint(AppColors.accent)
                                .padding(.vertical, 16)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 30)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("shortDrama.studio.title"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    navigator.pop()
                }
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: openCreateSeries) {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(AppColors.primaryText)
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.tr("shortDrama.series.create"))
            }
        }
        .task {
            await viewModel.loadInitial()
        }
        .refreshable {
            await viewModel.refresh()
        }
        .toast(message: $viewModel.errorMessage)
    }

    private func openCreateSeries() {
        navigator.push(ShortDramaUnifiedEditorView(mode: .create) { series in
            viewModel.upsert(series)
        })
    }

    private func openEditor(_ series: ShortDramaSeries) {
        let mode: ShortDramaUnifiedEditorMode
        if series.id.hasPrefix("local:"),
           let job = OutgoingStore.shared.jobs(ownerID: AuthManager.shared.currentUser?.userID ?? "")
            .first(where: { "local:\($0.id)" == series.id }),
           let payload = try? JSONDecoder().decode(ShortDramaOutgoingPayload.self, from: job.payload) {
            mode = .resume(job, payload)
        } else {
            mode = .edit(series)
        }
        navigator.push(ShortDramaUnifiedEditorView(mode: mode) { updated in
            viewModel.upsert(updated)
        })
    }
}

@MainActor
final class ShortDramaStudioViewModel: ObservableObject {
    @Published private(set) var series: [ShortDramaSeries] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingMore = false
    @Published var errorMessage: String?

    private var nextCursor: String?
    private var hasMore = true
    private var didLoadInitial = false

    func loadInitial() async {
        guard !didLoadInitial else { return }
        await load(reset: true)
    }

    func refresh() async {
        await load(reset: true)
    }

    func loadMoreIfNeeded(currentSeriesID: String) {
        guard hasMore, !isLoading, !isLoadingMore, series.last?.id == currentSeriesID else { return }
        Task {
            await load(reset: false)
        }
    }

    func upsert(_ item: ShortDramaSeries) {
        if !item.id.hasPrefix("local:"),
           let clientID = OutgoingStore.shared.jobs(
                ownerID: AuthManager.shared.currentUser?.userID ?? ""
           ).first(where: { $0.scene == .shortDrama && $0.serverID == item.id })?.clientRequestID {
            series.removeAll { $0.id == "local:\(clientID)" }
        }
        if let index = series.firstIndex(where: { $0.id == item.id }) {
            series[index] = item
        } else {
            series.insert(item, at: 0)
        }
    }

    private func load(reset: Bool) async {
        if reset {
            isLoading = true
            nextCursor = nil
            hasMore = true
        } else {
            isLoadingMore = true
        }
        errorMessage = nil
        defer {
            isLoading = false
            isLoadingMore = false
            didLoadInitial = true
        }

        do {
            let page = try await APIService.shared.getMyShortDramaSeries(cursor: reset ? nil : nextCursor)
            if reset {
                let local = localDraftSeries()
                let remoteIDs = Set(page.series.map(\.id))
                series = local.filter { draft in
                    let serverID = draft.id.hasPrefix("local:")
                        ? OutgoingStore.shared.jobs(ownerID: AuthManager.shared.currentUser?.userID ?? "")
                            .first(where: { "local:\($0.id)" == draft.id })?.serverID
                        : nil
                    return serverID.map { !remoteIDs.contains($0) } ?? true
                } + page.series
            } else {
                let existing = Set(series.map(\.id))
                series.append(contentsOf: page.series.filter { !existing.contains($0.id) })
            }
            hasMore = page.hasMore
            nextCursor = page.nextCursor
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func localDraftSeries() -> [ShortDramaSeries] {
        guard let user = AuthManager.shared.currentUser else { return [] }
        return OutgoingStore.shared.jobs(ownerID: user.userID).compactMap { job -> ShortDramaSeries? in
            guard job.scene == .shortDrama,
                  job.state != .succeeded,
                  job.state != .cancelled,
                  let payload = try? JSONDecoder().decode(ShortDramaOutgoingPayload.self, from: job.payload) else { return nil }
            let coverURL = payload.coverRelativePath
                .map { OutgoingFileStore.absoluteURL(for: $0).absoluteString }
                ?? ""
            return ShortDramaSeries(
                seriesID: "local:\(job.id)",
                title: payload.title,
                intro: payload.intro,
                coverURL: coverURL,
                episodeCount: payload.episodes.count,
                status: .draft,
                statusMessage: job.state.isUserVisibleFailure ? L10n.tr("common.retry") : nil,
                updatedAt: ISO8601DateFormatter().string(from: job.updatedAt),
                episodes: [],
                creator: ShortDramaCreator(
                    userID: user.userID,
                    username: user.username,
                    nickname: user.nickname,
                    avatarURL: user.avatarURL
                )
            )
        }
    }
}

private struct ShortDramaSeriesDetailView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @StateObject private var viewModel: ShortDramaSeriesDetailViewModel
    @State private var deleteTarget: ShortDramaVideo?
    let onSeriesUpdated: (ShortDramaSeries) -> Void

    init(series: ShortDramaSeries, onSeriesUpdated: @escaping (ShortDramaSeries) -> Void = { _ in }) {
        _viewModel = StateObject(wrappedValue: ShortDramaSeriesDetailViewModel(series: series))
        self.onSeriesUpdated = onSeriesUpdated
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                seriesHeader

                if viewModel.isLoading && viewModel.episodes.isEmpty {
                    ShortDramaStudioLoadingState()
                        .padding(.top, 48)
                } else if viewModel.episodes.isEmpty {
                    ShortDramaEpisodeEmptyState(action: openUploadEpisode)
                        .padding(.top, 42)
                } else {
                    LazyVStack(spacing: 10) {
                        ForEach(viewModel.episodes) { episode in
                            ShortDramaEpisodeRow(video: episode) {
                                deleteTarget = episode
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 30)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(viewModel.series.title)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    navigator.pop()
                }
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 8) {
                    Button(action: openEditSeries) {
                        Image(systemName: "pencil")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(AppColors.primaryText)
                            .frame(width: 34, height: 34)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.tr("shortDrama.series.edit"))

                    Button(action: openUploadEpisode) {
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(AppColors.primaryText)
                            .frame(width: 34, height: 34)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.tr("shortDrama.episode.upload"))
                }
            }
        }
        .task {
            await viewModel.load()
            viewModel.startStatusPollingIfNeeded()
        }
        .refreshable {
            await viewModel.load()
            viewModel.startStatusPollingIfNeeded()
        }
        .onDisappear {
            viewModel.stopStatusPolling()
        }
        .confirmationDialog(
            L10n.tr("shortDrama.episode.delete"),
            isPresented: Binding(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button(L10n.tr("shortDrama.episode.delete"), role: .destructive) {
                guard let target = deleteTarget else { return }
                Task {
                    await viewModel.delete(video: target)
                    onSeriesUpdated(viewModel.series)
                    deleteTarget = nil
                }
            }
            Button(L10n.tr("common.cancel"), role: .cancel) {
                deleteTarget = nil
            }
        } message: {
            Text(L10n.tr("shortDrama.episode.delete.confirm"))
        }
        .toast(message: $viewModel.errorMessage)
        .toast(message: $viewModel.toastMessage)
        .onChange(of: viewModel.series) { updated in
            onSeriesUpdated(updated)
        }
    }

    private var seriesHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 13) {
                ShortDramaCoverImage(url: viewModel.series.coverURL, image: nil)
                    .frame(width: 96, height: 128)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(viewModel.series.title)
                            .font(.system(size: 20, weight: .bold))
                            .foregroundColor(AppColors.primaryText)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)

                        ShortDramaStatusBadge(status: viewModel.series.status)
                    }

                    Text(viewModel.series.intro.isBlank ? L10n.tr("shortDrama.series.noIntro") : viewModel.series.intro)
                        .font(.system(size: 14))
                        .foregroundColor(AppColors.secondaryText)
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(L10n.tr("shortDrama.series.episodeCount", viewModel.series.episodeCount))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(AppColors.secondaryText)

                    if viewModel.series.status.needsAttention,
                       let message = viewModel.series.statusMessage.shortDramaNonEmptyText {
                        Text(message)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(AppColors.errorColor)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(14)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(AppColors.separator.opacity(0.7), lineWidth: 1)
        )
    }

    private func openEditSeries() {
        navigator.push(ShortDramaUnifiedEditorView(mode: .edit(viewModel.series)) { updated in
            viewModel.updateSeries(updated)
        })
    }

    private func openUploadEpisode() {
        navigator.push(ShortDramaUnifiedEditorView(mode: .edit(viewModel.series)) { updated in
            viewModel.updateSeries(updated)
        })
    }
}

@MainActor
final class ShortDramaSeriesDetailViewModel: ObservableObject {
    @Published var series: ShortDramaSeries
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?
    @Published var toastMessage: String?

    private var statusRefreshTask: Task<Void, Never>?

    var episodes: [ShortDramaVideo] {
        series.episodes.sorted { lhs, rhs in
            let lhsNumber = lhs.episodeNumber ?? Int.max
            let rhsNumber = rhs.episodeNumber ?? Int.max
            if lhsNumber != rhsNumber {
                return lhsNumber < rhsNumber
            }
            return lhs.id < rhs.id
        }
    }

    var shouldPollStatus: Bool {
        series.status.isPending || series.episodes.contains { $0.publishStatus?.isPending == true }
    }

    init(series: ShortDramaSeries) {
        self.series = series
    }

    func load(silently: Bool = false) async {
        if !silently {
            isLoading = true
            errorMessage = nil
        }
        defer {
            if !silently {
                isLoading = false
            }
        }

        do {
            series = try await APIService.shared.getShortDramaSeriesDetail(seriesID: series.id)
            if !shouldPollStatus {
                stopStatusPolling()
            }
        } catch {
            if !silently {
                errorMessage = error.localizedDescription
            }
        }
    }

    func updateSeries(_ updated: ShortDramaSeries) {
        series = updated
        startStatusPollingIfNeeded()
    }

    func applyUpload(_ result: ShortDramaEpisodeUploadResult) {
        guard let video = result.video else {
            toastMessage = result.statusMessage.shortDramaNonEmptyText
                ?? result.status?.localizedTitle
                ?? L10n.tr("shortDrama.episode.uploaded")
            Task {
                await load(silently: true)
                startStatusPollingIfNeeded()
            }
            return
        }

        var nextEpisodes = series.episodes
        if let index = nextEpisodes.firstIndex(where: { $0.id == video.id }) {
            nextEpisodes[index] = video
        } else {
            nextEpisodes.append(video)
        }
        series = series.replacingEpisodes(nextEpisodes)
        toastMessage = result.statusMessage.shortDramaNonEmptyText
            ?? result.status?.localizedTitle
            ?? L10n.tr("shortDrama.episode.uploaded")
        Task {
            await load(silently: true)
            startStatusPollingIfNeeded()
        }
    }

    func delete(video: ShortDramaVideo) async {
        errorMessage = nil
        do {
            try await APIService.shared.deleteShortDramaEpisode(videoID: video.id)
            series = series.replacingEpisodes(series.episodes.filter { $0.id != video.id })
            startStatusPollingIfNeeded()
            toastMessage = L10n.tr("shortDrama.episode.deleted")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func startStatusPollingIfNeeded() {
        guard shouldPollStatus else {
            stopStatusPolling()
            return
        }
        guard statusRefreshTask == nil else { return }

        statusRefreshTask = Task { @MainActor [weak self] in
            for attempt in 0..<18 {
                let seconds: UInt64 = attempt < 5 ? 3 : 8
                try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
                guard !Task.isCancelled, let self else { return }
                await self.load(silently: true)
                guard self.shouldPollStatus else { break }
            }
            self?.statusRefreshTask = nil
        }
    }

    func stopStatusPolling() {
        statusRefreshTask?.cancel()
        statusRefreshTask = nil
    }
}

private enum ShortDramaSeriesEditorMode {
    case create
    case edit(ShortDramaSeries)

    var title: String {
        switch self {
        case .create: return L10n.tr("shortDrama.series.create")
        case .edit: return L10n.tr("shortDrama.series.edit")
        }
    }

    var existingSeries: ShortDramaSeries? {
        if case .edit(let series) = self {
            return series
        }
        return nil
    }
}

private struct ShortDramaSeriesEditorView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @State private var title: String
    @State private var intro: String
    @State private var coverItem: PhotosPickerItem?
    @State private var coverImage: UIImage?
    @State private var coverData: Data?
    @State private var isSaving = false
    @State private var toastMessage: String?

    let mode: ShortDramaSeriesEditorMode
    let onSaved: (ShortDramaSeries) -> Void

    private var existingSeries: ShortDramaSeries? { mode.existingSeries }
    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedIntro: String { intro.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSave: Bool {
        guard !trimmedTitle.isEmpty, !isSaving else { return false }
        if existingSeries == nil {
            return coverData != nil
        }
        return true
    }

    init(mode: ShortDramaSeriesEditorMode, onSaved: @escaping (ShortDramaSeries) -> Void) {
        self.mode = mode
        self.onSaved = onSaved
        let series = mode.existingSeries
        _title = State(initialValue: series?.title ?? "")
        _intro = State(initialValue: series?.intro ?? "")
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                coverPicker
                formCard
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 30)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(mode.title)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    navigator.pop()
                }
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: save) {
                    if isSaving {
                        ProgressView()
                            .tint(AppColors.accent)
                    } else {
                        Text(L10n.tr("common.save"))
                            .font(.system(size: 15, weight: .bold))
                    }
                }
                .buttonStyle(.plain)
                .disabled(!canSave)
                .foregroundColor(canSave ? AppColors.accent : AppColors.tertiaryText)
            }
        }
        .onChange(of: coverItem) { item in
            Task { await loadCover(item) }
        }
        .toast(message: $toastMessage)
    }

    private var coverPicker: some View {
        PhotosPicker(selection: $coverItem, matching: .images) {
            ZStack(alignment: .bottomTrailing) {
                ShortDramaCoverImage(url: existingSeries?.coverURL ?? "", image: coverImage)
                    .frame(height: 210)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                Label(L10n.tr("shortDrama.cover.choose"), systemImage: "photo")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.black.opacity(0.55))
                    .clipShape(Capsule())
                    .padding(12)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L10n.tr("shortDrama.cover.choose"))
    }

    private var formCard: some View {
        VStack(spacing: 0) {
            ShortDramaFormField(title: L10n.tr("shortDrama.series.title")) {
                TextField(L10n.tr("shortDrama.series.title.placeholder"), text: $title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .textInputAutocapitalization(.never)
            }

            Divider().padding(.leading, 16)

            ShortDramaFormField(title: L10n.tr("shortDrama.series.intro")) {
                TextField(L10n.tr("shortDrama.series.intro.placeholder"), text: $intro, axis: .vertical)
                    .font(.system(size: 15))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(3...5)
            }
        }
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(AppColors.separator.opacity(0.7), lineWidth: 1)
        )
    }

    private func loadCover(_ item: PhotosPickerItem?) async {
        guard let item,
              let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else { return }
        let compressed = APIService.compressImageForUpload(data, maxDimension: 1280, quality: 0.78, maxBytes: 900_000)
        await MainActor.run {
            coverData = compressed
            coverImage = UIImage(data: compressed) ?? image
        }
    }

    private func save() {
        guard canSave else { return }
        isSaving = true
        Task {
            do {
                let saved: ShortDramaSeries
                if let existingSeries {
                    saved = try await APIService.shared.updateShortDramaSeries(
                        seriesID: existingSeries.id,
                        title: trimmedTitle,
                        intro: trimmedIntro,
                        coverData: coverData,
                        coverFilename: coverData == nil ? nil : coverFilename()
                    )
                } else if let coverData {
                    saved = try await APIService.shared.createShortDramaSeries(
                        title: trimmedTitle,
                        intro: trimmedIntro,
                        coverData: coverData,
                        coverFilename: coverFilename()
                    )
                } else {
                    toastMessage = L10n.tr("shortDrama.cover.required")
                    isSaving = false
                    return
                }

                onSaved(saved)
                navigator.pop()
            } catch {
                toastMessage = error.localizedDescription
                isSaving = false
            }
        }
    }

    private func coverFilename() -> String {
        "short_drama_cover_\(Int(Date().timeIntervalSince1970)).jpg"
    }
}

private struct ShortDramaEpisodeUploadView: View {
    @EnvironmentObject private var navigator: UIKitNavigator
    @State private var title = ""
    @State private var intro = ""
    @State private var episodeNumber = "1"
    @State private var videoItem: PhotosPickerItem?
    @State private var coverItem: PhotosPickerItem?
    @State private var videoData: Data?
    @State private var videoFilename: String?
    @State private var coverData: Data?
    @State private var coverImage: UIImage?
    @State private var isUploading = false
    @State private var toastMessage: String?

    let series: ShortDramaSeries
    let onUploaded: (ShortDramaEpisodeUploadResult) -> Void

    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedIntro: String { intro.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var resolvedEpisodeNumber: Int? { Int(episodeNumber.trimmingCharacters(in: .whitespacesAndNewlines)) }
    private var canUpload: Bool {
        !trimmedTitle.isEmpty
            && (resolvedEpisodeNumber ?? 0) > 0
            && videoData != nil
            && videoFilename != nil
            && coverData != nil
            && !isUploading
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 14) {
                videoPicker
                coverPicker
                metadataCard
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 30)
        }
        .background(AppColors.secondaryBackground)
        .navigationTitle(L10n.tr("shortDrama.episode.upload"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                AppBackButton {
                    navigator.pop()
                }
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                Button(action: upload) {
                    if isUploading {
                        ProgressView()
                            .tint(AppColors.accent)
                    } else {
                        Text(L10n.tr("common.publish"))
                            .font(.system(size: 15, weight: .bold))
                    }
                }
                .buttonStyle(.plain)
                .disabled(!canUpload)
                .foregroundColor(canUpload ? AppColors.accent : AppColors.tertiaryText)
            }
        }
        .onChange(of: videoItem) { item in
            Task { await loadVideo(item) }
        }
        .onChange(of: coverItem) { item in
            Task { await loadCover(item) }
        }
        .toast(message: $toastMessage)
    }

    private var videoPicker: some View {
        PhotosPicker(selection: $videoItem, matching: .videos) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(AppColors.cardBackground)
                    .frame(height: 190)

                VStack(spacing: 10) {
                    Image(systemName: videoData == nil ? "video.badge.plus" : "video.fill")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundColor(AppColors.accent)

                    Text(videoFilename ?? L10n.tr("shortDrama.video.choose"))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)

                    Text(L10n.tr("shortDrama.video.chooseHint"))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(AppColors.secondaryText)
                }
                .padding(.horizontal, 18)
            }
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(AppColors.separator.opacity(0.7), lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var coverPicker: some View {
        PhotosPicker(selection: $coverItem, matching: .images) {
            ZStack(alignment: .bottomTrailing) {
                ShortDramaCoverImage(url: "", image: coverImage)
                    .frame(height: 190)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                Label(L10n.tr("shortDrama.cover.replace"), systemImage: "photo")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.black.opacity(0.55))
                    .clipShape(Capsule())
                    .padding(12)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var metadataCard: some View {
        VStack(spacing: 0) {
            ShortDramaFormField(title: L10n.tr("shortDrama.episode.title")) {
                TextField(L10n.tr("shortDrama.episode.title.placeholder"), text: $title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
            }

            Divider().padding(.leading, 16)

            ShortDramaFormField(title: L10n.tr("shortDrama.episode.number")) {
                TextField("1", text: $episodeNumber)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(AppColors.primaryText)
                    .keyboardType(.numberPad)
            }

            Divider().padding(.leading, 16)

            ShortDramaFormField(title: L10n.tr("shortDrama.episode.intro")) {
                TextField(L10n.tr("shortDrama.episode.intro.placeholder"), text: $intro, axis: .vertical)
                    .font(.system(size: 15))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(3...5)
            }
        }
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(AppColors.separator.opacity(0.7), lineWidth: 1)
        )
    }

    private func loadVideo(_ item: PhotosPickerItem?) async {
        guard let item,
              let video = try? await item.loadTransferable(type: VideoTransferable.self) else { return }
        let url = video.url
        let data = await Task.detached(priority: .utility) {
            try? Data(contentsOf: url)
        }.value
        let preview = await videoPreviewImage(for: url)
        try? FileManager.default.removeItem(at: url)
        guard let data else { return }

        await MainActor.run {
            videoData = data
            videoFilename = videoFilename(for: url)
            if let preview {
                coverImage = preview
                coverData = preview.jpegData(compressionQuality: 0.82)
            }
        }
    }

    private func loadCover(_ item: PhotosPickerItem?) async {
        guard let item,
              let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else { return }
        let compressed = APIService.compressImageForUpload(data, maxDimension: 1280, quality: 0.78, maxBytes: 900_000)
        await MainActor.run {
            coverData = compressed
            coverImage = UIImage(data: compressed) ?? image
        }
    }

    private func upload() {
        guard canUpload,
              let videoData,
              let videoFilename,
              let coverData,
              let episodeNumber = resolvedEpisodeNumber else { return }
        isUploading = true
        Task {
            do {
                let result = try await APIService.shared.uploadShortDramaEpisode(
                    seriesID: series.id,
                    title: trimmedTitle,
                    intro: trimmedIntro,
                    episodeNumber: episodeNumber,
                    videoData: videoData,
                    videoFilename: videoFilename,
                    coverData: coverData,
                    coverFilename: coverFilename()
                )
                onUploaded(result)
                navigator.pop()
            } catch {
                toastMessage = error.localizedDescription
                isUploading = false
            }
        }
    }

    private func videoFilename(for url: URL) -> String {
        let ext = url.pathExtension.isBlank ? "mp4" : url.pathExtension.lowercased()
        return "short_drama_episode_\(Int(Date().timeIntervalSince1970)).\(ext)"
    }

    private func coverFilename() -> String {
        "short_drama_episode_cover_\(Int(Date().timeIntervalSince1970)).jpg"
    }

    private func videoPreviewImage(for url: URL) async -> UIImage? {
        await Task.detached(priority: .utility) {
            let asset = AVAsset(url: url)
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 720, height: 720)
            guard let cgImage = try? generator.copyCGImage(at: .zero, actualTime: nil) else {
                return nil
            }
            return UIImage(cgImage: cgImage)
        }.value
    }
}

private struct ShortDramaSeriesRow: View {
    let series: ShortDramaSeries

    var body: some View {
        HStack(spacing: 13) {
            ShortDramaCoverImage(url: series.coverURL, image: nil)
                .frame(width: 74, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 8) {
                    Text(series.title)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(AppColors.primaryText)
                        .lineLimit(1)

                    ShortDramaStatusBadge(status: series.status)
                }

                Text(series.intro.isBlank ? L10n.tr("shortDrama.series.noIntro") : series.intro)
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(2)

                if series.status.needsAttention,
                   let message = series.statusMessage.shortDramaNonEmptyText {
                    Text(message)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(AppColors.errorColor)
                        .lineLimit(1)
                }

                HStack(spacing: 10) {
                    Label(L10n.tr("shortDrama.series.episodeCount", series.episodeCount), systemImage: "play.rectangle")
                    if !series.updatedAt.isBlank {
                        Label(series.updatedAt, systemImage: "clock")
                    }
                }
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(AppColors.tertiaryText)
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(AppColors.tertiaryText)
        }
        .padding(12)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(AppColors.separator.opacity(0.7), lineWidth: 1)
        )
    }
}

private struct ShortDramaEpisodeRow: View {
    let video: ShortDramaVideo
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            ShortDramaCoverImage(url: video.coverURL, image: nil)
                .frame(width: 66, height: 88)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(video.episodeText)
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(AppColors.accent)

                    if let status = video.publishStatus {
                        ShortDramaStatusBadge(status: status)
                    }
                }

                Text(video.displayTitle)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(AppColors.primaryText)
                    .lineLimit(1)

                Text(video.displayIntro)
                    .font(.system(size: 13))
                    .foregroundColor(AppColors.secondaryText)
                    .lineLimit(2)

                if video.publishStatus?.needsAttention == true,
                   let message = video.statusMessage.shortDramaNonEmptyText {
                    Text(message)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(AppColors.errorColor)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button(action: onDelete) {
                Image(systemName: "trash")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(AppColors.errorColor)
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(AppColors.separator.opacity(0.7), lineWidth: 1)
        )
    }
}

private struct ShortDramaCoverImage: View {
    let url: String
    let image: UIImage?
    @State private var remoteImage: UIImage?

    init(url: String, image: UIImage?) {
        self.url = url
        self.image = image
        _remoteImage = State(
            initialValue: image == nil && !url.isBlank
                ? ImageCacheManager.shared.image(for: url)
                : nil
        )
    }

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else if let remoteImage {
                Image(uiImage: remoteImage)
                    .resizable()
                    .scaledToFill()
            } else {
                LinearGradient(
                    colors: [Color(hex: "2B2D42"), Color(hex: "7C3AED"), Color(hex: "FF4D8D")],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                Image(systemName: "play.rectangle.fill")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundColor(.white.opacity(0.88))
            }
        }
        .clipped()
        .task(id: url) {
            let requestedURL = url
            guard image == nil, !requestedURL.isBlank else {
                remoteImage = nil
                return
            }
            if let cached = ImageCacheManager.shared.image(for: requestedURL) {
                remoteImage = cached
            } else {
                remoteImage = nil
                let loaded = await ImageCacheManager.shared.loadImage(from: requestedURL)
                guard !Task.isCancelled, requestedURL == url else { return }
                remoteImage = loaded
            }
        }
    }
}

private struct ShortDramaStatusBadge: View {
    let status: ShortDramaPublishStatus

    var body: some View {
        Text(status.localizedTitle)
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
            .lineLimit(1)
    }

    private var color: Color {
        switch status {
        case .published: return AppColors.online
        case .processing, .reviewing: return AppColors.accent
        case .rejected, .failed: return AppColors.errorColor
        case .draft, .unknown: return AppColors.secondaryText
        }
    }
}

private struct ShortDramaFormField<Content: View>: View {
    let title: String
    private let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(AppColors.secondaryText)
            content
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

private struct ShortDramaStudioLoadingState: View {
    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(AppColors.accent)
            Text(L10n.tr("common.loading"))
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(AppColors.secondaryText)
        }
    }
}

private struct ShortDramaStudioEmptyState: View {
    let action: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "play.rectangle.stack")
                .font(.system(size: 44, weight: .semibold))
                .foregroundColor(AppColors.accent)

            VStack(spacing: 6) {
                Text(L10n.tr("shortDrama.studio.empty"))
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(AppColors.primaryText)

                Text(L10n.tr("shortDrama.studio.emptyHint"))
                    .font(.system(size: 14))
                    .foregroundColor(AppColors.secondaryText)
                    .multilineTextAlignment(.center)
            }

            Button(action: action) {
                Label(L10n.tr("shortDrama.series.create"), systemImage: "plus")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .background(AppColors.accent)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
        .padding(28)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct ShortDramaEpisodeEmptyState: View {
    let action: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "video.badge.plus")
                .font(.system(size: 38, weight: .semibold))
                .foregroundColor(AppColors.accent)

            Text(L10n.tr("shortDrama.episode.empty"))
                .font(.system(size: 17, weight: .bold))
                .foregroundColor(AppColors.primaryText)

            Button(action: action) {
                Text(L10n.tr("shortDrama.episode.upload"))
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .background(AppColors.accent)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
        .padding(28)
        .background(AppColors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private extension ShortDramaSeries {
    func replacingEpisodes(_ episodes: [ShortDramaVideo]) -> ShortDramaSeries {
        ShortDramaSeries(
            seriesID: seriesID,
            title: title,
            intro: intro,
            coverURL: coverURL,
            episodeCount: episodes.count,
            status: status,
            statusMessage: statusMessage,
            updatedAt: updatedAt,
            episodes: episodes,
            creator: creator,
            resumeEpisodeID: resumeEpisodeID,
            resumePositionSeconds: resumePositionSeconds,
            lastWatchedAt: lastWatchedAt
        )
    }
}

private extension Optional where Wrapped == String {
    var shortDramaNonEmptyText: String? {
        let trimmed = self?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}
