// BWChat/Views/ImagePreviewView.swift
// Full-screen image gallery with zoom-from-tap-point entrance.

import SwiftUI
import UIKit

// MARK: - Shared state so overlay can live at root level (above tab bar)

@MainActor
class ImageGalleryState: ObservableObject {
    static let shared = ImageGalleryState()
    @Published var isPresented = false
    @Published var imageURLs: [String] = []
    @Published var initialIndex: Int = 0
    /// Incremented on every show() so the overlay can force a fresh GalleryContent
    /// view identity even when the same image is tapped twice in a row.
    @Published var openToken: Int = 0

    /// Optional loader invoked when the gallery's current index approaches
    /// the leftmost image (oldest). The loader should fetch more older
    /// messages, prepend the newly-discovered image URLs to
    /// `imageURLs`, and return the number prepended so the gallery can
    /// shift its currentIndex and keep the user on the same image
    /// visually. Returning 0 signals "no more older images" and the
    /// gallery will stop retrying until the user reopens it.
    var loadMoreOlder: (() async -> Int)?

    func show(urls: [String], index: Int, loadMoreOlder: (() async -> Int)? = nil) {
        imageURLs = urls
        initialIndex = index
        self.loadMoreOlder = loadMoreOlder
        openToken &+= 1
        isPresented = true
    }

    /// Call instead of setting isPresented = false directly so the
    /// loadMoreOlder closure (which may retain a chat view-model) is
    /// released when the gallery closes.
    func dismiss() {
        isPresented = false
        loadMoreOlder = nil
    }
}

// MARK: - Overlay (always in the tree; only renders when isPresented)

struct ImageGalleryOverlay: View {
    @ObservedObject var state = ImageGalleryState.shared

    var body: some View {
        ZStack {
            if state.isPresented {
                // Key insight: GalleryContent is recreated each time openToken
                // changes, so its @State currentIndex is seeded fresh from
                // initialIndex inside its init() BEFORE the first render.
                // This lets TabView start on the right page from frame 1 —
                // otherwise UIPageViewController animates a horizontal page
                // transition (0 → initialIndex) concurrently with the outer
                // scale-in, which is the shake the user was seeing.
                GalleryContent(
                    state: state,
                    onDismiss: { state.dismiss() }
                )
                .id(state.openToken)
            }
        }
        .ignoresSafeArea()
    }
}

// MARK: - Gallery Content (fresh instance per open)

private struct GalleryContent: View {
    /// Observing the shared state directly (not a snapshot prop) lets
    /// the TabView pick up new pages when `loadMoreOlder` prepends
    /// older image URLs mid-gallery.
    @ObservedObject var state: ImageGalleryState
    let onDismiss: () -> Void

    @State private var currentIndex: Int
    @State private var appeared: Bool = false
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var verticalDrag: CGFloat = 0
    @State private var isLoadingMore: Bool = false
    /// Once the loader returns 0 added, stop retrying so we don't
    /// hammer the backend while the user sits at the first image.
    @State private var reachedEnd: Bool = false

    init(state: ImageGalleryState, onDismiss: @escaping () -> Void) {
        self.state = state
        self.onDismiss = onDismiss
        self._currentIndex = State(initialValue: state.initialIndex)
    }

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()
                .opacity(appeared ? backgroundOpacity : 0)

