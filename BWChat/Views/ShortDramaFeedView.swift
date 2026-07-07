// BWChat/Views/ShortDramaFeedView.swift
// Full-screen vertical short drama feed.

import AVFoundation
import SwiftUI
import UIKit

struct ShortDramaFeedView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var navigator: UIKitNavigator
    @ObservedObject private var viewModel: ShortDramaFeedViewModel
    @State private var commentTarget: ShortDramaVideo?

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
            guard let videoID else { return }
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
                onToggleFavorite: { viewModel.toggleFavorite(videoID: $0.id) },
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
}

private struct ShortDramaVerticalPager: UIViewControllerRepresentable {
    let videos: [ShortDramaVideo]
    let players: [String: AVPlayer]
    @Binding var selectedVideoID: String?
    let isPlaybackPaused: (ShortDramaVideo) -> Bool
    let isPlaybackTarget: (ShortDramaVideo) -> Bool
    let onTogglePlayback: (ShortDramaVideo) -> Void
    let onToggleLike: (ShortDramaVideo) -> Void
    let onToggleFavorite: (ShortDramaVideo) -> Void
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
                onToggleFavorite: { self.parent.onToggleFavorite(video) },
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
