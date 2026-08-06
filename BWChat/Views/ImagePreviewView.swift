// BWChat/Views/ImagePreviewView.swift
// Full-screen image gallery with zoom-from-tap-point entrance.

import SwiftUI
import UIKit

// MARK: - Location-aware pinch support (iOS 16 compatible)

/// SwiftUI's iOS 16 MagnificationGesture reports only a scale value, so it
/// cannot preserve the content beneath the midpoint of the user's fingers.
/// This bridge observes a UIKit pinch at the window level, without blocking
/// the gallery's paging, tapping, or AVPlayer controls.
struct LocationAwarePinchEvent {
    let state: UIGestureRecognizer.State
    let magnification: CGFloat
    /// Location and size in the media preview's local coordinate space.
    let location: CGPoint
    let viewportSize: CGSize
}

enum LocationAwareZoomMath {
    /// The media-space point currently displayed beneath a viewport-space
    /// location. Both points are expressed relative to the media center.
    static func contentPoint(
        under location: CGPoint,
        scale: CGFloat,
        offset: CGSize
    ) -> CGPoint {
        let safeScale = max(scale, 0.001)
        return CGPoint(
            x: (location.x - offset.width) / safeScale,
            y: (location.y - offset.height) / safeScale
        )
    }

    /// Offset needed to keep `contentPoint` beneath `location` at `scale`.
    static func offset(
        keeping contentPoint: CGPoint,
        under location: CGPoint,
        scale: CGFloat
    ) -> CGSize {
        CGSize(
            width: location.x - contentPoint.x * scale,
            height: location.y - contentPoint.y * scale
        )
    }
}

struct LocationAwarePinchGesture: UIViewRepresentable {
    let isEnabled: Bool
    let onEvent: (LocationAwarePinchEvent) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(isEnabled: isEnabled, onEvent: onEvent)
    }

    func makeUIView(context: Context) -> AttachmentView {
        let view = AttachmentView()
        view.isUserInteractionEnabled = false
        view.coordinator = context.coordinator
        return view
    }

    func updateUIView(_ uiView: AttachmentView, context: Context) {
        context.coordinator.update(isEnabled: isEnabled, onEvent: onEvent)
        context.coordinator.attach(to: uiView.window, coordinateView: uiView)
    }

    static func dismantleUIView(_ uiView: AttachmentView, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class AttachmentView: UIView {
        weak var coordinator: Coordinator?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            coordinator?.attach(to: window, coordinateView: self)
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        private weak var attachedWindow: UIWindow?
        private weak var coordinateView: UIView?
        private var eventHandler: (LocationAwarePinchEvent) -> Void
        private lazy var recognizer: UIPinchGestureRecognizer = {
            let recognizer = PreviewPinchGestureRecognizer(
                target: self,
                action: #selector(handlePinch(_:))
            )
            recognizer.delegate = self
            recognizer.cancelsTouchesInView = false
            recognizer.delaysTouchesBegan = false
            recognizer.delaysTouchesEnded = false
            return recognizer
        }()

        init(
            isEnabled: Bool,
            onEvent: @escaping (LocationAwarePinchEvent) -> Void
        ) {
            self.eventHandler = onEvent
            super.init()
            recognizer.isEnabled = isEnabled
        }

        func update(
            isEnabled: Bool,
            onEvent: @escaping (LocationAwarePinchEvent) -> Void
        ) {
            eventHandler = onEvent
            if recognizer.isEnabled != isEnabled {
                recognizer.isEnabled = isEnabled
            }
        }

        func attach(to window: UIWindow?, coordinateView: UIView) {
            guard attachedWindow !== window || self.coordinateView !== coordinateView else {
                return
            }
            detach()
            attachedWindow = window
            self.coordinateView = coordinateView
            window?.addGestureRecognizer(recognizer)
        }

        func detach() {
            attachedWindow?.removeGestureRecognizer(recognizer)
            attachedWindow = nil
            coordinateView = nil
        }

        @objc private func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
            guard recognizer.isEnabled, let coordinateView else { return }
            eventHandler(
                LocationAwarePinchEvent(
                    state: recognizer.state,
                    magnification: recognizer.scale,
                    location: recognizer.location(in: coordinateView),
                    viewportSize: coordinateView.bounds.size
                )
            )
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            // A two-finger zoom owns the touch sequence. In particular it must
            // not run alongside UIPageViewController's pan recognizer or the
            // vertical-dismiss drag; doing so lets a pinch move to another page
            // and leaves a stale verticalDrag behind.
            !(otherGestureRecognizer is UIPinchGestureRecognizer)
                && !(otherGestureRecognizer is UIPanGestureRecognizer)
        }
    }

    /// When AVKit installs its own pinch recognizer, make the preview's
    /// location-aware recognizer authoritative instead of applying both zooms.
    private final class PreviewPinchGestureRecognizer: UIPinchGestureRecognizer {
        override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool {
            if preventedGestureRecognizer is UIPinchGestureRecognizer
                || preventedGestureRecognizer is UIPanGestureRecognizer {
                return true
            }
            return super.canPrevent(preventedGestureRecognizer)
        }

        override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool {
            if preventingGestureRecognizer is UIPinchGestureRecognizer
                || preventingGestureRecognizer is UIPanGestureRecognizer {
                return false
            }
            return super.canBePrevented(by: preventingGestureRecognizer)
        }
    }
}

