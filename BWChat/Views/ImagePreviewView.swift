// BWChat/Views/ImagePreviewView.swift
// Full-screen image gallery with zoom-from-tap-point entrance.

import SwiftUI
import UIKit

// MARK: - Debug logging (remove after diagnosing open/close jitter + lag)

enum GalleryDbg {
    /// Monotonic clock seconds since the first call — easier to read than
    /// wall-clock times when diagnosing animation frame timing.
    private static let origin = Date()
    static func log(_ tag: String, _ fields: String = "") {
        let t = Date().timeIntervalSince(origin)
        print(String(format: "[GalleryDbg %8.3f] %@ %@", t, tag, fields))
    }
}

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

    /// Global-coordinate frame of the thumbnail that was tapped. Used for
    /// the WeChat-style "image flies from its chat position to full-screen"
    /// hero animation. `.zero` means callers didn't provide a frame —
    /// GalleryContent then falls back to a center scale-in.
    @Published var sourceFrame: CGRect = .zero

    /// Optional loader invoked when the gallery's current index approaches
    /// the leftmost image (oldest). The loader should fetch more older
    /// messages, prepend the newly-discovered image URLs to
    /// `imageURLs`, and return the number prepended so the gallery can
    /// shift its currentIndex and keep the user on the same image
    /// visually. Returning 0 signals "no more older images" and the
    /// gallery will stop retrying until the user reopens it.
    var loadMoreOlder: (() async -> Int)?

    func show(
        urls: [String],
        index: Int,
        sourceFrame: CGRect = .zero,
        loadMoreOlder: (() async -> Int)? = nil
    ) {
        GalleryDbg.log("show()", "src=\(sourceFrame)")
        imageURLs = urls
        initialIndex = index
        self.sourceFrame = sourceFrame
        self.loadMoreOlder = loadMoreOlder
        openToken &+= 1
        isPresented = true
    }

    /// Call instead of setting isPresented = false directly so the
    /// loadMoreOlder closure (which may retain a chat view-model) is
    /// released when the gallery closes.
    func dismiss() {
        GalleryDbg.log("state.dismiss()")
        isPresented = false
        loadMoreOlder = nil
    }
}

// MARK: - Tap + global-frame capture helper
//
// Image thumbnails use this modifier to surface their global-coordinate
// frame at the moment of tap — callers pass it to `ImageGalleryState.show`
// so the full-screen gallery animates from that exact position.

extension View {
    func onTapCaptureFrame(perform action: @escaping (CGRect) -> Void) -> some View {
        modifier(OnTapCaptureFrameModifier(action: action))
    }
}

private struct OnTapCaptureFrameModifier: ViewModifier {
    let action: (CGRect) -> Void
    @State private var frame: CGRect = .zero

