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
    /// Normalized tap point on the thumbnail (for zoom-from-tap entrance animation).
    @Published var openAnchor: UnitPoint = .center
    /// Incremented on every show() so the overlay can force a fresh GalleryContent
    /// view identity even when the same image is tapped twice in a row.
    @Published var openToken: Int = 0

    func show(urls: [String], index: Int, tapAnchor: UnitPoint = .center) {
        imageURLs = urls
        initialIndex = index
        openAnchor = tapAnchor
        openToken &+= 1
        isPresented = true
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
                    imageURLs: state.imageURLs,
                    initialIndex: state.initialIndex,
                    openAnchor: state.openAnchor,
                    onDismiss: { state.isPresented = false }
                )
                .id(state.openToken)
            }
        }
        .ignoresSafeArea()
    }
}

// MARK: - Gallery Content (fresh instance per open)

private struct GalleryContent: View {
    let imageURLs: [String]
    let initialIndex: Int
    let openAnchor: UnitPoint
    let onDismiss: () -> Void

    @State private var currentIndex: Int
    @State private var appeared: Bool = false
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var verticalDrag: CGFloat = 0

    init(imageURLs: [String], initialIndex: Int, openAnchor: UnitPoint, onDismiss: @escaping () -> Void) {
        self.imageURLs = imageURLs
        self.initialIndex = initialIndex
        self.openAnchor = openAnchor
        self.onDismiss = onDismiss
        self._currentIndex = State(initialValue: initialIndex)
    }

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()
                .opacity(appeared ? backgroundOpacity : 0)

            TabView(selection: $currentIndex) {
                ForEach(Array(imageURLs.enumerated()), id: \.offset) { index, url in
                    ZoomableImagePage(
                        imageURL: url,
                        scale: index == currentIndex ? $scale : .constant(1),
                        lastScale: index == currentIndex ? $lastScale : .constant(1),
                        offset: index == currentIndex ? $offset : .constant(.zero),
                        lastOffset: index == currentIndex ? $lastOffset : .constant(.zero),
                        onSingleTap: { dismissByTap() },
                        onDoubleTap: { doubleTap() }
                    )
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .offset(y: verticalDrag)
            // Centered scale: entrance is a subtle spring from 0.88 → 1.0
            // and a swipe-drag adds a further shrink (dragDismissScale).
            // Zoom-from-tap-point was removed previously because its
            // off-center anchor interacted badly with TabView layout — the
            // center scale here is stable and matches what WeChat does.
            .scaleEffect(entranceScale * dragDismissScale)
            .opacity(appeared ? 1.0 : 0.0)
            .gesture(scale <= 1.05 ? verticalDismissGesture : nil)
            .onChange(of: currentIndex) { _ in
                resetZoom()
            }

            if imageURLs.count > 1 {
                VStack {
                    Text("\(currentIndex + 1) / \(imageURLs.count)")
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

    // MARK: - Gestures

    private var verticalDismissGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                let h = value.translation.height
                let w = value.translation.width
                // Loose angle check (matches the prior diagonal-tolerant
                // behavior); the actual "commit to dismiss" threshold lives
                // in onEnded so a tiny drag can't accidentally dismiss.
                if abs(h) > abs(w) * 0.1 || abs(verticalDrag) > 0 {
                    verticalDrag = h
                }
            }
            .onEnded { value in
                let h = abs(value.translation.height)
                let predictedH = abs(value.predictedEndTranslation.height)
                // Higher threshold so a small accidental drag doesn't
                // dismiss — only a deliberate downward swipe does.
                if h > 110 || predictedH > 450 {
                    dismissBySwipe(direction: value.translation.height)
                } else {
                    withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
                        verticalDrag = 0
                    }
                }
            }
    }

    /// Tap-to-dismiss: simple zoom-out + fade in place, no offset continuation.
    private func dismissByTap() {
        withAnimation(.easeOut(duration: 0.22)) {
            appeared = false
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
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

    private func doubleTap() {
        withAnimation(.easeInOut(duration: 0.25)) {
            if scale > 1 {
                resetZoom()
            } else {
                scale = 2.5; lastScale = 2.5
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
    var onDoubleTap: () -> Void

    @State private var image: UIImage?
    @State private var isLoading: Bool

    init(
        imageURL: String,
        scale: Binding<CGFloat>,
        lastScale: Binding<CGFloat>,
        offset: Binding<CGSize>,
        lastOffset: Binding<CGSize>,
        onSingleTap: @escaping () -> Void,
        onDoubleTap: @escaping () -> Void
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
                        .simultaneousGesture(scale > 1.05 ? panGesture : nil)
                        .onTapGesture(count: 2) { onDoubleTap() }
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
