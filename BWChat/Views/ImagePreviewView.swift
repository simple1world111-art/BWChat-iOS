// BWChat/Views/ImagePreviewView.swift
// Full-screen image gallery with center-zoom, swipe/tap to dismiss

import SwiftUI

// MARK: - Shared state so overlay can live at root level (above tab bar)

@MainActor
class ImageGalleryState: ObservableObject {
    static let shared = ImageGalleryState()
    @Published var isPresented = false
    @Published var imageURLs: [String] = []
    @Published var initialIndex: Int = 0

    func show(urls: [String], index: Int) {
        imageURLs = urls
        initialIndex = index
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
    @State private var layoutReady = false

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
                currentIndex = state.initialIndex
                // Let TabView finish its initial layout pass before animating in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) {
                    layoutReady = true
                    withAnimation(.easeOut(duration: 0.22)) {
                        appeared = true
                    }
                }
            }
            .onDisappear {
                appeared = false
                layoutReady = false
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
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                let h = value.translation.height
                let w = value.translation.width
                // Allow dismiss drag as long as vertical component isn't negligible
                // compared to horizontal — enables diagonal swipe-down to dismiss
                if abs(h) > abs(w) * 0.25 || abs(verticalDrag) > 0 {
                    verticalDrag = h
                }
            }
            .onEnded { value in
                let h = abs(value.translation.height)
                let predictedH = abs(value.predictedEndTranslation.height)
                if h > 50 || predictedH > 250 {
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
        .task {
            image = await ImageCacheManager.shared.loadImage(from: imageURL)
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