            TabView(selection: $currentIndex) {
                ForEach(Array(state.imageURLs.enumerated()), id: \.offset) { index, url in
                    ZoomableImagePage(
                        imageURL: url,
                        scale: index == currentIndex ? $scale : .constant(1),
                        lastScale: index == currentIndex ? $lastScale : .constant(1),
                        offset: index == currentIndex ? $offset : .constant(.zero),
                        lastOffset: index == currentIndex ? $lastOffset : .constant(.zero),
                        onSingleTap: { dismissByTap() },
                        onDoubleTap: { centerDelta in doubleTap(at: centerDelta) }
                    )
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .offset(y: verticalDrag)
            // Centered scale: entrance is a subtle spring from 0.88 → 1.0
            // and a swipe-drag adds a further shrink (dragDismissScale).
            .scaleEffect(entranceScale * dragDismissScale)
            .opacity(appeared ? 1.0 : 0.0)
            // Dismiss-drag lives on the TabView as a simultaneousGesture so
            // UIPageViewController's horizontal page-swipe recognizer can
            // still fire alongside (that's how multi-image left/right swipe
            // keeps working). The scale check inside the gesture — not on
            // the attachment — is what actually prevents dismiss from
            // firing when the image is zoomed: conditional-nil attachment
            // turned out to be unreliable, so we gate inside the callback.
            .simultaneousGesture(verticalDismissGesture)
            .onChange(of: currentIndex) { newIndex in
                resetZoom()
                // Near the leftmost image and a loader exists → try
                // paging in more older chat history.
                if newIndex <= 1, !isLoadingMore, !reachedEnd, state.loadMoreOlder != nil {
                    Task { await loadMoreIfNeeded() }
                }
            }

            if state.imageURLs.count > 1 {
                VStack {
                    Text("\(currentIndex + 1) / \(state.imageURLs.count)")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white.opacity(0.9))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 5)
                        .background(.black.opacity(0.4))
                        .cornerRadius(14)
                        .padding(.top, 54)
                    Spacer()
                }
                .opacity(scale <= 1.05 && verticalDrag == 0 && appeared ? 1 : 0)
            }
        }
        .ignoresSafeArea()
        .onAppear {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                appeared = true
            }
        }
    }

    // MARK: - Derived visuals

    private var entranceScale: CGFloat {
        appeared ? 1.0 : 0.88
    }

    private var backgroundOpacity: Double {
        1.0 - min(abs(verticalDrag) / 320, 0.75)
    }

    private var dragDismissScale: CGFloat {
        let drag = abs(verticalDrag)
        if drag < 8 { return 1.0 }
        return max(1.0 - drag / 900, 0.55)
    }

    // MARK: - Dismiss gesture (on the TabView, simultaneous with paging)

    private var verticalDismissGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                // Gate inside the callback. If we're zoomed in, the pan
                // gesture on the Image is the one that should track the
                // finger — do not drive dismiss state.
                guard scale <= 1.05 else { return }
                let h = value.translation.height
                let w = value.translation.width
                // Require a clearly-vertical drag (≥45° off horizontal)
                // before we shift the image. A looser angle check made
                // the gallery jitter up-and-down when the user was
                // actually trying to swipe left/right between images —
                // even a tiny vertical wobble in a horizontal swipe kept
                // updating verticalDrag. If the drag is horizontal-
                // dominant, do not update — UIPageViewController's page
                // recognizer handles the paging.
                if abs(h) > abs(w) {
                    verticalDrag = h
                }
            }
            .onEnded { value in
                guard scale <= 1.05 else { return }
                let h = abs(value.translation.height)
                let w = abs(value.translation.width)
                let predictedH = abs(value.predictedEndTranslation.height)
                // Only dismiss if the release was vertical-dominant; a
                // mostly-horizontal fling should fall through to paging
                // and spring any stray verticalDrag back to zero.
                if h > w && (h > 110 || predictedH > 450) {
                    dismissBySwipe(direction: value.translation.height)
                } else if verticalDrag != 0 {
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                        verticalDrag = 0
                    }
                }
            }
    }

    /// Tap-to-dismiss. When the user taps while zoomed, we animate scale
    /// and offset back to rest alongside the fade — otherwise the image
    /// freezes at 2.5× while opacity drops, which feels abrupt (the
    /// "hitch" the user was seeing).
    private func dismissByTap() {
        withAnimation(.easeOut(duration: 0.24)) {
            scale = 1; lastScale = 1
            offset = .zero; lastOffset = .zero
            appeared = false
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.24) {
            onDismiss()
        }
    }

    /// Swipe-to-dismiss: continue the drag direction off-screen while
    /// fading so the release feels like a natural follow-through instead
    /// of a sudden cut.
    private func dismissBySwipe(direction: CGFloat) {
        let sign: CGFloat = direction >= 0 ? 1 : -1
        withAnimation(.easeOut(duration: 0.28)) {
            verticalDrag = 900 * sign
            appeared = false
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.28) {
            onDismiss()
        }
    }

    /// Call the chat view's loader to fetch older images. If it adds
    /// any URLs to `state.imageURLs` (prepended), shift currentIndex
    /// by the added count so the user stays on the same image visually
    /// — SwiftUI batches the imageURLs and currentIndex updates in the
    /// same render pass, so no intermediate frame shows the wrong page.
    @MainActor
    private func loadMoreIfNeeded() async {
        guard !isLoadingMore, let loader = state.loadMoreOlder else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let added = await loader()
        if added > 0 {
            currentIndex += added
        } else {
            reachedEnd = true
        }
    }

    /// Double-tap zoom. `centerDelta` is the tap point expressed as an
    /// offset from the image view's center (in the view's own coordinate
    /// space). Zooming in adjusts `offset` so the tapped point stays put
    /// under the finger — `scaleEffect` scales around the center, so a
    /// point at (dx, dy) from center would naturally move to (k·dx, k·dy)
    /// after a scale of k; compensating with offset = -(k-1)·(dx, dy)
    /// keeps that point stationary.
    private func doubleTap(at centerDelta: CGPoint) {
        withAnimation(.easeInOut(duration: 0.26)) {
            if scale > 1 {
                resetZoom()
            } else {
                let newScale: CGFloat = 2.5
                scale = newScale
                lastScale = newScale
                offset = CGSize(
                    width: -centerDelta.x * (newScale - 1),
                    height: -centerDelta.y * (newScale - 1)
                )
                lastOffset = offset
            }
        }
    }

    private func resetZoom() {
        scale = 1; lastScale = 1
        offset = .zero; lastOffset = .zero
    }
}