// MARK: - Direction-locked pull-to-dismiss support

struct DirectionLockedDismissEvent {
    let state: UIGestureRecognizer.State
    let translation: CGPoint
    let velocity: CGPoint
}

enum GalleryVerticalDismissMath {
    /// Do not move the image for tiny finger tremors. This also gives the
    /// direction arbiter enough travel to distinguish a page swipe from a
    /// pull-to-dismiss before anything visible changes.
    static let visualDeadZone: CGFloat = 18
    static let distanceThreshold: CGFloat = 72
    static let minimumFlickDistance: CGFloat = 28
    static let flickVelocityThreshold: CGFloat = 900

    static func visualTranslation(for rawTranslation: CGFloat) -> CGFloat {
        let magnitude = abs(rawTranslation)
        guard magnitude > visualDeadZone else { return 0 }
        let visibleMagnitude = magnitude - visualDeadZone
        return rawTranslation >= 0 ? visibleMagnitude : -visibleMagnitude
    }

    static func shouldDismiss(translation: CGFloat, velocity: CGFloat) -> Bool {
        let distance = abs(translation)
        return distance >= distanceThreshold
            || (distance >= minimumFlickDistance && abs(velocity) >= flickVelocityThreshold)
    }
}

/// A window-level one-finger pan that arbitrates direction before either the
/// gallery or UIPageViewController moves. Vertical intent owns the sequence;
/// horizontal intent fails immediately and leaves paging untouched.
struct DirectionLockedDismissGesture: UIViewRepresentable {
    let isEnabled: Bool
    let onEvent: (DirectionLockedDismissEvent) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(isEnabled: isEnabled, onEvent: onEvent)
    }

    func makeUIView(context: Context) -> AttachmentView {
        let view = AttachmentView()
        view.isUserInteractionEnabled = false
        view.coordinator = context.coordinator
        return view
    }

    func updateUIView(_ uiView: AttachmentView, context: Context) {
        context.coordinator.update(isEnabled: isEnabled, onEvent: onEvent)
        context.coordinator.attach(to: uiView.window, coordinateView: uiView)
    }

    static func dismantleUIView(_ uiView: AttachmentView, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class AttachmentView: UIView {
        weak var coordinator: Coordinator?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            coordinator?.attach(to: window, coordinateView: self)
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        private weak var attachedWindow: UIWindow?
        private weak var coordinateView: UIView?
        private var eventHandler: (DirectionLockedDismissEvent) -> Void
        private lazy var recognizer: UIPanGestureRecognizer = {
            let recognizer = PreviewVerticalPanGestureRecognizer(
                target: self,
                action: #selector(handlePan(_:))
            )
            recognizer.delegate = self
            recognizer.minimumNumberOfTouches = 1
            recognizer.maximumNumberOfTouches = 1
            recognizer.cancelsTouchesInView = true
            recognizer.delaysTouchesBegan = false
            recognizer.delaysTouchesEnded = false
            return recognizer
        }()

        init(
            isEnabled: Bool,
            onEvent: @escaping (DirectionLockedDismissEvent) -> Void
        ) {
            self.eventHandler = onEvent
            super.init()
            recognizer.isEnabled = isEnabled
        }

        func update(
            isEnabled: Bool,
            onEvent: @escaping (DirectionLockedDismissEvent) -> Void
        ) {
            eventHandler = onEvent
            if recognizer.isEnabled != isEnabled {
                recognizer.isEnabled = isEnabled
            }
        }

        func attach(to window: UIWindow?, coordinateView: UIView) {
            guard attachedWindow !== window || self.coordinateView !== coordinateView else { return }
            detach()
            attachedWindow = window
            self.coordinateView = coordinateView
            window?.addGestureRecognizer(recognizer)
        }

        func detach() {
            recognizer.isEnabled = false
            attachedWindow?.removeGestureRecognizer(recognizer)
            attachedWindow = nil
            coordinateView = nil
        }

        @objc private func handlePan(_ recognizer: UIPanGestureRecognizer) {
            guard recognizer.isEnabled, let coordinateView else { return }
            eventHandler(
                DirectionLockedDismissEvent(
                    state: recognizer.state,
                    translation: recognizer.translation(in: coordinateView),
                    velocity: recognizer.velocity(in: coordinateView)
                )
            )
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer,
                  let coordinateView else { return false }
            let velocity = pan.velocity(in: coordinateView)
            // A modest vertical bias prevents diagonal pulls from nudging the
            // adjacent page. Near-45-degree input intentionally remains a page
            // swipe because the user's direction is ambiguous.
            return abs(velocity.y) > abs(velocity.x) * 1.12
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            false
        }

    }

    private final class PreviewVerticalPanGestureRecognizer: UIPanGestureRecognizer {
        override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool {
            if preventedGestureRecognizer is UIPinchGestureRecognizer {
                return false
            }
            if preventedGestureRecognizer is UIPanGestureRecognizer {
                return true
            }
            return super.canPrevent(preventedGestureRecognizer)
        }

        override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool {
            if preventingGestureRecognizer is UIPinchGestureRecognizer {
                return true
            }
            if preventingGestureRecognizer is UIPanGestureRecognizer {
                return false
            }
            return super.canBePrevented(by: preventingGestureRecognizer)
        }
    }
}