    func body(content: Content) -> some View {
        content
            .background(
                GeometryReader { geo in
                    Color.clear
                        .onAppear { frame = geo.frame(in: .global) }
                        .onChange(of: geo.frame(in: .global)) { newFrame in
                            frame = newFrame
                        }
                }
            )
            .onTapGesture { action(frame) }
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
                // Default conditional-view transition is `.opacity` with an
                // ambient animation; on insertion it fades in the whole
                // GalleryContent over ~0.35s, concurrently with our own
                // hero-grow animation. The two overlapping curves produce a
                // directional jitter (down on open, up on close) exactly in
                // line with the hero direction. Kill the transition so our
                // hero animation is the only motion the user perceives.
                .transition(.identity)
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
    /// True while the hero (grow-from-thumbnail) animation is running —
    /// we render a simple Image view instead of the TabView during this
    /// phase. Applying scaleEffect/offset directly to TabView caused
    /// the internal UIPageViewController to re-layout every frame and
    /// Core Animation spammed "Failed to create 1206x0 image slot"
    /// errors, visibly stuttering the animation.
    @State private var inHeroPhase: Bool

    init(state: ImageGalleryState, onDismiss: @escaping () -> Void) {
        self.state = state
        self.onDismiss = onDismiss
        self._currentIndex = State(initialValue: state.initialIndex)
        // Start in hero phase only if the caller supplied a real source
        // frame. Otherwise we fall back to the old center scale-in on the
        // TabView, which is a tiny transform that doesn't choke UIKit.
        self._inHeroPhase = State(initialValue: state.sourceFrame.width > 1 && state.sourceFrame.height > 1)
        GalleryDbg.log("GalleryContent.init", "srcFrame=\(state.sourceFrame) inHeroPhase=\(_inHeroPhase.wrappedValue)")
    }

    /// Aspect-fit rect of `aspect` (w/h) inside `bounds`, centered.
    private static func fitRect(aspect: CGFloat, in bounds: CGSize) -> CGRect {
        guard aspect > 0, bounds.width > 0, bounds.height > 0 else {
            return CGRect(origin: .zero, size: bounds)
        }
        let boundsAspect = bounds.width / bounds.height
        let w: CGFloat
        let h: CGFloat
        if aspect >= boundsAspect {
            w = bounds.width
            h = bounds.width / aspect
        } else {
            h = bounds.height
            w = bounds.height * aspect
        }
        return CGRect(
            x: (bounds.width - w) / 2,
            y: (bounds.height - h) / 2,
            width: w,
            height: h
        )
    }

    /// Pull the image's natural size out of the memory cache. The gallery
    /// uses this to compute the on-screen target rect with the image's REAL
    /// aspect ratio (the captured sourceFrame may be a bubble container, not
    /// the image itself, so its aspect cannot be trusted).
    private static func cachedImageSize(for url: String) -> CGSize? {
        let cache = ImageCacheManager.shared
        if let img = cache.image(for: url) ?? cache.image(for: url + "?thumb=1") {
            return img.size
        }
        return nil
    }

    var body: some View {
        // Use UIScreen.main.bounds for screen size instead of GeometryReader —
        // UIScreen gives a synchronous, stable size with no first-frame race.
        let screen = UIScreen.main.bounds.size
        let src = state.sourceFrame
        let hasSrc = src.width > 1 && src.height > 1
        let currentURL = currentIndex >= 0 && currentIndex < state.imageURLs.count
            ? state.imageURLs[currentIndex]
            : (state.imageURLs.first ?? "")

        // Full-screen aspect-fit rect for the image. Prefer the image's real
        // intrinsic aspect (from memory cache) — sourceFrame may be the bubble
        // container, not the image's displayed rect, so its aspect is not
        // trustworthy. Fall back to src aspect only when the image isn't yet
        // cached. Also: Image uses .aspectRatio(.fit) so a stale fallback aspect
        // degrades to letterbox, never to a stretched image.
        let cachedSize = Self.cachedImageSize(for: currentURL)
        let imgAspect: CGFloat
        if let s = cachedSize, s.width > 0, s.height > 0 {
            imgAspect = s.width / s.height
        } else if hasSrc {
            imgAspect = src.width / src.height
        } else {
            imgAspect = screen.width / screen.height
        }
        let targetRect = Self.fitRect(aspect: imgAspect, in: screen)

        // Hero's REST rect is the image's actual displayed rect inside the
        // source bubble — NOT the bubble container's rect. The captured
        // sourceFrame is the bubble (aspect ~0.77), but the image inside is
        // aspect-fitted with its own aspect; if the two differ, the bubble
        // has transparent letterbox around the image. Starting the hero at
        // the bubble's rect means the hero's interior letterbox (40pt on
        // each side for a tall portrait in a square-ish bubble) would
        // animate away at the same time the rect is translating — users
        // read that as "enlarges, then shrinks to target". Instead, start
        // at the image's real rect inside the bubble: hero and chat image
        // overlap exactly at t=0, no letterbox at any frame.
        let srcRect: CGRect
        if hasSrc {
            let fit = Self.fitRect(aspect: imgAspect, in: CGSize(width: src.width, height: src.height))
            srcRect = CGRect(
                x: src.minX + fit.minX,
                y: src.minY + fit.minY,
                width: fit.width,
                height: fit.height
            )
        } else {
            srcRect = src
        }

        // Hero animates a single rectangle from srcRect (image's real rect in
        // the bubble) to targetRect (on-screen fit). Both have the image's
        // aspect, so the rect's aspect is constant throughout — no mid-
        // animation letterbox changes, no scaleEffect/offset tricks.
        let baseRect: CGRect = appeared ? targetRect : srcRect
        let dragK = dragDismissScale
        let heroW = max(baseRect.width * dragK, 0)
        let heroH = max(baseRect.height * dragK, 0)
        let heroCX = baseRect.midX
        let heroCY = baseRect.midY + verticalDrag

        return ZStack {
                Color.black
                    .ignoresSafeArea()
                    .opacity(appeared ? backgroundOpacity : 0)

                // Real gallery (paging, pinch-zoom). Mounted from t=0 so its
                // UIPageViewController is fully laid out by the time the hero
                // hands off — avoids a blank/half-rendered frame at the swap.
                // The old 1206x0 layout failure came from applying a shrinking
                // scaleEffect directly to TabView during the hero grow; in the
                // current architecture TabView's frame is fixed (screenSize)
                // and its image renders at a fixed imageRect, so its internal
                // layout is stable even while hidden behind the hero.
                TabView(selection: $currentIndex) {
                    ForEach(Array(state.imageURLs.enumerated()), id: \.offset) { index, url in
                        ZoomableImagePage(
                            imageURL: url,
                            imageRect: targetRect,
                            screenSize: screen,
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
                // Critical: TabView under .page style still honors the bottom
                // safe area (and on some iOS versions the top one too) even
                // when an ancestor calls .ignoresSafeArea(). The inset shifts
                // the TabView's child frame down by ~top_inset and shrinks
                // its height by ~bottom_inset. ZoomableImagePage uses
                // .position(imageRect.midX, imageRect.midY) — coordinates
                // computed against the SCREEN — but .position is interpreted
                // in the ZoomableImagePage's parent coordinate space (the
                // TabView's child frame). If that frame is offset, the image
                // lands at screen y = top_inset + imageRect.midY instead of
                // imageRect.midY. The hero (rendered directly in the
                // .ignoresSafeArea() ZStack) IS at imageRect.midY, so the
                // hero→TabView swap visibly jumps the image down by the top
                // inset and crops differently — users read this as "image
                // fills the screen, then shrinks with black borders".
                // .ignoresSafeArea() on the TabView itself eliminates the
                // inset so both views share one coord system.
                .ignoresSafeArea()
                .offset(y: verticalDrag)
                .scaleEffect(dragDismissScale)
                .scrollDisabled(verticalDrag != 0)
                .simultaneousGesture(verticalDismissGesture)
                .onChange(of: currentIndex) { newIndex in
                    resetZoom()
                    if newIndex <= 1, !isLoadingMore, !reachedEnd, state.loadMoreOlder != nil {
                        Task { await loadMoreIfNeeded() }
                    }
                }
                .opacity(inHeroPhase ? 0 : 1)
                .allowsHitTesting(!inHeroPhase)

                // Hero image — rendered at heroRect (src→targetRect animated).
                // Since targetRect is a screen-aspect-fit of src's aspect, the
                // Hero and the TabView's image land at the exact same pixel
                // rect when the hero animation completes. The handoff swap is
                // visually a no-op — no "enlarge then shrink" flicker.
                if hasSrc {
                    HeroImageView(url: currentURL)
                        .frame(width: heroW, height: heroH)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .position(x: heroCX, y: heroCY)
                        .opacity(inHeroPhase ? 1 : 0)
                        .allowsHitTesting(false)
                        .onAppear {
                            GalleryDbg.log("Hero geom", "screen=\(screen.width)x\(screen.height) src=\(src) srcRect=\(srcRect) target=\(targetRect) imgAspect=\(imgAspect)")
                        }
                }

                if !inHeroPhase, state.imageURLs.count > 1 {
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
            GalleryDbg.log("onAppear", "inHeroPhase=\(inHeroPhase)")
            // Defer the animation start until AFTER SwiftUI has rendered
            // this view one time with appeared=false. Inline withAnimation
            // inside onAppear was giving SwiftUI no chance to commit the
            // initial rest-frame — it seems to have been interpolating
            // from a default identity state (scale=1 fullscreen) to the
            // appeared=true target, which both happen to be scale=1 but
            // with a momentary "big" frame in between that users read as
            // an overshoot. One runloop tick of delay ensures the hero
            // is physically drawn at restScale first, then grown.
            DispatchQueue.main.async {
                withAnimation(.easeOut(duration: 0.22)) {
                    GalleryDbg.log("withAnim(appeared=true) START")
                    appeared = true
                }
            }
            if inHeroPhase {
                // 20ms buffer past the animation duration for safety.
                // Includes the extra async-dispatch tick above (~1 frame).
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.26) {
                    GalleryDbg.log("inHeroPhase=false (swap hero→TabView)")
                    // Instant toggle, no crossfade. The earlier 80ms fade was
                    // a hedge against single-frame misalignment, but in
                    // practice — when hero and TabView DO render at slightly
                    // different rects — the crossfade made both visible
                    // simultaneously for 80ms, which is exactly the
                    // "flicker, then shrink" the user reported. Instant
                    // swap is invisible if the two views match, and at
                    // worst it's a single off-frame instead of 80ms of
                    // visible mismatch.
                    inHeroPhase = false
                }
            }
        }
    }

    // MARK: - Derived visuals

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
                // Lower thresholds to match WeChat's touch: ~60pt drag or a
                // confident flick commits dismiss. Previous 110/450 made
                // users drag the photo nearly halfway down the screen.
                if h > w && (h > 60 || predictedH > 250) {
                    dismissBySwipe(direction: value.translation.height)
                } else if verticalDrag != 0 {
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                        verticalDrag = 0
                    }
                }
            }
    }

    /// Tap-to-dismiss. Hero image is already mounted at full-screen
    /// (underneath the opaque TabView), so we just toggle `inHeroPhase`
    /// to reveal it AND start the shrink animation in the same frame.
    /// No async dispatch — removes the one-tick lag that users felt as
    /// a slow response.
    private func dismissByTap() {
        GalleryDbg.log("dismissByTap()")
        let hasSrc = state.sourceFrame.width > 1 && state.sourceFrame.height > 1
        if hasSrc {
            // Any user pinch-zoom goes back to identity synchronously so
            // the swap to hero (which renders at scale 1) doesn't pop.
            scale = 1; lastScale = 1
            offset = .zero; lastOffset = .zero
            // Instant TabView→Hero swap (no crossfade). Same rationale as
            // the open-side swap: when the two views don't perfectly
            // overlap, an 80ms crossfade displays both at once and that's
            // what the user reads as "image briefly fills the screen".
            inHeroPhase = true
            GalleryDbg.log("  inHeroPhase=true, starting withAnim(appeared=false)")
            // Same defer trick as onAppear: the hero just mounted via
            // inHeroPhase=true; let SwiftUI commit that mount at the
            // current appeared=true fullscreen state before we fire the
            // shrink animation. Without the defer, SwiftUI batches the
            // mount and state-change into one transaction and the close
            // visibly overshoots at the start of the shrink.
            DispatchQueue.main.async {
                withAnimation(.easeOut(duration: 0.14)) {
                    appeared = false
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.17) {
                GalleryDbg.log("  onDismiss() (post-animation)")
                onDismiss()
            }
        } else {
            // No source frame — old behavior: fade + shrink in place.
            withAnimation(.easeOut(duration: 0.18)) {
                scale = 1; lastScale = 1
                offset = .zero; lastOffset = .zero
                appeared = false
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
                onDismiss()
            }
        }
    }

    /// Swipe-to-dismiss. If we have a source frame, reuse the hero path:
    /// swap TabView for hero (which now inherits the drag transforms and
    /// therefore matches the TabView's visible state on handoff), then
    /// animate the hero back to the source thumbnail frame. If no source
    /// frame was supplied, fall back to the old slide-off-bottom style.
    private func dismissBySwipe(direction: CGFloat) {
        let hasSrc = state.sourceFrame.width > 1 && state.sourceFrame.height > 1
        if hasSrc {
            scale = 1; lastScale = 1
            offset = .zero; lastOffset = .zero
            inHeroPhase = true
            withAnimation(.easeOut(duration: 0.18)) {
                appeared = false
                verticalDrag = 0
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.19) {
                onDismiss()
            }
        } else {
            let sign: CGFloat = direction >= 0 ? 1 : -1
            withAnimation(.easeOut(duration: 0.26)) {
                verticalDrag = 900 * sign
                appeared = false
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.26) {
                onDismiss()
            }
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

    private func resetZoom() {
        scale = 1; lastScale = 1
        offset = .zero; lastOffset = .zero
    }

    /// Double-tap zoom. `centerDelta` is the tap point expressed as an
    /// offset from the image view's center. Adjust `offset` so the
    /// tapped point stays under the finger after scaling.
    func doubleTap(at centerDelta: CGPoint) {
        withAnimation(.easeInOut(duration: 0.22)) {
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
}

// MARK: - Zoomable Image Page

private struct ZoomableImagePage: View {
    let imageURL: String
    /// Precomputed on-screen rect where the image renders at rest (no pinch,
    /// no drag). Matches the hero's final animation rect exactly, so the
    /// hero→TabView handoff is pixel-identical.
    let imageRect: CGRect
    /// Full page size (UIScreen bounds), used to size the cell so TabView
    /// doesn't fall back to GeometryReader's size report.
    let screenSize: CGSize
    @Binding var scale: CGFloat
    @Binding var lastScale: CGFloat
    @Binding var offset: CGSize
    @Binding var lastOffset: CGSize
    var onSingleTap: () -> Void
    /// Receives the double-tap location as a delta from the image view's
    /// center. GalleryContent uses it for zoom-from-tap-point.
    var onDoubleTap: (CGPoint) -> Void

    @State private var image: UIImage?
    @State private var isLoading: Bool
    /// Scheduled work item that fires the single-tap action after a short
    /// debounce window. A second tap cancels it and triggers the double-tap
    /// path instead — this is how we keep single-tap dismiss snappy while
    /// still disambiguating against double-tap zoom.
    @State private var pendingSingleTap: DispatchWorkItem?

    init(
        imageURL: String,
        imageRect: CGRect,
        screenSize: CGSize,
        scale: Binding<CGFloat>,
        lastScale: Binding<CGFloat>,
        offset: Binding<CGSize>,
        lastOffset: Binding<CGSize>,
        onSingleTap: @escaping () -> Void,
        onDoubleTap: @escaping (CGPoint) -> Void
    ) {
        self.imageURL = imageURL
        self.imageRect = imageRect
        self.screenSize = screenSize
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
        // Use a GeometryReader to log the ACTUAL frame TabView gives us, in
        // global screen coords. If TabView (.page) is still applying a safe-
        // area inset to its child despite our .ignoresSafeArea(), the global
        // origin will be (0, top_inset) instead of (0, 0) — that's the
        // signature of the bug.
        GeometryReader { geo in
            let globalFrame = geo.frame(in: .global)
            ZStack {
                Color.clear
                    .onAppear {
                        GalleryDbg.log(
                            "ZoomableImagePage geom",
                            "size=\(geo.size) globalOrigin=(\(globalFrame.minX),\(globalFrame.minY)) safeArea=\(geo.safeAreaInsets)"
                        )
                    }

            if let image = image {
                Image(uiImage: image)
                    .resizable()
                    // aspectRatio(.fit) guarantees the image is never stretched
                    // inside the frame, even if imageRect's aspect doesn't
                    // perfectly match the image's aspect (e.g., sourceFrame was
                    // a bubble container instead of the image's displayed rect).
                    // Worst case: letterbox bars. Never distortion.
                    .aspectRatio(contentMode: .fit)
                    .frame(width: imageRect.width, height: imageRect.height)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .scaleEffect(scale, anchor: .center)
                    .offset(x: offset.width, y: offset.height)
                    // Don't use .position(imageRect.midX, .midY) — those are
                    // SCREEN coords, but .position is interpreted in this
                    // view's parent coords. If the parent (TabView page) is
                    // inset by the top safe area, the image lands top_inset
                    // pixels too low, and the image is also clipped at the
                    // page's bottom. Hand-off from the hero (which DOES use
                    // screen coords) shows the visible image jumping down
                    // and shrinking. ZStack auto-centering plus the outer
                    // .ignoresSafeArea() below puts the image at the
                    // GeometryReader's local center, which after ignoring
                    // the inset coincides with the screen center where the
                    // hero ends.
                    .gesture(pinchGesture)
                    // Pan is attached ONLY while zoomed. At rest scale, no
                    // drag gesture on the image — UIPageViewController sees
                    // the touches and left/right paging works.
                    .simultaneousGesture(scale > 1.05 ? panGesture : nil)
                    .simultaneousGesture(
                        SpatialTapGesture(count: 2)
                            .onEnded { event in
                                GalleryDbg.log("double-tap detected")
                                pendingSingleTap?.cancel()
                                pendingSingleTap = nil
                                // event.location is relative to the Image
                                // view (which is sized to imageRect), so its
                                // center is at (w/2, h/2) of that rect.
                                let dx = event.location.x - imageRect.width / 2
                                let dy = event.location.y - imageRect.height / 2
                                onDoubleTap(CGPoint(x: dx, y: dy))
                            }
                    )
                    .onTapGesture {
                        GalleryDbg.log("single-tap scheduled (80ms debounce)")
                        let task = DispatchWorkItem {
                            GalleryDbg.log("single-tap fires (after debounce)")
                            onSingleTap()
                            pendingSingleTap = nil
                        }
                        pendingSingleTap?.cancel()
                        pendingSingleTap = task
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08, execute: task)
                    }
                    .longPressToSaveImage(url: imageURL)
            } else if isLoading {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
            } else {
                Image(systemName: "photo")
                    .font(.system(size: 48))
                    .foregroundColor(.gray)
            }
            }  // ZStack
            .frame(width: geo.size.width, height: geo.size.height)
            .contentShape(Rectangle())
        }  // GeometryReader
        // Critical: extend BEYOND the safe area from inside the TabView page.
        // .ignoresSafeArea() on the TabView itself didn't propagate to its
        // UIPageViewController-managed children (the pages still got an
        // inset frame). Adding it here, on the page content, expands the
        // GeometryReader to the full screen and erases the inset that had
        // been shifting the image down ~top_inset pixels relative to the
        // hero's screen-coord rect.
        .ignoresSafeArea()
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

// MARK: - Hero Image
//
// Plain Image-backed view whose frame is animated by its parent between
// the tapped thumbnail rect and the full-screen rect. No gestures, no
// pagination, no TabView — just a single resizable image so Core
// Animation can run the frame/position interpolation on the GPU without
// fighting any UIKit controls underneath. Used only during open/close;
// once the hero lands, the real TabView takes over.

private struct HeroImageView: View {
    let url: String
    @State private var image: UIImage?

    init(url: String) {
        self.url = url
        // Seed from memory cache synchronously so the first frame of the
        // hero animation already has pixels — otherwise we'd animate an
        // empty rect and pop the image in halfway through.
        let preLoaded: UIImage? = ImageCacheManager.shared.image(for: url)
            ?? ImageCacheManager.shared.image(for: url + "?thumb=1")
        self._image = State(initialValue: preLoaded)
    }

    var body: some View {
        Group {
            if let image = image {
                // aspectRatio(.fit) keeps the image at its natural aspect even
                // when the outer frame's aspect differs — prevents ugly
                // stretching when sourceFrame's aspect doesn't match the
                // image's aspect.
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else {
                Color.black.opacity(0.001)
            }
        }
        .task(id: url) {
            if image == nil {
                image = await ImageCacheManager.shared.loadImage(from: url)
            }
        }
    }
}