// MARK: - Zoomable Image Page

private struct ZoomableImagePage: View {
    let imageURL: String
    @Binding var scale: CGFloat
    @Binding var lastScale: CGFloat
    @Binding var offset: CGSize
    @Binding var lastOffset: CGSize
    var onSingleTap: () -> Void
    /// Receives the double-tap location expressed as a delta from the
    /// image view's center. GalleryContent uses this to zoom-from-tap.
    var onDoubleTap: (CGPoint) -> Void

    @State private var image: UIImage?
    @State private var isLoading: Bool

    init(
        imageURL: String,
        scale: Binding<CGFloat>,
        lastScale: Binding<CGFloat>,
        offset: Binding<CGSize>,
        lastOffset: Binding<CGSize>,
        onSingleTap: @escaping () -> Void,
        onDoubleTap: @escaping (CGPoint) -> Void
    ) {
        self.imageURL = imageURL
        self._scale = scale
        self._lastScale = lastScale
        self._offset = offset
        self._lastOffset = lastOffset
        self.onSingleTap = onSingleTap
        self.onDoubleTap = onDoubleTap

        // Seed from memory cache before the first render so the entrance
        // animation zooms a stable image, not a placeholder-then-image swap.
        let preLoaded: UIImage? = ImageCacheManager.shared.image(for: imageURL)
            ?? ImageCacheManager.shared.image(for: imageURL + "?thumb=1")
        self._image = State(initialValue: preLoaded)
        self._isLoading = State(initialValue: preLoaded == nil)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.clear

                if let image = image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: geo.size.width, height: geo.size.height)
                        .scaleEffect(scale)
                        .offset(x: offset.width, y: offset.height)
                        .gesture(pinchGesture)
                        // Pan is attached ONLY while zoomed. At rest scale,
                        // no drag gesture on the image — UIPageViewController
                        // sees the touches and left/right paging works. When
                        // zoomed, pan takes over (dismiss is gated off at
                        // scale > 1.05 inside its own handler).
                        .simultaneousGesture(scale > 1.05 ? panGesture : nil)
                        // SpatialTapGesture provides the tap location so we
                        // can zoom from the tapped point. The single-tap
                        // follows afterward — SwiftUI disambiguates via the
                        // count parameter like the built-in `.onTapGesture`.
                        .gesture(
                            SpatialTapGesture(count: 2)
                                .onEnded { event in
                                    let dx = event.location.x - geo.size.width / 2
                                    let dy = event.location.y - geo.size.height / 2
                                    onDoubleTap(CGPoint(x: dx, y: dy))
                                }
                        )
                        .onTapGesture { onSingleTap() }
                        .longPressToSaveImage(url: imageURL)
                } else if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Image(systemName: "photo")
                        .font(.system(size: 48))
                        .foregroundColor(.gray)
                }
            }
        }
        .task(id: imageURL) {
            if let loaded = await ImageCacheManager.shared.loadImage(from: imageURL) {
                image = loaded
            }
            isLoading = false
        }
    }

    private var pinchGesture: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                scale = max(lastScale * value, 0.5)
            }
            .onEnded { _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    if scale < 1 { scale = 1; offset = .zero; lastOffset = .zero }
                }
                lastScale = scale
            }
    }

    /// Pan the zoomed image. Only attached while `scale > 1.05` so at
    /// rest the image view doesn't consume touches that should go to
    /// UIPageViewController for horizontal paging.
    private var panGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(
                    width: lastOffset.width + value.translation.width,
                    height: lastOffset.height + value.translation.height
                )
            }
            .onEnded { _ in
                lastOffset = offset
            }
    }
}