// MARK: - Debug logging (remove after diagnosing open/close jitter + lag)

enum GalleryDbg {
    /// Keep call sites lightweight in case gallery diagnostics are needed
    /// again, but never print during interactive transitions. Console I/O in a
    /// Debug build can otherwise block frames while opening, paging or closing.
    static func log(_ tag: String, _ fields: String = "") {}
}

// MARK: - Shared state so overlay can live at root level (above tab bar)

enum ImageGallerySourceContentMode: Equatable {
    case fit
    case fill
}

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
    /// Stable identity of the tapped thumbnail. Unlike view-local state this
    /// survives LazyVGrid cell reconstruction while the gallery is presented.
    @Published var activeSourceID: String?
    /// Chat bubbles use aspect-fit thumbnails, while Moments uses square
    /// aspect-fill crops. The hero needs to know which endpoint to reproduce.
    @Published var sourceContentMode: ImageGallerySourceContentMode = .fit
    @Published var sourceCornerRadius: CGFloat = 14

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
        sourceContentMode: ImageGallerySourceContentMode = .fit,
        sourceCornerRadius: CGFloat = 14,
        loadMoreOlder: (() async -> Int)? = nil
    ) {
        GalleryDbg.log("show()", "src=\(sourceFrame)")
        let requestedURL = urls.indices.contains(index) ? urls[index] : urls.first
        var seen = Set<String>()
        imageURLs = urls.filter { seen.insert($0).inserted }
        initialIndex = requestedURL.flatMap(imageURLs.firstIndex(of:)) ?? 0
        self.sourceFrame = sourceFrame
        self.sourceContentMode = sourceContentMode
        self.sourceCornerRadius = sourceCornerRadius
        self.loadMoreOlder = loadMoreOlder
        openToken &+= 1
        isPresented = true
    }

    /// Prepending by stable URL keeps existing pages alive and avoids decoding
    /// them again when older history is loaded in the gallery.
    @discardableResult
    func prependUnique(_ urls: some Sequence<String>) -> Int {
        var seen = Set(imageURLs)
        let additions = urls.filter { seen.insert($0).inserted }
        guard !additions.isEmpty else { return 0 }
        imageURLs.insert(contentsOf: additions, at: 0)
        return additions.count
    }

    /// Call instead of setting isPresented = false directly so the
    /// loadMoreOlder closure (which may retain a chat view-model) is
    /// released when the gallery closes.
    func dismiss() {
        GalleryDbg.log("state.dismiss()")
        isPresented = false
        activeSourceID = nil
        loadMoreOlder = nil
    }
}

