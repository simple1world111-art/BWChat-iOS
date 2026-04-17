// BWChat/Views/ImagePreviewView.swift
// Full-screen image gallery with center-zoom, swipe/tap to dismiss

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

    func show(urls: [String], index: Int, tapAnchor: UnitPoint = .center) {
        imageURLs = urls
        initialIndex = index
        openAnchor = tapAnchor
        isPresented = true
    }
}

// MARK: - Gallery Overlay (attach at root to cover tab bar)

struct ImageGalleryOverlay: View {
    @ObservedObject var state = ImageGalleryState.shared

    @State private var currentIndex: Int = 0
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var verticalDrag: CGFloat = 0
    @State private var appeared = false

    var body: some View {
        if state.isPresented {
            ZStack {
                Color.black
                    .ignoresSafeArea()
                    .opacity(backgroundOpacity)

                TabView(selection: $currentIndex) {
                    ForEach(Array(state.imageURLs.enumerated()), id: \.offset) { index, url in
                        ZoomableImagePage(
                            imageURL: url,
                            scale: index == currentIndex ? $scale : .constant(1),
                            lastScale: index == currentIndex ? $lastScale : .constant(1),
                            offset: index == currentIndex ? $offset : .constant(.zero),
                            lastOffset: index == currentIndex ? $lastOffset : .constant(.zero),
                            onSingleTap: { dismissGallery() },
                            onDoubleTap: { doubleTap() }
                        )
                        .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .offset(y: verticalDrag)
                .scaleEffect(dragDismissScale)
                // Use state.openAnchor directly — reading @State after onAppear
                // creates a one-frame window where the anchor is still .center,
                // which is what produces the visible "jump".
                .scaleEffect(appeared ? 1.0 : 0.28, anchor: state.openAnchor)
                .opacity(appeared ? 1.0 : 0.0)
                .gesture(scale <= 1.05 ? verticalDismissGesture : nil)
                .onChange(of: currentIndex) { _ in
                    resetZoom()
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
                // Set TabView's page without animation — otherwise the page-
                // transition animation (from default 0 → initialIndex) runs
                // simultaneously with the scale/opacity entrance and produces
                // the visible jitter during the zoom-in.
                var snap = Transaction()
                snap.disablesAnimations = true
                withTransaction(snap) {
                    currentIndex = state.initialIndex
                }
                // Run the entrance with an easeOut curve rather than a spring,
                // so the zoom-in doesn't overshoot past 1.0 and bounce back.
                DispatchQueue.main.async {
                    withAnimation(.easeOut(duration: 0.26)) {
                        appeared = true
                    }
                }
            }
            .onDisappear {
                appeared = false
                verticalDrag = 0
                resetZoom()
            }
        }
    }

    private var backgroundOpacity: Double {
        guard appeared else { return 0 }
        return 1.0 - min(abs(verticalDrag) / 250, 0.7)
    }

    private var dragDismissScale: CGFloat {
        let drag = abs(verticalDrag)
        if drag < 10 { return 1.0 }
        return max(1.0 - drag / 800, 0.6)
    }

    private var verticalDismissGesture: some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { value in
                let h = value.translation.height
                let w = value.translation.width
                // Very permissive: any drag with even a small vertical component
                // triggers dismiss (roughly >6° from pure horizontal)
                if abs(h) > abs(w) * 0.1 || abs(verticalDrag) > 0 {
                    verticalDrag = h
                }
            }
            .onEnded { value in
                let h = abs(value.translation.height)
                let predictedH = abs(value.predictedEndTranslation.height)
                if h > 40 || predictedH > 200 {
                    dismissGallery()
                } else {
                    withAnimation(.easeOut(duration: 0.2)) {
                        verticalDrag = 0
                    }
                }
            }
    }

    private func dismissGallery() {
        withAnimation(.easeOut(duration: 0.2)) {
            appeared = false
            verticalDrag = verticalDrag > 0 ? 400 : (verticalDrag < 0 ? -400 : 300)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            state.isPresented = false
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
    @State private var isLoading = true

    /// Initialise @State from the memory cache synchronously. This is the key
    /// to a jitter-free entrance: the gallery's zoom-in animation runs on the
    /// outer container, and if the inner content swaps from a placeholder
    /// (ProgressView) to a full-screen Image mid-animation the whole thing
    /// appears to shake. By the time the first frame is committed, the @State
    /// already holds the cached thumbnail / full-size image, so the content
    /// the entrance animation zooms in on is stable from frame one.
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
            // Resolve full-size asynchronously. If we're already showing the
            // cached thumbnail, this silently swaps to the high-res version
            // (same aspect ratio, no layout shift); if nothing was cached we
            // replace the placeholder once the bytes arrive.
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
