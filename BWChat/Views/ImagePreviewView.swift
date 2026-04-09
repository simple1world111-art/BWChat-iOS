// BWChat/Views/ImagePreviewView.swift
// Full-screen image gallery with center-zoom transition and horizontal swipe

import SwiftUI

struct ImageGalleryOverlay: View {
    let imageURLs: [String]
    let initialIndex: Int
    @Binding var isPresented: Bool

    @State private var currentIndex: Int = 0
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var verticalDrag: CGFloat = 0
    @State private var appeared = false

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()
                .opacity(backgroundOpacity)

            TabView(selection: $currentIndex) {
                ForEach(Array(imageURLs.enumerated()), id: \.offset) { index, url in
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
            .scaleEffect(appeared ? 1.0 : 0.3)
            .opacity(appeared ? 1.0 : 0.0)
            .gesture(scale <= 1.05 ? verticalDismissGesture : nil)
            .onChange(of: currentIndex) { _ in
                resetZoom()
            }

            // Top bar
            VStack {
                HStack {
                    if imageURLs.count > 1 {
                        Text("\(currentIndex + 1) / \(imageURLs.count)")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 6)
                            .background(.black.opacity(0.5))
                            .cornerRadius(16)
                    }
                    Spacer()
                    Button { dismissGallery() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 54)

                Spacer()

                HStack {
                    Spacer()
                    Button { saveCurrentImage() } label: {
                        Image(systemName: "square.and.arrow.down")
                            .font(.system(size: 18))
                            .foregroundColor(.white)
                            .padding(11)
                            .background(.black.opacity(0.5))
                            .cornerRadius(10)
                    }
                    .padding(.trailing, 16)
                    .padding(.bottom, 40)
                }
            }
            .opacity(scale <= 1.05 && verticalDrag == 0 && appeared ? 1 : 0)
        }
        .onAppear {
            currentIndex = initialIndex
            withAnimation(.spring(response: 0.3, dampingFraction: 0.82)) {
                appeared = true
            }
        }
    }

    private var backgroundOpacity: Double {
        guard appeared else { return 0 }
        let dragFade = 1.0 - min(abs(verticalDrag) / 300, 0.6)
        return dragFade
    }

    private var verticalDismissGesture: some Gesture {
        DragGesture(minimumDistance: 20)
            .onChanged { value in
                if abs(value.translation.height) > abs(value.translation.width) {
                    verticalDrag = value.translation.height
                }
            }
            .onEnded { value in
                if abs(value.translation.height) > 120 {
                    dismissGallery()
                } else {
                    withAnimation(.easeOut(duration: 0.2)) {
                        verticalDrag = 0
                    }
                }
            }
    }

    private func dismissGallery() {
        withAnimation(.easeOut(duration: 0.22)) {
            appeared = false
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
            isPresented = false
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
        verticalDrag = 0
    }

    private func saveCurrentImage() {
        Task {
            if let image = await ImageCacheManager.shared.loadImage(from: imageURLs[currentIndex]) {
                UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
            }
        }
    }
}

// MARK: - Zoomable Image Page (no DragGesture — lets TabView handle horizontal swipes)

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

// MARK: - View extension for easy usage

extension View {
    func imageGalleryOverlay(isPresented: Binding<Bool>, imageURLs: [String], initialIndex: Int) -> some View {
        self.overlay {
            if isPresented.wrappedValue {
                ImageGalleryOverlay(
                    imageURLs: imageURLs,
                    initialIndex: initialIndex,
                    isPresented: isPresented
                )
                .transition(.identity)
            }
        }
    }
}