// MARK: - Tap + global-frame capture helper
//
// Image thumbnails use this modifier to surface their global-coordinate
// frame at the moment of tap — callers pass it to `ImageGalleryState.show`
// so the full-screen gallery animates from that exact position.

extension View {
    func onTapCaptureFrame(
        sourceID: String? = nil,
        perform action: @escaping (CGRect) -> Void
    ) -> some View {
        modifier(OnTapCaptureFrameModifier(sourceID: sourceID, action: action))
    }
}

private struct OnTapCaptureFrameModifier: ViewModifier {
    let sourceID: String?
    let action: (CGRect) -> Void
    @ObservedObject private var galleryState = ImageGalleryState.shared
    @State private var frame: CGRect = .zero
    @State private var ownsActiveSource = false

    private var shouldHideSource: Bool {
        guard galleryState.isPresented else { return false }
        if let sourceID {
            return galleryState.activeSourceID == sourceID
        }
        return ownsActiveSource
    }

    func body(content: Content) -> some View {
        content
            // A shared-element transition must not draw the source thumbnail
            // and the flying hero at the same time. Keeping the tapped source
            // hidden until the overlay is removed eliminates the duplicate
            // image/ghosting that was visible while the black backdrop faded.
            // Opacity preserves layout and GeometryReader updates while hidden.
            .opacity(shouldHideSource ? 0 : 1)
            .background(
                GeometryReader { geo in
                    Color.clear
                        .onAppear { frame = geo.frame(in: .global) }
                        .onChange(of: geo.frame(in: .global)) { newFrame in
                            frame = newFrame
                        }
                }
            )
            .onTapGesture {
                ownsActiveSource = true
                if let sourceID {
                    galleryState.activeSourceID = sourceID
                }
                action(frame)

                // Some callers may reject the tap (for example while a
                // context menu owns the touch). Do not leave that view marked
                // as the source of a future, unrelated gallery presentation.
                DispatchQueue.main.async {
                    if !galleryState.isPresented {
                        ownsActiveSource = false
                        if galleryState.activeSourceID == sourceID {
                            galleryState.activeSourceID = nil
                        }
                    }
                }
            }
            .onChange(of: galleryState.isPresented) { isPresented in
                if !isPresented {
                    ownsActiveSource = false
                }
            }
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
    @State private var isPinching: Bool = false
    @State private var pinchStartScale: CGFloat = 1.0
    @State private var pinchContentPoint: CGPoint = .zero
    /// Selection captured when a pinch starts. It remains locked for the
    /// entire zoom session so an in-flight UIPageViewController pan cannot
    /// commit a page and reset the zoom underneath the user's fingers.
    @State private var pinchLockedIndex: Int?
    @State private var verticalDrag: CGFloat = 0
    @State private var isDismissing: Bool = false
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
        // The captured frame belongs to the image that opened the gallery.
        // After a normal page change we no longer know the on-screen frame of
        // the new thumbnail, so a center fade is safer than flying it into the
        // wrong grid cell.
        let hasSrc = src.width > 1
            && src.height > 1
            && currentIndex == state.initialIndex
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

        // Aspect-fit sources (chat bubbles) end at the actual letterboxed image
        // rect. Aspect-fill sources (Moments cells) keep the captured square as
        // their mask and scale the image far enough to cover it.
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

        // Hero is animated via .scaleEffect + .offset only — NOT .frame /
        // .position. The latter trigger a full SwiftUI layout pass on every
        // animation frame, which on a complex view tree (TabView with
        // UIPageViewController child still mounted underneath) drops the
        // animation framerate to "you can see the intermediate frames"
        // territory. scaleEffect and offset, by contrast, are CALayer
        // affineTransform changes — interpolated by Core Animation on the
        // GPU at the display's full refresh rate, no layout work per
        // frame. This is also how WeChat (and every native UIKit hero
        // transition) keeps the motion silky.
        //
        // The view's frame stays constant at targetRect throughout. The
        // animated transform takes the image from src→target and back.
        //
        // - At appeared=true: scale = the user's pinch zoom (default 1),
        //   offset = the user's pan (default 0). At rest this is identity,
        //   matching targetRect on screen.
        // - At appeared=false: aspect-fit uses the fitted source rect; aspect-
        //   fill scales until it covers the source frame and an animated mask
        //   reproduces the square crop used by Moments.
        //
        // Because both endpoints reduce to scale + translate, ONE
        // withAnimation can interpolate them. dismissByTap can change
        // scale/offset/appeared all together and the hero glides from
        // "zoomed visual" straight to "thumbnail rect" in one continuous
        // GPU-driven motion.
        let restScale: CGFloat
        let sourceMaskRect: CGRect
        if state.sourceContentMode == .fill, targetRect.width > 0, targetRect.height > 0 {
            restScale = max(src.width / targetRect.width, src.height / targetRect.height)
            sourceMaskRect = src
        } else {
            restScale = targetRect.width > 0 ? srcRect.width / targetRect.width : 1
            sourceMaskRect = srcRect
        }
        let restOffsetX: CGFloat = sourceMaskRect.midX - targetRect.midX
        let restOffsetY: CGFloat = sourceMaskRect.midY - targetRect.midY

        let baseScale: CGFloat = appeared ? scale : restScale
        let baseOffsetX: CGFloat = appeared ? offset.width : restOffsetX
        let baseOffsetY: CGFloat = appeared ? offset.height : restOffsetY

        let heroScale = baseScale * dragDismissScale
        let heroOffsetX = baseOffsetX
        let heroOffsetY = baseOffsetY + verticalDrag
        let heroMaskRect = appeared
            ? CGRect(origin: .zero, size: screen)
            : sourceMaskRect
        let heroMaskCornerRadius = appeared ? 0 : state.sourceCornerRadius

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
                    ForEach(Array(state.imageURLs.enumerated()), id: \.element) { index, url in
                        ZoomableImagePage(
                            imageURL: url,
                            imageRect: targetRect,
                            screenSize: screen,
                            scale: index == currentIndex ? $scale : .constant(1),
                            offset: index == currentIndex ? $offset : .constant(.zero),
                            lastOffset: index == currentIndex ? $lastOffset : .constant(.zero),
                            isPinching: index == currentIndex && isPinching,
                            dismissTranslation: index == currentIndex ? verticalDrag : 0,
                            dismissScale: index == currentIndex ? dragDismissScale : 1,
                            shouldLoadFullResolution: abs(index - currentIndex) <= 1,
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
                .frame(width: screen.width, height: screen.height)
                // Page scrolling and zoomed-image panning are mutually
                // exclusive. Without the scale condition, both the image drag
                // and UIPageViewController pan consume the same movement.
                .scrollDisabled(
                    isPinching
                        || pinchLockedIndex != nil
                        || scale > 1.05
                )
                .onChange(of: currentIndex) { newIndex in
                    if let lockedIndex = pinchLockedIndex {
                        if newIndex != lockedIndex {
                            var transaction = Transaction()
                            transaction.disablesAnimations = true
                            withTransaction(transaction) {
                                currentIndex = lockedIndex
                            }
                        }
                        return
                    }
                    resetZoom()
                    if newIndex <= 1, !isLoadingMore, !reachedEnd, state.loadMoreOlder != nil {
                        Task { await loadMoreIfNeeded() }
                    }
                }
                .opacity(inHeroPhase || (!hasSrc && !appeared) ? 0 : 1)
                // The window-level pinch recognizer remains active. Removing
                // hit testing here immediately cancels any page pan that began
                // on the first finger before the second finger touched down.
                .allowsHitTesting(!inHeroPhase && !isPinching)

                // Hero image — rendered at heroRect (src→targetRect animated).
                // Since targetRect is a screen-aspect-fit of src's aspect, the
                // Hero and the TabView's image land at the exact same pixel
                // rect when the hero animation completes. The handoff swap is
                // visually a no-op — no "enlarge then shrink" flicker.
                if hasSrc {
                    // GPU-only animation: scaleEffect + offset are CALayer
                    // transforms, animated on the render server without any
                    // SwiftUI layout work per frame. .frame/.position stay
                    // constant at the target rect.
                    //
                    // .compositingGroup() flattens the hero (image + clip
                    // shape) into a single CALayer before the transform is
                    // applied. Without it, SwiftUI may keep the image and
                    // its clip mask in separate layers and animate each
                    // independently — that's where the residual "small
                    // jitter at open" was coming from. With one layer, the
                    // transform is a single CGAffineTransform interpolation
                    // and there's nothing for the layers to drift relative
                    // to each other.
                    ZStack {
                        HeroImageView(url: currentURL)
                            .frame(width: targetRect.width, height: targetRect.height)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                            .compositingGroup()
                            .scaleEffect(heroScale, anchor: .center)
                            .offset(x: heroOffsetX, y: heroOffsetY)
                            .position(x: targetRect.midX, y: targetRect.midY)
                    }
                        .frame(width: screen.width, height: screen.height)
                        .mask {
                            RoundedRectangle(
                                cornerRadius: heroMaskCornerRadius,
                                style: .continuous
                            )
                            .frame(width: heroMaskRect.width, height: heroMaskRect.height)
                            .position(x: heroMaskRect.midX, y: heroMaskRect.midY)
                        }
                        .opacity(inHeroPhase ? 1 : 0)
                        .allowsHitTesting(false)
                        .onAppear {
                            GalleryDbg.log("Hero geom", "screen=\(screen.width)x\(screen.height) src=\(src) srcRect=\(srcRect) target=\(targetRect) restScale=\(restScale) restOffset=(\(restOffsetX),\(restOffsetY))")
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
        .background {
            ZStack {
                LocationAwarePinchGesture(
                    isEnabled: appeared && !inHeroPhase,
                    onEvent: { event in
                        handlePinch(event)
                    }
                )
                DirectionLockedDismissGesture(
                    isEnabled: appeared
                        && !inHeroPhase
                        && !isDismissing
                        && !isPinching
                        && scale <= 1.05,
                    onEvent: { event in
                        handleVerticalDismiss(event)
                    }
                )
            }
        }
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
                // easeOut, monotonic. The previous spring(damping≈0.92) was
                // visibly under-damped — it kept oscillating slightly past
                // its response time, and the hero→TabView swap happened
                // while the spring was still in motion. Users saw a
                // "still wiggling → suddenly frozen" discontinuity, which
                // came across as worse jitter than the original layout-
                // driven version. easeOut never overshoots, so the swap
                // window is forgiving.
                withAnimation(.easeOut(duration: 0.22)) {
                    GalleryDbg.log("withAnim(appeared=true) START")
                    appeared = true
                }
            }
            if inHeroPhase {
                // Swap right after the easeOut completes.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.24) {
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

    // MARK: - Direction-locked dismiss gesture

    private func handleVerticalDismiss(_ event: DirectionLockedDismissEvent) {
        guard scale <= 1.05, !isPinching, !isDismissing else { return }

        switch event.state {
        case .began:
            // Start from a deterministic resting point. The dead zone below
            // keeps this state change visually inert.
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                verticalDrag = 0
            }

        case .changed:
            verticalDrag = GalleryVerticalDismissMath.visualTranslation(
                for: event.translation.y
            )

        case .ended:
            if GalleryVerticalDismissMath.shouldDismiss(
                translation: event.translation.y,
                velocity: event.velocity.y
            ) {
                let direction = event.translation.y != 0
                    ? event.translation.y
                    : event.velocity.y
                dismissBySwipe(direction: direction)
            } else {
                settleVerticalDrag()
            }

        case .cancelled, .failed:
            settleVerticalDrag()

        default:
            break
        }
    }

    private func settleVerticalDrag() {
        guard verticalDrag != 0 else { return }
        // A monotonic curve cannot overshoot above/below the resting point;
        // the previous spring was the visible "up/down jump" after a small
        // pull that did not meet the dismiss threshold.
        withAnimation(.easeOut(duration: 0.16)) {
            verticalDrag = 0
        }
    }

    /// Tap-to-dismiss. Hero image is already mounted at full-screen beneath
    /// the opaque TabView. Reveal it without animation, commit that handoff,
    /// then animate the hero back to the source thumbnail.
    private func dismissByTap() {
        GalleryDbg.log("dismissByTap()")
        guard !isDismissing else { return }
        isDismissing = true
        let hasSrc = state.sourceFrame.width > 1
            && state.sourceFrame.height > 1
            && currentIndex == state.initialIndex
        if hasSrc {
            // Single-phase dismiss. The hero's transform (scaleEffect +
            // offset) now uses the user's current scale/offset directly
            // when appeared=true, so the moment inHeroPhase flips on,
            // the hero mounts at the user's current visual rect — zoomed
            // or not — matching the TabView pixel-for-pixel. One
            // withAnimation then drives scale → 1, offset → 0, appeared
            // → false together: the hero glides from "zoomed visual"
            // straight to "thumbnail rect" via a pure CALayer transform
            // animation. No layout passes, no two-phase stutter.
            var handoffTransaction = Transaction()
            handoffTransaction.disablesAnimations = true
            withTransaction(handoffTransaction) {
                inHeroPhase = true
            }
            GalleryDbg.log("  inHeroPhase=true, arm hero before dismiss")

            // Commit one stable full-screen hero frame before changing its
            // transform. Without this handoff frame SwiftUI can coalesce the
            // visibility swap and the shrink transaction, producing the small
            // jump seen at the beginning of every cancellation in the video.
            DispatchQueue.main.async {
                let duration = 0.24
                withAnimation(.easeInOut(duration: duration)) {
                    scale = 1; lastScale = 1
                    offset = .zero; lastOffset = .zero
                    appeared = false
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + duration + 0.01) {
                    GalleryDbg.log("  onDismiss() (post-animation)")
                    onDismiss()
                }
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
        guard !isDismissing else { return }
        isDismissing = true
        let hasSrc = state.sourceFrame.width > 1
            && state.sourceFrame.height > 1
            && currentIndex == state.initialIndex
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
        isPinching = false
        pinchLockedIndex = nil
        scale = 1; lastScale = 1
        offset = .zero; lastOffset = .zero
    }

    /// UIKit's pinch recognizer supplies the two-finger midpoint that the
    /// iOS 16 SwiftUI MagnificationGesture omits. Convert that midpoint into
    /// a stable point in the unscaled media, then continuously adjust offset
    /// so the same image pixel remains beneath the moving midpoint.
    private func handlePinch(_ event: LocationAwarePinchEvent) {
        let viewportCenter = CGPoint(
            x: event.viewportSize.width / 2,
            y: event.viewportSize.height / 2
        )
        let locationFromCenter = CGPoint(
            x: event.location.x - viewportCenter.x,
            y: event.location.y - viewportCenter.y
        )

        switch event.state {
        case .began:
            isPinching = true
            pinchLockedIndex = currentIndex
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                verticalDrag = 0
            }
            pinchStartScale = max(scale, 0.001)
            pinchContentPoint = LocationAwareZoomMath.contentPoint(
                under: locationFromCenter,
                scale: pinchStartScale,
                offset: offset
            )

        case .changed:
            guard isPinching else { return }
            let newScale = min(max(pinchStartScale * event.magnification, 0.5), 5)
            scale = newScale
            offset = LocationAwareZoomMath.offset(
                keeping: pinchContentPoint,
                under: locationFromCenter,
                scale: newScale
            )

        case .ended, .cancelled, .failed:
            guard isPinching else { return }
            isPinching = false
            if scale <= 1.05 {
                withAnimation(.easeOut(duration: 0.2)) {
                    scale = 1
                    offset = .zero
                    lastScale = 1
                    lastOffset = .zero
                }
                let lockedIndex = pinchLockedIndex
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                    if !isPinching, pinchLockedIndex == lockedIndex {
                        pinchLockedIndex = nil
                    }
                }
            } else {
                // Keep paging locked until zoom returns to 1 (usually by a
                // double tap or a subsequent pinch-out).
                lastScale = scale
                lastOffset = offset
            }

        default:
            break
        }
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
    @Binding var offset: CGSize
    @Binding var lastOffset: CGSize
    let isPinching: Bool
    /// Dismiss motion is rendered inside the page. The TabView itself must
    /// remain completely stationary, otherwise its UICollectionView is
    /// re-laid out on every animation frame and visibly jumps during rebound.
    let dismissTranslation: CGFloat
    let dismissScale: CGFloat
    /// Only the visible page and its immediate neighbors decode the original.
    /// The previous implementation started full-resolution work for the whole
    /// chat history as soon as the gallery opened.
    let shouldLoadFullResolution: Bool
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
        offset: Binding<CGSize>,
        lastOffset: Binding<CGSize>,
        isPinching: Bool,
        dismissTranslation: CGFloat,
        dismissScale: CGFloat,
        shouldLoadFullResolution: Bool,
        onSingleTap: @escaping () -> Void,
        onDoubleTap: @escaping (CGPoint) -> Void
    ) {
        self.imageURL = imageURL
        self.imageRect = imageRect
        self.screenSize = screenSize
        self._scale = scale
        self._offset = offset
        self._lastOffset = lastOffset
        self.isPinching = isPinching
        self.dismissTranslation = dismissTranslation
        self.dismissScale = dismissScale
        self.shouldLoadFullResolution = shouldLoadFullResolution
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
        // Keep this GeometryReader inside the page's valid layout bounds.
        // Expanding a TabView child with ignoresSafeArea makes the item taller
        // than its UICollectionView after adjustedContentInset; UIKit then
        // reports an undefined flow layout and the page bounces between
        // competing heights during the dismiss animation.
        GeometryReader { geo in
            let globalFrame = geo.frame(in: .global)
            // Keep the horizontal position in PAGE-local coordinates. During
            // an interactive page swipe `globalFrame.minX` continuously moves;
            // subtracting it here cancels the pager's movement and pins every
            // page image to the screen centre, so the content appears to switch
            // instantly instead of sliding. Only the vertical coordinate needs
            // global-to-local conversion for the pager's safe-area inset.
            let mediaCenterInPage = CGPoint(
                x: geo.size.width / 2,
                y: screenSize.height / 2 - globalFrame.minY
            )
            ZStack {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture {
                        GalleryDbg.log("background single-tap")
                        onSingleTap()
                    }
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
                    .scaleEffect(dismissScale, anchor: .center)
                    .offset(y: dismissTranslation)
                    .position(mediaCenterInPage)
                    // Pan is attached ONLY while zoomed. At rest scale, no
                    // drag gesture on the image — UIPageViewController sees
                    // the touches and left/right paging works.
                    .simultaneousGesture(scale > 1.05 && !isPinching ? panGesture : nil)
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
                        GalleryDbg.log("single-tap scheduled (50ms debounce)")
                        let task = DispatchWorkItem {
                            GalleryDbg.log("single-tap fires (after debounce)")
                            onSingleTap()
                            pendingSingleTap = nil
                        }
                        pendingSingleTap?.cancel()
                        pendingSingleTap = task
                        // 50ms is the lower edge of human "fast tap"
                        // detection — most double-taps are ≥80ms apart, so
                        // the disambiguation window stays correct, but the
                        // single-tap (which is the common dismiss action)
                        // fires ~30ms sooner. That's a perceptible latency
                        // win at the start of the close animation.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: task)
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
        .task(id: shouldLoadFullResolution) {
            let requestedURL = imageURL
            if let cached = ImageCacheManager.shared.image(for: requestedURL) {
                image = cached
                isLoading = false
                return
            }
            let thumbnail = ImageCacheManager.shared.image(for: requestedURL + "?thumb=1")
            image = thumbnail
            isLoading = thumbnail == nil && shouldLoadFullResolution
            guard shouldLoadFullResolution else { return }
            if let loaded = await ImageCacheManager.shared.loadImage(from: requestedURL) {
                guard !Task.isCancelled, requestedURL == imageURL else { return }
                image = loaded
            }
            guard requestedURL == imageURL else { return }
            isLoading = false
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
            let requestedURL = url
            image = ImageCacheManager.shared.image(for: requestedURL)
                ?? ImageCacheManager.shared.image(for: requestedURL + "?thumb=1")
            // Keep the visible transition texture stable. The page underneath
            // loads the original concurrently; swapping a 2048px texture into
            // this hero mid-transform forces a GPU upload during the animation
            // and is more noticeable than sharpening after the handoff.
        }
    }
}
